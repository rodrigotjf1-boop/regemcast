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
/// - `DadosModelo` — o que o editor escreve e manda ao servidor (o
///   `SalvarModeloDto`), igual ao editor do site.

String _txt(Object? v) => v?.toString() ?? '';
String? _txtOuNulo(Object? v) => v?.toString();
int _int(Object? v) => v is num ? v.toInt() : int.tryParse('${v ?? ''}') ?? 0;
DateTime? _data(Object? v) =>
    v == null ? null : DateTime.tryParse('$v')?.toLocal();

List<BotaoModelo> _botoes(Object? v) => (v is List ? v : const [])
    .whereType<Map<String, dynamic>>()
    .map(BotaoModelo.deJson)
    .toList();

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

/// Um cartão do carrossel: a imagem, o texto e os botões.
class CartaoModelo {
  const CartaoModelo({
    this.imagem = '',
    this.corpo = '',
    this.botoes = const [],
  });

  /// Referência da imagem: `midia:<uuid>` (arquivo enviado) ou `https://…`.
  final String imagem;
  final String corpo;
  final List<BotaoModelo> botoes;

  CartaoModelo copiar({
    String? imagem,
    String? corpo,
    List<BotaoModelo>? botoes,
  }) => CartaoModelo(
    imagem: imagem ?? this.imagem,
    corpo: corpo ?? this.corpo,
    botoes: botoes ?? this.botoes,
  );

  Map<String, Object?> paraJson() => {
    if (imagem.trim().isNotEmpty) 'imagem': imagem.trim(),
    'corpo': corpo,
    'botoes': [for (final b in botoes) b.paraJson()],
  };

  factory CartaoModelo.deJson(Map<String, dynamic> j) => CartaoModelo(
    imagem: _txt(j['imagem']),
    corpo: _txt(j['corpo']),
    botoes: _botoes(j['botoes']),
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
  final List<CartaoModelo> cartoes;
  final bool ltoAtivo;
  final String? ltoTexto;
  final String? metaTemplateId;
  final DateTime? editadoMetaEm;
  final int variaveis;

  bool get naMeta => metaTemplateId != null;
  bool get emAnalise => status == 'enviado';
  bool get ehCarrossel => tipo == 'carrossel';

  /// Editar: tudo menos o que está em análise (a Meta ainda não decidiu, e
  /// editar agora seria editar uma versão que não existe dos dois lados).
  bool get podeEditar => !emAnalise;

  /// Enviar para aprovação: o que ainda não está na Meta. O recusado que já
  /// está lá volta pela edição, com o mesmo nome.
  bool get podeEnviar =>
      !naMeta && (status == 'rascunho' || status == 'rejeitado');

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
    botoes: _botoes(j['botoes']),
    cartoes: (j['cartoes'] is List ? j['cartoes'] as List : const [])
        .whereType<Map<String, dynamic>>()
        .map(CartaoModelo.deJson)
        .toList(),
    ltoAtivo: j['ltoAtivo'] == true,
    ltoTexto: _txtOuNulo(j['ltoTexto']),
    metaTemplateId: _txtOuNulo(j['metaTemplateId']),
    editadoMetaEm: _data(j['editadoMetaEm']),
    variaveis: _int(j['variaveis']),
  );
}

/// Marca "manter o valor atual" no `copiar` de um campo que aceita nulo.
const _manter = Object();

/// O modelo como a pessoa escreve — o corpo de `POST /modelos` e de
/// `PUT /modelos/:id` (o `SalvarModeloDto` do servidor). É o que o editor
/// edita, com as mesmas regras de forma do editor do site.
class DadosModelo {
  const DadosModelo({
    this.tipo = 'simples',
    this.nome = '',
    this.idioma = 'pt_BR',
    this.categoria = 'MARKETING',
    this.cabecalhoFormato,
    this.cabecalhoTexto = '',
    this.cabecalhoExemplo = '',
    this.cabecalhoMidia = '',
    this.corpo = '',
    this.corpoExemplos = const [],
    this.rodape = '',
    this.botoes = const [],
    this.cartoes = const [],
    this.ltoAtivo = false,
    this.ltoTexto = '',
  });

  /// `simples` ou `carrossel`.
  final String tipo;
  final String nome;
  final String idioma;

  /// `MARKETING`, `UTILITY` ou `AUTHENTICATION`.
  final String categoria;

