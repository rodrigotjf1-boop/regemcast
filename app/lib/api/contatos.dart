import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../sessao/sessao.dart';
import 'cliente_api.dart';
import 'publicos.dart';

/// A base de contatos, dos dois lados: quem pode receber (com o que se sabe
/// das compras de cada um) e quem saiu. Espelha `frontend/src/lib/tipos.ts`.

String _txt(Object? v) => v?.toString() ?? '';
String? _txtOuNulo(Object? v) => v?.toString();
int _int(Object? v) => v is num ? v.toInt() : int.tryParse('${v ?? ''}') ?? 0;
int? _intOuNulo(Object? v) =>
    v == null ? null : (v is num ? v.toInt() : int.tryParse('$v'));
DateTime? _data(Object? v) =>
    v == null ? null : DateTime.tryParse('$v')?.toLocal();
List<Map<String, dynamic>> _lista(Object? v) =>
    (v is List ? v : const []).whereType<Map<String, dynamic>>().toList();

/// Uma pessoa da base.
class Contato {
  const Contato({
    required this.id,
    required this.nome,
    required this.telefone,
    required this.optOut,
    required this.consentimentoOrigem,
    required this.consentimentoEm,
    required this.criadoEm,
    this.email,
    this.dataNascimento,
    this.pedidos,
    this.totalGastoCentavos,
    this.ultimoPedidoEm,
    this.semWhatsappEm,
    this.bairro,
    this.periodoPreferido,
    this.produtoFavorito,
    this.segmento,
    this.optOutEm,
    this.optOutOrigem,
    this.cashbackCentavos,
    this.cashbackVenceEm,
    this.cashbackValido = false,
  });

  final String id;
  final String? nome;

  /// E.164 sem o '+'.
  final String telefone;

  /// Pediu para sair: não recebe mais nenhuma campanha desta conta.
  final bool optOut;
  final String? consentimentoOrigem;
  final DateTime? consentimentoEm;
  final DateTime? criadoEm;
  final String? email;
  final String? dataNascimento;
  final int? pedidos;
  final int? totalGastoCentavos;
  final DateTime? ultimoPedidoEm;

  /// A Meta recusou o número em duas campanhas: saiu dos envios sozinho.
  final DateTime? semWhatsappEm;
  final String? bairro;

  /// `cafe`, `almoco`, `tarde`, `noite` ou `madrugada`.
  final String? periodoPreferido;
  final String? produtoFavorito;

  /// O perfil (Campeões, Em risco…), pelas compras.
  final String? segmento;
  final DateTime? optOutEm;

  /// Por onde saiu: `botao_modelo`, `preferencia_whatsapp`, `mensagem`…
  final String? optOutOrigem;
  final int? cashbackCentavos;

  /// `AAAA-MM-DD`: o dia em que o saldo vence (no fuso da conta).
  final String? cashbackVenceEm;
  final bool cashbackValido;

  /// Tem saldo de cashback lido do Cardápio Web (e pode receber).
  bool get temCashback => !optOut && (cashbackCentavos ?? 0) > 0;

  Contato descadastrado() => Contato(
    id: id,
    nome: nome,
    telefone: telefone,
    optOut: true,
    consentimentoOrigem: consentimentoOrigem,
    consentimentoEm: consentimentoEm,
    criadoEm: criadoEm,
    email: email,
    dataNascimento: dataNascimento,
    pedidos: pedidos,
    totalGastoCentavos: totalGastoCentavos,
    ultimoPedidoEm: ultimoPedidoEm,
    semWhatsappEm: semWhatsappEm,
    bairro: bairro,
    periodoPreferido: periodoPreferido,
    produtoFavorito: produtoFavorito,
    segmento: segmento,
    optOutEm: DateTime.now(),
    optOutOrigem: 'painel',
    cashbackCentavos: cashbackCentavos,
    cashbackVenceEm: cashbackVenceEm,
    cashbackValido: cashbackValido,
  );

