import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/campanhas.dart';
import '../api/dados.dart';
import '../api/erro_api.dart';
import '../componentes/basicos.dart';
import '../config.dart';
import '../tema/cores.dart';

/// Editar a campanha: nome, janela, ritmo e limites.
///
/// Modelo e público ficam de fora no app. Em campanha já disparada eles são o
/// registro do que foi enviado (o servidor recusa trocar); em rascunho, trocar
/// o público pede escolher lista, variáveis e conferir quem fica de fora —
/// trabalho de tela grande, que é o site.
class TelaEditarCampanha extends ConsumerStatefulWidget {
  const TelaEditarCampanha({super.key, required this.campanha});

  final ResumoCampanha campanha;

  @override
  ConsumerState<TelaEditarCampanha> createState() => _TelaEditarCampanhaState();
}

class _TelaEditarCampanhaState extends ConsumerState<TelaEditarCampanha> {
  late final TextEditingController _nome = TextEditingController(
    text: widget.campanha.nome,
  );
  late final TextEditingController _pausa = TextEditingController(
    text: widget.campanha.pausaSegundos > 0
        ? '${widget.campanha.pausaSegundos}'
        : '',
  );
  late final TextEditingController _maxDia = TextEditingController(
    text: _txt(widget.campanha.maxPorDia),
  );
  late final TextEditingController _maxSemana = TextEditingController(
    text: _txt(widget.campanha.maxPorSemana),
  );
  late final TextEditingController _maxMes = TextEditingController(
    text: _txt(widget.campanha.maxPorMes),
  );

  late bool _janelaAtiva = widget.campanha.temJanela;
  late final Set<int> _dias = {...widget.campanha.janelaDias};
  late TimeOfDay? _inicio = _lerHora(widget.campanha.janelaInicio);
  late TimeOfDay? _fim = _lerHora(widget.campanha.janelaFim);

  String? _erro;
  bool _salvando = false;

  static String _txt(int? v) => v == null ? '' : '$v';

  static TimeOfDay? _lerHora(String? hhmmss) {
    if (hhmmss == null || hhmmss.length < 5) return null;
    final h = int.tryParse(hhmmss.substring(0, 2));
    final m = int.tryParse(hhmmss.substring(3, 5));
    return (h == null || m == null) ? null : TimeOfDay(hour: h, minute: m);
  }

  static String _hhmm(TimeOfDay t) =>
      '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';

