/**
 * Gravação das conversas do WhatsApp (coexistência com "sim").
 *
 * O webhook chama uma porta por tipo de aviso — `historico`, `ecos`,
 * `recebidas` — e cada uma devolve o que fazer com o conteúdo do evento no
 * registro de eventos (`DestinoDoEvento`). A leitura dos formatos da Meta fica
 * em `conversas.regras.ts`; aqui, só banco.
 *
 * O que vale para as três:
 *
 * - Só grava para número em coexistência cujo dono respondeu "sim". Com "não",
 *   o conteúdo é esvaziado; sem resposta, o histórico espera (a retomada o
 *   devolve à fila quando a resposta vier) e o resto segue como sempre.
 * - Tudo em comandos por conjunto: as conversas do lote numa tacada, as
 *   mensagens em partes, os totais uma vez por lote. Nunca um comando por
 *   mensagem — um histórico de 6 meses tem milhares.
 * - O número fica travado (`for update`) durante a gravação: lotes do mesmo
 *   número não se atropelam somando não lidas duas vezes.
 * - Escopo de sistema: o aviso chega pelo número, e a conta só é conhecida
 *   depois (motivo A, `docs/rls.md`). Todo comando leva o `conta_id` do número
 *   achado.
 */
import { Injectable, Logger } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';

import { emPartes } from '../../common/em-partes';
import { ContextoDb, type Db } from '../../db/contexto';
import { conversa, mensagem, waNumero } from '../../db/schema';
import { destinoPelaResposta, type DestinoDoEvento } from './agenda.regras';
import {
  deduplicar,
  ecosDoCelular,
  mensagensDoHistorico,
  mensagensRecebidas,
  statusesRecebidos,
  totaisDoLote,
  type MensagemNormalizada,
  type StatusRecebido,
} from './conversas.regras';

interface NumeroDaConversa {
  id: string;
  contaId: string;
  coexistencia: boolean;
  integrarConversas: boolean | null;
}

const CAMPOS = {
  id: waNumero.id,
  contaId: waNumero.contaId,
  coexistencia: waNumero.coexistencia,
  integrarConversas: waNumero.integrarConversas,
};

/** De quais estados cada status pode vir. Mensagem entregue não "volta" a enviada. */
const ANTERIORES: Record<string, string[]> = {
  enviada: ['enviando'],
  entregue: ['enviando', 'enviada'],
  lida: ['enviando', 'enviada', 'entregue'],
  falhou: ['enviando', 'enviada'],
};

function mascararId(valor: string): string {
  return valor.length <= 4 ? '••••' : `••••${valor.slice(-4)}`;
}

@Injectable()
export class ConversasService {
  private readonly log = new Logger('Conversas');

  constructor(private readonly ctx: ContextoDb) {}

  // ------------------------------------------------------------ as portas

  /**
   * `history`: os 6 meses copiados e o aviso à parte com a mídia recente.
   *
   * Número ainda não gravado faz LANÇAR — o evento volta para a fila. É o
   * histórico que chega antes de a transação da conexão terminar.
   */
  async historico(phoneNumberId: string, value: Record<string, unknown>): Promise<DestinoDoEvento> {
    return this.ctx.comEscopoSistema('meta.conversas.historico', async (db) => {
      const n = await this.numero(db, phoneNumberId);
      if (!n) {
        throw new Error(
          `Histórico de um número que ainda não está gravado (${mascararId(phoneNumberId)}). O evento volta para a fila.`,
        );
      }
      if (!n.coexistencia) return 'esvaziar';

      const destino = destinoPelaResposta(n.integrarConversas);
      if (destino === 'aguardar') return 'guardar';
      if (destino === 'descartar') return 'esvaziar';

      const gravadas = await this.gravar(db, n, mensagensDoHistorico(value), new Map());
      if (gravadas) this.log.log(`Histórico: ${gravadas} mensagem(ns) nova(s) no número ${mascararId(phoneNumberId)}.`);
      return 'esvaziar';
    });
  }

