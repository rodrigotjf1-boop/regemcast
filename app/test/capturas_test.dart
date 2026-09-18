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
import 'package:regemcast/api/modelos.dart';
import 'package:regemcast/sessao/cofre.dart';
import 'package:regemcast/sessao/sessao.dart';
import 'package:regemcast/telas/campanha_detalhe.dart';
import 'package:regemcast/telas/campanhas.dart';
import 'package:regemcast/telas/casca.dart';
import 'package:regemcast/telas/contatos.dart';
import 'package:regemcast/telas/entrar.dart';
import 'package:regemcast/telas/importar_contatos.dart';
import 'package:regemcast/telas/modelo_detalhe.dart';
import 'package:regemcast/telas/modelo_editar.dart';
import 'package:regemcast/telas/modelos.dart';
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
      loader.addFont(
        Future.value(ByteData.view(File(a).readAsBytesSync().buffer)),
      );
    }
    await loader.load();
  }

  await carregar('Poppins', [
    'assets/fonts/Poppins-Regular.ttf',
    'assets/fonts/Poppins-Medium.ttf',
    'assets/fonts/Poppins-SemiBold.ttf',
    'assets/fonts/Poppins-Bold.ttf',
  ]);
  final raizFlutter = File(
    Platform.resolvedExecutable,
  ).parent.parent.parent.parent.parent.parent.path;
  await carregar('MaterialIcons', [
    '$raizFlutter/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf',
  ]);
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
          'usuario': {
            'id': 'u',
            'nome': 'Rodrigo Tavares',
            'email': 'rodrigo@misterburgers.com.br',
            'papel': 'dono',
          },
          'conta': {'id': 'c', 'nome': 'MISTER BURGERS', 'status': 'ativa'},
        });
      case '/conta':
        return _json({
          'conta': {'nome': 'MISTER BURGERS'},
          'plano': {
            'codigo': 'profissional',
            'nome': 'Profissional',
            'disparosMes': 20000,
          },
          'assinatura': {
            'status': 'ativa',
            'cicloInicio': '2026-09-17T00:00:00Z',
            'cicloFim': '2026-10-17T00:00:00Z',
            'gratisAte': null,
          },
          'uso': {'disparos': 12480, 'teto': 20000, 'restantes': 7520},
        });
      case '/whatsapp/situacao':
        return _json({
          'conectado': true,
          'numeros': [
            {
              'telefone': '+55 21 99999-8888',
              'nome': 'Mister Burgers',
              'qualidade': 'verde',
              'tierLimite': 10000,
              'status': 'registrado',
            },
          ],
        });
      case '/whatsapp/modelos':
        return _json(_modelosMeta);
      case '/modelos':
        return _json(_modelosSalvos);
      case '/contatos/listas':
        return _json([
          {'id': 'l1', 'nome': 'Clientes 2026', 'total': 4820},
          {'id': 'l2', 'nome': 'Aniversariantes', 'total': 374},
          {'id': 'l3', 'nome': 'Delivery Zona Sul', 'total': 1290},
        ]);
      case '/contatos':
        return _json({
          'total': 6484,
          'pagina': 1,
          'porPagina': 50,
          'itens': [
            {'id': 'k1', 'nome': 'Ana Beatriz Souza', 'telefone': '5521991112222', 'optOut': false},
            {'id': 'k2', 'nome': 'Carlos Menezes', 'telefone': '5521983334444', 'optOut': false},
            {'id': 'k3', 'nome': null, 'telefone': '5511975556666', 'optOut': false},
            {'id': 'k4', 'nome': 'Fernanda Lima', 'telefone': '5521967778888', 'optOut': true},
            {'id': 'k5', 'nome': 'João Pedro Alves', 'telefone': '5521959990000', 'optOut': false},
            {'id': 'k6', 'nome': 'Marina Costa', 'telefone': '5521941213141', 'optOut': false},
            {'id': 'k7', 'nome': 'Rafael Nunes', 'telefone': '5524988776655', 'optOut': false},
          ],
        });
      case '/campanhas/1':
        return _json({
          'id': '1', 'nome': 'Sexta do Smash', 'modeloNome': 'promo_sexta_smash', 'modeloIdioma': 'pt_BR', 'status': 'enviando',
          'listaNome': 'Clientes 2026', 'criadoEm': DateTime.now().toUtc().subtract(const Duration(minutes: 40)).toIso8601String(),
          'iniciadaEm': DateTime.now().toUtc().subtract(const Duration(minutes: 35)).toIso8601String(),
          'porStatus': {'lida': 1320, 'entregue': 1540, 'enviada': 410, 'falhou': 38, 'pendente': 1692}, 'total': 5000,
          'janelaDias': [1, 2, 3, 4, 5], 'janelaInicio': '09:00:00', 'janelaFim': '20:00:00', 'pausaSegundos': 2, 'maxPorDia': 3000,
        });
      case '/campanhas/1/destinatarios':
        final agora = DateTime.now().toUtc();
        return _json([
          {'id': 'a', 'telefone': '5521987654321', 'status': 'falhou', 'erroTitulo': 'Número sem WhatsApp', 'erroDetalhe': 'A Meta não encontrou uma conta de WhatsApp neste número.', 'falhouEm': agora.subtract(const Duration(minutes: 20)).toIso8601String()},
          {'id': 'b', 'telefone': '5521991112222', 'status': 'lida', 'lidaEm': agora.subtract(const Duration(minutes: 8)).toIso8601String()},
          {'id': 'c', 'telefone': '5511983334444', 'status': 'entregue', 'entregueEm': agora.subtract(const Duration(minutes: 12)).toIso8601String()},
          {'id': 'd', 'telefone': '5521975556666', 'status': 'enviada', 'enviadaEm': agora.subtract(const Duration(minutes: 2)).toIso8601String()},
          {'id': 'e', 'telefone': '5521967778888', 'status': 'pendente'},
        ]);
      case '/campanhas':
        final agora = DateTime.now().toUtc();
        return _json([
          {
            'id': '1',
            'nome': 'Sexta do Smash',
            'modeloNome': 'promo_sexta_smash',
            'status': 'enviando',
            'listaNome': 'Clientes 2026',
            'criadoEm': agora
                .subtract(const Duration(minutes: 40))
                .toIso8601String(),
            'porStatus': {
              'lida': 1320,
              'entregue': 1540,
              'enviada': 410,
              'falhou': 38,
              'pendente': 1692,
            },
            'total': 5000,
          },
          {
            'id': '2',
            'nome': 'Combo família',
            'modeloNome': 'combo_familia',
            'status': 'pausada',
            'pausaMotivo': 'manual',
            'criadoEm': agora
                .subtract(const Duration(days: 1))
                .toIso8601String(),
            'porStatus': {
              'lida': 600,
              'entregue': 900,
              'enviada': 100,
              'falhou': 12,
              'pendente': 388,
            },
            'total': 2000,
          },
          {
            'id': '3',
            'nome': 'Aniversariantes de setembro',
            'modeloNome': 'aniversario',
            'status': 'concluida',
            'criadoEm': agora
                .subtract(const Duration(days: 3))
                .toIso8601String(),
            'porStatus': {'lida': 210, 'entregue': 160, 'falhou': 4},
            'total': 374,
          },
        ]);
    }
    return _json({});
  }),
);

