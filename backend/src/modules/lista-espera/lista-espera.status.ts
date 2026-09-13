/**
 * Os quatro estados da fila de entrada, em um só lugar.
 *
 * O `check` da coluna em `001_fundacao.sql` é a fonte da verdade; esta lista é
 * o espelho tipado. Divergir é bug: um status novo aceito pelo DTO e recusado
 * pelo banco vira erro 500 do Postgres em vez de 400 explicando o que fazer.
 */
export const STATUS_LISTA_ESPERA = [
  'aguardando',
  'convidada',
  'recusada',
  'convertida',
] as const;

export type StatusListaEspera = (typeof STATUS_LISTA_ESPERA)[number];

/** Teto da Meta para Tech Provider antes da Access Verification sair. */
export const TETO_CONVITES_JANELA = 10;

/** Tamanho da janela rolling da Meta, em dias. Também é a validade do convite. */
export const JANELA_CONVITE_DIAS = 7;
