import { destinoPelaResposta, separarAgenda } from './agenda.regras';

const add = (phone_number: string, full_name?: string, first_name?: string) => ({
  type: 'contact',
  contact: { phone_number, ...(full_name ? { full_name } : {}), ...(first_name ? { first_name } : {}) },
  action: 'add',
  metadata: { timestamp: '1739321024' },
});
const remove = (phone_number: string) => ({
  type: 'contact',
  contact: { phone_number },
  action: 'remove',
  metadata: { timestamp: '1739321024' },
});

describe('destinoPelaResposta', () => {
  it('sim grava, não descarta, sem resposta espera — para agenda e histórico', () => {
    expect(destinoPelaResposta(true)).toBe('aplicar');
    expect(destinoPelaResposta(false)).toBe('descartar');
    expect(destinoPelaResposta(null)).toBe('aguardar');
  });
});

describe('separarAgenda', () => {
  it('lê o payload como a Meta documenta', () => {
    const r = separarAgenda([add('5521989751705', 'Pablo Morales', 'Pablo')]);
    expect(r).toEqual({
      adicionar: [{ telefone: '5521989751705', nome: 'Pablo Morales' }],
      remover: [],
      invalidos: 0,
      ignorados: 0,
    });
  });

  it('usa o primeiro nome quando não há nome completo, e aceita contato sem nome', () => {
    expect(separarAgenda([add('5521989751705', undefined, 'Ana')]).adicionar[0].nome).toBe('Ana');
    expect(separarAgenda([add('5521989751705')]).adicionar[0].nome).toBeNull();
  });

  it('devolve o 9 ao celular antigo, no mesmo formato do contato', () => {
    expect(separarAgenda([add('552189751705', 'Maria')]).adicionar[0].telefone).toBe('5521989751705');
  });

  it('número estrangeiro vale como veio', () => {
    expect(separarAgenda([add('16505551234', 'Pablo')]).adicionar[0].telefone).toBe('16505551234');
  });

  it('remoção vai para a lista de saída, sem nome', () => {
    const r = separarAgenda([remove('5521989751705')]);
    expect(r.remover).toEqual(['5521989751705']);
    expect(r.adicionar).toEqual([]);
  });

  it('o mesmo número duas vezes: vale a última ação', () => {
    expect(separarAgenda([add('5521989751705', 'A'), remove('5521989751705')])).toMatchObject({
      adicionar: [],
      remover: ['5521989751705'],
    });
    expect(separarAgenda([remove('5521989751705'), add('5521989751705', 'B')])).toMatchObject({
      adicionar: [{ telefone: '5521989751705', nome: 'B' }],
      remover: [],
    });
  });

  it('as duas formas do mesmo celular (com e sem o 9) contam como um só', () => {
    const r = separarAgenda([add('552189751705', 'Velho'), add('5521989751705', 'Novo')]);
    expect(r.adicionar).toEqual([{ telefone: '5521989751705', nome: 'Novo' }]);
  });

  it('conta inválidos e ignora ação desconhecida em vez de tratá-la como "add"', () => {
    const r = separarAgenda([
      add('123'),
      { type: 'contact', contact: { phone_number: '5521989751705' }, action: 'edit' },
      { type: 'label', action: 'add' },
      null,
    ]);
    expect(r).toEqual({ adicionar: [], remover: [], invalidos: 1, ignorados: 3 });
  });

  it('não estoura com payload que não é lista', () => {
    expect(separarAgenda(undefined)).toEqual({ adicionar: [], remover: [], invalidos: 0, ignorados: 0 });
    expect(separarAgenda({})).toEqual({ adicionar: [], remover: [], invalidos: 0, ignorados: 0 });
  });

  it('limpa espaços e corta nome gigante', () => {
    const r = separarAgenda([add('5521989751705', `  Maria   da  Silva ${'x'.repeat(300)}`)]);
    expect(r.adicionar[0].nome!.startsWith('Maria da Silva')).toBe(true);
    expect(r.adicionar[0].nome!.length).toBe(120);
  });
});
