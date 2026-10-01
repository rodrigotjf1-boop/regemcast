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
import 'package:regemcast/api/contatos.dart';
import 'package:regemcast/api/dados.dart';
import 'package:regemcast/api/repeticao.dart';
import 'package:regemcast/api/modelos.dart';
import 'package:regemcast/push/push.dart';
import 'package:regemcast/sessao/cofre.dart';
import 'package:regemcast/sessao/sessao.dart';
import 'package:regemcast/telas/campanha_detalhe.dart';
import 'package:regemcast/telas/campanha_formulario.dart';
import 'package:regemcast/telas/campanhas.dart';
import 'package:regemcast/telas/casca.dart';
import 'package:regemcast/telas/conta.dart';
import 'package:regemcast/telas/bloqueios.dart';
import 'package:regemcast/telas/contatos.dart';
import 'package:regemcast/telas/conversas.dart';
import 'package:regemcast/telas/dividir_em_blocos.dart';
import 'package:regemcast/telas/entrar.dart';
import 'package:regemcast/telas/importar_contatos.dart';
import 'package:regemcast/telas/integracoes.dart';
import 'package:regemcast/telas/lista_espera.dart';
import 'package:regemcast/telas/modelo_detalhe.dart';
import 'package:regemcast/telas/modelo_editor.dart';
import 'package:regemcast/telas/modelos.dart';
import 'package:regemcast/telas/plano.dart';
import 'package:regemcast/telas/recuperar_senha.dart';
import 'package:regemcast/telas/regras.dart';
import 'package:regemcast/telas/seguranca.dart';
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
            'status': 'ativa',
            'descansoMarketingDias': 3,
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
          'conversasHabilitadas': true,
        });
      case '/whatsapp/situacao':
        if (_contaNova) {
          return _json({'conectado': false, 'conta': null, 'numeros': []});
        }
        return _json({
          'conectado': true,
          'conta': {
            'nome': 'Mister Burgers Ltda',
            'wabaId': '1234567890123456',
            'moeda': 'BRL',
            'webhookAssinadoEm': '2026-09-15T12:00:00Z',
            'tokenExpiraEm': null,
          },
          'numeros': [
            {
              'phoneNumberId': '987654321',
              'telefone': '+55 21 99999-8888',
              'nome': 'Mister Burgers',
              'qualidade': 'verde',
              'tierLimite': 10000,
              'tierNome': 'TIER_10K',
              'status': 'registrado',
              'coexistencia': true,
              'vazaoMaxima': 20,
              'sincronizacao': 'concluida',
              'integrarConversas': true,
            },
          ],
        });
      case '/integracoes/cardapioweb':
        return _json({
          'conectado': true,
          'modo': 'chave',
          'lojaNome': 'Mister Burgers Tijuca',
          'sincronizacao': {
            'status': 'concluida',
            'pagina': 13,
            'totalPaginas': 13,
            'lidos': 6412,
            'novos': 5108,
            'bloqueados': 212,
            'invalidos': 38,
            'concluidaEm': '2026-09-25T15:00:00Z',
            'erro': null,
          },
          'pedidos': {
            'status': 'em_dia',
            'progresso': 100,
            'lidos': 31540,
            'ultimaConsulta': DateTime.now()
                .subtract(const Duration(minutes: 12))
                .toUtc()
                .toIso8601String(),
            'erro': null,
            'compras': 28730,
            'clientes': 3042,
            'primeira': '2023-10-02T00:00:00Z',
            'ultima': DateTime.now()
                .subtract(const Duration(minutes: 40))
                .toUtc()
                .toIso8601String(),
          },
          'saldos': {
            'comCashback': 1204,
            'vencendo': 87,
            'totalCentavos': 1873450,
            'lendo': false,
            'ultimaLeitura': '2026-09-29T07:00:00Z',
            'proximaLeitura': '2026-09-30T07:00:00Z',
            'erro': null,
          },
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
      case '/auth/seguranca':
        return _json({
          'doisFatores': 'nenhum',
          'emailVerificado': true,
          'appDisponivel': true,
        });
      case '/auth/seguranca/app/iniciar':
        return _json({
          'endereco':
              'otpauth://totp/RegemCast:rodrigo%40misterburgers.com.br?secret=JBSWY3DPEHPK3PXP&issuer=RegemCast',
          'segredo': 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
        });
      case '/auth/senha/esqueci':
        return _json({
          'mensagem':
              'Se este e-mail tiver acesso ao RegemCast, o código chega em instantes. Ele vale por 10 minutos.',
        });
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
      case '/conversas':
        final agora = DateTime.now();
        String ha(Duration d) => agora.subtract(d).toUtc().toIso8601String();
        final janela = agora
            .add(const Duration(hours: 23, minutes: 20))
            .toUtc()
            .toIso8601String();
        return _json([
          {
            'id': 'c1',
            'telefone': '5521991112222',
            'nome': 'Ana Beatriz Souza',
            'contatoId': 'k1',
            'optOut': false,
            'naoLidas': 2,
            'ultimaMensagem': 'Chegou certinho, obrigada!',
            'ultimaMensagemEm': ha(const Duration(minutes: 4)),
            'janelaAteEm': janela,
          },
          {
            'id': 'c2',
            'telefone': '5521983334444',
            'nome': 'Carlos Menezes',
            'contatoId': 'k2',
            'optOut': false,
            'naoLidas': 0,
            'ultimaMensagem': 'Vocês abrem amanhã no almoço?',
            'ultimaMensagemEm': ha(const Duration(hours: 2)),
            'janelaAteEm': janela,
          },
          {
            'id': 'c3',
            'telefone': '5511975556666',
            'nome': null,
            'contatoId': null,
            'optOut': false,
            'naoLidas': 1,
            'ultimaMensagem': 'Quero o combo da promoção',
            'ultimaMensagemEm': ha(const Duration(hours: 26)),
            'janelaAteEm': null,
          },
          {
            'id': 'c4',
            'telefone': '5521967778888',
            'nome': 'Fernanda Lima',
            'contatoId': 'k4',
            'optOut': true,
            'naoLidas': 0,
            'ultimaMensagem': 'Parar promoções',
            'ultimaMensagemEm': ha(const Duration(days: 3)),
            'janelaAteEm': null,
          },
          {
            'id': 'c5',
            'telefone': '5521959990000',
            'nome': 'João Pedro Alves',
            'contatoId': 'k5',
            'optOut': false,
            'naoLidas': 0,
            'ultimaMensagem': '📷 Foto',
            'ultimaMensagemEm': ha(const Duration(days: 9)),
            'janelaAteEm': null,
          },
        ]);
      case '/conversas/c1':
        return _json({
          'id': 'c1',
          'telefone': '5521991112222',
          'nome': 'Ana Beatriz Souza',
          'contatoId': 'k1',
          'optOut': false,
          'naoLidas': 0,
          'ultimaMensagem': 'Chegou certinho, obrigada!',
          'ultimaMensagemEm': DateTime.now().toUtc().toIso8601String(),
          'janelaAteEm': DateTime.now()
              .add(const Duration(hours: 23, minutes: 20))
              .toUtc()
              .toIso8601String(),
        });
      case '/conversas/c3':
        return _json({
          'id': 'c3',
          'telefone': '5511975556666',
          'nome': null,
          'contatoId': null,
          'optOut': false,
          'naoLidas': 0,
          'ultimaMensagem': 'Quero o combo da promoção',
          'ultimaMensagemEm': DateTime.now()
              .subtract(const Duration(hours: 26))
              .toUtc()
              .toIso8601String(),
          'janelaAteEm': null,
        });
      case '/conversas/c1/mensagens':
        final hoje = DateTime.now();
        String as(int dia, int h, int m) => DateTime(
          hoje.year,
          hoje.month,
          hoje.day + dia,
          h,
          m,
        ).toUtc().toIso8601String();
        Map<String, Object?> msg(
          String id,
          String quando, {
          bool saida = false,
          String origem = 'cliente',
          String tipo = 'text',
          String? texto,
          bool midia = false,
          String? status,
          String? por,
        }) => {
          'id': id,
          'direcao': saida ? 'saida' : 'entrada',
          'origem': origem,
          'tipo': tipo,
          'texto': texto,
          'temMidia': midia,
          'midiaMime': midia ? 'image/png' : null,
          'midiaNome': null,
          'status': status,
          'erroCodigo': null,
          'erroTitulo': null,
          'enviadaPor': por,
          'criadaEm': quando,
        };
        return _json([
          msg(
            'a1',
            as(-1, 20, 5),
            texto: 'Boa noite! Vocês entregam na Tijuca?',
          ),
          msg(
            'a2',
            as(-1, 20, 6),
            saida: true,
            origem: 'celular',
            texto: 'Entregamos sim, Ana! A taxa é R\$ 6,00 🛵',
            status: 'lida',
          ),
          msg(
            'a3',
            as(-1, 20, 9),
            texto: 'Então vou querer 2 smash duplos e uma batata com cheddar',
          ),
          msg(
            'a4',
            as(-1, 20, 10),
            saida: true,
            origem: 'painel',
            texto: 'Anotado! Sai em 35 minutos.',
            status: 'lida',
            por: 'Rodrigo Tavares',
          ),
          msg(
            'a5',
            as(0, 12, 31),
            tipo: 'image',
            midia: true,
            texto: 'Chegou assim, perfeito 😍',
          ),
          msg('a6', as(0, 12, 32), tipo: 'audio', midia: true),
          msg('a7', as(0, 12, 33), texto: 'Chegou certinho, obrigada!'),
          msg(
            'a8',
            as(0, 12, 40),
            saida: true,
            origem: 'painel',
            texto: 'Que bom! Obrigado pela preferência, Ana 🍔',
            status: 'entregue',
            por: 'Rodrigo Tavares',
          ),
        ]);
      case '/conversas/c1/mensagens/a5/midia':
        return http.Response.bytes(_fotos[0], 200);
      case '/conversas/c3/mensagens':
        final ontem = DateTime.now().subtract(const Duration(hours: 26));
        return _json([
          {
            'id': 'b1',
            'direcao': 'entrada',
            'origem': 'cliente',
            'tipo': 'text',
            'texto': 'Quero o combo da promoção',
            'temMidia': false,
            'status': null,
            'criadaEm': ontem.toUtc().toIso8601String(),
          },
        ]);
      case '/contatos/listas':
        return _json([
          {'id': 'l1', 'nome': 'Clientes 2026', 'total': 4820},
          {'id': 'l2', 'nome': 'Aniversariantes', 'total': 374},
          {'id': 'l3', 'nome': 'Delivery Zona Sul', 'total': 1290},
          for (var b = 1; b <= 4; b++)
            {
              'id': 'b$b',
              'nome': 'Base Anota Aí — bloco $b',
              'total': 500,
              'divisaoId': 'd1',
              'divisaoNome': 'Base Anota Aí (ativos)',
              'bloco': b,
              'blocos': 4,
              'usadaEm': b == 1 ? '2026-09-21T15:00:00Z' : null,
            },
        ]);
      case '/campanhas/previa':
        return _json({
          'total': 4702,
          'descanso': {'dias': 3, 'emDescanso': 118},
          'horario': {
            'total': 4702,
            'comHabito': 1880,
            'minimo': 20,
            'periodos': [
              {'periodo': 'noite', 'total': 1147},
              {'periodo': 'almoco', 'total': 490},
              {'periodo': 'tarde', 'total': 243},
            ],
            'sugestao': {
              'periodo': 'noite',
              'percentual': 61,
              'inicio': '17:00',
              'fim': '19:00',
            },
          },
          'cashback': null,
        }, 201);
      case '/contatos/importacoes':
        return _json([
          {
            'id': 'i1',
            'nome': 'Clientes ativos (Anota Aí)',
            'formato': 'xlsx',
            'criadoEm': '2026-09-26T13:00:00Z',
            'total': 1539,
          },
        ]);
      case '/contatos/segmentos':
        return _json({
          'parametros': {
            'recenteDias': 30,
            'ativoDias': 90,
            'riscoDias': 180,
            'fielPedidos': 5,
          },
          'segmentos': [
            {
              'id': 'campeoes',
              'nome': 'Campeões',
              'regra': 'Compraram nos últimos 30 dias e têm 5 pedidos ou mais.',
              'total': 412,
              'gastoCentavos': 8420000,
              'ticketMedioCentavos': 5200,
            },
            {
              'id': 'fieis',
              'nome': 'Fiéis',
              'regra': 'Têm 5 pedidos ou mais e compraram nos últimos 90 dias.',
              'total': 386,
              'gastoCentavos': 5130000,
              'ticketMedioCentavos': 4700,
            },
            {
              'id': 'novos',
              'nome': 'Novos',
              'regra': 'Primeira compra nos últimos 30 dias.',
              'total': 244,
              'gastoCentavos': 1120000,
              'ticketMedioCentavos': 4600,
            },
            {
              'id': 'em_risco',
              'nome': 'Em risco',
              'regra': 'Compravam bem e sumiram há mais de 90 dias.',
              'total': 690,
              'gastoCentavos': 3980000,
              'ticketMedioCentavos': 4100,
            },
            {
              'id': 'perdidos',
              'nome': 'Perdidos',
              'regra': 'A última compra foi há mais de 180 dias.',
              'total': 1310,
              'gastoCentavos': 2210000,
              'ticketMedioCentavos': 3800,
            },
            {
              'id': 'sem_historico',
              'nome': 'Sem histórico',
              'regra': 'Ainda sem pedido registrado.',
              'total': 3442,
            },
          ],
        });
      case '/contatos/publicos':
        return _json({
          'comValor': 3000,
          'comCompras': 3042,
          'publicos': [
            {
              'id': 'vip',
              'nome': 'VIP',
              'regra': r'Os 5% que mais gastaram: R$ 620 ou mais.',
              'total': 240,
              'gastoCentavos': 2980000,
            },
            {
              'id': 'ticket_alto',
              'nome': 'Ticket alto',
              'regra': r'Pedido médio acima de R$ 70.',
              'total': 980,
              'gastoCentavos': 6120000,
            },
            {
              'id': 'um_pedido',
              'nome': 'Um pedido só',
              'regra': 'Compraram uma vez e não voltaram.',
              'total': 1310,
              'gastoCentavos': 540000,
            },
            {
              'id': 'entrega',
              'nome': 'Pedem entrega',
              'regra': 'O jeito mais frequente é a entrega.',
              'total': 3100,
              'gastoCentavos': 0,
            },
            {
              'id': 'retirada',
              'nome': 'Retiram na loja',
              'regra': 'O jeito mais frequente é retirar.',
              'total': 870,
              'gastoCentavos': 0,
            },
            {
              'id': 'periodo_noite',
              'nome': 'Pedem à noite',
              'regra': 'Das 18h às 23h59.',
              'total': 1147,
              'gastoCentavos': 0,
            },
            {
              'id': 'periodo_almoco',
              'nome': 'Pedem no almoço',
              'regra': 'Das 11h às 14h59.',
              'total': 490,
              'gastoCentavos': 0,
            },
            {
              'id': 'nunca_receberam',
              'nome': 'Nunca receberam',
              'regra': 'Nenhuma campanha chegou a eles ainda.',
              'total': 2210,
              'gastoCentavos': 0,
            },
          ],
          'bairros': [
            {'bairro': 'Centro', 'total': 820},
            {'bairro': 'Tijuca', 'total': 540},
            {'bairro': 'Méier', 'total': 312},
            {'bairro': 'Vila Isabel', 'total': 208},
          ],
          'aniversarios': [
            {'mes': 9, 'total': 374},
            {'mes': 10, 'total': 402},
            {'mes': 11, 'total': 355},
          ],
          'mesAtual': 9,
          'conversasLigadas': true,
        });
      case '/contatos/regioes':
        return _json({
          'regioes': [
            {
              'uf': 'RJ',
              'estado': 'Rio de Janeiro',
              'total': 5480,
              'ddds': [
                {'ddd': '21', 'cidade': 'Rio de Janeiro', 'total': 5210},
                {'ddd': '24', 'cidade': 'Volta Redonda', 'total': 270},
              ],
            },
            {
              'uf': 'SP',
              'estado': 'São Paulo',
              'total': 640,
              'ddds': [
                {'ddd': '11', 'cidade': 'São Paulo', 'total': 640},
              ],
            },
            {
              'uf': 'MG',
              'estado': 'Minas Gerais',
              'total': 190,
              'ddds': [
                {'ddd': '32', 'cidade': 'Juiz de Fora', 'total': 190},
              ],
            },
          ],
          'semRegiao': 18,
        });
      case '/contatos/divisoes':
        return _json([
          {
            'id': 'd1',
            'nome': 'Base Anota Aí (ativos)',
            'tamanho': 500,
            'ordem': 'importacao',
            'soNuncaReceberam': false,
            'totalContatos': 2000,
            'totalBlocos': 4,
            'blocos': [
              {
                'id': 'b1',
                'bloco': 1,
                'total': 500,
                'usos': [
                  {
                    'campanhaId': '1',
                    'campanhaNome': 'Sexta do Smash',
                    'em': '2026-09-21T15:00:00Z',
                    'total': 500,
                    'entregues': 489,
                    'lidas': 301,
                    'falhas': 11,
                    'sairam': 4,
                  },
                ],
              },
              {'id': 'b2', 'bloco': 2, 'total': 500, 'usos': <Object>[]},
              {'id': 'b3', 'bloco': 3, 'total': 500, 'usos': <Object>[]},
              {'id': 'b4', 'bloco': 4, 'total': 500, 'usos': <Object>[]},
            ],
          },
        ]);
      case '/contatos/divisoes/opcoes':
        return _json({
          'limite': 1000,
          'limiteConhecido': true,
          'maximo': 1000,
          'tamanhos': [
            {'valor': 250, 'disponivel': true},
            {'valor': 500, 'disponivel': true},
            {'valor': 750, 'disponivel': true},
            {'valor': 1000, 'disponivel': true},
            {'valor': 2000, 'disponivel': false},
          ],
          'sugerido': 500,
        });
      case '/contatos/importacao/texto':
        return _json({
          'formato': 'xlsx',
          'arquivoNome': 'clientes-anotaai.xlsx',
          'totalLidos': 1542,
          'validos': 1539,
          'invalidos': 3,
          'novos': 1212,
          'jaExistem': 327,
          'assumiramPais': 1539,
          'limite': 50000,
          'porEnvio': 5000,
          'truncado': false,
          'extras': [
            'e-mail',
            'aniversário',
            'pedidos',
            'total gasto',
            'última compra',
          ],
          'contatos': [
            for (final (i, n) in [
              'Ana Beatriz Souza',
              'Carlos Menezes',
              'Fernanda Lima',
              'João Pedro Alves',
              'Marina Costa',
              'Rafael Nunes',
              'Bruna Tavares',
              'Diego Ramos',
            ].indexed)
              {
                'nome': n,
                'telefone':
                    '552199${(1112222 + i * 1371).toString().padLeft(7, '0')}',
                'novo': i != 2,
                'assumiuPais': true,
              },
          ],
        }, 201);
      case '/contatos/importacao':
        return _json({
          'importacaoId': 'i1',
          'gravados': 1212,
          'jaExistiam': 327,
        }, 201);
      case '/contatos/publicos/produtos':
        return _json({
          'produtos': [
            {'nome': 'Smash duplo', 'total': 1620},
            {'nome': 'Batata com cheddar', 'total': 980},
          ],
        });
      case '/contatos':
        final q = req.url.queryParameters;
        if (_contaNova) {
          return _json({'total': 0, 'pagina': 1, 'porPagina': 1, 'itens': []});
        }
        final agora = DateTime.now().toUtc();
        String atras(int dias) =>
            agora.subtract(Duration(days: dias, hours: 3)).toIso8601String();
        if (q['situacao'] == 'bloqueados') {
          return _json({
            'total': 3,
            'pagina': 1,
            'porPagina': 50,
            'itens': [
              {
                'id': 'x1',
                'nome': 'Paula Reis',
                'telefone': '5521955554444',
                'optOut': true,
                'optOutEm': '2026-09-20T15:00:00Z',
                'optOutOrigem': 'botao_modelo',
              },
              {
                'id': 'x2',
                'nome': null,
                'telefone': '5521933332222',
                'optOut': true,
                'optOutEm': '2026-09-12T19:30:00Z',
                'optOutOrigem': 'mensagem',
              },
              {
                'id': 'x3',
                'nome': 'Otávio Lins',
                'telefone': '5511922221111',
                'optOut': true,
                'optOutEm': '2026-08-30T11:10:00Z',
                'optOutOrigem': 'cardapioweb',
              },
            ],
          });
        }
        if (q['situacao'] == 'sem_whatsapp') {
          return _json({
            'total': 2,
            'pagina': 1,
            'porPagina': 100,
            'itens': [
              {
                'id': 'w1',
                'nome': 'Lúcia Prado',
                'telefone': '5521944443333',
                'optOut': false,
                'semWhatsappEm': '2026-09-18T15:00:00Z',
              },
              {
                'id': 'w2',
                'nome': null,
                'telefone': '5524911110000',
                'optOut': false,
                'semWhatsappEm': '2026-09-02T15:00:00Z',
              },
            ],
          });
        }
        return _json({
          'total': q['segmento'] == 'campeoes' ? 412 : 6484,
          'pagina': 1,
          'porPagina': 50,
          'cashbackLido': true,
          'itens': [
            {
              'id': 'k1',
              'nome': 'Ana Beatriz Souza',
              'email': 'ana.souza@gmail.com',
              'telefone': '5521991112222',
              'optOut': false,
              'consentimentoOrigem': 'declarado',
              'pedidos': 23,
              'totalGastoCentavos': 128740,
              'ultimoPedidoEm': atras(2),
              'produtoFavorito': 'Smash duplo',
              'periodoPreferido': 'noite',
              'segmento': 'campeoes',
              'cashbackCentavos': 1850,
              'cashbackVenceEm': '${DateTime.now().year}-10-14',
              'cashbackValido': true,
            },
            {
              'id': 'k2',
              'nome': 'Carlos Menezes',
              'telefone': '5521983334444',
              'optOut': false,
              'consentimentoOrigem': 'conversa',
              'pedidos': 6,
              'totalGastoCentavos': 31260,
              'ultimoPedidoEm': atras(118),
              'produtoFavorito': 'Batata com cheddar',
              'periodoPreferido': 'almoco',
              'segmento': 'em_risco',
            },
            {
              'id': 'k3',
              'nome': null,
              'telefone': '5511975556666',
              'optOut': false,
              'consentimentoOrigem': 'declarado',
            },
            {
              'id': 'k4',
              'nome': 'Fernanda Lima',
              'telefone': '5521967778888',
              'optOut': true,
              'consentimentoOrigem': 'declarado',
            },
            {
              'id': 'k5',
              'nome': 'João Pedro Alves',
              'telefone': '5521959990000',
              'optOut': false,
              'consentimentoOrigem': 'formulario',
              'pedidos': 1,
              'totalGastoCentavos': 4590,
              'ultimoPedidoEm': atras(12),
              'segmento': 'novos',
              'cashbackCentavos': 700,
              'cashbackVenceEm': '${DateTime.now().year}-09-01',
              'cashbackValido': false,
            },
            {
              'id': 'k6',
              'nome': 'Marina Costa',
              'telefone': '5521941213141',
              'optOut': false,
              'consentimentoOrigem': 'declarado',
              'semWhatsappEm': '2026-09-18T15:00:00Z',
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
      case '/campanhas/2':
        return _json({
          'id': '2',
          'nome': 'Combo família',
          'modeloNome': 'combo_familia',
          'modeloIdioma': 'pt_BR',
          'modeloCategoria': 'marketing',
          'publicoOrigem': 'publico',
          'publicoRotulo': 'Pedem à noite',
          'status': 'enviando',
          'criadoEm': DateTime.now()
              .toUtc()
              .subtract(const Duration(hours: 3))
              .toIso8601String(),
          'iniciadaEm': DateTime.now()
              .toUtc()
              .subtract(const Duration(hours: 2))
              .toIso8601String(),
          'espera': {
            'motivo': 'limite_meta',
            'ate': DateTime.now()
                .toUtc()
                .add(const Duration(hours: 9))
                .toIso8601String(),
            'limite': 1000,
          },
          'porStatus': {
            'lida': 380,
            'entregue': 520,
            'enviada': 60,
            'falhou': 9,
            'pendente': 178,
          },
          'total': 1147,
          'respondidas': 41,
          'descansoDias': 3,
        });
      case '/campanhas/2/destinatarios':
        return _json([
          {
            'id': 'x1',
            'telefone': '5521988771234',
            'status': 'falhou',
            'erroTitulo': 'Número sem WhatsApp',
            'erroDetalhe': 'A Meta não encontrou WhatsApp neste número.',
          },
          {'id': 'x2', 'telefone': '5521977123456', 'status': 'lida'},
          {'id': 'x3', 'telefone': '5521966554433', 'status': 'pendente'},
        ]);
      case '/campanhas/3':
        return _json({
          'id': '3',
          'nome': 'Aniversariantes de setembro',
          'modeloNome': 'aniversario',
          'modeloIdioma': 'pt_BR',
          'modeloCategoria': 'marketing',
          'publicoOrigem': 'publico',
          'publicoRotulo': 'Aniversariantes de setembro',
          'status': 'concluida',
          'criadoEm': '2026-09-26T14:00:00Z',
          'iniciadaEm': '2026-09-26T14:05:00Z',
          'concluidaEm': '2026-09-26T14:42:00Z',
          'porStatus': {
            'lida': 210,
            'entregue': 130,
            'falhou': 4,
            'descanso': 30,
          },
          'total': 374,
          'respondidas': 27,
          'descansoDias': 3,
        });
      case '/campanhas/3/destinatarios':
        return _json([
          {
            'id': 'y1',
            'telefone': '5521955443322',
            'status': 'descanso',
            'erroDetalhe':
                'Recebeu "Sexta do Smash" em 25/09 e ficou de fora pelo descanso de 3 dias.',
          },
          {'id': 'y2', 'telefone': '5521944332211', 'status': 'lida'},
          {'id': 'y3', 'telefone': '5521933221100', 'status': 'entregue'},
        ]);
      case '/campanhas/4':
        return _json({
          'id': '4',
          'nome': 'Oferta relâmpago de sexta',
          'modeloNome': 'oferta_relampago',
          'modeloIdioma': 'pt_BR',
          'modeloCategoria': 'marketing',
          'listaNome': 'Clientes 2026',
          'status': 'pausada',
          'pausaMotivo': 'modelo',
          'criadoEm': '2026-10-01T14:00:00Z',
          'iniciadaEm': '2026-10-01T14:05:00Z',
          'porStatus': {'falhou': 1, 'pendente': 4819},
          'total': 4820,
        });
      case '/campanhas/4/destinatarios':
        return _json([
          {
            'id': 'z1',
            'telefone': '5521988771234',
            'status': 'falhou',
            'erroTitulo': 'O formato de um parâmetro não bate com o modelo',
            'erroDetalhe':
                'A Meta recusou a mensagem porque um parâmetro do modelo veio em formato diferente do aprovado (132012).',
          },
          {'id': 'z2', 'telefone': '5521977123456', 'status': 'pendente'},
          {'id': 'z3', 'telefone': '5521966554433', 'status': 'pendente'},
        ]);
      case '/campanhas/5':
        return _json({
          'id': '5',
          'nome': 'Oferta relâmpago de sexta',
          'modeloNome': 'oferta_relampago',
          'modeloIdioma': 'pt_BR',
          'modeloCategoria': 'marketing',
          'listaNome': 'Clientes 2026',
          'status': 'pausada',
          'pausaMotivo': 'conta_meta',
          'pausaErro': _erroDoPagamento,
          'criadoEm': '2026-10-01T22:00:00Z',
          'iniciadaEm': '2026-10-01T22:05:00Z',
          'porStatus': {'pendente': 4820},
          'total': 4820,
        });
      case '/campanhas/5/destinatarios':
        return _json([
          {'id': 'w1', 'telefone': '5521988771234', 'status': 'pendente'},
          {'id': 'w2', 'telefone': '5521977123456', 'status': 'pendente'},
        ]);
      case '/campanhas/6':
        return _json({
          'id': '6',
          'nome': 'Sexta do Smash',
          'modeloNome': 'promo_sexta_smash',
          'modeloIdioma': 'pt_BR',
          'modeloCategoria': 'marketing',
          'listaNome': 'Clientes 2026',
          'status': 'concluida',
          'criadoEm': '2026-09-26T14:00:00Z',
          'iniciadaEm': '2026-09-26T14:05:00Z',
          'concluidaEm': '2026-09-26T14:42:00Z',
          'porStatus': {'lida': 3100, 'entregue': 1620, 'falhou': 100},
          'total': 4820,
          'falhasPorMotivo': [
            {
              'total': 62,
              'erro': {
                'codigo': 131026,
                'titulo': 'Número não recebe no WhatsApp',
                'explicacao':
                    'Este número não tem WhatsApp, não aceitou os termos do aplicativo ou usa uma versão muito antiga.',
                'acao':
                    'Confira o número com o contato. Reenviar para o mesmo número não adianta.',
                'quem': 'voce',
                'tela': 'contatos',
                'link': null,
                'daMeta': null,
              },
            },
            {
              'total': 38,
              'erro': {
                'codigo': 131050,
                'titulo': 'Parou o marketing pelo WhatsApp',
                'explicacao':
                    'A pessoa escolheu, no próprio WhatsApp, não receber mais mensagens de marketing da sua empresa.',
                'acao':
                    'Não precisa fazer nada, e reenviar não adianta: ela sai dos envios sozinha e aparece em Contatos, na aba Bloqueios.',
                'quem': 'ninguem',
                'tela': 'bloqueios',
                'link': null,
                'daMeta': null,
              },
            },
          ],
        });
      case '/campanhas/6/destinatarios':
        return _json([
          {
            'id': 'v1',
            'telefone': '5521988771234',
            'status': 'falhou',
            'erroTitulo': 'Número não recebe no WhatsApp',
            'erroDetalhe':
                'Este número não tem WhatsApp, não aceitou os termos do aplicativo ou usa uma versão muito antiga. Confira o número com o contato. Reenviar para o mesmo número não adianta.',
          },
          {'id': 'v2', 'telefone': '5521977123456', 'status': 'lida'},
        ]);
      case '/campanhas':
        if (_contaNova) return _json([]);
        final agora = DateTime.now().toUtc();
        return _json([
          {
            'id': '1',
            'nome': 'Sexta do Smash',
            'modeloNome': 'promo_sexta_smash',
            'modeloCategoria': 'marketing',
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
            'modeloCategoria': 'marketing',
            'publicoOrigem': 'publico',
            'publicoRotulo': 'Pedem à noite',
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
            'modeloCategoria': 'marketing',
            'publicoOrigem': 'publico',
            'publicoRotulo': 'Aniversariantes de setembro',
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

/// Conta recém-criada: sem número, sem contatos, sem campanha — o Painel
/// mostra o caminho até o disparo.
var _contaNova = false;

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
  for (final e in find.byType(Image).evaluate()) {
    provedores.add((e.widget as Image).image);
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
  {
    'id': 't10',
    'nome': 'boas_vindas_clube',
    'idioma': 'pt_BR',
    'categoria': 'MARKETING',
    'status': 'aprovado',
    'cabecalho': 'Oi, {{1}}!',
    'corpo':
        'Seu cadastro no clube Mister Burgers está pronto. Na primeira compra tem fritas por nossa conta.',
    'variaveis': 0,
    'botoes': ['Parar promoções'],
    'exige': {
      'cabecalho': 'texto',
      'oferta': false,
      'cupomNoBotao': null,
      'cartoes': <Object>[],
      'semSuporte': <String>[],
    },
  },
  {
    'id': 't11',
    'nome': 'oferta_relampago',
    'idioma': 'pt_BR',
    'categoria': 'MARKETING',
    'status': 'aprovado',
    'corpo': 'Só hoje: combo em dobro para quem pedir pelo cardápio.',
    'variaveis': 0,
    'botoes': ['Copiar código', 'Parar promoções'],
    'exige': {
      'cabecalho': 'image',
      'oferta': true,
      'cupomNoBotao': 0,
      'cartoes': <Object>[],
      'semSuporte': <String>[],
    },
  },
];

/// O 131042 (pagamento da conta do WhatsApp na Meta) como o servidor manda.
const _erroDoPagamento = {
  'codigo': 131042,
  'titulo': 'Falta acertar o pagamento na Meta',
  'explicacao':
      'A Meta não entregou porque o pagamento da conta do WhatsApp Business não está em ordem: falta cadastrar a forma de pagamento (com a moeda e o fuso horário), o cartão foi recusado ou a conta de pagamento está suspensa.',
  'acao':
      'Acerte o pagamento da conta do WhatsApp na Meta. Nenhuma mensagem sai até lá; depois, retome a campanha ou monte outra para quem não recebeu.',
  'quem': 'voce',
  'tela': null,
  'link': {
    'rotulo': 'Abrir o pagamento na Meta',
    'url': 'https://business.facebook.com/billing_hub/accounts/details/',
  },
  'daMeta':
      'Message failed to send because your WhatsApp Business account currency is not configured.',
};

/// Um modelo aprovado, com oferta por tempo limitado, que já está na Meta.
final _ofertaNaMeta = ModeloSalvo.deJson({
  'id': 'm11',
  'nome': 'oferta_relampago',
  'idioma': 'pt_BR',
  'categoria': 'MARKETING',
  'status': 'aprovado',
  'corpo': 'Só hoje: combo em dobro para quem pedir pelo cardápio.',
  'botoes': [
    {'tipo': 'COPY_CODE', 'texto': 'SMASH10'},
  ],
  'ltoAtivo': true,
  'ltoTexto': 'Só hoje!',
  'ltoHoras': 12,
  'metaTemplateId': '999',
});

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
      // Como no app: leitura que falhou não se repete sozinha (ERR-026).
      retry: semRepeticao,
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

  Future<void> assentar(WidgetTester t) async {
    for (var i = 0; i < 10; i++) {
      await t.pump(const Duration(milliseconds: 100));
    }
  }

  Future<void> escolher(WidgetTester t, String campo, String opcao) async {
    final alvo = find.byKey(ValueKey(campo));
    if (alvo.evaluate().isEmpty) {
      await t.scrollUntilVisible(
        alvo,
        300,
        scrollable: find.byType(Scrollable).first,
      );
    }
    await t.ensureVisible(alvo);
    await assentar(t);
    await t.tap(alvo);
    await assentar(t);
    await t.tap(find.text(opcao).last);
    await assentar(t);
  }

  Future<void> montarComLista(WidgetTester t) async {
    await t.enterText(find.byKey(const ValueKey('c-nome')), 'Sexta do Smash');
    await escolher(t, 'c-modelo', 'promo_sexta_smash — Marketing');
    await escolher(t, 'c-lista', 'Clientes 2026 · 4.820 contatos');
  }

  Future<void> rolarAte(WidgetTester t, Finder alvo) async {
    if (alvo.evaluate().isEmpty) {
      await t.scrollUntilVisible(
        alvo,
        300,
        scrollable: find.byType(Scrollable).first,
      );
    }
    await t.ensureVisible(alvo);
    await assentar(t);
  }

  testWidgets('campanha — nova', (t) async {
    await _capturar(
      t,
      const TelaFormularioCampanha(),
      '31-campanha-nova',
      antes: (t) async {
        await montarComLista(t);
        // De volta ao topo, para a captura mostrar o começo do formulário.
        await t.drag(find.byType(ListView).first, const Offset(0, 4000));
        await assentar(t);
      },
    );
  }, skip: !ativo);

  testWidgets('campanha — quem recebe', (t) async {
    await _capturar(
      t,
      const TelaFormularioCampanha(),
      '32-campanha-quem-recebe',
      antes: (t) async {
        await montarComLista(t);
        await rolarAte(t, find.text('Quem recebe'));
      },
    );
  }, skip: !ativo);

  testWidgets('campanha — público pronto', (t) async {
    await _capturar(
      t,
      const TelaFormularioCampanha(),
      '33-campanha-publico-pronto',
      antes: (t) async {
        await escolher(t, 'c-modelo', 'promo_sexta_smash — Marketing');
        await rolarAte(t, find.byKey(const ValueKey('quem-base')));
        await t.tap(find.byKey(const ValueKey('quem-base')));
        await assentar(t);
        await escolher(
          t,
          'c-de-onde',
          'Um público pronto (VIP, horário, produto, bairro…)',
        );
        await rolarAte(t, find.byKey(const ValueKey('c-qual')));
        await t.tap(find.byKey(const ValueKey('c-qual')));
        await assentar(t);
      },
    );
  }, skip: !ativo);

  testWidgets('campanha — janela', (t) async {
    await _capturar(
      t,
      const TelaFormularioCampanha(),
      '34-campanha-janela',
      antes: (t) async {
        await montarComLista(t);
        await rolarAte(t, find.byKey(const ValueKey('c-usar-horario')));
        await t.tap(find.byKey(const ValueKey('c-usar-horario')));
        await assentar(t);
        await rolarAte(t, find.byKey(const ValueKey('c-janela')));
      },
    );
  }, skip: !ativo);

  testWidgets('campanha — esperando o limite', (t) async {
    await _capturar(
      t,
      const TelaCampanhaDetalhe(id: '2', nomeInicial: 'Combo família'),
      '35-campanha-espera',
    );
  }, skip: !ativo);

  testWidgets('campanha — descanso e respostas', (t) async {
    await _capturar(
      t,
      const TelaCampanhaDetalhe(
        id: '3',
        nomeInicial: 'Aniversariantes de setembro',
      ),
      '36-campanha-descanso',
      antes: (t) => rolarAte(t, find.text('Resultado')),
    );
  }, skip: !ativo);

  testWidgets('campanha — variável do título', (t) async {
    await _capturar(
      t,
      const TelaFormularioCampanha(),
      '58-campanha-titulo',
      antes: (t) async {
        await t.enterText(
          find.byKey(const ValueKey('c-nome')),
          'Boas-vindas ao clube',
        );
        await escolher(t, 'c-modelo', 'boas_vindas_clube — Marketing');
        await escolher(t, 'c-titulo-origem-t10', 'Primeiro nome do contato');
        await t.enterText(
          find.byKey(const ValueKey('c-titulo-t10')),
          'cliente',
        );
        await assentar(t);
        await rolarAte(t, find.text('Variável do título'));
      },
    );
  }, skip: !ativo);

  testWidgets('campanha — o que vai do modelo', (t) async {
    await _capturar(
      t,
      const TelaFormularioCampanha(),
      '59-campanha-do-modelo',
      antes: (t) async {
        await t.enterText(
          find.byKey(const ValueKey('c-nome')),
          'Oferta relâmpago de sexta',
        );
        await escolher(t, 'c-modelo', 'oferta_relampago — Marketing');
      },
    );
  }, skip: !ativo);

  testWidgets('campanha — pausada pelo modelo', (t) async {
    await _capturar(
      t,
      const TelaCampanhaDetalhe(
        id: '4',
        nomeInicial: 'Oferta relâmpago de sexta',
      ),
      '60-campanha-pausada-modelo',
    );
  }, skip: !ativo);

  testWidgets('campanha — pausada pela conta na Meta', (t) async {
    await _capturar(
      t,
      const TelaCampanhaDetalhe(
        id: '5',
        nomeInicial: 'Oferta relâmpago de sexta',
      ),
      '62-campanha-pausada-conta',
      antes: (t) => rolarAte(t, find.byKey(const ValueKey('cd-pausa-conta'))),
    );
  }, skip: !ativo);

  testWidgets('campanha — por que falhou', (t) async {
    await _capturar(
      t,
      const TelaCampanhaDetalhe(id: '6', nomeInicial: 'Sexta do Smash'),
      '63-campanha-por-que-falhou',
      antes: (t) =>
          rolarAte(t, find.byKey(const ValueKey('cd-por-que-falhou'))),
    );
  }, skip: !ativo);

  testWidgets('modelo — validade da oferta', (t) async {
    await _capturar(
      t,
      TelaEditorModelo(inicial: _ofertaNaMeta),
      '61-modelo-validade-oferta',
      antes: (t) =>
          rolarAte(t, find.byKey(const ValueKey('m-lto-salvar-validade'))),
    );
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

  Future<void> assentarContatos(WidgetTester t) async {
    for (var i = 0; i < 10; i++) {
      await t.pump(const Duration(milliseconds: 100));
    }
  }

  Future<void> vista(WidgetTester t, String nome) async {
    await t.tap(find.byKey(ValueKey('vista-$nome')));
    await assentarContatos(t);
  }

  testWidgets('contatos — públicos', (t) async {
    await _capturar(
      t,
      const Scaffold(body: TelaContatos()),
      '37-contatos-publicos',
      antes: (t) => vista(t, 'publicos'),
    );
  }, skip: !ativo);

  testWidgets('contatos — públicos, mais abaixo', (t) async {
    await _capturar(
      t,
      const Scaffold(body: TelaContatos()),
      '38-contatos-publicos-2',
      antes: (t) async {
        await vista(t, 'publicos');
        await t.drag(find.byType(Scrollable).first, const Offset(0, -1500));
        await assentarContatos(t);
      },
    );
  }, skip: !ativo);

  testWidgets('contatos — filtro de perfil', (t) async {
    await _capturar(
      t,
      const Scaffold(body: TelaContatos()),
      '39-contatos-filtro',
      antes: (t) async {
        await vista(t, 'publicos');
        await t.tap(find.byKey(const ValueKey('perfil-campeoes')));
        await assentarContatos(t);
      },
    );
  }, skip: !ativo);

  testWidgets('contatos — blocos e listas', (t) async {
    await _capturar(
      t,
      const Scaffold(body: TelaContatos()),
      '40-contatos-blocos',
      antes: (t) => vista(t, 'blocos'),
    );
  }, skip: !ativo);

  testWidgets('contatos — blocos, escuro', (t) async {
    await _capturar(
      t,
      const Scaffold(body: TelaContatos()),
      '41-contatos-blocos-escuro',
      brilho: Brightness.dark,
      antes: (t) => vista(t, 'blocos'),
    );
  }, skip: !ativo);

  testWidgets('dividir em blocos', (t) async {
    await _capturar(
      t,
      const TelaDividirEmBlocos(
        alvo: AlvoDaDivisao(
          origem: 'lista',
          origemId: 'l1',
          rotulo: 'Clientes 2026',
          total: 4820,
        ),
      ),
      '42-dividir-em-blocos',
    );
  }, skip: !ativo);

  testWidgets('bloqueios', (t) async {
    await _capturar(t, const TelaBloqueios(), '43-bloqueios');
  }, skip: !ativo);

  testWidgets('importar — prévia com colunas extras', (t) async {
    await _capturar(
      t,
      const TelaImportarContatos(),
      '44-importar-previa',
      antes: (t) async {
        await t.enterText(find.byType(TextField).first, '21 99111-2222');
        await t.tap(find.text('Ler números'));
        await assentarContatos(t);
      },
    );
  }, skip: !ativo);

  testWidgets('importar — concluída', (t) async {
    await _capturar(
      t,
      const TelaImportarContatos(),
      '45-importar-concluida',
      antes: (t) async {
        await t.enterText(find.byType(TextField).first, '21 99111-2222');
        await t.tap(find.text('Ler números'));
        await assentarContatos(t);
        await t.scrollUntilVisible(
          find.byKey(const ValueKey('consentimento')),
          300,
          scrollable: find.byType(Scrollable).first,
        );
        await t.tap(find.byKey(const ValueKey('consentimento')));
        await assentarContatos(t);
        await t.tap(find.byKey(const ValueKey('importar-confirmar')));
        await assentarContatos(t);
      },
    );
  }, skip: !ativo);

  testWidgets('conversas', (t) async {
    await _capturar(t, const Scaffold(body: TelaConversas()), '46-conversas');
  }, skip: !ativo);

  Future<void> abrirConversa(WidgetTester t, String id) async {
    await t.tap(find.byKey(ValueKey('conversa-$id')));
    for (var i = 0; i < 20; i++) {
      await t.pump(const Duration(milliseconds: 100));
    }
  }

  testWidgets('conversa aberta', (t) async {
    await _capturar(
      t,
      const Scaffold(body: TelaConversas()),
      '47-conversa',
      antes: (t) => abrirConversa(t, 'c1'),
    );
  }, skip: !ativo);

  testWidgets('conversa aberta — escuro', (t) async {
    await _capturar(
      t,
      const Scaffold(body: TelaConversas()),
      '48-conversa-escuro',
      brilho: Brightness.dark,
      antes: (t) => abrirConversa(t, 'c1'),
    );
  }, skip: !ativo);

  testWidgets('conversa com a janela fechada', (t) async {
    await _capturar(
      t,
      const Scaffold(body: TelaConversas()),
      '49-conversa-fechada',
      antes: (t) => abrirConversa(t, 'c3'),
    );
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

  testWidgets('segurança', (t) async {
    await _capturar(
      t,
      const _ComSessao(child: TelaSeguranca()),
      '53-seguranca',
    );
  }, skip: !ativo);

  testWidgets('segurança — o aplicativo autenticador', (t) async {
    await _capturar(
      t,
      const _ComSessao(child: TelaSeguranca()),
      '54-seguranca-aplicativo',
      antes: (t) async {
        await t.tap(find.byKey(const ValueKey('configurar-aplicativo')));
      },
    );
  }, skip: !ativo);

  testWidgets('recuperar a senha', (t) async {
    await _capturar(
      t,
      const TelaRecuperarSenha(email: 'rodrigo@misterburgers.com.br'),
      '55-recuperar-senha',
      antes: (t) async {
        await t.tap(find.byKey(const ValueKey('enviar-codigo')));
      },
    );
  }, skip: !ativo);

  testWidgets('lista de espera', (t) async {
    await _capturar(t, const TelaListaEspera(), '56-lista-espera');
  }, skip: !ativo);

  testWidgets('painel — conta nova', (t) async {
    _contaNova = true;
    addTearDown(() => _contaNova = false);
    await _capturar(
      t,
      const _ComSessao(child: Casca()),
      '57-painel-conta-nova',
    );
  }, skip: !ativo);

  testWidgets('whatsapp', (t) async {
    await _capturar(t, const _ComSessao(child: TelaWhatsapp()), '20-whatsapp');
  }, skip: !ativo);

  testWidgets('whatsapp — escuro', (t) async {
    await _capturar(
      t,
      const _ComSessao(child: TelaWhatsapp()),
      '50-whatsapp-escuro',
      brilho: Brightness.dark,
    );
  }, skip: !ativo);

  testWidgets('integrações', (t) async {
    await _capturar(
      t,
      const _ComSessao(child: TelaIntegracoes()),
      '51-integracoes',
    );
  }, skip: !ativo);

  testWidgets('integrações — mais abaixo', (t) async {
    await _capturar(
      t,
      const _ComSessao(child: TelaIntegracoes()),
      '52-integracoes-2',
      antes: (t) async {
        await t.drag(find.byType(Scrollable).first, const Offset(0, -1400));
        for (var i = 0; i < 10; i++) {
          await t.pump(const Duration(milliseconds: 100));
        }
      },
    );
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
  Widget build(BuildContext context) => const Casca(abaInicial: Aba.mais);
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
