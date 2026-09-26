/**
 * Pedidos do Cardápio Web → compras (decisão do dono, 25/09/2026: "opção B").
 *
 * Duas fases por loja, com o ponto em que parou guardado no banco — reinício
 * ou deploy não perde nada:
 *
 * - **carga**: o histórico de até 3 anos, uma janela de 180 dias por vez, uma
 *   página (100 pedidos) por passo. O histórico não traz o cliente, então cada
 *   pedido que ainda não está guardado é aberto (`GET /orders/{id}`).
 * - **em dia**: a cada 30 min, os pedidos alterados desde a última consulta.
 *   Consulta parada há mais de 7 h (a API só devolve os alterados nas últimas
 *   8 h) é coberta pela carga, do ponto onde parou.
 *
 * Nas duas: pedido fechado vira compra; cancelado (mesmo depois de fechado)
 * desfaz a compra.
 *
 * Ritmo: a API limita por loja — histórico 5/min, o resto 300 a cada 3 min.
 * Um passo faz no máximo 1 consulta de histórico e abre os pedidos com 650 ms
 * entre um e outro (~92/min); o próximo passo da mesma loja sai 15 s depois.
 * Nenhuma chamada ao Cardápio Web acontece com transação aberta.
 *
 * Contato: a compra se liga pelo telefone, nas duas formas do celular. Cliente
 * que ainda não está na base é buscado no Cardápio Web e entra pelas MESMAS
 * regras da importação de clientes — e só se o dono já fez a declaração de
 * consentimento da loja. Compra de quem pediu para sair não é guardada.
 */
import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { eq, sql, type SQL } from 'drizzle-orm';

import { env } from '../../config/env';
import { emPartes } from '../../common/em-partes';
import { gemeoDoCelular } from '../../common/telefone';
import { ContextoDb, type Db } from '../../db/contexto';
import { integracaoCardapioweb } from '../../db/schema';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { periodoPreferidoSql, refazerProdutos } from '../contato/habitos';
import { decifrarToken } from '../meta/cripto';
import { CardapiowebCliente, ErroCardapioWeb, type Credencial } from './cardapioweb.cliente';
import {
  compraDoPedido,
  ehMarketplace,
  fimDaJanela,
  HORAS_MAXIMAS_DE_CONSULTA,
  inicioMaisAntigo,
  type CompraNormalizada,
  type PedidoDetalhe,
  type PedidoResumo,
} from './cardapioweb.pedidos.regras';
import { decidir, type ClienteCardapioWeb } from './cardapioweb.regras';

const PAUSA_ENTRE_PEDIDOS_MS = 650;
/** Entre dois passos da mesma loja: a consulta de histórico é 5 por minuto. */
const SEGUNDOS_ENTRE_PASSOS = 15;
/** A consulta dos pedidos alterados, loja em dia. */
export const MINUTOS_ENTRE_CONSULTAS = 30;
/**
 * Janela recusada (400) mais velha que isto é pulada: a documentação chegou a
 * dizer "1 ano" num lugar e "3 anos" em outro. Recusa numa janela recente é
 * erro de verdade e para a busca, com o motivo na tela.
 */
const DIAS_EM_QUE_A_RECUSA_E_PULADA = 365;

type Linha = typeof integracaoCardapioweb.$inferSelect;

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Deixa a loja pronta para a carga do histórico (de 3 anos atrás até agora).
 * Usado ao começar a importação de clientes: pedidos vêm junto.
 */
export async function prepararCargaDePedidos(db: Db, contaId: string, agora = new Date()): Promise<void> {
  const de = inicioMaisAntigo(agora);
  await db
    .update(integracaoCardapioweb)
    .set({
      pedidosStatus: 'carga',
      pedidosCargaDe: de,
      pedidosCargaAte: agora,
      pedidosJanelaDe: de,
      pedidosPagina: 0,
      pedidosTotalEstimado: null,
      pedidosLidos: 0,
      pedidosGravados: 0,
      pedidosIgnorados: 0,
      pedidosErro: null,
      pedidosProximoEm: null,
      pedidosAtualizadoEm: agora,
    })
    .where(eq(integracaoCardapioweb.contaId, contaId));
}

