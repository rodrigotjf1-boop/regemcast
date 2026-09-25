/**
 * Públicos prontos a partir das compras: VIP, faixas de ticket, "um pedido
 * só", "rumo ao 10º pedido", como compra (entrega, retirada, salão), bairro e
 * aniversariantes do mês.
 *
 * Como os perfis, são CALCULADOS na consulta — nada disso é gravado por
 * contato, a não ser o bairro e o jeito de comprar (migration 030), que saem
 * de todas as compras e são refeitos a cada sincronização.
 *
 * VIP e faixas de ticket são RELATIVOS à loja: os 10% que mais gastam, e os
 * terços do ticket médio. Uma pizzaria e uma loja de açaí têm tickets
 * diferentes, e um corte fixo em reais serviria para uma e não para a outra.
 * Os limites são arredondados para reais inteiros, para a regra mostrada na
 * tela ser exatamente a que filtra.
 *
 * `expressaoPublico` é a ÚNICA definição de cada público: a contagem, o filtro
 * da tabela, a lista e os blocos usam a mesma — o número da tela é o número
 * da lista.
 */
import { sql, type SQL } from 'drizzle-orm';

import { gemeoEmSql } from '../../common/telefone-sql';

export const PUBLICOS = [
  'vip',
  'ticket_alto',
  'ticket_medio',
  'ticket_baixo',
  'um_pedido',
  'marco_10',
  'entrega',
  'retirada',
  'salao',
  'leram_30d',
  'responderam_30d',
  'nao_leram_3',
  'nunca_receberam',
  'conversaram_7d',
  'bairro',
  'aniversario',
] as const;
export type Publico = (typeof PUBLICOS)[number];

/** Os fixos (sem valor), na ordem da tela. */
export const PUBLICOS_FIXOS = PUBLICOS.filter((p) => p !== 'bairro' && p !== 'aniversario') as Exclude<
  Publico,
  'bairro' | 'aniversario'
>[];

/** Os 10% que mais gastam. */
export const FRACAO_VIP = 0.1;
/** O pedido que é marco: quem tem um a menos está "rumo" a ele. */
export const PEDIDO_MARCO = 10;
/** Bairro com mais de 80 letras não é bairro. */
export const TAMANHO_MAXIMO_BAIRRO = 80;

export interface LimitesDosPublicos {
  /** Total gasto a partir do qual o contato é VIP. `null` = ninguém tem valor. */
  vipCentavos: number | null;
  /** Ticket médio até aqui é "baixo" (o terço de baixo). */
  ticketBaixoAteCentavos: number | null;
  /** Ticket médio acima daqui é "alto" (o terço de cima). */
  ticketAltoAcimaCentavos: number | null;
  /** "Um pedido só": comprou nos últimos N dias — o "ativo" dos perfis. */
  ativoDias: number;
}

/** As duas formas do celular do contato — as campanhas e conversas podem estar em qualquer uma. */
const FORMAS_DO_CONTATO = sql`(contato.telefone_e164, ${gemeoEmSql(sql`contato.telefone_e164`)})`;

/** Alguma mensagem de campanha para este contato que atenda à condição (em `d`). */
const recebeu = (condicao: SQL) => sql`exists (
  select 1 from campanha_destinatario d
   where d.conta_id = contato.conta_id
     and d.telefone_e164 in ${FORMAS_DO_CONTATO}
     and ${condicao}
)`;

/** Ticket médio do contato, em centavos (numeric). */
export const TICKET_SQL = sql`(contato.total_gasto_centavos::numeric / nullif(contato.pedidos, 0))`;

/** Arredonda um limite em centavos para reais inteiros. */
export function emReais(centavos: number | null, modo: 'baixo' | 'perto'): number | null {
  if (centavos == null || !Number.isFinite(centavos)) return null;
  const reais = modo === 'baixo' ? Math.floor(centavos / 100) : Math.round(centavos / 100);
  return Math.max(0, reais) * 100;
}

