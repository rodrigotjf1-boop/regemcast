/**
 * O que a tela faz com as regras do público, sem React — o teste chama direto.
 *
 * A tela NÃO guarda lista própria de campos: tudo sai do catálogo do servidor
 * (`GET /publicos-salvos/campos`). O que mora aqui é só o comportamento da
 * tela: quando a regra está completa, o que acontece ao trocar o campo, quando
 * o público salvo ainda vale e como a parte se ajusta ao tamanho do público.
 */
import type {
  CampoDaRegra,
  CatalogoDasRegras,
  ComparacaoDaRegra,
  PublicoDaCampanha,
  RegraDoPublico,
} from './tipos.ts';

/** A regra como a tela edita: com uma chave própria para o React e para os `id` dos campos. */
export interface RegraNaTela extends RegraDoPublico {
  chave: string;
}

/** A parte do público: do contato `de` ao `ate`. */
export interface ParteDoPublico {
  de: number;
  ate: number;
}

let sequencia = 0;
/** Uma chave nova, única nesta página. */
export function novaChave(): string {
  sequencia += 1;
  return `r${sequencia}`;
}

export function campoDe(catalogo: CatalogoDasRegras, id: string): CampoDaRegra | undefined {
  return catalogo.campos.find((c) => c.id === id);
}

/** A comparação com que um campo novo nasce: "é maior ou igual a" nos números, a primeira nos outros. */
export function comparacaoInicial(catalogo: CatalogoDasRegras, campo: CampoDaRegra): ComparacaoDaRegra {
  const lista = catalogo.comparacoes[campo.tipo] ?? [];
  if (campo.tipo !== 'lista' && campo.tipo !== 'data' && lista.some((c) => c.valor === '>=')) return '>=';
  return lista[0]?.valor ?? '=';
}

/** Uma regra vazia no primeiro campo do catálogo. */
export function regraNova(catalogo: CatalogoDasRegras): RegraNaTela | null {
  const campo = catalogo.campos[0];
  if (!campo) return null;
  return { chave: novaChave(), campo: campo.id, comparacao: comparacaoInicial(catalogo, campo), valor: '' };
}

/**
 * Trocar o campo: para outro do MESMO tipo, comparação e valor ficam; para
 * outro tipo, a comparação volta à inicial e o valor some — "3 pedidos" não
 * vira data, e "é maior que" não existe numa lista.
 */
export function trocarCampo(catalogo: CatalogoDasRegras, regra: RegraNaTela, novoCampo: string): RegraNaTela {
  const antes = campoDe(catalogo, regra.campo);
  const depois = campoDe(catalogo, novoCampo);
  if (!depois) return regra;
  if (antes && antes.tipo === depois.tipo) {
    // Lista para lista: "é" e "não é" valem nas duas, mas o bairro não é um perfil.
    return depois.tipo === 'lista' ? { ...regra, campo: novoCampo, valor: '' } : { ...regra, campo: novoCampo };
  }
  return { ...regra, campo: novoCampo, comparacao: comparacaoInicial(catalogo, depois), valor: '' };
}

export function regraCompleta(r: RegraDoPublico): boolean {
  return r.valor.trim() !== '';
}

/** Tem regra e todas têm valor. */
export function regrasCompletas(regras: readonly RegraDoPublico[]): boolean {
  return regras.length > 0 && regras.every(regraCompleta);
}

/** Só o que o servidor recebe: campo, comparação e valor (sem a chave da tela). */
export function paraEnviar(regras: readonly RegraDoPublico[]): RegraDoPublico[] {
  return regras.map((r) => ({ campo: r.campo, comparacao: r.comparacao, valor: r.valor.trim() }));
}

/** As mesmas regras, na mesma ordem — é o que decide se o público salvo ainda vale. */
export function mesmasRegras(a: readonly RegraDoPublico[], b: readonly RegraDoPublico[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (r, i) => r.campo === b[i].campo && r.comparacao === b[i].comparacao && r.valor.trim() === b[i].valor.trim(),
  );
}

/** As regras gravadas viram regras da tela, cada uma com a sua chave. */
export function paraATela(regras: readonly RegraDoPublico[]): RegraNaTela[] {
  return regras.map((r) => ({ chave: novaChave(), campo: r.campo, comparacao: r.comparacao, valor: r.valor }));
}

/**
 * A parte dentro do público: `de` pelo menos 1, `ate` pelo menos `de`, e os
 * dois até o total quando ele é conhecido. Texto ilegível vira o limite.
 */
export function ajustarParte(de: number, ate: number, total: number | null): ParteDoPublico {
  let inicio = Math.max(1, Number.isFinite(de) ? Math.trunc(de) : 1);
  let fim = Number.isFinite(ate) ? Math.trunc(ate) : inicio;
  if (total !== null && total > 0) {
    inicio = Math.min(inicio, total);
    fim = Math.min(fim, total);
  }
  return { de: inicio, ate: Math.max(inicio, fim) };
}

/**
 * O público da campanha a partir das regras da tela — ou `null` enquanto
 * falta valor. O público salvo só vai enquanto as regras são as dele: com ele,
 * o servidor usa as regras gravadas.
 */
export function publicoDasRegras(
  regras: readonly RegraDoPublico[],
  publicoSalvoId: string | null,
  parte: ParteDoPublico | null,
): PublicoDaCampanha | null {
  if (!regrasCompletas(regras)) return null;
  return {
    origem: 'regras',
    regras: paraEnviar(regras),
    ...(publicoSalvoId ? { publicoSalvoId } : {}),
    ...(parte ? { parteDe: parte.de, parteAte: parte.ate } : {}),
  };
}

/** Quantos contatos a parte tem. */
export function tamanhoDaParte(parte: ParteDoPublico): number {
  return parte.ate - parte.de + 1;
}
