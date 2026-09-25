/**
 * Telefone: uma normalização só, para o produto inteiro.
 *
 * Este arquivo existe por causa de um defeito real. A tela de campanha aceitava
 * qualquer coisa entre 8 e 15 dígitos, então `21989751705` — o jeito como todo
 * brasileiro escreve o próprio número — passava sem o `55`. A Meta lia aquilo
 * como um número internacional que começa em `219…`, recusava, e o cliente
 * recebia um erro que não explicava nada.
 *
 * A causa não foi a validação frouxa: foi haver DUAS normalizações no produto.
 * A lista de espera já usava `libphonenumber-js`, que resolve esse caso desde
 * sempre; a campanha usava uma expressão regular própria. Enquanto forem duas,
 * o que uma aceita e a outra recusa volta a divergir.
 *
 * Duas representações, um parser:
 *
 * - `normalizarTelefoneE164` devolve **com o `+`** (`+5521989751705`), que é o
 *   E.164 canônico e o que a lista de espera guarda.
 * - `paraCloudApi` devolve **sem o `+`** (`5521989751705`), porque é o formato
 *   que a Cloud API aceita no campo `to` e o que `campanha_destinatario` e
 *   `contato` guardam.
 *
 * As duas saem do MESMO parse. Divergir deixa de ser possível.
 */
import { parsePhoneNumberFromString } from 'libphonenumber-js';

/**
 * País assumido quando o número vem sem DDI. O produto nasce no Brasil; um
 * cliente de fora informa o "+DDI" e o parser respeita.
 */
export const PAIS_PADRAO = 'BR' as const;

/** Devolve o número em E.164 **com** o "+", ou `null` se não for válido. */
export function normalizarTelefoneE164(bruto: unknown): string | null {
  if (typeof bruto !== 'string') return null;
  const limpo = bruto.trim();
  if (!limpo) return null;

  const numero = parsePhoneNumberFromString(limpo, PAIS_PADRAO);
  if (!numero || !numero.isValid()) return null;
  return String(numero.number);
}

export interface TelefoneDeEnvio {
  /** E.164 **sem** o "+", só dígitos. Vazio quando o número não é válido. */
  e164: string;
  /**
   * `true` quando o número veio sem DDI e assumimos o Brasil.
   *
   * A importação mostra esse total na prévia ("adicionamos o 55 a 412 números")
   * porque assumir em silêncio é como o defeito original começou: a decisão
   * estava certa na maioria das vezes, e invisível em todas.
   */
  assumiuPaisPadrao: boolean;
}

/** Número no formato que a Cloud API aceita, com a bandeira de país assumido. */
export function paraCloudApi(bruto: unknown): TelefoneDeEnvio {
  const e164 = normalizarTelefoneE164(bruto);
  if (!e164) return { e164: '', assumiuPaisPadrao: false };

  // Se o texto original já trazia DDI explícito ("+55…" ou "0055…"), não houve
  // suposição nossa. Qualquer outra forma foi interpretada como brasileira.
  const original = String(bruto).trim();
  const trouxeDdi = original.startsWith('+') || original.replace(/\D/g, '').startsWith('00');

  return { e164: e164.replace('+', ''), assumiuPaisPadrao: !trouxeDdi };
}

/**
 * Número como a META manda (`wa_id`, `from`, a agenda da coexistência) no
 * formato em que o `contato` guarda.
 *
 * Celular brasileiro cadastrado no WhatsApp antes do 9º dígito chega com 12
 * dígitos: `55 21 8975-1705`. A Meta entrega nos dois formatos, mas o contato
 * guarda com o 9. `paraCloudApi` aceita o de 12 como está (pelo formato, a
 * biblioteca não distingue celular antigo de fixo) — então, sem esta correção,
 * a mesma pessoa viraria dois contatos: um com o 9, outro sem.
 *
 * Só mexe no que é inequívoco: DDI 55, 12 dígitos e primeiro dígito do número
 * entre 6 e 9 (faixa de celular). Fixo (2 a 5) e número de fora passam como
 * vieram. Devolve só dígitos; a validação continua sendo a de `paraCloudApi`.
 */
export function doWhatsapp(bruto: unknown): string {
  const digitos = String(bruto ?? '').replace(/\D/g, '');
  if (/^55\d{2}[6-9]\d{7}$/.test(digitos)) return `${digitos.slice(0, 4)}9${digitos.slice(4)}`;
  return digitos;
}

/**
 * O mesmo celular brasileiro na OUTRA forma: com 13 dígitos devolve o de 12
 * (sem o 9º dígito), com 12 devolve o de 13. `null` para o resto — fixo,
 * número de fora, ou celular novo que nunca existiu sem o 9.
 *
 * Existe porque a base pode ter a pessoa nas duas formas: a importação de
 * arquivo guarda o número como veio (`paraCloudApi` aceita os dois), e a Meta
 * manda o `from` do jeito que o WhatsApp da pessoa foi cadastrado. Um pedido de
 * saída que bloqueasse só uma das formas deixaria a outra recebendo campanha.
 *
 * A mesma regra existe em SQL, em `gemeoEmSql` (telefone-sql.ts), e na
 * migration 026 — mudou aqui, muda lá.
 */
export function gemeoDoCelular(bruto: unknown): string | null {
  const d = String(bruto ?? '').replace(/\D/g, '');
  if (/^55\d{2}9[6-9]\d{7}$/.test(d)) return `${d.slice(0, 4)}${d.slice(5)}`;
  if (/^55\d{2}[6-9]\d{7}$/.test(d)) return `${d.slice(0, 4)}9${d.slice(4)}`;
  return null;
}

/**
 * Esconde o miolo do número para log e auditoria: `+5511*****4321`.
 * Nunca registramos o telefone inteiro.
 */
export function mascararTelefone(e164: string | null): string | null {
  if (!e164) return null;
  if (e164.length <= 8) return '*'.repeat(e164.length);
  return `${e164.slice(0, 5)}${'*'.repeat(e164.length - 9)}${e164.slice(-4)}`;
}
