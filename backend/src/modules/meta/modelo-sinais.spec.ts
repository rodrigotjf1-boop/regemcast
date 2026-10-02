/**
 * Os sinais do modelo: qualidade e categoria.
 *
 * Os exemplos dos avisos são os da documentação da Meta (conferidos em
 * 02/10/2026), com o nome trocado. O que estes testes trancam:
 *
 *   1. o que não reconhecemos nunca vira "verde" nem some;
 *   2. `new_category` significa coisas diferentes nos dois formatos do aviso de
 *      categoria — ler errado inverteria "de" e "para";
 *   3. só a QUEDA de qualidade vira aviso no celular.
 */
import {
  avisoDaCategoria,
  avisoDaQualidade,
  lerMudancaDeCategoria,
  lerMudancaDeQualidade,
  nomeDaCategoria,
  qualidadeDoModelo,
  sinaisDoModelo,
} from './modelo-sinais';

describe('qualidade do modelo', () => {
  it.each([
    ['GREEN', 'verde'],
    ['YELLOW', 'amarela'],
    ['RED', 'vermelha'],
    ['UNKNOWN', 'desconhecida'],
    ['green', 'verde'],
  ])('%s → %s', (bruto, esperado) => {
    expect(qualidadeDoModelo(bruto)).toBe(esperado);
  });

  it('lê o objeto da lista de modelos ({ score, date })', () => {
    expect(qualidadeDoModelo({ score: 'RED', date: 1746082800 })).toBe('vermelha');
  });

  it.each([undefined, null, '', 'PURPLE', {}, 42])('o que não reconhece (%p) é "desconhecida", nunca "verde"', (bruto) => {
    expect(qualidadeDoModelo(bruto)).toBe('desconhecida');
  });
});

describe('nome da categoria', () => {
  it('traduz as três da Meta e mostra crua a que não conhece', () => {
    expect(nomeDaCategoria('MARKETING')).toBe('marketing');
    expect(nomeDaCategoria('UTILITY')).toBe('utilidade');
    expect(nomeDaCategoria('AUTHENTICATION')).toBe('autenticação');
    expect(nomeDaCategoria('SERVICE')).toBe('service');
    expect(nomeDaCategoria('')).toBeNull();
    expect(nomeDaCategoria(undefined)).toBeNull();
  });
});

describe('sinais do modelo na lista da Meta', () => {
  it('modelo sem nada de especial: sem alerta', () => {
    expect(sinaisDoModelo({ category: 'MARKETING', quality_score: { score: 'GREEN' } })).toEqual({
      qualidade: 'verde',
      categoriaPrevista: null,
      categoriaAnterior: null,
      alertas: [],
    });
  });

  it('a Meta devolve a categoria certa IGUAL à atual: não é mudança', () => {
    const s = sinaisDoModelo({ category: 'MARKETING', correct_category: 'MARKETING', previous_category: 'MARKETING' });
    expect(s.categoriaPrevista).toBeNull();
    expect(s.categoriaAnterior).toBeNull();
    expect(s.alertas).toEqual([]);
  });

  it('categoria certa diferente da atual: a Meta vai mudar, e a tela avisa do preço', () => {
    const s = sinaisDoModelo({ category: 'UTILITY', correct_category: 'MARKETING' });
    expect(s.categoriaPrevista).toBe('marketing');
    expect(s.alertas).toEqual([
      {
        tom: 'atencao',
        texto:
          'A Meta vai mudar este modelo de utilidade para marketing em até 24 horas. O preço por mensagem e as regras de envio mudam junto.',
      },
    ]);
  });

  it('categoria anterior diferente: a Meta já mudou — informa, sem alerta permanente', () => {
    const s = sinaisDoModelo({ category: 'MARKETING', previous_category: 'UTILITY' });
    expect(s.categoriaAnterior).toBe('utilidade');
    expect(s.alertas).toEqual([]);
  });

  it('qualidade amarela é atenção; vermelha é erro e fala da pausa', () => {
    expect(sinaisDoModelo({ category: 'MARKETING', quality_score: { score: 'YELLOW' } }).alertas).toEqual([
      expect.objectContaining({ tom: 'atencao', texto: expect.stringContaining('Qualidade em atenção') }),
    ]);
    const vermelha = sinaisDoModelo({ category: 'MARKETING', quality_score: { score: 'RED' } }).alertas;
    expect(vermelha).toEqual([expect.objectContaining({ tom: 'erro', texto: expect.stringContaining('pausar ou desativar') })]);
  });

  it('modelo novo (sem qualidade): "desconhecida", sem alerta', () => {
    expect(sinaisDoModelo({ category: 'MARKETING' })).toMatchObject({ qualidade: 'desconhecida', alertas: [] });
  });

  it('nenhuma frase em inglês, e todas terminam com ponto', () => {
    const todos = [
      ...sinaisDoModelo({ category: 'UTILITY', correct_category: 'MARKETING', quality_score: 'RED' }).alertas,
      ...sinaisDoModelo({ category: 'MARKETING', quality_score: 'YELLOW' }).alertas,
    ];
    expect(todos.length).toBe(3);
    for (const a of todos) {
      expect(a.texto).toMatch(/\.$/);
      expect(a.texto).not.toMatch(/UTILITY|MARKETING|YELLOW|RED|quality/);
    }
  });
});

