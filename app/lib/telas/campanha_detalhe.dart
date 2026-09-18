import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/campanhas.dart';
import '../api/dados.dart';
import '../api/erro_api.dart';
import '../componentes/basicos.dart';
import '../componentes/campanha.dart';
import '../config.dart';
import '../tema/cores.dart';
import '../util/formato.dart' as f;
import 'campanha_editar.dart';

/// Uma campanha: o que aconteceu, com quem, e o que dá para fazer agora.
///
/// "Enviada" e "entregue" aparecem separadas de propósito — a primeira diz que
/// a Meta aceitou, a segunda que chegou ao aparelho. Juntar as duas é o que faz
/// uma campanha parecer 100% de sucesso com metade das mensagens paradas.
class TelaCampanhaDetalhe extends ConsumerStatefulWidget {
  const TelaCampanhaDetalhe({super.key, required this.id, this.nomeInicial});

  final String id;

  /// O nome já conhecido na lista, para o título não piscar vazio.
  final String? nomeInicial;

  @override
  ConsumerState<TelaCampanhaDetalhe> createState() =>
      _TelaCampanhaDetalheState();
}

class _TelaCampanhaDetalheState extends ConsumerState<TelaCampanhaDetalhe> {
  Timer? _relogio;
  bool _agindo = false;

  @override
  void dispose() {
    _relogio?.cancel();
    super.dispose();
  }

  /// Enquanto sai, a tela se atualiza sozinha a cada 5 s. Parou de sair, para.
  void _acompanhar(ResumoCampanha c) {
    if (c.emAndamento && _relogio == null) {
      _relogio = Timer.periodic(const Duration(seconds: 5), (_) {
        if (!mounted) return;
        ref.invalidate(campanhaProvider(widget.id));
        ref.invalidate(destinatariosProvider(widget.id));
      });
    } else if (!c.emAndamento && _relogio != null) {
      _relogio!.cancel();
      _relogio = null;
    }
  }

  Future<void> _atualizar() async {
    ref.invalidate(campanhaProvider(widget.id));
    ref.invalidate(destinatariosProvider(widget.id));
    await ref
        .read(campanhaProvider(widget.id).future)
        .catchError((_) => _placeholder);
  }

  static const _placeholder = ResumoCampanha(
    id: '',
    nome: '',
    modeloNome: '',
    status: '',
    pausaMotivo: null,
    criadoEm: null,
    porStatus: {},
    total: 0,
    listaNome: null,
  );

  void _avisar(String texto) => ScaffoldMessenger.of(
    context,
  ).showSnackBar(SnackBar(content: Text(texto)));

