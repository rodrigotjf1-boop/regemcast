import 'dart:io';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:regemcast/componentes/basicos.dart';
import 'package:regemcast/componentes/dialogos.dart';
import 'package:regemcast/componentes/escolha.dart';
import 'package:regemcast/telas/regras.dart';
import 'package:regemcast/tema/tema.dart';

/// A barra de navegação de três botões do Android: uns 48 pontos. Desde o
/// Android 15 o app desenha por trás dela (edge-to-edge) — ERR-030.
const _barra = 48.0;
const _dpr = 2.625;

/// A tela do celular com a barra de três botões — e, se [teclado] > 0, com o
/// teclado aberto (aí o `padding` de baixo zera: o teclado cobre a barra).
double _telaComBarra(WidgetTester t, {double teclado = 0}) {
  t.view.physicalSize = const Size(1080, 2400);
  t.view.devicePixelRatio = _dpr;
  t.view.viewPadding = const FakeViewPadding(
    top: 24 * _dpr,
    bottom: _barra * _dpr,
  );
  t.view.padding = FakeViewPadding(
    top: 24 * _dpr,
    bottom: teclado > 0 ? 0 : _barra * _dpr,
  );
  t.view.viewInsets = FakeViewPadding(bottom: teclado * _dpr);
  addTearDown(t.view.reset);
  return 2400 / _dpr;
}

Widget _app(Widget tela) =>
    MaterialApp(theme: temaDoApp(Brightness.light), home: tela);

Future<void> _assentar(WidgetTester t) async {
  for (var i = 0; i < 20; i++) {
    await t.pump(const Duration(milliseconds: 50));
  }
}

/// Rola até o fim de verdade. Um arrasto do teste para antes do fim (a
/// tolerância de toque come a ponta do gesto), e a lista monta os itens aos
/// poucos — o máximo cresce depois de cada salto. Salta até ele parar.
Future<void> _rolarAteOFim(WidgetTester t, Finder rolagem) async {
  final posicao = t.state<ScrollableState>(rolagem).position;
  for (var i = 0; i < 10; i++) {
    posicao.jumpTo(posicao.maxScrollExtent);
    await _assentar(t);
    if (posicao.pixels >= posicao.maxScrollExtent) break;
  }
  expect(posicao.pixels, posicao.maxScrollExtent);
}

/// Onde termina, na tela, o texto mais baixo dentro de [onde].
double _fimDoUltimoTexto(Finder onde) {
  var fim = 0.0;
  for (final e
      in find.descendant(of: onde, matching: find.byType(Text)).evaluate()) {
    final caixa = e.renderObject! as RenderBox;
    if (!caixa.hasSize) continue;
    fim = math.max(
      fim,
      caixa.localToGlobal(Offset.zero).dy + caixa.size.height,
    );
  }
  return fim;
}

CampoDeEscolha<String> _campo(int opcoes, ValueChanged<String> aoEscolher) =>
    CampoDeEscolha<String>(
      rotulo: 'Quem recebe',
      valor: null,
      grupos: [
        GrupoDeEscolha('Listas', [
          for (var i = 1; i <= opcoes; i++)
            OpcaoDeEscolha(valor: 'l$i', texto: 'Lista $i'),
        ]),
      ],
      aoEscolher: aoEscolher,
    );

