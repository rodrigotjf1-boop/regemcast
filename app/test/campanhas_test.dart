import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:regemcast/api/campanhas.dart';
import 'package:regemcast/api/cliente_api.dart';
import 'package:regemcast/api/dados.dart';
import 'package:regemcast/sessao/sessao.dart';
import 'package:regemcast/telas/campanha_detalhe.dart';
import 'package:regemcast/config.dart';
import 'package:regemcast/telas/campanha_formulario.dart';
import 'package:regemcast/tema/tema.dart';
import 'package:regemcast/util/formato.dart' as f;

http.Response _json(Object corpo, [int status = 200]) => http.Response.bytes(
  utf8.encode(jsonEncode(corpo)),
  status,
  headers: {'content-type': 'application/json; charset=utf-8'},
);

Map<String, dynamic> _campanha(
  String status, {
  String? pausaMotivo,
  Map<String, int>? porStatus,
}) => {
  'id': 'c1',
  'nome': 'Sexta do Smash',
  'modeloNome': 'promo_sexta',
  'status': status,
  'pausaMotivo': pausaMotivo,
  'criadoEm': '2026-09-18T12:00:00Z',
  'porStatus': porStatus ?? {'pendente': 100},
  'total': 100,
  'listaNome': 'Clientes',
  'janelaDias': <int>[],
  'pausaSegundos': 0,
};

/// O 131042 (pagamento da conta do WhatsApp na Meta) como o servidor manda.
const _erroDoPagamento = {
  'codigo': 131042,
  'titulo': 'Falta acertar o pagamento na Meta',
  'explicacao':
      'A Meta não entregou porque o pagamento da conta do WhatsApp Business não está em ordem.',
  'acao': 'Acerte o pagamento da conta do WhatsApp na Meta.',
  'quem': 'voce',
  'tela': null,
  'link': {
    'rotulo': 'Abrir o pagamento na Meta',
    'url': 'https://business.facebook.com/billing_hub/accounts/details/',
  },
  'daMeta':
      'Message failed to send because your WhatsApp Business account currency is not configured.',
};

/// Um servidor falso que responde à campanha e anota o que foi pedido.
class _Servidor {
  _Servidor(this.campanha, {this.destinatarios});

  Map<String, dynamic> campanha;
  List<Map<String, dynamic>>? destinatarios;

  /// A saúde da conta na Meta; nulo = o servidor não devolve sinal nenhum.
  Map<String, dynamic>? saude;
  final pedidos = <String>[];
  Map<String, dynamic>? ultimoCorpo;

  ClienteApi get api => ClienteApi(
    base: 'https://api.teste',
    http: MockClient((req) async {
      pedidos.add('${req.method} ${req.url.path}');
      if (req.body.isNotEmpty) {
        ultimoCorpo = jsonDecode(req.body) as Map<String, dynamic>;
      }
      final p = req.url.path;
      if (p == '/whatsapp/saude') return _json(saude ?? {});
      if (p == '/campanhas/c1/destinatarios' && destinatarios != null) {
        return _json(destinatarios!);
      }
      if (p == '/campanhas/c1/destinatarios') {
        return _json([
          {
            'id': 'd1',
            'telefone': '5521999998888',
            'status': 'falhou',
            'erroTitulo': 'Número sem WhatsApp',
            'erroDetalhe': 'A Meta não encontrou WhatsApp neste número.',
          },
          {'id': 'd2', 'telefone': '5521988887777', 'status': 'pendente'},
        ]);
      }
      if (p == '/campanhas/c1/disparar') {
        campanha = {...campanha, 'status': 'agendada'};
        return _json(campanha, 201);
      }
      if (p == '/campanhas/c1/pausar') {
        campanha = {...campanha, 'status': 'pausada', 'pausaMotivo': 'manual'};
        return _json(campanha);
      }
      if (p == '/campanhas/c1' && req.method == 'PATCH') return _json(campanha);
      if (p == '/campanhas/c1' && req.method == 'DELETE') {
        return _json({'resultado': 'cancelada'});
      }
      if (p == '/campanhas/c1') return _json(campanha);
      return _json({});
    }),
  );
}

