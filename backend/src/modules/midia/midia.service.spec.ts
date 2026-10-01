/**
 * Testes da mídia.
 *
 * O bloco que mais importa é o da ASSINATURA. Extensão e mimetype são escritos
 * pelo cliente e mentem fácil — um executável renomeado para `.jpg` passaria em
 * qualquer um dos dois. O arquivo é o que os primeiros bytes dizem que ele é.
 */
import { BadRequestException } from '@nestjs/common';

jest.mock('../../config/env', () => ({ env: { meta: {} } }));

import { MidiaIndisponivel, MidiaService, type ArquivoRecebido } from './midia.service';

const CONTA = '11111111-1111-4111-8111-111111111111';
const USUARIO = '22222222-2222-4222-8222-222222222222';

function consulta(linhas: unknown[]) {
  const alvo: Record<string, unknown> = {};
  for (const m of ['from', 'where', 'orderBy', 'limit', 'returning', 'values', 'set']) {
    alvo[m] = () => alvo;
  }
  alvo.then = (r: (v: unknown[]) => void) => r(linhas);
  return alvo;
}

function servico(graph: Record<string, unknown> = {}) {
  const db = {
    insert: () => consulta([{ id: 'nova' }]),
    select: () => consulta([]),
    update: () => consulta([]),
  };
  const ctx = { comConta: <T>(_c: string, fn: (d: typeof db) => Promise<T>) => fn(db) };
  return new MidiaService(ctx as never, graph as never, { registrar: jest.fn() } as never);
}

/** Um arquivo cujos primeiros bytes são os informados. */
function arquivo(tipo: string, inicio: number[] | string, tamanho = 1024): ArquivoRecebido {
  const buf = Buffer.alloc(tamanho);
  if (typeof inicio === 'string') buf.write(inicio, 0, 'ascii');
  else inicio.forEach((b, i) => (buf[i] = b));
  return { originalname: 'arquivo', mimetype: tipo, size: tamanho, buffer: buf };
}

const JPEG = [0xff, 0xd8, 0xff, 0xe0];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

