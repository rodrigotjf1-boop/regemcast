import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/contatos.dart';
import '../api/erro_api.dart';
import '../api/publicos.dart';
import '../componentes/basicos.dart';
import '../componentes/dialogos.dart';
import '../componentes/contato.dart';
import '../tema/cores.dart';
import '../util/formato.dart' as f;
import 'integracoes.dart';

/// Quantos bairros e produtos aparecem antes de "mais".
const _visiveis = 12;

/// Espera depois da última tecla antes de buscar o produto.
const _esperaDaBusca = Duration(milliseconds: 300);

/// O servidor recusa busca maior que isto.
const _tamanhoMaximoDaBusca = 80;

void _abrirIntegracoes(BuildContext context) => Navigator.of(
  context,
).push(MaterialPageRoute<void>(builder: (_) => const TelaIntegracoes()));

/// Os públicos da base, para filtrar a lista — os mesmos do site: perfis
/// (pela última compra e pelos pedidos), públicos pelas compras, produtos,
/// bairros, aniversariantes e regiões pelo DDD. Tocar num deles mostra quem
/// está nele; a lista oferece criar a lista da campanha ou dividir em blocos.
class VistaPublicos extends ConsumerWidget {
  const VistaPublicos({
    super.key,
    required this.filtro,
    required this.ehDono,
    required this.aoEscolher,
    required this.aoMudarRegras,
  });

  final FiltroDeContatos? filtro;
  final bool ehDono;
  final ValueChanged<FiltroDeContatos> aoEscolher;

  /// As regras dos perfis mudaram: a base toda muda de perfil.
  final VoidCallback aoMudarRegras;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _Perfis(
          filtro: filtro,
          ehDono: ehDono,
          aoEscolher: aoEscolher,
          aoMudarRegras: aoMudarRegras,
        ),
        const SizedBox(height: 28),
        _PublicosPelasCompras(filtro: filtro, aoEscolher: aoEscolher),
        const SizedBox(height: 28),
        _Regioes(filtro: filtro, aoEscolher: aoEscolher),
      ],
    );
  }
}

/// A seção não carregou: a tela segue, com o motivo e o "tentar de novo".
class _FalhaDaSecao extends StatelessWidget {
  const _FalhaDaSecao({required this.erro, required this.aoTentar});

  final Object erro;
  final VoidCallback aoTentar;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    return Row(
      children: [
        Icon(Icons.error_outline_rounded, color: c.erro, size: 18),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            mensagemDoErro(erro),
            style: TextStyle(color: c.tintaSuave, fontSize: 13),
          ),
        ),
        TextButton(onPressed: aoTentar, child: const Text('Tentar de novo')),
      ],
    );
  }
}

// ------------------------------------------------------------------ perfis

class _Perfis extends ConsumerWidget {
  const _Perfis({
    required this.filtro,
    required this.ehDono,
    required this.aoEscolher,
    required this.aoMudarRegras,
  });

  final FiltroDeContatos? filtro;
  final bool ehDono;
  final ValueChanged<FiltroDeContatos> aoEscolher;
  final VoidCallback aoMudarRegras;

