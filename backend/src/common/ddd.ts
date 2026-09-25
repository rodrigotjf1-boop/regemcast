/**
 * Região pelo DDD — a classificação que existe até na lista mais crua, só com
 * nome e número (a agenda exportada do celular): o número já diz o estado.
 *
 * O DDD diz onde a linha foi habilitada, não onde a pessoa mora hoje. Serve
 * para campanha regional ("frete grátis no Rio"), não para endereço.
 *
 * Os 67 DDDs do Brasil, com a cidade que dá nome à área.
 */

export interface RegiaoDoDdd {
  uf: string;
  cidade: string;
}

export const DDDS: Readonly<Record<string, RegiaoDoDdd>> = {
  '11': { uf: 'SP', cidade: 'São Paulo' },
  '12': { uf: 'SP', cidade: 'São José dos Campos' },
  '13': { uf: 'SP', cidade: 'Santos' },
  '14': { uf: 'SP', cidade: 'Bauru' },
  '15': { uf: 'SP', cidade: 'Sorocaba' },
  '16': { uf: 'SP', cidade: 'Ribeirão Preto' },
  '17': { uf: 'SP', cidade: 'São José do Rio Preto' },
  '18': { uf: 'SP', cidade: 'Presidente Prudente' },
  '19': { uf: 'SP', cidade: 'Campinas' },
  '21': { uf: 'RJ', cidade: 'Rio de Janeiro' },
  '22': { uf: 'RJ', cidade: 'Campos dos Goytacazes' },
  '24': { uf: 'RJ', cidade: 'Volta Redonda' },
  '27': { uf: 'ES', cidade: 'Vitória' },
  '28': { uf: 'ES', cidade: 'Cachoeiro de Itapemirim' },
  '31': { uf: 'MG', cidade: 'Belo Horizonte' },
  '32': { uf: 'MG', cidade: 'Juiz de Fora' },
  '33': { uf: 'MG', cidade: 'Governador Valadares' },
  '34': { uf: 'MG', cidade: 'Uberlândia' },
  '35': { uf: 'MG', cidade: 'Poços de Caldas' },
  '37': { uf: 'MG', cidade: 'Divinópolis' },
  '38': { uf: 'MG', cidade: 'Montes Claros' },
  '41': { uf: 'PR', cidade: 'Curitiba' },
  '42': { uf: 'PR', cidade: 'Ponta Grossa' },
  '43': { uf: 'PR', cidade: 'Londrina' },
  '44': { uf: 'PR', cidade: 'Maringá' },
  '45': { uf: 'PR', cidade: 'Cascavel' },
  '46': { uf: 'PR', cidade: 'Francisco Beltrão' },
  '47': { uf: 'SC', cidade: 'Joinville' },
  '48': { uf: 'SC', cidade: 'Florianópolis' },
  '49': { uf: 'SC', cidade: 'Chapecó' },
  '51': { uf: 'RS', cidade: 'Porto Alegre' },
  '53': { uf: 'RS', cidade: 'Pelotas' },
  '54': { uf: 'RS', cidade: 'Caxias do Sul' },
  '55': { uf: 'RS', cidade: 'Santa Maria' },
  '61': { uf: 'DF', cidade: 'Brasília' },
  '62': { uf: 'GO', cidade: 'Goiânia' },
  '63': { uf: 'TO', cidade: 'Palmas' },
  '64': { uf: 'GO', cidade: 'Rio Verde' },
  '65': { uf: 'MT', cidade: 'Cuiabá' },
  '66': { uf: 'MT', cidade: 'Rondonópolis' },
  '67': { uf: 'MS', cidade: 'Campo Grande' },
  '68': { uf: 'AC', cidade: 'Rio Branco' },
  '69': { uf: 'RO', cidade: 'Porto Velho' },
  '71': { uf: 'BA', cidade: 'Salvador' },
  '73': { uf: 'BA', cidade: 'Ilhéus' },
  '74': { uf: 'BA', cidade: 'Juazeiro' },
  '75': { uf: 'BA', cidade: 'Feira de Santana' },
  '77': { uf: 'BA', cidade: 'Vitória da Conquista' },
  '79': { uf: 'SE', cidade: 'Aracaju' },
  '81': { uf: 'PE', cidade: 'Recife' },
  '82': { uf: 'AL', cidade: 'Maceió' },
  '83': { uf: 'PB', cidade: 'João Pessoa' },
  '84': { uf: 'RN', cidade: 'Natal' },
  '85': { uf: 'CE', cidade: 'Fortaleza' },
  '86': { uf: 'PI', cidade: 'Teresina' },
  '87': { uf: 'PE', cidade: 'Petrolina' },
  '88': { uf: 'CE', cidade: 'Juazeiro do Norte' },
  '89': { uf: 'PI', cidade: 'Picos' },
  '91': { uf: 'PA', cidade: 'Belém' },
  '92': { uf: 'AM', cidade: 'Manaus' },
  '93': { uf: 'PA', cidade: 'Santarém' },
  '94': { uf: 'PA', cidade: 'Marabá' },
  '95': { uf: 'RR', cidade: 'Boa Vista' },
  '96': { uf: 'AP', cidade: 'Macapá' },
  '97': { uf: 'AM', cidade: 'Coari' },
  '98': { uf: 'MA', cidade: 'São Luís' },
  '99': { uf: 'MA', cidade: 'Imperatriz' },
};

export const ESTADOS: Readonly<Record<string, string>> = {
  AC: 'Acre',
  AL: 'Alagoas',
  AM: 'Amazonas',
  AP: 'Amapá',
  BA: 'Bahia',
  CE: 'Ceará',
  DF: 'Distrito Federal',
  ES: 'Espírito Santo',
  GO: 'Goiás',
  MA: 'Maranhão',
  MG: 'Minas Gerais',
  MS: 'Mato Grosso do Sul',
  MT: 'Mato Grosso',
  PA: 'Pará',
  PB: 'Paraíba',
  PE: 'Pernambuco',
  PI: 'Piauí',
  PR: 'Paraná',
  RJ: 'Rio de Janeiro',
  RN: 'Rio Grande do Norte',
  RO: 'Rondônia',
  RR: 'Roraima',
  RS: 'Rio Grande do Sul',
  SC: 'Santa Catarina',
  SE: 'Sergipe',
  SP: 'São Paulo',
  TO: 'Tocantins',
};

/** O DDD de um número guardado como o `contato` guarda (E.164 sem '+'); `null` fora do Brasil. */
export function dddDoTelefone(e164SemMais: string): string | null {
  const d = e164SemMais.replace(/\D/g, '');
  if (!d.startsWith('55') || d.length < 12) return null;
  const ddd = d.slice(2, 4);
  return ddd in DDDS ? ddd : null;
}

/** Os DDDs de um estado, em ordem. Vazio para sigla desconhecida. */
export function dddsDaUf(uf: string): string[] {
  const alvo = uf.toUpperCase();
  return Object.keys(DDDS)
    .filter((ddd) => DDDS[ddd]!.uf === alvo)
    .sort();
}
