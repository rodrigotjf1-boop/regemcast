// O catálogo de ferramentas importa os serviços das telas, e eles leem o ambiente ao carregar.
jest.mock('../../config/env', () => ({ env: { mercadoPago: { carenciaDias: 5 } } }));

import { BadRequestException } from '@nestjs/common';

import { CriarCampanhaDto } from '../campanha/dto/criar-campanha.dto';
import { SalvarModeloDto } from '../modelo/dto/salvar-modelo.dto';
import { emOrdem, FORMATO_DA_CHAVE, hashDoPedido } from './idempotencia.regras';
import { comIdempotencia, comoDto } from './mcp.escrita';
import type { ContextoDaFerramenta } from './mcp.ferramenta';

describe('a chave de idempotência', () => {
  it.each([['pedido-0001'], ['liame:acao:8d9d5c1e-4b0f-4f5e-9a51-2f0a8c6f7a11'], ['a.b_c-d:1'], ['x'.repeat(100)]])('%s vale', (chave) => {
    expect(FORMATO_DA_CHAVE.test(chave)).toBe(true);
  });

  it.each([[''], ['curta'], ['x'.repeat(101)], ['com espaço 1'], ['acento-é-não'], ["aspas'--12"]])('%p não vale', (chave) => {
    expect(FORMATO_DA_CHAVE.test(chave)).toBe(false);
  });
});

