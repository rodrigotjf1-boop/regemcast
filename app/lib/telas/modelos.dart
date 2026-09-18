import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/erro_api.dart';
import '../api/leituras.dart';
import '../api/modelos.dart';
import '../componentes/basicos.dart';
import '../config.dart';
import '../tema/cores.dart';
import 'modelo_detalhe.dart';

/// Rótulo e tom do status — o da Meta já vem em português; o nosso, não.
(String, TomPilula) situacaoDoModelo(String status) => switch (status) {
  'aprovado' => ('Aprovado', TomPilula.sucesso),
  'em análise' || 'enviado' || 'em recurso' => ('Em análise', TomPilula.atencao),
  'pausado' => ('Pausado', TomPilula.atencao),
  'recusado' || 'rejeitado' || 'desativado' => (status == 'desativado' ? 'Desativado' : 'Recusado', TomPilula.erro),
  'sendo excluído' => ('Sendo excluído', TomPilula.erro),
  'rascunho' => ('Rascunho', TomPilula.neutro),
  _ => (status, TomPilula.neutro),
};

String rotuloCategoria(String c) => switch (c.toUpperCase()) {
  'MARKETING' => 'Marketing',
  'UTILITY' => 'Utilidade',
  'AUTHENTICATION' => 'Autenticação',
  _ => c.isEmpty ? '' : '${c[0].toUpperCase()}${c.substring(1)}',
};

/// O nosso registro do modelo que a Meta está mostrando, se existir.
ModeloSalvo? localDe(ModeloNaMeta m, List<ModeloSalvo> meus) {
  for (final n in meus) {
    if (n.metaTemplateId != null && n.metaTemplateId == m.id) return n;
  }
  for (final n in meus) {
    if (n.nome == m.nome && n.idioma == m.idioma) return n;
  }
  return null;
}

/// Os modelos da conta: o que está na Meta e o que ainda é rascunho.
///
/// Criar modelo novo é no site (o editor completo, com mídia e carrossel).
/// Aqui se vê como a mensagem chega, se edita o texto e se exclui.
class TelaModelos extends ConsumerWidget {
  const TelaModelos({super.key});

  Future<void> _atualizar(WidgetRef ref) async {
    ref.invalidate(modelosNaMetaProvider);
    ref.invalidate(modelosSalvosProvider);
    ref.invalidate(situacaoWhatsappProvider);
    await Future.wait([
      ref.read(modelosSalvosProvider.future).catchError((_) => <ModeloSalvo>[]),
      ref.read(modelosNaMetaProvider.future).catchError((_) => <ModeloNaMeta>[]),
    ]);
  }

