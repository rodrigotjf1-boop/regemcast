/**
 * A chave mestra (`comEscopoSistema`) e a tabela que explica cada uso
 * (`docs/rls.md`, seção "`comEscopoSistema` — a exceção") andam juntas.
 *
 * Em 26/09/2026 o código usava 86 nomes e a tabela explicava uns 20: cada uso
 * novo entrava sem a linha, e ninguém percebia. Este teste falha quando:
 *
 * - um nome do código não tem linha na tabela;
 * - uma linha cita um nome que não existe mais no código;
 * - o nome não é texto à vista — a parte variável de um template vira `*`, e
 *   é assim que ele aparece na tabela (`codigo.emitir.*`).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(__dirname, '..');
const DOC = join(__dirname, '..', '..', '..', 'docs', 'rls.md');

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return arquivos(caminho);
    return caminho.endsWith('.ts') && !caminho.endsWith('.spec.ts') ? [caminho] : [];
  });
}

/** Cada chamada `.comEscopoSistema(` do código: o nome (ou `null`, se não for texto à vista) e onde está. */
function usosNoCodigo(): { nome: string | null; onde: string }[] {
  const usos: { nome: string | null; onde: string }[] = [];
  for (const arquivo of arquivos(SRC)) {
    const texto = readFileSync(arquivo, 'utf8');
    for (const m of texto.matchAll(/\.comEscopoSistema\(\s*([\s\S]{0,200})/g)) {
      const linha = texto.slice(0, m.index).split('\n').length;
      const onde = `${relative(SRC, arquivo).replace(/\\/g, '/')}:${linha}`;
      const literal = /^(['`])((?:(?!\1)[^\\\n])*)\1\s*,/.exec(m[1]!);
      usos.push({ nome: literal ? literal[2]!.replace(/\$\{[^}]*\}/g, '*') : null, onde });
    }
  }
  return usos;
}

/** Os nomes da primeira coluna das tabelas da seção da chave mestra. */
function nomesNaTabela(): Set<string> {
  const doc = readFileSync(DOC, 'utf8');
  const inicio = doc.indexOf('## `comEscopoSistema`');
  if (inicio < 0) throw new Error('docs/rls.md sem a seção "`comEscopoSistema` — a exceção".');
  const fim = doc.indexOf('\n## ', inicio + 5);
  const secao = doc.slice(inicio, fim < 0 ? undefined : fim);

  const nomes = new Set<string>();
  for (const linha of secao.split('\n')) {
    if (!linha.startsWith('|')) continue;
    const primeira = linha.split('|')[1] ?? '';
    for (const m of primeira.matchAll(/`([^`]+)`/g)) nomes.add(m[1]!);
  }
  return nomes;
}

describe('chave mestra × docs/rls.md', () => {
  const usos = usosNoCodigo();
  const naTabela = nomesNaTabela();
  const noCodigo = new Set(usos.map((u) => u.nome).filter((n): n is string => n !== null));

  it('acha as chamadas (o leitor do código não está quebrado)', () => {
    expect(usos.length).toBeGreaterThan(50);
    expect(naTabela.size).toBeGreaterThan(50);
  });

  it('todo nome é texto à vista, para caber na tabela e no grep', () => {
    expect(usos.filter((u) => u.nome === null).map((u) => u.onde)).toEqual([]);
  });

  it('todo nome do código tem a sua linha na tabela, com o motivo', () => {
    const faltam = usos.filter((u) => u.nome !== null && !naTabela.has(u.nome)).map((u) => `${u.nome} (${u.onde})`);
    expect(faltam).toEqual([]);
  });

  it('toda linha da tabela cita um nome que o código ainda usa', () => {
    expect([...naTabela].filter((n) => !noCodigo.has(n)).sort()).toEqual([]);
  });
});
