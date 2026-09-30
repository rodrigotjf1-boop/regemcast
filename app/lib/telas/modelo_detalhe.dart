import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/erro_api.dart';
import '../api/modelos.dart';
import '../componentes/basicos.dart';
import '../componentes/dialogos.dart';
import '../componentes/previa_mensagem.dart';
import '../componentes/previa_modelo.dart';
import '../tema/cores.dart';
import 'modelo_editor.dart';
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

  Future<void> _editar(ModeloSalvo m) async {
    final r = await Navigator.of(context).push<ResultadoEditor>(
      MaterialPageRoute(builder: (_) => TelaEditorModelo(inicial: m)),
    );
    if (!mounted) return;
    // Mesmo sem resultado (saiu depois de uma falha no envio), o rascunho
    // pode ter mudado: relê.
    if (r != null) avisar(context, r.mensagem);
    await _reler();
  }

  Future<void> _enviar(ModeloSalvo m) async {
    final ok = await confirmar(
      context,
      titulo: 'Enviar para a Meta?',
      texto:
          'A Meta analisa o modelo antes de liberar para campanha — costuma levar de minutos a algumas horas. '
          'Depois de aprovado, a categoria não muda e o texto aceita 1 edição por dia.',
      botao: 'Enviar',
    );
    if (!ok || !mounted) return;
    setState(() => _agindo = true);
    try {
      final status = await ref
          .read(servicoModelosProvider)
          .enviarParaAprovacao(m.id);
      if (!mounted) return;
      avisar(
        context,
        ResultadoEditor(FimDoEditor.enviado, status: status).mensagem,
      );
      await _reler();
    } catch (e) {
      // A recusa na hora (a Meta disse não) grava o motivo: relê para mostrar.
      if (mounted) avisar(context, mensagemDoErro(e));
      await _reler();
    } finally {
      if (mounted) setState(() => _agindo = false);
    }
  }

  Future<void> _excluir(ModeloSalvo m) async {
    final ok = await confirmar(
      context,
      titulo: m.naMeta ? 'Excluir da Meta?' : 'Excluir o rascunho?',
      texto: m.naMeta
          ? 'Excluir apaga o modelo aqui e na Meta, e ele não pode mais ser usado em campanha. Duas coisas que não dá para desfazer: '
                'o nome "${m.nome}" fica bloqueado por 30 dias, e as mensagens que já saíram continuam sendo entregues — excluir não cancela envio.'
          : 'O rascunho some. Não dá para desfazer.',
      botao: m.naMeta ? 'Excluir na Meta' : 'Excluir',
      perigo: true,
    );
    if (!ok || !mounted) return;
    setState(() => _agindo = true);
    try {
      final naMeta = await ref.read(servicoModelosProvider).excluir(m.id);
      if (!mounted) return;
      avisar(
        context,
        naMeta
            ? 'Modelo excluído aqui e na Meta. O nome só volta a ficar livre em 30 dias, e as mensagens que já saíram continuam sendo entregues.'
            : 'Rascunho excluído.',
      );
      Navigator.of(context).pop();
    } catch (e) {
      if (mounted) avisar(context, mensagemDoErro(e));
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
    final recusado =
        tom == TomPilula.erro && motivo != null && motivo.isNotEmpty;

    final podeEditar = m != null && m.podeEditar;
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
                      title: Text('Excluir', style: TextStyle(color: c.erro)),
                      contentPadding: EdgeInsets.zero,
                    ),
                  ),
              ],
            ),
        ],
      ),
      body: ListView(
        padding: respiroDaTela(context),
        children: [
          Wrap(
            spacing: 8,
            runSpacing: 8,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Pilula(rotulo, tom: tom),
              Pilula(rotuloCategoria(categoria)),
              Pilula(idioma),
              if (m?.ehCarrossel ?? false) const Pilula('Carrossel'),
            ],
          ),
          const SizedBox(height: 14),
          if (recusado) ...[
            // Recusado se corrige e reenvia com o MESMO nome (a Meta aceita
            // edição de modelo recusado). Criar outro com nome novo levava a
            // pessoa a repetir o mesmo erro com outro nome.
            Aviso(
              tom: TomPilula.erro,
              icone: Icons.report_gmailerrorred_rounded,
              texto: m != null && m.podeEditar
                  ? 'A Meta recusou: $motivo Toque em Editar, corrija e salve — a correção volta para a Meta com o mesmo nome.'
                  : 'A Meta recusou: $motivo',
              acao: m != null && m.podeEditar
                  ? TextButton.icon(
                      onPressed: _agindo ? null : () => _editar(m),
                      icon: const Icon(Icons.edit_outlined),
                      label: const Text('Editar'),
                    )
                  : null,
            ),
            const SizedBox(height: 14),
          ],
          if (m == null) ...[
            const Aviso(
              icone: Icons.info_outline_rounded,
              texto:
                  'Este modelo foi criado fora do Regemcast, direto na Meta. Dá para usar em campanha, mas editar e excluir só pelo painel da Meta.',
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
          if (m != null)
            PreviaDoModelo(dados: DadosModelo.deSalvo(m), comExemplos: false)
          else
            PreviaMensagem(
              corpo: meta!.corpo,
              cabecalho: meta.cabecalho,
              rodape: meta.rodape,
              botoes: [for (final b in meta.botoes) (null, b)],
            ),
          if (m != null && m.variaveis > 0) ...[
            const SizedBox(height: 14),
            _Exemplos(modelo: m),
          ] else if (m == null && meta!.variaveis > 0) ...[
            const SizedBox(height: 10),
            Text(
              meta.variaveis == 1
                  ? '1 variável a preencher na campanha.'
                  : '${meta.variaveis} variáveis a preencher na campanha.',
              style: TextStyle(color: c.tintaSuave, fontSize: 12.5),
            ),
          ],
          if (m != null && levaBotaoDeSaida(m.categoria, m.tipo)) ...[
            const SizedBox(height: 14),
            Text(
              'O botão "${botaoSaida.texto}" vai em todo modelo de marketing. Quem toca nele entra na lista de bloqueio e não recebe mais campanhas desta conta.',
              style: TextStyle(
                color: c.tintaSuave,
                fontSize: 12.5,
                height: 1.45,
              ),
            ),
          ],
        ],
      ),
      bottomNavigationBar: m != null && m.podeEnviar
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