@Injectable()
export class PedidosCardapiowebService {
  private readonly log = new Logger('CardapioWebPedidos');

  constructor(
    private readonly ctx: ContextoDb,
    private readonly cliente: CardapiowebCliente,
    private readonly auditoria: AuditoriaService,
  ) {}

  private credencial(l: Linha): Credencial {
    if (!env.integracoes.chave) {
      throw new ServiceUnavailableException('Falta configurar INTEGRACOES_CHAVE no servidor.');
    }
    if (!l.credencialCifrada) throw new BadRequestException('Conecte a loja do Cardápio Web primeiro.');
    return {
      modo: l.modo === 'oauth' ? 'oauth' : 'chave',
      valor: decifrarToken(l.credencialCifrada, env.integracoes.chave),
    };
  }

  private async linha(contaId: string): Promise<Linha | null> {
    return this.ctx.comConta(contaId, async (db) => {
      const [l] = await db.select().from(integracaoCardapioweb).where(eq(integracaoCardapioweb.contaId, contaId)).limit(1);
      return l ?? null;
    });
  }

  // ------------------------------------------------------------ o que o dono pede

  /**
   * "Buscar pedidos": começa a carga do histórico, ou — loja em dia — consulta
   * os alterados agora, sem esperar os 30 minutos.
   */
  async buscar(contaId: string, usuarioId: string): Promise<void> {
    await this.ctx.comConta(contaId, async (db) => {
      const [l] = await db.select().from(integracaoCardapioweb).where(eq(integracaoCardapioweb.contaId, contaId)).limit(1);
      if (!l?.credencialCifrada) throw new BadRequestException('Conecte a loja do Cardápio Web primeiro.');
      if (l.pedidosStatus === 'carga') throw new BadRequestException('A busca do histórico de pedidos já está em andamento.');

      if (l.pedidosStatus === 'em_dia') {
        await db
          .update(integracaoCardapioweb)
          .set({
            pedidosUltimaConsulta: sql`least(${integracaoCardapioweb.pedidosUltimaConsulta}, now() - make_interval(mins => ${MINUTOS_ENTRE_CONSULTAS + 1}))`,
            pedidosProximoEm: null,
          })
          .where(eq(integracaoCardapioweb.contaId, contaId));
      } else {
        await prepararCargaDePedidos(db, contaId);
      }

      await this.auditoria.registrar({
        contaId,
        atorTipo: 'usuario',
        atorUsuarioId: usuarioId,
        acao: l.pedidosStatus === 'em_dia' ? 'cardapioweb.pedidos_atualizados' : 'cardapioweb.pedidos_iniciados',
        entidade: 'integracao_cardapioweb',
        detalhe: { loja: l.lojaNome },
      });
    });
  }

  // ------------------------------------------------------------ o passo (chamado pelo job)

  /** Um passo de uma loja. Não lança: o erro vira `pedidos_erro` com o motivo. Solta a trava no fim. */
  async passo(contaId: string): Promise<void> {
    try {
      const l = await this.linha(contaId);
      if (!l?.credencialCifrada) return;
      const cred = this.credencial(l);
      if (l.pedidosStatus === 'carga') await this.passoDaCarga(contaId, l, cred);
      else if (l.pedidosStatus === 'em_dia') await this.passoEmDia(contaId, l, cred);
    } catch (erro) {
      await this.registrarErro(contaId, erro);
    } finally {
      await this.ctx
        .comConta(contaId, (db) =>
          db.update(integracaoCardapioweb).set({ pedidosTravaAte: null }).where(eq(integracaoCardapioweb.contaId, contaId)),
        )
        .catch((e: unknown) => this.log.error(`Não consegui soltar a trava de pedidos da conta ${contaId}: ${String(e)}`));
    }
  }

