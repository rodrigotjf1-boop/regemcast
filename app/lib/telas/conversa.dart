import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/contatos.dart';
import '../api/conversas.dart';
import '../api/erro_api.dart';
import '../componentes/basicos.dart';
import '../componentes/dialogos.dart';
import '../componentes/escolha.dart';
import '../componentes/midia_da_conversa.dart';
import '../tema/cores.dart';
import '../util/formato.dart' as f;
import 'campanha_formulario.dart';

/// Relê a conversa aberta a cada 5 segundos — só com o app na frente.
const _aCadaConversa = Duration(seconds: 5);

/// A que distância do fim ainda conta como "lendo o fim".
const _pertoDoFim = 120.0;

/// O teto da Meta para texto.
const _limiteDoTexto = 4096;

/// Uma conversa aberta, no jeito do WhatsApp: quem é, as mensagens e a caixa
/// de resposta — a mesma do site (`painel-conversa.tsx`).
///
/// A lista é invertida (a mais nova embaixo): carregar as anteriores não
/// mexe no ponto de leitura, e mensagem nova só puxa a tela se a pessoa já
/// estava no fim.
class TelaConversa extends ConsumerStatefulWidget {
  const TelaConversa({super.key, required this.conversa});

  /// O que a lista já sabe — o cabeçalho aparece na hora.
  final ConversaResumo conversa;

  @override
  ConsumerState<TelaConversa> createState() => _TelaConversaState();
}

class _TelaConversaState extends ConsumerState<TelaConversa> {
  late ConversaResumo _c = widget.conversa;
  final _mensagens = <MensagemDaConversa>[];
  final _rolagem = ScrollController();
  final _texto = TextEditingController();
  late final AppLifecycleListener _ciclo;
  Timer? _relogio;

  bool _carregou = false;
  Object? _erro;
  bool _temAnteriores = false;
  bool _carregandoAnteriores = false;
  bool _lendo = false;
  bool _enviando = false;
  bool _naFrente = true;

  ServicoConversas get _servico => ref.read(servicoConversasProvider);

  @override
  void initState() {
    super.initState();
    _ciclo = AppLifecycleListener(
      onStateChange: (estado) {
        _naFrente = estado == AppLifecycleState.resumed;
        if (_naFrente) _carregarRecentes();
      },
    );
    _relogio = Timer.periodic(_aCadaConversa, (_) {
      if (_naFrente) _carregarRecentes();
    });
    _texto.addListener(() => setState(() {}));
    _carregarRecentes(primeira: true);
    _lerCabecalho();
    if (_c.naoLidas > 0) _marcarLida();
  }

  @override
  void dispose() {
    _relogio?.cancel();
    _ciclo.dispose();
    _rolagem.dispose();
    _texto.dispose();
    super.dispose();
  }

  void _marcarLida() {
    _servico.marcarLida(_c.id).catchError((_) {});
  }

  /// O cabeçalho do servidor: a janela de 24 horas reabre quando a pessoa
  /// escreve, e a lista pode estar alguns segundos atrás.
  Future<void> _lerCabecalho() async {
    try {
      final c = await _servico.detalhe(_c.id);
      if (mounted) setState(() => _c = c.lida());
    } catch (_) {
      // Sem o cabeçalho novo, fica o da lista.
    }
  }

  Future<void> _carregarRecentes({bool primeira = false}) async {
    if (_lendo) return;
    _lendo = true;
    try {
      final recentes = await _servico.mensagens(_c.id);
      if (!mounted) return;
      final conhecidas = {for (final m in _mensagens) m.id};
      final novasDoCliente =
          _carregou &&
          recentes.any((m) => !m.saida && !conhecidas.contains(m.id));
      _aplicar(() {
        final juntas = mesclarMensagens(_mensagens, recentes);
        _mensagens
          ..clear()
          ..addAll(juntas);
        if (primeira) _temAnteriores = recentes.length >= mensagensPorPagina;
        _carregou = true;
        _erro = null;
      });
      if (novasDoCliente) {
        _marcarLida();
        _lerCabecalho();
      }
    } catch (e) {
      if (mounted && !_carregou) setState(() => _erro = e);
    } finally {
      _lendo = false;
    }
  }

