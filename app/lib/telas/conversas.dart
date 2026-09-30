import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/conversas.dart';
import '../api/erro_api.dart';
import '../api/leituras.dart';
import '../componentes/basicos.dart';
import '../componentes/dialogos.dart';
import '../sessao/sessao.dart';
import '../tema/cores.dart';
import '../util/formato.dart' as f;
import 'conversa.dart';
import 'whatsapp.dart';

/// Relê a lista a cada 15 segundos — só com a aba na tela e o app na frente.
const _aCadaLista = Duration(seconds: 15);

/// Espera depois da última tecla antes de buscar.
const _esperaDaBusca = Duration(milliseconds: 300);

/// Os prazos de guarda das mensagens (o `PRAZOS` do site).
const prazosDeGuarda = <(int, String)>[
  (0, 'Guardar tudo'),
  (7, '7 dias'),
  (30, '30 dias'),
  (90, '90 dias'),
  (180, '6 meses'),
  (365, '1 ano'),
];

/// Iniciais do nome (só letras: "Carlos (perfil)" vira "CP"); sem nome, os
/// dois últimos dígitos — a regra do site.
String iniciaisDaConversa(ConversaResumo c) {
  final partes = (c.nome ?? '')
      .split(RegExp(r'\s+'))
      .map((p) => p.replaceAll(RegExp(r'[^A-Za-zÀ-ÖØ-öø-ÿ]'), ''))
      .where((p) => p.isNotEmpty)
      .toList();
  if (partes.length >= 2) {
    return (partes.first[0] + partes.last[0]).toUpperCase();
  }
  if (partes.length == 1) {
    final p = partes.first;
    return (p.length > 1 ? p.substring(0, 2) : p).toUpperCase();
  }
  final t = c.telefone;
  return t.length >= 2 ? t.substring(t.length - 2) : t;
}

/// As conversas do WhatsApp Business da empresa, a mais recente primeiro —
/// como no site. Só aparece com as conversas ligadas; se desligarem, a tela
/// explica e a aba some.
class TelaConversas extends ConsumerStatefulWidget {
  const TelaConversas({super.key, this.ativa = true});

  /// A aba está na tela: só então a lista relê sozinha.
  final bool ativa;

  @override
  ConsumerState<TelaConversas> createState() => _TelaConversasState();
}

class _TelaConversasState extends ConsumerState<TelaConversas> {
  final _busca = TextEditingController();
  late final AppLifecycleListener _ciclo;
  Timer? _relogio;
  Timer? _espera;

  List<ConversaResumo> _lista = const [];
  bool _carregou = false;
  Object? _erro;
  bool _desligada = false;
  bool _naFrente = true;

  /// Sobe a cada leitura: a resposta de uma busca antiga que chega depois
  /// não passa por cima da atual.
  int _geracao = 0;

  @override
  void initState() {
    super.initState();
    _ciclo = AppLifecycleListener(
      onStateChange: (estado) {
        _naFrente = estado == AppLifecycleState.resumed;
        if (_naFrente && widget.ativa) _carregar();
      },
    );
    _relogio = Timer.periodic(_aCadaLista, (_) {
      if (_naFrente && widget.ativa) _carregar();
    });
    _carregar();
  }

  @override
  void didUpdateWidget(TelaConversas antes) {
    super.didUpdateWidget(antes);
    // Voltou para a aba: relê na hora, sem esperar a próxima volta.
    if (widget.ativa && !antes.ativa) _carregar();
  }

  @override
  void dispose() {
    _relogio?.cancel();
    _espera?.cancel();
    _ciclo.dispose();
    _busca.dispose();
    super.dispose();
  }