  private async passoDaCarga(contaId: string, l: Linha, cred: Credencial): Promise<void> {
    const agora = new Date();
    const ate = l.pedidosCargaAte ?? agora;
    let janelaDe = l.pedidosJanelaDe ?? l.pedidosCargaDe ?? ate;
    let paginaFeita = l.pedidosPagina;
    // O limite de 3 anos conta de hoje: carga parada por dias recomeça dentro
    // dele, do começo da janela (as páginas mudam junto com o início).
    const minimo = inicioMaisAntigo(agora);
    if (janelaDe < minimo) {
      janelaDe = minimo;
      paginaFeita = 0;
    }

    if (janelaDe >= ate) {
      await this.atualizarEstado(contaId, { pedidosStatus: 'em_dia', pedidosUltimaConsulta: ate, pedidosErro: null });
      this.log.log(`Cardápio Web: histórico de pedidos da conta ${contaId} carregado.`);
      return;
    }

    const janelaAte = fimDaJanela(janelaDe, ate);
    const pagina = paginaFeita + 1;
    let dados;
    try {
      dados = await this.cliente.historicoDePedidos(cred, janelaDe, janelaAte, pagina);
    } catch (erro) {
      const antiga = janelaAte.getTime() < agora.getTime() - DIAS_EM_QUE_A_RECUSA_E_PULADA * 86_400_000;
      if (erro instanceof ErroCardapioWeb && erro.status === 400 && paginaFeita === 0 && antiga) {
        this.log.warn(
          `Cardápio Web: conta ${contaId}, histórico de ${janelaDe.toISOString()} a ${janelaAte.toISOString()} recusado (400) — pulando a janela.`,
        );
        await this.atualizarEstado(contaId, {
          pedidosJanelaDe: janelaAte,
          pedidosPagina: 0,
          pedidosProximoEm: new Date(Date.now() + SEGUNDOS_ENTRE_PASSOS * 1000),
        });
        return;
      }
      throw erro;
    }

    const r = await this.processar(contaId, l, cred, dados.orders.filter((o) => o.status === 'closed'));
    await this.desfazerCancelados(contaId, dados.orders);
    const terminouJanela = dados.orders.length === 0 || pagina >= (dados.pagination.total_pages || 0);
    const acabou = terminouJanela && janelaAte >= ate;

    await this.atualizarEstado(contaId, {
      pedidosPagina: terminouJanela ? 0 : pagina,
      pedidosJanelaDe: terminouJanela ? janelaAte : janelaDe,
      ...(pagina === 1
        ? { pedidosTotalEstimado: sql`coalesce(${integracaoCardapioweb.pedidosTotalEstimado}, 0) + ${dados.pagination.total_orders ?? 0}` }
        : {}),
      pedidosLidos: sql`${integracaoCardapioweb.pedidosLidos} + ${dados.orders.length}`,
      pedidosGravados: sql`${integracaoCardapioweb.pedidosGravados} + ${r.gravadas}`,
      pedidosIgnorados: sql`${integracaoCardapioweb.pedidosIgnorados} + ${r.ignorados}`,
      pedidosErro: null,
      pedidosProximoEm: new Date(Date.now() + SEGUNDOS_ENTRE_PASSOS * 1000),
      ...(acabou ? { pedidosStatus: 'em_dia', pedidosUltimaConsulta: ate } : {}),
    });
  }

  private async passoEmDia(contaId: string, l: Linha, cred: Credencial): Promise<void> {
    const agora = new Date();
    const ultima = l.pedidosUltimaConsulta;
    if (!ultima || agora.getTime() - ultima.getTime() > HORAS_MAXIMAS_DE_CONSULTA * 3_600_000) {
      // Buraco maior que a consulta alcança: a carga cobre, do ponto onde parou.
      const de = new Date((ultima ?? agora).getTime() - 3_600_000);
      await this.atualizarEstado(contaId, {
        pedidosStatus: 'carga',
        pedidosCargaDe: de,
        pedidosCargaAte: agora,
        pedidosJanelaDe: de,
        pedidosPagina: 0,
        pedidosProximoEm: null,
      });
      return;
    }

    const desde = new Date(Math.max(ultima.getTime() - 5 * 60_000, agora.getTime() - HORAS_MAXIMAS_DE_CONSULTA * 3_600_000));
    const alterados = await this.cliente.pedidosAlterados(cred, desde);
    const r = await this.processar(contaId, l, cred, alterados.filter((o) => o.status === 'closed'));
    await this.desfazerCancelados(contaId, alterados);

    await this.atualizarEstado(contaId, {
      pedidosUltimaConsulta: agora,
      pedidosLidos: sql`${integracaoCardapioweb.pedidosLidos} + ${alterados.length}`,
      pedidosGravados: sql`${integracaoCardapioweb.pedidosGravados} + ${r.gravadas}`,
      pedidosIgnorados: sql`${integracaoCardapioweb.pedidosIgnorados} + ${r.ignorados}`,
      pedidosErro: null,
      pedidosProximoEm: null,
    });
  }

