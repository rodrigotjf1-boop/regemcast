/**
 * Conta: os dados da empresa, o consumo do ciclo e quem tem acesso.
 *
 * Três cuidados que vêm de cicatriz:
 *
 * 1. O contexto de banco já está aberto na conta do request (interceptor), e a
 *    RLS filtra sozinha — mas todo `where` repete o `conta_id` mesmo assim. É
 *    cinto e suspensório: se um dia a policy for desligada, a query continua
 *    escopada em vez de passar a enxergar a base inteira em silêncio.
 * 2. O plano entra no MESMO select, por join. Ele é catálogo da distribuição,
 *    e até a migration 002 a RLS só o revelava em escopo de sistema — o que
 *    obrigava a abrir uma segunda transação (e pegar uma segunda conexão do
 *    pool) no meio da transação do request. Com poolMax=10, dez `GET /conta`
 *    simultâneos travavam o pool inteiro: cada um segurava uma conexão e
 *    esperava por outra. A 002 liberou a LEITURA do catálogo para o escopo do
 *    tenant (escrita continua só-sistema), e aqui basta ler junto.
 * 3. Suspender alguém incrementa `token_versao`. Sem isso a pessoa continua
 *    operando com o token que já tem na mão até ele expirar — a suspensão só
 *    valeria no próximo login, que é justamente o que não vai acontecer.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { and, asc, eq, sql, type SQL } from 'drizzle-orm';

import type { UsuarioAutenticado } from '../../common/auth.guard';
import { ContextoDb } from '../../db/contexto';
import {
  assinatura as tAssinatura,
  conta as tConta,
  plano as tPlano,
  usoCiclo as tUso,
  usuario as tUsuario,
} from '../../db/schema';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { recalcularPeriodosDaConta } from '../contato/habitos';
import { CnpjReceitaService } from '../seguranca/cnpj-receita.service';
import { gerarHashSenha } from '../auth/argon2';
import { cnpjValido, normalizarCnpj } from './cnpj';
import { AtualizarContaDto } from './dto/atualizar-conta.dto';
import { AtualizarUsuarioDto } from './dto/atualizar-usuario.dto';
import { CriarUsuarioDto } from './dto/criar-usuario.dto';
import { fusoValido } from './fuso';

/** De onde veio a ação, para a trilha de auditoria. */
export interface OrigemRequest {
  ip?: string;
  userAgent?: string;
}

export interface ContaDados {
  id: string;
  nome: string;
  cnpj: string | null;
  timezone: string;
  status: string;
  /** Descanso entre campanhas de marketing, em dias; 0 = desligado. */
  descansoMarketingDias: number;
}

export interface PlanoResumo {
  codigo: string;
  nome: string;
  disparosMes: number;
}

export interface AssinaturaResumo {
  status: string;
  cicloInicio: string;
  cicloFim: string;
  gratisAte: string | null;
}

export interface UsoResumo {
  disparos: number;
  /** `null` quando a conta ainda não tem plano — aí não há teto a informar. */
  teto: number | null;
  restantes: number | null;
}

export interface ContaResumo {
  conta: ContaDados;
  plano: PlanoResumo | null;
  assinatura: AssinaturaResumo | null;
  uso: UsoResumo;
  /**
   * Algum número guarda conversas (coexistência + resposta "sim")? É o que faz
   * o menu "Conversas" aparecer. A rota de conversas confere de novo.
   */
  conversasHabilitadas: boolean;
}

export interface UsuarioResumo {
  id: string;
  nome: string;
  email: string;
  papel: 'dono' | 'operador';
  status: 'ativo' | 'suspenso';
  ultimoLoginEm: string | null;
  criadoEm: string;
}

/**
 * `usuario.email` é único na base inteira e a RLS esconde o usuário das outras
 * contas — então checar antes com um `select` responderia "livre" para um
 * e-mail que o `insert` vai recusar. O jeito honesto é tentar inserir e ler o
 * código do Postgres.
 */