  factory Contato.deJson(Map<String, dynamic> j) => Contato(
    id: _txt(j['id']),
    nome: _txtOuNulo(j['nome'])?.trim().isEmpty == true
        ? null
        : _txtOuNulo(j['nome']),
    telefone: _txt(j['telefone']),
    optOut: j['optOut'] == true,
    consentimentoOrigem: _txtOuNulo(j['consentimentoOrigem']),
    consentimentoEm: _data(j['consentimentoEm']),
    criadoEm: _data(j['criadoEm']),
    email: _txtOuNulo(j['email']),
    dataNascimento: _txtOuNulo(j['dataNascimento']),
    pedidos: _intOuNulo(j['pedidos']),
    totalGastoCentavos: _intOuNulo(j['totalGastoCentavos']),
    ultimoPedidoEm: _data(j['ultimoPedidoEm']),
    semWhatsappEm: _data(j['semWhatsappEm']),
    bairro: _txtOuNulo(j['bairro']),
    periodoPreferido: _txtOuNulo(j['periodoPreferido']),
    produtoFavorito: _txtOuNulo(j['produtoFavorito']),
    segmento: _txtOuNulo(j['segmento']),
    optOutEm: _data(j['optOutEm']),
    optOutOrigem: _txtOuNulo(j['optOutOrigem']),
    cashbackCentavos: _intOuNulo(j['cashbackCentavos']),
    cashbackVenceEm: _txtOuNulo(j['cashbackVenceEm']),
    cashbackValido: j['cashbackValido'] == true,
  );
}

class PaginaContatos {
  const PaginaContatos({
    required this.total,
    required this.pagina,
    required this.porPagina,
    required this.itens,
    this.cashbackLido = false,
  });

  final int total;
  final int pagina;
  final int porPagina;
  final List<Contato> itens;

  /// A conta tem saldo de cashback lido do Cardápio Web: as variáveis de
  /// cashback aparecem na campanha.
  final bool cashbackLido;

  bool get temMais => pagina * porPagina < total;

  factory PaginaContatos.deJson(Map<String, dynamic> j) => PaginaContatos(
    total: _int(j['total']),
    pagina: _int(j['pagina']),
    porPagina: _int(j['porPagina']),
    itens: _lista(j['itens']).map(Contato.deJson).toList(),
    cashbackLido: j['cashbackLido'] == true,
  );
}

/// O filtro da lista de contatos: um perfil, um estado (pelo DDD) ou um
/// público pronto — um de cada vez, como no site.
class FiltroDeContatos {
  const FiltroDeContatos.perfil(String this.segmento, this.rotulo, {this.total})
    : uf = null,
      publico = null,
      valor = null,
      detalhe = null;
  const FiltroDeContatos.regiao(
    String this.uf,
    this.rotulo, {
    this.total,
    this.detalhe,
  }) : segmento = null,
       publico = null,
       valor = null;
  const FiltroDeContatos.publico(
    String this.publico,
    this.valor,
    this.rotulo, {
    this.total,
  }) : segmento = null,
       uf = null,
       detalhe = null;

  final String? segmento;
  final String? uf;
  final String? publico;

  /// O bairro, o mês (1 a 12) ou o produto, quando o público pede.
  final String? valor;

  /// "Campeões", "Rio de Janeiro", "Já compraram Smash duplo"…
  final String rotulo;

  /// Quantos há, pelo cartão que foi tocado (antes da lista chegar).
  final int? total;

  /// Da região: os DDDs ("21 Rio de Janeiro, 24 Volta Redonda").
  final String? detalhe;

  /// Perfis e públicos viram lista; região só se divide em blocos.
  bool get viraLista => segmento != null || publico != null;

  String get consulta => segmento != null
      ? '&segmento=${Uri.encodeQueryComponent(segmento!)}'
      : uf != null
      ? '&uf=${Uri.encodeQueryComponent(uf!)}'
      : '&publico=${Uri.encodeQueryComponent(publico!)}${valor != null ? '&valor=${Uri.encodeQueryComponent(valor!)}' : ''}';

  /// O mesmo filtro, para dividir em blocos.
  AlvoDaDivisao alvo(int? total) => segmento != null
      ? AlvoDaDivisao(
          origem: 'perfil',
          segmento: segmento,
          rotulo: rotulo,
          total: total,
        )
      : uf != null
      ? AlvoDaDivisao(origem: 'regiao', uf: uf, rotulo: rotulo, total: total)
      : AlvoDaDivisao(
          origem: 'publico',
          publico: publico,
          publicoValor: valor,
          rotulo: rotulo,
          total: total,
        );

