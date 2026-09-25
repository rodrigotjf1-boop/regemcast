import { DDDS, ESTADOS, dddDoTelefone, dddsDaUf } from './ddd';

describe('DDD', () => {
  it('cobre os 67 DDDs do Brasil, todos com estado conhecido', () => {
    expect(Object.keys(DDDS)).toHaveLength(67);
    for (const { uf } of Object.values(DDDS)) expect(ESTADOS[uf]).toBeDefined();
    // Todo estado tem pelo menos um DDD.
    for (const uf of Object.keys(ESTADOS)) expect(dddsDaUf(uf).length).toBeGreaterThan(0);
  });

  it('lê o DDD do número como o contato guarda — com e sem o 9º dígito', () => {
    expect(dddDoTelefone('5521989751705')).toBe('21');
    expect(dddDoTelefone('552189751705')).toBe('21');
    expect(dddDoTelefone('5511970001234')).toBe('11');
  });

  it('fora do Brasil, curto demais ou DDD que não existe: sem região', () => {
    expect(dddDoTelefone('16505551234')).toBeNull();
    expect(dddDoTelefone('55219')).toBeNull();
    expect(dddDoTelefone('5520987654321')).toBeNull(); // 20 não é DDD
  });

  it('os DDDs de um estado, em ordem', () => {
    expect(dddsDaUf('RJ')).toEqual(['21', '22', '24']);
    expect(dddsDaUf('df')).toEqual(['61']);
    expect(dddsDaUf('XX')).toEqual([]);
  });
});