  /// Roda uma ação, mostra o resultado e relê a campanha.
  Future<void> _agir(Future<void> Function() acao, String sucesso) async {
    if (_agindo) return;
    setState(() => _agindo = true);
    try {
      await acao();
      if (!mounted) return;
      _avisar(sucesso);
      await _atualizar();
    } catch (e) {
      if (mounted) _avisar(mensagemDoErro(e));
    } finally {
      if (mounted) setState(() => _agindo = false);
    }
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

  Future<void> _disparar(ResumoCampanha camp) async {
    final ok = await _confirmar(
      titulo: 'Disparar agora?',
      texto:
          '${f.plural(camp.naFila, 'pessoa vai', 'pessoas vão')} receber o modelo "${camp.modeloNome}"${camp.temJanela ? ', respeitando a janela e o ritmo desta campanha' : ''}. '
          'Depois de disparar não dá para desfazer — só pausar.',
      botao: 'Disparar',
    );
    if (!ok) return;
    await _agir(
      () => ref.read(servicoCampanhasProvider).disparar(camp.id),
      'Campanha agendada. As mensagens saem pelo servidor — pode fechar o app.',
    );
  }

  Future<void> _pausar(ResumoCampanha camp) => _agir(
    () => ref.read(servicoCampanhasProvider).pausar(camp.id),
    'Campanha pausada. Quem faltava continua na fila e só sai quando você retomar.',
  );

  Future<void> _retomar(ResumoCampanha camp) => _agir(
    () => ref.read(servicoCampanhasProvider).retomar(camp.id),
    'Envio retomado. Quem faltava volta a sair pelo servidor.',
  );

  Future<void> _editar(ResumoCampanha camp) async {
    final salvou = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => TelaEditarCampanha(campanha: camp)),
    );
    if (salvou == true && mounted) {
      _avisar('Campanha atualizada.');
      await _atualizar();
    }
  }

  Future<void> _excluir(ResumoCampanha camp) async {
    // A palavra muda com a situação, porque o efeito muda.
    final (titulo, texto, botao) = switch (camp.status) {
      'rascunho' => (
        'Excluir o rascunho?',
        'Ele some junto com a lista de quem ia receber. Não dá para desfazer.',
        'Excluir',
      ),
      'agendada' || 'pausada' => (
        'Cancelar a campanha?',
        'Quem ainda não recebeu não recebe mais. O que já saiu continua no histórico — e continua cobrado pela Meta.',
        'Cancelar campanha',
      ),
      _ => (
        'Arquivar a campanha?',
        'Ela sai da sua lista. O histórico de envio continua no sistema, porque é ele que sustenta o consumo do ciclo.',
        'Arquivar',
      ),
    };
    final ok = await _confirmar(
      titulo: titulo,
      texto: texto,
      botao: botao,
      perigo: true,
    );
    if (!ok || !mounted) return;

    setState(() => _agindo = true);
    try {
      final r = await ref.read(servicoCampanhasProvider).excluir(camp.id);
      if (!mounted) return;
      if (r == ResultadoExclusao.cancelada) {
        _avisar(
          'Campanha cancelada. Quem ainda não tinha recebido não recebe mais.',
        );
        await _atualizar();
      } else {
        _avisar(
          r == ResultadoExclusao.apagada
              ? 'Rascunho excluído.'
              : 'Campanha arquivada.',
        );
        Navigator.of(context).pop();
      }
    } catch (e) {
      if (mounted) _avisar(mensagemDoErro(e));
    } finally {
      if (mounted) setState(() => _agindo = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final carga = ref.watch(campanhaProvider(widget.id));
    final camp = carga.value;
    if (camp != null) _acompanhar(camp);

    return Scaffold(
      appBar: AppBar(
        title: Text(
          camp?.nome ?? widget.nomeInicial ?? 'Campanha',
          overflow: TextOverflow.ellipsis,
        ),
        actions: [
          if (camp != null && (camp.podeEditar || camp.podeExcluir))
            PopupMenuButton<String>(
              tooltip: 'Mais ações',
              color: c.superficie,
              onSelected: (v) => v == 'editar' ? _editar(camp) : _excluir(camp),
              itemBuilder: (_) => [
                if (camp.podeEditar)
                  const PopupMenuItem(
                    value: 'editar',
                    child: ListTile(
                      leading: Icon(Icons.edit_outlined),
                      title: Text('Editar'),
                      contentPadding: EdgeInsets.zero,
                    ),
                  ),
                if (camp.podeExcluir)
                  PopupMenuItem(
                    value: 'excluir',
                    child: ListTile(
                      leading: Icon(
                        Icons.delete_outline_rounded,
                        color: c.erro,
                      ),
                      title: Text(
                        camp.status == 'rascunho'
                            ? 'Excluir'
                            : (camp.status == 'agendada' ||
                                  camp.status == 'pausada')
                            ? 'Cancelar campanha'
                            : 'Arquivar',
                        style: TextStyle(color: c.erro),
                      ),
                      contentPadding: EdgeInsets.zero,
                    ),
                  ),
              ],
            ),
        ],
      ),
      body: carga.when(
        loading: () => const Padding(
          padding: EdgeInsets.all(20),
          child: Column(
            children: [
              Cartao(child: Esqueleto(altura: 70)),
              SizedBox(height: 14),
              Cartao(child: Esqueleto(altura: 140)),
            ],
          ),
        ),
        error: (e, _) => Padding(
          padding: const EdgeInsets.all(20),
          child: EstadoErro(
            titulo: 'Não consegui abrir a campanha',
            mensagem: mensagemDoErro(e),
            aoTentar: _atualizar,
          ),
        ),
        data: (camp) => RefreshIndicator(
          color: c.acentoContraste,
          backgroundColor: c.acento,
          onRefresh: _atualizar,
          child: ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.fromLTRB(20, 8, 20, 28),
            children: [
              _Cabecalho(campanha: camp),
              const SizedBox(height: 14),
              ..._alertas(camp, c),
              _Metricas(campanha: camp),
              const SizedBox(height: 14),
              if (camp.temJanela) ...[
                _Janela(campanha: camp),
                const SizedBox(height: 14),
              ],
              _Destinatarios(campanha: camp),
            ],
          ),
        ),
      ),
      bottomNavigationBar: camp == null
          ? null
          : _BarraDeAcao(
              campanha: camp,
              ocupado: _agindo,
              aoDisparar: _disparar,
              aoPausar: _pausar,
              aoRetomar: _retomar,
            ),
    );
  }

  List<Widget> _alertas(ResumoCampanha camp, Cores c) {
    Widget embrulhar(Widget w) =>
        Padding(padding: const EdgeInsets.only(bottom: 14), child: w);
    final lista = <Widget>[];

    if (camp.status == 'rascunho') {
      lista.add(
        const Aviso(
          tom: TomPilula.acento,
          icone: Icons.info_outline_rounded,
          texto:
              'Esta campanha ainda não saiu. Confira o público abaixo antes de disparar — depois não dá para desfazer.',
        ),
      );
    }
    if (camp.status == 'agendada') {
      lista.add(
        const Aviso(
          tom: TomPilula.acento,
          icone: Icons.schedule_rounded,
          texto:
              'Agendada. As mensagens começam a sair na próxima abertura da janela de envio.',
        ),
      );
    }
    if (camp.status == 'cancelada') {
      lista.add(
        const Aviso(
          texto:
              'Campanha cancelada. Quem não tinha recebido não recebeu — o que saiu antes continua no histórico.',
        ),
      );
    }
    if (camp.status == 'pausada') {
      switch (camp.pausaMotivo) {
        case 'manual':
          lista.add(
            const Aviso(
              tom: TomPilula.acento,
              icone: Icons.pause_circle_outline_rounded,
              texto:
                  'Pausada por você. Quem faltava continua na fila, intacto, e nada sai até você retomar.',
            ),
          );
        case 'conexao':
          lista.add(
            Aviso(
              tom: TomPilula.erro,
              icone: Icons.link_off_rounded,
              texto:
                  'Pausada: a conexão com o WhatsApp caiu antes de terminar. Ninguém foi marcado como falha. Reconecte pelo site e retome.',
              acao: _BotaoSite(
                rotulo: 'Reconectar no site',
                caminho: '/whatsapp',
              ),
            ),
          );
        case 'teto_plano':
          lista.add(
            const Aviso(
              icone: Icons.speed_rounded,
              texto:
                  'Pausada: os disparos do seu plano acabaram neste ciclo. Quem faltava continua na fila e a campanha volta sozinha quando o ciclo virar ou com um plano maior.',
            ),
          );
        case 'inadimplencia':
          lista.add(
            Aviso(
              tom: TomPilula.erro,
              icone: Icons.credit_card_off_rounded,
              texto:
                  'Pausada por falta de pagamento do plano. Ela volta sozinha assim que o pagamento for confirmado.',
              acao: _BotaoSite(
                rotulo: 'Ver plano e pagamento',
                caminho: '/plano',
              ),
            ),
          );
      }
    }
    return lista.map(embrulhar).toList();
  }
}

