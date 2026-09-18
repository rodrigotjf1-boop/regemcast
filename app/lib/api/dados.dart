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
  });

  final String? telefone;
  final String? nome;

  /// `verde`, `amarela`, `vermelha` ou `desconhecida`.
  final String qualidade;

  /// Pessoas diferentes por 24h. Nulo = ilimitado ou não informado.
  final int? tierLimite;

  /// `pendente`, `registrado`, `suspenso` ou `removido`.
  final String status;

  factory NumeroWhatsapp.deJson(Map<String, dynamic> j) => NumeroWhatsapp(
    telefone: _txtOuNulo(j['telefone']),
    nome: _txtOuNulo(j['nome']),
    qualidade: _txt(j['qualidade']).isEmpty
        ? 'desconhecida'
        : _txt(j['qualidade']),
    tierLimite: _intOuNulo(j['tierLimite']),
    status: _txt(j['status']),
  );
}

/// `GET /whatsapp/situacao`.
class SituacaoWhatsapp {
  const SituacaoWhatsapp({required this.conectado, required this.numeros});

  final bool conectado;
  final List<NumeroWhatsapp> numeros;

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
    numeros: (j['numeros'] is List ? j['numeros'] as List : const [])
        .whereType<Map<String, dynamic>>()
        .map(NumeroWhatsapp.deJson)
        .toList(),
  );
}

// ------------------------------------------------------------------ campanhas

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
  });

  final String id;
  final String nome;
  final String modeloNome;

  /// `rascunho`, `agendada`, `enviando`, `pausada`, `concluida` ou `cancelada`.
  final String status;

  /// `conexao`, `teto_plano`, `inadimplencia` ou `manual` — só quando pausada.
  final String? pausaMotivo;
  final DateTime? criadoEm;
  final Map<String, int> porStatus;
  final int total;
  final String? listaNome;

  int get entregues => (porStatus['entregue'] ?? 0) + (porStatus['lida'] ?? 0);
  int get lidas => porStatus['lida'] ?? 0;
  int get falhas => porStatus['falhou'] ?? 0;

  /// Quantas já saíram (a Meta aceitou), de qualquer jeito que tenham terminado.
  int get sairam => (porStatus['enviada'] ?? 0) + entregues + falhas;

  bool get emAndamento => status == 'enviando' || status == 'agendada';

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
  );
}
