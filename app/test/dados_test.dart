import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:regemcast/api/contatos.dart';
import 'package:regemcast/api/dados.dart';
import 'package:regemcast/api/publicos.dart';
import 'package:regemcast/componentes/basicos.dart';
import 'package:regemcast/componentes/campanha.dart';
import 'package:regemcast/componentes/categoria.dart';
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

  group('campanha como o site', () {
    test('resumo lê espera, respondidas, descanso, categoria e público', () {
      final c = ResumoCampanha.deJson({
        'id': 'c',
        'nome': 'Sexta',
        'modeloNome': 'promo',
        'status': 'enviando',
        'porStatus': {'lida': 3, 'entregue': 2, 'enviada': 1, 'descanso': 4},
        'total': 10,
        'modeloCategoria': 'marketing',
        'publicoOrigem': 'publico',
        'publicoRotulo': 'Pedem à noite',
        'espera': {
          'motivo': 'limite_meta',
          'ate': '2026-09-30T13:00:00Z',
          'limite': '1000',
        },
        'respondidas': 2,
        'descansoDias': 3,
      });
      expect(c.espera?.motivo, 'limite_meta');
      expect(c.espera?.limite, 1000);
      expect(c.espera?.ate, isNotNull);
      expect(c.respondidas, 2);
      expect(c.descansoDias, 3);
      expect(c.emDescanso, 4);
      expect(c.aceitas, 6, reason: 'enviada + entregue + lida');
      expect(publicoDaCampanha(c), 'Pedem à noite');
      expect(
        ResumoCampanha.deJson({
          'espera': {'motivo': ''},
        }).espera,
        isNull,
      );
    });

    test('público sem lista nem rótulo: números digitados ou da base', () {
      expect(
        publicoDaCampanha(ResumoCampanha.deJson({'publicoOrigem': 'numeros'})),
        'Números digitados',
      );
      expect(publicoDaCampanha(ResumoCampanha.deJson({})), 'Números digitados');
      expect(
        publicoDaCampanha(ResumoCampanha.deJson({'publicoOrigem': 'base'})),
        'Da base',
      );
      expect(
        publicoDaCampanha(ResumoCampanha.deJson({'listaNome': 'Clientes'})),
        'Clientes',
      );
    });

    test('situação: as mesmas cores do site', () {
      ResumoCampanha r(String s) => ResumoCampanha.deJson({'status': s});
      expect(situacaoDaCampanha(r('agendada')), (
        'Agendada',
        TomPilula.atencao,
        true,
      ));
      expect(situacaoDaCampanha(r('pausada')).$2, TomPilula.erro);
      expect(situacaoDoDestinatario('descanso'), (
        'Em descanso',
        TomPilula.neutro,
      ));
      expect(situacaoDoDestinatario('pendente').$1, 'Na fila');
    });

    test('lista que é bloco traz a divisão e quando foi usada', () {
      final b = ListaContatos.deJson({
        'id': 'b1',
        'nome': 'Base — bloco 1',
        'total': 250,
        'divisaoId': 'd1',
        'divisaoNome': 'Base de setembro',
        'bloco': 1,
        'blocos': 4,
        'usadaEm': '2026-09-21T15:00:00Z',
      });
      expect(b.ehBloco, isTrue);
      expect(b.blocos, 4);
      expect(b.usadaEm, isNotNull);
      expect(ListaContatos.deJson({'id': 'l', 'nome': 'x'}).ehBloco, isFalse);
    });

    test('prévia do público: total, descanso, horário e cashback', () {
      final p = PreviaDoPublico.deJson({
        'total': 310,
        'descanso': {'dias': 3, 'emDescanso': 12},
        'horario': {
          'total': 4700,
          'comHabito': 900,
          'minimo': 20,
          'periodos': [
            {'periodo': 'noite', 'total': 540},
          ],
          'sugestao': {
            'periodo': 'noite',
            'percentual': 60,
            'inicio': '17:00',
            'fim': '19:00',
          },
        },
        'cashback': {'doPublico': 4700},
      });
      expect(p.total, 310);
      expect(p.emDescanso, 12);
      expect(p.horario?.sugestao?.inicio, '17:00');
      expect(p.horario?.periodos.single.periodo, 'noite');
      expect(p.cashbackDoPublico, 4700);
      expect(PreviaDoPublico.deJson({'total': 5}).horario, isNull);
      expect(
        PreviaDoPublico.deJson({'cashback': null}).cashbackDoPublico,
        isNull,
      );
    });

    test('o público vai só com o que a origem pede', () {
      expect(
        const PublicoDaCampanha(
          origem: 'publico',
          publico: 'bairro',
          publicoValor: 'Centro',
        ).paraJson(),
        {'origem': 'publico', 'publico': 'bairro', 'publicoValor': 'Centro'},
      );
      expect(const PublicoDaCampanha(origem: 'base').paraJson(), {
        'origem': 'base',
      });
      expect(
        const PublicoDaCampanha(origem: 'lista', origemId: 'l1'),
        const PublicoDaCampanha(origem: 'lista', origemId: 'l1'),
        reason: 'mesmo público = mesma prévia',
      );
    });

    test('categoria: nome, explicação e tom, das duas grafias', () {
      expect(nomeDaCategoria('MARKETING'), 'Marketing');
      expect(nomeDaCategoria('utilidade'), 'Utilidade');
      expect(nomeDaCategoria('UTILITY'), 'Utilidade');
      expect(nomeDaCategoria('AUTHENTICATION'), 'Autenticação');
      expect(nomeDaCategoria(null), isNull);
      expect(nomeDaCategoria('nova'), 'Nova');
      expect(tomDaCategoria('marketing'), TomPilula.acento);
      expect(ehMarketing('MARKETING'), isTrue);
      expect(
        explicacaoDaCategoria('utilidade'),
        contains('Não entra no descanso'),
      );
    });

    test('hora curta e período', () {
      expect(horaCurta('17:00'), '17h');
      expect(horaCurta('10:30'), '10h30');
      expect(horaCurta('09:00'), '9h');
      expect(quandoPede('noite'), 'à noite');
      expect(nomeDoPeriodo('cafe'), 'café da manhã');
    });
  });
}