describe('guardar mídia', () => {
  it('aceita JPEG, PNG e PDF com a assinatura certa', async () => {
    await expect(servico().guardar(CONTA, USUARIO, arquivo('image/jpeg', JPEG))).resolves.toMatchObject({
      formato: 'IMAGE',
    });
    await expect(servico().guardar(CONTA, USUARIO, arquivo('image/png', PNG))).resolves.toMatchObject({
      formato: 'IMAGE',
    });
    await expect(servico().guardar(CONTA, USUARIO, arquivo('application/pdf', '%PDF-1.7'))).resolves.toMatchObject({
      formato: 'DOCUMENT',
    });
  });

  it('aceita MP4 pela caixa "ftyp" a partir do quarto byte', async () => {
    const mp4 = arquivo('video/mp4', [0, 0, 0, 0x20]);
    mp4.buffer.write('ftyp', 4, 'ascii');
    await expect(servico().guardar(CONTA, USUARIO, mp4)).resolves.toMatchObject({ formato: 'VIDEO' });
  });

  it('devolve a referência no formato que o modelo usa', async () => {
    const r = await servico().guardar(CONTA, USUARIO, arquivo('image/jpeg', JPEG));
    expect(r.referencia).toBe('midia:nova');
  });

  it('RECUSA um arquivo que declara ser JPEG mas não é', async () => {
    // O caso que a checagem existe para barrar: executável renomeado para .jpg.
    // "MZ" é o começo de um .exe do Windows.
    const exe = arquivo('image/jpeg', 'MZ\x90\x00');
    await expect(servico().guardar(CONTA, USUARIO, exe)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('RECUSA um HTML disfarçado de PNG', async () => {
    const html = arquivo('image/png', '<html><script>');
    await expect(servico().guardar(CONTA, USUARIO, html)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('recusa tipo que a Meta não aceita em cabeçalho', async () => {
    await expect(
      servico().guardar(CONTA, USUARIO, arquivo('image/gif', 'GIF89a')),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('respeita o teto POR TIPO: imagem acima de 5 MB é recusada', async () => {
    const grande = arquivo('image/jpeg', JPEG, 6 * 1024 * 1024);
    await expect(servico().guardar(CONTA, USUARIO, grande)).rejects.toThrow('5 MB');
  });

  it('recusa arquivo curto demais para ter assinatura', async () => {
    const curto = { originalname: 'x', mimetype: 'image/jpeg', size: 3, buffer: Buffer.from(JPEG.slice(0, 3)) };
    await expect(servico().guardar(CONTA, USUARIO, curto)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('referência para handle', () => {
  it('recusa referência que não é arquivo nem endereço', async () => {
    await expect(servico().handleParaModelo(CONTA, 'qualquer-coisa')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('recusa arquivo guardado que não existe', async () => {
    await expect(
      servico().handleParaModelo(CONTA, 'midia:33333333-3333-4333-8333-333333333333'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

/**
 * A mídia do modelo, pronta para ENVIAR numa mensagem: o id que a Meta devolve
 * em `POST /{numero}/media` fica guardado por número, para a campanha subir o
 * arquivo uma vez e não uma por destinatário.
 */
describe('mídia para envio', () => {
  const ID = '33333333-3333-4333-8333-333333333333';
  const REF = `midia:${ID}`;

  /** As leituras, em ordem; o que não estiver na fila devolve vazio. */
  function servicoComLeituras(leituras: unknown[][], graph: Record<string, unknown> = {}) {
    const fila = [...leituras];
    const gravados: unknown[] = [];
    const escrita = () => {
      const alvo: Record<string, unknown> = {};
      alvo.values = (v: unknown) => {
        gravados.push(v);
        return alvo;
      };
      alvo.onConflictDoUpdate = () => alvo;
      alvo.then = (r: (v: unknown[]) => void) => r([]);
      return alvo;
    };
    const db = { select: () => consulta(fila.shift() ?? []), insert: escrita, update: () => consulta([]) };
    const ctx = { comConta: <T>(_c: string, fn: (d: typeof db) => Promise<T>) => fn(db) };
    return { midias: new MidiaService(ctx as never, graph as never, { registrar: jest.fn() } as never), gravados };
  }

  const ARQUIVO = { nome: 'promo.jpg', tipoMime: 'image/jpeg' };
  const BYTES = { conteudo: Buffer.from([0xff, 0xd8, 0xff, 0xe0]), tipoMime: 'image/jpeg' };

  it('endereço público vai como link: é a Meta que busca, e nada é lido do banco', async () => {
    const subir = jest.fn();
    const { midias } = servicoComLeituras([], { subirMidiaParaEnvio: subir });
    await expect(midias.paraEnvio(CONTA, 'PN1', 'tok', 'https://loja.example/promo.jpg')).resolves.toEqual({
      link: 'https://loja.example/promo.jpg',
    });
    expect(subir).not.toHaveBeenCalled();
  });

  it('id ainda válido guardado para este número: usa o que tem, sem subir de novo', async () => {
    const subir = jest.fn();
    const { midias } = servicoComLeituras([[ARQUIVO], [{ mediaId: 'MEDIA-GUARDADO' }]], { subirMidiaParaEnvio: subir });

    await expect(midias.paraEnvio(CONTA, 'PN1', 'tok', REF)).resolves.toEqual({
      id: 'MEDIA-GUARDADO',
      nomeArquivo: 'promo.jpg',
    });
    expect(subir).not.toHaveBeenCalled();
  });

  it('sem id guardado: sobe os bytes com o token e o número do cliente, e guarda o id com validade', async () => {
    const subir = jest.fn().mockResolvedValue('MEDIA-NOVO');
    const { midias, gravados } = servicoComLeituras([[ARQUIVO], [], [BYTES]], { subirMidiaParaEnvio: subir });

    await expect(midias.paraEnvio(CONTA, 'PN1', 'tok', REF)).resolves.toEqual({ id: 'MEDIA-NOVO', nomeArquivo: 'promo.jpg' });

    expect(subir).toHaveBeenCalledWith('PN1', { conteudo: BYTES.conteudo, tipoMime: 'image/jpeg', nome: 'promo.jpg' }, 'tok');
    const guardado = gravados[0] as { midiaId: string; phoneNumberId: string; mediaId: string; expiraEm: Date };
    expect(guardado).toMatchObject({ contaId: CONTA, midiaId: ID, phoneNumberId: 'PN1', mediaId: 'MEDIA-NOVO' });
    // A Meta guarda por 30 dias; paramos de confiar antes disso.
    const dias = (guardado.expiraEm.getTime() - Date.now()) / 86_400_000;
    expect(dias).toBeGreaterThan(20);
    expect(dias).toBeLessThan(30);
  });

  it.each([
    ['arquivo que não existe', [[]]],
    ['arquivo que perdeu os bytes', [[ARQUIVO], [], [{ conteudo: null, tipoMime: 'image/jpeg' }]]],
  ])('%s: MidiaIndisponivel — não adianta tentar de novo, a campanha pausa e aponta o modelo', async (_caso, leituras) => {
    const subir = jest.fn();
    const { midias } = servicoComLeituras(leituras as unknown[][], { subirMidiaParaEnvio: subir });
    await expect(midias.paraEnvio(CONTA, 'PN1', 'tok', REF)).rejects.toBeInstanceOf(MidiaIndisponivel);
    expect(subir).not.toHaveBeenCalled();
  });

  it('referência que não é arquivo nem endereço: MidiaIndisponivel', async () => {
    const { midias } = servicoComLeituras([]);
    await expect(midias.paraEnvio(CONTA, 'PN1', 'tok', 'qualquer-coisa')).rejects.toBeInstanceOf(MidiaIndisponivel);
  });

  it('a recusa da Meta ao subir passa adiante como veio (é quem chama que decide esperar ou pausar)', async () => {
    const recusa = new Error('a Meta recusou');
    const { midias } = servicoComLeituras([[ARQUIVO], [], [BYTES]], { subirMidiaParaEnvio: jest.fn().mockRejectedValue(recusa) });
    await expect(midias.paraEnvio(CONTA, 'PN1', 'tok', REF)).rejects.toBe(recusa);
  });

  it('disponível para envio: endereço serve; arquivo precisa existir e ainda ter os bytes', async () => {
    expect(await servicoComLeituras([]).midias.disponivelParaEnvio(CONTA, 'https://loja.example/x.jpg')).toBe(true);
    expect(await servicoComLeituras([[{ temBytes: true }]]).midias.disponivelParaEnvio(CONTA, REF)).toBe(true);
    expect(await servicoComLeituras([[{ temBytes: false }]]).midias.disponivelParaEnvio(CONTA, REF)).toBe(false);
    expect(await servicoComLeituras([[]]).midias.disponivelParaEnvio(CONTA, REF)).toBe(false);
    expect(await servicoComLeituras([]).midias.disponivelParaEnvio(CONTA, 'midia:não-é-uuid')).toBe(false);
    expect(await servicoComLeituras([]).midias.disponivelParaEnvio(CONTA, 'qualquer')).toBe(false);
  });
});
