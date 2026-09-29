// Capturas das telas, renderizadas pelo próprio motor do Flutter no tamanho de
// um celular (412×915, densidade 2,625 — um Pixel 7). Servem para conferir o
// visual sem emulador e como base das imagens da ficha na Play Store.
//
// Não rodam no `flutter test` comum: só com a variável CAPTURAS=1, e gravam em
// test/_capturas/ (fora do Git).
//   CAPTURAS=1 flutter test test/capturas_test.dart --update-goldens
import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;

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
import 'package:regemcast/push/push.dart';
import 'package:regemcast/sessao/cofre.dart';
import 'package:regemcast/sessao/sessao.dart';
import 'package:regemcast/telas/campanha_detalhe.dart';
import 'package:regemcast/telas/campanhas.dart';
import 'package:regemcast/telas/casca.dart';
import 'package:regemcast/telas/conta.dart';
import 'package:regemcast/telas/contatos.dart';
import 'package:regemcast/telas/entrar.dart';
import 'package:regemcast/telas/importar_contatos.dart';
import 'package:regemcast/telas/modelo_detalhe.dart';
import 'package:regemcast/telas/modelo_editor.dart';
import 'package:regemcast/telas/modelos.dart';
import 'package:regemcast/telas/plano.dart';
import 'package:regemcast/telas/regras.dart';
import 'package:regemcast/telas/usuarios.dart';
import 'package:regemcast/telas/whatsapp.dart';
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
          'conta': {
            'nome': 'MISTER BURGERS',
            'cnpj': '12345678000195',
            'timezone': 'America/Sao_Paulo',
          },
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
          'conta': {'nome': 'Mister Burgers Ltda'},
          'numeros': [
            {
              'telefone': '+55 21 99999-8888',
              'nome': 'Mister Burgers',
              'qualidade': 'verde',
              'tierLimite': 10000,
              'status': 'registrado',
              'coexistencia': true,
              'vazaoMaxima': 20,
              'sincronizacao': 'concluida',
            },
          ],
        });
      case '/plano':
        return _json({
          'status': 'ativa',
          'cicloInicio': '2026-09-17T03:00:00Z',
          'cicloFim': '2026-10-17T03:00:00Z',
          'bloqueado': false,
          'mpStatus': 'authorized',
          'cobrancaDisponivel': true,
          'planoAtual': {
            'id': 'p2',
            'nome': 'Profissional',
            'disparosMes': 20000,
            'precoCentavos': 29900,
          },
          'uso': {'disparos': 12480, 'teto': 20000},
          'planos': [
            {
              'id': 'p1',
              'nome': 'Essencial',
              'disparosMes': 5000,
              'precoCentavos': 9900,
            },
            {
              'id': 'p2',
              'nome': 'Profissional',
              'disparosMes': 20000,
              'precoCentavos': 29900,
            },
            {
              'id': 'p3',
              'nome': 'Escala',
              'disparosMes': 60000,
              'precoCentavos': 69900,
            },
          ],
          'cobrancas': [
            {
              'id': 'c2',
              'valorCentavos': 29900,
              'status': 'aprovada',
              'pagoEm': '2026-09-17T12:00:00Z',
              'plano': 'Profissional',
              'criadoEm': '2026-09-17T12:00:00Z',
            },
            {
              'id': 'c1',
              'valorCentavos': 29900,
              'status': 'recusada',
              'motivo': 'Cartão sem limite.',
              'vencimento': '2026-08-17T12:00:00Z',
              'plano': 'Profissional',
              'criadoEm': '2026-08-17T12:00:00Z',
            },
          ],
        });
      case '/conta/usuarios':
        return _json([
          {
            'id': 'u',
            'nome': 'Rodrigo Tavares',
            'email': 'rodrigo@misterburgers.com.br',
            'papel': 'dono',
            'status': 'ativo',
            'ultimoLoginEm': DateTime.now().toUtc().toIso8601String(),
          },
          {
            'id': 'u2',
            'nome': 'Ana Ribeiro',
            'email': 'ana@misterburgers.com.br',
            'papel': 'operador',
            'status': 'ativo',
            'ultimoLoginEm': DateTime.now()
                .toUtc()
                .subtract(const Duration(days: 2))
                .toIso8601String(),
          },
          {
            'id': 'u3',
            'nome': 'Bruno Lima',
            'email': 'bruno@misterburgers.com.br',
            'papel': 'operador',
            'status': 'suspenso',
          },
        ]);
      case '/whatsapp/modelos':
        return _json(_modelosMeta);
      case '/modelos':
        return _json(_modelosSalvos);
      case '/modelos/conferir':
        final nome =
            (jsonDecode(utf8.decode(req.bodyBytes)) as Map)['nome'] as String?;
        return _json({
          'problemas': nome == 'cupom_boas_vindas'
              ? [
                  {
                    'campo': 'corpo',
                    'mensagem':
                        'A mensagem não pode terminar com uma variável. Escreva algo depois dela.',
                  },
                  {
                    'campo': 'corpo',
                    'mensagem':
                        'Preencha um exemplo para cada variável: são 1, e você informou 0. A Meta recusa o modelo sem eles.',
                  },
                  {
                    'campo': 'botoes',
                    'mensagem':
                        'O botão de link precisa de um endereço https completo.',
                  },
                ]
              : <Object>[],
        }, 201);
      case '/midia/foto1':
        return http.Response.bytes(_fotos[0], 200);
      case '/midia/foto2':
        return http.Response.bytes(_fotos[1], 200);
      case '/midia/foto3':
        return http.Response.bytes(_fotos[2], 200);
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
            {
              'id': 'k1',
              'nome': 'Ana Beatriz Souza',
              'telefone': '5521991112222',
              'optOut': false,
            },
            {
              'id': 'k2',
              'nome': 'Carlos Menezes',
              'telefone': '5521983334444',
              'optOut': false,
            },
            {
              'id': 'k3',
              'nome': null,
              'telefone': '5511975556666',
              'optOut': false,
            },
            {
              'id': 'k4',
              'nome': 'Fernanda Lima',
              'telefone': '5521967778888',
              'optOut': true,
            },
            {
              'id': 'k5',
              'nome': 'João Pedro Alves',
              'telefone': '5521959990000',
              'optOut': false,
            },
            {
              'id': 'k6',
              'nome': 'Marina Costa',
              'telefone': '5521941213141',
              'optOut': false,
            },
            {
              'id': 'k7',
              'nome': 'Rafael Nunes',
              'telefone': '5524988776655',
              'optOut': false,
            },
          ],
        });
      case '/campanhas/1':
        return _json({
          'id': '1',
          'nome': 'Sexta do Smash',
          'modeloNome': 'promo_sexta_smash',
          'modeloIdioma': 'pt_BR',
          'status': 'enviando',
          'listaNome': 'Clientes 2026',
          'criadoEm': DateTime.now()
              .toUtc()
              .subtract(const Duration(minutes: 40))
              .toIso8601String(),
          'iniciadaEm': DateTime.now()
              .toUtc()
              .subtract(const Duration(minutes: 35))
              .toIso8601String(),
          'porStatus': {
            'lida': 1320,
            'entregue': 1540,
            'enviada': 410,
            'falhou': 38,
            'pendente': 1692,
          },
          'total': 5000,
          'janelaDias': [1, 2, 3, 4, 5],
          'janelaInicio': '09:00:00',
          'janelaFim': '20:00:00',
          'pausaSegundos': 2,
          'maxPorDia': 3000,
        });
      case '/campanhas/1/destinatarios':
        final agora = DateTime.now().toUtc();
        return _json([
          {
            'id': 'a',
            'telefone': '5521987654321',
            'status': 'falhou',
            'erroTitulo': 'Número sem WhatsApp',
            'erroDetalhe':
                'A Meta não encontrou uma conta de WhatsApp neste número.',
            'falhouEm': agora
                .subtract(const Duration(minutes: 20))
                .toIso8601String(),
          },
          {
            'id': 'b',
            'telefone': '5521991112222',
            'status': 'lida',
            'lidaEm': agora
                .subtract(const Duration(minutes: 8))
                .toIso8601String(),
          },
          {
            'id': 'c',
            'telefone': '5511983334444',
            'status': 'entregue',
            'entregueEm': agora
                .subtract(const Duration(minutes: 12))
                .toIso8601String(),
          },
          {
            'id': 'd',
            'telefone': '5521975556666',
            'status': 'enviada',
            'enviadaEm': agora
                .subtract(const Duration(minutes: 2))
                .toIso8601String(),
          },
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
    'id': 'm1',
    'tipo': 'simples',
    'nome': 'promo_sexta_smash',
    'idioma': 'pt_BR',
    'categoria': 'MARKETING',
    'status': 'aprovado',
    'cabecalhoFormato': 'TEXT',
    'cabecalhoTexto': 'Sexta do Smash 🍔',
    'corpo':
        'Oi, {{1}}! Hoje o Smash duplo sai por R\$ {{2}} até as 23h. Peça pelo app ou venha buscar.',
    'corpoExemplos': ['Ana', '29,90'],
    'rodape': 'Mister Burgers',
    'botoes': [
      {
        'tipo': 'URL',
        'texto': 'Pedir agora',
        'url': 'https://misterburgers.com.br/pedir',
      },
      {'tipo': 'QUICK_REPLY', 'texto': 'Quero o combo'},
    ],
    'metaTemplateId': 't1',
    'variaveis': 2,
  },
  {
    'id': 'm2',
    'tipo': 'simples',
    'nome': 'combo_familia_v2',
    'idioma': 'pt_BR',
    'categoria': 'MARKETING',
    'status': 'rascunho',
    'corpo': 'Domingo em família: 4 burgers + 2 fritas grandes por R\$ {{1}}.',
    'corpoExemplos': ['119,90'],
    'botoes': [],
    'variaveis': 1,
  },
  {
    'id': 'm3',
    'tipo': 'simples',
    'nome': 'aviso_pedido',
    'idioma': 'pt_BR',
    'categoria': 'UTILITY',
    'status': 'enviado',
    'corpo': 'Seu pedido {{1}} saiu para entrega.',
    'corpoExemplos': ['#1042'],
    'botoes': [],
    'metaTemplateId': 't3',
    'variaveis': 1,
  },
  {
    'id': 'm4',
    'tipo': 'simples',
    'nome': 'smash_da_semana',
    'idioma': 'pt_BR',
    'categoria': 'MARKETING',
    'status': 'rejeitado',
    'motivo':
        'A Meta entendeu o texto como promessa de preço sem prazo. Diga até quando vale.',
    'cabecalhoFormato': 'IMAGE',
    'cabecalhoMidia': 'midia:foto1',
    'corpo':
        'Oi, {{1}}! O Smash da semana chegou: blend de 160 g, cheddar duplo e bacon crocante. Só R\$ {{2}} no app.',
    'corpoExemplos': ['Ana', '32,90'],
    'botoes': [
      {
        'tipo': 'URL',
        'texto': 'Pedir agora',
        'url': 'https://misterburgers.com.br/pedir',
      },
    ],
    'variaveis': 2,
  },
  {
    'id': 'm5',
    'tipo': 'carrossel',
    'nome': 'vitrine_burgers',
    'idioma': 'pt_BR',
    'categoria': 'MARKETING',
    'status': 'rascunho',
    'corpo':
        'Oi, {{1}}! Escolha o seu burger de sexta — tem opção para todo mundo.',
    'corpoExemplos': ['Ana'],
    'cartoes': [
      {
        'imagem': 'midia:foto1',
        'corpo': 'Smash duplo com cheddar e cebola caramelizada',
        'botoes': [
          {
            'tipo': 'URL',
            'texto': 'Pedir',
            'url': 'https://misterburgers.com.br/smash',
          },
          {'tipo': 'QUICK_REPLY', 'texto': 'Quero este'},
        ],
      },
      {
        'imagem': 'midia:foto2',
        'corpo': 'Chicken crispy com maionese de ervas',
        'botoes': [
          {
            'tipo': 'URL',
            'texto': 'Pedir',
            'url': 'https://misterburgers.com.br/chicken',
          },
          {'tipo': 'QUICK_REPLY', 'texto': 'Quero este'},
        ],
      },
      {
        'imagem': 'midia:foto3',
        'corpo': 'Veggie de grão-de-bico com molho da casa',
        'botoes': [
          {
            'tipo': 'URL',
            'texto': 'Pedir',
            'url': 'https://misterburgers.com.br/veggie',
          },
          {'tipo': 'QUICK_REPLY', 'texto': 'Quero este'},
        ],
      },
    ],
    'botoes': [],
    'variaveis': 1,
  },
];

