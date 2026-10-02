/// Quanto uma campanha custa na Meta, como o servidor manda.
///
/// Espelha `CustoNaMeta` de `frontend/src/lib/tipos.ts`. As frases e os valores
/// vêm prontos (`orcamento/custo.regras.ts`, no servidor): o app não faz conta
/// de dinheiro nem decide o que dizer quando falta a tarifa ou a moeda.
library;

/// Uma linha do custo: o rótulo ("Custo estimado na Meta"), o valor em
/// destaque ("até R$ 96,51") e de onde ele saiu ("300 mensagens × R$ 0,3217").
class LinhaDoCusto {
  const LinhaDoCusto({required this.rotulo, required this.valor, this.detalhe});

  final String rotulo;
  final String valor;
  final String? detalhe;
}

class CustoNaMeta {
  const CustoNaMeta({
    this.linhas = const [],
    this.avisos = const [],
    this.nota,
  });

  final List<LinhaDoCusto> linhas;

  /// O que falta para a conta ficar completa (tarifa, moeda, aviso de cobrança).
  final List<String> avisos;

  /// A regra da cobrança, em uma frase.
  final String? nota;

  /// Sem linha e sem aviso, não há o que mostrar (campanha sem destinatários).
  bool get temOQueMostrar => linhas.isNotEmpty || avisos.isNotEmpty;

  /// Nulo quando o servidor não mandou o custo (versão antiga, ou a prévia
  /// sem modelo escolhido).
  static CustoNaMeta? deJson(Object? v) {
    if (v is! Map<String, dynamic>) return null;
    String? texto(Object? t) {
      final s = t?.toString().trim() ?? '';
      return s.isEmpty ? null : s;
    }

    return CustoNaMeta(
      linhas: [
        for (final l
            in (v['linhas'] is List ? v['linhas'] as List : const [])
                .whereType<Map<String, dynamic>>())
          if (texto(l['rotulo']) != null && texto(l['valor']) != null)
            LinhaDoCusto(
              rotulo: texto(l['rotulo'])!,
              valor: texto(l['valor'])!,
              detalhe: texto(l['detalhe']),
            ),
      ],
      avisos: [
        for (final a in (v['avisos'] is List ? v['avisos'] as List : const []))
          if (texto(a) != null) texto(a)!,
      ],
      nota: texto(v['nota']),
    );
  }
}
