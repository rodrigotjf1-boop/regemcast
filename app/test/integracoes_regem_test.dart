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
import 'package:regemcast/api/regem.dart';
import 'package:regemcast/api/repeticao.dart';
import 'package:regemcast/push/push.dart';
import 'package:regemcast/sessao/sessao.dart';
import 'package:regemcast/telas/integracoes.dart';
import 'package:regemcast/telas/integracoes_regem.dart';
import 'package:regemcast/tema/tema.dart';

/// O cartão do Regem no app — o mesmo do site (`regem.tsx`): os estados, as
/// ações do dono e os CORPOS que vão para o servidor (V23: site e app mandam
/// o mesmo).

http.Response _json(Object corpo, [int status = 200]) => http.Response.bytes(
  utf8.encode(jsonEncode(corpo)),
  status,
  headers: {'content-type': 'application/json; charset=utf-8'},
);

const _texto99 =
    'Autorizo o RegemCast a trazer do Regem os clientes que compraram na empresa "Grupo Sabor" pela 99Food e declaro, em nome da empresa e sob a responsabilidade dela (CNPJ), que esses clientes autorizaram receber mensagens da empresa pelo WhatsApp.';

Map<String, dynamic> _rg({
  bool ligado = true,
  String clientes = 'em_dia',
  String vendas = 'em_dia',
  int lidos = 2480,
  bool incluir99 = false,
  bool escopo99 = false,
  bool cardapioWebDireto = false,
  String? erroClientes,
  String? erroVendas,
}) => {
  'ligado': ligado,
  'empresaNome': ligado ? 'Grupo Sabor' : null,
  'lojas': ligado
      ? [
          {'id': 'l1', 'nome': 'Centro'},
          {'id': 'l2', 'nome': 'Tijuca'},
        ]
      : <Object>[],
  'ligadaEm': ligado ? '2026-09-27T12:00:00Z' : null,
  'escopo99': escopo99,
  'incluir99': incluir99,
  'autorizacao99Em': incluir99 ? '2026-09-29T15:00:00Z' : null,
  'textoAutorizacao99': _texto99,
  'consentimentoEm': clientes == 'parado' ? null : '2026-09-28T12:00:00Z',
  'listaId': null,
  'cardapioWebDireto': cardapioWebDireto,
  'carenciaDias': 7,
  'clientes': {
    'status': clientes,
    'lidos': lidos,
    'novos': 2210,
    'bloqueados': 41,
    'ignorados': 3,
    'invalidos': 12,
    'removidos': 2,
    'ultimaConsulta': clientes == 'em_dia' ? '2026-09-30T13:30:00Z' : null,
    'erro': erroClientes,
  },
  'pedidos': {
    'status': vendas,
    'lidos': 18700,
    'gravados': 4870,
    'ignorados': 900,
    'ultimaConsulta': vendas == 'em_dia' ? '2026-09-30T13:30:00Z' : null,
    'erro': erroVendas,
    'compras': 4870,
    'clientes': 1480,
    'primeira': '2023-10-02T00:00:00Z',
    'ultima': '2026-09-29T13:10:00Z',
  },
};

/// O servidor falso: anota cada pedido e o corpo de cada escrita; as
/// situações seguintes saem de uma fila (a última se repete).
class _Servidor {
  _Servidor(this.regem);

  List<Map<String, dynamic>> regem;
  final pedidos = <String>[];
  final corpos = <String, Object?>{};

  ClienteApi get api => ClienteApi(
    base: 'https://api.teste',
    http: MockClient((req) async {
      final chave = '${req.method} ${req.url.path}';
      pedidos.add(chave);
      if (req.body.isNotEmpty) corpos[chave] = jsonDecode(req.body);
      switch (chave) {
        case 'GET /integracoes/regem':
          final atual = regem.first;
          if (regem.length > 1) regem.removeAt(0);
          return _json(atual);
        case 'POST /integracoes/regem/importar':
        case 'POST /integracoes/regem/99':
        case 'POST /integracoes/regem/atualizar':
          return _json(regem.first, 201);
        case 'DELETE /integracoes/regem':
          return http.Response('', 204);
      }
      return _json({});
    }),
  );

