import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/contatos.dart';
import '../api/erro_api.dart';
import '../componentes/basicos.dart';
import '../componentes/contato.dart';
import '../componentes/dialogos.dart';
import '../tema/cores.dart';
import '../util/formato.dart' as f;

/// Bloqueios: quem pediu para não receber mais — e os números que a Meta
/// recusou por não terem WhatsApp.
///
/// As três ações são diferentes de propósito, como no site: voltar à base só
/// a pedido da própria pessoa (e com o pedido gravado); apagar os dados
/// atende a exclusão da LGPD mantendo o bloqueio; apagar tudo é o que menos
/// protege o número da empresa, porque deixa a pessoa voltar numa importação.
class TelaBloqueios extends ConsumerStatefulWidget {
  const TelaBloqueios({super.key});

  @override
  ConsumerState<TelaBloqueios> createState() => _TelaBloqueiosState();
}

class _TelaBloqueiosState extends ConsumerState<TelaBloqueios> {
  final _rolagem = ScrollController();
  final _itens = <Contato>[];
  int _pagina = 0;
  int _total = 0;
  bool _temMais = true;
  bool _carregando = false;
  Object? _erro;

  /// Contato com uma ação em andamento (os botões dele giram).
  String? _agindo;

  /// Sem WhatsApp: seção complementar; se falhar, a tela segue sem ela.
  PaginaContatos? _semWhatsapp;

  @override
  void initState() {
    super.initState();
    _rolagem.addListener(() {
      if (_rolagem.position.extentAfter < 600) _carregarMais();
    });
    _carregarMais();
    _lerSemWhatsapp();
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
      final p = await ref
          .read(servicoContatosProvider)
          .pagina(_pagina + 1, situacao: 'bloqueados');
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

  Future<void> _lerSemWhatsapp() async {
    try {
      final p = await ref
          .read(servicoContatosProvider)
          .pagina(1, situacao: 'sem_whatsapp', tamanho: 100);
      if (mounted) setState(() => _semWhatsapp = p);
    } catch (_) {
      if (mounted) setState(() => _semWhatsapp = null);
    }
  }

  Future<void> _recomecar() async {
    setState(() {
      _itens.clear();
      _pagina = 0;
      _temMais = true;
    });
    await Future.wait([_carregarMais(), _lerSemWhatsapp()]);
  }

  /// Faz a ação, avisa e relê a lista (o contato sai dela ou muda).
  Future<void> _agir(
    Contato contato,
    Future<void> Function() acao,
    String texto,
  ) async {
    setState(() => _agindo = contato.id);
    try {
      await acao();
      if (!mounted) return;
      avisar(context, texto);
      await _recomecar();
    } catch (e) {
      if (mounted) avisar(context, mensagemDoErro(e));
    } finally {
      if (mounted) setState(() => _agindo = null);
    }
  }

  Future<void> _voltarABase(Contato contato) async {
    final justificativa = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      backgroundColor: Cores.de(context).superficie,
      builder: (_) => _FolhaDeRetorno(contato: contato),
    );
    if (justificativa == null || !mounted) return;
    await _agir(
      contato,
      () =>
          ref.read(servicoContatosProvider).reativar(contato.id, justificativa),
      'Contato de volta à base, com o pedido registrado.',
    );
  }

  Future<void> _apagarDados(Contato contato) async {
    final ok = await confirmar(
      context,
      titulo: 'Apagar os dados?',
      texto:
          'Apagar nome, e-mail, aniversário e histórico desta pessoa? O número continua bloqueado.',
      botao: 'Apagar dados',
      perigo: true,
    );
    if (!ok || !mounted) return;
    await _agir(
      contato,
      () => ref.read(servicoContatosProvider).anonimizar(contato.id),
      'Dados pessoais apagados. O número segue bloqueado.',
    );
  }

  Future<void> _apagarTudo(Contato contato) async {
    final ok = await confirmar(
      context,
      titulo: 'Apagar tudo, inclusive o número?',
      texto:
          'Sem o número na lista, esta pessoa pode voltar numa importação futura e receber campanha de novo. Para atender um pedido de exclusão mantendo o bloqueio, use "Apagar dados".',
      botao: 'Apagar tudo',
      perigo: true,
    );
    if (!ok || !mounted) return;
    await _agir(
      contato,
      () => ref.read(servicoContatosProvider).apagar(contato.id),
      'Contato apagado por completo.',
    );
  }

