/**
 * A integração com o Regem (decisões do dono, 30/09/2026).
 *
 * Fluxo:
 * 1. A DISTRIBUIÇÃO liga a conta à empresa no Regem, pelo console: o token que
 *    ela emitiu no console do Regem é conferido na hora (`GET /integracao/loja`)
 *    e guardado cifrado. A loja não copia nada.
 * 2. O dono declara o consentimento e começa a importação: os clientes vêm
 *    primeiro, pelo cursor, 500 por página; depois as vendas (3 anos na carga).
 *    Uma leitura completa = um registro em `importacao`, como a de arquivo.
 * 3. Com a carga feita, a cada 30 min o cursor traz o que mudou — clientes
 *    novos, quem pediu para sair, quem foi esquecido, vendas novas e canceladas.
 * 4. A 99Food só entra com a autorização do dono, registrada AQUI, sob a
 *    responsabilidade dele. O Regem só entrega a 99 quando o token tem o escopo
 *    dela (a distribuição emite outro); as duas coisas juntas relêem tudo do
 *    começo. Desfazer a autorização tira as compras da 99 e quem entrou na base
 *    só por ela.
 *
 * Nunca sobrescreve: um contato que já existe mantém o consentimento que tinha
 * e um descadastro nunca é desfeito. Quem foi esquecido no Regem (a lápide) é
 * anonimizado aqui, como no pedido de exclusão feito na tela do contato.
 *
 * Concorrência: um passo por conta (a trava do job) e, dentro dele, cada página
 * é gravada com a linha da integração travada (`for update`) e só se o cursor
 * ainda for o que foi lido — recomeçar, autorizar a 99 ou desligar no meio de
 * um passo faz o passo parar, nunca gravar por cima.
 *
 * Nenhuma chamada ao Regem acontece com transação aberta: cada página é lida
 * fora e gravada num `comConta` curto.
 */
import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { and, eq, sql, type SQL } from 'drizzle-orm';

import { emPartes } from '../../common/em-partes';
import { MARCA_REGEM_DESLIGADO } from '../../common/gratuidade-regem';
import { env } from '../../config/env';
import { ContextoDb, type Db } from '../../db/contexto';
import { contatoLista, importacao, integracaoCardapioweb, integracaoRegem } from '../../db/schema';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { retomarPausadasPorTeto } from '../campanha/campanha.service';
import { anonimizarContatos } from '../contato/anonimizar';
import {
  acharContato,
  bloquearContatos,
  contatosPorTelefone,
  gravarCompras,
  recalcularTotais,
} from '../contato/compras';
import { cifrarToken, decifrarToken } from '../meta/cripto';
import { ErroRegem, RegemCliente } from './regem.cliente';
import {
  CANAL_99,
  ESCOPO_99,
  MINUTOS_ENTRE_CONSULTAS,
  PAGINAS_POR_PASSO,
  PAUSA_ENTRE_PAGINAS_MS,
  compraDaVenda,
  decidirCliente,
  escoposQueFaltam,
  type ClienteRegem,
  type CompraDoRegem,
  type DecisaoDoCliente,
  type LojaDoRegem,
  type VendaRegem,
} from './regem.regras';

const NOME_LISTA = 'Clientes Regem';

type Linha = typeof integracaoRegem.$inferSelect;
type Status = 'parado' | 'carga' | 'em_dia' | 'falhou';
type Fase = 'clientes' | 'pedidos';

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * O texto que o dono aceita para trazer os clientes da 99. O servidor é a
 * fonte: o site e o app mostram este, e é este que fica gravado.
 */
export function textoDaAutorizacao99(empresa: string | null): string {
  return (
    `Autorizo o RegemCast a trazer do Regem os clientes que compraram na empresa "${empresa ?? 'minha empresa'}" pela 99Food ` +
    'e declaro, em nome da empresa e sob a responsabilidade dela (CNPJ), que esses clientes autorizaram receber ' +
    'mensagens da empresa pelo WhatsApp.'
  );
}

export interface SituacaoRegem {
  ligado: boolean;
  empresaNome: string | null;
  lojas: { id: string; nome: string }[];
  ligadaEm: Date | null;
  /** O token no Regem libera os clientes e as vendas da 99. */
  escopo99: boolean;
  /** O dono autorizou usar os clientes da 99, sob a responsabilidade dele. */
  incluir99: boolean;
  autorizacao99Em: Date | null;
  /** O texto que o dono aceita para autorizar a 99 (o mesmo que fica gravado). */
  textoAutorizacao99: string;
  consentimentoEm: Date | null;
  listaId: string | null;
  /** A loja também liga o Cardápio Web direto aqui: as vendas dele que chegam pelo Regem ficam de fora. */
  cardapioWebDireto: boolean;
  /**
   * Ligada ao Regem, a conta não paga (`common/gratuidade-regem.ts`). Desligou,
   * a gratuidade acaba: sem plano pago, os disparos param depois destes dias.
   */
  carenciaDias: number;
  clientes: {
    status: Status;
    lidos: number;
    novos: number;
    bloqueados: number;
    ignorados: number;
    invalidos: number;
    removidos: number;
    ultimaConsulta: Date | null;
    erro: string | null;
  };
  pedidos: {
    status: Status;
    lidos: number;
    gravados: number;
    ignorados: number;
    ultimaConsulta: Date | null;
    erro: string | null;
    /** O que está guardado: compras, quantos clientes compraram, e de quando a quando. */
    compras: number;
    clientes: number;
    primeira: Date | null;
    ultima: Date | null;
  };
}

/** Uma linha do console da distribuição: o que está ligado e o que espera por nós. */
export interface LigacaoRegem {
  contaId: string;
  contaNome: string;
  empresaNome: string | null;
  ligadaEm: Date | null;
  ligadaPor: string | null;
  escopo99: boolean;
  incluir99: boolean;
  autorizacao99Em: Date | null;
  /** O dono autorizou a 99 e o token não tem o escopo (emitir outro), ou o contrário (tirar). */
  acao99: 'emitir' | 'retirar' | null;
  importando: boolean;
  clientesStatus: Status;
  pedidosStatus: Status;
  erro: string | null;
}

@Injectable()
export class RegemService {
  private readonly log = new Logger('Regem');

  constructor(
    private readonly ctx: ContextoDb,
    private readonly cliente: RegemCliente,
    private readonly auditoria: AuditoriaService,
  ) {}

  // ------------------------------------------------------------ leitura

