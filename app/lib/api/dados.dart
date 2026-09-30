/// O que a API devolve, em Dart.
///
/// Espelha os tipos de `frontend/src/lib/tipos.ts`, com a mesma regra de lá:
/// só entra campo que o servidor realmente manda. Campo inventado não quebra
/// nada — só nunca chega preenchido, e a tela mente em silêncio.
///
/// A leitura é tolerante (número pode vir como texto, lista pode faltar): um
/// campo novo ou ausente na API não pode derrubar o app inteiro.
library;

int _int(Object? v) => v is num ? v.toInt() : int.tryParse('${v ?? ''}') ?? 0;
int? _intOuNulo(Object? v) =>
    v == null ? null : (v is num ? v.toInt() : int.tryParse('$v'));
String _txt(Object? v) => v?.toString() ?? '';
String? _txtOuNulo(Object? v) => v?.toString();
DateTime? _data(Object? v) =>
    v == null ? null : DateTime.tryParse(v.toString())?.toLocal();
Map<String, dynamic> _mapa(Object? v) =>
    v is Map<String, dynamic> ? v : <String, dynamic>{};

// --------------------------------------------------------------------- sessão

class UsuarioSessao {
  const UsuarioSessao({
    required this.id,
    required this.nome,
    required this.email,
    required this.papel,
  });

  final String id;
  final String nome;
  final String email;

  /// `dono` ou `operador`.
  final String papel;

  bool get ehDono => papel == 'dono';

  String get primeiroNome => nome.trim().split(RegExp(r'\s+')).first;

  factory UsuarioSessao.deJson(Map<String, dynamic> j) => UsuarioSessao(
    id: _txt(j['id']),
    nome: _txt(j['nome']),
    email: _txt(j['email']),
    papel: _txt(j['papel']),
  );
}

class ContaSessao {
  const ContaSessao({
    required this.id,
    required this.nome,
    required this.status,
  });

  final String id;
  final String nome;
  final String status;

  factory ContaSessao.deJson(Map<String, dynamic> j) => ContaSessao(
    id: _txt(j['id']),
    nome: _txt(j['nome']),
    status: _txt(j['status']),
  );
}

/// `GET /auth/eu`, e o miolo da resposta do login.
class Sessao {
  const Sessao({required this.usuario, required this.conta});

  final UsuarioSessao usuario;
  final ContaSessao conta;

  factory Sessao.deJson(Map<String, dynamic> j) => Sessao(
    usuario: UsuarioSessao.deJson(_mapa(j['usuario'])),
    conta: ContaSessao.deJson(_mapa(j['conta'])),
  );
}

/// A segunda etapa do login: a senha conferiu, falta o código.
class EtapaCodigo {
  const EtapaCodigo({required this.metodo, required this.emailMascarado});

  /// `email` (código chega por e-mail) ou `app` (aplicativo autenticador).
  final String metodo;
  final String emailMascarado;

  bool get porEmail => metodo == 'email';
}

// ---------------------------------------------------------------- conta/plano

class ResumoConta {
  const ResumoConta({
    required this.nomeConta,
    required this.planoNome,
    required this.statusAssinatura,
    required this.cicloFim,
    required this.gratisAte,
    required this.disparos,
    required this.teto,
    required this.restantes,
    this.conversasHabilitadas = false,
  });

  final String nomeConta;
  final String? planoNome;

  /// `cortesia`, `ativa`, `inadimplente` ou `cancelada`.
  final String? statusAssinatura;
  final DateTime? cicloFim;
  final DateTime? gratisAte;
  final int disparos;

  /// Nulo = sem plano, sem teto.
  final int? teto;
  final int? restantes;

  /// Algum número guarda conversas (coexistência + resposta "sim"): a aba
  /// Conversas aparece. As rotas de conversa conferem de novo.
  final bool conversasHabilitadas;

  /// Fração usada do ciclo, de 0 a 1. Sem teto não há fração.
  double? get fracao => (teto == null || teto == 0)
      ? null
      : (disparos / teto!).clamp(0, 1).toDouble();

  factory ResumoConta.deJson(Map<String, dynamic> j) {
    final plano = j['plano'] is Map<String, dynamic>
        ? j['plano'] as Map<String, dynamic>
        : null;
    final assinatura = j['assinatura'] is Map<String, dynamic>
        ? j['assinatura'] as Map<String, dynamic>
        : null;
    final uso = _mapa(j['uso']);
    return ResumoConta(
      nomeConta: _txt(_mapa(j['conta'])['nome']),
      planoNome: _txtOuNulo(plano?['nome']),
      statusAssinatura: _txtOuNulo(assinatura?['status']),
      cicloFim: _data(assinatura?['cicloFim']),
      gratisAte: _data(assinatura?['gratisAte']),
      disparos: _int(uso['disparos']),
      teto: _intOuNulo(uso['teto']),
      restantes: _intOuNulo(uso['restantes']),
      conversasHabilitadas: j['conversasHabilitadas'] == true,
    );
  }
}