  @override
  bool operator ==(Object other) =>
      other is FiltroDeContatos &&
      other.segmento == segmento &&
      other.uf == uf &&
      other.publico == publico &&
      other.valor == valor;

  @override
  int get hashCode => Object.hash(segmento, uf, publico, valor);
}

/// Uma lista de contatos — ou um bloco de uma divisão da base.
class ListaContatos {
  const ListaContatos({
    required this.id,
    required this.nome,
    required this.descricao,
    required this.total,
    required this.criadoEm,
    this.divisaoId,
    this.divisaoNome,
    this.bloco,
    this.blocos,
    this.usadaEm,
  });

  final String id;
  final String nome;
  final String? descricao;

  /// Quem pode receber (sem quem pediu para sair).
  final int total;
  final DateTime? criadoEm;

  /// Quando a lista é um bloco: a divisão, a posição e quantos blocos ela tem.
  final String? divisaoId;
  final String? divisaoNome;
  final int? bloco;
  final int? blocos;

  /// Última vez que uma campanha usou esta lista.
  final DateTime? usadaEm;

  bool get ehBloco => divisaoId != null;

  factory ListaContatos.deJson(Map<String, dynamic> j) => ListaContatos(
    id: _txt(j['id']),
    nome: _txt(j['nome']),
    descricao: _txtOuNulo(j['descricao']),
    total: _int(j['total']),
    criadoEm: _data(j['criadoEm']),
    divisaoId: _txtOuNulo(j['divisaoId']),
    divisaoNome: _txtOuNulo(j['divisaoNome']),
    bloco: j['bloco'] is num ? (j['bloco'] as num).toInt() : null,
    blocos: j['blocos'] is num ? (j['blocos'] as num).toInt() : null,
    usadaEm: _data(j['usadaEm']),
  );
}

// ------------------------------------------------------------ importação

/// Uma linha da prévia: já normalizada, ainda não gravada — com o que a
/// planilha trouxe além de nome e telefone.
class ContatoDaPrevia {
  const ContatoDaPrevia({
    required this.nome,
    required this.telefone,
    required this.novo,
    required this.assumiuPais,
    this.email,
    this.dataNascimento,
    this.pedidos,
    this.totalGastoCentavos,
    this.ultimoPedidoEm,
  });

  final String nome;
  final String telefone;

  /// `false` = este número já está na base; a importação não duplica.
  final bool novo;

  /// O número veio sem o 55 e o Brasil foi assumido.
  final bool assumiuPais;
  final String? email;

  /// `AAAA-MM-DD`
  final String? dataNascimento;
  final int? pedidos;
  final int? totalGastoCentavos;

  /// ISO 8601, como o servidor mandou (vai de volta igual).
  final String? ultimoPedidoEm;

  factory ContatoDaPrevia.deJson(Map<String, dynamic> j) => ContatoDaPrevia(
    nome: _txt(j['nome']),
    telefone: _txt(j['telefone']),
    novo: j['novo'] == true,
    assumiuPais: j['assumiuPais'] == true,
    email: _txtOuNulo(j['email']),
    dataNascimento: _txtOuNulo(j['dataNascimento']),
    pedidos: _intOuNulo(j['pedidos']),
    totalGastoCentavos: _intOuNulo(j['totalGastoCentavos']),
    ultimoPedidoEm: _txtOuNulo(j['ultimoPedidoEm']),
  );

  /// O corpo de `POST /contatos/importacao` para esta linha: tudo que a
  /// planilha trouxe, como o site manda (ERR-024: o app mandava só telefone e
  /// nome, e importar pelo celular perdia o histórico de compra).
  Map<String, Object?> paraJson() => {
    'telefone': telefone,
    if (nome.trim().isNotEmpty) 'nome': nome,
    'email': ?email,
    'dataNascimento': ?dataNascimento,
    'pedidos': ?pedidos,
    'totalGastoCentavos': ?totalGastoCentavos,
    'ultimoPedidoEm': ?ultimoPedidoEm,
  };
}

