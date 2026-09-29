import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/contatos.dart';
import '../api/erro_api.dart';
import '../api/publicos.dart';
import '../componentes/basicos.dart';
import '../componentes/contato.dart';
import '../componentes/dialogos.dart';
import '../sessao/sessao.dart';
import '../tema/cores.dart';
import '../util/formato.dart' as f;
import 'bloqueios.dart';
import 'contatos_blocos.dart';
import 'contatos_publicos.dart';
import 'dividir_em_blocos.dart';
import 'importar_contatos.dart';

/// As três partes da tela: quem está na base, os públicos para filtrar, e os
/// blocos e listas que a campanha usa.
enum VistaContatos {
  contatos('Contatos'),
  publicos('Públicos'),
  blocos('Blocos e listas');

  const VistaContatos(this.rotulo);
  final String rotulo;
}

/// A base de contatos — como no site: quem pode receber (com o registro de
/// como cada pessoa autorizou e o que se sabe das compras dela), os perfis e
/// públicos para filtrar, os blocos para enviar aos poucos e quem saiu.
///
/// A lista vem em páginas de 50 e carrega mais ao chegar perto do fim — uma
/// base com milhares de números não pode travar o celular.
class TelaContatos extends ConsumerStatefulWidget {
  const TelaContatos({super.key});

  @override
  ConsumerState<TelaContatos> createState() => _TelaContatosState();
}

class _TelaContatosState extends ConsumerState<TelaContatos> {
  final _rolagem = ScrollController();
  final _itens = <Contato>[];
  VistaContatos _vista = VistaContatos.contatos;
  FiltroDeContatos? _filtro;
  int _pagina = 0;
  int _total = 0;
  bool _temMais = true;
  bool _carregando = false;
  Object? _erro;
  bool _criandoLista = false;

  /// Sobe a cada troca de filtro: a página de um filtro antigo que chega
  /// depois é descartada.
  int _geracao = 0;

  @override
  void initState() {
    super.initState();
    _rolagem.addListener(() {
      if (_vista == VistaContatos.contatos &&
          _rolagem.position.extentAfter < 600) {
        _carregarMais();
      }
    });
    _carregarMais();
  }

  @override
  void dispose() {
    _rolagem.dispose();
    super.dispose();
  }

  Future<void> _carregarMais() async {
    if (_carregando || !_temMais) return;
    final geracao = _geracao;
    setState(() {
      _carregando = true;
      _erro = null;
    });
    try {
      final p = await ref
          .read(servicoContatosProvider)
          .pagina(_pagina + 1, filtro: _filtro);
      if (!mounted || geracao != _geracao) return;
      setState(() {
        _pagina = p.pagina;
        _total = p.total;
        _temMais = p.temMais;
        _itens.addAll(p.itens);
      });
    } catch (e) {
      if (mounted && geracao == _geracao) setState(() => _erro = e);
    } finally {
      if (mounted && geracao == _geracao) setState(() => _carregando = false);
    }
  }

  /// Relê a lista do começo — e, com [tudo], os perfis, públicos e blocos.
  Future<void> _recomecar({bool tudo = true}) async {
    _geracao++;
    if (tudo) {
      ref
        ..invalidate(listasContatosProvider)
        ..invalidate(divisoesProvider)
        ..invalidate(resumoSegmentosProvider)
        ..invalidate(publicosProntosProvider)
        ..invalidate(produtosDaBuscaProvider)
        ..invalidate(regioesProvider);
    }
    setState(() {
      _itens.clear();
      _pagina = 0;
      _temMais = true;
      _carregando = false;
      _erro = null;
    });
    await _carregarMais();
  }

  void _irPara(VistaContatos vista) {
    setState(() => _vista = vista);
    if (_rolagem.hasClients) _rolagem.jumpTo(0);
  }

