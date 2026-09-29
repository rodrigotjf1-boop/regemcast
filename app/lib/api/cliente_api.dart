import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';

import '../config.dart';
import 'erro_api.dart';

/// O único lugar do app que fala HTTP.
///
/// Três responsabilidades, e só elas:
///
/// 1. **Sessão.** O token vai no `Authorization: Bearer`. Fora do navegador
///    não existe cookie de sessão; a API devolve o token no corpo quando o
///    login vem do app, e ele mora no cofre do Android (ver `Cofre`).
/// 2. **Pré-sessão das duas etapas.** Entre a senha e o código, a API usa um
///    cookie httpOnly de 5 minutos restrito a `/auth/login`. No navegador ele
///    viaja sozinho; aqui guardamos esse cookie em memória e o devolvemos só
///    nas rotas do próprio login. Nunca vai para o disco.
/// 3. **Erro legível.** Toda falha vira `ErroApi` com a frase da API — e a
///    falta de rede vira uma frase também, não uma exceção de socket.
class ClienteApi {
  ClienteApi({http.Client? http, String? base})
    : _http = http ?? _clientePadrao(),
      _base = base ?? urlApi;

  final http.Client _http;
  final String _base;

  String? _token;

  /// Cookie da pré-sessão (`nome=valor`). Só em memória, só para /auth/login.
  String? _cookiePre;

  /// Chamado quando a API diz que a sessão não vale mais (401 fora do login).
  void Function()? aoPerderSessao;

  set token(String? valor) => _token = valor;
  bool get temToken => _token != null;

  /// Para quem busca um arquivo por fora deste cliente — o reprodutor de
  /// áudio e vídeo das conversas, que lê o arquivo aos poucos: o endereço
  /// completo e o cabeçalho da sessão (a rota é autenticada).
  Uri endereco(String caminho) => Uri.parse('$_base$caminho');
  Map<String, String> get cabecalhoDaSessao => {
    if (_token != null) 'Authorization': 'Bearer $_token',
  };

  static http.Client _clientePadrao() => http.Client();

  Future<dynamic> get(String caminho) => _pedir('GET', caminho);
  Future<dynamic> post(String caminho, [Object? corpo]) =>
      _pedir('POST', caminho, corpo);
  Future<dynamic> patch(String caminho, [Object? corpo]) =>
      _pedir('PATCH', caminho, corpo);
  Future<dynamic> put(String caminho, [Object? corpo]) =>
      _pedir('PUT', caminho, corpo);
  Future<dynamic> delete(String caminho) => _pedir('DELETE', caminho);

  /// Esquece a pré-sessão: login concluído, cancelado ou recomeçado.
  void limparPreSessao() => _cookiePre = null;

  /// Envia um arquivo (multipart), como o formulário da web faz. Usado na
  /// importação de contatos e na mídia dos modelos.
  ///
  /// `tipoMime` vai no cabeçalho da parte: a mídia do modelo é aceita ou
  /// recusada pelo servidor por ele (e pelos primeiros bytes). Sem ele, a
  /// parte sai como `application/octet-stream` — que o navegador nunca manda
  /// e o servidor recusa.
  Future<dynamic> enviarArquivo(
    String caminho, {
    required String campo,
    required List<int> bytes,
    required String nomeArquivo,
    String? tipoMime,
  }) {
    final pedido = http.MultipartRequest('POST', Uri.parse('$_base$caminho'))
      ..headers.addAll({
        'Accept': 'application/json',
        if (_token != null) 'Authorization': 'Bearer $_token',
      })
      ..files.add(
        http.MultipartFile.fromBytes(
          campo,
          bytes,
          filename: nomeArquivo,
          contentType: tipoMime == null ? null : MediaType.parse(tipoMime),
        ),
      );
    return _responder(caminho, pedido);
  }

