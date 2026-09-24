/**
 * A agenda do WhatsApp Business (coexistência): a resposta do dono e os lotes
 * que a Meta manda. As regras sem banco ficam em `agenda.regras.ts`.
 *
 * Três portas, uma decisão só:
 *
 *   1. a resposta do dono — na conexão ou depois, no cartão do número;
 *   2. o webhook `smb_app_state_sync`, lote a lote;
 *   3. a retomada, que devolve à fila o que chegou antes da resposta.
 *
 * A terceira existe por causa da ordem das coisas. A Meta pode mandar a agenda
 * antes de o dono responder — ou antes de a transação da conexão gravar a
 * resposta. Nesse caso o lote fica guardado como chegou, e quando a resposta
 * existe a retomada o devolve à fila, onde ele passa pelo MESMO caminho do
 * webhook. Nenhum lote é decidido com uma resposta que ainda não foi gravada.
 */
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';

import { emPartes } from '../../common/em-partes';
import { mascararTelefone } from '../../common/telefone';
import { ContextoDb, type Db } from '../../db/contexto';
import { contato, contatoLista, importacao, usuario, waNumero } from '../../db/schema';
import { AuditoriaService } from '../auditoria/auditoria.service';
import {
  DECLARACAO_INTEGRACAO,
  destinoPelaResposta,
  separarAgenda,
  type DestinoDoEvento,
  type LoteDaAgenda,
} from './agenda.regras';

/** Linhas por comando: bem abaixo do teto de parâmetros do Postgres. */
const POR_COMANDO = 1000;

/** Só números com resposta recente entram na varredura de cada minuto. */
const DIAS_PARA_REENFILEIRAR = 7;

const CAMPOS_DO_NUMERO = {
  id: waNumero.id,
  contaId: waNumero.contaId,
  telefoneE164: waNumero.telefoneE164,
  coexistencia: waNumero.coexistencia,
  integrarConversas: waNumero.integrarConversas,
  integrarDecididoEm: waNumero.integrarDecididoEm,
  integrarDecididoPor: waNumero.integrarDecididoPor,
  integrarListaId: waNumero.integrarListaId,
  integrarImportacaoId: waNumero.integrarImportacaoId,
};

type NumeroTravado = {
  id: string;
  contaId: string;
  telefoneE164: string | null;
  coexistencia: boolean;
  integrarConversas: boolean | null;
  integrarDecididoEm: Date | null;
  integrarDecididoPor: string | null;
  integrarListaId: string | null;
  integrarImportacaoId: string | null;
};

/** O número da empresa como a Meta mostra ("+55 21 98975-1705"), mascarado para log e auditoria. */
function mascararNumero(exibicao: string | null): string | null {
  return mascararTelefone(exibicao ? exibicao.replace(/[^\d+]/g, '') : null);
}

function mascararId(valor: string): string {
  return valor.length <= 4 ? '••••' : `••••${valor.slice(-4)}`;
}

@Injectable()
export class AgendaService implements OnApplicationBootstrap {
  private readonly log = new Logger('Agenda');

  constructor(
    private readonly ctx: ContextoDb,
    private readonly auditoria: AuditoriaService,
  ) {}

  /**
   * Na subida, uma varredura SEM a janela de dias: devolve à fila o que ficou
   * guardado de números que já têm resposta — o histórico que esperou a
   * gravação das conversas, ou o que sobrou de um servidor fora do ar por mais
   * tempo que a janela. Não segura a subida e não pode derrubá-la.
   */
  onApplicationBootstrap(): void {
    void this.reenfileirar({ semJanela: true })
      .then((n) => {
        if (n > 0) this.log.log(`Subida: ${n} lote(s) guardados de agenda e histórico voltaram para a fila.`);
      })
      .catch((erro: unknown) => {
        this.log.error(`Varredura da subida falhou: ${(erro as Error)?.message ?? String(erro)}`);
      });
  }

  // ------------------------------------------------------------ a resposta

