/**
 * Sessão, senha e conversão de convite em conta.
 *
 * Cinco decisões que vêm de cicatriz e não devem ser "simplificadas" depois:
 *
 * 1. Login errado responde SEMPRE a mesma frase e gasta SEMPRE o mesmo tempo.
 *    Sem o hash-isca, e-mail inexistente responde na hora e e-mail existente
 *    responde depois do argon2 — a diferença de tempo entrega quem tem conta
 *    aqui, que é exatamente a lista que um atacante quer.
 * 2. A negativa de login é auditada FORA da transação
 *    (`registrarForaDeContexto`). Auditar dentro e depois lançar faria o
 *    rollback levar junto o registro da tentativa — sumiria justamente a linha
 *    que prova o ataque.
 * 3. Aceitar convite reivindica a linha da lista de espera com update
 *    condicional (`where status = 'convidada'`). Dois cliques simultâneos no
 *    mesmo link não criam duas contas: o segundo encontra 0 linhas e desfaz
 *    tudo.
 * 4. O JWT sai SÓ no cookie httpOnly — nunca no corpo da resposta. Devolver o
 *    token no JSON anula o httpOnly inteiro: qualquer XSS lê a resposta do
 *    login e leva a sessão junto. Por isso `login` e `aceitarConvite` devolvem
 *    `SessaoEmitida` (token à parte, para o controller gravar o cookie) e o
 *    corpo leva apenas usuário, conta e validade.
 * 5. Sair INVALIDA a sessão: incrementa `token_versao`. Limpar o cookie só
 *    resolve para quem está com o navegador na mão — quem copiou o token
 *    continuaria entrando até ele expirar, até 12 horas depois.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import argon2 from 'argon2';
import { and, eq, sql } from 'drizzle-orm';

import type { UsuarioAutenticado } from '../../common/auth.guard';
import { env } from '../../config/env';
import { ContextoDb, type Db } from '../../db/contexto';
import {
  assinatura as tAssinatura,
  conta as tConta,
  listaEspera as tListaEspera,
  plano as tPlano,
  usuario as tUsuario,
} from '../../db/schema';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { EmailService, mascararEmail } from '../email/email.service';
import { emailDeCodigo } from '../email/modelos-email';
import { CnpjReceitaService } from '../seguranca/cnpj-receita.service';
import {
  CodigoVerificacaoService,
  MENSAGEM_CODIGO,
} from '../seguranca/codigo-verificacao.service';
import { gerarHashSenha } from './argon2';
import { AceitarConviteDto, FORMATO_TOKEN_CONVITE } from './dto/aceitar-convite.dto';
import { LoginDto } from './dto/login.dto';
import { TrocarSenhaDto } from './dto/trocar-senha.dto';
import { MINUTOS_TRAVA } from './segunda-etapa.service';

/** Uma frase só para os dois casos, para não revelar qual deles falhou. */
const CREDENCIAL_INVALIDA = 'E-mail ou senha incorretos.';
const CONVITE_INVALIDO = 'Convite inválido ou expirado.';
const SESSAO_EXPIRADA = 'Sua sessão expirou. Entre de novo.';
/**
 * Não existe rota nem tela de recuperação de senha: quem esquece a senha pede
 * um acesso novo ao dono da conta ou fala com o suporte. A frase não pode
 * mandar "peça a recuperação" e deixar a pessoa procurando um link que não
 * existe em lugar nenhum.
 */
const EMAIL_JA_CADASTRADO =
  'Já existe uma conta com este e-mail. Entre com a sua senha — se não lembra dela, fale com o suporte do Regemcast.';
const CNPJ_JA_CADASTRADO =
  'Já existe uma conta no Regemcast com este CNPJ. Peça ao dono dessa conta um acesso de operador.';
const PLANO_CORTESIA = 'cortesia';
/** Duração da cortesia do primeiro ciclo. */
/**
 * Senhas erradas seguidas até travar o acesso. Mais folgado que os 5 códigos
 * da segunda etapa: senha se erra digitando, e travar quem só esqueceu é pior
 * que dar mais cinco chances a um robô que já está limitado por IP.
 */
