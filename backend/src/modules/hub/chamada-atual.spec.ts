/**
 * O registro de cada chamada da porta, campo a campo, contra o contrato do hub: um registro fora dele faz o hub
 * recusar o LOTE inteiro (400) e o pacote jogar o lote fora. O esquema abaixo é cópia do que o hub confere
 * (`servidor/src/produtos/contratos.ts` no repositório do hub, A4 da F2).
 */
import { z } from 'zod';

import {
  anotarChamada,
  chamadaAtual,
  comChamada,
  ferramentaDoRegistro,
  ferramentasDoCorpo,
  montarChamada,
  novoCodigo,
  problemaDoStatus,
  resultadoDaResposta,
  type ChamadaAtual,
} from './chamada-atual';

const codigo = z.string().regex(/^[A-Za-z0-9_.:-]{6,100}$/);
const CHAMADA_DO_HUB = z.strictObject({
  codigo,
  ocorrido_em: z.iso.datetime({ offset: true }),
  aplicativo: z.string().min(1).max(80).optional(),
  credencial: z.enum(['dms_id', 'token_integracao', 'acesso_proprio']),
  ligacao_prefixo: z.string().regex(/^[A-Za-z0-9_-]{4,40}$/).optional(),
  conta: z.string().min(1).max(80).optional(),
  conta_nome: z.string().min(1).max(120).optional(),
  ferramenta: z.string().min(1).max(120),
  resultado: z.enum(['aceita', 'recusada', 'erro']),
  problema: z.string().regex(/^[a-z][a-z0-9-]{2,40}$/).optional(),
  status_http: z.number().int().min(100).max(599).optional(),
  duracao_ms: z.number().int().min(0).max(3_600_000).optional(),
});

const INICIO = Date.UTC(2026, 9, 17, 12, 0, 0);
const base = (extra: Partial<ChamadaAtual> = {}): ChamadaAtual => ({ codigo: 'rc_0123456789abcdef', inicio: INICIO, ...extra });

describe('montarChamada: o registro no contrato do hub', () => {
  it('chamada atendida: aceita, com quem chamou, a ferramenta, o status e a duração', () => {
    const r = montarChamada(
      base({
        credencial: 'token_integracao',
        ligacaoPrefixo: 'rct_it_ab12cd34',
        aplicativo: 'liame',
        conta: '00000000-0000-4000-8000-000000000001',
        contaNome: 'Loja de teste',
        ferramenta: 'orcamento_ler',
      }),
      200,
      true,
      INICIO + 87,
    );
    expect(r).toEqual({
      codigo: 'rc_0123456789abcdef',
      ocorrido_em: '2026-10-17T12:00:00.000Z',
      credencial: 'token_integracao',
      ligacao_prefixo: 'rct_it_ab12cd34',
      aplicativo: 'liame',
      conta: '00000000-0000-4000-8000-000000000001',
      conta_nome: 'Loja de teste',
      ferramenta: 'orcamento_ler',
      resultado: 'aceita',
      status_http: 200,
      duracao_ms: 87,
    });
    expect(CHAMADA_DO_HUB.safeParse(r).success).toBe(true);
  });

  it.each([
    ['o portão recusou (401)', base({ problema: 'token-invalido' }), 401, true, 'recusada', 'token-invalido'],
    ['a parada (503 integracao-parada) é recusa, não erro', base({ problema: 'integracao-parada' }), 503, true, 'recusada', 'integracao-parada'],
    ['outro 5xx é erro nosso', base({ problema: 'erro-interno' }), 500, true, 'erro', 'erro-interno'],
    ['a ferramenta recusou por regra (200)', base({ resultado: 'recusada', problema: 'nao-encontrado' }), 200, true, 'recusada', 'nao-encontrado'],
    ['a ferramenta falhou (200)', base({ resultado: 'erro', problema: 'erro-interno' }), 200, true, 'erro', 'erro-interno'],
    ['a conexão caiu antes do fim', base(), 200, false, 'erro', undefined],
    ['aceita não leva problema', base({ problema: 'token-invalido' }), 200, true, 'aceita', undefined],
  ])('%s', (_, chamada, status, terminou, resultado, problema) => {
    const r = montarChamada(chamada, status, terminou, INICIO + 5);
    expect(r.resultado).toBe(resultado);
    expect(r.problema).toBe(problema);
    expect(CHAMADA_DO_HUB.safeParse(r).success).toBe(true);
  });

  it('o que não cabe no contrato sai (opcional) ou é cortado (texto), nunca vai torto', () => {
    const r = montarChamada(
      base({
        ligacaoPrefixo: 'dms_lg_regemcast_a b%c',
        aplicativo: 'a'.repeat(200),
        conta: ' ',
        contaNome: 'N'.repeat(500),
        ferramenta: 'f'.repeat(500),
        problema: 'Problema Torto',
        resultado: 'recusada',
      }),
      700,
      true,
      INICIO - 50,
    );
    expect(r.ligacao_prefixo).toBeUndefined();
    expect(r.aplicativo).toHaveLength(80);
    expect(r.conta).toBeUndefined();
    expect(r.conta_nome).toHaveLength(120);
    expect(r.ferramenta).toHaveLength(120);
    expect(r.problema).toBeUndefined();
    expect(r.status_http).toBeUndefined();
    expect(r.duracao_ms).toBe(0);
    expect(r.credencial).toBe('token_integracao');
    expect(CHAMADA_DO_HUB.safeParse(r).success).toBe(true);
  });

  it('sem ferramenta e com duração enorme: o padrão e o teto do hub', () => {
    const r = montarChamada(base({ credencial: 'dms_id' }), 200, true, INICIO + 10 * 3_600_000);
    expect(r.ferramenta).toBe('(sem método)');
    expect(r.duracao_ms).toBe(3_600_000);
    expect(CHAMADA_DO_HUB.safeParse(r).success).toBe(true);
  });

  it('o código novo cabe no código do hub e não se repete', () => {
    const codigos = new Set(Array.from({ length: 200 }, () => novoCodigo()));
    expect(codigos.size).toBe(200);
    for (const c of codigos) {
      expect(c).toMatch(/^rc_[0-9a-f]{16}$/);
      expect(codigo.safeParse(c).success).toBe(true);
    }
  });
});

