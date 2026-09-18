import 'package:flutter/material.dart';

/// A mensagem como ela chega no WhatsApp — as mesmas cores da prévia da web
/// (`frontend/src/components/app/previa-whatsapp.tsx`).
///
/// Ler `{{1}}` numa lista de campos não diz nada; ver a frase inteira no balão
/// diz na hora se o modelo serve. As variáveis aparecem destacadas, para a
/// pessoa ver onde entra o que muda de uma pessoa para outra.
class PreviaMensagem extends StatelessWidget {
  const PreviaMensagem({
    super.key,
    required this.corpo,
    this.cabecalho,
    this.cabecalhoMidia,
    this.rodape,
    this.botoes = const [],
  });

  final String corpo;
  final String? cabecalho;

  /// `IMAGE`, `VIDEO` ou `DOCUMENT`: mostra um espaço reservado com o tipo.
  final String? cabecalhoMidia;
  final String? rodape;

  /// (tipo, texto). O tipo decide o ícone; nulo = resposta rápida.
  final List<(String?, String)> botoes;

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

  /// Pinta `{{n}}` de destaque dentro do texto.
  static List<TextSpan> _comVariaveis(String texto, Color cor) {
    final partes = <TextSpan>[];
    final padrao = RegExp(r'\{\{\s*\d+\s*\}\}');
    var inicio = 0;
    for (final m in padrao.allMatches(texto)) {
      if (m.start > inicio) {
        partes.add(TextSpan(text: texto.substring(inicio, m.start)));
      }
      partes.add(
        TextSpan(
          text: m.group(0),
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
    final t = Theme.of(context).brightness == Brightness.dark
        ? _escuro
        : _claro;
    final temBotoes = botoes.isNotEmpty;
    const raio = Radius.circular(10);

    return Container(
      padding: const EdgeInsets.fromLTRB(14, 16, 40, 16),
      decoration: BoxDecoration(
        color: t.fundo,
        borderRadius: BorderRadius.circular(18),
      ),
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
                  Container(
                    height: 120,
                    margin: const EdgeInsets.only(bottom: 8),
                    decoration: BoxDecoration(
                      color: t.midia,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    alignment: Alignment.center,
                    child: Icon(
                      switch (cabecalhoMidia) {
                        'VIDEO' => Icons.play_circle_outline_rounded,
                        'DOCUMENT' => Icons.description_outlined,
                        _ => Icons.image_outlined,
                      },
                      size: 40,
                      color: t.secundario,
                    ),
                  ),
                if (cabecalho != null && cabecalho!.trim().isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 4),
                    child: Text.rich(
                      TextSpan(children: _comVariaveis(cabecalho!, t.botao)),
                      style: TextStyle(
                        color: t.texto,
                        fontWeight: FontWeight.w700,
                        fontSize: 15,
                      ),
                    ),
                  ),
                Text.rich(
                  TextSpan(children: _comVariaveis(corpo, t.botao)),
                  style: TextStyle(color: t.texto, fontSize: 14.5, height: 1.4),
                ),
                if (rodape != null && rodape!.trim().isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 6),
                    child: Text(
                      rodape!,
                      style: TextStyle(color: t.secundario, fontSize: 12.5),
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
            Container(
              decoration: const BoxDecoration(
                borderRadius: BorderRadius.only(
                  bottomLeft: raio,
                  bottomRight: raio,
                ),
              ),
              clipBehavior: Clip.antiAlias,
              child: Column(
                children: [
                  for (final (tipo, texto) in botoes)
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.symmetric(vertical: 10),
                      decoration: BoxDecoration(
                        color: t.balao,
                        border: Border(top: BorderSide(color: t.divisoria)),
                      ),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(_icone(tipo), size: 16, color: t.botao),
                          const SizedBox(width: 6),
                          Flexible(
                            child: Text(
                              texto.isEmpty ? 'Botão' : texto,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                color: t.botao,
                                fontWeight: FontWeight.w500,
                                fontSize: 14,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}
