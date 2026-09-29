/// Endereços do Regemcast, definidos na hora do build.
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

/// O site, para o que o app ainda manda fazer no navegador (montar campanha,
/// conectar o número pela Meta) e para as páginas públicas.
const String urlWeb = String.fromEnvironment(
  'WEB_URL',
  defaultValue: 'https://cast.dmsregem.com',
);

/// Renova a sessão quando faltar menos que isto para ela vencer.
const Duration renovarSessaoAntesDe = Duration(days: 7);

/// Quanto esperar uma resposta da API antes de desistir.
const Duration tempoLimiteApi = Duration(seconds: 20);

/// Build da Play Store: `--dart-define=LOJA_PLAY=true`.
///
/// A Google exige o faturamento dela para vender serviço digital dentro do
/// app, e proíbe levar a pessoa a pagar por fora. O APK distribuído direto
/// contrata pelo Mercado Pago como o site; o da Play mostra o plano, o consumo
/// e os pagamentos, mas não oferece contratar nem trocar.
const bool compraNoApp = !bool.fromEnvironment('LOJA_PLAY');

/// Vai junto do registro do aparelho, para saber quem ainda roda versão velha.
/// Acompanha o `version` do pubspec.yaml.
const String versaoDoApp = '0.5.0';
