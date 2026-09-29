import 'package:flutter_test/flutter_test.dart';
import 'package:regemcast/api/contatos.dart';
import 'package:regemcast/api/midia.dart';
import 'package:regemcast/api/modelos.dart';

void main() {
  group('botão de saída', () {
    const link = BotaoModelo(tipo: 'URL', texto: 'Pedir', url: 'https://x');
    const resposta = BotaoModelo(tipo: 'QUICK_REPLY', texto: 'Quero');

    test('marketing simples: respostas agrupadas e a saída por último', () {
      final r = botoesComSaida('MARKETING', 'simples', [resposta, link]);
      expect(r.map((b) => b.texto), ['Pedir', 'Quero', 'Parar promoções']);
    });

    test('não duplica a saída que já veio na lista', () {
      final r = botoesComSaida('MARKETING', 'simples', [
        const BotaoModelo(tipo: 'QUICK_REPLY', texto: 'parar promoções '),
        resposta,
      ]);
      expect(r.where(ehBotaoDeSaida).length, 1);
      expect(r.last.texto, 'Parar promoções');
    });

    test('utilidade e carrossel ficam como estão', () {
      expect(botoesComSaida('UTILITY', 'simples', [resposta]), [resposta]);
      expect(botoesComSaida('MARKETING', 'carrossel', [resposta]), [resposta]);
      expect(limiteBotoes('MARKETING', 'simples'), 9);
      expect(limiteBotoes('UTILITY', 'simples'), 10);
    });
  });

  test('variáveis contam distintas, não ocorrências', () {
    expect(quantasVariaveis('Oi {{1}}, {{1}} e {{ 2 }}'), 2);
    expect(quantasVariaveis('sem nada'), 0);
    expect(variaveisDe('{{2}} e {{1}} e {{2}}'), [1, 2]);
  });

  group('ModeloSalvo', () {
    Map<String, dynamic> base(Map<String, dynamic> extra) => {
      'id': 'm',
      'nome': 'promo',
      'idioma': 'pt_BR',
      'categoria': 'MARKETING',
      'status': 'aprovado',
      'corpo': 'Oi {{1}}',
      'corpoExemplos': ['Ana'],
      'botoes': [
        {'tipo': 'URL', 'texto': 'Ver', 'url': 'https://x'},
      ],
      ...extra,
    };

    test('edição recente segura a próxima por 24 h', () {
      final m = ModeloSalvo.deJson(
        base({
          'editadoMetaEm': DateTime.now()
              .toUtc()
              .subtract(const Duration(hours: 5))
              .toIso8601String(),
        }),
      );
      expect(m.horasParaEditar, inInclusiveRange(18, 19));
      expect(ModeloSalvo.deJson(base({})).horasParaEditar, 0);
    });

    test('só o que está em análise não edita — carrossel edita pelo app', () {
      expect(ModeloSalvo.deJson(base({'status': 'enviado'})).podeEditar, false);
      expect(ModeloSalvo.deJson(base({'tipo': 'carrossel'})).podeEditar, true);
      expect(ModeloSalvo.deJson(base({})).podeEditar, true);
    });

    test(
      'enviar para aprovação: rascunho e recusado que ainda não estão na Meta',
      () {
        expect(
          ModeloSalvo.deJson(base({'status': 'rascunho'})).podeEnviar,
          true,
        );
        expect(
          ModeloSalvo.deJson(base({'status': 'rejeitado'})).podeEnviar,
          true,
        );
        // Recusado que já está na Meta volta pela edição, com o mesmo nome.
        expect(
          ModeloSalvo.deJson(
            base({'status': 'rejeitado', 'metaTemplateId': '99'}),
          ).podeEnviar,
          false,
        );
        expect(ModeloSalvo.deJson(base({})).podeEnviar, false);
      },
    );

    test('lê os cartões do carrossel com imagem e botões', () {
      final m = ModeloSalvo.deJson(
        base({
          'tipo': 'carrossel',
          'cartoes': [
            {
              'imagem': 'midia:abc',
              'corpo': 'Smash duplo',
              'botoes': [
                {'tipo': 'URL', 'texto': 'Pedir', 'url': 'https://x'},
              ],
            },
            'lixo',
          ],
        }),
      );
      expect(m.cartoes, hasLength(1));
      expect(m.cartoes.single.imagem, 'midia:abc');
      expect(m.cartoes.single.botoes.single.url, 'https://x');
    });
  });

  group('DadosModelo (o que o editor manda ao servidor)', () {
    test('reabrir um modelo tira o botão de saída gravado por engano', () {
      final d = DadosModelo.deSalvo(
        ModeloSalvo.deJson({
          'id': 'm',
          'nome': 'promo',
          'categoria': 'MARKETING',
          'status': 'rascunho',
          'corpo': 'Oi {{1}}, tudo bem?',
          'botoes': [
            {'tipo': 'QUICK_REPLY', 'texto': 'Quero'},
            {'tipo': 'QUICK_REPLY', 'texto': 'Parar promoções'},
          ],
        }),
      );
      expect(d.botoes.map((b) => b.texto), ['Quero']);
      expect(d.idioma, 'pt_BR');
    });

    test('um exemplo por variável do texto: o que sobrou não vai (132000)', () {
      const d = DadosModelo(
        nome: 'promo',
        corpo: 'Olá {{1}}, hoje o frete é por nossa conta.',
        corpoExemplos: [' Maria ', '4521'],
      );
      expect(d.paraJson()['corpoExemplos'], ['Maria']);
      const semExemplo = DadosModelo(corpo: 'Oi {{1}} e {{2}} aqui.');
      expect(semExemplo.paraJson()['corpoExemplos'], ['', '']);
    });

    test('mensagem simples: só o que a forma usa vai no pedido', () {
      const d = DadosModelo(
        nome: ' promo_x ',
        categoria: 'UTILITY',
        cabecalhoFormato: 'IMAGE',
        cabecalhoTexto: 'sobrou',
        cabecalhoMidia: 'midia:abc',
        corpo: 'Seu pedido saiu.',
        rodape: 'Loja Centro',
        botoes: [BotaoModelo(tipo: 'URL', texto: 'Ver', url: 'https://x')],
        cartoes: [CartaoModelo(corpo: 'sobrou')],
      );
      final j = d.paraJson();
      expect(j['nome'], 'promo_x');
      expect(j['cabecalhoFormato'], 'IMAGE');
      expect(j['cabecalhoMidia'], 'midia:abc');
      expect(j.containsKey('cabecalhoTexto'), false);
      expect(j['rodape'], 'Loja Centro');
      expect(j['cartoes'], isEmpty);
      expect(j['ltoAtivo'], false);
      expect(j.containsKey('ltoTexto'), false);
    });

    test('oferta por tempo limitado leva o texto e deixa o rodapé de fora', () {
      const d = DadosModelo(
        corpo: 'Hoje tem.',
        rodape: 'não vai',
        ltoAtivo: true,
        ltoTexto: 'Só hoje!',
      );
      final j = d.paraJson();
      expect(j['ltoAtivo'], true);
      expect(j['ltoTexto'], 'Só hoje!');
      expect(j.containsKey('rodape'), false);
    });

    test('carrossel: sem cabeçalho, rodapé, oferta nem botões soltos', () {
      final d = const DadosModelo(
        nome: 'vitrine',
        cabecalhoFormato: 'TEXT',
        cabecalhoTexto: 'Oi',
        rodape: 'r',
        ltoAtivo: true,
        botoes: [BotaoModelo(tipo: 'QUICK_REPLY', texto: 'Quero')],
        corpo: 'Escolha o seu.',
      ).comTipo('carrossel');
      expect(d.cartoes, hasLength(2), reason: 'a Meta exige pelo menos 2');
      final j = d.paraJson();
      expect(j.containsKey('cabecalhoFormato'), false);
      expect(j.containsKey('rodape'), false);
      expect(j['ltoAtivo'], false);
      expect(j['botoes'], isEmpty);
      expect(j['cartoes'], [
        {'corpo': '', 'botoes': <Object?>[]},
        {'corpo': '', 'botoes': <Object?>[]},
      ]);
      expect(d.comTipo('simples').cartoes, isEmpty);
    });

    test('trocar o formato do cabeçalho limpa o que o anterior usava', () {
      const imagem = DadosModelo(
        cabecalhoFormato: 'IMAGE',
        cabecalhoMidia: 'midia:foto',
      );
      // Uma imagem não serve de vídeo.
      expect(imagem.comCabecalho('VIDEO').cabecalhoMidia, '');
      expect(imagem.comCabecalho('IMAGE').cabecalhoMidia, 'midia:foto');
      final texto = const DadosModelo(
        cabecalhoFormato: 'TEXT',
        cabecalhoTexto: 'Oi {{1}}',
        cabecalhoExemplo: 'Ana',
      );
      expect(texto.cabecalhoTemVariavel, true);
      expect(texto.paraJson()['cabecalhoExemplo'], 'Ana');
      final sem = texto.comCabecalho(null);
      expect(sem.cabecalhoFormato, isNull);
      expect(sem.cabecalhoTexto, '');
      expect(sem.paraJson().containsKey('cabecalhoFormato'), false);
    });
  });

  group(
    'mídia do modelo (filtro antes de subir; quem decide é o servidor)',
    () {
      test('aceita o tipo certo do formato', () {
        expect(problemaDoArquivo('foto.JPG', 1000, 'IMAGE'), isNull);
        expect(problemaDoArquivo('foto.png', 1000, 'IMAGE'), isNull);
        expect(problemaDoArquivo('video.mp4', 1000, 'VIDEO'), isNull);
        expect(problemaDoArquivo('cardapio.pdf', null, 'DOCUMENT'), isNull);
      });

      test('recusa o formato que a Meta não aceita, dizendo qual é', () {
        expect(problemaDoArquivo('foto.webp', 10, 'IMAGE'), contains('.webp'));
        expect(problemaDoArquivo('video.mp4', 10, 'IMAGE'), contains('JPG'));
        expect(
          problemaDoArquivo('semextensao', 10, 'DOCUMENT'),
          contains('PDF'),
        );
      });

      test('recusa o que passa do teto do tipo', () {
        expect(
          problemaDoArquivo('foto.jpg', 5 * 1024 * 1024 + 1, 'IMAGE'),
          contains('5 MB'),
        );
        expect(problemaDoArquivo('foto.jpg', 5 * 1024 * 1024, 'IMAGE'), isNull);
        expect(
          problemaDoArquivo('video.mp4', 16 * 1024 * 1024 + 1, 'VIDEO'),
          contains('16 MB'),
        );
      });

      test('referência: arquivo guardado ou endereço', () {
        expect(idDaMidia('midia:123'), '123');
        expect(idDaMidia('https://x/y.jpg'), isNull);
        expect(ehEndereco('HTTPS://x/y.jpg'), true);
        expect(ehEndereco('midia:123'), false);
        expect(extensoesDoFormato('VIDEO'), ['mp4', '3gp']);
      });
    },
  );

  test('página de contatos sabe se tem mais', () {
    final p = PaginaContatos.deJson({
      'total': 120,
      'pagina': 2,
      'porPagina': 50,
      'itens': [
        {'id': 'a', 'telefone': '5521999998888', 'nome': ' ', 'optOut': true},
      ],
    });
    expect(p.temMais, true);
    expect(p.itens.single.nome, isNull);
    expect(p.itens.single.optOut, true);
  });
}
