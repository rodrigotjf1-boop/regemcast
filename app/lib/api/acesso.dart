import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../sessao/sessao.dart';
import 'cliente_api.dart';

/// As rotas abertas, de quem ainda não entrou: "esqueci minha senha" e a
/// lista de espera — as mesmas páginas públicas do site. Nenhuma abre sessão.
final servicoAcessoProvider = Provider<ServicoAcesso>(
  (ref) => ServicoAcesso(ref.read(clienteApiProvider)),
);

class ServicoAcesso {
  ServicoAcesso(this._api);

  final ClienteApi _api;

  static String _mensagem(Object? dados, String reserva) =>
      dados is Map && dados['mensagem'] is String
      ? dados['mensagem'] as String
      : reserva;

  /// `POST /auth/senha/esqueci`. A resposta é sempre a mesma, exista o e-mail
  /// ou não: a tela não pode dizer a ninguém quem tem conta.
  Future<String> esqueciSenha(String email) async => _mensagem(
    await _api.post('/auth/senha/esqueci', {'email': email.trim()}),
    'Se este e-mail tiver acesso, o código chega em instantes.',
  );

  /// `POST /auth/senha/redefinir`: a senha nova, com o código do e-mail. O
  /// servidor encerra as sessões abertas em outros aparelhos.
  Future<String> redefinirSenha({
    required String email,
    required String codigo,
    required String senhaNova,
  }) async => _mensagem(
    await _api.post('/auth/senha/redefinir', {
      'email': email.trim(),
      'codigo': codigo,
      'senhaNova': senhaNova,
    }),
    'Senha nova criada. Entre com ela.',
  );

  /// `POST /lista-espera`: anônimo e idempotente por e-mail. `origem` diz de
  /// onde veio o pedido — o site manda `site`, o app manda `app`.
  Future<String> entrarNaListaDeEspera({
    required String nome,
    required String email,
    String? empresa,
    String? telefone,
  }) async {
    final empresaLimpa = empresa?.trim() ?? '';
    final telefoneLimpo = telefone?.trim() ?? '';
    return _mensagem(
      await _api.post('/lista-espera', {
        'nome': nome.trim(),
        'email': email.trim(),
        if (empresaLimpa.isNotEmpty) 'empresa': empresaLimpa,
        if (telefoneLimpo.isNotEmpty) 'telefone': telefoneLimpo,
        'origem': 'app',
      }),
      'Pedido registrado.',
    );
  }
}
