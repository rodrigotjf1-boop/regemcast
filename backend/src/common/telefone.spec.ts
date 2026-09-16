/**
 * Testes da normalização de telefone.
 *
 * O primeiro bloco tranca um defeito que chegou à produção: `21989751705` — o
 * jeito como todo brasileiro escreve o próprio número — passava na validação da
 * campanha sem o `55`, e a Meta o lia como um número internacional inexistente.
 * O erro que voltava não dizia nada sobre formato.
 */
import { mascararTelefone, normalizarTelefoneE164, paraCloudApi } from './telefone';

describe('paraCloudApi', () => {
  it('acrescenta o 55 quando o número vem só com DDD — e avisa que acrescentou', () => {
    const r = paraCloudApi('21989751705');
    expect(r.e164).toBe('5521989751705');
    expect(r.assumiuPaisPadrao).toBe(true);
  });

  it('aceita o número já com o país, sem duplicar o 55', () => {
    expect(paraCloudApi('5521989751705').e164).toBe('5521989751705');
  });

  it('não marca como assumido quando o DDI veio explícito', () => {
    expect(paraCloudApi('+5521989751705').assumiuPaisPadrao).toBe(false);
    expect(paraCloudApi('005521989751705').assumiuPaisPadrao).toBe(false);
  });

  it('entende o número escrito como as pessoas escrevem', () => {
    for (const forma of ['(21) 98975-1705', '21 98975 1705', '21-98975-1705']) {
      expect(paraCloudApi(forma).e164).toBe('5521989751705');
    }
  });

  it('devolve sem o "+", que é o formato do campo `to` da Cloud API', () => {
    expect(paraCloudApi('+5521989751705').e164).not.toContain('+');
  });

  it('respeita número estrangeiro com DDI', () => {
    expect(paraCloudApi('+14155552671').e164).toBe('14155552671');
  });

  it('recusa o que não é telefone', () => {
    for (const lixo of ['', '   ', '123', 'abc', '0000000000000000000', null, undefined, 42]) {
      expect(paraCloudApi(lixo as unknown).e164).toBe('');
    }
  });

  it('as duas representações saem do mesmo parse', () => {
    // É esta igualdade que impede a divergência que causou o defeito: uma
    // função aceitar o que a outra recusa.
    const comMais = normalizarTelefoneE164('21989751705');
    const semMais = paraCloudApi('21989751705').e164;
    expect(comMais).toBe(`+${semMais}`);
  });
});

describe('mascararTelefone', () => {
  it('esconde o miolo e mantém os quatro últimos', () => {
    expect(mascararTelefone('+5521989751705')).toBe('+5521*****1705');
  });

  it('não estoura com nulo nem com número curto', () => {
    expect(mascararTelefone(null)).toBeNull();
    expect(mascararTelefone('123')).toBe('***');
  });
});
