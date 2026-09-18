import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/erro_api.dart';
import '../api/modelos.dart';
import '../componentes/basicos.dart';
import '../componentes/previa_mensagem.dart';
import '../tema/cores.dart';

/// Edita o texto de um modelo simples: cabeçalho de texto, corpo, exemplos,
/// rodapé e botões.
///
/// Nome, idioma e categoria ficam de fora de propósito: a Meta não deixa mudar
/// a categoria de um modelo aprovado, e o nome é a chave dele lá. Antes de
/// gravar, o servidor confere contra as regras da Meta — o que ele disser vale
/// mais do que qualquer validação desta tela.
///
/// Devolve (pop) o status novo quando salvou.
class TelaEditarModelo extends ConsumerStatefulWidget {
  const TelaEditarModelo({super.key, required this.modelo});

  final ModeloSalvo modelo;

  @override
  ConsumerState<TelaEditarModelo> createState() => _TelaEditarModeloState();
}

class _BotaoEmEdicao {
  _BotaoEmEdicao(BotaoModelo b)
    : tipo = b.tipo,
      texto = TextEditingController(text: b.texto),
      url = TextEditingController(text: b.url ?? ''),
      telefone = TextEditingController(text: b.telefone ?? '');

  String tipo;
  final TextEditingController texto;
  final TextEditingController url;
  final TextEditingController telefone;

  BotaoModelo get valor => BotaoModelo(
    tipo: tipo,
    texto: texto.text.trim(),
    url: tipo == 'URL' ? url.text.trim() : null,
    telefone: tipo == 'PHONE_NUMBER' ? telefone.text.trim() : null,
  );

  void descartar() {
    texto.dispose();
    url.dispose();
    telefone.dispose();
  }
}

const _tiposBotao = {
  'QUICK_REPLY': 'Resposta rápida',
  'URL': 'Abrir link',
  'PHONE_NUMBER': 'Ligar',
  'COPY_CODE': 'Copiar código',
};

class _TelaEditarModeloState extends ConsumerState<TelaEditarModelo> {
  late final ModeloSalvo _m = widget.modelo;
  late final _cabecalho = TextEditingController(text: _m.cabecalhoTexto ?? '');
  late final _cabecalhoExemplo = TextEditingController(
    text: _m.cabecalhoExemplo ?? '',
  );
  late final _corpo = TextEditingController(text: _m.corpo);
  late final _rodape = TextEditingController(text: _m.rodape ?? '');
  final _exemplos = <TextEditingController>[];
  late final List<_BotaoEmEdicao> _botoes = [
    for (final b in _m.botoes)
      if (!ehBotaoDeSaida(b)) _BotaoEmEdicao(b),
  ];

  List<ProblemaModelo> _problemas = const [];
  bool _salvando = false;

  bool get _cabecalhoDeTexto => _m.cabecalhoFormato == 'TEXT';
  bool get _comSaida => levaBotaoDeSaida(_m.categoria, _m.tipo);
  int get _limite => limiteBotoes(_m.categoria, _m.tipo);

  @override
  void initState() {
    super.initState();
    _ajustarExemplos();
    for (final c in [_cabecalho, _cabecalhoExemplo, _corpo, _rodape]) {
      c.addListener(_mudou);
    }
    for (final b in _botoes) {
      b.texto.addListener(_mudou);
    }
  }

  @override
  void dispose() {
    for (final c in [_cabecalho, _cabecalhoExemplo, _corpo, _rodape]) {
      c.dispose();
    }
    for (final c in _exemplos) {
      c.dispose();
    }
    for (final b in _botoes) {
      b.descartar();
    }
    super.dispose();
  }

  void _mudou() {
    _ajustarExemplos();
    setState(() {});
  }

  /// Um campo de exemplo por variável distinta do corpo.
  void _ajustarExemplos() {
    final n = quantasVariaveis(_corpo.text);
    while (_exemplos.length < n) {
      final i = _exemplos.length;
      _exemplos.add(
        TextEditingController(
          text: i < _m.corpoExemplos.length ? _m.corpoExemplos[i] : '',
        )..addListener(() => setState(() {})),
      );
    }
    while (_exemplos.length > n) {
      _exemplos.removeLast().dispose();
    }
  }