  async situacao(contaId: string): Promise<SituacaoRegem> {
    return this.ctx.comConta(contaId, async (db) => {
      const [l] = await db.select().from(integracaoRegem).where(eq(integracaoRegem.contaId, contaId)).limit(1);
      const [guardado] = (
        await db.execute(sql`
          select count(*)::int as compras, count(distinct contato_id)::int as clientes,
                 min(feita_em) as primeira, max(feita_em) as ultima
            from compra where conta_id = ${contaId} and fonte = 'regem'
        `)
      ).rows as { compras: number; clientes: number; primeira: string | null; ultima: string | null }[];
      return {
        ligado: Boolean(l?.credencialCifrada),
        empresaNome: l?.empresaNome ?? null,
        lojas: Array.isArray(l?.lojas) ? (l.lojas as { id: string; nome: string }[]) : [],
        ligadaEm: l?.ligadaEm ?? null,
        escopo99: Boolean(l?.escopos?.includes(ESCOPO_99)),
        incluir99: Boolean(l?.incluir99),
        autorizacao99Em: l?.autorizacao99Em ?? null,
        textoAutorizacao99: textoDaAutorizacao99(l?.empresaNome ?? null),
        consentimentoEm: l?.consentimentoEm ?? null,
        listaId: l?.listaId ?? null,
        cardapioWebDireto: await cardapioWebDireto(db, contaId),
        carenciaDias: env.mercadoPago.carenciaDias,
        clientes: {
          status: (l?.clientesStatus ?? 'parado') as Status,
          lidos: l?.clientesLidos ?? 0,
          novos: l?.clientesNovos ?? 0,
          bloqueados: l?.clientesBloqueados ?? 0,
          ignorados: l?.clientesIgnorados ?? 0,
          invalidos: l?.clientesInvalidos ?? 0,
          removidos: l?.clientesRemovidos ?? 0,
          ultimaConsulta: l?.clientesUltimaConsulta ?? null,
          erro: l?.clientesErro ?? null,
        },
        pedidos: {
          status: (l?.pedidosStatus ?? 'parado') as Status,
          lidos: l?.pedidosLidos ?? 0,
          gravados: l?.pedidosGravados ?? 0,
          ignorados: l?.pedidosIgnorados ?? 0,
          ultimaConsulta: l?.pedidosUltimaConsulta ?? null,
          erro: l?.pedidosErro ?? null,
          compras: guardado?.compras ?? 0,
          clientes: guardado?.clientes ?? 0,
          primeira: guardado?.primeira ? new Date(guardado.primeira) : null,
          ultima: guardado?.ultima ? new Date(guardado.ultima) : null,
        },
      };
    });
  }

  // ------------------------------------------------------------ distribuição

  /**
   * Liga a conta à empresa no Regem com o token que a distribuição emitiu lá.
   *
   * O token é conferido antes de gravar. Token novo da MESMA empresa (trocado,
   * ou com escopo a mais) continua de onde parou; se ele trouxe a 99 que o dono
   * já tinha autorizado, relê tudo do começo. OUTRA empresa zera a conexão: a
   * declaração do dono e a autorização da 99 eram sobre a empresa antiga.
   */
  async ligar(contaId: string, token: string, operador: string): Promise<LojaDoRegem> {
    const segredo = this.chave();
    const bruto = token.trim();
    if (!bruto.startsWith('rgm_it_') || bruto.length < 20) {
      throw new BadRequestException('Esse não é um token de integração do Regem (começa com rgm_it_).');
    }
    let loja: LojaDoRegem;
    try {
      loja = await this.cliente.loja(bruto);
    } catch (erro) {
      if (erro instanceof ErroRegem) throw new BadRequestException(erro.message);
      throw erro;
    }
    const faltam = escoposQueFaltam(loja.escopos);
    if (faltam.length) {
      throw new BadRequestException(`O token do Regem não libera ${faltam.join(', ')}. Emita outro com esses escopos.`);
    }

    await this.ctx.comConta(contaId, async (db) => {
      const existe = await db.execute(sql`select 1 from conta where id = ${contaId}`);
      if (!existe.rows.length) throw new NotFoundException('Conta não encontrada.');

      const [antes] = await db
        .select()
        .from(integracaoRegem)
        .where(eq(integracaoRegem.contaId, contaId))
        .limit(1)
        .for('update');
      const empresa = (x: { empresaId: string | null; empresaNome: string | null }) => x.empresaId ?? x.empresaNome;
      const outraEmpresa = Boolean(antes?.credencialCifrada) && empresa(antes!) !== empresa(loja);
      const ganhou99 = !antes?.escopos.includes(ESCOPO_99) && loja.escopos.includes(ESCOPO_99);

      const conexao = {
        credencialCifrada: cifrarToken(bruto, segredo),
        empresaId: loja.empresaId,
        empresaNome: loja.empresaNome,
        lojas: loja.lojas,
        escopos: loja.escopos,
        ligadaEm: new Date(),
        ligadaPor: operador,
        clientesErro: null,
        pedidosErro: null,
        proximoEm: null,
      };

      let releitura = false;
      if (!antes) {
        await db.insert(integracaoRegem).values({ contaId, ...conexao });
      } else if (outraEmpresa) {
        await db
          .update(integracaoRegem)
          .set({
            ...conexao,
            ...LEITURA_DO_ZERO,
            clientesStatus: 'parado',
            incluir99: false,
            autorizacao99Por: null,
            autorizacao99Em: null,
            autorizacao99Texto: null,
            consentimentoPor: null,
            consentimentoEm: null,
            consentimentoEvidencia: null,
            importacaoId: null,
          })
          .where(eq(integracaoRegem.contaId, contaId));
        await db.execute(sql`delete from integracao_regem_cliente where conta_id = ${contaId}`);
      } else {
        await db
          .update(integracaoRegem)
          // Parou por recusa (token revogado, escopo tirado): o token novo
          // retoma do ponto em que parou.
          .set({ ...conexao, ...RETOMAR_DA_FALHA })
          .where(eq(integracaoRegem.contaId, contaId));
        // A 99 que o dono autorizou chegou agora: os clientes e as vendas dela
        // ficaram para trás no cursor — lê tudo de novo.
        if (ganhou99 && antes.incluir99 && antes.consentimentoEm) {
          await this.comecarLeitura(db, contaId, antes.autorizacao99Por ?? antes.consentimentoPor, loja.empresaNome, true);
          releitura = true;
        }
      }

      // Ligada ao Regem, a conta não paga nem tem teto do plano: as campanhas
      // paradas por falta de saldo ou de pagamento voltam à fila.
      const retomadas = await retomarPausadasPorTeto(db, [contaId], ['teto_plano', 'inadimplencia']);

      await this.auditoria.registrar({
        contaId,
        atorTipo: 'distribuicao',
        acao: 'regem.ligado',
        entidade: 'integracao_regem',
        detalhe: {
          empresa: loja.empresaNome,
          lojas: loja.lojas.length,
          escopos: loja.escopos,
          operador,
          ...(outraEmpresa ? { outraEmpresa: true } : {}),
          ...(releitura ? { releitura: 'a 99 autorizada foi liberada no Regem' } : {}),
          ...(retomadas ? { campanhasRetomadas: retomadas } : {}),
        },
      });
    });
    return loja;
  }

