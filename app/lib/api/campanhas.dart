import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../sessao/sessao.dart';
import 'cliente_api.dart';
import 'dados.dart';

/// Uma campanha, relida do servidor. `family` por id: cada tela de detalhe tem
/// a sua, e a lista não precisa ser recarregada para abrir uma.
final campanhaProvider = FutureProvider.autoDispose
    .family<ResumoCampanha, String>((ref, id) async {
      final dados = await ref.read(clienteApiProvider).get('/campanhas/$id');
      return ResumoCampanha.deJson(dados as Map<String, dynamic>);
    });

final destinatariosProvider = FutureProvider.autoDispose
    .family<List<DestinatarioCampanha>, String>((ref, id) async {
      final dados = await ref
          .read(clienteApiProvider)
          .get('/campanhas/$id/destinatarios');
      return (dados as List)
          .whereType<Map<String, dynamic>>()
          .map(DestinatarioCampanha.deJson)
          .toList();
    });

final servicoCampanhasProvider = Provider<ServicoCampanhas>(
  (ref) => ServicoCampanhas(ref.read(clienteApiProvider)),
);

/// O que acontece com a campanha quando se pede para excluir.
enum ResultadoExclusao { apagada, cancelada, arquivada }

/// As ações sobre uma campanha que já existe. Montar campanha é da web.
class ServicoCampanhas {
  ServicoCampanhas(this._api);

  final ClienteApi _api;

  Future<ResumoCampanha> disparar(String id) async => ResumoCampanha.deJson(
    await _api.post('/campanhas/$id/disparar') as Map<String, dynamic>,
  );

  Future<ResumoCampanha> pausar(String id) async => ResumoCampanha.deJson(
    await _api.post('/campanhas/$id/pausar') as Map<String, dynamic>,
  );

  Future<ResumoCampanha> retomar(String id) async => ResumoCampanha.deJson(
    await _api.post('/campanhas/$id/retomar') as Map<String, dynamic>,
  );

  /// Manda só o que mudou. O servidor decide o que a situação permite.
  Future<ResumoCampanha> editar(
    String id,
    Map<String, Object?> mudancas,
  ) async => ResumoCampanha.deJson(
    await _api.patch('/campanhas/$id', mudancas) as Map<String, dynamic>,
  );

  Future<ResultadoExclusao> excluir(String id) async {
    final r = await _api.delete('/campanhas/$id') as Map<String, dynamic>;
    return switch (r['resultado']) {
      'apagada' => ResultadoExclusao.apagada,
      'cancelada' => ResultadoExclusao.cancelada,
      _ => ResultadoExclusao.arquivada,
    };
  }
}
