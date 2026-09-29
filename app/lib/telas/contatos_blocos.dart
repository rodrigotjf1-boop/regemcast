import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/contatos.dart';
import '../api/erro_api.dart';
import '../componentes/basicos.dart';
import '../componentes/contato.dart';
import '../componentes/dialogos.dart';
import '../tema/cores.dart';
import '../util/formato.dart' as f;
import 'campanha_detalhe.dart';
import 'campanha_formulario.dart';
import 'dividir_em_blocos.dart';

/// Os blocos (com o resultado de cada um já enviado) e as listas comuns.
///
/// É o que deixa "aquecer" uma lista fria: o bloco 1 saiu, a tela mostra
/// quantos receberam, quantos leram e quantos pediram para sair — e só então
/// o dono decide mandar o próximo. O próximo bloco ainda não usado fica
/// marcado.
class VistaBlocos extends ConsumerWidget {
  const VistaBlocos({
    super.key,
    required this.ehDono,
    required this.naBase,
    required this.aoDividir,
  });

  final bool ehDono;

  /// Quantos da base podem receber (nulo enquanto não se sabe).
  final int? naBase;
  final ValueChanged<AlvoDaDivisao> aoDividir;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = Cores.de(context);
    final divisoes = ref.watch(divisoesProvider);
    final listas = ref.watch(listasContatosProvider);
    // Os blocos aparecem na seção deles; aqui embaixo, só as listas comuns.
    final comuns = (listas.value ?? const <ListaContatos>[])
        .where((l) => !l.ehBloco)
        .toList();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const TituloDeSecao(
          'Blocos',
          nota: 'Cada bloco é uma lista: escolha o bloco ao montar a campanha.',
        ),
        const SizedBox(height: 10),
        divisoes.when(
          loading: () => const Cartao(child: Esqueleto(altura: 90)),
          error: (e, _) => EstadoErro(
            titulo: 'Não consegui ler os blocos',
            mensagem: mensagemDoErro(e),
            aoTentar: () => ref.invalidate(divisoesProvider),
          ),
          data: (ds) => ds.isEmpty
              ? Cartao(
                  padding: const EdgeInsets.all(20),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Nenhum bloco ainda',
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                      const SizedBox(height: 6),
                      Text(
                        'Dividir em blocos separa o envio: um bloco por vez, dentro do limite do seu número, olhando o resultado de cada um antes de mandar o próximo. Dá para dividir a base inteira, uma lista, um perfil, um público ou uma região.',
                        style: TextStyle(color: c.tintaSuave, height: 1.45),
                      ),
                      if ((naBase ?? 0) > 0) ...[
                        const SizedBox(height: 14),
                        OutlinedButton.icon(
                          onPressed: () => aoDividir(
                            AlvoDaDivisao(
                              origem: 'base',
                              rotulo: 'Base inteira',
                              total: naBase,
                            ),
                          ),
                          icon: const Icon(Icons.view_module_outlined),
                          label: const Text('Dividir a base em blocos'),
                        ),
                      ],
                    ],
                  ),
                )
              : Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    for (final d in ds) ...[
                      _CartaoDivisao(divisao: d, ehDono: ehDono),
                      const SizedBox(height: 12),
                    ],
                  ],
                ),
        ),
        if (comuns.isNotEmpty) ...[
          const SizedBox(height: 18),
          const TituloDeSecao(
            'Listas',
            nota: 'A contagem exclui quem pediu para sair.',
          ),
          const SizedBox(height: 10),
          for (final l in comuns) ...[
            Cartao(
              key: ValueKey('lista-${l.id}'),
              padding: const EdgeInsets.fromLTRB(14, 12, 8, 12),
              child: Row(
                children: [
                  _Icone(icone: Icons.people_outline_rounded),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          l.nome,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontWeight: FontWeight.w600),
                        ),
                        Text(
                          '${f.plural(l.total, 'pessoa', 'pessoas')} · ${f.data(l.criadoEm)}',
                          style: TextStyle(color: c.tintaSuave, fontSize: 12.5),
                        ),
                      ],
                    ),
                  ),
                  if (l.total > 0)
                    TextButton(
                      key: ValueKey('dividir-lista-${l.id}'),
                      onPressed: () => aoDividir(
                        AlvoDaDivisao(
                          origem: 'lista',
                          origemId: l.id,
                          rotulo: l.nome,
                          total: l.total,
                        ),
                      ),
                      child: const Text('Dividir'),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 8),
          ],
        ],
      ],
    );
  }
}

