import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../sessao/sessao.dart';
import 'cliente_api.dart';

String _txt(Object? v) => v?.toString() ?? '';
String? _txtOuNulo(Object? v) => v?.toString();
int _int(Object? v) => v is num ? v.toInt() : int.tryParse('${v ?? ''}') ?? 0;
int? _intOuNulo(Object? v) => v == null ? null : _int(v);
DateTime? _data(Object? v) =>
    v == null ? null : DateTime.tryParse('$v')?.toLocal();
Map<String, dynamic> _mapa(Object? v) =>
    v is Map<String, dynamic> ? v : const {};

// ------------------------------------------------------------------ conta

/// `GET /conta` → `conta`: o que o dono pode mudar, e a situação da conta.
class DadosConta {
  const DadosConta({
    required this.nome,
    required this.cnpj,
    required this.timezone,
    this.status = 'ativa',
    this.descansoMarketingDias,
  });

  final String nome;

  /// Só dígitos (ou letras e dígitos, no CNPJ novo), ou nulo. Conferido na
  /// Receita no cadastro: é a identidade da conta na Meta e só muda pelo
  /// suporte — por isso a tela mostra, mas não edita.
  final String? cnpj;

  /// Nome IANA (`America/Sao_Paulo`): rege as janelas de envio.
  final String timezone;

  /// `aprovada`, `ativa`, `suspensa` ou `cancelada`.
  final String status;

  /// Descanso entre campanhas de marketing, em dias (0 desliga). Nulo quando
  /// o servidor não manda o campo — aí a tela não mostra, como no site.
  final int? descansoMarketingDias;

  factory DadosConta.deJson(Map<String, dynamic> j) {
    final c = _mapa(j['conta']);
    return DadosConta(
      nome: _txt(c['nome']),
      cnpj: _txtOuNulo(c['cnpj']),
      timezone: _txt(c['timezone']).isEmpty
          ? 'America/Sao_Paulo'
          : _txt(c['timezone']),
      status: _txt(c['status']).isEmpty ? 'ativa' : _txt(c['status']),
      descansoMarketingDias: _intOuNulo(c['descansoMarketingDias']),
    );
  }
}

/// Cada situação da conta tem nome próprio: "Ativa" no lugar de "Cancelada"
/// seria mentira. A mesma tabela da página "Conta e usuários" do site.
String rotuloDaSituacaoDaConta(String status) => switch (status) {
  'aprovada' => 'Aprovada',
  'ativa' => 'Ativa',
  'suspensa' => 'Suspensa',
  'cancelada' => 'Cancelada',
  _ => status,
};

/// Os fusos do Brasil, do jeito que as pessoas os chamam.
const fusosBrasil = {
  'America/Sao_Paulo': 'Brasília (SP, RJ, MG, Sul, GO, DF, NE)',
  'America/Manaus': 'Amazonas (Manaus)',
  'America/Cuiaba': 'Mato Grosso (Cuiabá)',
  'America/Campo_Grande': 'Mato Grosso do Sul (Campo Grande)',
  'America/Porto_Velho': 'Rondônia (Porto Velho)',
  'America/Boa_Vista': 'Roraima (Boa Vista)',
  'America/Rio_Branco': 'Acre (Rio Branco)',
  'America/Noronha': 'Fernando de Noronha',
};

class UsuarioConta {
  const UsuarioConta({
    required this.id,
    required this.nome,
    required this.email,
    required this.papel,
    required this.status,
    required this.ultimoLoginEm,
  });

  final String id;
  final String nome;
  final String email;

  /// `dono` ou `operador`.
  final String papel;

  /// `ativo` ou `suspenso`.
  final String status;
  final DateTime? ultimoLoginEm;

  bool get ehDono => papel == 'dono';
  bool get suspenso => status == 'suspenso';

  factory UsuarioConta.deJson(Map<String, dynamic> j) => UsuarioConta(
    id: _txt(j['id']),
    nome: _txt(j['nome']),
    email: _txt(j['email']),
    papel: _txt(j['papel']),
    status: _txt(j['status']),
    ultimoLoginEm: _data(j['ultimoLoginEm']),
  );
}

// ------------------------------------------------------------------ plano

class PlanoOferta {
  const PlanoOferta({
    required this.id,
    required this.nome,
    required this.disparosMes,
    required this.precoCentavos,
  });

  final String id;
  final String nome;
  final int disparosMes;
  final int precoCentavos;