  Future<void> _abrir(BuildContext context, WidgetRef ref, {ModeloNaMeta? meta, ModeloSalvo? local}) async {
    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => TelaModeloDetalhe(meta: meta, local: local)));
    ref.invalidate(modelosNaMetaProvider);
    ref.invalidate(modelosSalvosProvider);
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = Cores.de(context);
    final situacao = ref.watch(situacaoWhatsappProvider).value;
    final conectado = situacao?.conectado ?? true;
    final meus = ref.watch(modelosSalvosProvider).value ?? const <ModeloSalvo>[];
    final naMeta = conectado ? ref.watch(modelosNaMetaProvider) : const AsyncValue<List<ModeloNaMeta>>.data([]);

    final idsNaMeta = (naMeta.value ?? const <ModeloNaMeta>[]).map((m) => m.id).toSet();
    // Rascunhos e recusados que NÃO aparecem na lista da Meta (os que ela já
    // tem aparecem lá, com o status dela — mostrar duas vezes confundiria).
    final soNossos = meus
        .where((m) => (m.status == 'rascunho' || m.status == 'rejeitado') && (m.metaTemplateId == null || !idsNaMeta.contains(m.metaTemplateId)))
        .toList();
    final emAnalise = meus.where((m) => m.emAnalise).length;

    return RefreshIndicator(
      color: c.acentoContraste,
      backgroundColor: c.acento,
      onRefresh: () => _atualizar(ref),
      child: CustomScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        slivers: [
          SliverSafeArea(
            bottom: false,
            sliver: SliverPadding(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 8),
              sliver: SliverToBoxAdapter(
                child: Row(
                  children: [
                    Expanded(child: Text('Modelos', style: Theme.of(context).textTheme.headlineSmall)),
                    IconButton(
                      tooltip: 'Criar modelo no site',
                      onPressed: () => launchUrl(Uri.parse('$urlWeb/modelos'), mode: LaunchMode.externalApplication),
                      icon: const Icon(Icons.add_circle_outline_rounded),
                    ),
                  ],
                ),
              ),
            ),
          ),
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(20, 4, 20, 28),
            sliver: SliverList.list(
              children: [
                if (!conectado)
                  const Padding(
                    padding: EdgeInsets.only(bottom: 14),
                    child: Aviso(
                      icone: Icons.chat_bubble_outline_rounded,
                      texto: 'Conecte o número pelo site para ver os modelos aprovados. Os rascunhos continuam aqui.',
                    ),
                  ),
                if (emAnalise > 0)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 14),
                    child: Aviso(
                      tom: TomPilula.acento,
                      icone: Icons.hourglass_top_rounded,
                      texto: emAnalise == 1
                          ? '1 modelo está em análise na Meta. A resposta costuma levar de minutos a algumas horas.'
                          : '$emAnalise modelos estão em análise na Meta. A resposta costuma levar de minutos a algumas horas.',
                    ),
                  ),
                if (soNossos.isNotEmpty) ...[
                  _Titulo('Rascunhos e recusados'),
                  for (final m in soNossos)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: _CartaoModelo(
                        nome: m.nome,
                        categoria: m.categoria,
                        idioma: m.idioma,
                        status: m.status,
                        corpo: m.corpo,
                        pontilhado: true,
                        aoTocar: () => _abrir(context, ref, local: m),
                      ),
                    ),
                  const SizedBox(height: 10),
                ],
                if (conectado) ...[
                  _Titulo('Na Meta'),
                  naMeta.when(
                    loading: () => const Column(children: [
                      Cartao(child: Esqueleto(altura: 70)),
                      SizedBox(height: 10),
                      Cartao(child: Esqueleto(altura: 70)),
                    ]),
                    error: (e, _) => EstadoErro(
                      titulo: 'Não consegui ler os modelos da Meta',
                      mensagem: mensagemDoErro(e),
                      aoTentar: () => ref.invalidate(modelosNaMetaProvider),
                    ),
                    data: (lista) => lista.isEmpty
                        ? Cartao(
                            child: Text(
                              'Nenhum modelo na Meta ainda. Crie o primeiro pelo site — a Meta analisa cada um antes de liberar.',
                              style: TextStyle(color: c.tintaSuave, height: 1.45),
                            ),
                          )
                        : Column(
                            children: [
                              for (final m in lista)
                                Padding(
                                  padding: const EdgeInsets.only(bottom: 10),
                                  child: _CartaoModelo(
                                    nome: m.nome,
                                    categoria: m.categoria,
                                    idioma: m.idioma,
                                    status: m.status,
                                    corpo: m.corpo,
                                    foraDoRegemCast: localDe(m, meus) == null,
                                    aoTocar: () => _abrir(context, ref, meta: m, local: localDe(m, meus)),
                                  ),
                                ),
                            ],
                          ),
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

class _Titulo extends StatelessWidget {
  const _Titulo(this.texto);
  final String texto;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 10, top: 4),
    child: Text(texto, style: Theme.of(context).textTheme.titleMedium),
  );
}

class _CartaoModelo extends StatelessWidget {
  const _CartaoModelo({
    required this.nome,
    required this.categoria,
    required this.idioma,
    required this.status,
    required this.corpo,
    required this.aoTocar,
    this.pontilhado = false,
    this.foraDoRegemCast = false,
  });

  final String nome;
  final String categoria;
  final String idioma;
  final String status;
  final String corpo;
  final VoidCallback aoTocar;
  final bool pontilhado;
  final bool foraDoRegemCast;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final (rotulo, tom) = situacaoDoModelo(status);
    return Cartao(
      aoTocar: aoTocar,
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(nome, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
              ),
              const SizedBox(width: 8),
              Pilula(rotulo, tom: tom),
            ],
          ),
          const SizedBox(height: 2),
          Text(
            [rotuloCategoria(categoria), idioma, if (foraDoRegemCast) 'criado fora do RegemCast'].join(' · '),
            style: TextStyle(fontSize: 12, color: c.tintaSuave),
          ),
          const SizedBox(height: 8),
          Text(corpo, maxLines: 2, overflow: TextOverflow.ellipsis, style: TextStyle(color: c.tintaSuave, height: 1.4, fontSize: 13.5)),
        ],
      ),
    );
  }
}