class _Icone extends StatelessWidget {
  const _Icone({required this.icone});

  final IconData icone;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final escuro = Theme.of(context).brightness == Brightness.dark;
    return Container(
      width: 40,
      height: 40,
      decoration: BoxDecoration(
        color: c.realce.withValues(alpha: escuro ? .16 : .35),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Icon(icone, size: 20, color: escuro ? c.realce : c.tinta),
    );
  }
}

class _CartaoDivisao extends ConsumerStatefulWidget {
  const _CartaoDivisao({required this.divisao, required this.ehDono});

  final DivisaoDeBlocos divisao;
  final bool ehDono;

  @override
  ConsumerState<_CartaoDivisao> createState() => _CartaoDivisaoState();
}

class _CartaoDivisaoState extends ConsumerState<_CartaoDivisao> {
  bool _apagando = false;

  Future<void> _apagar() async {
    final d = widget.divisao;
    final ok = await confirmar(
      context,
      titulo: 'Apagar os blocos?',
      texto:
          'Apagar "${d.nome}" e os ${f.numero(d.totalBlocos)} blocos dela? Os contatos continuam na base.',
      botao: 'Apagar',
      perigo: true,
    );
    if (!ok || !mounted) return;
    setState(() => _apagando = true);
    try {
      await ref.read(servicoContatosProvider).apagarDivisao(d.id);
      if (!mounted) return;
      ref
        ..invalidate(divisoesProvider)
        ..invalidate(listasContatosProvider);
      avisar(context, 'Blocos apagados. Os contatos continuam na base.');
    } catch (e) {
      if (mounted) avisar(context, mensagemDoErro(e));
    } finally {
      if (mounted) setState(() => _apagando = false);
    }
  }