  Future<void> _carregar() async {
    final geracao = ++_geracao;
    try {
      final itens = await ref
          .read(servicoConversasProvider)
          .listar(_busca.text);
      if (!mounted || geracao != _geracao) return;
      setState(() {
        _lista = itens;
        _erro = null;
        _desligada = false;
        _carregou = true;
      });
    } catch (e) {
      if (!mounted || geracao != _geracao) return;
      final desligada = e is ErroApi && e.status == 404;
      setState(() {
        _erro = e;
        _desligada = desligada;
        _carregou = true;
      });
      // Desligaram as conversas: a casca relê a conta e a aba some.
      if (desligada) ref.invalidate(resumoContaProvider);
    }
  }

  void _buscar(String _) {
    _espera?.cancel();
    _espera = Timer(_esperaDaBusca, _carregar);
  }

  Future<void> _abrir(ConversaResumo c) async {
    setState(() {
      _lista = [
        for (final x in _lista)
          if (x.id == c.id) x.lida() else x,
      ];
    });
    await Navigator.of(
      context,
    ).push(MaterialPageRoute<void>(builder: (_) => TelaConversa(conversa: c)));
    if (mounted) await _carregar();
  }

  Future<void> _ajustarGuarda() async {
    final texto = await abrirFolha<String>(
      context,
      builder: (_) => const _FolhaDaGuarda(),
    );
    if (texto != null && mounted) avisar(context, texto);
  }

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final sessao = ref.watch(sessaoProvider);
    final ehDono = sessao is SessaoAtiva && sessao.sessao.usuario.ehDono;
    final naoLidas = _lista.fold<int>(0, (t, x) => t + x.naoLidas);