  /// Tocar num perfil, público ou estado filtra a lista; tocar de novo solta.
  void _escolher(FiltroDeContatos filtro) {
    if (filtro == _filtro) {
      _filtrar(null);
    } else {
      _filtrar(filtro);
      _irPara(VistaContatos.contatos);
    }
  }

  void _filtrar(FiltroDeContatos? filtro) {
    setState(() => _filtro = filtro);
    _recomecar(tudo: false);
  }

  Future<void> _importar() async {
    final r = await Navigator.of(context).push<Object?>(
      MaterialPageRoute(builder: (_) => const TelaImportarContatos()),
    );
    if (r == null || !mounted) return;
    await _recomecar();
    if (r is DivisaoDeBlocos && mounted) _dividiu(r);
  }

  Future<void> _abrirBloqueios() async {
    await Navigator.of(
      context,
    ).push(MaterialPageRoute<void>(builder: (_) => const TelaBloqueios()));
    // Alguém pode ter voltado à base.
    if (mounted) await _recomecar();
  }

  Future<void> _dividir(AlvoDaDivisao alvo) async {
    final d = await Navigator.of(context).push<DivisaoDeBlocos>(
      MaterialPageRoute(builder: (_) => TelaDividirEmBlocos(alvo: alvo)),
    );
    if (d != null && mounted) _dividiu(d);
  }

  void _dividiu(DivisaoDeBlocos d) {
    ref
      ..invalidate(divisoesProvider)
      ..invalidate(listasContatosProvider);
    avisar(
      context,
      '${f.plural(d.totalBlocos, 'bloco criado', 'blocos criados')} com ${f.plural(d.totalContatos, 'pessoa', 'pessoas')}. Cada bloco é uma lista: escolha-o ao montar a campanha.',
    );
    _irPara(VistaContatos.blocos);
  }

  Future<void> _criarLista() async {
    final filtro = _filtro;
    if (filtro == null || !filtro.viraLista) return;
    setState(() => _criandoLista = true);
    final servico = ref.read(servicoContatosProvider);
    try {
      final r = filtro.segmento != null
          ? await servico.criarListaDoPerfil(filtro.segmento!)
          : await servico.criarListaDoPublico(filtro.publico!, filtro.valor);
      if (!mounted) return;
      ref.invalidate(listasContatosProvider);
      avisar(
        context,
        'Lista "${r.nome}" criada com ${f.plural(r.total, 'contato', 'contatos')}. Escolha essa lista ao montar a campanha.',
      );
    } catch (e) {
      if (mounted) avisar(context, mensagemDoErro(e));
    } finally {
      if (mounted) setState(() => _criandoLista = false);
    }
  }