export const MAX_ERROS_SENHA = 10;

const DIAS_CORTESIA = 30;

export type StatusConta = 'aprovada' | 'ativa' | 'suspensa' | 'cancelada';

export interface UsuarioSessao {
  id: string;
  nome: string;
  email: string;
  papel: 'dono' | 'operador';
}

export interface ContaSessao {
  id: string;
  nome: string;
  timezone: string;
  status: StatusConta;
}

/**
 * O que vai no CORPO da resposta de login e de aceite de convite. Sem `token`:
 * ele viaja só no cookie httpOnly, que o JavaScript da página não lê.
 * `expiraEm` fica porque não é segredo e a tela usa para avisar que a sessão
 * está acabando.
 */
export interface RespostaSessao {
  expiraEm: string;
  usuario: UsuarioSessao;
  conta: ContaSessao;
}

/**
 * Uso interno do controller: ele precisa do token para gravar o cookie e
 * devolve só `resposta` ao cliente. O tipo separado existe para que pôr o
 * token de volta no corpo vire erro de compilação, não descuido.
 */
export interface SessaoEmitida {
  token: string;
  resposta: RespostaSessao;
}

/**
 * O que o login decide depois da senha: sessão direto, ou a segunda etapa para
 * quem ligou a verificação em duas etapas.
 */
export type ResultadoLogin =
  | { tipo: 'sessao'; sessao: SessaoEmitida }
  | {
      tipo: 'segunda_etapa';
      usuario: {
        id: string;
        contaId: string;
        email: string;
        metodo: 'email' | 'app';
        tokenVersao: number;
      };
    };

/** O que a tela do convite mostra depois de consultar o CNPJ. */
export interface CnpjDoConvite {
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string | null;
  situacao: string;
  ativa: boolean;
  /** Já existe conta com este CNPJ — a tela avisa antes de pedir o código. */
  jaCadastrado: boolean;
}

export interface RespostaEu {
  usuario: UsuarioSessao;
  conta: ContaSessao;
}

export interface PreviaConvite {
  email: string;
  nome: string;
  empresa: string | null;
}

/** O que o controller extrai do request para a trilha de auditoria. */
export interface MetaRequisicao {
  ip?: string;
  userAgent?: string;
}