  Future<void> _usar(BlocoDaDivisao b) async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => TelaFormularioCampanha(listaInicial: b.id),
      ),
    );
    ref.invalidate(divisoesProvider);
  }

  void _abrirCampanha(UsoDoBloco u) => Navigator.of(context).push(
    MaterialPageRoute<void>(
      builder: (_) =>
          TelaCampanhaDetalhe(id: u.campanhaId, nomeInicial: u.campanhaNome),
    ),
  );

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final d = widget.divisao;
    final proximo = d.proximo;
    final casas = '${d.totalBlocos}'.length < 2 ? 2 : '${d.totalBlocos}'.length;
    return Cartao(
      key: ValueKey('divisao-${d.id}'),
      padding: const EdgeInsets.fromLTRB(14, 14, 14, 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const _Icone(icone: Icons.view_module_outlined),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      d.nome,
                      style: const TextStyle(fontWeight: FontWeight.w600),
                    ),
                    Text(
                      '${f.numero(d.totalContatos)} pessoas em ${f.plural(d.totalBlocos, 'bloco', 'blocos')} de ${f.numero(d.tamanho)} · ${ordemDaDivisao(d.ordem)}',
                      style: TextStyle(color: c.tintaSuave, fontSize: 12.5),
                    ),
                  ],
                ),
              ),
            ],
          ),
          if (d.soNuncaReceberam || (widget.ehDono && !d.usada)) ...[
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                if (d.soNuncaReceberam)
                  const Pilula('Só quem nunca recebeu', ponto: false),
                if (widget.ehDono && !d.usada)
                  TextButton.icon(
                    key: ValueKey('apagar-divisao-${d.id}'),
                    style: TextButton.styleFrom(foregroundColor: c.erro),
                    onPressed: _apagando ? null : _apagar,
                    icon: _apagando
                        ? const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.delete_outline_rounded, size: 18),
                    label: const Text('Apagar'),
                  ),
              ],
            ),
          ],
          const SizedBox(height: 10),
          Container(
            decoration: BoxDecoration(
              border: Border.all(color: c.borda),
              borderRadius: BorderRadius.circular(14),
            ),
            clipBehavior: Clip.antiAlias,
            child: Column(
              children: [
                for (var i = 0; i < d.blocos.length; i++) ...[
                  if (i > 0) Divider(height: 1, color: c.borda),
                  _LinhaDoBloco(
                    bloco: d.blocos[i],
                    casas: casas,
                    proximo: d.blocos[i].id == proximo,
                    aoUsar: _usar,
                    aoAbrirCampanha: _abrirCampanha,
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _LinhaDoBloco extends StatelessWidget {
  const _LinhaDoBloco({
    required this.bloco,
    required this.casas,
    required this.proximo,
    required this.aoUsar,
    required this.aoAbrirCampanha,
  });

  final BlocoDaDivisao bloco;

  /// Quantos dígitos o número do bloco leva ("Bloco 01").
  final int casas;
  final bool proximo;
  final ValueChanged<BlocoDaDivisao> aoUsar;
  final ValueChanged<UsoDoBloco> aoAbrirCampanha;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final b = bloco;
    final ultimo = b.usos.isEmpty ? null : b.usos.last;
    final suave = TextStyle(color: c.tintaSuave, fontSize: 12.5, height: 1.4);
    final numero = TextStyle(
      color: c.tinta,
      fontFeatures: const [FontFeature.tabularFigures()],
    );
    return Container(
      key: ValueKey('bloco-${b.id}'),
      color: proximo ? c.acentoSuave : null,
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Text.rich(
                  TextSpan(
                    children: [
                      TextSpan(
                        text: 'Bloco ${'${b.bloco}'.padLeft(casas, '0')}',
                        style: const TextStyle(fontWeight: FontWeight.w700),
                      ),
                      TextSpan(
                        text: ' · ${f.plural(b.total, 'pessoa', 'pessoas')}',
                        style: TextStyle(color: c.tintaSuave),
                      ),
                    ],
                  ),
                  style: const TextStyle(
                    fontFeatures: [FontFeature.tabularFigures()],
                  ),
                ),
              ),
              if (proximo) const Pilula('Próximo', tom: TomPilula.acento),
            ],
          ),
          const SizedBox(height: 2),
          if (ultimo != null)
            InkWell(
              onTap: () => aoAbrirCampanha(ultimo),
              borderRadius: BorderRadius.circular(8),
              child: Semantics(
                button: true,
                label: 'Abrir a campanha ${ultimo.campanhaNome}',
                child: Text.rich(
                  TextSpan(
                    children: [
                      TextSpan(text: 'Enviado em ${f.data(ultimo.em)} em '),
                      TextSpan(
                        text: ultimo.campanhaNome,
                        style: TextStyle(
                          color: c.acentoForte,
                          fontWeight: FontWeight.w600,
                          decoration: TextDecoration.underline,
                        ),
                      ),
                      const TextSpan(text: ': '),
                      TextSpan(
                        text: f.porcento(ultimo.entregues, ultimo.total),
                        style: numero,
                      ),
                      const TextSpan(text: ' entregues · '),
                      TextSpan(
                        text: f.porcento(ultimo.lidas, ultimo.total),
                        style: numero,
                      ),
                      const TextSpan(text: ' lidas'),
                      if (ultimo.falhas > 0) ...[
                        const TextSpan(text: ' · '),
                        TextSpan(text: f.numero(ultimo.falhas), style: numero),
                        const TextSpan(text: ' não chegaram'),
                      ],
                      if (ultimo.sairam > 0) ...[
                        const TextSpan(text: ' · '),
                        TextSpan(
                          text: f.numero(ultimo.sairam),
                          style: numero.copyWith(
                            // 2% ou mais saindo num bloco é sinal de lista fria.
                            color:
                                ultimo.sairam /
                                        (ultimo.total < 1 ? 1 : ultimo.total) >=
                                    0.02
                                ? c.erro
                                : c.tinta,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        TextSpan(
                          text: ultimo.sairam == 1
                              ? ' pediu para sair'
                              : ' pediram para sair',
                        ),
                      ],
                    ],
                  ),
                  style: suave,
                ),
              ),
            )
          else
            Text('Ainda não usado.', style: suave),
          if (ultimo == null && b.total > 0) ...[
            const SizedBox(height: 8),
            Align(
              alignment: Alignment.centerLeft,
              child: proximo
                  ? FilledButton(
                      key: ValueKey('usar-${b.id}'),
                      style: FilledButton.styleFrom(
                        minimumSize: const Size(0, 38),
                      ),
                      onPressed: () => aoUsar(b),
                      child: const Text('Usar em campanha'),
                    )
                  : OutlinedButton(
                      key: ValueKey('usar-${b.id}'),
                      style: OutlinedButton.styleFrom(
                        minimumSize: const Size(0, 38),
                      ),
                      onPressed: () => aoUsar(b),
                      child: const Text('Usar em campanha'),
                    ),
            ),
          ],
        ],
      ),
    );
  }
}
