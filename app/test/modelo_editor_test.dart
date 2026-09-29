import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:regemcast/api/cliente_api.dart';
import 'package:regemcast/api/midia.dart';
import 'package:regemcast/api/modelos.dart';
import 'package:regemcast/sessao/sessao.dart';
import 'package:regemcast/telas/modelo_detalhe.dart';
import 'package:regemcast/telas/modelo_editor.dart';
import 'package:regemcast/tema/tema.dart';

http.Response _json(Object corpo, [int status = 200]) => http.Response.bytes(
  utf8.encode(jsonEncode(corpo)),
  status,
  headers: {'content-type': 'application/json; charset=utf-8'},
);

/// Uma imagem PNG de 1×1 de verdade: a prévia decodifica o que recebe.
final _png = base64Decode(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
);

/// Um servidor falso que responde às rotas do modelo e anota o que recebeu.
class _Servidor {
  final pedidos = <String>[];
  final corpos = <String, Map<String, dynamic>>{};
  List<Map<String, String>> problemas = [];
  String? erroNoEnvio;
  String statusDoEnvio = 'enviado';
  String? multipart;

  int quantos(String pedido) => pedidos.where((p) => p == pedido).length;

  ClienteApi get api => ClienteApi(
    base: 'https://api.teste',
    http: MockClient((req) async {
      final chave = '${req.method} ${req.url.path}';
      pedidos.add(req.url.hasQuery ? '$chave?${req.url.query}' : chave);
      if ((req.headers['content-type'] ?? '').startsWith('multipart/')) {
        multipart = latin1.decode(req.bodyBytes);
        return _json({
          'id': 'abc',
          'referencia': 'midia:abc',
          'formato': 'IMAGE',
          'nome': 'foto.png',
        }, 201);
      }
      if (req.bodyBytes.isNotEmpty) {
        corpos[chave] =
            jsonDecode(utf8.decode(req.bodyBytes)) as Map<String, dynamic>;
      }
      switch (chave) {
        case 'POST /modelos/conferir':
          return _json({'problemas': problemas}, 201);
        case 'POST /modelos':
          return _json({'id': 'm9'}, 201);
        case 'POST /modelos/m9/enviar':
          if (erroNoEnvio != null) {
            return _json({'mensagem': erroNoEnvio}, 400);
          }
          return _json({'status': statusDoEnvio, 'motivo': null}, 201);
        case 'GET /midia/abc':
          return http.Response.bytes(_png, 200);
      }
      if (req.method == 'PUT' && req.url.path.startsWith('/modelos/')) {
        return _json({'id': req.url.pathSegments.last, 'status': 'aprovado'});
      }
      return _json({});
    }),
  );
}

/// Abre o editor por cima de uma tela, para o teste ler o que ele devolve.
class _Abridor extends StatelessWidget {
  const _Abridor({required this.editor, required this.aoVoltar});

  final Widget editor;
  final void Function(ResultadoEditor?) aoVoltar;

  @override
  Widget build(BuildContext context) => Scaffold(
    body: Center(
      child: TextButton(
        onPressed: () async {
          final r = await Navigator.of(
            context,
          ).push<ResultadoEditor>(MaterialPageRoute(builder: (_) => editor));
          aoVoltar(r);
        },
        child: const Text('abrir'),
      ),
    ),
  );
}

Widget _app(ClienteApi api, Widget tela, {EscolherMidia? escolher}) =>
    ProviderScope(
      overrides: [
        clienteApiProvider.overrideWithValue(api),
        escolherMidiaProvider.overrideWithValue(escolher ?? (_) async => null),
      ],
      child: MaterialApp(
        theme: temaDoApp(Brightness.light),
        home: MediaQuery(
          data: const MediaQueryData(disableAnimations: true),
          child: tela,
        ),
      ),
    );

/// Celular alto (412×1830): o teste enxerga quase o formulário inteiro.
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

final _lista = find.byType(Scrollable).first;

/// Traz o alvo para a tela: rola para baixo até ele existir e depois o
/// centraliza (para cima também — a barra do topo cobre o que subiu).
Future<void> _ver(WidgetTester t, Finder alvo) async {
  if (alvo.evaluate().isEmpty) {
    await t.scrollUntilVisible(alvo, 200, scrollable: _lista);
  }
  await t.ensureVisible(alvo);
  await _assentar(t);
}

Future<void> _escrever(WidgetTester t, String chave, String texto) async {
  final campo = find.byKey(ValueKey(chave));
  await _ver(t, campo);
  await t.enterText(campo, texto);
  await _assentar(t);
}