/**
 * O público como condição sobre a tabela `contato` (sem alias, como a dos
 * perfis). Sem o limite de que depende (ninguém com valor gasto), é `false`.
 * `valor` já validado por `validarPublico`.
 */
export function expressaoPublico(publico: Publico, valor: string | null, l: LimitesDosPublicos): SQL {
  switch (publico) {
    case 'vip':
      return l.vipCentavos == null
        ? sql`false`
        : sql`(contato.total_gasto_centavos > 0 and contato.total_gasto_centavos >= ${l.vipCentavos})`;
    case 'ticket_baixo':
      return l.ticketBaixoAteCentavos == null
        ? sql`false`
        : sql`(${TICKET_SQL} > 0 and ${TICKET_SQL} <= ${l.ticketBaixoAteCentavos})`;
    case 'ticket_medio':
      return l.ticketBaixoAteCentavos == null || l.ticketAltoAcimaCentavos == null
        ? sql`false`
        : sql`(${TICKET_SQL} > ${l.ticketBaixoAteCentavos} and ${TICKET_SQL} <= ${l.ticketAltoAcimaCentavos})`;
    case 'ticket_alto':
      return l.ticketAltoAcimaCentavos == null ? sql`false` : sql`(${TICKET_SQL} > ${l.ticketAltoAcimaCentavos})`;
    case 'um_pedido':
      return sql`(contato.pedidos = 1 and contato.ultimo_pedido_em >= now() - make_interval(days => ${l.ativoDias}))`;
    case 'marco_10':
      return sql`(contato.pedidos = ${PEDIDO_MARCO - 1})`;
    case 'entrega':
    case 'retirada':
    case 'salao':
      return sql`(contato.tipo_preferido = ${publico})`;
    case 'leram_30d':
      return recebeu(sql`d.lida_em >= now() - interval '30 days'`);
    case 'responderam_30d':
      return recebeu(sql`d.respondida_em >= now() - interval '30 days'`);
    case 'nunca_receberam':
      return sql`not ${recebeu(sql`d.enviada_em is not null`)}`;
    case 'nao_leram_3':
      // As 3 últimas que chegaram (enviada, entregue, lida): três, e nenhuma lida.
      return sql`(
        select count(*) = 3 and count(u.lida_em) = 0
          from (
            select d.lida_em from campanha_destinatario d
             where d.conta_id = contato.conta_id
               and d.telefone_e164 in ${FORMAS_DO_CONTATO}
               and d.status in ('enviada', 'entregue', 'lida')
             order by d.enviada_em desc
             limit 3
          ) u
      )`;
    case 'conversaram_7d':
      return sql`exists (
        select 1 from conversa v
         where v.conta_id = contato.conta_id
           and v.telefone_e164 in ${FORMAS_DO_CONTATO}
           and v.ultima_entrada_em >= now() - interval '7 days'
      )`;
    case 'bairro':
      return sql`(lower(contato.bairro) = lower(${valor}))`;
    case 'aniversario':
      return sql`(extract(month from contato.data_nascimento) = ${Number(valor)})`;
  }
}

export const MESES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
] as const;

/** Confere o público e o valor que ele pede. Devolve o motivo da recusa, ou o par normalizado. */
export function validarPublico(
  publico: string | undefined,
  valor: string | null | undefined,
): { publico: Publico; valor: string | null } | { erro: string } {
  if (!publico || !(PUBLICOS as readonly string[]).includes(publico)) return { erro: 'Público desconhecido.' };
  const p = publico as Publico;
  if (p === 'bairro') {
    const b = (valor ?? '').replace(/\s+/g, ' ').trim();
    if (!b || b.length > TAMANHO_MAXIMO_BAIRRO) return { erro: 'Escolha o bairro.' };
    return { publico: p, valor: b };
  }
  if (p === 'aniversario') {
    const m = Number(valor);
    if (!Number.isInteger(m) || m < 1 || m > 12) return { erro: 'Escolha o mês do aniversário.' };
    return { publico: p, valor: String(m) };
  }
  return { publico: p, valor: null };
}

