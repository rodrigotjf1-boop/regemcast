import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/campanhas.dart';
import '../api/dados.dart';
import '../api/erro_api.dart';
import '../api/leituras.dart';
import '../componentes/basicos.dart';
import '../componentes/campanha.dart';
import '../componentes/categoria.dart';
import '../config.dart';
import '../tema/cores.dart';
import '../util/formato.dart' as f;
import 'bloqueios.dart';
import 'campanha_formulario.dart';
import 'casca.dart';
import 'plano.dart';
import 'whatsapp.dart';

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
      'Campanha agendada. As mensagens saem pelo servidor, respeitando a janela e o ritmo que você definiu — esta tela se atualiza sozinha.',
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
      MaterialPageRoute(builder: (_) => TelaFormularioCampanha(campanha: camp)),
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
            padding: respiroDaTela(context),
            children: [
              _Cabecalho(campanha: camp),
              const SizedBox(height: 14),
              ..._alertas(camp, c),
              // Antes de disparar ou de retomar: o que a Meta aponta na conta.
              if (camp.podeDisparar || camp.podeRetomar) const AvisoDaSaude(),
              _Metricas(campanha: camp),
              const SizedBox(height: 14),
              if (camp.falhasPorMotivo.isNotEmpty) ...[
                _PorQueFalhou(falhas: camp.falhasPorMotivo),
                const SizedBox(height: 14),
              ],
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
    final espera = camp.espera;

    if (camp.status == 'enviando') {
      lista.add(
        const Aviso(
          tom: TomPilula.acento,
          icone: Icons.send_rounded,
          texto:
              'Enviando. As mensagens saem pelo servidor — você pode fechar o app.',
        ),
      );
    }
    if (camp.status == 'rascunho') {
      lista.add(
        const Aviso(
          tom: TomPilula.acento,
          icone: Icons.info_outline_rounded,
          texto:
              'Esta campanha ainda não saiu. Confira os números abaixo antes de disparar — depois não dá para desfazer.',
        ),
      );
    }
    if (camp.status == 'agendada' && espera == null) {
      lista.add(
        const Aviso(
          tom: TomPilula.acento,
          icone: Icons.schedule_rounded,
          texto:
              'Agendada. As mensagens começam a sair na próxima abertura da janela de envio.',
        ),
      );
    }
    if (espera?.motivo == 'limite_meta') {
      final quantas = espera!.limite != null
          ? f.numero(espera.limite!)
          : 'o máximo de';
      final quando = espera.ate != null
          ? 'A campanha continua sozinha a partir de ${f.dataHora(espera.ate)}'
          : 'A campanha continua sozinha assim que abrir vaga';
      lista.add(
        Aviso(
          tom: TomPilula.acento,
          icone: Icons.hourglass_top_rounded,
          texto:
              'Aguardando o limite da Meta: sua conta já falou com $quantas pessoas diferentes nas últimas 24 horas, o teto do seu número hoje. $quando — ninguém fica de fora nem é marcado como falha.',
          acao: Align(
            alignment: Alignment.centerLeft,
            child: OutlinedButton(
              style: OutlinedButton.styleFrom(minimumSize: const Size(0, 40)),
              onPressed: () => Navigator.of(
                context,
              ).push(MaterialPageRoute(builder: (_) => const TelaWhatsapp())),
              child: const Text('Ver o limite do número'),
            ),
          ),
        ),
      );
    }
    if (espera?.motivo == 'ritmo') {
      final quando = espera!.ate != null
          ? 'A campanha continua sozinha a partir de ${f.dataHora(espera.ate)}'
          : 'A campanha continua sozinha em instantes';
      lista.add(
        Aviso(
          tom: TomPilula.acento,
          icone: Icons.speed_rounded,
          texto:
              'A Meta pediu para desacelerar: muitas mensagens em pouco tempo. $quando — quem ficou na fila sai depois, sem perder a mensagem.',
        ),
      );
    }
    if (camp.status == 'cancelada') {
      lista.add(
        const Aviso(
          texto:
              'Campanha cancelada. Quem não tinha recebido não recebeu — o que saiu antes continua no histórico abaixo.',
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
                  'Pausada: a conexão com o WhatsApp caiu antes de terminar. Ninguém foi marcado como falha — quem faltava continua na fila. Reconecte o WhatsApp e retome.',
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
                  'Pausada: os disparos do seu plano acabaram neste ciclo. Ninguém foi marcado como falha — quem faltava continua na fila e a campanha volta a sair sozinha quando o ciclo virar ou quando o plano tiver mais disparos.',
            ),
          );
        case 'inadimplencia':
          lista.add(
            Aviso(
              tom: TomPilula.erro,
              icone: Icons.credit_card_off_rounded,
              texto:
                  'Pausada: os disparos da conta estão parados por falta de pagamento do plano. Quem faltava continua na fila e a campanha volta sozinha assim que o pagamento for confirmado.',
              // O plano tem tela no app: pagar ou trocar não precisa do site.
              acao: const _BotaoTela(
                rotulo: 'Ver plano e pagamento',
                tela: TelaPlano(),
              ),
            ),
          );
        case 'conta_meta':
          // A Meta recusou por um problema da CONTA do WhatsApp (pagamento,
          // restrição, registro): a mensagem seguinte teria a mesma resposta.
          lista.add(
            const Aviso(
              key: ValueKey('cd-pausa-conta'),
              tom: TomPilula.erro,
              icone: Icons.report_gmailerrorred_rounded,
              texto:
                  'Pausada: a Meta recusou o envio por um problema da conta do WhatsApp, e a mensagem seguinte teria a mesma resposta. A campanha parou — quem faltava continua na fila e sai quando você retomar.',
            ),
          );
          if (camp.pausaErro != null) {
            lista.add(Cartao(child: BlocoDoErro(erro: camp.pausaErro!)));
          }
        case 'modelo':
          lista.add(
            const Aviso(
              key: ValueKey('cd-pausa-modelo'),
              tom: TomPilula.erro,
              icone: Icons.report_gmailerrorred_rounded,
              texto:
                  'Pausada: a Meta recusou o modelo desta campanha, ou o arquivo dele não está mais disponível. A campanha parou na primeira recusa — quem faltava continua na fila, sem ser marcado como falha. Veja o motivo na lista abaixo, confira o modelo e retome.',
              acao: _BotaoTela(
                rotulo: 'Ver modelos',
                tela: TelaModelosAvulsa(),
              ),
            ),
          );
          if (camp.pausaErro != null) {
            lista.add(Cartao(child: BlocoDoErro(erro: camp.pausaErro!)));
          }
      }
    }
    return lista.map(embrulhar).toList();
  }
}

