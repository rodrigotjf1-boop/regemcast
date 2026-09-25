/**
 * Os três formatos em que a Meta informa o limite de envio, como estão na
 * documentação oficial (conferida em 25/09/2026) — inclusive a contradição do
 * aviso `business_capability_update`, que lista nomes de degrau e dá um número
 * no exemplo.
 */
import { SEM_TETO, limiteInformado } from './limite.regras';

describe('limiteInformado', () => {
  it('lê o nome do degrau, inclusive o de 2.000 que substituiu o de 1.000', () => {
    expect(limiteInformado('TIER_250')).toEqual({ limite: 250, nome: 'TIER_250' });
    expect(limiteInformado('TIER_2K')).toEqual({ limite: 2_000, nome: 'TIER_2K' });
    expect(limiteInformado('TIER_10K')).toEqual({ limite: 10_000, nome: 'TIER_10K' });
    expect(limiteInformado('TIER_100K')).toEqual({ limite: 100_000, nome: 'TIER_100K' });
    expect(limiteInformado('tier_1k')).toEqual({ limite: 1_000, nome: 'TIER_1K' });
  });

  it('sem teto vem como nome ou como -1, e vira limite nulo com o nome canônico', () => {
    expect(limiteInformado('TIER_UNLIMITED')).toEqual({ limite: null, nome: SEM_TETO });
    expect(limiteInformado(-1)).toEqual({ limite: null, nome: SEM_TETO });
    expect(limiteInformado('-1')).toEqual({ limite: null, nome: SEM_TETO });
  });

  it('lê o número do exemplo do aviso e dá a ele o nome do degrau', () => {
    expect(limiteInformado(2000)).toEqual({ limite: 2_000, nome: 'TIER_2K' });
    expect(limiteInformado('250')).toEqual({ limite: 250, nome: 'TIER_250' });
    expect(limiteInformado(5000)).toEqual({ limite: 5_000, nome: 'TIER_5K' });
  });

  it('o que não reconhece é "não sabemos" — nunca "sem teto"', () => {
    for (const bruto of [undefined, null, '', 'TIER_ALGO_NOVO', 0, -5, 12.5, Number.NaN, {}, 'abc']) {
      expect(limiteInformado(bruto)).toBeUndefined();
    }
  });
});