  Future<void> _ajustar(
    BuildContext context,
    ParametrosSegmentacao parametros,
  ) async {
    final salvou = await abrirFolha<bool>(
      context,
      builder: (_) => _FolhaDeRegras(parametros: parametros),
    );
    if (salvou == true) aoMudarRegras();
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final carga = ref.watch(resumoSegmentosProvider);
    final resumo = carga.value;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TituloDeSecao(
          'Perfis da base',
          nota: 'Só quem pode receber (sem descadastrados).',
          acao: ehDono && resumo != null
              ? TextButton(
                  key: const ValueKey('ajustar-regras'),
                  onPressed: () => _ajustar(context, resumo.parametros),
                  child: const Text('Ajustar regras'),
                )
              : null,
        ),
        const SizedBox(height: 10),
        if (carga.isLoading && resumo == null)
          const Esqueleto(altura: 64)
        else if (carga.hasError && resumo == null)
          _FalhaDaSecao(
            erro: carga.error!,
            aoTentar: () => ref.invalidate(resumoSegmentosProvider),
          )
        else if (resumo != null) ...[
          if (!resumo.comHistorico) ...[
            Aviso(
              tom: TomPilula.acento,
              icone: Icons.insights_rounded,
              texto:
                  'Para classificar a base, conecte o cardápio em Integrações ou importe uma planilha com pedidos e última compra (ou dias sem comprar) — a exportação de clientes do seu cardápio costuma trazer.',
              acao: TextButton.icon(
                onPressed: () => _abrirIntegracoes(context),
                icon: const Icon(Icons.hub_outlined, size: 18),
                label: const Text('Abrir Integrações'),
              ),
            ),
            const SizedBox(height: 10),
          ],
          for (final s in resumo.segmentos) ...[
            CartaoDePublico(
              key: ValueKey('perfil-${s.id}'),
              nome: s.nome,
              regra: s.regra,
              total: s.total,
              perfil: s.id,
              ativo: filtro?.segmento == s.id,
              gasto: (s.gastoCentavos ?? 0) > 0
                  ? '${f.reais(s.gastoCentavos!)} no total${s.ticketMedioCentavos != null ? ' · ticket ${f.reais(s.ticketMedioCentavos!)}' : ''}'
                  : null,
              aoTocar: () => aoEscolher(
                FiltroDeContatos.perfil(s.id, s.nome, total: s.total),
              ),
            ),
            const SizedBox(height: 8),
          ],
        ],
      ],
    );
  }
}

/// "Ajustar regras": os quatro números da classificação. Do dono — mudam os
/// perfis da base inteira na hora. Devolve (pop) `true` quando salvou.
class _FolhaDeRegras extends ConsumerStatefulWidget {
  const _FolhaDeRegras({required this.parametros});

  final ParametrosSegmentacao parametros;

  @override
  ConsumerState<_FolhaDeRegras> createState() => _FolhaDeRegrasState();
}

class _FolhaDeRegrasState extends ConsumerState<_FolhaDeRegras> {
  late final _recente = TextEditingController(
    text: '${widget.parametros.recenteDias}',
  );
  late final _ativo = TextEditingController(
    text: '${widget.parametros.ativoDias}',
  );
  late final _risco = TextEditingController(
    text: '${widget.parametros.riscoDias}',
  );
  late final _fiel = TextEditingController(
    text: '${widget.parametros.fielPedidos}',
  );
  bool _salvando = false;
  String? _erro;

  @override
  void dispose() {
    for (final c in [_recente, _ativo, _risco, _fiel]) {
      c.dispose();
    }
    super.dispose();
  }

  void _padrao() {
    const p = ParametrosSegmentacao.padrao;
    setState(() {
      _recente.text = '${p.recenteDias}';
      _ativo.text = '${p.ativoDias}';
      _risco.text = '${p.riscoDias}';
      _fiel.text = '${p.fielPedidos}';
      _erro = null;
    });
  }

  Future<void> _salvar() async {
    int n(TextEditingController c) => int.tryParse(c.text.trim()) ?? 0;
    FocusScope.of(context).unfocus();
    setState(() {
      _salvando = true;
      _erro = null;
    });
    try {
      await ref
          .read(servicoContatosProvider)
          .salvarParametros(
            ParametrosSegmentacao(
              recenteDias: n(_recente),
              ativoDias: n(_ativo),
              riscoDias: n(_risco),
              fielPedidos: n(_fiel),
            ),
          );
      if (!mounted) return;
      ref.invalidate(resumoSegmentosProvider);
      Navigator.of(context).pop(true);
    } catch (e) {
      if (mounted) setState(() => _erro = mensagemDoErro(e));
    } finally {
      if (mounted) setState(() => _salvando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    Widget campo(String chave, String rotulo, TextEditingController ctl) =>
        TextField(
          key: ValueKey('regra-$chave'),
          controller: ctl,
          keyboardType: TextInputType.number,
          inputFormatters: [FilteringTextInputFormatter.digitsOnly],
          decoration: InputDecoration(labelText: rotulo),
        );
    return Padding(
      padding: EdgeInsets.fromLTRB(
        20,
        0,
        20,
        16 + MediaQuery.viewInsetsOf(context).bottom,
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Regras dos perfis',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 6),
            Text(
              'Os perfis mudam na hora, para a base inteira. Os dias precisam crescer: recente < ativo < em risco.',
              style: TextStyle(color: c.tintaSuave, height: 1.45),
            ),
            const SizedBox(height: 14),
            Row(
              children: [
                Expanded(
                  child: campo('recente', 'Recente: até (dias)', _recente),
                ),
                const SizedBox(width: 12),
                Expanded(child: campo('ativo', 'Ativo: até (dias)', _ativo)),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(child: campo('risco', 'Em risco: até (dias)', _risco)),
                const SizedBox(width: 12),
                Expanded(child: campo('fiel', 'Frequente: pedidos', _fiel)),
              ],
            ),
            if (_erro != null) ...[
              const SizedBox(height: 12),
              Aviso(
                tom: TomPilula.erro,
                icone: Icons.error_outline_rounded,
                texto: _erro!,
              ),
            ],
            const SizedBox(height: 16),
            FilledButton(
              key: const ValueKey('salvar-regras'),
              onPressed: _salvando ? null : _salvar,
              child: _salvando
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Salvar regras'),
            ),
            const SizedBox(height: 6),
            OutlinedButton(
              key: const ValueKey('regras-padrao'),
              onPressed: _salvando ? null : _padrao,
              child: const Text('Voltar ao padrão'),
            ),
          ],
        ),
      ),
    );
  }
}