/// Abre o editor pelo `_Abridor` e devolve onde o resultado vai cair.
Future<List<ResultadoEditor?>> _abrir(
  WidgetTester t,
  _Servidor s,
  Widget editor, {
  EscolherMidia? escolher,
}) async {
  _telaAlta(t);
  final resultado = <ResultadoEditor?>[];
  await t.pumpWidget(
    _app(
      s.api,
      _Abridor(editor: editor, aoVoltar: resultado.add),
      escolher: escolher,
    ),
  );
  await t.tap(find.text('abrir'));
  await _assentar(t);
  return resultado;
}

void main() {
  testWidgets('modelo novo: confere, grava e envia — e devolve o status', (
    t,
  ) async {
    final s = _Servidor();
    final fim = await _abrir(t, s, const TelaEditorModelo());

    expect(find.text('Novo modelo'), findsOneWidget);
    await _escrever(t, 'm-nome', 'Promo Sexta');
    await _escrever(t, 'm-corpo', 'Olá {{1}}, hoje o frete é por nossa conta!');
    await _escrever(t, 'm-ex-1', 'Maria');

    await t.tap(find.text('Enviar para aprovação'));
    await _assentar(t);

    expect(s.pedidos, [
      'POST /modelos/conferir',
      'POST /modelos',
      'POST /modelos/m9/enviar',
    ]);
    final corpo = s.corpos['POST /modelos']!;
    // O teclado do celular põe maiúscula e espaço; o nome técnico não aceita.
    expect(corpo['nome'], 'promo_sexta');
    expect(corpo['corpo'], 'Olá {{1}}, hoje o frete é por nossa conta!');
    expect(corpo['corpoExemplos'], ['Maria']);
    expect(corpo['categoria'], 'MARKETING');
    expect(fim.single!.fim, FimDoEditor.enviado);
    expect(fim.single!.status, 'enviado');
  });

  testWidgets(
    'com problema, nada vai para a Meta e cada ponto aparece na seção dele',
    (t) async {
      final s = _Servidor()
        ..problemas = [
          {'campo': 'nome', 'mensagem': 'Dê um nome técnico ao modelo.'},
          {
            'campo': 'corpo',
            'mensagem': 'A mensagem não pode terminar com uma variável.',
          },
        ];
      final fim = await _abrir(t, s, const TelaEditorModelo());
      await _escrever(t, 'm-corpo', 'Seu código é {{1}}');

      await t.tap(find.text('Enviar para aprovação'));
      await _assentar(t);

      expect(s.pedidos, ['POST /modelos/conferir']);
      expect(fim, isEmpty, reason: 'o editor continua aberto');
      expect(
        find.textContaining('Nada foi enviado para a Meta: há 2 pontos'),
        findsOneWidget,
      );
      expect(find.text('Dê um nome técnico ao modelo.'), findsOneWidget);
      expect(
        find.text('A mensagem não pode terminar com uma variável.'),
        findsOneWidget,
      );
    },
  );

  testWidgets(
    'o envio falha depois de gravar: diz que o rascunho ficou e a nova tentativa não cria outro',
    (t) async {
      final s = _Servidor()
        ..erroNoEnvio = 'Conecte sua conta do WhatsApp antes de criar modelos.';
      final fim = await _abrir(t, s, const TelaEditorModelo());
      await _escrever(t, 'm-nome', 'promo_sexta');
      await _escrever(t, 'm-corpo', 'Hoje o frete é por nossa conta.');

      await t.tap(find.text('Enviar para aprovação'));
      await _assentar(t);
      expect(
        find.text(
          'Conecte sua conta do WhatsApp antes de criar modelos. O rascunho ficou salvo.',
        ),
        findsOneWidget,
      );
      expect(fim, isEmpty);

      s.erroNoEnvio = null;
      await t.tap(find.text('Enviar para aprovação'));
      await _assentar(t);

      expect(s.quantos('POST /modelos'), 1, reason: 'um rascunho só');
      expect(s.quantos('PUT /modelos/m9'), 1);
      expect(s.quantos('POST /modelos/m9/enviar'), 2);
      expect(fim.single!.fim, FimDoEditor.enviado);
    },
  );

  testWidgets(
    'imagem do cabeçalho: escolhe no celular, sobe com o tipo e vai no modelo',
    (t) async {
      final s = _Servidor();
      final escolhidos = <String>[];
      final fim = await _abrir(
        t,
        s,
        const TelaEditorModelo(),
        escolher: (formato) async {
          escolhidos.add(formato);
          return ArquivoEscolhido(
            nome: 'foto.png',
            tamanho: _png.length,
            ler: () async => Uint8List.fromList(_png),
          );
        },
      );
      await _escrever(t, 'm-nome', 'promo_foto');
      await _escrever(t, 'm-corpo', 'Olha o smash novo da casa.');

      await _ver(t, find.byKey(const ValueKey('cabecalho-IMAGE')));
      await t.tap(find.byKey(const ValueKey('cabecalho-IMAGE')));
      await _assentar(t);
      expect(find.text('JPG ou PNG · até 5 MB'), findsOneWidget);
      await t.tap(find.byKey(const ValueKey('escolher-IMAGE')));
      await _assentar(t);

      expect(escolhidos, ['IMAGE']);
      expect(s.pedidos, contains('POST /midia'));
      expect(s.multipart, contains('content-type: image/png'));
      expect(s.multipart, contains('filename="foto.png"'));
      expect(find.text('foto.png'), findsOneWidget);

      await t.tap(find.text('Salvar rascunho'));
      await _assentar(t);
      final corpo = s.corpos['POST /modelos']!;
      expect(corpo['cabecalhoFormato'], 'IMAGE');
      expect(corpo['cabecalhoMidia'], 'midia:abc');
      expect(fim.single!.fim, FimDoEditor.rascunho);
    },
  );

  testWidgets('arquivo que a Meta recusa é barrado antes de subir', (t) async {
    final s = _Servidor();
    await _abrir(
      t,
      s,
      const TelaEditorModelo(),
      escolher: (_) async => ArquivoEscolhido(
        nome: 'print.webp',
        tamanho: 900,
        ler: () async => Uint8List(0),
      ),
    );
    await _ver(t, find.byKey(const ValueKey('cabecalho-IMAGE')));
    await t.tap(find.byKey(const ValueKey('cabecalho-IMAGE')));
    await _assentar(t);
    await t.tap(find.byKey(const ValueKey('escolher-IMAGE')));
    await _assentar(t);

    expect(find.textContaining('este arquivo é .webp'), findsOneWidget);
    expect(s.pedidos, isNot(contains('POST /midia')));
  });

  testWidgets(
    'carrossel: dois cartões de saída, e o cartão novo nasce com os botões do primeiro',
    (t) async {
      final s = _Servidor();
      final fim = await _abrir(t, s, const TelaEditorModelo());
      await _escrever(t, 'm-nome', 'vitrine');
      await _ver(t, find.byKey(const ValueKey('forma-carrossel')));
      await t.tap(find.byKey(const ValueKey('forma-carrossel')));
      await _assentar(t);

      expect(find.text('Cartão 1'), findsOneWidget);
      expect(find.text('Cartão 2'), findsOneWidget);
      expect(find.text('Cabeçalho'), findsNothing);

      await _escrever(t, 'm-corpo', 'Escolha o seu burger da semana.');
      final addBotao = find.text('Botão').first;
      await _ver(t, addBotao);
      await t.tap(addBotao);
      await _assentar(t);
      await t.tap(find.text('Resposta rápida').last);
      await _assentar(t);
      final textoDoBotao = find.widgetWithText(TextField, 'Texto do botão');
      await _ver(t, textoDoBotao);
      await t.enterText(textoDoBotao, 'Quero');
      await _assentar(t);

      final addCartao = find.text('Cartão');
      await _ver(t, addCartao);
      await t.tap(addCartao);
      await _assentar(t);
      expect(find.text('Cartão 3'), findsOneWidget);

      await t.tap(find.text('Salvar rascunho'));
      await _assentar(t);
      final cartoes = s.corpos['POST /modelos']!['cartoes'] as List;
      expect(cartoes, hasLength(3));
      const quero = {'tipo': 'QUICK_REPLY', 'texto': 'Quero'};
      expect((cartoes[0] as Map)['botoes'], [quero]);
      expect((cartoes[2] as Map)['botoes'], [quero]);
      expect((cartoes[1] as Map)['botoes'], isEmpty);
      expect(s.corpos['POST /modelos']!['tipo'], 'carrossel');
      expect(fim.single!.fim, FimDoEditor.rascunho);
    },
  );

  testWidgets(
    'modelo que já está na Meta: nome e categoria travados, confere com o id e manda a alteração',
    (t) async {
      final s = _Servidor();
      final naMeta = ModeloSalvo.deJson({
        'id': 'm5',
        'nome': 'promo_sexta',
        'idioma': 'pt_BR',
        'categoria': 'MARKETING',
        'status': 'aprovado',
        'corpo': 'Olá {{1}}, tem novidade hoje.',
        'corpoExemplos': ['Ana'],
        'metaTemplateId': '999',
      });
      final fim = await _abrir(t, s, TelaEditorModelo(inicial: naMeta));

      expect(find.text('Alterar modelo'), findsOneWidget);
      expect(find.text('Enviar para aprovação'), findsNothing);
      final nome = t.widget<TextField>(find.byKey(const ValueKey('m-nome')));
      expect(nome.enabled, isFalse);

      await _escrever(t, 'm-corpo', 'Olá {{1}}, tem novidade hoje na loja.');
      await t.tap(find.text('Salvar alteração na Meta'));
      await _assentar(t);
      expect(find.text('Enviar a alteração à Meta?'), findsOneWidget);
      await t.tap(find.text('Enviar'));
      await _assentar(t);

      expect(s.pedidos, ['POST /modelos/conferir?id=m5', 'PUT /modelos/m5']);
      expect(s.corpos['PUT /modelos/m5']!['corpoExemplos'], ['Ana']);
      expect(fim.single!.fim, FimDoEditor.alteradoNaMeta);
      expect(fim.single!.status, 'aprovado');
      expect(
        fim.single!.mensagem,
        'Alteração aceita: a Meta manteve o modelo aprovado.',
      );
    },
  );

  testWidgets('conferir regras sem gravar nada', (t) async {
    final s = _Servidor();
    await _abrir(t, s, const TelaEditorModelo());
    await _escrever(t, 'm-corpo', 'Hoje o frete é por nossa conta.');
    await t.tap(find.text('Conferir regras'));
    await _assentar(t);

    expect(s.pedidos, ['POST /modelos/conferir']);
    expect(find.textContaining('Passou em todas as regras'), findsOneWidget);
  });

  testWidgets('sair com alteração pergunta antes de perder o que foi escrito', (
    t,
  ) async {
    final s = _Servidor();
    final fim = await _abrir(t, s, const TelaEditorModelo());
    await _escrever(t, 'm-corpo', 'Rascunho que ninguém salvou.');

    await t.pageBack();
    await _assentar(t);
    expect(find.text('Sair sem salvar?'), findsOneWidget);
    await t.tap(find.text('Sair'));
    await _assentar(t);

    expect(find.text('abrir'), findsOneWidget);
    expect(fim.single, isNull);
    expect(s.pedidos, isEmpty);
  });

  testWidgets('a prévia abre com a imagem guardada e troca para o escuro', (
    t,
  ) async {
    final s = _Servidor();
    final comImagem = ModeloSalvo.deJson({
      'id': 'm7',
      'nome': 'promo_foto',
      'categoria': 'MARKETING',
      'status': 'rascunho',
      'cabecalhoFormato': 'IMAGE',
      'cabecalhoMidia': 'midia:abc',
      'corpo': 'Olá {{1}}, chegou o smash novo.',
      'corpoExemplos': ['Ana'],
    });
    await _abrir(t, s, TelaEditorModelo(inicial: comImagem));
    await t.tap(find.text('Prévia'));
    await _assentar(t);

    expect(find.text('Como vai chegar'), findsOneWidget);
    // O exemplo entra no lugar da variável, como a mensagem chega.
    expect(
      find.textContaining('Olá Ana, chegou o smash novo.'),
      findsOneWidget,
    );
    expect(find.text('Parar promoções'), findsOneWidget);
    expect(s.pedidos, contains('GET /midia/abc'));
    await t.tap(find.byKey(const ValueKey('tema-escuro')));
    await _assentar(t);
    expect(find.text('Como vai chegar'), findsOneWidget);
  });

  testWidgets(
    'detalhe: recusado que não chegou à Meta pode ser enviado de novo, e carrossel edita pelo app',
    (t) async {
      final s = _Servidor();
      _telaAlta(t);
      final recusado = ModeloSalvo.deJson({
        'id': 'm9',
        'nome': 'vitrine',
        'tipo': 'carrossel',
        'categoria': 'MARKETING',
        'status': 'rejeitado',
        'motivo': 'O conteúdo parece promoção enganosa.',
        'corpo': 'Escolha o seu.',
        'cartoes': [
          {'corpo': 'Smash', 'imagem': 'midia:abc'},
          {'corpo': 'Duplo', 'imagem': 'midia:abc'},
        ],
      });
      await t.pumpWidget(_app(s.api, TelaModeloDetalhe(local: recusado)));
      await _assentar(t);

      expect(
        find.textContaining('A Meta recusou: O conteúdo parece'),
        findsOneWidget,
      );
      expect(find.text('Enviar para aprovação'), findsOneWidget);
      expect(find.textContaining('pelo site'), findsNothing);
      await t.tap(find.byTooltip('Mais ações'));
      await _assentar(t);
      expect(find.text('Editar'), findsWidgets);
    },
  );
}
