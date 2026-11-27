/**
 * O público montado com regras (migration 053) — como o "Escolher clientes" do
 * Cardápio Web: cada regra é campo + comparação + valor, e o contato precisa
 * cumprir TODAS. Até 10.
 *
 * Uma definição só: a prévia, a montagem da campanha e os públicos salvos usam
 * `expressaoDasRegras`, então o número que a tela mostra é o que a campanha
 * envia. Os campos são uma lista FIXA (`CAMPOS`): o que vem da tela só escolhe
 * um item dela e o valor vai como parâmetro — nenhum nome de coluna, apelido
 * ou operador sai de texto de fora (a regra da GHSA-gpj5-g38j-94v9).
 *
 * Datas e "dias desde" são do CALENDÁRIO, no fuso da conta: quem comprou ontem
 * comprou há 1 dia. "Não é igual a" (e "não é", nas listas) inclui quem não
 * tem o dado; as outras comparações, não — quem nunca comprou não entra em
 * "dias desde o último pedido > 45". A exceção é a última campanha: quem nunca
 * recebeu conta como há muito tempo.
 */
import { sql, type SQL } from 'drizzle-orm';

import { ESTADOS, dddsDaUf } from '../../common/ddd';
import { gemeoEmSql } from '../../common/telefone-sql';
import { cashbackValido } from './cashback';
import { PERIODOS } from './habitos';
import { TAMANHO_MAXIMO_BAIRRO, TAMANHO_MAXIMO_PRODUTO } from './publicos';
import {
  PARAMETROS_PADRAO,
  SEGMENTOS,
  descreverSegmentos,
  expressaoSegmento,
  type ParametrosSegmentacao,
} from './segmentacao';

export const MAX_REGRAS = 10;

export const COMPARACOES = ['=', '!=', '>', '<', '>=', '<='] as const;
export type Comparacao = (typeof COMPARACOES)[number];

export type TipoDoCampo = 'numero' | 'reais' | 'dias' | 'data' | 'lista';

/** Quem nunca recebeu campanha conta como há muito tempo: 100 mil dias. */
export const DIAS_DE_QUEM_NUNCA_RECEBEU = 100_000;

export interface Opcao {
  valor: string;
  nome: string;
}

export interface DefinicaoDoCampo {
  id: string;
  nome: string;
  grupo: string;
  tipo: TipoDoCampo;
  /** Lista fechada: só estes valores. */
  opcoes?: Opcao[];
  /** Lista que a tela carrega da base (bairros, produtos): texto livre, conferido só no tamanho. */
  opcoesDe?: 'bairros' | 'produtos';
  ajuda?: string;
}

const NOMES_DOS_PERFIS = descreverSegmentos(PARAMETROS_PADRAO);

const NOMES_DOS_PERIODOS: Record<(typeof PERIODOS)[number], string> = {
  cafe: 'Café da manhã',
  almoco: 'Almoço',
  tarde: 'Tarde',
  noite: 'Noite',
  madrugada: 'Madrugada',
};