// ----------------------------------------------------------------- blocos

/// O aviso curto antes de disparar ou de retomar: se a Meta BLOQUEOU o envio,
/// diz por quê e leva à tela do WhatsApp, onde está o que fazer. Quieto quando
/// está tudo certo e quando não deu para conferir — o servidor confere de novo
/// na hora do disparo.
///
/// Só o bloqueio aparece aqui. "Envia com restrição" pode durar semanas (um
/// nome de exibição aguardando aprovação) e a mensagem sai: um aviso amarelo em
/// toda campanha ensinaria a ignorar o vermelho. A restrição fica na tela do
/// WhatsApp.
class AvisoDaSaude extends ConsumerWidget {
  const AvisoDaSaude({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final saude = ref.watch(saudeDaContaProvider).value;
    final problema = saude?.motivoDoBloqueio;
    if (saude == null || !saude.bloqueada || problema == null) {
      return const SizedBox.shrink();
    }
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Column(
        key: const ValueKey('cd-saude'),
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Aviso(
            tom: TomPilula.erro,
            icone: Icons.block_rounded,
            texto:
                'A Meta não deixa esta conta enviar agora. Resolva o ponto abaixo antes de disparar.',
          ),
          const SizedBox(height: 10),
          Cartao(child: BlocoDoErro(erro: problema.comTela('whatsapp'))),
        ],
      ),
    );
  }
}