  /// Muda a lista mantendo o ponto de leitura: quem rolou para cima não é
  /// puxado para baixo quando chega mensagem nova.
  void _aplicar(VoidCallback mudar) {
    final pos = _rolagem.hasClients ? _rolagem.position : null;
    final noFim = pos == null || pos.pixels <= _pertoDoFim;
    final ultimaAntes = _mensagens.isEmpty ? null : _mensagens.last.id;
    final maximoAntes = pos?.maxScrollExtent;
    final pixelsAntes = pos?.pixels;
    setState(mudar);
    final ultimaDepois = _mensagens.isEmpty ? null : _mensagens.last.id;
    if (noFim || ultimaAntes == ultimaDepois || pixelsAntes == null) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_rolagem.hasClients) return;
      final p = _rolagem.position;
      p.jumpTo(
        (pixelsAntes + (p.maxScrollExtent - maximoAntes!)).clamp(
          0.0,
          p.maxScrollExtent,
        ),
      );
    });
  }

  Future<void> _carregarAnteriores() async {
    if (_mensagens.isEmpty) return;
    setState(() => _carregandoAnteriores = true);
    try {
      final anteriores = await _servico.mensagens(
        _c.id,
        antesDe: _mensagens.first.criadaEm,
      );
      if (!mounted) return;
      final conhecidas = {for (final m in _mensagens) m.id};
      setState(() {
        _mensagens.insertAll(0, [
          for (final m in anteriores)
            if (!conhecidas.contains(m.id)) m,
        ]);
        _temAnteriores = anteriores.length >= mensagensPorPagina;
      });
    } catch (e) {
      if (mounted) avisar(context, mensagemDoErro(e));
    } finally {
      if (mounted) setState(() => _carregandoAnteriores = false);
    }
  }

  Future<void> _enviar() async {
    final corpo = _texto.text.trim();
    if (corpo.isEmpty || _enviando) return;
    setState(() => _enviando = true);
    try {
      final nova = await _servico.responder(_c.id, corpo);
      if (!mounted) return;
      setState(() {
        _mensagens.add(nova);
        _texto.clear();
      });
      if (_rolagem.hasClients) _rolagem.jumpTo(0);
    } catch (e) {
      if (mounted) avisar(context, mensagemDoErro(e));
      // A janela pode ter fechado enquanto a pessoa escrevia.
      _lerCabecalho();
    } finally {
      if (mounted) setState(() => _enviando = false);
    }
  }

  Future<void> _adicionarNaLista() async {
    final contatoId = _c.contatoId;
    if (contatoId == null) return;
    await abrirFolha<void>(
      context,
      builder: (_) => _FolhaDaLista(contatoId: contatoId),
    );
  }

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final janela = _c.janelaAteEm;
    final aberta = janela != null && janela.isAfter(DateTime.now());
    return Scaffold(
      appBar: AppBar(
        titleSpacing: 0,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              _c.nome ?? f.telefone(_c.telefone),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600),
            ),
            if (_c.nome != null)
              Text(
                f.telefone(_c.telefone),
                style: TextStyle(
                  color: c.tintaSuave,
                  fontSize: 12.5,
                  fontWeight: FontWeight.w400,
                  fontFeatures: const [FontFeature.tabularFigures()],
                ),
              ),
          ],
        ),
        actions: [
          if (_c.optOut)
            const Padding(
              padding: EdgeInsets.only(right: 12),
              child: Pilula('Saiu das promoções', tom: TomPilula.atencao),
            )
          else if (_c.contatoId == null)
            const Padding(
              padding: EdgeInsets.only(right: 12),
              child: Pilula('Fora da sua base', ponto: false),
            )
          else
            IconButton(
              key: const ValueKey('adicionar-na-lista'),
              tooltip: 'Adicionar à lista',
              icon: const Icon(Icons.playlist_add_rounded),
              onPressed: _adicionarNaLista,
            ),
        ],
      ),
      body: Column(
        children: [
          Expanded(
            child: ColoredBox(color: c.superficie2, child: _corpo(c)),
          ),
          if (aberta)
            _CaixaDeResposta(
              controle: _texto,
              ate: janela,
              enviando: _enviando,
              aoEnviar: _enviar,
            )
          else
            const _JanelaFechada(),
        ],
      ),
    );
  }

  Widget _corpo(Cores c) {
    if (!_carregou && _erro != null) {
      return ListView(
        padding: const EdgeInsets.all(20),
        children: [
          EstadoErro(
            titulo: 'Não consegui abrir a conversa',
            mensagem: mensagemDoErro(_erro!),
            aoTentar: () {
              setState(() => _erro = null);
              _carregarRecentes(primeira: true);
            },
          ),
        ],
      );
    }
    if (!_carregou) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_mensagens.isEmpty) {
      return Center(
        child: Text(
          'Nenhuma mensagem nesta conversa ainda.',
          style: TextStyle(color: c.tintaSuave),
        ),
      );
    }
    final n = _mensagens.length;
    return ListView.builder(
      key: const ValueKey('mensagens'),
      controller: _rolagem,
      reverse: true,
      padding: const EdgeInsets.fromLTRB(12, 12, 12, 12),
      itemCount: n + (_temAnteriores ? 1 : 0),
      itemBuilder: (_, i) {
        if (i == n) {
          return Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Center(
              child: OutlinedButton(
                key: const ValueKey('anteriores'),
                style: OutlinedButton.styleFrom(minimumSize: const Size(0, 38)),
                onPressed: _carregandoAnteriores ? null : _carregarAnteriores,
                child: _carregandoAnteriores
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Text('Carregar mensagens anteriores'),
              ),
            ),
          );
        }
        final m = _mensagens[n - 1 - i];
        final anterior = n - 2 - i >= 0 ? _mensagens[n - 2 - i] : null;
        final novoDia =
            anterior == null || !f.mesmoDia(anterior.criadaEm, m.criadaEm);
        return Column(
          children: [
            if (novoDia) _SeparadorDeDia(rotulo: f.rotuloDoDia(m.criadaEm)),
            BolhaDaMensagem(conversaId: _c.id, mensagem: m),
          ],
        );
      },
    );
  }
}

