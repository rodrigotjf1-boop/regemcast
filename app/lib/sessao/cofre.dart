import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Onde a sessão mora no aparelho: o cofre do Android (Keystore).
///
/// O token dá acesso à conta inteira por 30 dias. Em `SharedPreferences` ele
/// ficaria em texto puro, legível por qualquer backup ou aparelho com root; no
/// cofre, a chave de cifra nem sai do hardware. O manifesto também desliga o
/// backup automático, para o token não ser copiado para outro aparelho.
class Cofre {
  Cofre([FlutterSecureStorage? armazenamento])
    : _a = armazenamento ?? const FlutterSecureStorage();

  final FlutterSecureStorage _a;

  static const _token = 'sessao.token';
  static const _expiraEm = 'sessao.expira_em';
  static const _biometria = 'preferencia.biometria';
  static const _biometriaPerguntada = 'preferencia.biometria_perguntada';
  static const _ultimoEmail = 'preferencia.ultimo_email';

  Future<String?> lerToken() => _a.read(key: _token);

  Future<DateTime?> lerExpiraEm() async {
    final v = await _a.read(key: _expiraEm);
    return v == null ? null : DateTime.tryParse(v);
  }

  Future<void> guardarSessao(String token, String? expiraEm) async {
    await _a.write(key: _token, value: token);
    if (expiraEm != null) await _a.write(key: _expiraEm, value: expiraEm);
  }

  /// Sai da conta. A preferência de biometria some junto: ela vale para ESTA
  /// sessão, e quem entrar depois (outra pessoa no mesmo aparelho) escolhe de novo.
  Future<void> apagarSessao() async {
    await _a.delete(key: _token);
    await _a.delete(key: _expiraEm);
    await _a.delete(key: _biometria);
    await _a.delete(key: _biometriaPerguntada);
  }

  Future<bool> biometriaLigada() async =>
      (await _a.read(key: _biometria)) == 'sim';

  Future<void> definirBiometria(bool ligada) async {
    await _a.write(key: _biometria, value: ligada ? 'sim' : 'nao');
    await _a.write(key: _biometriaPerguntada, value: 'sim');
  }

  Future<bool> biometriaJaPerguntada() async =>
      (await _a.read(key: _biometriaPerguntada)) == 'sim';

  /// O e-mail do último login, para não pedir de novo. Não é segredo, mas fica
  /// no mesmo cofre para ter um lugar só de dados do app.
  Future<String?> lerUltimoEmail() => _a.read(key: _ultimoEmail);
  Future<void> guardarUltimoEmail(String email) =>
      _a.write(key: _ultimoEmail, value: email);
}