  /// Baixa bytes com a sessão (a miniatura da mídia de um modelo, que só
  /// existe no nosso banco e passa pela autenticação). Falha vira `ErroApi`,
  /// como nas outras rotas.
  Future<Uint8List> baixar(String caminho) async {
    final pedido = http.Request('GET', Uri.parse('$_base$caminho'))
      ..headers.addAll({if (_token != null) 'Authorization': 'Bearer $_token'});
    http.Response resposta;
    try {
      final enviado = await _http.send(pedido).timeout(tempoLimiteApi);
      resposta = await http.Response.fromStream(
        enviado,
      ).timeout(tempoLimiteApi);
    } on TimeoutException {
      throw ErroApi.tempoEsgotado;
    } on SocketException {
      throw ErroApi.semRede;
    } on http.ClientException {
      throw ErroApi.semRede;
    } on HandshakeException {
      throw ErroApi.semRede;
    }
    if (resposta.statusCode >= 200 && resposta.statusCode < 300) {
      return resposta.bodyBytes;
    }
    final dados = _lerCorpo(resposta);
    if (resposta.statusCode == 401 && _token != null) aoPerderSessao?.call();
    throw ErroApi(
      (dados is Map && dados['mensagem'] is String)
          ? dados['mensagem'] as String
          : 'O servidor respondeu com erro (${resposta.statusCode}). Tente de novo.',
      status: resposta.statusCode,
    );
  }

  Future<dynamic> _pedir(String metodo, String caminho, [Object? corpo]) {
    final ehLogin = caminho.startsWith('/auth/login');
    final cabecalhos = <String, String>{
      'Accept': 'application/json',
      if (corpo != null) 'Content-Type': 'application/json',
      if (_token != null) 'Authorization': 'Bearer $_token',
      if (ehLogin && _cookiePre != null) 'Cookie': _cookiePre!,
    };

    final pedido = http.Request(metodo, Uri.parse('$_base$caminho'))
      ..headers.addAll(cabecalhos);
    if (corpo != null) pedido.body = jsonEncode(corpo);
    return _responder(caminho, pedido);
  }

  /// Manda o pedido e transforma a resposta: dado no sucesso, `ErroApi` com a
  /// frase da API em qualquer falha. Um lugar só para JSON e multipart.
  Future<dynamic> _responder(String caminho, http.BaseRequest pedido) async {
    final ehLogin = caminho.startsWith('/auth/login');
    http.Response resposta;
    try {
      final enviado = await _http.send(pedido).timeout(tempoLimiteApi);
      resposta = await http.Response.fromStream(
        enviado,
      ).timeout(tempoLimiteApi);
    } on TimeoutException {
      throw ErroApi.tempoEsgotado;
    } on SocketException {
      throw ErroApi.semRede;
    } on http.ClientException {
      throw ErroApi.semRede;
    } on HandshakeException {
      throw ErroApi.semRede;
    }

    if (ehLogin) _guardarPreSessao(resposta);

    final dados = _lerCorpo(resposta);

    if (resposta.statusCode >= 200 && resposta.statusCode < 300) return dados;

    final mensagem = (dados is Map && dados['mensagem'] is String)
        ? dados['mensagem'] as String
        : 'O servidor respondeu com erro (${resposta.statusCode}). Tente de novo.';

    // 401 fora do login = a sessão acabou (senha trocada, acesso suspenso,
    // validade vencida). Dentro do login, 401 é "senha não confere" e precisa
    // chegar à tela como erro, não como expulsão.
    if (resposta.statusCode == 401 && !ehLogin && _token != null) {
      aoPerderSessao?.call();
    }

    throw ErroApi(mensagem, status: resposta.statusCode);
  }

  void _guardarPreSessao(http.Response resposta) {
    // O pacote http junta vários Set-Cookie numa linha separada por vírgula.
    // O que interessa é o cookie terminado em `_pre`; vazio = foi apagado.
    final bruto = resposta.headers['set-cookie'];
    if (bruto == null) return;
    final achado = RegExp(r'([A-Za-z0-9_]+_pre)=([^;,]*)').firstMatch(bruto);
    if (achado == null) return;
    final valor = achado.group(2) ?? '';
    _cookiePre = valor.isEmpty ? null : '${achado.group(1)}=$valor';
  }

  dynamic _lerCorpo(http.Response resposta) {
    if (resposta.bodyBytes.isEmpty) return null;
    // A API manda UTF-8. Se algum intermediário (proxy, página de erro do
    // Cloudflare) mandar outra codificação, cai no que o cabeçalho declarou em
    // vez de perder a mensagem — e com ela o motivo do erro.
    String texto;
    try {
      texto = utf8.decode(resposta.bodyBytes);
    } on FormatException {
      texto = resposta.body;
    }
    try {
      return jsonDecode(texto);
    } on FormatException {
      return null;
    }
  }
}
