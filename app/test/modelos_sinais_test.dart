import 'dart:convert';

import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:regemcast/api/cliente_api.dart';
import 'package:regemcast/api/dados.dart';
import 'package:regemcast/api/modelos.dart';
import 'package:regemcast/api/repeticao.dart';
import 'package:regemcast/push/push.dart';
import 'package:regemcast/sessao/sessao.dart';
import 'package:regemcast/telas/casca.dart';
import 'package:regemcast/telas/modelos.dart';
import 'package:regemcast/telas/whatsapp.dart';
import 'package:regemcast/tema/tema.dart';

/// Os sinais que a Meta dá sobre um modelo aprovado — a qualidade e a
/// categoria que ela vai mudar — na lista de modelos, e o toque nos avisos do
/// celular que falam deles.

http.Response _json(Object corpo, [int status = 200]) => http.Response.bytes(
  utf8.encode(jsonEncode(corpo)),
  status,
  headers: {'content-type': 'application/json; charset=utf-8'},
);

Map<String, dynamic> _modelo(
  String id,
  String nome, {
  String categoria = 'marketing',
  Map<String, dynamic> sinais = const {},
}) => {
  'id': id,
  'nome': nome,
  'idioma': 'pt_BR',
  'categoria': categoria,
  'status': 'aprovado',
  'motivo': null,
  'cabecalho': null,
  'corpo': 'Oi! Tem novidade.',
  'rodape': null,
  'variaveis': 0,
  'botoes': <String>[],
  ...sinais,
};

const _alertaDaQualidade =
    'Qualidade ruim: a Meta pode pausar ou desativar este modelo em breve, e com ele pausado nenhuma campanha sai.';
const _alertaDaCategoria =
    'A Meta vai mudar este modelo de utilidade para marketing em até 24 horas. O preço por mensagem e as regras de envio mudam junto.';

final _modelos = [
  _modelo(
    'm1',
    'promo_de_sexta',
    sinais: {
      'qualidade': 'vermelha',
      'categoriaPrevista': null,
      'categoriaAnterior': null,
      'alertas': [
        {'tom': 'erro', 'texto': _alertaDaQualidade},
      ],
    },
  ),
  _modelo(
    'm2',
    'pedido_saiu',
    categoria: 'utilidade',
    sinais: {
      'qualidade': 'verde',
      'categoriaPrevista': 'marketing',
      'categoriaAnterior': null,
      'alertas': [
        {'tom': 'atencao', 'texto': _alertaDaCategoria},
      ],
    },
  ),
  _modelo(
    'm3',
    'boas_vindas',
    sinais: {
      'qualidade': 'desconhecida',
      'categoriaPrevista': null,
      'categoriaAnterior': 'utilidade',
      'alertas': <Object>[],
    },
  ),
  // Servidor antigo: o modelo vem sem os campos novos.
  _modelo('m4', 'modelo_antigo'),
];

final _pedidos = <String>[];

ClienteApi get _api => ClienteApi(
  base: 'https://api.teste',
  http: MockClient((req) async {
    _pedidos.add('${req.method} ${req.url.path}');
    switch (req.url.path) {
      case '/whatsapp/situacao':
        return _json({
          'conectado': true,
          'conta': {
            'nome': 'Mister Burgers Ltda',
            'wabaId': '1',
            'moeda': 'BRL',
          },
          'numeros': [
            {
              'phoneNumberId': '1111',
              'telefone': '+55 21 99999-8888',
              'qualidade': 'verde',
              'status': 'registrado',
            },
          ],
        });
      case '/whatsapp/modelos':
        return _json(_modelos);
      case '/modelos':
      case '/campanhas':
        return _json(<Object>[]);
      case '/conta':
        return _json({
          'conta': {'nome': 'MISTER BURGERS'},
          'uso': {'disparos': 0},
          'conversasHabilitadas': false,
        });
    }
    return _json({});
  }),
);

class _SessaoFixa extends ControleSessao {
  @override
  EstadoSessao build() => SessaoAtiva(
    Sessao.deJson({
      'usuario': {
        'id': 'u',
        'nome': 'Rodrigo',
        'email': 'r@x',
        'papel': 'dono',
      },
      'conta': {'id': 'c', 'nome': 'MISTER BURGERS', 'status': 'ativa'},
    }),
  );
}

/// Sem Firebase: guarda o que a casca registrou para o toque no aviso.
class _AvisosDeTeste extends ServicoPush {
  _AvisosDeTeste(super.api);

  static void Function(Map<String, dynamic>)? tocar;

  @override
  Future<void> ativar({
    void Function(RemoteMessage)? aoChegar,
    void Function(Map<String, dynamic>)? aoTocar,
  }) async {
    if (aoTocar != null) tocar = aoTocar;
  }
}