  /**
   * Desliga: apaga o token, o andamento e a ligação dos clientes do Regem aos
   * contatos. Os contatos e as compras ficam — são da conta. A gratuidade do
   * Regem acaba junto (`encerrarGratuidade`).
   */
  async desligar(contaId: string, por: { usuarioId: string } | { operador: string }): Promise<void> {
    await this.ctx.comConta(contaId, async (db) => {
      const apagada = await db
        .delete(integracaoRegem)
        .where(eq(integracaoRegem.contaId, contaId))
        .returning({ id: integracaoRegem.id });
      await db.execute(sql`delete from integracao_regem_cliente where conta_id = ${contaId}`);
      if (!apagada.length) return;
      const cobranca = await encerrarGratuidade(db, contaId);
      await this.auditoria.registrar({
        contaId,
        ...('usuarioId' in por
          ? { atorTipo: 'usuario' as const, atorUsuarioId: por.usuarioId, detalhe: { cobranca } }
          : { atorTipo: 'distribuicao' as const, detalhe: { operador: por.operador, cobranca } }),
        acao: 'regem.desligado',
        entidade: 'integracao_regem',
      });
    });
  }

  /** O console: as contas ligadas ao Regem, primeiro as que esperam por nós (a 99). */
  async ligacoes(): Promise<LigacaoRegem[]> {
    return this.ctx.comEscopoSistema('distribuicao.regem', async (db) => {
      const r = await db.execute(sql`
        select r.conta_id, c.nome as conta_nome, r.empresa_nome, r.ligada_em, r.ligada_por,
               (${ESCOPO_99} = any(r.escopos)) as escopo_99, r.incluir_99, r.autorizacao_99_em,
               r.clientes_status, r.pedidos_status, coalesce(r.clientes_erro, r.pedidos_erro) as erro
          from integracao_regem r
          join conta c on c.id = r.conta_id
         where r.credencial_cifrada is not null
         order by (r.incluir_99 <> (${ESCOPO_99} = any(r.escopos))) desc, r.atualizado_em desc
         limit 500
      `);
      return (
        r.rows as {
          conta_id: string;
          conta_nome: string;
          empresa_nome: string | null;
          ligada_em: string | null;
          ligada_por: string | null;
          escopo_99: boolean;
          incluir_99: boolean;
          autorizacao_99_em: string | null;
          clientes_status: Status;
          pedidos_status: Status;
          erro: string | null;
        }[]
      ).map((x) => ({
        contaId: x.conta_id,
        contaNome: x.conta_nome,
        empresaNome: x.empresa_nome,
        ligadaEm: x.ligada_em ? new Date(x.ligada_em) : null,
        ligadaPor: x.ligada_por,
        escopo99: x.escopo_99,
        incluir99: x.incluir_99,
        autorizacao99Em: x.autorizacao_99_em ? new Date(x.autorizacao_99_em) : null,
        acao99: x.incluir_99 && !x.escopo_99 ? 'emitir' : !x.incluir_99 && x.escopo_99 ? 'retirar' : null,
        importando: x.clientes_status === 'carga' || x.pedidos_status === 'carga',
        clientesStatus: x.clientes_status,
        pedidosStatus: x.pedidos_status,
        erro: x.erro,
      }));
    });
  }

  // ------------------------------------------------------------ dono

  /**
   * O dono declara o consentimento e começa (ou recomeça) a leitura completa:
   * os clientes do começo do cursor; as vendas vêm quando os clientes
   * terminarem (elas se ligam aos contatos).
   */
  async iniciar(contaId: string, usuarioId: string, dados: { consentimento: boolean; evidencia?: string }): Promise<SituacaoRegem> {
    if (!dados.consentimento) {
      throw new BadRequestException(
        'Confirme que os clientes da sua empresa autorizaram receber mensagens da empresa. Sem esse aceite não importamos.',
      );
    }
    await this.ctx.comConta(contaId, async (db) => {
      // Travada: o clique duplo espera o primeiro e recebe "já está em andamento".
      const l = await this.linhaLigada(db, contaId, true);
      if (l.clientesStatus === 'carga') throw new BadRequestException('A importação já está em andamento.');

      const evidencia = dados.evidencia?.trim().slice(0, 500) || null;
      await db
        .update(integracaoRegem)
        .set({ consentimentoPor: usuarioId, consentimentoEm: new Date(), consentimentoEvidencia: evidencia })
        .where(eq(integracaoRegem.contaId, contaId));
      const importacaoId = await this.comecarLeitura(db, contaId, usuarioId, l.empresaNome, false);

      await this.auditoria.registrar({
        contaId,
        atorTipo: 'usuario',
        atorUsuarioId: usuarioId,
        acao: 'regem.importacao_iniciada',
        entidade: 'importacao',
        entidadeId: importacaoId,
        detalhe: { empresa: l.empresaNome, evidencia },
      });
    });
    return this.situacao(contaId);
  }

