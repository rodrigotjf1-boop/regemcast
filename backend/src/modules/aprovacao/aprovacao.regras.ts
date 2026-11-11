/**
 * A aprovação de disparos (Hub DMS, F5 parte B) — as regras, sem banco.
 *
 * O disparo que outro produto da DMS pede pela porta MCP espera uma pessoa da
 * conta: o pedido fica preso ao PLANO (o que a pessoa vê para aprovar), e a
 * aprovação vale para aquele plano e uma vez só. As situações, o prazo, o
 * resumo do plano e as conferências são as do pacote comum
 * (`dms/integracao-dms.ts`, seção 11); aqui ficam o plano do Regemcast, a
 * impressão do pedido repetido, quem pode aprovar e as frases desta tela.
 * Detalhe e o porquê em `docs/aprovacao-de-disparos.md`.
 */
import { createHash } from 'node:crypto';

import { impressaoPedido, resumoDoPlano, type DecididoPor } from '../../dms/integracao-dms';

/** A ação do pedido: o nome da ferramenta que dispara (o registro do hub e o `pedidoPublico` levam este nome). */
export const ACAO_DO_DISPARO = 'campanha_disparar';

/** Mensagem a cliente E gasto na Meta: R3, e o teto de gasto é obrigatório na aprovação (decisão F5-6). */
export const RISCO_DO_DISPARO = 'R3' as const;

/** O cupom que vai junto (texto de quem pede: dado, nunca instrução). */
export interface CupomDoPedido {
  codigo: string;
  descricao: string | null;
}

export const LIMITE_CUPOM_CODIGO = 40;
export const LIMITE_CUPOM_DESCRICAO = 200;

/**
 * O plano: tudo o que a pessoa vê para aprovar, e só isso. O resumo dele
 * (`resumoDoPlano`) prende o pedido: mudou um campo, a aprovação não vale.
 * O orçamento da conta NÃO entra: não é o que ela aprova (ela fixa o teto do
 * disparo), e o teto mexido pelo dono não pode encerrar o pedido.
 */
export interface PlanoDoDisparo {
  campanha: string;
  aplicativo: string;
  nome: string;
  /** O modelo como a Meta o tem AGORA (o id dela, o texto de cada parte e os botões): é o que sai. */
  modelo: {
    id: string;
    nome: string;
    idioma: string;
    categoria: string | null;
    cabecalho: string | null;
    corpo: string;
    rodape: string | null;
    botoes: string[];
  };
  /** De onde sai cada variável do corpo, com o valor das fixas (o cupom e o "10%" que o rascunho grava). */
  variaveis: unknown;
  /** A variável do título, quando o modelo tem. */
  variavelCabecalho: unknown;
  /** O que o modelo exige no envio além do corpo, já resolvido (mídia do cabeçalho, oferta, cartões). */
  envio: unknown;
  /**
   * O público: o rótulo, as contagens e a IMPRESSÃO de quem recebe (o telefone e as variáveis de cada um, em ordem):
   * trocar a lista por outra do mesmo tamanho muda o plano.
   */
  publico: { rotulo: string | null; destinatarios: number; aceitaram: number; impressao: string };
  custo: { moeda: string | null; estimadoCentavos: number | null };
  cupom: CupomDoPedido | null;
}

const inteiroSemSinal = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.trunc(v) : 0);
const textoOuNulo = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
/** O JSON guardado como está, sem `undefined` (que o resumo trataria diferente de nulo). */
const dado = (v: unknown): unknown => (v === undefined ? null : v);

/** O plano na forma que entra no resumo: os mesmos campos, na mesma forma, em todo caminho (pedido, tela, execução). */
export function montarPlano(e: {
  campanhaId: string;
  aplicativo: string;
  nome: string;
  modelo: { id: string; nome: string; idioma: string; categoria: string | null; cabecalho: string | null; corpo: string; rodape: string | null; botoes: readonly string[] };
  variaveis: unknown;
  variavelCabecalho: unknown;
  envio: unknown;
  publicoRotulo: string | null;
  destinatarios: number;
  aceitaram: number;
  impressaoDoPublico: string;
  moeda: string | null;
  estimadoCentavos: number | null;
  cupom: CupomDoPedido | null;
}): PlanoDoDisparo {
  return {
    campanha: e.campanhaId,
    aplicativo: e.aplicativo,
    nome: e.nome,
    modelo: {
      id: e.modelo.id,
      nome: e.modelo.nome,
      idioma: e.modelo.idioma,
      categoria: textoOuNulo(e.modelo.categoria),
      cabecalho: textoOuNulo(e.modelo.cabecalho),
      corpo: e.modelo.corpo,
      rodape: textoOuNulo(e.modelo.rodape),
      botoes: [...e.modelo.botoes],
    },
    variaveis: dado(e.variaveis),
    variavelCabecalho: dado(e.variavelCabecalho),
    envio: dado(e.envio),
    publico: {
      rotulo: textoOuNulo(e.publicoRotulo),
      destinatarios: inteiroSemSinal(e.destinatarios),
      aceitaram: inteiroSemSinal(e.aceitaram),
      impressao: e.impressaoDoPublico,
    },
    custo: {
      moeda: textoOuNulo(e.moeda),
      estimadoCentavos: typeof e.estimadoCentavos === 'number' && Number.isSafeInteger(e.estimadoCentavos) && e.estimadoCentavos >= 0 ? e.estimadoCentavos : null,
    },
    cupom: e.cupom ? { codigo: e.cupom.codigo, descricao: e.cupom.descricao } : null,
  };
}