function violacaoUnica(erro: unknown): boolean {
  const e = erro as { code?: string; cause?: { code?: string } } | null;
  return e?.code === '23505' || e?.cause?.code === '23505';
}

function iso(valor: Date | null): string | null {
  return valor ? valor.toISOString() : null;
}

@Injectable()
export class ContaService {
  private readonly log = new Logger('Conta');

  constructor(
    private readonly ctx: ContextoDb,
    private readonly auditoria: AuditoriaService,
    // Opcional só para o teste montar o serviço sem rede; na aplicação o
    // SegurancaModule é global e sempre injeta.
    @Optional() private readonly cnpjReceita?: CnpjReceitaService,
  ) {}

  /** Dados da conta + assinatura + consumo do ciclo corrente, numa ida ao banco. */
  async resumo(): Promise<ContaResumo> {
    const contaId = this.ctx.contaObrigatoria();

    const [linha] = await this.ctx.db
      .select({
        id: tConta.id,
        nome: tConta.nome,
        cnpj: tConta.cnpj,
        timezone: tConta.timezone,
        status: tConta.status,
        descansoMarketingDias: tConta.descansoMarketingDias,
        assinaturaStatus: tAssinatura.status,
        cicloInicio: tAssinatura.cicloInicio,
        cicloFim: tAssinatura.cicloFim,
        gratisAte: tAssinatura.gratisAte,
        disparos: tUso.disparos,
        planoCodigo: tPlano.codigo,
        planoNome: tPlano.nome,
        planoDisparosMes: tPlano.disparosMes,
        conversasHabilitadas: sql<boolean>`exists (
          select 1 from wa_numero n
           where n.conta_id = conta.id and n.coexistencia and n.integrar_conversas is true
        )`,
      })
      .from(tConta)
      .leftJoin(tAssinatura, eq(tAssinatura.contaId, tConta.id))
      // O consumo é por ciclo: casar só por conta somaria o ciclo passado.
      .leftJoin(
        tUso,
        and(eq(tUso.contaId, tConta.id), eq(tUso.cicloInicio, tAssinatura.cicloInicio)),
      )
      // A assinatura manda no plano do ciclo; `conta.plano_id` é o fallback de
      // quem ainda não assinou. O coalesce resolve os dois no próprio join, na
      // transação do request — sem abrir contexto novo (ver item 2 no topo).
      .leftJoin(tPlano, eq(tPlano.id, sql`coalesce(${tAssinatura.planoId}, ${tConta.planoId})`))
      .where(eq(tConta.id, contaId))
      .limit(1);

    if (!linha) {
      throw new NotFoundException('Não encontramos esta conta. Entre de novo.');
    }

    // Conta sem plano (ou plano apagado do catálogo) deixa o join sem par: aí
    // o campo inteiro vem `null`, em vez de um objeto meio preenchido.
    const plano: PlanoResumo | null =
      linha.planoCodigo !== null &&
      linha.planoNome !== null &&
      linha.planoDisparosMes !== null
        ? {
            codigo: linha.planoCodigo,
            nome: linha.planoNome,
            disparosMes: linha.planoDisparosMes,
          }
        : null;

    // `uso_ciclo.disparos` é bigint no banco: o driver entrega string, e
    // "42" - 5000 viraria NaN sem avisar.
    const disparos = Number(linha.disparos ?? 0);
    const teto = plano?.disparosMes ?? null;

    return {
      conta: {
        id: linha.id,
        nome: linha.nome,
        cnpj: linha.cnpj,
        timezone: linha.timezone,
        status: linha.status,
        descansoMarketingDias: linha.descansoMarketingDias,
      },
      plano,
      // O leftJoin deixa tudo nulo quando a conta ainda não tem assinatura —
      // e aí o campo inteiro vem `null`, em vez de um objeto meio preenchido.
      assinatura:
        linha.cicloInicio && linha.cicloFim
          ? {
              status: linha.assinaturaStatus ?? 'cortesia',
              cicloInicio: linha.cicloInicio.toISOString(),
              cicloFim: linha.cicloFim.toISOString(),
              gratisAte: iso(linha.gratisAte),
            }
          : null,
      uso: {
        disparos,
        teto,
        restantes: teto === null ? null : Math.max(0, teto - disparos),
      },
      conversasHabilitadas: linha.conversasHabilitadas === true,
    };
  }

