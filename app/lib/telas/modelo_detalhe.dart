import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/erro_api.dart';
import '../api/modelos.dart';
import '../componentes/basicos.dart';
import '../componentes/previa_mensagem.dart';
import '../config.dart';
import '../tema/cores.dart';
import 'modelo_editar.dart';
import 'modelos.dart' show rotuloCategoria, situacaoDoModelo;

/// Um modelo: como a mensagem chega, em que pé está na Meta e o que dá para
/// fazer com ele daqui.
///
/// Recebe o que a lista já tem — o lado da Meta, o nosso, ou os dois. Só o que
/// tem registro nosso pode ser editado ou excluído: de um modelo criado direto
/// no painel da Meta não temos o texto original para reenviar.
class TelaModeloDetalhe extends ConsumerStatefulWidget {
  const TelaModeloDetalhe({super.key, this.meta, this.local})
    : assert(meta != null || local != null);

  final ModeloNaMeta? meta;
  final ModeloSalvo? local;

  @override
  ConsumerState<TelaModeloDetalhe> createState() => _TelaModeloDetalheState();
}

class _TelaModeloDetalheState extends ConsumerState<TelaModeloDetalhe> {
  late ModeloSalvo? _local = widget.local;
  bool _agindo = false;

  void _avisar(String texto) => ScaffoldMessenger.of(
    context,
  ).showSnackBar(SnackBar(content: Text(texto)));

  String get _nome => _local?.nome ?? widget.meta!.nome;
  String get _status => widget.meta?.status ?? _local!.status;

  /// Relê o nosso registro depois de uma mudança.
  Future<void> _reler() async {
    final id = _local?.id;
    if (id == null) return;
    ref.invalidate(modelosSalvosProvider);
    final todos = await ref.read(modelosSalvosProvider.future);
    if (!mounted) return;
    setState(() {
      for (final m in todos) {
        if (m.id == id) _local = m;
      }
    });
  }