// ------------------------------------------------- públicos pelas compras

class _PublicosPelasCompras extends ConsumerStatefulWidget {
  const _PublicosPelasCompras({required this.filtro, required this.aoEscolher});

  final FiltroDeContatos? filtro;
  final ValueChanged<FiltroDeContatos> aoEscolher;

  @override
  ConsumerState<_PublicosPelasCompras> createState() =>
      _PublicosPelasComprasState();
}

class _PublicosPelasComprasState extends ConsumerState<_PublicosPelasCompras> {
  bool _todosOsBairros = false;

  bool _ativo(String publico, [String? valor]) =>
      widget.filtro?.publico == publico && widget.filtro?.valor == valor;

  void _escolher(String publico, String? valor, String nome, int total) =>
      widget.aoEscolher(
        FiltroDeContatos.publico(publico, valor, nome, total: total),
      );

  @override
  Widget build(BuildContext context) {
    final carga = ref.watch(publicosProntosProvider);
    final resumo = carga.value;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const TituloDeSecao(
          'Públicos pelas compras',
          nota:
              'Só quem pode receber. VIP e ticket são calculados com os valores da sua loja.',
        ),
        const SizedBox(height: 10),
        if (carga.isLoading && resumo == null)
          const Esqueleto(altura: 64)
        else if (carga.hasError && resumo == null)
          _FalhaDaSecao(
            erro: carga.error!,
            aoTentar: () => ref.invalidate(publicosProntosProvider),
          )
        else if (resumo != null)
          ..._conteudo(context, resumo),
      ],
    );
  }

  List<Widget> _conteudo(BuildContext context, ResumoPublicos resumo) {
    // "Conversaram" só existe com as conversas ligadas: sem elas, o zero
    // diria "ninguém conversou" quando o certo é "não sabemos".
    final porId = {
      for (final p in resumo.publicos)
        if (p.id != 'conversaram_7d' || resumo.conversasLigadas) p.id: p,
    };
    final grupos = [
      for (final g in gruposDePublicos)
        (
          titulo: g.titulo,
          itens: [
            for (final id in g.ids)
              if (porId[id] != null) porId[id]!,
          ],
        ),
    ].where((g) => g.itens.any((p) => p.total > 0)).toList();
    final aniversarios = resumo.aniversarios.where((a) => a.total > 0).toList();
    final bairros = _todosOsBairros
        ? resumo.bairros
        : resumo.bairros.take(_visiveis).toList();
    final vazio =
        grupos.isEmpty && resumo.bairros.isEmpty && aniversarios.isEmpty;
    // O aviso é sobre VALOR: com engajamento na tela e sem compra nenhuma,
    // ele continua útil.
    final semCompras = resumo.comValor == 0 && resumo.comCompras == 0;

    return [
      if (vazio || semCompras) ...[
        Aviso(
          tom: TomPilula.acento,
          icone: Icons.receipt_long_rounded,
          texto:
              'Para separar a base por valor gasto, bairro, jeito de comprar, horário e produto, traga as compras: conecte o cardápio em Integrações ou importe uma planilha com pedidos e total gasto.',
          acao: TextButton.icon(
            onPressed: () => _abrirIntegracoes(context),
            icon: const Icon(Icons.hub_outlined, size: 18),
            label: const Text('Abrir Integrações'),
          ),
        ),
        const SizedBox(height: 14),
      ],
      if (!vazio) ...[
        for (final g in grupos) ...[
          TituloDeGrupo(g.titulo),
          const SizedBox(height: 8),
          for (final p in g.itens) ...[
            CartaoDePublico(
              key: ValueKey('publico-${p.id}'),
              nome: p.nome,
              regra: p.regra,
              total: p.total,
              ativo: _ativo(p.id),
              gasto: (p.gastoCentavos ?? 0) > 0
                  ? '${f.reais(p.gastoCentavos!)} em compras'
                  : null,
              aoTocar: () => _escolher(p.id, null, p.nome, p.total),
            ),
            const SizedBox(height: 8),
          ],
          const SizedBox(height: 10),
        ],
        _Produtos(filtro: widget.filtro, aoEscolher: widget.aoEscolher),
        if (resumo.bairros.isNotEmpty) ...[
          const SizedBox(height: 18),
          const TituloDeGrupo(
            'Bairros',
            complemento: 'o mais frequente nas entregas',
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final b in bairros)
                FichaDePublico(
                  key: ValueKey('bairro-${b.bairro}'),
                  rotulo: b.bairro,
                  total: b.total,
                  ativa: _ativo('bairro', b.bairro),
                  aoTocar: () => _escolher(
                    'bairro',
                    b.bairro,
                    'Bairro ${b.bairro}',
                    b.total,
                  ),
                ),
              if (resumo.bairros.length > _visiveis)
                TextButton(
                  onPressed: () =>
                      setState(() => _todosOsBairros = !_todosOsBairros),
                  child: Text(
                    _todosOsBairros
                        ? 'Mostrar menos'
                        : 'Mais ${resumo.bairros.length - _visiveis} bairros',
                  ),
                ),
            ],
          ),
        ],
        if (aniversarios.isNotEmpty) ...[
          const SizedBox(height: 18),
          const TituloDeGrupo('Aniversariantes'),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final a in aniversarios)
                FichaDePublico(
                  key: ValueKey('aniversario-${a.mes}'),
                  rotulo: a.mes == resumo.mesAtual
                      ? '${_mes(a.mes)} (este mês)'
                      : _mes(a.mes),
                  total: a.total,
                  destaque: a.mes == resumo.mesAtual,
                  ativa: _ativo('aniversario', '${a.mes}'),
                  aoTocar: () => _escolher(
                    'aniversario',
                    '${a.mes}',
                    'Aniversariantes de ${_mes(a.mes)}',
                    a.total,
                  ),
                ),
            ],
          ),
        ],
      ],
    ];
  }

  String _mes(int mes) =>
      mes >= 1 && mes <= 12 ? nomesDosMeses[mes - 1] : '$mes';
}

