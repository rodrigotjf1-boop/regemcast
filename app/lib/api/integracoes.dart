import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../sessao/sessao.dart';
import 'cliente_api.dart';

/// A loja do Cardápio Web ligada ao Regemcast: os clientes, as compras de cada
/// um e o cashback. Espelha `SituacaoCardapioWeb` de
/// `frontend/src/lib/tipos.ts`. Tudo roda no servidor — a pessoa pode fechar
/// a tela no meio.

String _txt(Object? v) => v?.toString() ?? '';
String? _txtOuNulo(Object? v) => v?.toString();
int _int(Object? v) => v is num ? v.toInt() : int.tryParse('${v ?? ''}') ?? 0;
int? _intOuNulo(Object? v) =>
    v == null ? null : (v is num ? v.toInt() : int.tryParse('$v'));
DateTime? _data(Object? v) =>
    v == null ? null : DateTime.tryParse('$v')?.toLocal();
Map<String, dynamic> _mapa(Object? v) =>
    v is Map<String, dynamic> ? v : const <String, dynamic>{};

/// A importação dos clientes.
class ClientesDaLoja {
  const ClientesDaLoja({
    required this.status,
    required this.pagina,
    required this.lidos,
    required this.novos,
    required this.bloqueados,
    required this.invalidos,
    this.totalPaginas,
    this.concluidaEm,
    this.erro,
  });

  /// `parada`, `rodando`, `concluida` ou `falhou`.
  final String status;
  final int pagina;
  final int? totalPaginas;
  final int lidos;
  final int novos;

  /// WhatsApp desligado no Cardápio Web: entraram descadastrados.
  final int bloqueados;
  final int invalidos;
  final DateTime? concluidaEm;
  final String? erro;

  bool get rodando => status == 'rodando';

  /// De 0 a 100, pela página.
  int get progresso => (totalPaginas ?? 0) == 0
      ? 0
      : ((pagina / totalPaginas!) * 100).round().clamp(0, 100);

  factory ClientesDaLoja.deJson(Map<String, dynamic> j) => ClientesDaLoja(
    status: _txt(j['status']).isEmpty ? 'parada' : _txt(j['status']),
    pagina: _int(j['pagina']),
    totalPaginas: _intOuNulo(j['totalPaginas']),
    lidos: _int(j['lidos']),
    novos: _int(j['novos']),
    bloqueados: _int(j['bloqueados']),
    invalidos: _int(j['invalidos']),
    concluidaEm: _data(j['concluidaEm']),
    erro: _txtOuNulo(j['erro']),
  );
}

/// As compras: a carga do histórico (3 anos) e os pedidos novos a cada 30 min.
class ComprasDaLoja {
  const ComprasDaLoja({
    required this.status,
    required this.progresso,
    required this.lidos,
    required this.compras,
    required this.clientes,
    this.cargaDe,
    this.cargaAte,
    this.ultimaConsulta,
    this.erro,
    this.primeira,
    this.ultima,
  });

  /// `parado`, `carga`, `em_dia` ou `falhou`.
  final String status;
  final int progresso;
  final DateTime? cargaDe;
  final DateTime? cargaAte;
  final int lidos;
  final DateTime? ultimaConsulta;

  /// Na carga, um soluço que se resolve sozinho; parada, o motivo.
  final String? erro;
  final int compras;
  final int clientes;
  final DateTime? primeira;
  final DateTime? ultima;

  bool get buscando => status == 'carga';

  factory ComprasDaLoja.deJson(Map<String, dynamic> j) => ComprasDaLoja(
    status: _txt(j['status']).isEmpty ? 'parado' : _txt(j['status']),
    progresso: _int(j['progresso']),
    cargaDe: _data(j['cargaDe']),
    cargaAte: _data(j['cargaAte']),
    lidos: _int(j['lidos']),
    ultimaConsulta: _data(j['ultimaConsulta']),
    erro: _txtOuNulo(j['erro']),
    compras: _int(j['compras']),
    clientes: _int(j['clientes']),
    primeira: _data(j['primeira']),
    ultima: _data(j['ultima']),
  );
}

