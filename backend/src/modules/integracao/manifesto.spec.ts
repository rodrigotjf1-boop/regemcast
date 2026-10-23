/**
 * O manifesto da porta de integração (Padrão DMS §13; Hub DMS, F4 parte A; pacote 0.7.2): sem banco nem HTTP. O arquivo
 * do repositório (`docs/dms-manifesto.json`) é o que o código monta; com `ATUALIZAR_MANIFESTO=1`, este teste o regrava.
 * A rota sem credencial, a versão do protocolo falada de verdade e o kit no modo `manifesto` estão em
 * `mcp.dmsid.spec.ts`.
 */
jest.mock('../../config/env', () => ({ env: {} }));

import 'reflect-metadata';
import { PATH_METADATA } from '@nestjs/common/constants';
import type { McpServer } from '@modelcontextprotocol/server';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as z from 'zod/v4';

import { PUBLICO } from '../../common/publico.decorator';
import { CAMINHO_MANIFESTO, conferirManifesto, VERSAO_PACOTE } from '../../dms/integracao-dms';
import { PERMISSOES_COM_DADO_PESSOAL } from './autorizacao.regras';
import { LIMITE_POR_MINUTO } from './integracao.guard';
import { ESCOPOS } from './integracao.regras';
import { CAMINHO_DO_MANIFESTO } from './ligacao.regras';
import { BASE_DO_MANIFESTO, ferramentasDoCatalogo, manifestoDaPorta, PORTA_MCP } from './manifesto';
import { ManifestoController } from './manifesto.controller';
import { McpController } from './mcp.controller';
import type { Ferramenta } from './mcp.ferramenta';
import { FERRAMENTAS } from './mcp.servidor';

const ARQUIVO = join(__dirname, '..', '..', '..', '..', 'docs', 'dms-manifesto.json');
const textoDoManifesto = () => `${JSON.stringify(manifestoDaPorta(), null, 2)}\n`;

/** O que o teste lê do manifesto servido. */
interface FerramentaServida {
  nome: string;
  descricao: string;
  permissao: string | null;
  esquemaEntrada: { type?: string; properties?: Record<string, unknown>; required?: string[] };
  escrita?: string;
}
interface ManifestoServido {
  info: Record<string, unknown>;
  servers: unknown;
  security: unknown;
  paths: unknown;
  components: { securitySchemes: Record<string, unknown> };
  'x-dms-permissoes': Record<string, { frase: string; classes: string[]; sensivel: boolean }>;
  'x-dms-limite': unknown;
  'x-dms-ferramentas': FerramentaServida[];
  'x-dms-avisos': unknown;
  'x-dms-mcp': unknown;
}

// O que vai no manifesto, lido como o portal e o kit leem (o JSON servido).
const servido = () => JSON.parse(JSON.stringify(manifestoDaPorta())) as ManifestoServido;