  // ------------------------------------------------------------ pedidos → compras

  /** Pedido cancelado (mesmo depois de fechado) não é compra: sai, e os totais do contato são refeitos. */
  private async desfazerCancelados(contaId: string, pedidos: PedidoResumo[]): Promise<void> {
    const cancelados = pedidos.filter((o) => o.status === 'canceled').map((o) => String(o.id));
    if (!cancelados.length) return;
    await this.ctx.comConta(contaId, async (db) => {
      for (const parte of emPartes(cancelados, 500)) {
        const tirados = await db.execute(sql`
          delete from compra
           where conta_id = ${contaId} and fonte = 'cardapioweb'
             and id_externo in (${sql.join(parte.map((c) => sql`${c}`), sql`, `)})
          returning contato_id
        `);
        await recalcularTotais(db, contaId, (tirados.rows as { contato_id: string }[]).map((x) => x.contato_id));
      }
    });
  }

  /**
   * Abre os pedidos que faltam, liga cada um a um contato e grava as compras.
   * Três etapas: ler (transação curta) → Cardápio Web (sem transação) → gravar.
   */
  private async processar(
    contaId: string,
    l: Linha,
    cred: Credencial,
    pedidos: PedidoResumo[],
  ): Promise<{ gravadas: number; ignorados: number }> {
    // Marketplace fica de fora sem nem abrir o pedido: o histórico já diz o canal.
    const proprios = pedidos.filter((p) => !ehMarketplace(p));
    let ignorados = pedidos.length - proprios.length;
    if (!proprios.length) return { gravadas: 0, ignorados };

    // 1. O que já está guardado, e igual, não é aberto de novo.
    const ids = proprios.map((p) => String(p.id));
    const guardadas = await this.ctx.comConta(contaId, async (db) => {
      const r = await db.execute(sql`
        select id_externo, atualizada_na_fonte from compra
         where conta_id = ${contaId} and fonte = 'cardapioweb'
           and id_externo in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})
      `);
      return new Map((r.rows as { id_externo: string; atualizada_na_fonte: string | null }[]).map((x) => [x.id_externo, x.atualizada_na_fonte]));
    });
    const abrir = proprios.filter((p) => {
      const id = String(p.id);
      if (!guardadas.has(id)) return true;
      const antes = guardadas.get(id);
      return Boolean(p.updated_at && antes && new Date(p.updated_at).getTime() > new Date(antes).getTime());
    });

    // 2. Abrir os pedidos (sem transação), no ritmo da API.
    const compras: CompraNormalizada[] = [];
    for (let i = 0; i < abrir.length; i++) {
      if (i > 0) await esperar(PAUSA_ENTRE_PEDIDOS_MS);
      const detalhe: PedidoDetalhe | null = await this.cliente.pedido(cred, String(abrir[i]!.id));
      if (!detalhe) {
        ignorados++;
        continue;
      }
      const c = compraDoPedido(detalhe);
      if ('ignorado' in c) ignorados++;
      else compras.push(c);
    }
    if (!compras.length) return { gravadas: 0, ignorados };

    // 3. Quem ainda não é contato: buscar no Cardápio Web (sem transação).
    const conhecidos = await this.ctx.comConta(contaId, (db) => contatosPorTelefone(db, contaId, compras.map((c) => c.telefone)));
    const semContato = [...new Set(compras.filter((c) => !acharContato(conhecidos, c.telefone) && c.clienteId).map((c) => c.clienteId!))];
    const clientesNovos: ClienteCardapioWeb[] = [];
    // Sem a declaração do dono, cliente novo não entra pela sincronização de pedidos.
    if (semContato.length && l.consentimentoEm) {
      for (let i = 0; i < semContato.length; i++) {
        if (i > 0 || abrir.length) await esperar(PAUSA_ENTRE_PEDIDOS_MS);
        const c = await this.cliente.cliente(cred, semContato[i]!);
        if (c) clientesNovos.push(c);
      }
    }

    // 4. Gravar: clientes novos, compras de quem pode receber, totais.
    const gravadas = await this.ctx.comConta(contaId, async (db) => {
      if (clientesNovos.length) await gravarClientesNovos(db, contaId, l, clientesNovos);
      const contatos = await contatosPorTelefone(db, contaId, compras.map((c) => c.telefone));

      const linhas: { compra: CompraNormalizada; contatoId: string }[] = [];
      for (const c of compras) {
        const k = acharContato(contatos, c.telefone);
        if (k && !k.optOut) linhas.push({ compra: c, contatoId: k.id });
        else ignorados++;
      }

      const afetados = new Set<string>();
      let novas = 0;
      for (const parte of emPartes(linhas, 200)) {
        const r = await db.execute(sql`
          insert into compra (conta_id, contato_id, fonte, id_externo, feita_em, valor_centavos, tipo, canal, bairro, itens, atualizada_na_fonte)
          values ${sql.join(
            parte.map(
              ({ compra: c, contatoId }) =>
                sql`(${contaId}, ${contatoId}, 'cardapioweb', ${c.idExterno}, ${c.feitaEm}, ${c.valorCentavos}, ${c.tipo},
                     ${c.canal}, ${c.bairro}, ${JSON.stringify(c.itens)}::jsonb, ${c.atualizadaNaFonte})`,
            ),
            sql`, `,
          )}
          on conflict (conta_id, fonte, id_externo) do update
             set contato_id = excluded.contato_id,
                 feita_em = excluded.feita_em,
                 valor_centavos = excluded.valor_centavos,
                 tipo = excluded.tipo,
                 canal = excluded.canal,
                 bairro = excluded.bairro,
                 itens = excluded.itens,
                 atualizada_na_fonte = excluded.atualizada_na_fonte
           where compra.atualizada_na_fonte is distinct from excluded.atualizada_na_fonte
              or compra.contato_id <> excluded.contato_id
          returning contato_id, (xmax = 0) as nova
        `);
        for (const x of r.rows as { contato_id: string; nova: boolean }[]) {
          afetados.add(x.contato_id);
          if (x.nova) novas++;
        }
      }
      await recalcularTotais(db, contaId, [...afetados]);
      return novas;
    });

    return { gravadas, ignorados };
  }

