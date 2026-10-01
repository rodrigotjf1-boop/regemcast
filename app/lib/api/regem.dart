import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../sessao/sessao.dart';
import 'cliente_api.dart';

/// A empresa no Regem ligada ao Regemcast: os clientes, as compras de cada um
/// e a 99 (só com a autorização do dono). Espelha `SituacaoRegem` de
/// `frontend/src/lib/tipos.ts`. Quem liga é a equipe do Regemcast, pelo
/// console — a loja não copia token. Tudo roda no servidor.

String _txt(Object? v) => v?.toString() ?? '';
String? _txtOuNulo(Object? v) => v?.toString();
int _int(Object? v) => v is num ? v.toInt() : int.tryParse('${v ?? ''}') ?? 0;
DateTime? _data(Object? v) =>
    v == null ? null : DateTime.tryParse('$v')?.toLocal();
Map<String, dynamic> _mapa(Object? v) =>
    v is Map<String, dynamic> ? v : const <String, dynamic>{};
String _status(Object? v) => _txt(v).isEmpty ? 'parado' : _txt(v);

/// Os clientes: a leitura completa (`carga`) e, depois, as mudanças a cada 30 min.
class ClientesDoRegem {
  const ClientesDoRegem({
    required this.status,
    required this.lidos,
    required this.novos,
    required this.bloqueados,
    required this.invalidos,
    required this.removidos,
    this.ultimaConsulta,
    this.erro,
  });

  /// `parado`, `carga`, `em_dia` ou `falhou`.
  final String status;
  final int lidos;
  final int novos;

  /// Pediram para sair no Regem: entraram descadastrados.
  final int bloqueados;
  final int invalidos;

  /// Esquecidos a pedido no Regem: anonimizados aqui.
  final int removidos;
  final DateTime? ultimaConsulta;
  final String? erro;

  factory ClientesDoRegem.deJson(Map<String, dynamic> j) => ClientesDoRegem(
    status: _status(j['status']),
    lidos: _int(j['lidos']),
    novos: _int(j['novos']),
    bloqueados: _int(j['bloqueados']),
    invalidos: _int(j['invalidos']),
    removidos: _int(j['removidos']),
    ultimaConsulta: _data(j['ultimaConsulta']),
    erro: _txtOuNulo(j['erro']),
  );
}

/// As vendas que viram compras: 3 anos na carga, depois a cada 30 min.
class VendasDoRegem {
  const VendasDoRegem({
    required this.status,
    required this.lidas,
    required this.compras,
    required this.clientes,
    this.ultimaConsulta,
    this.erro,
    this.primeira,
    this.ultima,
  });

  final String status;
  final int lidas;
  final int compras;
  final int clientes;
  final DateTime? ultimaConsulta;
  final String? erro;
  final DateTime? primeira;
  final DateTime? ultima;

  factory VendasDoRegem.deJson(Map<String, dynamic> j) => VendasDoRegem(
    status: _status(j['status']),
    lidas: _int(j['lidos']),
    compras: _int(j['compras']),
    clientes: _int(j['clientes']),
    ultimaConsulta: _data(j['ultimaConsulta']),
    erro: _txtOuNulo(j['erro']),
    primeira: _data(j['primeira']),
    ultima: _data(j['ultima']),
  );
}

/// `GET /integracoes/regem`.
class SituacaoRegem {
  const SituacaoRegem({
    required this.ligado,
    required this.lojas,
    required this.escopo99,
    required this.incluir99,
    required this.textoAutorizacao99,
    required this.cardapioWebDireto,
    required this.clientes,
    required this.vendas,
    this.empresaNome,
    this.autorizacao99Em,
    this.carenciaDias = 5,
  });

  final bool ligado;
  final String? empresaNome;
  final List<String> lojas;

  /// O Regem já entrega a 99 para esta conta.
  final bool escopo99;

  /// O dono autorizou os clientes da 99, sob a responsabilidade da empresa.
  final bool incluir99;
  final DateTime? autorizacao99Em;

  /// O texto que o dono aceita — o mesmo que o servidor grava.
  final String textoAutorizacao99;

  /// O Cardápio Web também ligado direto: as vendas dele pelo Regem ficam de fora.
  final bool cardapioWebDireto;
  final ClientesDoRegem clientes;
  final VendasDoRegem vendas;

  /// Desligou a integração, a gratuidade acaba: sem plano pago, os disparos
  /// param depois destes dias.
  final int carenciaDias;

  /// Algo andando no servidor: a tela relê sozinha.
  bool get lendo => clientes.status == 'carga' || vendas.status == 'carga';

  factory SituacaoRegem.deJson(Map<String, dynamic> j) => SituacaoRegem(
    ligado: j['ligado'] == true,
    empresaNome: _txtOuNulo(j['empresaNome']),
    lojas: [
      for (final l in (j['lojas'] is List ? j['lojas'] as List : const []))
        if (l is Map && _txt(l['nome']).isNotEmpty) _txt(l['nome']),
    ],
    escopo99: j['escopo99'] == true,
    incluir99: j['incluir99'] == true,
    autorizacao99Em: _data(j['autorizacao99Em']),
    textoAutorizacao99: _txt(j['textoAutorizacao99']),
    cardapioWebDireto: j['cardapioWebDireto'] == true,
    carenciaDias: j['carenciaDias'] is num
        ? (j['carenciaDias'] as num).toInt()
        : 5,
    clientes: ClientesDoRegem.deJson(_mapa(j['clientes'])),
    vendas: VendasDoRegem.deJson(_mapa(j['pedidos'])),
  );
}

final servicoRegemProvider = Provider<ServicoRegem>(
  (ref) => ServicoRegem(ref.read(clienteApiProvider)),
);

/// As mesmas rotas e os mesmos corpos do site (`lib/servicos.ts` › `regem`).
class ServicoRegem {
  ServicoRegem(this._api);

  final ClienteApi _api;

  Future<SituacaoRegem> situacao() async => SituacaoRegem.deJson(
    await _api.get('/integracoes/regem') as Map<String, dynamic>,
  );

  /// A declaração do dono e a leitura completa, em segundo plano.
  Future<void> importar({required bool consentimento, String? evidencia}) =>
      _api.post('/integracoes/regem/importar', {
        'consentimento': consentimento,
        if (evidencia != null && evidencia.trim().isNotEmpty)
          'evidencia': evidencia.trim(),
      });

  /// Autoriza (com a declaração) ou desfaz o uso dos clientes da 99Food.
  Future<void> autorizar99(bool autorizar) => _api.post(
    '/integracoes/regem/99',
    {'autorizar': autorizar, if (autorizar) 'declaracao': true},
  );

  /// Consulta as mudanças agora; parado por falha, retoma de onde parou.
  Future<void> atualizar() => _api.post('/integracoes/regem/atualizar');

  /// Para de trazer; os contatos e as compras ficam.
  Future<void> desligar() => _api.delete('/integracoes/regem');
}
