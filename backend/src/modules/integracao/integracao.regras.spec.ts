// O catálogo de ferramentas importa os serviços das telas, e eles leem o ambiente ao carregar.
jest.mock('../../config/env', () => ({ env: { mercadoPago: { carenciaDias: 5 } } }));

import {
  conferirEmissao,
  descreverEscopos,
  ESCOPOS,
  escoposEfetivos,
  gerarToken,
  hashDoToken,
  prefixoVisivel,
  tokenDoCabecalho,
} from './integracao.regras';
import { ferramentasDe, FERRAMENTAS } from './mcp.servidor';

describe('conferirEmissao', () => {
  const ok = { produto: 'liame', classe: 'dms', nome: 'Liame — piloto', escopos: ['campanhas.ler', 'conta.ler'] };

  it('aceita e devolve os escopos na ordem do catálogo, sem repetição', () => {
    expect(conferirEmissao({ ...ok, escopos: ['campanhas.ler', 'conta.ler', 'conta.ler'] })).toEqual({
      produto: 'liame',
      classe: 'dms',
      nome: 'Liame — piloto',
      escopos: ['conta.ler', 'campanhas.ler'],
    });
  });

  it('o produto vira minúsculas e o nome perde os espaços das pontas', () => {
    expect(conferirEmissao({ ...ok, produto: ' Liame ', nome: '  Liame  ' })).toMatchObject({ produto: 'liame', nome: 'Liame' });
  });

  it('disparo: produto da DMS pode', () => {
    expect(conferirEmissao({ ...ok, escopos: ['campanhas.disparar'] })).toMatchObject({ escopos: ['campanhas.disparar'] });
  });

  it('disparo: cliente de fora NÃO pode (decisão do dono, 02/10/2026)', () => {
    expect(conferirEmissao({ ...ok, classe: 'externo', escopos: ['conta.ler', 'campanhas.disparar'] })).toEqual({
      erro: 'A permissão "Disparar campanha" só existe para produtos da DMS. Cliente de fora não dispara.',
    });
  });

  it.each([
    [{ produto: '' }, /Informe o produto/],
    [{ produto: 'Liame com espaço' }, /Informe o produto/],
    [{ produto: 'l' }, /Informe o produto/],
    [{ classe: 'parceiro' }, /produto da DMS ou de um cliente de fora/],
    [{ classe: undefined }, /produto da DMS ou de um cliente de fora/],
    [{ nome: 'x' }, /Dê um nome ao token/],
    [{ nome: 'x'.repeat(81) }, /Dê um nome ao token/],
    [{ escopos: [] }, /pelo menos uma permissão/],
    [{ escopos: 'conta.ler' }, /pelo menos uma permissão/],
    [{ escopos: ['conta.ler', 'tudo.liberado'] }, /A permissão "tudo.liberado" não existe/],
  ])('%p é recusado com a frase do conserto', (mudanca, frase) => {
    const r = conferirEmissao({ ...ok, ...mudanca });
    expect(r).toEqual({ erro: expect.stringMatching(frase) });
  });
});

describe('escoposEfetivos', () => {
  it('só vale o que está no catálogo', () => {
    expect(escoposEfetivos(['conta.ler', 'inventado', 7], 'dms')).toEqual(['conta.ler']);
  });

  it('linha adulterada: token externo com disparo no banco NÃO dispara', () => {
    expect(escoposEfetivos(['conta.ler', 'campanhas.disparar'], 'externo')).toEqual(['conta.ler']);
    expect(escoposEfetivos(['conta.ler', 'campanhas.disparar'], 'dms')).toEqual(['conta.ler', 'campanhas.disparar']);
  });

  it('o que não é lista vira nenhuma permissão', () => {
    expect(escoposEfetivos('conta.ler', 'dms')).toEqual([]);
    expect(escoposEfetivos(null, 'dms')).toEqual([]);
  });
});

describe('o catálogo', () => {
  it('todo escopo tem a frase que o dono lê', () => {
    for (const e of ESCOPOS) {
      expect(e.rotulo.length).toBeGreaterThan(3);
      expect(e.descricao).toMatch(/\.$/);
    }
  });

  it('só o disparo é exclusivo da DMS', () => {
    expect(ESCOPOS.filter((e) => e.soDms).map((e) => e.id)).toEqual(['campanhas.disparar']);
  });

  it('descreverEscopos devolve o texto do dono, na ordem do catálogo', () => {
    expect(descreverEscopos(['campanhas.ler', 'conta.ler']).map((e) => e.rotulo)).toEqual(['Situação da conta', 'Campanhas e resultados']);
  });
});

