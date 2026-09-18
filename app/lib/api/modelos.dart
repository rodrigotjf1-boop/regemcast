import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../sessao/sessao.dart';
import 'cliente_api.dart';

/// Modelos de mensagem, dos dois lados.
///
/// - `ModeloNaMeta` — o que a Meta tem (`GET /whatsapp/modelos`): a verdade
///   sobre o que está aprovado e pode ser usado em campanha.
/// - `ModeloSalvo` — o nosso registro (`GET /modelos`): o texto como foi
///   escrito, os rascunhos e o id que liga os dois. Só o que tem registro
///   nosso pode ser editado ou excluído pelo app — de um modelo criado direto
///   no painel da Meta não temos o texto original.

String _txt(Object? v) => v?.toString() ?? '';
String? _txtOuNulo(Object? v) => v?.toString();
int _int(Object? v) => v is num ? v.toInt() : int.tryParse('${v ?? ''}') ?? 0;
DateTime? _data(Object? v) =>
    v == null ? null : DateTime.tryParse('$v')?.toLocal();

/// `GET /whatsapp/modelos`. A categoria e o status já vêm em português.
class ModeloNaMeta {
  const ModeloNaMeta({
    required this.id,
    required this.nome,
    required this.idioma,
    required this.categoria,
    required this.status,
    required this.motivo,
    required this.cabecalho,
    required this.corpo,
    required this.rodape,
    required this.variaveis,
    required this.botoes,
  });

  final String id;
  final String nome;
  final String idioma;
  final String categoria;

  /// "aprovado", "em análise", "recusado", "pausado"…
  final String status;
  final String? motivo;
  final String? cabecalho;
  final String corpo;
  final String? rodape;
  final int variaveis;

  /// Só o texto de cada botão.
  final List<String> botoes;

  factory ModeloNaMeta.deJson(Map<String, dynamic> j) => ModeloNaMeta(
    id: _txt(j['id']),
    nome: _txt(j['nome']),
    idioma: _txt(j['idioma']),
    categoria: _txt(j['categoria']),
    status: _txt(j['status']),
    motivo: _txtOuNulo(j['motivo']),
    cabecalho: _txtOuNulo(j['cabecalho']),
    corpo: _txt(j['corpo']),
    rodape: _txtOuNulo(j['rodape']),
    variaveis: _int(j['variaveis']),
    botoes: (j['botoes'] is List ? j['botoes'] as List : const [])
        .map((b) => '$b')
        .toList(),
  );
}

/// Um botão como o nosso registro guarda.
class BotaoModelo {
  const BotaoModelo({
    required this.tipo,
    required this.texto,
    this.url,
    this.telefone,
  });

  /// `QUICK_REPLY`, `URL`, `PHONE_NUMBER` ou `COPY_CODE`.
  final String tipo;
  final String texto;
  final String? url;
  final String? telefone;

  BotaoModelo copiar({
    String? tipo,
    String? texto,
    String? url,
    String? telefone,
  }) => BotaoModelo(
    tipo: tipo ?? this.tipo,
    texto: texto ?? this.texto,
    url: url ?? this.url,
    telefone: telefone ?? this.telefone,
  );

  Map<String, Object?> paraJson() => {
    'tipo': tipo,
    'texto': texto,
    if (tipo == 'URL') 'url': url ?? '',
    if (tipo == 'PHONE_NUMBER') 'telefone': telefone ?? '',
  };

  factory BotaoModelo.deJson(Map<String, dynamic> j) => BotaoModelo(
    tipo: _txt(j['tipo']).isEmpty ? 'QUICK_REPLY' : _txt(j['tipo']),
    texto: _txt(j['texto']),
    url: _txtOuNulo(j['url']),
    telefone: _txtOuNulo(j['telefone']),
  );
}

/// `GET /modelos` — o nosso registro, inteiro, para reabrir e editar.
class ModeloSalvo {
  const ModeloSalvo({
    required this.id,
    required this.tipo,
    required this.nome,
    required this.idioma,
    required this.categoria,
    required this.status,
    required this.motivo,
    required this.corpo,
    required this.cabecalhoFormato,
    required this.cabecalhoTexto,
    required this.cabecalhoExemplo,
    required this.cabecalhoMidia,
    required this.corpoExemplos,
    required this.rodape,
    required this.botoes,
    required this.cartoes,
    required this.ltoAtivo,
    required this.ltoTexto,
    required this.metaTemplateId,
    required this.editadoMetaEm,
    required this.variaveis,
  });