  static PlanoOferta? deJson(Object? v) {
    if (v is! Map<String, dynamic>) return null;
    return PlanoOferta(
      id: _txt(v['id']),
      nome: _txt(v['nome']),
      disparosMes: _int(v['disparosMes']),
      precoCentavos: _int(v['precoCentavos']),
    );
  }
}

class CobrancaPlano {
  const CobrancaPlano({
    required this.id,
    required this.valorCentavos,
    required this.status,
    required this.data,
    required this.motivo,
    required this.plano,
  });

  final String id;
  final int valorCentavos;

  /// `aprovada`, `pendente`, `recusada`, `cancelada` ou `estornada`.
  final String status;
  final DateTime? data;
  final String? motivo;
  final String? plano;

  factory CobrancaPlano.deJson(Map<String, dynamic> j) => CobrancaPlano(
    id: _txt(j['id']),
    valorCentavos: _int(j['valorCentavos']),
    status: _txt(j['status']),
    data: _data(j['pagoEm'] ?? j['vencimento'] ?? j['criadoEm']),
    motivo: _txtOuNulo(j['motivo']),
    plano: _txtOuNulo(j['plano']),
  );
}

/// `GET /plano`.
class SituacaoPlano {
  const SituacaoPlano({
    required this.status,
    required this.gratisAte,
    required this.cicloFim,
    required this.disparosParamEm,
    required this.bloqueado,
    required this.planoAtual,
    required this.planoProximoCiclo,
    required this.mpStatus,
    required this.checkoutPendenteUrl,
    required this.checkoutPendentePlano,
    required this.cobrancaDisponivel,
    required this.recontratarEm,
    required this.disparos,
    required this.teto,
    required this.planos,
    required this.cobrancas,
  });

  /// `cortesia`, `ativa`, `inadimplente` ou `cancelada`.
  final String status;
  final DateTime? gratisAte;
  final DateTime? cicloFim;
  final DateTime? disparosParamEm;
  final bool bloqueado;
  final PlanoOferta? planoAtual;
  final PlanoOferta? planoProximoCiclo;

  /// No Mercado Pago: `pending`, `authorized`, `paused`, `cancelled`.
  final String? mpStatus;
  final String? checkoutPendenteUrl;
  final String? checkoutPendentePlano;
  final bool cobrancaDisponivel;
  final DateTime? recontratarEm;
  final int disparos;
  final int? teto;
  final List<PlanoOferta> planos;
  final List<CobrancaPlano> cobrancas;

  bool get pago => mpStatus == 'authorized';
  bool get renovacaoCancelada =>
      status == 'ativa' && (mpStatus == 'cancelled' || mpStatus == 'paused');

  /// O que o botão de cada plano diz — a mesma regra da página do site.
  String rotuloDo(PlanoOferta p) {
    final atual = pago && planoAtual?.id == p.id;
    if (atual) {
      return planoProximoCiclo != null ? 'Continuar neste plano' : 'Seu plano';
    }
    if (planoProximoCiclo?.id == p.id) return 'Começa no próximo ciclo';
    if (!pago) return 'Contratar';
    final maior =
        planoAtual == null || p.precoCentavos >= planoAtual!.precoCentavos;
    return maior ? 'Mudar para este' : 'Reduzir no próximo ciclo';
  }

  bool ehAtual(PlanoOferta p) => pago && planoAtual?.id == p.id;

  bool podeEscolher(PlanoOferta p) =>
      cobrancaDisponivel &&
      recontratarEm == null &&
      !(ehAtual(p) && planoProximoCiclo == null) &&
      planoProximoCiclo?.id != p.id;

  factory SituacaoPlano.deJson(Map<String, dynamic> j) {
    final checkout = j['checkoutPendente'] is Map<String, dynamic>
        ? j['checkoutPendente'] as Map<String, dynamic>
        : null;
    final uso = _mapa(j['uso']);
    return SituacaoPlano(
      status: _txt(j['status']),
      gratisAte: _data(j['gratisAte']),
      cicloFim: _data(j['cicloFim']),
      disparosParamEm: _data(j['disparosParamEm']),
      bloqueado: j['bloqueado'] == true,
      planoAtual: PlanoOferta.deJson(j['planoAtual']),
      planoProximoCiclo: PlanoOferta.deJson(j['planoProximoCiclo']),
      mpStatus: _txtOuNulo(j['mpStatus']),
      checkoutPendenteUrl: _txtOuNulo(checkout?['url']),
      checkoutPendentePlano: PlanoOferta.deJson(checkout?['plano'])?.nome,
      cobrancaDisponivel: j['cobrancaDisponivel'] == true,
      recontratarEm: _data(j['recontratarEm']),
      disparos: _int(uso['disparos']),
      teto: _intOuNulo(uso['teto']),
      planos: (j['planos'] is List ? j['planos'] as List : const [])
          .map(PlanoOferta.deJson)
          .whereType<PlanoOferta>()
          .toList(),
      cobrancas: (j['cobrancas'] is List ? j['cobrancas'] as List : const [])
          .whereType<Map<String, dynamic>>()
          .map(CobrancaPlano.deJson)
          .toList(),
    );
  }
}

