import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../sessao/sessao.dart';

/// "Quem recebe": de onde sai o público da campanha, e a prévia dele.
///
/// Espelha `frontend/src/lib/tipos.ts` (PublicoDaCampanha, PreviaDoPublico e
/// os resumos da base). A regra de quem entra em cada público é do servidor
/// (`contato/origem-do-publico.ts`) — a mesma dos blocos e da tela de Contatos.

int _int(Object? v) => v is num ? v.toInt() : int.tryParse('${v ?? ''}') ?? 0;
String _txt(Object? v) => v?.toString() ?? '';
DateTime? _data(Object? v) =>
    v == null ? null : DateTime.tryParse(v.toString())?.toLocal();
List<Map<String, dynamic>> _lista(Object? v) =>
    (v is List ? v : const []).whereType<Map<String, dynamic>>().toList();

/// O público escolhido: uma lista, ou um público da base.
class PublicoDaCampanha {
  const PublicoDaCampanha({
    required this.origem,
    this.origemId,
    this.segmento,
    this.uf,
    this.publico,
    this.publicoValor,
  });

  /// `lista`, `base`, `importacao`, `perfil`, `regiao` ou `publico`.
  final String origem;

  /// A lista ou a importação.
  final String? origemId;
  final String? segmento;
  final String? uf;
  final String? publico;

  /// O bairro, o mês (1 a 12) ou o produto, quando o público pede.
  final String? publicoValor;

  Map<String, Object?> paraJson() => {
    'origem': origem,
    if (origemId != null) 'origemId': origemId,
    if (segmento != null) 'segmento': segmento,
    if (uf != null) 'uf': uf,
    if (publico != null) 'publico': publico,
    if (publicoValor != null && publicoValor!.isNotEmpty)
      'publicoValor': publicoValor,
  };

  /// Para comparar dois públicos (e não pedir a prévia do mesmo de novo).
  String get chave =>
      '$origem|${origemId ?? ''}|${segmento ?? ''}|${uf ?? ''}|${publico ?? ''}|${publicoValor ?? ''}';

  @override
  bool operator ==(Object other) =>
      other is PublicoDaCampanha && other.chave == chave;

  @override
  int get hashCode => chave.hashCode;
}

/// Em que período o público pede, e a janela sugerida.
class SugestaoDeHorario {
  const SugestaoDeHorario({
    required this.total,
    required this.comHabito,
    required this.minimo,
    required this.periodos,
    this.sugestao,
  });

  final int total;

  /// Desses, quantos têm período (compras).
  final int comHabito;

  /// Com menos gente com compra que isso, não há sugestão.
  final int minimo;

  /// Os períodos que aparecem, do maior para o menor.
  final List<({String periodo, int total})> periodos;
  final ({String periodo, int percentual, String inicio, String fim})? sugestao;

  factory SugestaoDeHorario.deJson(Map<String, dynamic> j) {
    final s = j['sugestao'];
    return SugestaoDeHorario(
      total: _int(j['total']),
      comHabito: _int(j['comHabito']),
      minimo: _int(j['minimo']),
      periodos: [
        for (final p in _lista(j['periodos']))
          (periodo: _txt(p['periodo']), total: _int(p['total'])),
      ],
      sugestao: s is Map<String, dynamic>
          ? (
              periodo: _txt(s['periodo']),
              percentual: _int(s['percentual']),
              inicio: _txt(s['inicio']),
              fim: _txt(s['fim']),
            )
          : null,
    );
  }
}

/// `POST /campanhas/previa`: quantos podem receber, o descanso e o horário.
class PreviaDoPublico {
  const PreviaDoPublico({
    required this.total,
    required this.descansoDias,
    required this.emDescanso,
    this.horario,
    this.cashbackDoPublico,
  });

  /// Quem pode receber. Com variável de cashback, só quem tem cashback válido.
  final int total;
  final int descansoDias;
  final int emDescanso;
  final SugestaoDeHorario? horario;

  /// Com variável de cashback: de quantos do público saiu o `total`.
  final int? cashbackDoPublico;

  factory PreviaDoPublico.deJson(Map<String, dynamic> j) {
    final descanso = j['descanso'] is Map<String, dynamic>
        ? j['descanso'] as Map<String, dynamic>
        : const <String, dynamic>{};
    final cashback = j['cashback'];
    return PreviaDoPublico(
      total: _int(j['total']),
      descansoDias: _int(descanso['dias']),
      emDescanso: _int(descanso['emDescanso']),
      horario: j['horario'] is Map<String, dynamic>
          ? SugestaoDeHorario.deJson(j['horario'] as Map<String, dynamic>)
          : null,
      cashbackDoPublico: cashback is Map<String, dynamic>
          ? _int(cashback['doPublico'])
          : null,
    );
  }
}

/// `GET /contatos/importacoes`: cada arquivo (ou Cardápio Web) importado.
class ImportacaoDaBase {
  const ImportacaoDaBase({
    required this.id,
    required this.nome,
    required this.formato,
    required this.criadoEm,
    required this.total,
  });

  final String id;
  final String nome;
  final String formato;
  final DateTime? criadoEm;

  /// Quem pode receber.
  final int total;

  factory ImportacaoDaBase.deJson(Map<String, dynamic> j) => ImportacaoDaBase(
    id: _txt(j['id']),
    nome: _txt(j['nome']),
    formato: _txt(j['formato']),
    criadoEm: _data(j['criadoEm']),
    total: _int(j['total']),
  );
}

/// Um perfil da base (Campeões, Em risco…) ou um público pronto.
class PublicoResumido {
  const PublicoResumido({
    required this.id,
    required this.nome,
    required this.regra,
    required this.total,
  });