class _SeparadorDeDia extends StatelessWidget {
  const _SeparadorDeDia({required this.rotulo});

  final String rotulo;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Center(
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 3),
          decoration: BoxDecoration(
            color: c.superficie,
            borderRadius: BorderRadius.circular(99),
            border: Border.all(color: c.borda),
          ),
          child: Text(
            rotulo[0].toUpperCase() + rotulo.substring(1),
            style: TextStyle(
              color: c.tintaSuave,
              fontSize: 11.5,
              fontWeight: FontWeight.w500,
            ),
          ),
        ),
      ),
    );
  }
}

/// Uma mensagem, como no WhatsApp: do cliente à esquerda, da empresa à
/// direita — em lima, com o texto escuro por cima (lima é fundo, nunca
/// letra). Embaixo, a hora, de onde saiu e o status; falha com o motivo real.
class BolhaDaMensagem extends StatelessWidget {
  const BolhaDaMensagem({
    super.key,
    required this.conversaId,
    required this.mensagem,
  });

  final String conversaId;
  final MensagemDaConversa mensagem;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final m = mensagem;
    final saida = m.saida;
    final frente = saida ? c.acentoContraste : c.tinta;
    final suave = frente.withValues(alpha: saida ? .75 : 1);
    final corSuave = saida ? suave : c.tintaSuave;
    final texto = TextStyle(color: frente, fontSize: 15, height: 1.35);
    final pequeno = TextStyle(
      color: corSuave,
      fontSize: 12.5,
      fontStyle: FontStyle.italic,
    );