  bool get _cabecalhoTemVariavel =>
      _cabecalhoDeTexto && quantasVariaveis(_cabecalho.text) > 0;

  Map<String, Object?> _dados() => _m.paraSalvar(
    corpo: _corpo.text.trim(),
    corpoExemplos: [for (final e in _exemplos) e.text.trim()],
    cabecalhoTexto: _cabecalhoDeTexto ? _cabecalho.text.trim() : null,
    cabecalhoExemplo: _cabecalhoTemVariavel
        ? _cabecalhoExemplo.text.trim()
        : null,
    rodape: _rodape.text.trim(),
    botoes: [for (final b in _botoes) b.valor],
  );

  String? _problemaDe(String campo) {
    final achados = _problemas
        .where((p) => p.campo == campo || p.campo.startsWith('$campo.'))
        .map((p) => p.mensagem)
        .toList();
    return achados.isEmpty ? null : achados.join('\n');
  }

  void _adicionarBotao(String tipo) {
    setState(() {
      _botoes.add(
        _BotaoEmEdicao(BotaoModelo(tipo: tipo, texto: ''))
          ..texto.addListener(_mudou),
      );
    });
  }

  Future<void> _escolherTipoDoBotao() async {
    final c = Cores.de(context);
    final tipo = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: c.superficie,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            for (final e in _tiposBotao.entries)
              ListTile(
                leading: Icon(switch (e.key) {
                  'URL' => Icons.open_in_new_rounded,
                  'PHONE_NUMBER' => Icons.call_rounded,
                  'COPY_CODE' => Icons.copy_rounded,
                  _ => Icons.reply_rounded,
                }),
                title: Text(e.value),
                onTap: () => Navigator.pop(ctx, e.key),
              ),
          ],
        ),
      ),
    );
    if (tipo != null) _adicionarBotao(tipo);
  }

  Future<void> _salvar() async {
    FocusScope.of(context).unfocus();
    setState(() {
      _salvando = true;
      _problemas = const [];
    });
    final servico = ref.read(servicoModelosProvider);
    try {
      final dados = _dados();
      final problemas = await servico.conferir(dados);
      if (!mounted) return;
      if (problemas.isNotEmpty) {
        setState(() => _problemas = problemas);
        return;
      }
      if (_m.naMeta) {
        final ok = await _confirmarEnvio();
        if (!ok || !mounted) return;
      }
      final status = await servico.salvar(_m.id, dados);
      if (!mounted) return;
      Navigator.of(context).pop(status ?? _m.status);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(mensagemDoErro(e))));
      }
    } finally {
      if (mounted) setState(() => _salvando = false);
    }
  }

  Future<bool> _confirmarEnvio() async {
    final c = Cores.de(context);
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: c.superficie,
        title: const Text('Enviar a edição à Meta?'),
        content: Text(
          'O texto novo passa pela análise da Meta de novo. Em modelo aprovado ela aceita 1 edição por dia e 10 por mês.',
          style: TextStyle(color: c.tintaSuave, height: 1.45),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Voltar'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(minimumSize: const Size(0, 44)),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Enviar'),
          ),
        ],
      ),
    );
    return ok == true;
  }

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final bloqueado = _m.horasParaEditar > 0;
    final previaBotoes = botoesComSaida(_m.categoria, _m.tipo, [
      for (final b in _botoes) b.valor,
    ]);
    final gerais = _problemas
        .where(
          (p) => !const {
            'corpo',
            'cabecalho',
            'rodape',
            'botoes',
          }.any((c) => p.campo == c || p.campo.startsWith('$c.')),
        )
        .toList();

    return Scaffold(
      appBar: AppBar(
        title: Text('Editar ${_m.nome}', overflow: TextOverflow.ellipsis),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 28),
        children: [
          if (bloqueado) ...[
            Aviso(
              icone: Icons.schedule_rounded,
              texto:
                  'A Meta aceita 1 edição por dia em modelo aprovado. A próxima libera em ${_m.horasParaEditar == 1 ? '1 hora' : '${_m.horasParaEditar} horas'}.',
            ),
            const SizedBox(height: 14),
          ] else if (_m.naMeta) ...[
            const Aviso(
              tom: TomPilula.acento,
              icone: Icons.info_outline_rounded,
              texto:
                  'Este modelo já está na Meta: salvar envia a edição para ela analisar de novo. A categoria não muda.',
            ),
            const SizedBox(height: 14),
          ],
          if (_problemas.isNotEmpty) ...[
            Aviso(
              tom: TomPilula.erro,
              icone: Icons.error_outline_rounded,
              texto: _problemas.length == 1
                  ? 'Falta ajustar 1 ponto para a Meta aceitar.'
                  : 'Faltam ajustar ${_problemas.length} pontos para a Meta aceitar.',
            ),
            for (final p in gerais)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(p.mensagem, style: TextStyle(color: c.erro)),
              ),
            const SizedBox(height: 14),
          ],
          PreviaMensagem(
            corpo: _corpo.text,
            cabecalho: _cabecalhoDeTexto ? _cabecalho.text : null,
            cabecalhoMidia: _m.cabecalhoFormato != null && !_cabecalhoDeTexto
                ? _m.cabecalhoFormato
                : null,
            rodape: _rodape.text,
            botoes: [for (final b in previaBotoes) (b.tipo, b.texto)],
          ),
          const SizedBox(height: 20),
          if (_cabecalhoDeTexto) ...[
            TextField(
              controller: _cabecalho,
              maxLength: 60,
              decoration: InputDecoration(
                labelText: 'Cabeçalho',
                errorText: _problemaDe('cabecalho'),
                errorMaxLines: 4,
              ),
            ),
            if (_cabecalhoTemVariavel) ...[
              const SizedBox(height: 8),
              TextField(
                controller: _cabecalhoExemplo,
                decoration: const InputDecoration(
                  labelText: 'Exemplo para {{1}} do cabeçalho',
                ),
              ),
            ],
            const SizedBox(height: 12),
          ] else if (_m.cabecalhoFormato != null) ...[
            Text(
              'A mídia do cabeçalho é trocada pelo site.',
              style: TextStyle(color: c.tintaSuave, fontSize: 12.5),
            ),
            const SizedBox(height: 12),
          ],
          TextField(
            controller: _corpo,
            minLines: 4,
            maxLines: 12,
            maxLength: 1024,
            keyboardType: TextInputType.multiline,
            decoration: InputDecoration(
              labelText: 'Mensagem',
              alignLabelWithHint: true,
              helperText: 'Use {{1}}, {{2}}… onde entra o dado de cada pessoa.',
              helperMaxLines: 2,
              errorText: _problemaDe('corpo'),
              errorMaxLines: 6,
            ),
          ),
          if (_exemplos.isNotEmpty) ...[
            const SizedBox(height: 12),
            Text(
              'Exemplos das variáveis',
              style: Theme.of(context).textTheme.titleSmall,
            ),
            const SizedBox(height: 4),
            Text(
              'A Meta analisa a mensagem com estes valores. Use dados parecidos com os reais.',
              style: TextStyle(color: c.tintaSuave, fontSize: 12.5),
            ),
            for (var i = 0; i < _exemplos.length; i++)
              Padding(
                padding: const EdgeInsets.only(top: 10),
                child: TextField(
                  controller: _exemplos[i],
                  decoration: InputDecoration(labelText: '{{${i + 1}}}'),
                ),
              ),
          ],
          const SizedBox(height: 16),
          TextField(
            controller: _rodape,
            maxLength: 60,
            decoration: InputDecoration(
              labelText: 'Rodapé (opcional)',
              errorText: _problemaDe('rodape'),
              errorMaxLines: 4,
            ),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: Text(
                  'Botões',
                  style: Theme.of(context).textTheme.titleSmall,
                ),
              ),
              Text(
                '${_botoes.length} de $_limite',
                style: TextStyle(
                  color: c.tintaSuave,
                  fontSize: 12.5,
                  fontFeatures: const [FontFeature.tabularFigures()],
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          for (var i = 0; i < _botoes.length; i++)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: _EditorBotao(
                botao: _botoes[i],
                aoMudar: () => setState(() {}),
                aoRemover: () => setState(() {
                  _botoes.removeAt(i).descartar();
                }),
              ),
            ),
          if (_comSaida)
            Cartao(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
              child: Row(
                children: [
                  Icon(
                    Icons.lock_outline_rounded,
                    size: 18,
                    color: c.tintaSuave,
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text.rich(
                      TextSpan(
                        children: [
                          TextSpan(
                            text: botaoSaida.texto,
                            style: const TextStyle(fontWeight: FontWeight.w600),
                          ),
                          TextSpan(
                            text:
                                ' — sempre o último. Quem toca entra na lista de bloqueio.',
                            style: TextStyle(color: c.tintaSuave),
                          ),
                        ],
                      ),
                      style: const TextStyle(fontSize: 13),
                    ),
                  ),
                ],
              ),
            ),
          if (_problemaDe('botoes') case final erro?)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                erro,
                style: TextStyle(color: c.erro, fontSize: 12.5),
              ),
            ),
          if (_botoes.length < _limite)
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton.icon(
                onPressed: _escolherTipoDoBotao,
                icon: const Icon(Icons.add_rounded),
                label: const Text('Adicionar botão'),
              ),
            ),
        ],
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 12),
          child: FilledButton(
            onPressed: _salvando || bloqueado ? null : _salvar,
            child: _salvando
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : Text(
                    _m.naMeta ? 'Salvar e enviar à Meta' : 'Salvar rascunho',
                  ),
          ),
        ),
      ),
    );
  }
}