  /** Altera nome, CNPJ e/ou fuso da conta. Só o dono chega aqui (DonoGuard). */
  async atualizar(
    dto: AtualizarContaDto,
    atual: UsuarioAutenticado,
    origem: OrigemRequest = {},
  ): Promise<ContaDados> {
    const contaId = this.ctx.contaObrigatoria();
    const patch: { nome?: string; cnpj?: string | null; timezone?: string; descansoMarketingDias?: number } = {};

    if (dto.nome !== undefined) patch.nome = dto.nome.trim();

    if (dto.timezone !== undefined) {
      const tz = dto.timezone.trim();
      if (!fusoValido(tz)) {
        throw new BadRequestException(
          `Não reconhecemos o fuso horário "${tz}". Use o nome IANA, como America/Sao_Paulo.`,
        );
      }
      patch.timezone = tz;
    }

    if (dto.cnpj !== undefined) {
      const limpo = normalizarCnpj(dto.cnpj);
      if (limpo && !cnpjValido(limpo)) {
        throw new BadRequestException('Confira o CNPJ: os dígitos verificadores não batem.');
      }
      patch.cnpj = limpo;
    }

    if (dto.descansoMarketingDias !== undefined) patch.descansoMarketingDias = dto.descansoMarketingDias;

    if (Object.keys(patch).length === 0) {
      throw new BadRequestException('Informe o que alterar: nome, CNPJ, fuso horário ou descanso entre campanhas.');
    }

    const [antes] = await this.ctx.db
      .select({
        nome: tConta.nome,
        cnpj: tConta.cnpj,
        timezone: tConta.timezone,
        descansoMarketingDias: tConta.descansoMarketingDias,
        cnpjConferidoEm: tConta.cnpjConferidoEm,
      })
      .from(tConta)
      .where(eq(tConta.id, contaId))
      .limit(1);

    if (!antes) {
      throw new NotFoundException('Não encontramos esta conta. Entre de novo.');
    }

    // CNPJ conferido na Receita não se troca por aqui: é a identidade da conta
    // na Meta e o que impede a mesma empresa de ter duas contas. Troca legítima
    // (mudança societária) passa pelo suporte.
    const extra: { cnpjRazaoSocial?: string; cnpjSituacao?: string; cnpjConferidoEm?: SQL } = {};
    if (patch.cnpj !== undefined && patch.cnpj !== antes.cnpj) {
      if (antes.cnpjConferidoEm) {
        throw new BadRequestException(
          'O CNPJ desta conta já foi conferido na Receita e não pode ser trocado por aqui. Fale com o suporte do Regemcast.',
        );
      }
      if (patch.cnpj && this.cnpjReceita) {
        const conferido = await this.cnpjReceita.exigirAtivo(patch.cnpj);
        extra.cnpjRazaoSocial = conferido.razaoSocial;
        extra.cnpjSituacao = conferido.situacao;
        extra.cnpjConferidoEm = sql`now()`;
      }
    }

    let depois: ContaDados | undefined;
    try {
      [depois] = await this.ctx.db
        .update(tConta)
        .set({ ...patch, ...extra })
        .where(eq(tConta.id, contaId))
        .returning({
          id: tConta.id,
          nome: tConta.nome,
          cnpj: tConta.cnpj,
          timezone: tConta.timezone,
          status: tConta.status,
          descansoMarketingDias: tConta.descansoMarketingDias,
        });
    } catch (erro) {
      if ((erro as { code?: string } | null)?.code === '23505') {
        throw new ConflictException('Já existe uma conta no Regemcast com este CNPJ.');
      }
      throw erro;
    }

    if (!depois) {
      throw new NotFoundException('Não encontramos esta conta. Entre de novo.');
    }

    // Outro fuso, outra hora local para cada compra: o período em que cada
    // contato costuma pedir é refeito agora, na mesma transação.
    if (patch.timezone !== undefined && patch.timezone !== antes.timezone) {
      await recalcularPeriodosDaConta(this.ctx.db, contaId);
    }

    const anterior = antes as unknown as Record<string, unknown>;

    await this.auditoria.registrar({
      contaId,
      atorTipo: 'usuario',
      atorUsuarioId: atual.id,
      acao: 'conta.atualizada',
      entidade: 'conta',
      entidadeId: contaId,
      // Só os campos que mudaram, com o valor anterior — é o que faz a trilha
      // responder "quem trocou o fuso da conta?" três meses depois.
      detalhe: {
        antes: Object.fromEntries(Object.keys(patch).map((campo) => [campo, anterior[campo]])),
        depois: patch,
      },
      ip: origem.ip,
      userAgent: origem.userAgent,
    });

    return depois;
  }