/** Os campos, na ordem e nos grupos da tela. */
export const CAMPOS: readonly DefinicaoDoCampo[] = [
  { id: 'total_pedidos', nome: 'Total de pedidos', grupo: 'Compras', tipo: 'numero' },
  { id: 'total_gasto', nome: 'Total gasto em pedidos', grupo: 'Compras', tipo: 'reais' },
  { id: 'ticket_medio', nome: 'Ticket médio', grupo: 'Compras', tipo: 'reais' },
  { id: 'primeiro_pedido', nome: 'Data do primeiro pedido', grupo: 'Compras', tipo: 'data' },
  { id: 'ultimo_pedido', nome: 'Data do último pedido', grupo: 'Compras', tipo: 'data' },
  {
    id: 'dias_ultimo_pedido',
    nome: 'Dias desde o último pedido',
    grupo: 'Compras',
    tipo: 'dias',
    ajuda: 'Dias de calendário, no fuso da conta: quem comprou ontem comprou há 1 dia.',
  },
  { id: 'produto', nome: 'Já comprou o produto', grupo: 'Compras', tipo: 'lista', opcoesDe: 'produtos' },
  {
    id: 'aniversario_data',
    nome: 'Data do próximo aniversário',
    grupo: 'Aniversário',
    tipo: 'data',
    ajuda: 'Quem nasceu em 29/02 faz aniversário em 28/02 nos anos sem 29.',
  },
  { id: 'aniversario_dias', nome: 'Dias para o próximo aniversário', grupo: 'Aniversário', tipo: 'dias' },
  {
    id: 'dias_ultima_campanha',
    nome: 'Dias desde a última campanha recebida',
    grupo: 'Campanhas e cadastro',
    tipo: 'dias',
    ajuda: 'Conta as campanhas do Regemcast. Quem nunca recebeu conta como há muito tempo.',
  },
  {
    id: 'cadastro_cw',
    nome: 'Data do cadastro no Cardápio Web',
    grupo: 'Campanhas e cadastro',
    tipo: 'data',
    ajuda: 'Só de quem veio do Cardápio Web. A data chega na sincronização com a loja.',
  },
  {
    id: 'dias_cadastro_cw',
    nome: 'Dias desde o cadastro no Cardápio Web',
    grupo: 'Campanhas e cadastro',
    tipo: 'dias',
    ajuda: 'Só de quem veio do Cardápio Web. A data chega na sincronização com a loja.',
  },
  { id: 'entrou_base', nome: 'Data em que entrou no Regemcast', grupo: 'Campanhas e cadastro', tipo: 'data' },
  {
    id: 'perfil',
    nome: 'Perfil (classificação RFV)',
    grupo: 'Campanhas e cadastro',
    tipo: 'lista',
    opcoes: SEGMENTOS.map((s) => ({ valor: s, nome: NOMES_DOS_PERFIS[s].nome })),
    ajuda: 'Os perfis de Contatos, com os números que a conta ajustou.',
  },
  {
    id: 'cashback',
    nome: 'Saldo de cashback',
    grupo: 'Cashback',
    tipo: 'reais',
    ajuda: 'Só o saldo que ainda vale hoje; o vencido conta como zero.',
  },
  { id: 'cashback_dias', nome: 'Dias para o cashback vencer', grupo: 'Cashback', tipo: 'dias' },
  { id: 'bairro', nome: 'Bairro', grupo: 'Onde e como compra', tipo: 'lista', opcoesDe: 'bairros' },
  {
    id: 'estado',
    nome: 'Estado (pelo DDD)',
    grupo: 'Onde e como compra',
    tipo: 'lista',
    opcoes: Object.entries(ESTADOS).map(([uf, nome]) => ({ valor: uf, nome })),
  },
  {
    id: 'jeito',
    nome: 'Jeito de comprar',
    grupo: 'Onde e como compra',
    tipo: 'lista',
    opcoes: [
      { valor: 'entrega', nome: 'Entrega' },
      { valor: 'retirada', nome: 'Retirada' },
      { valor: 'salao', nome: 'Salão' },
    ],
  },
  {
    id: 'periodo',
    nome: 'Período do dia',
    grupo: 'Onde e como compra',
    tipo: 'lista',
    opcoes: PERIODOS.map((p) => ({ valor: p, nome: NOMES_DOS_PERIODOS[p] })),
  },
];

export const IDS_DOS_CAMPOS = CAMPOS.map((c) => c.id);

const POR_ID = new Map(CAMPOS.map((c) => [c.id, c]));

export function campoDaRegra(id: string): DefinicaoDoCampo | undefined {
  return POR_ID.get(id);
}