describe('o token', () => {
  it('nasce com o prefixo e 43 caracteres de acaso, e cada um é diferente', () => {
    const a = gerarToken();
    const b = gerarToken();
    expect(a).toMatch(/^rct_it_[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });

  it('o hash é sha-256 em hexadecimal, e o mesmo token dá o mesmo hash', () => {
    const t = gerarToken();
    expect(hashDoToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashDoToken(t)).toBe(hashDoToken(t));
    expect(hashDoToken(t)).not.toBe(hashDoToken(gerarToken()));
  });

  it('a tela vê só o começo', () => {
    expect(prefixoVisivel('rct_it_abcdefghXYZ')).toBe('rct_it_abcdefgh');
  });

  it('do cabeçalho Authorization, só o que tem a cara de um token nosso', () => {
    const t = gerarToken();
    expect(tokenDoCabecalho(`Bearer ${t}`)).toBe(t);
    expect(tokenDoCabecalho(`bearer ${t}`)).toBe(t);
    expect(tokenDoCabecalho(`  Bearer   ${t}  `)).toBe(t);
    expect(tokenDoCabecalho(t)).toBeNull();
    expect(tokenDoCabecalho('Bearer abc')).toBeNull();
    expect(tokenDoCabecalho(`Bearer ${t}x`)).toBeNull();
    expect(tokenDoCabecalho(`Basic ${t}`)).toBeNull();
    expect(tokenDoCabecalho(undefined)).toBeNull();
    expect(tokenDoCabecalho(['Bearer', t])).toBeNull();
  });
});

describe('as ferramentas de cada token', () => {
  it('toda ferramenta tem nome no formato que os clientes aceitam (snake_case, até 64, sem ponto)', () => {
    for (const f of FERRAMENTAS) expect(f.nome).toMatch(/^[a-z][a-z0-9_]{0,63}$/);
  });

  it('toda ferramenta exige um escopo do catálogo, ou nenhum', () => {
    const ids = new Set(ESCOPOS.map((e) => e.id));
    for (const f of FERRAMENTAS) expect(f.escopo === null || ids.has(f.escopo)).toBe(true);
  });

  it('a situação da integração vale para qualquer token; o resto, só com o escopo', () => {
    expect(ferramentasDe({ escopos: [] }).map((f) => f.nome)).toEqual(['integracao_situacao']);
    expect(ferramentasDe({ escopos: ['campanhas.ler'] }).map((f) => f.nome)).toEqual([
      'integracao_situacao',
      'campanhas_listar',
      'campanha_detalhar',
    ]);
    expect(ferramentasDe({ escopos: ['publicos.ler', 'orcamento.ler'] }).map((f) => f.nome)).toEqual([
      'integracao_situacao',
      'publicos_listar',
      'publico_estimar',
      'orcamento_ler',
    ]);
  });

  it('o telefone de quem veio de anúncio só sai com a permissão própria', () => {
    expect(ferramentasDe({ escopos: ['conversas.anuncio.ler'] }).map((f) => f.nome)).toEqual([
      'integracao_situacao',
      'conversas_anuncio_listar',
    ]);
    const leitura = ['conta.ler', 'campanhas.ler', 'publicos.ler', 'modelos.ler', 'orcamento.ler'];
    expect(ferramentasDe({ escopos: leitura }).map((f) => f.nome)).not.toContain('conversas_anuncio_listar');
  });

  it('rascunhar pede a permissão de rascunhar: quem só lê não grava', () => {
    expect(ferramentasDe({ escopos: ['modelos.rascunhar'] }).map((f) => f.nome)).toEqual(['integracao_situacao', 'modelo_rascunhar']);
    expect(ferramentasDe({ escopos: ['campanhas.rascunhar'] }).map((f) => f.nome)).toEqual(['integracao_situacao', 'campanha_rascunhar']);
    const leitura = ['conta.ler', 'campanhas.ler', 'publicos.ler', 'modelos.ler', 'orcamento.ler', 'conversas.anuncio.ler'];
    const nomes = ferramentasDe({ escopos: leitura }).map((f) => f.nome);
    expect(nomes).not.toContain('modelo_rascunhar');
    expect(nomes).not.toContain('campanha_rascunhar');
  });

  it('não existe ferramenta que dispare: o escopo de disparo ainda não libera nada', () => {
    expect(ferramentasDe({ escopos: ['campanhas.disparar'] }).map((f) => f.nome)).toEqual(['integracao_situacao']);
  });

  it('nenhuma ferramenta de leitura fica sem escopo: só a situação da integração é de todos', () => {
    expect(FERRAMENTAS.filter((f) => f.escopo === null).map((f) => f.nome)).toEqual(['integracao_situacao']);
  });

  it('não há duas ferramentas com o mesmo nome', () => {
    const nomes = FERRAMENTAS.map((f) => f.nome);
    expect(new Set(nomes).size).toBe(nomes.length);
  });
});