  /**
   * O dono responde — ou muda a resposta — no cartão do número.
   *
   * Roda na transação do request. Os lotes que chegaram antes ficam para a
   * retomada: ela só os enxerga depois que esta resposta estiver gravada.
   */
  async decidir(contaId: string, usuarioId: string, phoneNumberId: string, integrar: boolean) {
    const db = this.ctx.db;
    const [n] = await db
      .select(CAMPOS_DO_NUMERO)
      .from(waNumero)
      .where(and(eq(waNumero.contaId, contaId), eq(waNumero.phoneNumberId, phoneNumberId)))
      .limit(1)
      .for('update');

    if (!n) throw new NotFoundException('Número não encontrado nesta conta.');
    if (!n.coexistencia) {
      throw new BadRequestException(
        'Este número não continua no WhatsApp Business do celular: não há contatos nem conversas para trazer.',
      );
    }

    await this.gravarDecisao(db, n, integrar, usuarioId);
    return { phoneNumberId, integrarConversas: integrar };
  }

  /**
   * A resposta dada na tela de conexão, antes de abrir a janela da Meta.
   *
   * Roda na MESMA transação que grava o número e ANTES do pedido de
   * sincronização — a agenda só começa a chegar depois desse pedido.
   */
  async decidirNaConexao(db: Db, numeroId: string, integrar: boolean, usuarioId: string | null) {
    const [n] = await db
      .select(CAMPOS_DO_NUMERO)
      .from(waNumero)
      .where(eq(waNumero.id, numeroId))
      .limit(1)
      .for('update');
    if (!n || !n.coexistencia) return;
    await this.gravarDecisao(db, n, integrar, usuarioId);
  }

  private async gravarDecisao(db: Db, n: NumeroTravado, integrar: boolean, usuarioId: string | null) {
    const anterior = n.integrarConversas;
    // A mesma resposta de novo não muda nada — e não pode empurrar a data da
    // decisão, senão a retomada reprocessaria o que já foi resolvido.
    if (anterior === integrar) return;

    const agora = new Date();
    await db
      .update(waNumero)
      .set({ integrarConversas: integrar, integrarDecididoEm: agora, integrarDecididoPor: usuarioId })
      .where(eq(waNumero.id, n.id));

    if (integrar) {
      await this.garantirDestino(db, { ...n, integrarDecididoPor: usuarioId });
    }

    await this.auditoria.registrar({
      contaId: n.contaId,
      atorTipo: usuarioId ? 'usuario' : 'sistema',
      atorUsuarioId: usuarioId,
      acao: 'whatsapp.integracao_decidida',
      entidade: 'wa_numero',
      entidadeId: n.id,
      // A declaração vai por extenso: é a prova do que o dono aceitou.
      detalhe: {
        numero: mascararNumero(n.telefoneE164),
        integrar,
        anterior,
        declaracao: integrar ? DECLARACAO_INTEGRACAO : null,
      },
    });
  }

  /**
   * A lista "WhatsApp Business" e o registro de importação do número.
   *
   * Recria o que o dono tiver apagado — a FK zera a coluna quando a lista some.
   * Roda com o número travado (`for update`), então dois lotes ao mesmo tempo
   * não criam duas listas.
   */
  private async garantirDestino(
    db: Db,
    n: NumeroTravado,
  ): Promise<{ listaId: string; importacaoId: string }> {
    const rotulo = n.telefoneE164 ? `WhatsApp Business ${n.telefoneE164}` : 'WhatsApp Business';

    let listaId = n.integrarListaId;
    if (!listaId) {
      const [nova] = await db
        .insert(contatoLista)
        .values({
          contaId: n.contaId,
          nome: rotulo,
          descricao: 'Contatos da agenda do WhatsApp Business deste número, trazidos pela coexistência.',
        })
        .returning({ id: contatoLista.id });
      listaId = nova!.id;
    }

    let importacaoId = n.integrarImportacaoId;
    if (!importacaoId) {
      const [registro] = await db
        .insert(importacao)
        .values({
          contaId: n.contaId,
          formato: 'whatsapp_business',
          arquivoNome: rotulo,
          listaId,
          criadoPor: n.integrarDecididoPor,
        })
        .returning({ id: importacao.id });
      importacaoId = registro!.id;
    }

    if (listaId !== n.integrarListaId || importacaoId !== n.integrarImportacaoId) {
      await db
        .update(waNumero)
        .set({ integrarListaId: listaId, integrarImportacaoId: importacaoId })
        .where(eq(waNumero.id, n.id));
    }
    return { listaId, importacaoId };
  }