class _Cabecalho extends StatelessWidget {
  const _Cabecalho({required this.campanha});
  final ResumoCampanha campanha;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final (rotulo, tom, vivo) = situacaoDaCampanha(campanha);
    final categoria = nomeDaCategoria(campanha.modeloCategoria);
    final linhas = <(IconData, String)>[
      (
        Icons.description_outlined,
        [
          categoria == null
              ? campanha.modeloNome
              : '${campanha.modeloNome} ($categoria)',
          ?campanha.modeloIdioma,
        ].join(' · '),
      ),
      (
        Icons.groups_outlined,
        campanha.listaNome != null
            ? 'Lista ${campanha.listaNome}'
            : campanha.publicoRotulo != null
            ? 'Público ${campanha.publicoRotulo}'
            : publicoDaCampanha(campanha),
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

/// Por que as mensagens falharam, do motivo mais comum para o menos. Quem tem
/// 300 falhas lê três motivos, cada um com o que fazer — e não 300 linhas.
class _PorQueFalhou extends StatelessWidget {
  const _PorQueFalhou({required this.falhas});
  final List<FalhaPorMotivo> falhas;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    return Cartao(
      key: const ValueKey('cd-por-que-falhou'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text(
            'Por que falhou',
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 2),
          Text(
            falhas.length == 1
                ? 'Um motivo, com o que fazer.'
                : '${falhas.length} motivos, do mais comum para o menos, cada um com o que fazer.',
            style: TextStyle(color: c.tintaSuave, fontSize: 12.5),
          ),
          for (final (i, falha) in falhas.indexed) ...[
            if (i > 0)
              Divider(height: 28, color: c.borda)
            else
              const SizedBox(height: 14),
            Text(
              f.plural(falha.total, 'mensagem', 'mensagens'),
              style: TextStyle(
                color: c.erro,
                fontSize: 12.5,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 4),
            BlocoDoErro(erro: falha.erro),
          ],
        ],
      ),
    );
  }
}

/// Um erro da Meta do jeito que guia: o que houve, o que fazer, quem resolve e
/// por onde. O texto vem pronto do servidor. A frase da Meta, em inglês, nunca
/// é a explicação: fica recolhida em "O que a Meta respondeu".
class BlocoDoErro extends StatefulWidget {
  const BlocoDoErro({super.key, required this.erro});
  final ErroQueGuia erro;

  @override
  State<BlocoDoErro> createState() => _BlocoDoErroState();
}

class _BlocoDoErroState extends State<BlocoDoErro> {
  bool _aberto = false;

  static const _quem = {
    'voce': ('Depende de você', TomPilula.atencao),
    'nos': ('É conosco', TomPilula.acento),
    'ninguem': ('Sem ação sua', TomPilula.neutro),
  };

  /// A tela do app onde se resolve. Contatos é uma aba: não tem atalho daqui.
  (String, Widget)? get _tela => switch (widget.erro.tela) {
    'whatsapp' => ('Abrir WhatsApp', const TelaWhatsapp()),
    'modelos' => ('Ver modelos', const TelaModelosAvulsa()),
    'bloqueios' => ('Ver bloqueios', const TelaBloqueios()),
    _ => null,
  };

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final erro = widget.erro;
    final quem = _quem[erro.quem];
    final tela = _tela;
    // No app da Play nada leva a uma página de pagamento fora dele — nem a da
    // Meta. A explicação fica; o atalho, não.
    final link = erro.linkUrl != null && (compraNoApp || !erro.linkDePagamento)
        ? erro.linkUrl
        : null;
    final daMeta = erro.daMeta;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Wrap(
          spacing: 8,
          runSpacing: 6,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            Text(
              erro.titulo,
              style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
            ),
            if (quem != null) Pilula(quem.$1, tom: quem.$2, ponto: false),
          ],
        ),
        const SizedBox(height: 6),
        Text(
          erro.explicacao,
          style: TextStyle(color: c.tintaSuave, height: 1.45),
        ),
        if (erro.acao != null) ...[
          const SizedBox(height: 6),
          Text.rich(
            TextSpan(
              children: [
                const TextSpan(
                  text: 'O que fazer: ',
                  style: TextStyle(fontWeight: FontWeight.w600),
                ),
                TextSpan(text: erro.acao),
              ],
            ),
            style: const TextStyle(height: 1.45),
          ),
        ],
        if (link != null || tela != null) ...[
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              if (link != null)
                OutlinedButton.icon(
                  key: const ValueKey('erro-link'),
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size(0, 40),
                  ),
                  onPressed: () => launchUrl(
                    Uri.parse(link),
                    mode: LaunchMode.externalApplication,
                  ),
                  icon: const Icon(Icons.open_in_new_rounded, size: 18),
                  label: Text(erro.linkRotulo ?? 'Abrir na Meta'),
                ),
              if (tela != null)
                OutlinedButton(
                  key: const ValueKey('erro-tela'),
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size(0, 40),
                  ),
                  onPressed: () => Navigator.of(
                    context,
                  ).push(MaterialPageRoute<void>(builder: (_) => tela.$2)),
                  child: Text(tela.$1),
                ),
            ],
          ),
        ],
        if (daMeta != null) ...[
          const SizedBox(height: 4),
          TextButton(
            key: const ValueKey('erro-da-meta'),
            style: TextButton.styleFrom(
              padding: EdgeInsets.zero,
              minimumSize: const Size(0, 36),
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
            onPressed: () => setState(() => _aberto = !_aberto),
            child: Text(
              _aberto
                  ? 'Esconder o que a Meta respondeu'
                  : 'O que a Meta respondeu',
              style: TextStyle(color: c.tintaSuave, fontSize: 12.5),
            ),
          ),
          if (_aberto)
            Text(
              '${erro.codigo != null ? 'Código ${erro.codigo}. ' : ''}$daMeta',
              style: TextStyle(
                color: c.tintaSuave,
                fontSize: 12.5,
                height: 1.4,
              ),
            ),
        ],
      ],
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
    final r = campanha.respondidas;
    final itens = [
      (
        'Enviadas',
        campanha.aceitas,
        c.tintaSuave,
        Icons.north_east_rounded,
        f.porcento(campanha.aceitas, t),
      ),
      (
        'Entregues',
        campanha.entregues,
        c.realce,
        Icons.done_all_rounded,
        f.porcento(campanha.entregues, t),
      ),
      (
        'Lidas',
        campanha.lidas,
        c.acento,
        Icons.visibility_outlined,
        r > 0
            ? '${f.porcento(campanha.lidas, t)} · ${f.numero(r)} ${r == 1 ? 'respondeu' : 'responderam'}'
            : f.porcento(campanha.lidas, t),
      ),
      (
        'Falhas',
        campanha.falhas,
        c.erro,
        Icons.error_outline_rounded,
        f.porcento(campanha.falhas, t),
      ),
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
                  for (final (rotulo, valor, cor, icone, apoio) in itens)
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
                                color: rotulo == 'Lidas' ? c.tinta : cor,
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
                            child: Text(
                              f.numero(valor),
                              style: TextStyle(
                                fontSize: 22,
                                fontWeight: FontWeight.w700,
                                color: rotulo == 'Falhas' && valor > 0
                                    ? c.erro
                                    : c.tinta,
                              ),
                            ),
                          ),
                          Text(
                            apoio,
                            style: TextStyle(fontSize: 12, color: c.tintaSuave),
                          ),
                        ],
                      ),
                    ),
                ],
              );
            },
          ),
          const SizedBox(height: 14),
          BarraDeStatus(campanha: campanha),
          if (campanha.descansoDias != null && campanha.descansoDias! > 0) ...[
            const SizedBox(height: 10),
            Text(
              'Descanso de ${f.plural(campanha.descansoDias!, 'dia', 'dias')}: quem recebeu outra campanha de marketing nesse prazo fica de fora, sem contar no plano${campanha.emDescanso > 0 ? ' — ${f.numero(campanha.emDescanso)} ${campanha.emDescanso == 1 ? 'pessoa ficou' : 'pessoas ficaram'} de fora até agora' : ''}.',
              style: TextStyle(fontSize: 12, color: c.tintaSuave, height: 1.4),
            ),
          ],
          const SizedBox(height: 10),
          Text(
            'Enviada quer dizer que a Meta aceitou a mensagem — ainda não que ela chegou. Entregue é a confirmação de que chegou ao aparelho, e vem depois, pela própria Meta. Lida só é informada quando a pessoa mantém a confirmação de leitura ligada no WhatsApp — o número real de leituras pode ser maior.',
            style: TextStyle(fontSize: 12, color: c.tintaSuave, height: 1.4),
          ),
        ],
      ),
    );
  }
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

