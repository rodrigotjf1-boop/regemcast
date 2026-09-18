/// Endereços do RegemCast, definidos na hora do build.
///
/// Nada aqui é segredo: é o mesmo endereço público que o site usa. O que é
/// segredo (a sessão) fica no cofre do Android, nunca no código.
///
/// Para testar contra a API local no emulador:
///   flutter run --dart-define=API_URL=http://10.0.2.2:3010/api/v1
library;

const String urlApi = String.fromEnvironment(
  'API_URL',
  defaultValue: 'https://castapi.dmsregem.com/api/v1',
);

/// O site, para o que o app manda fazer no navegador (criar modelo, montar
/// campanha): as duas telas longas ficam lá por decisão de produto.
const String urlWeb = String.fromEnvironment(
  'WEB_URL',
  defaultValue: 'https://cast.dmsregem.com',
);

/// Renova a sessão quando faltar menos que isto para ela vencer.
const Duration renovarSessaoAntesDe = Duration(days: 7);

/// Quanto esperar uma resposta da API antes de desistir.
const Duration tempoLimiteApi = Duration(seconds: 20);
