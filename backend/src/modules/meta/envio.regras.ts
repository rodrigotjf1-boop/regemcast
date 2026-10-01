/**
 * O que um modelo exige NO ENVIO, além das variáveis do corpo — e como isso
 * vira o `components` que a Meta espera.
 *
 * Criar um modelo e enviar um modelo são dois formatos diferentes. Na criação a
 * Meta recebe um EXEMPLO de cada parte; no envio, o valor de verdade tem de ir
 * de novo, a cada mensagem: a mídia do cabeçalho, o código do cupom, a imagem de
 * cada cartão. Faltando um, ela recusa a mensagem (132000 / 132012).
 *
 * Três passos, cada um num lugar:
 *
 *   `exigenciasDoEnvio`  — lê os componentes que a Meta devolve do modelo e diz
 *                          o que ele pede. É a Meta quem define a forma (a
 *                          ordem dos botões, quantos cartões), não a nossa
 *                          cópia do modelo.
 *   `PlanoDeEnvio`       — as exigências com os valores resolvidos. Fica
 *                          gravado na campanha (`campanha.envio`).
 *   `componentesDoEnvio` — monta o JSON de UMA mensagem.
 *
 * Fontes (Meta, conferidas em 01/10/2026): "Media card carousel templates",
 * "Coupon code templates", "Limited-time offer templates", "Custom marketing
 * templates" e "Media" (upload para envio).
 */

/** Formato de mídia que um cabeçalho aceita. É também o nome do campo no envio (`image: {…}`). */
export type TipoDeMidia = 'image' | 'video' | 'document';

/** O que o modelo pede no envio, lido dos componentes que a Meta devolve. */
export interface ExigenciasDoEnvio {
  /** Cabeçalho: uma mídia, um texto com variável, ou nada a preencher. */
  cabecalho: TipoDeMidia | 'texto' | null;
  /** Oferta por tempo limitado com validade: o envio manda quando ela vence. */
  oferta: boolean;
  /** Posição do botão de copiar código na lista de botões da Meta; `null` = não tem. */
  cupomNoBotao: number | null;
  /** Os cartões do carrossel, em ordem. Vazio = não é carrossel. */
  cartoes: Array<{ tipo: 'image' | 'video'; respostas: Array<{ indice: number; texto: string }> }>;
  /**
   * O que este modelo pede e o disparo não sabe preencher — frases prontas para
   * completar "O modelo … ainda não pode ser disparado: …". Vazio = sabe tudo.
   */
  semSuporte: string[];
}

/** Uma resposta rápida de cartão: o envio a identifica pela posição. */
interface RespostaRapida {
  indice: number;
  texto: string;
}

/** Sem horas no modelo, a oferta vale este tanto depois de enviada (decisão do dono, 01/10/2026). */
export const HORAS_DA_OFERTA_PADRAO = 3;

/** As exigências com os valores resolvidos, como ficam gravadas em `campanha.envio`. */
export interface PlanoDeEnvio {
  /**
   * Cabeçalho de mídia: `midia:<uuid>` (arquivo guardado) ou um endereço
   * `https://`. Cabeçalho de texto com variável: o valor é de cada pessoa
   * (`campanha_destinatario.variavel_cabecalho`); aqui fica de onde ele saiu
   * (`origem` e `valor`, como as variáveis do corpo), para a tela reabrir o
   * rascunho preenchido.
   */
  cabecalho?: { tipo: TipoDeMidia; midia: string } | { tipo: 'texto'; origem?: string; valor?: string };
  /** Oferta por tempo limitado: por quantas horas vale depois de enviada. */
  oferta?: { horas: number };
  /** O botão de copiar código: a posição dele na Meta e o código. */
  cupom?: { indice: number; codigo: string };
  /** Os cartões do carrossel, em ordem. */
  cartoes?: Array<{ tipo: 'image' | 'video'; midia: string; respostas: RespostaRapida[] }>;
}

