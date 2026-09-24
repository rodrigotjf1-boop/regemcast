/**
 * Conversas do WhatsApp — a leitura dos avisos da Meta, sem banco.
 *
 * Três portas trazem mensagem para uma conversa, cada uma com seu formato
 * (conferido na documentação oficial em 24/09/2026):
 *
 *   `messages`           value.messages[]       — o cliente escreveu (ao vivo)
 *   `smb_message_echoes` value.message_echoes[] — o lojista respondeu pelo celular
 *                                                 (`from` = empresa, `to` = cliente)
 *   `history`            value.history[].threads[].messages[] — os 6 meses copiados
 *                        (thread.id = cliente; `from` = quem mandou)
 *                        value.messages[]       — mídia dos últimos 14 dias, num
 *                                                 aviso à parte, com o MESMO wamid
 *
 * Tudo vira `MensagemNormalizada`, no formato da tabela `mensagem`. O telefone
 * da pessoa passa por `doWhatsapp` (o 9º dígito) para casar com o `contato`.
 */
import { doWhatsapp, paraCloudApi } from '../../common/telefone';

export type Direcao = 'entrada' | 'saida';
export type OrigemMensagem = 'cliente' | 'celular' | 'painel' | 'historico' | 'campanha';
export type StatusMensagem = 'enviando' | 'enviada' | 'entregue' | 'lida' | 'falhou';

export interface MensagemNormalizada {
  wamid: string;
  /** A pessoa, no formato do `contato` (sem '+', com o 55 e o 9º dígito). */
  telefone: string;
  direcao: Direcao;
  origem: OrigemMensagem;
  tipo: string;
  texto: string | null;
  midiaId: string | null;
  midiaMime: string | null;
  midiaNome: string | null;
  /** Só saída. */
  status: StatusMensagem | null;
  /** A data ORIGINAL, do WhatsApp. */
  criadaEm: Date;
}

export interface StatusRecebido {
  wamid: string;
  status: StatusMensagem;
  erroCodigo: number | null;
  erroTitulo: string | null;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});
const lista = (v: unknown): Obj[] => (Array.isArray(v) ? (v as Obj[]) : []);
const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** A pessoa no formato do contato, ou '' se não for telefone. */
export function telefoneDaPessoa(bruto: unknown): string {
  const digitos = doWhatsapp(bruto);
  return digitos ? paraCloudApi(`+${digitos}`).e164 : '';
}

/** Segundos (texto ou número) → Date. Sem data, agora — melhor que perder a mensagem. */
function dataDe(timestamp: unknown): Date {
  const s = Number(timestamp);
  return Number.isFinite(s) && s > 0 ? new Date(s * 1000) : new Date();
}

/**
 * Status da Meta → o nosso. Serve aos dois formatos: o do webhook de status
 * (`sent`, `delivered`…) e o do histórico (`history_context.status`, em
 * maiúsculas: `READ`, `DELIVERED`, `PLAYED`…).
 */
const STATUS_DA_META: Record<string, StatusMensagem> = {
  pending: 'enviando',
  sent: 'enviada',
  delivered: 'entregue',
  read: 'lida',
  played: 'lida',
  failed: 'falhou',
  error: 'falhou',
};

export function statusDaMeta(bruto: unknown): StatusMensagem | null {
  return typeof bruto === 'string' ? (STATUS_DA_META[bruto.toLowerCase()] ?? null) : null;
}

