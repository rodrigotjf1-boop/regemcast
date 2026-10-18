/**
 * O cliente do hub no RegemCast, contra um DMS ID e um hub de mentira por HTTP: desligado não faz nada; ligado, pede o
 * token do aplicativo do RegemCast, bate com a versão, lê a lista de parada quando o hub diz que mudou e, no
 * desligamento, manda o registro e os erros (limpos) que estavam na fila.
 */
jest.mock('../../config/env', () => ({ env: {} }));

import { Logger } from '@nestjs/common';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { env } from '../../config/env';
import { HubService } from './hub.service';

type Pedido = { caminho: string; cabecalhos: IncomingMessage['headers']; corpo: string };
type Falsos = { servidor: Server; base: string; pedidos: Pedido[] };

/** O DMS ID (só o `/oidc/token`) e o hub (batida, lista de parada, registro e erros) num servidor só. */
async function subirFalsos(): Promise<Falsos> {
  const pedidos: Pedido[] = [];
  const servidor = createServer((req, res) => {
    let corpo = '';
    req.on('data', (d) => (corpo += d));
    req.on('end', () => {
      pedidos.push({ caminho: req.url ?? '', cabecalhos: req.headers, corpo });
      res.setHeader('content-type', 'application/json');
      const responder = (status: number, json: unknown) => {
        res.statusCode = status;
        res.end(JSON.stringify(json));
      };
      if (req.url === '/oidc/token') return responder(200, { access_token: 'token-do-hub-de-teste', expires_in: 3600, token_type: 'Bearer' });
      if (req.url === '/api/v1/batida') return responder(200, { parada_versao: 2 });
      if (req.url === '/api/v1/parada') {
        res.setHeader('etag', '"v2"');
        return responder(200, { versao: 2, itens: [{ nivel: 'ferramenta', produto: 'regemcast', alvo: 'campanha_disparar' }] });
      }
      if (req.url === '/api/v1/registro') return responder(202, { recebidas: 1, novas: 1, repetidas: 0 });
      if (req.url === '/api/v1/erros') return responder(202, { recebidos: 1, contados: 1, grupos: [] });
      return responder(404, {});
    });
  });
  await new Promise<void>((pronto) => servidor.listen(0, '127.0.0.1', pronto));
  return { servidor, base: `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`, pedidos };
}

async function esperar(condicao: () => boolean, ms = 3000): Promise<void> {
  const fim = Date.now() + ms;
  while (!condicao()) {
    if (Date.now() > fim) throw new Error('não aconteceu a tempo');
    await new Promise((pronto) => setTimeout(pronto, 10));
  }
}

const config = env as { hub?: unknown };
const SEGREDO = 'segredo-do-aplicativo-de-teste-0123456789';
const VERSAO_ORIGINAL = process.env.APP_VERSAO;