    return RefreshIndicator(
      color: c.acentoContraste,
      backgroundColor: c.acento,
      onRefresh: _carregar,
      child: CustomScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        slivers: [
          SliverSafeArea(
            bottom: false,
            sliver: SliverPadding(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 4),
              sliver: SliverToBoxAdapter(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                'Conversas',
                                style: Theme.of(
                                  context,
                                ).textTheme.headlineSmall,
                              ),
                              if (_carregou && _erro == null)
                                Text(
                                  naoLidas == 0
                                      ? 'Tudo lido'
                                      : f.plural(
                                          naoLidas,
                                          'mensagem não lida',
                                          'mensagens não lidas',
                                        ),
                                  style: TextStyle(
                                    color: c.tintaSuave,
                                    fontSize: 13,
                                  ),
                                ),
                            ],
                          ),
                        ),
                        if (ehDono && !_desligada)
                          TextButton(
                            key: const ValueKey('guarda'),
                            onPressed: _ajustarGuarda,
                            child: const Text('Guarda das mensagens'),
                          ),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'As conversas do WhatsApp Business da empresa. O que você responde aqui aparece também no celular.',
                      style: TextStyle(color: c.tintaSuave, height: 1.45),
                    ),
                    if (!_desligada) ...[
                      const SizedBox(height: 12),
                      TextField(
                        key: const ValueKey('buscar-conversa'),
                        controller: _busca,
                        onChanged: _buscar,
                        textInputAction: TextInputAction.search,
                        decoration: const InputDecoration(
                          hintText: 'Buscar por nome ou telefone',
                          prefixIcon: Icon(Icons.search_rounded),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
          ..._conteudo(c),
        ],
      ),
    );
  }

  List<Widget> _conteudo(Cores c) {
    Widget caixa(Widget filho) => SliverPadding(
      padding: respiroDaTela(context, topo: 12),
      sliver: SliverToBoxAdapter(child: filho),
    );
    if (!_carregou) return [caixa(const Cartao(child: Esqueleto(altura: 140)))];
    if (_desligada) {
      return [
        caixa(
          Cartao(
            key: const ValueKey('desligadas'),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'As conversas não estão ligadas',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                const SizedBox(height: 6),
                Text(
                  mensagemDoErro(_erro!),
                  style: TextStyle(color: c.tintaSuave, height: 1.45),
                ),
                const SizedBox(height: 8),
                Text(
                  'Elas aparecem para números que continuam no WhatsApp Business do celular, com a resposta “Sim, trazer” sobre contatos e conversas.',
                  style: TextStyle(color: c.tintaSuave, height: 1.45),
                ),
                const SizedBox(height: 14),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    OutlinedButton(
                      onPressed: () => Navigator.of(context).push(
                        MaterialPageRoute<void>(
                          builder: (_) => const TelaWhatsapp(),
                        ),
                      ),
                      child: const Text('Ir para WhatsApp'),
                    ),
                    TextButton(
                      onPressed: _carregar,
                      child: const Text('Tentar de novo'),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ];
    }
    if (_erro != null && _lista.isEmpty) {
      return [
        caixa(
          EstadoErro(
            titulo: 'Não consegui carregar as conversas',
            mensagem: mensagemDoErro(_erro!),
            aoTentar: _carregar,
          ),
        ),
      ];
    }
    if (_lista.isEmpty) {
      return [
        caixa(
          Cartao(
            padding: const EdgeInsets.all(22),
            child: Text(
              _busca.text.trim().isNotEmpty
                  ? 'Nenhuma conversa com esse nome ou telefone.'
                  : 'Nenhuma conversa ainda. Mensagens novas aparecem aqui sozinhas.',
              style: TextStyle(color: c.tintaSuave, height: 1.45),
            ),
          ),
        ),
      ];
    }
    return [
      SliverPadding(
        padding: respiroDaTela(context, topo: 12),
        sliver: DecoratedSliver(
          decoration: BoxDecoration(
            color: c.superficie,
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: c.borda),
          ),
          sliver: SliverList.separated(
            itemCount: _lista.length,
            separatorBuilder: (_, _) =>
                Divider(height: 1, indent: 68, color: c.borda),
            itemBuilder: (_, i) => LinhaDaConversa(
              conversa: _lista[i],
              aoTocar: () => _abrir(_lista[i]),
            ),
          ),
        ),
      ),
    ];
  }
}

/// Uma conversa na lista: quem é, o último trecho, quando, quantas não lidas
/// e se ainda dá para responder com texto (janela de 24 horas aberta).
class LinhaDaConversa extends StatelessWidget {
  const LinhaDaConversa({
    super.key,
    required this.conversa,
    required this.aoTocar,
  });

  final ConversaResumo conversa;
  final VoidCallback aoTocar;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final k = conversa;
    final destaque = k.naoLidas > 0;
    return InkWell(
      key: ValueKey('conversa-${k.id}'),
      onTap: aoTocar,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
        child: Row(
          children: [
            ExcludeSemantics(
              child: Container(
                width: 42,
                height: 42,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: c.tinta,
                  shape: BoxShape.circle,
                ),
                child: Text(
                  iniciaisDaConversa(k),
                  style: TextStyle(
                    color: c.superficie,
                    fontWeight: FontWeight.w700,
                    fontSize: 13,
                  ),
                ),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          k.nome ?? f.telefone(k.telefone),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontWeight: FontWeight.w600,
                            fontSize: 15,
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Text(
                        f.quandoNaLista(k.ultimaMensagemEm),
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: destaque
                              ? FontWeight.w700
                              : FontWeight.w400,
                          color: destaque ? c.acentoForte : c.tintaSuave,
                          fontFeatures: const [FontFeature.tabularFigures()],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 3),
                  Row(
                    children: [
                      if (k.janelaAberta) ...[
                        Semantics(
                          label: 'Dá para responder com texto',
                          child: Container(
                            key: ValueKey('janela-aberta-${k.id}'),
                            width: 7,
                            height: 7,
                            decoration: BoxDecoration(
                              color: c.sucesso,
                              shape: BoxShape.circle,
                            ),
                          ),
                        ),
                        const SizedBox(width: 6),
                      ],
                      Expanded(
                        child: Text(
                          k.ultimaMensagem ?? f.telefone(k.telefone),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(color: c.tintaSuave, fontSize: 13),
                        ),
                      ),
                      if (destaque) ...[
                        const SizedBox(width: 8),
                        Container(
                          constraints: const BoxConstraints(minWidth: 22),
                          height: 22,
                          padding: const EdgeInsets.symmetric(horizontal: 6),
                          alignment: Alignment.center,
                          decoration: BoxDecoration(
                            color: c.acento,
                            borderRadius: BorderRadius.circular(99),
                          ),
                          child: Semantics(
                            label: 'Não lidas: ${k.naoLidas}',
                            child: Text(
                              k.naoLidas > 99 ? '99+' : '${k.naoLidas}',
                              style: TextStyle(
                                color: c.acentoContraste,
                                fontSize: 11.5,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// "Guarda das mensagens" (só o dono): por quanto tempo as mensagens ficam
/// aqui. Devolve (pop) o texto do aviso quando salvou.
class _FolhaDaGuarda extends ConsumerStatefulWidget {
  const _FolhaDaGuarda();

  @override
  ConsumerState<_FolhaDaGuarda> createState() => _FolhaDaGuardaState();
}

class _FolhaDaGuardaState extends ConsumerState<_FolhaDaGuarda> {
  int? _dias;
  bool _salvando = false;
  String? _erro;

  @override
  void initState() {
    super.initState();
    ref
        .read(servicoConversasProvider)
        .guarda()
        .then((d) {
          if (mounted) setState(() => _dias = d);
        })
        .catchError((Object e) {
          if (mounted) setState(() => _erro = mensagemDoErro(e));
        });
  }

  Future<void> _salvar() async {
    final dias = _dias;
    if (dias == null) return;
    setState(() {
      _salvando = true;
      _erro = null;
    });
    try {
      await ref.read(servicoConversasProvider).salvarGuarda(dias);
      if (!mounted) return;
      Navigator.of(context).pop(
        dias == 0
            ? 'Todas as mensagens ficam guardadas.'
            : 'Mensagens com mais de $dias dias passam a ser apagadas, de hora em hora.',
      );
    } catch (e) {
      if (mounted) setState(() => _erro = mensagemDoErro(e));
    } finally {
      if (mounted) setState(() => _salvando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final dias = _dias;
    final prazos = [
      if (dias != null && !prazosDeGuarda.any((p) => p.$1 == dias))
        (dias, '$dias dias'),
      ...prazosDeGuarda,
    ];
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Por quanto tempo guardar as mensagens',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 6),
            Text(
              'O que passar do prazo é apagado daqui, pela data da mensagem. No celular, nada muda.',
              style: TextStyle(color: c.tintaSuave, height: 1.45),
            ),
            const SizedBox(height: 8),
            if (dias == null && _erro == null)
              const Padding(
                padding: EdgeInsets.all(16),
                child: Center(child: CircularProgressIndicator()),
              )
            else if (dias != null)
              RadioGroup<int>(
                groupValue: dias,
                onChanged: (v) {
                  if (v != null && !_salvando) setState(() => _dias = v);
                },
                child: Column(
                  children: [
                    for (final (valor, rotulo) in prazos)
                      RadioListTile<int>(
                        key: ValueKey('prazo-$valor'),
                        value: valor,
                        contentPadding: EdgeInsets.zero,
                        title: Text(rotulo),
                      ),
                  ],
                ),
              ),
            if (_erro != null) ...[
              const SizedBox(height: 8),
              Aviso(
                tom: TomPilula.erro,
                icone: Icons.error_outline_rounded,
                texto: _erro!,
              ),
            ],
            const SizedBox(height: 12),
            FilledButton(
              key: const ValueKey('salvar-guarda'),
              onPressed: dias == null || _salvando ? null : _salvar,
              child: _salvando
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Salvar'),
            ),
          ],
        ),
      ),
    );
  }
}
