import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/cliente_api.dart';
import '../config.dart';
import '../sessao/sessao.dart';

/// Os três tipos de aviso que a pessoa liga e desliga neste aparelho.
class PreferenciasAviso {
  const PreferenciasAviso({
    required this.campanhas,
    required this.modelos,
    required this.cobranca,
  });

  final bool campanhas;
  final bool modelos;
  final bool cobranca;

  factory PreferenciasAviso.deJson(Map<String, dynamic> j) => PreferenciasAviso(
    campanhas: j['campanhas'] != false,
    modelos: j['modelos'] != false,
    cobranca: j['cobranca'] != false,
  );
}

/// Push pelo Firebase Cloud Messaging.
///
/// Quem manda é o servidor; o app só:
/// 1. pede a permissão (Android 13+) e entrega o token ao servidor depois do
///    login — e de novo quando o Firebase troca o token;
/// 2. mostra o aviso que chega com o app aberto (o Android só mostra sozinho
///    com o app fechado ou em segundo plano);
/// 3. abre a tela certa quando a pessoa toca no aviso;
/// 4. ao sair, desfaz o vínculo: um celular deslogado não pode continuar
///    recebendo aviso da conta.
///
/// Tudo aqui engole erro. Sem Firebase (teste, aparelho sem Google Play), o app
/// funciona igual — só não avisa.
class ServicoPush {
  ServicoPush(this._api);

  final ClienteApi _api;

  bool _ouvindo = false;
  final _assinaturas = <StreamSubscription<dynamic>>[];

  /// Trocados a cada `ativar`: a casca pode ser remontada (sair e entrar), e os
  /// ouvintes do Firebase são registrados uma vez só.
  void Function(RemoteMessage)? _aoChegar;
  void Function(Map<String, dynamic>)? _aoTocar;

  Future<bool> _firebase() async {
    try {
      // Tempo-limite: aparelho sem Google Play pode nunca responder, e a
      // tela de avisos não pode ficar carregando para sempre.
      if (Firebase.apps.isEmpty) {
        await Firebase.initializeApp().timeout(const Duration(seconds: 8));
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  Future<String?> token() async {
    if (!await _firebase()) return null;
    try {
      return await FirebaseMessaging.instance.getToken().timeout(
        const Duration(seconds: 10),
      );
    } catch (_) {
      return null;
    }
  }

  /// Depois do login. Pode ser chamado de novo sem duplicar nada.
  Future<void> ativar({
    void Function(RemoteMessage)? aoChegar,
    void Function(Map<String, dynamic>)? aoTocar,
  }) async {
    _aoChegar = aoChegar ?? _aoChegar;
    _aoTocar = aoTocar ?? _aoTocar;
    if (!await _firebase()) return;
    final m = FirebaseMessaging.instance;
    try {
      await m.requestPermission();
      final t = await m.getToken();
      if (t != null) await _registrar(t);

      if (!_ouvindo) {
        _ouvindo = true;
        _assinaturas
          ..add(m.onTokenRefresh.listen(_registrar))
          ..add(FirebaseMessaging.onMessage.listen((r) => _aoChegar?.call(r)))
          ..add(
            FirebaseMessaging.onMessageOpenedApp.listen(
              (r) => _aoTocar?.call(r.data),
            ),
          );
        // App aberto PELO aviso, a partir de fechado.
        final inicial = await m.getInitialMessage();
        if (inicial != null) _aoTocar?.call(inicial.data);
      }
    } catch (_) {
      // Permissão negada ou Google Play ausente: segue sem aviso.
    }
  }

  Future<void> _registrar(String token) async {
    try {
      await _api.post('/dispositivos', {
        'token': token,
        'appVersao': versaoDoApp,
      });
    } catch (_) {
      // Tenta de novo na próxima abertura.
    }
  }

  /// Sair do app. Com `avisarServidor`, o servidor apaga o vínculo; em todo
  /// caso o token local é destruído — o que sobrar no servidor morre no
  /// próximo envio (o FCM responde "token não existe" e a linha é apagada).
  Future<void> desativar({bool avisarServidor = true}) async {
    for (final a in _assinaturas) {
      await a.cancel();
    }
    _assinaturas.clear();
    _ouvindo = false;
    if (!await _firebase()) return;
    try {
      final t = await FirebaseMessaging.instance.getToken();
      if (t != null && avisarServidor) {
        await _api.post('/dispositivos/remover', {'token': t});
      }
    } catch (_) {}
    try {
      await FirebaseMessaging.instance.deleteToken();
    } catch (_) {}
  }

  /// Nulo = este aparelho ainda não está registrado (sem permissão, sem Firebase).
  Future<PreferenciasAviso?> preferencias() async {
    final t = await token();
    if (t == null) return null;
    try {
      final r = await _api.get(
        '/dispositivos/avisos?token=${Uri.encodeQueryComponent(t)}',
      );
      return PreferenciasAviso.deJson(r as Map<String, dynamic>);
    } catch (_) {
      return null;
    }
  }

  Future<PreferenciasAviso> definir(String tipo, bool ligado) async {
    final t = await token();
    final r = await _api.patch('/dispositivos/avisos', {
      'token': t,
      tipo: ligado,
    });
    return PreferenciasAviso.deJson(r as Map<String, dynamic>);
  }
}

final servicoPushProvider = Provider<ServicoPush>(
  (ref) => ServicoPush(ref.read(clienteApiProvider)),
);

final preferenciasAvisoProvider =
    FutureProvider.autoDispose<PreferenciasAviso?>(
      (ref) => ref.read(servicoPushProvider).preferencias(),
    );