describe('aviso de qualidade (message_template_quality_update)', () => {
  // O exemplo da documentação.
  const oficial = {
    previous_quality_score: 'GREEN',
    new_quality_score: 'YELLOW',
    message_template_id: 806312974732579,
    message_template_name: 'promo_de_sexta',
    message_template_language: 'pt_BR',
  };

  it('lê o exemplo oficial: caiu de verde para amarela', () => {
    expect(lerMudancaDeQualidade(oficial)).toEqual({
      idMeta: '806312974732579',
      nome: 'promo_de_sexta',
      anterior: 'verde',
      nova: 'amarela',
      piorou: true,
    });
  });

  it.each([
    ['GREEN', 'YELLOW', true],
    ['GREEN', 'RED', true],
    ['YELLOW', 'RED', true],
    ['UNKNOWN', 'YELLOW', true],
    ['UNKNOWN', 'RED', true],
    ['UNKNOWN', 'GREEN', false],
    ['YELLOW', 'GREEN', false],
    ['RED', 'YELLOW', false],
    ['RED', 'GREEN', false],
    ['GREEN', 'GREEN', false],
    ['GREEN', 'UNKNOWN', false],
    ['RED', 'UNKNOWN', false],
  ])('%s → %s: piorou = %s', (anterior, nova, piorou) => {
    expect(lerMudancaDeQualidade({ ...oficial, previous_quality_score: anterior, new_quality_score: nova })?.piorou).toBe(piorou);
  });

  it('só a queda vira aviso no celular; vermelha fala da pausa', () => {
    expect(avisoDaQualidade(lerMudancaDeQualidade({ ...oficial, previous_quality_score: 'YELLOW', new_quality_score: 'GREEN' })!)).toBeNull();
    expect(avisoDaQualidade(lerMudancaDeQualidade(oficial)!)).toEqual({
      titulo: 'Qualidade em atenção: promo_de_sexta',
      corpo: 'Parte de quem recebeu este modelo bloqueou ou reclamou. Se continuar, a Meta pode pausá-lo.',
    });
    expect(avisoDaQualidade(lerMudancaDeQualidade({ ...oficial, new_quality_score: 'RED' })!)).toMatchObject({
      titulo: 'Qualidade ruim: promo_de_sexta',
      corpo: expect.stringContaining('pausar ou desativar'),
    });
  });

  it('aviso sem id e sem nome não serve', () => {
    expect(lerMudancaDeQualidade({ previous_quality_score: 'GREEN', new_quality_score: 'RED' })).toBeNull();
  });
});

describe('aviso de categoria (template_category_update)', () => {
  // Os dois exemplos da documentação.
  const vaiMudar = {
    message_template_id: 278077987957091,
    message_template_name: 'pedido_saiu',
    message_template_language: 'pt_BR',
    new_category: 'UTILITY',
    correct_category: 'MARKETING',
    category_update_timestamp: 1746169200,
  };
  const mudou = {
    message_template_id: 278077987957091,
    message_template_name: 'pedido_saiu',
    message_template_language: 'pt_BR',
    previous_category: 'UTILITY',
    new_category: 'MARKETING',
  };

  it('aviso das 24 horas: `new_category` é a categoria de HOJE, `correct_category` a de amanhã', () => {
    expect(lerMudancaDeCategoria(vaiMudar)).toEqual({
      idMeta: '278077987957091',
      nome: 'pedido_saiu',
      de: 'utilidade',
      para: 'marketing',
      feita: false,
      quando: new Date(1746169200 * 1000),
      paraBruta: 'MARKETING',
    });
  });

  it('mudança feita: `previous_category` → `new_category`', () => {
    expect(lerMudancaDeCategoria(mudou)).toEqual({
      idMeta: '278077987957091',
      nome: 'pedido_saiu',
      de: 'utilidade',
      para: 'marketing',
      feita: true,
      quando: null,
      paraBruta: 'MARKETING',
    });
  });

  it('sem mudança de verdade (mesma categoria, ou faltando um lado): nada', () => {
    expect(lerMudancaDeCategoria({ ...mudou, previous_category: 'MARKETING' })).toBeNull();
    expect(lerMudancaDeCategoria({ ...vaiMudar, correct_category: 'UTILITY' })).toBeNull();
    expect(lerMudancaDeCategoria({ message_template_id: 1, new_category: 'MARKETING' })).toBeNull();
    expect(lerMudancaDeCategoria({ new_category: 'MARKETING', previous_category: 'UTILITY' })).toBeNull();
  });

  it('o aviso das 24 horas diz quando, no fuso da conta', () => {
    // 1746169200 = 02/05/2025 07:00 UTC = 04:00 em Brasília = 03:00 em Manaus.
    const m = lerMudancaDeCategoria(vaiMudar)!;
    expect(avisoDaCategoria(m, 'America/Sao_Paulo')).toEqual({
      titulo: 'A Meta vai mudar a categoria: pedido_saiu',
      corpo: 'O modelo passa de utilidade para marketing em 02/05 às 04:00. O preço por mensagem e as regras de envio mudam junto.',
    });
    expect(avisoDaCategoria(m, 'America/Manaus').corpo).toContain('em 02/05 às 03:00');
  });

  it('fuso inválido na conta não derruba o aviso: cai no de Brasília', () => {
    expect(avisoDaCategoria(lerMudancaDeCategoria(vaiMudar)!, 'Lugar/Nenhum').corpo).toContain('em 02/05 às 04:00');
  });

  it('sem a hora marcada, diz "em até 24 horas"', () => {
    const m = lerMudancaDeCategoria({ ...vaiMudar, category_update_timestamp: undefined })!;
    expect(avisoDaCategoria(m, 'America/Sao_Paulo').corpo).toContain('para marketing em até 24 horas.');
  });

  it('mudança feita: diz de onde para onde e que o preço muda', () => {
    expect(avisoDaCategoria(lerMudancaDeCategoria(mudou)!, 'America/Sao_Paulo')).toEqual({
      titulo: 'A Meta mudou a categoria: pedido_saiu',
      corpo: 'O modelo passou de utilidade para marketing. O preço por mensagem e as regras de envio mudam junto.',
    });
  });
});
