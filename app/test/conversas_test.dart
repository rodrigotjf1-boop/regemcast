import 'dart:convert';
import 'dart:typed_data';

import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:regemcast/api/cliente_api.dart';
import 'package:regemcast/api/conversas.dart';
import 'package:regemcast/api/dados.dart';
import 'package:regemcast/api/repeticao.dart';
import 'package:regemcast/componentes/midia_da_conversa.dart';
import 'package:regemcast/push/push.dart';
import 'package:regemcast/sessao/sessao.dart';
import 'package:regemcast/telas/campanha_formulario.dart';
import 'package:regemcast/telas/casca.dart';
import 'package:regemcast/telas/conversa.dart';
import 'package:regemcast/telas/conversas.dart';
import 'package:regemcast/tema/tema.dart';
import 'package:video_player/video_player.dart';

http.Response _json(Object corpo, [int status = 200]) => http.Response.bytes(
  utf8.encode(jsonEncode(corpo)),
  status,
  headers: {'content-type': 'application/json; charset=utf-8'},
);

final _agora = DateTime.now();
String _iso(DateTime d) => d.toUtc().toIso8601String();
DateTime _ontemAs(int h, int m) =>
    DateTime(_agora.year, _agora.month, _agora.day - 1, h, m);
DateTime _hojeAs(int h, int m) =>
    DateTime(_agora.year, _agora.month, _agora.day, h, m);

Map<String, dynamic> _conversa(
  String id, {
  String? nome,
  required String telefone,
  String? contatoId,
  bool optOut = false,
  int naoLidas = 0,
  String? ultima,
  DateTime? em,
  bool janela = true,
}) => {
  'id': id,
  'telefone': telefone,
  'nome': nome,
  'contatoId': contatoId,
  'optOut': optOut,
  'naoLidas': naoLidas,
  'ultimaMensagem': ultima,
  'ultimaMensagemEm': em == null ? null : _iso(em),
  'janelaAteEm': janela
      ? _iso(_agora.add(const Duration(hours: 23, minutes: 10)))
      : null,
  'numero': '+55 21 3333-0000',
};

Map<String, dynamic> _mensagem(
  String id,
  DateTime em, {
  String direcao = 'entrada',
  String origem = 'cliente',
  String tipo = 'text',
  String? texto,
  bool temMidia = false,
  String? mime,
  String? nome,
  String? status,
  int? erroCodigo,
  String? erroTitulo,
  String? por,
}) => {
  'id': id,
  'direcao': direcao,
  'origem': origem,
  'tipo': tipo,
  'texto': texto,
  'temMidia': temMidia,
  'midiaMime': mime,
  'midiaNome': nome,
  'status': status,
  'erroCodigo': erroCodigo,
  'erroTitulo': erroTitulo,
  'enviadaPor': por,
  'criadaEm': _iso(em),
};

/// Um PNG de 1×1 de verdade: a foto da conversa decodifica sem erro.
final _png = base64Decode(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
);

/// O servidor falso das conversas: anota cada pedido (com a consulta) e o
/// corpo de cada escrita.
class _Servidor {
  _Servidor({this.desligadas = false, this.conversasNaConta = true});

  bool desligadas;
  bool conversasNaConta;
  final pedidos = <String>[];
  final corpos = <String, Object?>{};

  /// Mensagens da conversa c1, na ordem do servidor.
  late List<Map<String, dynamic>> mensagensC1 = [
    _mensagem('m1', _ontemAs(20, 10), texto: 'Oi, o pedido saiu?'),
    _mensagem(
      'm2',
      _ontemAs(20, 12),
      direcao: 'saida',
      origem: 'celular',
      texto: 'Saiu sim!',
      status: 'lida',
    ),
    _mensagem(
      'm3',
      _hojeAs(9, 0),
      tipo: 'image',
      temMidia: true,
      mime: 'image/png',
    ),
    _mensagem(
      'm4',
      _hojeAs(9, 1),
      tipo: 'audio',
      temMidia: true,
      mime: 'audio/ogg',
    ),
    _mensagem(
      'm5',
      _hojeAs(9, 2),
      tipo: 'document',
      temMidia: true,
      mime: 'application/pdf',
      nome: 'cardapio.pdf',
    ),
    _mensagem('m6', _hojeAs(9, 3), tipo: 'video'),
    _mensagem(
      'm7',
      _hojeAs(9, 4),
      direcao: 'saida',
      origem: 'painel',
      texto: 'Pode deixar',
      status: 'falhou',
      erroCodigo: 131026,
      erroTitulo: 'Número sem WhatsApp',
      por: 'Rodrigo',
    ),
    _mensagem('m8', _hojeAs(9, 5), tipo: 'reaction', texto: '👍'),
  ];

