/**
 * Cifra do token de acesso de cada cliente.
 *
 * O token que a Meta emite no Embedded Signup permite enviar mensagem em nome
 * do cliente, criar template na WABA dele e ler o histórico de entrega. Guardá-lo
 * em claro significa que um dump do banco — backup vazado, acesso indevido,
 * engano de permissão — entrega o WhatsApp de todos os clientes de uma vez.
 *
 * AES-256-GCM, e não AES-CBC: GCM é autenticado, então adulterar o texto
 * cifrado faz a decifragem FALHAR em vez de devolver lixo silencioso. Num
 * campo que vira credencial, essa diferença importa.
 *
 * Formato armazenado: `v1.<iv>.<tag>.<cifra>`, tudo em base64url.
 * O prefixo de versão existe para o dia da rotação de chave: dá para
 * identificar o que está no formato antigo, decifrar com a chave antiga e
 * regravar com a nova, sem adivinhação.
 */
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const ALGORITMO = 'aes-256-gcm';
const VERSAO = 'v1';
/** GCM recomenda 96 bits de IV: é o tamanho para o qual ele foi projetado. */
const TAMANHO_IV = 12;
const TAMANHO_TAG = 16;
const TAMANHO_CHAVE = 32;

export class CriptoIndisponivelError extends Error {
  constructor(motivo: string) {
    super(
      `Não é possível cifrar o token da Meta: ${motivo}. ` +
        'Defina META_TOKEN_CHAVE com 32 bytes em base64 (openssl rand -base64 32).',
    );
    this.name = 'CriptoIndisponivelError';
  }
}

export class TokenCorrompidoError extends Error {
  constructor(motivo: string) {
    // Sem detalhe do conteúdo: a mensagem vai para log, e log não é lugar de
    // fragmento de credencial.
    super(`Token guardado não pôde ser decifrado: ${motivo}.`);
    this.name = 'TokenCorrompidoError';
  }
}

function chave(bruta: string): Buffer {
  if (!bruta) throw new CriptoIndisponivelError('a chave não está definida');
  let b: Buffer;
  try {
    b = Buffer.from(bruta, 'base64');
  } catch {
    throw new CriptoIndisponivelError('a chave não é base64 válido');
  }
  if (b.length !== TAMANHO_CHAVE) {
    throw new CriptoIndisponivelError(
      `a chave tem ${b.length} bytes e precisa de ${TAMANHO_CHAVE}`,
    );
  }
  return b;
}

/**
 * Cifra o token. Cada chamada gera um IV novo — reusar IV em GCM quebra a
 * confidencialidade, não só a integridade, e é o erro clássico do modo.
 */
export function cifrarToken(claro: string, chaveBase64: string): string {
  if (!claro) throw new Error('Token vazio não deve ser cifrado.');
  const k = chave(chaveBase64);
  const iv = randomBytes(TAMANHO_IV);
  const cipher = createCipheriv(ALGORITMO, k, iv);
  const cifra = Buffer.concat([cipher.update(claro, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSAO,
    iv.toString('base64url'),
    tag.toString('base64url'),
    cifra.toString('base64url'),
  ].join('.');
}

export function decifrarToken(guardado: string, chaveBase64: string): string {
  if (!guardado) throw new TokenCorrompidoError('o campo está vazio');

  const partes = guardado.split('.');
  if (partes.length !== 4) {
    throw new TokenCorrompidoError('o formato não é v1.iv.tag.cifra');
  }
  const [versao, ivB64, tagB64, cifraB64] = partes as [string, string, string, string];
  if (versao !== VERSAO) {
    throw new TokenCorrompidoError(`versão desconhecida "${versao}"`);
  }

  const k = chave(chaveBase64);
  const iv = Buffer.from(ivB64, 'base64url');
  const tag = Buffer.from(tagB64, 'base64url');
  const cifra = Buffer.from(cifraB64, 'base64url');

  if (iv.length !== TAMANHO_IV) throw new TokenCorrompidoError('IV com tamanho errado');
  if (tag.length !== TAMANHO_TAG) throw new TokenCorrompidoError('tag com tamanho errado');

  try {
    const decipher = createDecipheriv(ALGORITMO, k, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(cifra), decipher.final()]).toString('utf8');
  } catch {
    // A falha aqui quase sempre significa chave trocada ou dado adulterado.
    // Não repassamos o erro do OpenSSL: ele não acrescenta nada e o texto varia
    // entre versões.
    throw new TokenCorrompidoError('a autenticação do conteúdo falhou (chave errada ou dado alterado)');
  }
}

/**
 * Mascara um token para aparecer em tela ou log sem virar vazamento.
 * Mostra os 4 últimos caracteres — o suficiente para alguém conferir "é este
 * mesmo?" sem que o valor sirva para nada.
 */
export function mascararToken(claro: string): string {
  if (!claro) return '';
  if (claro.length <= 8) return '••••';
  return `••••${claro.slice(-4)}`;
}

/**
 * Compara dois segredos em tempo constante. Usado na verificação do
 * `hub.verify_token` do webhook: comparar com `===` vaza, pelo tempo de
 * resposta, quantos caracteres iniciais o atacante acertou.
 */
export function segredosIguais(a: string, b: string): boolean {
  const ba = Buffer.from(a ?? '', 'utf8');
  const bb = Buffer.from(b ?? '', 'utf8');
  // timingSafeEqual exige mesmo tamanho; comparar o tamanho antes já vazaria
  // essa informação, então normalizamos com hash de tamanho fixo seria o ideal
  // — aqui basta rejeitar cedo, porque o tamanho do verify token é público
  // (é o valor que nós mesmos configuramos).
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