  // ------------------------------------------------------------ estado e erro

  private async atualizarEstado(contaId: string, valores: Partial<Record<keyof Linha, unknown>>): Promise<void> {
    await this.ctx.comConta(contaId, (db) =>
      db
        .update(integracaoCardapioweb)
        .set({ ...(valores as Partial<Linha>), pedidosAtualizadoEm: new Date() })
        .where(eq(integracaoCardapioweb.contaId, contaId)),
    );
  }

  /**
   * Erro do Cardápio Web passageiro (limite, fora do ar): tenta de novo mais
   * tarde, do mesmo ponto. Recusa da credencial: para, com o motivo na tela.
   * Erro nosso: registra o motivo e tenta de novo em 5 min — um soluço de
   * banco não pode matar a sincronização.
   */
  private async registrarErro(contaId: string, erro: unknown): Promise<void> {
    const doCardapioWeb = erro instanceof ErroCardapioWeb;
    const motivo = doCardapioWeb
      ? erro.message
      : 'A busca de pedidos parou por um erro nosso. Tentamos de novo em alguns minutos.';
    const espera = doCardapioWeb ? (erro.status === 429 ? 60 : erro.passageiro ? 120 : null) : 300;
    if (doCardapioWeb) this.log.warn(`Cardápio Web: pedidos da conta ${contaId}: ${motivo}`);
    else this.log.error(`Cardápio Web: pedidos da conta ${contaId} falharam: ${String(erro)}`, (erro as Error)?.stack);

    await this.atualizarEstado(contaId, {
      pedidosErro: motivo,
      pedidosProximoEm: espera === null ? null : new Date(Date.now() + espera * 1000),
      ...(espera === null ? { pedidosStatus: 'falhou' } : {}),
    }).catch((e: unknown) => this.log.error(`Não consegui registrar o erro de pedidos da conta ${contaId}: ${String(e)}`));
  }
}