  /** Quem tem acesso à conta. Nunca devolve senha_hash nem token_versao. */
  async listarUsuarios(): Promise<UsuarioResumo[]> {
    const contaId = this.ctx.contaObrigatoria();

    const linhas = await this.ctx.db
      .select({
        id: tUsuario.id,
        nome: tUsuario.nome,
        email: tUsuario.email,
        papel: tUsuario.papel,
        status: tUsuario.status,
        ultimoLoginEm: tUsuario.ultimoLoginEm,
        criadoEm: tUsuario.criadoEm,
      })
      .from(tUsuario)
      .where(eq(tUsuario.contaId, contaId))
      // 'dono' vem antes de 'operador' por ordem alfabética — estável e útil.
      .orderBy(asc(tUsuario.papel), asc(tUsuario.nome));

    return linhas.map((u) => this.paraResumo(u));
  }

  /** Cria um operador. Um segundo dono não passa daqui nem por engano. */
  async criarUsuario(
    dto: CriarUsuarioDto,
    atual: UsuarioAutenticado,
    origem: OrigemRequest = {},
  ): Promise<UsuarioResumo> {
    const contaId = this.ctx.contaObrigatoria();
    const email = dto.email.trim().toLowerCase();
    // MESMO caminho de hash do login e da troca de senha. Parâmetros de argon2
    // diferentes entre os dois caminhos fazem o hash-isca do login gastar menos
    // tempo que um hash de verdade — e o relógio volta a entregar quem tem
    // conta aqui (ver modules/auth/argon2.ts).
    const senhaHash = await gerarHashSenha(dto.senha);

    try {
      const [novo] = await this.ctx.db
        .insert(tUsuario)
        .values({
          contaId,
          nome: dto.nome.trim(),
          email,
          senhaHash,
          papel: 'operador',
          status: 'ativo',
        })
        .returning({
          id: tUsuario.id,
          nome: tUsuario.nome,
          email: tUsuario.email,
          papel: tUsuario.papel,
          status: tUsuario.status,
          ultimoLoginEm: tUsuario.ultimoLoginEm,
          criadoEm: tUsuario.criadoEm,
        });

      if (!novo) {
        throw new ConflictException('Não conseguimos criar este acesso. Tente de novo.');
      }

      await this.auditoria.registrar({
        contaId,
        atorTipo: 'usuario',
        atorUsuarioId: atual.id,
        acao: 'usuario.criado',
        entidade: 'usuario',
        entidadeId: novo.id,
        detalhe: { nome: novo.nome, email: novo.email, papel: novo.papel },
        ip: origem.ip,
        userAgent: origem.userAgent,
      });

      return this.paraResumo(novo);
    } catch (erro) {
      if (violacaoUnica(erro)) {
        throw new ConflictException('Este e-mail já tem acesso ao Regemcast. Use outro endereço.');
      }
      throw erro;
    }
  }