  /** `smb_message_echoes`: o que o lojista respondeu pelo aplicativo do celular. */
  async ecos(phoneNumberId: string, value: Record<string, unknown>): Promise<DestinoDoEvento | void> {
    return this.ctx.comEscopoSistema('meta.conversas.ecos', async (db) => {
      const n = await this.numero(db, phoneNumberId);
      if (!n?.coexistencia || n.integrarConversas === null) return undefined;
      if (n.integrarConversas === false) return 'esvaziar';
      await this.gravar(db, n, ecosDoCelular(value), new Map());
      return 'esvaziar';
    });
  }

  /**
   * `messages`: o que o cliente escreveu, e os status de entrega das respostas.
   *
   * Roda DEPOIS do tratamento de sempre (pedido de saída, status de campanha),
   * que não depende de nada disto. Evento só de status não é esvaziado: não
   * traz conversa.
   */
  async recebidas(phoneNumberId: string, value: Record<string, unknown>): Promise<DestinoDoEvento | void> {
    const { mensagens, nomes } = mensagensRecebidas(value);
    const statuses = statusesRecebidos(value);
    if (!mensagens.length && !statuses.length) return undefined;

    return this.ctx.comEscopoSistema('meta.conversas.recebidas', async (db) => {
      const n = await this.numero(db, phoneNumberId);
      if (!n?.coexistencia || n.integrarConversas === null) return undefined;
      if (n.integrarConversas === false) return mensagens.length ? 'esvaziar' : undefined;

      if (mensagens.length) await this.gravar(db, n, mensagens, nomes);
      if (statuses.length) await this.aplicarStatus(db, n.contaId, statuses);
      return mensagens.length ? 'esvaziar' : undefined;
    });
  }

  // ------------------------------------------------------------ o banco

  private async numero(db: Db, phoneNumberId: string): Promise<NumeroDaConversa | null> {
    const [n] = await db
      .select(CAMPOS)
      .from(waNumero)
      .where(eq(waNumero.phoneNumberId, phoneNumberId))
      .limit(1)
      .for('update');
    return n ?? null;
  }