  /// A 2ª leitura do cabeçalho de c1 já vem com a janela fechada.
  bool fecharJanelaDepois = false;
  int leiturasDoCabecalho = 0;

  /// O próximo POST de resposta é recusado com esta frase.
  String? recusarResposta;

  /// A mídia já saiu da Meta.
  bool midiaApagada = false;
  bool jaEstavaNaLista = false;

  ClienteApi get api => ClienteApi(
    base: 'https://api.teste',
    http: MockClient((req) async {
      final consulta = req.url.hasQuery ? '?${req.url.query}' : '';
      final chave = '${req.method} ${req.url.path}';
      pedidos.add('$chave$consulta');
      if (req.body.isNotEmpty) corpos[chave] = jsonDecode(req.body);
      return _responder(req, chave);
    }),
  )..token = 'tk';

  http.Response _responder(http.Request req, String chave) {
    final q = req.url.queryParameters;
    final c1 = _conversa(
      'c1',
      nome: 'Ana Beatriz Souza',
      telefone: '5521991112222',
      contatoId: 'k1',
      naoLidas: 2,
      ultima: 'Chegou certinho!',
      em: _agora.subtract(const Duration(minutes: 5)),
    );
    final c2 = _conversa(
      'c2',
      telefone: '5521983334444',
      ultima: 'Obrigado',
      em: _agora.subtract(const Duration(days: 1)),
      janela: false,
    );
    final c3 = _conversa(
      'c3',
      nome: 'Carlos (perfil)',
      telefone: '5521975556666',
      contatoId: 'k3',
      optOut: true,
      ultima: 'Parar promoções',
      em: _agora.subtract(const Duration(days: 10)),
      janela: false,
    );
    switch (chave) {
      case 'GET /conversas':
        if (desligadas) {
          return _json({
            'mensagem':
                'As conversas não estão ligadas nesta conta. Ligue em WhatsApp → "Contatos e conversas do celular".',
          }, 404);
        }
        final busca = (q['busca'] ?? '').toLowerCase();
        return _json([
          for (final c in [c1, c2, c3])
            if (busca.isEmpty ||
                '${c['nome'] ?? ''}'.toLowerCase().contains(busca))
              c,
        ]);
      case 'GET /conversas/config':
        return _json({'retencaoDias': 30});
      case 'PATCH /conversas/config':
        return _json(corpos[chave]!);
      case 'GET /conversas/c1':
        leiturasDoCabecalho++;
        return _json({
          ...c1,
          if (fecharJanelaDepois && leiturasDoCabecalho > 1)
            'janelaAteEm': null,
        });
      case 'GET /conversas/c2':
        return _json(c2);
      case 'GET /conversas/c3':
        return _json(c3);
      case 'GET /conversas/c1/mensagens':
        final antes = q['antesDe'];
        if (antes != null) {
          final limite = DateTime.parse(antes);
          return _json([
            for (var i = 1; i <= 3; i++)
              _mensagem(
                'antiga$i',
                limite.subtract(Duration(minutes: 10 - i)),
                texto: 'Antiga $i',
              ),
          ]);
        }
        return _json(mensagensC1);
      case 'GET /conversas/c2/mensagens':
        return _json([_mensagem('n1', _ontemAs(12, 0), texto: 'Obrigado')]);
      case 'GET /conversas/c3/mensagens':
        return _json([
          _mensagem('p1', _hojeAs(8, 0), texto: 'Parar promoções'),
        ]);
      case 'POST /conversas/c1/lida':
        return _json({'ok': true}, 201);
      case 'POST /conversas/c1/mensagens':
        if (recusarResposta != null) {
          return _json({'mensagem': recusarResposta}, 400);
        }
        return _json(
          _mensagem(
            'nova1',
            DateTime.now(),
            direcao: 'saida',
            origem: 'painel',
            texto: (corpos[chave] as Map)['texto'] as String,
            status: 'enviando',
            por: 'Rodrigo',
          ),
          201,
        );
      case 'GET /contatos/listas':
        return _json([
          {'id': 'l1', 'nome': 'Clientes 2026', 'total': 4820},
          {
            'id': 'b1',
            'nome': 'Base — bloco 1',
            'total': 250,
            'divisaoId': 'd1',
            'divisaoNome': 'Base de setembro',
            'bloco': 1,
            'blocos': 2,
          },
        ]);
      case 'POST /contatos/k1/listas':
        return _json({
          'ok': true,
          'jaEstava': jaEstavaNaLista,
          'lista': 'Clientes 2026',
        }, 201);
      case 'GET /conta':
        return _json({
          'conta': {'nome': 'MISTER BURGERS'},
          'uso': {'disparos': 0},
          'conversasHabilitadas': conversasNaConta,
        });
    }
    if (req.url.path.endsWith('/midia')) {
      if (midiaApagada) {
        return _json({
          'mensagem': 'Esta mídia não está mais disponível na Meta.',
        }, 400);
      }
      return http.Response.bytes(
        req.url.path.contains('/m5/') ? utf8.encode('%PDF-1.4') : _png,
        200,
      );
    }
    return _json({});
  }

