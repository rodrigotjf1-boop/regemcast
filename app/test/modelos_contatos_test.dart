import 'package:flutter_test/flutter_test.dart';
import 'package:regemcast/api/contatos.dart';
import 'package:regemcast/api/modelos.dart';

void main() {
  group('botão de saída', () {
    const link = BotaoModelo(tipo: 'URL', texto: 'Pedir', url: 'https://x');
    const resposta = BotaoModelo(tipo: 'QUICK_REPLY', texto: 'Quero');

    test('marketing simples: respostas agrupadas e a saída por último', () {
      final r = botoesComSaida('MARKETING', 'simples', [resposta, link]);
      expect(r.map((b) => b.texto), ['Pedir', 'Quero', 'Parar promoções']);
    });

    test('não duplica a saída que já veio na lista', () {
      final r = botoesComSaida('MARKETING', 'simples', [
        const BotaoModelo(tipo: 'QUICK_REPLY', texto: 'parar promoções '),
        resposta,
      ]);
      expect(r.where(ehBotaoDeSaida).length, 1);
      expect(r.last.texto, 'Parar promoções');
    });

    test('utilidade e carrossel ficam como estão', () {
      expect(botoesComSaida('UTILITY', 'simples', [resposta]), [resposta]);
      expect(botoesComSaida('MARKETING', 'carrossel', [resposta]), [resposta]);
      expect(limiteBotoes('MARKETING', 'simples'), 9);
      expect(limiteBotoes('UTILITY', 'simples'), 10);
    });
  });

  test('variáveis contam distintas, não ocorrências', () {
    expect(quantasVariaveis('Oi {{1}}, {{1}} e {{ 2 }}'), 2);
    expect(quantasVariaveis('sem nada'), 0);
  });

  group('ModeloSalvo', () {
    Map<String, dynamic> base(Map<String, dynamic> extra) => {
      'id': 'm',
      'nome': 'promo',
      'idioma': 'pt_BR',
      'categoria': 'MARKETING',
      'status': 'aprovado',
      'corpo': 'Oi {{1}}',
      'corpoExemplos': ['Ana'],
      'botoes': [
        {'tipo': 'URL', 'texto': 'Ver', 'url': 'https://x'},
      ],
      ...extra,
    };

    test('edição recente segura a próxima por 24 h', () {
      final m = ModeloSalvo.deJson(
        base({
          'editadoMetaEm': DateTime.now()
              .toUtc()
              .subtract(const Duration(hours: 5))
              .toIso8601String(),
        }),
      );
      expect(m.horasParaEditar, inInclusiveRange(18, 19));
      expect(ModeloSalvo.deJson(base({})).horasParaEditar, 0);
    });

    test('em análise e carrossel não editam pelo app', () {
      expect(ModeloSalvo.deJson(base({'status': 'enviado'})).editavelNoApp, false);
      expect(ModeloSalvo.deJson(base({'tipo': 'carrossel'})).editavelNoApp, false);
      expect(ModeloSalvo.deJson(base({})).editavelNoApp, true);
    });

    test('paraSalvar leva as mudanças e limpa rodapé vazio', () {
      final d = ModeloSalvo.deJson(base({'rodape': 'Loja'})).paraSalvar(
        corpo: 'Olá {{1}}',
        rodape: '  ',
      );
      expect(d['corpo'], 'Olá {{1}}');
      expect(d['rodape'], isNull);
      expect(d['categoria'], 'MARKETING');
      expect((d['botoes'] as List).single, {
        'tipo': 'URL',
        'texto': 'Ver',
        'url': 'https://x',
      });
    });
  });

  test('página de contatos sabe se tem mais', () {
    final p = PaginaContatos.deJson({
      'total': 120,
      'pagina': 2,
      'porPagina': 50,
      'itens': [
        {'id': 'a', 'telefone': '5521999998888', 'nome': ' ', 'optOut': true},
      ],
    });
    expect(p.temMais, true);
    expect(p.itens.single.nome, isNull);
    expect(p.itens.single.optOut, true);
  });
}
