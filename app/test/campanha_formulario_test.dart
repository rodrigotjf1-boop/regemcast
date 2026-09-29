import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:regemcast/api/cliente_api.dart';
import 'package:regemcast/api/dados.dart';
import 'package:regemcast/sessao/sessao.dart';
import 'package:regemcast/telas/campanha_formulario.dart';
import 'package:regemcast/tema/tema.dart';

http.Response _json(Object corpo, [int status = 200]) => http.Response.bytes(
  utf8.encode(jsonEncode(corpo)),
  status,
  headers: {'content-type': 'application/json; charset=utf-8'},
);

Map<String, dynamic> _modelo(
  String id,
  String nome,
  String categoria,
  int variaveis, {
  String status = 'aprovado',
}) => {
  'id': id,
  'nome': nome,
  'idioma': 'pt_BR',
  'categoria': categoria,
  'status': status,
  'corpo': variaveis == 0
      ? 'Seu pedido saiu para entrega.'
      : 'Oi {{1}}, hoje o smash duplo sai com fritas grátis.',
  'variaveis': variaveis,
  'botoes': <String>[],
};

/// Um servidor falso para o formulário: modelos, listas (com blocos), a base
/// e a prévia — e anota o que recebeu.
class _Servidor {
  _Servidor({this.modelos, this.totalDaPrevia = 4700});

  List<Map<String, dynamic>>? modelos;
  int totalDaPrevia;
  final pedidos = <String>[];
  final corpos = <String, Map<String, dynamic>>{};
  final previas = <Map<String, dynamic>>[];

  ClienteApi get api => ClienteApi(
    base: 'https://api.teste',
    http: MockClient((req) async {
      final chave = '${req.method} ${req.url.path}';
      pedidos.add(chave);
      final corpo = req.body.isEmpty
          ? null
          : jsonDecode(req.body) as Map<String, dynamic>;
      if (corpo != null) corpos[chave] = corpo;
      switch (chave) {
        case 'GET /whatsapp/modelos':
          return _json(
            modelos ??
                [
                  _modelo('t1', 'promo_sexta', 'marketing', 1),
                  _modelo('t2', 'aviso_pedido', 'utilidade', 0),
                  _modelo(
                    't3',
                    'em_analise',
                    'marketing',
                    0,
                    status: 'em análise',
                  ),
                ],
          );
        case 'GET /contatos/listas':
          return _json([
            {'id': 'l1', 'nome': 'Clientes 2026', 'total': 4820},
            for (var b = 1; b <= 3; b++)
              {
                'id': 'b$b',
                'nome': 'Base de setembro — bloco $b',
                'total': 250,
                'divisaoId': 'd1',
                'divisaoNome': 'Base de setembro',
                'bloco': b,
                'blocos': 3,
                'usadaEm': b == 1 ? '2026-09-21T15:00:00Z' : null,
              },
          ]);
        case 'GET /contatos':
          return _json({
            'total': 0,
            'pagina': 1,
            'porPagina': 1,
            'itens': <Object>[],
            'cashbackLido': true,
          });
        case 'GET /contatos/segmentos':
          return _json({
            'segmentos': [
              {'id': 'campeoes', 'nome': 'Campeões', 'regra': '', 'total': 120},
              {'id': 'perdidos', 'nome': 'Perdidos', 'regra': '', 'total': 0},
            ],
          });
        case 'POST /campanhas/previa':
          previas.add(corpo!);
          final cashback = corpo['soComCashback'] == true;
          return _json({
            'total': cashback ? 310 : totalDaPrevia,
            'descanso': {'dias': 3, 'emDescanso': 120},
            'horario': {
              'total': totalDaPrevia,
              'comHabito': 900,
              'minimo': 20,
              'periodos': [
                {'periodo': 'noite', 'total': 540},
                {'periodo': 'almoco', 'total': 200},
              ],
              'sugestao': {
                'periodo': 'noite',
                'percentual': 60,
                'inicio': '17:00',
                'fim': '19:00',
              },
            },
            'cashback': cashback ? {'doPublico': totalDaPrevia} : null,
          }, 201);
        case 'POST /campanhas':
          return _json({'id': 'nova1'}, 201);
        case 'GET /campanhas/nova1':
          return _json({
            'id': 'nova1',
            'nome': corpos['POST /campanhas']?['nome'] ?? 'x',
            'modeloNome': 'promo_sexta',
            'status': 'rascunho',
            'criadoEm': '2026-09-29T12:00:00Z',
            'porStatus': {'pendente': 4700},
            'total': 4700,
          });
        case 'GET /campanhas/nova1/destinatarios':
          return _json(<Object>[]);
      }
      if (req.method == 'PATCH') {
        return _json({'id': 'r1', 'status': 'rascunho'});
      }
      return _json({});
    }),
  );
}