  /// `TEXT`, `IMAGE`, `VIDEO`, `DOCUMENT` ou nulo (sem cabeçalho).
  final String? cabecalhoFormato;
  final String cabecalhoTexto;
  final String cabecalhoExemplo;

  /// Referência da mídia: `midia:<uuid>` ou `https://…`.
  final String cabecalhoMidia;
  final String corpo;

  /// Por posição: o primeiro é o exemplo de `{{1}}`, e assim por diante.
  final List<String> corpoExemplos;
  final String rodape;

  /// Só os da pessoa. O "Parar promoções" do marketing o servidor acrescenta.
  final List<BotaoModelo> botoes;
  final List<CartaoModelo> cartoes;
  final bool ltoAtivo;
  final String ltoTexto;

  bool get ehCarrossel => tipo == 'carrossel';
  bool get cabecalhoDeMidia =>
      cabecalhoFormato != null && cabecalhoFormato != 'TEXT';
  bool get cabecalhoTemVariavel =>
      cabecalhoFormato == 'TEXT' &&
      RegExp(r'\{\{\s*1\s*\}\}').hasMatch(cabecalhoTexto);

  /// O modelo salvo, no formato que o editor edita.
  factory DadosModelo.deSalvo(ModeloSalvo m) => DadosModelo(
    tipo: m.tipo,
    nome: m.nome,
    idioma: m.idioma.isEmpty ? 'pt_BR' : m.idioma,
    categoria: m.categoria.isEmpty ? 'MARKETING' : m.categoria.toUpperCase(),
    cabecalhoFormato: m.cabecalhoFormato,
    cabecalhoTexto: m.cabecalhoTexto ?? '',
    cabecalhoExemplo: m.cabecalhoExemplo ?? '',
    cabecalhoMidia: m.cabecalhoMidia ?? '',
    corpo: m.corpo,
    corpoExemplos: m.corpoExemplos,
    rodape: m.rodape ?? '',
    // Modelo antigo pode ter o botão de saída gravado: ele é nosso, e o
    // servidor o põe de volta no fim.
    botoes: [
      for (final b in m.botoes)
        if (!ehBotaoDeSaida(b)) b,
    ],
    cartoes: m.cartoes,
    ltoAtivo: m.ltoAtivo,
    ltoTexto: m.ltoTexto ?? '',
  );

  DadosModelo copiar({
    String? tipo,
    String? nome,
    String? idioma,
    String? categoria,
    Object? cabecalhoFormato = _manter,
    String? cabecalhoTexto,
    String? cabecalhoExemplo,
    String? cabecalhoMidia,
    String? corpo,
    List<String>? corpoExemplos,
    String? rodape,
    List<BotaoModelo>? botoes,
    List<CartaoModelo>? cartoes,
    bool? ltoAtivo,
    String? ltoTexto,
  }) => DadosModelo(
    tipo: tipo ?? this.tipo,
    nome: nome ?? this.nome,
    idioma: idioma ?? this.idioma,
    categoria: categoria ?? this.categoria,
    cabecalhoFormato: identical(cabecalhoFormato, _manter)
        ? this.cabecalhoFormato
        : cabecalhoFormato as String?,
    cabecalhoTexto: cabecalhoTexto ?? this.cabecalhoTexto,
    cabecalhoExemplo: cabecalhoExemplo ?? this.cabecalhoExemplo,
    cabecalhoMidia: cabecalhoMidia ?? this.cabecalhoMidia,
    corpo: corpo ?? this.corpo,
    corpoExemplos: corpoExemplos ?? this.corpoExemplos,
    rodape: rodape ?? this.rodape,
    botoes: botoes ?? this.botoes,
    cartoes: cartoes ?? this.cartoes,
    ltoAtivo: ltoAtivo ?? this.ltoAtivo,
    ltoTexto: ltoTexto ?? this.ltoTexto,
  );

  /// Troca a forma do modelo limpando o que a outra forma não tem — em vez de
  /// guardar lixo. O carrossel nasce com os dois cartões que a Meta exige.
  DadosModelo comTipo(String novo) => novo == 'carrossel'
      ? copiar(
          tipo: 'carrossel',
          cabecalhoFormato: null,
          cabecalhoTexto: '',
          cabecalhoExemplo: '',
          cabecalhoMidia: '',
          rodape: '',
          ltoAtivo: false,
          ltoTexto: '',
          botoes: const [],
          cartoes: cartoes.isNotEmpty
              ? cartoes
              : const [CartaoModelo(), CartaoModelo()],
        )
      : copiar(tipo: 'simples', cartoes: const []);