class _EditorBotao extends StatelessWidget {
  const _EditorBotao({
    required this.botao,
    required this.aoMudar,
    required this.aoRemover,
  });

  final _BotaoEmEdicao botao;
  final VoidCallback aoMudar;
  final VoidCallback aoRemover;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    return Cartao(
      padding: const EdgeInsets.fromLTRB(14, 8, 4, 12),
      child: Column(
        children: [
          Row(
            children: [
              Expanded(
                child: DropdownButtonHideUnderline(
                  child: DropdownButton<String>(
                    value: botao.tipo,
                    isExpanded: true,
                    dropdownColor: c.superficie,
                    items: [
                      for (final e in _tiposBotao.entries)
                        DropdownMenuItem(value: e.key, child: Text(e.value)),
                    ],
                    onChanged: (v) {
                      if (v == null) return;
                      botao.tipo = v;
                      aoMudar();
                    },
                  ),
                ),
              ),
              IconButton(
                tooltip: 'Remover botão',
                onPressed: aoRemover,
                icon: Icon(Icons.close_rounded, color: c.tintaSuave),
              ),
            ],
          ),
          Padding(
            padding: const EdgeInsets.only(right: 10),
            child: Column(
              children: [
                TextField(
                  controller: botao.texto,
                  maxLength: 25,
                  decoration: InputDecoration(
                    labelText: botao.tipo == 'COPY_CODE'
                        ? 'Código de exemplo'
                        : 'Texto do botão',
                  ),
                ),
                if (botao.tipo == 'URL')
                  TextField(
                    controller: botao.url,
                    keyboardType: TextInputType.url,
                    decoration: const InputDecoration(
                      labelText: 'Link (https://…)',
                    ),
                  ),
                if (botao.tipo == 'PHONE_NUMBER')
                  TextField(
                    controller: botao.telefone,
                    keyboardType: TextInputType.phone,
                    decoration: const InputDecoration(
                      labelText: 'Telefone com DDI (ex.: 5511999998888)',
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