  /**
   * Grava um lote de mensagens. Devolve quantas eram novas.
   *
   * 1. As conversas das pessoas do lote, criadas se ainda não existem.
   * 2. As mensagens, únicas por wamid. A mesma mensagem de novo não entra —
   *    exceto para ganhar a mídia que faltava: o aviso de mídia do histórico
   *    chega depois, com o mesmo wamid.
   * 3. Os totais de cada conversa, a partir só das mensagens NOVAS.
   */
  private async gravar(
    db: Db,
    n: NumeroDaConversa,
    brutas: MensagemNormalizada[],
    nomes: Map<string, string>,
  ): Promise<number> {
    const mensagens = deduplicar(brutas);
    if (!mensagens.length) return 0;

    // 1. conversas
    const idPorTelefone = new Map<string, string>();
    for (const parte of emPartes([...new Set(mensagens.map((m) => m.telefone))])) {
      const linhas = await db
        .insert(conversa)
        .values(
          parte.map((telefone) => ({
            contaId: n.contaId,
            waNumeroId: n.id,
            telefoneE164: telefone,
            nomePerfil: nomes.get(telefone) ?? null,
          })),
        )
        .onConflictDoUpdate({
          target: [conversa.waNumeroId, conversa.telefoneE164],
          // Atualiza de propósito — é o que faz o RETURNING trazer a conversa
          // que já existia. O nome de perfil só muda quando veio um novo.
          set: { nomePerfil: sql`coalesce(excluded.nome_perfil, ${conversa.nomePerfil})` },
        })
        .returning({ id: conversa.id, telefone: conversa.telefoneE164 });
      for (const l of linhas) idPorTelefone.set(l.telefone, l.id);
    }

    // 2. mensagens
    const novas: Array<{ conversaId: string } & Pick<MensagemNormalizada, 'direcao' | 'origem' | 'tipo' | 'texto' | 'criadaEm'>> = [];
    for (const parte of emPartes(mensagens)) {
      const linhas = await db
        .insert(mensagem)
        .values(
          parte.map((m) => ({
            contaId: n.contaId,
            conversaId: idPorTelefone.get(m.telefone)!,
            wamid: m.wamid,
            direcao: m.direcao,
            origem: m.origem,
            tipo: m.tipo,
            texto: m.texto,
            midiaId: m.midiaId,
            midiaMime: m.midiaMime,
            midiaNome: m.midiaNome,
            status: m.status,
            criadaEm: m.criadaEm,
          })),
        )
        .onConflictDoUpdate({
          target: [mensagem.contaId, mensagem.wamid],
          set: {
            midiaId: sql`excluded.midia_id`,
            midiaMime: sql`excluded.midia_mime`,
            midiaNome: sql`coalesce(excluded.midia_nome, ${mensagem.midiaNome})`,
          },
          // Só a mídia que faltava; repetição sem novidade não toca a linha.
          setWhere: sql`${mensagem.midiaId} is null and excluded.midia_id is not null`,
        })
        .returning({
          conversaId: mensagem.conversaId,
          direcao: mensagem.direcao,
          origem: mensagem.origem,
          tipo: mensagem.tipo,
          texto: mensagem.texto,
          criadaEm: mensagem.criadaEm,
          // xmax = 0: linha inserida agora (e não a mídia preenchida numa que já existia).
          nova: sql<boolean>`(xmax = 0)`,
        });
      for (const l of linhas) {
        if (l.nova) {
          novas.push({
            conversaId: l.conversaId,
            direcao: l.direcao as MensagemNormalizada['direcao'],
            origem: l.origem as MensagemNormalizada['origem'],
            tipo: l.tipo,
            texto: l.texto,
            criadaEm: l.criadaEm,
          });
        }
      }
    }

    // 3. totais
    const porConversa = new Map<string, typeof novas>();
    for (const m of novas) porConversa.set(m.conversaId, [...(porConversa.get(m.conversaId) ?? []), m]);
    const totais = [...porConversa].map(([id, lista]) => ({ id, ...totaisDoLote(lista) }));

    for (const parte of emPartes(totais)) {
      await db.execute(sql`
        update conversa c
           set ultima_mensagem = case
                 when c.ultima_mensagem_em is null or v.ultima_em >= c.ultima_mensagem_em then v.resumo
                 else c.ultima_mensagem
               end,
               ultima_mensagem_em = greatest(c.ultima_mensagem_em, v.ultima_em),
               ultima_entrada_em = greatest(c.ultima_entrada_em, v.ultima_entrada_em),
               nao_lidas = case when v.zerar then v.novas else c.nao_lidas + v.novas end
          from (values ${sql.join(
            parte.map(
              (t) =>
                sql`(${t.id}::uuid, ${t.ultimaMensagemEm}::timestamptz, ${t.ultimaMensagem}::text, ${t.ultimaEntradaEm}::timestamptz, ${t.zerarNaoLidas}::boolean, ${t.novasNaoLidas}::int)`,
            ),
            sql`, `,
          )}) as v(id, ultima_em, resumo, ultima_entrada_em, zerar, novas)
         where c.id = v.id
           and c.conta_id = ${n.contaId}
      `);
    }

    return novas.length;
  }

  /**
   * Status de entrega das respostas (painel e celular). Só anda para frente:
   * "entregue" atrasado não desfaz "lida".
   */
  private async aplicarStatus(db: Db, contaId: string, statuses: StatusRecebido[]): Promise<void> {
    for (const parte of emPartes(statuses)) {
      await db.execute(sql`
        update mensagem m
           set status = v.status,
               erro_codigo = coalesce(v.erro_codigo, m.erro_codigo),
               erro_titulo = coalesce(v.erro_titulo, m.erro_titulo)
          from (values ${sql.join(
            parte.map(
              (s) =>
                // O array vai como literal do Postgres ('{a,b}'): array JS dentro
                // do `sql` do Drizzle vira lista de parâmetros. Os valores são
                // palavras fixas deste arquivo, nada que venha de fora.
                sql`(${s.wamid}::text, ${s.status}::text, ${s.erroCodigo}::int, ${s.erroTitulo}::text, ${`{${(ANTERIORES[s.status] ?? []).join(',')}}`}::text[])`,
            ),
            sql`, `,
          )}) as v(wamid, status, erro_codigo, erro_titulo, anteriores)
         where m.conta_id = ${contaId}
           and m.wamid = v.wamid
           and m.direcao = 'saida'
           and (m.status is null or m.status = any(v.anteriores))
      `);
    }
  }
}
