#!/usr/bin/env node
/**
 * Runner de migration do Regemcast — com LEDGER.
 *
 * Por que ledger: no Regem não existe tabela de controle. O runner re-executa
 * os ~240 arquivos em ordem a cada atualização e engole uma lista de SQLSTATEs
 * considerados "benignos" (42P07, 42701, 42P01...). O efeito colateral é que
 * uma migration que falhou de verdade passa despercebida, e o banco fica
 * diferente do que o código espera sem ninguém saber.
 *
 * Aqui é o contrário:
 *   - cada arquivo aplicado entra em schema_migrations com o sha256 do conteúdo;
 *   - arquivo já aplicado NUNCA roda de novo;
 *   - arquivo já aplicado que foi EDITADO aborta tudo, com o nome do arquivo;
 *   - cada arquivo roda na própria transação (falhou, desfaz só ele);
 *   - falha imprime SQLSTATE, mensagem, detail, hint e a linha/coluna exatas.
 *
 * Uso:
 *   npm run migrate              aplica as pendentes
 *   npm run migrate -- --status  mostra aplicadas x pendentes
 *   npm run migrate -- --dry     lista o que aplicaria, sem aplicar
 *
 * 000_roles.sql NÃO é aplicado por este runner e não entra no ledger: criar
 * role exige superusuário, que a aplicação não tem (nem deve ter). Ele é passo
 * manual, uma vez, no SQL Editor do Supabase — ver docs/banco.md.
 *
 * QUEM CONECTA: `MIGRATION_DATABASE_URL` se existir, senão `DATABASE_URL`. São
 * usuários diferentes de propósito. A API roda como `regemcast_app`, que não
 * tem CREATE no schema public — e migration é DDL. Rodar o runner com a URL da
 * aplicação não "quase funciona": ele para antes de escrever qualquer coisa e
 * diz qual variável falta.
 *
 * ORDEM DAS CHECAGENS: os pré-requisitos (role existe, usuário pode criar
 * objeto) rodam ANTES de tocar no ledger. Isso importa porque o ledger é ele
 * próprio um `create table` — checar depois trocava a mensagem que explica o
 * problema por um "Erro inesperado no runner: permission denied for schema
 * public", inclusive no `--status`, que nem escreve nada.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ_BACKEND = resolve(AQUI, '..');
const RAIZ_REPO = resolve(RAIZ_BACKEND, '..');
/**
 * Onde ficam os .sql. São DOIS layouts, e os dois existem de verdade:
 *
 *   - no repositório, o runner mora em backend/scripts e as migrations em
 *     ../../database/migrations;
 *   - na imagem, o Dockerfile copia `database/migrations` para dentro de /app
 *     (ao lado de `scripts`), então o mesmo cálculo apontaria para
 *     `/database/migrations`, que não existe — e o runner morreria com "pasta
 *     de migrations não encontrada" na primeira vez que alguém rodasse
 *     `npm run migrate` dentro do contêiner.
 *
 * `MIGRATIONS_DIR` vence os dois, para quem tiver um layout próprio.
 */
const CANDIDATOS_MIGRATIONS = (process.env.MIGRATIONS_DIR || '').trim()
  ? [resolve((process.env.MIGRATIONS_DIR || '').trim())]
  : [join(RAIZ_REPO, 'database', 'migrations'), join(RAIZ_BACKEND, 'database', 'migrations')];
const DIR_MIGRATIONS = CANDIDATOS_MIGRATIONS.find((c) => existsSync(c)) ?? CANDIDATOS_MIGRATIONS[0];
const ARQUIVO_ROLES = '000_roles.sql';
const ROLE_APP = 'regemcast_app';

const args = new Set(process.argv.slice(2));
const MODO_STATUS = args.has('--status');
const MODO_DRY = args.has('--dry') || args.has('--dry-run');
const AJUDA = args.has('--help') || args.has('-h');

function log(msg = '') {
  process.stdout.write(`${msg}\n`);
}

function erroFatal(msg, dica) {
  process.stderr.write(`\nErro: ${msg}\n`);
  if (dica) process.stderr.write(`${dica}\n`);
  process.exit(1);
}

if (AJUDA) {
  log('npm run migrate              aplica as migrations pendentes');
  log('npm run migrate -- --status  mostra o que já foi aplicado e o que falta');
  log('npm run migrate -- --dry     lista o que aplicaria, sem tocar no banco');
  process.exit(0);
}