  /**
   * A 99Food, sob a responsabilidade do dono.
   *
   * Autorizar grava o texto aceito. Com o escopo da 99 já no token, relê tudo
   * do começo (os clientes e as vendas da 99 tinham ficado de fora); sem ele,
   * a distribuição emite outro token e a releitura sai quando ele for ligado.
   * Desfazer tira as compras da 99 e quem entrou na base só por ela.
   */
  async autorizar99(
    contaId: string,
    usuarioId: string,
    dados: { autorizar: boolean; declaracao?: boolean },
  ): Promise<SituacaoRegem> {
    if (dados.autorizar && dados.declaracao !== true) {
      throw new BadRequestException('Para trazer os clientes da 99, confirme a declaração de responsabilidade.');
    }
    await this.ctx.comConta(contaId, async (db) => {
      const l = await this.linhaLigada(db, contaId, true);

      if (dados.autorizar) {
        if (l.incluir99) return;
        const texto = textoDaAutorizacao99(l.empresaNome);
        await db
          .update(integracaoRegem)
          .set({ incluir99: true, autorizacao99Por: usuarioId, autorizacao99Em: new Date(), autorizacao99Texto: texto })
          .where(eq(integracaoRegem.contaId, contaId));
        const releitura = Boolean(l.consentimentoEm) && l.escopos.includes(ESCOPO_99);
        if (releitura) await this.comecarLeitura(db, contaId, usuarioId, l.empresaNome, true);
        await this.auditoria.registrar({
          contaId,
          atorTipo: 'usuario',
          atorUsuarioId: usuarioId,
          acao: 'regem.99_autorizado',
          entidade: 'integracao_regem',
          detalhe: { texto, escopoNoToken: l.escopos.includes(ESCOPO_99), releitura },
        });
        return;
      }

      if (!l.incluir99) return;
      await db
        .update(integracaoRegem)
        .set({ incluir99: false, autorizacao99Por: null, autorizacao99Em: null, autorizacao99Texto: null })
        .where(eq(integracaoRegem.contaId, contaId));
      const tirados = await tirarDados99(db, contaId);
      await this.auditoria.registrar({
        contaId,
        atorTipo: 'usuario',
        atorUsuarioId: usuarioId,
        acao: 'regem.99_desautorizado',
        entidade: 'integracao_regem',
        detalhe: tirados,
      });
    });
    return this.situacao(contaId);
  }

  /** Consultar agora: em dia, sai na próxima volta do job; parado por falha, retoma do ponto em que parou. */
  async atualizar(contaId: string): Promise<SituacaoRegem> {
    await this.ctx.comConta(contaId, async (db) => {
      const l = await this.linhaLigada(db, contaId);
      if (!l.consentimentoEm) throw new BadRequestException('Comece a importação primeiro.');
      await db
        .update(integracaoRegem)
        .set({
          ...RETOMAR_DA_FALHA,
          // A consulta das mudanças vence agora (sem apagar que a leitura completa já foi feita).
          clientesUltimaConsulta: sql`case when ${integracaoRegem.clientesUltimaConsulta} is null then null else now() - interval '1 day' end`,
          pedidosUltimaConsulta: sql`case when ${integracaoRegem.pedidosUltimaConsulta} is null then null else now() - interval '1 day' end`,
          clientesErro: null,
          pedidosErro: null,
          proximoEm: null,
        })
        .where(eq(integracaoRegem.contaId, contaId));
    });
    return this.situacao(contaId);
  }

  // ------------------------------------------------------------ o passo (job)

  /**
   * Um passo de uma conta: até 5 páginas de clientes e, com eles em dia, até 5
   * de vendas. Não lança: o erro vira o motivo na tela. A trava (`trava_ate`)
   * foi posta pelo job; sai no fim.
   */
  async passo(contaId: string): Promise<void> {
    const estado: { fase: Fase } = { fase: 'clientes' };
    try {
      const l = await this.linha(contaId);
      if (!l?.credencialCifrada || !l.consentimentoEm) return;
      const token = decifrarToken(l.credencialCifrada, this.chave());

      if (l.clientesStatus === 'carga' || (l.clientesStatus === 'em_dia' && vencida(l.clientesUltimaConsulta))) {
        await this.passoDeClientes(contaId, token, l, estado);
      }
      const depois = await this.linha(contaId);
      if (!depois?.credencialCifrada || depois.clientesStatus !== 'em_dia') return;
      if (depois.pedidosStatus === 'carga' || (depois.pedidosStatus === 'em_dia' && vencida(depois.pedidosUltimaConsulta))) {
        await this.passoDeVendas(contaId, token, depois, estado);
      }
    } catch (erro) {
      await this.registrarErro(contaId, erro, estado.fase);
    } finally {
      await this.ctx
        .comConta(contaId, (db) =>
          db.update(integracaoRegem).set({ travaAte: null }).where(eq(integracaoRegem.contaId, contaId)),
        )
        .catch((e: unknown) => this.log.error(`Não consegui soltar a trava do Regem da conta ${contaId}: ${String(e)}`));
    }
  }

  private async passoDeClientes(contaId: string, token: string, l: Linha, estado: { fase: Fase }): Promise<void> {
    estado.fase = 'clientes';
    let cursor = l.clientesCursor;
    for (let i = 0; i < PAGINAS_POR_PASSO; i++) {
      if (i > 0) await esperar(PAUSA_ENTRE_PAGINAS_MS);
      const pagina = await this.cliente.clientes(token, cursor);
      const terminou = !pagina.tem_mais;
      const feito = await this.ctx.comConta(contaId, async (db) => {
        const atual = await linhaTravada(db, contaId);
        // Recomeçaram, autorizaram a 99 ou desligaram no meio: este passo para.
        if (!atual || atual.clientesCursor !== cursor || !emAndamento(atual.clientesStatus)) return null;
        const c = await gravarClientes(db, contaId, atual, pagina.itens);
        const eraCarga = atual.clientesStatus === 'carga';
        await db
          .update(integracaoRegem)
          .set({
            clientesCursor: pagina.proximo_cursor,
            clientesLidos: sql`${integracaoRegem.clientesLidos} + ${pagina.itens.length}`,
            clientesNovos: sql`${integracaoRegem.clientesNovos} + ${c.novos}`,
            clientesBloqueados: sql`${integracaoRegem.clientesBloqueados} + ${c.bloqueados}`,
            clientesIgnorados: sql`${integracaoRegem.clientesIgnorados} + ${c.ignorados}`,
            clientesInvalidos: sql`${integracaoRegem.clientesInvalidos} + ${c.invalidos}`,
            clientesRemovidos: sql`${integracaoRegem.clientesRemovidos} + ${c.removidos}`,
            clientesErro: null,
            proximoEm: null,
            ...(terminou
              ? {
                  clientesStatus: 'em_dia',
                  clientesUltimaConsulta: new Date(),
                  // A carga dos clientes acabou: as vendas começam (do começo do cursor).
                  ...(eraCarga && atual.pedidosStatus === 'parado' ? { pedidosStatus: 'carga' } : {}),
                }
              : {}),
          })
          .where(eq(integracaoRegem.contaId, contaId));
        if (terminou && eraCarga && atual.importacaoId) {
          // O registro da importação fica com os totais, como o de arquivo.
          await db.execute(sql`
            update importacao i
               set total_lidos = s.clientes_lidos,
                   validos     = s.clientes_lidos - s.clientes_invalidos,
                   invalidos   = s.clientes_invalidos,
                   novos       = s.clientes_novos,
                   ja_existiam = greatest(s.clientes_lidos - s.clientes_invalidos - s.clientes_novos
                                          - s.clientes_bloqueados - s.clientes_ignorados - s.clientes_removidos, 0)
              from integracao_regem s
             where s.conta_id = ${contaId} and i.id = ${atual.importacaoId}
          `);
        }
        return { eraCarga, importacaoId: atual.importacaoId, empresa: atual.empresaNome };
      });
      if (!feito) return;
      cursor = pagina.proximo_cursor;
      if (terminou) {
        if (feito.eraCarga) {
          await this.auditoria.registrarForaDeContexto({
            contaId,
            atorTipo: 'sistema',
            acao: 'regem.clientes_importados',
            entidade: 'importacao',
            entidadeId: feito.importacaoId ?? undefined,
            detalhe: { empresa: feito.empresa },
          });
        }
        return;
      }
    }
  }