/// O cashback: lido na importação e, depois, todo dia às 4h.
class CashbackDaLoja {
  const CashbackDaLoja({
    required this.comCashback,
    required this.vencendo,
    required this.totalCentavos,
    required this.lendo,
    this.ultimaLeitura,
    this.proximaLeitura,
    this.erro,
  });

  final int comCashback;

  /// Vence de hoje até daqui a 7 dias.
  final int vencendo;

  /// Soma do cashback que vale hoje.
  final int totalCentavos;
  final bool lendo;
  final DateTime? ultimaLeitura;
  final DateTime? proximaLeitura;
  final String? erro;

  factory CashbackDaLoja.deJson(Map<String, dynamic> j) => CashbackDaLoja(
    comCashback: _int(j['comCashback']),
    vencendo: _int(j['vencendo']),
    totalCentavos: _int(j['totalCentavos']),
    lendo: j['lendo'] == true,
    ultimaLeitura: _data(j['ultimaLeitura']),
    proximaLeitura: _data(j['proximaLeitura']),
    erro: _txtOuNulo(j['erro']),
  );
}

/// `GET /integracoes/cardapioweb`.
class SituacaoCardapioWeb {
  const SituacaoCardapioWeb({
    required this.conectado,
    required this.clientes,
    this.lojaNome,
    this.compras,
    this.cashback,
  });

  final bool conectado;
  final String? lojaNome;
  final ClientesDaLoja clientes;

  /// Ausentes só numa API mais antiga que o app: o bloco não aparece.
  final ComprasDaLoja? compras;
  final CashbackDaLoja? cashback;

  /// Algo andando no servidor: a tela relê sozinha.
  bool get trabalhando => clientes.rodando || (compras?.buscando ?? false);

  factory SituacaoCardapioWeb.deJson(Map<String, dynamic> j) =>
      SituacaoCardapioWeb(
        conectado: j['conectado'] == true,
        lojaNome: _txtOuNulo(j['lojaNome']),
        clientes: ClientesDaLoja.deJson(_mapa(j['sincronizacao'])),
        compras: j['pedidos'] is Map<String, dynamic>
            ? ComprasDaLoja.deJson(j['pedidos'] as Map<String, dynamic>)
            : null,
        cashback: j['saldos'] is Map<String, dynamic>
            ? CashbackDaLoja.deJson(j['saldos'] as Map<String, dynamic>)
            : null,
      );
}

final servicoCardapioWebProvider = Provider<ServicoCardapioWeb>(
  (ref) => ServicoCardapioWeb(ref.read(clienteApiProvider)),
);

class ServicoCardapioWeb {
  ServicoCardapioWeb(this._api);

  final ClienteApi _api;

  Future<SituacaoCardapioWeb> situacao() async => SituacaoCardapioWeb.deJson(
    await _api.get('/integracoes/cardapioweb') as Map<String, dynamic>,
  );

  /// Confere o token na loja e guarda cifrado. Só o dono.
  Future<String> conectar(String chave) async {
    final r =
        await _api.post('/integracoes/cardapioweb/chave', {
              'chave': chave.trim(),
            })
            as Map<String, dynamic>;
    return _txt(r['lojaNome']);
  }

  /// Começa a importação dos clientes, em segundo plano. Só o dono.
  Future<void> importar({required bool consentimento, String? evidencia}) =>
      _api.post('/integracoes/cardapioweb/importar', {
        'consentimento': consentimento,
        if (evidencia != null && evidencia.trim().isNotEmpty)
          'evidencia': evidencia.trim(),
      });

  /// Começa a carga do histórico ou, com a loja em dia, consulta os novos.
  Future<void> buscarPedidos() => _api.post('/integracoes/cardapioweb/pedidos');

  /// Apaga a credencial; os contatos e as compras ficam.
  Future<void> desconectar() => _api.delete('/integracoes/cardapioweb');
}