// ------------------------------------------------------------------- WhatsApp

class NumeroWhatsapp {
  const NumeroWhatsapp({
    required this.telefone,
    required this.nome,
    required this.qualidade,
    required this.tierLimite,
    required this.status,
    this.phoneNumberId = '',
    this.tierNome,
    this.coexistencia = false,
    this.vazaoMaxima,
    this.sincronizacao,
    this.horasParaSincronizar,
    this.integrarConversas,
  });

  /// O identificador do número na Meta (vai na resposta sobre as conversas).
  final String phoneNumberId;
  final String? telefone;
  final String? nome;

  /// `verde`, `amarela`, `vermelha` ou `desconhecida`.
  final String qualidade;

  /// Pessoas diferentes por 24h. Nulo = ilimitado ou não informado.
  final int? tierLimite;

  /// `TIER_250`, `TIER_2K`… — `TIER_UNLIMITED` é "sem teto".
  final String? tierNome;

  /// `pendente`, `registrado`, `suspenso` ou `removido`.
  final String status;

  /// O mesmo número segue no app WhatsApp Business do celular.
  final bool coexistencia;

  /// Mensagens por segundo: 20 com o app no celular, 80 dedicado.
  final int? vazaoMaxima;

  /// Cópia de contatos e conversas (coexistência): `pendente`,
  /// `sincronizando`, `concluida`, `expirada`, `falhou` ou `nao_se_aplica`
  /// (o `SincronizacaoNumero` do site).
  final String? sincronizacao;

  /// Prazo da Meta para terminar a cópia. Nulo = não há prazo correndo.
  final double? horasParaSincronizar;

  /// Coexistência: trazer os contatos e as conversas do WhatsApp Business?
  /// Nulo = o dono ainda não respondeu (o que chega fica esperando).
  final bool? integrarConversas;

  bool get semTeto => tierNome == 'TIER_UNLIMITED';

  factory NumeroWhatsapp.deJson(Map<String, dynamic> j) => NumeroWhatsapp(
    phoneNumberId: _txt(j['phoneNumberId']),
    tierNome: _txtOuNulo(j['tierNome']),
    integrarConversas: j['integrarConversas'] is bool
        ? j['integrarConversas'] as bool
        : null,
    telefone: _txtOuNulo(j['telefone']),
    nome: _txtOuNulo(j['nome']),
    qualidade: _txt(j['qualidade']).isEmpty
        ? 'desconhecida'
        : _txt(j['qualidade']),
    tierLimite: _intOuNulo(j['tierLimite']),
    status: _txt(j['status']),
    coexistencia: j['coexistencia'] == true,
    vazaoMaxima: _intOuNulo(j['vazaoMaxima']),
    sincronizacao: _txtOuNulo(j['sincronizacao']),
    horasParaSincronizar: j['horasParaSincronizar'] is num
        ? (j['horasParaSincronizar'] as num).toDouble()
        : null,
  );
}

/// `GET /whatsapp/situacao`.
class SituacaoWhatsapp {
  const SituacaoWhatsapp({
    required this.conectado,
    required this.numeros,
    this.contaNome,
    this.wabaId,
    this.moeda,
    this.webhookAssinadoEm,
    this.tokenExpiraEm,
  });

  final bool conectado;
  final List<NumeroWhatsapp> numeros;

  /// O nome da conta do WhatsApp Business na Meta.
  final String? contaNome;
  final String? wabaId;

  /// A moeda em que a Meta cobra a conta.
  final String? moeda;

  /// Nulo = a Meta ainda não confirmou os avisos de entrega (webhook).
  final DateTime? webhookAssinadoEm;

  /// A autorização do Embedded Signup vence (60 dias): o aviso aparece na
  /// última semana.
  final DateTime? tokenExpiraEm;

  /// O número que envia: o registrado, ou o primeiro que houver.
  NumeroWhatsapp? get principal {
    if (numeros.isEmpty) return null;
    return numeros.firstWhere(
      (n) => n.status == 'registrado',
      orElse: () => numeros.first,
    );
  }