/** Os nomes das comparações, como a tela mostra, por tipo de campo. */
export const NOMES_DAS_COMPARACOES: Record<TipoDoCampo, Array<{ valor: Comparacao; nome: string }>> = {
  numero: [
    { valor: '=', nome: 'é igual a' },
    { valor: '!=', nome: 'não é igual a' },
    { valor: '>', nome: 'é maior que' },
    { valor: '<', nome: 'é menor que' },
    { valor: '>=', nome: 'é maior ou igual a' },
    { valor: '<=', nome: 'é menor ou igual a' },
  ],
  reais: [],
  dias: [],
  data: [
    { valor: '=', nome: 'é no dia' },
    { valor: '!=', nome: 'não é no dia' },
    { valor: '>', nome: 'é depois de' },
    { valor: '<', nome: 'é antes de' },
    { valor: '>=', nome: 'é no dia ou depois' },
    { valor: '<=', nome: 'é no dia ou antes' },
  ],
  lista: [
    { valor: '=', nome: 'é' },
    { valor: '!=', nome: 'não é' },
  ],
};
NOMES_DAS_COMPARACOES.reais = NOMES_DAS_COMPARACOES.numero;
NOMES_DAS_COMPARACOES.dias = NOMES_DAS_COMPARACOES.numero;

export interface RegraDoPublico {
  campo: string;
  comparacao: Comparacao;
  /** Já normalizado: inteiro, reais com duas casas ("80.00"), `AAAA-MM-DD` ou o valor da lista. */
  valor: string;
}

/** O que a montagem guarda e a tela reabre. */
export interface RegrasDaCampanha {
  regras: RegraDoPublico[];
  parte: { de: number; ate: number } | null;
}

/** O maior número aceito em "Total de pedidos". */
const MAIOR_NUMERO = 1_000_000;
/** O maior número de dias aceito (100 anos). */
const MAIOR_DIAS = 36_500;
/** R$ 10 milhões, em centavos. */
const MAIOR_CENTAVOS = 1_000_000_000;