  final String id;

  /// `simples` ou `carrossel`.
  final String tipo;
  final String nome;
  final String idioma;
  final String categoria;

  /// `rascunho`, `enviado` (em análise), `aprovado` ou `rejeitado`.
  final String status;
  final String? motivo;
  final String corpo;

  /// `TEXT`, `IMAGE`, `VIDEO`, `DOCUMENT` ou nulo.
  final String? cabecalhoFormato;
  final String? cabecalhoTexto;
  final String? cabecalhoExemplo;
  final String? cabecalhoMidia;
  final List<String> corpoExemplos;
  final String? rodape;
  final List<BotaoModelo> botoes;

  /// Os cartões do carrossel, crus: o app não edita carrossel.
  final List<dynamic> cartoes;
  final bool ltoAtivo;
  final String? ltoTexto;
  final String? metaTemplateId;
  final DateTime? editadoMetaEm;
  final int variaveis;

  bool get naMeta => metaTemplateId != null;
  bool get emAnalise => status == 'enviado';

  /// O app edita só o modelo simples. Carrossel tem imagem por cartão e
  /// regras próprias: é trabalho do editor da web.
  bool get editavelNoApp => tipo == 'simples' && !emAnalise;

  /// Modelo aprovado aceita 1 edição por 24 h. Horas que faltam, ou 0.
  int get horasParaEditar {
    if (status != 'aprovado' || editadoMetaEm == null) return 0;
    final falta =
        const Duration(hours: 24) - DateTime.now().difference(editadoMetaEm!);
    return falta.isNegative ? 0 : (falta.inMinutes / 60).ceil();
  }

  factory ModeloSalvo.deJson(Map<String, dynamic> j) => ModeloSalvo(
    id: _txt(j['id']),
    tipo: _txt(j['tipo']).isEmpty ? 'simples' : _txt(j['tipo']),
    nome: _txt(j['nome']),
    idioma: _txt(j['idioma']),
    categoria: _txt(j['categoria']),
    status: _txt(j['status']),
    motivo: _txtOuNulo(j['motivo']),
    corpo: _txt(j['corpo']),
    cabecalhoFormato: _txtOuNulo(j['cabecalhoFormato']),
    cabecalhoTexto: _txtOuNulo(j['cabecalhoTexto']),
    cabecalhoExemplo: _txtOuNulo(j['cabecalhoExemplo']),
    cabecalhoMidia: _txtOuNulo(j['cabecalhoMidia']),
    corpoExemplos:
        (j['corpoExemplos'] is List ? j['corpoExemplos'] as List : const [])
            .map((e) => '$e')
            .toList(),
    rodape: _txtOuNulo(j['rodape']),
    botoes: (j['botoes'] is List ? j['botoes'] as List : const [])
        .whereType<Map<String, dynamic>>()
        .map(BotaoModelo.deJson)
        .toList(),
    cartoes: j['cartoes'] is List ? j['cartoes'] as List : const [],
    ltoAtivo: j['ltoAtivo'] == true,
    ltoTexto: _txtOuNulo(j['ltoTexto']),
    metaTemplateId: _txtOuNulo(j['metaTemplateId']),
    editadoMetaEm: _data(j['editadoMetaEm']),
    variaveis: _int(j['variaveis']),
  );

  /// O corpo que o servidor espera (`SalvarModeloDto`), com as mudanças.
  Map<String, Object?> paraSalvar({
    String? corpo,
    List<String>? corpoExemplos,
    String? cabecalhoTexto,
    String? cabecalhoExemplo,
    String? rodape,
    List<BotaoModelo>? botoes,
  }) => {
    'tipo': tipo,
    'nome': nome,
    'idioma': idioma,
    'categoria': categoria,
    'cabecalhoFormato': cabecalhoFormato,
    'cabecalhoTexto': cabecalhoTexto ?? this.cabecalhoTexto,
    'cabecalhoExemplo': cabecalhoExemplo ?? this.cabecalhoExemplo,
    'cabecalhoMidia': cabecalhoMidia,
    'corpo': corpo ?? this.corpo,
    'corpoExemplos': corpoExemplos ?? this.corpoExemplos,
    'rodape': (rodape ?? this.rodape)?.trim().isEmpty == true
        ? null
        : (rodape ?? this.rodape),
    'botoes': (botoes ?? this.botoes).map((b) => b.paraJson()).toList(),
    'cartoes': cartoes,
    'ltoAtivo': ltoAtivo,
    'ltoTexto': ltoTexto,
  };
}