  Future<bool> _confirmar({
    required String titulo,
    required String texto,
    required String botao,
    bool perigo = false,
  }) async {
    final c = Cores.de(context);
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: c.superficie,
        title: Text(titulo),
        content: Text(
          texto,
          style: TextStyle(color: c.tintaSuave, height: 1.45),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Voltar'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              minimumSize: const Size(0, 44),
              backgroundColor: perigo ? c.erro : null,
              foregroundColor: perigo
                  ? (Theme.of(ctx).brightness == Brightness.dark
                        ? const Color(0xFF231632)
                        : Colors.white)
                  : null,
            ),
            onPressed: () => Navigator.pop(ctx, true),
            child: Text(botao),
          ),
        ],
      ),
    );
    return ok == true;
  }

  Future<void> _editar(ModeloSalvo m) async {
    final status = await Navigator.of(context).push<String>(
      MaterialPageRoute(builder: (_) => TelaEditarModelo(modelo: m)),
    );
    if (status == null || !mounted) return;
    _avisar(
      m.naMeta
          ? 'Edição enviada. A Meta analisa o texto novo antes de liberar.'
          : 'Rascunho salvo.',
    );
    await _reler();
  }

  Future<void> _enviar(ModeloSalvo m) async {
    final ok = await _confirmar(
      titulo: 'Enviar para a Meta?',
      texto:
          'A Meta analisa o modelo antes de liberar para campanha — costuma levar de minutos a algumas horas. '
          'Depois de aprovado, a categoria não muda e o texto aceita 1 edição por dia.',
      botao: 'Enviar',
    );
    if (!ok || !mounted) return;
    setState(() => _agindo = true);
    try {
      await ref.read(servicoModelosProvider).enviarParaAprovacao(m.id);
      if (!mounted) return;
      _avisar('Enviado. Avisamos na lista quando a Meta responder.');
      await _reler();
    } catch (e) {
      if (mounted) _avisar(mensagemDoErro(e));
    } finally {
      if (mounted) setState(() => _agindo = false);
    }
  }

  Future<void> _excluir(ModeloSalvo m) async {
    final ok = await _confirmar(
      titulo: m.naMeta ? 'Excluir da Meta?' : 'Excluir o rascunho?',
      texto: m.naMeta
          ? 'O modelo sai daqui e da Meta, e não pode mais ser usado em campanha. '
                'A Meta segura o nome "${m.nome}" por 30 dias: nesse período não dá para criar outro com o mesmo nome.'
          : 'O rascunho some. Não dá para desfazer.',
      botao: 'Excluir',
      perigo: true,
    );
    if (!ok || !mounted) return;
    setState(() => _agindo = true);
    try {
      final naMeta = await ref.read(servicoModelosProvider).excluir(m.id);
      if (!mounted) return;
      _avisar(naMeta ? 'Modelo excluído aqui e na Meta.' : 'Rascunho excluído.');
      Navigator.of(context).pop();
    } catch (e) {
      if (mounted) _avisar(mensagemDoErro(e));
    } finally {
      if (mounted) setState(() => _agindo = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final m = _local;
    final meta = widget.meta;
    final (rotulo, tom) = situacaoDoModelo(_status);
    final categoria = m?.categoria ?? meta!.categoria;
    final idioma = m?.idioma ?? meta!.idioma;
    final motivo = meta?.motivo ?? m?.motivo;
    final recusado = tom == TomPilula.erro && motivo != null && motivo.isNotEmpty;

    final podeEditar = m != null && m.editavelNoApp;
    final podeExcluir = m != null && !m.emAnalise;

    return Scaffold(
      appBar: AppBar(
        title: Text(_nome, overflow: TextOverflow.ellipsis),
        actions: [
          if (podeEditar || podeExcluir)
            PopupMenuButton<String>(
              tooltip: 'Mais ações',
              color: c.superficie,
              enabled: !_agindo,
              onSelected: (v) => v == 'editar' ? _editar(m) : _excluir(m),
              itemBuilder: (_) => [
                if (podeEditar)
                  const PopupMenuItem(
                    value: 'editar',
                    child: ListTile(
                      leading: Icon(Icons.edit_outlined),
                      title: Text('Editar'),
                      contentPadding: EdgeInsets.zero,
                    ),
                  ),
                if (podeExcluir)
                  PopupMenuItem(
                    value: 'excluir',
                    child: ListTile(
                      leading: Icon(
                        Icons.delete_outline_rounded,
                        color: c.erro,
                      ),
                      title: Text(
                        'Excluir',
                        style: TextStyle(color: c.erro),
                      ),
                      contentPadding: EdgeInsets.zero,
                    ),
                  ),
              ],
            ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 28),
        children: [
          Wrap(
            spacing: 8,
            runSpacing: 8,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Pilula(rotulo, tom: tom),
              Pilula(rotuloCategoria(categoria)),
              Pilula(idioma),
              if (m?.tipo == 'carrossel') const Pilula('Carrossel'),
            ],
          ),
          const SizedBox(height: 14),
          if (recusado) ...[
            Aviso(
              tom: TomPilula.erro,
              icone: Icons.report_gmailerrorred_rounded,
              texto: 'Motivo da Meta: $motivo',
            ),
            const SizedBox(height: 14),
          ],
          if (m == null) ...[
            const Aviso(
              icone: Icons.info_outline_rounded,
              texto:
                  'Este modelo foi criado fora do RegemCast, direto na Meta. Dá para usar em campanha, mas editar e excluir só pelo painel da Meta.',
            ),
            const SizedBox(height: 14),
          ] else if (m.tipo == 'carrossel') ...[
            Aviso(
              icone: Icons.view_carousel_outlined,
              texto:
                  'Carrossel tem imagem por cartão: a edição é pelo site. Daqui dá para ver e excluir.',
              acao: TextButton(
                onPressed: () => launchUrl(
                  Uri.parse('$urlWeb/modelos'),
                  mode: LaunchMode.externalApplication,
                ),
                child: const Text('Abrir no site'),
              ),
            ),
            const SizedBox(height: 14),
          ] else if (m.emAnalise) ...[
            const Aviso(
              tom: TomPilula.acento,
              icone: Icons.hourglass_top_rounded,
              texto:
                  'Em análise na Meta. Enquanto ela não responde, o modelo não pode ser editado nem excluído.',
            ),
            const SizedBox(height: 14),
          ] else if (m.horasParaEditar > 0) ...[
            Aviso(
              icone: Icons.schedule_rounded,
              texto:
                  'A Meta aceita 1 edição por dia em modelo aprovado. A próxima libera em ${m.horasParaEditar == 1 ? '1 hora' : '${m.horasParaEditar} horas'}.',
            ),
            const SizedBox(height: 14),
          ],
          _Previa(meta: meta, local: m),
          if (m != null && m.variaveis > 0) ...[
            const SizedBox(height: 14),
            _Exemplos(modelo: m),
          ],
          if (m != null && levaBotaoDeSaida(m.categoria, m.tipo)) ...[
            const SizedBox(height: 14),
            Text(
              'O botão "${botaoSaida.texto}" vai em todo modelo de marketing. Quem toca nele entra na lista de bloqueio e não recebe mais campanhas desta conta.',
              style: TextStyle(color: c.tintaSuave, fontSize: 12.5, height: 1.45),
            ),
          ],
        ],
      ),
      bottomNavigationBar: m != null && m.status == 'rascunho'
          ? SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 8, 20, 12),
                child: FilledButton.icon(
                  onPressed: _agindo ? null : () => _enviar(m),
                  icon: _agindo
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.send_rounded),
                  label: const Text('Enviar para aprovação'),
                ),
              ),
            )
          : null,
    );
  }
}

