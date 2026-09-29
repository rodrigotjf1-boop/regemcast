import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/dados.dart';
import '../api/erro_api.dart';
import '../api/leituras.dart';
import '../componentes/basicos.dart';
import '../componentes/campanha.dart';
import '../tema/cores.dart';
import '../util/formato.dart' as f;
import 'campanha_detalhe.dart';
import 'campanha_formulario.dart';

/// Os filtros da lista — pelo que a pessoa quer olhar, não pelo nome técnico.
enum FiltroCampanhas {
  todas('Todas'),
  saindo('Saindo'),
  pausadas('Pausadas'),
  rascunhos('Rascunhos'),
  encerradas('Encerradas');

  const FiltroCampanhas(this.rotulo);
  final String rotulo;

  bool aceita(ResumoCampanha c) => switch (this) {
    FiltroCampanhas.todas => true,
    FiltroCampanhas.saindo => c.emAndamento,
    FiltroCampanhas.pausadas => c.status == 'pausada',
    FiltroCampanhas.rascunhos => c.status == 'rascunho',
    FiltroCampanhas.encerradas =>
      c.status == 'concluida' || c.status == 'cancelada',
  };
}

/// Todas as campanhas da conta: montar uma nova, acompanhar e agir sobre as
/// que existem — como no site.
class TelaCampanhas extends ConsumerStatefulWidget {
  const TelaCampanhas({super.key});

  @override
  ConsumerState<TelaCampanhas> createState() => _TelaCampanhasState();
}

class _TelaCampanhasState extends ConsumerState<TelaCampanhas> {
  FiltroCampanhas _filtro = FiltroCampanhas.todas;

  Future<void> _atualizar() async {
    ref.invalidate(campanhasProvider);
    await ref
        .read(campanhasProvider.future)
        .catchError((_) => <ResumoCampanha>[]);
  }

  /// Montar leva direto para a campanha montada; na volta, a lista relê.
  Future<void> _montar() async {
    await Navigator.of(
      context,
    ).push(MaterialPageRoute(builder: (_) => const TelaFormularioCampanha()));
    ref.invalidate(campanhasProvider);
  }

  Future<void> _abrir(ResumoCampanha c) async {
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => TelaCampanhaDetalhe(id: c.id, nomeInicial: c.nome),
      ),
    );
    // Voltou: a campanha pode ter mudado (pausou, cancelou, sumiu).
    ref.invalidate(campanhasProvider);
  }

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final carga = ref.watch(campanhasProvider);
    final todas = carga.value ?? const <ResumoCampanha>[];

    return RefreshIndicator(
      color: c.acentoContraste,
      backgroundColor: c.acento,
      onRefresh: _atualizar,
      child: CustomScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        slivers: [
          SliverSafeArea(
            bottom: false,
            sliver: SliverPadding(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 4),
              sliver: SliverToBoxAdapter(
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Campanhas',
                            style: Theme.of(context).textTheme.headlineSmall,
                          ),
                          if (carga.hasValue)
                            Text(
                              '${f.plural(todas.length, 'campanha', 'campanhas')} · ${f.numero(todas.where((x) => x.emAndamento).length)} saindo agora',
                              style: TextStyle(
                                color: c.tintaSuave,
                                fontSize: 13,
                              ),
                            ),
                        ],
                      ),
                    ),
                    FilledButton.icon(
                      key: const ValueKey('nova-campanha'),
                      style: FilledButton.styleFrom(
                        minimumSize: const Size(0, 42),
                        padding: const EdgeInsets.symmetric(horizontal: 16),
                        textStyle: const TextStyle(
                          fontFamily: 'Poppins',
                          fontWeight: FontWeight.w600,
                          fontSize: 14,
                        ),
                      ),
                      onPressed: _montar,
                      icon: const Icon(Icons.add_rounded, size: 20),
                      label: const Text('Nova campanha'),
                    ),
                  ],
                ),
              ),
            ),
          ),
          SliverToBoxAdapter(
            child: SizedBox(
              height: 48,
              child: ListView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 20),
                children: [
                  for (final f in FiltroCampanhas.values)
                    Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: ChoiceChip(
                        label: Text(_rotuloComQuantidade(f, todas)),
                        selected: _filtro == f,
                        onSelected: (_) => setState(() => _filtro = f),
                        showCheckmark: false,
                        selectedColor: c.acento,
                        backgroundColor: c.superficie,
                        side: BorderSide(
                          color: _filtro == f ? c.acento : c.borda,
                        ),
                        labelStyle: TextStyle(
                          fontWeight: FontWeight.w600,
                          color: _filtro == f
                              ? c.acentoContraste
                              : c.tintaSuave,
                        ),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(99),
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(20, 10, 20, 28),
            sliver: carga.when(
              loading: () => SliverList.list(
                children: const [
                  Cartao(child: Esqueleto(altura: 64)),
                  SizedBox(height: 10),
                  Cartao(child: Esqueleto(altura: 64)),
                  SizedBox(height: 10),
                  Cartao(child: Esqueleto(altura: 64)),
                ],
              ),
              error: (e, _) => SliverToBoxAdapter(
                child: EstadoErro(
                  titulo: 'Não consegui ler as campanhas',
                  mensagem: mensagemDoErro(e),
                  aoTentar: () => ref.invalidate(campanhasProvider),
                ),
              ),
              data: (lista) {
                final filtradas = lista.where(_filtro.aceita).toList()
                  ..sort(
                    (a, b) => (b.criadoEm ?? DateTime(0)).compareTo(
                      a.criadoEm ?? DateTime(0),
                    ),
                  );
                if (filtradas.isEmpty) {
                  return SliverToBoxAdapter(
                    child: _Vazio(
                      filtro: _filtro,
                      semNenhuma: lista.isEmpty,
                      aoMontar: _montar,
                    ),
                  );
                }
                return SliverList.separated(
                  itemCount: filtradas.length,
                  separatorBuilder: (_, _) => const SizedBox(height: 10),
                  itemBuilder: (_, i) => CartaoCampanha(
                    campanha: filtradas[i],
                    aoTocar: () => _abrir(filtradas[i]),
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  String _rotuloComQuantidade(FiltroCampanhas f, List<ResumoCampanha> todas) {
    if (todas.isEmpty) return f.rotulo;
    final n = todas.where(f.aceita).length;
    return '${f.rotulo} $n';
  }
}

class _Vazio extends StatelessWidget {
  const _Vazio({
    required this.filtro,
    required this.semNenhuma,
    required this.aoMontar,
  });

  final FiltroCampanhas filtro;
  final bool semNenhuma;
  final VoidCallback aoMontar;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final (titulo, texto) = semNenhuma
        ? (
            'Nenhuma campanha ainda',
            'Escolha um modelo aprovado e quem recebe. Montar não envia nada: você confere a campanha e dispara na tela seguinte.',
          )
        : (
            'Nada por aqui',
            'Nenhuma campanha ${filtro.rotulo.toLowerCase()} agora.',
          );
    return Cartao(
      padding: const EdgeInsets.all(22),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            titulo,
            style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 6),
          Text(texto, style: TextStyle(color: c.tintaSuave, height: 1.45)),
          if (semNenhuma) ...[
            const SizedBox(height: 16),
            OutlinedButton.icon(
              style: OutlinedButton.styleFrom(minimumSize: const Size(0, 44)),
              onPressed: aoMontar,
              icon: const Icon(Icons.add_rounded, size: 18),
              label: const Text('Nova campanha'),
            ),
          ],
        ],
      ),
    );
  }
}