/// "Já compraram…": os produtos que mais gente comprou, com busca pelo nome.
/// Cada ficha é um público — o número é exatamente quem aparece ao tocar.
class _Produtos extends ConsumerStatefulWidget {
  const _Produtos({required this.filtro, required this.aoEscolher});

  final FiltroDeContatos? filtro;
  final ValueChanged<FiltroDeContatos> aoEscolher;

  @override
  ConsumerState<_Produtos> createState() => _ProdutosState();
}

class _ProdutosState extends ConsumerState<_Produtos> {
  final _busca = TextEditingController();
  Timer? _espera;

  /// O termo que já foi para o servidor (depois da espera).
  String _termo = '';
  bool _todos = false;

  @override
  void dispose() {
    _espera?.cancel();
    _busca.dispose();
    super.dispose();
  }

  void _digitou(String texto) {
    final termo = texto.replaceAll(RegExp(r'\s+'), ' ').trim();
    _espera?.cancel();
    _espera = Timer(termo.isEmpty ? Duration.zero : _esperaDaBusca, () {
      if (mounted && termo != _termo) {
        setState(() {
          _termo = termo;
          _todos = false;
        });
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    // Sem produto nenhum (sem busca), a seção nem aparece.
    final semBusca = ref.watch(produtosDaBuscaProvider(''));
    if (semBusca.hasValue && semBusca.value!.isEmpty && _termo.isEmpty) {
      return const SizedBox.shrink();
    }
    if (!semBusca.hasValue && !semBusca.hasError) {
      return const SizedBox.shrink();
    }
    final carga = ref.watch(produtosDaBuscaProvider(_termo));
    final lista = carga.value ?? const <({String nome, int total})>[];
    final visiveis = _todos ? lista : lista.take(_visiveis).toList();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const TituloDeGrupo(
          'Já compraram',
          complemento: 'os produtos que mais gente pediu',
        ),
        const SizedBox(height: 8),
        TextField(
          key: const ValueKey('buscar-produto'),
          controller: _busca,
          onChanged: _digitou,
          maxLength: _tamanhoMaximoDaBusca,
          textInputAction: TextInputAction.search,
          decoration: const InputDecoration(
            hintText: 'Buscar produto',
            prefixIcon: Icon(Icons.search_rounded),
            counterText: '',
          ),
        ),
        const SizedBox(height: 10),
        if (carga.hasError)
          _FalhaDaSecao(
            erro: carga.error!,
            aoTentar: () => ref.invalidate(produtosDaBuscaProvider(_termo)),
          )
        else if (carga.isLoading && !carga.hasValue)
          const Esqueleto(altura: 36)
        else if (_termo.isNotEmpty && lista.isEmpty)
          Text(
            'Nenhum produto com “$_termo” entre as compras de quem pode receber.',
            style: TextStyle(color: c.tintaSuave, fontSize: 13.5),
          )
        else
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final p in visiveis)
                FichaDePublico(
                  key: ValueKey('produto-${p.nome}'),
                  rotulo: p.nome,
                  total: p.total,
                  ativa:
                      widget.filtro?.publico == 'produto' &&
                      widget.filtro?.valor == p.nome,
                  aoTocar: () => widget.aoEscolher(
                    FiltroDeContatos.publico(
                      'produto',
                      p.nome,
                      'Já compraram ${p.nome}',
                      total: p.total,
                    ),
                  ),
                ),
              if (lista.length > _visiveis)
                TextButton(
                  onPressed: () => setState(() => _todos = !_todos),
                  child: Text(
                    _todos
                        ? 'Mostrar menos'
                        : 'Mais ${lista.length - _visiveis} produtos',
                  ),
                ),
            ],
          ),
      ],
    );
  }
}

