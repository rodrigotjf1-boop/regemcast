import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:regemcast/api/dados.dart';
import 'package:regemcast/util/formato.dart' as f;

void main() {
  setUpAll(() => initializeDateFormatting('pt_BR'));

  group('leitura dos dados da API', () {
    test('resumo da conta calcula a fração do plano', () {
      final r = ResumoConta.deJson({
        'conta': {'nome': 'MISTER BURGERS'},
        'plano': {
          'codigo': 'essencial',
          'nome': 'Essencial',
          'disparosMes': 5000,
        },
        'assinatura': {
          'status': 'ativa',
          'cicloInicio': '2026-09-17T00:00:00Z',
          'cicloFim': '2026-10-17T00:00:00Z',
        },
        'uso': {'disparos': 1250, 'teto': 5000, 'restantes': 3750},
      });
      expect(r.nomeConta, 'MISTER BURGERS');
      expect(r.planoNome, 'Essencial');
      expect(r.fracao, 0.25);
      expect(r.restantes, 3750);
    });

    test('conta sem plano não inventa teto', () {
      final r = ResumoConta.deJson({
        'conta': {'nome': 'X'},
        'plano': null,
        'assinatura': null,
        'uso': {'disparos': 3, 'teto': null, 'restantes': null},
      });
      expect(r.fracao, isNull);
      expect(r.planoNome, isNull);
    });

    test('campo faltando não derruba a leitura', () {
      final c = ResumoCampanha.deJson({'id': '1', 'nome': 'Promo'});
      expect(c.total, 0);
      expect(c.porStatus, isEmpty);
      expect(c.entregues, 0);
    });

    test(
      'entregues conta também as lidas (lida é entregue que foi aberta)',
      () {
        final c = ResumoCampanha.deJson({
          'id': '1',
          'nome': 'Promo',
          'status': 'enviando',
          'porStatus': {
            'entregue': 10,
            'lida': 5,
            'enviada': 3,
            'falhou': 2,
            'pendente': 80,
          },
          'total': 100,
        });
        expect(c.entregues, 15);
        expect(c.sairam, 20);
        expect(c.falhas, 2);
        expect(c.emAndamento, isTrue);
      },
    );

    test('WhatsApp escolhe o número registrado como principal', () {
      final s = SituacaoWhatsapp.deJson({
        'conectado': true,
        'numeros': [
          {
            'telefone': '+55 21 1111-1111',
            'status': 'pendente',
            'qualidade': 'desconhecida',
          },
          {
            'telefone': '+55 21 2222-2222',
            'status': 'registrado',
            'qualidade': 'verde',
            'tierLimite': 1000,
          },
        ],
      });
      expect(s.principal?.telefone, '+55 21 2222-2222');
      expect(s.principal?.tierLimite, 1000);
    });

    test('desconectado não tem número principal', () {
      expect(SituacaoWhatsapp.deJson({'conectado': false}).principal, isNull);
    });
  });

  group('formato brasileiro', () {
    test(
      'números com ponto de milhar',
      () => expect(f.numero(50000), '50.000'),
    );
    test(
      'data dd/mm/aaaa',
      () => expect(f.data(DateTime(2026, 10, 17)), '17/10/2026'),
    );
    test('plural', () {
      expect(f.plural(1, 'campanha', 'campanhas'), '1 campanha');
      expect(f.plural(3, 'campanha', 'campanhas'), '3 campanhas');
    });
    test('quando é relativo e curto', () {
      final agora = DateTime(2026, 9, 18, 12);
      expect(
        f.quando(agora.subtract(const Duration(minutes: 5)), agora: agora),
        'há 5 min',
      );
      expect(
        f.quando(agora.subtract(const Duration(days: 1)), agora: agora),
        'ontem',
      );
    });
  });
}