  /** Renomeia ou liga/desliga o acesso de alguém da conta. */
  async atualizarUsuario(
    id: string,
    dto: AtualizarUsuarioDto,
    atual: UsuarioAutenticado,
    origem: OrigemRequest = {},
  ): Promise<UsuarioResumo> {
    const contaId = this.ctx.contaObrigatoria();

    if (dto.nome === undefined && dto.status === undefined) {
      throw new BadRequestException('Informe o que alterar: nome ou status.');
    }

    // Antes de qualquer ida ao banco: ninguém se tranca para fora sozinho.
    if (dto.status === 'suspenso' && id === atual.id) {
      throw new ForbiddenException(
        'Você não pode suspender o seu próprio acesso. Peça a outra pessoa da conta.',
      );
    }

    const [alvo] = await this.ctx.db
      .select({
        id: tUsuario.id,
        nome: tUsuario.nome,
        email: tUsuario.email,
        papel: tUsuario.papel,
        status: tUsuario.status,
      })
      .from(tUsuario)
      .where(and(eq(tUsuario.id, id), eq(tUsuario.contaId, contaId)))
      .limit(1);

    if (!alvo) {
      throw new NotFoundException('Não encontramos este usuário na sua conta.');
    }

    // A conta exige exatamente um dono ativo (índice único no banco), e o dono
    // é quem reativa os outros: suspendê-lo deixaria a conta sem saída.
    if (alvo.papel === 'dono' && dto.status === 'suspenso') {
      // Não existe rota de transferência de titularidade: a frase precisa
      // mandar para onde a pessoa realmente resolve isso.
      throw new ForbiddenException(
        'O dono da conta não pode ser suspenso. Suspenda outro acesso, ou fale com o suporte do Regemcast para trocar o titular.',
      );
    }

    const patch: { nome?: string; status?: string; tokenVersao?: SQL } = {};
    if (dto.nome !== undefined) patch.nome = dto.nome.trim();
    if (dto.status !== undefined) {
      patch.status = dto.status;
      // Suspender derruba a sessão em andamento na hora, não só barra o
      // próximo login: o guard compara a versão do token a cada request.
      if (dto.status === 'suspenso') {
        patch.tokenVersao = sql`${tUsuario.tokenVersao} + 1`;
      }
    }

    const [depois] = await this.ctx.db
      .update(tUsuario)
      .set(patch)
      .where(and(eq(tUsuario.id, id), eq(tUsuario.contaId, contaId)))
      .returning({
        id: tUsuario.id,
        nome: tUsuario.nome,
        email: tUsuario.email,
        papel: tUsuario.papel,
        status: tUsuario.status,
        ultimoLoginEm: tUsuario.ultimoLoginEm,
        criadoEm: tUsuario.criadoEm,
      });

    if (!depois) {
      throw new NotFoundException('Não encontramos este usuário na sua conta.');
    }

    const acao =
      dto.status === 'suspenso'
        ? 'usuario.suspenso'
        : dto.status === 'ativo' && alvo.status === 'suspenso'
          ? 'usuario.reativado'
          : 'usuario.atualizado';

    await this.auditoria.registrar({
      contaId,
      atorTipo: 'usuario',
      atorUsuarioId: atual.id,
      acao,
      entidade: 'usuario',
      entidadeId: id,
      detalhe: {
        antes: { nome: alvo.nome, status: alvo.status },
        depois: { nome: dto.nome, status: dto.status },
        sessaoDerrubada: dto.status === 'suspenso',
      },
      ip: origem.ip,
      userAgent: origem.userAgent,
    });

    return this.paraResumo(depois);
  }

