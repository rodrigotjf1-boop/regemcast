/// Um erro vindo da API, já com a frase que a pessoa vai ler.
///
/// A API do Regemcast responde erro como `{ "mensagem": "..." }`, em
/// português e escrito para o cliente. O app mostra essa frase como veio —
/// reescrever aqui criaria duas versões da mesma explicação, e elas divergem.
class ErroApi implements Exception {
  const ErroApi(this.mensagem, {this.status, this.semConexao = false});

  final String mensagem;

  /// Código HTTP. Nulo quando nem chegou resposta.
  final int? status;

  /// Não houve resposta: sem internet, servidor fora, tempo esgotado.
  final bool semConexao;

  bool get naoAutenticado => status == 401;

  static const semRede = ErroApi(
    'Não consegui falar com o servidor. Confira a internet do celular e tente de novo.',
    semConexao: true,
  );

  static const tempoEsgotado = ErroApi(
    'O servidor demorou demais para responder. Tente de novo em instantes.',
    semConexao: true,
  );

  @override
  String toString() => 'ErroApi($status): $mensagem';
}

/// A frase de qualquer erro, para a tela. Erro que não é da API vira genérico:
/// detalhe técnico (stack, nome de exceção) não ajuda quem está no celular.
String mensagemDoErro(Object erro) {
  if (erro is ErroApi) return erro.mensagem;
  return 'Algo deu errado. Tente de novo.';
}
