import { ErroMcp, gerarChave } from '../../dms/integracao-dms';
import {
  chaveDoAjuste,
  conferirAjuste,
  conferirVolta,
  falhaDoGraph,
  lerConfigDmsGraph,
  lerTarefa,
  ligacaoDaTroca,
  ligadoParaConta,
  linkValido,
  pareceMp4,
  urlDaPagina,
} from './dms-graph.regras';

const BASE = {
  DMS_GRAPH_LIGADO: 'true',
  DMS_ID_EMISSOR: 'https://id.exemplo/oidc',
  HUB_APLICATIVO: 'aplicativo-do-cast',
  HUB_SEGREDO: 'segredo-do-aplicativo-de-teste',
};
const ORIGEM = 'https://graph.dmstecnologias.com';
const TAREFA = '00000000-0000-4000-8000-000000000001';

describe('a configuração', () => {
  it('nasce desligada: só o valor exato liga', () => {
    expect(lerConfigDmsGraph({ ...BASE, DMS_GRAPH_LIGADO: undefined }).ligado).toBe(false);
    expect(lerConfigDmsGraph({ ...BASE, DMS_GRAPH_LIGADO: '1' }).ligado).toBe(false);
    expect(lerConfigDmsGraph(BASE).ligado).toBe(true);
  });

  it('o endereço padrão e a volta do Regemcast', () => {
    const c = lerConfigDmsGraph(BASE);
    expect(c.endereco).toBe(`${ORIGEM}/mcp`);
    expect(c.origem).toBe(ORIGEM);
    expect(c.volta).toBe('https://cast.dmsregem.com/integracoes/graph/volta');
  });

  it('APP_URL vazia vale como ausente', () => {
    expect(lerConfigDmsGraph({ ...BASE, APP_URL: '' }).volta).toBe('https://cast.dmsregem.com/integracoes/graph/volta');
  });

  it.each([
    ['http://graph.exemplo/mcp', /https/],
    ['https://graph.exemplo/outra', /\/mcp/],
    ['https://u:s@graph.exemplo/mcp', /usuário/],
    ['nao e endereco', /endereço/],
  ])('endereço torto não liga: %s', (url, motivo) => {
    const c = lerConfigDmsGraph({ ...BASE, DMS_GRAPH_MCP_URL: url });
    expect(c.ligado).toBe(false);
    expect(c.motivo).toMatch(motivo);
  });

  it('em produção não aponta para a própria máquina', () => {
    expect(lerConfigDmsGraph({ ...BASE, NODE_ENV: 'production', DMS_GRAPH_MCP_URL: 'http://localhost:9/mcp' }).ligado).toBe(false);
  });

  it.each(['DMS_ID_EMISSOR', 'HUB_APLICATIVO', 'HUB_SEGREDO'])('sem %s não liga', (nome) => {
    expect(lerConfigDmsGraph({ ...BASE, [nome]: '' }).ligado).toBe(false);
  });

  it('o piloto: vazio = todas; a lista só libera quem está nela', () => {
    expect(ligadoParaConta('abc', BASE)).toBe(true);
    expect(ligadoParaConta('abc', { ...BASE, DMS_GRAPH_CONTAS: 'abc, def' })).toBe(true);
    expect(ligadoParaConta('ABC', { ...BASE, DMS_GRAPH_CONTAS: 'abc' })).toBe(true);
    expect(ligadoParaConta('xyz', { ...BASE, DMS_GRAPH_CONTAS: 'abc;;torto' })).toBe(false);
    expect(ligadoParaConta('abc', { ...BASE, DMS_GRAPH_LIGADO: 'false' })).toBe(false);
  });
});