  @override
  void dispose() {
    for (final c in [_nome, _pausa, _maxDia, _maxSemana, _maxMes]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _escolherHora(bool ehInicio) async {
    final atual = ehInicio ? _inicio : _fim;
    final escolhida = await showTimePicker(
      context: context,
      initialTime:
          atual ??
          (ehInicio
              ? const TimeOfDay(hour: 9, minute: 0)
              : const TimeOfDay(hour: 20, minute: 0)),
      helpText: ehInicio ? 'Começa a enviar às' : 'Para de enviar às',
      builder: (ctx, filho) => MediaQuery(
        data: MediaQuery.of(ctx).copyWith(alwaysUse24HourFormat: true),
        child: filho!,
      ),
    );
    if (escolhida != null) {
      setState(() => ehInicio ? _inicio = escolhida : _fim = escolhida);
    }
  }

  /// O mesmo que o servidor confere, para a pessoa saber antes de salvar.
  String? _problema() {
    if (_nome.text.trim().length < 2) {
      return 'O nome precisa ter ao menos 2 caracteres.';
    }
    if (!_janelaAtiva) return null;
    if ((_inicio == null) != (_fim == null)) {
      return 'Escolha o início E o fim do horário, ou deixe os dois vazios.';
    }
    final dia = int.tryParse(_maxDia.text);
    final semana = int.tryParse(_maxSemana.text);
    final mes = int.tryParse(_maxMes.text);
    if ((dia != null && semana != null && dia > semana) ||
        (semana != null && mes != null && semana > mes) ||
        (dia != null && mes != null && dia > mes)) {
      return 'Os limites precisam ser crescentes: o do dia não pode passar o da semana, nem o da semana o do mês.';
    }
    final pausa = int.tryParse(_pausa.text) ?? 0;
    if (pausa > 3600) {
      return 'A pausa entre envios pode ser de até 1 hora (3600 segundos).';
    }
    return null;
  }

  Future<void> _salvar() async {
    final problema = _problema();
    if (problema != null) {
      setState(() => _erro = problema);
      return;
    }
    setState(() {
      _erro = null;
      _salvando = true;
    });

    // Janela desligada vai EXPLÍCITA (vazio/nulo): ausente, o servidor entende
    // "não mexer" e a campanha continuaria presa ao horário antigo.
    int? n(TextEditingController c) => int.tryParse(c.text.trim());
    final mudancas = <String, Object?>{
      'nome': _nome.text.trim(),
      'janelaDias': _janelaAtiva ? (_dias.toList()..sort()) : <int>[],
      'janelaInicio': _janelaAtiva && _inicio != null ? _hhmm(_inicio!) : null,
      'janelaFim': _janelaAtiva && _fim != null ? _hhmm(_fim!) : null,
      'pausaSegundos': _janelaAtiva ? (n(_pausa) ?? 0) : 0,
      'maxPorDia': _janelaAtiva ? n(_maxDia) : null,
      'maxPorSemana': _janelaAtiva ? n(_maxSemana) : null,
      'maxPorMes': _janelaAtiva ? n(_maxMes) : null,
    };

    try {
      await ref
          .read(servicoCampanhasProvider)
          .editar(widget.campanha.id, mudancas);
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      if (mounted) setState(() => _erro = mensagemDoErro(e));
    } finally {
      if (mounted) setState(() => _salvando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    const nomesDias = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

    return Scaffold(
      appBar: AppBar(title: const Text('Editar campanha')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 28),
        children: [
          if (widget.campanha.status != 'rascunho')
            const Padding(
              padding: EdgeInsets.only(bottom: 14),
              child: Aviso(
                tom: TomPilula.acento,
                texto:
                    'Esta campanha já foi disparada: dá para ajustar o nome, a janela, o ritmo e os limites. Modelo e público ficam como foram enviados.',
              ),
            )
          else
            Padding(
              padding: const EdgeInsets.only(bottom: 14),
              child: Aviso(
                tom: TomPilula.acento,
                texto:
                    'Para trocar o modelo ou o público deste rascunho, use o site — lá dá para escolher a lista e conferir quem fica de fora.',
                acao: Align(
                  alignment: Alignment.centerLeft,
                  child: OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size(0, 40),
                    ),
                    onPressed: () => launchUrl(
                      Uri.parse('$urlWeb/campanhas/${widget.campanha.id}'),
                      mode: LaunchMode.externalApplication,
                    ),
                    icon: const Icon(Icons.open_in_new_rounded, size: 18),
                    label: const Text('Abrir no site'),
                  ),
                ),
              ),
            ),
          TextField(
            controller: _nome,
            textCapitalization: TextCapitalization.sentences,
            maxLength: 120,
            decoration: const InputDecoration(labelText: 'Nome da campanha'),
          ),
          const SizedBox(height: 8),
          Cartao(
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
            child: SwitchListTile(
              value: _janelaAtiva,
              onChanged: (v) => setState(() => _janelaAtiva = v),
              activeThumbColor: c.acentoContraste,
              activeTrackColor: c.acento,
              title: const Text(
                'Controlar quando e quanto sai',
                style: TextStyle(fontWeight: FontWeight.w600),
              ),
              subtitle: Text(
                _janelaAtiva
                    ? 'Só envia nos dias e horários escolhidos.'
                    : 'Desligado: envia assim que disparada, sem pausa.',
                style: TextStyle(color: c.tintaSuave, fontSize: 13),
              ),
            ),
          ),
          if (_janelaAtiva) ...[
            const SizedBox(height: 18),
            Text('Dias', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 4),
            Text(
              'Nenhum marcado = todos os dias.',
              style: TextStyle(color: c.tintaSuave, fontSize: 13),
            ),
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (var d = 0; d < 7; d++)
                  FilterChip(
                    label: Text(nomesDias[d]),
                    selected: _dias.contains(d),
                    showCheckmark: false,
                    selectedColor: c.acento,
                    backgroundColor: c.superficie,
                    side: BorderSide(
                      color: _dias.contains(d) ? c.acento : c.borda,
                    ),
                    labelStyle: TextStyle(
                      fontWeight: FontWeight.w600,
                      color: _dias.contains(d)
                          ? c.acentoContraste
                          : c.tintaSuave,
                    ),
                    onSelected: (v) =>
                        setState(() => v ? _dias.add(d) : _dias.remove(d)),
                  ),
              ],
            ),
            const SizedBox(height: 18),
            Text('Horário', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  child: _CampoHora(
                    rotulo: 'Das',
                    valor: _inicio,
                    aoTocar: () => _escolherHora(true),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: _CampoHora(
                    rotulo: 'Até',
                    valor: _fim,
                    aoTocar: () => _escolherHora(false),
                  ),
                ),
              ],
            ),
            if (_inicio != null || _fim != null)
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton(
                  onPressed: () => setState(() {
                    _inicio = null;
                    _fim = null;
                  }),
                  child: const Text('Sem horário (qualquer hora)'),
                ),
              ),
            const SizedBox(height: 14),
            Text('Ritmo', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 10),
            _CampoNumero(
              controller: _pausa,
              rotulo: 'Pausa entre mensagens',
              sufixo: 'segundos',
            ),
            const SizedBox(height: 18),
            Text('Limites', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 4),
            Text(
              'Em branco = sem limite. Quando chega no limite, a campanha espera o próximo período.',
              style: TextStyle(color: c.tintaSuave, fontSize: 13, height: 1.4),
            ),
            const SizedBox(height: 10),
            _CampoNumero(
              controller: _maxDia,
              rotulo: 'Por dia',
              sufixo: 'mensagens',
            ),
            const SizedBox(height: 10),
            _CampoNumero(
              controller: _maxSemana,
              rotulo: 'Por semana',
              sufixo: 'mensagens',
            ),
            const SizedBox(height: 10),
            _CampoNumero(
              controller: _maxMes,
              rotulo: 'Por mês',
              sufixo: 'mensagens',
            ),
          ],
          if (_erro != null) ...[
            const SizedBox(height: 16),
            Aviso(
              texto: _erro!,
              tom: TomPilula.erro,
              icone: Icons.error_outline_rounded,
            ),
          ],
        ],
      ),
      bottomNavigationBar: SafeArea(
        top: false,
        child: Container(
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 12),
          decoration: BoxDecoration(
            color: c.superficie,
            border: Border(top: BorderSide(color: c.borda)),
          ),
          child: FilledButton(
            onPressed: _salvando ? null : _salvar,
            child: _salvando
                ? SizedBox.square(
                    dimension: 22,
                    child: CircularProgressIndicator(
                      strokeWidth: 2.5,
                      color: c.acentoContraste,
                    ),
                  )
                : const Text('Salvar alterações'),
          ),
        ),
      ),
    );
  }
}

