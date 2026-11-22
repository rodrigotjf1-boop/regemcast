/**
 * O DMS GRAPH NO REGEMCAST: as peças sem rede nem banco (plano "recursos por produto", F4; migration 052).
 *
 * "Graph" aqui é o produto da DMS, não a Graph API da Meta (`modules/meta/graph.service.ts`): por isso o
 * nome `dms-graph` em tudo. O Regemcast é o APLICATIVO que pede (Padrão DMS §3): empurra o pedido ao Graph
 * com o token do DMS ID, o responsável autoriza na página do Graph e, na volta, o Regemcast troca o código
 * pela LIGAÇÃO da conta. Nasce desligado: sem `DMS_GRAPH_LIGADO=true`, a tela nem mostra o cartão.
 */
import { createHash, randomBytes } from 'node:crypto';

import { ErroMcp, lerChave, montarChaveIdempotencia } from '../../dms/integracao-dms';

export const ENDERECO_PADRAO = 'https://graph.dmstecnologias.com/mcp';
export const VALIDADE_DO_PEDIDO_MS = 10 * 60_000;

/** O que o Regemcast usa hoje. Editar e criar imagem entram quando o editor tiver a tela delas. */
export const PERMISSAO_AJUSTAR = 'videos.ajustar';
export const PERMISSOES_DO_REGEMCAST: readonly string[] = [PERMISSAO_AJUSTAR];

export const FERRAMENTA_AJUSTAR = 'ajustar_video';
export const FERRAMENTA_CONSULTAR = 'consultar_criacao';

/** O limite de entrada da ferramenta `ajustar_video`. O modelo aceita até 16 MB: o vídeo maior segue valendo, sem ajuste. */
export const AJUSTE_MAX_BYTES = 12 * 1024 * 1024;
/** O limite de saída da ferramenta (e o da mídia de vídeo do Regemcast). */
export const RESULTADO_MAX_BYTES = 16 * 1024 * 1024;
export const DURACAO_MAXIMA_S = 180;
export const TEXTO_MAXIMO = 80;
export const PROPORCOES = ['16:9', '9:16', '1:1'] as const;
export type Proporcao = (typeof PROPORCOES)[number];

export type ConfigDmsGraph = {
  /** `DMS_GRAPH_LIGADO=true` com a credencial completa. Falso: nada do Graph aparece. */
  ligado: boolean;
  motivo: string | null;
  /** A porta MCP, que é também o recurso no DMS ID. */
  endereco: string;
  /** A origem do Graph: o `iss` da volta (RFC 9207), a base do clique e a única origem aceita no link do resultado. */
  origem: string;
  emissor: string;
  aplicativo: string;
  segredo: string;
  /** O endereço de volta do Regemcast, o padrão que o Graph aceita. */
  volta: string;
};

const semBarra = (v?: string) => (v ?? '').trim().replace(/\/+$/, '');
const LOCAIS = ['localhost', '127.0.0.1'];
const ID_DE_APLICATIVO = /^[A-Za-z0-9_-]{4,64}$/;