  factory SituacaoWhatsapp.deJson(Map<String, dynamic> j) => SituacaoWhatsapp(
    conectado: j['conectado'] == true,
    contaNome: _txtOuNulo(_mapa(j['conta'])['nome']),
    wabaId: _txtOuNulo(_mapa(j['conta'])['wabaId']),
    moeda: _txtOuNulo(_mapa(j['conta'])['moeda']),
    webhookAssinadoEm: _data(_mapa(j['conta'])['webhookAssinadoEm']),
    tokenExpiraEm: _data(_mapa(j['conta'])['tokenExpiraEm']),
    numeros: (j['numeros'] is List ? j['numeros'] as List : const [])
        .whereType<Map<String, dynamic>>()
        .map(NumeroWhatsapp.deJson)
        .toList(),
  );
}

// ------------------------------------------------------------------ campanhas

/// A campanha ativa está esperando — não é pausa: ela continua sozinha.
class EsperaCampanha {
  const EsperaCampanha({required this.motivo, this.ate, this.limite});

  /// `limite_meta`: a conta já alcançou as pessoas que a Meta permite em 24 h;
  /// `ritmo`: a Meta pediu para desacelerar.
  final String motivo;
  final DateTime? ate;

  /// Pessoas diferentes por 24 h, quando o motivo é o limite.
  final int? limite;

  static EsperaCampanha? deJson(Object? v) {
    if (v is! Map<String, dynamic>) return null;
    final motivo = _txt(v['motivo']);
    if (motivo.isEmpty) return null;
    return EsperaCampanha(
      motivo: motivo,
      ate: _data(v['ate']),
      limite: _intOuNulo(v['limite']),
    );
  }
}

class ResumoCampanha {
  const ResumoCampanha({
    required this.id,
    required this.nome,
    required this.modeloNome,
    required this.status,
    required this.pausaMotivo,
    required this.criadoEm,
    required this.porStatus,
    required this.total,
    required this.listaNome,
    this.modeloIdioma,
    this.iniciadaEm,
    this.concluidaEm,
    this.janelaDias = const [],
    this.janelaInicio,
    this.janelaFim,
    this.pausaSegundos = 0,
    this.maxPorDia,
    this.maxPorSemana,
    this.maxPorMes,
    this.modeloCategoria,
    this.modeloId,
    this.listaId,
    this.publicoOrigem,
    this.publicoRotulo,
    this.espera,
    this.respondidas = 0,
    this.descansoDias,
  });

  final String id;
  final String nome;
  final String modeloNome;

  /// A categoria do modelo, traduzida (marketing, utilidade, autenticação).
  final String? modeloCategoria;
  final String? modeloId;
  final String? listaId;

  /// De onde saiu o público (`lista`, `base`, `importacao`, `perfil`,
  /// `publico`, `numeros`…) e o nome dele no cartão ("Pedem à noite").
  final String? publicoOrigem;
  final String? publicoRotulo;

  /// Esperando o limite da Meta ou o ritmo — continua sozinha.
  final EsperaCampanha? espera;

  /// Quantas pessoas responderam à mensagem.
  final int respondidas;

  /// O descanso desta campanha, em dias; nulo = sem descanso.
  final int? descansoDias;

  /// `rascunho`, `agendada`, `enviando`, `pausada`, `concluida` ou `cancelada`.
  final String status;

  /// `conexao`, `teto_plano`, `inadimplencia` ou `manual` — só quando pausada.
  final String? pausaMotivo;
  final DateTime? criadoEm;
  final Map<String, int> porStatus;
  final int total;
  final String? listaNome;
  final String? modeloIdioma;
  final DateTime? iniciadaEm;
  final DateTime? concluidaEm;

  // ---- janela e ritmo (o que a edição reabre)

  /// 0 = domingo … 6 = sábado. Vazio = qualquer dia.
  final List<int> janelaDias;

  /// 'HH:MM:SS' no fuso da conta.
  final String? janelaInicio;
  final String? janelaFim;
  final int pausaSegundos;
  final int? maxPorDia;
  final int? maxPorSemana;
  final int? maxPorMes;

  int get entregues => (porStatus['entregue'] ?? 0) + (porStatus['lida'] ?? 0);
  int get lidas => porStatus['lida'] ?? 0;
  int get falhas => porStatus['falhou'] ?? 0;
  int get enviadas => porStatus['enviada'] ?? 0;
  int get cancelados => porStatus['cancelado'] ?? 0;

  /// Ficaram de fora pelo descanso entre campanhas (não contam no plano).
  int get emDescanso => porStatus['descanso'] ?? 0;

  /// Ainda não saíram: na fila ou saindo agora.
  int get naFila => (porStatus['pendente'] ?? 0) + (porStatus['enviando'] ?? 0);

