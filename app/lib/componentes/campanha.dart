import 'package:flutter/material.dart';

import '../api/dados.dart';
import '../tema/cores.dart';
import '../util/formato.dart' as f;
import 'basicos.dart';
import 'categoria.dart';

/// Rótulo, tom e se o ponto pulsa — a situação da campanha em um lugar só,
/// para o Painel, a lista e o detalhe dizerem a mesma coisa (e com as mesmas
/// cores da web: cor que muda de significado entre telas ensina a pessoa a não
/// confiar em cor).
(String, TomPilula, bool) situacaoDaCampanha(ResumoCampanha c) =>
    switch (c.status) {
      'enviando' => ('Enviando', TomPilula.acento, true),
      'agendada' => ('Agendada', TomPilula.atencao, true),
      'pausada' => ('Pausada', TomPilula.erro, false),
      'concluida' => ('Concluída', TomPilula.sucesso, false),
      'cancelada' => ('Cancelada', TomPilula.neutro, false),
      _ => ('Rascunho', TomPilula.neutro, false),
    };

/// A situação de UMA mensagem.
(String, TomPilula) situacaoDoDestinatario(String status) => switch (status) {
  'lida' => ('Lida', TomPilula.sucesso),
  'entregue' => ('Entregue', TomPilula.acento),
  'enviada' => ('Enviada', TomPilula.atencao),
  'enviando' => ('Enviando', TomPilula.neutro),
  'falhou' => ('Falhou', TomPilula.erro),
  // Cancelado e descanso NÃO são falha: não saíram, e não contam no plano.
  'cancelado' => ('Cancelado', TomPilula.neutro),
  'descanso' => ('Em descanso', TomPilula.neutro),
  _ => ('Na fila', TomPilula.neutro),
};

/// Onde saiu o público, em uma linha: a lista, o público da base ou os
/// números digitados.
String publicoDaCampanha(ResumoCampanha c) =>
    c.listaNome ??
    c.publicoRotulo ??
    (c.publicoOrigem == null || c.publicoOrigem == 'numeros'
        ? 'Números digitados'
        : 'Da base');

/// Ordem do funil: do mais avançado ao que nem saiu, falha por último.
const _ordem = [
  'lida',
  'entregue',
  'enviada',
  'enviando',
  'pendente',
  'descanso',
  'cancelado',
  'falhou',
];

Color _corDoStatus(String status, Cores c) => switch (status) {
  'lida' => c.acento,
  'entregue' => c.realce,
  'enviada' => c.tintaSuave.withValues(alpha: 0.5),
  'enviando' => c.tintaSuave.withValues(alpha: 0.25),
  'falhou' => c.erro,
  _ => c.borda,
};

/// A campanha numa barra: quanto foi lido, entregue, enviado, o que está na
/// fila e o que falhou. O número vem na legenda — ninguém deve precisar medir
/// pixel para saber quantos falharam.
class BarraDeStatus extends StatelessWidget {
  const BarraDeStatus({super.key, required this.campanha, this.legenda = true});

  final ResumoCampanha campanha;
  final bool legenda;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final presentes = [
      for (final s in _ordem)
        if ((campanha.porStatus[s] ?? 0) > 0) s,
    ];
    final base = campanha.total < 1 ? 1 : campanha.total;
    final soma = presentes.fold<int>(
      0,
      (t, s) => t + (campanha.porStatus[s] ?? 0),
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Semantics(
          label: presentes
              .map(
                (s) =>
                    '${campanha.porStatus[s]} ${situacaoDoDestinatario(s).$1.toLowerCase()}',
              )
              .join(', '),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(99),
            child: SizedBox(
              height: 8,
              child: Row(
                children: [
                  for (final s in presentes)
                    Expanded(
                      flex: ((campanha.porStatus[s] ?? 0) * 1000 ~/ base).clamp(
                        1,
                        1000,
                      ),
                      child: Container(color: _corDoStatus(s, c)),
                    ),
                  if (soma < base)
                    Expanded(
                      flex: ((base - soma) * 1000 ~/ base).clamp(1, 1000),
                      child: Container(color: c.superficie2),
                    ),
                ],
              ),
            ),
          ),
        ),
        if (legenda && presentes.isNotEmpty) ...[
          const SizedBox(height: 8),
          Wrap(
            spacing: 14,
            runSpacing: 4,
            children: [
              for (final s in presentes)
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      width: 8,
                      height: 8,
                      decoration: BoxDecoration(
                        color: _corDoStatus(s, c),
                        shape: BoxShape.circle,
                      ),
                    ),
                    const SizedBox(width: 6),
                    Text(
                      '${f.numero(campanha.porStatus[s] ?? 0)} ${situacaoDoDestinatario(s).$1.toLowerCase()}',
                      style: TextStyle(fontSize: 12, color: c.tintaSuave),
                    ),
                  ],
                ),
            ],
          ),
        ],
      ],
    );
  }
}

/// Uma campanha num cartão: nome, situação, o modelo com o tipo, o público e
/// a barra de entrega.
class CartaoCampanha extends StatelessWidget {
  const CartaoCampanha({super.key, required this.campanha, this.aoTocar});

  final ResumoCampanha campanha;
  final VoidCallback? aoTocar;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final (rotulo, tom, vivo) = situacaoDaCampanha(campanha);
    final categoria = nomeDaCategoria(campanha.modeloCategoria);

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
          // Duas linhas: o modelo com o tipo, e o público com a data — numa
          // só, o nome do modelo sumia.
          Text(
            [campanha.modeloNome, ?categoria].join(' · '),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(fontSize: 12, color: c.tintaSuave),
          ),
          Text(
            '${publicoDaCampanha(campanha)} · ${f.quando(campanha.criadoEm)}',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(fontSize: 12, color: c.tintaSuave),
          ),
          const SizedBox(height: 12),
          BarraDeStatus(campanha: campanha, legenda: false),
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