// ------------------------------------------------------------ banco (funções da transação)

interface ContatoDoTelefone {
  id: string;
  telefone: string;
  optOut: boolean;
}

/** Os contatos da conta com estes telefones — em qualquer das duas formas do celular. */
async function contatosPorTelefone(db: Db, contaId: string, telefones: string[]): Promise<Map<string, ContatoDoTelefone>> {
  const formas = [...new Set(telefones.flatMap((t) => [t, gemeoDoCelular(t)].filter((x): x is string => Boolean(x))))];
  const mapa = new Map<string, ContatoDoTelefone>();
  for (const parte of emPartes(formas, 500)) {
    const r = await db.execute(sql`
      select id, telefone_e164, opt_out from contato
       where conta_id = ${contaId}
         and telefone_e164 in (${sql.join(parte.map((t) => sql`${t}`), sql`, `)})
    `);
    for (const x of r.rows as { id: string; telefone_e164: string; opt_out: boolean }[]) {
      mapa.set(x.telefone_e164, { id: x.id, telefone: x.telefone_e164, optOut: x.opt_out });
    }
  }
  return mapa;
}

/** O contato deste telefone, na forma dele ou na outra; bloqueado em qualquer forma vence. */
function acharContato(mapa: Map<string, ContatoDoTelefone>, telefone: string): ContatoDoTelefone | null {
  const achados = [mapa.get(telefone), mapa.get(gemeoDoCelular(telefone) ?? '')].filter((x): x is ContatoDoTelefone => Boolean(x));
  return achados.find((k) => k.optOut) ?? achados[0] ?? null;
}

/**
 * Clientes que chegaram pelo pedido antes de estarem na base: as mesmas regras
 * da importação de clientes (WhatsApp liberado → contato com a evidência;
 * desligado → descadastrado). O descadastro que já existe nunca é desfeito.
 */
async function gravarClientesNovos(db: Db, contaId: string, l: Linha, clientes: ClienteCardapioWeb[]): Promise<void> {
  const agora = new Date();
  const hoje = agora.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const loja = l.lojaNome ?? 'loja';
  const decisoes = clientes.map(decidir);
  const liberados = decisoes.filter((d): d is Extract<ReturnType<typeof decidir>, { tipo: 'contato' }> => d.tipo === 'contato');
  const bloqueados = decisoes.filter((d): d is Extract<ReturnType<typeof decidir>, { tipo: 'bloqueado' }> => d.tipo === 'bloqueado');

  if (liberados.length) {
    await db.execute(sql`
      insert into contato (conta_id, telefone_e164, nome, email, consentimento_origem, consentimento_em, consentimento_evidencia, importacao_id)
      values ${sql.join(
        liberados.map(
          (c) => sql`(${contaId}, ${c.telefone}, ${c.nome}, ${c.email}, 'api', ${agora},
                      ${`Cliente da loja "${loja}" no Cardápio Web, com WhatsApp liberado lá. Encontrado pela sincronização de pedidos em ${hoje}, com a declaração de consentimento do dono da conta.`},
                      ${l.importacaoId})`,
        ),
        sql`, `,
      )}
      on conflict (conta_id, telefone_e164) do nothing
    `);
    if (l.listaId) {
      await db.execute(sql`
        insert into contato_lista_item (conta_id, lista_id, contato_id)
        select conta_id, ${l.listaId}, id from contato
         where conta_id = ${contaId} and opt_out = false
           and telefone_e164 in (${sql.join(liberados.map((c) => sql`${c.telefone}`), sql`, `)})
        on conflict do nothing
      `);
    }
  }
  if (bloqueados.length) {
    await db.execute(sql`
      insert into contato (conta_id, telefone_e164, nome, opt_out, opt_out_em, opt_out_origem, importacao_id)
      values ${sql.join(
        bloqueados.map((b) => sql`(${contaId}, ${b.telefone}, ${b.nome}, true, ${agora}, 'cardapioweb', ${l.importacaoId})`),
        sql`, `,
      )}
      on conflict (conta_id, telefone_e164) do update
         set opt_out = true, opt_out_em = excluded.opt_out_em, opt_out_origem = excluded.opt_out_origem
       where contato.opt_out = false
    `);
  }
}

