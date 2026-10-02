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
import 'package:regemcast/api/repeticao.dart';
import 'package:regemcast/config.dart';
import 'package:regemcast/push/push.dart';
import 'package:regemcast/sessao/sessao.dart';
import 'package:regemcast/telas/casca.dart';
import 'package:regemcast/telas/importar_contatos.dart';
import 'package:regemcast/telas/integracoes.dart';
import 'package:regemcast/telas/whatsapp.dart';
import 'package:regemcast/tema/tema.dart';

http.Response _json(Object corpo, [int status = 200]) => http.Response.bytes(
  utf8.encode(jsonEncode(corpo)),
  status,
  headers: {'content-type': 'application/json; charset=utf-8'},
);

Map<String, dynamic> _numero({
  String id = '1111',
  String? tierNome = 'TIER_10K',
  int? tierLimite = 10000,
  bool coexistencia = true,
  String sincronizacao = 'concluida',
  double? horas,
  Object? integrar = true,
  String qualidade = 'verde',
  String status = 'registrado',
}) => {
  'phoneNumberId': id,
  'telefone': '+55 21 99999-8888',
  'nome': 'Mister Burgers',
  'qualidade': qualidade,
  'tierLimite': tierLimite,
  'tierNome': tierNome,
  'status': status,
  'coexistencia': coexistencia,
  'sincronizacao': sincronizacao,
  'horasParaSincronizar': horas,
  'vazaoMaxima': coexistencia ? 20 : 80,
  'integrarConversas': integrar,
};

Map<String, dynamic> _situacaoWhatsapp({
  bool conectado = true,
  List<Map<String, dynamic>>? numeros,
  DateTime? expiraEm,
  bool webhook = false,
  String? pagamentoUrl,
}) => {
  'conectado': conectado,
  'conta': conectado
      ? {
          'nome': 'Mister Burgers Ltda',
          'wabaId': '123456789',
          'moeda': 'BRL',
          'pagamentoUrl': pagamentoUrl,
          'webhookAssinadoEm': webhook ? '2026-09-20T12:00:00Z' : null,
          'tokenExpiraEm': expiraEm?.toUtc().toIso8601String(),
        }
      : null,
  'numeros': conectado ? (numeros ?? [_numero()]) : <Object>[],
};

/// A saúde da conta como o servidor manda (`GET /whatsapp/saude`).
Map<String, dynamic> _saude({
  String sinal = 'pode_enviar',
  String titulo = 'Pode enviar',
  String resumo = 'A Meta não aponta nada que impeça o envio.',
  List<Map<String, dynamic>>? itens,
}) => {
  'sinal': sinal,
  'titulo': titulo,
  'resumo': resumo,
  'lidaEm': '2026-10-01T22:10:00Z',
  'itens':
      itens ??
      [
        {
          'chave': 'conta',
          'rotulo': 'Conta do WhatsApp',
          'sinal': 'pode_enviar',
          'resumo': 'Pode enviar.',
          'problemas': <Object>[],
        },
        {
          'chave': 'numero:1111',
          'rotulo': 'Número +55 21 99999-8888',
          'sinal': 'pode_enviar',
          'resumo': 'Pode enviar.',
          'problemas': <Object>[],
        },
      ],
};

/// A conta bloqueada pela Meta, com o que ela respondeu.
const _contaBloqueada = {
  'chave': 'conta',
  'rotulo': 'Conta do WhatsApp',
  'sinal': 'bloqueado',
  'resumo': 'Bloqueado para enviar.',
  'problemas': [
    {
      'codigo': 141006,
      'titulo': 'A Meta bloqueou o envio por um problema da conta do WhatsApp',
      'explicacao':
          'Enquanto isso não for resolvido, a Meta recusa as mensagens desta conta.',
      'acao':
          'A Meta diz o que ela pede em "O que a Meta respondeu", logo abaixo.',
      'quem': 'voce',
      'tela': null,
      'link': null,
      'daMeta': 'There is an error with the payment method.',
    },
  ],
};

/// O pagamento a conferir: aviso nosso, com o atalho para a Meta.
const _pagamentoAConferir = {
  'chave': 'pagamento',
  'rotulo': 'Pagamento na Meta',
  'sinal': 'com_restricao',
  'resumo': 'A Meta não informa a forma de pagamento desta conta.',
  'problemas': [
    {
      'codigo': null,
      'titulo': 'Confira o pagamento da conta na Meta',
      'explicacao':
          'A Meta cobra as mensagens direto da conta do WhatsApp, e não informa a forma de pagamento desta conta.',
      'acao': 'Abra o pagamento da conta na Meta e confira o cartão.',
      'quem': 'voce',
      'tela': null,
      'link': {
        'rotulo': 'Abrir o pagamento na Meta',
        'url':
            'https://business.facebook.com/billing_hub/accounts/details/?business_id=1&asset_id=2',
      },
      'daMeta': null,
    },
  ],
};

