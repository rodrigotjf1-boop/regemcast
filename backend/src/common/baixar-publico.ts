/**
 * Baixa um arquivo de um endereço informado pelo CLIENTE, sem abrir a rede
 * interna para ele.
 *
 * Um `fetch(url)` direto deixa qualquer usuário logado fazer o servidor bater
 * em `http://localhost`, no painel da VPS, em serviços da rede do Docker ou no
 * endereço de metadados da nuvem — e a mensagem de erro ("respondeu 404")
 * devolve o que tem lá. Também lia o arquivo inteiro para a memória antes de
 * conferir o tamanho: um endereço de vários GB derrubava a API de todo mundo.
 *
 * Regras:
 *
 * - só `https`, porta 443, sem usuário/senha no endereço;
 * - o IP é conferido NA HORA DE CONECTAR (no `lookup` do socket), não antes:
 *   conferir antes e deixar o fetch resolver de novo abre a porta para o DNS
 *   trocar a resposta entre as duas consultas;
 * - redirecionamento é seguido no máximo 3 vezes, cada destino passando pelas
 *   mesmas regras;
 * - o download é cortado ao passar do limite, sem esperar o fim.
 */
import { lookup as lookupDns, type LookupAddress } from 'node:dns';
import https from 'node:https';
import { BlockList, isIP } from 'node:net';

export class EnderecoRecusado extends Error {}

const BLOQUEADOS = new BlockList();
// IPv4 que não é internet pública.
for (const [rede, prefixo] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  BLOQUEADOS.addSubnet(rede, prefixo, 'ipv4');
}
// IPv6 que não é internet pública. O IPv4 embutido (::ffff:a.b.c.d) NÃO entra
// aqui: o BlockList aplica regra IPv6 também na checagem de IPv4, e a faixa
// ::ffff:0:0/96 bloquearia todo IPv4. Ele é tratado em `ipPublico`.
for (const [rede, prefixo] of [
  ['::', 128],
  ['::1', 128],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  BLOQUEADOS.addSubnet(rede, prefixo, 'ipv6');
}

/** O IP é de internet pública? IPv4 embutido em IPv6 é conferido como IPv4. */
export function ipPublico(ip: string): boolean {
  const versao = isIP(ip);
  if (versao === 4) return !BLOQUEADOS.check(ip, 'ipv4');
  if (versao === 6) {
    const mapeado = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
    if (mapeado) return !BLOQUEADOS.check(mapeado[1], 'ipv4');
    return !BLOQUEADOS.check(ip, 'ipv6');
  }
  return false;
}

/** Confere a forma do endereço. Devolve a URL já interpretada. */
export function conferirEndereco(bruto: string): URL {
  let url: URL;
  try {
    url = new URL(bruto);
  } catch {
    throw new EnderecoRecusado('Endereço inválido.');
  }
  if (url.protocol !== 'https:') throw new EnderecoRecusado('Use um endereço https://.');
  if (url.username || url.password) throw new EnderecoRecusado('O endereço não pode ter usuário e senha.');
  if (url.port && url.port !== '443') throw new EnderecoRecusado('O endereço precisa usar a porta padrão do https.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && !ipPublico(host)) throw new EnderecoRecusado('Esse endereço não é público.');
  return url;
}

/** Resolve o nome e só entrega ao socket endereço público. */
function lookupSeguro(
  hostname: string,
  opcoes: object,
  cb: (erro: NodeJS.ErrnoException | null, endereco: string | LookupAddress[], familia?: number) => void,
): void {
  lookupDns(hostname, { all: true }, (erro, enderecos) => {
    if (erro) return cb(erro, '', 0);
    const lista = enderecos as LookupAddress[];
    if (!lista.length || lista.some((e) => !ipPublico(e.address))) {
      return cb(Object.assign(new Error('endereço não público'), { code: 'ENDERECO_PRIVADO' }), '', 0);
    }
    if ((opcoes as { all?: boolean }).all) return cb(null, lista);
    cb(null, lista[0].address, lista[0].family);
  });
}

export interface ArquivoBaixado {
  conteudo: Buffer;
  tipoMime: string;
}

export class DownloadFalhou extends Error {
  constructor(
    mensagem: string,
    readonly motivo: 'rede' | 'status' | 'grande' | 'privado' | 'redirecionamento',
  ) {
    super(mensagem);
  }
}

/**
 * Baixa o endereço respeitando as regras acima.
 *
 * `limiteBytes` é o teto absoluto; quem chama confere o teto por tipo depois.
 */
export async function baixarPublico(
  bruto: string,
  { limiteBytes, timeoutMs = 20_000 }: { limiteBytes: number; timeoutMs?: number },
): Promise<ArquivoBaixado> {
  let url = conferirEndereco(bruto);

  for (let salto = 0; salto <= 3; salto++) {
    const resposta = await pedir(url, limiteBytes, timeoutMs);
    if ('redirecionar' in resposta) {
      if (salto === 3) throw new DownloadFalhou('redirecionamentos demais', 'redirecionamento');
      try {
        url = conferirEndereco(new URL(resposta.redirecionar, url).toString());
      } catch (erro) {
        if (erro instanceof EnderecoRecusado) throw new DownloadFalhou(erro.message, 'privado');
        throw erro;
      }
      continue;
    }
    return resposta;
  }
  throw new DownloadFalhou('redirecionamentos demais', 'redirecionamento');
}

function pedir(
  url: URL,
  limiteBytes: number,
  timeoutMs: number,
): Promise<ArquivoBaixado | { redirecionar: string }> {
  return new Promise((resolver, rejeitar) => {
    const req = https.get(
      url,
      { lookup: lookupSeguro as never, timeout: timeoutMs, headers: { 'User-Agent': 'RegemCast/1.0' } },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          return resolver({ redirecionar: res.headers.location });
        }
        if (status < 200 || status >= 300) {
          res.resume();
          return rejeitar(new DownloadFalhou(`status ${status}`, 'status'));
        }
        const declarado = Number(res.headers['content-length'] ?? 0);
        if (declarado > limiteBytes) {
          res.destroy();
          return rejeitar(new DownloadFalhou('arquivo grande demais', 'grande'));
        }

        const partes: Buffer[] = [];
        let total = 0;
        res.on('data', (parte: Buffer) => {
          total += parte.length;
          if (total > limiteBytes) {
            res.destroy();
            rejeitar(new DownloadFalhou('arquivo grande demais', 'grande'));
            return;
          }
          partes.push(parte);
        });
        res.on('end', () =>
          resolver({
            conteudo: Buffer.concat(partes),
            tipoMime: String(res.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase(),
          }),
        );
        res.on('error', () => rejeitar(new DownloadFalhou('conexão interrompida', 'rede')));
      },
    );
    req.on('timeout', () => req.destroy(new Error('tempo esgotado')));
    req.on('error', (erro: NodeJS.ErrnoException) =>
      rejeitar(
        erro.code === 'ENDERECO_PRIVADO'
          ? new DownloadFalhou('endereço não público', 'privado')
          : new DownloadFalhou(erro.message, 'rede'),
      ),
    );
  });
}