  Future<void> _descadastrar(Contato contato) async {
    final ok = await confirmar(
      context,
      titulo: 'Descadastrar este número?',
      texto:
          '${contato.nome ?? f.telefone(contato.telefone)} não recebe mais nenhuma campanha desta conta — nem se aparecer numa importação futura. Só volta à base se a própria pessoa pedir, pela tela Bloqueios.',
      botao: 'Descadastrar',
      perigo: true,
    );
    if (!ok || !mounted) return;
    try {
      await ref.read(servicoContatosProvider).descadastrar(contato.id);
      if (!mounted) return;
      setState(() {
        final i = _itens.indexWhere((x) => x.id == contato.id);
        if (i >= 0) _itens[i] = contato.descadastrado();
      });
      avisar(context, 'Número descadastrado. Ele não recebe mais campanhas.');
    } catch (e) {
      if (mounted) avisar(context, mensagemDoErro(e));
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final sessao = ref.watch(sessaoProvider);
    final ehDono = sessao is SessaoAtiva && sessao.sessao.usuario.ehDono;
    // Quem pode receber: a soma das regiões já conta só os ativos.
    final naBase = ref.watch(regioesProvider).value?.total;

    return RefreshIndicator(
      color: c.acentoContraste,
      backgroundColor: c.acento,
      onRefresh: _recomecar,
      child: CustomScrollView(
        controller: _rolagem,
        physics: const AlwaysScrollableScrollPhysics(),
        slivers: [
          SliverSafeArea(
            bottom: false,
            sliver: SliverPadding(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 4),
              sliver: SliverToBoxAdapter(
                child: _Cabecalho(
                  total: _pagina > 0 ? _total : null,
                  filtrado: _filtro != null,
                  // Com filtro, quem divide é a barra do filtro.
                  podeDividir: _filtro == null && (naBase ?? _total) > 0,
                  aoImportar: _importar,
                  aoAbrirBloqueios: _abrirBloqueios,
                  aoDividirBase: () => _dividir(
                    AlvoDaDivisao(
                      origem: 'base',
                      rotulo: 'Base inteira',
                      total: naBase,
                    ),
                  ),
                ),
              ),
            ),
          ),
          SliverToBoxAdapter(
            child: SizedBox(
              height: 50,
              child: ListView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.fromLTRB(20, 6, 20, 0),
                children: [
                  for (final v in VistaContatos.values)
                    Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: ChoiceChip(
                        key: ValueKey('vista-${v.name}'),
                        label: Text(v.rotulo),
                        selected: _vista == v,
                        onSelected: (_) => _irPara(v),
                        showCheckmark: false,
                        selectedColor: c.acento,
                        backgroundColor: c.superficie,
                        side: BorderSide(
                          color: _vista == v ? c.acento : c.borda,
                        ),
                        labelStyle: TextStyle(
                          fontWeight: FontWeight.w600,
                          color: _vista == v ? c.acentoContraste : c.tintaSuave,
                        ),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(99),
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),
          ...switch (_vista) {
            VistaContatos.contatos => _vistaDaLista(c),
            VistaContatos.publicos => [
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(20, 12, 20, 28),
                sliver: SliverToBoxAdapter(
                  child: VistaPublicos(
                    filtro: _filtro,
                    ehDono: ehDono,
                    aoEscolher: _escolher,
                    aoMudarRegras: () => _recomecar(),
                  ),
                ),
              ),
            ],
            VistaContatos.blocos => [
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(20, 12, 20, 28),
                sliver: SliverToBoxAdapter(
                  child: VistaBlocos(
                    ehDono: ehDono,
                    naBase: naBase,
                    aoDividir: _dividir,
                  ),
                ),
              ),
            ],
          },
        ],
      ),
    );
  }

  List<Widget> _vistaDaLista(Cores c) {
    final filtro = _filtro;
    final segmentos = ref.watch(resumoSegmentosProvider).value;
    return [
      if (filtro != null)
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 0),
          sliver: SliverToBoxAdapter(
            child: _BarraDoFiltro(
              filtro: filtro,
              total: _pagina > 0 ? _total : filtro.total,
              criandoLista: _criandoLista,
              aoCriarLista: _criarLista,
              aoDividir: () =>
                  _dividir(filtro.alvo(_pagina > 0 ? _total : filtro.total)),
              aoVerTodos: () => _filtrar(null),
            ),
          ),
        ),
      if (_itens.isNotEmpty)
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(22, 14, 20, 8),
          sliver: SliverToBoxAdapter(
            child: Row(
              children: [
                Icon(
                  Icons.verified_user_outlined,
                  size: 16,
                  color: c.tintaSuave,
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    'Autorização registrada por pessoa',
                    style: TextStyle(color: c.tintaSuave, fontSize: 12.5),
                  ),
                ),
              ],
            ),
          ),
        ),
      if (_itens.isEmpty)
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 28),
          sliver: SliverToBoxAdapter(
            child: _carregando
                ? const Cartao(child: Esqueleto(altura: 120))
                : _erro != null
                ? EstadoErro(
                    titulo: 'Não consegui carregar seus contatos',
                    mensagem: mensagemDoErro(_erro!),
                    aoTentar: _carregarMais,
                  )
                : filtro != null
                ? _Vazio(
                    titulo: 'Ninguém aqui agora',
                    texto:
                        'Ninguém que possa receber está neste filtro hoje. Escolha outro perfil ou público, ou veja a base inteira.',
                    acao: OutlinedButton(
                      onPressed: () => _filtrar(null),
                      child: const Text('Ver todos'),
                    ),
                  )
                : _Vazio(
                    titulo: 'Nenhum contato ainda',
                    texto:
                        'Importe a agenda do seu celular, uma planilha ou cole uma lista de números.',
                    acao: FilledButton.icon(
                      style: FilledButton.styleFrom(
                        minimumSize: const Size(0, 44),
                      ),
                      onPressed: _importar,
                      icon: const Icon(Icons.upload_file_rounded, size: 20),
                      label: const Text('Importar contatos'),
                    ),
                  ),
          ),
        )
      else
        SliverPadding(
          padding: const EdgeInsets.symmetric(horizontal: 20),
          sliver: DecoratedSliver(
            decoration: BoxDecoration(
              color: c.superficie,
              borderRadius: BorderRadius.circular(18),
              border: Border.all(color: c.borda),
            ),
            sliver: SliverList.separated(
              itemCount: _itens.length,
              separatorBuilder: (_, _) => Divider(height: 1, color: c.borda),
              itemBuilder: (_, i) => LinhaContato(
                contato: _itens[i],
                perfil: segmentos?.nomeDe(_itens[i].segmento),
                aoDescadastrar: _descadastrar,
              ),
            ),
          ),
        ),
      if (_itens.isNotEmpty)
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 28),
          sliver: SliverToBoxAdapter(
            child: _carregando
                ? const Padding(
                    padding: EdgeInsets.all(12),
                    child: Center(
                      child: SizedBox(
                        width: 22,
                        height: 22,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      ),
                    ),
                  )
                : _erro != null
                ? Center(
                    child: TextButton(
                      onPressed: _carregarMais,
                      child: const Text('Não carregou o resto. Tentar de novo'),
                    ),
                  )
                : const SizedBox.shrink(),
          ),
        ),
    ];
  }
}

