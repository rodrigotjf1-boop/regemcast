import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../sessao/sessao.dart';
import 'cliente_api.dart';

/// O orçamento de disparos: quanto a conta aceita gastar na Meta por dia, por
/// semana e por mês.
///
/// Espelha `OrcamentoDeDisparos` de `frontend/src/lib/tipos.ts`. O servidor
/// faz a conta e manda as frases prontas (`orcamento/orcamento.regras.ts`); o
/// app mostra, e manda os três campos do jeito que a pessoa digitou.

String _txt(Object? v) => v?.toString() ?? '';
int _int(Object? v) => v is num ? v.toInt() : int.tryParse('${v ?? ''}') ?? 0;

/// Um período com teto: quanto já saiu nele.
class PeriodoDoOrcamento {
  const PeriodoDoOrcamento({
    required this.periodo,
    required this.rotulo,
    required this.texto,
    required this.percentual,
    required this.sinal,
    required this.zera,
  });

  /// `dia`, `semana` ou `mes`.
  final String periodo;

  /// "Hoje", "Esta semana", "Este mês".
  final String rotulo;

  /// "R$ 12,40 de R$ 50,00".
  final String texto;

  /// 0 a 100, para a barra.
  final int percentual;

  /// `ok`, `atencao` ou `cheio`.
  final String sinal;

  /// "Zera amanhã".
  final String zera;
}

class OrcamentoDeDisparos {
  const OrcamentoDeDisparos({
    this.moeda,
    this.campos = const {},
    this.periodos = const [],
    this.avisos = const [],
    this.podeMudar = false,
  });

  /// A moeda em que a Meta cobra a conta. Nulo = a Meta ainda não informou.
  final String? moeda;

  /// O texto de cada campo de edição ("50,00"); vazio = sem teto.
  final Map<String, String> campos;

  /// Só os períodos com teto.
  final List<PeriodoDoOrcamento> periodos;
  final List<String> avisos;

  /// Só o dono muda o orçamento.
  final bool podeMudar;

  String campo(String periodo) => campos[periodo] ?? '';

  factory OrcamentoDeDisparos.deJson(Map<String, dynamic> j) {
    final campos = j['campos'] is Map<String, dynamic>
        ? j['campos'] as Map<String, dynamic>
        : const <String, dynamic>{};
    return OrcamentoDeDisparos(
      moeda: j['moeda'] is String ? j['moeda'] as String : null,
      campos: {for (final e in campos.entries) e.key: _txt(e.value)},
      periodos: [
        for (final p
            in (j['periodos'] is List ? j['periodos'] as List : const [])
                .whereType<Map<String, dynamic>>())
          PeriodoDoOrcamento(
            periodo: _txt(p['periodo']),
            rotulo: _txt(p['rotulo']),
            texto: _txt(p['texto']),
            percentual: _int(p['percentual']).clamp(0, 100),
            sinal: _txt(p['sinal']),
            zera: _txt(p['zera']),
          ),
      ],
      avisos: [
        for (final a in (j['avisos'] is List ? j['avisos'] as List : const []))
          if (_txt(a).isNotEmpty) _txt(a),
      ],
      podeMudar: j['podeMudar'] == true,
    );
  }
}

/// `GET /orcamento`: qualquer pessoa da conta lê.
final orcamentoProvider = FutureProvider.autoDispose<OrcamentoDeDisparos>((
  ref,
) async {
  final dados = await ref.read(clienteApiProvider).get('/orcamento');
  return OrcamentoDeDisparos.deJson(dados as Map<String, dynamic>);
});

final servicoOrcamentoProvider = Provider<ServicoOrcamento>(
  (ref) => ServicoOrcamento(ref.read(clienteApiProvider)),
);

class ServicoOrcamento {
  ServicoOrcamento(this._api);

  final ClienteApi _api;

  /// `PUT /orcamento`, só do dono: os três campos como a pessoa digitou; vazio
  /// tira o teto. O formato é conferido no servidor, e a frase do que está
  /// errado volta de lá.
  Future<OrcamentoDeDisparos> definir({
    required String dia,
    required String semana,
    required String mes,
  }) async => OrcamentoDeDisparos.deJson(
    await _api.put('/orcamento', {'dia': dia, 'semana': semana, 'mes': mes})
        as Map<String, dynamic>,
  );
}
