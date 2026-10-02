/**
 * A renovação automática da autorização.
 *
 * O que estes testes trancam:
 *
 *   1. o token novo só é gravado depois de conferido contra a conta — renovar
 *      para um token que não funciona trocaria uma conta que envia por uma que
 *      não envia;
 *   2. a recusa deixa o CÓDIGO no banco (nunca a frase, nunca o token) e não
 *      mexe no token guardado;
 *   3. o token nunca aparece em claro no que é gravado nem no log.
 *
 * O banco e a Meta entram como dublês. A consulta que escolhe as contas é SQL
 * em texto: quem a exercita de verdade é a bateria contra Postgres
 * (`e2e-renovacao`).
 */
import { Logger } from '@nestjs/common';

jest.mock('../../config/env', () => ({
  env: { meta: { tokenChave: Buffer.alloc(32, 7).toString('base64'), appId: '123', appSecret: 'segredo', graphVersao: 'v26.0' } },
}));

import { waConta } from '../../db/schema';
import { cifrarToken, decifrarToken } from './cripto';
import { traduzirErroMeta } from './erros-meta';
import { ErroGraph, GraphService } from './graph.service';
import { RENOVAR_QUANDO_FALTAM_DIAS, RenovacaoJob, SEM_CODIGO } from './renovacao.job';

const CHAVE = Buffer.alloc(32, 7).toString('base64');
const TOKEN_ATUAL = 'EAAG-token-atual';
const TOKEN_NOVO = 'EAAG-token-novo';

function montar(contas: Array<{ id: string; waba_id: string; token_cifrado: string }> = [conta()]) {
  const gravados: Array<Record<string, unknown>> = [];
  const escopos: string[] = [];
  const consultas: unknown[] = [];
  const db = {
    execute: jest.fn(async (q: unknown) => {
      consultas.push(q);
      return { rows: contas };
    }),
    update: (tabela: unknown) => {
      expect(tabela).toBe(waConta);
      const cadeia: Record<string, unknown> = {};
      cadeia.set = (valores: Record<string, unknown>) => {
        gravados.push(valores);
        return cadeia;
      };
      cadeia.where = () => cadeia;
      cadeia.then = (r: (v: unknown[]) => void) => r([]);
      return cadeia;
    },
  };
  const ctx = {
    comEscopoSistema: <T>(motivo: string, fn: (d: typeof db) => Promise<T>) => {
      escopos.push(motivo);
      return fn(db);
    },
  };
  const graph = {
    renovarToken: jest.fn().mockResolvedValue({ token: TOKEN_NOVO, expiraEm: 5_184_000 }),
    dadosDaWaba: jest.fn().mockResolvedValue({ id: 'WABA1' }),
  };
  const job = new RenovacaoJob(ctx as never, graph as never);
  return { job, graph, gravados, escopos, consultas };
}

function conta(id = 'wa-1', waba = '1578000000000001') {
  return { id, waba_id: waba, token_cifrado: cifrarToken(TOKEN_ATUAL, CHAVE) };
}

let avisos: jest.SpyInstance;
beforeAll(() => {
  avisos = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});
afterAll(() => jest.restoreAllMocks());

