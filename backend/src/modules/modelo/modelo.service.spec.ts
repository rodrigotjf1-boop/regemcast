/**
 * Editar e excluir modelo que JÁ está na Meta.
 *
 * O que estes testes protegem é o que a Meta cobra caro:
 *
 * - modelo aprovado aceita UMA edição por dia — descobrir isso pelo erro dela,
 *   depois de reescrever o modelo, é o atrito que o produto existe para evitar;
 * - a exclusão tem de acontecer LÁ antes de sumir daqui, senão fica um modelo
 *   órfão na Meta ocupando o nome por 30 dias, sem tela nenhuma onde apareça;
 * - a categoria nunca vai junto na edição: mandá-la faz a Meta recusar tudo.
 */
import { BadRequestException, ConflictException } from '@nestjs/common';

// O serviço lê env na importação; o teste não precisa de banco nenhum.
jest.mock('../../config/env', () => ({ env: { meta: { graphVersao: 'v21.0' } } }));

import { ModeloService } from './modelo.service';

const MODELO_BASE = {
  id: 'm1',
  contaId: 'c1',
  nome: 'promo_sexta',
  idioma: 'pt_BR',
  tipo: 'simples',
  categoria: 'MARKETING',
  categoriaMeta: null,
  status: 'aprovado',
  motivo: null,
  corpo: 'Olá! Temos novidades para você nesta sexta.',
  corpoExemplos: [],
  cabecalhoFormato: null,
  cabecalhoTexto: null,
  cabecalhoExemplo: null,
  cabecalhoMidia: null,
  rodape: null,
  botoes: [],
  cartoes: [],
  ltoAtivo: false,
  ltoTexto: null,
  metaTemplateId: '999' as string | null,
  editadoMetaEm: null as Date | null,
};

const DTO = {
  nome: MODELO_BASE.nome,
  idioma: 'pt_BR',
  categoria: 'MARKETING' as const,
  corpo: 'Olá! Temos novidades para você nesta sexta, com frete grátis.',
};

function montar(parcial: Partial<typeof MODELO_BASE> = {}) {
  const linha = { ...MODELO_BASE, ...parcial };
  const gravado: Record<string, unknown>[] = [];

  const cadeia = () => {
    const c: Record<string, unknown> = {};
    for (const m of ['from', 'where', 'limit', 'returning']) c[m] = () => c;
    c.set = (v: Record<string, unknown>) => {
      gravado.push(v);
      return c;
    };
    c.then = (r: (v: unknown[]) => void) => r([linha]);
    return c;
  };

  const db = {
    select: () => cadeia(),
    update: () => cadeia(),
    delete: () => cadeia(),
  };

  const ctx = { comConta: <T>(_c: string, fn: (d: typeof db) => Promise<T>) => fn(db), db };
  const meta = { tokenDaConta: jest.fn().mockResolvedValue({ token: 'tok', wabaId: 'waba1' }) };
  const graph = {
    editarModelo: jest.fn().mockResolvedValue({ success: true }),
    lerModelo: jest.fn().mockResolvedValue({ id: '999', status: 'PENDING' }),
    excluirModelo: jest.fn().mockResolvedValue(undefined),
  };
  const auditoria = { registrar: jest.fn().mockResolvedValue(undefined) };
  const midia = {
    handleParaModelo: jest.fn(),
    formatosDe: jest.fn().mockResolvedValue(new Map<string, string>()),
  };

  const service = new ModeloService(
    ctx as never,
    meta as never,
    graph as never,
    auditoria as never,
    midia as never,
  );

  return { service, graph, meta, auditoria, gravado, linha, db, midia };
}