class _Cabecalho extends StatelessWidget {
  const _Cabecalho({
    required this.total,
    required this.filtrado,
    required this.podeDividir,
    required this.aoImportar,
    required this.aoAbrirBloqueios,
    required this.aoDividirBase,
  });

  /// Nulo enquanto a primeira página não chega.
  final int? total;
  final bool filtrado;
  final bool podeDividir;
  final VoidCallback aoImportar;
  final VoidCallback aoAbrirBloqueios;
  final VoidCallback aoDividirBase;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final secundario = OutlinedButton.styleFrom(
      minimumSize: const Size(0, 38),
      padding: const EdgeInsets.symmetric(horizontal: 14),
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Contatos',
                    style: Theme.of(context).textTheme.headlineSmall,
                  ),
                  if (total != null)
                    Text(
                      '${f.plural(total!, 'contato', 'contatos')} ${filtrado ? 'neste filtro' : 'na base'}',
                      style: TextStyle(color: c.tintaSuave, fontSize: 13),
                    ),
                ],
              ),
            ),
            FilledButton.icon(
              key: const ValueKey('importar'),
              style: FilledButton.styleFrom(
                minimumSize: const Size(0, 42),
                padding: const EdgeInsets.symmetric(horizontal: 16),
              ),
              onPressed: aoImportar,
              icon: const Icon(Icons.upload_file_rounded, size: 20),
              label: const Text('Importar'),
            ),
          ],
        ),
        const SizedBox(height: 10),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            OutlinedButton.icon(
              key: const ValueKey('bloqueios'),
              style: secundario,
              onPressed: aoAbrirBloqueios,
              icon: const Icon(Icons.shield_outlined, size: 18),
              label: const Text('Bloqueios'),
            ),
            if (podeDividir)
              OutlinedButton.icon(
                key: const ValueKey('dividir-base'),
                style: secundario,
                onPressed: aoDividirBase,
                icon: const Icon(Icons.view_module_outlined, size: 18),
                label: const Text('Dividir em blocos'),
              ),
          ],
        ),
      ],
    );
  }
}