  int quantos(String pedido) => pedidos.where((p) => p == pedido).length;
}

class _SessaoFixa extends ControleSessao {
  _SessaoFixa(this.papel);
  final String papel;

  @override
  EstadoSessao build() => SessaoAtiva(
    Sessao.deJson({
      'usuario': {'id': 'u', 'nome': 'Rodrigo', 'email': 'r@x', 'papel': papel},
      'conta': {'id': 'c', 'nome': 'GRUPO SABOR', 'status': 'ativa'},
    }),
  );
}

class _AvisosQuietos extends ServicoPush {
  _AvisosQuietos(super.api);

  @override
  Future<void> ativar({
    void Function(RemoteMessage)? aoChegar,
    void Function(Map<String, dynamic>)? aoTocar,
  }) async {}
}

Widget _app(_Servidor s, Widget tela, {String papel = 'dono'}) => ProviderScope(
  retry: semRepeticao,
  overrides: [
    clienteApiProvider.overrideWithValue(s.api),
    sessaoProvider.overrideWith(() => _SessaoFixa(papel)),
    servicoPushProvider.overrideWith(
      (ref) => _AvisosQuietos(ref.read(clienteApiProvider)),
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

/// Só o cartão, numa tela que rola.
const _cartao = Scaffold(
  body: SafeArea(
    child: SingleChildScrollView(
      padding: EdgeInsets.all(16),
      child: CartaoRegem(),
    ),
  ),
);

Future<void> _assentar(WidgetTester t) async {
  for (var i = 0; i < 10; i++) {
    await t.pump(const Duration(milliseconds: 50));
  }
}

Future<void> _abrir(
  WidgetTester t,
  _Servidor s, {
  Widget tela = _cartao,
  String papel = 'dono',
}) async {
  t.view.physicalSize = const Size(1080, 7000);
  t.view.devicePixelRatio = 2.625;
  addTearDown(t.view.reset);
  await t.pumpWidget(_app(s, tela, papel: papel));
  await _assentar(t);
}

/// Rola até o alvo, espera o quadro com a rolagem nova e só então toca.
Future<void> _tocar(WidgetTester t, Finder alvo) async {
  await t.ensureVisible(alvo.first);
  await t.pump();
  await t.tap(alvo.first);
  await _assentar(t);
}

void main() {
  setUpAll(() => initializeDateFormatting('pt_BR'));

  test('lê a situação do servidor (lojas, vendas, 99)', () {
    final s = SituacaoRegem.deJson(_rg(incluir99: true));
    expect(s.ligado, isTrue);
    expect(s.lojas, ['Centro', 'Tijuca']);
    expect(s.vendas.lidas, 18700);
    expect(s.vendas.compras, 4870);
    expect(s.clientes.removidos, 2);
    expect(s.incluir99, isTrue);
    expect(s.escopo99, isFalse);
    expect(s.textoAutorizacao99, _texto99);
    expect(s.lendo, isFalse);
    expect(SituacaoRegem.deJson(const {}).ligado, isFalse);
  });

  testWidgets('não ligada: pede a ligação ao suporte, sem token para copiar', (
    t,
  ) async {
    final s = _Servidor([
      _rg(ligado: false, clientes: 'parado', vendas: 'parado'),
    ]);
    await _abrir(t, s);

    expect(find.text('Não ligada'), findsOneWidget);
    expect(find.byKey(const ValueKey('pedir-ligacao-regem')), findsOneWidget);
    expect(find.text('suporte@dmsregem.com'), findsOneWidget);
    expect(
      find.textContaining('quem usa o Regem não paga o Regemcast'),
      findsOneWidget,
    );
    expect(find.textContaining('você não copia nenhum token'), findsOneWidget);
    expect(find.byKey(const ValueKey('importar-regem')), findsNothing);
  });

  testWidgets(
    'importar pede a declaração e leva a evidência (o corpo do site)',
    (t) async {
      final s = _Servidor([
        _rg(clientes: 'parado', vendas: 'parado'),
        _rg(clientes: 'carga', vendas: 'parado', lidos: 0),
      ]);
      await _abrir(t, s);

      expect(
        find.text('Empresa ligada: Grupo Sabor · 2 lojas (Centro, Tijuca)'),
        findsOneWidget,
      );
      final importar = find.byKey(const ValueKey('importar-regem'));
      expect(t.widget<FilledButton>(importar).onPressed, isNull);
      await _tocar(t, find.byKey(const ValueKey('consentimento-regem')));
      await t.enterText(
        find.byKey(const ValueKey('evidencia-regem')),
        '  Aceite no cardápio  ',
      );
      await _assentar(t);
      await _tocar(t, importar);

      expect(s.corpos['POST /integracoes/regem/importar'], {
        'consentimento': true,
        'evidencia': 'Aceite no cardápio',
      });
      expect(
        find.textContaining('Lendo os clientes de Grupo Sabor'),
        findsOneWidget,
      );
    },
  );

  testWidgets('lendo: relê a cada 3 s até ficar em dia, e para', (t) async {
    final s = _Servidor([
      _rg(clientes: 'carga', vendas: 'parado', lidos: 100),
      _rg(clientes: 'carga', vendas: 'parado', lidos: 300),
      _rg(),
    ]);
    await _abrir(t, s);

    expect(find.text('100 lidos · 2.210 novos na base'), findsOneWidget);
    expect(
      find.textContaining('Começam assim que a leitura dos clientes terminar.'),
      findsOneWidget,
    );
    await t.pump(const Duration(seconds: 3));
    await _assentar(t);
    expect(find.text('300 lidos · 2.210 novos na base'), findsOneWidget);
    await t.pump(const Duration(seconds: 3));
    await _assentar(t);
    expect(find.text('Em dia'), findsNWidgets(2));
    final leituras = s.quantos('GET /integracoes/regem');
    await t.pump(const Duration(seconds: 20));
    expect(s.quantos('GET /integracoes/regem'), leituras);
  });

  testWidgets('em dia: os números, o que fica de fora, atualizar e ler de novo', (
    t,
  ) async {
    final s = _Servidor([_rg()]);
    await _abrir(t, s);

    expect(
      find.textContaining(
        '2.480 clientes lidos, 2.210 novos na base, 41 que pediram para sair (entraram descadastrados), 12 sem telefone válido, 2 esquecidos a pedido (anonimizados aqui)',
      ),
      findsOneWidget,
    );
    expect(find.text('4.870'), findsOneWidget);
    expect(
      find.textContaining('o Regemcast é grátis para a sua empresa, sem teto'),
      findsOneWidget,
    );
    expect(find.text('1.480'), findsOneWidget);
    expect(
      find.textContaining('Ficam de fora as vendas do iFood'),
      findsOneWidget,
    );

    await _tocar(t, find.byKey(const ValueKey('atualizar-regem')));
    expect(s.pedidos, contains('POST /integracoes/regem/atualizar'));

    expect(find.byKey(const ValueKey('importar-regem')), findsNothing);
    await _tocar(t, find.byKey(const ValueKey('reler-regem')));
    expect(
      find.widgetWithText(FilledButton, 'Ler tudo de novo'),
      findsOneWidget,
    );
    await _tocar(t, find.widgetWithText(TextButton, 'Cancelar'));
    expect(find.byKey(const ValueKey('importar-regem')), findsNothing);
  });

  testWidgets(
    '99: autorizar só com a declaração do servidor; depois, aguardando',
    (t) async {
      final s = _Servidor([_rg(), _rg(incluir99: true)]);
      await _abrir(t, s);

      expect(find.text('Não autorizada'), findsOneWidget);
      expect(find.text(_texto99), findsOneWidget);
      final autorizar = find.byKey(const ValueKey('autorizar-99'));
      expect(t.widget<OutlinedButton>(autorizar).onPressed, isNull);
      await _tocar(t, find.byKey(const ValueKey('declaracao-99')));
      await _tocar(t, autorizar);

      expect(s.corpos['POST /integracoes/regem/99'], {
        'autorizar': true,
        'declaracao': true,
      });
      expect(find.text('Autorização da 99 registrada.'), findsOneWidget);
      expect(find.text('Aguardando a liberação'), findsOneWidget);
      expect(find.textContaining('Falta a liberação no Regem'), findsOneWidget);
    },
  );

  testWidgets(
    '99 incluída: desfazer pede confirmação e manda só "autorizar: false"',
    (t) async {
      final s = _Servidor([
        _rg(incluir99: true, escopo99: true),
        _rg(escopo99: true),
      ]);
      await _abrir(t, s);

      expect(find.text('Incluídos'), findsOneWidget);
      await _tocar(t, find.byKey(const ValueKey('desfazer-99')));
      expect(find.text('Desfazer a autorização da 99?'), findsOneWidget);
      await _tocar(t, find.widgetWithText(FilledButton, 'Desfazer'));

      expect(s.corpos['POST /integracoes/regem/99'], {'autorizar': false});
      expect(find.text('Autorização da 99 desfeita.'), findsOneWidget);
      expect(find.text('Não autorizada'), findsOneWidget);
    },
  );

  testWidgets('operador: vê, mas não importa, não autoriza e não desliga', (
    t,
  ) async {
    final s = _Servidor([_rg(clientes: 'parado', vendas: 'parado')]);
    await _abrir(t, s, papel: 'operador');

    expect(
      find.text('Só o dono da conta pode importar os clientes.'),
      findsOneWidget,
    );
    expect(
      find.text('Só o dono da conta pode autorizar os clientes da 99.'),
      findsOneWidget,
    );
    expect(find.byKey(const ValueKey('importar-regem')), findsNothing);
    expect(find.byKey(const ValueKey('desligar-regem')), findsNothing);
  });

  testWidgets('parou: o motivo e "tentar de novo" (retoma de onde parou)', (
    t,
  ) async {
    const motivo =
        'O Regem recusou a conexão: o acesso foi revogado ou trocado. Fale com o suporte do RegemCast para ligar de novo.';
    final s = _Servidor([
      _rg(
        clientes: 'falhou',
        vendas: 'falhou',
        erroClientes: motivo,
        erroVendas: motivo,
      ),
    ]);
    await _abrir(t, s);

    expect(find.text('Parou'), findsNWidgets(2));
    expect(find.text(motivo), findsNWidgets(2));
    await _tocar(t, find.byKey(const ValueKey('tentar-clientes-regem')));
    expect(s.pedidos, contains('POST /integracoes/regem/atualizar'));
  });

  testWidgets(
    'Cardápio Web ligado direto: avisa que a venda não conta duas vezes',
    (t) async {
      final s = _Servidor([_rg(cardapioWebDireto: true)]);
      await _abrir(t, s);
      expect(
        find.textContaining('Cardápio Web também está ligado direto'),
        findsOneWidget,
      );
    },
  );

  testWidgets('desligar pede confirmação', (t) async {
    final s = _Servidor([
      _rg(),
      _rg(ligado: false, clientes: 'parado', vendas: 'parado'),
    ]);
    await _abrir(t, s);

    await _tocar(t, find.byKey(const ValueKey('desligar-regem')));
    expect(find.text('Desligar do Regem?'), findsOneWidget);
    // A confirmação diz o que se perde: a gratuidade, com a carência do servidor.
    expect(
      find.textContaining(
        'a gratuidade acaba: sem plano pago, os disparos param em 7 dias',
      ),
      findsWidgets,
    );
    await _tocar(t, find.widgetWithText(FilledButton, 'Desligar'));
    expect(s.pedidos, contains('DELETE /integracoes/regem'));
    expect(find.text('Desligado do Regem.'), findsOneWidget);
    expect(find.text('Não ligada'), findsOneWidget);
  });

  testWidgets(
    'a tela Integrações mostra o cartão do Regem no lugar do "Em preparação"',
    (t) async {
      final s = _Servidor([_rg()]);
      await _abrir(t, s, tela: const TelaIntegracoes());
      expect(find.byKey(const ValueKey('regem')), findsOneWidget);
      expect(find.text('Em preparação'), findsNothing);
    },
  );
}