/** A mídia como a Meta a aceita no envio: o id de um arquivo já entregue a ela, ou um endereço público. */
export type MidiaNaMeta = { id: string; nomeArquivo?: string } | { link: string };

const TIPOS_DE_MIDIA: readonly string[] = ['image', 'video', 'document'];

/** `{{1}}` ou `{{nome}}`: qualquer variável, numerada ou nomeada. */
const VARIAVEL = /\{\{\s*[^{}\s][^{}]*\}\}/;

type Objeto = Record<string, unknown>;

const ehObjeto = (v: unknown): v is Objeto => typeof v === 'object' && v !== null && !Array.isArray(v);
const lista = (v: unknown): Objeto[] => (Array.isArray(v) ? v.filter(ehObjeto) : []);
const maiusculo = (v: unknown): string => (typeof v === 'string' ? v.toUpperCase() : '');
const texto = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * Lê os `components` de um modelo (como vêm de `GET /{waba}/message_templates`)
 * e diz o que o envio precisa mandar.
 *
 * Só entra em `semSuporte` o que a documentação diz que EXIGE parâmetro e o
 * disparo não preenche. Tipo de botão que não conhecemos não é recusado aqui:
 * se ele não pedir nada, o envio funciona como sempre funcionou; se pedir, a
 * Meta recusa a primeira mensagem e a campanha pausa (`pausa_motivo = modelo`).
 */
export function exigenciasDoEnvio(componentes: unknown): ExigenciasDoEnvio {
  const partes = lista(componentes);
  const achar = (tipo: string) => partes.find((c) => maiusculo(c.type) === tipo);
  const semSuporte: string[] = [];

  // ---- cabeçalho
  let cabecalho: ExigenciasDoEnvio['cabecalho'] = null;
  const cab = achar('HEADER');
  if (cab) {
    const formato = maiusculo(cab.format).toLowerCase();
    if (TIPOS_DE_MIDIA.includes(formato)) cabecalho = formato as TipoDeMidia;
    else if (formato === 'text') cabecalho = VARIAVEL.test(texto(cab.text)) ? 'texto' : null;
    else if (formato === 'location') semSuporte.push('o cabeçalho é uma localização');
    else if (formato) semSuporte.push(`o cabeçalho é de um tipo que não conhecemos (${formato})`);
  }

  // ---- oferta por tempo limitado
  const lto = achar('LIMITED_TIME_OFFER');
  const oferta = ehObjeto(lto?.limited_time_offer) && lto.limited_time_offer.has_expiration === true;

  // ---- botões
  const botoes = lista(achar('BUTTONS')?.buttons);
  const indiceDoCupom = botoes.findIndex((b) => maiusculo(b.type) === 'COPY_CODE');
  if (botoes.some((b) => maiusculo(b.type) === 'URL' && VARIAVEL.test(texto(b.url)))) {
    semSuporte.push('tem um botão de link com variável');
  }
  if (botoes.some((b) => maiusculo(b.type) === 'OTP')) {
    semSuporte.push('é um modelo de código de verificação');
  }

  // ---- carrossel
  const cartoes: ExigenciasDoEnvio['cartoes'] = [];
  const carrossel = achar('CAROUSEL');
  if (carrossel) {
    const problemas = new Set<string>();
    for (const cartao of lista(carrossel.cards)) {
      const dentro = lista(cartao.components);
      const cabecalhoDoCartao = dentro.find((c) => maiusculo(c.type) === 'HEADER');
      const formato = maiusculo(cabecalhoDoCartao?.format).toLowerCase();
      if (formato !== 'image' && formato !== 'video') {
        problemas.add('um cartão do carrossel não tem imagem nem vídeo');
        continue;
      }
      const corpoDoCartao = dentro.find((c) => maiusculo(c.type) === 'BODY');
      if (VARIAVEL.test(texto(corpoDoCartao?.text))) problemas.add('os cartões têm variável no texto');

      const botoesDoCartao = lista(dentro.find((c) => maiusculo(c.type) === 'BUTTONS')?.buttons);
      if (botoesDoCartao.some((b) => maiusculo(b.type) === 'URL' && VARIAVEL.test(texto(b.url)))) {
        problemas.add('os cartões têm botão de link com variável');
      }
      cartoes.push({
        tipo: formato,
        respostas: botoesDoCartao.flatMap((b, indice) =>
          maiusculo(b.type) === 'QUICK_REPLY' ? [{ indice, texto: texto(b.text) }] : [],
        ),
      });
    }
    semSuporte.push(...problemas);
  }

  return {
    cabecalho,
    oferta,
    cupomNoBotao: indiceDoCupom >= 0 ? indiceDoCupom : null,
    cartoes,
    semSuporte,
  };
}