/// O que o arquivo tinha, antes de gravar qualquer coisa.
class PreviaImportacao {
  const PreviaImportacao({
    required this.formato,
    required this.arquivoNome,
    required this.totalLidos,
    required this.validos,
    required this.invalidos,
    required this.novos,
    required this.jaExistem,
    required this.assumiramPais,
    required this.limite,
    required this.porEnvio,
    required this.truncado,
    required this.contatos,
    this.extras = const [],
  });

  /// `vcard`, `csv`, `xlsx` ou `texto`.
  final String formato;
  final String? arquivoNome;
  final int totalLidos;
  final int validos;
  final int invalidos;
  final int novos;
  final int jaExistem;
  final int assumiramPais;

  /// Teto do arquivo.
  final int limite;

  /// Quantos cabem por envio: a tela grava em blocos deste tamanho.
  final int porEnvio;
  final bool truncado;
  final List<ContatoDaPrevia> contatos;

  /// Colunas extras encontradas: "e-mail", "aniversário", "pedidos"…
  final List<String> extras;

  /// Só nome e número, sem pedidos: o caso do arquivo exportado do celular.
  bool get soNomeENumero => extras.isEmpty;

  factory PreviaImportacao.deJson(Map<String, dynamic> j) => PreviaImportacao(
    formato: _txt(j['formato']),
    arquivoNome: _txtOuNulo(j['arquivoNome']),
    totalLidos: _int(j['totalLidos']),
    validos: _int(j['validos']),
    invalidos: _int(j['invalidos']),
    novos: _int(j['novos']),
    jaExistem: _int(j['jaExistem']),
    assumiramPais: _int(j['assumiramPais']),
    limite: _int(j['limite']),
    porEnvio: _int(j['porEnvio']) > 0 ? _int(j['porEnvio']) : 5000,
    truncado: j['truncado'] == true,
    extras: (j['extras'] is List ? j['extras'] as List : const [])
        .map((e) => '$e')
        .toList(),
    contatos: _lista(j['contatos']).map(ContatoDaPrevia.deJson).toList(),
  );
}

class ResultadoImportacao {
  const ResultadoImportacao({
    required this.gravados,
    required this.jaExistiam,
    this.importacaoId,
  });
  final int gravados;
  final int jaExistiam;

  /// O registro da importação: é por ele que se divide em blocos depois.
  final String? importacaoId;
}

// ------------------------------------------------------------------ blocos

/// Uma campanha que usou o bloco, com o resultado dela.
class UsoDoBloco {
  const UsoDoBloco({
    required this.campanhaId,
    required this.campanhaNome,
    required this.em,
    required this.total,
    required this.entregues,
    required this.lidas,
    required this.falhas,
    required this.sairam,
  });

  final String campanhaId;
  final String campanhaNome;
  final DateTime? em;
  final int total;
  final int entregues;
  final int lidas;
  final int falhas;
  final int sairam;

  factory UsoDoBloco.deJson(Map<String, dynamic> j) => UsoDoBloco(
    campanhaId: _txt(j['campanhaId']),
    campanhaNome: _txt(j['campanhaNome']),
    em: _data(j['em']),
    total: _int(j['total']),
    entregues: _int(j['entregues']),
    lidas: _int(j['lidas']),
    falhas: _int(j['falhas']),
    sairam: _int(j['sairam']),
  );
}

class BlocoDaDivisao {
  const BlocoDaDivisao({
    required this.id,
    required this.bloco,
    required this.total,
    required this.usos,
  });

  final String id;
  final int bloco;
  final int total;
  final List<UsoDoBloco> usos;

  factory BlocoDaDivisao.deJson(Map<String, dynamic> j) => BlocoDaDivisao(
    id: _txt(j['id']),
    bloco: _int(j['bloco']),
    total: _int(j['total']),
    usos: _lista(j['usos']).map(UsoDoBloco.deJson).toList(),
  );
}

/// `GET /contatos/divisoes`: cada divisão em blocos, com o resultado de cada
/// bloco já enviado.
class DivisaoDeBlocos {
  const DivisaoDeBlocos({
    required this.id,
    required this.nome,
    required this.tamanho,
    required this.ordem,
    required this.soNuncaReceberam,
    required this.totalContatos,
    required this.totalBlocos,
    required this.blocos,
  });