/// Campo de hora que abre o relógio do Android — nunca digitação.
class _CampoHora extends StatelessWidget {
  const _CampoHora({
    required this.rotulo,
    required this.valor,
    required this.aoTocar,
  });

  final String rotulo;
  final TimeOfDay? valor;
  final VoidCallback aoTocar;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    return InkWell(
      onTap: aoTocar,
      borderRadius: BorderRadius.circular(14),
      child: InputDecorator(
        decoration: InputDecoration(
          labelText: rotulo,
          suffixIcon: const Icon(Icons.schedule_rounded),
        ),
        child: Text(
          valor == null
              ? '—'
              : '${valor!.hour.toString().padLeft(2, '0')}:${valor!.minute.toString().padLeft(2, '0')}',
          style: TextStyle(
            fontSize: 16,
            color: valor == null ? c.tintaSuave : c.tinta,
          ),
        ),
      ),
    );
  }
}

class _CampoNumero extends StatelessWidget {
  const _CampoNumero({
    required this.controller,
    required this.rotulo,
    required this.sufixo,
  });

  final TextEditingController controller;
  final String rotulo;
  final String sufixo;

  @override
  Widget build(BuildContext context) => TextField(
    controller: controller,
    keyboardType: TextInputType.number,
    inputFormatters: [
      FilteringTextInputFormatter.digitsOnly,
      LengthLimitingTextInputFormatter(7),
    ],
    decoration: InputDecoration(
      labelText: rotulo,
      suffixText: sufixo,
      hintText: 'sem limite',
    ),
  );
}
