import { gerarSegredoAviso } from '../../dms/integracao-dms';
import {
  basesDoProduto,
  conferirRegistro,
  corpoDoAviso,
  entregue,
  proximaTentativa,
  RECUO_SEGUNDOS,
  TIPO_ACAO_ALTERADA,
} from './aviso-assinado.regras';

// O aviso assinado a quem pediu (Hub DMS, F5 parte B, PR 3): as regras puras.
describe('o aviso assinado — as regras', () => {
  const base = 'https://api.agencialiame.com/v1/inbox/regemcast/';

  it('as bases: a do código para o Liame, a da variável quando ela traz o produto, e nada para quem não está na lista', () => {
    expect(basesDoProduto('liame')).toEqual([base]);
    expect(basesDoProduto('liame', { liame: ['https://aviso.exemplo.test/x/'] })).toEqual(['https://aviso.exemplo.test/x/']);
    expect(basesDoProduto('orzuni')).toEqual([]);
    expect(basesDoProduto('__proto__')).toEqual([]);
    expect(basesDoProduto('toString')).toEqual([]);
  });

  it('o registro: a base mais UM trecho em https, e o segredo whsec_', () => {
    const segredo = gerarSegredoAviso();
    expect(conferirRegistro({ url: `${base}0190f1aa-1111-7222-8333-444455556666`, segredo }, [base])).toEqual({
      ok: true,
      url: `${base}0190f1aa-1111-7222-8333-444455556666`,
    });
    for (const url of [
      `${base}a/b`, // dois trechos
      `${base}`, // nenhum
      `http://api.agencialiame.com/v1/inbox/regemcast/abc`, // sem https
      `https://api.agencialiame.com:8443/v1/inbox/regemcast/abc`, // porta
      `https://outro.exemplo/v1/inbox/regemcast/abc`, // outra origem
      `${base}abc?x=1`, // pergunta
      `https://api.agencialiame.com/v1/inbox/regem/abc`, // a base do Regem, não a do Regemcast
      42,
    ]) {
      expect(conferirRegistro({ url, segredo }, [base])).toMatchObject({ ok: false, problema: 'endereco-nao-permitido' });
    }
    expect(conferirRegistro({ url: `${base}abc`, segredo }, [])).toMatchObject({ ok: false, problema: 'endereco-nao-permitido' });
    for (const ruim of ['segredo', 'whsec_curto', `whsec_${'%'.repeat(40)}`, null]) {
      expect(conferirRegistro({ url: `${base}abc`, segredo: ruim }, [base])).toMatchObject({ ok: false, problema: 'segredo-invalido' });
    }
  });

  it('o corpo leva só o tipo e o id', () => {
    expect(JSON.parse(corpoDoAviso(TIPO_ACAO_ALTERADA, 'id-1'))).toEqual({ tipo: 'acao.alterada', id: 'id-1' });
  });

  it('o recuo: 8 tentativas, cada uma mais longe, e depois desiste', () => {
    const agora = new Date('2026-11-12T12:00:00Z');
    expect(proximaTentativa(1, agora)!.getTime() - agora.getTime()).toBe(30_000);
    expect(proximaTentativa(2, agora)!.getTime() - agora.getTime()).toBe(120_000);
    expect(proximaTentativa(RECUO_SEGUNDOS.length, agora)).not.toBeNull();
    expect(proximaTentativa(RECUO_SEGUNDOS.length + 1, agora)).toBeNull();
    for (let i = 1; i < RECUO_SEGUNDOS.length; i += 1) expect(RECUO_SEGUNDOS[i]!).toBeGreaterThan(RECUO_SEGUNDOS[i - 1]!);
  });

  it('entregue só com 2xx', () => {
    expect(entregue(200)).toBe(true);
    expect(entregue(204)).toBe(true);
    for (const s of [null, 199, 301, 302, 400, 404, 429, 500, 503]) expect(entregue(s)).toBe(false);
  });
});