describe('HubService', () => {
  afterEach(() => {
    config.hub = undefined;
    if (VERSAO_ORIGINAL === undefined) delete process.env.APP_VERSAO;
    else process.env.APP_VERSAO = VERSAO_ORIGINAL;
    jest.restoreAllMocks();
  });

  it('desligado (sem HUB_LIGADO): não chama ninguém, não para nada e aceita integrações', async () => {
    const hub = new HubService();
    hub.onModuleInit();
    expect(hub.ligado).toBe(false);
    expect(hub.estado).toBeNull();
    expect(hub.aceitaIntegracoes).toBe(true);
    expect(hub.parado({ aplicativo: 'liame', ferramenta: 'campanha_disparar' })).toBeNull();
    expect(() => hub.registrar({ codigo: 'rc_0123456789abcdef', ocorrido_em: new Date().toISOString(), credencial: 'token_integracao', ferramenta: 'x', resultado: 'aceita' })).not.toThrow();
    expect(() => hub.erro({ origem: 'backend', tipo: 'HTTP 500', mensagem: 'x', lugar: 'y' })).not.toThrow();
    await expect(hub.onApplicationShutdown()).resolves.toBeUndefined();
  });

  it('a chave própria ACEITAR_INTEGRACOES=false vale com o hub desligado', () => {
    config.hub = { ligado: false, url: '', recurso: '', emissor: '', aplicativo: '', segredo: '', aceitaIntegracoes: false };
    expect(new HubService().aceitaIntegracoes).toBe(false);
  });

  describe('ligado, contra o hub de mentira', () => {
    let f: Falsos;
    beforeEach(async () => {
      f = await subirFalsos();
      process.env.APP_VERSAO = 'abc1234';
      config.hub = {
        ligado: true,
        url: f.base,
        recurso: 'https://hub.exemplo.test/api',
        emissor: `${f.base}/oidc`,
        aplicativo: 'app-regemcast-de-teste',
        segredo: SEGREDO,
        aceitaIntegracoes: true,
      };
    });
    afterEach(async () => {
      await new Promise((fim) => f.servidor.close(fim));
    });

    it('pede o token do aplicativo do RegemCast, bate com a versão e lê a lista quando o hub diz que mudou', async () => {
      const hub = new HubService();
      hub.onModuleInit();
      try {
        await esperar(() => hub.estado?.paradaVersao === 2);
        expect(hub.ligado).toBe(true);

        const token = f.pedidos.find((p) => p.caminho === '/oidc/token')!;
        expect(token.cabecalhos.authorization).toBe(`Basic ${Buffer.from(`app-regemcast-de-teste:${SEGREDO}`).toString('base64')}`);
        const pedido = new URLSearchParams(token.corpo);
        expect(pedido.get('grant_type')).toBe('client_credentials');
        expect(pedido.get('resource')).toBe('https://hub.exemplo.test/api');
        expect(pedido.get('scope')).toBe('registro.enviar parada.ler');

        const batida = f.pedidos.find((p) => p.caminho === '/api/v1/batida')!;
        expect(batida.cabecalhos.authorization).toBe('Bearer token-do-hub-de-teste');
        expect(JSON.parse(batida.corpo)).toMatchObject({ versao: 'abc1234', aceita_integracoes: true });

        expect(hub.parado({ aplicativo: 'liame', ferramenta: 'campanha_disparar' })).toEqual({ nivel: 'ferramenta', produto: 'regemcast', alvo: 'campanha_disparar' });
        expect(hub.parado({ aplicativo: 'liame', ferramenta: 'orcamento_ler' })).toBeNull();
      } finally {
        await hub.onApplicationShutdown();
      }
    });

    it('no desligamento, manda o registro e os erros que estavam na fila (o erro limpo de dado pessoal)', async () => {
      const hub = new HubService();
      hub.onModuleInit();
      hub.registrar({ codigo: 'rc_0123456789abcdef', ocorrido_em: '2026-10-17T12:00:00.000Z', credencial: 'token_integracao', ferramenta: 'orcamento_ler', resultado: 'aceita', status_http: 200 });
      hub.erro({ origem: 'backend', tipo: 'HTTP 500', mensagem: 'falhou para +5521900000000', lugar: 'POST /api/v1/campanhas/<id>/disparar', codigo: 'rc_0123456789abcdef' });
      await hub.onApplicationShutdown();
      expect(hub.ligado).toBe(false);

      const registro = f.pedidos.find((p) => p.caminho === '/api/v1/registro')!;
      expect(registro.cabecalhos.authorization).toBe('Bearer token-do-hub-de-teste');
      expect(JSON.parse(registro.corpo)).toEqual({
        chamadas: [{ codigo: 'rc_0123456789abcdef', ocorrido_em: '2026-10-17T12:00:00.000Z', credencial: 'token_integracao', ferramenta: 'orcamento_ler', resultado: 'aceita', status_http: 200 }],
      });
      const erros = JSON.parse(f.pedidos.find((p) => p.caminho === '/api/v1/erros')!.corpo) as { erros: Array<Record<string, unknown>> };
      expect(erros.erros).toHaveLength(1);
      expect(erros.erros[0]).toMatchObject({ origem: 'backend', tipo: 'HTTP 500', mensagem: 'falhou para <telefone>', versao: 'abc1234', codigo: 'rc_0123456789abcdef', quantidade: 1 });
    });
  });

  it('a falha do hub vira aviso no log, sem repetir o mesmo motivo a cada volta', () => {
    const aviso = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const hub = new HubService() as unknown as { avisar(motivo: string): void };
    hub.avisar('sem resposta do hub na batida');
    hub.avisar('sem resposta do hub na batida');
    hub.avisar('o hub respondeu 503 em /api/v1/registro');
    expect(aviso).toHaveBeenCalledTimes(2);
    expect(aviso).toHaveBeenNthCalledWith(1, 'Hub: sem resposta do hub na batida');
  });
});
