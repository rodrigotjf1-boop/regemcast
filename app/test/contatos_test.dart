import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:regemcast/api/cliente_api.dart';
import 'package:regemcast/api/contatos.dart';
import 'package:regemcast/api/dados.dart';
import 'package:regemcast/sessao/sessao.dart';
import 'package:regemcast/telas/bloqueios.dart';
import 'package:regemcast/telas/campanha_formulario.dart';
import 'package:regemcast/telas/contatos.dart';
import 'package:regemcast/telas/importar_contatos.dart';
import 'package:regemcast/tema/tema.dart';

http.Response _json(Object corpo, [int status = 200]) => http.Response.bytes(
  utf8.encode(jsonEncode(corpo)),
  status,
  headers: {'content-type': 'application/json; charset=utf-8'},
);

String _iso(Duration atras) =>
    DateTime.now().toUtc().subtract(atras).toIso8601String();

final _ano = DateTime.now().year;

Map<String, dynamic> _contato(
  String id,
  String? nome,
  String telefone, [
  Map<String, dynamic> extra = const {},
]) => {
  'id': id,
  'nome': nome,
  'telefone': telefone,
  'optOut': false,
  'consentimentoOrigem': 'declarado',
  'criadoEm': '2026-09-01T12:00:00Z',
  ...extra,
};

Map<String, dynamic> _pagina(List<Map<String, dynamic>> itens, [int? total]) =>
    {
      'total': total ?? itens.length,
      'pagina': 1,
      'porPagina': 50,
      'itens': itens,
    };

/// Um servidor falso para a base de contatos: anota cada pedido (com a
/// consulta) e o corpo de cada escrita.
class _Servidor {
  final pedidos = <String>[];
  final corpos = <String, Object?>{};

  /// Segura a resposta de um pedido até o teste soltar.
  Future<void>? Function(Uri url)? segurar;

  /// A prévia da importação por texto.
  Map<String, dynamic> previa = {
    'formato': 'texto',
    'totalLidos': 1,
    'validos': 1,
    'invalidos': 0,
    'novos': 0,
    'jaExistem': 1,
    'assumiramPais': 0,
    'limite': 50000,
    'porEnvio': 5000,
    'truncado': false,
    'extras': ['e-mail', 'pedidos'],
    'contatos': [
      {
        'nome': 'Ana',
        'telefone': '5521991112222',
        'novo': false,
        'assumiuPais': false,
        'email': 'ana@exemplo.com',
        'pedidos': 12,
      },
    ],
  };

  ClienteApi get api => ClienteApi(
    base: 'https://api.teste',
    http: MockClient((req) async {
      final consulta = req.url.hasQuery ? '?${req.url.query}' : '';
      final chave = '${req.method} ${req.url.path}';
      pedidos.add('$chave$consulta');
      if (req.body.isNotEmpty) corpos[chave] = jsonDecode(req.body);
      final espera = segurar?.call(req.url);
      if (espera != null) await espera;
      return _responder(req, chave);
    }),
  );