/** O conteúdo de uma mensagem da Cloud API, por tipo. Tipo novo não quebra: vira texto nulo. */
export function conteudo(m: Obj): Pick<MensagemNormalizada, 'tipo' | 'texto' | 'midiaId' | 'midiaMime' | 'midiaNome'> {
  const tipo = typeof m.type === 'string' && m.type ? m.type : 'unsupported';
  const corpo = obj(m[tipo]);
  const vazio = { tipo, texto: null, midiaId: null, midiaMime: null, midiaNome: null };

  switch (tipo) {
    case 'text':
      return { ...vazio, texto: texto(corpo.body) };
    case 'image':
    case 'video':
    case 'audio':
    case 'sticker':
    case 'document':
      return {
        ...vazio,
        texto: texto(corpo.caption),
        midiaId: texto(corpo.id),
        midiaMime: texto(corpo.mime_type),
        midiaNome: tipo === 'document' ? texto(corpo.filename) : null,
      };
    case 'location': {
      const partes = [texto(corpo.name), texto(corpo.address)].filter(Boolean);
      const coordenadas =
        typeof corpo.latitude === 'number' && typeof corpo.longitude === 'number'
          ? `${corpo.latitude}, ${corpo.longitude}`
          : null;
      return { ...vazio, texto: partes.length ? partes.join(' — ') : coordenadas };
    }
    case 'contacts': {
      const nomes = lista(m.contacts).map((c) => texto(obj(c.name).formatted_name)).filter(Boolean);
      return { ...vazio, texto: nomes.length ? nomes.join(', ') : null };
    }
    case 'interactive': {
      const resposta = obj(corpo.button_reply ?? corpo.list_reply);
      return { ...vazio, texto: texto(resposta.title) };
    }
    case 'button':
      return { ...vazio, texto: texto(corpo.text) ?? texto(corpo.payload) };
    case 'reaction':
      return { ...vazio, texto: texto(corpo.emoji) };
    case 'system':
      return { ...vazio, texto: texto(corpo.body) };
    default:
      return vazio;
  }
}

/** O trecho que a lista de conversas mostra. */
export function resumoDaMensagem(tipo: string, conteudoTexto: string | null): string {
  const t = conteudoTexto?.replace(/\s+/g, ' ').trim() ?? '';
  const rotulo: Record<string, string> = {
    image: '📷 Foto',
    video: '🎥 Vídeo',
    audio: '🎤 Áudio',
    document: '📄 Documento',
    sticker: 'Figurinha',
    location: '📍 Localização',
    contacts: '👤 Contato',
  };
  if (tipo === 'reaction') return t ? `Reagiu com ${t}` : 'Reação';
  const base = t || rotulo[tipo] || '[mensagem]';
  return base.length > 120 ? `${base.slice(0, 119)}…` : base;
}

function montar(
  m: Obj,
  telefone: string,
  direcao: Direcao,
  origem: OrigemMensagem,
  status: StatusMensagem | null,
): MensagemNormalizada | null {
  const wamid = texto(m.id);
  if (!wamid || !telefone) return null;
  return {
    wamid,
    telefone,
    direcao,
    origem,
    ...conteudo(m),
    status: direcao === 'saida' ? status : null,
    criadaEm: dataDe(m.timestamp),
  };
}

/** `messages`: o que o cliente escreveu, e o nome de perfil de cada um. */
export function mensagensRecebidas(value: Obj): { mensagens: MensagemNormalizada[]; nomes: Map<string, string> } {
  const nomes = new Map<string, string>();
  for (const c of lista(value.contacts)) {
    const telefone = telefoneDaPessoa(c.wa_id);
    const nome = texto(obj(c.profile).name);
    if (telefone && nome) nomes.set(telefone, nome);
  }
  const mensagens = lista(value.messages)
    .map((m) => montar(m, telefoneDaPessoa(m.from), 'entrada', 'cliente', null))
    .filter((m): m is MensagemNormalizada => m !== null);
  return { mensagens, nomes };
}

/** `smb_message_echoes`: o que o lojista respondeu pelo aplicativo do celular. */
export function ecosDoCelular(value: Obj): MensagemNormalizada[] {
  return lista(value.message_echoes)
    .map((m) => montar(m, telefoneDaPessoa(m.to), 'saida', 'celular', 'enviada'))
    .filter((m): m is MensagemNormalizada => m !== null);
}

/**
 * `history`: os lotes de conversa e o aviso à parte com a mídia recente.
 *
 * Direção pelo remetente: quem mandou é o cliente da thread → entrada; senão,
 * foi a empresa → saída. No aviso de mídia não há thread: se `from` é a
 * empresa, a pessoa está em `to`; sem `to`, não dá para saber a conversa, e a
 * mensagem fica de fora (o texto dela já veio no lote da thread).
 */