  // ------------------------------------------------------------ os lotes

  /**
   * Um lote do webhook `smb_app_state_sync`.
   *
   * Escopo de sistema: o evento chega identificado pelo número, e a conta só é
   * conhecida depois (motivo A, `docs/rls.md`).
   *
   * Número que ainda não está gravado faz LANÇAR: o evento volta para a fila e
   * é tentado de novo. É o caso da agenda que chega antes de a transação da
   * conexão terminar — em segundos o número aparece.
   */
  async aplicarLote(phoneNumberId: string, itens: unknown): Promise<DestinoDoEvento> {
    return this.ctx.comEscopoSistema('meta.agenda.lote', async (db) => {
      const [n] = await db
        .select(CAMPOS_DO_NUMERO)
        .from(waNumero)
        .where(eq(waNumero.phoneNumberId, phoneNumberId))
        .limit(1)
        .for('update');

      if (!n) {
        throw new Error(
          `Agenda de um número que ainda não está gravado (${mascararId(phoneNumberId)}). O evento volta para a fila.`,
        );
      }
      // Número dedicado não tem agenda de celular; se algo chegar, não é nosso para guardar.
      if (!n.coexistencia) return 'esvaziar';

      const destino = destinoPelaResposta(n.integrarConversas);
      if (destino === 'aguardar') return 'guardar';
      if (destino === 'descartar') return 'esvaziar';

      const lote = separarAgenda(itens);
      if (lote.ignorados) {
        this.log.warn(
          `Agenda do número ${mascararId(phoneNumberId)}: ${lote.ignorados} item(ns) de tipo ou ação ` +
            'desconhecidos — registrados, não aplicados.',
        );
      }

      const destinos = await this.garantirDestino(db, n);
      await this.gravarLote(db, n, lote, destinos);
      return 'esvaziar';
    });
  }