/** Lê a configuração da distribuição. Nunca lança: o que falta vira `motivo`, que vai ao log. */
export function lerConfigDmsGraph(e: Record<string, string | undefined> = process.env): ConfigDmsGraph {
  const endereco = semBarra(e.DMS_GRAPH_MCP_URL) || ENDERECO_PADRAO;
  const producao = e.NODE_ENV === 'production';
  let motivo: string | null = null;
  let origem = '';
  try {
    const u = new URL(endereco);
    const local = LOCAIS.includes(u.hostname);
    if (u.username || u.password || u.search || u.hash) motivo = 'DMS_GRAPH_MCP_URL não pode ter usuário, senha, parâmetro nem âncora';
    else if (u.pathname !== '/mcp') motivo = 'DMS_GRAPH_MCP_URL precisa terminar em /mcp';
    else if (producao && local) motivo = 'DMS_GRAPH_MCP_URL aponta para a própria máquina';
    else if (u.protocol !== 'https:' && !(local && !producao && u.protocol === 'http:')) motivo = 'DMS_GRAPH_MCP_URL precisa ser https';
    origem = u.origin;
  } catch {
    motivo = 'DMS_GRAPH_MCP_URL não é um endereço';
  }
  const emissor = semBarra(e.DMS_ID_EMISSOR);
  const aplicativo = (e.HUB_APLICATIVO ?? '').trim();
  const segredo = (e.HUB_SEGREDO ?? '').trim();
  if (!motivo && !emissor) motivo = 'falta DMS_ID_EMISSOR';
  if (!motivo && !ID_DE_APLICATIVO.test(aplicativo)) motivo = 'HUB_APLICATIVO precisa ser o client_id do Regemcast no DMS ID';
  if (!motivo && segredo.length < 16) motivo = 'HUB_SEGREDO falta ou está curto';
  // `||`, não `??`: a variável vazia no painel vale como ausente.
  const site = semBarra(e.APP_URL) || 'https://cast.dmsregem.com';
  return {
    ligado: motivo === null && e.DMS_GRAPH_LIGADO === 'true',
    motivo,
    endereco,
    origem,
    emissor,
    aplicativo,
    segredo,
    volta: `${site}/integracoes/graph/volta`,
  };
}

/**
 * O piloto: `DMS_GRAPH_CONTAS` = os ids das contas que veem o Graph, separados por vírgula ou espaço. Vazia = todas.
 * Um item torto não libera ninguém a mais: a lista FECHA, nunca abre para todas.
 */
export function ligadoParaConta(contaId: string, e: Record<string, string | undefined> = process.env): boolean {
  if (e.DMS_GRAPH_LIGADO !== 'true') return false;
  const bruto = String(e.DMS_GRAPH_CONTAS ?? '').trim();
  if (!bruto) return true;
  return bruto
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase())
    .includes(String(contaId).toLowerCase());
}

// ───────────────────────────── o clique ─────────────────────────────

export const hashDoEstado = (estado: string): string => createHash('sha256').update(estado, 'utf8').digest('hex');

/** O `state` (preso a quem começou; só o resumo é guardado) e o par do PKCE (o verificador fica cifrado). */
export function gerarPedido(): { estado: string; estadoHash: string; verificador: string; desafio: string } {
  const estado = randomBytes(32).toString('base64url');
  const verificador = randomBytes(48).toString('base64url');
  return { estado, estadoHash: hashDoEstado(estado), verificador, desafio: createHash('sha256').update(verificador, 'ascii').digest('base64url') };
}

const FORMATO_DO_ESTADO = /^[A-Za-z0-9_-]{43}$/;
const FORMATO_DO_NUMERO = /^urn:ietf:params:oauth:request_uri:gph_[A-Za-z0-9_-]{43}$/;
const FORMATO_DO_CODIGO = /^gph_ac_[A-Za-z0-9_-]{43}$/;

export const formatoDoNumero = (v: unknown): v is string => typeof v === 'string' && FORMATO_DO_NUMERO.test(v);

/** O CNPJ da conta com 14 dígitos, ou nada: a conta da empresa no Graph nasce e é achada por ele. */
export function cnpjDaConta(bruto: string | null | undefined): string | null {
  const d = String(bruto ?? '').replace(/\D/g, '');
  return d.length === 14 ? d : null;
}

/** O corpo do pedido empurrado (`POST /v1/dms-id/autorizacao/pedido`). */
export function corpoDoPedido(d: {
  aplicativo: string;
  volta: string;
  estado: string;
  desafio: string;
  contaId: string;
  contaNome: string;
  contaCnpj: string;
  contaEmail: string;
}): Record<string, string> {
  return {
    response_type: 'code',
    client_id: d.aplicativo,
    redirect_uri: d.volta,
    scope: PERMISSOES_DO_REGEMCAST.join(' '),
    state: d.estado,
    code_challenge: d.desafio,
    code_challenge_method: 'S256',
    conta_nome: d.contaNome.trim().slice(0, 120) || 'Conta do Regemcast',
    conta_cnpj: d.contaCnpj,
    conta_email: d.contaEmail.trim().toLowerCase().slice(0, 200),
    conta_empresa_id: d.contaId,
  };
}

