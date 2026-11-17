// O ambiente da API (como os outros testes da porta): sem banco nem DMS ID, nada aqui depende dele.
jest.mock('../../config/env', () => ({ env: { dmsId: { ligado: false, emissor: '', recurso: '', aplicativos: {} } } }));

import 'reflect-metadata';
import { BadRequestException, HttpException, UnauthorizedException } from '@nestjs/common';
import { credencialAntigaDesligada, CREDENCIAL_RETIRADA } from '../../common/retirada-credencial';
import { ErroProblema } from '../../dms/integracao-dms';
import { IntegracaoGuard } from './integracao.guard';
import { EMISSAO_RETIRADA, IntegracaoService, TROCA_AUTOMATICA_RETIRADA } from './integracao.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O DESLIGAMENTO DA CREDENCIAL ANTIGA (Hub DMS F6, plano "Fim das portas antigas", P-4; decisão do dono em 17/11/2026,
// sem o prazo de 90 dias porque não há parceiro de fora e nenhum `rct_it_` estava vivo). Com
// `INTEGRACAO_ANTIGA_DESLIGADA=true`, o `rct_it_` é recusado e nada mais o cria ou troca. Sem a variável, tudo como
// antes (cada caso abaixo prova os dois lados).

const TOKEN = `rct_it_${'A'.repeat(43)}`;
/** O contexto do banco que não pode ser tocado: o desligamento recusa antes de qualquer consulta. */
const ctxIntocavel = { comEscopoSistema: async () => { throw new Error('o banco não devia ser consultado'); } } as any;

async function recusa(promessa: Promise<unknown>): Promise<unknown> {
  try {
    await promessa;
  } catch (e) {
    return e;
  }
  throw new Error('devia ter sido recusado');
}

describe('a credencial antiga desligada (P-4)', () => {
  const antes = process.env.INTEGRACAO_ANTIGA_DESLIGADA;
  beforeEach(() => delete process.env.INTEGRACAO_ANTIGA_DESLIGADA);
  afterAll(() => {
    if (antes === undefined) delete process.env.INTEGRACAO_ANTIGA_DESLIGADA;
    else process.env.INTEGRACAO_ANTIGA_DESLIGADA = antes;
  });
  const desligar = () => (process.env.INTEGRACAO_ANTIGA_DESLIGADA = 'true');

  it('a chave: só "true" (sem diferença de maiúsculas e espaços) liga', () => {
    expect(credencialAntigaDesligada({})).toBe(false);
    expect(credencialAntigaDesligada({ INTEGRACAO_ANTIGA_DESLIGADA: '' })).toBe(false);
    expect(credencialAntigaDesligada({ INTEGRACAO_ANTIGA_DESLIGADA: '1' })).toBe(false);
    expect(credencialAntigaDesligada({ INTEGRACAO_ANTIGA_DESLIGADA: 'false' })).toBe(false);
    expect(credencialAntigaDesligada({ INTEGRACAO_ANTIGA_DESLIGADA: ' True ' })).toBe(true);
  });

  describe('a porta MCP (token colado `rct_it_`)', () => {
    function montar() {
      const integracoes = { autenticar: jest.fn(async () => { throw new UnauthorizedException('Token de integração inválido.'); }) };
      const hub = { aceitaIntegracoes: true, parado: () => false };
      const dmsId = { ligado: false };
      const g = new IntegracaoGuard(integracoes as any, dmsId as any, {} as any, hub as any);
      const cab: Record<string, string> = {};
      const req: any = { headers: { authorization: `Bearer ${TOKEN}` }, body: {} };
      const res: any = { setHeader: (n: string, v: string) => (cab[n] = v) };
      const contexto: any = { switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }) };
      return { g, integracoes, cab, contexto };
    }

    it('desligada: 401 com a frase do clique e o desafio do Bearer, sem ir ao banco', async () => {
      desligar();
      const { g, integracoes, cab, contexto } = montar();
      const e = await recusa(g.canActivate(contexto));
      expect(e).toBeInstanceOf(UnauthorizedException);
      expect((e as HttpException).message).toBe(CREDENCIAL_RETIRADA);
      expect(cab['WWW-Authenticate']).toBe('Bearer error="invalid_token"');
      expect(integracoes.autenticar).not.toHaveBeenCalled();
    });

    it('sem a chave: o token vai ao serviço como sempre (aqui não vale: 401 com a frase de token inválido)', async () => {
      const { g, integracoes, contexto } = montar();
      const e = await recusa(g.canActivate(contexto));
      expect(integracoes.autenticar).toHaveBeenCalledTimes(1);
      expect((e as HttpException).message).not.toBe(CREDENCIAL_RETIRADA);
    });
  });

  describe('nada mais cria ou troca o `rct_it_`', () => {
    it('a emissão pelo console da distribuição: desligada = recusa com a frase; sem a chave, a conferência de sempre', async () => {
      const s = new IntegracaoService(ctxIntocavel, {} as any);
      desligar();
      const e = await recusa(s.emitir('conta', {} as any, 'operador'));
      expect(e).toBeInstanceOf(BadRequestException);
      expect((e as HttpException).message).toBe(EMISSAO_RETIRADA);
      delete process.env.INTEGRACAO_ANTIGA_DESLIGADA;
      const antes = await recusa(s.emitir('conta', {} as any, 'operador'));
      expect(antes).toBeInstanceOf(BadRequestException);
      expect((antes as HttpException).message).not.toBe(EMISSAO_RETIRADA);
    });

    it('a troca automática pela ligação: desligada = 404 nao-encontrado; sem a chave, a conferência de sempre', async () => {
      const s = new IntegracaoService(ctxIntocavel, {} as any);
      desligar();
      const e = await recusa(s.trocarPorLigacao(TOKEN, 'aplicativo', {}));
      expect(e).toBeInstanceOf(ErroProblema);
      expect([(e as ErroProblema).tipo, (e as ErroProblema).status, (e as ErroProblema).message]).toEqual(['nao-encontrado', 404, TROCA_AUTOMATICA_RETIRADA]);
      delete process.env.INTEGRACAO_ANTIGA_DESLIGADA;
      const antes = await recusa(s.trocarPorLigacao('fora-do-formato', 'aplicativo', {}));
      expect((antes as ErroProblema).tipo).toBe('ligacao-invalida');
    });
  });
});