  /// Quantas já saíram (a Meta aceitou), de qualquer jeito que tenham terminado.
  int get sairam => enviadas + entregues + falhas;

  /// A Meta aceitou — chegando ou não ao aparelho: enviada, entregue ou lida.
  /// É o "Enviadas" da web; falha fica de fora.
  int get aceitas => enviadas + entregues;

  bool get emAndamento => status == 'enviando' || status == 'agendada';

  // ---- o que dá para fazer, pela situação (as mesmas regras do servidor)

  bool get podeDisparar => status == 'rascunho';
  bool get podePausar => status == 'agendada' || status == 'enviando';
  bool get podeRetomar => status == 'pausada';
  bool get podeEditar =>
      status == 'rascunho' || status == 'agendada' || status == 'pausada';

  /// Enviando não se exclui: pausar primeiro garante que ninguém receba uma
  /// campanha "cancelada".
  bool get podeExcluir => status != 'enviando';

  bool get temJanela =>
      janelaDias.isNotEmpty ||
      janelaInicio != null ||
      pausaSegundos > 0 ||
      maxPorDia != null ||
      maxPorSemana != null ||
      maxPorMes != null;

  factory ResumoCampanha.deJson(Map<String, dynamic> j) => ResumoCampanha(
    id: _txt(j['id']),
    nome: _txt(j['nome']),
    modeloNome: _txt(j['modeloNome']),
    status: _txt(j['status']),
    pausaMotivo: _txtOuNulo(j['pausaMotivo']),
    criadoEm: _data(j['criadoEm']),
    porStatus: _mapa(j['porStatus']).map((k, v) => MapEntry(k, _int(v))),
    total: _int(j['total']),
    listaNome: _txtOuNulo(j['listaNome']),
    modeloIdioma: _txtOuNulo(j['modeloIdioma']),
    iniciadaEm: _data(j['iniciadaEm']),
    concluidaEm: _data(j['concluidaEm']),
    janelaDias: (j['janelaDias'] is List ? j['janelaDias'] as List : const [])
        .map(_int)
        .toList(),
    janelaInicio: _txtOuNulo(j['janelaInicio']),
    janelaFim: _txtOuNulo(j['janelaFim']),
    pausaSegundos: _int(j['pausaSegundos']),
    maxPorDia: _intOuNulo(j['maxPorDia']),
    maxPorSemana: _intOuNulo(j['maxPorSemana']),
    maxPorMes: _intOuNulo(j['maxPorMes']),
    modeloCategoria: _txtOuNulo(j['modeloCategoria']),
    modeloId: _txtOuNulo(j['modeloId']),
    listaId: _txtOuNulo(j['listaId']),
    publicoOrigem: _txtOuNulo(j['publicoOrigem']),
    publicoRotulo: _txtOuNulo(j['publicoRotulo']),
    espera: EsperaCampanha.deJson(j['espera']),
    respondidas: _int(j['respondidas']),
    descansoDias: _intOuNulo(j['descansoDias']),
  );
}

/// `GET /campanhas/:id/destinatarios` — no máximo 500, com as falhas primeiro.
class DestinatarioCampanha {
  const DestinatarioCampanha({
    required this.id,
    required this.telefone,
    required this.status,
    this.erroTitulo,
    this.erroDetalhe,
    this.enviadaEm,
    this.entregueEm,
    this.lidaEm,
    this.falhouEm,
  });

  final String id;

  /// E.164 sem o '+': 5521999998888.
  final String telefone;

  /// `pendente`, `enviando`, `enviada`, `entregue`, `lida`, `falhou`,
  /// `cancelado` ou `descanso`.
  final String status;
  final String? erroTitulo;
  final String? erroDetalhe;
  final DateTime? enviadaEm;
  final DateTime? entregueEm;
  final DateTime? lidaEm;
  final DateTime? falhouEm;

  /// O último acontecimento, para mostrar "quando".
  DateTime? get ultimoEm => lidaEm ?? entregueEm ?? falhouEm ?? enviadaEm;

  factory DestinatarioCampanha.deJson(Map<String, dynamic> j) =>
      DestinatarioCampanha(
        id: _txt(j['id']),
        telefone: _txt(j['telefone']),
        status: _txt(j['status']),
        erroTitulo: _txtOuNulo(j['erroTitulo']),
        erroDetalhe: _txtOuNulo(j['erroDetalhe']),
        enviadaEm: _data(j['enviadaEm']),
        entregueEm: _data(j['entregueEm']),
        lidaEm: _data(j['lidaEm']),
        falhouEm: _data(j['falhouEm']),
      );
}