Widget _app(Widget tela) => ProviderScope(
  retry: semRepeticao,
  overrides: [
    clienteApiProvider.overrideWithValue(_api),
    sessaoProvider.overrideWith(_SessaoFixa.new),
    servicoPushProvider.overrideWith(
      (ref) => _AvisosDeTeste(ref.read(clienteApiProvider)),
    ),
    preferenciasAvisoProvider.overrideWith(
      (ref) async => const PreferenciasAviso(
        campanhas: true,
        modelos: true,
        cobranca: false,
      ),
    ),
  ],
  child: MaterialApp(
    theme: temaDoApp(Brightness.light),
    home: MediaQuery(
      data: const MediaQueryData(disableAnimations: true),
      child: tela,
    ),
  ),
);

Future<void> _abrir(WidgetTester t, Widget tela) async {
  t.view.physicalSize = const Size(1080, 6000);
  t.view.devicePixelRatio = 2.625;
  addTearDown(t.view.reset);
  await t.pumpWidget(_app(tela));
  for (var i = 0; i < 12; i++) {
    await t.pump(const Duration(milliseconds: 50));
  }
}

Future<void> _transicao(WidgetTester t) async {
  for (var i = 0; i < 20; i++) {
    await t.pump(const Duration(milliseconds: 100));
  }
}

void main() {
  setUpAll(() => initializeDateFormatting('pt_BR'));
  setUp(() {
    _pedidos.clear();
    _AvisosDeTeste.tocar = null;
  });

  group('ModeloNaMeta lê os sinais', () {
    test('qualidade, categoria anterior e os alertas com o tom', () {
      final ruim = ModeloNaMeta.deJson(_modelos[0]);
      expect(ruim.qualidade, 'vermelha');
      expect(ruim.alertas.single.erro, isTrue);
      expect(ruim.alertas.single.texto, _alertaDaQualidade);

      final vaiMudar = ModeloNaMeta.deJson(_modelos[1]);
      expect(vaiMudar.qualidade, 'verde');
      expect(vaiMudar.alertas.single.erro, isFalse);

      expect(ModeloNaMeta.deJson(_modelos[2]).categoriaAnterior, 'utilidade');
    });

    test('servidor antigo, sem os campos: "desconhecida" e nenhum alerta', () {
      final m = ModeloNaMeta.deJson(_modelos[3]);
      expect(m.qualidade, 'desconhecida');
      expect(m.categoriaAnterior, isNull);
      expect(m.alertas, isEmpty);
    });

    test('alerta sem texto não entra', () {
      final m = ModeloNaMeta.deJson({
        ..._modelos[3],
        'alertas': [
          {'tom': 'erro', 'texto': ''},
          'lixo',
          {'tom': 'atencao', 'texto': 'Vale.'},
        ],
      });
      expect(m.alertas.map((a) => a.texto), ['Vale.']);
    });
  });

  group('lista de modelos', () {
    testWidgets('a qualidade vira pílula; sem informação, não aparece', (
      t,
    ) async {
      await _abrir(t, const Scaffold(body: TelaModelos()));

      expect(find.text('Qualidade: Ruim'), findsOneWidget);
      expect(find.text('Qualidade: Boa'), findsOneWidget);
      // m3 (desconhecida) e m4 (servidor antigo) ficam sem pílula de qualidade.
      expect(find.textContaining('Qualidade:'), findsNWidgets(2));
    });

    testWidgets('os alertas da Meta aparecem com a frase do servidor', (
      t,
    ) async {
      await _abrir(t, const Scaffold(body: TelaModelos()));

      expect(find.text(_alertaDaQualidade), findsOneWidget);
      expect(find.text(_alertaDaCategoria), findsOneWidget);
      expect(find.byKey(const ValueKey('modelo-alerta-erro')), findsOneWidget);
      expect(
        find.byKey(const ValueKey('modelo-alerta-atencao')),
        findsOneWidget,
      );
    });

    testWidgets('modelo que a Meta já reclassificou diz de onde veio', (
      t,
    ) async {
      await _abrir(t, const Scaffold(body: TelaModelos()));
      expect(find.textContaining('era utilidade'), findsOneWidget);
    });
  });

  group('toque no aviso do celular', () {
    testWidgets('"Sua conta não pode enviar agora" abre a tela do WhatsApp', (
      t,
    ) async {
      await _abrir(t, const Casca());
      expect(_AvisosDeTeste.tocar, isNotNull);

      _AvisosDeTeste.tocar!({'tipo': 'campanhas', 'tela': 'whatsapp'});
      await _transicao(t);

      expect(find.byType(TelaWhatsapp), findsOneWidget);
    });

    testWidgets(
      'aviso de qualidade ou categoria de modelo criado fora do Regemcast (sem modeloId) abre os modelos',
      (t) async {
        await _abrir(t, const Casca());

        _AvisosDeTeste.tocar!({'tipo': 'modelos', 'tela': 'modelos'});
        await _transicao(t);

        expect(find.byType(TelaModelos), findsOneWidget);
        expect(find.text('Qualidade: Ruim'), findsOneWidget);
      },
    );
  });
}
