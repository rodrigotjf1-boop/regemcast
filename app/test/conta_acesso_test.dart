import 'dart:convert';

import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:regemcast/api/cliente_api.dart';
import 'package:regemcast/api/conta.dart';
import 'package:regemcast/api/dados.dart';
import 'package:regemcast/api/repeticao.dart';
import 'package:regemcast/api/seguranca.dart';
import 'package:regemcast/config.dart';
import 'package:regemcast/push/push.dart';
import 'package:regemcast/sessao/cofre.dart';
import 'package:regemcast/sessao/sessao.dart';
import 'package:regemcast/telas/casca.dart';
import 'package:regemcast/telas/conta.dart';
import 'package:regemcast/telas/entrar.dart';
import 'package:regemcast/telas/importar_contatos.dart';
import 'package:regemcast/telas/lista_espera.dart';
import 'package:regemcast/telas/integracoes.dart';
import 'package:regemcast/telas/painel.dart';
import 'package:regemcast/telas/plano.dart';
import 'package:regemcast/telas/recuperar_senha.dart';
import 'package:regemcast/telas/seguranca.dart';
import 'package:regemcast/tema/tema.dart';
import 'package:regemcast/util/senha.dart';

http.Response _json(Object corpo, [int status = 200]) => http.Response.bytes(
  utf8.encode(jsonEncode(corpo)),
  status,
  headers: {'content-type': 'application/json; charset=utf-8'},
);

Map<String, dynamic> _seguranca({
  String doisFatores = 'nenhum',
  bool emailVerificado = false,
  bool appDisponivel = true,
}) => {
  'doisFatores': doisFatores,
  'emailVerificado': emailVerificado,
  'appDisponivel': appDisponivel,
};

const _segredo = 'JBSWY3DPEHPK3PXP';
const _endereco =
    'otpauth://totp/RegemCast:rodrigo%40misterburgers.com.br?secret=$_segredo&issuer=RegemCast';

/// O servidor falso: anota cada pedido e o corpo de cada escrita. Uma rota
/// pode ganhar resposta própria (erro, demora) em [respostas].
class _Servidor {
  Map<String, dynamic> conta = {
    'id': 'c',
    'nome': 'MISTER BURGERS',
    'cnpj': '12345678000195',
    'timezone': 'America/Sao_Paulo',
    'status': 'ativa',
    'descansoMarketingDias': 3,
  };
  String? statusAssinatura = 'ativa';
  String? gratisAte;
  List<Map<String, dynamic>> seguranca = [_seguranca()];
  Map<String, dynamic> whatsapp = {
    'conectado': false,
    'conta': null,
    'numeros': <Object>[],
  };
  int totalContatos = 0;
  List<Map<String, dynamic>> modelos = [];
  List<Map<String, dynamic>> campanhas = [];

  final respostas = <String, Future<http.Response> Function(Object? corpo)>{};
  final pedidos = <String>[];
  final corpos = <String, List<Object?>>{};

  ClienteApi get api => ClienteApi(
    base: 'https://api.teste',
    http: MockClient((req) async {
      final chave = '${req.method} ${req.url.path}';
      pedidos.add(chave);
      final corpo = req.body.isEmpty ? null : jsonDecode(req.body);
      (corpos[chave] ??= []).add(corpo);
      final propria = respostas[chave];
      if (propria != null) return propria(corpo);
      switch (chave) {
        case 'GET /conta':
          return _json({
            'conta': conta,
            'plano': {
              'codigo': 'essencial',
              'nome': 'Essencial',
              'disparosMes': 5000,
            },
            'assinatura': {
              'status': statusAssinatura,
              'cicloInicio': '2026-09-17T00:00:00Z',
              'cicloFim': '2026-10-17T00:00:00Z',
              'gratisAte': gratisAte,
            },
            'uso': {'disparos': 120, 'teto': 5000, 'restantes': 4880},
            'conversasHabilitadas': false,
          });
        case 'PATCH /conta':
          conta = {...conta, ...(corpo as Map<String, dynamic>)};
          return _json(conta);
        case 'POST /auth/senha':
          return _json({
            'mensagem':
                'Senha alterada. Entre de novo — as sessões abertas foram encerradas.',
          });
        case 'GET /auth/seguranca':
          final atual = seguranca.first;
          if (seguranca.length > 1) seguranca.removeAt(0);
          return _json(atual);
        case 'POST /auth/seguranca/app/iniciar':
          return _json({'endereco': _endereco, 'segredo': _segredo});
        case 'POST /auth/seguranca/app/ativar':
          return _json(_seguranca(doisFatores: 'app'));
        case 'POST /auth/seguranca/email/codigo':
          return _json({
            'emailMascarado': 'ro***@misterburgers.com.br',
            'minutos': 10,
          });
        case 'POST /auth/seguranca/email/ativar':
          return _json(_seguranca(doisFatores: 'email', emailVerificado: true));
        case 'POST /auth/seguranca/desativar':
          return _json(_seguranca(emailVerificado: true));
        case 'POST /auth/senha/esqueci':
          return _json({
            'mensagem':
                'Se este e-mail tiver acesso ao RegemCast, o código chega em instantes. Ele vale por 10 minutos.',
          });
        case 'POST /auth/senha/redefinir':
          return _json({
            'mensagem':
                'Senha nova criada. Entre com ela — as sessões abertas em outros aparelhos foram encerradas.',
          });
        case 'POST /lista-espera':
          return _json({'mensagem': 'Pedido recebido.'});
        case 'GET /whatsapp/situacao':
          return _json(whatsapp);
        case 'GET /contatos':
          return _json({
            'total': totalContatos,
            'pagina': 1,
            'porPagina': 1,
            'itens': <Object>[],
          });
        case 'GET /whatsapp/modelos':
          return _json(modelos);
        case 'GET /campanhas':
          return _json(campanhas);
        case 'GET /plano':
          return _json({
            'status': 'inadimplente',
            'planos': <Object>[],
            'cobrancas': <Object>[],
            'uso': {'disparos': 0},
          });
      }
      return _json({});
    }),
  );

