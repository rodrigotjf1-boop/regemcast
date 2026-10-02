import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/erro_api.dart';
import '../api/leituras.dart';
import '../api/orcamento.dart';
import '../tema/cores.dart';
import 'basicos.dart';
import 'dialogos.dart';

/// O orçamento de disparos na tela da Conta: os tetos de gasto na Meta por
/// dia, por semana e por mês, e quanto já saiu em cada período.
///
/// Qualquer pessoa da conta vê; só o dono muda. As frases vêm prontas do
/// servidor, e é ele que confere o valor digitado.
class OrcamentoDeDisparosNaConta extends ConsumerStatefulWidget {
  const OrcamentoDeDisparosNaConta({super.key});

  @override
  ConsumerState<OrcamentoDeDisparosNaConta> createState() =>
      _OrcamentoDeDisparosNaContaState();
}

class _OrcamentoDeDisparosNaContaState
    extends ConsumerState<OrcamentoDeDisparosNaConta> {
  final _dia = TextEditingController();
  final _semana = TextEditingController();
  final _mes = TextEditingController();
  bool _editando = false;
  bool _salvando = false;
  String? _erro;

  @override
  void dispose() {
    _dia.dispose();
    _semana.dispose();
    _mes.dispose();
    super.dispose();
  }

  void _abrir(OrcamentoDeDisparos o) {
    _dia.text = o.campo('dia');
    _semana.text = o.campo('semana');
    _mes.text = o.campo('mes');
    setState(() {
      _editando = true;
      _erro = null;
    });
  }

  Future<void> _salvar() async {
    FocusScope.of(context).unfocus();
    setState(() {
      _salvando = true;
      _erro = null;
    });
    try {
      final salvo = await ref
          .read(servicoOrcamentoProvider)
          .definir(dia: _dia.text, semana: _semana.text, mes: _mes.text);
      if (!mounted) return;
      setState(() => _editando = false);
      avisar(
        context,
        salvo.periodos.isEmpty
            ? 'Orçamento removido. As campanhas saem sem teto de gasto.'
            : 'Orçamento salvo.',
      );
      ref.invalidate(orcamentoProvider);
      // Campanha pausada pelo orçamento pode ter voltado para a fila.
      ref.invalidate(campanhasProvider);
    } catch (e) {
      if (mounted) setState(() => _erro = mensagemDoErro(e));
    } finally {
      if (mounted) setState(() => _salvando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final carga = ref.watch(orcamentoProvider);
    return Column(
      key: const ValueKey('orcamento'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          'Orçamento de disparos',
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: 4),
        Text(
          'Quanto a conta aceita gastar na Meta por dia, por semana e por mês. Quando um teto é atingido, as campanhas pausam e voltam a sair sozinhas na virada do período.',
          style: TextStyle(color: c.tintaSuave, fontSize: 13, height: 1.45),
        ),
        const SizedBox(height: 14),
        carga.when(
          loading: () => const Esqueleto(altura: 64),
          error: (e, _) => EstadoErro(
            titulo: 'Não consegui ler o orçamento',
            mensagem: mensagemDoErro(e),
            aoTentar: () => ref.invalidate(orcamentoProvider),
          ),
          data: (o) => _conteudo(c, o),
        ),
      ],
    );
  }

  Widget _conteudo(Cores c, OrcamentoDeDisparos o) {
    final moeda = o.moeda == null || o.moeda == 'BRL' ? r'R$' : o.moeda!;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (o.periodos.isEmpty && !_editando)
          Text(
            o.podeMudar
                ? 'Sem orçamento definido: as campanhas saem sem teto de gasto.'
                : 'Sem orçamento definido: as campanhas saem sem teto de gasto. Só o dono da conta define o orçamento.',
            style: const TextStyle(fontSize: 13.5, height: 1.45),
          ),
        for (final p in o.periodos) ...[
          _Periodo(periodo: p),
          const SizedBox(height: 14),
        ],
        for (final a in o.avisos) ...[
          Aviso(texto: a, icone: Icons.info_outline_rounded),
          const SizedBox(height: 10),
        ],
        if (!o.podeMudar && o.periodos.isNotEmpty)
          Text(
            'Só o dono da conta muda o orçamento.',
            style: TextStyle(color: c.tintaSuave, fontSize: 12.5),
          ),
        if (o.podeMudar && !_editando) ...[
          if (o.periodos.isEmpty) const SizedBox(height: 12),
          Align(
            alignment: Alignment.centerLeft,
            child: OutlinedButton(
              key: const ValueKey('orcamento-alterar'),
              style: OutlinedButton.styleFrom(minimumSize: const Size(0, 44)),
              onPressed: () => _abrir(o),
              child: Text(o.periodos.isEmpty ? 'Definir orçamento' : 'Alterar'),
            ),
          ),
        ],
        if (_editando) ...[
          for (final (chave, rotulo, exemplo, controle) in [
            ('dia', 'Por dia', '50,00', _dia),
            ('semana', 'Por semana', '300,00', _semana),
            ('mes', 'Por mês', '1.000,00', _mes),
          ]) ...[
            TextField(
              key: ValueKey('orcamento-$chave'),
              controller: controle,
              enabled: !_salvando,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              decoration: InputDecoration(
                labelText: '$rotulo ($moeda)',
                hintText: exemplo,
              ),
            ),
            const SizedBox(height: 10),
          ],
          Text(
            'Deixe vazio para não ter teto naquele período. A semana vai de segunda a domingo. Conta o que saiu no período, pelo preço da Meta para cada mensagem; a que falha ou sai de graça deixa de contar.',
            style: TextStyle(color: c.tintaSuave, fontSize: 12.5, height: 1.4),
          ),
          if (_erro != null) ...[
            const SizedBox(height: 10),
            Aviso(
              key: const ValueKey('orcamento-erro'),
              texto: _erro!,
              tom: TomPilula.erro,
              icone: Icons.error_outline_rounded,
            ),
          ],
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              FilledButton(
                key: const ValueKey('orcamento-salvar'),
                style: FilledButton.styleFrom(minimumSize: const Size(0, 44)),
                onPressed: _salvando ? null : _salvar,
                child: _salvando
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Text('Salvar orçamento'),
              ),
              if (!_salvando)
                TextButton(
                  key: const ValueKey('orcamento-cancelar'),
                  onPressed: () => setState(() {
                    _editando = false;
                    _erro = null;
                  }),
                  child: const Text('Cancelar'),
                ),
            ],
          ),
        ],
      ],
    );
  }
}

