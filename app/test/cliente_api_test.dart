import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'package:regemcast/api/cliente_api.dart';
import 'package:regemcast/api/erro_api.dart';

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

/// O cliente da API é o que decide se a sessão vale, se o código das duas
/// etapas chega ao lugar certo e o que a pessoa lê quando algo dá errado.
void main() {
  group('sessão', () {
    test('manda o token como Bearer', () async {
      String? recebido;
      final api = ClienteApi(
        base: 'https://api.teste',
        http: MockClient((req) async {
          recebido = req.headers['Authorization'];
          return http.Response('{}', 200);
        }),
      )..token = 'abc';

      await api.get('/auth/eu');
      expect(recebido, 'Bearer abc');
    });

    test('401 fora do login avisa que a sessão acabou', () async {
      var perdeu = false;
      final api =
          ClienteApi(
              base: 'https://api.teste',
              http: MockClient(
                (_) async => _json(({'mensagem': 'Sua sessão expirou.'}), 401),
              ),
            )
            ..token = 'abc'
            ..aoPerderSessao = () => perdeu = true;

      await expectLater(api.get('/campanhas'), throwsA(isA<ErroApi>()));
      expect(perdeu, isTrue);
    });

    test('401 no login é senha errada, não expulsão', () async {
      var perdeu = false;
      final api = ClienteApi(
        base: 'https://api.teste',
        http: MockClient(
          (_) async =>
              _json(({'mensagem': 'E-mail ou senha não conferem.'}), 401),
        ),
      )..aoPerderSessao = () => perdeu = true;

      try {
        await api.post('/auth/login', {'email': 'a@b.c', 'senha': 'x'});
        fail('deveria ter falhado');
      } on ErroApi catch (e) {
        expect(e.mensagem, 'E-mail ou senha não conferem.');
      }
      expect(perdeu, isFalse);
    });
  });

  group('pré-sessão das duas etapas', () {
    test(
      'guarda o cookie _pre do login e devolve só nas rotas do login',
      () async {
        final cookies = <String, String?>{};
        final api = ClienteApi(
          base: 'https://api.teste',
          http: MockClient((req) async {
            cookies[req.url.path] = req.headers['Cookie'];
            if (req.url.path == '/auth/login') {
              return http.Response(
                jsonEncode({
                  'etapa': 'codigo',
                  'metodo': 'app',
                  'emailMascarado': 'a***@b.c',
                }),
                200,
                headers: {
                  'set-cookie':
                      'regemcast_sess_pre=PRE123; Path=/api/v1/auth/login; HttpOnly; SameSite=Strict',
                },
              );
            }
            return http.Response('{}', 200);
          }),
        );

        await api.post('/auth/login', {'email': 'a@b.c', 'senha': 'x'});
        await api.post('/auth/login/codigo', {'codigo': '123456'});
        await api.get('/campanhas');

        expect(cookies['/auth/login/codigo'], 'regemcast_sess_pre=PRE123');
        expect(
          cookies['/campanhas'],
          isNull,
          reason: 'a pré-sessão não pode vazar para o resto da API',
        );
      },
    );

    test('cookie apagado pelo servidor sai da memória', () async {
      var chamada = 0;
      String? enviadoNaTerceira;
      final api = ClienteApi(
        base: 'https://api.teste',
        http: MockClient((req) async {
          chamada++;
          if (chamada == 3) enviadoNaTerceira = req.headers['Cookie'];
          final valor = chamada == 1 ? 'PRE123' : '';
          return http.Response(
            '{}',
            200,
            headers: {
              'set-cookie':
                  'regemcast_sess_pre=$valor; Path=/api/v1/auth/login',
            },
          );
        }),
      );

      await api.post('/auth/login');
      await api.post('/auth/login/codigo');
      await api.post('/auth/login/reenviar');
      expect(enviadoNaTerceira, isNull);
    });
  });

  group('erros legíveis', () {
    test('usa a frase da API', () async {
      final api = ClienteApi(
        base: 'https://api.teste',
        http: MockClient(
          (_) async => _json(({'mensagem': 'Campanha não encontrada.'}), 404),
        ),
      );
      await expectLater(
        api.get('/campanhas/x'),
        throwsA(
          isA<ErroApi>()
              .having((e) => e.mensagem, 'mensagem', 'Campanha não encontrada.')
              .having((e) => e.status, 'status', 404),
        ),
      );
    });

    test('sem rede vira frase, não exceção de socket', () async {
      final api = ClienteApi(
        base: 'https://api.teste',
        http: MockClient((_) async => throw const SocketException('sem rede')),
      );
      await expectLater(
        api.get('/conta'),
        throwsA(
          isA<ErroApi>().having((e) => e.semConexao, 'semConexao', isTrue),
        ),
      );
    });

    test('resposta sem corpo JSON ainda explica o erro', () async {
      final api = ClienteApi(
        base: 'https://api.teste',
        http: MockClient((_) async => http.Response('<html>502</html>', 502)),
      );
      await expectLater(
        api.get('/conta'),
        throwsA(
          isA<ErroApi>().having((e) => e.mensagem, 'mensagem', contains('502')),
        ),
      );
    });
  });
}