/** O modelo só pede as variáveis do corpo: o envio é o de sempre. */
export function soPedeOCorpo(e: ExigenciasDoEnvio): boolean {
  return (
    e.cabecalho === null && !e.oferta && e.cupomNoBotao === null && e.cartoes.length === 0 && e.semSuporte.length === 0
  );
}

/**
 * O plano gravado em `campanha.envio`, conferido. `null` quando não há plano
 * (campanha antiga, modelo só de texto) ou quando o que está gravado não é um
 * plano — aí o envio é o de sempre, e a Meta diz se faltou algo.
 */
export function lerPlano(json: unknown): PlanoDeEnvio | null {
  if (!ehObjeto(json)) return null;
  const plano: PlanoDeEnvio = {};

  const cab = json.cabecalho;
  if (ehObjeto(cab) && TIPOS_DE_MIDIA.includes(texto(cab.tipo)) && texto(cab.midia)) {
    plano.cabecalho = { tipo: cab.tipo as TipoDeMidia, midia: texto(cab.midia) };
  } else if (ehObjeto(cab) && cab.tipo === 'texto') {
    plano.cabecalho = {
      tipo: 'texto',
      ...(texto(cab.origem) ? { origem: texto(cab.origem), valor: texto(cab.valor) } : {}),
    };
  }

  const oferta = json.oferta;
  if (ehObjeto(oferta) && typeof oferta.horas === 'number' && oferta.horas > 0) {
    plano.oferta = { horas: oferta.horas };
  }

  const cupom = json.cupom;
  if (ehObjeto(cupom) && Number.isInteger(cupom.indice) && texto(cupom.codigo)) {
    plano.cupom = { indice: cupom.indice as number, codigo: texto(cupom.codigo) };
  }

  const cartoes = lista(json.cartoes).flatMap((c) =>
    (c.tipo === 'image' || c.tipo === 'video') && texto(c.midia)
      ? [
          {
            tipo: c.tipo,
            midia: texto(c.midia),
            respostas: lista(c.respostas).flatMap((r) =>
              Number.isInteger(r.indice) ? [{ indice: r.indice as number, texto: texto(r.texto) }] : [],
            ),
          } as NonNullable<PlanoDeEnvio['cartoes']>[number],
        ]
      : [],
  );
  if (cartoes.length) plano.cartoes = cartoes;

  return Object.keys(plano).length ? plano : null;
}

/** Toda mídia que o plano usa — para subir à Meta uma vez, antes da rodada. */
export function midiasDoPlano(plano: PlanoDeEnvio | null): string[] {
  if (!plano) return [];
  return [
    ...new Set([
      ...(plano.cabecalho && plano.cabecalho.tipo !== 'texto' ? [plano.cabecalho.midia] : []),
      ...(plano.cartoes ?? []).map((c) => c.midia),
    ]),
  ];
}

/** Faltou a mídia que o plano pede: erro de programação de quem chamou, não da Meta. */
export class MidiaForaDoPlano extends Error {
  constructor(readonly referencia: string) {
    super(`A mídia ${referencia} do plano de envio não foi resolvida.`);
  }
}

