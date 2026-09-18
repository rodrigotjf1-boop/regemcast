import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/contatos.dart';
import '../api/erro_api.dart';
import '../componentes/basicos.dart';
import '../tema/cores.dart';
import '../util/formato.dart' as f;
import 'importar_contatos.dart';

/// A base de contatos da conta: quem pode receber campanha, as listas e quem
/// pediu para sair.
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
  int _pagina = 0;
  int _total = 0;
  bool _temMais = true;
  bool _carregando = false;
  Object? _erro;

  @override
  void initState() {
    super.initState();
    _rolagem.addListener(() {
      if (_rolagem.position.extentAfter < 600) _carregarMais();
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
    setState(() {
      _carregando = true;
      _erro = null;
    });
    try {
      final p = await ref.read(servicoContatosProvider).pagina(_pagina + 1);
      if (!mounted) return;
      setState(() {
        _pagina = p.pagina;
        _total = p.total;
        _temMais = p.temMais;
        _itens.addAll(p.itens);
      });
    } catch (e) {
      if (mounted) setState(() => _erro = e);
    } finally {
      if (mounted) setState(() => _carregando = false);
    }
  }

  Future<void> _recomecar() async {
    ref.invalidate(listasContatosProvider);
    setState(() {
      _itens.clear();
      _pagina = 0;
      _temMais = true;
    });
    await _carregarMais();
  }

  void _avisar(String texto) => ScaffoldMessenger.of(
    context,
  ).showSnackBar(SnackBar(content: Text(texto)));

  Future<void> _importar() async {
    final importou = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => const TelaImportarContatos()),
    );
    if (importou == true && mounted) await _recomecar();
  }

  Future<void> _descadastrar(Contato contato) async {
    final c = Cores.de(context);
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: c.superficie,
        title: const Text('Descadastrar este número?'),
        content: Text(
          '${contato.nome ?? f.telefone(contato.telefone)} não recebe mais nenhuma campanha desta conta — nem se aparecer numa importação futura. Não dá para desfazer pelo app.',
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
              backgroundColor: c.erro,
              foregroundColor: Theme.of(ctx).brightness == Brightness.dark
                  ? const Color(0xFF231632)
                  : Colors.white,
            ),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Descadastrar'),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    try {
      await ref.read(servicoContatosProvider).descadastrar(contato.id);
      if (!mounted) return;
      setState(() {
        final i = _itens.indexWhere((x) => x.id == contato.id);
        if (i >= 0) {
          _itens[i] = Contato(
            id: contato.id,
            nome: contato.nome,
            telefone: contato.telefone,
            optOut: true,
            consentimentoOrigem: contato.consentimentoOrigem,
            consentimentoEm: contato.consentimentoEm,
            criadoEm: contato.criadoEm,
          );
        }
      });
      _avisar('Número descadastrado. Ele não recebe mais campanhas.');
    } catch (e) {
      if (mounted) _avisar(mensagemDoErro(e));
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final listas = ref.watch(listasContatosProvider);

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
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 8),
              sliver: SliverToBoxAdapter(
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Contatos',
                            style: Theme.of(context).textTheme.headlineSmall,
                          ),
                          if (_pagina > 0)
                            Text(
                              f.plural(
                                _total,
                                'contato na base',
                                'contatos na base',
                              ),
                              style: TextStyle(
                                color: c.tintaSuave,
                                fontSize: 13,
                              ),
                            ),
                        ],
                      ),
                    ),
                    FilledButton.icon(
                      style: FilledButton.styleFrom(
                        minimumSize: const Size(0, 42),
                        padding: const EdgeInsets.symmetric(horizontal: 16),
                      ),
                      onPressed: _importar,
                      icon: const Icon(Icons.upload_file_rounded, size: 20),
                      label: const Text('Importar'),
                    ),
                  ],
                ),
              ),
            ),
          ),
          SliverToBoxAdapter(
            child: listas.maybeWhen(
              data: (ls) =>
                  ls.isEmpty ? const SizedBox.shrink() : _Listas(listas: ls),
              orElse: () => const SizedBox.shrink(),
            ),
          ),
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(20, 8, 20, 28),
            sliver: SliverList.list(
              children: [
                if (_itens.isEmpty && _carregando)
                  const Cartao(child: Esqueleto(altura: 120))
                else if (_itens.isEmpty && _erro != null)
                  EstadoErro(
                    titulo: 'Não consegui ler os contatos',
                    mensagem: mensagemDoErro(_erro!),
                    aoTentar: _carregarMais,
                  )
                else if (_itens.isEmpty)
                  Cartao(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Nenhum contato ainda',
                          style: Theme.of(context).textTheme.titleMedium,
                        ),
                        const SizedBox(height: 6),
                        Text(
                          'Importe os contatos do celular (.vcf), uma planilha (.csv ou .xlsx) ou cole os números. Só entra quem autorizou receber mensagens da sua empresa.',
                          style: TextStyle(color: c.tintaSuave, height: 1.45),
                        ),
                      ],
                    ),
                  )
                else
                  Cartao(
                    padding: EdgeInsets.zero,
                    child: Column(
                      children: [
                        for (var i = 0; i < _itens.length; i++) ...[
                          if (i > 0)
                            Divider(height: 1, indent: 16, color: c.borda),
                          _LinhaContato(
                            contato: _itens[i],
                            aoDescadastrar: _descadastrar,
                          ),
                        ],
                      ],
                    ),
                  ),
                if (_itens.isNotEmpty && _carregando)
                  const Padding(
                    padding: EdgeInsets.all(16),
                    child: Center(
                      child: SizedBox(
                        width: 22,
                        height: 22,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      ),
                    ),
                  ),
                if (_itens.isNotEmpty && _erro != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: Center(
                      child: TextButton(
                        onPressed: _carregarMais,
                        child: const Text(
                          'Não carregou o resto. Tentar de novo',
                        ),
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

class _Listas extends StatelessWidget {
  const _Listas({required this.listas});

  final List<ListaContatos> listas;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 4, 20, 8),
          child: Text('Listas', style: Theme.of(context).textTheme.titleMedium),
        ),
        SizedBox(
          height: 78,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 20),
            itemCount: listas.length,
            separatorBuilder: (_, _) => const SizedBox(width: 10),
            itemBuilder: (_, i) {
              final l = listas[i];
              return ConstrainedBox(
                constraints: const BoxConstraints(minWidth: 140, maxWidth: 220),
                child: Cartao(
                  padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(
                        l.nome,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontWeight: FontWeight.w600),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        f.plural(l.total, 'contato', 'contatos'),
                        style: TextStyle(color: c.tintaSuave, fontSize: 12.5),
                      ),
                    ],
                  ),
                ),
              );
            },
          ),
        ),
        const SizedBox(height: 8),
      ],
    );
  }
}