describe('a volta', () => {
  const state = 'a'.repeat(43);
  const code = `gph_ac_${'c'.repeat(43)}`;

  it('sem o iss do Graph não vale, mesmo com o resto certo', () => {
    expect(conferirVolta({ code, state, iss: 'https://outro.exemplo' }, ORIGEM).tipo).toBe('invalida');
    expect(conferirVolta({ code, state }, ORIGEM).tipo).toBe('invalida');
  });

  it('o código e o state têm a forma do Graph', () => {
    expect(conferirVolta({ code, state, iss: ORIGEM }, ORIGEM)).toEqual({ tipo: 'codigo', estado: state, codigo: code });
    expect(conferirVolta({ code: 'x', state, iss: ORIGEM }, ORIGEM).tipo).toBe('invalida');
    expect(conferirVolta({ code, state: 'curto', iss: ORIGEM }, ORIGEM).tipo).toBe('invalida');
  });

  it('a recusa', () => {
    expect(conferirVolta({ error: 'access_denied', state, iss: ORIGEM }, ORIGEM)).toEqual({ tipo: 'recusa', estado: state, motivo: 'recusado' });
    expect(conferirVolta({ error: 'invalid_request_uri', state, iss: ORIGEM }, ORIGEM)).toEqual({ tipo: 'recusa', estado: state, motivo: 'pedido_invalido' });
  });

  it('a página: só a da origem do Graph', () => {
    expect(urlDaPagina('https://atacante.exemplo/x', ORIGEM, 'app', 'urn:n')).toContain(`${ORIGEM}/autorizar?`);
    expect(urlDaPagina(`${ORIGEM}/autorizar`, ORIGEM, 'app', 'urn:n')).toContain('client_id=app');
  });

  it('a troca: só a ligação do Graph com a permissão de ajustar', () => {
    const { chave } = gerarChave('lg', 'graph');
    expect(ligacaoDaTroca({ ligacao: chave, permissoes: ['videos.ajustar'] })?.ligacao).toBe(chave);
    expect(ligacaoDaTroca({ ligacao: chave, permissoes: ['imagens.criar'] })).toBeNull();
    expect(ligacaoDaTroca({ ligacao: gerarChave('lg', 'regem').chave, permissoes: ['videos.ajustar'] })).toBeNull();
    expect(ligacaoDaTroca(null)).toBeNull();
  });
});

describe('o pedido de ajuste', () => {
  it('monta os argumentos e sempre comprime em 720p', () => {
    const r = conferirAjuste({ inicioSegundos: 2, fimSegundos: 10, proporcao: '9:16', texto: '  Só   hoje ' });
    if ('erro' in r) throw new Error(r.erro);
    expect(r.argumentos).toEqual({
      cortar: { inicioSegundos: 2, fimSegundos: 10 },
      proporcao: { alvo: '9:16', modo: 'preencher' },
      texto: { texto: 'Só hoje', posicao: 'base' },
      comprimir: { ladoMenor: 720, qualidade: 'media' },
    });
  });

  it.each([
    [{}, /Diga o que ajustar/],
    [{ inicioSegundos: 1 }, /começo e o fim/],
    [{ inicioSegundos: 5, fimSegundos: 5.2 }, /meio segundo/],
    [{ inicioSegundos: 0, fimSegundos: 181 }, /180/],
    [{ proporcao: '4:3' as never }, /proporção/],
    [{ texto: 'x'.repeat(81) }, /80 letras/],
    [{ texto: 'promo 🔥' }, /emoji/],
  ])('recusa %j', (d, frase) => {
    const r = conferirAjuste(d);
    expect('erro' in r && r.erro).toMatch(frase);
  });

  it('a chave: o mesmo pedido dá a mesma; qualquer diferença dá outra', () => {
    const a = chaveDoAjuste('c', 'm', { proporcao: '9:16' });
    expect(chaveDoAjuste('c', 'm', { proporcao: '9:16' })).toBe(a);
    expect(chaveDoAjuste('c', 'm', { proporcao: '1:1' })).not.toBe(a);
    expect(chaveDoAjuste('c', 'outra', { proporcao: '9:16' })).not.toBe(a);
    expect(chaveDoAjuste('outra', 'm', { proporcao: '9:16' })).not.toBe(a);
    expect(a.length).toBeLessThanOrEqual(100);
  });
});