  private async passoDeVendas(contaId: string, token: string, l: Linha, estado: { fase: Fase }): Promise<void> {
    let cursor = l.pedidosCursor;
    let clientesRelidos = false;
    for (let i = 0; i < PAGINAS_POR_PASSO; i++) {
      if (i > 0) await esperar(PAUSA_ENTRE_PAGINAS_MS);
      estado.fase = 'pedidos';
      const pagina = await this.cliente.pedidos(token, cursor);
      // Venda de cliente que a leitura de clientes ainda não trouxe (ele entrou
      // no Regem depois dela): os clientes são lidos de novo ANTES de gravar a
      // página — senão a primeira compra dele se perderia. Uma vez por passo.
      if (!clientesRelidos && (await this.faltamClientes(contaId, pagina.itens))) {
        clientesRelidos = true;
        const agora = await this.linha(contaId);
        if (agora?.clientesStatus === 'em_dia') await this.passoDeClientes(contaId, token, agora, estado);
        estado.fase = 'pedidos';
      }
      const terminou = !pagina.tem_mais;
      const feito = await this.ctx.comConta(contaId, async (db) => {
        const atual = await linhaTravada(db, contaId);
        if (!atual || atual.pedidosCursor !== cursor || !emAndamento(atual.pedidosStatus)) return null;
        const r = await gravarVendas(db, contaId, atual, pagina.itens, await cardapioWebDireto(db, contaId));
        const eraCarga = atual.pedidosStatus === 'carga';
        await db
          .update(integracaoRegem)
          .set({
            pedidosCursor: pagina.proximo_cursor,
            pedidosLidos: sql`${integracaoRegem.pedidosLidos} + ${pagina.itens.length}`,
            pedidosGravados: sql`${integracaoRegem.pedidosGravados} + ${r.gravadas}`,
            pedidosIgnorados: sql`${integracaoRegem.pedidosIgnorados} + ${r.ignoradas}`,
            pedidosErro: null,
            proximoEm: null,
            ...(terminou ? { pedidosStatus: 'em_dia', pedidosUltimaConsulta: new Date() } : {}),
          })
          .where(eq(integracaoRegem.contaId, contaId));
        return { eraCarga, empresa: atual.empresaNome };
      });
      if (!feito) return;
      cursor = pagina.proximo_cursor;
      if (terminou) {
        if (feito.eraCarga) {
          await this.auditoria.registrarForaDeContexto({
            contaId,
            atorTipo: 'sistema',
            acao: 'regem.vendas_importadas',
            entidade: 'integracao_regem',
            detalhe: { empresa: feito.empresa },
          });
        }
        return;
      }
    }
  }

  /** Alguma venda da página que viraria compra é de um telefone que ainda não está na base? */
  private async faltamClientes(contaId: string, vendas: readonly VendaRegem[]): Promise<boolean> {
    return this.ctx.comConta(contaId, async (db) => {
      const [l] = await db.select().from(integracaoRegem).where(eq(integracaoRegem.contaId, contaId)).limit(1);
      if (!l) return false;
      const cw = await cardapioWebDireto(db, contaId);
      const telefones = vendas
        .map((v) => compraDaVenda(v, { incluir99: l.incluir99, cardapioWebDireto: cw }))
        .filter((d): d is CompraDoRegem => 'idExterno' in d)
        .map((c) => c.telefone);
      if (!telefones.length) return false;
      const mapa = await contatosPorTelefone(db, contaId, telefones);
      return telefones.some((t) => !acharContato(mapa, t));
    });
  }

  // ------------------------------------------------------------ apoio

  private chave(): string {
    if (!env.integracoes.chave) {
      throw new ServiceUnavailableException('A conexão com o Regem ainda não está disponível: falta configurar INTEGRACOES_CHAVE no servidor.');
    }
    return env.integracoes.chave;
  }

  private async linha(contaId: string): Promise<Linha | null> {
    return this.ctx.comConta(contaId, async (db) => {
      const [x] = await db.select().from(integracaoRegem).where(eq(integracaoRegem.contaId, contaId)).limit(1);
      return x ?? null;
    });
  }

  private async linhaLigada(db: Db, contaId: string, travar = false): Promise<Linha> {
    const consulta = db.select().from(integracaoRegem).where(eq(integracaoRegem.contaId, contaId)).limit(1);
    const [l] = travar ? await consulta.for('update') : await consulta;
    if (!l?.credencialCifrada) {
      throw new BadRequestException('A conta ainda não está ligada ao Regem. Fale com o suporte do RegemCast.');
    }
    return l;
  }

  /**
   * Uma leitura completa, do começo dos dois cursores: um registro novo em
   * `importacao` (quantos, quando, quem), a lista "Clientes Regem" (a mesma de
   * antes, se ainda existir) e os contadores do zero.
   */
  private async comecarLeitura(
    db: Db,
    contaId: string,
    criadoPor: string | null,
    empresa: string | null,
    com99: boolean,
  ): Promise<string> {
    const [l] = await db.select().from(integracaoRegem).where(eq(integracaoRegem.contaId, contaId)).limit(1);
    let listaId = l?.listaId ?? null;
    if (listaId) {
      const [existe] = await db
        .select({ id: contatoLista.id })
        .from(contatoLista)
        .where(and(eq(contatoLista.contaId, contaId), eq(contatoLista.id, listaId)))
        .limit(1);
      if (!existe) listaId = null;
    }
    if (!listaId) {
      const [nova] = await db
        .insert(contatoLista)
        .values({ contaId, nome: NOME_LISTA, descricao: `Clientes da empresa ${empresa ?? ''} no Regem.`.replace(/\s+/g, ' ') })
        .returning({ id: contatoLista.id });
      listaId = nova!.id;
    }
    const [registro] = await db
      .insert(importacao)
      .values({
        contaId,
        formato: 'regem',
        arquivoNome: `Regem — ${empresa ?? 'empresa'}${com99 ? ' (com a 99Food)' : ''}`,
        listaId,
        criadoPor,
      })
      .returning({ id: importacao.id });
    await db
      .update(integracaoRegem)
      .set({ ...LEITURA_DO_ZERO, listaId, importacaoId: registro!.id })
      .where(eq(integracaoRegem.contaId, contaId));
    return registro!.id;
  }