  http.Response _responder(http.Request req, String chave) {
    final q = req.url.queryParameters;
    switch (chave) {
      case 'GET /contatos':
        if (q['situacao'] == 'bloqueados') {
          return _json(
            _pagina([
              _contato('x1', 'Paula Reis', '5521955554444', {
                'optOut': true,
                'optOutEm': '2026-09-20T15:00:00Z',
                'optOutOrigem': 'botao_modelo',
              }),
            ]),
          );
        }
        if (q['situacao'] == 'sem_whatsapp') {
          return _json(
            _pagina([
              _contato('w1', null, '5521944443333', {
                'semWhatsappEm': '2026-09-18T15:00:00Z',
              }),
            ]),
          );
        }
        if (q['segmento'] == 'campeoes') {
          return _json(
            _pagina([
              _contato('k1', 'Ana Beatriz Souza', '5521991112222', {
                'segmento': 'campeoes',
              }),
            ], 412),
          );
        }
        if (q['uf'] == 'RJ') {
          return _json(
            _pagina([_contato('k2', 'Carlos Menezes', '5521983334444')], 5200),
          );
        }
        if (q['publico'] == 'bairro') {
          return _json(
            _pagina([_contato('k5', 'João Pedro', '5521959990000')], 540),
          );
        }
        return _json(
          _pagina([
            _contato('k1', 'Ana Beatriz Souza', '5521991112222', {
              'email': 'ana@exemplo.com',
              'pedidos': 12,
              'totalGastoCentavos': 45890,
              'ultimoPedidoEm': _iso(const Duration(days: 9, hours: 2)),
              'periodoPreferido': 'noite',
              'produtoFavorito': 'Smash duplo',
              'segmento': 'campeoes',
              'cashbackCentavos': 1200,
              'cashbackVenceEm': '$_ano-12-20',
              'cashbackValido': true,
            }),
            _contato('k2', 'Carlos Menezes', '5521983334444', {
              'consentimentoOrigem': 'conversa',
              'cashbackCentavos': 800,
              'cashbackVenceEm': '$_ano-01-05',
              'cashbackValido': false,
            }),
            _contato('k3', null, '5511975556666', {
              'semWhatsappEm': '2026-09-18T15:00:00Z',
            }),
            _contato('k4', 'Fernanda Lima', '5521967778888', {
              'optOut': true,
              'segmento': 'campeoes',
            }),
          ], 6484),
        );
      case 'GET /contatos/segmentos':
      case 'PUT /contatos/segmentos/parametros':
        return _json({
          'parametros': {
            'recenteDias': 20,
            'ativoDias': 60,
            'riscoDias': 120,
            'fielPedidos': 4,
          },
          'segmentos': [
            {
              'id': 'campeoes',
              'nome': 'Campeões',
              'regra': 'Compraram nos últimos 20 dias e têm 4 pedidos ou mais.',
              'total': 412,
              'gastoCentavos': 1240000,
              'ticketMedioCentavos': 4800,
            },
            {
              'id': 'em_risco',
              'nome': 'Em risco',
              'regra': 'A última compra foi há mais de 60 dias.',
              'total': 690,
            },
          ],
        });
      case 'POST /contatos/segmentos/campeoes/lista':
        return _json({'id': 'l9', 'nome': 'Campeões — 29/09', 'total': 412});
      case 'GET /contatos/publicos':
        return _json({
          'comValor': 3000,
          'comCompras': 3100,
          'publicos': [
            {
              'id': 'vip',
              'nome': 'VIP',
              'regra': 'Gastaram R\$\u00a0500 ou mais.',
              'total': 240,
              'gastoCentavos': 980000,
            },
            {
              'id': 'ticket_baixo',
              'nome': 'Ticket baixo',
              'regra': '',
              'total': 0,
              'gastoCentavos': 0,
            },
            {
              'id': 'conversaram_7d',
              'nome': 'Conversaram na última semana',
              'regra': '',
              'total': 30,
              'gastoCentavos': 0,
            },
            {
              'id': 'entrega',
              'nome': 'Pedem entrega',
              'regra': '',
              'total': 0,
              'gastoCentavos': 0,
            },
          ],
          'bairros': [
            {'bairro': 'Centro', 'total': 820},
            {'bairro': 'Tijuca', 'total': 540},
          ],
          'aniversarios': [
            {'mes': 9, 'total': 374},
            {'mes': 10, 'total': 0},
          ],
          'mesAtual': 9,
          'conversasLigadas': false,
        });
      case 'GET /contatos/publicos/produtos':
        final busca = q['busca'] ?? '';
        return _json({
          'produtos': busca == 'xyz'
              ? <Object>[]
              : [
                  if (busca.isEmpty || 'smash duplo'.contains(busca))
                    {'nome': 'Smash duplo', 'total': 1620},
                  if (busca.isEmpty)
                    {'nome': 'Batata com cheddar', 'total': 980},
                ],
        });
      case 'POST /contatos/publicos/lista':
        return _json({
          'id': 'l8',
          'nome': 'Bairro Tijuca — 29/09',
          'total': 540,
        });
      case 'GET /contatos/regioes':
        return _json({
          'regioes': [
            {
              'uf': 'RJ',
              'estado': 'Rio de Janeiro',
              'total': 5200,
              'ddds': [
                {'ddd': '21', 'cidade': 'Rio de Janeiro', 'total': 5000},
                {'ddd': '24', 'cidade': 'Volta Redonda', 'total': 200},
              ],
            },
            {
              'uf': 'SP',
              'estado': 'São Paulo',
              'total': 900,
              'ddds': [
                {'ddd': '11', 'cidade': 'São Paulo', 'total': 900},
              ],
            },
          ],
          'semRegiao': 12,
        });
      case 'GET /contatos/divisoes':
        return _json([
          {
            'id': 'd1',
            'nome': 'Base Anota Aí (ativos)',
            'tamanho': 250,
            'ordem': 'importacao',
            'soNuncaReceberam': true,
            'totalContatos': 750,
            'totalBlocos': 3,
            'blocos': [
              {
                'id': 'b1',
                'bloco': 1,
                'total': 250,
                'usos': [
                  {
                    'campanhaId': 'c1',
                    'campanhaNome': 'Sexta do Smash',
                    'em': '2026-09-21T15:00:00Z',
                    'total': 250,
                    'entregues': 245,
                    'lidas': 152,
                    'falhas': 5,
                    'sairam': 6,
                  },
                ],
              },
              {'id': 'b2', 'bloco': 2, 'total': 250, 'usos': <Object>[]},
              {'id': 'b3', 'bloco': 3, 'total': 250, 'usos': <Object>[]},
            ],
          },
          {
            'id': 'd2',
            'nome': 'Rio de Janeiro — 28/09',
            'tamanho': 500,
            'ordem': 'sorteio',
            'soNuncaReceberam': false,
            'totalContatos': 900,
            'totalBlocos': 2,
            'blocos': [
              {'id': 'b4', 'bloco': 1, 'total': 500, 'usos': <Object>[]},
              {'id': 'b5', 'bloco': 2, 'total': 400, 'usos': <Object>[]},
            ],
          },
        ]);
      case 'GET /contatos/divisoes/opcoes':
        return _json({
          'limite': 1000,
          'limiteConhecido': true,
          'maximo': 1000,
          'tamanhos': [
            {'valor': 250, 'disponivel': true},
            {'valor': 500, 'disponivel': true},
            {'valor': 1000, 'disponivel': true},
            {'valor': 2000, 'disponivel': false},
          ],
          'sugerido': 250,
        });
      case 'POST /contatos/divisoes':
        return _json({
          'id': 'd9',
          'nome': 'Nova divisão',
          'tamanho': 250,
          'ordem': 'importacao',
          'soNuncaReceberam': false,
          'totalContatos': 1539,
          'totalBlocos': 7,
          'blocos': <Object>[],
        }, 201);
      case 'GET /contatos/listas':
        return _json([
          {
            'id': 'l1',
            'nome': 'Clientes 2026',
            'total': 4820,
            'criadoEm': '2026-09-02T12:00:00Z',
          },
          {
            'id': 'b1',
            'nome': 'Base Anota Aí — bloco 1',
            'total': 250,
            'divisaoId': 'd1',
            'bloco': 1,
            'blocos': 3,
          },
        ]);
      case 'GET /whatsapp/modelos':
        return _json(<Object>[]);
      case 'POST /contatos/importacao/texto':
        return _json(previa, 201);
      case 'POST /contatos/importacao':
        return _json({
          'importacaoId': '5e1d0b8e-4a8c-4d7e-9a50-1c2b3d4e5f60',
          'gravados': 0,
          'jaExistiam': 1,
        }, 201);
    }
    return _json({});
  }