describe('a impressão digital do pedido', () => {
  it('o mesmo pedido dá a mesma, venha na ordem que vier', () => {
    const a = { nome: 'Promo', publico: { origem: 'lista', origemId: 'x' }, variaveis: [{ origem: 'fixo', valor: '10%' }] };
    const b = { variaveis: [{ valor: '10%', origem: 'fixo' }], publico: { origemId: 'x', origem: 'lista' }, nome: 'Promo' };
    expect(hashDoPedido(a)).toBe(hashDoPedido(b));
    expect(hashDoPedido(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('campo que não veio e campo indefinido são o mesmo pedido', () => {
    expect(hashDoPedido({ nome: 'Promo', rodape: undefined })).toBe(hashDoPedido({ nome: 'Promo' }));
  });

  it('qualquer diferença de conteúdo muda', () => {
    const base = { nome: 'Promo', variaveis: ['a', 'b'] };
    expect(hashDoPedido(base)).not.toBe(hashDoPedido({ ...base, nome: 'Promo ' }));
    // A ordem de uma lista é conteúdo: {{1}} e {{2}} trocados é outra mensagem.
    expect(hashDoPedido(base)).not.toBe(hashDoPedido({ ...base, variaveis: ['b', 'a'] }));
    expect(hashDoPedido({ a: null })).not.toBe(hashDoPedido({ a: 0 }));
  });

  it('o texto em ordem é JSON de verdade', () => {
    expect(JSON.parse(emOrdem({ b: [1, { d: 'x', c: null }], a: 'é "aspas"' }))).toEqual({ a: 'é "aspas"', b: [1, { c: null, d: 'x' }] });
  });
});

describe('comoDto: a validação é a da rota', () => {
  it('o rascunho de modelo passa como a tela mandaria', () => {
    const dto = comoDto(SalvarModeloDto, { tipo: 'simples', nome: 'promo_sexta', categoria: 'MARKETING', corpo: 'Oi, {{1}}!', corpoExemplos: ['Maria'], rodape: undefined });
    expect(dto).toBeInstanceOf(SalvarModeloDto);
    expect(dto).toMatchObject({ nome: 'promo_sexta', categoria: 'MARKETING', corpo: 'Oi, {{1}}!' });
    expect(dto.rodape).toBeUndefined();
  });

  it('recusa com a frase da rota', () => {
    expect(() => comoDto(SalvarModeloDto, { nome: 'promo', categoria: 'PROMOCAO', corpo: 'Oi' })).toThrow(new BadRequestException('Categoria não reconhecida.'));
  });

  it('campo que a rota não conhece é recusado, como na rota', () => {
    expect(() => comoDto(SalvarModeloDto, { nome: 'promo', corpo: 'Oi', status: 'aprovado' })).toThrow(/status/);
  });

  it('a campanha valida o público e as variáveis por dentro', () => {
    const base = { nome: 'Promo de sexta', modeloNome: 'promo_sexta', modeloIdioma: 'pt_BR' };
    const dto = comoDto(CriarCampanhaDto, { ...base, daBase: { origem: 'base' }, variaveisLista: [{ origem: 'primeiro_nome', valor: 'cliente' }] });
    expect(dto.daBase).toMatchObject({ origem: 'base' });

    expect(() => comoDto(CriarCampanhaDto, { ...base, daBase: { origem: 'lista' } })).toThrow('Escolha a lista ou a importação.');
    expect(() => comoDto(CriarCampanhaDto, { ...base, daBase: { origem: 'base' }, variaveisLista: [{ origem: 'fixo' }] })).toThrow(/Preencha o valor da variável/);
    expect(() => comoDto(CriarCampanhaDto, { ...base, nome: 'x', daBase: { origem: 'base' } })).toThrow(/ao menos 2 caracteres/);
  });
});

describe('comIdempotencia', () => {
  /** Um banco de mentira: guarda uma linha por (token, ferramenta, chave), como o índice único. */
  function bancada() {
    const linhas = new Map<string, { id: string; pedido_hash: string; resposta: unknown }>();
    const execute = jest.fn(async (consulta: { queryChunks: unknown[] }) => {
      const texto = JSON.stringify(consulta.queryChunks);
      const valores = consulta.queryChunks.filter((p) => typeof p === 'string' || p === null) as string[];
      if (texto.includes('insert into integracao_idempotencia')) {
        const [, token, ferramenta, chave, hash] = valores as [string, string, string, string, string];
        const k = `${token}|${ferramenta}|${chave}`;
        if (linhas.has(k)) return { rows: [] };
        linhas.set(k, { id: k, pedido_hash: hash, resposta: null });
        return { rows: [{ id: k }] };
      }
      if (texto.includes('select pedido_hash')) {
        const [token, ferramenta, chave] = valores as [string, string, string];
        const l = linhas.get(`${token}|${ferramenta}|${chave}`);
        return { rows: l ? [{ pedido_hash: l.pedido_hash, resposta: l.resposta }] : [] };
      }
      const [resposta, id] = valores as [string, string];
      linhas.get(id)!.resposta = JSON.parse(resposta);
      return { rows: [] };
    });
    const c = {
      quem: { contaId: 'conta-1', tokenId: 'token-1' },
      ctx: { db: { execute } },
    } as unknown as ContextoDaFerramenta;
    return { c, linhas };
  }

  it('a primeira vez roda a ação e guarda a resposta', async () => {
    const { c, linhas } = bancada();
    const acao = jest.fn(async () => ({ id: 'campanha-1' }));
    await expect(comIdempotencia(c, 'campanha_rascunhar', 'chave-0001', { nome: 'Promo' }, acao)).resolves.toEqual({ id: 'campanha-1' });
    expect(acao).toHaveBeenCalledTimes(1);
    expect([...linhas.values()][0]!.resposta).toEqual({ id: 'campanha-1' });
  });

  it('a mesma chave com o mesmo pedido devolve a resposta guardada, sem rodar de novo', async () => {
    const { c } = bancada();
    const acao = jest.fn(async () => ({ id: 'campanha-1' }));
    await comIdempotencia(c, 'campanha_rascunhar', 'chave-0001', { nome: 'Promo' }, acao);
    await expect(comIdempotencia(c, 'campanha_rascunhar', 'chave-0001', { nome: 'Promo' }, acao)).resolves.toEqual({ id: 'campanha-1' });
    expect(acao).toHaveBeenCalledTimes(1);
  });

  it('a mesma chave com OUTRO pedido é recusada, e a ação não roda', async () => {
    const { c } = bancada();
    const acao = jest.fn(async () => ({ id: 'campanha-1' }));
    await comIdempotencia(c, 'campanha_rascunhar', 'chave-0001', { nome: 'Promo' }, acao);
    await expect(comIdempotencia(c, 'campanha_rascunhar', 'chave-0001', { nome: 'Outra' }, acao)).rejects.toThrow(/já foi usada com outro pedido/);
    expect(acao).toHaveBeenCalledTimes(1);
  });

  it('a chave é por ferramenta: a mesma em outra ferramenta é outra ação', async () => {
    const { c } = bancada();
    const acao = jest.fn(async () => ({ id: 'x' }));
    await comIdempotencia(c, 'campanha_rascunhar', 'chave-0001', { nome: 'Promo' }, acao);
    await comIdempotencia(c, 'modelo_rascunhar', 'chave-0001', { nome: 'Promo' }, acao);
    expect(acao).toHaveBeenCalledTimes(2);
  });

  it('a ação falhou: o erro sobe (e a transação da ferramenta desfaz a chave)', async () => {
    const { c } = bancada();
    await expect(
      comIdempotencia(c, 'campanha_rascunhar', 'chave-0001', {}, async () => {
        throw new BadRequestException('Escolha um modelo aprovado.');
      }),
    ).rejects.toThrow('Escolha um modelo aprovado.');
  });
});
