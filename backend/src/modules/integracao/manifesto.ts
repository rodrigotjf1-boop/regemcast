/**
 * O MANIFESTO da porta de integração (Padrão DMS §13; Hub DMS, F4 parte A; pacote 0.7.2): a documentação pública da
 * porta MCP, montada do próprio código. As permissões saem do catálogo `ESCOPOS` (a frase que o dono lê); as
 * ferramentas saem do catálogo `FERRAMENTAS`, registradas num servidor de mentira que só anota o nome, a descrição, o
 * esquema de entrada (zod → JSON Schema) e as marcas; o limite, do guard. Servido sem credencial em
 * `/.well-known/dms-manifesto` (fora do prefixo, `ROTAS_FORA_DO_PREFIXO`) e guardado em `docs/dms-manifesto.json`:
 * o teste confere que o arquivo é o que o código monta, e `ATUALIZAR_MANIFESTO=1` regrava.
 *
 * Fica de fora, de propósito: as rotas REST da credencial (os metadados RFC 9728, a troca do `rct_it_` pela ligação e a
 * autorização por clique), que são o ciclo da credencial (Padrão §2 e §3), e não a porta; e o `rct_it_`, credencial
 * antiga, que sai na F5 (parte E). A classe é só `dms`: pela via do DMS ID, só entra ligação de produto da DMS.
 */
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import { montarManifesto, type FerramentaNoManifesto, type ManifestoDms, type PermissaoNoManifesto } from '../../dms/integracao-dms';
import { PERMISSOES_COM_DADO_PESSOAL } from './autorizacao.regras';
import { LIMITE_POR_MINUTO } from './integracao.guard';
import { ESCOPOS } from './integracao.regras';
import type { ContextoDaFerramenta, Ferramenta } from './mcp.ferramenta';
import { FERRAMENTAS } from './mcp.servidor';

/** O endereço público da API: o manifesto é o mesmo em todo ambiente (o arquivo do repositório confere com ele). */
export const BASE_DO_MANIFESTO = 'https://castapi.dmsregem.com';

/** A porta MCP: o endereço e a versão da especificação que ela fala (`mcp.servidor.ts`). */
export const PORTA_MCP = { endereco: `${BASE_DO_MANIFESTO}/api/v1/mcp`, versao: '2026-07-28' } as const;

/** A versão do contrato da porta (Padrão §12): a do servidor MCP. */
export const VERSAO_DO_CONTRATO = '1.0.0';

/** Dado pessoal ou dinheiro (Padrão §4): o telefone de quem escreveu e o disparo, que gasta na Meta. */
const SENSIVEIS: readonly string[] = [...PERMISSOES_COM_DADO_PESSOAL, 'campanhas.disparar'];

function permissoes(): Record<string, PermissaoNoManifesto> {
  return Object.fromEntries(ESCOPOS.map((e) => [e.id, { frase: e.descricao, classes: ['dms'], sensivel: SENSIVEIS.includes(e.id) }]));
}

/** O que o servidor de mentira anota de cada `registerTool`. */
interface Registro {
  nome: string;
  description?: string;
  inputSchema?: z.ZodType;
  annotations?: { readOnlyHint?: boolean; idempotentHint?: boolean };
}

/**
 * Cada ferramenta do catálogo, como ela se registra. Quem grava diz como é idempotente: com o argumento
 * `chaveIdempotencia`, por chave; sem ele, só se a própria marca diz que repetir não muda nada (o revogar). Ferramenta
 * que grava sem uma coisa nem outra para a montagem: o Padrão (§6) pede a chave.
 */
export function ferramentasDoCatalogo(catalogo: readonly Ferramenta[] = FERRAMENTAS): FerramentaNoManifesto[] {
  return catalogo.map((f) => {
    const anotadas: Registro[] = [];
    const deMentira = {
      registerTool: (nome: string, config: Omit<Registro, 'nome'>) => {
        anotadas.push({ nome, ...config });
      },
    } as unknown as McpServer;
    f.registrar(deMentira, {} as ContextoDaFerramenta);
    const r = anotadas[0];
    if (anotadas.length !== 1 || !r || r.nome !== f.nome) throw new Error(`a ferramenta ${f.nome} não se registrou uma vez, com o próprio nome`);
    if (!r.inputSchema || !r.description) throw new Error(`a ferramenta ${f.nome} não tem descrição ou esquema de entrada`);
    const esquemaEntrada = z.toJSONSchema(r.inputSchema) as Record<string, unknown>;
    const propriedades = (esquemaEntrada.properties ?? {}) as Record<string, unknown>;
    const ferramenta: FerramentaNoManifesto = { nome: f.nome, descricao: r.description, permissao: f.escopo, esquemaEntrada };
    if (r.annotations?.readOnlyHint !== true) {
      if ('chaveIdempotencia' in propriedades) ferramenta.escrita = 'chave';
      else if (r.annotations?.idempotentHint === true) ferramenta.escrita = 'substituicao';
      else throw new Error(`a ferramenta ${f.nome} grava sem chaveIdempotencia e sem ser idempotente (Padrão §6)`);
    }
    return ferramenta;
  });
}

let guardado: ManifestoDms | null = null;

/** O manifesto da porta (montado uma vez: é o mesmo enquanto o processo vive). */
export function manifestoDaPorta(): ManifestoDms {
  guardado ??= montarManifesto({
    produto: 'regemcast',
    versao: VERSAO_DO_CONTRATO,
    titulo: 'Porta de integração do Regemcast',
    descricao:
      'A porta MCP que os produtos da DMS ligados à conta usam: a situação da conta, as campanhas, os públicos, os ' +
      'modelos, o orçamento e as conversas abertas por anúncio, com o que o dono autorizou, e os rascunhos e o ' +
      'disparo de campanha. Credencial: o token do DMS ID com o segredo da ligação (DMS-Ligacao).',
    base: BASE_DO_MANIFESTO,
    permissoes: permissoes(),
    limite: { porMinuto: LIMITE_POR_MINUTO, por: 'ligacao' },
    rotas: [],
    ferramentas: ferramentasDoCatalogo(),
    avisos: [],
    credenciais: ['dms_id'],
    mcp: PORTA_MCP,
  });
  return guardado;
}