  /// Troca o formato do cabeçalho (nulo = sem cabeçalho) limpando o que o
  /// anterior usava: mandar à Meta um campo que sobrou da escolha anterior é
  /// recusa certa — e uma imagem não serve de vídeo.
  DadosModelo comCabecalho(String? formato) => copiar(
    cabecalhoFormato: formato,
    cabecalhoTexto: formato == 'TEXT' ? cabecalhoTexto : '',
    cabecalhoExemplo: formato == 'TEXT' ? cabecalhoExemplo : '',
    cabecalhoMidia: formato == cabecalhoFormato ? cabecalhoMidia : '',
  );

  /// O corpo do pedido, só com o que a forma escolhida usa.
  Map<String, Object?> paraJson() {
    final simples = !ehCarrossel;
    final n = quantasVariaveis(corpo);
    return {
      'tipo': tipo,
      'nome': nome.trim(),
      'idioma': idioma.trim().isEmpty ? 'pt_BR' : idioma.trim(),
      'categoria': categoria,
      if (simples && cabecalhoFormato != null)
        'cabecalhoFormato': cabecalhoFormato,
      if (simples && cabecalhoFormato == 'TEXT')
        'cabecalhoTexto': cabecalhoTexto,
      if (simples && cabecalhoTemVariavel)
        'cabecalhoExemplo': cabecalhoExemplo.trim(),
      if (simples && cabecalhoDeMidia && cabecalhoMidia.trim().isNotEmpty)
        'cabecalhoMidia': cabecalhoMidia.trim(),
      'corpo': corpo,
      // Um exemplo por variável do texto, na ordem. O que sobrou de uma
      // variável apagada não vai: exemplo a mais é recusa da Meta (132000).
      'corpoExemplos': [
        for (var i = 0; i < n; i++)
          i < corpoExemplos.length ? corpoExemplos[i].trim() : '',
      ],
      if (simples && !ltoAtivo && rodape.trim().isNotEmpty) 'rodape': rodape,
      'botoes': simples ? [for (final b in botoes) b.paraJson()] : const [],
      'cartoes': ehCarrossel
          ? [for (final c in cartoes) c.paraJson()]
          : const [],
      'ltoAtivo': simples && ltoAtivo,
      if (simples && ltoAtivo) 'ltoTexto': ltoTexto,
    };
  }
}

/// Um problema do modelo, já em português, com a parte do formulário:
/// `nome`, `categoria`, `cabecalho`, `corpo`, `rodape`, `botoes`, `lto` ou
/// `cartoes`.
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

  /// Confere as regras da Meta (e a cópia de outro modelo) sem gravar nada.
  /// `id`: o modelo sendo editado — ele não é cópia de si mesmo.
  Future<List<ProblemaModelo>> conferir(DadosModelo dados, {String? id}) async {
    final caminho = id == null
        ? '/modelos/conferir'
        : '/modelos/conferir?id=${Uri.encodeQueryComponent(id)}';
    final r =
        await _api.post(caminho, dados.paraJson()) as Map<String, dynamic>;
    return (r['problemas'] is List ? r['problemas'] as List : const [])
        .whereType<Map<String, dynamic>>()
        .map((p) => ProblemaModelo('${p['campo']}', '${p['mensagem']}'))
        .toList();
  }

  /// Grava um rascunho novo. Nada vai para a Meta ainda. Devolve o id.
  Future<String> criar(DadosModelo dados) async {
    final r =
        await _api.post('/modelos', dados.paraJson()) as Map<String, dynamic>;
    return '${r['id']}';
  }

  /// Salva. Rascunho grava aqui; modelo que já está na Meta vai editado até
  /// ela (o servidor decide). Devolve o status novo, quando a Meta respondeu.
  Future<String?> salvar(String id, DadosModelo dados) async {
    final r =
        await _api.put('/modelos/$id', dados.paraJson())
            as Map<String, dynamic>?;
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
// qualquer envio, e o que ele disser vale.

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

/// As variáveis distintas do texto, em ordem: `[1, 2]` para "{{2}} e {{1}}".
List<int> variaveisDe(String texto) =>
    (RegExp(
        r'\{\{\s*(\d+)\s*\}\}',
      ).allMatches(texto).map((m) => int.parse(m.group(1)!)).toSet().toList()
      ..sort());

/// Variáveis distintas: `{{1}}` repetido ainda é uma só (erro 132000).
int quantasVariaveis(String texto) => variaveisDe(texto).length;