describe('manifesto da porta de integração (Padrão §13)', () => {
  it('passa na conferência do pacote', () => {
    expect(conferirManifesto(manifestoDaPorta())).toEqual([]);
  });

  it('o arquivo do repositório é o que o código monta (ATUALIZAR_MANIFESTO=1 regrava)', () => {
    if (process.env.ATUALIZAR_MANIFESTO === '1') writeFileSync(ARQUIVO, textoDoManifesto());
    expect(existsSync(ARQUIVO)).toBe(true);
    expect(readFileSync(ARQUIVO, 'utf8').replace(/\r\n/g, '\n')).toBe(textoDoManifesto());
  });

  it('é do regemcast, na versão do pacote, no endereço público, só com a credencial do DMS ID e o limite do guard', () => {
    const m = servido();
    expect(m.info['x-dms-produto']).toBe('regemcast');
    expect(m.info['x-dms-pacote']).toBe(VERSAO_PACOTE);
    expect(m.servers).toEqual([{ url: BASE_DO_MANIFESTO }]);
    // o rct_it_ (credencial antiga) não entra; a chave do acesso próprio não é desta porta
    expect(m.security).toEqual([{ dmsId: [] }]);
    expect(Object.keys(m.components.securitySchemes)).toEqual(['dmsId']);
    expect(m['x-dms-limite']).toEqual({ porMinuto: LIMITE_POR_MINUTO, por: 'ligacao' });
    // a porta é só MCP: nenhuma rota REST e nenhum aviso
    expect(m.paths).toEqual({});
    expect(m['x-dms-avisos']).toEqual([]);
  });

  it('a porta MCP declarada é a do McpController, debaixo do prefixo, na versão que a porta fala', () => {
    const m = servido();
    expect(m['x-dms-mcp']).toEqual({ endereco: PORTA_MCP.endereco, versao: PORTA_MCP.versao });
    const caminho = Reflect.getMetadata(PATH_METADATA, McpController) as string;
    expect(PORTA_MCP.endereco).toBe(`${BASE_DO_MANIFESTO}/api/v1/${caminho}`);
    // a mesma versão que os testes da porta mandam ao servidor de verdade (mcp.dmsid.spec.ts) e que docs/mcp.md conta
    expect(PORTA_MCP.versao).toBe('2026-07-28');
  });

  it('as permissões são as do catálogo ESCOPOS, com a frase da tela, só a classe dms e o sensível certo', () => {
    const m = servido();
    expect(Object.keys(m['x-dms-permissoes'])).toEqual(ESCOPOS.map((e) => e.id));
    for (const e of ESCOPOS) {
      const p = m['x-dms-permissoes'][e.id];
      expect(p.frase).toBe(e.descricao);
      expect(p.classes).toEqual(['dms']);
    }
    const sensiveis = ESCOPOS.filter((e) => m['x-dms-permissoes'][e.id].sensivel).map((e) => e.id);
    // o telefone de quem escreveu (dado pessoal, o mesmo bloco da tela do clique) e o disparo, que gasta na Meta
    expect(sensiveis).toEqual(['conversas.anuncio.ler', 'campanhas.disparar']);
    for (const pessoal of PERMISSOES_COM_DADO_PESSOAL) expect(sensiveis).toContain(pessoal);
  });

  it('as ferramentas são as do catálogo FERRAMENTAS, na ordem, com a permissão, a descrição e o esquema de cada uma', () => {
    const m = servido();
    const ferramentas = m['x-dms-ferramentas'];
    expect(ferramentas.map((f) => f.nome)).toEqual(FERRAMENTAS.map((f) => f.nome));
    expect(ferramentas).toHaveLength(15);
    for (const [i, f] of ferramentas.entries()) {
      expect(f.permissao).toBe(FERRAMENTAS[i]!.escopo);
      expect(f.descricao.length).toBeGreaterThan(20);
      expect(f.esquemaEntrada.type).toBe('object');
    }
    // sem permissão, só as duas da própria ligação: ver a situação dela e desligá-la (qualquer ligação válida)
    expect(ferramentas.filter((f) => f.permissao === null).map((f) => f.nome)).toEqual(['integracao_situacao', 'integracao_revogar']);
  });

  it('quem grava diz como é idempotente: as quatro com chaveIdempotencia obrigatória e o revogar, que repetir não muda', () => {
    const m = servido();
    const ferramentas = m['x-dms-ferramentas'];
    const escritas = Object.fromEntries(ferramentas.filter((f) => f.escrita).map((f) => [f.nome, f.escrita]));
    expect(escritas).toEqual({
      integracao_revogar: 'substituicao',
      modelo_rascunhar: 'chave',
      campanha_rascunhar: 'chave',
      campanha_disparar: 'chave',
      campanha_pausar: 'chave',
    });
    for (const f of ferramentas.filter((x) => x.escrita === 'chave')) {
      expect(f.esquemaEntrada.properties).toHaveProperty('chaveIdempotencia');
      expect(f.esquemaEntrada.required).toContain('chaveIdempotencia');
    }
  });

  it('a rota é pública (o guard de autenticação é global) e fica no caminho do Padrão', () => {
    expect(Reflect.getMetadata(PUBLICO, ManifestoController)).toBe(true);
    expect(`/${CAMINHO_DO_MANIFESTO}`).toBe(CAMINHO_MANIFESTO);
  });
});

