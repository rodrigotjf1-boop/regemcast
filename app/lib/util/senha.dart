/// A regra de senha do produto — em UM lugar só no app.
///
/// É a mesma do site (`frontend/src/lib/senha.ts`) e do servidor
/// (`SenhaForte`): de 10 a 200 caracteres, com ao menos uma letra e um
/// número. Aqui a letra é `\p{L}`, exatamente como o servidor cobra.
///
/// A checagem daqui nunca é mais frouxa que a do servidor: mais frouxa deixa
/// passar o que vira 400 lá na frente. Ela confere a FORMA — quem decide se a
/// senha vale é o servidor.
library;

const senhaMinimo = 10;
const senhaMaximo = 200;

/// O texto de ajuda do campo. Toda tela de senha mostra este mesmo texto.
const ajudaSenha =
    'Pelo menos $senhaMinimo caracteres, com pelo menos uma letra e um número.';

final _temLetra = RegExp(r'\p{L}', unicode: true);
final _temNumero = RegExp(r'\d');

/// O que está errado na senha, em pt-BR, ou nulo quando ela passa.
///
/// [rotulo] é como a tela chama a senha ("A senha", "A senha nova"), para a
/// frase sair no mesmo tom do formulário.
String? erroDaSenha(String senha, {String rotulo = 'A senha'}) {
  if (senha.length < senhaMinimo) {
    return '$rotulo precisa ter pelo menos $senhaMinimo caracteres.';
  }
  if (senha.length > senhaMaximo) {
    return '$rotulo pode ter no máximo $senhaMaximo caracteres.';
  }
  if (!_temLetra.hasMatch(senha)) {
    return '$rotulo precisa ter pelo menos uma letra.';
  }
  if (!_temNumero.hasMatch(senha)) {
    return '$rotulo precisa ter pelo menos um número.';
  }
  return null;
}