/** `AAAA-MM-DD` que existe no calendário, entre 1900 e 2999. */
function diaValido(texto: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return false;
  const ano = Number(texto.slice(0, 4));
  if (ano < 1900 || ano > 2999) return false;
  const d = new Date(`${texto}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === texto;
}

/** "80", "80.5", "80,50" → centavos; `null` se não for dinheiro. */
export function centavosDe(texto: string): number | null {
  const t = texto.trim();
  if (!/^\d{1,8}([.,]\d{1,2})?$/.test(t)) return null;
  const [inteiro, frac = ''] = t.replace(',', '.').split('.');
  const centavos = Number(inteiro) * 100 + Number(frac.padEnd(2, '0'));
  return centavos <= MAIOR_CENTAVOS ? centavos : null;
}

/**
 * Confere e normaliza as regras. Devolve a lista pronta para gravar, ou a frase
 * da recusa ("Regra 2: …"), que a tela mostra como veio.
 */
export function validarRegras(entrada: unknown): { regras: RegraDoPublico[] } | { erro: string } {
  if (!Array.isArray(entrada) || entrada.length === 0) return { erro: 'Monte ao menos uma regra.' };
  if (entrada.length > MAX_REGRAS) return { erro: `São no máximo ${MAX_REGRAS} regras.` };
  const regras: RegraDoPublico[] = [];
  for (const [i, bruta] of entrada.entries()) {
    const n = i + 1;
    const r = (bruta ?? {}) as Record<string, unknown>;
    const campo = typeof r.campo === 'string' ? POR_ID.get(r.campo) : undefined;
    if (!campo) return { erro: `Regra ${n}: escolha um campo da lista.` };
    const comparacao = r.comparacao as Comparacao;
    if (!(COMPARACOES as readonly string[]).includes(comparacao)) return { erro: `Regra ${n}: escolha a comparação.` };
    if (campo.tipo === 'lista' && comparacao !== '=' && comparacao !== '!=') {
      return { erro: `Regra ${n}: em "${campo.nome}" a comparação é "é" ou "não é".` };
    }
    const bruto = typeof r.valor === 'string' ? r.valor.trim() : typeof r.valor === 'number' ? String(r.valor) : '';
    if (!bruto) return { erro: `Regra ${n}: informe o valor de "${campo.nome}".` };
    let valor: string;
    switch (campo.tipo) {
      case 'numero': {
        const v = /^\d{1,7}$/.test(bruto) ? Number(bruto) : NaN;
        if (!(v >= 0 && v <= MAIOR_NUMERO)) return { erro: `Regra ${n}: "${campo.nome}" pede um número inteiro, de 0 a 1.000.000.` };
        valor = String(v);
        break;
      }
      case 'dias': {
        const v = /^\d{1,6}$/.test(bruto) ? Number(bruto) : NaN;
        if (!(v >= 0 && v <= MAIOR_DIAS)) return { erro: `Regra ${n}: "${campo.nome}" pede um número inteiro de dias, de 0 a 36.500.` };
        valor = String(v);
        break;
      }
      case 'reais': {
        const c = centavosDe(bruto);
        if (c === null) return { erro: `Regra ${n}: "${campo.nome}" pede um valor em reais, como 80 ou 80,50.` };
        valor = (c / 100).toFixed(2);
        break;
      }
      case 'data': {
        if (!diaValido(bruto)) return { erro: `Regra ${n}: escolha uma data válida em "${campo.nome}".` };
        valor = bruto;
        break;
      }
      case 'lista': {
        if (campo.opcoes) {
          if (!campo.opcoes.some((o) => o.valor === bruto)) return { erro: `Regra ${n}: escolha uma das opções de "${campo.nome}".` };
          valor = bruto;
        } else {
          const texto = bruto.replace(/\s+/g, ' ');
          const limite = campo.opcoesDe === 'bairros' ? TAMANHO_MAXIMO_BAIRRO : TAMANHO_MAXIMO_PRODUTO;
          if (texto.length > limite) return { erro: `Regra ${n}: "${campo.nome}" tem até ${limite} letras.` };
          valor = texto;
        }
        break;
      }
    }
    regras.push({ campo: campo.id, comparacao, valor });
  }
  return { regras };
}

/** A parte do público: do contato `de` ao `ate`, os dois a partir de 1. */
export function validarParte(de: unknown, ate: unknown): { parte: { de: number; ate: number } | null } | { erro: string } {
  if (de == null && ate == null) return { parte: null };
  const a = Number(de);
  const b = Number(ate);
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 1 || b < 1 || a > MAIOR_NUMERO || b > MAIOR_NUMERO) {
    return { erro: 'A parte vai de um contato a outro: dois números inteiros a partir de 1.' };
  }
  if (a > b) return { erro: 'Na parte, o primeiro contato vem antes do último.' };
  return { parte: { de: a, ate: b } };
}

// ------------------------------------------------------------------ a frase de cada regra

const SIMBOLO: Record<Comparacao, string> = { '=': '=', '!=': '≠', '>': '>', '<': '<', '>=': '≥', '<=': '≤' };

function reais(valor: string): string {
  return Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function dataBr(valor: string): string {
  return valor.split('-').reverse().join('/');
}

/** "Total de pedidos ≥ 3", "Bairro é Centro", "Data do primeiro pedido é no dia ou depois 01/11/2026". */
export function descreverRegra(r: RegraDoPublico): string {
  const campo = POR_ID.get(r.campo);
  if (!campo) return 'Regra que não vale mais';
  const nomeDaComparacao = NOMES_DAS_COMPARACOES[campo.tipo].find((c) => c.valor === r.comparacao)?.nome ?? r.comparacao;
  switch (campo.tipo) {
    case 'lista': {
      const opcao = campo.opcoes?.find((o) => o.valor === r.valor)?.nome ?? r.valor;
      return `${campo.nome} ${nomeDaComparacao} ${opcao}`;
    }
    case 'data':
      return `${campo.nome} ${nomeDaComparacao} ${dataBr(r.valor)}`;
    case 'reais':
      return `${campo.nome} ${SIMBOLO[r.comparacao]} ${reais(r.valor)}`;
    case 'dias':
      return `${campo.nome} ${SIMBOLO[r.comparacao]} ${r.valor} ${r.valor === '1' ? 'dia' : 'dias'}`;
    case 'numero':
      return `${campo.nome} ${SIMBOLO[r.comparacao]} ${r.valor}`;
  }
}

/** As regras numa frase só, para o cartão da campanha: "A e B e C" — cortada em `max` letras. */
export function resumoDasRegras(regras: RegraDoPublico[], max = 220): string {
  const texto = regras.map(descreverRegra).join(' e ');
  return texto.length <= max ? texto : `${texto.slice(0, max - 1).trimEnd()}…`;
}

// ------------------------------------------------------------------ a condição em SQL

/** O que a condição precisa da conta: o fuso, o "hoje" dele e os números dos perfis. */
export interface ContextoDasRegras {
  fuso: string;
  parametros: ParametrosSegmentacao;
}

/** Operadores, da lista fixa: o texto do pedido nunca vira SQL. */
const OPERADOR: Record<Exclude<Comparacao, '!='>, SQL> = {
  '=': sql.raw('='),
  '>': sql.raw('>'),
  '<': sql.raw('<'),
  '>=': sql.raw('>='),
  '<=': sql.raw('<='),
};

/** Compara um valor que pode faltar. "Não é igual a" inclui quem não tem o dado. */
function comparar(valor: SQL, comparacao: Comparacao, parametro: SQL): SQL {
  if (comparacao === '!=') return sql`(${valor} is distinct from ${parametro})`;
  return sql`(${valor} ${OPERADOR[comparacao]} ${parametro})`;
}

/** Uma condição que já é verdadeira ou falsa (nunca nula): "não é" a nega. */
function seOuNao(condicao: SQL, comparacao: Comparacao): SQL {
  return comparacao === '!=' ? sql`(not ${condicao})` : condicao;
}

/** O dia, no fuso da conta, de um instante do contato. */
function diaNoFuso(coluna: SQL, ctx: ContextoDasRegras): SQL {
  return sql`((${coluna} at time zone ${ctx.fuso})::date)`;
}

function hoje(ctx: ContextoDasRegras): SQL {
  return sql`((now() at time zone ${ctx.fuso})::date)`;
}

/** O próximo aniversário (hoje conta como "próximo"); 29/02 vira 28/02 nos anos sem 29. */
function proximoAniversario(ctx: ContextoDasRegras): SQL {
  const mes = sql`extract(month from contato.data_nascimento)::int`;
  const dia = sql`extract(day from contato.data_nascimento)::int`;
  const noAno = (ano: SQL) =>
    sql`make_date(${ano}, ${mes}, least(${dia}, extract(day from (make_date(${ano}, ${mes}, 1) + interval '1 month - 1 day'))::int))`;
  const ano = sql`extract(year from ${hoje(ctx)})::int`;
  return sql`(case when contato.data_nascimento is null then null
                   when ${noAno(ano)} >= ${hoje(ctx)} then ${noAno(ano)}
                   else ${noAno(sql`(${ano} + 1)`)} end)`;
}

/** O dia da última campanha que chegou ao contato (nas duas formas do celular), no fuso da conta. */
function diaDaUltimaCampanha(ctx: ContextoDasRegras): SQL {
  return sql`(select (max(d.enviada_em) at time zone ${ctx.fuso})::date
                from campanha_destinatario d
               where d.conta_id = contato.conta_id
                 and d.telefone_e164 in (contato.telefone_e164, ${gemeoEmSql(sql`contato.telefone_e164`)})
                 and d.enviada_em is not null)`;
}

/** Uma regra (já validada) como condição sobre a tabela `contato`, sem apelido. */
export function expressaoDaRegra(r: RegraDoPublico, ctx: ContextoDasRegras): SQL {
  const c = r.comparacao;
  const inteiro = sql`${Number(r.valor)}::int`;
  const centavos = sql`${centavosDe(r.valor) ?? 0}::bigint`;
  const data = sql`${r.valor}::date`;
  switch (r.campo) {
    case 'total_pedidos':
      // Quem tem data de compra e não tem a contagem comprou ao menos uma vez (a regra dos perfis).
      return comparar(sql`coalesce(contato.pedidos, case when contato.ultimo_pedido_em is null then 0 else 1 end)`, c, inteiro);
    case 'total_gasto':
      return comparar(sql`coalesce(contato.total_gasto_centavos, 0)`, c, centavos);
    case 'ticket_medio':
      return comparar(sql`(contato.total_gasto_centavos::numeric / nullif(contato.pedidos, 0))`, c, centavos);
    case 'primeiro_pedido':
      return comparar(diaNoFuso(sql`contato.primeiro_pedido_em`, ctx), c, data);
    case 'ultimo_pedido':
      return comparar(diaNoFuso(sql`contato.ultimo_pedido_em`, ctx), c, data);
    case 'dias_ultimo_pedido':
      return comparar(sql`(${hoje(ctx)} - ${diaNoFuso(sql`contato.ultimo_pedido_em`, ctx)})`, c, inteiro);
    case 'produto':
      // Pelo nome sem maiúscula: a `chave` de `contato_produto` é o nome em minúsculas.
      return seOuNao(
        sql`exists (select 1 from contato_produto p where p.contato_id = contato.id and p.chave = lower(${r.valor}))`,
        c,
      );
    case 'aniversario_data':
      return comparar(proximoAniversario(ctx), c, data);
    case 'aniversario_dias':
      return comparar(sql`(${proximoAniversario(ctx)} - ${hoje(ctx)})`, c, inteiro);
    case 'dias_ultima_campanha':
      return comparar(
        sql`coalesce(${hoje(ctx)} - ${diaDaUltimaCampanha(ctx)}, ${DIAS_DE_QUEM_NUNCA_RECEBEU}::int)`,
        c,
        inteiro,
      );
    case 'cadastro_cw':
      return comparar(diaNoFuso(sql`contato.cadastro_origem_em`, ctx), c, data);
    case 'dias_cadastro_cw':
      return comparar(sql`(${hoje(ctx)} - ${diaNoFuso(sql`contato.cadastro_origem_em`, ctx)})`, c, inteiro);
    case 'entrou_base':
      return comparar(diaNoFuso(sql`contato.criado_em`, ctx), c, data);
    case 'perfil':
      return comparar(expressaoSegmento(ctx.parametros), c, sql`${r.valor}`);
    case 'cashback':
      return comparar(
        sql`(case when ${cashbackValido('contato', hoje(ctx))} then contato.cashback_centavos else 0 end)`,
        c,
        centavos,
      );
    case 'cashback_dias':
      return comparar(
        sql`(case when ${cashbackValido('contato', hoje(ctx))} then contato.cashback_vence_em - ${hoje(ctx)} end)`,
        c,
        inteiro,
      );
    case 'bairro':
      return comparar(sql`lower(contato.bairro)`, c, sql`lower(${r.valor})`);
    case 'estado': {
      const ddds = dddsDaUf(r.valor);
      const noEstado = ddds.length
        ? sql`(contato.telefone_e164 like '55%' and substr(contato.telefone_e164, 3, 2) in (${sql.join(
            ddds.map((d) => sql`${d}`),
            sql`, `,
          )}))`
        : sql`false`;
      return seOuNao(noEstado, c);
    }
    case 'jeito':
      return comparar(sql`contato.tipo_preferido`, c, sql`${r.valor}`);
    case 'periodo':
      return comparar(sql`contato.periodo_preferido`, c, sql`${r.valor}`);
    default:
      // Campo fora da lista não chega aqui (`validarRegras`); se chegar, não casa ninguém.
      return sql`false`;
  }
}

/** Todas as regras: o contato precisa cumprir cada uma. */
export function expressaoDasRegras(regras: RegraDoPublico[], ctx: ContextoDasRegras): SQL {
  if (!regras.length) return sql`false`;
  return sql`(${sql.join(
    regras.map((r) => expressaoDaRegra(r, ctx)),
    sql` and `,
  )})`;
}

/**
 * Só uma parte do público: do contato `de` ao `ate`, na ordem em que entraram
 * na base, contando só quem pode receber (sem descadastro e com WhatsApp). A
 * ordem é fixa — o "do 1 ao 500" da prévia é o da montagem.
 */
export function expressaoDaParte(contaId: string, filtro: SQL, parte: { de: number; ate: number }): SQL {
  // O `contato` de dentro esconde o de fora: as condições do filtro valem para a linha de dentro.
  return sql`(contato.id in (
    select contato.id
      from contato
     where contato.conta_id = ${contaId}
       and contato.opt_out = false
       and contato.sem_whatsapp_em is null
       and ${filtro}
     order by contato.criado_em, contato.id
    offset ${parte.de - 1}
     limit ${parte.ate - parte.de + 1}
  ))`;
}