describe('renovação da autorização', () => {
  it('renova uma semana depois de emitida: quando faltam menos de 53 dias dos 60', () => {
    expect(RENOVAR_QUANDO_FALTAM_DIAS).toBe(53);
  });

  it('troca o token, confere que o novo enxerga a conta e SÓ ENTÃO grava — cifrado, com 60 dias', async () => {
    const m = montar();
    await expect(m.job.renovarVencendo()).resolves.toBe(1);

    expect(m.graph.renovarToken).toHaveBeenCalledWith(TOKEN_ATUAL);
    expect(m.graph.dadosDaWaba).toHaveBeenCalledWith('1578000000000001', TOKEN_NOVO);
    // A conferência vem antes da gravação.
    expect(m.graph.dadosDaWaba.mock.invocationCallOrder[0]).toBeGreaterThan(m.graph.renovarToken.mock.invocationCallOrder[0]!);

    expect(m.gravados).toHaveLength(1);
    const g = m.gravados[0]!;
    expect(decifrarToken(g.tokenCifrado as string, CHAVE)).toBe(TOKEN_NOVO);
    expect(String(g.tokenCifrado)).not.toContain(TOKEN_NOVO);
    expect(g.tokenEm).toBeInstanceOf(Date);
    expect(Math.round(((g.tokenExpiraEm as Date).getTime() - Date.now()) / 86_400_000)).toBe(60);
    expect(g.tokenRenovacaoEm).toBeInstanceOf(Date);
    expect(g.tokenRenovacaoErro).toBeNull();
  });

  it('a Meta recusa a renovação: anota o código e a hora, e o token guardado NÃO muda', async () => {
    const m = montar();
    m.graph.renovarToken.mockRejectedValue(new ErroGraph({ status: 400, codigo: 100, traduzido: traduzirErroMeta(100) }));

    await expect(m.job.renovarVencendo()).resolves.toBe(0);

    expect(m.gravados).toHaveLength(1);
    expect(Object.keys(m.gravados[0]!).sort()).toEqual(['tokenRenovacaoEm', 'tokenRenovacaoErro']);
    expect(m.gravados[0]!.tokenRenovacaoErro).toBe(100);
    expect(m.graph.dadosDaWaba).not.toHaveBeenCalled();
  });

  it('o token novo não enxerga a conta: NÃO grava o token novo, anota a recusa', async () => {
    const m = montar();
    m.graph.dadosDaWaba.mockRejectedValue(new ErroGraph({ status: 401, codigo: 190, traduzido: traduzirErroMeta(190) }));

    await expect(m.job.renovarVencendo()).resolves.toBe(0);

    expect(m.gravados).toHaveLength(1);
    expect('tokenCifrado' in m.gravados[0]!).toBe(false);
    expect(m.gravados[0]!.tokenRenovacaoErro).toBe(190);
  });

  it('rede caída, ou resposta sem o token: anota "sem código" (-1), sem inventar um', async () => {
    const rede = montar();
    rede.graph.renovarToken.mockRejectedValue(new Error('fetch failed'));
    await rede.job.renovarVencendo();
    expect(rede.gravados[0]).toMatchObject({ tokenRenovacaoErro: SEM_CODIGO });

    const vazio = montar();
    vazio.graph.renovarToken.mockResolvedValue({ token: '', expiraEm: null });
    await vazio.job.renovarVencendo();
    expect(vazio.gravados[0]).toMatchObject({ tokenRenovacaoErro: SEM_CODIGO });
    expect('tokenCifrado' in vazio.gravados[0]!).toBe(false);
    expect(vazio.graph.dadosDaWaba).not.toHaveBeenCalled();
  });

  it('token novo sem prazo na resposta: grava "sem prazo" (nulo), e não uma data inventada', async () => {
    const m = montar();
    m.graph.renovarToken.mockResolvedValue({ token: TOKEN_NOVO, expiraEm: null });
    await m.job.renovarVencendo();
    expect(m.gravados[0]!.tokenExpiraEm).toBeNull();
    expect(m.gravados[0]!.tokenRenovacaoErro).toBeNull();
  });

  it('token guardado que não decifra: anota a falha e segue para a próxima conta', async () => {
    const m = montar([{ id: 'wa-ruim', waba_id: '1', token_cifrado: 'v1.lixo' }, conta('wa-2', '1578000000000002')]);

    await expect(m.job.renovarVencendo()).resolves.toBe(1);

    expect(m.gravados[0]).toMatchObject({ tokenRenovacaoErro: SEM_CODIGO });
    expect(m.graph.renovarToken).toHaveBeenCalledTimes(1);
    expect(m.gravados[1]!.tokenRenovacaoErro).toBeNull();
  });

  it('uma conta que falha não impede a seguinte', async () => {
    const m = montar([conta('wa-1', '1578000000000001'), conta('wa-2', '1578000000000002')]);
    m.graph.renovarToken.mockRejectedValueOnce(new ErroGraph({ status: 400, codigo: 100, traduzido: traduzirErroMeta(100) }));

    await expect(m.job.renovarVencendo()).resolves.toBe(1);
    expect(m.gravados.map((g) => g.tokenRenovacaoErro)).toEqual([100, null]);
  });

  it('nenhuma conta para renovar: nenhuma chamada à Meta', async () => {
    const m = montar([]);
    await expect(m.job.renovarVencendo()).resolves.toBe(0);
    expect(m.graph.renovarToken).not.toHaveBeenCalled();
  });

  it('lê e grava pela chave mestra, cada coisa no seu escopo', async () => {
    const m = montar();
    await m.job.renovarVencendo();
    expect(m.escopos).toEqual(['meta.renovacao.vencendo', 'meta.renovacao.gravar']);
  });

  it('o token nunca aparece em claro: nem no que é gravado, nem no log', async () => {
    const m = montar();
    m.graph.renovarToken.mockRejectedValue(new ErroGraph({ status: 400, codigo: 190, traduzido: traduzirErroMeta(190) }));
    avisos.mockClear();
    await m.job.renovarVencendo();

    const tudo = JSON.stringify([m.gravados, avisos.mock.calls]);
    expect(tudo).not.toContain(TOKEN_ATUAL);
    expect(tudo).not.toContain(TOKEN_NOVO);
    // E a WABA vai mascarada.
    expect(tudo).not.toContain('1578000000000001');
  });

  it('exceção na rotina não derruba o agendador', async () => {
    const m = montar();
    (m.job as unknown as { ctx: { comEscopoSistema: unknown } }).ctx.comEscopoSistema = () => Promise.reject(new Error('banco fora'));
    await expect(m.job.acompanhar()).resolves.toBeUndefined();
  });
});