/// "Mostrando Campeões: 412 contatos." e o que dá para fazer com eles.
class _BarraDoFiltro extends StatelessWidget {
  const _BarraDoFiltro({
    required this.filtro,
    required this.total,
    required this.criandoLista,
    required this.aoCriarLista,
    required this.aoDividir,
    required this.aoVerTodos,
  });

  final FiltroDeContatos filtro;
  final int? total;
  final bool criandoLista;
  final VoidCallback aoCriarLista;
  final VoidCallback aoDividir;
  final VoidCallback aoVerTodos;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final vazio = total == 0;
    return Cartao(
      destaque: true,
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text.rich(
            TextSpan(
              children: [
                const TextSpan(text: 'Mostrando '),
                TextSpan(
                  text: filtro.rotulo,
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
                if (total != null)
                  TextSpan(
                    text: ': ${f.plural(total!, 'contato', 'contatos')}',
                  ),
                if (filtro.detalhe != null)
                  TextSpan(
                    text: ' (${filtro.detalhe})',
                    style: TextStyle(color: c.tintaSuave),
                  ),
                const TextSpan(text: '.'),
              ],
            ),
            style: TextStyle(color: c.tinta, height: 1.4),
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              if (filtro.viraLista)
                FilledButton(
                  key: const ValueKey('criar-lista'),
                  style: FilledButton.styleFrom(minimumSize: const Size(0, 40)),
                  onPressed: criandoLista || vazio ? null : aoCriarLista,
                  child: criandoLista
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Text('Criar lista com estes contatos'),
                ),
              OutlinedButton(
                key: const ValueKey('dividir-filtro'),
                style: OutlinedButton.styleFrom(minimumSize: const Size(0, 40)),
                onPressed: vazio ? null : aoDividir,
                child: const Text('Dividir em blocos'),
              ),
              TextButton(
                key: const ValueKey('ver-todos'),
                onPressed: aoVerTodos,
                child: const Text('Ver todos'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _Vazio extends StatelessWidget {
  const _Vazio({required this.titulo, required this.texto, this.acao});

  final String titulo;
  final String texto;
  final Widget? acao;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    return Cartao(
      padding: const EdgeInsets.all(22),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(titulo, style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 6),
          Text(texto, style: TextStyle(color: c.tintaSuave, height: 1.45)),
          if (acao != null) ...[const SizedBox(height: 16), acao!],
        ],
      ),
    );
  }
}

/// Uma pessoa da base: como autorizou, o que comprou, quando e o quê.
class LinhaContato extends StatelessWidget {
  const LinhaContato({
    super.key,
    required this.contato,
    required this.aoDescadastrar,
    this.perfil,
  });

  final Contato contato;

  /// O nome do perfil dela (Campeões, Em risco…), quando há.
  final String? perfil;
  final ValueChanged<Contato> aoDescadastrar;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final k = contato;
    final suave = TextStyle(color: c.tintaSuave, fontSize: 12.5, height: 1.4);
    final numeros = TextStyle(
      color: c.tinta,
      fontSize: 12.5,
      height: 1.4,
      fontFeatures: const [FontFeature.tabularFigures()],
    );

    final compras = k.pedidos != null
        ? '${f.plural(k.pedidos!, 'pedido', 'pedidos')}${k.totalGastoCentavos != null ? ' · ${f.reais(k.totalGastoCentavos!)}' : ''}'
        : k.totalGastoCentavos != null
        ? f.reais(k.totalGastoCentavos!)
        : null;
    final dias = f.diasDesde(k.ultimoPedidoEm);
    final costuma = [
      if (k.produtoFavorito != null && k.produtoFavorito!.isNotEmpty)
        k.produtoFavorito!,
      if (k.periodoPreferido != null) quandoPede(k.periodoPreferido!),
    ];
    final mostraPerfil =
        k.segmento != null && k.segmento != 'sem_historico' && !k.optOut;
    final origem = origemDoConsentimento(k.consentimentoOrigem);

    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 12, 2, 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          AvatarContato(nome: k.nome, telefone: k.telefone),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  k.nome ?? 'Sem nome',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontWeight: k.nome == null
                        ? FontWeight.w400
                        : FontWeight.w600,
                    color: k.nome == null || k.optOut ? c.tintaSuave : c.tinta,
                  ),
                ),
                if (k.email != null && k.email!.isNotEmpty)
                  Text(
                    k.email!,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: suave,
                  ),
                Text(f.telefone(k.telefone), style: numeros),
                const SizedBox(height: 6),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    if (mostraPerfil)
                      EtiquetaDePerfil(
                        perfil: k.segmento!,
                        nome: perfil ?? k.segmento!,
                      ),
                    if (k.optOut)
                      const Pilula('Pediu para sair', tom: TomPilula.erro)
                    else if (k.semWhatsappEm != null)
                      const Pilula('Sem WhatsApp', tom: TomPilula.atencao)
                    else if (origem != null)
                      Text(origem, style: suave),
                  ],
                ),
                if (compras != null) ...[
                  const SizedBox(height: 4),
                  Text(compras, style: numeros),
                ],
                if (dias != null)
                  Text(
                    'Última compra ${f.haQuantosDias(dias)} · ${f.data(k.ultimoPedidoEm)}',
                    style: suave,
                  ),
                if (costuma.isNotEmpty)
                  Text('Costuma pedir ${costuma.join(' · ')}', style: suave),
                if (k.temCashback) _Cashback(contato: k),
              ],
            ),
          ),
          if (!k.optOut)
            PopupMenuButton<String>(
              key: ValueKey('acoes-${k.id}'),
              tooltip: 'Ações do contato',
              color: c.superficie,
              icon: Icon(Icons.more_vert_rounded, color: c.tintaSuave),
              onSelected: (_) => aoDescadastrar(k),
              itemBuilder: (_) => [
                PopupMenuItem(
                  value: 'descadastrar',
                  child: Row(
                    children: [
                      Icon(Icons.block_rounded, color: c.erro, size: 20),
                      const SizedBox(width: 12),
                      Text('Descadastrar', style: TextStyle(color: c.erro)),
                    ],
                  ),
                ),
              ],
            )
          else
            const SizedBox(width: 14),
        ],
      ),
    );
  }
}

/// O cashback do Cardápio Web: o saldo e até quando vale. Vencido, o valor
/// aparece riscado.
class _Cashback extends StatelessWidget {
  const _Cashback({required this.contato});

  final Contato contato;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final valido = contato.cashbackValido;
    final vence = contato.cashbackVenceEm;
    return Text.rich(
      TextSpan(
        children: [
          TextSpan(
            text: 'Cashback ',
            style: TextStyle(color: c.tintaSuave),
          ),
          TextSpan(
            text: f.reais(contato.cashbackCentavos ?? 0),
            style: valido
                ? TextStyle(color: c.tinta, fontWeight: FontWeight.w600)
                : TextStyle(
                    color: c.tintaSuave,
                    decoration: TextDecoration.lineThrough,
                  ),
          ),
          TextSpan(
            text: vence == null
                ? ' · sem prazo'
                : valido
                ? ' · vence ${f.diaCurto(vence)}'
                : ' · venceu ${f.diaCurto(vence)}',
            style: TextStyle(color: valido ? c.tintaSuave : c.erro),
          ),
        ],
      ),
      style: const TextStyle(
        fontSize: 12.5,
        height: 1.4,
        fontFeatures: [FontFeature.tabularFigures()],
      ),
    );
  }
}
