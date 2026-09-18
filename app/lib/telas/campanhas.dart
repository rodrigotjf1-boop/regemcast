import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/dados.dart';
import '../api/erro_api.dart';
import '../api/leituras.dart';
import '../componentes/basicos.dart';
import '../componentes/campanha.dart';
import '../config.dart';
import '../tema/cores.dart';
import 'campanha_detalhe.dart';

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

/// Todas as campanhas da conta. Montar uma nova é na web; aqui se acompanha e
/// se age sobre as que existem.
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
                      child: Text(
                        'Campanhas',
                        style: Theme.of(context).textTheme.headlineSmall,
                      ),
                    ),
                    IconButton(
                      tooltip: 'Montar campanha no site',
                      onPressed: () => launchUrl(
                        Uri.parse('$urlWeb/campanhas'),
                        mode: LaunchMode.externalApplication,
                      ),
                      icon: const Icon(Icons.add_circle_outline_rounded),
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
                    child: _Vazio(filtro: _filtro, semNenhuma: lista.isEmpty),
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
  const _Vazio({required this.filtro, required this.semNenhuma});

  final FiltroCampanhas filtro;
  final bool semNenhuma;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final (titulo, texto) = semNenhuma
        ? (
            'Nenhuma campanha ainda',
            'As campanhas são montadas pelo site, onde dá para escolher o público e conferir tudo antes. Assim que a primeira existir, ela aparece aqui.',
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
              onPressed: () => launchUrl(
                Uri.parse('$urlWeb/campanhas'),
                mode: LaunchMode.externalApplication,
              ),
              icon: const Icon(Icons.open_in_new_rounded, size: 18),
              label: const Text('Montar no site'),
            ),
          ],
        ],
      ),
    );
  }
}