const reais = (centavos: number) =>
  (centavos / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });

/** O nome do público e a regra em português, com os números da loja — a tela mostra isto. */
export function descreverPublico(publico: Publico, valor: string | null, l: LimitesDosPublicos): { nome: string; regra: string } {
  switch (publico) {
    case 'vip':
      return {
        nome: 'VIP',
        regra:
          l.vipCentavos == null
            ? 'Os 10% que mais gastam. Aparece quando houver valor gasto na base.'
            : `Os 10% que mais gastam: ${reais(l.vipCentavos)} ou mais no total.`,
      };
    case 'ticket_alto':
      return {
        nome: 'Ticket alto',
        regra:
          l.ticketAltoAcimaCentavos == null
            ? 'O terço que gasta mais por pedido.'
            : `Gastam, em média, mais de ${reais(l.ticketAltoAcimaCentavos)} por pedido.`,
      };
    case 'ticket_medio':
      return {
        nome: 'Ticket médio',
        regra:
          l.ticketBaixoAteCentavos == null || l.ticketAltoAcimaCentavos == null
            ? 'O terço do meio, no gasto por pedido.'
            : l.ticketAltoAcimaCentavos <= l.ticketBaixoAteCentavos
              ? 'Sem faixa do meio: os tickets da loja são muito parecidos.'
              : `Mais de ${reais(l.ticketBaixoAteCentavos)} e até ${reais(l.ticketAltoAcimaCentavos)} por pedido, em média.`,
      };
    case 'ticket_baixo':
      return {
        nome: 'Ticket baixo',
        regra:
          l.ticketBaixoAteCentavos == null
            ? 'O terço que gasta menos por pedido.'
            : `Até ${reais(l.ticketBaixoAteCentavos)} por pedido, em média.`,
      };
    case 'um_pedido':
      return { nome: 'Um pedido só', regra: `Compraram uma vez nos últimos ${l.ativoDias} dias: chame para o segundo.` };
    case 'marco_10':
      return { nome: `Rumo ao ${PEDIDO_MARCO}º pedido`, regra: `Têm ${PEDIDO_MARCO - 1} pedidos: o próximo é o ${PEDIDO_MARCO}º.` };
    case 'entrega':
      return { nome: 'Pedem entrega', regra: 'A maior parte das compras foi com entrega.' };
    case 'retirada':
      return { nome: 'Retiram na loja', regra: 'A maior parte das compras foi retirada no balcão.' };
    case 'salao':
      return { nome: 'Consomem no salão', regra: 'A maior parte das compras foi no salão ou na mesa.' };
    case 'leram_30d':
      return { nome: 'Leram nos últimos 30 dias', regra: 'Leram pelo menos uma campanha nos últimos 30 dias.' };
    case 'responderam_30d':
      return { nome: 'Responderam', regra: 'Responderam a uma campanha nos últimos 30 dias.' };
    case 'nao_leram_3':
      return {
        nome: 'Não leram as últimas 3',
        regra: 'Receberam as 3 últimas campanhas e não leram nenhuma: dê um tempo ou mude a oferta.',
      };
    case 'nunca_receberam':
      return { nome: 'Nunca receberam campanha', regra: 'Ainda não receberam nenhuma campanha da sua loja.' };
    case 'conversaram_7d':
      return { nome: 'Conversaram na última semana', regra: 'Mandaram mensagem para a loja nos últimos 7 dias.' };
    case 'bairro':
      return { nome: `Bairro ${valor ?? ''}`.trim(), regra: 'O bairro mais frequente nas entregas.' };
    case 'aniversario': {
      const mes = MESES[Number(valor) - 1] ?? '';
      return { nome: `Aniversariantes de ${mes}`, regra: `Fazem aniversário em ${mes}.` };
    }
  }
}
