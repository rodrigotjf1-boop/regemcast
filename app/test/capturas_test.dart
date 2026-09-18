// Capturas das telas, renderizadas pelo próprio motor do Flutter no tamanho de
// um celular (412×915, densidade 2,625 — um Pixel 7). Servem para conferir o
// visual sem emulador e como base das imagens da ficha na Play Store.
//
// Não rodam no `flutter test` comum: só com a variável CAPTURAS=1, e gravam em
// test/_capturas/ (fora do Git).
//   CAPTURAS=1 flutter test test/capturas_test.dart --update-goldens
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:regemcast/api/cliente_api.dart';
import 'package:regemcast/api/dados.dart';
import 'package:regemcast/sessao/cofre.dart';
import 'package:regemcast/sessao/sessao.dart';
import 'package:regemcast/telas/casca.dart';
import 'package:regemcast/telas/entrar.dart';
import 'package:regemcast/tema/tema.dart';

http.Response _json(Object corpo, [int status = 200]) => http.Response.bytes(
  utf8.encode(jsonEncode(corpo)),
  status,
  headers: {'content-type': 'application/json; charset=utf-8'},
);

Future<void> _carregarFontes() async {
  Future<void> carregar(String familia, List<String> arquivos) async {
    final loader = FontLoader(familia);
    for (final a in arquivos) {
      loader.addFont(Future.value(ByteData.view(File(a).readAsBytesSync().buffer)));
    }
    await loader.load();
  }

  await carregar('Poppins', [
    'assets/fonts/Poppins-Regular.ttf',
    'assets/fonts/Poppins-Medium.ttf',
    'assets/fonts/Poppins-SemiBold.ttf',
    'assets/fonts/Poppins-Bold.ttf',
  ]);
  final raizFlutter = File(Platform.resolvedExecutable).parent.parent.parent.parent.parent.parent.path;
  await carregar('MaterialIcons', ['$raizFlutter/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf']);
}

class _CofreMemoria extends Cofre {
  _CofreMemoria() : super(const FlutterSecureStorage());
  @override
  Future<String?> lerToken() async => 'x';
  @override
  Future<DateTime?> lerExpiraEm() async => null;
  @override
  Future<void> guardarSessao(String token, String? expiraEm) async {}
  @override
  Future<void> apagarSessao() async {}
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

/// Dados de exemplo — uma hamburgueria no meio de uma campanha de sexta.
final _api = ClienteApi(
  base: 'https://api.teste',
  http: MockClient((req) async {
    switch (req.url.path) {
      case '/auth/eu':
        return _json({
          'usuario': {'id': 'u', 'nome': 'Rodrigo Tavares', 'email': 'rodrigo@misterburgers.com.br', 'papel': 'dono'},
          'conta': {'id': 'c', 'nome': 'MISTER BURGERS', 'status': 'ativa'},
        });
      case '/conta':
        return _json({
          'conta': {'nome': 'MISTER BURGERS'},
          'plano': {'codigo': 'profissional', 'nome': 'Profissional', 'disparosMes': 20000},
          'assinatura': {'status': 'ativa', 'cicloInicio': '2026-09-17T00:00:00Z', 'cicloFim': '2026-10-17T00:00:00Z', 'gratisAte': null},
          'uso': {'disparos': 12480, 'teto': 20000, 'restantes': 7520},
        });
      case '/whatsapp/situacao':
        return _json({
          'conectado': true,
          'numeros': [
            {'telefone': '+55 21 99999-8888', 'nome': 'Mister Burgers', 'qualidade': 'verde', 'tierLimite': 10000, 'status': 'registrado'},
          ],
        });
      case '/campanhas':
        final agora = DateTime.now().toUtc();
        return _json([
          {
            'id': '1', 'nome': 'Sexta do Smash', 'modeloNome': 'promo_sexta_smash', 'status': 'enviando', 'listaNome': 'Clientes 2026',
            'criadoEm': agora.subtract(const Duration(minutes: 40)).toIso8601String(),
            'porStatus': {'lida': 1320, 'entregue': 1540, 'enviada': 410, 'falhou': 38, 'pendente': 1692}, 'total': 5000,
          },
          {
            'id': '2', 'nome': 'Combo família', 'modeloNome': 'combo_familia', 'status': 'pausada', 'pausaMotivo': 'manual',
            'criadoEm': agora.subtract(const Duration(days: 1)).toIso8601String(),
            'porStatus': {'lida': 600, 'entregue': 900, 'enviada': 100, 'falhou': 12, 'pendente': 388}, 'total': 2000,
          },
          {
            'id': '3', 'nome': 'Aniversariantes de setembro', 'modeloNome': 'aniversario', 'status': 'concluida',
            'criadoEm': agora.subtract(const Duration(days: 3)).toIso8601String(),
            'porStatus': {'lida': 210, 'entregue': 160, 'falhou': 4}, 'total': 374,
          },
        ]);
    }
    return _json({});
  }),
);

Future<void> _capturar(WidgetTester tester, Widget tela, String nome, {Brightness brilho = Brightness.light}) async {
  tester.view.physicalSize = const Size(1080, 2400);
  tester.view.devicePixelRatio = 2.625;
  addTearDown(tester.view.reset);

  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        clienteApiProvider.overrideWithValue(_api),
        cofreProvider.overrideWithValue(_CofreMemoria()),
      ],
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: temaDoApp(brilho),
        home: MediaQuery(
          data: const MediaQueryData(padding: EdgeInsets.only(top: 24), disableAnimations: true),
          child: tela,
        ),
      ),
    ),
  );
  for (var i = 0; i < 20; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
  await expectLater(find.byType(MaterialApp), matchesGoldenFile('_capturas/$nome.png'));
}

void main() {
  final ativo = Platform.environment['CAPTURAS'] == '1';

  setUpAll(() async {
    if (!ativo) return;
    await initializeDateFormatting('pt_BR');
    await _carregarFontes();
  });

  testWidgets('entrar', (t) => _capturar(t, const TelaEntrar(), '01-entrar'), skip: !ativo);

  testWidgets('entrar — escuro', (t) => _capturar(t, const TelaEntrar(), '02-entrar-escuro', brilho: Brightness.dark), skip: !ativo);

  testWidgets('painel', (t) async {
    await _capturar(t, const _ComSessao(child: Casca()), '03-painel');
  }, skip: !ativo);

  testWidgets('painel — escuro', (t) async {
    await _capturar(t, const _ComSessao(child: Casca()), '04-painel-escuro', brilho: Brightness.dark);
  }, skip: !ativo);
}

/// A casca lê a sessão ativa; aqui ela é posta direto, sem passar pelo login.
class _ComSessao extends ConsumerWidget {
  const _ComSessao({required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final estado = ref.watch(sessaoProvider);
    if (estado is! SessaoAtiva) {
      Future.microtask(() {
        ref.read(sessaoProvider.notifier).state = SessaoAtiva(
          Sessao.deJson({
            'usuario': {'id': 'u', 'nome': 'Rodrigo Tavares', 'email': 'rodrigo@misterburgers.com.br', 'papel': 'dono'},
            'conta': {'id': 'c', 'nome': 'MISTER BURGERS', 'status': 'ativa'},
          }),
        );
      });
      return const SizedBox.shrink();
    }
    return child;
  }
}
