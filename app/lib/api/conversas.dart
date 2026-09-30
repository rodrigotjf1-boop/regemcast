import 'dart:async';
import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../sessao/sessao.dart';
import 'cliente_api.dart';

/// As conversas do WhatsApp Business da empresa — o mesmo que a tela do site
/// (`frontend/src/app/(app)/conversas`). Espelha `ConversaResumo` e
/// `MensagemDaConversa` de `backend/src/modules/conversa/conversa.service.ts`.
///
/// Só existem com a coexistência ligada e a resposta "sim" sobre contatos e
/// conversas: sem isso, toda rota responde 404 com a explicação.

String _txt(Object? v) => v?.toString() ?? '';
String? _txtOuNulo(Object? v) => v?.toString();
int _int(Object? v) => v is num ? v.toInt() : int.tryParse('${v ?? ''}') ?? 0;
DateTime? _data(Object? v) =>
    v == null ? null : DateTime.tryParse('$v')?.toLocal();

/// Mensagens por página ao abrir uma conversa (a do servidor).
const mensagensPorPagina = 60;

/// Uma conversa, na lista ou no cabeçalho do chat.
class ConversaResumo {
  const ConversaResumo({
    required this.id,
    required this.telefone,
    required this.nome,
    required this.contatoId,
    required this.optOut,
    required this.naoLidas,
    required this.ultimaMensagem,
    required this.ultimaMensagemEm,
    required this.janelaAteEm,
    this.numero,
  });

  final String id;

  /// E.164 sem o '+'.
  final String telefone;

  /// O nome do contato na base; sem ele, o nome do perfil no WhatsApp.
  final String? nome;

  /// Nulo = a pessoa não está na base.
  final String? contatoId;

  /// Pediu para sair das promoções (continua podendo receber resposta).
  final bool optOut;
  final int naoLidas;
  final String? ultimaMensagem;
  final DateTime? ultimaMensagemEm;

  /// Até quando dá para responder com texto livre. Nulo = janela fechada.
  final DateTime? janelaAteEm;

  /// O número da empresa desta conversa (a conta pode ter mais de um).
  final String? numero;

  bool get janelaAberta => janelaAteEm != null;

  ConversaResumo lida() => ConversaResumo(
    id: id,
    telefone: telefone,
    nome: nome,
    contatoId: contatoId,
    optOut: optOut,
    naoLidas: 0,
    ultimaMensagem: ultimaMensagem,
    ultimaMensagemEm: ultimaMensagemEm,
    janelaAteEm: janelaAteEm,
    numero: numero,
  );

  factory ConversaResumo.deJson(Map<String, dynamic> j) => ConversaResumo(
    id: _txt(j['id']),
    telefone: _txt(j['telefone']),
    nome: _txtOuNulo(j['nome'])?.trim().isEmpty == true
        ? null
        : _txtOuNulo(j['nome']),
    contatoId: _txtOuNulo(j['contatoId']),
    optOut: j['optOut'] == true,
    naoLidas: _int(j['naoLidas']),
    ultimaMensagem: _txtOuNulo(j['ultimaMensagem']),
    ultimaMensagemEm: _data(j['ultimaMensagemEm']),
    janelaAteEm: _data(j['janelaAteEm']),
    numero: _txtOuNulo(j['numero']),
  );
}

/// Uma mensagem da conversa.
class MensagemDaConversa {
  const MensagemDaConversa({
    required this.id,
    required this.direcao,
    required this.origem,
    required this.tipo,
    required this.criadaEm,
    this.texto,
    this.temMidia = false,
    this.midiaMime,
    this.midiaNome,
    this.status,
    this.erroCodigo,
    this.erroTitulo,
    this.enviadaPor,
  });

  final String id;

  /// `entrada` (do cliente) ou `saida` (da empresa).
  final String direcao;

  /// `cliente`, `celular` (respondida no WhatsApp Business), `painel`,
  /// `campanha`…
  final String origem;

  /// `text`, `image`, `video`, `audio`, `document`, `sticker`, `reaction`,
  /// `location`, `contacts`, `system`, `media_placeholder`…
  final String tipo;
  final String? texto;

  /// A mídia ainda pode ser buscada na Meta.
  final bool temMidia;
  final String? midiaMime;
  final String? midiaNome;

  /// `enviando`, `enviada`, `entregue`, `lida` ou `falhou` (só saída).
  final String? status;
  final int? erroCodigo;
  final String? erroTitulo;

  /// Quem respondeu pelo painel ou pelo app.
  final String? enviadaPor;
  final DateTime criadaEm;

  bool get saida => direcao == 'saida';

  /// A ordem do servidor: pela data, e o id desempata.
  String get chave => '${criadaEm.toUtc().toIso8601String()}|$id';