  /** Remove o acesso de alguém. O dono e você mesmo ficam de fora. */
  async removerUsuario(
    id: string,
    atual: UsuarioAutenticado,
    origem: OrigemRequest = {},
  ): Promise<{ mensagem: string }> {
    const contaId = this.ctx.contaObrigatoria();

    if (id === atual.id) {
      throw new ForbiddenException('Você não pode remover o seu próprio acesso.');
    }

    const [alvo] = await this.ctx.db
      .select({
        id: tUsuario.id,
        nome: tUsuario.nome,
        email: tUsuario.email,
        papel: tUsuario.papel,
      })
      .from(tUsuario)
      .where(and(eq(tUsuario.id, id), eq(tUsuario.contaId, contaId)))
      .limit(1);

    if (!alvo) {
      throw new NotFoundException('Não encontramos este usuário na sua conta.');
    }

    if (alvo.papel === 'dono') {
      throw new ForbiddenException(
        'O dono da conta não pode ser removido. Remova outro acesso, ou fale com o suporte do Regemcast para trocar o titular.',
      );
    }

    // `returning` não é enfeite: sem ele um delete que não pegou nada (linha já
    // removida por outra aba, ou escondida pela RLS) responderia "Acesso
    // removido." e ainda gravaria a auditoria de uma remoção que não houve.
    let removidos: { id: string }[];
    try {
      removidos = await this.ctx.db
        .delete(tUsuario)
        .where(and(eq(tUsuario.id, id), eq(tUsuario.contaId, contaId)))
        .returning({ id: tUsuario.id });
    } catch (erro) {
      throw this.falhaAoRemover(erro, id);
    }

    if (removidos.length === 0) {
      throw new NotFoundException('Não encontramos este usuário na sua conta.');
    }

    await this.auditoria.registrar({
      contaId,
      atorTipo: 'usuario',
      atorUsuarioId: atual.id,
      acao: 'usuario.removido',
      entidade: 'usuario',
      entidadeId: id,
      // Nome e e-mail vão no detalhe porque a linha some: sem isso a trilha
      // guardaria só um uuid órfão, que não responde "quem foi removido?".
      detalhe: { nome: alvo.nome, email: alvo.email, papel: alvo.papel },
      ip: origem.ip,
      userAgent: origem.userAgent,
    });

    return { mensagem: 'Acesso removido.' };
  }

  /**
   * Remover usuário é a operação que mais depende do formato da auditoria: a
   * trilha guarda `ator_usuario_id` como dado CONGELADO, sem chave estrangeira
   * (migration 001). Com FK `on delete set null`, apagar alguém dispararia um
   * UPDATE na auditoria, que a trigger de append-only bloqueia — e o cliente
   * receberia um 500 mudo dizendo "auditoria é append-only".
   *
   * Se voltar a acontecer (FK reintroduzida, outra trigger, permissão), o
   * motivo REAL precisa aparecer no log com código e detalhe do Postgres, e o
   * usuário precisa ler uma frase que diz o que fazer. Falha de esquema é nossa
   * — 500, nunca 4xx, senão qualquer retry acima desiste achando que o pedido
   * estava errado.
   */
  private falhaAoRemover(erro: unknown, usuarioId: string): InternalServerErrorException {
    const e = erro as Error & { code?: string; detail?: string; constraint?: string };
    this.log.error(
      `Não consegui remover o usuário ${usuarioId}: ` +
        `${e?.name ?? 'Erro'}: ${e?.message ?? String(erro)}` +
        (e?.code ? ` (code ${e.code})` : '') +
        (e?.constraint ? ` [constraint ${e.constraint}]` : '') +
        (e?.detail ? ` — ${e.detail}` : ''),
      e?.stack,
    );
    return new InternalServerErrorException(
      'Não conseguimos remover este acesso agora. Tente de novo em instantes — se continuar, fale com o suporte do Regemcast.',
    );
  }

  private paraResumo(u: {
    id: string;
    nome: string;
    email: string;
    papel: string;
    status: string;
    ultimoLoginEm: Date | null;
    criadoEm: Date;
  }): UsuarioResumo {
    return {
      id: u.id,
      nome: u.nome,
      email: u.email,
      papel: u.papel as 'dono' | 'operador',
      status: u.status as 'ativo' | 'suspenso',
      ultimoLoginEm: iso(u.ultimoLoginEm),
      criadoEm: u.criadoEm.toISOString(),
    };
  }
}
