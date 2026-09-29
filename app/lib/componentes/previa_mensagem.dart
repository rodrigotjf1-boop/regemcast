import 'package:flutter/material.dart';

/// Um cartão do carrossel, como a prévia desenha.
class CartaoPrevia {
  const CartaoPrevia({
    required this.corpo,
    this.imagem,
    this.botoes = const [],
  });

  final String corpo;

  /// A imagem do cartão, quando já dá para mostrar.
  final ImageProvider? imagem;

  /// (tipo, texto).
  final List<(String?, String)> botoes;
}

/// A mensagem como ela chega no WhatsApp — as mesmas cores da prévia da web
/// (`frontend/src/components/app/previa-whatsapp.tsx`).
///
/// Ler `{{1}}` numa lista de campos não diz nada; ver a frase inteira no balão
/// diz na hora se o modelo serve. Com `exemplos`, as variáveis aparecem
/// preenchidas — que é como a mensagem chega de verdade — e destacadas, para a
/// pessoa ver onde entra o que muda de uma pessoa para outra.
class PreviaMensagem extends StatelessWidget {
  const PreviaMensagem({
    super.key,
    required this.corpo,
    this.cabecalho,
    this.cabecalhoExemplo,
    this.cabecalhoMidia,
    this.imagemCabecalho,
    this.rodape,
    this.oferta,
    this.botoes = const [],
    this.cartoes = const [],
    this.exemplos,
    this.escuro,
  });

  final String corpo;
  final String? cabecalho;

  /// O valor de `{{1}}` no cabeçalho de texto, quando há exemplos.
  final String? cabecalhoExemplo;

  /// `IMAGE`, `VIDEO` ou `DOCUMENT`.
  final String? cabecalhoMidia;

  /// A imagem do cabeçalho, quando já dá para mostrar. Sem ela, um espaço
  /// reservado com o tipo.
  final ImageProvider? imagemCabecalho;
  final String? rodape;

  /// O texto da oferta por tempo limitado: aparece com o contador, como no
  /// WhatsApp.
  final String? oferta;

  /// (tipo, texto). O tipo decide o ícone; nulo = resposta rápida.
  final List<(String?, String)> botoes;

  /// Os cartões do carrossel, abaixo do balão.
  final List<CartaoPrevia> cartoes;

  /// Um por variável distinta, na ordem de `{{1}}`, `{{2}}`… Nulo = mostrar
  /// as variáveis como estão, destacadas.
  final List<String>? exemplos;

  /// Força o tema do WhatsApp (metade das pessoas usa no escuro, e o contraste
  /// muda). Nulo = o tema do app.
  final bool? escuro;

  static const _claro = (
    fundo: Color(0xFFE5DDD5),
    balao: Color(0xFFFFFFFF),
    texto: Color(0xFF111B21),
    secundario: Color(0xFF667781),
    divisoria: Color(0xFFE9EDEF),
    botao: Color(0xFF027EB5),
    midia: Color(0xFFD7D0C6),
  );

  static const _escuro = (
    fundo: Color(0xFF0B141A),
    balao: Color(0xFF1F2C34),
    texto: Color(0xFFE9EDEF),
    secundario: Color(0xFF8696A0),
    divisoria: Color(0xFF2A3942),
    botao: Color(0xFF53BDEB),
    midia: Color(0xFF2A3942),
  );

  static IconData _icone(String? tipo) => switch (tipo) {
    'URL' => Icons.open_in_new_rounded,
    'PHONE_NUMBER' => Icons.call_rounded,
    'COPY_CODE' => Icons.copy_rounded,
    _ => Icons.reply_rounded,
  };

  static final _variavel = RegExp(r'\{\{\s*(\d+)\s*\}\}');

  /// O texto com cada `{{n}}` destacado — trocado pelo exemplo, quando há.
  static List<TextSpan> _comVariaveis(
    String texto,
    Color cor,
    String? Function(int n)? exemplo,
  ) {
    final partes = <TextSpan>[];
    var inicio = 0;
    for (final m in _variavel.allMatches(texto)) {
      if (m.start > inicio) {
        partes.add(TextSpan(text: texto.substring(inicio, m.start)));
      }
      final n = int.parse(m.group(1)!);
      partes.add(
        TextSpan(
          text: exemplo == null ? m.group(0) : exemplo(n),
          style: TextStyle(
            color: cor,
            fontWeight: FontWeight.w600,
            backgroundColor: cor.withValues(alpha: 0.12),
          ),
        ),
      );
      inicio = m.end;
    }
    if (inicio < texto.length) {
      partes.add(TextSpan(text: texto.substring(inicio)));
    }
    return partes;
  }