  final String id;
  final String nome;
  final int tamanho;

  /// `importacao`, `sorteio`, `recentes`, `regiao` ou `valor`.
  final String ordem;
  final bool soNuncaReceberam;
  final int totalContatos;
  final int totalBlocos;
  final List<BlocoDaDivisao> blocos;

  /// Algum bloco já foi para uma campanha: a divisão não se apaga mais.
  bool get usada => blocos.any((b) => b.usos.isNotEmpty);

  /// O próximo bloco com gente que nenhuma campanha usou.
  String? get proximo {
    for (final b in blocos) {
      if (b.usos.isEmpty && b.total > 0) return b.id;
    }
    return null;
  }

  factory DivisaoDeBlocos.deJson(Map<String, dynamic> j) => DivisaoDeBlocos(
    id: _txt(j['id']),
    nome: _txt(j['nome']),
    tamanho: _int(j['tamanho']),
    ordem: _txt(j['ordem']),
    soNuncaReceberam: j['soNuncaReceberam'] == true,
    totalContatos: _int(j['totalContatos']),
    totalBlocos: _int(j['totalBlocos']),
    blocos: _lista(j['blocos']).map(BlocoDaDivisao.deJson).toList(),
  );
}

/// `GET /contatos/divisoes/opcoes`: os tamanhos liberados hoje, pelo limite
/// de envio que a Meta dá ao número.
class OpcoesDeBloco {
  const OpcoesDeBloco({
    required this.limite,
    required this.limiteConhecido,
    required this.maximo,
    required this.tamanhos,
    required this.sugerido,
  });

  /// Pessoas diferentes por dia; nulo = sem teto.
  final int? limite;
  final bool limiteConhecido;
  final int maximo;
  final List<({int valor, bool disponivel})> tamanhos;
  final int sugerido;

  factory OpcoesDeBloco.deJson(Map<String, dynamic> j) => OpcoesDeBloco(
    limite: _intOuNulo(j['limite']),
    limiteConhecido: j['limiteConhecido'] == true,
    maximo: _int(j['maximo']),
    tamanhos: [
      for (final t in _lista(j['tamanhos']))
        (valor: _int(t['valor']), disponivel: t['disponivel'] == true),
    ],
    sugerido: _int(j['sugerido']),
  );
}

/// O que vai ser dividido: a base, uma lista, uma importação, um perfil, um
/// estado ou um público pronto.
class AlvoDaDivisao {
  const AlvoDaDivisao({
    required this.origem,
    required this.rotulo,
    this.origemId,
    this.segmento,
    this.uf,
    this.publico,
    this.publicoValor,
    this.total,
    this.soNomeENumero = false,
  });

  final String origem;
  final String rotulo;
  final String? origemId;
  final String? segmento;
  final String? uf;
  final String? publico;
  final String? publicoValor;

  /// Quantos podem receber, quando a tela já sabe.
  final int? total;

  /// Lista só com nome e número: o caso do arquivo exportado do celular.
  final bool soNomeENumero;

  Map<String, Object?> pedido({
    required int tamanho,
    required String ordem,
    required bool soNuncaReceberam,
  }) => {
    'origem': origem,
    'origemId': ?origemId,
    'segmento': ?segmento,
    'uf': ?uf,
    'publico': ?publico,
    if (publicoValor != null && publicoValor!.isNotEmpty)
      'publicoValor': publicoValor,
    'tamanho': tamanho,
    'ordem': ordem,
    if (soNuncaReceberam) 'soNuncaReceberam': true,
  };
}

// ----------------------------------------------------------------- regiões

/// `GET /contatos/regioes`: a base por estado, pelo DDD.
class RegioesDaBase {
  const RegioesDaBase({required this.regioes, required this.semRegiao});

  final List<
    ({
      String uf,
      String estado,
      int total,
      List<({String ddd, String cidade, int total})> ddds,
    })
  >
  regioes;

  /// Fora do Brasil ou sem DDD.
  final int semRegiao;

  /// Quem pode receber: a soma das regiões já conta só os ativos.
  int get total => regioes.fold(semRegiao, (t, r) => t + r.total);