  /**
   * Grava um lote: contatos novos, nome onde faltava, a lista do número e os
   * totais da importação. Tudo em comandos por conjunto, nunca um por contato.
   */
  private async gravarLote(
    db: Db,
    n: NumeroTravado,
    lote: LoteDaAgenda,
    { listaId, importacaoId }: { listaId: string; importacaoId: string },
  ): Promise<void> {
    const agora = new Date();
    const fuso = { timeZone: 'America/Sao_Paulo' } as const;
    const decididoEm = n.integrarDecididoEm ?? agora;

    const [dono] = n.integrarDecididoPor
      ? await db.select({ nome: usuario.nome }).from(usuario).where(eq(usuario.id, n.integrarDecididoPor)).limit(1)
      : [];
    const evidencia =
      `Agenda do WhatsApp Business do número ${n.telefoneE164 ?? ''}, trazida pela coexistência em ` +
      `${agora.toLocaleDateString('pt-BR', fuso)}. Declaração de ${dono?.nome ?? 'o dono da conta'} em ` +
      `${decididoEm.toLocaleDateString('pt-BR', fuso)}: "${DECLARACAO_INTEGRACAO}"`;

    let novos = 0;
    for (const parte of emPartes(lote.adicionar, POR_COMANDO)) {
      // Quem já está na base fica como está: o consentimento que tinha pode ser
      // mais antigo e mais forte, e quem pediu para sair continua fora.
      const inseridos = await db
        .insert(contato)
        .values(
          parte.map((c) => ({
            contaId: n.contaId,
            telefoneE164: c.telefone,
            nome: c.nome,
            consentimentoOrigem: 'declarado' as const,
            consentimentoEm: decididoEm,
            consentimentoEvidencia: evidencia,
            importacaoId,
          })),
        )
        .onConflictDoNothing({ target: [contato.contaId, contato.telefoneE164] })
        .returning({ id: contato.id });
      novos += inseridos.length;

      // Quem já estava sem nome ganha o da agenda. Nome dado antes não é trocado.
      const comNome = parte.filter((c) => c.nome);
      if (comNome.length) {
        await db.execute(sql`
          update contato c
             set nome = v.nome
            from (values ${sql.join(comNome.map((c) => sql`(${c.telefone}, ${c.nome})`), sql`, `)}) as v(telefone, nome)
           where c.conta_id = ${n.contaId}
             and c.telefone_e164 = v.telefone
             and c.nome is null
        `);
      }

      // Na lista entram todos os da agenda, menos quem pediu para sair.
      await db.execute(sql`
        insert into contato_lista_item (conta_id, lista_id, contato_id)
        select conta_id, ${listaId}, id
          from contato
         where conta_id = ${n.contaId}
           and opt_out = false
           and telefone_e164 in (${sql.join(parte.map((c) => sql`${c.telefone}`), sql`, `)})
        on conflict do nothing
      `);
    }

    // Apagado da agenda do celular sai da lista deste número — não da base: o
    // contato pode estar em outras listas e ter histórico de campanha.
    for (const parte of emPartes(lote.remover, POR_COMANDO)) {
      await db.execute(sql`
        delete from contato_lista_item i
         using contato c
         where i.conta_id = ${n.contaId}
           and i.lista_id = ${listaId}
           and i.contato_id = c.id
           and c.conta_id = ${n.contaId}
           and c.telefone_e164 in (${sql.join(parte.map((t) => sql`${t}`), sql`, `)})
      `);
    }

    const validos = lote.adicionar.length;
    const lidos = validos + lote.invalidos;
    if (lidos) {
      await db
        .update(importacao)
        .set({
          totalLidos: sql`${importacao.totalLidos} + ${lidos}`,
          validos: sql`${importacao.validos} + ${validos}`,
          invalidos: sql`${importacao.invalidos} + ${lote.invalidos}`,
          novos: sql`${importacao.novos} + ${novos}`,
          jaExistiam: sql`${importacao.jaExistiam} + ${validos - novos}`,
        })
        .where(eq(importacao.id, importacaoId));
    }
  }

  // ------------------------------------------------------------ a retomada

  /**
   * Devolve à fila os lotes de agenda e histórico guardados de números que já
   * têm resposta.
   *
   * Lote guardado + número com resposta só acontece de um jeito: o lote foi
   * processado quando ainda não havia resposta. Com resposta, o caminho do
   * webhook SEMPRE esvazia o conteúdo (gravou ou recusou) — então cada evento
   * volta à fila uma vez só, e não há laço.
   *
   * A cada minuto, só números com resposta dos últimos dias: no dia a dia a
   * consulta não acha número nenhum. Na subida do servidor, `semJanela` pega
   * o resto — inclusive o histórico que esperou a gravação das conversas
   * existir. O índice `idx_wa_evento_sincronizacao` (migration 025) mantém as
   * duas baratas.
   */
  async reenfileirar(opcoes: { semJanela?: boolean } = {}): Promise<number> {
    const janela = opcoes.semJanela
      ? sql``
      : sql`and n.integrar_decidido_em > now() - make_interval(days => ${DIAS_PARA_REENFILEIRAR})`;
    return this.ctx.comEscopoSistema('meta.agenda.reenfileirar', async (db) => {
      const r = await db.execute(sql`
        update wa_evento e
           set processado_em = null, tentativas = 0, erro = null
          from wa_numero n
         where n.integrar_conversas is not null
           ${janela}
           and e.phone_number_id = n.phone_number_id
           and e.tipo in ('smb_app_state_sync', 'history')
           and e.processado_em is not null
           and e.payload -> 'value' is not null
        returning e.id
      `);
      return r.rows.length;
    });
  }
}