/** A página do Graph com o número do pedido. Só a página que o próprio Graph devolveu, na origem dele; senão, a padrão. */
export function urlDaPagina(devolvida: unknown, origem: string, aplicativo: string, numero: string): string {
  let pagina = `${origem}/autorizar`;
  if (typeof devolvida === 'string') {
    try {
      if (new URL(devolvida).origin === origem) pagina = devolvida;
    } catch {
      /* o endereço torto fica com a página padrão */
    }
  }
  const u = new URL(pagina);
  u.searchParams.set('client_id', aplicativo);
  u.searchParams.set('request_uri', numero);
  return u.toString();
}

export type Volta =
  | { tipo: 'codigo'; estado: string; codigo: string }
  | { tipo: 'recusa'; estado: string; motivo: 'recusado' | 'pedido_invalido' }
  | { tipo: 'invalida'; motivo: string };

const texto = (v: unknown) => (typeof v === 'string' ? v : '');

/** Confere a volta ANTES do banco. Sem o `iss` do Graph, a volta não vale, mesmo com um `state` certo (RFC 9207). */
export function conferirVolta(q: { code?: unknown; state?: unknown; iss?: unknown; error?: unknown }, origem: string): Volta {
  if (texto(q.iss) !== origem) return { tipo: 'invalida', motivo: 'a volta não veio do DMS Graph' };
  if (typeof q.state !== 'string' || !FORMATO_DO_ESTADO.test(q.state)) return { tipo: 'invalida', motivo: 'a volta veio sem o pedido que o Regemcast abriu' };
  const erro = texto(q.error);
  if (erro) return { tipo: 'recusa', estado: q.state, motivo: erro === 'access_denied' ? 'recusado' : 'pedido_invalido' };
  const codigo = texto(q.code);
  if (!FORMATO_DO_CODIGO.test(codigo)) return { tipo: 'invalida', motivo: 'a volta veio sem o código da autorização' };
  return { tipo: 'codigo', estado: q.state, codigo };
}

export type LigacaoDaTroca = { ligacao: string; prefixo: string; contaGraph: string | null; contaNome: string | null; permissoes: string[] };

/** A ligação que a troca devolveu: o segredo do Graph, com a permissão de ajustar. Torta devolve `null`: nada se guarda. */
export function ligacaoDaTroca(resposta: unknown): LigacaoDaTroca | null {
  const r = resposta as Record<string, unknown> | null;
  const ligacao = texto(r?.ligacao);
  const lida = lerChave(ligacao);
  if (!lida || lida.tipo !== 'lg' || lida.produto !== 'graph') return null;
  const permissoes = Array.isArray(r?.permissoes) ? (r.permissoes as unknown[]).filter((p): p is string => typeof p === 'string').slice(0, 20) : [];
  if (!permissoes.includes(PERMISSAO_AJUSTAR)) return null;
  return {
    ligacao,
    prefixo: texto(r?.prefixo).slice(0, 40) || ligacao.slice(0, 18),
    contaGraph: texto(r?.conta_id).slice(0, 100) || null,
    contaNome: texto(r?.conta_nome).slice(0, 200) || null,
    permissoes,
  };
}

// ───────────────────────────── o ajuste ─────────────────────────────

export type PedidoDeAjuste = {
  inicioSegundos?: number;
  fimSegundos?: number;
  proporcao?: Proporcao;
  texto?: string;
};

export type AjusteConferido = { pedido: PedidoDeAjuste; argumentos: Record<string, unknown> };

const segundoValido = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= DURACAO_MAXIMA_S;