  /**
   * Erro passageiro do Regem (limite, fora do ar): tenta de novo mais tarde, do
   * mesmo ponto. Recusa: para a fase, com o motivo na tela (repetir não
   * conserta — V15); token recusado (401) para as duas. Erro nosso: registra e
   * tenta em 5 min.
   */
  private async registrarErro(contaId: string, erro: unknown, fase: Fase): Promise<void> {
    const doRegem = erro instanceof ErroRegem;
    const motivo = doRegem
      ? erro.message
      : 'A sincronização com o Regem parou por um erro nosso. Tentamos de novo em alguns minutos.';
    const espera = doRegem ? (erro.passageiro ? (erro.esperarSeg ?? 120) : null) : 300;
    const conexaoRecusada = doRegem && erro.status === 401;
    if (doRegem) this.log.warn(`Regem: conta ${contaId} (${fase}): ${motivo}`);
    else this.log.error(`Regem: conta ${contaId} (${fase}) falhou: ${String(erro)}`, (erro as Error)?.stack);

    const nosClientes = fase === 'clientes' || conexaoRecusada;
    const nasVendas = fase === 'pedidos' || conexaoRecusada;
    const parar = espera === null;
    await this.ctx
      .comConta(contaId, (db) =>
        db
          .update(integracaoRegem)
          .set({
            proximoEm: parar ? null : new Date(Date.now() + espera * 1000),
            ...(nosClientes ? { clientesErro: motivo } : {}),
            ...(nasVendas ? { pedidosErro: motivo } : {}),
            ...(parar && nosClientes
              ? { clientesStatus: sql`case when ${integracaoRegem.clientesStatus} in ('carga','em_dia') then 'falhou' else ${integracaoRegem.clientesStatus} end` }
              : {}),
            ...(parar && nasVendas
              ? { pedidosStatus: sql`case when ${integracaoRegem.pedidosStatus} in ('carga','em_dia') then 'falhou' else ${integracaoRegem.pedidosStatus} end` }
              : {}),
          })
          .where(eq(integracaoRegem.contaId, contaId)),
      )
      .catch((e: unknown) => this.log.error(`Não consegui registrar o erro do Regem da conta ${contaId}: ${String(e)}`));
  }
}

/** Os dois cursores do começo e os contadores do zero: os clientes começam; as vendas, depois deles. */
const LEITURA_DO_ZERO = {
  clientesStatus: 'carga',
  clientesCursor: null,
  clientesLidos: 0,
  clientesNovos: 0,
  clientesBloqueados: 0,
  clientesIgnorados: 0,
  clientesInvalidos: 0,
  clientesRemovidos: 0,
  clientesUltimaConsulta: null,
  clientesErro: null,
  pedidosStatus: 'parado',
  pedidosCursor: null,
  pedidosLidos: 0,
  pedidosGravados: 0,
  pedidosIgnorados: 0,
  pedidosUltimaConsulta: null,
  pedidosErro: null,
  proximoEm: null,
} as const;

/**
 * Quem parou por falha volta de onde parou: se a leitura completa ainda não
 * tinha terminado (nunca houve consulta), continua a carga; senão, em dia.
 */
const RETOMAR_DA_FALHA = {
  clientesStatus: sql`case when ${integracaoRegem.clientesStatus} <> 'falhou' then ${integracaoRegem.clientesStatus}
    when ${integracaoRegem.clientesUltimaConsulta} is null then 'carga' else 'em_dia' end`,
  pedidosStatus: sql`case when ${integracaoRegem.pedidosStatus} <> 'falhou' then ${integracaoRegem.pedidosStatus}
    when ${integracaoRegem.pedidosUltimaConsulta} is null then 'carga' else 'em_dia' end`,
};

/**
 * A gratuidade do Regem acabou (a integração foi desligada).
 *
 * - Quem tem plano pago segue como está.
 * - Quem ainda está no grátis de entrada (ou é conta sem prazo) segue nele.
 * - Os demais ganham a carência: o grátis termina AGORA — os disparos param em
 *   `CARENCIA_DIAS`, com o aviso por e-mail (a marca faz a frase certa sair).
 * - Cobrança recusada de quem tem assinatura no Mercado Pago: a carência
 *   volta a contar de hoje.
 */
async function encerrarGratuidade(
  db: Db,
  contaId: string,
): Promise<'sem_assinatura' | 'plano_pago' | 'gratis_de_entrada' | 'carencia'> {
  const [a] = (
    await db.execute(sql`
      select status, mp_status, gratis_ate is null as sem_prazo, coalesce(gratis_ate > now(), false) as no_gratis
        from assinatura where conta_id = ${contaId} for update
    `)
  ).rows as { status: string; mp_status: string | null; sem_prazo: boolean; no_gratis: boolean }[];
  if (!a) return 'sem_assinatura';
  if (a.status === 'ativa') return 'plano_pago';
  if (a.status === 'cortesia' && (a.sem_prazo || a.no_gratis)) return 'gratis_de_entrada';
  if (a.status === 'inadimplente' && a.mp_status === 'authorized') {
    await db.execute(sql`update assinatura set inadimplente_desde = now() where conta_id = ${contaId}`);
    return 'carencia';
  }
  await db.execute(sql`
    update assinatura
       set status = 'cortesia', gratis_ate = now(), inadimplente_desde = null,
           avisos_enviados = array[${MARCA_REGEM_DESLIGADO}]::text[]
     where conta_id = ${contaId}
  `);
  return 'carencia';
}

/** Em dia, a consulta das mudanças sai a cada 30 min. */
function vencida(ultima: Date | null): boolean {
  return !ultima || Date.now() - ultima.getTime() >= MINUTOS_ENTRE_CONSULTAS * 60_000;
}

const emAndamento = (status: string) => status === 'carga' || status === 'em_dia';