  final String id;
  final String nome;
  final String regra;
  final int total;

  factory PublicoResumido.deJson(Map<String, dynamic> j) => PublicoResumido(
    id: _txt(j['id']),
    nome: _txt(j['nome']),
    regra: _txt(j['regra']),
    total: _int(j['total']),
  );
}

/// `GET /contatos/publicos`: os públicos prontos, bairros e aniversários.
class ResumoPublicos {
  const ResumoPublicos({
    required this.publicos,
    required this.bairros,
    required this.aniversarios,
    required this.mesAtual,
    this.conversasLigadas = false,
  });

  final List<PublicoResumido> publicos;
  final List<({String bairro, int total})> bairros;
  final List<({int mes, int total})> aniversarios;

  /// O mês de hoje no fuso da conta (1 a 12).
  final int mesAtual;

  /// Com as conversas ligadas, "Conversaram na última semana" faz sentido.
  final bool conversasLigadas;

  factory ResumoPublicos.deJson(Map<String, dynamic> j) => ResumoPublicos(
    publicos: _lista(j['publicos']).map(PublicoResumido.deJson).toList(),
    bairros: [
      for (final b in _lista(j['bairros']))
        (bairro: _txt(b['bairro']), total: _int(b['total'])),
    ],
    aniversarios: [
      for (final a in _lista(j['aniversarios']))
        (mes: _int(a['mes']), total: _int(a['total'])),
    ],
    mesAtual: _int(j['mesAtual']),
    conversasLigadas: j['conversasLigadas'] == true,
  );
}

/// Os públicos fixos em grupos, na ordem da tela — os mesmos da web
/// (`GRUPOS` em `frontend/src/components/app/publicos-base.tsx`).
const gruposDePublicos = <({String titulo, List<String> ids})>[
  (
    titulo: 'Quanto gastam',
    ids: ['vip', 'ticket_alto', 'ticket_medio', 'ticket_baixo'],
  ),
  (titulo: 'Momento', ids: ['um_pedido', 'marco_10']),
  (titulo: 'Como compram', ids: ['entrega', 'retirada', 'salao']),
  (
    titulo: 'Quando pedem',
    ids: [
      'periodo_cafe',
      'periodo_almoco',
      'periodo_tarde',
      'periodo_noite',
      'periodo_madrugada',
    ],
  ),
  (
    titulo: 'Engajamento',
    ids: [
      'leram_30d',
      'responderam_30d',
      'nao_leram_3',
      'nunca_receberam',
      'conversaram_7d',
    ],
  ),
  (titulo: 'Cashback', ids: ['cashback', 'cashback_vence_7d']),
];

const nomesDosMeses = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

// -------------------------------------------------------------- leituras

final importacoesProvider = FutureProvider.autoDispose<List<ImportacaoDaBase>>((
  ref,
) async {
  final dados = await ref.read(clienteApiProvider).get('/contatos/importacoes');
  return _lista(dados).map(ImportacaoDaBase.deJson).toList();
});

final segmentosProvider = FutureProvider.autoDispose<List<PublicoResumido>>((
  ref,
) async {
  final dados = await ref.read(clienteApiProvider).get('/contatos/segmentos');
  final mapa = dados is Map<String, dynamic> ? dados : <String, dynamic>{};
  return _lista(mapa['segmentos']).map(PublicoResumido.deJson).toList();
});

final publicosProntosProvider = FutureProvider.autoDispose<ResumoPublicos>((
  ref,
) async {
  final dados = await ref.read(clienteApiProvider).get('/contatos/publicos');
  return ResumoPublicos.deJson(
    dados is Map<String, dynamic> ? dados : <String, dynamic>{},
  );
});

/// "Já compraram…": os produtos da base, com quantas pessoas compraram.
final produtosDaBaseProvider =
    FutureProvider.autoDispose<List<({String nome, int total})>>((ref) async {
      final dados = await ref
          .read(clienteApiProvider)
          .get('/contatos/publicos/produtos');
      final mapa = dados is Map<String, dynamic> ? dados : <String, dynamic>{};
      return [
        for (final p in _lista(mapa['produtos']))
          (nome: _txt(p['nome']), total: _int(p['total'])),
      ];
    });

/// A conta tem saldo de cashback lido do Cardápio Web? Uma linha só de
/// contatos basta para saber (`cashbackLido`).
final cashbackNaContaProvider = FutureProvider.autoDispose<bool>((ref) async {
  final dados = await ref
      .read(clienteApiProvider)
      .get('/contatos?pagina=1&porPagina=1');
  return dados is Map<String, dynamic> && dados['cashbackLido'] == true;
});

/// O nome do período como a tela fala dele — a regra é do servidor
/// (`contato/habitos.ts`).
String quandoPede(String periodo) => switch (periodo) {
  'cafe' => 'no café da manhã',
  'almoco' => 'no almoço',
  'tarde' => 'à tarde',
  'noite' => 'à noite',
  'madrugada' => 'de madrugada',
  _ => periodo,
};

String nomeDoPeriodo(String periodo) => switch (periodo) {
  'cafe' => 'café da manhã',
  'almoco' => 'almoço',
  'tarde' => 'tarde',
  'noite' => 'noite',
  'madrugada' => 'madrugada',
  _ => periodo,
};

/// '17:00' → '17h'; '10:30' → '10h30'.
String horaCurta(String hhmm) {
  final partes = hhmm.split(':');
  final h = int.tryParse(partes.first) ?? 0;
  final m = partes.length > 1 ? partes[1] : '00';
  return '${h}h${m != '00' ? m : ''}';
}