// ------------------------------------------------------------------ .env

/**
 * Lê backend/.env na mão. Sem dotenv de propósito: o runner precisa rodar em
 * container e em CI, onde a variável pode vir só do ambiente, e uma dependência
 * a menos aqui é uma superfície a menos.
 * Variável já definida no ambiente vence o arquivo.
 */
function carregarEnv() {
  const caminho = join(RAIZ_BACKEND, '.env');
  if (!existsSync(caminho)) return;
  const texto = readFileSync(caminho, 'utf8');
  for (const linhaBruta of texto.split(/\r?\n/)) {
    const linha = linhaBruta.trim();
    if (!linha || linha.startsWith('#')) continue;
    const igual = linha.indexOf('=');
    if (igual < 0) continue;
    const chave = linha.slice(0, igual).trim();
    if (!chave || process.env[chave] !== undefined) continue;
    let valor = linha.slice(igual + 1).trim();
    const aspa = valor[0];
    if ((aspa === '"' || aspa === "'") && valor.endsWith(aspa) && valor.length > 1) {
      valor = valor.slice(1, -1);
    }
    process.env[chave] = valor;
  }
}

carregarEnv();

/**
 * A URL de migration pode ser diferente da URL da aplicação — e em produção
 * ela É diferente. regemcast_app roda sem CREATE no schema public (por
 * construção, ver 000_roles.sql), então quem cria tabela é o dono do banco.
 * MIGRATION_DATABASE_URL tem prioridade; sem ela, cai em DATABASE_URL, o que
 * serve para o dev local onde o dono do banco é o próprio usuário.
 */
const urlBanco = (process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL || '').trim();
if (!urlBanco) {
  erroFatal(
    'nenhuma URL de banco definida.',
    'Defina DATABASE_URL em backend/.env (ou MIGRATION_DATABASE_URL, com o usuário dono do banco).\n' +
      'Modelo em backend/.env.example; passo a passo em docs/banco.md.',
  );
}

function configSsl() {
  const modo = (process.env.DATABASE_SSL || '').trim().toLowerCase();
  if (!modo || modo === 'disable' || modo === 'false' || modo === 'off') return false;
  // no-verify existe para o caso do certificado interno do provedor; é opção
  // consciente, não padrão silencioso.
  if (modo === 'no-verify' || modo === 'prefer') return { rejectUnauthorized: false };
  return { rejectUnauthorized: true };
}

// ------------------------------------------------------------------ arquivos