  @override
  Widget build(BuildContext context) {
    final noEscuro = escuro ?? Theme.of(context).brightness == Brightness.dark;
    final t = noEscuro ? _escuro : _claro;
    final temBotoes = botoes.isNotEmpty;
    const raio = Radius.circular(10);

    // O exemplo de cada variável, pela posição dela entre as distintas — como
    // a web faz. Vazio vira "exemplo n", para a frase não ficar com buraco.
    String? Function(int)? doCorpo;
    if (exemplos != null) {
      final distintas =
          _variavel
              .allMatches(corpo)
              .map((m) => int.parse(m.group(1)!))
              .toSet()
              .toList()
            ..sort();
      doCorpo = (n) {
        final i = distintas.indexOf(n);
        final valor = i >= 0 && i < exemplos!.length ? exemplos![i].trim() : '';
        return valor.isEmpty ? 'exemplo $n' : valor;
      };
    }
    final doCabecalho = exemplos == null
        ? null
        : (int _) => (cabecalhoExemplo ?? '').trim().isEmpty
              ? 'exemplo'
              : cabecalhoExemplo!.trim();

    final textoCorpo = corpo.trim().isEmpty
        ? 'Sua mensagem aparece aqui.'
        : corpo;

    return Container(
      padding: const EdgeInsets.fromLTRB(14, 16, 14, 16),
      decoration: BoxDecoration(
        color: t.fundo,
        borderRadius: BorderRadius.circular(18),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            // O balão recebido não ocupa a largura toda.
            padding: const EdgeInsets.only(right: 26),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
                  decoration: BoxDecoration(
                    color: t.balao,
                    borderRadius: temBotoes
                        ? const BorderRadius.only(
                            topRight: raio,
                            bottomRight: Radius.circular(2),
                            bottomLeft: Radius.circular(2),
                          )
                        : const BorderRadius.only(
                            topRight: raio,
                            bottomRight: raio,
                            bottomLeft: raio,
                          ),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (cabecalhoMidia != null)
                        _MidiaDoCabecalho(
                          formato: cabecalhoMidia!,
                          imagem: imagemCabecalho,
                          fundo: t.midia,
                          secundario: t.secundario,
                          texto: t.texto,
                        ),
                      if (oferta != null)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 4),
                          child: Row(
                            children: [
                              Icon(
                                Icons.hourglass_bottom_rounded,
                                size: 15,
                                color: t.botao,
                              ),
                              const SizedBox(width: 4),
                              Flexible(
                                child: Text(
                                  '${oferta!.trim().isEmpty ? 'Oferta!' : oferta!.trim()} · termina em 23:59',
                                  style: TextStyle(
                                    color: t.botao,
                                    fontWeight: FontWeight.w600,
                                    fontSize: 13,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      if (cabecalho != null && cabecalho!.trim().isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 4),
                          child: Text.rich(
                            TextSpan(
                              children: _comVariaveis(
                                cabecalho!,
                                t.botao,
                                doCabecalho,
                              ),
                            ),
                            style: TextStyle(
                              color: t.texto,
                              fontWeight: FontWeight.w700,
                              fontSize: 15,
                            ),
                          ),
                        ),
                      Text.rich(
                        TextSpan(
                          children: _comVariaveis(textoCorpo, t.botao, doCorpo),
                        ),
                        style: TextStyle(
                          color: t.texto,
                          fontSize: 14.5,
                          height: 1.4,
                        ),
                      ),
                      if (rodape != null && rodape!.trim().isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.only(top: 6),
                          child: Text(
                            rodape!,
                            style: TextStyle(
                              color: t.secundario,
                              fontSize: 12.5,
                            ),
                          ),
                        ),
                      Align(
                        alignment: Alignment.centerRight,
                        child: Text(
                          '12:30',
                          style: TextStyle(color: t.secundario, fontSize: 11),
                        ),
                      ),
                    ],
                  ),
                ),
                if (temBotoes)
                  ClipRRect(
                    borderRadius: const BorderRadius.only(
                      bottomLeft: raio,
                      bottomRight: raio,
                    ),
                    child: Column(
                      children: [
                        for (final (tipo, texto) in botoes)
                          _BotaoDaMensagem(
                            icone: _icone(tipo),
                            texto: texto,
                            fundo: t.balao,
                            divisoria: t.divisoria,
                            cor: t.botao,
                          ),
                      ],
                    ),
                  ),
              ],
            ),
          ),
          if (cartoes.isNotEmpty) ...[
            const SizedBox(height: 8),
            // Os cartões rolam na horizontal, como no aparelho, todos da mesma
            // altura — o texto mais curto não encolhe o cartão.
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: IntrinsicHeight(
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    for (var i = 0; i < cartoes.length; i++) ...[
                      if (i > 0) const SizedBox(width: 8),
                      _CartaoDoCarrossel(
                        cartao: cartoes[i],
                        balao: t.balao,
                        midia: t.midia,
                        texto: t.texto,
                        secundario: t.secundario,
                        divisoria: t.divisoria,
                        botao: t.botao,
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _BotaoDaMensagem extends StatelessWidget {
  const _BotaoDaMensagem({
    required this.icone,
    required this.texto,
    required this.fundo,
    required this.divisoria,
    required this.cor,
    this.tamanho = 14,
  });

  final IconData icone;
  final String texto;
  final Color fundo;
  final Color divisoria;
  final Color cor;
  final double tamanho;

  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 8),
    decoration: BoxDecoration(
      color: fundo,
      border: Border(top: BorderSide(color: divisoria)),
    ),
    child: Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Icon(icone, size: tamanho + 2, color: cor),
        const SizedBox(width: 6),
        Flexible(
          child: Text(
            texto.isEmpty ? 'Botão' : texto,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              color: cor,
              fontWeight: FontWeight.w500,
              fontSize: tamanho,
            ),
          ),
        ),
      ],
    ),
  );
}

/// A mídia no topo do balão, como o WhatsApp mostra: a imagem de verdade (é o
/// que a pessoa precisa conferir); vídeo e documento como ele os desenha antes
/// de tocar.
class _MidiaDoCabecalho extends StatelessWidget {
  const _MidiaDoCabecalho({
    required this.formato,
    required this.imagem,
    required this.fundo,
    required this.secundario,
    required this.texto,
  });