describe('editar modelo que está na Meta', () => {
  it('manda só os componentes — categoria nunca vai junto', async () => {
    const m = montar();
    await m.service.editarNaMeta('c1', 'u1', 'm1', DTO);

    expect(m.graph.editarModelo).toHaveBeenCalledTimes(1);
    const [templateId, token, componentes] = m.graph.editarModelo.mock.calls[0];
    expect(templateId).toBe('999');
    expect(token).toBe('tok');
    expect(Array.isArray(componentes)).toBe(true);
    expect(JSON.stringify(componentes)).not.toContain('MARKETING');
  });

  it('recusa a segunda edição no mesmo dia, dizendo quando dá para tentar', async () => {
    const m = montar({ editadoMetaEm: new Date(Date.now() - 2 * 3_600_000) });

    await expect(m.service.editarNaMeta('c1', 'u1', 'm1', DTO)).rejects.toBeInstanceOf(BadRequestException);
    expect(m.graph.editarModelo).not.toHaveBeenCalled();
  });

  it('deixa editar depois de passadas as 24 horas', async () => {
    const m = montar({ editadoMetaEm: new Date(Date.now() - 25 * 3_600_000) });
    await m.service.editarNaMeta('c1', 'u1', 'm1', DTO);
    expect(m.graph.editarModelo).toHaveBeenCalled();
  });

  it('grava o status que a Meta diz depois da edição, e não um palpite', async () => {
    const m = montar();
    m.graph.lerModelo.mockResolvedValue({ id: '999', status: 'APPROVED', category: 'MARKETING' });

    const r = await m.service.editarNaMeta('c1', 'u1', 'm1', DTO);

    expect(r.status).toBe('aprovado');
    expect(m.gravado.some((g) => g.status === 'aprovado' && g.editadoMetaEm instanceof Date)).toBe(true);
  });

  it('se a releitura falhar, fica em análise — o conservador, nunca "aprovado" por engano', async () => {
    const m = montar();
    m.graph.lerModelo.mockRejectedValue(new Error('rede'));

    const r = await m.service.editarNaMeta('c1', 'u1', 'm1', DTO);
    expect(r.status).toBe('enviado');
  });

  it('modelo em análise não é editável', async () => {
    const m = montar({ status: 'enviado' });
    await expect(m.service.editarNaMeta('c1', 'u1', 'm1', DTO)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('excluir modelo', () => {
  it('apaga na Meta com o id do idioma antes de apagar aqui', async () => {
    const m = montar();
    const r = await m.service.excluir('c1', 'u1', 'm1');

    expect(m.graph.excluirModelo).toHaveBeenCalledWith('waba1', 'tok', 'promo_sexta', '999');
    expect(r).toEqual({ ok: true, naMeta: true });
  });

  it('se a Meta recusar, nada some daqui', async () => {
    const m = montar();
    m.graph.excluirModelo.mockRejectedValue(new Error('meta fora'));

    await expect(m.service.excluir('c1', 'u1', 'm1')).rejects.toBeInstanceOf(BadRequestException);
    expect(m.auditoria.registrar).not.toHaveBeenCalled();
  });

  it('rascunho nosso não chama a Meta', async () => {
    const m = montar({ status: 'rascunho', metaTemplateId: null });
    const r = await m.service.excluir('c1', 'u1', 'm1');

    expect(m.graph.excluirModelo).not.toHaveBeenCalled();
    expect(r).toEqual({ ok: true, naMeta: false });
  });
});

describe('cópia de outro modelo (a Meta recusa corpo e rodapé iguais aos de um que já existe)', () => {
  it('conferir aponta a cópia de um modelo nosso, pelo nome dele', async () => {
    const m = montar();
    const problemas = await m.service.conferir('c1', { ...DTO, nome: 'promo_nova', corpo: MODELO_BASE.corpo });
    expect(problemas.map((p) => p.mensagem).join(' ')).toContain('O modelo "promo_sexta" já tem este mesmo texto');
  });

  it('conferir aponta a cópia de um modelo criado direto no painel da Meta', async () => {
    const m = montar();
    Object.assign(m.meta, {
      modelos: jest.fn().mockResolvedValue([{ id: '555', nome: 'feito_na_meta', corpo: DTO.corpo, rodape: null }]),
    });
    const problemas = await m.service.conferir('c1', { ...DTO, nome: 'promo_nova' });
    expect(problemas.map((p) => p.mensagem).join(' ')).toContain('"feito_na_meta"');
  });

  it('o modelo editado não é cópia de si mesmo', async () => {
    const m = montar();
    Object.assign(m.meta, {
      modelos: jest.fn().mockResolvedValue([{ id: '999', nome: 'promo_sexta', corpo: MODELO_BASE.corpo, rodape: null }]),
    });
    await m.service.editarNaMeta('c1', 'u1', 'm1', { ...DTO, corpo: MODELO_BASE.corpo });
    expect(m.graph.editarModelo).toHaveBeenCalledTimes(1);
  });

  it('envio para aprovação: cópia é barrada ANTES de ir à Meta', async () => {
    const m = montar({ status: 'rascunho', metaTemplateId: null });
    const criarModelo = jest.fn();
    Object.assign(m.graph, { criarModelo });
    Object.assign(m.meta, {
      modelos: jest.fn().mockResolvedValue([{ id: '555', nome: 'feito_na_meta', corpo: MODELO_BASE.corpo, rodape: null }]),
    });
    await expect(m.service.enviarParaAprovacao('c1', 'u1', 'm1')).rejects.toBeInstanceOf(BadRequestException);
    expect(criarModelo).not.toHaveBeenCalled();
  });

  it('sem a lista da Meta (fora do ar), confere só os nossos e não trava', async () => {
    const m = montar();
    Object.assign(m.meta, { modelos: jest.fn().mockRejectedValue(new Error('fora do ar')) });
    const problemas = await m.service.conferir('c1', { ...DTO, nome: 'promo_nova' });
    expect(problemas).toEqual([]);
  });
});

describe('exemplos das variáveis (a Meta recusa exemplo a mais: erro 132000)', () => {
  // A tela guarda os exemplos por posição. Quem preenche dois e depois apaga o
  // {{2}} do texto fica com um exemplo sobrando — e ele não pode ir junto.
  const CORPO_UMA = 'Olá {{1}}, seu pedido saiu hoje da cozinha para entrega.';

  function exemplosDoCorpo(componentes: unknown): unknown {
    const lista = componentes as { type: string; example?: { body_text?: unknown } }[];
    return lista.find((c) => c.type === 'BODY')?.example?.body_text;
  }

  it('envio para aprovação: só um exemplo por variável do texto', async () => {
    const m = montar({ status: 'rascunho', metaTemplateId: null, corpo: CORPO_UMA, corpoExemplos: ['Ana', '4521'] as never });
    const criarModelo = jest.fn().mockResolvedValue({ id: '777', status: 'PENDING' });
    Object.assign(m.graph, { criarModelo });

    await m.service.enviarParaAprovacao('c1', 'u1', 'm1');

    const corpo = criarModelo.mock.calls[0][2] as { components: unknown };
    expect(exemplosDoCorpo(corpo.components)).toEqual([['Ana']]);
  });

  it('edição na Meta: o exemplo que sobrou não vai', async () => {
    const m = montar();
    await m.service.editarNaMeta('c1', 'u1', 'm1', { ...DTO, corpo: CORPO_UMA, corpoExemplos: ['Ana', '4521'] });

    const componentes = m.graph.editarModelo.mock.calls[0][2];
    expect(exemplosDoCorpo(componentes)).toEqual([['Ana']]);
  });
});

describe('nome repetido (o nome, com o idioma, é a chave do modelo aqui e na Meta)', () => {
  const OUTRO_TEXTO = 'Chegou o combo de domingo com batata e refrigerante para a família.';

  it('conferir aponta, na seção do nome, um modelo nosso com o mesmo nome', async () => {
    const m = montar();
    const problemas = await m.service.conferir('c1', { ...DTO, corpo: OUTRO_TEXTO });
    expect(problemas).toEqual([
      expect.objectContaining({ campo: 'nome', mensagem: expect.stringContaining('Já existe um modelo "promo_sexta"') }),
    ]);
  });

  it('o próprio modelo, sendo editado, não repete o nome de si mesmo', async () => {
    const m = montar();
    const problemas = await m.service.conferir('c1', { ...DTO, corpo: OUTRO_TEXTO }, 'm1');
    expect(problemas).toEqual([]);
  });

  it('conferir aponta o nome que a Meta já tem (modelo criado direto no painel dela)', async () => {
    const m = montar();
    Object.assign(m.meta, {
      modelos: jest.fn().mockResolvedValue([
        { id: '555', nome: 'feito_na_meta', idioma: 'pt_BR', corpo: 'outro texto qualquer', rodape: null },
      ]),
    });
    const problemas = await m.service.conferir('c1', { ...DTO, nome: 'feito_na_meta', corpo: OUTRO_TEXTO });
    expect(problemas).toEqual([
      expect.objectContaining({ campo: 'nome', mensagem: expect.stringContaining('A Meta já tem um modelo "feito_na_meta"') }),
    ]);
  });

  it('salvar com nome repetido responde 409 com a frase — e não "algo deu errado" (500)', async () => {
    const m = montar();
    const duplicado = Object.assign(new Error('duplicar valor da chave viola a restrição de unicidade "idx_modelo_unico"'), {
      code: '23505',
    });
    Object.assign(m.db, {
      insert: () => ({ values: () => ({ returning: () => Promise.reject(duplicado) }) }),
    });
    const tentativa = m.service.salvarRascunho('c1', 'u1', { ...DTO, corpo: OUTRO_TEXTO });
    await expect(tentativa).rejects.toBeInstanceOf(ConflictException);
    await expect(m.service.salvarRascunho('c1', 'u1', { ...DTO, corpo: OUTRO_TEXTO })).rejects.toThrow(
      'Já existe um modelo "promo_sexta" nesta conta.',
    );
  });

  it('o erro 23505 embrulhado (cause) também vira 409', async () => {
    const m = montar();
    const embrulhado = Object.assign(new Error('Failed query'), { cause: { code: '23505' } });
    Object.assign(m.db, {
      insert: () => ({ values: () => ({ returning: () => Promise.reject(embrulhado) }) }),
    });
    await expect(m.service.salvarRascunho('c1', 'u1', { ...DTO, corpo: OUTRO_TEXTO })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('mídia que não combina com o formato (imagem no cabeçalho que virou vídeo)', () => {
  const FOTO = '11111111-2222-4333-8444-555555555555';
  const VIDEO = '66666666-7777-4888-8999-000000000000';
  const TEXTO = 'Olha o smash novo que chegou na loja hoje, só para quem pede pelo app.';

  it('conferir aponta, no cabeçalho, a imagem guardada como vídeo', async () => {
    const m = montar();
    m.midia.formatosDe.mockResolvedValue(new Map([[FOTO, 'IMAGE']]));
    const problemas = await m.service.conferir(
      'c1',
      { ...DTO, nome: 'promo_video', corpo: TEXTO, cabecalhoFormato: 'VIDEO', cabecalhoMidia: `midia:${FOTO}` },
    );
    expect(m.midia.formatosDe).toHaveBeenCalledWith('c1', [FOTO]);
    expect(problemas).toEqual([
      expect.objectContaining({
        campo: 'cabecalho',
        mensagem: 'O cabeçalho pede um vídeo, mas o arquivo escolhido é uma imagem. Escolha um vídeo, ou troque o formato.',
      }),
    ]);
  });

  it('a mídia do formato certo passa', async () => {
    const m = montar();
    m.midia.formatosDe.mockResolvedValue(new Map([[FOTO, 'IMAGE']]));
    const problemas = await m.service.conferir(
      'c1',
      { ...DTO, nome: 'promo_foto', corpo: TEXTO, cabecalhoFormato: 'IMAGE', cabecalhoMidia: `midia:${FOTO}` },
    );
    expect(problemas).toEqual([]);
  });

  it('carrossel: cartão com vídeo no lugar da imagem', async () => {
    const m = montar();
    m.midia.formatosDe.mockResolvedValue(new Map([[FOTO, 'IMAGE'], [VIDEO, 'VIDEO']]));
    const problemas = await m.service.conferir('c1', {
      ...DTO,
      nome: 'vitrine',
      corpo: 'Escolha o seu burger da semana entre as opções da casa.',
      tipo: 'carrossel',
      cartoes: [
        { imagem: `midia:${FOTO}`, corpo: 'Smash', botoes: [{ tipo: 'QUICK_REPLY', texto: 'Quero' }] },
        { imagem: `midia:${VIDEO}`, corpo: 'Duplo', botoes: [{ tipo: 'QUICK_REPLY', texto: 'Quero' }] },
      ],
    });
    expect(problemas.filter((p) => p.campo === 'cartoes').map((p) => p.mensagem)).toContain(
      'O cartão 2 pede uma imagem, mas o arquivo escolhido é um vídeo. Escolha uma imagem, ou troque o formato.',
    );
  });

  it('referência que não é uuid nem chega à consulta', async () => {
    const m = montar();
    await m.service.conferir('c1', {
      ...DTO,
      nome: 'promo_x',
      corpo: TEXTO,
      cabecalhoFormato: 'IMAGE',
      cabecalhoMidia: "midia:1' or 1=1 --",
    });
    expect(m.midia.formatosDe).not.toHaveBeenCalled();
  });

  it('envio para aprovação: a mídia trocada é barrada ANTES de ir à Meta', async () => {
    const m = montar({
      status: 'rascunho',
      metaTemplateId: null,
      corpo: TEXTO,
      cabecalhoFormato: 'VIDEO' as never,
      cabecalhoMidia: `midia:${FOTO}` as never,
    });
    m.midia.formatosDe.mockResolvedValue(new Map([[FOTO, 'IMAGE']]));
    const criarModelo = jest.fn();
    Object.assign(m.graph, { criarModelo });
    await expect(m.service.enviarParaAprovacao('c1', 'u1', 'm1')).rejects.toBeInstanceOf(BadRequestException);
    expect(criarModelo).not.toHaveBeenCalled();
    expect(m.midia.handleParaModelo).not.toHaveBeenCalled();
  });
});