class _LinhaContato extends StatelessWidget {
  const _LinhaContato({required this.contato, required this.aoDescadastrar});

  final Contato contato;
  final ValueChanged<Contato> aoDescadastrar;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final tel = f.telefone(contato.telefone);
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 10, 4, 10),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  contato.nome ?? tel,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontWeight: FontWeight.w500,
                    color: contato.optOut ? c.tintaSuave : null,
                  ),
                ),
                if (contato.nome != null)
                  Text(
                    tel,
                    style: TextStyle(
                      color: c.tintaSuave,
                      fontSize: 12.5,
                      fontFeatures: const [FontFeature.tabularFigures()],
                    ),
                  ),
              ],
            ),
          ),
          if (contato.optOut)
            const Padding(
              padding: EdgeInsets.only(right: 12),
              child: Pilula('Saiu', tom: TomPilula.erro),
            )
          else
            PopupMenuButton<String>(
              tooltip: 'Ações do contato',
              color: c.superficie,
              icon: Icon(Icons.more_vert_rounded, color: c.tintaSuave),
              onSelected: (_) => aoDescadastrar(contato),
              itemBuilder: (_) => [
                PopupMenuItem(
                  value: 'descadastrar',
                  child: ListTile(
                    leading: Icon(Icons.block_rounded, color: c.erro),
                    title: Text(
                      'Descadastrar',
                      style: TextStyle(color: c.erro),
                    ),
                    contentPadding: EdgeInsets.zero,
                  ),
                ),
              ],
            ),
        ],
      ),
    );
  }
}