// ----------------------------------------------------------------- regiões

/// A base por estado, pelo DDD — a classificação que existe até na lista mais
/// crua, só com nome e número.
class _Regioes extends ConsumerWidget {
  const _Regioes({required this.filtro, required this.aoEscolher});

  final FiltroDeContatos? filtro;
  final ValueChanged<FiltroDeContatos> aoEscolher;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = Cores.de(context);
    final carga = ref.watch(regioesProvider);
    final regioes = carga.value;
    if (carga.hasError && regioes == null) {
      return _FalhaDaSecao(
        erro: carga.error!,
        aoTentar: () => ref.invalidate(regioesProvider),
      );
    }
    if (regioes == null || regioes.regioes.isEmpty) {
      return const SizedBox.shrink();
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const TituloDeSecao(
          'Regiões pelo DDD',
          nota:
              'O DDD diz onde a linha foi habilitada, não onde a pessoa mora hoje.',
        ),
        const SizedBox(height: 10),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final r in regioes.regioes)
              FichaDePublico(
                key: ValueKey('regiao-${r.uf}'),
                rotulo: r.uf,
                total: r.total,
                ativa: filtro?.uf == r.uf,
                aoTocar: () => aoEscolher(
                  FiltroDeContatos.regiao(
                    r.uf,
                    r.estado,
                    total: r.total,
                    detalhe: r.ddds
                        .map((d) => '${d.ddd} ${d.cidade}')
                        .join(', '),
                  ),
                ),
              ),
            if (regioes.semRegiao > 0)
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 7,
                ),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(99),
                  border: Border.all(color: c.borda),
                ),
                child: Text(
                  'Fora do Brasil ou sem DDD  ${f.numero(regioes.semRegiao)}',
                  style: TextStyle(color: c.tintaSuave, fontSize: 13),
                ),
              ),
          ],
        ),
      ],
    );
  }
}