// ----------------------------------------------------------------- blocos

class _Cabecalho extends StatelessWidget {
  const _Cabecalho({required this.campanha});
  final ResumoCampanha campanha;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final (rotulo, tom, vivo) = situacaoDaCampanha(campanha);
    final linhas = <(IconData, String)>[
      (Icons.description_outlined, campanha.modeloNome),
      (
        Icons.groups_outlined,
        campanha.listaNome == null
            ? 'Números digitados'
            : 'Lista ${campanha.listaNome}',
      ),
      (Icons.event_outlined, 'Criada em ${f.dataHora(campanha.criadoEm)}'),
      if (campanha.iniciadaEm != null)
        (
          Icons.play_circle_outline_rounded,
          'Disparada em ${f.dataHora(campanha.iniciadaEm)}',
        ),
      if (campanha.concluidaEm != null)
        (
          Icons.flag_outlined,
          'Encerrada em ${f.dataHora(campanha.concluidaEm)}',
        ),
    ];
    return Cartao(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Pilula(rotulo, tom: tom, vivo: vivo),
          const SizedBox(height: 12),
          for (final (icone, texto) in linhas)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Row(
                children: [
                  Icon(icone, size: 18, color: c.tintaSuave),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      texto,
                      style: TextStyle(color: c.tintaSuave, fontSize: 14),
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

class _Metricas extends StatelessWidget {
  const _Metricas({required this.campanha});
  final ResumoCampanha campanha;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final t = campanha.total;
    final itens = [
      ('Saíram', campanha.sairam, c.tintaSuave, Icons.north_east_rounded),
      ('Entregues', campanha.entregues, c.acento, Icons.done_all_rounded),
      ('Lidas', campanha.lidas, c.realce, Icons.visibility_outlined),
      ('Falhas', campanha.falhas, c.erro, Icons.error_outline_rounded),
    ];

    return Cartao(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  'Resultado',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ),
              ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 170),
                child: Text(
                  f.plural(t, 'destinatário', 'destinatários'),
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: c.tintaSuave, fontSize: 13),
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          // Duas colunas que crescem com o conteúdo, e não uma grade de altura
          // fixa: com fonte grande (acessibilidade) a grade cortava o número.
          LayoutBuilder(
            builder: (context, limites) {
              final largura = (limites.maxWidth - 10) / 2;
              return Wrap(
                spacing: 10,
                runSpacing: 10,
                children: [
                  for (final (rotulo, valor, cor, icone) in itens)
                    Container(
                      width: largura,
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: c.superficie2,
                        borderRadius: BorderRadius.circular(14),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Icon(
                                icone,
                                size: 16,
                                color: rotulo == 'Entregues' ? c.tinta : cor,
                              ),
                              const SizedBox(width: 6),
                              Flexible(
                                child: Text(
                                  rotulo,
                                  overflow: TextOverflow.ellipsis,
                                  style: TextStyle(
                                    fontSize: 13,
                                    color: c.tintaSuave,
                                  ),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 6),
                          FittedBox(
                            fit: BoxFit.scaleDown,
                            alignment: Alignment.centerLeft,
                            child: Row(
                              crossAxisAlignment: CrossAxisAlignment.baseline,
                              textBaseline: TextBaseline.alphabetic,
                              children: [
                                Text(
                                  f.numero(valor),
                                  style: const TextStyle(
                                    fontSize: 22,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                                const SizedBox(width: 6),
                                Text(
                                  f.porcento(valor, t),
                                  style: TextStyle(
                                    fontSize: 12,
                                    color: c.tintaSuave,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                ],
              );
            },
          ),
          const SizedBox(height: 14),
          _BarraFunil(campanha: campanha),
          const SizedBox(height: 10),
          Wrap(
            spacing: 14,
            runSpacing: 4,
            children: [
              if (campanha.naFila > 0)
                _Legenda(
                  cor: c.superficie2,
                  borda: c.borda,
                  texto: '${f.numero(campanha.naFila)} na fila',
                ),
              if (campanha.cancelados > 0)
                _Legenda(
                  cor: c.borda,
                  texto: '${f.numero(campanha.cancelados)} cancelados',
                ),
            ],
          ),
          const SizedBox(height: 10),
          Text(
            'Lida só aparece quando a pessoa mantém a confirmação de leitura ligada — o número real de leituras pode ser maior.',
            style: TextStyle(fontSize: 12, color: c.tintaSuave, height: 1.4),
          ),
        ],
      ),
    );
  }
}

/// A barra da campanha, em camadas: lidas, entregues, enviadas, falhas.
class _BarraFunil extends StatelessWidget {
  const _BarraFunil({required this.campanha});
  final ResumoCampanha campanha;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final t = campanha.total == 0 ? 1 : campanha.total;
    final partes = [
      (campanha.lidas, c.realce),
      (campanha.entregues - campanha.lidas, c.acento),
      (campanha.enviadas, c.tintaSuave.withValues(alpha: 0.45)),
      (campanha.falhas, c.erro),
    ];
    return ClipRRect(
      borderRadius: BorderRadius.circular(99),
      child: SizedBox(
        height: 10,
        child: Row(
          children: [
            for (final (valor, cor) in partes)
              if (valor > 0)
                Expanded(
                  flex: (valor * 1000 ~/ t).clamp(1, 1000),
                  child: Container(color: cor),
                ),
            if (campanha.naFila + campanha.cancelados > 0)
              Expanded(
                flex: ((campanha.naFila + campanha.cancelados) * 1000 ~/ t)
                    .clamp(1, 1000),
                child: Container(color: c.superficie2),
              ),
          ],
        ),
      ),
    );
  }
}

class _Legenda extends StatelessWidget {
  const _Legenda({required this.cor, required this.texto, this.borda});
  final Color cor;
  final Color? borda;
  final String texto;

  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      Container(
        width: 10,
        height: 10,
        decoration: BoxDecoration(
          color: cor,
          shape: BoxShape.circle,
          border: borda == null ? null : Border.all(color: borda!),
        ),
      ),
      const SizedBox(width: 6),
      Text(
        texto,
        style: TextStyle(fontSize: 12, color: Cores.de(context).tintaSuave),
      ),
    ],
  );
}

class _Janela extends StatelessWidget {
  const _Janela({required this.campanha});
  final ResumoCampanha campanha;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final itens = <(String, String)>[
      ('Dias', f.diasDaSemana(campanha.janelaDias)),
      if (campanha.janelaInicio != null)
        (
          'Horário',
          '${f.hora(campanha.janelaInicio)} às ${f.hora(campanha.janelaFim)}',
        ),
      if (campanha.pausaSegundos > 0)
        (
          'Ritmo',
          '1 mensagem a cada ${f.plural(campanha.pausaSegundos, 'segundo', 'segundos')}',
        ),
      if (campanha.maxPorDia != null)
        ('Por dia', 'até ${f.numero(campanha.maxPorDia!)}'),
      if (campanha.maxPorSemana != null)
        ('Por semana', 'até ${f.numero(campanha.maxPorSemana!)}'),
      if (campanha.maxPorMes != null)
        ('Por mês', 'até ${f.numero(campanha.maxPorMes!)}'),
    ];
    return Cartao(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Janela e ritmo',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 10),
          for (final (rotulo, valor) in itens)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Row(
                children: [
                  SizedBox(
                    width: 96,
                    child: Text(
                      rotulo,
                      style: TextStyle(color: c.tintaSuave, fontSize: 14),
                    ),
                  ),
                  Expanded(
                    child: Text(
                      valor,
                      style: const TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w500,
                      ),
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

(String, TomPilula) _situacaoDestinatario(String s) => switch (s) {
  'lida' => ('Lida', TomPilula.sucesso),
  'entregue' => ('Entregue', TomPilula.acento),
  'enviada' => ('Enviada', TomPilula.atencao),
  'enviando' => ('Enviando', TomPilula.neutro),
  'falhou' => ('Falhou', TomPilula.erro),
  'cancelado' => ('Cancelado', TomPilula.neutro),
  _ => ('Na fila', TomPilula.neutro),
};

class _Destinatarios extends ConsumerWidget {
  const _Destinatarios({required this.campanha});
  final ResumoCampanha campanha;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = Cores.de(context);
    final carga = ref.watch(destinatariosProvider(campanha.id));

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(top: 8, bottom: 10),
          child: Text(
            'Destinatários',
            style: Theme.of(context).textTheme.titleLarge,
          ),
        ),
        carga.when(
          loading: () => const Cartao(
            child: Column(
              children: [
                Esqueleto(),
                SizedBox(height: 12),
                Esqueleto(),
                SizedBox(height: 12),
                Esqueleto(),
              ],
            ),
          ),
          error: (e, _) => EstadoErro(
            titulo: 'Não consegui ler os destinatários',
            mensagem: mensagemDoErro(e),
            aoTentar: () => ref.invalidate(destinatariosProvider(campanha.id)),
          ),
          data: (lista) {
            if (lista.isEmpty) {
              return Cartao(
                child: Text(
                  'Nenhum destinatário.',
                  style: TextStyle(color: c.tintaSuave),
                ),
              );
            }
            return Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (campanha.total > lista.length)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: Text(
                      'Mostrando ${f.numero(lista.length)} de ${f.numero(campanha.total)}, com as falhas primeiro. Os números do resultado contam todos.',
                      style: TextStyle(
                        fontSize: 12,
                        color: c.tintaSuave,
                        height: 1.4,
                      ),
                    ),
                  ),
                Cartao(
                  padding: EdgeInsets.zero,
                  child: Column(
                    children: [
                      for (var i = 0; i < lista.length; i++) ...[
                        if (i > 0) const Divider(height: 1),
                        _LinhaDestinatario(d: lista[i]),
                      ],
                    ],
                  ),
                ),
              ],
            );
          },
        ),
      ],
    );
  }
}

class _LinhaDestinatario extends StatelessWidget {
  const _LinhaDestinatario({required this.d});
  final DestinatarioCampanha d;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final (rotulo, tom) = _situacaoDestinatario(d.status);
    final temErro =
        d.status == 'falhou' && (d.erroTitulo != null || d.erroDetalhe != null);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  f.telefone(d.telefone),
                  style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ),
              if (d.ultimoEm != null) ...[
                Text(
                  f.quando(d.ultimoEm),
                  style: TextStyle(fontSize: 12, color: c.tintaSuave),
                ),
                const SizedBox(width: 8),
              ],
              Pilula(rotulo, tom: tom, vivo: d.status == 'enviando'),
            ],
          ),
          // O motivo real da falha, como a Meta explicou — é o que diz se o
          // problema é do número, do modelo ou da pessoa.
          if (temErro) ...[
            const SizedBox(height: 6),
            if (d.erroTitulo != null)
              Text(
                d.erroTitulo!,
                style: TextStyle(
                  fontSize: 13,
                  color: c.erro,
                  fontWeight: FontWeight.w600,
                ),
              ),
            if (d.erroDetalhe != null)
              Text(
                d.erroDetalhe!,
                style: TextStyle(
                  fontSize: 12,
                  color: c.tintaSuave,
                  height: 1.4,
                ),
              ),
          ],
        ],
      ),
    );
  }
}

