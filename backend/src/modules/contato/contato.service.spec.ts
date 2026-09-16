/**
 * Testes da importação de contatos.
 *
 * O que está sob teste é o que separa um import conferido de um import de fé:
 *
 * - o mesmo assinante escrito de duas formas é UMA pessoa, não duas;
 * - o número sem o `55` é corrigido **e contado**, para a tela poder dizer
 *   quantos foram — assumir em silêncio é como o defeito original começou;
 * - sem consentimento declarado, nada entra.
 *
 * O banco entra como dublê. Nada aqui toca Postgres nem rede.
 */
import { BadRequestException } from '@nestjs/common';

jest.mock('../../config/env', () => ({ env: {} }));

import { ContatoService } from './contato.service';

const CONTA = '11111111-1111-4111-8111-111111111111';
const USUARIO = '22222222-2222-4222-8222-222222222222';

type Encadeavel = Record<string, unknown>;

/** Um handle de consulta que resolve sempre nas mesmas linhas. */
function consulta(linhas: unknown[]): Encadeavel {
  const alvo: Encadeavel = {};
  for (const metodo of ['from', 'where', 'orderBy', 'groupBy', 'limit', 'offset', 'innerJoin', 'returning', 'onConflictDoNothing', 'values', 'set']) {
    alvo[metodo] = () => alvo;
  }
  alvo.then = (resolver: (v: unknown[]) => void) => resolver(linhas);
  return alvo;
}

/** Contexto de banco falso: `select` devolve o que o teste mandar. */
function contextoFalso(jaNaBase: string[] = []) {
  const db = {
    select: () => consulta(jaNaBase.map((telefone) => ({ telefone }))),
    insert: () => consulta([{ id: 'novo' }]),
    update: () => consulta([{ id: 'novo' }]),
  };
  return {
    db,
    comConta: <T>(_conta: string, fn: (d: typeof db) => Promise<T>) => fn(db),
    comEscopoSistema: <T>(_m: string, fn: (d: typeof db) => Promise<T>) => fn(db),
  };
}

const auditoriaFalsa = { registrar: jest.fn(), registrarForaDeContexto: jest.fn() };

function servico(jaNaBase: string[] = []) {
  return new ContatoService(
    contextoFalso(jaNaBase) as never,
    auditoriaFalsa as never,
  );
}

beforeEach(() => jest.clearAllMocks());

describe('prévia da importação', () => {
  it('acrescenta o país que faltou e conta quantos foram', async () => {
    const r = await servico().previa(CONTA, { formato: 'texto' }, '21989751705\n21988887777');

    expect(r.validos).toBe(2);
    expect(r.assumiramPais).toBe(2);
    expect(r.contatos.map((c) => c.telefone)).toEqual(['5521989751705', '5521988887777']);
  });

  it('trata o mesmo assinante escrito de duas formas como UMA pessoa', async () => {
    // Dedup pelo texto original deixaria os dois passarem, e a mesma pessoa
    // receberia a campanha duas vezes — cobrada duas vezes.
    const r = await servico().previa(
      CONTA,
      { formato: 'texto' },
      '(21) 98975-1705\n5521989751705\n+55 21 98975 1705',
    );

    expect(r.validos).toBe(1);
    expect(r.contatos).toHaveLength(1);
  });

  it('separa quem já está na base de quem entra', async () => {
    const r = await servico(['5521989751705']).previa(
      CONTA,
      { formato: 'texto' },
      '21989751705\n21988887777',
    );

    expect(r.jaExistem).toBe(1);
    expect(r.novos).toBe(1);
    expect(r.contatos.find((c) => c.telefone === '5521989751705')?.novo).toBe(false);
  });

  it('conta como inválido o que não é telefone, sem derrubar o resto', async () => {
    const r = await servico().previa(CONTA, { formato: 'texto' }, '21989751705\n123\nabc');

    expect(r.validos).toBe(1);
    expect(r.invalidos).toBe(2);
  });

  it('lê nome e telefone de um CSV com cabeçalho', async () => {
    const csv = 'nome;telefone\nMaria Souza;21989751705\nJoão;21988887777';
    const r = await servico().previa(CONTA, { formato: 'csv' }, csv);

    expect(r.validos).toBe(2);
    expect(r.contatos[0]).toMatchObject({ nome: 'Maria Souza', telefone: '5521989751705' });
  });

  it('do vCard, escolhe o primeiro telefone que normaliza', async () => {
    // O primeiro CELL é um ramal curto; descartar o contato por causa dele
    // perderia uma pessoa que tem número válido logo abaixo.
    const vcf = [
      'BEGIN:VCARD',
      'FN:Maria',
      'TEL;TYPE=CELL:1234',
      'TEL;TYPE=CELL:21989751705',
      'END:VCARD',
    ].join('\n');

    const r = await servico().previa(CONTA, { formato: 'vcard' }, vcf);
    expect(r.contatos[0].telefone).toBe('5521989751705');
  });

  it('recusa arquivo que não é vCard com mensagem que diz o que fazer', async () => {
    await expect(
      servico().previa(CONTA, { formato: 'vcard' }, 'nome;telefone'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('recusa planilha sem coluna de telefone', async () => {
    await expect(
      servico().previa(CONTA, { formato: 'csv' }, 'produto;preco\nX;10'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('confirmação da importação', () => {
  const contatos = [{ telefone: '21989751705', nome: 'Maria' }];

  it('não importa sem o consentimento declarado', async () => {
    // Não é caixinha de termo de uso: é a condição que declaramos à Meta no
    // App Review. Sem ela, a declaração vira falsa.
    await expect(
      servico().importar(CONTA, USUARIO, {
        formato: 'texto',
        consentimento: false,
        contatos,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('grava com consentimento, e normaliza de novo no servidor', async () => {
    const r = await servico().importar(CONTA, USUARIO, {
      formato: 'texto',
      consentimento: true,
      contatos,
    });

    expect(r.gravados).toBe(1);
    expect(auditoriaFalsa.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ acao: 'contato.importado' }),
    );
  });

  it('recusa quando nenhum telefone enviado é válido', async () => {
    await expect(
      servico().importar(CONTA, USUARIO, {
        formato: 'texto',
        consentimento: true,
        contatos: [{ telefone: '123' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