    final Widget conteudo;
    if (ehMidia(m.tipo)) {
      conteudo = Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (m.temMidia)
            MidiaDaMensagem(conversaId: conversaId, mensagem: m, cor: frente)
          else
            Text('${rotulosDaMidia[m.tipo]} — só no celular', style: pequeno),
          if (m.texto != null && m.texto!.isNotEmpty) ...[
            const SizedBox(height: 6),
            Text(m.texto!, style: texto),
          ],
        ],
      );
    } else if (m.tipo == 'reaction') {
      conteudo = Text(
        'Reagiu com ${m.texto ?? 'uma reação'}',
        style: texto.copyWith(fontStyle: FontStyle.italic),
      );
    } else if (m.tipo == 'location') {
      conteudo = Text('📍 ${m.texto ?? 'Localização'}', style: texto);
    } else if (m.tipo == 'contacts') {
      conteudo = Text('👤 ${m.texto ?? 'Contato'}', style: texto);
    } else if (m.texto != null && m.texto!.isNotEmpty) {
      conteudo = Text(m.texto!, style: m.tipo == 'system' ? pequeno : texto);
    } else {
      conteudo = Text('Mensagem que só abre no celular.', style: pequeno);
    }

    final raio = const Radius.circular(18);
    final canto = const Radius.circular(6);
    return Align(
      alignment: saida ? Alignment.centerRight : Alignment.centerLeft,
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxWidth: MediaQuery.sizeOf(context).width * .82,
        ),
        child: GestureDetector(
          // Pressionar e segurar copia o texto, como no WhatsApp.
          onLongPress: m.texto == null || m.texto!.isEmpty
              ? null
              : () {
                  Clipboard.setData(ClipboardData(text: m.texto!));
                  avisar(context, 'Mensagem copiada.');
                },
          child: Container(
            margin: const EdgeInsets.symmetric(vertical: 3),
            padding: const EdgeInsets.fromLTRB(12, 8, 12, 6),
            decoration: BoxDecoration(
              color: saida ? c.acento : c.superficie,
              border: saida ? null : Border.all(color: c.borda),
              borderRadius: BorderRadius.only(
                topLeft: raio,
                topRight: raio,
                bottomLeft: saida ? raio : canto,
                bottomRight: saida ? canto : raio,
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              mainAxisSize: MainAxisSize.min,
              children: [
                Align(alignment: Alignment.centerLeft, child: conteudo),
                const SizedBox(height: 3),
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (saida && m.origem == 'celular') ...[
                      Text(
                        'pelo celular',
                        style: TextStyle(color: corSuave, fontSize: 11.5),
                      ),
                      const SizedBox(width: 6),
                    ] else if (saida &&
                        m.origem == 'painel' &&
                        m.enviadaPor != null) ...[
                      Flexible(
                        child: Text(
                          m.enviadaPor!,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(color: corSuave, fontSize: 11.5),
                        ),
                      ),
                      const SizedBox(width: 6),
                    ],
                    Text(
                      f.horaDe(m.criadaEm),
                      style: TextStyle(
                        color: corSuave,
                        fontSize: 11.5,
                        fontFeatures: const [FontFeature.tabularFigures()],
                      ),
                    ),
                    if (saida) ...[
                      const SizedBox(width: 4),
                      _Status(status: m.status, cor: corSuave),
                    ],
                  ],
                ),
                if (m.status == 'falhou') ...[
                  const SizedBox(height: 4),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 8,
                      vertical: 4,
                    ),
                    decoration: BoxDecoration(
                      color: c.superficie.withValues(alpha: .85),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      'Não entregue${m.erroTitulo != null ? ' — ${m.erroTitulo}' : ''}${m.erroCodigo != null ? ' (${m.erroCodigo})' : ''}',
                      style: TextStyle(color: c.erro, fontSize: 12.5),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _Status extends StatelessWidget {
  const _Status({required this.status, required this.cor});

  final String? status;
  final Color cor;

  @override
  Widget build(BuildContext context) {
    final (icone, rotulo, alfa) = switch (status) {
      'enviando' => (Icons.schedule_rounded, 'Enviando', 1.0),
      'enviada' => (Icons.check_rounded, 'Enviada', 1.0),
      'entregue' => (Icons.done_all_rounded, 'Entregue', .7),
      'lida' => (Icons.done_all_rounded, 'Lida', 1.0),
      _ => (null, null, 1.0),
    };
    if (icone == null) return const SizedBox.shrink();
    return Semantics(
      key: ValueKey('status-$status'),
      label: rotulo,
      child: Tooltip(
        message: rotulo!,
        child: Icon(
          icone,
          size: status == 'lida' ? 17 : 15,
          color: cor.withValues(alpha: cor.a * alfa),
        ),
      ),
    );
  }
}

/// Janela aberta: onde o atendente responde.
class _CaixaDeResposta extends StatelessWidget {
  const _CaixaDeResposta({
    required this.controle,
    required this.ate,
    required this.enviando,
    required this.aoEnviar,
  });

  final TextEditingController controle;
  final DateTime ate;
  final bool enviando;
  final VoidCallback aoEnviar;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final tamanho = controle.text.length;
    final vazio = controle.text.trim().isEmpty;
    return Material(
      color: c.superficie,
      child: SafeArea(
        top: false,
        child: Container(
          decoration: BoxDecoration(
            border: Border(top: BorderSide(color: c.borda)),
          ),
          padding: const EdgeInsets.fromLTRB(12, 8, 8, 6),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Expanded(
                    child: TextField(
                      key: const ValueKey('resposta'),
                      controller: controle,
                      minLines: 1,
                      maxLines: 6,
                      maxLength: _limiteDoTexto,
                      keyboardType: TextInputType.multiline,
                      textCapitalization: TextCapitalization.sentences,
                      decoration: const InputDecoration(
                        hintText: 'Escreva uma mensagem',
                        counterText: '',
                      ),
                    ),
                  ),
                  const SizedBox(width: 6),
                  IconButton.filled(
                    key: const ValueKey('enviar'),
                    tooltip: 'Enviar mensagem',
                    onPressed: vazio || enviando ? null : aoEnviar,
                    style: IconButton.styleFrom(
                      backgroundColor: c.acento,
                      foregroundColor: c.acentoContraste,
                      fixedSize: const Size(48, 48),
                    ),
                    icon: enviando
                        ? SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: c.acentoContraste,
                            ),
                          )
                        : const Icon(Icons.send_rounded),
                  ),
                ],
              ),
              const SizedBox(height: 4),
              Text(
                'Dá para responder com texto até ${f.dataHora(ate)}.'
                '${tamanho > _limiteDoTexto - 200 ? ' · $tamanho/$_limiteDoTexto' : ''}',
                style: TextStyle(color: c.tintaSuave, fontSize: 11.5),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Janela fechada: a caixa não finge que funciona — diz por quê e aponta o
/// caminho (modelo aprovado, numa campanha).
class _JanelaFechada extends StatelessWidget {
  const _JanelaFechada();

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    return Material(
      color: c.superficie,
      child: SafeArea(
        top: false,
        child: Container(
          key: const ValueKey('janela-fechada'),
          width: double.infinity,
          decoration: BoxDecoration(
            border: Border(top: BorderSide(color: c.borda)),
          ),
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text.rich(
                TextSpan(
                  children: [
                    TextSpan(
                      text: 'A janela de 24 horas está fechada. ',
                      style: TextStyle(
                        color: c.tinta,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const TextSpan(
                      text:
                          'Ela abre quando a pessoa manda mensagem — até lá, a Meta só aceita modelo aprovado.',
                    ),
                  ],
                ),
                style: TextStyle(color: c.tintaSuave, height: 1.45),
              ),
              TextButton(
                key: const ValueKey('enviar-modelo'),
                style: TextButton.styleFrom(padding: EdgeInsets.zero),
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => const TelaFormularioCampanha(),
                  ),
                ),
                child: const Text('Enviar um modelo pela tela de Campanhas'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// "Adicionar à lista": o substituto das etiquetas do WhatsApp Business — o
/// atendente organiza a base enquanto conversa, e a lista vira público de
/// campanha.
class _FolhaDaLista extends ConsumerStatefulWidget {
  const _FolhaDaLista({required this.contatoId});

  final String contatoId;

  @override
  ConsumerState<_FolhaDaLista> createState() => _FolhaDaListaState();
}

class _FolhaDaListaState extends ConsumerState<_FolhaDaLista> {
  String? _escolhida;
  bool _salvando = false;
  ({bool erro, String texto})? _resultado;

  Future<void> _adicionar() async {
    final lista = _escolhida;
    if (lista == null) return;
    setState(() {
      _salvando = true;
      _resultado = null;
    });
    try {
      final r = await ref
          .read(servicoContatosProvider)
          .adicionarNaLista(widget.contatoId, lista);
      if (!mounted) return;
      ref.invalidate(listasContatosProvider);
      setState(
        () => _resultado = (
          erro: false,
          texto: r.jaEstava
              ? 'Já estava em "${r.lista}".'
              : 'Adicionado a "${r.lista}".',
        ),
      );
    } catch (e) {
      if (mounted) {
        setState(() => _resultado = (erro: true, texto: mensagemDoErro(e)));
      }
    } finally {
      if (mounted) setState(() => _salvando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final carga = ref.watch(listasContatosProvider);
    final listas = carga.value ?? const <ListaContatos>[];
    final comuns = listas.where((l) => !l.ehBloco).toList();
    final blocos = <String, List<ListaContatos>>{};
    final nomes = <String, String>{};
    for (final l in listas.where((l) => l.ehBloco)) {
      blocos.putIfAbsent(l.divisaoId!, () => []).add(l);
      nomes[l.divisaoId!] = l.divisaoNome ?? 'Blocos';
    }
    return Padding(
      padding: EdgeInsets.fromLTRB(
        20,
        0,
        20,
        16 + MediaQuery.viewInsetsOf(context).bottom,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Adicionar à lista',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 12),
          if (carga.hasError && !carga.hasValue)
            Text(mensagemDoErro(carga.error!), style: TextStyle(color: c.erro))
          else
            CampoDeEscolha<String>(
              key: const ValueKey('lista-da-conversa'),
              rotulo: 'Lista',
              valor: _escolhida,
              carregando: carga.isLoading && !carga.hasValue,
              vazio: listas.isEmpty && carga.hasValue
                  ? 'Nenhuma lista criada'
                  : 'Escolha uma lista',
              habilitado: !_salvando,
              grupos: [
                if (comuns.isNotEmpty)
                  GrupoDeEscolha('Listas', [
                    for (final l in comuns)
                      OpcaoDeEscolha(
                        valor: l.id,
                        texto: '${l.nome} · ${f.numero(l.total)}',
                      ),
                  ]),
                for (final e in blocos.entries)
                  GrupoDeEscolha('Blocos — ${nomes[e.key]}', [
                    for (final l in e.value)
                      OpcaoDeEscolha(valor: l.id, texto: l.nome),
                  ]),
              ],
              aoEscolher: (id) => setState(() {
                _escolhida = id;
                _resultado = null;
              }),
            ),
          if (_resultado != null) ...[
            const SizedBox(height: 10),
            Text(
              _resultado!.texto,
              key: const ValueKey('resultado-da-lista'),
              style: TextStyle(
                color: _resultado!.erro ? c.erro : c.sucesso,
                fontSize: 13.5,
              ),
            ),
          ],
          const SizedBox(height: 14),
          FilledButton(
            key: const ValueKey('adicionar'),
            onPressed: _escolhida == null || _salvando ? null : _adicionar,
            child: _salvando
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Text('Adicionar'),
          ),
          const SizedBox(height: 4),
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Fechar'),
          ),
        ],
      ),
    );
  }
}