  factory MensagemDaConversa.deJson(Map<String, dynamic> j) =>
      MensagemDaConversa(
        id: _txt(j['id']),
        direcao: _txt(j['direcao']),
        origem: _txt(j['origem']),
        tipo: _txt(j['tipo']),
        texto: _txtOuNulo(j['texto']),
        temMidia: j['temMidia'] == true,
        midiaMime: _txtOuNulo(j['midiaMime']),
        midiaNome: _txtOuNulo(j['midiaNome']),
        status: _txtOuNulo(j['status']),
        erroCodigo: j['erroCodigo'] is num
            ? (j['erroCodigo'] as num).toInt()
            : null,
        erroTitulo: _txtOuNulo(j['erroTitulo']),
        enviadaPor: _txtOuNulo(j['enviadaPor']),
        criadaEm: _data(j['criadaEm']) ?? DateTime.now(),
      );
}

/// Junta a página mais recente com o que já estava carregado (as páginas
/// anteriores) — como o `mesclar` do site: o que é mais antigo que a página
/// nova fica; o resto vem da página nova, que tem o status atualizado.
List<MensagemDaConversa> mesclarMensagens(
  List<MensagemDaConversa> atuais,
  List<MensagemDaConversa> recentes,
) {
  if (recentes.isEmpty) return atuais;
  final ids = {for (final m in recentes) m.id};
  final inicio = recentes.first.criadaEm;
  return [
    for (final m in atuais)
      if (m.criadaEm.isBefore(inicio) && !ids.contains(m.id)) m,
    ...recentes,
  ];
}

// -------------------------------------------------------------- leituras

/// Os bytes de uma mídia da conversa, buscados na Meta pelo servidor na
/// hora. Ficam cinco minutos na memória depois de sair da tela: rolar a
/// conversa para cima e voltar não baixa de novo.
final bytesDaMidiaDaConversaProvider = FutureProvider.autoDispose
    .family<Uint8List, (String, String)>((ref, ids) async {
      final (conversaId, mensagemId) = ids;
      final bytes = await ref
          .read(clienteApiProvider)
          .baixar('/conversas/$conversaId/mensagens/$mensagemId/midia');
      final vinculo = ref.keepAlive();
      final prazo = Timer(const Duration(minutes: 5), vinculo.close);
      ref.onDispose(prazo.cancel);
      return bytes;
    });

final servicoConversasProvider = Provider<ServicoConversas>(
  (ref) => ServicoConversas(ref.read(clienteApiProvider)),
);

class ServicoConversas {
  ServicoConversas(this._api);

  final ClienteApi _api;

  /// As conversas da conta, a mais recente primeiro (até 100). A busca por
  /// nome ou telefone alcança as que ficam de fora.
  Future<List<ConversaResumo>> listar([String busca = '']) async {
    final termo = busca.trim();
    final dados = await _api.get(
      '/conversas${termo.isEmpty ? '' : '?busca=${Uri.encodeQueryComponent(termo)}'}',
    );
    return (dados is List ? dados : const [])
        .whereType<Map<String, dynamic>>()
        .map(ConversaResumo.deJson)
        .toList();
  }

  Future<ConversaResumo> detalhe(String id) async => ConversaResumo.deJson(
    await _api.get('/conversas/$id') as Map<String, dynamic>,
  );

  /// Uma página de mensagens, da mais antiga para a mais nova. `antesDe` pede
  /// a página anterior (rolar para cima).
  Future<List<MensagemDaConversa>> mensagens(
    String id, {
    DateTime? antesDe,
  }) async {
    final dados = await _api.get(
      '/conversas/$id/mensagens${antesDe == null ? '' : '?antesDe=${Uri.encodeQueryComponent(antesDe.toUtc().toIso8601String())}'}',
    );
    return (dados is List ? dados : const [])
        .whereType<Map<String, dynamic>>()
        .map(MensagemDaConversa.deJson)
        .toList();
  }

  /// Abriu a conversa: zera as não lidas.
  Future<void> marcarLida(String id) => _api.post('/conversas/$id/lida');

  /// Responde com texto livre — só dentro da janela de 24 horas; fora dela o
  /// servidor recusa com a explicação.
  Future<MensagemDaConversa> responder(String id, String texto) async =>
      MensagemDaConversa.deJson(
        await _api.post('/conversas/$id/mensagens', {'texto': texto})
            as Map<String, dynamic>,
      );

  /// Por quantos dias as mensagens ficam guardadas. 0 = tudo.
  Future<int> guarda() async {
    final r = await _api.get('/conversas/config') as Map<String, dynamic>;
    return _int(r['retencaoDias']);
  }

  /// Só o dono.
  Future<void> salvarGuarda(int dias) =>
      _api.patch('/conversas/config', {'retencaoDias': dias});

  /// O caminho da mídia, para o reprodutor de áudio e vídeo.
  static String caminhoDaMidia(String conversaId, String mensagemId) =>
      '/conversas/$conversaId/mensagens/$mensagemId/midia';
}