/// O que cada estado significa, em uma frase (as mesmas da web).
const _explicacao = {
  'pendente': 'Ainda não saiu.',
  'enviando': 'Saindo agora.',
  'enviada': 'A Meta aceitou. Ainda não chegou ao aparelho.',
  'entregue': 'Chegou ao aparelho.',
  'lida': 'A pessoa abriu.',
  'falhou': 'Não foi entregue.',
  'descanso':
      'Recebeu outra campanha de marketing há pouco e ficou de fora. Não contou no plano.',
  'cancelado': 'A campanha foi cancelada antes de sair para esta pessoa.',
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
          child: Row(
            children: [
              Expanded(
                child: Text(
                  'Destinatários',
                  style: Theme.of(context).textTheme.titleLarge,
                ),
              ),
              if (campanha.emAndamento)
                const Pilula('Atualizando sozinha', vivo: true),
            ],
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
                      'Mostrando ${f.numero(lista.length)} de ${f.numero(campanha.total)}, com as falhas primeiro. Os totais acima contam todos.',
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
    final (rotulo, tom) = situacaoDoDestinatario(d.status);
    final falhou = d.status == 'falhou' && d.erroDetalhe != null;
    // O motivo real da falha, como a Meta explicou — é o que diz se o
    // problema é do número, do modelo ou da pessoa. Descanso também traz o
    // porquê; o resto, a frase de cada estado.
    final explicacao = falhou
        ? d.erroDetalhe!
        : d.status == 'descanso' && d.erroDetalhe != null
        ? d.erroDetalhe!
        : _explicacao[d.status] ?? '—';
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
          const SizedBox(height: 6),
          if (falhou && d.erroTitulo != null)
            Text(
              d.erroTitulo!,
              style: TextStyle(
                fontSize: 13,
                color: c.erro,
                fontWeight: FontWeight.w600,
              ),
            ),
          Text(
            explicacao,
            style: TextStyle(fontSize: 12.5, color: c.tintaSuave, height: 1.4),
          ),
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

class _BotaoTela extends StatelessWidget {
  const _BotaoTela({required this.rotulo, required this.tela});
  final String rotulo;
  final Widget tela;

  @override
  Widget build(BuildContext context) => Align(
    alignment: Alignment.centerLeft,
    child: OutlinedButton(
      style: OutlinedButton.styleFrom(minimumSize: const Size(0, 40)),
      onPressed: () => Navigator.of(
        context,
      ).push(MaterialPageRoute<void>(builder: (_) => tela)),
      child: Text(rotulo),
    ),
  );
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