Widget _app(ClienteApi api, Widget tela) => ProviderScope(
  overrides: [clienteApiProvider.overrideWithValue(api)],
  child: MaterialApp(
    theme: temaDoApp(Brightness.light),
    home: MediaQuery(
      data: const MediaQueryData(disableAnimations: true),
      child: tela,
    ),
  ),
);

/// Celular alto (412×1830): o teste enxerga a tela inteira sem rolar.
void _telaAlta(WidgetTester t) {
  t.view.physicalSize = const Size(1080, 4800);
  t.view.devicePixelRatio = 2.625;
  addTearDown(t.view.reset);
}

Future<void> _assentar(WidgetTester t) async {
  for (var i = 0; i < 10; i++) {
    await t.pump(const Duration(milliseconds: 50));
  }
}

void main() {
  setUpAll(() => initializeDateFormatting('pt_BR'));

  group(
    'o que dá para fazer em cada situação (as mesmas regras do servidor)',
    () {
      ResumoCampanha c(String s) => ResumoCampanha.deJson(_campanha(s));

      test('rascunho: dispara, edita e exclui', () {
        expect(c('rascunho').podeDisparar, isTrue);
        expect(c('rascunho').podeEditar, isTrue);
        expect(c('rascunho').podeExcluir, isTrue);
        expect(c('rascunho').podePausar, isFalse);
      });

      test('enviando: só pausa — não exclui sem pausar antes', () {
        expect(c('enviando').podePausar, isTrue);
        expect(c('enviando').podeExcluir, isFalse);
        expect(c('enviando').podeEditar, isFalse);
      });

      test('pausada: retoma, edita e cancela', () {
        expect(c('pausada').podeRetomar, isTrue);
        expect(c('pausada').podeEditar, isTrue);
        expect(c('pausada').podeExcluir, isTrue);
      });

      test('concluída: só arquiva', () {
        final x = c('concluida');
        expect([
          x.podeDisparar,
          x.podePausar,
          x.podeRetomar,
          x.podeEditar,
        ], everyElement(isFalse));
        expect(x.podeExcluir, isTrue);
      });
    },
  );

  group('formatos da campanha', () {
    test('telefone brasileiro', () {
      expect(f.telefone('5521999998888'), '+55 21 99999-8888');
      expect(f.telefone('552133334444'), '+55 21 3333-4444');
      expect(f.telefone('14155550100'), '+14155550100');
    });
    test('dias da semana', () {
      expect(f.diasDaSemana([]), 'Todos os dias');
      expect(f.diasDaSemana([5, 1, 3]), 'Seg, Qua e Sex');
    });
    test('porcentagem', () {
      expect(f.porcento(57, 100), '57%');
      expect(f.porcento(1, 0), '—');
    });
  });

  group('ações', () {
    test('excluir devolve o que de fato aconteceu', () async {
      final s = _Servidor(_campanha('pausada'));
      final r = await ServicoCampanhas(s.api).excluir('c1');
      expect(r, ResultadoExclusao.cancelada);
      expect(s.pedidos, contains('DELETE /campanhas/c1'));
    });
  });

  group('tela da campanha', () {
    testWidgets('rascunho: disparar pede confirmação e chama o servidor', (
      t,
    ) async {
      _telaAlta(t);
      final s = _Servidor(_campanha('rascunho'));
      await t.pumpWidget(_app(s.api, const TelaCampanhaDetalhe(id: 'c1')));
      await _assentar(t);

      expect(find.text('Disparar agora'), findsOneWidget);
      await t.tap(find.text('Disparar agora'));
      await _assentar(t);
      expect(
        find.text('Disparar agora?'),
        findsOneWidget,
        reason: 'disparo não tem volta: precisa confirmar',
      );
      expect(s.pedidos, isNot(contains('POST /campanhas/c1/disparar')));

      await t.tap(find.widgetWithText(FilledButton, 'Disparar'));
      await _assentar(t);
      expect(s.pedidos, contains('POST /campanhas/c1/disparar'));
    });

    testWidgets(
      'rascunho com a conta bloqueada na Meta: avisa antes do disparo e leva ao WhatsApp',
      (t) async {
        _telaAlta(t);
        final s = _Servidor(_campanha('rascunho'))
          ..saude = {
            'sinal': 'bloqueado',
            'titulo': 'Não pode enviar agora',
            'resumo': 'Há 1 ponto a resolver.',
            'lidaEm': '2026-10-01T22:10:00Z',
            'itens': [
              {
                'chave': 'conta',
                'rotulo': 'Conta do WhatsApp',
                'sinal': 'bloqueado',
                'resumo': 'Bloqueado para enviar.',
                'problemas': [
                  {
                    'codigo': 141006,
                    'titulo':
                        'A Meta bloqueou o envio por um problema da conta do WhatsApp',
                    'explicacao':
                        'Enquanto isso não for resolvido, a Meta recusa as mensagens desta conta.',
                    'acao': 'Veja o motivo em WhatsApp.',
                    'quem': 'voce',
                    'tela': null,
                    'link': null,
                    'daMeta': null,
                  },
                ],
              },
            ],
          };
        await t.pumpWidget(_app(s.api, const TelaCampanhaDetalhe(id: 'c1')));
        await _assentar(t);

        expect(find.byKey(const ValueKey('cd-saude')), findsOneWidget);
        expect(
          find.text(
            'A Meta não deixa esta conta enviar agora. Resolva o ponto abaixo antes de disparar.',
          ),
          findsOneWidget,
        );
        expect(
          find.text(
            'A Meta bloqueou o envio por um problema da conta do WhatsApp',
          ),
          findsOneWidget,
        );
        expect(find.text('Abrir WhatsApp'), findsOneWidget);
      },
    );

    testWidgets('rascunho com a conta em dia: nenhum aviso da saúde', (
      t,
    ) async {
      _telaAlta(t);
      final s = _Servidor(_campanha('rascunho'))
        ..saude = {
          'sinal': 'pode_enviar',
          'titulo': 'Pode enviar',
          'resumo': 'A Meta não aponta nada que impeça o envio.',
          'lidaEm': '2026-10-01T22:10:00Z',
          'itens': <Object>[],
        };
      await t.pumpWidget(_app(s.api, const TelaCampanhaDetalhe(id: 'c1')));
      await _assentar(t);

      expect(find.byKey(const ValueKey('cd-saude')), findsNothing);
      expect(s.pedidos, contains('GET /whatsapp/saude'));
    });

    testWidgets('enviando: a saúde nem é pedida — não há o que decidir agora', (
      t,
    ) async {
      _telaAlta(t);
      final s = _Servidor(
        _campanha('enviando', porStatus: {'entregue': 40, 'pendente': 60}),
      );
      await t.pumpWidget(_app(s.api, const TelaCampanhaDetalhe(id: 'c1')));
      await _assentar(t);

      expect(s.pedidos, isNot(contains('GET /whatsapp/saude')));
    });

    testWidgets('enviando: o botão é pausar, e o menu não oferece excluir', (
      t,
    ) async {
      _telaAlta(t);
      final s = _Servidor(
        _campanha('enviando', porStatus: {'entregue': 40, 'pendente': 60}),
      );
      await t.pumpWidget(_app(s.api, const TelaCampanhaDetalhe(id: 'c1')));
      await _assentar(t);

      expect(find.text('Pausar envio'), findsOneWidget);
      expect(find.byTooltip('Mais ações'), findsNothing);

      await t.tap(find.text('Pausar envio'));
      await _assentar(t);
      expect(s.pedidos, contains('POST /campanhas/c1/pausar'));
    });

    testWidgets('pausada por você: explica e oferece retomar', (t) async {
      _telaAlta(t);
      final s = _Servidor(_campanha('pausada', pausaMotivo: 'manual'));
      await t.pumpWidget(_app(s.api, const TelaCampanhaDetalhe(id: 'c1')));
      await _assentar(t);

      expect(find.textContaining('Pausada por você'), findsOneWidget);
      expect(find.text('Retomar envio'), findsOneWidget);
    });

    testWidgets(
      'pausada pelo modelo: diz que parou na primeira recusa, leva aos modelos e oferece retomar',
      (t) async {
        _telaAlta(t);
        final s = _Servidor(_campanha('pausada', pausaMotivo: 'modelo'));
        await t.pumpWidget(_app(s.api, const TelaCampanhaDetalhe(id: 'c1')));
        await _assentar(t);

        expect(find.byKey(const ValueKey('cd-pausa-modelo')), findsOneWidget);
        expect(
          find.textContaining('a Meta recusou o modelo desta campanha'),
          findsOneWidget,
        );
        expect(
          find.textContaining('sem ser marcado como falha'),
          findsOneWidget,
        );
        expect(find.text('Ver modelos'), findsOneWidget);
        expect(find.text('Retomar envio'), findsOneWidget);
      },
    );

    testWidgets(
      'pausada pela conta na Meta: diz o que houve, o que fazer e de quem depende, sem a frase em inglês',
      (t) async {
        _telaAlta(t);
        final s = _Servidor({
          ..._campanha('pausada', pausaMotivo: 'conta_meta'),
          'pausaErro': _erroDoPagamento,
        });
        await t.pumpWidget(_app(s.api, const TelaCampanhaDetalhe(id: 'c1')));
        await _assentar(t);

        expect(find.byKey(const ValueKey('cd-pausa-conta')), findsOneWidget);
        expect(
          find.textContaining('quem faltava continua na fila'),
          findsOneWidget,
        );
        expect(find.text('Falta acertar o pagamento na Meta'), findsOneWidget);
        expect(find.text('Depende de você'), findsOneWidget);
        expect(
          find.textContaining('Acerte o pagamento da conta do WhatsApp'),
          findsOneWidget,
        );
        // No app da Play nada leva a uma página de pagamento fora dele.
        expect(
          find.text('Abrir o pagamento na Meta'),
          compraNoApp ? findsOneWidget : findsNothing,
        );
        expect(find.text('Retomar envio'), findsOneWidget);

        // A frase da Meta fica recolhida, para quem quiser ler.
        expect(find.textContaining('Message failed to send'), findsNothing);
        await t.ensureVisible(find.byKey(const ValueKey('erro-da-meta')));
        await t.tap(find.byKey(const ValueKey('erro-da-meta')));
        await _assentar(t);
        expect(
          find.textContaining('Código 131042. Message failed to send'),
          findsOneWidget,
        );
      },
    );

    testWidgets(
      'por que falhou: um bloco por motivo, com a contagem, o que fazer e o atalho da tela',
      (t) async {
        _telaAlta(t);
        final s = _Servidor({
          ..._campanha('concluida', porStatus: {'entregue': 60, 'falhou': 40}),
          'falhasPorMotivo': [
            {
              'total': 38,
              'erro': {
                'codigo': 131050,
                'titulo': 'Parou o marketing pelo WhatsApp',
                'explicacao':
                    'A pessoa escolheu, no próprio WhatsApp, não receber mais mensagens de marketing da sua empresa.',
                'acao': 'Não precisa fazer nada, e reenviar não adianta.',
                'quem': 'ninguem',
                'tela': 'bloqueios',
                'link': null,
                'daMeta': null,
              },
            },
            {'total': 2, 'erro': _erroDoPagamento},
            // Linha que o app não entende não derruba a tela.
            {'total': 1, 'erro': 'lixo'},
          ],
        });
        await t.pumpWidget(_app(s.api, const TelaCampanhaDetalhe(id: 'c1')));
        await _assentar(t);

        expect(find.byKey(const ValueKey('cd-por-que-falhou')), findsOneWidget);
        expect(
          find.text(
            '2 motivos, do mais comum para o menos, cada um com o que fazer.',
          ),
          findsOneWidget,
        );
        expect(find.text('38 mensagens'), findsOneWidget);
        expect(find.text('Parou o marketing pelo WhatsApp'), findsOneWidget);
        expect(find.text('Sem ação sua'), findsOneWidget);
        expect(find.text('Ver bloqueios'), findsOneWidget);
        expect(find.text('2 mensagens'), findsOneWidget);
        expect(find.text('Falta acertar o pagamento na Meta'), findsOneWidget);
      },
    );

    testWidgets(
      'servidor antigo, sem o erro na pausa: o aviso aparece sem o bloco',
      (t) async {
        _telaAlta(t);
        final s = _Servidor(_campanha('pausada', pausaMotivo: 'conta_meta'));
        await t.pumpWidget(_app(s.api, const TelaCampanhaDetalhe(id: 'c1')));
        await _assentar(t);

        expect(find.byKey(const ValueKey('cd-pausa-conta')), findsOneWidget);
        expect(find.byKey(const ValueKey('erro-da-meta')), findsNothing);
        expect(find.byKey(const ValueKey('cd-por-que-falhou')), findsNothing);
        expect(find.text('Retomar envio'), findsOneWidget);
      },
    );

    testWidgets('mostra o motivo real da falha de cada destinatário', (
      t,
    ) async {
      _telaAlta(t);
      final s = _Servidor(
        _campanha('concluida', porStatus: {'entregue': 99, 'falhou': 1}),
      );
      await t.pumpWidget(_app(s.api, const TelaCampanhaDetalhe(id: 'c1')));
      await _assentar(t);

      expect(find.text('Número sem WhatsApp'), findsOneWidget);
      expect(find.text('+55 21 99999-8888'), findsOneWidget);
    });
  });

  group('o que o detalhe explica (como o site)', () {
    testWidgets('esperando o limite da Meta: quantas pessoas e até quando', (
      t,
    ) async {
      _telaAlta(t);
      final s = _Servidor({
        ..._campanha('enviando', porStatus: {'entregue': 400, 'pendente': 600}),
        'espera': {
          'motivo': 'limite_meta',
          'ate': '2026-09-30T13:00:00Z',
          'limite': 1000,
        },
      });
      await t.pumpWidget(_app(s.api, const TelaCampanhaDetalhe(id: 'c1')));
      await _assentar(t);

      expect(
        find.textContaining(
          'Aguardando o limite da Meta: sua conta já falou com 1.000 pessoas diferentes',
        ),
        findsOneWidget,
      );
      expect(
        find.textContaining('A campanha continua sozinha a partir de'),
        findsOneWidget,
      );
      expect(find.text('Ver o limite do número'), findsOneWidget);
      expect(find.text('Atualizando sozinha'), findsOneWidget);
    });

    testWidgets('a Meta pediu calma: explica que ninguém perde a mensagem', (
      t,
    ) async {
      _telaAlta(t);
      final s = _Servidor({
        ..._campanha('agendada'),
        'espera': {'motivo': 'ritmo', 'ate': null, 'limite': null},
      });
      await t.pumpWidget(_app(s.api, const TelaCampanhaDetalhe(id: 'c1')));
      await _assentar(t);

      expect(
        find.textContaining('A Meta pediu para desacelerar'),
        findsOneWidget,
      );
      expect(
        find.textContaining('começam a sair na próxima abertura'),
        findsNothing,
        reason: 'esperando não é "aguardando a janela"',
      );
    });

    testWidgets('lidas com quem respondeu, descanso e o público no cabeçalho', (
      t,
    ) async {
      _telaAlta(t);
      final s = _Servidor(
        {
          ..._campanha(
            'concluida',
            porStatus: {'lida': 30, 'entregue': 50, 'descanso': 20},
          ),
          'total': 100,
          'modeloCategoria': 'marketing',
          'modeloIdioma': 'pt_BR',
          'listaNome': null,
          'publicoOrigem': 'publico',
          'publicoRotulo': 'Pedem à noite',
          'respondidas': 5,
          'descansoDias': 3,
        },
        destinatarios: [
          {
            'id': 'd1',
            'telefone': '5521977776666',
            'status': 'descanso',
            'erroDetalhe':
                'Recebeu "Sexta do Smash" em 27/09. Descanso de 3 dias.',
          },
          {'id': 'd2', 'telefone': '5521966665555', 'status': 'lida'},
        ],
      );
      await t.pumpWidget(_app(s.api, const TelaCampanhaDetalhe(id: 'c1')));
      await _assentar(t);

      expect(find.text('promo_sexta (Marketing) · pt_BR'), findsOneWidget);
      expect(find.text('Público Pedem à noite'), findsOneWidget);
      expect(find.textContaining('5 responderam'), findsOneWidget);
      expect(
        find.textContaining(
          'Descanso de 3 dias: quem recebeu outra campanha de marketing nesse prazo fica de fora, sem contar no plano — 20 pessoas ficaram de fora até agora.',
        ),
        findsOneWidget,
      );
      expect(find.text('Em descanso'), findsOneWidget);
      expect(
        find.textContaining('Recebeu "Sexta do Smash" em 27/09'),
        findsOneWidget,
      );
      expect(find.text('A pessoa abriu.'), findsOneWidget);
      // O funil conta o descanso na legenda, sem virar falha.
      expect(find.text('20 em descanso'), findsOneWidget);
    });
  });

  group('editar', () {
    testWidgets('desligar a janela manda os campos vazios, e não "nada"', (
      t,
    ) async {
      _telaAlta(t);
      final comJanela = {
        ..._campanha('pausada', pausaMotivo: 'manual'),
        'janelaDias': [1, 2, 3],
        'janelaInicio': '09:00:00',
        'janelaFim': '18:00:00',
        'maxPorDia': 500,
      };
      final s = _Servidor(comJanela);
      await t.pumpWidget(
        _app(
          s.api,
          TelaFormularioCampanha(campanha: ResumoCampanha.deJson(comJanela)),
        ),
      );
      await _assentar(t);

      await t.tap(find.byType(Switch));
      await _assentar(t);
      await t.tap(find.text('Salvar alterações'));
      await _assentar(t);

      expect(s.pedidos, contains('PATCH /campanhas/c1'));
      expect(s.ultimoCorpo?['janelaDias'], isEmpty);
      expect(s.ultimoCorpo?.containsKey('janelaInicio'), isTrue);
      expect(s.ultimoCorpo?['janelaInicio'], isNull);
      expect(s.ultimoCorpo?['maxPorDia'], isNull);
    });

    testWidgets('limites fora de ordem não saem do celular', (t) async {
      _telaAlta(t);
      final s = _Servidor(_campanha('pausada', pausaMotivo: 'manual'));
      await t.pumpWidget(
        _app(
          s.api,
          TelaFormularioCampanha(
            campanha: ResumoCampanha.deJson(_campanha('pausada')),
          ),
        ),
      );
      await _assentar(t);

      await t.tap(find.byType(Switch));
      await _assentar(t);
      await t.enterText(find.widgetWithText(TextField, 'Máx. por dia'), '100');
      await t.enterText(
        find.widgetWithText(TextField, 'Máx. por semana'),
        '10',
      );
      await t.tap(find.text('Salvar alterações'));
      await _assentar(t);

      // Embaixo da janela (como no site) e no topo, ao tentar salvar.
      expect(find.textContaining('precisam ser crescentes'), findsWidgets);
      expect(s.pedidos, isNot(contains('PATCH /campanhas/c1')));
    });
  });
}