  Future<void> _tentarDeNovo(Contato contato) => _agir(
    contato,
    () => ref.read(servicoContatosProvider).tentarWhatsappDeNovo(contato.id),
    'Número de volta aos envios. Se a Meta recusar de novo em duas campanhas, ele volta para esta lista.',
  );

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final semWhatsapp = _semWhatsapp;
    return Scaffold(
      appBar: AppBar(title: const Text('Bloqueios')),
      body: RefreshIndicator(
        color: c.acentoContraste,
        backgroundColor: c.acento,
        onRefresh: _recomecar,
        child: ListView(
          controller: _rolagem,
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(20, 4, 20, 28),
          children: [
            if (_pagina > 0)
              Text(
                f.plural(_total, 'número bloqueado', 'números bloqueados'),
                style: TextStyle(color: c.tintaSuave, fontSize: 13),
              ),
            const SizedBox(height: 4),
            Text(
              'Quem pediu para não receber mais. Nenhuma campanha sai para estes números — a conferência é feita no momento do disparo.',
              style: TextStyle(color: c.tintaSuave, height: 1.45),
            ),
            const SizedBox(height: 14),
            const Aviso(
              tom: TomPilula.acento,
              icone: Icons.shield_outlined,
              texto:
                  'Respeitar o pedido de saída é o que protege o seu número: quem não consegue sair bloqueia ou denuncia, e bloqueio derruba a qualidade — que leva semanas para voltar. Só devolva alguém à base se a própria pessoa pedir.',
            ),
            const SizedBox(height: 16),
            if (_itens.isEmpty && _carregando)
              const Cartao(child: Esqueleto(altura: 120))
            else if (_itens.isEmpty && _erro != null)
              EstadoErro(
                titulo: 'Não consegui carregar os bloqueios',
                mensagem: mensagemDoErro(_erro!),
                aoTentar: _carregarMais,
              )
            else if (_itens.isEmpty)
              Cartao(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Ninguém pediu para sair',
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'Quando alguém tocar em “Parar promoções” ou responder pedindo para sair, o número aparece aqui.',
                      style: TextStyle(color: c.tintaSuave, height: 1.45),
                    ),
                  ],
                ),
              )
            else
              Cartao(
                padding: EdgeInsets.zero,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    for (var i = 0; i < _itens.length; i++) ...[
                      if (i > 0) Divider(height: 1, color: c.borda),
                      _LinhaBloqueio(
                        contato: _itens[i],
                        agindo: _agindo == _itens[i].id,
                        livre: _agindo == null,
                        aoVoltar: _voltarABase,
                        aoApagarDados: _apagarDados,
                        aoApagarTudo: _apagarTudo,
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
              Center(
                child: TextButton(
                  onPressed: _carregarMais,
                  child: const Text('Não carregou o resto. Tentar de novo'),
                ),
              ),
            if (semWhatsapp != null && semWhatsapp.total > 0) ...[
              const SizedBox(height: 26),
              _SemWhatsapp(
                pagina: semWhatsapp,
                agindo: _agindo,
                aoTentar: _tentarDeNovo,
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _LinhaBloqueio extends StatelessWidget {
  const _LinhaBloqueio({
    required this.contato,
    required this.agindo,
    required this.livre,
    required this.aoVoltar,
    required this.aoApagarDados,
    required this.aoApagarTudo,
  });

  final Contato contato;
  final bool agindo;

  /// Nenhuma ação em andamento em outro contato.
  final bool livre;
  final ValueChanged<Contato> aoVoltar;
  final ValueChanged<Contato> aoApagarDados;
  final ValueChanged<Contato> aoApagarTudo;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final pode = livre && !agindo;
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            contato.nome ?? 'Sem nome',
            style: TextStyle(
              fontWeight: FontWeight.w600,
              color: contato.nome == null ? c.tintaSuave : c.tinta,
            ),
          ),
          Text(
            f.telefone(contato.telefone),
            style: TextStyle(
              fontSize: 13,
              fontFeatures: const [FontFeature.tabularFigures()],
              color: c.tinta,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            'Saiu em ${f.data(contato.optOutEm)} · ${comoSaiu(contato.optOutOrigem)}',
            style: TextStyle(color: c.tintaSuave, fontSize: 12.5, height: 1.4),
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              OutlinedButton(
                key: ValueKey('voltar-${contato.id}'),
                style: OutlinedButton.styleFrom(minimumSize: const Size(0, 38)),
                onPressed: pode ? () => aoVoltar(contato) : null,
                child: agindo
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Text('Voltar à base'),
              ),
              OutlinedButton(
                key: ValueKey('apagar-dados-${contato.id}'),
                style: OutlinedButton.styleFrom(minimumSize: const Size(0, 38)),
                onPressed: pode ? () => aoApagarDados(contato) : null,
                child: const Text('Apagar dados'),
              ),
              OutlinedButton(
                key: ValueKey('apagar-tudo-${contato.id}'),
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size(0, 38),
                  foregroundColor: c.erro,
                  side: BorderSide(color: c.erro.withValues(alpha: .5)),
                ),
                onPressed: pode ? () => aoApagarTudo(contato) : null,
                child: const Text('Apagar tudo'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// "Voltar à base": a justificativa fica gravada no contato e na auditoria.
/// Devolve (pop) o texto, ou nada se cancelou.
class _FolhaDeRetorno extends StatefulWidget {
  const _FolhaDeRetorno({required this.contato});

  final Contato contato;

  @override
  State<_FolhaDeRetorno> createState() => _FolhaDeRetornoState();
}

class _FolhaDeRetornoState extends State<_FolhaDeRetorno> {
  final _justificativa = TextEditingController();

  @override
  void dispose() {
    _justificativa.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final texto = _justificativa.text.trim();
    final contato = widget.contato;
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
            'Voltar ${contato.nome ?? f.telefone(contato.telefone)} à base',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 8),
          Text(
            'Só faça isso se a própria pessoa pediu. O que você escrever fica gravado no contato e na trilha de auditoria — é a prova de que o retorno foi pedido, e não uma saída apagada.',
            style: TextStyle(color: c.tintaSuave, height: 1.45),
          ),
          const SizedBox(height: 14),
          TextField(
            key: const ValueKey('justificativa'),
            controller: _justificativa,
            autofocus: true,
            maxLength: 500,
            minLines: 2,
            maxLines: 4,
            onChanged: (_) => setState(() {}),
            decoration: const InputDecoration(
              labelText: 'Quem pediu, e como',
              hintText:
                  'Ex.: a cliente pediu no balcão para voltar a receber as promoções',
            ),
          ),
          const SizedBox(height: 8),
          FilledButton(
            key: const ValueKey('confirmar-retorno'),
            onPressed: texto.length < 5
                ? null
                : () => Navigator.of(context).pop(texto),
            child: const Text('Confirmar retorno'),
          ),
          const SizedBox(height: 4),
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Cancelar'),
          ),
        ],
      ),
    );
  }
}

/// Números que a Meta recusou (131026) em duas campanhas: não é pedido de
/// saída — é número que não recebe. "Tentar de novo" não pede justificativa.
class _SemWhatsapp extends StatelessWidget {
  const _SemWhatsapp({
    required this.pagina,
    required this.agindo,
    required this.aoTentar,
  });

  final PaginaContatos pagina;
  final String? agindo;
  final ValueChanged<Contato> aoTentar;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TituloDeSecao(
          'Sem WhatsApp · ${f.numero(pagina.total)}',
          nota: 'A Meta recusou o número em duas campanhas diferentes.',
        ),
        const SizedBox(height: 8),
        Text(
          'O número não tem WhatsApp, não aceitou os termos do aplicativo ou usa uma versão antiga. Ele saiu sozinho dos envios — mandar de novo só gastaria o plano. Se a pessoa atualizou o app ou você corrigiu o número, tente de novo.',
          style: TextStyle(color: c.tintaSuave, height: 1.45, fontSize: 13.5),
        ),
        const SizedBox(height: 12),
        Cartao(
          padding: EdgeInsets.zero,
          child: Column(
            children: [
              for (var i = 0; i < pagina.itens.length; i++) ...[
                if (i > 0) Divider(height: 1, color: c.borda),
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 10, 12, 10),
                  child: Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              pagina.itens[i].nome ?? 'Sem nome',
                              style: TextStyle(
                                fontWeight: FontWeight.w500,
                                color: pagina.itens[i].nome == null
                                    ? c.tintaSuave
                                    : c.tinta,
                              ),
                            ),
                            Text(
                              '${f.telefone(pagina.itens[i].telefone)} · desde ${f.data(pagina.itens[i].semWhatsappEm)}',
                              style: TextStyle(
                                color: c.tintaSuave,
                                fontSize: 12.5,
                                fontFeatures: const [
                                  FontFeature.tabularFigures(),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ),
                      OutlinedButton(
                        key: ValueKey('tentar-${pagina.itens[i].id}'),
                        style: OutlinedButton.styleFrom(
                          minimumSize: const Size(0, 38),
                        ),
                        onPressed: agindo != null
                            ? null
                            : () => aoTentar(pagina.itens[i]),
                        child: agindo == pagina.itens[i].id
                            ? const SizedBox(
                                width: 16,
                                height: 16,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                ),
                              )
                            : const Text('Tentar de novo'),
                      ),
                    ],
                  ),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }
}
