import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../sessao/sessao.dart';
import 'cliente_api.dart';
import 'dados.dart';
import 'publicos.dart';

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

/// A prévia do público escolhido: uma por público, por "só com cashback" e
/// pela categoria do modelo (que decide o custo), relida quando a escolha muda.
/// Falha vira "sem prévia" na tela — o servidor confere de novo ao montar.
final previaDoPublicoProvider = FutureProvider.autoDispose
    .family<PreviaDoPublico, (PublicoDaCampanha, bool, String)>(
      (ref, alvo) => ref
          .read(servicoCampanhasProvider)
          .previa(alvo.$1, soComCashback: alvo.$2, categoria: alvo.$3),
    );

/// O que acontece com a campanha quando se pede para excluir.
enum ResultadoExclusao { apagada, cancelada, arquivada }

/// Montar campanha e as ações sobre as que existem — as mesmas do site.
class ServicoCampanhas {
  ServicoCampanhas(this._api);

  final ClienteApi _api;

  /// Monta a campanha (`POST /campanhas`). Nenhuma mensagem sai aqui: o
  /// disparo é outro passo, na tela da campanha. Devolve o id.
  Future<String> criar(Map<String, Object?> corpo) async {
    final r = await _api.post('/campanhas', corpo) as Map<String, dynamic>;
    return '${r['id']}';
  }

  /// Quantos do público podem receber, quantos estão em descanso e em que
  /// horário pedem — com a mesma regra da montagem. `soComCashback`: a
  /// mensagem usa variável de cashback, e só conta quem tem cashback válido.
  /// `categoria`: a do modelo escolhido — com ela vem o custo estimado na Meta.
  Future<PreviaDoPublico> previa(
    PublicoDaCampanha publico, {
    bool soComCashback = false,
    String categoria = '',
  }) async => PreviaDoPublico.deJson(
    await _api.post('/campanhas/previa', {
          ...publico.paraJson(),
          if (soComCashback) 'soComCashback': true,
          if (categoria.isNotEmpty) 'categoria': categoria,
        })
        as Map<String, dynamic>,
  );

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