/// `POST /plano/contratar`: ou vai para o Mercado Pago, ou já resolveu aqui.
sealed class ResultadoContratacao {
  const ResultadoContratacao();

  static ResultadoContratacao deJson(Map<String, dynamic> j) {
    final plano = _txt(j['plano']);
    return switch (j['modo']) {
      'checkout' => ContratacaoCheckout(_txt(j['checkoutUrl'])),
      'agendado' => ContratacaoResolvida(
        'Combinado: o plano $plano começa na virada do ciclo.',
      ),
      'mantido' => ContratacaoResolvida(
        'Redução desfeita: você continua no plano $plano.',
      ),
      _ => ContratacaoResolvida(
        'Pronto: você está no plano $plano. Os disparos a mais já valem neste ciclo.',
      ),
    };
  }
}

class ContratacaoCheckout extends ResultadoContratacao {
  const ContratacaoCheckout(this.url);
  final String url;
}

class ContratacaoResolvida extends ResultadoContratacao {
  const ContratacaoResolvida(this.mensagem);
  final String mensagem;
}

// -------------------------------------------------------------- leituras

final dadosContaProvider = FutureProvider.autoDispose<DadosConta>((ref) async {
  final dados = await ref.read(clienteApiProvider).get('/conta');
  return DadosConta.deJson(dados as Map<String, dynamic>);
});

final usuariosProvider = FutureProvider.autoDispose<List<UsuarioConta>>((
  ref,
) async {
  final dados = await ref.read(clienteApiProvider).get('/conta/usuarios');
  return (dados as List)
      .whereType<Map<String, dynamic>>()
      .map(UsuarioConta.deJson)
      .toList();
});

final situacaoPlanoProvider = FutureProvider.autoDispose<SituacaoPlano>((
  ref,
) async {
  final dados = await ref.read(clienteApiProvider).get('/plano');
  return SituacaoPlano.deJson(dados as Map<String, dynamic>);
});

final servicoContaProvider = Provider<ServicoConta>(
  (ref) => ServicoConta(ref.read(clienteApiProvider)),
);

class ServicoConta {
  ServicoConta(this._api);

  final ClienteApi _api;

  /// `PATCH /conta` com o mesmo corpo do site: nome, fuso e o descanso. O
  /// CNPJ não vai — conferido na Receita, ele só muda pelo suporte, e o
  /// servidor recusaria a troca.
  Future<void> atualizar({
    required String nome,
    required String timezone,
    int? descansoMarketingDias,
  }) => _api.patch('/conta', {
    'nome': nome.trim(),
    'timezone': timezone,
    'descansoMarketingDias': ?descansoMarketingDias,
  });

  Future<void> criarUsuario({
    required String nome,
    required String email,
    required String senha,
  }) => _api.post('/conta/usuarios', {
    'nome': nome.trim(),
    'email': email.trim(),
    'senha': senha,
  });

  Future<void> suspender(String id, {required bool suspenso}) => _api.patch(
    '/conta/usuarios/$id',
    {'status': suspenso ? 'suspenso' : 'ativo'},
  );

  Future<void> remover(String id) => _api.delete('/conta/usuarios/$id');

  Future<void> trocarSenha(String atual, String nova) =>
      _api.post('/auth/senha', {'senhaAtual': atual, 'senhaNova': nova});

  Future<ResultadoContratacao> contratar(
    String planoId, {
    String? emailPagador,
  }) async => ResultadoContratacao.deJson(
    await _api.post('/plano/contratar', {
          'planoId': planoId,
          if (emailPagador != null && emailPagador.trim().isNotEmpty)
            'emailPagador': emailPagador.trim(),
        })
        as Map<String, dynamic>,
  );

  Future<void> cancelar() => _api.post('/plano/cancelar');
}
