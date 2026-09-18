import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:local_auth/local_auth.dart';

import '../api/cliente_api.dart';
import '../api/dados.dart';
import '../api/erro_api.dart';
import '../config.dart';
import 'cofre.dart';

// ---------------------------------------------------------------- os estados

/// Em que pé está a entrada no app. A tela raiz mostra uma tela por estado.
sealed class EstadoSessao {
  const EstadoSessao();
}

/// Lendo o cofre e conferindo a sessão com o servidor.
class SessaoIniciando extends EstadoSessao {
  const SessaoIniciando();
}

/// Ninguém dentro. `aviso` explica por quê, quando houve motivo (sessão vencida).
class SessaoAusente extends EstadoSessao {
  const SessaoAusente({this.aviso});
  final String? aviso;
}

/// Tem sessão, mas o app pede a biometria antes de mostrar a conta.
class SessaoTravada extends EstadoSessao {
  const SessaoTravada(this.sessao);
  final Sessao sessao;
}

/// Dentro.
class SessaoAtiva extends EstadoSessao {
  const SessaoAtiva(this.sessao, {this.oferecerBiometria = false});
  final Sessao sessao;

  /// Primeira entrada neste aparelho e ele tem biometria: pergunta uma vez.
  final bool oferecerBiometria;
}

/// Tem token guardado mas o servidor não respondeu (sem internet). O token NÃO
/// é apagado: falta de rede não é sessão inválida.
class SessaoSemConexao extends EstadoSessao {
  const SessaoSemConexao(this.mensagem);
  final String mensagem;
}

// -------------------------------------------------------------- dependências

final cofreProvider = Provider<Cofre>((ref) => Cofre());

final clienteApiProvider = Provider<ClienteApi>((ref) => ClienteApi());

final biometriaProvider = Provider<LocalAuthentication>(
  (ref) => LocalAuthentication(),
);

final sessaoProvider = NotifierProvider<ControleSessao, EstadoSessao>(
  ControleSessao.new,
);

// ------------------------------------------------------------------ o controle

class ControleSessao extends Notifier<EstadoSessao> {
  ClienteApi get _api => ref.read(clienteApiProvider);
  Cofre get _cofre => ref.read(cofreProvider);
  LocalAuthentication get _bio => ref.read(biometriaProvider);

  @override
  EstadoSessao build() {
    _api.aoPerderSessao = () => _expulsar('Sua sessão expirou. Entre de novo.');
    Future.microtask(iniciar);
    return const SessaoIniciando();
  }

  /// Abre o app: há sessão guardada? Ela ainda vale?
  Future<void> iniciar() async {
    state = const SessaoIniciando();

    final token = await _cofre.lerToken();
    if (token == null) {
      state = const SessaoAusente();
      return;
    }
    _api.token = token;

    try {
      final sessao = Sessao.deJson(
        await _api.get('/auth/eu') as Map<String, dynamic>,
      );
      await _renovarSePerto();
      state = await _cofre.biometriaLigada()
          ? SessaoTravada(sessao)
          : SessaoAtiva(sessao);
    } on ErroApi catch (e) {
      if (e.naoAutenticado) {
        await _expulsar('Sua sessão expirou. Entre de novo.');
      } else {
        state = SessaoSemConexao(e.mensagem);
      }
    }
  }

  /// Senha. Devolve a etapa do código quando a conta usa duas etapas; senão,
  /// a sessão já abre aqui.
  Future<EtapaCodigo?> entrar(String email, String senha) async {
    _api.limparPreSessao();
    final resposta =
        await _api.post('/auth/login', {
              'email': email.trim(),
              'senha': senha,
              'dispositivo': 'app',
            })
            as Map<String, dynamic>;

    await _cofre.guardarUltimoEmail(email.trim());

    if (resposta['etapa'] == 'codigo') {
      return EtapaCodigo(
        metodo: '${resposta['metodo']}',
        emailMascarado: '${resposta['emailMascarado'] ?? ''}',
      );
    }

    await _abrir(resposta);
    return null;
  }

  Future<void> confirmarCodigo(String codigo) async {
    final resposta =
        await _api.post('/auth/login/codigo', {'codigo': codigo})
            as Map<String, dynamic>;
    _api.limparPreSessao();
    await _abrir(resposta);
  }