/**
 * Confere o pedido e monta os argumentos da ferramenta (sem o vídeo e sem a chave). O resultado sempre sai comprimido em
 * 720p, o tamanho que serve ao cabeçalho do WhatsApp. O que a ferramenta recusaria é recusado aqui, antes de mandar 12 MB.
 */
export function conferirAjuste(d: PedidoDeAjuste): AjusteConferido | { erro: string } {
  const argumentos: Record<string, unknown> = {};
  const pedido: PedidoDeAjuste = {};
  const temInicio = d.inicioSegundos !== undefined;
  const temFim = d.fimSegundos !== undefined;
  if (temInicio !== temFim) return { erro: 'Informe o começo e o fim do trecho.' };
  if (temInicio && temFim) {
    if (!segundoValido(d.inicioSegundos) || !segundoValido(d.fimSegundos)) return { erro: 'O trecho precisa ficar entre 0 e 180 segundos.' };
    if (d.fimSegundos - d.inicioSegundos < 0.5) return { erro: 'O trecho precisa ter pelo menos meio segundo.' };
    pedido.inicioSegundos = d.inicioSegundos;
    pedido.fimSegundos = d.fimSegundos;
    argumentos.cortar = { inicioSegundos: d.inicioSegundos, fimSegundos: d.fimSegundos };
  }
  if (d.proporcao !== undefined) {
    if (!PROPORCOES.includes(d.proporcao)) return { erro: 'Escolha a proporção 16:9, 9:16 ou 1:1.' };
    pedido.proporcao = d.proporcao;
    argumentos.proporcao = { alvo: d.proporcao, modo: 'preencher' };
  }
  const limpo = (d.texto ?? '').normalize('NFC').trim().replace(/ +/g, ' ');
  if (limpo) {
    if ([...limpo].length > TEXTO_MAXIMO) return { erro: `O texto no vídeo vai até ${TEXTO_MAXIMO} letras.` };
    if (/[\p{C}\p{Extended_Pictographic}]/u.test(limpo)) return { erro: 'O texto no vídeo não aceita emoji nem quebra de linha.' };
    pedido.texto = limpo;
    argumentos.texto = { texto: limpo, posicao: 'base' };
  }
  if (!Object.keys(argumentos).length) return { erro: 'Diga o que ajustar: o trecho, a proporção ou o texto.' };
  argumentos.comprimir = { ladoMenor: 720, qualidade: 'media' };
  return { pedido, argumentos };
}

/** A mesma mídia com o mesmo pedido dá sempre a mesma chave: repetir não processa de novo nem cria outra mídia. */
export const chaveDoAjuste = (contaId: string, midiaId: string, pedido: PedidoDeAjuste): string =>
  montarChaveIdempotencia(
    'regemcast-ajuste-video',
    contaId,
    midiaId,
    pedido.inicioSegundos ?? '',
    pedido.fimSegundos ?? '',
    pedido.proporcao ?? '',
    pedido.texto ?? '',
  );

export type SituacaoDaTarefa =
  | { situacao: 'processando' }
  | { situacao: 'erro'; codigo: string; frase: string; podeRepetir: boolean }
  | { situacao: 'pronto'; link: string; bytes: number; largura: number | null; altura: number | null; duracaoMs: number | null };

const inteiroPositivo = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n > 0;

/** O link do resultado: só https (ou a máquina local, em teste) e só na origem do Graph da configuração. */
export function linkValido(link: unknown, origem: string): link is string {
  if (typeof link !== 'string' || link.length > 2048) return false;
  try {
    const u = new URL(link);
    return u.origin === origem && !u.username && !u.password && (u.protocol === 'https:' || LOCAIS.includes(u.hostname));
  } catch {
    return false;
  }
}