/// Um rascunho com problemas, para a captura do editor barrando o envio.
final _rascunhoComProblema = ModeloSalvo.deJson({
  'id': 'm6',
  'tipo': 'simples',
  'nome': 'cupom_boas_vindas',
  'idioma': 'pt_BR',
  'categoria': 'MARKETING',
  'status': 'rascunho',
  'corpo': 'Bem-vindo ao clube Mister Burgers! Seu cupom de estreia é {{1}}',
  'botoes': [
    {'tipo': 'URL', 'texto': 'Usar cupom', 'url': 'misterburgers'},
  ],
});

/// As "fotos" dos produtos, desenhadas no próprio teste (sem arquivo no Git).
late final List<Uint8List> _fotos;

Future<Uint8List> _desenharBurger(
  Color fundoA,
  Color fundoB,
  Color recheio,
) async {
  const w = 480.0;
  const h = 360.0;
  final gravador = ui.PictureRecorder();
  final tela = Canvas(gravador, const Rect.fromLTWH(0, 0, w, h));
  tela.drawRect(
    const Rect.fromLTWH(0, 0, w, h),
    Paint()
      ..shader = ui.Gradient.linear(Offset.zero, const Offset(w, h), [
        fundoA,
        fundoB,
      ]),
  );
  tela.drawRect(
    const Rect.fromLTWH(0, h * 0.74, w, h * 0.26),
    Paint()..color = const Color(0x2E000000),
  );
  tela.drawOval(
    Rect.fromCenter(
      center: const Offset(w / 2, h * 0.78),
      width: 300,
      height: 46,
    ),
    Paint()..color = const Color(0x40000000),
  );
  final pao = Paint()..color = const Color(0xFFDB9A45);
  // pão de baixo
  tela.drawRRect(
    RRect.fromRectAndRadius(
      Rect.fromCenter(
        center: const Offset(w / 2, h * 0.70),
        width: 250,
        height: 40,
      ),
      const Radius.circular(18),
    ),
    pao,
  );
  // recheio (carne, frango, grão-de-bico)
  tela.drawRRect(
    RRect.fromRectAndRadius(
      Rect.fromCenter(
        center: const Offset(w / 2, h * 0.60),
        width: 262,
        height: 40,
      ),
      const Radius.circular(20),
    ),
    Paint()..color = recheio,
  );
  // queijo
  final queijo = Path()
    ..moveTo(w / 2 - 128, h * 0.52)
    ..lineTo(w / 2 + 128, h * 0.52)
    ..lineTo(w / 2 + 96, h * 0.60)
    ..lineTo(w / 2 + 40, h * 0.555)
    ..lineTo(w / 2 - 20, h * 0.61)
    ..lineTo(w / 2 - 80, h * 0.56)
    ..close();
  tela.drawPath(queijo, Paint()..color = const Color(0xFFF7C531));
  // alface
  tela.drawRRect(
    RRect.fromRectAndRadius(
      Rect.fromCenter(
        center: const Offset(w / 2, h * 0.505),
        width: 270,
        height: 16,
      ),
      const Radius.circular(8),
    ),
    Paint()..color = const Color(0xFF6BB445),
  );
  // pão de cima
  tela.drawArc(
    Rect.fromCenter(
      center: const Offset(w / 2, h * 0.50),
      width: 256,
      height: 190,
    ),
    3.1416,
    3.1416,
    true,
    pao,
  );
  final gergelim = Paint()..color = const Color(0xFFFFF4DC);
  for (final (dx, dy) in [
    (-70.0, -52.0),
    (-20.0, -70.0),
    (34.0, -60.0),
    (78.0, -36.0),
    (-96.0, -22.0),
    (8.0, -38.0),
  ]) {
    tela.drawOval(
      Rect.fromCenter(
        center: Offset(w / 2 + dx, h * 0.50 + dy),
        width: 12,
        height: 6,
      ),
      gergelim,
    );
  }
  final imagem = await gravador.endRecording().toImage(w.toInt(), h.toInt());
  final dados = await imagem.toByteData(format: ui.ImageByteFormat.png);
  return dados!.buffer.asUint8List();
}