  int quantos(String pedido) => pedidos.where((p) => p == pedido).length;
  Object? ultimo(String pedido) => corpos[pedido]?.last;
}

class _SessaoFixa extends ControleSessao {
  _SessaoFixa(this.papel);
  final String papel;

  @override
  EstadoSessao build() => SessaoAtiva(
    Sessao.deJson({
      'usuario': {
        'id': 'u',
        'nome': 'Rodrigo Tavares',
        'email': 'rodrigo@misterburgers.com.br',
        'papel': papel,
      },
      'conta': {'id': 'c', 'nome': 'MISTER BURGERS', 'status': 'ativa'},
    }),
  );
}

/// Cofre em memória: o teste não tem o Keystore do Android.
class _CofreMemoria extends Cofre {
  _CofreMemoria() : super(const FlutterSecureStorage());

  String? token = 't';

  @override
  Future<String?> lerToken() async => token;
  @override
  Future<DateTime?> lerExpiraEm() async => null;
  @override
  Future<void> guardarSessao(String token, String? expiraEm) async =>
      this.token = token;
  @override
  Future<void> apagarSessao() async => token = null;
  @override
  Future<bool> biometriaLigada() async => false;
  @override
  Future<void> definirBiometria(bool ligada) async {}
  @override
  Future<bool> biometriaJaPerguntada() async => true;
  @override
  Future<String?> lerUltimoEmail() async => 'rodrigo@misterburgers.com.br';
  @override
  Future<void> guardarUltimoEmail(String email) async {}
}

class _AvisosQuietos extends ServicoPush {
  _AvisosQuietos(super.api);

  @override
  Future<void> ativar({
    void Function(RemoteMessage)? aoChegar,
    void Function(Map<String, dynamic>)? aoTocar,
  }) async {}
}

Widget _app(
  _Servidor s,
  Widget tela, {
  String? papel = 'dono',
  List<Uri>? abertos,
  bool autenticadorAbre = true,
}) => ProviderScope(
  retry: semRepeticao,
  overrides: [
    clienteApiProvider.overrideWithValue(s.api),
    cofreProvider.overrideWithValue(_CofreMemoria()),
    if (papel != null) sessaoProvider.overrideWith(() => _SessaoFixa(papel)),
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
    abrirForaDoAppProvider.overrideWithValue((uri) async {
      abertos?.add(uri);
      return autenticadorAbre;
    }),
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
  t.view.physicalSize = const Size(1080, 6000);
  t.view.devicePixelRatio = 2.625;
  addTearDown(t.view.reset);
}

Future<void> _assentar(WidgetTester t) async {
  for (var i = 0; i < 10; i++) {
    await t.pump(const Duration(milliseconds: 50));
  }
}

Future<void> _transicao(WidgetTester t) async {
  for (var i = 0; i < 20; i++) {
    await t.pump(const Duration(milliseconds: 100));
  }
}

Future<void> _abrir(
  WidgetTester t,
  _Servidor s,
  Widget tela, {
  String? papel = 'dono',
  List<Uri>? abertos,
  bool autenticadorAbre = true,
}) async {
  _telaAlta(t);
  await t.pumpWidget(
    _app(
      s,
      tela,
      papel: papel,
      abertos: abertos,
      autenticadorAbre: autenticadorAbre,
    ),
  );
  await _assentar(t);
}

/// Rola até o alvo, espera o quadro com a rolagem nova e só então toca.
Future<void> _tocar(WidgetTester t, Finder alvo) async {
  if (alvo.evaluate().isEmpty) {
    await t.scrollUntilVisible(
      alvo,
      300,
      scrollable: find.byType(Scrollable).first,
    );
  }
  await t.ensureVisible(alvo.first);
  await t.pump();
  await t.tap(alvo.first);
  await _assentar(t);
}

Finder _chave(String k) => find.byKey(ValueKey(k));

bool _habilitado(WidgetTester t, String chave) {
  final w = t.widget(_chave(chave));
  return switch (w) {
    FilledButton b => b.onPressed != null,
    OutlinedButton b => b.onPressed != null,
    TextButton b => b.onPressed != null,
    _ => throw StateError('não é botão: $chave'),
  };
}

/// O que o app pôs na área de transferência.
List<String> _escutarCopia(WidgetTester t) {
  final copiado = <String>[];
  t.binding.defaultBinaryMessenger.setMockMethodCallHandler(
    SystemChannels.platform,
    (call) async {
      if (call.method == 'Clipboard.setData') {
        copiado.add((call.arguments as Map)['text'] as String);
      }
      return null;
    },
  );
  addTearDown(
    () => t.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      SystemChannels.platform,
      null,
    ),
  );
  return copiado;
}

