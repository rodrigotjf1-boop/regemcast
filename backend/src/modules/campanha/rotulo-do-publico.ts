/**
 * O nome do público no cartão da campanha. Puro: nenhum banco, nenhum
 * serviço — o teste chama direto.
 */
import type { OrigemDoPublico } from '../contato/origem-do-publico';

/** De onde saiu o público da campanha: os números digitados, ou uma das origens da base. */
export type OrigemDaCampanha = OrigemDoPublico | 'numeros';

/**
 * Lista e números não precisam: o cartão já mostra a lista (ou nada, para
 * números digitados). O resto diz de onde veio, com o nome que a tela usa.
 */
export function rotuloDoPublico(origem: OrigemDaCampanha, nome: string): string | null {
  switch (origem) {
    case 'lista':
    case 'numeros':
      return null;
    case 'base':
      return 'Toda a base';
    case 'importacao':
      return `Importação: ${nome}`;
    case 'perfil':
      return `Perfil: ${nome}`;
    case 'regiao':
      return `Estado: ${nome}`;
    case 'publico':
      return nome;
  }
}
