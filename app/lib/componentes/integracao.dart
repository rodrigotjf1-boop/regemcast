import 'package:flutter/material.dart';

import '../tema/cores.dart';
import 'basicos.dart';

/// As peças dos cartões de integração (Cardápio Web, Regem): o bloco com
/// título e selo, o número em destaque e a grade de dois em dois.

/// Um bloco do cartão (Clientes, Compras, Cashback, 99…): título e o selo.
class BlocoIntegracao extends StatelessWidget {
  const BlocoIntegracao({
    super.key,
    required this.titulo,
    required this.selo,
    required this.tom,
    required this.filhos,
    this.vivo = false,
    this.chave,
  });

  final String titulo;
  final String selo;
  final TomPilula tom;
  final bool vivo;
  final List<Widget> filhos;

  /// O nome da chave do bloco (`bloco-…`); sem ele, o título.
  final String? chave;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    return Container(
      key: ValueKey('bloco-${chave ?? titulo}'),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: c.borda),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  titulo,
                  style: const TextStyle(fontWeight: FontWeight.w600),
                ),
              ),
              Pilula(selo, tom: tom, vivo: vivo),
            ],
          ),
          const SizedBox(height: 10),
          ...filhos,
        ],
      ),
    );
  }
}

/// Um número do cartão: rótulo pequeno em cima, valor em destaque.
class NumeroIntegracao extends StatelessWidget {
  const NumeroIntegracao({
    super.key,
    required this.rotulo,
    required this.valor,
  });

  final String rotulo;
  final String valor;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: c.superficie2,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(rotulo, style: TextStyle(color: c.tintaSuave, fontSize: 12)),
          Text(
            valor,
            style: const TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w700,
              fontFeatures: [FontFeature.tabularFigures()],
            ),
          ),
        ],
      ),
    );
  }
}

/// Os números de dois em dois, cada um com metade da largura.
Widget gradeDeNumeros(List<Widget> numeros) => LayoutBuilder(
  builder: (_, limites) {
    final largura = (limites.maxWidth - 8) / 2;
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [for (final n in numeros) SizedBox(width: largura, child: n)],
    );
  },
);