  int quantos(String pedido) => pedidos.where((p) => p == pedido).length;
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

/// Um reprodutor que falha ao abrir — como o arquivo que a Meta já apagou. O
/// de verdade esperaria para sempre um evento do reprodutor nativo, que não
/// existe no teste.
class _ReprodutorQueFalha extends VideoPlayerController {
  _ReprodutorQueFalha(super.url) : super.networkUrl();

  @override
  Future<void> initialize() async => throw Exception('sem arquivo');
}

/// Sem Firebase no teste: a casca pede para ligar os avisos e nada acontece
/// (o de verdade deixaria o tempo-limite de 8 s pendurado no fim do teste).
class _AvisosQuietos extends ServicoPush {
  _AvisosQuietos(super.api);

  @override
  Future<void> ativar({
    void Function(RemoteMessage)? aoChegar,
    void Function(Map<String, dynamic>)? aoTocar,
  }) async {}
}

/// O que o "Salvar" mandou para a janela do Android.
final _salvos = <({String nome, int tamanho, String tipoMime})>[];

/// O que o reprodutor recebeu.
final _tocados = <({Uri endereco, Map<String, String> cabecalho})>[];

Widget _app(
  _Servidor s,
  Widget tela, {
  String papel = 'dono',
  ClienteApi? api,
}) => ProviderScope(
  // Como no app: leitura que falhou não se repete sozinha (ERR-026).
  retry: semRepeticao,
  overrides: [
    clienteApiProvider.overrideWithValue(api ?? s.api),
    sessaoProvider.overrideWith(() => _SessaoFixa(papel)),
    salvarArquivoProvider.overrideWithValue(({
      required nome,
      required bytes,
      required tipoMime,
    }) async {
      _salvos.add((nome: nome, tamanho: bytes.length, tipoMime: tipoMime));
      return true;
    }),
    fabricaDeReprodutorProvider.overrideWithValue((endereco, cabecalho) {
      _tocados.add((endereco: endereco, cabecalho: cabecalho));
      return _ReprodutorQueFalha(endereco);
    }),
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

Future<void> _abrirLista(
  WidgetTester t,
  _Servidor s, {
  String papel = 'dono',
}) async {
  _telaAlta(t);
  await t.pumpWidget(
    _app(s, const Scaffold(body: TelaConversas()), papel: papel),
  );
  await _assentar(t);
}

/// Espera a transição de página inteira (entrar numa tela ou sair dela).
Future<void> _transicao(WidgetTester t) async {
  for (var i = 0; i < 20; i++) {
    await t.pump(const Duration(milliseconds: 100));
  }
}

Future<void> _abrirConversa(WidgetTester t, _Servidor s, String id) async {
  await _abrirLista(t, s);
  await t.tap(find.byKey(ValueKey('conversa-$id')));
  await _transicao(t);
}

/// Só o que está na tela da conversa (a lista fica por baixo).
Finder _naConversa(Finder f) =>
    find.descendant(of: find.byType(TelaConversa), matching: f);

void main() {
  setUpAll(() => initializeDateFormatting('pt_BR'));
  setUp(() {
    _salvos.clear();
    _tocados.clear();
  });

  testWidgets('lista: nome ou telefone, quando, não lidas e a janela aberta', (
    t,
  ) async {
    final s = _Servidor();
    await _abrirLista(t, s);

    expect(find.text('2 mensagens não lidas'), findsOneWidget);
    expect(find.text('Ana Beatriz Souza'), findsOneWidget);
    // Hoje: a hora; ontem: "Ontem"; há 10 dias: a data curta.
    final cinco = _agora.subtract(const Duration(minutes: 5));
    expect(
      find.text(
        '${cinco.hour.toString().padLeft(2, '0')}:${cinco.minute.toString().padLeft(2, '0')}',
      ),
      findsOneWidget,
    );
    expect(find.text('Ontem'), findsOneWidget);
    expect(find.text('2'), findsOneWidget);
    // Sem nome: o telefone no lugar do nome, e as iniciais são os 2 últimos dígitos.
    expect(find.text('+55 21 98333-4444'), findsOneWidget);
    expect(find.text('44'), findsOneWidget);
    expect(find.text('AS'), findsOneWidget);
    expect(find.text('CP'), findsOneWidget);
    // A bolinha da janela aberta só na conversa que ainda aceita texto.
    expect(find.byKey(const ValueKey('janela-aberta-c1')), findsOneWidget);
    expect(find.byKey(const ValueKey('janela-aberta-c2')), findsNothing);
  });

  testWidgets('busca: espera a digitação e diz quando não acha', (t) async {
    final s = _Servidor();
    await _abrirLista(t, s);

    await t.enterText(find.byKey(const ValueKey('buscar-conversa')), 'an');
    await t.pump(const Duration(milliseconds: 100));
    await t.enterText(find.byKey(const ValueKey('buscar-conversa')), 'ana');
    await t.pump(const Duration(milliseconds: 100));
    expect(s.pedidos.where((p) => p.contains('busca=')), isEmpty);
    await _assentar(t);
    expect(s.pedidos.where((p) => p.contains('busca=')).toList(), [
      'GET /conversas?busca=ana',
    ]);
    expect(find.text('Ana Beatriz Souza'), findsOneWidget);
    expect(find.text('+55 21 98333-4444'), findsNothing);

    await t.enterText(find.byKey(const ValueKey('buscar-conversa')), 'zzz');
    await _assentar(t);
    expect(
      find.text('Nenhuma conversa com esse nome ou telefone.'),
      findsOneWidget,
    );
  });

  testWidgets('conversas desligadas: explica e aponta o WhatsApp', (t) async {
    final s = _Servidor(desligadas: true);
    await _abrirLista(t, s);

    expect(find.text('As conversas não estão ligadas'), findsOneWidget);
    expect(
      find.textContaining('Contatos e conversas do celular'),
      findsOneWidget,
    );
    expect(find.text('Ir para WhatsApp'), findsOneWidget);
    expect(find.byKey(const ValueKey('buscar-conversa')), findsNothing);
    expect(find.byKey(const ValueKey('guarda')), findsNothing);
  });

  testWidgets(
    'abrir: marca como lida, separa os dias e mostra status, falha e mídias',
    (t) async {
      final s = _Servidor();
      await _abrirConversa(t, s, 'c1');

      expect(s.pedidos, contains('POST /conversas/c1/lida'));
      expect(s.pedidos, contains('GET /conversas/c1'));
      expect(_naConversa(find.text('Ontem')), findsOneWidget);
      expect(_naConversa(find.text('Hoje')), findsOneWidget);
      expect(find.text('Oi, o pedido saiu?'), findsOneWidget);
      expect(find.text('pelo celular'), findsOneWidget);
      expect(find.byKey(const ValueKey('status-lida')), findsOneWidget);
      expect(find.text('Rodrigo'), findsOneWidget);
      expect(
        find.text('Não entregue — Número sem WhatsApp (131026)'),
        findsOneWidget,
      );
      expect(find.text('🎥 Vídeo — só no celular'), findsOneWidget);
      expect(find.text('Reagiu com 👍'), findsOneWidget);
      // A foto é buscada na hora; áudio e documento só quando a pessoa pede.
      expect(s.pedidos, contains('GET /conversas/c1/mensagens/m3/midia'));
      expect(s.pedidos.where((p) => p.contains('/m4/')), isEmpty);
      expect(s.pedidos.where((p) => p.contains('/m5/')), isEmpty);
      expect(find.text('cardapio.pdf'), findsOneWidget);
      expect(find.text('🎤 Áudio'), findsOneWidget);
      expect(find.byType(Image), findsOneWidget);
    },
  );

  testWidgets('responder: manda o texto, mostra a bolha e limpa a caixa', (
    t,
  ) async {
    final s = _Servidor();
    await _abrirConversa(t, s, 'c1');

    expect(
      find.textContaining('Dá para responder com texto até'),
      findsOneWidget,
    );
    final enviar = find.byKey(const ValueKey('enviar'));
    expect(t.widget<IconButton>(enviar).onPressed, isNull);
    await t.enterText(find.byKey(const ValueKey('resposta')), '  Obrigado!  ');
    await _assentar(t);
    await t.tap(enviar);
    await _assentar(t);

    expect(s.corpos['POST /conversas/c1/mensagens'], {'texto': 'Obrigado!'});
    expect(find.text('Obrigado!'), findsOneWidget);
    expect(
      t
          .widget<TextField>(find.byKey(const ValueKey('resposta')))
          .controller!
          .text,
      isEmpty,
    );
    expect(find.byKey(const ValueKey('status-enviando')), findsOneWidget);
  });

  testWidgets(
    'recusa ao responder: mostra o motivo e relê a janela, que fechou',
    (t) async {
      final s = _Servidor()
        ..fecharJanelaDepois = true
        ..recusarResposta =
            'A janela de 24 horas para responder já fechou: ela abre quando a pessoa manda mensagem.';
      await _abrirConversa(t, s, 'c1');

      await t.enterText(find.byKey(const ValueKey('resposta')), 'Oi');
      await _assentar(t);
      await t.tap(find.byKey(const ValueKey('enviar')));
      await _assentar(t);

      expect(
        find.textContaining('A janela de 24 horas para responder já fechou'),
        findsOneWidget,
      );
      expect(s.quantos('GET /conversas/c1'), 2);
      expect(find.byKey(const ValueKey('janela-fechada')), findsOneWidget);
      expect(find.byKey(const ValueKey('resposta')), findsNothing);
    },
  );

  testWidgets('janela fechada: a caixa explica e aponta a campanha', (t) async {
    final s = _Servidor();
    await _abrirConversa(t, s, 'c2');

    expect(find.text('Fora da sua base'), findsOneWidget);
    expect(find.byKey(const ValueKey('resposta')), findsNothing);
    expect(
      find.textContaining('A janela de 24 horas está fechada.'),
      findsOneWidget,
    );
    await t.tap(find.byKey(const ValueKey('enviar-modelo')));
    await _transicao(t);
    expect(find.byType(TelaFormularioCampanha), findsOneWidget);
  });

  testWidgets(
    'mensagem nova chega sozinha em 5 s e a conversa é marcada como lida',
    (t) async {
      final s = _Servidor();
      await _abrirConversa(t, s, 'c1');
      final lidasAntes = s.quantos('POST /conversas/c1/lida');

      s.mensagensC1 = [
        ...s.mensagensC1,
        _mensagem('m9', DateTime.now(), texto: 'Mais uma coisa!'),
      ];
      await t.pump(const Duration(seconds: 5));
      await _assentar(t);

      expect(find.text('Mais uma coisa!'), findsOneWidget);
      expect(s.quantos('POST /conversas/c1/lida'), lidasAntes + 1);

      // Sem nada novo, a próxima volta não marca de novo.
      await t.pump(const Duration(seconds: 5));
      await _assentar(t);
      expect(s.quantos('POST /conversas/c1/lida'), lidasAntes + 1);
      // Saiu da conversa: o relógio para junto.
      await t.pageBack();
      await _transicao(t);
      final leituras = s.quantos('GET /conversas/c1/mensagens');
      await t.pump(const Duration(seconds: 12));
      expect(s.quantos('GET /conversas/c1/mensagens'), leituras);
    },
  );

  testWidgets('anteriores: pede a página antes da mais antiga', (t) async {
    final s = _Servidor()
      ..mensagensC1 = [
        for (var i = 0; i < mensagensPorPagina; i++)
          _mensagem(
            'p$i',
            _hojeAs(8, 0).add(Duration(seconds: i)),
            texto: 'Mensagem $i',
          ),
      ];
    await _abrirConversa(t, s, 'c1');

    final botao = find.byKey(const ValueKey('anteriores'));
    await t.scrollUntilVisible(
      botao,
      400,
      scrollable: find.descendant(
        of: find.byKey(const ValueKey('mensagens')),
        matching: find.byType(Scrollable),
      ),
    );
    await t.tap(botao);
    await _assentar(t);

    final pedido = s.pedidos.lastWhere((p) => p.contains('antesDe='));
    expect(
      Uri.decodeQueryComponent(pedido.split('antesDe=').last),
      DateTime.parse(
        (s.mensagensC1.first['criadaEm'] as String),
      ).toUtc().toIso8601String(),
    );
    expect(find.text('Antiga 3'), findsOneWidget);
    // Vieram menos de 60: acabou o histórico.
    expect(botao, findsNothing);
  });

  testWidgets('documento: salva no celular pela janela do Android', (t) async {
    final s = _Servidor();
    await _abrirConversa(t, s, 'c1');

    await t.tap(find.byKey(const ValueKey('salvar-m5')));
    await _assentar(t);

    expect(s.pedidos, contains('GET /conversas/c1/mensagens/m5/midia'));
    expect(_salvos.single.nome, 'cardapio.pdf');
    expect(_salvos.single.tipoMime, 'application/pdf');
    expect(_salvos.single.tamanho, 8);
    expect(find.text('Documento salvo no celular.'), findsOneWidget);
  });

  testWidgets('mídia que a Meta já apagou: a mensagem diz, sem erro técnico', (
    t,
  ) async {
    final s = _Servidor()..midiaApagada = true;
    await _abrirConversa(t, s, 'c1');

    // A foto não veio.
    expect(
      find.text(
        'Esta mídia não está mais disponível. Veja no WhatsApp Business do celular.',
      ),
      findsOneWidget,
    );
    await t.tap(find.byKey(const ValueKey('salvar-m5')));
    await _assentar(t);
    expect(
      find.text(
        'Esta mídia não está mais disponível. Veja no WhatsApp Business do celular.',
      ),
      findsNWidgets(2),
    );
    expect(_salvos, isEmpty);
  });

  testWidgets('áudio: só baixa no play, pela nossa rota e com a sessão', (
    t,
  ) async {
    final s = _Servidor();
    await _abrirConversa(t, s, 'c1');

    await t.tap(find.byKey(const ValueKey('tocar-m4')));
    await _assentar(t);

    expect(
      _tocados.single.endereco.toString(),
      'https://api.teste/conversas/c1/mensagens/m4/midia',
    );
    expect(_tocados.single.cabecalho, {'Authorization': 'Bearer tk'});
    // No teste não há reprodutor nativo: a mensagem diz, sem travar a tela.
    expect(
      find.text(
        'Esta mídia não está mais disponível. Veja no WhatsApp Business do celular.',
      ),
      findsOneWidget,
    );
  });

  testWidgets('adicionar à lista: escolhe a lista e diz o resultado', (
    t,
  ) async {
    final s = _Servidor();
    await _abrirConversa(t, s, 'c1');

    await t.tap(find.byKey(const ValueKey('adicionar-na-lista')));
    await _assentar(t);
    await t.tap(find.byKey(const ValueKey('lista-da-conversa')));
    await _assentar(t);
    // Os blocos vêm num grupo à parte, com o nome da divisão.
    expect(find.text('BLOCOS — BASE DE SETEMBRO'), findsOneWidget);
    await t.tap(find.text('Clientes 2026 · 4.820').last);
    await _assentar(t);
    await t.tap(find.byKey(const ValueKey('adicionar')));
    await _assentar(t);

    expect(s.corpos['POST /contatos/k1/listas'], {'listaId': 'l1'});
    expect(find.text('Adicionado a "Clientes 2026".'), findsOneWidget);

    s.jaEstavaNaLista = true;
    await t.tap(find.byKey(const ValueKey('adicionar')));
    await _assentar(t);
    expect(find.text('Já estava em "Clientes 2026".'), findsOneWidget);
  });

  testWidgets('saiu das promoções: sem "Adicionar à lista"', (t) async {
    final s = _Servidor();
    await _abrirConversa(t, s, 'c3');
    expect(find.text('Saiu das promoções'), findsOneWidget);
    expect(find.byKey(const ValueKey('adicionar-na-lista')), findsNothing);
  });

  testWidgets('guarda das mensagens: só o dono; salva e avisa', (t) async {
    final s = _Servidor();
    await _abrirLista(t, s);

    await t.tap(find.byKey(const ValueKey('guarda')));
    await _assentar(t);
    expect(s.pedidos, contains('GET /conversas/config'));
    await t.tap(find.byKey(const ValueKey('prazo-90')));
    await _assentar(t);
    await t.tap(find.byKey(const ValueKey('salvar-guarda')));
    await _assentar(t);

    expect(s.corpos['PATCH /conversas/config'], {'retencaoDias': 90});
    expect(
      find.text(
        'Mensagens com mais de 90 dias passam a ser apagadas, de hora em hora.',
      ),
      findsOneWidget,
    );

    await t.tap(find.byKey(const ValueKey('guarda')));
    await _assentar(t);
    await t.tap(find.byKey(const ValueKey('prazo-0')));
    await _assentar(t);
    await t.tap(find.byKey(const ValueKey('salvar-guarda')));
    await _assentar(t);
    expect(find.text('Todas as mensagens ficam guardadas.'), findsOneWidget);
  });

  testWidgets('operador não vê a guarda das mensagens', (t) async {
    final s = _Servidor();
    await _abrirLista(t, s, papel: 'operador');
    expect(find.byKey(const ValueKey('guarda')), findsNothing);
  });

  group('casca', () {
    Future<void> abrirCasca(WidgetTester t, _Servidor s) async {
      _telaAlta(t);
      await t.pumpWidget(_app(s, const Casca()));
      await _assentar(t);
    }

    testWidgets(
      'com as conversas ligadas, Conversas entra no lugar de Modelos, que vai para "Mais"',
      (t) async {
        final s = _Servidor();
        await abrirCasca(t, s);

        expect(find.byKey(const ValueKey('aba-conversas')), findsOneWidget);
        expect(find.byKey(const ValueKey('aba-modelos')), findsNothing);

        await t.tap(find.byKey(const ValueKey('aba-conversas')));
        await _assentar(t);
        expect(s.pedidos, contains('GET /conversas'));

        await t.tap(find.text('Mais'));
        await _assentar(t);
        await t.tap(find.byKey(const ValueKey('mais-modelos')));
        await _transicao(t);
        expect(find.byType(TelaModelosAvulsa), findsOneWidget);
      },
    );

    testWidgets('sem conversas, a barra fica como sempre foi', (t) async {
      final s = _Servidor(conversasNaConta: false);
      await abrirCasca(t, s);

      expect(find.byKey(const ValueKey('aba-modelos')), findsOneWidget);
      expect(find.byKey(const ValueKey('aba-conversas')), findsNothing);
      await t.tap(find.text('Mais'));
      await _assentar(t);
      expect(find.byKey(const ValueKey('mais-modelos')), findsNothing);
      // Ninguém pergunta pelas conversas numa conta sem elas.
      expect(s.pedidos.where((p) => p.startsWith('GET /conversas')), isEmpty);
    });
  });

  group('regras puras', () {
    test('mesclar: a página nova traz o status novo e mantém as antigas', () {
      MensagemDaConversa m(String id, int minuto, [String? status]) =>
          MensagemDaConversa.deJson(
            _mensagem(
              id,
              DateTime(2026, 9, 29, 10, minuto),
              direcao: status == null ? 'entrada' : 'saida',
              status: status,
            ),
          );
      final atuais = [m('a', 1), m('b', 2), m('c', 3, 'enviada')];
      final recentes = [m('b', 2), m('c', 3, 'lida'), m('d', 4)];
      final juntas = mesclarMensagens(atuais, recentes);
      expect(juntas.map((x) => x.id), ['a', 'b', 'c', 'd']);
      expect(juntas[2].status, 'lida');
      expect(mesclarMensagens(atuais, const []), same(atuais));
    });

    test('iniciais: só letras; sem nome, os dois últimos dígitos', () {
      ConversaResumo c(String? nome) => ConversaResumo.deJson(
        _conversa('x', nome: nome, telefone: '5521999998877'),
      );
      expect(iniciaisDaConversa(c('Carlos (perfil)')), 'CP');
      expect(iniciaisDaConversa(c('ana')), 'AN');
      expect(iniciaisDaConversa(c('😀 123')), '77');
      expect(iniciaisDaConversa(c(null)), '77');
    });

    test('o arquivo salvo leva o nome da mensagem ou um pelo tipo', () {
      MensagemDaConversa m(String? nome, String mime) =>
          MensagemDaConversa.deJson(
            _mensagem(
              '1a2b3c4d-0000-4000-8000-000000000000',
              DateTime(2026, 9, 29),
              tipo: 'document',
              nome: nome,
              mime: mime,
            ),
          );
      expect(nomeDoArquivo(m('nota.pdf', 'application/pdf')), 'nota.pdf');
      expect(nomeDoArquivo(m(null, 'audio/ogg')), 'whatsapp-1a2b3c4d.ogg');
      expect(nomeDoArquivo(m(null, 'x/y')), 'whatsapp-1a2b3c4d.bin');
    });

    test('bytes da mídia pelo cliente: a rota da conversa', () async {
      final pedidos = <String>[];
      final api = ClienteApi(
        base: 'https://api.teste',
        http: MockClient((req) async {
          pedidos.add(req.url.path);
          return http.Response.bytes(Uint8List.fromList([1, 2, 3]), 200);
        }),
      );
      final container = ProviderContainer(
        overrides: [clienteApiProvider.overrideWithValue(api)],
      );
      addTearDown(container.dispose);
      final bytes = await container.read(
        bytesDaMidiaDaConversaProvider(('c1', 'm3')).future,
      );
      expect(bytes, [1, 2, 3]);
      expect(pedidos, ['/conversas/c1/mensagens/m3/midia']);
    });
  });

  test('ResumoConta lê se as conversas estão ligadas', () {
    expect(
      ResumoConta.deJson({'conversasHabilitadas': true}).conversasHabilitadas,
      isTrue,
    );
    expect(ResumoConta.deJson({}).conversasHabilitadas, isFalse);
  });
}