  factory RegioesDaBase.deJson(Map<String, dynamic> j) => RegioesDaBase(
    regioes: [
      for (final r in _lista(j['regioes']))
        (
          uf: _txt(r['uf']),
          estado: _txt(r['estado']),
          total: _int(r['total']),
          ddds: [
            for (final d in _lista(r['ddds']))
              (
                ddd: _txt(d['ddd']),
                cidade: _txt(d['cidade']),
                total: _int(d['total']),
              ),
          ],
        ),
    ],
    semRegiao: _int(j['semRegiao']),
  );
}

// -------------------------------------------------------------- leituras

final listasContatosProvider = FutureProvider.autoDispose<List<ListaContatos>>((
  ref,
) async {
  final dados = await ref.read(clienteApiProvider).get('/contatos/listas');
  return _lista(dados).map(ListaContatos.deJson).toList();
});

final divisoesProvider = FutureProvider.autoDispose<List<DivisaoDeBlocos>>((
  ref,
) async {
  final dados = await ref.read(clienteApiProvider).get('/contatos/divisoes');
  return _lista(dados).map(DivisaoDeBlocos.deJson).toList();
});

final regioesProvider = FutureProvider.autoDispose<RegioesDaBase>((ref) async {
  final dados = await ref.read(clienteApiProvider).get('/contatos/regioes');
  return RegioesDaBase.deJson(
    dados is Map<String, dynamic> ? dados : <String, dynamic>{},
  );
});

/// Quantos contatos a base tem — o "Contatos" do Painel, como no site: uma
/// página de um só, para ler o total.
final totalContatosProvider = FutureProvider.autoDispose<int>((ref) async {
  final pagina = await ref.read(servicoContatosProvider).pagina(1, tamanho: 1);
  return pagina.total;
});

final opcoesDeBlocoProvider = FutureProvider.autoDispose<OpcoesDeBloco>((
  ref,
) async {
  final dados = await ref
      .read(clienteApiProvider)
      .get('/contatos/divisoes/opcoes');
  return OpcoesDeBloco.deJson(
    dados is Map<String, dynamic> ? dados : <String, dynamic>{},
  );
});

final servicoContatosProvider = Provider<ServicoContatos>(
  (ref) => ServicoContatos(ref.read(clienteApiProvider)),
);

class ServicoContatos {
  ServicoContatos(this._api);

  final ClienteApi _api;

  static const porPagina = 50;

  /// Uma página da base — com filtro (perfil, estado ou público) ou numa
  /// situação (`bloqueados`, `sem_whatsapp`).
  Future<PaginaContatos> pagina(
    int numero, {
    FiltroDeContatos? filtro,
    String? situacao,
    int tamanho = porPagina,
  }) async => PaginaContatos.deJson(
    await _api.get(
          '/contatos?pagina=$numero&porPagina=$tamanho${filtro?.consulta ?? ''}${situacao != null ? '&situacao=$situacao' : ''}',
        )
        as Map<String, dynamic>,
  );

  /// Descadastra: a pessoa não recebe mais campanhas desta conta. Não apaga
  /// — apagar deixaria o número voltar numa importação futura.
  Future<void> descadastrar(String id) => _api.delete('/contatos/$id');

  /// Volta à base quem PEDIU para voltar; a justificativa fica gravada.
  Future<void> reativar(String id, String justificativa) =>
      _api.post('/contatos/$id/reativar', {'justificativa': justificativa});

  /// Apaga os dados pessoais e mantém o número bloqueado.
  Future<void> anonimizar(String id) => _api.post('/contatos/$id/anonimizar');

  /// Apaga tudo, inclusive o número (pode voltar numa importação futura).
  Future<void> apagar(String id) => _api.delete('/contatos/$id/permanente');

  /// Número sem WhatsApp volta aos envios.
  Future<void> tentarWhatsappDeNovo(String id) =>
      _api.post('/contatos/$id/tentar-whatsapp');

  Future<PreviaImportacao> previaDeArquivo(
    List<int> bytes,
    String nomeArquivo,
  ) async => PreviaImportacao.deJson(
    await _api.enviarArquivo(
          '/contatos/importacao/arquivo',
          campo: 'arquivo',
          bytes: bytes,
          nomeArquivo: nomeArquivo,
        )
        as Map<String, dynamic>,
  );