describe('a resposta do Graph', () => {
  const pronta = (r: Record<string, unknown> = {}) => ({
    tarefa: TAREFA,
    situacao: 'pronto',
    resultado: { link: `${ORIGEM}/midia/x`, mimeType: 'video/mp4', bytes: 100, largura: 720, altura: 1280, duracaoSegundos: 15.5, ...r },
  });

  it('pronto, em curso e erro', () => {
    expect(lerTarefa(pronta(), ORIGEM)).toMatchObject({ situacao: 'pronto', bytes: 100, duracaoMs: 15500 });
    expect(lerTarefa({ tarefa: TAREFA, situacao: 'processando' }, ORIGEM)).toEqual({ tarefa: TAREFA, situacao: 'processando' });
    expect(lerTarefa({ tarefa: TAREFA, situacao: 'erro', erro: { codigo: 'grande', mensagem: 'Passou de 16 MB.', podeRepetir: false } }, ORIGEM)).toEqual({
      tarefa: TAREFA,
      situacao: 'erro',
      codigo: 'grande',
      frase: 'Passou de 16 MB.',
      podeRepetir: false,
    });
  });

  it.each([
    ['link de outra origem', { link: 'https://outro.exemplo/midia/x' }],
    ['não é MP4', { mimeType: 'image/jpeg' }],
    ['maior que 16 MB', { bytes: 16 * 1024 * 1024 + 1 }],
    ['sem tamanho', { bytes: 0 }],
  ])('fora do formato: %s', (_n, r) => {
    expect(lerTarefa(pronta(r), ORIGEM)).toBeNull();
  });

  it('sem o número da tarefa não vale', () => {
    expect(lerTarefa({ situacao: 'processando' }, ORIGEM)).toBeNull();
    expect(lerTarefa(null, ORIGEM)).toBeNull();
  });

  it('o link', () => {
    expect(linkValido(`${ORIGEM}/midia/a`, ORIGEM)).toBe(true);
    expect(linkValido(`https://u:s@graph.dmstecnologias.com/midia/a`, ORIGEM)).toBe(false);
    expect(linkValido('http://graph.dmstecnologias.com/midia/a', ORIGEM)).toBe(false);
    expect(linkValido(5, ORIGEM)).toBe(false);
  });

  it('o MP4 pela caixa ftyp', () => {
    expect(pareceMp4(Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(8)]))).toBe(true);
    expect(pareceMp4(Buffer.alloc(32, 1))).toBe(false);
  });
});

describe('a falha do Graph vira frase', () => {
  const erro = (tipo: ConstructorParameters<typeof ErroMcp>[0]['tipo'], extra = {}) => new ErroMcp({ tipo, ferramenta: 'ajustar_video', ...extra });

  it('a ligação desfeita pede para conectar de novo', () => {
    expect(falhaDoGraph(erro('ligacao'))).toMatchObject({ codigo: 'ligacao-desfeita', ligacaoDesfeita: true, podeRepetir: false });
  });

  it.each(['limite', 'indisponivel', 'sem-resposta'] as const)('%s pode repetir', (t) => {
    expect(falhaDoGraph(erro(t)).podeRepetir).toBe(true);
  });

  it('a recusa da ferramenta usa a frase e o código dela', () => {
    const f = falhaDoGraph(erro('ferramenta', { frase: 'O vídeo passa de 3 minutos.', dados: { codigo: 'parametro-invalido', pode_repetir: false } }));
    expect(f).toMatchObject({ codigo: 'parametro-invalido', frase: 'O vídeo passa de 3 minutos.', podeRepetir: false });
  });

  it('erro desconhecido nunca mostra a mensagem crua', () => {
    const f = falhaDoGraph(new Error('token dms_lg_graph_segredo vazou'));
    expect(f.frase).not.toContain('dms_lg');
  });
});