function hashDe(texto) {
  // Normaliza CRLF antes de hashear: o mesmo arquivo sai com \r\n num checkout
  // Windows e \n no CI Linux. Sem normalizar, o CI acusaria "migration
  // alterada" num arquivo que ninguém tocou.
  return createHash('sha256').update(texto.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

function lerMigrations() {
  if (!existsSync(DIR_MIGRATIONS)) {
    erroFatal(
      'pasta de migrations não encontrada.',
      `Procurei em:\n${CANDIDATOS_MIGRATIONS.map((c) => `  ${c}`).join('\n')}\n` +
        'Aponte a pasta certa com a variável MIGRATIONS_DIR.',
    );
  }
  const nomes = readdirSync(DIR_MIGRATIONS)
    .filter((n) => n.toLowerCase().endsWith('.sql'))
    .filter((n) => n !== ARQUIVO_ROLES)
    .sort((a, b) => a.localeCompare(b, 'en'));
  return nomes.map((nome) => {
    const sql = readFileSync(join(DIR_MIGRATIONS, nome), 'utf8');
    return { nome, sql, hash: hashDe(sql) };
  });
}

/** Converte a posição (offset em caracteres, 1-based) do Postgres em linha/coluna. */
function posicaoLegivel(sql, posicao) {
  const n = Number(posicao);
  if (!Number.isFinite(n) || n < 1) return null;
  const antes = sql.slice(0, n - 1);
  const linhas = antes.split('\n');
  const linha = linhas.length;
  const coluna = linhas[linhas.length - 1].length + 1;
  const trecho = sql.split('\n')[linha - 1] ?? '';
  return { linha, coluna, trecho: trecho.trim().slice(0, 160) };
}

function relatarErroSql(nome, sql, erro) {
  process.stderr.write(`\n✖ ${nome} falhou — nada dela foi aplicado (a transação voltou atrás).\n`);
  if (erro?.code) process.stderr.write(`  SQLSTATE: ${erro.code}\n`);
  process.stderr.write(`  mensagem: ${erro?.message ?? erro}\n`);
  if (erro?.detail) process.stderr.write(`  detalhe:  ${erro.detail}\n`);
  if (erro?.hint) process.stderr.write(`  dica:     ${erro.hint}\n`);
  if (erro?.where) process.stderr.write(`  onde:     ${erro.where}\n`);
  const pos = posicaoLegivel(sql, erro?.position);
  if (pos) {
    process.stderr.write(`  posição:  linha ${pos.linha}, coluna ${pos.coluna}\n`);
    process.stderr.write(`  trecho:   ${pos.trecho}\n`);
  }
  process.stderr.write(
    '\nCorrija o arquivo e rode de novo: nada foi gravado no ledger, então ele volta como pendente.\n',
  );
}

// ------------------------------------------------------------------ ledger

/**
 * Qualificado com o schema de propósito: a checagem de privilégio pergunta por
 * `public`, então o objeto precisa nascer em `public` — e não onde o
 * `search_path` da conexão apontar.
 */
const TABELA_LEDGER = 'public.schema_migrations';

const SQL_LEDGER = `
  create table if not exists ${TABELA_LEDGER} (
    arquivo     text primary key,
    hash        text not null,
    aplicada_em timestamptz not null default now()
  )
`;

/** `insufficient_privilege` — o SQLSTATE que o role da aplicação recebe no DDL. */
const SQLSTATE_SEM_PRIVILEGIO = '42501';

function ehSemPrivilegio(erro) {
  return erro?.code === SQLSTATE_SEM_PRIVILEGIO;
}

/**
 * A MESMA explicação, venha ela da checagem de privilégio ou de um 42501 cru
 * do servidor. Os dois caminhos existem porque a checagem cobre o caso normal
 * e o 42501 cobre o resto: schema com outro dono, permissão revogada entre uma
 * consulta e a seguinte, `search_path` apontando para outro lugar. Em nenhum
 * deles o operador pode receber "Erro inesperado no runner".
 */
function bloqueioSemCreate(usuario) {
  return {
    msg: `o usuário ${usuario} não pode criar objetos no schema public.`,
    dica:
      `${ROLE_APP} é o usuário da API e não tem (nem deve ter) CREATE — 000_roles.sql\n` +
      'revoga esse privilégio de propósito.\n' +
      'Defina MIGRATION_DATABASE_URL em backend/.env com o usuário dono do banco\n' +
      '(no Supabase: postgres; no Docker local: postgres) e rode de novo.\n' +
      'Modelo em backend/.env.example; passo a passo em docs/banco.md.',
  };
}

/** `to_regclass` responde sem exigir privilégio nenhum sobre a tabela. */
async function existeLedger(cliente) {
  const rs = await cliente.query(`select to_regclass('${TABELA_LEDGER}') is not null as existe`);
  return Boolean(rs.rows[0]?.existe);
}

async function lerLedger(cliente, usuario) {
  try {
    return await cliente.query(
      `select arquivo, hash, aplicada_em from ${TABELA_LEDGER} order by arquivo`,
    );
  } catch (erro) {
    if (ehSemPrivilegio(erro)) {
      erroFatal(
        `o usuário ${usuario} não pode ler ${TABELA_LEDGER}.`,
        'Essa tabela é o registro do que já foi aplicado — sem lê-la o runner não\n' +
          'sabe o que falta. Use MIGRATION_DATABASE_URL com o usuário dono do banco\n' +
          '(no Supabase: postgres). Passo a passo em docs/banco.md.',
      );
    }
    throw erro;
  }
}

/** Cria o ledger. Só é chamada quando o runner vai aplicar de verdade. */
async function garantirLedger(cliente, usuario) {
  try {
    await cliente.query(SQL_LEDGER);
  } catch (erro) {
    if (ehSemPrivilegio(erro)) {
      const b = bloqueioSemCreate(usuario);
      erroFatal(b.msg, b.dica);
    }
    throw erro;
  }
}

/** Guardado para o `catch` de último recurso lá embaixo saber quem tentou. */
let usuarioConectado = '(desconhecido)';

async function main() {
  const cliente = new pg.Client({
    connectionString: urlBanco,
    ssl: configSsl(),
    application_name: 'regemcast-migrate',
  });

  try {
    await cliente.connect();
  } catch (erro) {
    erroFatal(
      `não consegui conectar no banco (${erro?.code ?? 'sem código'}): ${erro?.message ?? erro}`,
      'Confira DATABASE_URL em backend/.env. Para subir o banco local:\n' +
        '  docker compose -f docker-compose.dev.yml up -d',
    );
  }

  try {
    const quem = await cliente.query(
      'select current_user as usuario, current_database() as banco',
    );
    const { usuario, banco } = quem.rows[0];
    usuarioConectado = usuario;

    // 1) PRÉ-REQUISITOS PRIMEIRO, antes de tocar em qualquer objeto do banco.
    //
    //    A ordem é o ponto. O ledger é ele próprio um `create table`, e
    //    `create table` é exatamente o que regemcast_app NÃO pode fazer —
    //    000_roles.sql revoga o CREATE de propósito. Criando o ledger antes de
    //    checar, o runner morria com "Erro inesperado no runner: permission
    //    denied for schema public" justamente onde já existe uma mensagem
    //    pronta explicando o que fazer; e morria até no `--status`, que não
    //    escreve nada no banco.
    const bloqueios = [];

    //    O role da aplicação precisa existir ANTES da primeira migration: é ele
    //    que recebe os grants, e foi justamente a ausência dele que fez a RLS do
    //    Regem nunca ser criada.
    const temRole = await cliente.query('select 1 from pg_roles where rolname = $1', [ROLE_APP]);
    if (!temRole.rowCount) {
      bloqueios.push({
        msg: `o role ${ROLE_APP} não existe neste banco.`,
        dica: 'Rode database/migrations/000_roles.sql como superusuário antes (veja docs/banco.md).',
      });
    }

    //    E quem roda migration precisa poder criar objeto — inclusive o próprio
    //    ledger. Dizer isso agora é melhor que um 42501 no meio do DDL, com
    //    metade do arquivo aplicado.
    const podeCriar = await cliente.query(
      "select has_schema_privilege(current_user, 'public', 'create') as pode",
    );
    if (!podeCriar.rows[0].pode) bloqueios.push(bloqueioSemCreate(usuario));

    // 2) SÓ AGORA o ledger — e só para LER. A criação fica para o momento de
    //    aplicar de verdade: `--status` e `--dry` prometem não tocar no banco,
    //    e criar uma tabela de controle também é tocar no banco.
    const aplicadas = new Map();
    let aplicadasRs = { rows: [] };
    const ledgerExiste = await existeLedger(cliente);
    if (ledgerExiste) {
      aplicadasRs = await lerLedger(cliente, usuario);
      for (const linha of aplicadasRs.rows) aplicadas.set(linha.arquivo, linha);
    }

    const arquivos = lerMigrations();

    // 3) Migration já aplicada não se edita. Se o conteúdo mudou, o banco e o
    //    repositório divergiram e aplicar o resto só piora.
    const alteradas = arquivos.filter((a) => aplicadas.has(a.nome) && aplicadas.get(a.nome).hash !== a.hash);
    if (alteradas.length) {
      process.stderr.write('\nErro: migration já aplicada foi alterada.\n');
      for (const a of alteradas) {
        process.stderr.write(`  ${a.nome}\n`);
        process.stderr.write(`    hash no banco:   ${aplicadas.get(a.nome).hash}\n`);
        process.stderr.write(`    hash no arquivo: ${a.hash}\n`);
      }
      process.stderr.write(
        '\nMigration aplicada não se edita — o banco que já rodou a versão antiga nunca veria a mudança.\n' +
          'Crie OUTRA migration com o próximo número da sequência e faça a correção nela.\n',
      );
      process.exit(1);
    }

    // 4) Arquivo sumiu do repositório mas está no ledger: avisa e segue.
    const nomesNoDisco = new Set(arquivos.map((a) => a.nome));
    for (const nome of aplicadas.keys()) {
      if (!nomesNoDisco.has(nome)) {
        log(`aviso: ${nome} está no ledger mas não existe mais em database/migrations/.`);
      }
    }

    const pendentes = arquivos.filter((a) => !aplicadas.has(a.nome));

    if (MODO_STATUS) {
      log(`banco: ${banco} · usuário: ${usuario}`);
      if (!ledgerExiste) {
        log(`ledger: ${TABELA_LEDGER} ainda não existe — nasce na primeira aplicação.`);
      }
      log('');
      log(`aplicadas (${aplicadas.size}):`);
      for (const linha of aplicadasRs.rows) {
        log(`  ✓ ${linha.arquivo}  ${new Date(linha.aplicada_em).toISOString()}`);
      }
      if (!aplicadas.size) log('  (nenhuma)');
      log('');
      log(`pendentes (${pendentes.length}):`);
      for (const a of pendentes) log(`  · ${a.nome}`);
      if (!pendentes.length) log('  (nenhuma)');

      // O relatório sai INTEIRO antes do bloqueio: quem pediu status quer o
      // status. O bloqueio só vira erro quando há algo pendente — é aí que ele
      // de fato impede alguma coisa.
      if (bloqueios.length && pendentes.length) {
        process.stderr.write('\nCom esta conexão, porém, nada disso seria aplicado:\n');
        for (const b of bloqueios) process.stderr.write(`\nErro: ${b.msg}\n${b.dica}\n`);
        process.exit(1);
      }
      return;
    }

    if (!pendentes.length) {
      log(`Nada a aplicar — ${aplicadas.size} migration(s) já no banco ${banco}.`);
      return;
    }

    // 5) --dry mostra o plano MESMO com bloqueio: quem está conferindo o que vai
    //    rodar merece ver a lista junto com o motivo de ainda não poder rodar.
    if (MODO_DRY) {
      log(`banco: ${banco} · usuário: ${usuario}`);
      log(`Aplicaria ${pendentes.length} migration(s), nesta ordem:`);
      for (const a of pendentes) log(`  · ${a.nome}  (sha256 ${a.hash.slice(0, 12)})`);
      log('\nNada foi aplicado (--dry).');
      if (bloqueios.length) {
        process.stderr.write('\nMas hoje ele NÃO conseguiria aplicar:\n');
        for (const b of bloqueios) process.stderr.write(`\nErro: ${b.msg}\n${b.dica}\n`);
        process.exit(1);
      }
      return;
    }

    if (bloqueios.length) erroFatal(bloqueios[0].msg, bloqueios[0].dica);

    // Daqui para baixo o runner escreve. O ledger nasce agora — passados os
    // pré-requisitos, e ainda assim com o 42501 traduzido, porque entre a
    // checagem e este comando o banco pode ter mudado de ideia.
    if (!ledgerExiste) await garantirLedger(cliente, usuario);

    log(`banco: ${banco} · usuário: ${usuario}`);
    log(`Aplicando ${pendentes.length} migration(s).`);

    for (const a of pendentes) {
      const inicio = Date.now();
      try {
        await cliente.query('begin');
        await cliente.query(a.sql);
        await cliente.query(
          `insert into ${TABELA_LEDGER} (arquivo, hash) values ($1, $2)`,
          [a.nome, a.hash],
        );
        await cliente.query('commit');
      } catch (erro) {
        try {
          await cliente.query('rollback');
        } catch {
          // conexão já pode ter morrido; o erro que importa é o de baixo.
        }
        relatarErroSql(a.nome, a.sql, erro);
        process.exit(1);
      }
      log(`  ✓ ${a.nome}  (${Date.now() - inicio} ms)`);
    }

    log(`\nPronto — ${pendentes.length} migration(s) aplicada(s).`);
  } finally {
    await cliente.end().catch(() => {});
  }
}

main().catch((erro) => {
  // Último recurso: mesmo aqui, "permissão negada" tem explicação — e era
  // exatamente por este caminho que ela se perdia antes.
  if (ehSemPrivilegio(erro)) {
    const b = bloqueioSemCreate(usuarioConectado);
    process.stderr.write(`\n(${erro.message})\n`);
    erroFatal(b.msg, b.dica);
  }
  process.stderr.write(`\nErro inesperado no runner: ${erro?.message ?? erro}\n`);
  if (erro?.stack) process.stderr.write(`${erro.stack}\n`);
  process.exit(1);
});