  Future<PreviaImportacao> previaDeTexto(String texto) async =>
      PreviaImportacao.deJson(
        await _api.post('/contatos/importacao/texto', {'texto': texto})
            as Map<String, dynamic>,
      );

  Future<String> criarLista(String nome) async {
    final r =
        await _api.post('/contatos/listas', {'nome': nome.trim()})
            as Map<String, dynamic>;
    return '${r['id']}';
  }

  /// Os quatro números da classificação — do dono: mudam os perfis da base
  /// inteira na hora.
  Future<void> salvarParametros(ParametrosSegmentacao p) =>
      _api.put('/contatos/segmentos/parametros', p.paraJson());

  /// A foto de um perfil numa lista, para a campanha usar.
  Future<({String nome, int total})> criarListaDoPerfil(String segmento) async {
    final r =
        await _api.post('/contatos/segmentos/$segmento/lista', const {})
            as Map<String, dynamic>;
    return (nome: _txt(r['nome']), total: _int(r['total']));
  }

  /// A foto de um público pronto numa lista.
  Future<({String nome, int total})> criarListaDoPublico(
    String publico,
    String? valor,
  ) async {
    final r =
        await _api.post('/contatos/publicos/lista', {
              'publico': publico,
              'valor': ?valor,
            })
            as Map<String, dynamic>;
    return (nome: _txt(r['nome']), total: _int(r['total']));
  }

  /// Põe a pessoa de uma conversa numa lista — o substituto das etiquetas do
  /// WhatsApp Business, que a Meta não sincroniza.
  Future<({bool jaEstava, String lista})> adicionarNaLista(
    String contatoId,
    String listaId,
  ) async {
    final r =
        await _api.post('/contatos/$contatoId/listas', {'listaId': listaId})
            as Map<String, dynamic>;
    return (jaEstava: r['jaEstava'] == true, lista: _txt(r['lista']));
  }

  /// Divide em blocos; cada bloco vira uma lista.
  Future<DivisaoDeBlocos> dividir(Map<String, Object?> pedido) async =>
      DivisaoDeBlocos.deJson(
        await _api.post('/contatos/divisoes', pedido) as Map<String, dynamic>,
      );

  /// Só a divisão que nenhuma campanha usou (e só o dono).
  Future<void> apagarDivisao(String id) =>
      _api.delete('/contatos/divisoes/$id');

  /// Grava. Sem o consentimento declarado o servidor recusa — é a condição da
  /// Meta para mensagem iniciada pela empresa.
  /// Arquivo grande vai em blocos: o corpo de uma requisição não comporta
  /// dezenas de milhares de contatos. O primeiro bloco cria o registro da
  /// importação; os seguintes somam nele, e o histórico tem uma linha só.
  Future<ResultadoImportacao> importar({
    required PreviaImportacao previa,
    required bool consentimento,
    String? evidencia,
    String? listaId,
    void Function(int feitos, int total)? aoAndar,
  }) async {
    final total = previa.contatos.length;
    final porEnvio = previa.porEnvio.clamp(1, 5000);
    String? importacaoId;
    var gravados = 0;
    var jaExistiam = 0;

    for (var i = 0; i < total; i += porEnvio) {
      aoAndar?.call(i, total);
      final bloco = previa.contatos.sublist(
        i,
        i + porEnvio > total ? total : i + porEnvio,
      );
      final r =
          await _api.post('/contatos/importacao', {
                'formato': previa.formato,
                if (previa.arquivoNome != null)
                  'arquivoNome': previa.arquivoNome,
                'listaId': ?listaId,
                'importacaoId': ?importacaoId,
                'consentimento': consentimento,
                if (evidencia != null && evidencia.trim().isNotEmpty)
                  'evidencia': evidencia.trim(),
                'contatos': [for (final c in bloco) c.paraJson()],
              })
              as Map<String, dynamic>;
      importacaoId = _txtOuNulo(r['importacaoId']) ?? importacaoId;
      gravados += _int(r['gravados']);
      jaExistiam += _int(r['jaExistiam']);
    }
    return ResultadoImportacao(
      gravados: gravados,
      jaExistiam: jaExistiam,
      importacaoId: importacaoId,
    );
  }
}