final _modelosSalvos = [
  {
    'id': 'm1', 'tipo': 'simples', 'nome': 'promo_sexta_smash', 'idioma': 'pt_BR', 'categoria': 'MARKETING',
    'status': 'aprovado', 'cabecalhoFormato': 'TEXT', 'cabecalhoTexto': 'Sexta do Smash 🍔',
    'corpo': 'Oi, {{1}}! Hoje o Smash duplo sai por R\$ {{2}} até as 23h. Peça pelo app ou venha buscar.',
    'corpoExemplos': ['Ana', '29,90'], 'rodape': 'Mister Burgers',
    'botoes': [
      {'tipo': 'URL', 'texto': 'Pedir agora', 'url': 'https://misterburgers.com.br/pedir'},
      {'tipo': 'QUICK_REPLY', 'texto': 'Quero o combo'},
    ],
    'metaTemplateId': 't1', 'variaveis': 2,
  },
  {
    'id': 'm2', 'tipo': 'simples', 'nome': 'combo_familia_v2', 'idioma': 'pt_BR', 'categoria': 'MARKETING',
    'status': 'rascunho', 'corpo': 'Domingo em família: 4 burgers + 2 fritas grandes por R\$ {{1}}.',
    'corpoExemplos': ['119,90'], 'botoes': [], 'variaveis': 1,
  },
  {
    'id': 'm3', 'tipo': 'simples', 'nome': 'aviso_pedido', 'idioma': 'pt_BR', 'categoria': 'UTILITY',
    'status': 'enviado', 'corpo': 'Seu pedido {{1}} saiu para entrega.', 'corpoExemplos': ['#1042'],
    'botoes': [], 'metaTemplateId': 't3', 'variaveis': 1,
  },
];