describe('as ferramentas de um corpo JSON-RPC', () => {
  it.each([
    ['tools/call: o nome da ferramenta', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'campanha_disparar' } }, ['campanha_disparar']],
    ['outro pedido: o método', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, ['tools/list']],
    ['tools/call sem nome: o método', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: {} }, ['tools/call']],
    [
      'o lote da geração 2025: uma por mensagem',
      [
        { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'orcamento_ler' } },
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'campanha_disparar' } },
      ],
      ['orcamento_ler', 'campanha_disparar'],
    ],
    ['sem corpo', undefined, []],
    ['corpo torto', 'texto', []],
    ['resposta JSON-RPC (sem método)', { jsonrpc: '2.0', id: 1, result: {} }, []],
  ])('%s', (_, corpo, esperado) => {
    expect(ferramentasDoCorpo(corpo)).toEqual(esperado);
  });

  it('o registro leva uma só: a ferramenta, ou "lote"', () => {
    expect(ferramentaDoRegistro({ method: 'tools/call', params: { name: 'orcamento_ler' } })).toBe('orcamento_ler');
    expect(ferramentaDoRegistro([{ method: 'tools/list' }])).toBe('lote');
    expect(ferramentaDoRegistro(null)).toBe('(sem método)');
  });
});

describe('o que a resposta JSON-RPC do SDK diz da chamada', () => {
  it.each([
    ['atendida', '{"jsonrpc":"2.0","id":1,"result":{"content":[]}}', null],
    ['-32602 sem a situação da ferramenta: o argumento fora do esquema', '{"jsonrpc":"2.0","id":1,"error":{"code":-32602,"message":"Invalid arguments"}}', { resultado: 'recusada', problema: 'parametro-invalido' }],
    ['erro interno do protocolo (-32603)', '{"jsonrpc":"2.0","id":1,"error":{"code":-32603,"message":"Internal error"}}', { resultado: 'erro', problema: 'erro-interno' }],
    ['resultado com isError', '{"jsonrpc":"2.0","id":1,"result":{"isError":true,"content":[]}}', { resultado: 'recusada' }],
    [
      'lote: o erro interno vence',
      '[{"jsonrpc":"2.0","id":1,"error":{"code":-32602}},{"jsonrpc":"2.0","id":2,"error":{"code":-32603}}]',
      { resultado: 'erro', problema: 'erro-interno' },
    ],
    ['não é JSON', 'event: message', null],
  ])('%s', (_, texto, esperado) => {
    expect(resultadoDaResposta(texto)).toEqual(esperado);
  });

  // ERR-049: o mesmo -32602 diz três coisas; o hub mostrava "parâmetro inválido" para a ferramenta fora do escopo
  it.each([
    ['fora-do-escopo', 'escopo-insuficiente'],
    ['inexistente', 'nao-encontrado'],
    ['liberada', 'parametro-invalido'],
  ] as const)('o -32602 de uma ferramenta %s sai como %s', (situacao, problema) => {
    const texto = '{"jsonrpc":"2.0","id":1,"error":{"code":-32602,"message":"Tool x not found"}}';
    expect(resultadoDaResposta(texto, situacao)).toEqual({ resultado: 'recusada', problema });
  });

  it('a situação só muda o -32602: outro código de erro segue parâmetro inválido, e o -32603 segue erro interno', () => {
    expect(resultadoDaResposta('{"jsonrpc":"2.0","id":1,"error":{"code":-32600,"message":"Invalid Request"}}', 'fora-do-escopo')).toEqual({ resultado: 'recusada', problema: 'parametro-invalido' });
    expect(resultadoDaResposta('{"jsonrpc":"2.0","id":1,"error":{"code":-32603}}', 'fora-do-escopo')).toEqual({ resultado: 'erro', problema: 'erro-interno' });
  });
});

describe('o problema de uma recusa de regra dentro da ferramenta', () => {
  it('só quando o status diz sem ambiguidade', () => {
    expect(problemaDoStatus(400)).toBe('parametro-invalido');
    expect(problemaDoStatus(403)).toBe('escopo-insuficiente');
    expect(problemaDoStatus(404)).toBe('nao-encontrado');
    expect(problemaDoStatus(422)).toBe('regra-invalida');
    expect(problemaDoStatus(409)).toBeUndefined();
  });
});

describe('a chamada atual', () => {
  it('fora da porta, anotar não faz nada', () => {
    expect(chamadaAtual()).toBeUndefined();
    expect(() => anotarChamada({ problema: 'token-invalido' })).not.toThrow();
  });

  it('dentro, a anotação chega a quem roda depois (também depois de esperar), e indefinido não apaga', async () => {
    const chamada = base();
    await comChamada(chamada, async () => {
      anotarChamada({ aplicativo: 'liame', ferramenta: 'orcamento_ler' });
      await new Promise((pronto) => setTimeout(pronto, 5));
      anotarChamada({ aplicativo: undefined, resultado: 'recusada' });
      expect(chamadaAtual()).toBe(chamada);
    });
    expect(chamada).toMatchObject({ aplicativo: 'liame', ferramenta: 'orcamento_ler', resultado: 'recusada' });
    expect(chamadaAtual()).toBeUndefined();
  });
});
