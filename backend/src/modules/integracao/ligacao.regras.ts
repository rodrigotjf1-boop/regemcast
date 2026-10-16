/**
 * A ligação do Hub DMS (F2, etapa A2): regras puras da via nova da porta MCP.
 *
 * Com o DMS ID ligado (`DMS_ID_LIGADO`), cada chamada pode trazer, no lugar do
 * `rct_it_`, DUAS coisas: o token do DMS ID (`Authorization: Bearer <jwt>`),
 * que diz QUAL APLICATIVO chama, e o segredo da ligação (`DMS-Ligacao:
 * dms_lg_regemcast_…`), que diz QUAL CONTA autorizou. Vazar um só não abre
 * nada: o segredo só vale com o token do aplicativo dono da ligação, e o token
 * sozinho não diz conta nenhuma.
 *
 * Regras do Padrão DMS (§2.1, §6 e §7) que moram aqui:
 * - ligação ausente, inexistente, revogada ou de outro aplicativo respondem
 *   IGUAL (a mesma frase), para quem tem um segredo não descobrir se ele
 *   existiu nem de quem é;
 * - vale a MENOR das duas permissões: a do token (o que o DMS ID deixa o
 *   aplicativo fazer no RegemCast) e a da ligação (o que a conta deixou);
 * - só a classe `dms` entra pelo cabeçalho.
 */
import {
  CABECALHO_LIGACAO,
  cabecalhoWwwAuthenticate,
  ErroPermissaoFaltando,
  ErroProblema,
  ErroTokenDmsId,
  lerChave,
  permissoesDaChamada,
} from '../../dms/integracao-dms';
import { ESCOPOS, escoposEfetivos, type ClasseDoToken } from './integracao.regras';

/** O cabeçalho como o Node entrega (nome em minúsculas). */
export const CABECALHO_LIGACAO_NO_NODE = CABECALHO_LIGACAO.toLowerCase();

/** O caminho dos metadados do recurso protegido (RFC 9728), FORA do prefixo `/api/v1`. */
export const CAMINHO_DOS_METADADOS = '.well-known/oauth-protected-resource/api/v1/mcp';

/** A frase de toda ligação que não vale — a mesma para todo motivo. */
export const LIGACAO_INVALIDA =
  'Ligação ausente, inválida ou revogada. Mande o segredo da ligação no cabeçalho DMS-Ligacao, junto do token do DMS ID do aplicativo dono dela.';

/** A frase da troca recusada — a mesma para token inexistente, revogado, de cliente de fora ou de outro produto. */
export const TROCA_RECUSADA =
  'O token de integração informado não vale para este aplicativo: inexistente, revogado ou de outro produto. Peça um token novo à distribuição.';

/** Todas as permissões do RegemCast, na ordem do catálogo: é o que o 401 e o 403 da porta anunciam. */
export const PERMISSOES_DO_RECURSO: readonly string[] = ESCOPOS.map((e) => e.id);

/** O texto de um `Authorization: Bearer …`, qualquer que seja a forma. Quem confere a forma é o DMS ID. */
export function bearerDoCabecalho(authorization: unknown): string | null {
  if (typeof authorization !== 'string') return null;
  const m = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  return m?.[1] ?? null;
}

/**
 * O segredo da ligação do cabeçalho, ou nulo. Só aceita o que tem a forma de uma
 * ligação do RegemCast, com os dígitos de conferência certos: o resto nem chega
 * ao banco. Cabeçalho repetido (o Node entrega lista) não vale.
 */
export function ligacaoDoCabecalho(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const lida = lerChave(valor.trim());
  return lida && lida.tipo === 'lg' && lida.produto === 'regemcast' ? valor.trim() : null;
}

/** As permissões do token que existem no catálogo do RegemCast (o DMS ID pode mandar de outro recurso no mesmo token). */
export function permissoesDoCatalogo(doToken: readonly string[]): string[] {
  return PERMISSOES_DO_RECURSO.filter((p) => doToken.includes(p));
}

/** Uma ligação como o banco devolve, só o que decide se ela vale. */
export interface LigacaoGuardada {
  aplicativo: string;
  classe: string;
  escopos: unknown;
  revogadoEm: Date | null;
}

/**
 * A ligação vale para este token? Existe, não foi revogada, é da classe `dms`,
 * pertence ao aplicativo do token e esse aplicativo segue na lista da
 * distribuição (`DMS_ID_APLICATIVOS`): tirar um aplicativo da lista corta todas
 * as ligações dele na chamada seguinte, sem tocar no banco.
 */
export function ligacaoVale(l: LigacaoGuardada | undefined, aplicativoDoToken: string, aplicativos: Readonly<Record<string, string>>): l is LigacaoGuardada {
  return (
    !!l &&
    !l.revogadoEm &&
    l.classe === 'dms' &&
    l.aplicativo === aplicativoDoToken &&
    Object.values(aplicativos).includes(aplicativoDoToken)
  );
}

/** As permissões que valem na chamada: as da ligação (só as que a classe pode ter) que o token também tem. */
export function permissoesDaLigacao(l: Pick<LigacaoGuardada, 'escopos' | 'classe'>, doToken: readonly string[]): string[] {
  return permissoesDaChamada(escoposEfetivos(l.escopos, l.classe), doToken);
}

/**
 * Este `rct_it_` pode virar ligação deste aplicativo? Só token de produto da DMS
 * (classe `dms`) e só para o aplicativo que a distribuição cadastrou para o
 * produto do token: o Liame não troca o token do GoGeM.
 */
export function podeTrocar(
  token: { classe: ClasseDoToken | string; produto: string; revogadoEm: Date | null },
  aplicativoDoToken: string,
  aplicativos: Readonly<Record<string, string>>,
): boolean {
  return !token.revogadoEm && token.classe === 'dms' && Object.hasOwn(aplicativos, token.produto) && aplicativos[token.produto] === aplicativoDoToken;
}

/**
 * O `WWW-Authenticate` de uma recusa da via do DMS ID, ou nulo (a recusa não
 * leva desafio). Todo 401 leva o endereço dos metadados e as permissões do
 * recurso; sem credencial nenhuma, vai sem código de erro (RFC 6750 §3.1). O
 * 403 de permissão leva TODAS as que faltam (especificação MCP 2026-07-28).
 */
export function desafioDaRecusa(erro: unknown, veioToken: boolean, metadadosRecurso: string): string | null {
  if (erro instanceof ErroPermissaoFaltando) {
    return cabecalhoWwwAuthenticate({ metadadosRecurso, erro: 'insufficient_scope', escopos: erro.faltando });
  }
  if (erro instanceof ErroProblema && erro.status === 401) {
    const invalido = erro instanceof ErroTokenDmsId && veioToken;
    return cabecalhoWwwAuthenticate({ metadadosRecurso, escopos: PERMISSOES_DO_RECURSO, ...(invalido ? { erro: 'invalid_token' as const } : {}) });
  }
  return null;
}

/** O endereço dos metadados do recurso (RFC 9728 §3.1): o `.well-known` entre a origem e o caminho da porta. */
export function enderecoDosMetadados(recurso: string): string {
  const u = new URL(recurso);
  return `${u.origin}/.well-known/oauth-protected-resource${u.pathname.replace(/\/+$/, '')}`;
}