/// A sessão já aberta: a tela real só abre com ela ativa, e o cofre do
/// Android não existe no teste.
class _SessaoFixa extends ControleSessao {
  _SessaoFixa(this.papel);
  final String papel;

  @override
  EstadoSessao build() => SessaoAtiva(
    Sessao.deJson({
      'usuario': {'id': 'u', 'nome': 'Rodrigo', 'email': 'r@x', 'papel': papel},
      'conta': {'id': 'c', 'nome': 'MISTER BURGERS', 'status': 'ativa'},
    }),
  );
}

Widget _app(ClienteApi api, Widget tela, {String papel = 'dono'}) =>
    ProviderScope(
      overrides: [
        clienteApiProvider.overrideWithValue(api),
        sessaoProvider.overrideWith(() => _SessaoFixa(papel)),
      ],
      child: MaterialApp(
        theme: temaDoApp(Brightness.light),
        home: MediaQuery(
          data: const MediaQueryData(disableAnimations: true),
          child: tela,
        ),
      ),
    );

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

final _lista = find.byType(Scrollable).first;

Future<void> _ver(WidgetTester t, Finder alvo) async {
  if (alvo.evaluate().isEmpty) {
    await t.scrollUntilVisible(alvo, 200, scrollable: _lista);
  }
  await t.ensureVisible(alvo);
  await _assentar(t);
}

/// Rola até o campo e digita — como a pessoa faria.
Future<void> _escrever(WidgetTester t, String chave, String texto) async {
  await _ver(t, find.byKey(ValueKey(chave)));
  await t.enterText(find.byKey(ValueKey(chave)), texto);
  await _assentar(t);
}

/// Abre um campo de escolha e toca na opção.
Future<void> _escolher(WidgetTester t, String campo, String opcao) async {
  await _ver(t, find.byKey(ValueKey(campo)));
  await t.tap(find.byKey(ValueKey(campo)));
  await _assentar(t);
  await t.tap(find.text(opcao).last);
  await _assentar(t);
}

Future<void> _tocar(WidgetTester t, Finder alvo) async {
  await _ver(t, alvo);
  await t.tap(alvo);
  await _assentar(t);
}

Future<void> _abrirNovo(
  WidgetTester t,
  _Servidor s, {
  String papel = 'dono',
}) async {
  _telaAlta(t);
  await t.pumpWidget(_app(s.api, const TelaFormularioCampanha(), papel: papel));
  await _assentar(t);
}

Future<void> _montar(WidgetTester t) async {
  await t.tap(find.byKey(const ValueKey('c-salvar')));
  await _assentar(t);
}

