import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:regemcast/api/cliente_api.dart';
import 'package:regemcast/api/contatos.dart';

/// A planilha traz mais que nome e telefone (a exportação do Anota Aí traz
/// pedidos, total gasto e última compra). O site grava tudo; o app precisa
/// gravar igual — senão importar pelo celular perde o histórico de compra.
void main() {
  test(
    'a importação leva as colunas extras da planilha, como o site',
    () async {
      final corpos = <Map<String, dynamic>>[];
      final api = ClienteApi(
        base: 'https://api.teste',
        http: MockClient((req) async {
          corpos.add(jsonDecode(req.body) as Map<String, dynamic>);
          return http.Response(
            jsonEncode({'importacaoId': 'i1', 'gravados': 1, 'jaExistiam': 0}),
            201,
            headers: {'content-type': 'application/json'},
          );
        }),
      );
      final previa = PreviaImportacao.deJson({
        'formato': 'xlsx',
        'arquivoNome': 'clientes-ativos.xlsx',
        'totalLidos': 1,
        'validos': 1,
        'invalidos': 0,
        'novos': 1,
        'jaExistem': 0,
        'assumiramPais': 0,
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
          {
            'nome': 'Ana',
            'telefone': '5521999998888',
            'novo': true,
            'assumiuPais': false,
            'email': 'ana@exemplo.com',
            'dataNascimento': '1990-09-14',
            'pedidos': 12,
            'totalGastoCentavos': 45890,
            'ultimoPedidoEm': '2026-09-20T22:10:00.000Z',
          },
        ],
      });

      await ServicoContatos(api).importar(previa: previa, consentimento: true);

      expect(corpos.single['contatos'], [
        {
          'telefone': '5521999998888',
          'nome': 'Ana',
          'email': 'ana@exemplo.com',
          'dataNascimento': '1990-09-14',
          'pedidos': 12,
          'totalGastoCentavos': 45890,
          'ultimoPedidoEm': '2026-09-20T22:10:00.000Z',
        },
      ]);
    },
  );
}