async function linhaTravada(db: Db, contaId: string): Promise<Linha | null> {
  const [x] = await db
    .select()
    .from(integracaoRegem)
    .where(eq(integracaoRegem.contaId, contaId))
    .limit(1)
    .for('update');
  return x?.credencialCifrada ? x : null;
}

async function cardapioWebDireto(db: Db, contaId: string): Promise<boolean> {
  const [cw] = await db
    .select({ id: integracaoCardapioweb.id })
    .from(integracaoCardapioweb)
    .where(and(eq(integracaoCardapioweb.contaId, contaId), sql`${integracaoCardapioweb.credencialCifrada} is not null`))
    .limit(1);
  return Boolean(cw);
}

/** O contato nasceu de uma leitura do Regem (qualquer uma desta conta). */
function criadoPeloRegem(contaId: string, coluna: SQL): SQL {
  return sql`${coluna} in (select id from importacao where conta_id = ${contaId} and formato = 'regem')`;
}

// ------------------------------------------------------------ banco (dentro da transação da conta)

/**
 * Uma página de clientes: quem pediu para sair entra bloqueado; quem pode
 * receber entra na base (nunca sobrescreve o que já estava) e na lista; quem
 * foi esquecido no Regem é anonimizado. Cada cliente fica ligado ao contato.
 */
async function gravarClientes(
  db: Db,
  contaId: string,
  l: Linha,
  clientes: readonly ClienteRegem[],
): Promise<{ novos: number; bloqueados: number; ignorados: number; invalidos: number; removidos: number }> {
  const agora = new Date();
  const decisoes: DecisaoDoCliente[] = clientes.map((c) => decidirCliente(c, { incluir99: l.incluir99 }));
  const contatos = decisoes.filter((d): d is Extract<DecisaoDoCliente, { tipo: 'contato' }> => d.tipo === 'contato');
  const bloqueados = decisoes.filter((d): d is Extract<DecisaoDoCliente, { tipo: 'bloqueado' }> => d.tipo === 'bloqueado');
  const removidos = decisoes.filter((d) => d.tipo === 'removido').map((d) => d.regemId);

  // A base pode ter a pessoa na outra forma do celular (com ou sem o 9): ela é
  // a mesma — não nasce um segundo contato, e o bloqueio cai no que existe.
  const telefones = [...contatos, ...bloqueados].map((d) => d.telefone);
  const antes = await contatosPorTelefone(db, contaId, telefones);
  const aCriar = [...new Map(contatos.filter((c) => !acharContato(antes, c.telefone)).map((c) => [c.telefone, c])).values()];

  let novos = 0;
  if (aCriar.length) {
    const hoje = agora.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const empresa = l.empresaNome ?? 'empresa';
    const dia = (d: Date) => d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    for (const parte of emPartes(aCriar, 500)) {
      const r = await db.execute(sql`
        insert into contato (conta_id, telefone_e164, nome, consentimento_origem, consentimento_em, consentimento_evidencia, importacao_id)
        values ${sql.join(
          parte.map((c) => {
            const evidencia = c.aceite
              ? `Aceitou receber promoções da empresa "${empresa}" no Regem` +
                (c.aceite.origem ? ` (${c.aceite.origem})` : '') +
                (c.aceite.em ? ` em ${dia(c.aceite.em)}` : '') +
                (c.aceite.texto ? `: “${c.aceite.texto}”` : '') +
                `. Importado em ${hoje}.`
              : c.so99
                ? `Cliente da empresa "${empresa}" que comprou pela 99Food, trazido do Regem em ${hoje} com a autorização do dono da conta, sob a responsabilidade da empresa.`
                : `Cliente da empresa "${empresa}" no Regem (${c.canais.join(', ') || 'canal próprio'}). Importado em ${hoje} com a declaração de consentimento do dono da conta.`;
            return sql`(${contaId}, ${c.telefone}, ${c.nome}, 'api', ${c.aceite?.em ?? agora}, ${evidencia}, ${l.importacaoId})`;
          }),
          sql`, `,
        )}
        on conflict (conta_id, telefone_e164) do nothing
        returning id
      `);
      novos += r.rowCount ?? 0;
    }
  }

  // Pediu para sair no Regem (ou recusou o aceite): entra, ou passa a estar,
  // descadastrado — na forma do celular que já está na base. Um descadastro
  // que já existia não é tocado.
  if (bloqueados.length) {
    await bloquearContatos(
      db,
      contaId,
      bloqueados.map((b) => ({ telefone: acharContato(antes, b.telefone)?.telefone ?? b.telefone, nome: b.nome })),
      l.importacaoId,
      agora,
      'regem',
    );
  }

  const ligaveis = [...contatos, ...bloqueados];
  if (ligaveis.length) {
    const mapa = await contatosPorTelefone(db, contaId, telefones);
    const linhas = [...new Map(ligaveis.map((d) => [d.regemId, { d, k: acharContato(mapa, d.telefone) }])).values()];

    // Na lista entram todos os que podem receber — inclusive os que já estavam
    // na base —, menos quem está descadastrado aqui (em qualquer forma do celular).
    const naLista = [...new Set(linhas.filter((x) => x.d.tipo === 'contato' && x.k && !x.k.optOut).map((x) => x.k!.id))];
    if (l.listaId && naLista.length) {
      for (const parte of emPartes(naLista, 500)) {
        await db.execute(sql`
          insert into contato_lista_item (conta_id, lista_id, contato_id)
          select ${contaId}, ${l.listaId}, id from unnest(array[${sql.join(parte.map((id) => sql`${id}::uuid`), sql`, `)}]) as id
          on conflict do nothing
        `);
      }
    }

    // Cada cliente do Regem ligado ao contato. É por essa ligação que a lápide
    // acha quem anonimizar e que desfazer a 99 acha quem entrou só por ela.
    const ids = [...new Set(linhas.map((x) => x.k?.id).filter((x): x is string => Boolean(x)))];
    const doRegem = new Set<string>();
    for (const parte of emPartes(ids, 500)) {
      const r = await db.execute(sql`
        select id from contato
         where conta_id = ${contaId} and id in (${sql.join(parte.map((id) => sql`${id}::uuid`), sql`, `)})
           and ${criadoPeloRegem(contaId, sql`importacao_id`)}
      `);
      for (const x of r.rows as { id: string }[]) doRegem.add(x.id);
    }
    for (const parte of emPartes(linhas, 500)) {
      await db.execute(sql`
        insert into integracao_regem_cliente (conta_id, regem_id, contato_id, telefone_e164, canais, so_99, atualizado_em)
        values ${sql.join(
          parte.map(({ d, k }) => {
            const so99 = d.tipo === 'contato' && d.so99 && Boolean(k && doRegem.has(k.id));
            return sql`(${contaId}, ${d.regemId}, ${k?.id ?? null}, ${d.telefone},
                        array(select jsonb_array_elements_text(${JSON.stringify(d.canais)}::jsonb)), ${so99}, now())`;
          }),
          sql`, `,
        )}
        on conflict (conta_id, regem_id) do update
           set contato_id = excluded.contato_id,
               telefone_e164 = excluded.telefone_e164,
               canais = excluded.canais,
               -- Só-99 é de nascença: quem passou a comprar por canal próprio deixa de ser.
               so_99 = integracao_regem_cliente.so_99 and excluded.so_99,
               atualizado_em = now()
      `);
    }
  }

  if (removidos.length) await esquecer(db, contaId, removidos, agora);

  return {
    novos,
    bloqueados: bloqueados.length,
    ignorados: decisoes.filter((d) => d.tipo === 'ignorado').length,
    invalidos: decisoes.filter((d) => d.tipo === 'invalido').length,
    removidos: removidos.length,
  };
}

