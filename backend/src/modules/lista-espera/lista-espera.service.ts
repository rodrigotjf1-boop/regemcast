/**
 * Fila de entrada do Regemcast.
 *
 * Ela existe por um motivo concreto: a Meta limita um Tech Provider a 10
 * clientes NOVOS por janela rolling de 7 dias enquanto a Access Verification
 * não sai. Sem fila, esse teto aparece como erro no meio do Embedded Signup do
 * cliente — depois de ele já ter escolhido o número e aceitado os termos. Com
 * fila, o teto vira uma conta que a gente administra antes de convidar.
 *
 * `lista_espera` tem policy `rc_sistema` (001_fundacao.sql): só enxerga quem
 * roda em escopo de sistema. Por isso TODO método aqui abre
 * `comEscopoSistema` — inclusive o cadastro público, que acontece antes de
 * existir conta alguma.
 */
import { ConflictException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { and, asc, eq, ne, sql } from 'drizzle-orm';

import { env } from '../../config/env';
import { ContextoDb, type Db } from '../../db/contexto';
import { listaEspera } from '../../db/schema';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { EmailService } from '../email/email.service';
import { emailDeConvite } from '../email/modelos-email';
import type { ConvidarListaEsperaDto } from './dto/convidar-lista-espera.dto';
import type { CriarListaEsperaDto } from './dto/criar-lista-espera.dto';
import type { ListarListaEsperaDto } from './dto/listar-lista-espera.dto';
import type { RecusarListaEsperaDto } from './dto/recusar-lista-espera.dto';
import { mascararTelefone, normalizarTelefoneE164 } from './dto/telefone';
import {
  JANELA_CONVITE_DIAS,
  tetoConvitesJanela,
  type StatusListaEspera,
} from './lista-espera.status';

/** De onde veio o request. Só para a auditoria — nunca volta na resposta. */
export interface OrigemRequest {
  ip?: string;
  userAgent?: string;
}

export interface RespostaCadastro {
  mensagem: string;
}

export interface ItemListaEspera {
  id: string;
  nome: string;
  email: string;
  empresa: string | null;
  telefoneE164: string | null;
  origem: string | null;
  status: string;
  observacao: string | null;
  conviteExpiraEm: Date | null;
  conviteExpirado: boolean;
  convidadaEm: Date | null;
  convertidaEm: Date | null;
  contaId: string | null;
  criadoEm: Date;
}

export interface PaginaListaEspera {
  itens: ItemListaEspera[];
  total: number;
  pagina: number;
  limite: number;
}

export interface Capacidade {
  enviados7d: number;
  teto: number;
  restantes: number;
  /** Quando a vaga mais antiga da janela expira. `null` quando a janela está vazia. */
  proximaVagaEm: Date | null;
}

export interface RespostaConvite {
  id: string;
  status: StatusListaEspera;
  expiraEm: Date;
  link: string;
  /** O convite saiu por e-mail. Falso = mande o link à mão. */
  emailEnviado: boolean;
  aviso: string;
}

/**
 * A resposta do cadastro público é SEMPRE esta, exista ou não a pessoa na
 * fila. Responder "você já está cadastrado" transforma a rota anônima num
 * oráculo de e-mails: qualquer um descobre quem se inscreveu.
 */
const MENSAGEM_CADASTRO =
  'Recebemos seu pedido. Entramos em contato assim que liberarmos uma vaga.';

/**
 * A janela da Meta escrita uma vez só. `sql.raw` porque `interval` não aceita
 * parâmetro ligado: `interval $1` é erro de sintaxe no Postgres. O valor vem de
 * uma constante nossa, nunca de entrada do usuário.
 */
const JANELA = sql.raw(`interval '${JANELA_CONVITE_DIAS} days'`);

@Injectable()
export class ListaEsperaService {
  private readonly log = new Logger('ListaEspera');

  constructor(
    private readonly ctx: ContextoDb,
    private readonly auditoria: AuditoriaService,
    // Opcional para o serviço continuar montável sozinho em teste; na
    // aplicação o EmailModule é global e sempre injeta.
    @Optional() private readonly email?: EmailService,
  ) {}

  // ------------------------------------------------------------- público

  /**
   * Cadastro anônimo. Idempotente por e-mail: a segunda tentativa não cria
   * linha, não sobrescreve a primeira e não muda a resposta.
   *
   * O `on conflict do nothing ... returning` detecta o repetido no mesmo
   * ida-e-volta do insert. Um `select` antes do `insert`, além de custar uma
   * consulta a mais, perde a corrida: dois cadastros simultâneos do mesmo
   * e-mail passariam os dois pelo select e o segundo estouraria 23505.
   */
  async cadastrar(
    dto: CriarListaEsperaDto,
    origem: OrigemRequest,
  ): Promise<RespostaCadastro> {
    // Normalizado aqui, e não só no DTO: o service é chamado por job e por
    // teste também, e nesses caminhos o ValidationPipe não roda.
    const email = dto.email.trim().toLowerCase();
    const nome = dto.nome.trim();
    const empresa = dto.empresa?.trim() || null;
    const origemCadastro = dto.origem?.trim() || null;
    const telefoneE164 = normalizarTelefoneE164(dto.telefone);

    await this.ctx.comEscopoSistema('lista-espera.cadastro', async (db) => {
      const [criada] = await db
        .insert(listaEspera)
        .values({ email, nome, empresa, telefoneE164, origem: origemCadastro })
        .onConflictDoNothing({ target: listaEspera.email })
        .returning({ id: listaEspera.id });

      // A auditoria vai na MESMA transação: se ela falhar, o cadastro volta
      // atrás junto. É o registro de quando e de onde a pessoa pediu a vaga —
      // guardar o pedido sem guardar a prova do pedido não serve para nada.
      await this.auditoria.registrar({
        contaId: null,
        atorTipo: 'sistema',
        acao: criada ? 'lista_espera.cadastro' : 'lista_espera.cadastro_repetido',
        entidade: 'lista_espera',
        entidadeId: criada?.id,
        detalhe: {
          emailMascarado: mascararEmail(email),
          empresa,
          origem: origemCadastro,
          telefoneMascarado: mascararTelefone(telefoneE164),
        },
        ip: origem.ip,
        userAgent: origem.userAgent,
      });
    });

    return { mensagem: MENSAGEM_CADASTRO };
  }

  // ------------------------------------------------- console de distribuição

  /** Fila em ordem de chegada — é assim que se decide quem convidar primeiro. */
  async listar(filtro: ListarListaEsperaDto): Promise<PaginaListaEspera> {
    const pagina = filtro.pagina ?? 1;
    const limite = filtro.limite ?? 50;
    const condicao = filtro.status ? eq(listaEspera.status, filtro.status) : undefined;

    return this.ctx.comEscopoSistema('lista-espera.listar', async (db) => {
      // `convite_token_hash` fica de fora da projeção de propósito: nem o
      // console tem motivo para ver o hash do convite.
      const itens = await db
        .select({
          id: listaEspera.id,
          nome: listaEspera.nome,
          email: listaEspera.email,
          empresa: listaEspera.empresa,
          telefoneE164: listaEspera.telefoneE164,
          origem: listaEspera.origem,
          status: listaEspera.status,
          observacao: listaEspera.observacao,
          conviteExpiraEm: listaEspera.conviteExpiraEm,
          conviteExpirado: sql<boolean>`(${listaEspera.conviteExpiraEm} is not null and ${listaEspera.conviteExpiraEm} < now())`,
          convidadaEm: listaEspera.convidadaEm,
          convertidaEm: listaEspera.convertidaEm,
          contaId: listaEspera.contaId,
          criadoEm: listaEspera.criadoEm,
        })
        .from(listaEspera)
        .where(condicao)
        .orderBy(asc(listaEspera.criadoEm))
        .limit(limite)
        .offset((pagina - 1) * limite);

      const [contagem] = await db
        .select({ total: sql<number>`count(*)::int` })
        .from(listaEspera)
        .where(condicao);

      return { itens, total: Number(contagem?.total ?? 0), pagina, limite };
    });
  }

  /**
   * Quanto ainda cabe na janela da Meta.
   *
   * É a consulta que evita descobrir o teto no meio de um onboarding: o
   * operador olha aqui ANTES de prometer vaga para alguém.
   */
  async capacidade(): Promise<Capacidade> {
    return this.ctx.comEscopoSistema('lista-espera.capacidade', (db) =>
      this.janelaConvites(db),
    );
  }

  /**
   * Emite o convite e devolve o link UMA ÚNICA VEZ.
   *
   * Só o sha256 do token vai para o banco. Quem tiver leitura do banco
   * (backup, réplica, suporte) não consegue entrar no lugar do cliente, e um
   * convite vazado morre na data de expiração.
   */
  async convidar(
    id: string,
    dto: ConvidarListaEsperaDto,
    origem: OrigemRequest,
  ): Promise<RespostaConvite> {
    const emitido = await this.ctx.comEscopoSistema('lista-espera.convite', async (db) => {
      // Serializa a emissão de convites. Sem a trava, dois operadores clicando
      // ao mesmo tempo leem o mesmo "restantes: 1" e emitem os dois — e o teto
      // da Meta só apareceria depois, no onboarding de um cliente real. A
      // trava é da transação: sai sozinha no commit ou no rollback.
      await db.execute(
        sql`select pg_advisory_xact_lock(hashtext('regemcast.lista_espera.convite'))`,
      );

      const [linha] = await db
        .select({
          id: listaEspera.id,
          email: listaEspera.email,
          nome: listaEspera.nome,
          status: listaEspera.status,
        })
        .from(listaEspera)
        .where(eq(listaEspera.id, id))
        .limit(1);

      if (!linha) {
        throw new NotFoundException('Não encontrei este pedido na lista de espera.');
      }
      if (linha.status === 'convertida') {
        throw new ConflictException(
          'Esta pessoa já virou conta no Regemcast. Não há convite a enviar.',
        );
      }

      const reenvio = linha.status === 'convidada';
      // Quem já está na janela não ocupa uma vaga NOVA ao receber o reenvio:
      // a contagem ignora a própria linha.
      const janela = await this.janelaConvites(db, id);

      if (janela.restantes <= 0 && !dto.forcar) {
        throw new ConflictException(
          `A janela de ${JANELA_CONVITE_DIAS} dias já tem ${tetoConvitesJanela()} convites, ` +
            'que é o teto da Meta antes da Access Verification sair. ' +
            (janela.proximaVagaEm
              ? `A próxima vaga abre em ${janela.proximaVagaEm.toISOString()}. `
              : '') +
            'Se o teto da nossa conta já mudou, repita com "forcar": true.',
        );
      }

      const token = randomBytes(32).toString('hex');

      const [atualizada] = await db
        .update(listaEspera)
        .set({
          status: 'convidada',
          conviteTokenHash: sha256(token),
          conviteExpiraEm: sql`now() + ${JANELA}`,
          convidadaEm: sql`now()`,
        })
        // A guarda de status volta na cláusula do update: entre o select e o
        // update a linha segue protegida pelo advisory lock, mas a condição
        // custa nada e cobre qualquer caminho futuro que não pegue a trava.
        .where(and(eq(listaEspera.id, id), ne(listaEspera.status, 'convertida')))
        .returning({
          id: listaEspera.id,
          status: listaEspera.status,
          conviteExpiraEm: listaEspera.conviteExpiraEm,
        });

      if (!atualizada?.conviteExpiraEm) {
        throw new ConflictException(
          'Este pedido mudou de estado enquanto o convite era emitido. Abra a lista de novo.',
        );
      }

      await this.auditoria.registrar({
        contaId: null,
        atorTipo: 'distribuicao',
        acao: 'lista_espera.convidada',
        entidade: 'lista_espera',
        entidadeId: id,
        // Nunca o token nem o hash: a auditoria é lida por gente, e token de
        // convite em log é token de convite vazado.
        detalhe: {
          emailMascarado: mascararEmail(linha.email),
          reenvio,
          forcado: Boolean(dto.forcar),
          enviados7dAntes: janela.enviados7d,
          expiraEm: atualizada.conviteExpiraEm.toISOString(),
        },
        ip: origem.ip,
        userAgent: origem.userAgent,
      });

      return {
        id: atualizada.id,
        status: atualizada.status as StatusListaEspera,
        expiraEm: atualizada.conviteExpiraEm,
        link: `${env.rede.appUrl.replace(/\/+$/, '')}/convite/${token}`,
        email: linha.email,
        nome: linha.nome,
      };
    });

    // O e-mail sai DEPOIS do commit: se o envio falhar, o convite continua
    // valendo e o link volta na resposta para ser mandado à mão. Enviar dentro
    // da transação faria uma falha do provedor desfazer o convite inteiro.
    let emailEnviado = false;
    if (this.email) {
      try {
        await this.email.enviar(
          emailDeConvite(emitido.email, emitido.nome, emitido.link, emitido.expiraEm),
        );
        emailEnviado = true;
      } catch (erro) {
        this.log.warn(
          `Convite ${emitido.id} emitido, mas o e-mail não saiu: ${(erro as Error)?.message ?? erro}`,
        );
      }
    }

    return {
      id: emitido.id,
      status: emitido.status,
      expiraEm: emitido.expiraEm,
      link: emitido.link,
      emailEnviado,
      aviso: emailEnviado
        ? 'Convite enviado por e-mail. O link também aparece aqui uma única vez — guardamos apenas o hash dele.'
        : 'O e-mail NÃO saiu. Mande este link à pessoa: ele aparece uma única vez — guardamos apenas o hash dele.',
    };
  }

  /** Recusa o pedido e mata qualquer convite em aberto da mesma linha. */
  async recusar(
    id: string,
    dto: RecusarListaEsperaDto,
    origem: OrigemRequest,
  ): Promise<{ id: string; status: StatusListaEspera }> {
    return this.ctx.comEscopoSistema('lista-espera.recusa', async (db) => {
      const [linha] = await db
        .select({
          id: listaEspera.id,
          email: listaEspera.email,
          status: listaEspera.status,
        })
        .from(listaEspera)
        .where(eq(listaEspera.id, id))
        .limit(1);

      if (!linha) {
        throw new NotFoundException('Não encontrei este pedido na lista de espera.');
      }
      if (linha.status === 'convertida') {
        throw new ConflictException(
          'Esta pessoa já virou conta no Regemcast. Cancele a conta em vez de recusar o pedido.',
        );
      }

      const [atualizada] = await db
        .update(listaEspera)
        .set({
          status: 'recusada',
          observacao: dto.observacao.trim(),
          // Recusar precisa invalidar o convite já enviado. Sem isto, quem
          // recebeu o link ontem ainda abre conta hoje.
          conviteTokenHash: null,
          conviteExpiraEm: null,
        })
        .where(and(eq(listaEspera.id, id), ne(listaEspera.status, 'convertida')))
        .returning({ id: listaEspera.id, status: listaEspera.status });

      if (!atualizada) {
        throw new ConflictException(
          'Este pedido mudou de estado enquanto era recusado. Abra a lista de novo.',
        );
      }

      await this.auditoria.registrar({
        contaId: null,
        atorTipo: 'distribuicao',
        acao: 'lista_espera.recusada',
        entidade: 'lista_espera',
        entidadeId: id,
        detalhe: {
          emailMascarado: mascararEmail(linha.email),
          statusAnterior: linha.status,
          observacao: dto.observacao.trim(),
          conviteInvalidado: linha.status === 'convidada',
        },
        ip: origem.ip,
        userAgent: origem.userAgent,
      });

      return { id: atualizada.id, status: atualizada.status as StatusListaEspera };
    });
  }

  // ------------------------------------------------------------- interno

  /**
   * Conta os convites da janela rolling e diz quando a vaga mais antiga expira.
   *
   * A janela sai do `now()` do BANCO, não do processo: com duas réplicas da API
   * e relógios diferentes, cada uma decidiria uma fronteira para a mesma
   * janela — e a que estivesse adiantada liberaria a 11ª vaga.
   */
  private async janelaConvites(db: Db, excluirId?: string): Promise<Capacidade> {
    const naJanela = sql`${listaEspera.convidadaEm} >= now() - ${JANELA}`;
    const condicao = excluirId ? and(naJanela, ne(listaEspera.id, excluirId)) : naJanela;

    const [linha] = await db
      .select({
        enviados: sql<number>`count(*)::int`,
        // Sai do banco já formatado em ISO-8601 UTC, e não como timestamptz.
        // Motivo: em expressão calculada (sem coluna por trás) o Drizzle não
        // tem mapeador, o driver devolve o texto cru do Postgres
        // ("2026-09-20 03:16:43.814119-03") e o que chega aqui é uma string
        // com cara de Date. Tipar como Date e chamar `.toISOString()` nela
        // estoura TypeError — 500 no lugar do 409 que explica a janela cheia.
        proximaVagaIso: sql<
          string | null
        >`to_char((min(${listaEspera.convidadaEm}) + ${JANELA}) at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`,
      })
      .from(listaEspera)
      .where(condicao);

    const enviados7d = Number(linha?.enviados ?? 0);
    return {
      enviados7d,
      teto: tetoConvitesJanela(),
      // Nunca negativo: uma janela estourada por convite forçado mostra 0
      // vagas, não "-2 vagas".
      restantes: Math.max(0, tetoConvitesJanela() - enviados7d),
      proximaVagaEm: linha?.proximaVagaIso ? new Date(linha.proximaVagaIso) : null,
    };
  }
}

function sha256(valor: string): string {
  return createHash('sha256').update(valor, 'utf8').digest('hex');
}

/** `maria@empresa.com` vira `ma***@empresa.com`. A auditoria não precisa do resto. */
export function mascararEmail(email: string): string {
  const corte = email.indexOf('@');
  if (corte <= 0) return '***';
  const usuario = email.slice(0, corte);
  return `${usuario.slice(0, Math.min(2, usuario.length))}***${email.slice(corte)}`;
}
