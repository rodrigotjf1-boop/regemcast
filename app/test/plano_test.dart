import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:regemcast/api/conta.dart';
import 'package:regemcast/telas/plano.dart';

Map<String, dynamic> _plano(String id, int preco) => {
  'id': id,
  'nome': id,
  'disparosMes': 1000,
  'precoCentavos': preco,
};

SituacaoPlano _situacao(Map<String, dynamic> extra) => SituacaoPlano.deJson({
  'status': 'ativa',
  'cobrancaDisponivel': true,
  'planos': [_plano('p1', 100), _plano('p2', 200), _plano('p3', 300)],
  ...extra,
});

void main() {
  setUpAll(() => initializeDateFormatting('pt_BR'));

  group('aviso do topo da tela Plano', () {
    const datas = {
      'gratisAte': '2026-10-10T12:00:00Z',
      'disparosParamEm': '2026-10-10T12:00:00Z',
      'cicloFim': '2026-10-17T12:00:00Z',
    };
    const casos = <String, Map<String, dynamic>>{
      'grátis': {'status': 'cortesia'},
      'assinatura terminou': {'status': 'cancelada', 'bloqueado': true},
      'parada por falta de pagamento': {
        'status': 'inadimplente',
        'bloqueado': true,
      },
      'pagamento recusado': {'status': 'inadimplente'},
      'renovação cancelada': {
        'status': 'ativa',
        'mpStatus': 'cancelled',
        'recontratarEm': '2026-10-17T12:00:00Z',
      },
    };

    test('APK direto: as frases do site, com o convite para contratar', () {
      String texto(Map<String, dynamic> caso) =>
          avisoDoPlano(_situacao({...datas, ...caso}), compra: true)!.$1;
      expect(texto(casos['grátis']!), contains('Escolha um plano'));
      expect(texto(casos['pagamento recusado']!), contains('Mercado Pago'));
      expect(
        texto(casos['renovação cancelada']!),
        contains('contratar de novo'),
      );
    });

    test('build da Play: nenhum aviso chama para pagar fora (ERR-029)', () {
      for (final caso in casos.entries) {
        final aviso = avisoDoPlano(
          _situacao({...datas, ...caso.value}),
          compra: false,
        );
        expect(aviso, isNotNull, reason: caso.key);
        for (final proibido in [
          'Escolha',
          'contratar',
          'Mercado Pago',
          'fora do app',
        ]) {
          expect(
            aviso!.$1,
            isNot(contains(proibido)),
            reason: '${caso.key}: "${aviso.$1}"',
          );
        }
      }
    });
  });

  test('sem pagar: todos contratam', () {
    final s = _situacao({'status': 'cortesia'});
    expect(s.planos.map(s.rotuloDo), everyElement('Contratar'));
    expect(s.planos.every(s.podeEscolher), true);
  });

  test('pago: atual trava, maior muda, menor reduz no ciclo', () {
    final s = _situacao({
      'mpStatus': 'authorized',
      'planoAtual': _plano('p2', 200),
    });
    final [p1, p2, p3] = s.planos;
    expect(s.rotuloDo(p2), 'Seu plano');
    expect(s.podeEscolher(p2), false);
    expect(s.rotuloDo(p3), 'Mudar para este');
    expect(s.rotuloDo(p1), 'Reduzir no próximo ciclo');
  });

  test('redução agendada: o atual oferece desfazer, o agendado trava', () {
    final s = _situacao({
      'mpStatus': 'authorized',
      'planoAtual': _plano('p2', 200),
      'planoProximoCiclo': _plano('p1', 100),
    });
    final [p1, p2, _] = s.planos;
    expect(s.rotuloDo(p2), 'Continuar neste plano');
    expect(s.podeEscolher(p2), true);
    expect(s.rotuloDo(p1), 'Começa no próximo ciclo');
    expect(s.podeEscolher(p1), false);
  });

  test('renovação cancelada com mês pago: nada se contrata antes da data', () {
    final s = _situacao({
      'mpStatus': 'cancelled',
      'recontratarEm': '2026-10-17T03:00:00Z',
    });
    expect(s.renovacaoCancelada, true);
    expect(s.planos.any(s.podeEscolher), false);
  });

  test('contratação devolve checkout ou mensagem', () {
    expect(
      ResultadoContratacao.deJson({
        'modo': 'checkout',
        'checkoutUrl': 'https://mp',
      }),
      isA<ContratacaoCheckout>().having((c) => c.url, 'url', 'https://mp'),
    );
    expect(
      ResultadoContratacao.deJson({'modo': 'agendado', 'plano': 'Essencial'}),
      isA<ContratacaoResolvida>().having(
        (c) => c.mensagem,
        'mensagem',
        contains('Essencial'),
      ),
    );
  });
}