  final String formato;
  final ImageProvider? imagem;
  final Color fundo;
  final Color secundario;
  final Color texto;

  @override
  Widget build(BuildContext context) {
    if (formato == 'DOCUMENT') {
      return Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
        decoration: BoxDecoration(
          color: fundo,
          borderRadius: BorderRadius.circular(8),
        ),
        child: Row(
          children: [
            Icon(Icons.description_outlined, size: 22, color: secundario),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                'documento.pdf',
                overflow: TextOverflow.ellipsis,
                style: TextStyle(color: texto, fontSize: 13),
              ),
            ),
          ],
        ),
      );
    }
    if (formato == 'VIDEO') {
      return Container(
        height: 140,
        margin: const EdgeInsets.only(bottom: 8),
        decoration: BoxDecoration(
          color: const Color(0xCC000000),
          borderRadius: BorderRadius.circular(8),
        ),
        alignment: Alignment.center,
        child: Container(
          width: 40,
          height: 40,
          decoration: const BoxDecoration(
            color: Color(0xE6FFFFFF),
            shape: BoxShape.circle,
          ),
          child: const Icon(Icons.play_arrow_rounded, color: Colors.black),
        ),
      );
    }
    return Container(
      height: 150,
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: fundo,
        borderRadius: BorderRadius.circular(8),
        image: imagem == null
            ? null
            : DecorationImage(image: imagem!, fit: BoxFit.cover),
      ),
      alignment: Alignment.center,
      child: imagem == null
          ? Text(
              'Escolha a imagem',
              style: TextStyle(color: secundario, fontSize: 12.5),
            )
          : null,
    );
  }
}

class _CartaoDoCarrossel extends StatelessWidget {
  const _CartaoDoCarrossel({
    required this.cartao,
    required this.balao,
    required this.midia,
    required this.texto,
    required this.secundario,
    required this.divisoria,
    required this.botao,
  });

  final CartaoPrevia cartao;
  final Color balao;
  final Color midia;
  final Color texto;
  final Color secundario;
  final Color divisoria;
  final Color botao;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(10),
      child: Container(
        width: 190,
        color: balao,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Container(
              height: 110,
              decoration: BoxDecoration(
                color: midia,
                image: cartao.imagem == null
                    ? null
                    : DecorationImage(image: cartao.imagem!, fit: BoxFit.cover),
              ),
              alignment: Alignment.center,
              child: cartao.imagem == null
                  ? Text(
                      'sem imagem',
                      style: TextStyle(color: secundario, fontSize: 12),
                    )
                  : null,
            ),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
                child: Text(
                  cartao.corpo.trim().isEmpty
                      ? 'Texto do cartão'
                      : cartao.corpo,
                  maxLines: 3,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: texto, fontSize: 13.5, height: 1.35),
                ),
              ),
            ),
            for (final (tipo, t) in cartao.botoes)
              _BotaoDaMensagem(
                icone: PreviaMensagem._icone(tipo),
                texto: t,
                fundo: balao,
                divisoria: divisoria,
                cor: botao,
                tamanho: 13,
              ),
          ],
        ),
      ),
    );
  }
}