export function mensagensDoHistorico(value: Obj): MensagemNormalizada[] {
  const empresa = telefoneDaPessoa(obj(value.metadata).display_phone_number);
  const saida: MensagemNormalizada[] = [];

  for (const item of lista(value.history)) {
    for (const thread of lista(item.threads)) {
      const pessoa = telefoneDaPessoa(thread.id);
      if (!pessoa) continue;
      for (const m of lista(thread.messages)) {
        const doCliente = telefoneDaPessoa(m.from) === pessoa;
        const status = statusDaMeta(obj(m.history_context).status);
        const nova = montar(m, pessoa, doCliente ? 'entrada' : 'saida', 'historico', status);
        if (nova) saida.push(nova);
      }
    }
  }

  for (const m of lista(value.messages)) {
    const remetente = telefoneDaPessoa(m.from);
    const daEmpresa = !!empresa && remetente === empresa;
    const pessoa = daEmpresa ? telefoneDaPessoa(m.to) : remetente;
    const nova = montar(m, pessoa, daEmpresa ? 'saida' : 'entrada', 'historico', daEmpresa ? 'enviada' : null);
    if (nova) saida.push(nova);
  }

  return saida;
}

/** Status de entrega do webhook `messages` (enviada, entregue, lida, falhou). */
export function statusesRecebidos(value: Obj): StatusRecebido[] {
  return lista(value.statuses)
    .map((s) => {
      const wamid = texto(s.id);
      const status = statusDaMeta(s.status);
      if (!wamid || !status) return null;
      const erro = lista(s.errors)[0];
      return {
        wamid,
        status,
        erroCodigo: erro && Number.isFinite(Number(erro.code)) ? Number(erro.code) : null,
        erroTitulo: erro ? texto(erro.title) ?? texto(erro.message) : null,
      };
    })
    .filter((s): s is StatusRecebido => s !== null);
}

/**
 * Uma linha por wamid. O mesmo lote pode repetir a mensagem — e um `insert ...
 * on conflict do update` que toca a mesma linha duas vezes aborta o comando
 * inteiro. Mantém a versão com mídia, se houver.
 */
export function deduplicar(mensagens: MensagemNormalizada[]): MensagemNormalizada[] {
  const porWamid = new Map<string, MensagemNormalizada>();
  for (const m of mensagens) {
    const atual = porWamid.get(m.wamid);
    if (!atual) porWamid.set(m.wamid, m);
    else if (!atual.midiaId && m.midiaId) {
      porWamid.set(m.wamid, { ...atual, midiaId: m.midiaId, midiaMime: m.midiaMime, midiaNome: m.midiaNome ?? atual.midiaNome });
    }
  }
  return [...porWamid.values()];
}

/**
 * Os totais de uma conversa a partir das mensagens NOVAS de um lote.
 *
 * - não lidas: só mensagem do cliente AO VIVO conta (histórico é passado); se o
 *   lojista respondeu no lote (painel ou celular), zera e conta só o que veio
 *   depois da resposta;
 * - janela de 24h: a última mensagem do cliente, ao vivo ou do histórico.
 */
export function totaisDoLote(novas: Array<Pick<MensagemNormalizada, 'direcao' | 'origem' | 'tipo' | 'texto' | 'criadaEm'>>) {
  const ordenadas = [...novas].sort((a, b) => a.criadaEm.getTime() - b.criadaEm.getTime());
  const ultima = ordenadas[ordenadas.length - 1]!;
  const entradas = ordenadas.filter((m) => m.direcao === 'entrada');
  const respostas = ordenadas.filter((m) => m.direcao === 'saida' && (m.origem === 'painel' || m.origem === 'celular'));
  const ultimaResposta = respostas.length ? respostas[respostas.length - 1]!.criadaEm : null;
  const novasNaoLidas = ordenadas.filter(
    (m) => m.direcao === 'entrada' && m.origem === 'cliente' && (!ultimaResposta || m.criadaEm > ultimaResposta),
  ).length;

  return {
    ultimaMensagemEm: ultima.criadaEm,
    ultimaMensagem: resumoDaMensagem(ultima.tipo, ultima.texto),
    ultimaEntradaEm: entradas.length ? entradas[entradas.length - 1]!.criadaEm : null,
    zerarNaoLidas: ultimaResposta !== null,
    novasNaoLidas,
  };
}
