/**
 * Fusos oferecidos na tela de conta.
 *
 * O fuso da conta rege janela de envio e virada de ciclo, então é escolha
 * explícita do cliente — não constante no código.
 */
export const FUSOS: ReadonlyArray<{ valor: string; rotulo: string }> = [
  { valor: 'America/Sao_Paulo', rotulo: 'Brasília (São Paulo, Rio, Sul e Sudeste)' },
  { valor: 'America/Bahia', rotulo: 'Bahia e Sergipe' },
  { valor: 'America/Fortaleza', rotulo: 'Ceará, Piauí, Rio Grande do Norte e Paraíba' },
  { valor: 'America/Recife', rotulo: 'Pernambuco e Alagoas' },
  { valor: 'America/Belem', rotulo: 'Pará e Amapá' },
  { valor: 'America/Araguaina', rotulo: 'Tocantins' },
  { valor: 'America/Campo_Grande', rotulo: 'Mato Grosso do Sul' },
  { valor: 'America/Cuiaba', rotulo: 'Mato Grosso' },
  { valor: 'America/Manaus', rotulo: 'Amazonas e Roraima' },
  { valor: 'America/Porto_Velho', rotulo: 'Rondônia' },
  { valor: 'America/Rio_Branco', rotulo: 'Acre' },
  { valor: 'America/Noronha', rotulo: 'Fernando de Noronha' },
];
