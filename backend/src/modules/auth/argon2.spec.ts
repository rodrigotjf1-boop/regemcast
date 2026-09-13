/**
 * Os DOIS caminhos que criam senha precisam produzir hash com os MESMOS
 * parâmetros de custo.
 *
 * Por que isto merece teste próprio: o login gasta o mesmo tempo para e-mail
 * que existe e para e-mail que não existe porque, quando não existe, ele
 * confere a senha contra um hash-isca. Isso só iguala o relógio enquanto o
 * isca e os hashes reais custarem o mesmo. Quando o cadastro de operador usava
 * os defaults da lib (m=65536, t=3, p=4) e o login usava os da OWASP
 * (m=19456, t=2, p=1), conferir um hash de verdade levava ~85 ms contra ~28 ms
 * do isca — e a diferença de tempo voltava a responder "este e-mail tem conta
 * aqui", que é exatamente a lista que um atacante quer montar.
 *
 * O teste roda o argon2 de verdade (é o ponto: olhar o hash que sai), por isso
 * os timeouts generosos.
 */
import './ambiente-de-teste';

import argon2 from 'argon2';

import type { UsuarioAutenticado } from '../../common/auth.guard';
import type { ContextoDb, Db } from '../../db/contexto';
import type { AuditoriaService } from '../auditoria/auditoria.service';
import { ContaService } from '../conta/conta.service';
import type { CriarUsuarioDto } from '../conta/dto/criar-usuario.dto';
import { OPCOES_ARGON2 } from './argon2';
import { AuthService } from './auth.service';
import type { LoginDto } from './dto/login.dto';
import type { TrocarSenhaDto } from './dto/trocar-senha.dto';

/**
 * A string do argon2 é `$argon2id$v=19$m=...,t=...,p=...$salt$hash`: os três
 * primeiros campos SÃO os parâmetros de custo. Comparar o prefixo compara
 * exatamente o que faz o tempo de resposta ser o que é.
 */
const PARAMETROS = '$argon2id$v=19$m=19456,t=2,p=1';

function prefixo(hash: string): string {
  return hash.split('$').slice(0, 4).join('$');
}

interface Registro {
  gravados: Record<string, unknown>[];
}

type Encadeavel = Record<string, unknown>;

/** Encadeamento mínimo do Drizzle, guardando o que foi gravado. */
function consulta(linhas: unknown[], registro: Registro): Encadeavel {
  const alvo: Encadeavel = {};
  for (const metodo of ['from', 'leftJoin', 'where', 'orderBy', 'limit', 'returning']) {
    alvo[metodo] = () => alvo;
  }
  for (const metodo of ['values', 'set']) {
    alvo[metodo] = (v: Record<string, unknown>) => {
      registro.gravados.push(v);
      return alvo;
    };
  }
  alvo.then = (resolver: (v: unknown[]) => void) => resolver(linhas);
  return alvo;
}

const CONTA = '11111111-1111-4111-8111-111111111111';
const DONO = '22222222-2222-4222-8222-222222222222';
const OPERADOR = '33333333-3333-4333-8333-333333333333';

const dono: UsuarioAutenticado = {
  id: DONO,
  contaId: CONTA,
  nome: 'Rodrigo',
  email: 'dono@empresa.com.br',
  papel: 'dono',
};

const auditoriaFalsa = () =>
  ({
    registrar: jest.fn().mockResolvedValue(undefined),
    registrarForaDeContexto: jest.fn().mockResolvedValue(undefined),
  }) as unknown as AuditoriaService;

function contextoFalso(db: unknown): ContextoDb {
  return {
    db,
    contaId: CONTA,
    contaObrigatoria: () => CONTA,
    comConta: <T>(_conta: string, fn: (d: Db) => Promise<T>) => fn(db as Db),
    comEscopoSistema: <T>(_motivo: string, fn: (d: Db) => Promise<T>) => fn(db as Db),
  } as unknown as ContextoDb;
}

/** Caminho 1: o dono cria um operador (POST /conta/usuarios). */
async function hashDoCadastro(senha: string): Promise<string> {
  const registro: Registro = { gravados: [] };
  const db = {
    select: () => consulta([], registro),
    update: () => consulta([], registro),
    delete: () => consulta([], registro),
    insert: () =>
      consulta(
        [
          {
            id: OPERADOR,
            nome: 'Ana',
            email: 'ana@empresa.com.br',
            papel: 'operador',
            status: 'ativo',
            ultimoLoginEm: null,
            criadoEm: new Date('2026-09-01T12:00:00.000Z'),
          },
        ],
        registro,
      ),
  };

  const service = new ContaService(contextoFalso(db), auditoriaFalsa());
  await service.criarUsuario(
    { nome: 'Ana', email: 'ana@empresa.com.br', senha } as CriarUsuarioDto,
    dono,
  );

  const gravado = registro.gravados[0]?.senhaHash;
  if (typeof gravado !== 'string') throw new Error('o cadastro não gravou senha_hash');
  return gravado;
}

/** Caminho 2: a pessoa troca a própria senha (POST /auth/senha). */
async function hashDaTrocaDeSenha(senhaAtual: string, senhaNova: string): Promise<string> {
  const registro: Registro = { gravados: [] };
  const atual = await argon2.hash(senhaAtual, OPCOES_ARGON2);
  const db = {
    select: () => consulta([{ id: DONO, senhaHash: atual }], registro),
    update: () => consulta([], registro),
    insert: () => consulta([], registro),
    delete: () => consulta([], registro),
  };

  const service = new AuthService(
    contextoFalso(db),
    { signAsync: jest.fn().mockResolvedValue('jwt-de-teste') } as never,
    auditoriaFalsa(),
  );

  await service.trocarSenha(dono, { senhaAtual, senhaNova } as TrocarSenhaDto, {});

  const gravado = registro.gravados[0]?.senhaHash;
  if (typeof gravado !== 'string') throw new Error('a troca não gravou senha_hash');
  return gravado;
}

describe('parâmetros do argon2', () => {
  it('são os da recomendação da OWASP, num lugar só', () => {
    expect(OPCOES_ARGON2).toEqual({
      type: argon2.argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });
  });

  it('cadastro de operador e troca de senha produzem o MESMO custo', async () => {
    const [doCadastro, daTroca] = await Promise.all([
      hashDoCadastro('uma frase boa 2026'),
      hashDaTrocaDeSenha('senha atual 2026', 'outra senha 2027'),
    ]);

    expect(prefixo(doCadastro)).toBe(PARAMETROS);
    expect(prefixo(daTroca)).toBe(PARAMETROS);
    expect(prefixo(doCadastro)).toBe(prefixo(daTroca));
  }, 60_000);

  it('o hash-isca do login usa os mesmos parâmetros (é ele que iguala o tempo)', async () => {
    const espia = jest.spyOn(argon2, 'hash');
    const registro: Registro = { gravados: [] };
    const db = {
      // E-mail que não existe: é exatamente o caminho que aciona o isca.
      select: () => consulta([], registro),
      update: () => consulta([], registro),
      insert: () => consulta([], registro),
      delete: () => consulta([], registro),
    };
    const service = new AuthService(
      contextoFalso(db),
      { signAsync: jest.fn() } as never,
      auditoriaFalsa(),
    );

    await service
      .login({ email: 'ninguem@empresa.com.br', senha: 'chute qualquer 2026' } as LoginDto, {})
      .catch(() => undefined);

    expect(espia).toHaveBeenCalledWith(expect.any(String), OPCOES_ARGON2);
    espia.mockRestore();
  }, 60_000);
});