/// A ação principal fica embaixo, onde o polegar alcança, e muda com a situação.
class _BarraDeAcao extends StatelessWidget {
  const _BarraDeAcao({
    required this.campanha,
    required this.ocupado,
    required this.aoDisparar,
    required this.aoPausar,
    required this.aoRetomar,
  });

  final ResumoCampanha campanha;
  final bool ocupado;
  final Future<void> Function(ResumoCampanha) aoDisparar;
  final Future<void> Function(ResumoCampanha) aoPausar;
  final Future<void> Function(ResumoCampanha) aoRetomar;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final (rotulo, icone, acao, primario) = campanha.podeDisparar
        ? ('Disparar agora', Icons.bolt_rounded, aoDisparar, true)
        : campanha.podePausar
        ? ('Pausar envio', Icons.pause_rounded, aoPausar, false)
        : campanha.podeRetomar && campanha.pausaMotivo != 'inadimplencia'
        ? ('Retomar envio', Icons.play_arrow_rounded, aoRetomar, true)
        : (null, null, null, false);
    if (rotulo == null) return const SizedBox.shrink();

    final carregando = SizedBox.square(
      dimension: 22,
      child: CircularProgressIndicator(strokeWidth: 2.5, color: c.tinta),
    );
    return SafeArea(
      top: false,
      child: Container(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 12),
        decoration: BoxDecoration(
          color: c.superficie,
          border: Border(top: BorderSide(color: c.borda)),
        ),
        child: primario
            ? FilledButton.icon(
                onPressed: ocupado ? null : () => acao!(campanha),
                icon: ocupado ? carregando : Icon(icone),
                label: Text(rotulo),
              )
            : OutlinedButton.icon(
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size.fromHeight(52),
                ),
                onPressed: ocupado ? null : () => acao!(campanha),
                icon: ocupado ? carregando : Icon(icone),
                label: Text(rotulo),
              ),
      ),
    );
  }
}

class _BotaoSite extends StatelessWidget {
  const _BotaoSite({required this.rotulo, required this.caminho});
  final String rotulo;
  final String caminho;

  @override
  Widget build(BuildContext context) => Align(
    alignment: Alignment.centerLeft,
    child: OutlinedButton.icon(
      style: OutlinedButton.styleFrom(minimumSize: const Size(0, 40)),
      onPressed: () => launchUrl(
        Uri.parse('$urlWeb$caminho'),
        mode: LaunchMode.externalApplication,
      ),
      icon: const Icon(Icons.open_in_new_rounded, size: 18),
      label: Text(rotulo),
    ),
  );
}