Map<String, dynamic> _cw({
  bool conectado = true,
  String clientes = 'concluida',
  int pagina = 2,
  int? totalPaginas = 5,
  String? pedidos = 'em_dia',
  String? erroPedidos,
  bool saldos = true,
}) => {
  'conectado': conectado,
  'modo': conectado ? 'chave' : null,
  'lojaNome': conectado ? 'Mister Burgers Tijuca' : null,
  'sincronizacao': {
    'status': clientes,
    'pagina': pagina,
    'totalPaginas': totalPaginas,
    'lidos': 120,
    'novos': 30,
    'bloqueados': 4,
    'invalidos': 2,
    'iniciadaEm': null,
    'concluidaEm': '2026-09-25T15:00:00Z',
    'erro': clientes == 'falhou' ? 'O Cardápio Web não respondeu.' : null,
    'listaId': null,
  },
  if (pedidos != null)
    'pedidos': {
      'status': pedidos,
      'progresso': 40,
      'cargaDe': '2023-09-29T00:00:00Z',
      'cargaAte': '2026-09-29T00:00:00Z',
      'lidos': 5200,
      'ignorados': 10,
      'ultimaConsulta': '2026-09-29T14:30:00Z',
      'erro': erroPedidos,
      'compras': 4870,
      'clientes': 1480,
      'primeira': '2023-10-02T00:00:00Z',
      'ultima': '2026-09-29T13:10:00Z',
    },
  if (saldos)
    'saldos': {
      'comCashback': 310,
      'vencendo': 42,
      'totalCentavos': 123450,
      'lendo': false,
      'ultimaLeitura': '2026-09-29T07:00:00Z',
      'proximaLeitura': '2026-09-30T07:00:00Z',
      'erro': null,
    },
};

/// O servidor falso: anota cada pedido e o corpo de cada escrita; as
/// situações seguintes saem de uma fila (a última se repete).
class _Servidor {
  _Servidor({
    Map<String, dynamic>? whatsapp,
    List<Map<String, dynamic>>? cardapioWeb,
  }) : whatsapp = whatsapp ?? _situacaoWhatsapp(),
       cardapioWeb = cardapioWeb ?? [_cw()];

  Map<String, dynamic> whatsapp;
  List<Map<String, dynamic>> cardapioWeb;
  bool conversasNaConta = false;

  /// A saúde da conta; nulo = o servidor não devolve sinal nenhum.
  Map<String, dynamic>? saude;

  /// O que a Meta responde no "Conferir agora" (`?atualizar=1`).
  Map<String, dynamic>? saudeConferida;
  bool saudeForaDoAr = false;
  final pedidos = <String>[];
  final corpos = <String, Object?>{};