/** A resposta da `ajustar_video` ou da `consultar_criacao`, conferida. Fora do formato devolve `null`. */
export function lerTarefa(dados: unknown, origem: string): (SituacaoDaTarefa & { tarefa: string }) | null {
  const d = dados as Record<string, unknown> | null;
  const tarefa = texto(d?.tarefa);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tarefa)) return null;
  if (d?.situacao === 'processando') return { tarefa, situacao: 'processando' };
  if (d?.situacao === 'erro') {
    const e = d.erro as Record<string, unknown> | null;
    return {
      tarefa,
      situacao: 'erro',
      codigo: texto(e?.codigo).slice(0, 40) || 'processar',
      frase: texto(e?.mensagem).slice(0, 300) || 'Não deu para ajustar este vídeo.',
      podeRepetir: e?.podeRepetir === true,
    };
  }
  if (d?.situacao !== 'pronto') return null;
  const r = d.resultado as Record<string, unknown> | null;
  if (r?.mimeType !== 'video/mp4' || !linkValido(r?.link, origem) || !inteiroPositivo(r?.bytes) || r.bytes > RESULTADO_MAX_BYTES) return null;
  const duracao = r.duracaoSegundos;
  return {
    tarefa,
    situacao: 'pronto',
    link: r.link,
    bytes: r.bytes,
    largura: inteiroPositivo(r.largura) ? r.largura : null,
    altura: inteiroPositivo(r.altura) ? r.altura : null,
    duracaoMs: typeof duracao === 'number' && Number.isFinite(duracao) && duracao > 0 ? Math.round(duracao * 1000) : null,
  };
}

/** O MP4 tem a caixa `ftyp` nos primeiros bytes. Confere o que veio antes de guardar como mídia. */
export const pareceMp4 = (b: Buffer): boolean => b.length > 12 && b.toString('latin1', 4, 8) === 'ftyp';

export type FalhaDoGraph = { codigo: string; frase: string; podeRepetir: boolean; ligacaoDesfeita: boolean };

/** Toda falha da porta vira uma frase que diz o que fazer. Nunca a mensagem crua: ela pode citar a credencial. */
export function falhaDoGraph(e: unknown): FalhaDoGraph {
  const f = (codigo: string, frase: string, podeRepetir: boolean, ligacaoDesfeita = false): FalhaDoGraph => ({ codigo, frase, podeRepetir, ligacaoDesfeita });
  if (!(e instanceof ErroMcp)) return f('erro', 'Não deu para falar com o DMS Graph agora. Tente de novo em instantes.', true);
  if (e.tipo === 'ligacao') return f('ligacao-desfeita', 'O acesso foi tirado no DMS Graph. Conecte de novo em Configuração › Integrações.', false, true);
  if (e.tipo === 'permissao') return f('sem-permissao', 'O DMS Graph não liberou o ajuste de vídeo para esta conta. Conecte de novo em Configuração › Integrações.', false);
  if (e.tipo === 'limite') return f('ocupado', 'Muitos pedidos ao DMS Graph agora. Tente de novo em alguns segundos.', true);
  if (e.tipo === 'indisponivel') return f('indisponivel', 'O DMS Graph está indisponível agora. Tente de novo em alguns minutos.', true);
  if (e.tipo === 'sem-resposta') return f('demora', 'O DMS Graph demorou para responder. Tente de novo em instantes.', true);
  if (e.tipo === 'ferramenta') {
    const d = e.dados && typeof e.dados === 'object' ? (e.dados as Record<string, unknown>) : {};
    // A frase da ferramenta foi escrita para a pessoa e não leva dado da conta.
    return f(texto(d.codigo).slice(0, 40) || 'recusada', e.frase || 'O DMS Graph não aceitou este pedido.', d.pode_repetir === true);
  }
  return f('erro', 'O DMS Graph não aceitou o pedido agora. Tente de novo; se continuar, fale com o suporte.', false);
}

export const FRASE_ACIMA_DO_LIMITE = 'Este vídeo passa de 12 MB. Ele continua valendo no modelo como está. Para ajustar, envie uma versão menor.';
