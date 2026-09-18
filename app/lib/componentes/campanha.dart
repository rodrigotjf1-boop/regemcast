import 'package:flutter/material.dart';

import '../api/dados.dart';
import '../tema/cores.dart';
import '../util/formato.dart' as f;
import 'basicos.dart';

/// Rótulo, tom e se o ponto pulsa — a situação da campanha em um lugar só,
/// para o Painel, a lista e o detalhe dizerem a mesma coisa.
(String, TomPilula, bool) situacaoDaCampanha(ResumoCampanha c) =>
    switch (c.status) {
      'enviando' => ('Enviando', TomPilula.acento, true),
      'agendada' => ('Agendada', TomPilula.neutro, false),
      'pausada' => ('Pausada', TomPilula.atencao, false),
      'concluida' => ('Concluída', TomPilula.sucesso, false),
      'cancelada' => ('Cancelada', TomPilula.neutro, false),
      _ => ('Rascunho', TomPilula.neutro, false),
    };

/// Uma campanha em uma linha: nome, situação e a barra de entrega.
class CartaoCampanha extends StatelessWidget {
  const CartaoCampanha({super.key, required this.campanha, this.aoTocar});

  final ResumoCampanha campanha;
  final VoidCallback? aoTocar;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final (rotulo, tom, vivo) = situacaoDaCampanha(campanha);
    final total = campanha.total == 0 ? 1 : campanha.total;
    final entregue = campanha.entregues / total;
    final saiu = campanha.sairam / total;

    return Cartao(
      aoTocar: aoTocar,
      destaque: campanha.status == 'enviando',
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  campanha.nome,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Pilula(rotulo, tom: tom, vivo: vivo),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            [
              campanha.modeloNome,
              if (campanha.listaNome != null) campanha.listaNome!,
              f.quando(campanha.criadoEm),
            ].join(' · '),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(fontSize: 12, color: c.tintaSuave),
          ),
          const SizedBox(height: 12),
          // Duas camadas: o que saiu (claro) e o que foi entregue (lima).
          // "Saiu" não é "chegou" — a barra mostra a diferença.
          ClipRRect(
            borderRadius: BorderRadius.circular(99),
            child: SizedBox(
              height: 8,
              child: Stack(
                children: [
                  Container(color: c.superficie2),
                  FractionallySizedBox(
                    widthFactor: saiu.clamp(0, 1),
                    child: Container(color: c.borda),
                  ),
                  FractionallySizedBox(
                    widthFactor: entregue.clamp(0, 1),
                    child: Container(color: c.acento),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Text(
                '${f.numero(campanha.entregues)} de ${f.numero(campanha.total)} entregues',
                style: TextStyle(fontSize: 12, color: c.tintaSuave),
              ),
              const Spacer(),
              if (campanha.falhas > 0)
                Text(
                  '${f.numero(campanha.falhas)} falhas',
                  style: TextStyle(
                    fontSize: 12,
                    color: c.erro,
                    fontWeight: FontWeight.w600,
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }
}
