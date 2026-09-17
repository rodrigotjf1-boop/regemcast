/**
 * Código de verificação em duas etapas (TOTP, RFC 6238).
 *
 * É o código de 6 dígitos que o Google Authenticator, o Authy ou o aplicativo
 * da Microsoft mostram, e que muda a cada 30 segundos.
 *
 * Implementado aqui, e não com biblioteca, porque são quarenta linhas de um
 * algoritmo público e estável — e o teste confere contra os vetores OFICIAIS
 * da própria RFC. Uma dependência a mais na rotina que protege o console de
 * todas as contas é superfície a mais para auditar, não a menos.
 *
 * O que cada parte evita:
 *
 * - **Janela de ±1 passo.** O relógio do celular raramente bate com o do
 *   servidor. Sem tolerância, o código digitado no fim dos 30 segundos chega
 *   já vencido e a pessoa acha que digitou errado.
 * - **Comparação em tempo constante.** Comparar os dígitos com `===` devolve,
 *   pelo tempo de resposta, quantos acertaram.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ALFABETO_BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Bytes → base32 (RFC 4648), o formato que os aplicativos autenticadores leem. */
export function paraBase32(bytes: Buffer): string {
  let bits = 0;
  let valor = 0;
  let saida = '';

  for (const byte of bytes) {
    valor = (valor << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      saida += ALFABETO_BASE32[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) saida += ALFABETO_BASE32[(valor << (5 - bits)) & 31];

  return saida;
}

/** base32 → bytes. Tolera espaços e minúsculas, que é como as pessoas digitam. */
export function deBase32(texto: string): Buffer {
  const limpo = texto.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let valor = 0;
  const saida: number[] = [];

  for (const letra of limpo) {
    const indice = ALFABETO_BASE32.indexOf(letra);
    if (indice < 0) throw new Error('Segredo em base32 inválido.');
    valor = (valor << 5) | indice;
    bits += 5;
    if (bits >= 8) {
      saida.push((valor >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(saida);
}

/** Um segredo novo: 20 bytes, o tamanho recomendado para HMAC-SHA1. */
export function novoSegredo(): string {
  return paraBase32(randomBytes(20));
}

/**
 * O código de um passo de tempo (RFC 4226, HOTP).
 *
 * `digitos` existe para o teste: os vetores da RFC 6238 usam 8 dígitos, os
 * aplicativos usam 6.
 */
export function codigoDoPasso(segredo: Buffer, passo: number, digitos = 6): string {
  const contador = Buffer.alloc(8);
  // Passo cabe em 53 bits com folga; escrito como dois inteiros de 32 bits.
  contador.writeUInt32BE(Math.floor(passo / 0x100000000), 0);
  contador.writeUInt32BE(passo >>> 0, 4);

  const hmac = createHmac('sha1', segredo).update(contador).digest();

  // Truncamento dinâmico: o último nibble diz de onde tirar os 4 bytes.
  const deslocamento = hmac[hmac.length - 1] & 0xf;
  const binario =
    ((hmac[deslocamento] & 0x7f) << 24) |
    ((hmac[deslocamento + 1] & 0xff) << 16) |
    ((hmac[deslocamento + 2] & 0xff) << 8) |
    (hmac[deslocamento + 3] & 0xff);

  return String(binario % 10 ** digitos).padStart(digitos, '0');
}

export const PASSO_SEGUNDOS = 30;

/** Passo de tempo de um instante. */
export function passoDe(instante: Date): number {
  return Math.floor(instante.getTime() / 1000 / PASSO_SEGUNDOS);
}

/**
 * O código digitado confere?
 *
 * Aceita o passo atual e um para cada lado — o relógio do celular raramente
 * bate exatamente com o do servidor.
 */
export function codigoConfere(segredoBase32: string, digitado: string, agora = new Date()): boolean {
  return passoDoCodigo(segredoBase32, digitado, agora) !== null;
}

/**
 * Em qual passo de tempo o código digitado está — ou `null` se não confere.
 *
 * É o passo que torna o código de USO ÚNICO: quem confere grava o último passo
 * aceito e recusa qualquer código do mesmo passo ou de antes. Sem isso, o mesmo
 * código vale por até 90 segundos, e quem o viu por cima do ombro entra junto.
 */
export function passoDoCodigo(segredoBase32: string, digitado: string, agora = new Date()): number | null {
  const limpo = String(digitado ?? '').replace(/\D/g, '');
  if (limpo.length !== 6) return null;

  let segredo: Buffer;
  try {
    segredo = deBase32(segredoBase32);
  } catch {
    return null;
  }

  const passo = passoDe(agora);
  let achado: number | null = null;

  // Percorre os TRÊS passos sempre, mesmo depois de achar: parar no primeiro
  // acerto devolveria, pelo tempo, em qual passo o código estava.
  for (const delta of [-1, 0, 1]) {
    const esperado = Buffer.from(codigoDoPasso(segredo, passo + delta));
    if (timingSafeEqual(esperado, Buffer.from(limpo))) achado = passo + delta;
  }

  return achado;
}

/**
 * O endereço que vira QR code no aplicativo autenticador.
 *
 * O `issuer` aparece como o nome da conta no aplicativo — é o que a pessoa lê
 * para saber qual dos códigos é o do console.
 */
export function enderecoParaAplicativo(segredoBase32: string, email: string, emissorNome?: string): string {
  const emissor = emissorNome ?? 'RegemCast Distribuição';
  const rotulo = encodeURIComponent(`${emissor}:${email}`);
  const parametros = new URLSearchParams({
    secret: segredoBase32,
    issuer: emissor,
    algorithm: 'SHA1',
    digits: '6',
    period: String(PASSO_SEGUNDOS),
  });
  return `otpauth://totp/${rotulo}?${parametros.toString()}`;
}