/// Carrega de verdade as imagens que estão na tela: a decodificação roda fora
/// do relógio falso do teste, e sem isto a captura sai com o espaço vazio.
Future<void> _carregarImagens(WidgetTester tester) async {
  final provedores = <ImageProvider>{};
  for (final e in find.byType(DecoratedBox).evaluate()) {
    final d = (e.widget as DecoratedBox).decoration;
    if (d is BoxDecoration && d.image != null) provedores.add(d.image!.image);
  }
  if (provedores.isEmpty) return;
  final contexto = tester.element(find.byType(Scaffold).last);
  await tester.runAsync(
    () => Future.wait([for (final p in provedores) precacheImage(p, contexto)]),
  );
  for (var i = 0; i < 5; i++) {
    await tester.pump(const Duration(milliseconds: 50));
  }
}

final _modelosMeta = [
  {
    'id': 't1',
    'nome': 'promo_sexta_smash',
    'idioma': 'pt_BR',
    'categoria': 'MARKETING',
    'status': 'aprovado',
    'cabecalho': 'Sexta do Smash 🍔',
    'corpo':
        'Oi, {{1}}! Hoje o Smash duplo sai por R\$ {{2}} até as 23h. Peça pelo app ou venha buscar.',
    'rodape': 'Mister Burgers',
    'variaveis': 2,
    'botoes': ['Pedir agora', 'Quero o combo', 'Parar promoções'],
  },
  {
    'id': 't3',
    'nome': 'aviso_pedido',
    'idioma': 'pt_BR',
    'categoria': 'UTILITY',
    'status': 'em análise',
    'corpo': 'Seu pedido {{1}} saiu para entrega.',
    'variaveis': 1,
    'botoes': [],
  },
  {
    'id': 't9',
    'nome': 'boas_vindas_antigo',
    'idioma': 'pt_BR',
    'categoria': 'MARKETING',
    'status': 'recusado',
    'motivo': 'Conteúdo promocional em categoria errada.',
    'corpo': 'Bem-vindo ao clube Mister Burgers! Use o cupom BEMVINDO.',
    'variaveis': 0,
    'botoes': [],
  },
];