/** O resumo do plano do disparo: a conta do pacote (SHA-256 do JSON canônico). */
export function resumoDoDisparo(plano: PlanoDoDisparo): string {
  return resumoDoPlano(plano);
}

const sha256 = (texto: string) => createHash('sha256').update(texto, 'utf8').digest('hex');

/** A chave de repetição guardada só em resumo (a chave em claro é de quem pede). */
export function resumoDaChave(chave: string): string {
  return sha256(chave);
}

/**
 * A impressão do pedido, para o pedido repetido (pacote, `conferirPedidoRepetido`): a mesma chave com a mesma
 * impressão devolve o mesmo pedido; com outra, `chave-reutilizada`. É a `impressaoPedido` do pacote sobre o que quem
 * pede manda (a campanha, a confirmação do plano, quem pede e o cupom), não sobre o que o Regemcast lê depois.
 */
export function impressaoDoPedido(p: { campanha: string; confirmacao: string; pedidoPor: unknown; cupom: CupomDoPedido | null }): string {
  return impressaoPedido('MCP', 'campanha_disparo_pedir', { campanha: p.campanha, confirmacao: p.confirmacao, pedidoPor: p.pedidoPor, cupom: p.cupom });
}

/** Quantos pedidos podem esperar ao mesmo tempo numa conta: mais que isso é inundação (e-mail a cada um). */
export const MAX_PEDIDOS_ESPERANDO = 20;

/** Há quanto tempo o pedido aprovado espera para a rotina tentar executar de novo (o da tela está em andamento antes). */
export const MINUTOS_PARA_TENTAR_DE_NOVO = 2;

/**
 * O cupom que veio no pedido: nulo quando não veio; `'invalido'` quando veio fora da forma (o pedido é recusado, sem
 * gravar). Código de 1 a 40 caracteres visíveis; descrição opcional, até 200, sem quebra de linha.
 */
export function cupomDoPedido(v: unknown): CupomDoPedido | null | 'invalido' {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'object' || Array.isArray(v)) return 'invalido';
  const o = v as Record<string, unknown>;
  const chaves = Object.keys(o).filter((k) => o[k] !== undefined);
  if (chaves.some((k) => k !== 'codigo' && k !== 'descricao')) return 'invalido';
  const codigo = typeof o.codigo === 'string' ? o.codigo.trim() : '';
  // Visível e sem espaço: o código que a pessoa digita no cardápio.
  if (!/^[\x21-\x7EÀ-ſ]{1,40}$/.test(codigo)) return 'invalido';
  if (o.descricao === undefined || o.descricao === null) return { codigo, descricao: null };
  if (typeof o.descricao !== 'string') return 'invalido';
  const descricao = o.descricao.replace(/\s+/g, ' ').trim();
  if (!descricao) return { codigo, descricao: null };
  if (descricao.length > LIMITE_CUPOM_DESCRICAO) return 'invalido';
  return { codigo, descricao };
}

/** Quem aprova: o dono sempre; o operador ativo, só com a permissão que o dono deu (decisão F5-2). */
export function podeAprovar(u: { papel: string; status: string; aprovaDisparos: boolean }): boolean {
  if (u.status !== 'ativo') return false;
  return u.papel === 'dono' || u.aprovaDisparos === true;
}

/** O papel de quem decidiu, para o registro do hub (nunca o nome). */
export function decididoPorQuem(papel: string): DecididoPor {
  return papel === 'dono' ? 'dono' : 'autorizado';
}

