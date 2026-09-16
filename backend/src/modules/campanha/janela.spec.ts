/**
 * Testes da janela de envio.
 *
 * As bordas aqui são as que erram em produção sem ninguém perceber: o servidor
 * em UTC calculando a hora do cliente em São Paulo, a janela que atravessa a
 * meia-noite, e a pausa que deixa sair duas mensagens coladas.
 */
import {
  decidir,
  dentroDaJanela,
  momentoNoFuso,
  pausaCumprida,
  quantasCabem,
  type RegraDeEnvio,
} from './janela';

const SEM_REGRA: RegraDeEnvio = {
  janelaDias: [],
  janelaInicio: null,
  janelaFim: null,
  pausaSegundos: 0,
  maxPorDia: null,
  maxPorSemana: null,
  maxPorMes: null,
};

describe('momento no fuso da conta', () => {
  it('usa a hora de São Paulo, não a do servidor em UTC', () => {
    // 15:00 UTC = 12:00 em São Paulo (UTC-3).
    const m = momentoNoFuso(new Date('2026-09-16T15:00:00Z'), 'America/Sao_Paulo');
    expect(m.minutos).toBe(12 * 60);
  });

  it('vira o dia pelo fuso da conta', () => {
    // 01:00 UTC de quinta = 22:00 de QUARTA em São Paulo.
    const m = momentoNoFuso(new Date('2026-09-17T01:00:00Z'), 'America/Sao_Paulo');
    expect(m.diaSemana).toBe(3); // quarta
    expect(m.minutos).toBe(22 * 60);
  });
});

describe('dentro da janela', () => {
  const noveAsVinte: RegraDeEnvio = { ...SEM_REGRA, janelaInicio: '09:00', janelaFim: '20:00' };

  it('sem regra, qualquer momento serve', () => {
    expect(dentroDaJanela(SEM_REGRA, { diaSemana: 0, minutos: 3 * 60 })).toBe(true);
  });

  it('respeita o horário, com o fim aberto', () => {
    expect(dentroDaJanela(noveAsVinte, { diaSemana: 2, minutos: 9 * 60 })).toBe(true);
    expect(dentroDaJanela(noveAsVinte, { diaSemana: 2, minutos: 19 * 60 + 59 })).toBe(true);
    expect(dentroDaJanela(noveAsVinte, { diaSemana: 2, minutos: 20 * 60 })).toBe(false);
    expect(dentroDaJanela(noveAsVinte, { diaSemana: 2, minutos: 8 * 60 + 59 })).toBe(false);
  });

  it('entende a janela que ATRAVESSA a meia-noite', () => {
    // A comparação ingênua "início <= agora < fim" nunca é verdade com início
    // maior que fim, e a campanha simplesmente não sai.
    const noite: RegraDeEnvio = { ...SEM_REGRA, janelaInicio: '22:00', janelaFim: '02:00' };
    expect(dentroDaJanela(noite, { diaSemana: 2, minutos: 23 * 60 })).toBe(true);
    expect(dentroDaJanela(noite, { diaSemana: 2, minutos: 1 * 60 })).toBe(true);
    expect(dentroDaJanela(noite, { diaSemana: 2, minutos: 12 * 60 })).toBe(false);
  });

  it('respeita os dias da semana', () => {
    const uteis: RegraDeEnvio = { ...SEM_REGRA, janelaDias: [1, 2, 3, 4, 5] };
    expect(dentroDaJanela(uteis, { diaSemana: 3, minutos: 600 })).toBe(true);
    expect(dentroDaJanela(uteis, { diaSemana: 0, minutos: 600 })).toBe(false); // domingo
    expect(dentroDaJanela(uteis, { diaSemana: 6, minutos: 600 })).toBe(false); // sábado
  });

  it('dias VAZIOS significa qualquer dia, não nenhum', () => {
    // A leitura contrária deixaria parada para sempre a campanha de quem só
    // não marcou nenhum dia.
    expect(dentroDaJanela({ ...SEM_REGRA, janelaDias: [] }, { diaSemana: 0, minutos: 600 })).toBe(true);
  });
});

describe('tetos por período', () => {
  it('o menor dos três manda', () => {
    const r: RegraDeEnvio = { ...SEM_REGRA, maxPorDia: 100, maxPorSemana: 300, maxPorMes: 1000 };
    expect(quantasCabem(r, { dia: 90, semana: 100, mes: 100 })).toBe(10);
    expect(quantasCabem(r, { dia: 10, semana: 295, mes: 300 })).toBe(5);
  });

  it('nunca devolve negativo, mesmo com teto estourado', () => {
    const r: RegraDeEnvio = { ...SEM_REGRA, maxPorDia: 10 };
    expect(quantasCabem(r, { dia: 15, semana: 15, mes: 15 })).toBe(0);
  });

  it('sem teto, não limita', () => {
    expect(quantasCabem(SEM_REGRA, { dia: 9999, semana: 9999, mes: 9999 })).toBe(Infinity);
  });
});

describe('pausa entre envios', () => {
  const trinta: RegraDeEnvio = { ...SEM_REGRA, pausaSegundos: 30 };
  const agora = new Date('2026-09-16T12:00:30Z');

  it('segura enquanto a pausa não passou', () => {
    expect(pausaCumprida(trinta, new Date('2026-09-16T12:00:10Z'), agora)).toBe(false);
  });

  it('libera quando a pausa passou', () => {
    expect(pausaCumprida(trinta, new Date('2026-09-16T12:00:00Z'), agora)).toBe(true);
  });

  it('a primeira mensagem não espera', () => {
    expect(pausaCumprida(trinta, null, agora)).toBe(true);
  });
});

describe('a decisão', () => {
  const agora = new Date('2026-09-16T15:00:00Z');
  const meioDia = { diaSemana: 3, minutos: 12 * 60 };
  const zerado = { dia: 0, semana: 0, mes: 0 };

  it('sem regra, sai o lote inteiro', () => {
    expect(decidir(SEM_REGRA, meioDia, zerado, null, agora, 50)).toEqual({ pode: true, quantas: 50 });
  });

  it('com pausa, sai UMA por rodada', () => {
    // Duas na mesma rodada já violariam a pausa entre elas.
    const r = { ...SEM_REGRA, pausaSegundos: 30 };
    expect(decidir(r, meioDia, zerado, null, agora, 50)).toEqual({ pode: true, quantas: 1 });
  });

  it('o lote nunca passa do que o teto ainda permite', () => {
    const r = { ...SEM_REGRA, maxPorDia: 100 };
    expect(decidir(r, meioDia, { dia: 97, semana: 97, mes: 97 }, null, agora, 50)).toEqual({
      pode: true,
      quantas: 3,
    });
  });

  it('fora da janela, explica o motivo', () => {
    const r = { ...SEM_REGRA, janelaInicio: '18:00', janelaFim: '20:00' };
    expect(decidir(r, meioDia, zerado, null, agora, 50)).toEqual({ pode: false, motivo: 'fora_da_janela' });
  });

  it('com a janela fechada E o teto estourado, o motivo é a janela', () => {
    // Dos dois, é o que muda sozinho mais cedo — a informação mais útil.
    const r = { ...SEM_REGRA, janelaInicio: '18:00', janelaFim: '20:00', maxPorDia: 10 };
    expect(decidir(r, meioDia, { dia: 10, semana: 10, mes: 10 }, null, agora, 50)).toMatchObject({
      motivo: 'fora_da_janela',
    });
  });
});