final _paraLoja = Platform.environment['LOJA'] == '1';

Future<void> _capturar(
  WidgetTester tester,
  Widget tela,
  String nome, {
  Brightness brilho = Brightness.light,
  Future<void> Function(WidgetTester tester)? antes,
}) async {
  // LOJA=1: 1080×1920, a proporção que a Play aceita (lado maior ≤ 2× o menor).
  tester.view.physicalSize = _paraLoja
      ? const Size(1080, 1920)
      : const Size(1080, 2400);
  tester.view.devicePixelRatio = 2.625;
  addTearDown(tester.view.reset);

  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        clienteApiProvider.overrideWithValue(_api),
        cofreProvider.overrideWithValue(_CofreMemoria()),
        // Sem Firebase no teste: as preferências vêm prontas.
        preferenciasAvisoProvider.overrideWith(
          (ref) async => const PreferenciasAviso(
            campanhas: true,
            modelos: true,
            cobranca: false,
          ),
        ),
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
  if (antes != null) {
    await antes(tester);
    for (var i = 0; i < 10; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
  }
  await _carregarImagens(tester);
  await expectLater(
    find.byType(MaterialApp),
    matchesGoldenFile('${_paraLoja ? '_loja' : '_capturas'}/$nome.png'),
  );
}

void main() {
  final ativo = Platform.environment['CAPTURAS'] == '1';

  setUpAll(() async {
    if (!ativo) return;
    TestWidgetsFlutterBinding.ensureInitialized();
    await initializeDateFormatting('pt_BR');
    await _carregarFontes();
    _fotos = [
      await _desenharBurger(
        const Color(0xFFF26B38),
        const Color(0xFFB8322A),
        const Color(0xFF5B3321),
      ),
      await _desenharBurger(
        const Color(0xFF2E8B8B),
        const Color(0xFF1C4E63),
        const Color(0xFFD08B3E),
      ),
      await _desenharBurger(
        const Color(0xFF7CA24B),
        const Color(0xFF3F6B34),
        const Color(0xFFB9853A),
      ),
    ];
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
    await _capturar(
      t,
      const TelaCampanhaDetalhe(id: '1', nomeInicial: 'Sexta do Smash'),
      '06-campanha',
    );
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
      TelaEditorModelo(inicial: ModeloSalvo.deJson(_modelosSalvos[0])),
      '11-modelo-editar',
    );
  }, skip: !ativo);

  testWidgets('modelo — novo', (t) async {
    await _capturar(t, const TelaEditorModelo(), '22-modelo-novo');
  }, skip: !ativo);

  testWidgets('modelo — imagem no cabeçalho', (t) async {
    await _capturar(
      t,
      TelaEditorModelo(inicial: ModeloSalvo.deJson(_modelosSalvos[3])),
      '23-modelo-imagem',
      antes: (t) => t.scrollUntilVisible(
        find.text('Cabeçalho'),
        300,
        scrollable: find.byType(Scrollable).first,
      ),
    );
  }, skip: !ativo);

  testWidgets('modelo — carrossel', (t) async {
    await _capturar(
      t,
      TelaEditorModelo(inicial: ModeloSalvo.deJson(_modelosSalvos[4])),
      '24-modelo-carrossel',
      antes: (t) => t.scrollUntilVisible(
        find.text('Cartão 1'),
        300,
        scrollable: find.byType(Scrollable).first,
      ),
    );
  }, skip: !ativo);

  testWidgets('modelo — prévia', (t) async {
    await _capturar(
      t,
      TelaEditorModelo(inicial: ModeloSalvo.deJson(_modelosSalvos[3])),
      '25-modelo-previa',
      antes: (t) => t.tap(find.text('Prévia')),
    );
  }, skip: !ativo);

  testWidgets('modelo — prévia escura', (t) async {
    await _capturar(
      t,
      TelaEditorModelo(inicial: ModeloSalvo.deJson(_modelosSalvos[3])),
      '26-modelo-previa-escuro',
      brilho: Brightness.dark,
      antes: (t) => t.tap(find.text('Prévia')),
    );
  }, skip: !ativo);

  testWidgets('modelo — prévia do carrossel', (t) async {
    await _capturar(
      t,
      TelaEditorModelo(inicial: ModeloSalvo.deJson(_modelosSalvos[4])),
      '27-modelo-previa-carrossel',
      antes: (t) => t.tap(find.text('Prévia')),
    );
  }, skip: !ativo);

  testWidgets('modelo — problemas antes de enviar', (t) async {
    await _capturar(
      t,
      TelaEditorModelo(inicial: _rascunhoComProblema),
      '28-modelo-problemas',
      antes: (t) async {
        await t.tap(find.text('Enviar para aprovação'));
        for (var i = 0; i < 10; i++) {
          await t.pump(const Duration(milliseconds: 100));
        }
        await t.scrollUntilVisible(
          find.text('Mensagem'),
          300,
          scrollable: find.byType(Scrollable).first,
        );
      },
    );
  }, skip: !ativo);

  testWidgets('modelo — detalhe do carrossel', (t) async {
    await _capturar(
      t,
      TelaModeloDetalhe(local: ModeloSalvo.deJson(_modelosSalvos[4])),
      '29-modelo-detalhe-carrossel',
    );
  }, skip: !ativo);

  testWidgets('modelo — recusado com imagem', (t) async {
    await _capturar(
      t,
      TelaModeloDetalhe(local: ModeloSalvo.deJson(_modelosSalvos[3])),
      '30-modelo-recusado',
    );
  }, skip: !ativo);

  testWidgets('contatos', (t) async {
    await _capturar(t, const Scaffold(body: TelaContatos()), '12-contatos');
  }, skip: !ativo);

  testWidgets('contatos — escuro', (t) async {
    await _capturar(
      t,
      const Scaffold(body: TelaContatos()),
      '13-contatos-escuro',
      brilho: Brightness.dark,
    );
  }, skip: !ativo);

  testWidgets('importar', (t) async {
    await _capturar(t, const TelaImportarContatos(), '14-importar');
  }, skip: !ativo);

  testWidgets('mais', (t) async {
    await _capturar(t, const _ComSessao(child: _AbaMais()), '15-mais');
  }, skip: !ativo);

  testWidgets('plano', (t) async {
    await _capturar(t, const _ComSessao(child: TelaPlano()), '16-plano');
  }, skip: !ativo);

  testWidgets('plano — escuro', (t) async {
    await _capturar(
      t,
      const _ComSessao(child: TelaPlano()),
      '17-plano-escuro',
      brilho: Brightness.dark,
    );
  }, skip: !ativo);

  testWidgets('conta', (t) async {
    await _capturar(t, const _ComSessao(child: TelaConta()), '18-conta');
  }, skip: !ativo);

  testWidgets('usuarios', (t) async {
    await _capturar(t, const _ComSessao(child: TelaUsuarios()), '19-usuarios');
  }, skip: !ativo);

  testWidgets('whatsapp', (t) async {
    await _capturar(t, const TelaWhatsapp(), '20-whatsapp');
  }, skip: !ativo);

  testWidgets('regras', (t) async {
    await _capturar(t, const TelaRegras(), '21-regras');
  }, skip: !ativo);

  testWidgets('campanha — escuro', (t) async {
    await _capturar(
      t,
      const TelaCampanhaDetalhe(id: '1', nomeInicial: 'Sexta do Smash'),
      '07-campanha-escuro',
      brilho: Brightness.dark,
    );
  }, skip: !ativo);
}

/// A casca com a aba Mais aberta.
class _AbaMais extends StatelessWidget {
  const _AbaMais();

  @override
  Widget build(BuildContext context) => const Casca(abaInicial: 4);
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