void main() {
  setUpAll(() => initializeDateFormatting('pt_BR'));

  group('regra de senha (a mesma do site e do servidor)', () {
    test('comprimento, letra e número — com o rótulo da tela', () {
      expect(
        erroDaSenha('curta1'),
        'A senha precisa ter pelo menos 10 caracteres.',
      );
      expect(
        erroDaSenha('1234567890'),
        'A senha precisa ter pelo menos uma letra.',
      );
      expect(
        erroDaSenha('abcdefghij', rotulo: 'A senha nova'),
        'A senha nova precisa ter pelo menos um número.',
      );
      expect(
        erroDaSenha('a1${'x' * 199}'),
        'A senha pode ter no máximo 200 caracteres.',
      );
      expect(erroDaSenha('uma frase que só você lembra 2026'), isNull);
    });

    test('letra é qualquer letra, como o \\p{L} do servidor', () {
      expect(erroDaSenha('ção e maçã 12'), isNull);
      expect(erroDaSenha('ΑΒΓΔΕΖΗΘΙ 1'), isNull);
      expect(
        erroDaSenha('1234567890!@#'),
        'A senha precisa ter pelo menos uma letra.',
      );
    });
  });

  group('Conta', () {
    testWidgets(
      'o dono vê a situação, o CNPJ só para ler e salva o descanso — sem mandar CNPJ',
      (t) async {
        final s = _Servidor();
        await _abrir(t, s, const TelaConta());

        expect(_chave('situacao-ativa'), findsOneWidget);
        expect(find.text('Ativa'), findsOneWidget);
        expect(find.text('Você é o dono'), findsOneWidget);
        expect(find.text('12.345.678/0001-95'), findsOneWidget);
        expect(
          find.textContaining('fale com o suporte'),
          findsOneWidget,
          reason: 'CNPJ conferido na Receita só muda pelo suporte',
        );
        expect(
          find.descendant(
            of: _chave('conta-cnpj'),
            matching: find.byType(TextField),
          ),
          findsNothing,
        );
        expect(_habilitado(t, 'salvar-conta'), isFalse);

        // Fora da faixa: a tela explica, e nada vai para o servidor.
        await t.enterText(_chave('conta-descanso'), '45');
        await _assentar(t);
        expect(_habilitado(t, 'salvar-conta'), isTrue);
        await _tocar(t, _chave('salvar-conta'));
        expect(
          find.text(
            'O descanso entre campanhas vai de 0 (desligado) a 30 dias.',
          ),
          findsOneWidget,
        );
        expect(s.quantos('PATCH /conta'), 0);

        await t.enterText(_chave('conta-descanso'), '7');
        await _tocar(t, _chave('salvar-conta'));
        expect(s.ultimo('PATCH /conta'), {
          'nome': 'MISTER BURGERS',
          'timezone': 'America/Sao_Paulo',
          'descansoMarketingDias': 7,
        });
        expect(find.text('Dados da conta atualizados.'), findsOneWidget);
        expect(s.quantos('GET /conta'), 2, reason: 'relê o que foi gravado');
      },
    );

    testWidgets('descartar volta ao que estava', (t) async {
      final s = _Servidor();
      await _abrir(t, s, const TelaConta());

      await t.enterText(_chave('conta-nome'), 'Outro nome');
      await t.enterText(_chave('conta-descanso'), '10');
      await _assentar(t);
      await _tocar(t, _chave('descartar-conta'));

      expect(
        t.widget<TextField>(_chave('conta-nome')).controller!.text,
        'MISTER BURGERS',
      );
      expect(
        t.widget<TextField>(_chave('conta-descanso')).controller!.text,
        '3',
      );
      expect(_habilitado(t, 'salvar-conta'), isFalse);
      expect(_chave('descartar-conta'), findsNothing);
    });

    testWidgets('o operador vê, mas não muda', (t) async {
      final s = _Servidor()
        ..conta = {..._Servidor().conta, 'status': 'suspensa'};
      await _abrir(t, s, const TelaConta(), papel: 'operador');

      expect(find.text('Você é operador'), findsOneWidget);
      expect(find.text('Suspensa'), findsOneWidget);
      expect(find.textContaining('Só o dono da conta altera'), findsOneWidget);
      expect(t.widget<TextField>(_chave('conta-nome')).enabled, isFalse);
      expect(t.widget<TextField>(_chave('conta-descanso')).enabled, isFalse);
      expect(_chave('salvar-conta'), findsNothing);
    });

    testWidgets('conta sem o campo de descanso: nem aparece, nem vai', (
      t,
    ) async {
      final base = _Servidor().conta..remove('descansoMarketingDias');
      final s = _Servidor()..conta = base;
      await _abrir(t, s, const TelaConta());

      expect(_chave('conta-descanso'), findsNothing);
      await t.enterText(_chave('conta-nome'), 'Mister Burgers Tijuca');
      await _tocar(t, _chave('salvar-conta'));
      expect(s.ultimo('PATCH /conta'), {
        'nome': 'Mister Burgers Tijuca',
        'timezone': 'America/Sao_Paulo',
      });
    });

    testWidgets(
      'trocar a senha segue a regra única e encerra a sessão deste aparelho',
      (t) async {
        final s = _Servidor();
        await _abrir(t, s, const TelaConta());

        await _tocar(t, _chave('trocar-senha'));
        await _transicao(t);
        await t.enterText(_chave('senha-atual'), 'senha antiga 2025');
        await t.enterText(_chave('senha-nova'), 'abcdefghij');
        await t.enterText(_chave('senha-repetir'), 'abcdefghij');
        await _tocar(t, _chave('salvar-senha'));
        expect(
          find.text('A senha nova precisa ter pelo menos um número.'),
          findsOneWidget,
        );
        expect(s.quantos('POST /auth/senha'), 0);

        await t.enterText(_chave('senha-nova'), 'senha nova 2026');
        await t.enterText(_chave('senha-repetir'), 'senha nova 2026');
        final container = ProviderScope.containerOf(
          t.element(find.byType(TelaConta)),
        );
        await _tocar(t, _chave('salvar-senha'));
        await _transicao(t);

        expect(s.ultimo('POST /auth/senha'), {
          'senhaAtual': 'senha antiga 2025',
          'senhaNova': 'senha nova 2026',
        });
        final estado = container.read(sessaoProvider);
        expect(estado, isA<SessaoAusente>());
        expect(
          (estado as SessaoAusente).aviso,
          'Senha trocada. Entre de novo com a senha nova.',
        );
      },
    );

    testWidgets('a segurança aparece na Conta e abre a tela das duas etapas', (
      t,
    ) async {
      final s = _Servidor();
      await _abrir(t, s, const TelaConta());

      expect(_chave('seguranca-desligada'), findsOneWidget);
      await _tocar(t, _chave('abrir-seguranca'));
      await _transicao(t);
      expect(find.byType(TelaSeguranca), findsOneWidget);
    });

    test('a situação da conta tem nome próprio', () {
      expect(rotuloDaSituacaoDaConta('aprovada'), 'Aprovada');
      expect(rotuloDaSituacaoDaConta('cancelada'), 'Cancelada');
      final d = DadosConta.deJson({
        'conta': {
          'nome': 'X',
          'status': 'suspensa',
          'descansoMarketingDias': 0,
        },
      });
      expect(d.status, 'suspensa');
      expect(d.descansoMarketingDias, 0);
      expect(DadosConta.deJson({'conta': {}}).descansoMarketingDias, isNull);
    });
  });

  group('Verificação em duas etapas', () {
    testWidgets(
      'aplicativo: um pedido só, abre o autenticador, copia a chave e ativa com código e senha',
      (t) async {
        final s = _Servidor()
          ..seguranca = [_seguranca(), _seguranca(doisFatores: 'app')];
        // Resposta que demora: o segundo toque chega com o primeiro no ar.
        s.respostas['POST /auth/seguranca/app/iniciar'] = (_) async {
          await Future<void>.delayed(const Duration(milliseconds: 300));
          return _json({'endereco': _endereco, 'segredo': _segredo});
        };
        final abertos = <Uri>[];
        final copiado = _escutarCopia(t);
        await _abrir(t, s, const TelaSeguranca(), abertos: abertos);

        expect(_chave('situacao-so-senha'), findsOneWidget);
        expect(find.text('Recomendado'), findsOneWidget);
        expect(
          find.textContaining('Vale só para rodrigo@misterburgers.com.br'),
          findsOneWidget,
        );
        expect(
          find.textContaining('E-mail ainda não verificado'),
          findsOneWidget,
        );

        await t.tap(_chave('configurar-aplicativo'));
        await t.tap(_chave('configurar-aplicativo'));
        await _transicao(t);
        expect(
          s.quantos('POST /auth/seguranca/app/iniciar'),
          1,
          reason:
              'duas chaves: a tela mostraria uma e o servidor guardaria outra',
        );

        expect(
          t.widget<SelectableText>(_chave('chave-autenticador')).data,
          'JBSW Y3DP EHPK 3PXP',
        );
        await _tocar(t, _chave('abrir-autenticador'));
        expect(abertos.single.toString(), _endereco);

        await _tocar(t, _chave('copiar-chave'));
        expect(copiado, [_segredo]);
        expect(
          find.text('Chave copiada. Cole no aplicativo autenticador.'),
          findsOneWidget,
        );

        await _tocar(t, _chave('ativar-seguranca'));
        expect(find.text('O código tem 6 dígitos.'), findsOneWidget);
        await t.enterText(_chave('codigo-seguranca'), '123456');
        await _tocar(t, _chave('ativar-seguranca'));
        expect(find.text('Informe a sua senha.'), findsOneWidget);
        expect(s.quantos('POST /auth/seguranca/app/ativar'), 0);

        await t.enterText(_chave('senha-seguranca'), 'minha senha 2026');
        await _tocar(t, _chave('ativar-seguranca'));
        expect(s.ultimo('POST /auth/seguranca/app/ativar'), {
          'codigo': '123456',
          'senha': 'minha senha 2026',
        });
        expect(
          find.text(
            'Pronto. No próximo login, vamos pedir o código do aplicativo.',
          ),
          findsOneWidget,
        );
        expect(_chave('situacao-protegido'), findsOneWidget);
        expect(find.text('Protegido · aplicativo'), findsOneWidget);
        expect(_chave('passos-aplicativo'), findsNothing);
        expect(
          s.quantos('GET /auth/seguranca'),
          2,
          reason: 'a Conta relê a mesma situação',
        );
      },
    );

    testWidgets('sem autenticador no celular: diz o que fazer', (t) async {
      final s = _Servidor();
      await _abrir(t, s, const TelaSeguranca(), autenticadorAbre: false);

      await _tocar(t, _chave('configurar-aplicativo'));
      await _tocar(t, _chave('abrir-autenticador'));
      expect(
        find.textContaining('Nenhum aplicativo autenticador abriu'),
        findsOneWidget,
      );
      expect(_chave('chave-autenticador'), findsOneWidget);
    });

    testWidgets('código errado: a frase do servidor, e a tela continua', (
      t,
    ) async {
      final s = _Servidor();
      s.respostas['POST /auth/seguranca/app/ativar'] = (_) async => _json({
        'mensagem': 'Código não confere. Confira o aplicativo e tente de novo.',
      }, 400);
      await _abrir(t, s, const TelaSeguranca());

      await _tocar(t, _chave('configurar-aplicativo'));
      await t.enterText(_chave('codigo-seguranca'), '000000');
      await t.enterText(_chave('senha-seguranca'), 'minha senha 2026');
      await _tocar(t, _chave('ativar-seguranca'));

      expect(
        t.widget<Text>(_chave('erro-seguranca')).data,
        'Código não confere. Confira o aplicativo e tente de novo.',
      );
      expect(_chave('passos-aplicativo'), findsOneWidget);
      expect(_chave('situacao-so-senha'), findsOneWidget);
    });

    testWidgets('e-mail: manda o código, reenvia e ativa', (t) async {
      final s = _Servidor();
      await _abrir(t, s, const TelaSeguranca());

      await _tocar(t, _chave('ativar-por-email'));
      expect(
        find.text(
          'Enviamos um código para ro***@misterburgers.com.br. Ele vale por 10 minutos.',
        ),
        findsOneWidget,
      );
      await _tocar(t, _chave('reenviar-codigo'));
      expect(s.quantos('POST /auth/seguranca/email/codigo'), 2);
      expect(
        find.text('Enviamos um código novo para ro***@misterburgers.com.br.'),
        findsOneWidget,
      );

      await t.enterText(_chave('codigo-seguranca'), '654321');
      await _tocar(t, _chave('ativar-seguranca'));
      expect(s.ultimo('POST /auth/seguranca/email/ativar'), {
        'codigo': '654321',
      });
      expect(
        find.text(
          'Pronto. No próximo login, vamos enviar um código para o seu e-mail.',
        ),
        findsOneWidget,
      );
      expect(find.text('Protegido · e-mail'), findsOneWidget);
      expect(find.text('E-mail verificado'), findsOneWidget);
    });

    testWidgets('desligar pede a senha', (t) async {
      final s = _Servidor()..seguranca = [_seguranca(doisFatores: 'app')];
      await _abrir(t, s, const TelaSeguranca());

      expect(
        find.text('A cada login pedimos o código do aplicativo autenticador.'),
        findsOneWidget,
      );
      await _tocar(t, _chave('desativar'));
      await _tocar(t, _chave('confirmar-desativar'));
      expect(find.text('Informe a sua senha.'), findsOneWidget);
      expect(s.quantos('POST /auth/seguranca/desativar'), 0);

      await t.enterText(_chave('senha-seguranca'), 'minha senha 2026');
      await _tocar(t, _chave('confirmar-desativar'));
      expect(s.ultimo('POST /auth/seguranca/desativar'), {
        'senha': 'minha senha 2026',
      });
      expect(
        find.text(
          'Verificação em duas etapas desligada. Sua conta volta a entrar só com a senha.',
        ),
        findsOneWidget,
      );
      expect(_chave('situacao-so-senha'), findsOneWidget);
      expect(_chave('configurar-aplicativo'), findsOneWidget);
    });

    testWidgets('servidor sem a chave do aplicativo: só o e-mail', (t) async {
      final s = _Servidor()..seguranca = [_seguranca(appDisponivel: false)];
      await _abrir(t, s, const TelaSeguranca());

      expect(find.text('Ainda não disponível neste servidor.'), findsOneWidget);
      expect(_chave('configurar-aplicativo'), findsNothing);
      expect(_chave('ativar-por-email'), findsOneWidget);
    });

    testWidgets('leitura que falha mostra o erro, nunca "só senha"', (t) async {
      final s = _Servidor();
      s.respostas['GET /auth/seguranca'] = (_) async =>
          _json({'mensagem': 'Não conseguimos falar com o servidor.'}, 503);
      await _abrir(t, s, const TelaSeguranca());

      expect(find.text('Não consegui ler a sua segurança'), findsOneWidget);
      expect(_chave('situacao-so-senha'), findsNothing);
      expect(s.quantos('GET /auth/seguranca'), 1, reason: 'sem repetição');
    });
  });

  group('Entrada', () {
    testWidgets(
      'esqueci a senha: e-mail, código e senha nova — e volta com o e-mail pronto',
      (t) async {
        final s = _Servidor();
        await _abrir(t, s, const TelaEntrar(), papel: null);

        await _tocar(t, _chave('esqueci-senha'));
        await _transicao(t);
        expect(find.byType(TelaRecuperarSenha), findsOneWidget);
        expect(
          t.widget<TextField>(_chave('email-recuperar')).controller!.text,
          'rodrigo@misterburgers.com.br',
          reason: 'o que estava na entrada vem junto',
        );

        await _tocar(t, _chave('enviar-codigo'));
        expect(s.ultimo('POST /auth/senha/esqueci'), {
          'email': 'rodrigo@misterburgers.com.br',
        });
        expect(find.text('Crie a senha nova'), findsOneWidget);
        expect(
          find.textContaining('o código chega em instantes'),
          findsOneWidget,
        );

        await t.enterText(_chave('codigo-recuperar'), '123456');
        await t.enterText(_chave('senha-recuperar'), 'abcdefghij');
        await _tocar(t, _chave('criar-senha-nova'));
        expect(
          find.text('A senha nova precisa ter pelo menos um número.'),
          findsOneWidget,
        );
        expect(s.quantos('POST /auth/senha/redefinir'), 0);

        await t.enterText(_chave('senha-recuperar'), 'senha nova 2026');
        await _tocar(t, _chave('criar-senha-nova'));
        expect(s.ultimo('POST /auth/senha/redefinir'), {
          'email': 'rodrigo@misterburgers.com.br',
          'codigo': '123456',
          'senhaNova': 'senha nova 2026',
        });
        expect(find.text('Senha nova criada'), findsOneWidget);

        await _tocar(t, _chave('entrar-com-senha-nova'));
        await _transicao(t);
        expect(find.byType(TelaRecuperarSenha), findsNothing);
        expect(
          find.descendant(
            of: _chave('aviso-entrada'),
            matching: find.textContaining('Senha nova criada'),
          ),
          findsOneWidget,
        );
      },
    );

    testWidgets('esqueci a senha: e-mail vazio, reenvio e código vencido', (
      t,
    ) async {
      final s = _Servidor();
      s.respostas['POST /auth/senha/redefinir'] = (_) async =>
          _json({'mensagem': 'Código inválido ou vencido. Peça um novo.'}, 400);
      await _abrir(t, s, const TelaRecuperarSenha(), papel: null);

      await _tocar(t, _chave('enviar-codigo'));
      expect(find.text('Informe o e-mail de acesso.'), findsOneWidget);
      expect(s.quantos('POST /auth/senha/esqueci'), 0);

      await t.enterText(_chave('email-recuperar'), 'ana@empresa.com.br');
      await _tocar(t, _chave('enviar-codigo'));
      await _tocar(t, _chave('reenviar-recuperar'));
      expect(s.quantos('POST /auth/senha/esqueci'), 2);
      expect(
        find.text('Pedimos outro código. Confira também o spam.'),
        findsOneWidget,
      );

      await t.enterText(_chave('codigo-recuperar'), '111111');
      await t.enterText(_chave('senha-recuperar'), 'senha nova 2026');
      await _tocar(t, _chave('criar-senha-nova'));
      expect(
        find.text('Código inválido ou vencido. Peça um novo.'),
        findsOneWidget,
      );
      expect(find.text('Senha nova criada'), findsNothing);
    });

    testWidgets(
      'lista de espera pelo app: manda origem "app" e só o preenchido',
      (t) async {
        final s = _Servidor();
        await _abrir(t, s, const TelaEntrar(), papel: null);

        await _tocar(t, _chave('abrir-lista-espera'));
        await _transicao(t);
        expect(find.byType(TelaListaEspera), findsOneWidget);

        await _tocar(t, _chave('entrar-na-lista'));
        expect(find.text('Informe seu nome.'), findsOneWidget);
        expect(s.quantos('POST /lista-espera'), 0);

        await t.enterText(_chave('lista-nome'), 'Ana Ribeiro');
        await t.enterText(_chave('lista-email'), 'ana@padariabomdia.com.br');
        await _tocar(t, _chave('entrar-na-lista'));
        expect(s.ultimo('POST /lista-espera'), {
          'nome': 'Ana Ribeiro',
          'email': 'ana@padariabomdia.com.br',
          'origem': 'app',
        });
        expect(find.text('Pedido registrado'), findsOneWidget);
        expect(find.textContaining('ana@padariabomdia.com.br'), findsOneWidget);

        await _tocar(t, _chave('voltar-da-lista'));
        await _transicao(t);
        expect(find.byType(TelaListaEspera), findsNothing);
        expect(find.byType(TelaEntrar), findsOneWidget);
      },
    );

    testWidgets('lista de espera: empresa, telefone e a frase do servidor', (
      t,
    ) async {
      final s = _Servidor();
      s.respostas['POST /lista-espera'] = (_) async => _json({
        'mensagem':
            'Informe um telefone válido com DDD, por exemplo 11 98765-4321.',
      }, 400);
      await _abrir(t, s, const TelaListaEspera(), papel: null);

      await t.enterText(_chave('lista-nome'), 'Ana');
      await t.enterText(_chave('lista-empresa'), '  Padaria Bom Dia ');
      await t.enterText(_chave('lista-email'), 'ana@padariabomdia.com.br');
      await t.enterText(_chave('lista-telefone'), '123');
      await _tocar(t, _chave('entrar-na-lista'));

      expect(s.ultimo('POST /lista-espera'), {
        'nome': 'Ana',
        'email': 'ana@padariabomdia.com.br',
        'empresa': 'Padaria Bom Dia',
        'telefone': '123',
        'origem': 'app',
      });
      expect(
        find.text(
          'Informe um telefone válido com DDD, por exemplo 11 98765-4321.',
        ),
        findsOneWidget,
      );
      expect(find.text('Pedido registrado'), findsNothing);
    });
  });

  group('Painel', () {
    Map<String, dynamic> conectado() => {
      'conectado': true,
      'conta': {'nome': 'Mister Burgers Ltda'},
      'numeros': [
        {
          'phoneNumberId': '1',
          'telefone': '+55 21 99999-8888',
          'qualidade': 'amarela',
          'tierLimite': 1000,
          'status': 'registrado',
        },
      ],
    };

    Map<String, dynamic> campanha(String status) => {
      'id': 'k-$status',
      'nome': 'Sexta do smash',
      'status': status,
      'total': 10,
      'porStatus': {'lida': 4},
      'criadoEm': '2026-09-26T18:00:00Z',
    };

    testWidgets(
      'conta nova: o caminho até o disparo em 0/4, sem perguntar à Meta',
      (t) async {
        final s = _Servidor();
        await _abrir(t, s, const Scaffold(body: TelaPainel()));

        expect(_chave('caminho-ate-o-disparo'), findsOneWidget);
        expect(find.text('0/4'), findsOneWidget);
        for (final p in ['numero', 'contatos', 'modelo', 'campanha']) {
          expect(_chave('passo-$p-falta'), findsOneWidget);
        }
        expect(
          find.descendant(
            of: _chave('indicador-contatos'),
            matching: find.text('0'),
          ),
          findsOneWidget,
        );
        expect(
          find.descendant(
            of: _chave('indicador-modelos'),
            matching: find.text('Conecte o número para ver os aprovados'),
          ),
          findsOneWidget,
        );
        expect(s.quantos('GET /whatsapp/modelos'), 0);
      },
    );

    testWidgets('no meio do caminho: 2/4, cada passo com o seu estado', (
      t,
    ) async {
      final s = _Servidor()
        ..whatsapp = conectado()
        ..totalContatos = 5
        ..modelos = [
          {'id': 'm', 'nome': 'boas_vindas', 'status': 'em análise'},
        ]
        ..campanhas = [campanha('rascunho')];
      await _abrir(t, s, const Scaffold(body: TelaPainel()));

      expect(find.text('2/4'), findsOneWidget);
      expect(_chave('passo-numero-feito'), findsOneWidget);
      expect(_chave('passo-contatos-feito'), findsOneWidget);
      expect(_chave('passo-modelo-falta'), findsOneWidget);
      expect(_chave('passo-campanha-falta'), findsOneWidget);
      expect(
        find.descendant(
          of: _chave('indicador-modelos'),
          matching: find.text('0'),
        ),
        findsOneWidget,
      );
      expect(
        find.text('Qualidade: Em atenção'),
        findsOneWidget,
        reason: 'os mesmos nomes da tela do WhatsApp',
      );
    });

    testWidgets('caminho feito: some, e os indicadores mostram os números', (
      t,
    ) async {
      final s = _Servidor()
        ..whatsapp = conectado()
        ..totalContatos = 1480
        ..modelos = [
          {'id': 'm', 'nome': 'boas_vindas', 'status': 'aprovado'},
          {'id': 'n', 'nome': 'cupom', 'status': 'recusado'},
        ]
        ..campanhas = [campanha('concluida')];
      await _abrir(t, s, const Scaffold(body: TelaPainel()));

      expect(_chave('caminho-ate-o-disparo'), findsNothing);
      expect(
        find.descendant(
          of: _chave('indicador-contatos'),
          matching: find.text('1.480'),
        ),
        findsOneWidget,
      );
      expect(
        find.descendant(
          of: _chave('indicador-modelos'),
          matching: find.text('1'),
        ),
        findsOneWidget,
      );
    });

    testWidgets('leitura que falha não vira passo por fazer nem zero', (
      t,
    ) async {
      final s = _Servidor();
      s.respostas['GET /contatos'] = (_) async =>
          _json({'mensagem': 'Falhou.'}, 500);
      await _abrir(t, s, const Scaffold(body: TelaPainel()));

      expect(_chave('caminho-ate-o-disparo'), findsNothing);
      expect(
        find.descendant(
          of: _chave('indicador-contatos'),
          matching: find.text('Não consegui ler agora.'),
        ),
        findsOneWidget,
      );
      expect(
        find.descendant(
          of: _chave('indicador-contatos'),
          matching: find.text('0'),
        ),
        findsNothing,
      );
    });

    testWidgets('o passo abre a tela do app e, na volta, o Painel relê', (
      t,
    ) async {
      final s = _Servidor();
      await _abrir(t, s, const Scaffold(body: TelaPainel()));
      final antes = s.quantos('GET /contatos');

      await _tocar(t, _chave('passo-contatos'));
      await _transicao(t);
      expect(find.byType(TelaImportarContatos), findsOneWidget);

      await t.pageBack();
      await _transicao(t);
      expect(s.quantos('GET /contatos'), antes + 1);
    });

    testWidgets(
      'o nome vem do resumo, os atalhos estão no topo e o aviso de pagamento abre o plano do app',
      (t) async {
        final s = _Servidor()
          ..conta = {..._Servidor().conta, 'nome': 'MISTER BURGERS TIJUCA'}
          ..statusAssinatura = 'inadimplente';
        await _abrir(t, s, const Scaffold(body: TelaPainel()));

        expect(find.text('MISTER BURGERS TIJUCA'), findsOneWidget);
        expect(_chave('painel-nova-campanha'), findsOneWidget);
        expect(_chave('painel-importar'), findsOneWidget);

        await _tocar(t, _chave('ver-plano'));
        await _transicao(t);
        expect(find.byType(TelaPlano), findsOneWidget);
        expect(s.quantos('GET /plano'), 1);
      },
    );
  });

  testWidgets(
    'mês grátis acabando: o aviso abre o plano do app — e, no build da Play, só informa',
    (t) async {
      final s = _Servidor()
        ..statusAssinatura = 'cortesia'
        ..gratisAte = DateTime.now()
            .add(const Duration(days: 3))
            .toUtc()
            .toIso8601String();
      await _abrir(t, s, const Scaffold(body: TelaPainel()));

      final aviso = _chave('aviso-gratis');
      expect(aviso, findsOneWidget);
      if (compraNoApp) {
        expect(
          find.descendant(
            of: aviso,
            matching: find.textContaining('Escolha um plano'),
          ),
          findsOneWidget,
        );
        expect(
          find.descendant(of: aviso, matching: find.text('Escolher plano')),
          findsOneWidget,
        );
      } else {
        // Build da Play: nada de chamar para pagar fora do faturamento dela.
        expect(
          find.descendant(of: aviso, matching: find.textContaining('Escolha')),
          findsNothing,
        );
        expect(
          find.descendant(of: aviso, matching: find.text('Ver plano')),
          findsOneWidget,
        );
      }

      await _tocar(t, _chave('escolher-plano'));
      await _transicao(t);
      expect(find.byType(TelaPlano), findsOneWidget);
      expect(s.quantos('GET /plano'), 1, reason: 'o plano do app, não o site');
    },
  );

  testWidgets(
    'quem usa o Regem: o Painel não avisa de cobrança e mostra "grátis pelo Regem"',
    (t) async {
      final s = _Servidor();
      s.respostas['GET /conta'] = (_) async => _json({
        'conta': s.conta,
        'plano': {
          'codigo': 'cortesia',
          'nome': 'Primeiro mês',
          'disparosMes': 5000,
        },
        'assinatura': {
          'status': 'inadimplente',
          'cicloInicio': '2026-09-17T00:00:00Z',
          'cicloFim': '2026-10-17T00:00:00Z',
          'gratisAte': '2026-09-01T00:00:00Z',
        },
        'uso': {'disparos': 6000, 'teto': null, 'restantes': null},
        'gratisPeloRegem': true,
        'conversasHabilitadas': false,
      });
      await _abrir(t, s, const Scaffold(body: TelaPainel()));

      expect(_chave('ver-plano'), findsNothing);
      expect(_chave('aviso-gratis'), findsNothing);
      expect(find.text('GRÁTIS PELO REGEM'), findsOneWidget);
      expect(find.text('Sem teto do plano'), findsOneWidget);
    },
  );

  testWidgets(
    'tela Plano de quem usa o Regem: grátis, sem a lista de planos nem o informativo',
    (t) async {
      final s = _Servidor();
      s.respostas['GET /plano'] = (_) async => _json({
        'status': 'cortesia',
        'gratisAte': '2026-09-01T00:00:00Z',
        'cicloFim': '2026-10-17T00:00:00Z',
        'gratisPeloRegem': true,
        'cobrancaDisponivel': true,
        'planos': [
          {
            'id': 'p1',
            'nome': 'Essencial',
            'disparosMes': 5000,
            'precoCentavos': 3000,
          },
        ],
        'cobrancas': <Object>[],
        'uso': {'disparos': 6000, 'teto': null},
      });
      await _abrir(t, s, const TelaPlano());

      expect(find.textContaining('Você usa o Regem'), findsOneWidget);
      expect(find.text('Grátis pelo Regem'), findsOneWidget);
      expect(find.textContaining('sem teto do plano'), findsOneWidget);
      expect(find.text('Planos'), findsNothing);
      expect(find.text('Essencial'), findsNothing);
      expect(_chave('informativo-regem'), findsNothing);
    },
  );

  testWidgets(
    'tela Plano de quem não usa o Regem: o informativo dos 30 dias e do Regem leva às Integrações',
    (t) async {
      final s = _Servidor();
      s.respostas['GET /plano'] = (_) async => _json({
        'status': 'cortesia',
        'gratisAte': '2026-10-20T00:00:00Z',
        'disparosParamEm': '2026-10-25T00:00:00Z',
        'cicloFim': '2026-10-17T00:00:00Z',
        'cobrancaDisponivel': true,
        'planos': [
          {
            'id': 'p1',
            'nome': 'Essencial',
            'disparosMes': 5000,
            'precoCentavos': 3000,
          },
        ],
        'cobrancas': <Object>[],
        'uso': {'disparos': 10, 'teto': 5000},
      });
      await _abrir(t, s, const TelaPlano());

      final informativo = _chave('informativo-regem');
      expect(informativo, findsOneWidget);
      expect(
        find.descendant(
          of: informativo,
          matching: find.textContaining(
            'Toda conta começa com 30 dias grátis. Usa o Regem? Você não paga o Regemcast',
          ),
        ),
        findsOneWidget,
      );
      expect(find.text('Planos'), findsOneWidget);
      await _tocar(t, _chave('ver-integracoes'));
      await _transicao(t);
      expect(find.byType(TelaIntegracoes), findsOneWidget);
    },
  );

  testWidgets('Mais: "Excluir a conta" está lá, como a Play pede', (t) async {
    final s = _Servidor();
    await _abrir(t, s, const Casca(abaInicial: Aba.mais));
    await t.scrollUntilVisible(
      _chave('mais-excluir-conta'),
      300,
      scrollable: find.byType(Scrollable).first,
    );
    expect(_chave('mais-excluir-conta'), findsOneWidget);
  });

  test('a chave do autenticador sai em grupos de 4', () {
    expect(
      const CadastroDoAplicativo(
        endereco: _endereco,
        segredo: _segredo,
      ).segredoEmGrupos,
      'JBSW Y3DP EHPK 3PXP',
    );
    expect(
      const CadastroDoAplicativo(
        endereco: '',
        segredo: 'ABCDEF',
      ).segredoEmGrupos,
      'ABCD EF',
    );
  });
}