describe('ferramentasDoCatalogo: ferramenta fora do combinado para a montagem', () => {
  const entrada = z.object({ id: z.string() });
  const comChave = z.object({ chaveIdempotencia: z.string().min(1), id: z.string() });
  const umaFerramenta = (nome: string, registrar: (s: McpServer) => void): Ferramenta => ({ nome, escopo: 'campanhas.ler', registrar: (s) => registrar(s) });
  const registra = (nome: string, config: Record<string, unknown>) => (s: McpServer) => s.registerTool(nome, config as never, (() => undefined) as never);

  it('lê a marca de cada uma: leitura sem escrita, chave por chaveIdempotencia, substituição pela marca de idempotente', () => {
    const lidas = ferramentasDoCatalogo([
      umaFerramenta('so_le', registra('so_le', { description: 'Lê.', inputSchema: entrada, annotations: { readOnlyHint: true } })),
      umaFerramenta('grava_com_chave', registra('grava_com_chave', { description: 'Grava.', inputSchema: comChave, annotations: { readOnlyHint: false } })),
      umaFerramenta('troca_tudo', registra('troca_tudo', { description: 'Troca.', inputSchema: entrada, annotations: { readOnlyHint: false, idempotentHint: true } })),
    ]);
    expect(lidas.map((f) => [f.nome, f.escrita])).toEqual([
      ['so_le', undefined],
      ['grava_com_chave', 'chave'],
      ['troca_tudo', 'substituicao'],
    ]);
    expect(lidas[0]!.esquemaEntrada).toMatchObject({ type: 'object', properties: { id: { type: 'string' } } });
  });

  it('recusa a que grava sem chaveIdempotencia e sem ser idempotente, e a que não diz nada (sem marca, grava)', () => {
    expect(() =>
      ferramentasDoCatalogo([umaFerramenta('grava_solta', registra('grava_solta', { description: 'Grava.', inputSchema: entrada, annotations: { readOnlyHint: false } }))]),
    ).toThrow('a ferramenta grava_solta grava sem chaveIdempotencia e sem ser idempotente');
    expect(() => ferramentasDoCatalogo([umaFerramenta('sem_marca', registra('sem_marca', { description: 'Faz.', inputSchema: entrada }))])).toThrow(
      'a ferramenta sem_marca grava sem chaveIdempotencia',
    );
  });

  it('recusa a que não se registra, a que se registra duas vezes e a que se registra com outro nome', () => {
    expect(() => ferramentasDoCatalogo([umaFerramenta('nenhuma', () => undefined)])).toThrow('a ferramenta nenhuma não se registrou uma vez');
    const duas = registra('dupla', { description: 'Lê.', inputSchema: entrada, annotations: { readOnlyHint: true } });
    expect(() =>
      ferramentasDoCatalogo([
        umaFerramenta('dupla', (s) => {
          duas(s);
          duas(s);
        }),
      ]),
    ).toThrow('a ferramenta dupla não se registrou uma vez');
    expect(() =>
      ferramentasDoCatalogo([umaFerramenta('nome_do_catalogo', registra('outro_nome', { description: 'Lê.', inputSchema: entrada, annotations: { readOnlyHint: true } }))]),
    ).toThrow('a ferramenta nome_do_catalogo não se registrou uma vez, com o próprio nome');
  });

  it('recusa a que não tem descrição ou esquema de entrada', () => {
    expect(() => ferramentasDoCatalogo([umaFerramenta('sem_texto', registra('sem_texto', { inputSchema: entrada, annotations: { readOnlyHint: true } }))])).toThrow(
      'a ferramenta sem_texto não tem descrição ou esquema de entrada',
    );
    expect(() => ferramentasDoCatalogo([umaFerramenta('sem_esquema', registra('sem_esquema', { description: 'Lê.', annotations: { readOnlyHint: true } }))])).toThrow(
      'a ferramenta sem_esquema não tem descrição ou esquema de entrada',
    );
  });
});
