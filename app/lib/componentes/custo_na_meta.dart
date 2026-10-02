import 'package:flutter/material.dart';

import '../api/custo.dart';
import '../tema/cores.dart';
import 'basicos.dart';

/// Quanto a campanha custa na Meta: a estimativa antes de disparar, o gasto e
/// o que ainda pode sair depois. As frases vêm prontas do servidor.

/// O cartão do detalhe da campanha.
class CartaoDoCusto extends StatelessWidget {
  const CartaoDoCusto({super.key, required this.custo});
  final CustoNaMeta custo;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    return Cartao(
      key: const ValueKey('cd-custo'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text(
            'Custo na Meta',
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
          ),
          for (final l in custo.linhas) ...[
            const SizedBox(height: 12),
            Text(
              l.rotulo,
              style: TextStyle(color: c.tintaSuave, fontSize: 12.5),
            ),
            const SizedBox(height: 2),
            Text(
              l.valor,
              style: const TextStyle(
                fontSize: 22,
                fontWeight: FontWeight.w600,
                fontFeatures: [FontFeature.tabularFigures()],
              ),
            ),
            if (l.detalhe != null)
              Text(
                l.detalhe!,
                style: TextStyle(color: c.tintaSuave, fontSize: 12.5),
              ),
          ],
          for (final a in custo.avisos) ...[
            const SizedBox(height: 12),
            _Aviso(texto: a),
          ],
          if (custo.nota != null) ...[
            const SizedBox(height: 12),
            Text(
              custo.nota!,
              style: TextStyle(
                color: c.tintaSuave,
                fontSize: 12.5,
                height: 1.4,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// A estimativa na montagem da campanha, junto de "quantas pessoas vão receber".
class CustoDaPrevia extends StatelessWidget {
  const CustoDaPrevia({super.key, required this.custo});
  final CustoNaMeta custo;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    return Material(
      key: const ValueKey('c-custo'),
      color: c.superficie2,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: BorderSide(color: c.borda),
      ),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            for (final l in custo.linhas)
              Text.rich(
                TextSpan(
                  children: [
                    TextSpan(text: '${l.rotulo}: '),
                    TextSpan(
                      text: l.valor,
                      style: const TextStyle(fontWeight: FontWeight.w600),
                    ),
                    if (l.detalhe != null)
                      TextSpan(
                        text: ' (${l.detalhe})',
                        style: TextStyle(color: c.tintaSuave),
                      ),
                  ],
                ),
                style: const TextStyle(fontSize: 13.5, height: 1.45),
              ),
            for (final a in custo.avisos)
              Text(a, style: const TextStyle(fontSize: 13.5, height: 1.45)),
            if (custo.nota != null) ...[
              const SizedBox(height: 4),
              Text(
                custo.nota!,
                style: TextStyle(
                  color: c.tintaSuave,
                  fontSize: 12.5,
                  height: 1.4,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _Aviso extends StatelessWidget {
  const _Aviso({required this.texto});
  final String texto;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: c.atencao.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: c.atencao.withValues(alpha: 0.30)),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        child: Text(texto, style: const TextStyle(fontSize: 13, height: 1.4)),
      ),
    );
  }
}
