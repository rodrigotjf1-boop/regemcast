/**
 * Parâmetros do argon2id do produto — num lugar só, de propósito.
 *
 * POR QUE ISTO É UM ARQUIVO E NÃO UMA CONSTANTE SOLTA EM CADA SERVICE:
 * o custo do argon2 é o que define o TEMPO da resposta de login. O login
 * gasta o mesmo tempo para e-mail que existe e para e-mail que não existe
 * porque, quando não existe, ele confere a senha contra um hash-isca — e isso
 * só funciona enquanto o isca e os hashes de verdade tiverem os MESMOS
 * parâmetros. Quando o cadastro de usuário usava os defaults da lib
 * (m=65536, t=3, p=4) e o login usava os da OWASP (m=19456, t=2, p=1), a
 * conferência de um hash real levava ~85 ms contra ~28 ms do isca: o relógio
 * voltava a dizer quem tem conta aqui, que é exatamente a lista que um
 * atacante quer montar.
 *
 * Hash antigo continua válido: os parâmetros viajam DENTRO da string do hash,
 * então `argon2.verify` confere com os parâmetros de quando ele foi criado.
 * Trocar os números abaixo não invalida senha de ninguém — só muda o custo dos
 * hashes novos (e aí `argon2.needsRehash` diz quem reescrever no próximo
 * login, se um dia valer a pena).
 */
import argon2 from 'argon2';

/** Recomendação atual da OWASP para argon2id: m=19 MiB, t=2, p=1. */
export const OPCOES_ARGON2 = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

/**
 * Único caminho de hash de senha do backend. Existe para que ninguém precise
 * lembrar de passar as opções — esquecer é o defeito que este arquivo corrige.
 */
export function gerarHashSenha(senha: string): Promise<string> {
  return argon2.hash(senha, OPCOES_ARGON2);
}