class _Periodo extends StatelessWidget {
  const _Periodo({required this.periodo});
  final PeriodoDoOrcamento periodo;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final cor = switch (periodo.sinal) {
      'cheio' => c.erro,
      'atencao' => c.atencao,
      _ => c.acento,
    };
    return Column(
      key: ValueKey('orcamento-periodo-${periodo.periodo}'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Wrap(
          alignment: WrapAlignment.spaceBetween,
          spacing: 8,
          children: [
            Text(
              periodo.rotulo,
              style: TextStyle(color: c.tintaSuave, fontSize: 12.5),
            ),
            Text(
              periodo.zera,
              style: TextStyle(color: c.tintaSuave, fontSize: 12.5),
            ),
          ],
        ),
        const SizedBox(height: 2),
        Text(
          periodo.texto,
          style: const TextStyle(
            fontSize: 15,
            fontWeight: FontWeight.w600,
            fontFeatures: [FontFeature.tabularFigures()],
          ),
        ),
        const SizedBox(height: 6),
        ClipRRect(
          borderRadius: BorderRadius.circular(99),
          child: LinearProgressIndicator(
            value: periodo.percentual / 100,
            minHeight: 8,
            color: cor,
            backgroundColor: c.superficie2,
            semanticsLabel: '${periodo.rotulo}: ${periodo.texto}',
          ),
        ),
      ],
    );
  }
}