/**
 * A lápide do Regem: a pessoa pediu à empresa para ser esquecida. Aqui é o
 * mesmo pedido de exclusão da tela do contato — os dados pessoais e as compras
 * somem, o número fica bloqueado para ela não voltar numa importação.
 *
 * Se o mesmo contato ainda está ligado a OUTRO cliente vivo do Regem (cadastro
 * duplicado que a loja apagou lá), a pessoa não pediu nada: só a ligação do
 * cliente apagado sai.
 */
async function esquecer(db: Db, contaId: string, regemIds: string[], agora: Date): Promise<void> {
  for (const parte of emPartes(regemIds, 500)) {
    const r = await db.execute(sql`
      delete from integracao_regem_cliente
       where conta_id = ${contaId} and regem_id in (${sql.join(parte.map((id) => sql`${id}`), sql`, `)})
      returning contato_id
    `);
    const ligados = [...new Set((r.rows as { contato_id: string | null }[]).map((x) => x.contato_id).filter((x): x is string => Boolean(x)))];
    if (!ligados.length) continue;
    const vivos = await db.execute(sql`
      select distinct contato_id from integracao_regem_cliente
       where conta_id = ${contaId} and contato_id in (${sql.join(ligados.map((id) => sql`${id}::uuid`), sql`, `)})
    `);
    const aindaLigados = new Set((vivos.rows as { contato_id: string }[]).map((x) => x.contato_id));
    const contatos = ligados.filter((id) => !aindaLigados.has(id));
    if (!contatos.length) continue;
    const quando = agora.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    await anonimizarContatos(
      db,
      contaId,
      contatos,
      `Dados pessoais apagados em ${quando}: a pessoa pediu à empresa, pelo Regem, para ser esquecida. Número mantido bloqueado.`,
    );
  }
}

/**
 * A autorização da 99 foi desfeita: saem as compras da 99 e os contatos que
 * entraram só por ela (nascidos de uma leitura do Regem, sem compra de outra
 * fonte e sem descadastro — o descadastro fica, para o número não voltar).
 */
async function tirarDados99(db: Db, contaId: string): Promise<{ compras: number; contatos: number }> {
  const c = await db.execute(sql`
    delete from compra where conta_id = ${contaId} and fonte = 'regem' and canal = ${CANAL_99}
    returning contato_id
  `);
  const k = await db.execute(sql`
    delete from contato ct
     using integracao_regem_cliente m
     where m.conta_id = ${contaId} and m.so_99 and m.contato_id = ct.id
       and ct.conta_id = ${contaId} and ct.opt_out = false
       and ${criadoPeloRegem(contaId, sql`ct.importacao_id`)}
       and not exists (select 1 from compra x where x.contato_id = ct.id)
    returning ct.id
  `);
  await db.execute(sql`delete from integracao_regem_cliente where conta_id = ${contaId} and so_99`);
  const apagados = new Set((k.rows as { id: string }[]).map((x) => x.id));
  const tocados = [...new Set((c.rows as { contato_id: string }[]).map((x) => x.contato_id))].filter((id) => !apagados.has(id));
  if (tocados.length) await recalcularTotais(db, contaId, tocados, 'regem');
  return { compras: c.rowCount ?? 0, contatos: k.rowCount ?? 0 };
}

/**
 * Uma página de vendas: confirmada vira compra (do contato do telefone, se ele
 * pode receber); cancelada ou removida desfaz a compra. Os totais dos contatos
 * tocados são refeitos no fim.
 */
async function gravarVendas(
  db: Db,
  contaId: string,
  l: Linha,
  vendas: readonly VendaRegem[],
  cardapioWebDireto: boolean,
): Promise<{ gravadas: number; ignoradas: number }> {
  const decisoes = vendas.map((v) => compraDaVenda(v, { incluir99: l.incluir99, cardapioWebDireto }));
  const desfazer = decisoes.filter((d): d is { desfazer: string } => 'desfazer' in d).map((d) => d.desfazer);
  const compras = decisoes.filter((d): d is CompraDoRegem => 'idExterno' in d);
  let ignoradas = decisoes.filter((d) => 'ignorado' in d).length;

  const tocados = new Set<string>();
  for (const parte of emPartes(desfazer, 500)) {
    const r = await db.execute(sql`
      delete from compra
       where conta_id = ${contaId} and fonte = 'regem'
         and id_externo in (${sql.join(parte.map((id) => sql`${id}`), sql`, `)})
      returning contato_id
    `);
    for (const x of r.rows as { contato_id: string }[]) tocados.add(x.contato_id);
  }

  let gravadas = 0;
  if (compras.length) {
    const mapa = await contatosPorTelefone(db, contaId, compras.map((c) => c.telefone));
    const linhas: { compra: CompraDoRegem; contatoId: string }[] = [];
    for (const c of compras) {
      const k = acharContato(mapa, c.telefone);
      // Fora da base, ou descadastrado aqui: a compra não é guardada.
      if (k && !k.optOut) linhas.push({ compra: c, contatoId: k.id });
      else ignoradas++;
    }
    const r = await gravarCompras(db, contaId, 'regem', linhas);
    gravadas = r.novas;
    for (const id of r.afetados) tocados.add(id);
  }
  if (tocados.size) await recalcularTotais(db, contaId, [...tocados], 'regem');
  return { gravadas, ignoradas };
}
