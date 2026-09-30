import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../sessao/sessao.dart';
import 'cliente_api.dart';

/// A verificação em duas etapas de quem está logado — como a seção
/// "Segurança do seu acesso" do site (`seguranca-conta.tsx`).
///
/// É da PESSOA, não da conta: cada um liga a sua, porque o código chega no
/// celular ou no e-mail de quem entra. O dono não liga pelos operadores.
/// Ligar exige provar que funciona (um código válido); desligar exige a senha.
class SituacaoSeguranca {
  const SituacaoSeguranca({
    required this.doisFatores,
    required this.emailVerificado,
    required this.appDisponivel,
  });

  /// `nenhum`, `app` ou `email`.
  final String doisFatores;
  final bool emailVerificado;

  /// O servidor tem a chave do aplicativo autenticador configurada.
  final bool appDisponivel;

  bool get ligada => doisFatores != 'nenhum';
  bool get peloAplicativo => doisFatores == 'app';

  factory SituacaoSeguranca.deJson(Map<String, dynamic> j) => SituacaoSeguranca(
    doisFatores: switch (j['doisFatores']) {
      'app' => 'app',
      'email' => 'email',
      _ => 'nenhum',
    },
    emailVerificado: j['emailVerificado'] == true,
    appDisponivel: j['appDisponivel'] == true,
  );
}

/// O começo do cadastro do aplicativo autenticador: o endereço `otpauth://`
/// (o mesmo do QR code do site) e a chave, para quem digita.
class CadastroDoAplicativo {
  const CadastroDoAplicativo({required this.endereco, required this.segredo});

  final String endereco;
  final String segredo;

  /// A chave em grupos de 4, como o site mostra — é assim que se digita.
  String get segredoEmGrupos {
    final grupos = <String>[];
    for (var i = 0; i < segredo.length; i += 4) {
      grupos.add(
        segredo.substring(i, i + 4 > segredo.length ? segredo.length : i + 4),
      );
    }
    return grupos.join(' ');
  }
}

/// `POST /auth/seguranca/email/codigo`: para onde foi e por quanto tempo vale.
class CodigoEnviado {
  const CodigoEnviado({required this.emailMascarado, required this.minutos});

  final String emailMascarado;
  final int minutos;
}

final situacaoSegurancaProvider = FutureProvider.autoDispose<SituacaoSeguranca>(
  (ref) async {
    final dados = await ref.read(clienteApiProvider).get('/auth/seguranca');
    return SituacaoSeguranca.deJson(dados as Map<String, dynamic>);
  },
);

final servicoSegurancaProvider = Provider<ServicoSeguranca>(
  (ref) => ServicoSeguranca(ref.read(clienteApiProvider)),
);

class ServicoSeguranca {
  ServicoSeguranca(this._api);

  final ClienteApi _api;

  static SituacaoSeguranca _situacao(Object? dados) =>
      SituacaoSeguranca.deJson(dados as Map<String, dynamic>);

  Future<CodigoEnviado> enviarCodigoEmail() async {
    final r =
        await _api.post('/auth/seguranca/email/codigo', const {})
            as Map<String, dynamic>;
    final minutos = r['minutos'];
    return CodigoEnviado(
      emailMascarado: '${r['emailMascarado'] ?? ''}',
      minutos: minutos is num ? minutos.toInt() : 10,
    );
  }

  Future<SituacaoSeguranca> ativarEmail(String codigo) async => _situacao(
    await _api.post('/auth/seguranca/email/ativar', {'codigo': codigo}),
  );

  Future<CadastroDoAplicativo> iniciarApp() async {
    final r =
        await _api.post('/auth/seguranca/app/iniciar', const {})
            as Map<String, dynamic>;
    return CadastroDoAplicativo(
      endereco: '${r['endereco'] ?? ''}',
      segredo: '${r['segredo'] ?? ''}',
    );
  }

  /// O código E a senha: só o código deixaria quem achou uma sessão esquecida
  /// aberta cadastrar o PRÓPRIO celular e trancar o dono fora.
  Future<SituacaoSeguranca> ativarApp(String codigo, String senha) async =>
      _situacao(
        await _api.post('/auth/seguranca/app/ativar', {
          'codigo': codigo,
          'senha': senha,
        }),
      );

  Future<SituacaoSeguranca> desativar(String senha) async =>
      _situacao(await _api.post('/auth/seguranca/desativar', {'senha': senha}));
}