/** A trava do código na aprovação: 5 errados em 15 minutos travam a aprovação por 15 minutos (a entrada na conta não). */
export const MAX_ERROS_CODIGO_APROVACAO = 5;
export const MINUTOS_TRAVA_APROVACAO = 15;

/** O teto de gasto que a tela aceita: de R$ 1,00 a R$ 1.000.000,00, em centavos. */
export const TETO_MINIMO_CENTAVOS = 100;
export const TETO_MAXIMO_CENTAVOS = 100_000_000;

export function tetoValido(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= TETO_MINIMO_CENTAVOS && v <= TETO_MAXIMO_CENTAVOS;
}

// ------------------------------------------------------------------- frases

export const SO_QUEM_PODE_APROVAR = 'Só o dono da conta, ou quem ele autorizou em Conta e usuários, aprova disparos.';
export const SEM_APLICATIVO_AUTENTICADOR =
  'Aprovar pede o código do aplicativo autenticador. Ligue o aplicativo em Conta e usuários › Segurança do seu acesso e volte a este pedido.';
export const CODIGO_NAO_CONFERE = 'O código não confere. Confira o aplicativo autenticador e digite o código que está na tela agora.';
export const CODIGO_JA_USADO = 'Este código já foi usado. Espere o próximo aparecer no aplicativo autenticador.';
export const APROVACAO_TRAVADA = `Muitos códigos errados. Aprovar fica travado por ${MINUTOS_TRAVA_APROVACAO} minutos; o pedido continua esperando.`;
export const TETO_FORA = 'Diga o teto de gasto deste disparo, entre R$ 1,00 e R$ 1.000.000,00.';
export const MOTIVO_OBRIGATORIO = 'Escreva o motivo da recusa (até 300 caracteres): ele volta para quem pediu.';
export const CUPOM_INVALIDO = 'O cupom vai como {"codigo": "<até 40 caracteres, sem espaço>", "descricao": "<até 200 caracteres>"}.';
export const PEDIDO_NAO_ENCONTRADO = 'Pedido não encontrado.';
export const LIMITE_DE_PEDIDOS = `Esta conta já tem ${MAX_PEDIDOS_ESPERANDO} pedidos esperando aprovação. Espere uma resposta, ou cancele um pedido, antes de pedir outro.`;
export const MODELO_SEM_TEXTO =
  'O modelo desta campanha não está mais na Meta, ou não foi possível ler o texto dele: quem aprova precisa ver o que sai. Confira o modelo e peça de novo.';
export const CREDENCIAL_DESLIGADA = 'O aplicativo que pediu foi desconectado desta conta, ou perdeu a permissão de disparar: o pedido foi encerrado.';
export const CAMINHO_DIRETO_FECHADO =
  'O disparo por aplicativo agora espera a aprovação de uma pessoa da conta: peça com campanha_disparo_pedir e acompanhe com acao_pedido_ler.';

/** O botão Disparar da tela, para a campanha que outro produto montou: ela sai pelo pedido. */
export function saiPeloPedido(produto: string): string {
  return `Esta campanha foi montada pelo ${nomeDoProduto(produto)} e sai pelo pedido de aprovação, em Campanhas › Para aprovar.`;
}

/** O disparo por outro caminho (a tela, ou a porta com a chave desligada) de uma campanha com pedido aberto. */
export function temPedidoAberto(produto: string | null): string {
  const quem = produto ? `o ${nomeDoProduto(produto)}` : 'um aplicativo';
  return `Esta campanha tem um pedido de aprovação aberto (${quem} pediu o disparo): ela sai por ele, em Campanhas › Para aprovar.`;
}

/** A execução não saiu agora (o disparo recusou, ou a Meta não respondeu): o pedido segue aprovado e a rotina tenta de novo. */
export function adiado(frase: string, venceEm: string): string {
  return `Aprovado, mas o disparo não saiu agora: ${frase.replace(/\s+$/, '')} O Regemcast tenta de novo sozinho até ${venceEm}.`;
}

/** A pausa pelo teto aprovado não volta pela tela: seguir pede um pedido novo, com outro teto. */
export function pausaNoTeto(produto: string | null): string {
  const quem = produto ? `o ${nomeDoProduto(produto)}` : 'o aplicativo que pediu';
  return `Esta campanha parou no teto de gasto aprovado. Para seguir, ${quem} faz um pedido novo, com outro teto.`;
}

/** O nome do produto como a tela mostra ("Liame"), a partir do identificador (`liame`). */
export function nomeDoProduto(produto: string): string {
  const p = String(produto || '').trim();
  return p ? p.charAt(0).toUpperCase() + p.slice(1) : 'aplicativo';
}