/** Compara dois hashes sem vazar, pelo tempo, quantos bytes bateram. */
function hashesIguais(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  // timingSafeEqual estoura com tamanhos diferentes; o tamanho do hash não é
  // segredo, então comparar antes não vaza nada.
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function ehViolacaoDeUnicidade(erro: unknown): boolean {
  return (erro as { code?: string } | null)?.code === '23505';
}

function contaSessao(c: {
  id: string;
  nome: string;
  timezone: string;
  status: string;
}): ContaSessao {
  return { id: c.id, nome: c.nome, timezone: c.timezone, status: c.status as StatusConta };
}

@Injectable()
export class AuthService {
  private readonly log = new Logger('Auth');

  /**
   * Hash descartável usado só para gastar o mesmo tempo de um login real
   * quando o e-mail não existe. Calculado uma vez, sob demanda.
   */
  private isca: Promise<string> | null = null;

  constructor(
    private readonly ctx: ContextoDb,
    private readonly jwt: JwtService,
    private readonly auditoria: AuditoriaService,
    private readonly cnpjReceita: CnpjReceitaService,
    private readonly codigos: CodigoVerificacaoService,
    private readonly email: EmailService,
  ) {}

  // ------------------------------------------------------------------ login

  async login(dto: LoginDto, meta: MetaRequisicao): Promise<ResultadoLogin> {
    const email = dto.email.trim().toLowerCase();

    // Login precisa enxergar antes de saber a conta — é um dos poucos caminhos
    // de escopo sistema, e ele termina aqui: o resto do request já roda no
    // contexto da conta, aberto pelo interceptor.
    const resultado = await this.ctx.comEscopoSistema('auth.login', async (db) => {
      const [u] = await db
        .select({
          id: tUsuario.id,
          contaId: tUsuario.contaId,
          nome: tUsuario.nome,
          email: tUsuario.email,
          senhaHash: tUsuario.senhaHash,
          papel: tUsuario.papel,
          status: tUsuario.status,
          tokenVersao: tUsuario.tokenVersao,
          doisFatores: tUsuario.doisFatores,
          bloqueadoAte: tUsuario.bloqueadoAte,
        })
        .from(tUsuario)
        .where(eq(tUsuario.email, email))
        .limit(1);

      if (!u) {
        await this.gastarTempoDeVerificacao(dto.senha);
        return { tipo: 'credencial' as const, usuarioId: null, contaId: null };
      }

      // Travado (senhas ou códigos errados demais): recusa SEM conferir a
      // senha. Conferir antes deixaria um robô continuar testando senhas
      // durante a trava — só não saberia qual acertou. O tempo do argon2 é
      // gasto igual, para a resposta não denunciar a trava pelo relógio.
      if (u.bloqueadoAte && u.bloqueadoAte.getTime() > Date.now()) {
        await this.gastarTempoDeVerificacao(dto.senha);
        return {
          tipo: 'travado' as const,
          usuarioId: u.id,
          contaId: u.contaId,
          minutos: Math.ceil((u.bloqueadoAte.getTime() - Date.now()) / 60_000),
        };
      }

      // A senha é conferida ANTES do status: responder "suspenso" para quem
      // errou a senha contaria que a conta existe.
      const senhaOk = await this.conferirSenha(u.senhaHash, dto.senha, u.id);
      if (!senhaOk) {
        // Contada no usuário, não só no IP: o limite por IP não segura um robô
        // que troca de endereço. Incremento atômico, no mesmo contador dos
        // códigos da segunda etapa.
        await db.execute(sql`
          update usuario
             set tentativas_falhas = tentativas_falhas + 1,
                 bloqueado_ate = case
                   when tentativas_falhas + 1 >= ${MAX_ERROS_SENHA}
                   then now() + make_interval(mins => ${MINUTOS_TRAVA})
                   else bloqueado_ate
                 end
           where id = ${u.id}
        `);
        return { tipo: 'credencial' as const, usuarioId: u.id, contaId: u.contaId };
      }

      if (u.status !== 'ativo') {
        return { tipo: 'usuario-suspenso' as const, usuarioId: u.id, contaId: u.contaId };
      }

      const [c] = await db
        .select({
          id: tConta.id,
          nome: tConta.nome,
          timezone: tConta.timezone,
          status: tConta.status,
        })
        .from(tConta)
        .where(eq(tConta.id, u.contaId))
        .limit(1);

      // Usuário sem conta é defeito nosso (a FK é cascade), não erro do
      // cliente: 500, com o motivo no log.
      if (!c) {
        throw new InternalServerErrorException(
          'Não conseguimos carregar a conta desta sessão. Tente de novo em instantes.',
        );
      }

      if (c.status === 'suspensa' || c.status === 'cancelada') {
        return { tipo: 'conta-bloqueada' as const, usuarioId: u.id, contaId: c.id };
      }

      // Duas etapas: a senha certa NÃO abre sessão. Nada de último login nem
      // auditoria de entrada aqui — a entrada só acontece depois do código.
      if (u.doisFatores === 'email' || u.doisFatores === 'app') {
        return {
          tipo: 'segunda_etapa' as const,
          usuario: {
            id: u.id,
            contaId: u.contaId,
            email: u.email,
            metodo: u.doisFatores as 'email' | 'app',
            tokenVersao: u.tokenVersao,
          },
        };
      }

      await db
        .update(tUsuario)
        .set({ ultimoLoginEm: sql`now()`, tentativasFalhas: 0, bloqueadoAte: null })
        .where(eq(tUsuario.id, u.id));

      await this.auditoria.registrar({
        contaId: u.contaId,
        atorTipo: 'usuario',
        atorUsuarioId: u.id,
        acao: 'usuario.login',
        entidade: 'usuario',
        entidadeId: u.id,
        detalhe: { email },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const { token, expiraEm } = await this.assinarToken(u.id, u.contaId, u.tokenVersao);
      const sessao: SessaoEmitida = {
        token,
        resposta: {
          expiraEm,
          usuario: {
            id: u.id,
            nome: u.nome,
            email: u.email,
            papel: u.papel as 'dono' | 'operador',
          },
          conta: contaSessao(c),
        },
      };
      return { tipo: 'ok' as const, sessao };
    });

    if (resultado.tipo === 'ok') return { tipo: 'sessao', sessao: resultado.sessao };
    if (resultado.tipo === 'segunda_etapa') return { tipo: 'segunda_etapa', usuario: resultado.usuario };

    // Fora da transação de propósito: a negativa precisa sobreviver ao throw.
    await this.auditoria.registrarForaDeContexto({
      contaId: resultado.contaId,
      atorTipo: 'usuario',
      atorUsuarioId: resultado.usuarioId,
      acao: 'usuario.login_negado',
      entidade: 'usuario',
      entidadeId: resultado.usuarioId ?? undefined,
      detalhe: { email, motivo: resultado.tipo },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    if (resultado.tipo === 'credencial') throw new UnauthorizedException(CREDENCIAL_INVALIDA);
    if (resultado.tipo === 'travado') {
      throw new ForbiddenException(
        `Muitas tentativas erradas. Este acesso está travado por mais ${resultado.minutos} minuto(s).`,
      );
    }
    if (resultado.tipo === 'usuario-suspenso') {
      throw new UnauthorizedException('Este acesso foi suspenso. Fale com o dono da conta.');
    }
    throw new UnauthorizedException(
      'Esta conta está suspensa. Fale com o suporte do Regemcast para reativar.',
    );
  }

  /**
   * Abre a sessão de quem passou pela segunda etapa.
   *
   * Relê usuário e conta: entre a senha e o código podem ter passado minutos, e
   * uma suspensão nesse intervalo precisa valer. O registro de entrada acontece
   * AQUI, e não na senha — entrada é quando a sessão existe.
   */
  async sessaoAposSegundaEtapa(
    usuarioId: string,
    metodo: 'email' | 'app',
    meta: MetaRequisicao,
  ): Promise<SessaoEmitida> {
    return this.ctx.comEscopoSistema('auth.login.segunda_etapa', async (db) => {
      const [u] = await db
        .select({
          id: tUsuario.id,
          contaId: tUsuario.contaId,
          nome: tUsuario.nome,
          email: tUsuario.email,
          papel: tUsuario.papel,
          status: tUsuario.status,
          tokenVersao: tUsuario.tokenVersao,
        })
        .from(tUsuario)
        .where(eq(tUsuario.id, usuarioId))
        .limit(1);
      if (!u || u.status !== 'ativo') {
        throw new UnauthorizedException('Este acesso foi suspenso. Fale com o dono da conta.');
      }

      const [c] = await db
        .select({ id: tConta.id, nome: tConta.nome, timezone: tConta.timezone, status: tConta.status })
        .from(tConta)
        .where(eq(tConta.id, u.contaId))
        .limit(1);
      if (!c || c.status === 'suspensa' || c.status === 'cancelada') {
        throw new UnauthorizedException(
          'Esta conta está suspensa. Fale com o suporte do Regemcast para reativar.',
        );
      }

      await db.update(tUsuario).set({ ultimoLoginEm: sql`now()` }).where(eq(tUsuario.id, u.id));

      await this.auditoria.registrar({
        contaId: u.contaId,
        atorTipo: 'usuario',
        atorUsuarioId: u.id,
        acao: 'usuario.login',
        entidade: 'usuario',
        entidadeId: u.id,
        detalhe: { email: u.email, segundaEtapa: metodo },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const { token, expiraEm } = await this.assinarToken(u.id, u.contaId, u.tokenVersao);
      return {
        token,
        resposta: {
          expiraEm,
          usuario: { id: u.id, nome: u.nome, email: u.email, papel: u.papel as 'dono' | 'operador' },
          conta: contaSessao(c),
        },
      };
    });
  }

  // ------------------------------------------------------------------- sair

  /**
   * Sair de verdade: incrementa `token_versao`, e o guard compara a versão a
   * cada request. Sem isto o "sair" apagava só o cookie — quem tivesse copiado
   * o token (extensão do navegador, log de proxy, máquina compartilhada)
   * continuaria entrando até ele expirar, até 12 horas depois.
   *
   * O +1 vem do próprio SQL, e não do valor lido, para não perder incremento
   * quando dois "sair" chegam juntos. Ele derruba TODAS as sessões da pessoa,
   * não só esta: sem tabela de sessão não há como distinguir uma da outra, e
   * entre derrubar demais e derrubar de menos, o lado seguro é derrubar tudo.
   */
  async sair(usuario: UsuarioAutenticado, meta: MetaRequisicao): Promise<{ mensagem: string }> {
    await this.ctx.db
      .update(tUsuario)
      .set({ tokenVersao: sql`${tUsuario.tokenVersao} + 1` })
      // O conta_id repete o que a RLS já garante: se um dia a policy for
      // desligada, o update continua escopado na conta do request.
      .where(and(eq(tUsuario.id, usuario.id), eq(tUsuario.contaId, usuario.contaId)));

    await this.auditoria.registrar({
      contaId: usuario.contaId,
      atorTipo: 'usuario',
      atorUsuarioId: usuario.id,
      acao: 'usuario.logout',
      entidade: 'usuario',
      entidadeId: usuario.id,
      detalhe: { sessoesEncerradas: true },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return { mensagem: 'Você saiu da sua conta. As sessões abertas foram encerradas.' };
  }

  // --------------------------------------------------------------------- eu

  async eu(usuario: UsuarioAutenticado): Promise<RespostaEu> {
    const [c] = await this.ctx.db
      .select({
        id: tConta.id,
        nome: tConta.nome,
        timezone: tConta.timezone,
        status: tConta.status,
      })
      .from(tConta)
      .where(eq(tConta.id, usuario.contaId))
      .limit(1);

    if (!c) {
      throw new InternalServerErrorException(
        'Não conseguimos carregar os dados da sua conta. Tente de novo em instantes.',
      );
    }

    return {
      usuario: {
        id: usuario.id,
        nome: usuario.nome,
        email: usuario.email,
        papel: usuario.papel,
      },
      conta: contaSessao(c),
    };
  }

  // ------------------------------------------------------------ troca senha

  async trocarSenha(
    usuario: UsuarioAutenticado,
    dto: TrocarSenhaDto,
    meta: MetaRequisicao,
  ): Promise<{ mensagem: string }> {
    const db = this.ctx.db;

    const [u] = await db
      .select({ id: tUsuario.id, senhaHash: tUsuario.senhaHash })
      .from(tUsuario)
      .where(eq(tUsuario.id, usuario.id))
      .limit(1);

    if (!u) throw new UnauthorizedException(SESSAO_EXPIRADA);

    const atualOk = await this.conferirSenha(u.senhaHash, dto.senhaAtual, u.id);
    if (!atualOk) throw new BadRequestException('A senha atual está incorreta.');

    const repetida = await this.conferirSenha(u.senhaHash, dto.senhaNova, u.id);
    if (repetida) {
      throw new BadRequestException('A senha nova precisa ser diferente da senha atual.');
    }

    const senhaHash = await gerarHashSenha(dto.senhaNova);

    // Incrementar no próprio SQL (e não a partir do valor lido) evita perder
    // um incremento quando duas trocas acontecem ao mesmo tempo. É este +1 que
    // derruba todas as sessões abertas, inclusive a de quem trocou.
    await db
      .update(tUsuario)
      .set({ senhaHash, tokenVersao: sql`${tUsuario.tokenVersao} + 1` })
      .where(eq(tUsuario.id, u.id));

    await this.auditoria.registrar({
      contaId: usuario.contaId,
      atorTipo: 'usuario',
      atorUsuarioId: usuario.id,
      acao: 'usuario.senha_alterada',
      entidade: 'usuario',
      entidadeId: usuario.id,
      detalhe: { sessoesEncerradas: true },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return {
      mensagem: 'Senha alterada. Entre de novo — as sessões abertas foram encerradas.',
    };
  }

  // ---------------------------------------------------------------- convite

  async previaConvite(token: string): Promise<PreviaConvite> {
    const linha = await this.ctx.comEscopoSistema('auth.convite.previa', (db) =>
      this.buscarConvite(db, token),
    );
    return { email: linha.email, nome: linha.nome, empresa: linha.empresa };
  }

  /**
   * Manda o código de confirmação para o e-mail do convite.
   *
   * O e-mail é o do CONVITE, nunca um digitado na tela: é esse endereço que vira
   * o login, e é ele que precisa ser provado.
   */
  async enviarCodigoConvite(token: string): Promise<{ emailMascarado: string; minutos: number }> {
    const convite = await this.ctx.comEscopoSistema('auth.convite.codigo', (db) =>
      this.buscarConvite(db, token),
    );
    const { codigo, minutos } = await this.codigos.emitir({
      finalidade: 'convite',
      email: convite.email,
      listaEsperaId: convite.id,
    });
    await this.email.enviar(emailDeCodigo(convite.email, 'convite', codigo, minutos));
    return { emailMascarado: mascararEmail(convite.email), minutos };
  }

  /**
   * Consulta o CNPJ para a tela do convite mostrar a razão social antes do
   * cadastro. Exige um convite válido: sem isso a rota vira consulta de CNPJ
   * grátis para qualquer um, na nossa cota da BrasilAPI.
   */
  async consultarCnpjConvite(token: string, cnpj: string): Promise<CnpjDoConvite> {
    await this.ctx.comEscopoSistema('auth.convite.cnpj', (db) => this.buscarConvite(db, token));
    const conferido = await this.cnpjReceita.consultar(cnpj);
    const jaCadastrado = await this.cnpjJaTemConta(conferido.cnpj);
    return { ...conferido, jaCadastrado };
  }

  async aceitarConvite(dto: AceitarConviteDto, meta: MetaRequisicao): Promise<SessaoEmitida> {
    // O argon2 leva dezenas de milissegundos e não precisa do banco: calcular
    // antes de abrir a transação evita segurar uma conexão do pool à toa.
    const senhaHash = await gerarHashSenha(dto.senha);

    // Ordem pensada para não queimar o código à toa: primeiro tudo que pode
    // recusar SEM gastar o código (convite, CNPJ na Receita, CNPJ repetido), e
    // só então o código — que, aceito, não vale uma segunda vez.
    const conviteLido = await this.ctx.comEscopoSistema('auth.convite.conferir', (db) =>
      this.buscarConvite(db, dto.token),
    );
    const cnpj = await this.cnpjReceita.exigirAtivo(dto.cnpj);
    if (await this.cnpjJaTemConta(cnpj.cnpj)) throw new ConflictException(CNPJ_JA_CADASTRADO);

    const resultado = await this.codigos.conferir({
      finalidade: 'convite',
      email: conviteLido.email,
      codigo: dto.codigo,
    });
    if (resultado !== 'ok') throw new BadRequestException(MENSAGEM_CODIGO[resultado]);

    return this.ctx.comEscopoSistema('auth.convite.aceitar', async (db) => {
      const convite = await this.buscarConvite(db, dto.token);

      const [jaExiste] = await db
        .select({ id: tUsuario.id })
        .from(tUsuario)
        .where(eq(tUsuario.email, convite.email))
        .limit(1);
      if (jaExiste) {
        throw new ConflictException(EMAIL_JA_CADASTRADO);
      }

      const [planoCortesia] = await db
        .select({ id: tPlano.id })
        .from(tPlano)
        .where(eq(tPlano.codigo, PLANO_CORTESIA))
        .limit(1);
      if (!planoCortesia) {
        // Falta de dado nosso, não erro do cliente.
        throw new InternalServerErrorException(
          'O plano de cortesia não está cadastrado. Avise o suporte do Regemcast.',
        );
      }

      let contaNova: { id: string; nome: string; timezone: string; status: string } | undefined;
      try {
        [contaNova] = await db
          .insert(tConta)
          .values({
            nome: dto.nomeEmpresa,
            // A distribuição já aprovou quando enviou o convite; aceitar é o
            // momento em que a conta passa a existir e a ser usada.
            status: 'ativa',
            planoId: planoCortesia.id,
            aprovadaEm: sql`now()`,
            cnpj: cnpj.cnpj,
            cnpjRazaoSocial: cnpj.razaoSocial,
            cnpjSituacao: cnpj.situacao,
            cnpjConferidoEm: sql`now()`,
          })
          .returning({
            id: tConta.id,
            nome: tConta.nome,
            timezone: tConta.timezone,
            status: tConta.status,
          });
      } catch (erro) {
        // Dois cadastros do mesmo CNPJ ao mesmo tempo: o índice único decide.
        if (ehViolacaoDeUnicidade(erro)) throw new ConflictException(CNPJ_JA_CADASTRADO);
        throw erro;
      }
      if (!contaNova) {
        throw new InternalServerErrorException(
          'Não conseguimos criar a sua conta agora. Tente de novo em instantes.',
        );
      }

      const usuarioNovo = await this.criarDono(
        db,
        contaNova.id,
        dto.nome,
        convite.email,
        senhaHash,
      );

      await db.insert(tAssinatura).values({
        contaId: contaNova.id,
        planoId: planoCortesia.id,
        status: 'cortesia',
        cicloInicio: sql`now()`,
        cicloFim: sql`now() + make_interval(days => ${DIAS_CORTESIA})`,
        gratisAte: sql`now() + make_interval(days => ${DIAS_CORTESIA})`,
      });

      // Reivindicação condicional: é isto que impede duas contas a partir do
      // mesmo link clicado duas vezes ao mesmo tempo.
      const reivindicado = await db
        .update(tListaEspera)
        .set({ status: 'convertida', contaId: contaNova.id, convertidaEm: sql`now()` })
        .where(and(eq(tListaEspera.id, convite.id), eq(tListaEspera.status, 'convidada')))
        .returning({ id: tListaEspera.id });

      if (reivindicado.length === 0) {
        throw new ConflictException('Este convite já foi usado. Entre com a sua senha.');
      }

      await this.auditoria.registrar({
        contaId: contaNova.id,
        atorTipo: 'usuario',
        atorUsuarioId: usuarioNovo.id,
        acao: 'conta.criada',
        entidade: 'conta',
        entidadeId: contaNova.id,
        detalhe: {
          email: convite.email,
          listaEsperaId: convite.id,
          cnpj: cnpj.cnpj,
          razaoSocial: cnpj.razaoSocial,
          plano: PLANO_CORTESIA,
          diasDeCortesia: DIAS_CORTESIA,
        },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const { token, expiraEm } = await this.assinarToken(
        usuarioNovo.id,
        contaNova.id,
        usuarioNovo.tokenVersao,
      );

      return {
        token,
        resposta: {
          expiraEm,
          usuario: {
            id: usuarioNovo.id,
            nome: usuarioNovo.nome,
            email: usuarioNovo.email,
            papel: 'dono',
          },
          conta: contaSessao(contaNova),
        },
      };
    });
  }

  // ------------------------------------------------------------------ apoio

  private async cnpjJaTemConta(cnpj: string): Promise<boolean> {
    return this.ctx.comEscopoSistema('auth.convite.cnpj_repetido', async (db) => {
      const [existe] = await db
        .select({ id: tConta.id })
        .from(tConta)
        .where(eq(tConta.cnpj, cnpj))
        .limit(1);
      return Boolean(existe);
    });
  }

  /**
   * Todas as recusas do convite respondem a MESMA coisa: token fora do
   * formato, hash que não existe, convite já usado, recusado ou vencido. Quem
   * não tem o link não descobre nada sobre a fila de espera.
   */
  private async buscarConvite(db: Db, token: string) {
    if (!FORMATO_TOKEN_CONVITE.test(token)) throw new NotFoundException(CONVITE_INVALIDO);

    const hash = createHash('sha256').update(token).digest('hex');

    const [linha] = await db
      .select({
        id: tListaEspera.id,
        email: tListaEspera.email,
        nome: tListaEspera.nome,
        empresa: tListaEspera.empresa,
        status: tListaEspera.status,
        conviteTokenHash: tListaEspera.conviteTokenHash,
        conviteExpiraEm: tListaEspera.conviteExpiraEm,
      })
      .from(tListaEspera)
      .where(eq(tListaEspera.conviteTokenHash, hash))
      .limit(1);

    if (!linha?.conviteTokenHash) throw new NotFoundException(CONVITE_INVALIDO);
    if (!hashesIguais(hash, linha.conviteTokenHash)) throw new NotFoundException(CONVITE_INVALIDO);
    if (linha.status !== 'convidada') throw new NotFoundException(CONVITE_INVALIDO);
    if (!linha.conviteExpiraEm || linha.conviteExpiraEm.getTime() <= Date.now()) {
      throw new NotFoundException(CONVITE_INVALIDO);
    }

    return linha;
  }

  private async criarDono(
    db: Db,
    contaId: string,
    nome: string,
    email: string,
    senhaHash: string,
  ): Promise<{ id: string; nome: string; email: string; tokenVersao: number }> {
    try {
      const [novo] = await db
        .insert(tUsuario)
        // O e-mail acabou de ser provado pelo código do convite.
        .values({ contaId, nome, email, senhaHash, papel: 'dono', status: 'ativo', emailVerificadoEm: sql`now()` })
        .returning({
          id: tUsuario.id,
          nome: tUsuario.nome,
          email: tUsuario.email,
          tokenVersao: tUsuario.tokenVersao,
        });
      if (!novo) {
        throw new InternalServerErrorException(
          'Não conseguimos criar o seu acesso agora. Tente de novo em instantes.',
        );
      }
      return novo;
    } catch (erro) {
      // Corrida entre dois cadastros com o mesmo e-mail: o banco decide, e a
      // resposta explica o que fazer em vez de devolver 500.
      if (ehViolacaoDeUnicidade(erro)) {
        throw new ConflictException(EMAIL_JA_CADASTRADO);
      }
      throw erro;
    }
  }

  private async assinarToken(
    usuarioId: string,
    contaId: string,
    versao: number,
  ): Promise<{ token: string; expiraEm: string }> {
    const token = await this.jwt.signAsync(
      { sub: usuarioId, conta: contaId, ver: versao },
      { secret: env.sessao.segredo, expiresIn: `${env.sessao.ttlHoras}h` },
    );
    return {
      token,
      expiraEm: new Date(Date.now() + env.sessao.ttlHoras * 3_600_000).toISOString(),
    };
  }

  private async conferirSenha(hash: string, senha: string, usuarioId: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, senha);
    } catch (erro) {
      // Hash corrompido ou gerado por outro algoritmo. Para o usuário vira
      // senha errada, mas o motivo real precisa aparecer no log — sem a senha
      // e sem o hash.
      this.log.error(
        `Não consegui conferir a senha do usuário ${usuarioId}: ${(erro as Error).message}`,
      );
      return false;
    }
  }

  /** Gasta o tempo de um argon2.verify real quando o e-mail não existe. */
  private async gastarTempoDeVerificacao(senha: string): Promise<void> {
    try {
      // MESMO caminho de hash do cadastro e da troca de senha: é a igualdade
      // dos parâmetros que faz o tempo de resposta ser igual (ver argon2.ts).
      if (!this.isca) this.isca = gerarHashSenha(randomBytes(24).toString('hex'));
      await argon2.verify(await this.isca, senha);
    } catch (erro) {
      // Se o próprio hash-isca falhar, a resposta ao usuário não muda — mas
      // algo está errado com o argon2, e isso precisa ficar visível.
      this.isca = null;
      this.log.warn(`Hash-isca do login falhou: ${(erro as Error).message}`);
    }
  }
}
