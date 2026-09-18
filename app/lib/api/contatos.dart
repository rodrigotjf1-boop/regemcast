import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../sessao/sessao.dart';
import 'cliente_api.dart';

String _txt(Object? v) => v?.toString() ?? '';
String? _txtOuNulo(Object? v) => v?.toString();
int _int(Object? v) => v is num ? v.toInt() : int.tryParse('${v ?? ''}') ?? 0;
DateTime? _data(Object? v) =>
    v == null ? null : DateTime.tryParse('$v')?.toLocal();

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
  );
}

class PaginaContatos {
  const PaginaContatos({
    required this.total,
    required this.pagina,
    required this.porPagina,
    required this.itens,
  });

  final int total;
  final int pagina;
  final int porPagina;
  final List<Contato> itens;

  bool get temMais => pagina * porPagina < total;

  factory PaginaContatos.deJson(Map<String, dynamic> j) => PaginaContatos(
    total: _int(j['total']),
    pagina: _int(j['pagina']),
    porPagina: _int(j['porPagina']),
    itens: (j['itens'] is List ? j['itens'] as List : const [])
        .whereType<Map<String, dynamic>>()
        .map(Contato.deJson)
        .toList(),
  );
}

/// Um público: o que a campanha escolhe no site.
class ListaContatos {
  const ListaContatos({
    required this.id,
    required this.nome,
    required this.descricao,
    required this.total,
    required this.criadoEm,
  });

  final String id;
  final String nome;
  final String? descricao;
  final int total;
  final DateTime? criadoEm;

  factory ListaContatos.deJson(Map<String, dynamic> j) => ListaContatos(
    id: _txt(j['id']),
    nome: _txt(j['nome']),
    descricao: _txtOuNulo(j['descricao']),
    total: _int(j['total']),
    criadoEm: _data(j['criadoEm']),
  );
}

/// Uma linha da prévia: já normalizada, ainda não gravada.
class ContatoDaPrevia {
  const ContatoDaPrevia({
    required this.nome,
    required this.telefone,
    required this.novo,
    required this.assumiuPais,
  });

  final String nome;
  final String telefone;

  /// `false` = este número já está na base; a importação não duplica.
  final bool novo;

  /// O número veio sem o 55 e o Brasil foi assumido.
  final bool assumiuPais;

  factory ContatoDaPrevia.deJson(Map<String, dynamic> j) => ContatoDaPrevia(
    nome: _txt(j['nome']),
    telefone: _txt(j['telefone']),
    novo: j['novo'] == true,
    assumiuPais: j['assumiuPais'] == true,
  );
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
    required this.truncado,
    required this.contatos,
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
  final int limite;
  final bool truncado;
  final List<ContatoDaPrevia> contatos;

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
    truncado: j['truncado'] == true,
    contatos: (j['contatos'] is List ? j['contatos'] as List : const [])
        .whereType<Map<String, dynamic>>()
        .map(ContatoDaPrevia.deJson)
        .toList(),
  );
}

class ResultadoImportacao {
  const ResultadoImportacao({required this.gravados, required this.jaExistiam});
  final int gravados;
  final int jaExistiam;
}

// -------------------------------------------------------------- leituras

final listasContatosProvider = FutureProvider.autoDispose<List<ListaContatos>>((
  ref,
) async {
  final dados = await ref.read(clienteApiProvider).get('/contatos/listas');
  return (dados as List)
      .whereType<Map<String, dynamic>>()
      .map(ListaContatos.deJson)
      .toList();
});

final servicoContatosProvider = Provider<ServicoContatos>(
  (ref) => ServicoContatos(ref.read(clienteApiProvider)),
);

class ServicoContatos {
  ServicoContatos(this._api);

  final ClienteApi _api;

  static const porPagina = 50;

  Future<PaginaContatos> pagina(int numero) async => PaginaContatos.deJson(
    await _api.get('/contatos?pagina=$numero&porPagina=$porPagina')
        as Map<String, dynamic>,
  );

  /// Descadastra: a pessoa não recebe mais campanhas desta conta. Não apaga
  /// — apagar deixaria o número voltar numa importação futura.
  Future<void> descadastrar(String id) => _api.delete('/contatos/$id');

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

  /// Grava. Sem o consentimento declarado o servidor recusa — é a condição da
  /// Meta para mensagem iniciada pela empresa.
  Future<ResultadoImportacao> importar({
    required PreviaImportacao previa,
    required bool consentimento,
    String? evidencia,
    String? listaId,
  }) async {
    final r =
        await _api.post('/contatos/importacao', {
              'formato': previa.formato,
              if (previa.arquivoNome != null) 'arquivoNome': previa.arquivoNome,
              'listaId': ?listaId,
              'consentimento': consentimento,
              if (evidencia != null && evidencia.trim().isNotEmpty)
                'evidencia': evidencia.trim(),
              'contatos': [
                for (final c in previa.contatos)
                  {
                    'telefone': c.telefone,
                    if (c.nome.trim().isNotEmpty) 'nome': c.nome,
                  },
              ],
            })
            as Map<String, dynamic>;
    return ResultadoImportacao(
      gravados: _int(r['gravados']),
      jaExistiam: _int(r['jaExistiam']),
    );
  }
}