  ClienteApi get api => ClienteApi(
    base: 'https://api.teste',
    http: MockClient((req) async {
      final chave = '${req.method} ${req.url.path}';
      pedidos.add(chave);
      if (req.body.isNotEmpty) corpos[chave] = jsonDecode(req.body);
      switch (chave) {
        case 'GET /whatsapp/situacao':
          return _json(whatsapp);
        case 'GET /whatsapp/saude':
          if (saudeForaDoAr) return _json({'message': 'Fora do ar'}, 503);
          if (req.url.query == 'atualizar=1') {
            pedidos.add('GET /whatsapp/saude?atualizar=1');
            if (saudeConferida != null) saude = saudeConferida;
          }
          return _json(saude ?? {});
        case 'GET /whatsapp/config':
          return _json({
            'appId': '1',
            'configId': '2',
            'graphVersao': 'v23.0',
            'declaracaoIntegracao':
                'As pessoas da agenda deste número autorizaram receber mensagens da minha empresa.',
          });
        case 'POST /whatsapp/integrar':
          return _json({
            'phoneNumberId': (corpos[chave] as Map)['phoneNumberId'],
            'integrarConversas': (corpos[chave] as Map)['integrar'],
          }, 201);
        case 'GET /integracoes/cardapioweb':
          final atual = cardapioWeb.first;
          if (cardapioWeb.length > 1) cardapioWeb.removeAt(0);
          return _json(atual);
        case 'POST /integracoes/cardapioweb/chave':
          return _json({'lojaNome': 'Mister Burgers Tijuca'}, 201);
        case 'POST /integracoes/cardapioweb/importar':
        case 'POST /integracoes/cardapioweb/pedidos':
          return _json(cardapioWeb.first, 201);
        case 'DELETE /integracoes/cardapioweb':
          return http.Response('', 204);
        case 'GET /conta':
          return _json({
            'conta': {'nome': 'MISTER BURGERS'},
            'uso': {'disparos': 0},
            'conversasHabilitadas': conversasNaConta,
          });
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
      'conta': {'id': 'c', 'nome': 'MISTER BURGERS', 'status': 'ativa'},
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
  String papel = 'dono',
}) async {
  _telaAlta(t);
  await t.pumpWidget(_app(s, tela, papel: papel));
  await _assentar(t);
}

/// Rola até o alvo (a lista só monta o que está perto da tela), espera o
/// quadro com a rolagem nova e só então toca.
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

void main() {
  setUpAll(() => initializeDateFormatting('pt_BR'));

  group('WhatsApp', () {
    testWidgets(
      'conta conectada: nome, WABA, moeda, entrega pendente e o número completo',
      (t) async {
        final s = _Servidor();
        await _abrir(t, s, const TelaWhatsapp());

        expect(find.text('Mister Burgers Ltda'), findsOneWidget);
        expect(find.text('Conectada'), findsOneWidget);
        expect(find.text('Status de entrega pendente'), findsOneWidget);
        expect(
          find.text('WABA 123456789 · Cobrança da Meta em BRL · 1 número'),
          findsOneWidget,
        );
        expect(find.text('Pronto para enviar'), findsOneWidget);
        expect(find.text('Qualidade: Boa'), findsOneWidget);
        expect(find.text('Também no seu celular'), findsOneWidget);
        expect(find.text('até 20 msg/s'), findsOneWidget);
        expect(find.text('10.000 pessoas / 24h'), findsOneWidget);
        expect(
          find.textContaining(
            'É o teto de quem mantém o aplicativo no celular',
          ),
          findsOneWidget,
        );
        expect(find.textContaining('uma vez a cada 13 dias'), findsOneWidget);
      },
    );

    testWidgets(
      'pagamento na Meta: o atalho aparece com o endereço da conta — e não no app da Play',
      (t) async {
        final s = _Servidor(
          whatsapp: _situacaoWhatsapp(
            pagamentoUrl:
                'https://business.facebook.com/billing_hub/accounts/details/?business_id=1&asset_id=123456789&account_type=whatsapp-business-account',
          ),
        );
        await _abrir(t, s, const TelaWhatsapp());

        // No app da Play nada leva a uma página de pagamento fora dele.
        expect(
          find.byKey(const ValueKey('w-pagamento-meta')),
          compraNoApp ? findsOneWidget : findsNothing,
        );
        expect(
          find.textContaining('A Meta cobra as mensagens direto desta conta'),
          compraNoApp ? findsOneWidget : findsNothing,
        );
      },
    );

    testWidgets(
      'pagamento na Meta: sem endereço (ou com endereço que não é https), sem botão',
      (t) async {
        await _abrir(t, _Servidor(), const TelaWhatsapp());
        expect(find.byKey(const ValueKey('w-pagamento-meta')), findsNothing);

        final s = _Servidor(
          whatsapp: _situacaoWhatsapp(pagamentoUrl: 'javascript:alert(1)'),
        );
        expect(SituacaoWhatsapp.deJson(s.whatsapp).pagamentoUrl, isNull);
      },
    );

    testWidgets('sem teto, qualidade ruim e número dedicado', (t) async {
      final s = _Servidor(
        whatsapp: _situacaoWhatsapp(
          webhook: true,
          numeros: [
            _numero(
              tierNome: 'TIER_UNLIMITED',
              tierLimite: null,
              coexistencia: false,
              qualidade: 'vermelha',
              sincronizacao: 'nao_se_aplica',
            ),
          ],
        ),
      );
      await _abrir(t, s, const TelaWhatsapp());

      expect(find.text('Sem teto'), findsOneWidget);
      expect(find.text('Status de entrega pendente'), findsNothing);
      expect(find.text('Qualidade: Ruim'), findsOneWidget);
      expect(find.textContaining('Muita gente marcou'), findsOneWidget);
      // Número dedicado: sem cópia do celular nem a pergunta das conversas.
      expect(find.text('Também no seu celular'), findsNothing);
      expect(find.byKey(const ValueKey('conversas-1111')), findsNothing);
    });

    testWidgets('autorização vencendo em 3 dias, e vencida', (t) async {
      final s = _Servidor(
        whatsapp: _situacaoWhatsapp(
          expiraEm: DateTime.now().add(const Duration(days: 2, hours: 20)),
        ),
      );
      await _abrir(t, s, const TelaWhatsapp());
      expect(
        find.textContaining('vence em 3 dias. Reconecte antes disso'),
        findsOneWidget,
      );

      s.whatsapp = _situacaoWhatsapp(
        expiraEm: DateTime.now().subtract(const Duration(days: 1)),
      );
      await t.pumpWidget(Container());
      await _abrir(t, s, const TelaWhatsapp());
      expect(
        find.textContaining('A autorização do WhatsApp venceu'),
        findsOneWidget,
      );

      s.whatsapp = _situacaoWhatsapp(
        expiraEm: DateTime.now().add(const Duration(days: 30)),
      );
      await t.pumpWidget(Container());
      await _abrir(t, s, const TelaWhatsapp());
      expect(find.byKey(const ValueKey('vencimento')), findsNothing);
    });

    testWidgets(
      'a cópia que falhou ou expirou aparece, com o caminho (ERR-028)',
      (t) async {
        for (final estado in ['falhou', 'expirada']) {
          final s = _Servidor(
            whatsapp: _situacaoWhatsapp(
              numeros: [_numero(sincronizacao: estado)],
            ),
          );
          await t.pumpWidget(Container());
          await _abrir(t, s, const TelaWhatsapp());
          expect(
            find.byKey(ValueKey('sincronizacao-$estado')),
            findsOneWidget,
            reason: estado,
          );
          expect(find.text('Conectar de novo no site'), findsOneWidget);
        }
      },
    );

    testWidgets('copiando: o prazo em horas', (t) async {
      final s = _Servidor(
        whatsapp: _situacaoWhatsapp(
          numeros: [_numero(sincronizacao: 'sincronizando', horas: 5.6)],
        ),
      );
      await _abrir(t, s, const TelaWhatsapp());
      expect(
        find.textContaining(
          'Copiando seus contatos e conversas. Mantenha o WhatsApp Business aberto',
        ),
        findsOneWidget,
      );
      expect(
        find.textContaining('Faltam 5 horas para o prazo acabar.'),
        findsOneWidget,
      );
    });

    testWidgets(
      'sem resposta: o dono responde "sim" com a declaração do servidor',
      (t) async {
        final s = _Servidor(
          whatsapp: _situacaoWhatsapp(numeros: [_numero(integrar: null)]),
        );
        await _abrir(t, s, const TelaWhatsapp());

        expect(s.pedidos, contains('GET /whatsapp/config'));
        expect(
          find.textContaining(
            'Ao escolher sim, você declara: “As pessoas da agenda',
          ),
          findsOneWidget,
        );
        final salvar = find.byKey(const ValueKey('salvar-resposta'));
        expect(t.widget<FilledButton>(salvar).onPressed, isNull);
        await _tocar(t, find.byKey(const ValueKey('integrar-true')));
        await _tocar(t, salvar);

        expect(s.corpos['POST /whatsapp/integrar'], {
          'phoneNumberId': '1111',
          'integrar': true,
        });
        expect(
          find.text(
            'Resposta salva. Os contatos que já chegaram entram na sua base em até um minuto.',
          ),
          findsOneWidget,
        );
      },
    );

    testWidgets('operador vê o estado, mas não responde', (t) async {
      final s = _Servidor(
        whatsapp: _situacaoWhatsapp(numeros: [_numero(integrar: null)]),
      );
      await _abrir(t, s, const TelaWhatsapp(), papel: 'operador');
      expect(
        find.textContaining('O dono da conta ainda não respondeu'),
        findsOneWidget,
      );
      expect(find.byKey(const ValueKey('salvar-resposta')), findsNothing);
      expect(s.pedidos, isNot(contains('GET /whatsapp/config')));
    });

    testWidgets('trazendo: o dono para, com confirmação', (t) async {
      final s = _Servidor();
      await _abrir(t, s, const TelaWhatsapp());
      expect(find.text('Trazendo para o Regemcast'), findsOneWidget);
      await _tocar(t, find.byKey(const ValueKey('parar-de-trazer')));
      expect(find.text('Parar de trazer?'), findsOneWidget);
      await _tocar(t, find.widgetWithText(FilledButton, 'Parar de trazer'));
      expect(s.corpos['POST /whatsapp/integrar'], {
        'phoneNumberId': '1111',
        'integrar': false,
      });
    });

    testWidgets(
      'não trazemos: "Passar a trazer" abre a pergunta com Cancelar',
      (t) async {
        final s = _Servidor(
          whatsapp: _situacaoWhatsapp(numeros: [_numero(integrar: false)]),
        );
        await _abrir(t, s, const TelaWhatsapp());
        expect(find.text('Não trazemos'), findsOneWidget);
        await _tocar(t, find.byKey(const ValueKey('passar-a-trazer')));
        expect(find.byKey(const ValueKey('salvar-resposta')), findsOneWidget);
        await _tocar(t, find.text('Cancelar'));
        expect(find.text('Não trazemos'), findsOneWidget);
      },
    );

    testWidgets(
      'saúde: tudo certo — o sinal, quando foi conferida e cada item',
      (t) async {
        final s = _Servidor()..saude = _saude();
        await _abrir(t, s, const TelaWhatsapp());

        expect(find.byKey(const ValueKey('saude')), findsOneWidget);
        expect(find.text('Pode enviar'), findsOneWidget);
        expect(find.text('Tudo certo'), findsOneWidget);
        expect(find.textContaining('Conferida em'), findsOneWidget);
        expect(find.byKey(const ValueKey('saude-conta')), findsOneWidget);
        expect(find.byKey(const ValueKey('saude-numero:1111')), findsOneWidget);
        expect(find.text('O que fazer: '), findsNothing);
      },
    );

    testWidgets(
      'saúde: conta bloqueada — o motivo, o que fazer e a frase da Meta recolhida',
      (t) async {
        final s = _Servidor()
          ..saude = _saude(
            sinal: 'bloqueado',
            titulo: 'Não pode enviar agora',
            resumo:
                'Há 1 ponto a resolver — veja abaixo o que fazer em cada um.',
            itens: [_contaBloqueada],
          );
        await _abrir(t, s, const TelaWhatsapp());

        expect(find.text('Não pode enviar agora'), findsOneWidget);
        expect(find.text('Bloqueado'), findsOneWidget);
        expect(
          find.text(
            'A Meta bloqueou o envio por um problema da conta do WhatsApp',
          ),
          findsOneWidget,
        );
        expect(find.text('Depende de você'), findsOneWidget);
        // A frase da Meta, em inglês, nunca é a explicação: só ao abrir.
        expect(find.textContaining('payment method'), findsNothing);
        await _tocar(t, find.byKey(const ValueKey('erro-da-meta')));
        expect(
          find.text(
            'Código 141006. There is an error with the payment method.',
          ),
          findsOneWidget,
        );
      },
    );

    testWidgets(
      'saúde: pagamento a conferir — o atalho para a Meta só fora do app da Play',
      (t) async {
        final s = _Servidor()
          ..saude = _saude(
            sinal: 'com_restricao',
            titulo: 'Envia com restrição',
            resumo: 'Há 1 ponto de atenção — o envio sai, mas vale resolver.',
            itens: [_pagamentoAConferir],
          );
        await _abrir(t, s, const TelaWhatsapp());

        expect(find.text('Atenção'), findsOneWidget);
        expect(
          find.text('Confira o pagamento da conta na Meta'),
          findsOneWidget,
        );
        // No app da Play nada leva a uma página de pagamento fora dele.
        expect(
          find.byKey(const ValueKey('erro-link')),
          compraNoApp ? findsOneWidget : findsNothing,
        );
      },
    );

    testWidgets(
      'saúde: a conexão que vence fica só na linha — o botão é o do aviso abaixo',
      (t) async {
        final s =
            _Servidor(
                whatsapp: _situacaoWhatsapp(
                  expiraEm: DateTime.now().add(const Duration(days: 3)),
                ),
              )
              ..saude = _saude(
                sinal: 'com_restricao',
                titulo: 'Envia com restrição',
                itens: [
                  {
                    'chave': 'conexao',
                    'rotulo': 'Conexão com o Regemcast',
                    'sinal': 'com_restricao',
                    'resumo': 'A autorização vence em 3 dias.',
                    'problemas': [
                      {
                        'codigo': null,
                        'titulo': 'A autorização da conta está para vencer',
                        'explicacao': 'A autorização tem prazo.',
                        'acao': 'Reconecte o WhatsApp.',
                        'quem': 'voce',
                        'tela': 'whatsapp',
                        'link': null,
                        'daMeta': null,
                      },
                    ],
                  },
                ],
              );
        await _abrir(t, s, const TelaWhatsapp());

        expect(find.text('A autorização vence em 3 dias.'), findsOneWidget);
        expect(
          find.text('A autorização da conta está para vencer'),
          findsNothing,
        );
        expect(find.byKey(const ValueKey('erro-tela')), findsNothing);
        expect(find.byKey(const ValueKey('vencimento')), findsOneWidget);
      },
    );

    testWidgets(
      'saúde: a Meta recusou a autorização (190) — o problema aparece no cartão, sem atalho para a própria tela',
      (t) async {
        final s = _Servidor()
          ..saude = _saude(
            sinal: 'bloqueado',
            titulo: 'Não pode enviar agora',
            itens: [
              {
                'chave': 'conexao',
                'rotulo': 'Conexão com o Regemcast',
                'sinal': 'bloqueado',
                'resumo': 'A Meta recusou a autorização desta conta.',
                'problemas': [
                  {
                    'codigo': 190,
                    'titulo': 'A conexão com a Meta caiu',
                    'explicacao':
                        'A Meta recusou a autorização que o Regemcast tem desta conta.',
                    'acao':
                        'É preciso refazer a conexão desta conta com a Meta.',
                    'quem': 'voce',
                    'tela': 'whatsapp',
                    'link': null,
                    'daMeta': null,
                  },
                ],
              },
            ],
          );
        await _abrir(t, s, const TelaWhatsapp());

        expect(find.text('A conexão com a Meta caiu'), findsOneWidget);
        expect(find.byKey(const ValueKey('erro-tela')), findsNothing);
      },
    );

    testWidgets(
      'saúde: número com restrição pelo nome de exibição — diz o motivo e o que fazer',
      (t) async {
        final s = _Servidor()
          ..saude = _saude(
            sinal: 'com_restricao',
            titulo: 'Envia com restrição',
            resumo: 'Há 1 ponto de atenção — o envio sai, mas vale resolver.',
            itens: [
              {
                'chave': 'numero:1111',
                'rotulo': 'Número +55 21 99999-8888',
                'sinal': 'com_restricao',
                'resumo': 'Envia com restrição.',
                'problemas': [
                  {
                    'codigo': null,
                    'titulo':
                        'O nome de exibição do número ainda não foi aprovado',
                    'explicacao':
                        'Enquanto a Meta não aprova o nome de exibição, o número envia com um limite menor de mensagens.',
                    'acao':
                        'Confira o nome de exibição do número no Gerenciador do WhatsApp, na Meta.',
                    'quem': 'voce',
                    'tela': null,
                    'link': null,
                    'daMeta': 'Your display name has not been approved yet.',
                  },
                ],
              },
            ],
          );
        await _abrir(t, s, const TelaWhatsapp());

        expect(find.text('Envia com restrição'), findsOneWidget);
        expect(
          find.text('O nome de exibição do número ainda não foi aprovado'),
          findsOneWidget,
        );
        expect(find.textContaining('display name'), findsNothing);
      },
    );

    testWidgets(
      'saúde: "Conferir agora" pergunta de novo à Meta e mostra o novo',
      (t) async {
        final s = _Servidor()
          ..saude = _saude(
            sinal: 'bloqueado',
            titulo: 'Não pode enviar agora',
            itens: [_contaBloqueada],
          )
          ..saudeConferida = _saude();
        await _abrir(t, s, const TelaWhatsapp());
        expect(find.text('Não pode enviar agora'), findsOneWidget);

        await _tocar(t, find.byKey(const ValueKey('saude-conferir')));

        expect(s.quantos('GET /whatsapp/saude?atualizar=1'), 1);
        expect(find.text('Pode enviar'), findsOneWidget);
        expect(find.text('Não pode enviar agora'), findsNothing);
      },
    );

    testWidgets(
      'saúde: sem resposta do servidor não afirma nada — nem "pode", nem "não pode"',
      (t) async {
        final s = _Servidor()..saudeForaDoAr = true;
        await _abrir(t, s, const TelaWhatsapp());

        expect(find.byKey(const ValueKey('saude-erro')), findsOneWidget);
        expect(find.text('Pode enviar'), findsNothing);
        expect(find.text('Não pode enviar agora'), findsNothing);
        // O resto da tela continua: a saúde é uma leitura à parte.
        expect(find.text('Mister Burgers Ltda'), findsOneWidget);
        expect(find.text('Pronto para enviar'), findsOneWidget);
      },
    );

    testWidgets(
      'saúde: servidor sem o sinal (versão antiga) — o cartão não aparece',
      (t) async {
        final s = _Servidor();
        await _abrir(t, s, const TelaWhatsapp());

        expect(find.byKey(const ValueKey('saude')), findsNothing);
        expect(find.byKey(const ValueKey('saude-erro')), findsNothing);
      },
    );

    testWidgets('sem conexão: conectar é pelo site', (t) async {
      final s = _Servidor(whatsapp: _situacaoWhatsapp(conectado: false));
      await _abrir(t, s, const TelaWhatsapp());
      expect(find.byKey(const ValueKey('sem-conexao')), findsOneWidget);
      expect(find.text('Conectar no site'), findsOneWidget);
    });
  });

  group('Integrações', () {
    testWidgets(
      'não conectada: o dono cola o token e conecta; o operador não pode',
      (t) async {
        final s = _Servidor(
          cardapioWeb: [
            _cw(conectado: false, clientes: 'parada', pedidos: null),
            _cw(clientes: 'parada', pedidos: 'parado'),
          ],
        );
        await _abrir(t, s, const TelaIntegracoes());

        expect(find.text('Não conectada'), findsOneWidget);
        expect(
          find.textContaining('Configurações → Integrações → API'),
          findsOneWidget,
        );
        final conectar = find.byKey(const ValueKey('conectar-cw'));
        expect(t.widget<FilledButton>(conectar).onPressed, isNull);
        await t.enterText(find.byKey(const ValueKey('chave-cw')), 'curto');
        await _assentar(t);
        expect(t.widget<FilledButton>(conectar).onPressed, isNull);
        await t.enterText(
          find.byKey(const ValueKey('chave-cw')),
          '  token-da-loja-1234567890  ',
        );
        await _assentar(t);
        await _tocar(t, conectar);

        expect(s.corpos['POST /integracoes/cardapioweb/chave'], {
          'chave': 'token-da-loja-1234567890',
        });
        expect(
          find.text('Loja Mister Burgers Tijuca conectada.'),
          findsOneWidget,
        );
        expect(find.text('Conectada'), findsOneWidget);
        expect(find.text('Importar clientes'), findsOneWidget);
      },
    );

    testWidgets('operador: vê, mas não conecta nem importa', (t) async {
      final s = _Servidor(
        cardapioWeb: [_cw(conectado: false, clientes: 'parada', pedidos: null)],
      );
      await _abrir(t, s, const TelaIntegracoes(), papel: 'operador');
      expect(
        find.text('Só o dono da conta pode conectar a loja do Cardápio Web.'),
        findsOneWidget,
      );
      expect(find.byKey(const ValueKey('chave-cw')), findsNothing);
    });

    testWidgets('importar clientes pede o consentimento e leva a evidência', (
      t,
    ) async {
      final s = _Servidor(
        cardapioWeb: [_cw(clientes: 'parada', pedidos: 'parado')],
      );
      await _abrir(t, s, const TelaIntegracoes());

      final importar = find.byKey(const ValueKey('importar-clientes'));
      expect(t.widget<FilledButton>(importar).onPressed, isNull);
      await _tocar(t, find.byKey(const ValueKey('consentimento-cw')));
      await t.enterText(
        find.widgetWithText(TextField, 'Como autorizaram? (opcional)'),
        'Aceite no cadastro do cardápio',
      );
      await _assentar(t);
      await _tocar(t, importar);

      expect(s.corpos['POST /integracoes/cardapioweb/importar'], {
        'consentimento': true,
        'evidencia': 'Aceite no cadastro do cardápio',
      });
    });

    testWidgets('importando: mostra o progresso e relê a cada 2 s até terminar', (
      t,
    ) async {
      final s = _Servidor(
        cardapioWeb: [
          _cw(clientes: 'rodando', pedidos: 'carga'),
          _cw(clientes: 'rodando', pagina: 4, pedidos: 'carga'),
          _cw(),
        ],
      );
      await _abrir(t, s, const TelaIntegracoes());

      expect(
        find.textContaining('Importando os clientes de Mister Burgers Tijuca'),
        findsOneWidget,
      );
      expect(find.text('120 lidos · 30 novos · página 2 de 5'), findsOneWidget);
      expect(
        find.text(
          'A busca dos pedidos começa assim que a importação dos clientes terminar.',
        ),
        findsOneWidget,
      );
      await t.pump(const Duration(seconds: 2));
      await _assentar(t);
      expect(find.text('120 lidos · 30 novos · página 4 de 5'), findsOneWidget);
      await t.pump(const Duration(seconds: 2));
      await _assentar(t);
      expect(find.text('Importados'), findsOneWidget);
      final leituras = s.quantos('GET /integracoes/cardapioweb');
      // Terminou: para de reler.
      await t.pump(const Duration(seconds: 10));
      expect(s.quantos('GET /integracoes/cardapioweb'), leituras);
    });

    testWidgets('em dia: compras, clientes, cashback e o que fica de fora', (
      t,
    ) async {
      final s = _Servidor();
      await _abrir(t, s, const TelaIntegracoes());

      expect(
        find.text('Loja conectada: Mister Burgers Tijuca'),
        findsOneWidget,
      );
      expect(
        find.textContaining(
          'Importação de 25/09/2026: 120 clientes lidos, 30 novos na base, 4 com WhatsApp desligado',
        ),
        findsOneWidget,
      );
      expect(find.text('4.870'), findsOneWidget);
      expect(find.text('1.480'), findsOneWidget);
      expect(find.text('310'), findsOneWidget);
      expect(find.text('R\$ 1.234,50'), findsOneWidget);
      expect(
        find.textContaining('Ficam de fora os pedidos do iFood'),
        findsOneWidget,
      );
      await _tocar(t, find.byKey(const ValueKey('atualizar-pedidos')));
      expect(s.pedidos, contains('POST /integracoes/cardapioweb/pedidos'));
    });

    testWidgets(
      'compras paradas: tentar de novo ou trocar o token (e cancelar a troca)',
      (t) async {
        final s = _Servidor(
          cardapioWeb: [
            _cw(
              pedidos: 'falhou',
              erroPedidos: 'O Cardápio Web recusou o token.',
            ),
          ],
        );
        await _abrir(t, s, const TelaIntegracoes());

        expect(find.text('O Cardápio Web recusou o token.'), findsOneWidget);
        await _tocar(t, find.byKey(const ValueKey('tentar-pedidos')));
        expect(s.pedidos, contains('POST /integracoes/cardapioweb/pedidos'));

        await _tocar(t, find.byKey(const ValueKey('trocar-token')));
        expect(find.text('Salvar token novo'), findsOneWidget);
        expect(
          find.textContaining('Token novo da loja Mister Burgers Tijuca'),
          findsOneWidget,
        );
        await _tocar(t, find.text('Cancelar'));
        expect(find.text('Salvar token novo'), findsNothing);
      },
    );

    testWidgets('desconectar pede confirmação', (t) async {
      final s = _Servidor(
        cardapioWeb: [
          _cw(),
          _cw(conectado: false, clientes: 'parada', pedidos: null),
        ],
      );
      await _abrir(t, s, const TelaIntegracoes());

      await _tocar(t, find.byKey(const ValueKey('desconectar')));
      expect(find.text('Desconectar a loja?'), findsOneWidget);
      await _tocar(t, find.widgetWithText(FilledButton, 'Desconectar'));
      expect(s.pedidos, contains('DELETE /integracoes/cardapioweb'));
      expect(find.text('Loja desconectada.'), findsOneWidget);
      expect(find.text('Não conectada'), findsOneWidget);
    });

    testWidgets('lista do celular: leva para a importação', (t) async {
      final s = _Servidor();
      await _abrir(t, s, const TelaIntegracoes());
      await _tocar(t, find.byKey(const ValueKey('ir-importar')));
      await _transicao(t);
      expect(find.byType(TelaImportarContatos), findsOneWidget);
    });
  });

  testWidgets('importar: o cartão do Cardápio Web abre as Integrações do app', (
    t,
  ) async {
    final s = _Servidor();
    await _abrir(t, s, const TelaImportarContatos());
    await _tocar(t, find.byKey(const ValueKey('abrir-integracoes')));
    await _transicao(t);
    expect(find.byType(TelaIntegracoes), findsOneWidget);
  });

  testWidgets('Mais: Integrações abre a tela do app', (t) async {
    final s = _Servidor();
    await _abrir(t, s, const Casca(abaInicial: Aba.mais));
    await _tocar(t, find.byKey(const ValueKey('mais-integracoes')));
    await _transicao(t);
    expect(find.byType(TelaIntegracoes), findsOneWidget);
  });

  test('o número lê a resposta sobre as conversas e o tier sem teto', () {
    final n = NumeroWhatsapp.deJson(
      _numero(integrar: null, tierNome: 'TIER_UNLIMITED'),
    );
    expect(n.integrarConversas, isNull);
    expect(n.semTeto, isTrue);
    expect(n.phoneNumberId, '1111');
    final s = SituacaoWhatsapp.deJson(
      _situacaoWhatsapp(expiraEm: DateTime.utc(2026, 11, 20)),
    );
    expect(s.wabaId, '123456789');
    expect(s.moeda, 'BRL');
    expect(s.webhookAssinadoEm, isNull);
    expect(s.tokenExpiraEm, DateTime.utc(2026, 11, 20).toLocal());
  });
}