  /// Só para quem recebe o código por e-mail. Devolve para onde foi.
  Future<String> reenviarCodigo() async {
    final r = await _api.post('/auth/login/reenviar') as Map<String, dynamic>;
    return '${r['emailMascarado'] ?? ''}';
  }

  /// Pede a digital/rosto e, se conferir, abre a conta.
  Future<bool> desbloquear() async {
    final atual = state;
    if (atual is! SessaoTravada) return false;
    try {
      final ok = await _bio.authenticate(
        localizedReason: 'Confirme que é você para abrir o Regemcast',
      );
      if (ok) state = SessaoAtiva(atual.sessao);
      return ok;
    } on PlatformException {
      return false;
    } on LocalAuthException {
      return false;
    }
  }

  /// O aparelho tem biometria cadastrada?
  Future<bool> biometriaDisponivel() async {
    try {
      return await _bio.canCheckBiometrics && await _bio.isDeviceSupported();
    } catch (_) {
      return false;
    }
  }

  Future<void> definirBiometria(bool ligar) async {
    if (ligar) {
      // Ligar exige provar agora: sem isso, quem pegou o celular desbloqueado
      // ligaria a biometria DELE e passaria a abrir o app.
      final ok = await _bio.authenticate(
        localizedReason: 'Confirme para usar a biometria no Regemcast',
      );
      if (!ok) return;
    }
    await _cofre.definirBiometria(ligar);
    final atual = state;
    if (atual is SessaoAtiva) state = SessaoAtiva(atual.sessao);
  }

  Future<void> dispensarOfertaDeBiometria() async {
    await _cofre.definirBiometria(false);
    final atual = state;
    if (atual is SessaoAtiva) state = SessaoAtiva(atual.sessao);
  }

  Future<bool> biometriaLigada() => _cofre.biometriaLigada();

  /// Sai: avisa o servidor (derruba a sessão em todos os aparelhos) e limpa o cofre.
  Future<void> sair() async {
    try {
      await _api.post('/auth/sair');
    } catch (_) {
      // Sem rede, sai do mesmo jeito: o cofre é limpo e o token esquecido. Quem
      // tiver copiado o token cai na próxima troca de senha (token_versao).
    }
    await _expulsar(null);
  }

  /// A troca de senha derruba todas as sessões no servidor, inclusive esta:
  /// limpa o cofre e volta ao login com o motivo, sem chamar `/auth/sair`.
  Future<void> encerrarAposTrocaDeSenha() =>
      _expulsar('Senha trocada. Entre de novo com a senha nova.');

  // ------------------------------------------------------------------ apoio

  Future<void> _abrir(Map<String, dynamic> resposta) async {
    final token = resposta['token'];
    if (token is! String || token.isEmpty) {
      throw const ErroApi(
        'O servidor não devolveu a sessão do aplicativo. Atualize o app e tente de novo.',
      );
    }
    await _cofre.guardarSessao(token, resposta['expiraEm'] as String?);
    _api.token = token;

    final oferecer =
        !(await _cofre.biometriaJaPerguntada()) && await biometriaDisponivel();
    state = SessaoAtiva(Sessao.deJson(resposta), oferecerBiometria: oferecer);
  }

  /// Sessão perto de vencer: troca por uma nova, sem pedir senha.
  Future<void> _renovarSePerto() async {
    final expira = await _cofre.lerExpiraEm();
    if (expira != null &&
        expira.difference(DateTime.now()) > renovarSessaoAntesDe) {
      return;
    }
    try {
      final r = await _api.post('/auth/renovar') as Map<String, dynamic>;
      final token = r['token'] as String?;
      if (token == null) return;
      await _cofre.guardarSessao(token, r['expiraEm'] as String?);
      _api.token = token;
    } catch (_) {
      // Renovar é conveniência: se falhar, a sessão atual segue valendo até vencer.
    }
  }

  Future<void> _expulsar(String? aviso) async {
    await _cofre.apagarSessao();
    _api.token = null;
    _api.limparPreSessao();
    state = SessaoAusente(aviso: aviso);
  }
}