void main() {
  testWidgets(
    'lista longa de opções: rolada até o fim, a última fica acima dos botões do Android',
    (t) async {
      final altura = _telaComBarra(t);
      String? escolhido;
      await t.pumpWidget(
        _app(Scaffold(body: Center(child: _campo(30, (v) => escolhido = v)))),
      );
      await t.tap(find.byType(CampoDeEscolha<String>));
      await _assentar(t);

      final rolagem = find.descendant(
        of: find.byType(BottomSheet),
        matching: find.byType(Scrollable),
      );
      await _rolarAteOFim(t, rolagem.first);

      final ultima = find.ancestor(
        of: find.text('Lista 30'),
        matching: find.byType(ListTile),
      );
      expect(
        t.getRect(ultima).bottom,
        lessThanOrEqualTo(altura - _barra),
        reason: 'a última opção ficaria atrás dos botões do Android',
      );
      // O fundo da folha segue até a borda (por trás da barra), como pede o
      // Material; só o conteúdo para antes.
      expect(t.getRect(find.byType(BottomSheet)).bottom, altura);

      await t.tap(ultima);
      await _assentar(t);
      expect(escolhido, 'l30');
    },
  );

  testWidgets('lista curta: sem rolar, a última opção já fica acima da barra', (
    t,
  ) async {
    final altura = _telaComBarra(t);
    await t.pumpWidget(_app(Scaffold(body: Center(child: _campo(4, (_) {})))));
    await t.tap(find.byType(CampoDeEscolha<String>));
    await _assentar(t);

    final ultima = find.ancestor(
      of: find.text('Lista 4'),
      matching: find.byType(ListTile),
    );
    expect(t.getRect(ultima).bottom, lessThanOrEqualTo(altura - _barra));
  });

  testWidgets(
    'folha com campo de texto e teclado aberto: o botão fica logo acima do teclado, sem somar a barra',
    (t) async {
      const teclado = 300.0;
      final altura = _telaComBarra(t, teclado: teclado);
      await t.pumpWidget(
        _app(
          Scaffold(
            body: Builder(
              builder: (context) => Center(
                child: TextButton(
                  onPressed: () => abrirFolha<void>(
                    context,
                    builder: (ctx) => Padding(
                      // O jeito das folhas do app: 20 + a altura do teclado.
                      padding: EdgeInsets.fromLTRB(
                        20,
                        0,
                        20,
                        20 + MediaQuery.viewInsetsOf(ctx).bottom,
                      ),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          const TextField(),
                          const SizedBox(height: 16),
                          FilledButton(
                            key: const ValueKey('botao-da-folha'),
                            onPressed: () {},
                            child: const Text('Salvar'),
                          ),
                        ],
                      ),
                    ),
                  ),
                  child: const Text('abrir'),
                ),
              ),
            ),
          ),
        ),
      );
      await t.tap(find.text('abrir'));
      await _assentar(t);

      final botao = t.getRect(find.byKey(const ValueKey('botao-da-folha')));
      expect(botao.bottom, lessThanOrEqualTo(altura - teclado));
      expect(
        botao.bottom,
        greaterThan(altura - teclado - 20 - 1),
        reason: 'com o teclado aberto a barra não entra na conta duas vezes',
      );
    },
  );

  testWidgets(
    'tela aberta por cima: rolada até o fim, o último conteúdo fica acima da barra',
    (t) async {
      final altura = _telaComBarra(t);
      await t.pumpWidget(_app(const TelaRegras()));
      await _assentar(t);

      await _rolarAteOFim(t, find.byType(Scrollable).first);

      final lista = t.widget<ListView>(find.byType(ListView).first);
      expect(
        (lista.padding! as EdgeInsets).bottom,
        28 + _barra,
        reason: 'o respiro do fim soma a barra de navegação',
      );
      // Rolada até o fim, o último texto da tela termina acima da barra.
      final fim = _fimDoUltimoTexto(find.byType(ListView).first);
      expect(fim, greaterThan(0));
      expect(fim, lessThanOrEqualTo(altura - _barra));
    },
  );

  testWidgets(
    'com barra de baixo no Scaffold (as abas), o respiro não soma a barra do sistema',
    (t) async {
      _telaComBarra(t);
      late EdgeInsets comAbas;
      late EdgeInsets semAbas;
      await t.pumpWidget(
        _app(
          Scaffold(
            bottomNavigationBar: const SizedBox(height: 64),
            body: Builder(
              builder: (ctx) {
                comAbas = respiroDaTela(ctx);
                return const SizedBox.shrink();
              },
            ),
          ),
        ),
      );
      await t.pumpWidget(
        _app(
          Scaffold(
            body: Builder(
              builder: (ctx) {
                semAbas = respiroDaTela(ctx);
                return const SizedBox.shrink();
              },
            ),
          ),
        ),
      );
      expect(comAbas.bottom, 28);
      expect(semAbas.bottom, 28 + _barra);
    },
  );

  test('toda folha de baixo passa por abrirFolha (ERR-030)', () {
    final fora = <String>[];
    for (final arquivo
        in Directory('lib')
            .listSync(recursive: true)
            .whereType<File>()
            .where((f) => f.path.endsWith('.dart'))) {
      final caminho = arquivo.path.replaceAll('\\', '/');
      if (caminho.endsWith('componentes/dialogos.dart')) continue;
      if (arquivo.readAsStringSync().contains('showModalBottomSheet')) {
        fora.add(caminho);
      }
    }
    expect(
      fora,
      isEmpty,
      reason:
          'abra folhas com abrirFolha (componentes/dialogos.dart): o showModalBottomSheet sozinho deixa o fim atrás dos botões do Android',
    );
  });
}