class _Previa extends StatelessWidget {
  const _Previa({required this.meta, required this.local});

  final ModeloNaMeta? meta;
  final ModeloSalvo? local;

  @override
  Widget build(BuildContext context) {
    final m = local;
    // O nosso registro sabe o tipo de cada botão e o formato do cabeçalho;
    // a Meta, na listagem, só devolve os textos.
    if (m != null) {
      final midia =
          m.cabecalhoFormato != null && m.cabecalhoFormato != 'TEXT'
          ? m.cabecalhoFormato
          : null;
      return PreviaMensagem(
        corpo: m.corpo,
        cabecalho: m.cabecalhoFormato == 'TEXT' ? m.cabecalhoTexto : null,
        cabecalhoMidia: midia,
        rodape: m.rodape,
        botoes: [
          for (final b in botoesComSaida(m.categoria, m.tipo, m.botoes))
            (b.tipo, b.texto),
        ],
      );
    }
    final n = meta!;
    return PreviaMensagem(
      corpo: n.corpo,
      cabecalho: n.cabecalho,
      rodape: n.rodape,
      botoes: [for (final b in n.botoes) (null, b)],
    );
  }
}

/// Os exemplos que a Meta viu: é por eles que ela julga a mensagem.
class _Exemplos extends StatelessWidget {
  const _Exemplos({required this.modelo});

  final ModeloSalvo modelo;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    return Cartao(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Variáveis', style: Theme.of(context).textTheme.titleSmall),
          const SizedBox(height: 4),
          Text(
            'Cada campanha preenche com o dado de cada pessoa. Os exemplos abaixo são os que a Meta analisou.',
            style: TextStyle(color: c.tintaSuave, fontSize: 12.5, height: 1.45),
          ),
          const SizedBox(height: 10),
          for (var i = 0; i < modelo.variaveis; i++)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(
                    width: 48,
                    child: Text(
                      '{{${i + 1}}}',
                      style: TextStyle(
                        color: c.tintaSuave,
                        fontFeatures: const [FontFeature.tabularFigures()],
                      ),
                    ),
                  ),
                  Expanded(
                    child: Text(
                      i < modelo.corpoExemplos.length &&
                              modelo.corpoExemplos[i].trim().isNotEmpty
                          ? modelo.corpoExemplos[i]
                          : '—',
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}
