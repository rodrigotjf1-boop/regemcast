/**
 * Regra de senha do produto — em UM lugar só.
 *
 * Espelha o decorator `SenhaForte` do backend: pelo menos 10 caracteres, com ao
 * menos uma letra e um número, no máximo 200. A regra vivia copiada em dois
 * formulários com mínimo de 8 — a tela aceitava, o servidor devolvia 400 e o
 * usuário levava a culpa por uma regra que ninguém tinha mostrado a ele.
 *
 * A checagem daqui é sempre IGUAL OU MAIS ESTRITA que a do servidor, nunca mais
 * frouxa: mais frouxa deixa passar o que vira 400 lá na frente; mais estrita só
 * evita um request que já ia falhar. Por isso a senha provisória de um operador
 * (onde o servidor cobra só o comprimento) também pede letra e número — é a
 * mesma senha que a pessoa vai ter de reforçar na primeira troca.
 *
 * Isto valida FORMA, não segurança: quem decide se a senha vale é o servidor.
 */

export const SENHA_MINIMO = 10;
export const SENHA_MAXIMO = 200;

/** Texto de ajuda do campo. Toda tela de senha mostra este mesmo texto. */
export const AJUDA_SENHA = `Pelo menos ${SENHA_MINIMO} caracteres, com pelo menos uma letra e um número.`;

/**
 * O servidor cobra `\p{L}` (qualquer letra Unicode). Aqui a classe é escrita à
 * mão — latim básico mais os acentuados — porque o `tsconfig` do front compila
 * para um alvo que não aceita a flag `u` do `\p{...}`. Na prática a checagem
 * fica um pouco mais estrita que a do servidor, que é o lado seguro de errar:
 * nunca deixa passar senha que o servidor recusaria.
 */
const TEM_LETRA = /[A-Za-zÀ-ÖØ-öø-ɏ]/;
const TEM_NUMERO = /\d/;

/**
 * Devolve o que está errado na senha, em pt-BR, ou `null` quando ela passa.
 *
 * @param rotulo como a senha é chamada na tela ("A senha", "A senha nova"),
 *   para a frase sair no mesmo tom do formulário.
 */
export function erroDaSenha(senha: string, rotulo = 'A senha'): string | null {
  if (senha.length < SENHA_MINIMO) {
    return `${rotulo} precisa ter pelo menos ${SENHA_MINIMO} caracteres.`;
  }
  if (senha.length > SENHA_MAXIMO) {
    return `${rotulo} pode ter no máximo ${SENHA_MAXIMO} caracteres.`;
  }
  if (!TEM_LETRA.test(senha)) return `${rotulo} precisa ter pelo menos uma letra.`;
  if (!TEM_NUMERO.test(senha)) return `${rotulo} precisa ter pelo menos um número.`;
  return null;
}