/**
 * Os totais do contato (pedidos, gasto, primeira e última compra), o bairro
 * mais frequente nas entregas, o jeito de comprar mais frequente (entrega,
 * retirada, salão; empate: o mais recente), o período do dia em que mais pede
 * (no fuso da conta) e os produtos que já comprou, refeitos das compras — para
 * os contatos tocados neste lote. Quem ficou sem compra nenhuma (o único
 * pedido foi cancelado) volta a "sem histórico", se o histórico vinha daqui.
 */
export async function recalcularTotais(db: Db, contaId: string, contatoIds: string[]): Promise<void> {
  for (const parte of emPartes([...new Set(contatoIds)], 500)) {
    const lista: SQL = sql.join(parte.map((id) => sql`${id}::uuid`), sql`, `);
    await db.execute(sql`
      update contato c
         set pedidos = a.qtd,
             total_gasto_centavos = a.total,
             primeiro_pedido_em = a.primeiro,
             ultimo_pedido_em = a.ultimo,
             bairro = b.bairro,
             tipo_preferido = t.tipo,
             periodo_preferido = ${periodoPreferidoSql(sql`a.contato_id`)},
             metricas_em = now(),
             metricas_origem = 'cardapioweb'
        from (
          select contato_id, count(*)::int as qtd, sum(valor_centavos)::bigint as total,
                 min(feita_em) as primeiro, max(feita_em) as ultimo
            from compra
           where conta_id = ${contaId} and contato_id in (${lista})
           group by contato_id
        ) a
        left join lateral (
          -- O bairro que mais aparece (sem ligar para maiúscula; empate: o mais
          -- recente) e, dentro dele, a grafia mais usada, de preferência com
          -- inicial maiúscula — "Tijuca" e "tijuca" são o mesmo bairro.
          select x.bairro
            from compra x
           where x.contato_id = a.contato_id and x.bairro is not null
           group by x.bairro
           order by sum(count(*)) over (partition by lower(x.bairro)) desc,
                    max(max(x.feita_em)) over (partition by lower(x.bairro)) desc,
                    count(*) desc, (x.bairro ~ '^[[:upper:]]') desc, x.bairro
           limit 1
        ) b on true
        left join lateral (
          select x.tipo
            from compra x
           where x.contato_id = a.contato_id and x.tipo in ('entrega', 'retirada', 'salao')
           group by x.tipo
           order by count(*) desc, max(x.feita_em) desc
           limit 1
        ) t on true
       where c.id = a.contato_id and c.conta_id = ${contaId}
    `);
    await db.execute(sql`
      update contato c
         set pedidos = null, total_gasto_centavos = null, primeiro_pedido_em = null, ultimo_pedido_em = null,
             bairro = null, tipo_preferido = null, periodo_preferido = null, metricas_em = now()
       where c.conta_id = ${contaId}
         and c.id in (${lista})
         and c.metricas_origem = 'cardapioweb'
         and not exists (select 1 from compra x where x.contato_id = c.id)
    `);
    await refazerProdutos(db, contaId, lista);
  }
}