describe('GraphService.renovarToken', () => {
  const fetchOriginal = global.fetch;
  afterEach(() => {
    global.fetch = fetchOriginal;
  });

  it('faz a troca oficial: fb_exchange_token, com o prazo de 60 dias pedido', async () => {
    const urls: URL[] = [];
    global.fetch = jest.fn(async (url: string | URL) => {
      urls.push(new URL(String(url)));
      const corpo = { access_token: TOKEN_NOVO, token_type: 'bearer', expires_in: 5_183_944 };
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => corpo,
        text: async () => JSON.stringify(corpo),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const r = await new GraphService().renovarToken(TOKEN_ATUAL);

    expect(r).toEqual({ token: TOKEN_NOVO, expiraEm: 5_183_944 });
    expect(urls).toHaveLength(1);
    expect(urls[0]!.pathname).toContain('/oauth/access_token');
    expect(Object.fromEntries(urls[0]!.searchParams)).toMatchObject({
      grant_type: 'fb_exchange_token',
      client_id: '123',
      client_secret: 'segredo',
      set_token_expires_in_60_days: 'true',
      fb_exchange_token: TOKEN_ATUAL,
    });
  });

  it('recusa da Meta sobe com o código, e uma tentativa só', async () => {
    const chamada = jest.fn(async () => {
      const corpo = { error: { code: 190, message: 'Error validating access token', type: 'OAuthException' } };
      return {
        ok: false,
        status: 400,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => corpo,
        text: async () => JSON.stringify(corpo),
      } as unknown as Response;
    });
    global.fetch = chamada as unknown as typeof fetch;

    await expect(new GraphService().renovarToken(TOKEN_ATUAL)).rejects.toMatchObject({ codigo: 190 });
    expect(chamada).toHaveBeenCalledTimes(1);
  });
});