void main() {
  setUpAll(() => initializeDateFormatting('pt_BR'));

  testWidgets(
    'monta com lista: só modelo aprovado, variável do nome, e abre a campanha montada',
    (t) async {
      final s = _Servidor();
      await _abrirNovo(t, s);
      await _escrever(t, 'c-nome', 'Sexta do Smash');

      await t.tap(find.byKey(const ValueKey('c-modelo')));
      await _assentar(t);
      expect(find.text('em_analise — Marketing'), findsNothing);
      await t.tap(find.text('promo_sexta — Marketing').last);
      await _assentar(t);
      expect(
        find.textContaining('Entra no descanso entre campanhas'),
        findsOneWidget,
      );

      await _tocar(t, find.byKey(const ValueKey('c-origem-t1-0')));
      await t.tap(find.text('Primeiro nome do contato').last);
      await _assentar(t);
      await _escrever(t, 'c-var-t1-0', 'cliente');

      await _escolher(t, 'c-lista', 'Clientes 2026 · 4.820 contatos');
      expect(find.textContaining('4.700 pessoas vão receber'), findsOneWidget);
      expect(s.previas.last, {'origem': 'lista', 'origemId': 'l1'});

      await _montar(t);
      final corpo = s.corpos['POST /campanhas']!;
      expect(corpo['nome'], 'Sexta do Smash');
      expect(corpo['modeloNome'], 'promo_sexta');
      expect(corpo['modeloId'], 't1');
      expect(corpo['modeloCategoria'], 'marketing');
      expect(corpo['listaId'], 'l1');
      expect(corpo['variaveisLista'], [
        {'origem': 'primeiro_nome', 'valor': 'cliente'},
      ]);
      expect(corpo.containsKey('destinatarios'), isFalse);
      expect(corpo.containsKey('ignorarDescanso'), isFalse);
      expect(corpo.containsKey('janelaDias'), isFalse, reason: 'sem janela');
      // Montar leva para a campanha, onde se confere e se dispara.
      expect(s.pedidos, contains('GET /campanhas/nova1'));
      expect(find.text('Disparar agora'), findsOneWidget);
    },
  );

  testWidgets('descanso: o dono pode incluir quem está em descanso', (t) async {
    final s = _Servidor();
    await _abrirNovo(t, s);
    await _escolher(t, 'c-modelo', 'aviso_pedido — Utilidade');
    await _escolher(t, 'c-lista', 'Clientes 2026 · 4.820 contatos');
    expect(
      find.textContaining('ficam de fora — é o descanso'),
      findsNothing,
      reason: 'utilidade não entra no descanso',
    );

    await _escolher(t, 'c-modelo', 'promo_sexta — Marketing');
    await _escrever(t, 'c-var-t1-0', 'amigo');
    expect(
      find.textContaining('120 pessoas deste público receberam'),
      findsOneWidget,
    );
    await _tocar(t, find.byKey(const ValueKey('c-ignorar-descanso')));
    await _montar(t);
    expect(s.corpos['POST /campanhas']!['ignorarDescanso'], isTrue);
  });

  testWidgets(
    'descanso: o operador vê quem fica de fora, mas não a opção de incluir',
    (t) async {
      final s = _Servidor();
      await _abrirNovo(t, s, papel: 'operador');
      await _escolher(t, 'c-modelo', 'promo_sexta — Marketing');
      await _escolher(t, 'c-lista', 'Clientes 2026 · 4.820 contatos');
      expect(
        find.textContaining('120 pessoas deste público receberam'),
        findsOneWidget,
      );
      expect(find.byKey(const ValueKey('c-ignorar-descanso')), findsNothing);
    },
  );

  testWidgets('a sugestão de horário preenche a janela de envio', (t) async {
    final s = _Servidor();
    await _abrirNovo(t, s);
    await _escolher(t, 'c-modelo', 'aviso_pedido — Utilidade');
    await _escolher(t, 'c-lista', 'Clientes 2026 · 4.820 contatos');
    expect(find.textContaining('60% de quem já comprou'), findsOneWidget);

    await _tocar(t, find.byKey(const ValueKey('c-usar-horario')));
    expect(
      find.text('Horário aplicado na janela de envio abaixo.'),
      findsOneWidget,
    );
    await _montar(t);
    final corpo = s.corpos['POST /campanhas']!;
    expect(corpo['janelaInicio'], '17:00');
    expect(corpo['janelaFim'], '19:00');
    expect(corpo['janelaDias'], isEmpty);
  });

  testWidgets('da base por perfil: só aparece perfil com gente', (t) async {
    final s = _Servidor();
    await _abrirNovo(t, s);
    await _escolher(t, 'c-modelo', 'aviso_pedido — Utilidade');
    await _tocar(t, find.byKey(const ValueKey('quem-base')));
    await _escolher(t, 'c-de-onde', 'Um perfil (Campeões, Em risco…)');

    await _tocar(t, find.byKey(const ValueKey('c-qual')));
    expect(find.text('Perdidos · 0 contatos'), findsNothing);
    await t.tap(find.text('Campeões · 120 contatos').last);
    await _assentar(t);
    expect(
      find.textContaining('O público é copiado ao montar'),
      findsOneWidget,
    );

    await _montar(t);
    expect(s.corpos['POST /campanhas']!['daBase'], {
      'origem': 'perfil',
      'segmento': 'campeoes',
    });
    expect(s.corpos['POST /campanhas']!.containsKey('listaId'), isFalse);
  });

  testWidgets(
    'números digitados: conta, cobra o valor da variável e manda cada um',
    (t) async {
      final s = _Servidor();
      await _abrirNovo(t, s);
      await _escolher(t, 'c-modelo', 'promo_sexta — Marketing');
      await _tocar(t, find.byKey(const ValueKey('quem-numeros')));
      expect(find.byKey(const ValueKey('c-origem-t1-0')), findsNothing);

      await _escrever(t, 'c-numeros', '5521999998888, 5511988887777');
      await _assentar(t);
      expect(
        find.textContaining('Reconhecidos até agora: 2 de 500.'),
        findsOneWidget,
      );

      await _montar(t);
      expect(find.text('Preencha o valor de {{1}}.'), findsOneWidget);
      expect(s.pedidos, isNot(contains('POST /campanhas')));

      await _escrever(t, 'c-var-t1-0', 'amigo');
      await _montar(t);
      expect(s.corpos['POST /campanhas']!['destinatarios'], [
        {
          'telefone': '5521999998888',
          'variaveis': ['amigo'],
        },
        {
          'telefone': '5511988887777',
          'variaveis': ['amigo'],
        },
      ]);
    },
  );

  testWidgets('blocos: avisa o bloco já enviado e oferece o próximo', (
    t,
  ) async {
    final s = _Servidor();
    await _abrirNovo(t, s);
    await _escolher(t, 'c-modelo', 'aviso_pedido — Utilidade');
    await _tocar(t, find.byKey(const ValueKey('c-lista')));
    expect(find.text('BLOCOS — BASE DE SETEMBRO'), findsOneWidget);
    await t.tap(
      find.text('Bloco 01 · 250 contatos · já enviado em 21/09/2026').last,
    );
    await _assentar(t);
    expect(
      find.textContaining('mandar de novo repete as mesmas pessoas'),
      findsOneWidget,
    );

    await _tocar(t, find.byKey(const ValueKey('c-proximo-bloco')));
    expect(
      find.text('Bloco 02 · 250 contatos · ainda não usado'),
      findsOneWidget,
    );
    await _montar(t);
    expect(s.corpos['POST /campanhas']!['listaId'], 'b2');
  });

  testWidgets(
    'variável de cashback: a prévia conta só quem tem cashback válido',
    (t) async {
      final s = _Servidor();
      await _abrirNovo(t, s);
      await _escolher(t, 'c-modelo', 'promo_sexta — Marketing');
      await _escolher(t, 'c-lista', 'Clientes 2026 · 4.820 contatos');
      await _tocar(t, find.byKey(const ValueKey('c-origem-t1-0')));
      await t.tap(find.text('Saldo do cashback').last);
      await _assentar(t);

      expect(s.previas.last['soComCashback'], isTrue);
      expect(find.textContaining('310 pessoas vão receber'), findsOneWidget);
      expect(
        find.textContaining('só quem tem cashback válido, de 4.700 no público'),
        findsOneWidget,
      );
      // O saldo sai do contato: não pede texto.
      expect(find.byKey(const ValueKey('c-var-t1-0')), findsNothing);
      await _montar(t);
      expect(s.corpos['POST /campanhas']!['variaveisLista'], [
        {'origem': 'cashback_saldo', 'valor': ''},
      ]);
    },
  );

  testWidgets('público sem ninguém que possa receber não monta', (t) async {
    final s = _Servidor(totalDaPrevia: 0);
    await _abrirNovo(t, s);
    await _escolher(t, 'c-modelo', 'aviso_pedido — Utilidade');
    await _escolher(t, 'c-lista', 'Clientes 2026 · 4.820 contatos');
    await _montar(t);
    expect(
      find.textContaining('Essa lista não tem ninguém que possa receber'),
      findsOneWidget,
    );
    expect(s.pedidos, isNot(contains('POST /campanhas')));
  });

  testWidgets('sem modelo aprovado: explica e oferece criar um', (t) async {
    final s = _Servidor(
      modelos: [
        _modelo('t3', 'em_analise', 'marketing', 0, status: 'em análise'),
      ],
    );
    await _abrirNovo(t, s);
    expect(find.text('Nenhum modelo aprovado'), findsOneWidget);
    expect(find.text('Criar um modelo'), findsOneWidget);
  });

  testWidgets(
    'rascunho em edição: troca o conteúdo e manda a janela explícita',
    (t) async {
      final s = _Servidor();
      _telaAlta(t);
      final rascunho = ResumoCampanha.deJson({
        'id': 'r1',
        'nome': 'Rascunho de sexta',
        'modeloNome': 'aviso_pedido',
        'modeloId': 't2',
        'status': 'rascunho',
        'porStatus': {'pendente': 10},
        'total': 10,
      });
      await t.pumpWidget(
        _app(s.api, TelaFormularioCampanha(campanha: rascunho)),
      );
      await _assentar(t);
      expect(find.text('Editar campanha'), findsOneWidget);
      expect(find.text('aviso_pedido — Utilidade'), findsOneWidget);

      await _escolher(t, 'c-lista', 'Clientes 2026 · 4.820 contatos');
      await t.tap(find.text('Salvar alterações'));
      await _assentar(t);
      final corpo = s.corpos['PATCH /campanhas/r1']!;
      expect(corpo['listaId'], 'l1');
      expect(corpo['modeloId'], 't2');
      expect(corpo['janelaDias'], isEmpty);
      expect(corpo.containsKey('janelaInicio'), isTrue);
      expect(corpo['janelaInicio'], isNull);
    },
  );
}
