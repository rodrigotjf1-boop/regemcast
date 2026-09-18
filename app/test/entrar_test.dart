import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'package:intl/date_symbol_data_local.dart';
import 'package:regemcast/api/cliente_api.dart';
import 'package:regemcast/sessao/cofre.dart';
import 'package:regemcast/sessao/sessao.dart';
import 'package:regemcast/telas/entrar.dart';
import 'package:regemcast/tema/tema.dart';

/// Como a API responde de verdade: JSON em UTF-8.
http.Response _json(
  Object corpo,
  int status, {
  Map<String, String> headers = const {},
}) => http.Response.bytes(
  utf8.encode(jsonEncode(corpo)),
  status,
  headers: {'content-type': 'application/json; charset=utf-8', ...headers},
);

/// Cofre em memória: o teste não tem o Keystore do Android.
class _CofreMemoria extends Cofre {
  _CofreMemoria() : super(const FlutterSecureStorage());
  final Map<String, String> _m = {};

  @override
  Future<String?> lerToken() async => _m['token'];
  @override
  Future<DateTime?> lerExpiraEm() async => null;
  @override
  Future<void> guardarSessao(String token, String? expiraEm) async =>
      _m['token'] = token;
  @override
  Future<void> apagarSessao() async => _m.remove('token');
  @override
  Future<bool> biometriaLigada() async => false;
  @override
  Future<void> definirBiometria(bool ligada) async {}
  @override
  Future<bool> biometriaJaPerguntada() async => true;
  @override
  Future<String?> lerUltimoEmail() async => null;
  @override
  Future<void> guardarUltimoEmail(String email) async {}
}

Widget _app(ClienteApi api, Cofre cofre) => ProviderScope(
  overrides: [
    clienteApiProvider.overrideWithValue(api),
    cofreProvider.overrideWithValue(cofre),
  ],
  child: MaterialApp(
    theme: temaDoApp(Brightness.light),
    home: const TelaEntrar(),
  ),
);

void main() {
  setUpAll(() => initializeDateFormatting('pt_BR'));

  testWidgets('senha errada mostra a frase do servidor', (tester) async {
    final api = ClienteApi(
      base: 'https://api.teste',
      http: MockClient((req) async {
        if (req.url.path == '/auth/login') {
          return _json(({'mensagem': 'E-mail ou senha não conferem.'}), 401);
        }
        return http.Response('{}', 200);
      }),
    );

    await tester.pumpWidget(_app(api, _CofreMemoria()));
    await tester.pumpAndSettle();

    await tester.enterText(
      find.widgetWithText(TextField, 'E-mail'),
      'ana@empresa.com.br',
    );
    await tester.enterText(find.widgetWithText(TextField, 'Senha'), 'errada');
    await tester.tap(find.widgetWithText(FilledButton, 'Entrar'));
    await tester.pumpAndSettle();

    expect(find.text('E-mail ou senha não conferem.'), findsOneWidget);
  });

  testWidgets('conta com duas etapas pede o código e manda o login como app', (
    tester,
  ) async {
    Map<String, dynamic>? corpoLogin;
    final api = ClienteApi(
      base: 'https://api.teste',
      http: MockClient((req) async {
        if (req.url.path == '/auth/login') {
          corpoLogin = jsonDecode(req.body) as Map<String, dynamic>;
          return _json(({
            'etapa': 'codigo',
            'metodo': 'email',
            'emailMascarado': 'a***@empresa.com.br',
          }), 200);
        }
        return http.Response('{}', 200);
      }),
    );

    await tester.pumpWidget(_app(api, _CofreMemoria()));
    await tester.pumpAndSettle();

    await tester.enterText(
      find.widgetWithText(TextField, 'E-mail'),
      'ana@empresa.com.br',
    );
    await tester.enterText(
      find.widgetWithText(TextField, 'Senha'),
      'senha certa 2026',
    );
    await tester.tap(find.widgetWithText(FilledButton, 'Entrar'));
    await tester.pumpAndSettle();

    expect(
      corpoLogin?['dispositivo'],
      'app',
      reason: 'sem isso a API não devolve o token no corpo',
    );
    expect(find.text('Verificação em duas etapas'), findsOneWidget);
    expect(find.textContaining('a***@empresa.com.br'), findsOneWidget);
    expect(find.text('Enviar outro código'), findsOneWidget);
  });

  testWidgets('campos vazios não chamam o servidor', (tester) async {
    var chamou = false;
    final api = ClienteApi(
      base: 'https://api.teste',
      http: MockClient((_) async {
        chamou = true;
        return http.Response('{}', 200);
      }),
    );

    await tester.pumpWidget(_app(api, _CofreMemoria()));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Entrar'));
    await tester.pumpAndSettle();

    expect(find.text('Informe o e-mail e a senha.'), findsOneWidget);
    expect(chamou, isFalse);
  });
}