  bool pediu(String pedido) => pedidos.contains(pedido);
}

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

Future<void> _ver(WidgetTester t, Finder alvo) async {
  if (alvo.evaluate().isEmpty) {
    await t.scrollUntilVisible(
      alvo,
      200,
      scrollable: find.byType(Scrollable).first,
    );
  }
  await t.ensureVisible(alvo.first);
  await _assentar(t);
}

Future<void> _tocar(WidgetTester t, Finder alvo) async {
  await _ver(t, alvo);
  await t.tap(alvo.first);
  await _assentar(t);
}

Future<void> _abrirContatos(
  WidgetTester t,
  _Servidor s, {
  String papel = 'dono',
}) async {
  _telaAlta(t);
  await t.pumpWidget(
    _app(s.api, const Scaffold(body: TelaContatos()), papel: papel),
  );
  await _assentar(t);
}

Future<void> _vista(WidgetTester t, String nome) =>
    _tocar(t, find.byKey(ValueKey('vista-$nome')));

String _textoDe(WidgetTester t, Finder alvo) {
  final w = t.widget(alvo);
  return w is Text ? (w.data ?? w.textSpan!.toPlainText()) : '';
}

void main() {
  setUpAll(() => initializeDateFormatting('pt_BR'));

  testWidgets(
    'lista: compras, última compra, costuma pedir, cashback, perfil e autorização',
    (t) async {
      final s = _Servidor();
      await _abrirContatos(t, s);

      expect(find.text('6.484 contatos na base'), findsOneWidget);
      expect(find.text('Ana Beatriz Souza'), findsOneWidget);
      expect(find.text('ana@exemplo.com'), findsOneWidget);
      expect(find.text('+55 21 99111-2222'), findsOneWidget);
      // O perfil sai com o nome que o servidor dá; quem saiu não mostra perfil.
      expect(find.text('Campeões'), findsOneWidget);
      expect(find.text('12 pedidos · R\$\u00a0458,90'), findsOneWidget);
      expect(find.textContaining('Última compra há 9 dias · '), findsOneWidget);
      expect(find.text('Costuma pedir Smash duplo · à noite'), findsOneWidget);
      expect(
        find.text('Cashback R\$\u00a012,00 · vence 20/12'),
        findsOneWidget,
      );
      // Vencido: riscado e "venceu".
      expect(
        find.text('Cashback R\$\u00a08,00 · venceu 05/01'),
        findsOneWidget,
      );
      expect(find.text('Declarado na importação'), findsOneWidget);
      expect(find.text('Conversa iniciada pela pessoa'), findsOneWidget);
      expect(find.text('Sem nome'), findsOneWidget);
      expect(find.text('Sem WhatsApp'), findsOneWidget);
      expect(find.text('Pediu para sair'), findsOneWidget);
      // Quem saiu não tem o menu de descadastrar.
      expect(find.byKey(const ValueKey('acoes-k4')), findsNothing);
      expect(find.byKey(const ValueKey('acoes-k1')), findsOneWidget);
      // "Dividir em blocos" divide quem pode receber (pelas regiões).
      expect(find.byKey(const ValueKey('dividir-base')), findsOneWidget);
    },
  );

  testWidgets('descadastrar confirma e marca a pessoa na hora', (t) async {
    final s = _Servidor();
    await _abrirContatos(t, s);

    await _tocar(t, find.byKey(const ValueKey('acoes-k2')));
    await _tocar(t, find.text('Descadastrar').last);
    expect(find.text('Descadastrar este número?'), findsOneWidget);
    await _tocar(t, find.widgetWithText(FilledButton, 'Descadastrar'));

    expect(s.pediu('DELETE /contatos/k2'), isTrue);
    expect(find.text('Pediu para sair'), findsNWidgets(2));
    expect(find.byKey(const ValueKey('acoes-k2')), findsNothing);
  });

  testWidgets('perfil: filtra a lista, cria a lista do perfil e volta a todos', (
    t,
  ) async {
    final s = _Servidor();
    await _abrirContatos(t, s);

    await _vista(t, 'publicos');
    expect(
      find.text('R\$\u00a012.400,00 no total · ticket R\$\u00a048,00'),
      findsOneWidget,
    );
    await _tocar(t, find.byKey(const ValueKey('perfil-campeoes')));

    // Foi para a lista, filtrada.
    expect(
      s.pediu('GET /contatos?pagina=1&porPagina=50&segmento=campeoes'),
      isTrue,
    );
    expect(find.text('412 contatos neste filtro'), findsOneWidget);
    expect(
      _textoDe(t, find.textContaining('Mostrando')),
      'Mostrando Campeões: 412 contatos.',
    );

    await _tocar(t, find.byKey(const ValueKey('criar-lista')));
    expect(s.pediu('POST /contatos/segmentos/campeoes/lista'), isTrue);
    expect(
      find.text(
        'Lista "Campeões — 29/09" criada com 412 contatos. Escolha essa lista ao montar a campanha.',
      ),
      findsOneWidget,
    );

    await _tocar(t, find.byKey(const ValueKey('ver-todos')));
    expect(find.text('6.484 contatos na base'), findsOneWidget);
    expect(find.textContaining('Mostrando'), findsNothing);
  });

  testWidgets(
    'públicos: grupo vazio some, "conversaram" só com conversas ligadas, e o bairro vai com o valor',
    (t) async {
      final s = _Servidor();
      await _abrirContatos(t, s);
      await _vista(t, 'publicos');

      expect(find.text('R\$\u00a09.800,00 em compras'), findsOneWidget);
      // "Como compram" só tem zeros: o grupo inteiro some.
      expect(find.text('COMO COMPRAM'), findsNothing);
      expect(find.text('Pedem entrega'), findsNothing);
      // Sem as conversas ligadas, o zero diria "ninguém conversou".
      expect(find.text('Conversaram na última semana'), findsNothing);
      // O mês de hoje vem marcado; o mês sem ninguém some.
      expect(find.text('Setembro (este mês)'), findsOneWidget);
      expect(find.text('Outubro'), findsNothing);

      await _tocar(t, find.byKey(const ValueKey('bairro-Tijuca')));
      expect(
        s.pediu(
          'GET /contatos?pagina=1&porPagina=50&publico=bairro&valor=Tijuca',
        ),
        isTrue,
      );
      await _tocar(t, find.byKey(const ValueKey('criar-lista')));
      expect(s.corpos['POST /contatos/publicos/lista'], {
        'publico': 'bairro',
        'valor': 'Tijuca',
      });
    },
  );

  testWidgets('região: mostra os DDDs, não vira lista e divide em blocos', (
    t,
  ) async {
    final s = _Servidor();
    await _abrirContatos(t, s);
    await _vista(t, 'publicos');

    expect(find.text('Fora do Brasil ou sem DDD  12'), findsOneWidget);
    await _tocar(t, find.byKey(const ValueKey('regiao-RJ')));
    expect(s.pediu('GET /contatos?pagina=1&porPagina=50&uf=RJ'), isTrue);
    expect(
      _textoDe(t, find.textContaining('Mostrando')),
      'Mostrando Rio de Janeiro: 5.200 contatos (21 Rio de Janeiro, 24 Volta Redonda).',
    );
    // Região não tem lista pronta no servidor: só se divide em blocos.
    expect(find.byKey(const ValueKey('criar-lista')), findsNothing);

    await _tocar(t, find.byKey(const ValueKey('dividir-filtro')));
    expect(find.text('5.200 pessoas podem receber'), findsOneWidget);
    await _tocar(t, find.byKey(const ValueKey('b-dividir')));

    expect(s.corpos['POST /contatos/divisoes'], {
      'origem': 'regiao',
      'uf': 'RJ',
      'tamanho': 250,
      'ordem': 'importacao',
    });
    expect(
      find.text(
        '7 blocos criados com 1.539 pessoas. Cada bloco é uma lista: escolha-o ao montar a campanha.',
      ),
      findsOneWidget,
    );
    // Volta mostrando os blocos.
    expect(find.text('Base Anota Aí (ativos)'), findsOneWidget);
  });

  testWidgets(
    'troca de filtro: a página do filtro antigo que chega depois é descartada',
    (t) async {
      final s = _Servidor();
      final solta = Completer<void>();
      s.segurar = (url) =>
          url.queryParameters['segmento'] == 'campeoes' ? solta.future : null;
      await _abrirContatos(t, s);
      await _vista(t, 'publicos');

      // Toca em Campeões (a resposta fica presa) e, antes dela, troca de ideia.
      await _tocar(t, find.byKey(const ValueKey('perfil-campeoes')));
      await _vista(t, 'publicos');
      await _tocar(t, find.byKey(const ValueKey('regiao-RJ')));
      expect(find.text('Carlos Menezes'), findsOneWidget);

      solta.complete();
      await _assentar(t);
      // A página de Campeões chegou atrasada: não entra na lista do Rio.
      expect(find.text('Ana Beatriz Souza'), findsNothing);
      expect(find.text('5.200 contatos neste filtro'), findsOneWidget);
    },
  );

  testWidgets(
    'regras dos perfis: só o dono ajusta; voltar ao padrão e salvar',
    (t) async {
      final s = _Servidor();
      await _abrirContatos(t, s);
      await _vista(t, 'publicos');

      await _tocar(t, find.byKey(const ValueKey('ajustar-regras')));
      // Abre com os números da conta.
      expect(
        t
            .widget<TextField>(find.byKey(const ValueKey('regra-recente')))
            .controller!
            .text,
        '20',
      );
      await t.tap(find.byKey(const ValueKey('regras-padrao')));
      await _assentar(t);
      await t.tap(find.byKey(const ValueKey('salvar-regras')));
      await _assentar(t);

      expect(s.corpos['PUT /contatos/segmentos/parametros'], {
        'recenteDias': 30,
        'ativoDias': 90,
        'riscoDias': 180,
        'fielPedidos': 5,
      });
      expect(find.byKey(const ValueKey('salvar-regras')), findsNothing);
    },
  );

  testWidgets('operador não vê "Ajustar regras" nem apaga blocos', (t) async {
    final s = _Servidor();
    await _abrirContatos(t, s, papel: 'operador');
    await _vista(t, 'publicos');
    expect(find.byKey(const ValueKey('ajustar-regras')), findsNothing);
    await _vista(t, 'blocos');
    expect(find.byKey(const ValueKey('apagar-divisao-d2')), findsNothing);
  });

  testWidgets('produtos: a busca espera a digitação e diz quando não acha', (
    t,
  ) async {
    final s = _Servidor();
    await _abrirContatos(t, s);
    await _vista(t, 'publicos');

    expect(
      find.byKey(const ValueKey('produto-Batata com cheddar')),
      findsOneWidget,
    );
    await _ver(t, find.byKey(const ValueKey('buscar-produto')));
    await t.enterText(find.byKey(const ValueKey('buscar-produto')), 'x');
    await t.enterText(find.byKey(const ValueKey('buscar-produto')), 'xy');
    await t.enterText(find.byKey(const ValueKey('buscar-produto')), 'xyz');
    await t.pump(const Duration(milliseconds: 100));
    // Ainda digitando: nada foi ao servidor.
    expect(s.pedidos.where((p) => p.contains('busca=')), isEmpty);
    await _assentar(t);
    expect(s.pedidos.where((p) => p.contains('busca=')).toList(), [
      'GET /contatos/publicos/produtos?busca=xyz',
    ]);
    expect(
      find.text(
        'Nenhum produto com “xyz” entre as compras de quem pode receber.',
      ),
      findsOneWidget,
    );

    await t.enterText(find.byKey(const ValueKey('buscar-produto')), 'smash');
    await _assentar(t);
    await _tocar(t, find.byKey(const ValueKey('produto-Smash duplo')));
    expect(
      s.pediu(
        'GET /contatos?pagina=1&porPagina=50&publico=produto&valor=Smash+duplo',
      ),
      isTrue,
    );
  });

  testWidgets(
    'blocos: resultado do bloco enviado, próximo marcado e usar em campanha',
    (t) async {
      final s = _Servidor();
      await _abrirContatos(t, s);
      await _vista(t, 'blocos');

      expect(
        find.text('750 pessoas em 3 blocos de 250 · na ordem de importação'),
        findsOneWidget,
      );
      expect(find.text('Só quem nunca recebeu'), findsOneWidget);
      expect(
        _textoDe(t, find.textContaining('Enviado em')),
        'Enviado em 21/09/2026 em Sexta do Smash: 98% entregues · 61% lidas · 5 não chegaram · 6 pediram para sair',
      );
      // O próximo é o primeiro ainda não usado — um por divisão.
      expect(find.text('Próximo'), findsNWidgets(2));
      expect(find.byKey(const ValueKey('usar-b1')), findsNothing);
      // Divisão já usada não se apaga; a que ninguém usou, sim.
      expect(find.byKey(const ValueKey('apagar-divisao-d1')), findsNothing);
      expect(find.byKey(const ValueKey('apagar-divisao-d2')), findsOneWidget);
      // As listas comuns ficam embaixo; os blocos não se repetem nelas.
      expect(find.byKey(const ValueKey('lista-l1')), findsOneWidget);
      expect(find.byKey(const ValueKey('lista-b1')), findsNothing);

      await _tocar(t, find.byKey(const ValueKey('usar-b2')));
      final form = t.widget<TelaFormularioCampanha>(
        find.byType(TelaFormularioCampanha),
      );
      expect(form.listaInicial, 'b2');
    },
  );

  testWidgets('blocos: o dono apaga a divisão que ninguém usou', (t) async {
    final s = _Servidor();
    await _abrirContatos(t, s);
    await _vista(t, 'blocos');

    await _tocar(t, find.byKey(const ValueKey('apagar-divisao-d2')));
    expect(
      find.text(
        'Apagar "Rio de Janeiro — 28/09" e os 2 blocos dela? Os contatos continuam na base.',
      ),
      findsOneWidget,
    );
    await _tocar(t, find.widgetWithText(FilledButton, 'Apagar'));
    expect(s.pediu('DELETE /contatos/divisoes/d2'), isTrue);
    expect(
      find.text('Blocos apagados. Os contatos continuam na base.'),
      findsOneWidget,
    );
  });

  testWidgets(
    'dividir: tamanho acima do limite fica apagado, personalizado fora da faixa não divide, e a prévia mostra o último bloco',
    (t) async {
      final s = _Servidor();
      await _abrirContatos(t, s);
      await _vista(t, 'blocos');
      await _tocar(t, find.byKey(const ValueKey('dividir-lista-l1')));

      final acimaDoLimite = t.widget<ChoiceChip>(
        find.byKey(const ValueKey('b-tamanho-2000')),
      );
      expect(acimaDoLimite.onSelected, isNull);
      expect(
        find.text(
          'Seu número pode falar com 1.000 pessoas diferentes por dia hoje. Tamanhos maiores ficam disponíveis quando a Meta aumentar o limite.',
        ),
        findsOneWidget,
      );
      expect(
        find.text('4.820 pessoas → 20 blocos de 250 (o último com 70).'),
        findsOneWidget,
      );

      await _tocar(t, find.byKey(const ValueKey('b-tamanho-personalizado')));
      await t.enterText(find.byKey(const ValueKey('b-personalizado')), '30');
      await _assentar(t);
      expect(find.text('Escolha de 50 a 1.000.'), findsOneWidget);
      expect(
        t
            .widget<ButtonStyleButton>(find.byKey(const ValueKey('b-dividir')))
            .onPressed,
        isNull,
      );

      await t.enterText(find.byKey(const ValueKey('b-personalizado')), '1000');
      await _assentar(t);
      expect(
        find.text('4.820 pessoas → 5 blocos de 1.000 (o último com 820).'),
        findsOneWidget,
      );
      await _tocar(t, find.byKey(const ValueKey('b-ordem-sorteio')));
      await _tocar(t, find.byKey(const ValueKey('b-so-nunca')));
      // Só quem nunca recebeu: o servidor é quem sabe quantos sobram.
      expect(find.byKey(const ValueKey('b-previa')), findsNothing);
      await _tocar(t, find.byKey(const ValueKey('b-dividir')));

      expect(s.corpos['POST /contatos/divisoes'], {
        'origem': 'lista',
        'origemId': 'l1',
        'tamanho': 1000,
        'ordem': 'sorteio',
        'soNuncaReceberam': true,
      });
    },
  );

  testWidgets(
    'bloqueios: voltar à base pede o motivo; apagar dados e apagar tudo confirmam',
    (t) async {
      final s = _Servidor();
      _telaAlta(t);
      await t.pumpWidget(_app(s.api, const TelaBloqueios()));
      await _assentar(t);

      expect(find.text('1 número bloqueado'), findsOneWidget);
      expect(
        find.text('Saiu em 20/09/2026 · Tocou em "Parar promoções"'),
        findsOneWidget,
      );

      await _tocar(t, find.byKey(const ValueKey('voltar-x1')));
      await t.enterText(find.byKey(const ValueKey('justificativa')), 'pediu');
      await _assentar(t);
      await t.enterText(find.byKey(const ValueKey('justificativa')), 'pedi');
      await _assentar(t);
      final confirmar = find.byKey(const ValueKey('confirmar-retorno'));
      expect(t.widget<FilledButton>(confirmar).onPressed, isNull);
      await t.enterText(
        find.byKey(const ValueKey('justificativa')),
        'Pediu no balcão para voltar',
      );
      await _assentar(t);
      await t.tap(confirmar);
      await _assentar(t);
      expect(s.corpos['POST /contatos/x1/reativar'], {
        'justificativa': 'Pediu no balcão para voltar',
      });
      expect(
        find.text('Contato de volta à base, com o pedido registrado.'),
        findsOneWidget,
      );

      await _tocar(t, find.byKey(const ValueKey('apagar-dados-x1')));
      await _tocar(t, find.widgetWithText(FilledButton, 'Apagar dados'));
      expect(s.pediu('POST /contatos/x1/anonimizar'), isTrue);

      await _tocar(t, find.byKey(const ValueKey('apagar-tudo-x1')));
      expect(
        find.textContaining('pode voltar numa importação futura'),
        findsOneWidget,
      );
      await _tocar(t, find.widgetWithText(FilledButton, 'Apagar tudo'));
      expect(s.pediu('DELETE /contatos/x1/permanente'), isTrue);
      expect(find.text('Contato apagado por completo.'), findsOneWidget);
    },
  );

  testWidgets('sem WhatsApp: tentar de novo devolve aos envios', (t) async {
    final s = _Servidor();
    _telaAlta(t);
    await t.pumpWidget(_app(s.api, const TelaBloqueios()));
    await _assentar(t);

    expect(
      s.pediu('GET /contatos?pagina=1&porPagina=100&situacao=sem_whatsapp'),
      isTrue,
    );
    expect(find.text('Sem WhatsApp · 1'), findsOneWidget);
    await _tocar(t, find.byKey(const ValueKey('tentar-w1')));
    expect(s.pediu('POST /contatos/w1/tentar-whatsapp'), isTrue);
    expect(find.textContaining('Número de volta aos envios.'), findsOneWidget);
  });

  group('importar', () {
    /// Abre a importação por um botão (para receber o que ela devolve) e lê
    /// um número colado.
    Future<void> importarTexto(
      WidgetTester t,
      _Servidor s,
      void Function(Object?) aoVoltar,
    ) async {
      _telaAlta(t);
      await t.pumpWidget(
        _app(
          s.api,
          Builder(
            builder: (contexto) => Scaffold(
              body: Center(
                child: TextButton(
                  onPressed: () async => aoVoltar(
                    await Navigator.of(contexto).push<Object?>(
                      MaterialPageRoute(
                        builder: (_) => const TelaImportarContatos(),
                      ),
                    ),
                  ),
                  child: const Text('abrir'),
                ),
              ),
            ),
          ),
        ),
      );
      await t.tap(find.text('abrir'));
      await _assentar(t);
      await t.enterText(find.byType(TextField).first, '21 99111-2222');
      await _tocar(t, find.text('Ler números'));
    }

    testWidgets(
      'planilha com colunas extras: avisa o que vem e o botão vira "Atualizar"',
      (t) async {
        final s = _Servidor();
        await importarTexto(t, s, (_) {});

        expect(
          find.textContaining('Também vêm da planilha: e-mail, pedidos.'),
          findsOneWidget,
        );
        expect(find.text('Atualizar os dados dos contatos'), findsOneWidget);

        await _tocar(t, find.byKey(const ValueKey('consentimento')));
        await t.tap(find.text('Atualizar os dados dos contatos'));
        await _assentar(t);

        final enviado =
            (s.corpos['POST /contatos/importacao']
                as Map<String, dynamic>)['contatos'];
        expect(enviado, [
          {
            'telefone': '5521991112222',
            'nome': 'Ana',
            'email': 'ana@exemplo.com',
            'pedidos': 12,
          },
        ]);
        expect(find.text('0 contatos entraram na sua base'), findsOneWidget);
        // Com histórico de compra, dividir é opção, não o caminho principal.
        expect(
          t.widget(find.byKey(const ValueKey('dividir-importacao'))),
          isNot(isA<FilledButton>()),
        );
        expect(find.textContaining('só com nome e número'), findsNothing);
        expect(find.textContaining('pelo site'), findsNothing);
      },
    );

    testWidgets(
      'importar mais e sair pela seta: a lista ainda fica sabendo que entrou gente',
      (t) async {
        final s = _Servidor();
        Object? resultado;
        await importarTexto(t, s, (r) => resultado = r);
        await _tocar(t, find.byKey(const ValueKey('consentimento')));
        await t.tap(find.text('Atualizar os dados dos contatos'));
        await _assentar(t);

        await _tocar(t, find.byKey(const ValueKey('importar-mais')));
        expect(find.text('Importar contatos'), findsOneWidget);
        await t.pageBack();
        await _assentar(t);
        expect(resultado, isTrue);
      },
    );

    testWidgets(
      'lista só com nome e número: dividir em blocos é o próximo passo e volta com a divisão',
      (t) async {
        final s = _Servidor()
          ..previa = {
            ..._Servidor().previa,
            'novos': 1,
            'jaExistem': 0,
            'extras': <String>[],
            'contatos': [
              {
                'nome': 'Ana',
                'telefone': '5521991112222',
                'novo': true,
                'assumiuPais': true,
              },
            ],
          };
        Object? resultado;
        await importarTexto(t, s, (r) => resultado = r);

        expect(find.text('55 acrescentado'), findsOneWidget);
        expect(find.text('Importar 1 contato'), findsOneWidget);
        await _tocar(t, find.byKey(const ValueKey('consentimento')));
        await t.tap(find.text('Importar 1 contato'));
        await _assentar(t);

        expect(find.textContaining('só com nome e número'), findsOneWidget);
        // Sem histórico de compra, dividir é o caminho principal.
        expect(
          t.widget(find.byKey(const ValueKey('dividir-importacao'))),
          isA<FilledButton>(),
        );
        await _tocar(t, find.byKey(const ValueKey('dividir-importacao')));
        await _tocar(t, find.byKey(const ValueKey('b-dividir')));

        expect(s.corpos['POST /contatos/divisoes'], {
          'origem': 'importacao',
          'origemId': '5e1d0b8e-4a8c-4d7e-9a50-1c2b3d4e5f60',
          'tamanho': 250,
          'ordem': 'importacao',
        });
        expect(resultado, isA<DivisaoDeBlocos>());
      },
    );
  });

  test(
    'o público da campanha e o filtro dos contatos falam a mesma língua',
    () {
      const filtro = FiltroDeContatos.publico(
        'produto',
        'Smash duplo',
        'Já compraram Smash duplo',
        total: 1620,
      );
      expect(filtro.consulta, '&publico=produto&valor=Smash+duplo');
      expect(
        filtro
            .alvo(1620)
            .pedido(tamanho: 250, ordem: 'valor', soNuncaReceberam: false),
        {
          'origem': 'publico',
          'publico': 'produto',
          'publicoValor': 'Smash duplo',
          'tamanho': 250,
          'ordem': 'valor',
        },
      );
      expect(
        const FiltroDeContatos.perfil('campeoes', 'Campeões') ==
            const FiltroDeContatos.perfil('campeoes', 'outro rótulo', total: 3),
        isTrue,
      );
    },
  );

  test('contato: cashback só conta para quem pode receber', () {
    final k = Contato.deJson({
      'id': 'k',
      'telefone': '5521999998888',
      'optOut': false,
      'cashbackCentavos': 500,
      'cashbackVenceEm': '2026-10-14',
      'cashbackValido': true,
    });
    expect(k.temCashback, isTrue);
    expect(k.cashbackVenceEm, '2026-10-14');
    expect(k.descadastrado().temCashback, isFalse);
  });
}
