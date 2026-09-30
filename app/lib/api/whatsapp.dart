import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../sessao/sessao.dart';
import 'cliente_api.dart';

/// O que o app faz no WhatsApp da conta além de ler a situação: responder,
/// no número em coexistência, se os contatos e as conversas do celular vêm
/// para o Regemcast. Conectar o número continua no site — a Meta não deixa o
/// login dela rodar dentro de outro app.

final servicoWhatsappProvider = Provider<ServicoWhatsapp>(
  (ref) => ServicoWhatsapp(ref.read(clienteApiProvider)),
);

/// A declaração que o dono aceita ao dizer "sim" — o texto vem do servidor, e
/// é o mesmo que a auditoria grava.
final declaracaoIntegracaoProvider = FutureProvider.autoDispose<String>(
  (ref) => ref.read(servicoWhatsappProvider).declaracao(),
);

class ServicoWhatsapp {
  ServicoWhatsapp(this._api);

  final ClienteApi _api;

  Future<String> declaracao() async {
    final r = await _api.get('/whatsapp/config') as Map<String, dynamic>;
    return '${r['declaracaoIntegracao'] ?? ''}';
  }

  /// Só o dono: trazer (ou não) os contatos e as conversas deste número.
  Future<void> integrar(String phoneNumberId, bool integrar) => _api.post(
    '/whatsapp/integrar',
    {'phoneNumberId': phoneNumberId, 'integrar': integrar},
  );
}
