import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/erro_api.dart';
import '../api/leituras.dart';
import '../api/modelos.dart';
import '../componentes/basicos.dart';
import '../componentes/dialogos.dart';
import '../config.dart';
import '../tema/cores.dart';
import 'modelo_detalhe.dart';
import 'modelo_editor.dart';

/// Rótulo e tom do status — o da Meta já vem em português; o nosso, não.
(String, TomPilula) situacaoDoModelo(String status) => switch (status) {
  'aprovado' => ('Aprovado', TomPilula.sucesso),
  'em análise' ||
  'enviado' ||
  'em recurso' => ('Em análise', TomPilula.atencao),
  'pausado' => ('Pausado', TomPilula.atencao),
  'recusado' || 'rejeitado' || 'desativado' => (
    status == 'desativado' ? 'Desativado' : 'Recusado',
    TomPilula.erro,
  ),
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
/// No WhatsApp oficial, toda conversa que a empresa começa precisa de um modelo
/// aprovado pela Meta — sem ele não existe disparo. Por isso o status aparece
/// com destaque, e criar um modelo novo fica a um toque, com o mesmo editor do
/// site (mídia e carrossel incluídos).
class TelaModelos extends ConsumerWidget {
  const TelaModelos({super.key});

  Future<void> _atualizar(WidgetRef ref) async {
    ref.invalidate(modelosNaMetaProvider);
    ref.invalidate(modelosSalvosProvider);
    ref.invalidate(situacaoWhatsappProvider);
    await Future.wait([
      ref.read(modelosSalvosProvider.future).catchError((_) => <ModeloSalvo>[]),
      ref
          .read(modelosNaMetaProvider.future)
          .catchError((_) => <ModeloNaMeta>[]),
    ]);
  }

  Future<void> _criar(BuildContext context, WidgetRef ref) async {
    final r = await Navigator.of(context).push<ResultadoEditor>(
      MaterialPageRoute(builder: (_) => const TelaEditorModelo()),
    );
    ref.invalidate(modelosNaMetaProvider);
    ref.invalidate(modelosSalvosProvider);
    if (r != null && context.mounted) avisar(context, r.mensagem);
  }

  Future<void> _abrir(
    BuildContext context,
    WidgetRef ref, {
    ModeloNaMeta? meta,
    ModeloSalvo? local,
  }) async {
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => TelaModeloDetalhe(meta: meta, local: local),
      ),
    );
    ref.invalidate(modelosNaMetaProvider);
    ref.invalidate(modelosSalvosProvider);
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = Cores.de(context);
    final situacao = ref.watch(situacaoWhatsappProvider).value;
    final conectado = situacao?.conectado ?? true;
    final meus =
        ref.watch(modelosSalvosProvider).value ?? const <ModeloSalvo>[];
    final naMeta = conectado
        ? ref.watch(modelosNaMetaProvider)
        : const AsyncValue<List<ModeloNaMeta>>.data([]);

    final idsNaMeta = (naMeta.value ?? const <ModeloNaMeta>[])
        .map((m) => m.id)
        .toSet();
    // Rascunhos e recusados que NÃO aparecem na lista da Meta (os que ela já
    // tem aparecem lá, com o status dela — mostrar duas vezes confundiria).
    final soNossos = meus
        .where(
          (m) =>
              (m.status == 'rascunho' || m.status == 'rejeitado') &&
              (m.metaTemplateId == null ||
                  !idsNaMeta.contains(m.metaTemplateId)),
        )
        .toList();
    final emAnalise = meus.where((m) => m.emAnalise).length;
    final aprovados = naMeta.value?.where((m) => m.status == 'aprovado').length;

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
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Modelos',
                            style: Theme.of(context).textTheme.headlineSmall,
                          ),
                          if (aprovados != null)
                            Text(
                              aprovados == 1
                                  ? '1 aprovado pela Meta'
                                  : '$aprovados aprovados pela Meta',
                              style: TextStyle(
                                color: c.tintaSuave,
                                fontSize: 13,
                              ),
                            ),
                        ],
                      ),
                    ),
                    FilledButton.icon(
                      key: const ValueKey('novo-modelo'),
                      style: FilledButton.styleFrom(
                        minimumSize: const Size(0, 42),
                        padding: const EdgeInsets.symmetric(horizontal: 16),
                        textStyle: const TextStyle(
                          fontFamily: 'Poppins',
                          fontWeight: FontWeight.w600,
                          fontSize: 14,
                        ),
                      ),
                      onPressed: () => _criar(context, ref),
                      icon: const Icon(Icons.add_rounded, size: 20),
                      label: const Text('Novo modelo'),
                    ),
                  ],
                ),
              ),
            ),
          ),
          SliverPadding(
            padding: respiroDaTela(context, topo: 4),
            sliver: SliverList.list(
              children: [
                if (!conectado)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 14),
                    child: Aviso(
                      icone: Icons.chat_bubble_outline_rounded,
                      texto:
                          'Conecte o número para ver os modelos aprovados. Você já pode escrever e salvar rascunhos aqui; para enviar à aprovação, conecte o número primeiro.',
                      acao: TextButton(
                        onPressed: () => launchUrl(
                          Uri.parse('$urlWeb/whatsapp'),
                          mode: LaunchMode.externalApplication,
                        ),
                        child: const Text('Conectar pelo site'),
                      ),
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
                        motivo: m.motivo,
                        pontilhado: true,
                        aoTocar: () => _abrir(context, ref, local: m),
                      ),
                    ),
                  const SizedBox(height: 10),
                ],
                if (conectado) ...[
                  _Titulo('Na Meta'),
                  naMeta.when(
                    loading: () => const Column(
                      children: [
                        Cartao(child: Esqueleto(altura: 70)),
                        SizedBox(height: 10),
                        Cartao(child: Esqueleto(altura: 70)),
                      ],
                    ),
                    error: (e, _) => EstadoErro(
                      titulo: 'Não consegui ler os modelos da Meta',
                      mensagem: mensagemDoErro(e),
                      aoTentar: () => ref.invalidate(modelosNaMetaProvider),
                    ),
                    data: (lista) => lista.isEmpty
                        ? Cartao(
                            child: Text(
                              'Nenhum modelo na Meta ainda. Crie o primeiro em "Novo modelo" — a Meta analisa cada um antes de liberar, o que costuma levar de alguns minutos a algumas horas.',
                              style: TextStyle(
                                color: c.tintaSuave,
                                height: 1.45,
                              ),
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
                                    motivo: m.motivo,
                                    qualidade: m.qualidade,
                                    categoriaAnterior: m.categoriaAnterior,
                                    alertas: m.alertas,
                                    foraDoRegemCast: localDe(m, meus) == null,
                                    aoTocar: () => _abrir(
                                      context,
                                      ref,
                                      meta: m,
                                      local: localDe(m, meus),
                                    ),
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
    this.motivo,
    this.pontilhado = false,
    this.foraDoRegemCast = false,
    this.qualidade = 'desconhecida',
    this.categoriaAnterior,
    this.alertas = const [],
  });

  /// A qualidade como a tela fala dela. Sem informação não vira pílula.
  static (String, TomPilula)? rotuloDaQualidade(String q) => switch (q) {
    'verde' => ('Qualidade: Boa', TomPilula.sucesso),
    'amarela' => ('Qualidade: Em atenção', TomPilula.atencao),
    'vermelha' => ('Qualidade: Ruim', TomPilula.erro),
    _ => null,
  };

  final String qualidade;
  final String? categoriaAnterior;
  final List<AlertaDoModelo> alertas;

  final String nome;
  final String categoria;
  final String idioma;
  final String status;
  final String corpo;

  /// Por que a Meta recusou. Ela diz uma vez só: sem isto, a pessoa tentaria
  /// de novo às cegas.
  final String? motivo;
  final VoidCallback aoTocar;
  final bool pontilhado;
  final bool foraDoRegemCast;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final (rotulo, tom) = situacaoDoModelo(status);
    final daQualidade = rotuloDaQualidade(qualidade);
    return Cartao(
      aoTocar: aoTocar,
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  nome,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Pilula(rotulo, tom: tom),
            ],
          ),
          const SizedBox(height: 2),
          Text(
            [
              rotuloCategoria(categoria),
              idioma,
              // A Meta reclassificou: o preço segue a categoria de agora.
              if (categoriaAnterior != null) 'era $categoriaAnterior',
              if (foraDoRegemCast) 'criado fora do Regemcast',
            ].join(' · '),
            style: TextStyle(fontSize: 12, color: c.tintaSuave),
          ),
          if (daQualidade != null) ...[
            const SizedBox(height: 8),
            Pilula(daQualidade.$1, tom: daQualidade.$2),
          ],
          const SizedBox(height: 8),
          Text(
            corpo,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(color: c.tintaSuave, height: 1.4, fontSize: 13.5),
          ),
          if (tom == TomPilula.erro && (motivo ?? '').trim().isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(
              'A Meta recusou: ${motivo!.trim()}',
              maxLines: 3,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(color: c.erro, height: 1.4, fontSize: 13),
            ),
          ],
          // O que a Meta sinaliza neste modelo; a frase vem pronta do servidor.
          for (final a in alertas) ...[
            const SizedBox(height: 8),
            Text(
              a.texto,
              key: ValueKey('modelo-alerta-${a.erro ? 'erro' : 'atencao'}'),
              style: TextStyle(
                color: a.erro ? c.erro : c.atencao,
                height: 1.4,
                fontSize: 13,
              ),
            ),
          ],
        ],
      ),
    );
  }
}