/// Um problema do modelo, já em português, com a parte do formulário.
class ProblemaModelo {
  const ProblemaModelo(this.campo, this.mensagem);
  final String campo;
  final String mensagem;
}

// -------------------------------------------------------------- leituras

final modelosNaMetaProvider = FutureProvider.autoDispose<List<ModeloNaMeta>>((
  ref,
) async {
  final dados = await ref.read(clienteApiProvider).get('/whatsapp/modelos');
  return (dados as List)
      .whereType<Map<String, dynamic>>()
      .map(ModeloNaMeta.deJson)
      .toList();
});

final modelosSalvosProvider = FutureProvider.autoDispose<List<ModeloSalvo>>((
  ref,
) async {
  final dados = await ref.read(clienteApiProvider).get('/modelos');
  return (dados as List)
      .whereType<Map<String, dynamic>>()
      .map(ModeloSalvo.deJson)
      .toList();
});

final servicoModelosProvider = Provider<ServicoModelos>(
  (ref) => ServicoModelos(ref.read(clienteApiProvider)),
);

class ServicoModelos {
  ServicoModelos(this._api);

  final ClienteApi _api;

  /// Confere as regras da Meta sem gravar nada.
  Future<List<ProblemaModelo>> conferir(Map<String, Object?> dados) async {
    final r =
        await _api.post('/modelos/conferir', dados) as Map<String, dynamic>;
    return (r['problemas'] is List ? r['problemas'] as List : const [])
        .whereType<Map<String, dynamic>>()
        .map((p) => ProblemaModelo('${p['campo']}', '${p['mensagem']}'))
        .toList();
  }

  /// Salva. Rascunho grava aqui; modelo que já está na Meta vai editado até
  /// ela (o servidor decide). Devolve o status novo, quando a Meta respondeu.
  Future<String?> salvar(String id, Map<String, Object?> dados) async {
    final r = await _api.put('/modelos/$id', dados) as Map<String, dynamic>?;
    return r?['status'] as String?;
  }

  /// Manda o rascunho para a Meta analisar.
  Future<String> enviarParaAprovacao(String id) async {
    final r = await _api.post('/modelos/$id/enviar') as Map<String, dynamic>;
    return '${r['status']}';
  }

  /// Exclui aqui e, se o modelo está lá, na Meta. Devolve se foi na Meta.
  Future<bool> excluir(String id) async {
    final r = await _api.delete('/modelos/$id') as Map<String, dynamic>;
    return r['naMeta'] == true;
  }
}

// ------------------------------------------------------- regras espelhadas
//
// Só para a tela mostrar o que vai ser enviado. Quem decide é o servidor
// (`backend/src/modules/modelo/regras-modelo.ts`) — o `conferir` roda antes de
// qualquer gravação, e o que ele disser vale.

/// O botão de saída que o servidor acrescenta a todo marketing simples.
const botaoSaida = BotaoModelo(tipo: 'QUICK_REPLY', texto: 'Parar promoções');

bool levaBotaoDeSaida(String categoria, String tipo) =>
    categoria.toUpperCase() == 'MARKETING' && tipo == 'simples';

/// Quantos botões a pessoa monta: no marketing, o 10º é o nosso.
int limiteBotoes(String categoria, String tipo) =>
    levaBotaoDeSaida(categoria, tipo) ? 9 : 10;

bool ehBotaoDeSaida(BotaoModelo b) =>
    b.tipo == 'QUICK_REPLY' &&
    b.texto.trim().toLowerCase() == botaoSaida.texto.toLowerCase();

/// Os botões na ordem em que chegam à Meta: link/telefone/código, respostas
/// rápidas agrupadas e, no marketing, a saída por último.
List<BotaoModelo> botoesComSaida(
  String categoria,
  String tipo,
  List<BotaoModelo> botoes,
) {
  if (!levaBotaoDeSaida(categoria, tipo)) return botoes;
  final doCliente = botoes.where((b) => !ehBotaoDeSaida(b));
  return [
    ...doCliente.where((b) => b.tipo != 'QUICK_REPLY'),
    ...doCliente.where((b) => b.tipo == 'QUICK_REPLY'),
    botaoSaida,
  ];
}

/// Variáveis distintas: `{{1}}` repetido ainda é uma só (erro 132000).
int quantasVariaveis(String texto) => RegExp(
  r'\{\{\s*(\d+)\s*\}\}',
).allMatches(texto).map((m) => m.group(1)).toSet().length;