/** O parâmetro de mídia do jeito que a Meta espera: `{ type: "image", image: { id } }`. */
function parametroDeMidia(tipo: TipoDeMidia, referencia: string, midias: ReadonlyMap<string, MidiaNaMeta>) {
  const midia = midias.get(referencia);
  if (!midia) throw new MidiaForaDoPlano(referencia);
  const alvo: Record<string, string> = 'id' in midia ? { id: midia.id } : { link: midia.link };
  // Documento chega como arquivo: sem nome, o WhatsApp mostra "Untitled".
  if (tipo === 'document' && 'id' in midia && midia.nomeArquivo) alvo.filename = midia.nomeArquivo;
  return { type: tipo, [tipo]: alvo };
}

/** O que muda de uma mensagem para a outra, e o que a rodada resolveu uma vez. */
export interface DadosDoEnvio {
  /** As variáveis do corpo desta pessoa, em ordem. */
  variaveis: readonly string[];
  /** O valor da variável do título para esta pessoa. */
  cabecalhoTexto?: string | null;
  /** As mídias do plano, já entregues à Meta (ou o endereço público delas). */
  midias: ReadonlyMap<string, MidiaNaMeta>;
  /** O instante do envio: a oferta por tempo limitado vence a partir dele. */
  agora: Date;
}

/** A variável do título chegou vazia: a Meta recusaria a mensagem (132000). */
export class CabecalhoSemValor extends Error {
  constructor() {
    super('O modelo tem variável no título e este destinatário ficou sem valor para ela.');
  }
}

/**
 * O `template.components` de UMA mensagem. `undefined` quando não há nada a
 * mandar — a Meta recusa `components` vazio num modelo sem variável (132000).
 *
 * A ordem é a dos exemplos da Meta: cabeçalho, corpo, oferta, botões, carrossel.
 */
export function componentesDoEnvio(
  plano: PlanoDeEnvio | null,
  dados: DadosDoEnvio,
): Record<string, unknown>[] | undefined {
  const componentes: Record<string, unknown>[] = [];

  if (plano?.cabecalho?.tipo === 'texto') {
    const valor = (dados.cabecalhoTexto ?? '').trim();
    if (!valor) throw new CabecalhoSemValor();
    componentes.push({ type: 'header', parameters: [{ type: 'text', text: valor }] });
  } else if (plano?.cabecalho) {
    componentes.push({
      type: 'header',
      parameters: [parametroDeMidia(plano.cabecalho.tipo, plano.cabecalho.midia, dados.midias)],
    });
  }

  if (dados.variaveis.length) {
    componentes.push({ type: 'body', parameters: dados.variaveis.map((v) => ({ type: 'text', text: v })) });
  }

  if (plano?.oferta) {
    // Instante ABSOLUTO, em milissegundos. O exemplo da própria Meta traz
    // 1209600000 (14 dias, uma duração) e contradiz a descrição do campo
    // ("UNIX timestamp in milliseconds"); vale a descrição.
    componentes.push({
      type: 'limited_time_offer',
      parameters: [
        {
          type: 'limited_time_offer',
          limited_time_offer: { expiration_time_ms: dados.agora.getTime() + plano.oferta.horas * 3_600_000 },
        },
      ],
    });
  }

  if (plano?.cupom) {
    componentes.push({
      type: 'button',
      sub_type: 'copy_code',
      index: plano.cupom.indice,
      parameters: [{ type: 'coupon_code', coupon_code: plano.cupom.codigo }],
    });
  }

  if (plano?.cartoes?.length) {
    componentes.push({
      type: 'carousel',
      cards: plano.cartoes.map((cartao, card_index) => ({
        card_index,
        components: [
          { type: 'header', parameters: [parametroDeMidia(cartao.tipo, cartao.midia, dados.midias)] },
          // A resposta rápida volta no aviso da Meta com este `payload`: o
          // próprio texto do botão, que é o que o pedido de saída procura.
          ...cartao.respostas.map((r) => ({
            type: 'button',
            sub_type: 'quick_reply',
            index: r.indice,
            parameters: [{ type: 'payload', payload: r.texto }],
          })),
        ],
      })),
    });
  }

  return componentes.length ? componentes : undefined;
}