final _modelosMeta = [
  {
    'id': 't1', 'nome': 'promo_sexta_smash', 'idioma': 'pt_BR', 'categoria': 'MARKETING', 'status': 'aprovado',
    'cabecalho': 'Sexta do Smash 🍔',
    'corpo': 'Oi, {{1}}! Hoje o Smash duplo sai por R\$ {{2}} até as 23h. Peça pelo app ou venha buscar.',
    'rodape': 'Mister Burgers', 'variaveis': 2, 'botoes': ['Pedir agora', 'Quero o combo', 'Parar promoções'],
  },
  {
    'id': 't3', 'nome': 'aviso_pedido', 'idioma': 'pt_BR', 'categoria': 'UTILITY', 'status': 'em análise',
    'corpo': 'Seu pedido {{1}} saiu para entrega.', 'variaveis': 1, 'botoes': [],
  },
  {
    'id': 't9', 'nome': 'boas_vindas_antigo', 'idioma': 'pt_BR', 'categoria': 'MARKETING', 'status': 'recusado',
    'motivo': 'Conteúdo promocional em categoria errada.',
    'corpo': 'Bem-vindo ao clube Mister Burgers! Use o cupom BEMVINDO.', 'variaveis': 0, 'botoes': [],
  },
];

Future<void> _capturar(
  WidgetTester tester,
  Widget tela,
  String nome, {
  Brightness brilho = Brightness.light,
}) async {
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
          data: const MediaQueryData(
            padding: EdgeInsets.only(top: 24),
            disableAnimations: true,
          ),
          child: tela,
        ),
      ),
    ),
  );
  for (var i = 0; i < 20; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
  await expectLater(
    find.byType(MaterialApp),
    matchesGoldenFile('_capturas/$nome.png'),
  );
}

void main() {
  final ativo = Platform.environment['CAPTURAS'] == '1';

  setUpAll(() async {
    if (!ativo) return;
    await initializeDateFormatting('pt_BR');
    await _carregarFontes();
  });

  testWidgets(
    'entrar',
    (t) => _capturar(t, const TelaEntrar(), '01-entrar'),
    skip: !ativo,
  );

  testWidgets(
    'entrar — escuro',
    (t) => _capturar(
      t,
      const TelaEntrar(),
      '02-entrar-escuro',
      brilho: Brightness.dark,
    ),
    skip: !ativo,
  );

  testWidgets('painel', (t) async {
    await _capturar(t, const _ComSessao(child: Casca()), '03-painel');
  }, skip: !ativo);

  testWidgets('painel — escuro', (t) async {
    await _capturar(
      t,
      const _ComSessao(child: Casca()),
      '04-painel-escuro',
      brilho: Brightness.dark,
    );
  }, skip: !ativo);

  testWidgets('campanhas', (t) async {
    await _capturar(t, const Scaffold(body: TelaCampanhas()), '05-campanhas');
  }, skip: !ativo);

  testWidgets('campanha', (t) async {
    await _capturar(t, const TelaCampanhaDetalhe(id: '1', nomeInicial: 'Sexta do Smash'), '06-campanha');
  }, skip: !ativo);

  testWidgets('modelos', (t) async {
    await _capturar(t, const Scaffold(body: TelaModelos()), '08-modelos');
  }, skip: !ativo);

  testWidgets('modelo', (t) async {
    await _capturar(
      t,
      TelaModeloDetalhe(
        meta: ModeloNaMeta.deJson(_modelosMeta[0]),
        local: ModeloSalvo.deJson(_modelosSalvos[0]),
      ),
      '09-modelo',
    );
  }, skip: !ativo);

  testWidgets('modelo — escuro', (t) async {
    await _capturar(
      t,
      TelaModeloDetalhe(
        meta: ModeloNaMeta.deJson(_modelosMeta[0]),
        local: ModeloSalvo.deJson(_modelosSalvos[0]),
      ),
      '10-modelo-escuro',
      brilho: Brightness.dark,
    );
  }, skip: !ativo);

  testWidgets('modelo — editar', (t) async {
    await _capturar(
      t,
      TelaEditarModelo(modelo: ModeloSalvo.deJson(_modelosSalvos[0])),
      '11-modelo-editar',
    );
  }, skip: !ativo);

  testWidgets('contatos', (t) async {
    await _capturar(t, const Scaffold(body: TelaContatos()), '12-contatos');
  }, skip: !ativo);

  testWidgets('contatos — escuro', (t) async {
    await _capturar(t, const Scaffold(body: TelaContatos()), '13-contatos-escuro', brilho: Brightness.dark);
  }, skip: !ativo);

  testWidgets('importar', (t) async {
    await _capturar(t, const TelaImportarContatos(), '14-importar');
  }, skip: !ativo);

  testWidgets('campanha — escuro', (t) async {
    await _capturar(t, const TelaCampanhaDetalhe(id: '1', nomeInicial: 'Sexta do Smash'), '07-campanha-escuro', brilho: Brightness.dark);
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
            'usuario': {
              'id': 'u',
              'nome': 'Rodrigo Tavares',
              'email': 'rodrigo@misterburgers.com.br',
              'papel': 'dono',
            },
            'conta': {'id': 'c', 'nome': 'MISTER BURGERS', 'status': 'ativa'},
          }),
        );
      });
      return const SizedBox.shrink();
    }
    return child;
  }
}
