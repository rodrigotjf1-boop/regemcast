import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/campanhas.dart';
import '../api/contatos.dart';
import '../api/dados.dart';
import '../api/erro_api.dart';
import '../api/modelos.dart';
import '../api/publicos.dart';
import '../componentes/basicos.dart';
import '../componentes/categoria.dart';
import '../componentes/dialogos.dart';
import '../componentes/escolha.dart';
import '../sessao/sessao.dart';
import '../tema/cores.dart';
import '../util/formato.dart' as f;
import 'campanha_detalhe.dart';
import 'modelo_editor.dart';

/// Montar e editar a campanha — o mesmo formulário do site
/// (`frontend/src/components/app/formulario-campanha.tsx`).
///
/// O modelo vem da lista real da Meta, e só os **aprovados** aparecem:
/// oferecer um modelo em análise seria oferecer um disparo que a Meta vai
/// recusar, e a pessoa descobriria isso depois de montar o público inteiro.
///
/// Na EDIÇÃO, o que aparece depende da situação. Em rascunho nada saiu, então
/// tudo pode mudar. Depois de disparada, modelo e público somem do formulário:
/// eles são o registro do que foi enviado.
///
/// Montar não envia nada: ao montar, a tela abre a campanha, onde se confere e
/// se dispara.
class TelaFormularioCampanha extends ConsumerStatefulWidget {
  const TelaFormularioCampanha({super.key, this.campanha, this.listaInicial});

  /// Presente = edição. Ausente = campanha nova.
  final ResumoCampanha? campanha;

  /// Lista (ou bloco) já escolhida — quando se chega por "Usar em campanha".
  final String? listaInicial;

  @override
  ConsumerState<TelaFormularioCampanha> createState() =>
      _TelaFormularioCampanhaState();
}

/// Números digitados: o mesmo teto do servidor. Público maior vem de lista.
const tetoDestinatarios = 500;

/// Na ordem do site. `fixo` é o padrão.
const _rotuloOrigem = {
  'nome': 'Nome do contato',
  'primeiro_nome': 'Primeiro nome do contato',
  'fixo': 'Texto igual para todos',
  'cashback_saldo': 'Saldo do cashback',
  'cashback_validade': 'Validade do cashback',
};

bool _deCashback(String origem) =>
    origem == 'cashback_saldo' || origem == 'cashback_validade';

/// De onde a variável do título pode sair: o cashback fica de fora (o
/// servidor recusa).
const _origensDoTitulo = ['fixo', 'nome', 'primeiro_nome'];

/// O título de um modelo aceita até 60 caracteres.
const _limiteDoTitulo = 60;

/// O que o campo de cada variável pede, e o que a pessoa lê embaixo dele.
({String dica, String? ajuda}) _ajudaDaOrigem(
  String origem,
) => switch (origem) {
  'nome' || 'primeiro_nome' => (
    dica: 'Se não tiver nome, ex.: cliente',
    ajuda: 'Usado quando o contato não tem nome cadastrado.',
  ),
  'cashback_saldo' => (
    dica: '',
    ajuda: 'Sai como “R\$ 12,50”: o saldo de cada cliente no dia do envio.',
  ),
  'cashback_validade' => (
    dica: 'Se não tiver data para vencer, ex.: sem prazo',
    ajuda:
        'Sai como “30/09”: o dia em que o cashback vence. O texto vale para quem não tem data.',
  ),
  _ => (dica: 'Texto', ajuda: null),
};

enum _Quem { lista, base, numeros }

/// "Da base": de onde sai o público.
const _tiposDaBase = {
  'base': 'Toda a base',
  'importacao': 'Uma importação (arquivo ou Cardápio Web)',
  'perfil': 'Um perfil (Campeões, Em risco…)',
  'publico': 'Um público pronto (VIP, horário, produto, bairro…)',
};

const _vazioDaBase = {
  'importacao':
      'Nenhuma importação com contatos que podem receber. Importe em Contatos.',
  'perfil': 'Nenhum perfil com contatos que podem receber ainda.',
  'publico':
      'Os públicos prontos aparecem com as compras (Integrações) ou com uma planilha de pedidos.',
};

String _contagem(int n) => f.plural(n, 'contato', 'contatos');

String _rotuloDoBloco(ListaContatos l) {
  final casas = '${l.blocos ?? 0}'.length < 2 ? 2 : '${l.blocos ?? 0}'.length;
  final uso = l.usadaEm != null
      ? 'já enviado em ${f.data(l.usadaEm)}'
      : 'ainda não usado';
  return 'Bloco ${'${l.bloco ?? 0}'.padLeft(casas, '0')} · ${_contagem(l.total)} · $uso';
}

class _TelaFormularioCampanhaState
    extends ConsumerState<TelaFormularioCampanha> {
  late final ResumoCampanha? _c = widget.campanha;
  bool get _editando => _c != null;

  /// Em rascunho tudo muda; depois de disparada, só nome, janela e ritmo.
  bool get _podeTrocarConteudo => !_editando || _c!.status == 'rascunho';

  late final _nome = TextEditingController(text: _c?.nome ?? '');
  final _numeros = TextEditingController();
  final _valores = <TextEditingController>[];
  final _origens = <String>[];

  // ---- a variável do título do modelo (pré-preenchida da campanha)
  late String _tituloOrigem =
      _origensDoTitulo.contains(_c?.variavelCabecalho?.origem)
      ? _c!.variavelCabecalho!.origem
      : 'fixo';
  late final _titulo = TextEditingController(
    text: _c?.variavelCabecalho?.valor ?? '',
  );

  late String? _modeloId = _c?.modeloId;
  _Quem? _quemEscolhido;
  String? _listaEscolhida;
  String? _tipoDaBase;
  PublicoDaCampanha? _daBase;
  bool _ignorarDescanso = false;

  // ---- janela e ritmo (pré-preenchidos da campanha, como no site)
  late bool _janelaAtiva = _c?.temJanela ?? false;
  late final Set<int> _dias = {...?_c?.janelaDias};
  late TimeOfDay? _inicio = _lerHora(_c?.janelaInicio);
  late TimeOfDay? _fim = _lerHora(_c?.janelaFim);
  late final _pausa = TextEditingController(
    text: (_c?.pausaSegundos ?? 0) > 0 ? '${_c!.pausaSegundos}' : '',
  );
  late final _maxDia = TextEditingController(text: _txt(_c?.maxPorDia));
  late final _maxSemana = TextEditingController(text: _txt(_c?.maxPorSemana));
  late final _maxMes = TextEditingController(text: _txt(_c?.maxPorMes));

  String? _erro;
  bool _salvando = false;
  bool _mexeu = false;
  bool _saindo = false;
  final _rolagem = ScrollController();

  static String _txt(int? v) => v == null || v == 0 ? '' : '$v';

  static TimeOfDay? _lerHora(String? hhmmss) {
    if (hhmmss == null || hhmmss.length < 5) return null;
    final h = int.tryParse(hhmmss.substring(0, 2));
    final m = int.tryParse(hhmmss.substring(3, 5));
    return (h == null || m == null) ? null : TimeOfDay(hour: h, minute: m);
  }

  static String _hhmm(TimeOfDay t) =>
      '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';

  @override
  void initState() {
    super.initState();
    for (final c in [
      _nome,
      _numeros,
      _titulo,
      _pausa,
      _maxDia,
      _maxSemana,
      _maxMes,
    ]) {
      c.addListener(_marcar);
    }
  }

  @override
  void dispose() {
    for (final c in [
      _nome,
      _numeros,
      _titulo,
      _pausa,
      _maxDia,
      _maxSemana,
      _maxMes,
      ..._valores,
    ]) {
      c.dispose();
    }
    _rolagem.dispose();
    super.dispose();
  }

  void _marcar() {
    if (!mounted) return;
    setState(() {
      _mexeu = true;
      _erro = null;
    });
  }

  // ------------------------------------------------------------- derivados

  /// Sem escolha explícita: lista quando há listas; "Da base" sem nenhuma
  /// lista; números quando as listas não carregaram — como no site.
  _Quem _quem(AsyncValue<List<ListaContatos>> listas) {
    if (_quemEscolhido != null) return _quemEscolhido!;
    if (listas.hasError) return _Quem.numeros;
    final l = listas.value;
    if (l != null && l.isEmpty) return _Quem.base;
    return _Quem.lista;
  }

  String? _listaId(List<ListaContatos>? listas) {
    if (_listaEscolhida != null) return _listaEscolhida;
    final inicial = widget.listaInicial;
    if (inicial != null && (listas ?? const []).any((l) => l.id == inicial)) {
      return inicial;
    }
    return null;
  }

  List<String> get _numerosDigitados => _numeros.text
      .split(RegExp(r'[\s,;]+'))
      .map((t) => t.replaceAll(RegExp(r'\D'), ''))
      .where((t) => t.isNotEmpty)
      .toList();

  /// Um campo por variável do modelo escolhido; `fixo` é o padrão.
  void _ajustarVariaveis(int n) {
    while (_valores.length < n) {
      _valores.add(TextEditingController()..addListener(_marcar));
      _origens.add('fixo');
    }
    while (_valores.length > n) {
      _valores.removeLast().dispose();
      _origens.removeLast();
    }
  }

  // ----------------------------------------------------------------- janela

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
      setState(() {
        if (ehInicio) {
          _inicio = escolhida;
        } else {
          _fim = escolhida;
        }
        _mexeu = true;
        _erro = null;
      });
    }
  }

  int? _n(TextEditingController c) => int.tryParse(c.text.trim());

  /// As mesmas conferências do site (e do servidor, que confere de novo).
  String? _problemaDaJanela() {
    if (!_janelaAtiva) return null;
    final dia = _n(_maxDia), semana = _n(_maxSemana), mes = _n(_maxMes);
    if ((dia != null && semana != null && dia > semana) ||
        (semana != null && mes != null && semana > mes) ||
        (dia != null && mes != null && dia > mes)) {
      return 'Os limites precisam ser crescentes: o do dia não pode passar o da semana, nem o da semana o do mês.';
    }
    if ((_inicio == null) != (_fim == null)) {
      return 'Preencha o início E o fim do horário, ou deixe os dois vazios.';
    }
    if ((_n(_pausa) ?? 0) > 3600) {
      return 'A pausa entre envios pode ser de até 1 hora (3600 segundos).';
    }
    return null;
  }

  /// A janela como a MONTAGEM manda: só o que foi preenchido.
  Map<String, Object?> _janelaParaEnvio() {
    if (!_janelaAtiva) return const {};
    return {
      'janelaDias': _dias.toList()..sort(),
      if (_inicio != null && _fim != null) ...{
        'janelaInicio': _hhmm(_inicio!),
        'janelaFim': _hhmm(_fim!),
      },
      if (_n(_pausa) != null) 'pausaSegundos': _n(_pausa),
      if (_n(_maxDia) != null) 'maxPorDia': _n(_maxDia),
      if (_n(_maxSemana) != null) 'maxPorSemana': _n(_maxSemana),
      if (_n(_maxMes) != null) 'maxPorMes': _n(_maxMes),
    };
  }

  /// A janela como a EDIÇÃO manda: desligar vai explícito (vazio/nulo), senão
  /// o servidor entende "não mexer" e a campanha fica presa ao horário antigo.
  Map<String, Object?> _janelaDaEdicao() {
    if (!_janelaAtiva) {
      return {
        'janelaDias': <int>[],
        'janelaInicio': null,
        'janelaFim': null,
        'pausaSegundos': 0,
        'maxPorDia': null,
        'maxPorSemana': null,
        'maxPorMes': null,
      };
    }
    final completa = _inicio != null && _fim != null;
    return {
      'janelaDias': _dias.toList()..sort(),
      'janelaInicio': completa ? _hhmm(_inicio!) : null,
      'janelaFim': completa ? _hhmm(_fim!) : null,
      'pausaSegundos': _n(_pausa) ?? 0,
      'maxPorDia': _n(_maxDia),
      'maxPorSemana': _n(_maxSemana),
      'maxPorMes': _n(_maxMes),
    };
  }

  // ------------------------------------------------------------------ salvar

  void _falhar(String mensagem) {
    setState(() => _erro = mensagem);
    if (_rolagem.hasClients) {
      if (MediaQuery.of(context).disableAnimations) {
        _rolagem.jumpTo(0);
      } else {
        _rolagem.animateTo(
          0,
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeOut,
        );
      }
    }
  }

  Future<void> _salvar({
    required ModeloNaMeta? modelo,
    required _Quem quem,
    required String? listaId,
    required PreviaDoPublico? previa,
    required bool comCashback,
    required bool ehDono,
  }) async {
    FocusScope.of(context).unfocus();
    setState(() => _erro = null);
    final servico = ref.read(servicoCampanhasProvider);

    if (modelo == null && _podeTrocarConteudo) {
      return _falhar('Escolha um modelo aprovado.');
    }

    final problemaJanela = _problemaDaJanela();
    if (_editando && !_podeTrocarConteudo) {
      // Campanha que já saiu: só nome, janela, ritmo e limites.
      if (problemaJanela != null) return _falhar(problemaJanela);
      setState(() => _salvando = true);
      try {
        await servico.editar(_c!.id, {
          'nome': _nome.text.trim(),
          ..._janelaDaEdicao(),
        });
        _mexeu = false;
        if (mounted) Navigator.of(context).pop(true);
      } catch (e) {
        if (mounted) _falhar(mensagemDoErro(e));
      } finally {
        if (mounted) setState(() => _salvando = false);
      }
      return;
    }

    final nVars = modelo!.variaveis;
    final alcance = previa?.total;
    final numeros = _numerosDigitados;
    switch (quem) {
      case _Quem.lista:
        if (listaId == null) {
          return _falhar('Escolha a lista de contatos que vai receber.');
        }
        if (alcance == 0) {
          return _falhar(
            comCashback
                ? 'Ninguém desta lista tem cashback válido agora. Troque a lista ou tire a variável de cashback.'
                : 'Essa lista não tem ninguém que possa receber: está vazia ou todos pediram para sair.',
          );
        }
      case _Quem.base:
        if (_daBase == null) {
          return _falhar(
            'Escolha de onde sai o público: toda a base, uma importação, um perfil ou um público pronto.',
          );
        }
        if (alcance == 0) {
          return _falhar(
            comCashback
                ? 'Ninguém deste público tem cashback válido agora. Troque o público ou tire a variável de cashback.'
                : 'Esse público não tem ninguém que possa receber agora.',
          );
        }
      case _Quem.numeros:
        if (numeros.isEmpty) return _falhar('Informe ao menos um número.');
        if (numeros.length > tetoDestinatarios) {
          return _falhar(
            'Digitando, cada campanha aceita até $tetoDestinatarios números. Para mais, importe em Contatos e escolha a lista.',
          );
        }
    }
    for (var i = 0; i < nVars; i++) {
      final origem = quem != _Quem.numeros ? _origens[i] : 'fixo';
      // O saldo sai sempre do contato: não tem texto reserva.
      if (origem == 'cashback_saldo') continue;
      if (_valores[i].text.trim().isEmpty) {
        return _falhar(
          origem == 'cashback_validade'
              ? 'Preencha o que usar em {{${i + 1}}} quando o cashback não tiver data para vencer.'
              : origem != 'fixo'
              ? 'Preencha o que usar em {{${i + 1}}} quando o contato não tiver nome.'
              : 'Preencha o valor de {{${i + 1}}}.',
        );
      }
    }
    final naoSabeMandar = modelo.exige?.semSuporte ?? const <String>[];
    if (naoSabeMandar.isNotEmpty) {
      return _falhar(
        'Este modelo ainda não pode ser disparado por aqui: ${naoSabeMandar.join('; ')}.',
      );
    }
    final temTitulo = modelo.exige?.tituloComVariavel ?? false;
    // Número digitado não tem contato de onde tirar o nome: só texto fixo.
    final origemDoTitulo = quem == _Quem.numeros ? 'fixo' : _tituloOrigem;
    if (temTitulo && _titulo.text.trim().isEmpty) {
      return _falhar(
        origemDoTitulo == 'fixo'
            ? 'Preencha a variável do título do modelo.'
            : 'Preencha o que usar no título quando o contato não tiver nome.',
      );
    }
    if (problemaJanela != null) return _falhar(problemaJanela);

    final corpo = <String, Object?>{
      ..._janelaParaEnvio(),
      'nome': _nome.text.trim(),
      'modeloNome': modelo.nome,
      'modeloIdioma': modelo.idioma,
      'modeloId': modelo.id,
      'modeloCategoria': modelo.categoria,
      if (temTitulo)
        'variavelCabecalho': {
          'origem': origemDoTitulo,
          'valor': _titulo.text.trim(),
        },
      if (!_editando && ehDono && _ignorarDescanso) 'ignorarDescanso': true,
      if (quem != _Quem.numeros) ...{
        if (quem == _Quem.lista)
          'listaId': listaId
        else
          'daBase': _daBase!.paraJson(),
        'variaveisLista': [
          for (var i = 0; i < nVars; i++)
            {'origem': _origens[i], 'valor': _valores[i].text.trim()},
        ],
      } else
        'destinatarios': [
          for (final telefone in numeros)
            {
              'telefone': telefone,
              'variaveis': [
                for (var i = 0; i < nVars; i++) _valores[i].text.trim(),
              ],
            },
        ],
    };

    setState(() => _salvando = true);
    try {
      if (_editando) {
        await servico.editar(_c!.id, {...corpo, ..._janelaDaEdicao()});
        _mexeu = false;
        if (mounted) Navigator.of(context).pop(true);
        return;
      }
      final id = await servico.criar(corpo);
      _mexeu = false;
      if (!mounted) return;
      // Leva direto para a campanha: é lá que se confere e se dispara.
      await Navigator.of(context).pushReplacement(
        MaterialPageRoute(
          builder: (_) =>
              TelaCampanhaDetalhe(id: id, nomeInicial: _nome.text.trim()),
        ),
      );
    } catch (e) {
      if (mounted) _falhar(mensagemDoErro(e));
    } finally {
      if (mounted) setState(() => _salvando = false);
    }
  }

  Future<void> _tentarSair() async {
    final sair = await confirmar(
      context,
      titulo: 'Sair sem salvar?',
      texto: 'O que você preencheu aqui se perde.',
      botao: 'Sair',
      perigo: true,
    );
    if (!sair || !mounted) return;
    setState(() => _saindo = true);
    Navigator.of(context).pop();
  }

  // -------------------------------------------------------------------- tela

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    // Campanha já disparada só troca nome e janela: nada disso é lido.
    final podeTrocar = _podeTrocarConteudo;
    final sessao = podeTrocar ? ref.watch(sessaoProvider) : null;
    final ehDono = sessao is SessaoAtiva && sessao.sessao.usuario.ehDono;

    final modelos = podeTrocar
        ? ref.watch(modelosNaMetaProvider)
        : const AsyncValue<List<ModeloNaMeta>>.data([]);
    final listas = podeTrocar
        ? ref.watch(listasContatosProvider)
        : const AsyncValue<List<ListaContatos>>.data([]);
    final cashbackNaConta = podeTrocar
        ? (ref.watch(cashbackNaContaProvider).value ?? false)
        : false;

    final aprovados = [
      for (final m in modelos.value ?? const <ModeloNaMeta>[])
        if (m.status == 'aprovado') m,
    ];
    ModeloNaMeta? modelo;
    for (final m in aprovados) {
      if (m.id == _modeloId) modelo = m;
    }
    _ajustarVariaveis(modelo?.variaveis ?? 0);

    final quem = _quem(listas);
    final listaId = _listaId(listas.value);
    final nVars = modelo?.variaveis ?? 0;
    final comCashback =
        quem != _Quem.numeros && _origens.take(nVars).any(_deCashback);
    final alvo = quem == _Quem.lista && listaId != null
        ? PublicoDaCampanha(origem: 'lista', origemId: listaId)
        : quem == _Quem.base
        ? _daBase
        : null;
    final previa = alvo == null
        ? null
        : ref.watch(previaDoPublicoProvider((alvo, comCashback))).value;

    return PopScope(
      canPop: _saindo || !_mexeu,
      onPopInvokedWithResult: (saiu, _) {
        if (!saiu) _tentarSair();
      },
      child: Scaffold(
        appBar: AppBar(
          title: Text(_editando ? 'Editar campanha' : 'Montar campanha'),
        ),
        body: ListView(
          controller: _rolagem,
          padding: respiroDaTela(context),
          children: [
            Text(
              _editando && !_podeTrocarConteudo
                  ? 'Esta campanha já foi disparada: dá para ajustar o nome, a janela, o ritmo e os limites.'
                  : 'Modelo, público e janela de envio. Nada sai antes de você disparar.',
              style: TextStyle(color: c.tintaSuave, height: 1.45),
            ),
            const SizedBox(height: 14),
            if (_erro != null) ...[
              Aviso(
                tom: TomPilula.erro,
                icone: Icons.error_outline_rounded,
                texto: _erro!,
              ),
              const SizedBox(height: 14),
            ],
            TextField(
              key: const ValueKey('c-nome'),
              controller: _nome,
              textCapitalization: TextCapitalization.sentences,
              maxLength: 120,
              decoration: const InputDecoration(
                labelText: 'Nome da campanha',
                hintText: 'Promoção de sexta',
              ),
            ),
            if (_podeTrocarConteudo) ...[
              const SizedBox(height: 6),
              ..._secaoDoModelo(
                c,
                modelos,
                aprovados,
                modelo,
                quem,
                cashbackNaConta,
              ),
              const SizedBox(height: 22),
              ..._secaoQuemRecebe(
                c,
                listas: listas,
                quem: quem,
                listaId: listaId,
                previa: previa,
                modelo: modelo,
                ehDono: ehDono,
                alvo: alvo,
              ),
            ],
            const SizedBox(height: 22),
            _janela(c),
          ],
        ),
        bottomNavigationBar: SafeArea(
          top: false,
          child: Container(
            padding: const EdgeInsets.fromLTRB(20, 10, 20, 10),
            decoration: BoxDecoration(
              color: c.superficie,
              border: Border(top: BorderSide(color: c.borda)),
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                FilledButton(
                  key: const ValueKey('c-salvar'),
                  onPressed: _salvando
                      ? null
                      : () => _salvar(
                          modelo: modelo,
                          quem: quem,
                          listaId: listaId,
                          previa: previa,
                          comCashback: comCashback,
                          ehDono: ehDono,
                        ),
                  child: _salvando
                      ? SizedBox.square(
                          dimension: 22,
                          child: CircularProgressIndicator(
                            strokeWidth: 2.5,
                            color: c.acentoContraste,
                          ),
                        )
                      : Text(
                          _editando ? 'Salvar alterações' : 'Montar campanha',
                        ),
                ),
                if (!_editando)
                  Padding(
                    padding: const EdgeInsets.only(top: 6),
                    child: Text(
                      'Montar não envia nada. Você confere a campanha e dispara na tela seguinte.',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: c.tintaSuave, fontSize: 12.5),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  // ------------------------------------------------------------------ modelo

  List<Widget> _secaoDoModelo(
    Cores c,
    AsyncValue<List<ModeloNaMeta>> modelos,
    List<ModeloNaMeta> aprovados,
    ModeloNaMeta? modelo,
    _Quem quem,
    bool cashbackNaConta,
  ) {
    if (modelos.hasError && modelos.value == null) {
      return [
        Aviso(
          tom: TomPilula.erro,
          icone: Icons.error_outline_rounded,
          texto: mensagemDoErro(modelos.error!),
          acao: TextButton(
            onPressed: () => ref.invalidate(modelosNaMetaProvider),
            child: const Text('Tentar de novo'),
          ),
        ),
      ];
    }
    if (modelos.isLoading && modelos.value == null) {
      return [
        Row(
          children: [
            const SizedBox.square(
              dimension: 18,
              child: CircularProgressIndicator(strokeWidth: 2),
            ),
            const SizedBox(width: 10),
            Text(
              'Carregando seus modelos…',
              style: TextStyle(color: c.tintaSuave),
            ),
          ],
        ),
      ];
    }
    if (aprovados.isEmpty) {
      return [
        Cartao(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Nenhum modelo aprovado',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
              ),
              const SizedBox(height: 6),
              Text(
                'Só modelo aprovado pela Meta pode iniciar conversa. Assim que o primeiro for aprovado, ele aparece aqui.',
                style: TextStyle(color: c.tintaSuave, height: 1.45),
              ),
              const SizedBox(height: 12),
              OutlinedButton.icon(
                style: OutlinedButton.styleFrom(minimumSize: const Size(0, 42)),
                onPressed: () async {
                  await Navigator.of(context).push(
                    MaterialPageRoute(builder: (_) => const TelaEditorModelo()),
                  );
                  ref.invalidate(modelosNaMetaProvider);
                },
                icon: const Icon(Icons.add_rounded),
                label: const Text('Criar um modelo'),
              ),
            ],
          ),
        ),
      ];
    }

    final categoria = nomeDaCategoria(modelo?.categoria);
    return [
      CampoDeEscolha<String>(
        key: const ValueKey('c-modelo'),
        rotulo: 'Modelo',
        valor: _modeloId,
        grupos: [
          GrupoDeEscolha(null, [
            for (final m in aprovados)
              OpcaoDeEscolha(
                valor: m.id,
                texto:
                    '${m.nome} — ${nomeDaCategoria(m.categoria) ?? 'sem categoria'}',
              ),
          ]),
        ],
        aoEscolher: (id) {
          // O título de um modelo não é o do outro (limpar avisa o ouvinte,
          // então fica fora do `setState`).
          _titulo.clear();
          setState(() {
            _modeloId = id;
            // Trocar o modelo zera as variáveis: o {{1}} de um não é o do outro.
            for (final v in _valores) {
              v.dispose();
            }
            _valores.clear();
            _origens.clear();
            _tituloOrigem = 'fixo';
            _mexeu = true;
            _erro = null;
          });
        },
      ),
      if (modelo != null) ...[
        if (categoria != null) ...[
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 6,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Pilula(categoria, tom: tomDaCategoria(modelo.categoria)),
              if (explicacaoDaCategoria(modelo.categoria) != null)
                Text(
                  explicacaoDaCategoria(modelo.categoria)!,
                  style: TextStyle(
                    color: c.tintaSuave,
                    fontSize: 12.5,
                    height: 1.4,
                  ),
                ),
            ],
          ),
        ],
        if (modelo.exige?.semSuporte.isNotEmpty ?? false) ...[
          const SizedBox(height: 12),
          Aviso(
            key: const ValueKey('c-sem-suporte'),
            icone: Icons.block_rounded,
            texto:
                'Este modelo ainda não pode ser disparado por aqui: ${modelo.exige!.semSuporte.join('; ')}. Escolha outro modelo.',
          ),
        ],
        const SizedBox(height: 12),
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: c.superficie2,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: c.borda),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if ((modelo.cabecalho ?? '').isNotEmpty &&
                  !(modelo.exige?.cabecalhoDeMidia ?? false)) ...[
                Text(
                  modelo.cabecalho!,
                  style: const TextStyle(
                    fontWeight: FontWeight.w600,
                    height: 1.45,
                  ),
                ),
                const SizedBox(height: 6),
              ],
              Text(modelo.corpo, style: const TextStyle(height: 1.45)),
              for (final linha in oQueVaiDoModelo(modelo))
                Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: Text(
                    linha,
                    style: TextStyle(
                      color: c.tintaSuave,
                      fontSize: 12.5,
                      height: 1.4,
                    ),
                  ),
                ),
              if (modelo.exige?.tituloComVariavel ?? false) ...[
                const SizedBox(height: 12),
                _variavelDoTitulo(c, quem),
              ],
              for (var i = 0; i < modelo.variaveis; i++) ...[
                const SizedBox(height: 12),
                _variavel(c, i, quem, cashbackNaConta),
              ],
            ],
          ),
        ),
      ],
    ];
  }

  /// A variável do título (cabeçalho de texto) do modelo. Sai de um texto
  /// igual para todos ou do nome do contato — nunca do cashback.
  Widget _variavelDoTitulo(Cores c, _Quem quem) {
    final origem = quem != _Quem.numeros ? _tituloOrigem : 'fixo';
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: c.superficie,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: c.borda),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text(
            'Variável do título',
            style: TextStyle(fontWeight: FontWeight.w600),
          ),
          if (quem != _Quem.numeros) ...[
            const SizedBox(height: 8),
            DropdownButtonFormField<String>(
              key: ValueKey('c-titulo-origem-$_modeloId'),
              initialValue: origem,
              isExpanded: true,
              dropdownColor: c.superficie,
              decoration: const InputDecoration(
                labelText: 'De onde vem a variável do título',
              ),
              items: [
                for (final o in _origensDoTitulo)
                  DropdownMenuItem(value: o, child: Text(_rotuloOrigem[o]!)),
              ],
              onChanged: (v) {
                if (v == null) return;
                setState(() {
                  _tituloOrigem = v;
                  _mexeu = true;
                  _erro = null;
                });
              },
            ),
          ],
          const SizedBox(height: 8),
          TextField(
            key: ValueKey('c-titulo-$_modeloId'),
            controller: _titulo,
            maxLength: _limiteDoTitulo,
            decoration: InputDecoration(
              labelText: origem == 'fixo' ? 'Texto' : 'Se não tiver',
              hintText: _ajudaDaOrigem(origem).dica,
            ),
          ),
          Text(
            origem != 'fixo'
                ? 'Usado quando o contato não tem nome cadastrado. Até $_limiteDoTitulo caracteres.'
                : 'Entra no lugar da variável do título do modelo. Até $_limiteDoTitulo caracteres.',
            style: TextStyle(color: c.tintaSuave, fontSize: 12.5),
          ),
        ],
      ),
    );
  }

  Widget _variavel(Cores c, int i, _Quem quem, bool cashbackNaConta) {
    final origem = quem != _Quem.numeros ? _origens[i] : 'fixo';
    final ajuda = _ajudaDaOrigem(origem);
    // As de cashback só em conta com saldo lido (ou já escolhidas).
    final opcoes = [
      for (final o in _rotuloOrigem.keys)
        if (!_deCashback(o) || cashbackNaConta || o == origem) o,
    ];
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: c.superficie,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: c.borda),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Variável {{${i + 1}}}',
            style: const TextStyle(fontWeight: FontWeight.w600),
          ),
          if (quem != _Quem.numeros) ...[
            const SizedBox(height: 8),
            DropdownButtonFormField<String>(
              key: ValueKey('c-origem-$_modeloId-$i'),
              initialValue: origem,
              isExpanded: true,
              dropdownColor: c.superficie,
              decoration: InputDecoration(
                labelText: 'De onde vem {{${i + 1}}}',
              ),
              items: [
                for (final o in opcoes)
                  DropdownMenuItem(value: o, child: Text(_rotuloOrigem[o]!)),
              ],
              onChanged: (v) {
                if (v == null) return;
                setState(() {
                  _origens[i] = v;
                  _mexeu = true;
                  _erro = null;
                });
              },
            ),
          ],
          if (origem != 'cashback_saldo') ...[
            const SizedBox(height: 8),
            TextField(
              key: ValueKey('c-var-$_modeloId-$i'),
              controller: _valores[i],
              decoration: InputDecoration(
                labelText: origem == 'fixo' ? 'Texto' : 'Se não tiver',
                hintText: ajuda.dica,
              ),
            ),
          ],
          if (ajuda.ajuda != null) ...[
            const SizedBox(height: 6),
            Text(
              ajuda.ajuda!,
              style: TextStyle(color: c.tintaSuave, fontSize: 12.5),
            ),
          ],
        ],
      ),
    );
  }

  // ------------------------------------------------------------ quem recebe

  List<Widget> _secaoQuemRecebe(
    Cores c, {
    required AsyncValue<List<ListaContatos>> listas,
    required _Quem quem,
    required String? listaId,
    required PreviaDoPublico? previa,
    required ModeloNaMeta? modelo,
    required bool ehDono,
    required PublicoDaCampanha? alvo,
  }) {
    final todas = listas.value ?? const <ListaContatos>[];
    final semListas = listas.hasValue && todas.isEmpty;
    // Descanso: vale para campanha NOVA de marketing. A prévia usa a mesma
    // regra do envio, que confere de novo na hora de mandar.
    final descanso = !_editando && ehMarketing(modelo?.categoria)
        ? previa
        : null;

    return [
      Text('Quem recebe', style: Theme.of(context).textTheme.titleMedium),
      const SizedBox(height: 10),
      Wrap(
        spacing: 8,
        runSpacing: 8,
        children: [
          for (final (q, rotulo) in [
            (_Quem.lista, 'Uma lista de contatos'),
            (_Quem.base, 'Da base'),
            (_Quem.numeros, 'Digitar números'),
          ])
            _Pilula(
              key: ValueKey('quem-${q.name}'),
              rotulo: rotulo,
              ativo: quem == q,
              habilitado: !(q == _Quem.lista && semListas),
              aoTocar: () => setState(() {
                _quemEscolhido = q;
                _mexeu = true;
                _erro = null;
              }),
            ),
        ],
      ),
      const SizedBox(height: 14),
      if (quem == _Quem.lista) ..._lista(c, listas, listaId, previa),
      if (quem == _Quem.base) ..._daBaseWidgets(c, previa),
      if (quem == _Quem.numeros) ...[
        TextField(
          key: const ValueKey('c-numeros'),
          controller: _numeros,
          minLines: 3,
          maxLines: 8,
          keyboardType: TextInputType.multiline,
          decoration: const InputDecoration(
            labelText: 'Números',
            hintText: '5521999998888, 5511988887777',
            alignLabelWithHint: true,
          ),
        ),
        const SizedBox(height: 6),
        Text(
          'País + DDD + número, separados por vírgula ou quebra de linha. Reconhecidos até agora: ${f.numero(_numerosDigitados.length)} de $tetoDestinatarios.',
          style: TextStyle(color: c.tintaSuave, fontSize: 12.5, height: 1.4),
        ),
      ],
      if (quem != _Quem.numeros &&
          descanso != null &&
          descanso.descansoDias > 0 &&
          descanso.emDescanso > 0) ...[
        const SizedBox(height: 14),
        _descanso(c, descanso, ehDono),
      ],
      if (quem != _Quem.numeros && !_editando && alvo != null)
        _SugestaoDeHorario(
          dados: previa?.horario,
          aplicada: (inicio, fim) =>
              _janelaAtiva &&
              _inicio != null &&
              _fim != null &&
              _hhmm(_inicio!) == inicio &&
              _hhmm(_fim!) == fim,
          aoUsar: (inicio, fim) => setState(() {
            _janelaAtiva = true;
            _inicio = _lerHora(inicio);
            _fim = _lerHora(fim);
            _mexeu = true;
          }),
        ),
    ];
  }

  List<Widget> _lista(
    Cores c,
    AsyncValue<List<ListaContatos>> listas,
    String? listaId,
    PreviaDoPublico? previa,
  ) {
    final todas = listas.value ?? const <ListaContatos>[];
    final comuns = [
      for (final l in todas)
        if (!l.ehBloco) l,
    ];
    // Cada divisão com os blocos em ordem, na ordem em que a API manda.
    final grupos = <String, List<ListaContatos>>{};
    final nomes = <String, String>{};
    for (final l in todas) {
      if (!l.ehBloco) continue;
      grupos.putIfAbsent(l.divisaoId!, () => []).add(l);
      nomes[l.divisaoId!] = l.divisaoNome ?? 'Blocos';
    }
    for (final g in grupos.values) {
      g.sort((a, b) => (a.bloco ?? 0).compareTo(b.bloco ?? 0));
    }
    ListaContatos? escolhida;
    for (final l in todas) {
      if (l.id == listaId) escolhida = l;
    }
    // O próximo bloco ainda não enviado: da divisão do escolhido, ou da
    // primeira divisão.
    final grupoDoProximo = escolhida?.divisaoId != null
        ? grupos[escolhida!.divisaoId]
        : (grupos.values.isEmpty ? null : grupos.values.first);
    ListaContatos? proximo;
    for (final b in grupoDoProximo ?? const <ListaContatos>[]) {
      if (b.usadaEm == null && b.total > 0 && b.id != listaId) {
        proximo = b;
        break;
      }
    }

    return [
      CampoDeEscolha<String>(
        key: const ValueKey('c-lista'),
        rotulo: 'Lista',
        valor: listaId,
        carregando: listas.isLoading && !listas.hasValue,
        grupos: [
          if (comuns.isNotEmpty)
            GrupoDeEscolha('Listas', [
              for (final l in comuns)
                OpcaoDeEscolha(
                  valor: l.id,
                  texto: '${l.nome} · ${_contagem(l.total)}',
                ),
            ]),
          for (final e in grupos.entries)
            GrupoDeEscolha('Blocos — ${nomes[e.key]}', [
              for (final l in e.value)
                OpcaoDeEscolha(valor: l.id, texto: _rotuloDoBloco(l)),
            ]),
        ],
        aoEscolher: (id) => setState(() {
          _listaEscolhida = id;
          _mexeu = true;
          _erro = null;
        }),
      ),
      if (escolhida != null &&
          escolhida.ehBloco &&
          escolhida.usadaEm != null) ...[
        const SizedBox(height: 8),
        Aviso(
          icone: Icons.replay_rounded,
          texto:
              'Este bloco já foi enviado em ${f.data(escolhida.usadaEm)} — mandar de novo repete as mesmas pessoas.',
        ),
      ],
      if (proximo != null)
        Align(
          alignment: Alignment.centerLeft,
          child: TextButton(
            key: const ValueKey('c-proximo-bloco'),
            onPressed: () => setState(() {
              _listaEscolhida = proximo!.id;
              _mexeu = true;
            }),
            child: Text(
              'Usar o próximo bloco ainda não enviado (${_rotuloDoBloco(proximo).split(' · ').first} de ${proximo.blocos})',
            ),
          ),
        ),
      const SizedBox(height: 6),
      if (listaId != null && previa != null)
        _Alcance(
          previa: previa,
          fim: '. Quem pediu para sair fica de fora automaticamente.',
        )
      else
        Wrap(
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            Text(
              'Os contatos importados sem lista (planilhas, Cardápio Web) estão em ',
              style: TextStyle(color: c.tintaSuave, fontSize: 12.5),
            ),
            InkWell(
              onTap: () => setState(() => _quemEscolhido = _Quem.base),
              child: Text(
                'Da base',
                style: TextStyle(
                  color: c.tinta,
                  fontSize: 12.5,
                  fontWeight: FontWeight.w600,
                  decoration: TextDecoration.underline,
                ),
              ),
            ),
            Text(
              '. As listas nascem em Contatos.',
              style: TextStyle(color: c.tintaSuave, fontSize: 12.5),
            ),
          ],
        ),
    ];
  }

  List<Widget> _daBaseWidgets(Cores c, PreviaDoPublico? previa) {
    final tipo = _tipoDaBase;
    List<GrupoDeEscolha<String>>? opcoes;
    Object? erro;
    if (tipo == 'importacao') {
      final carga = ref.watch(importacoesProvider);
      erro = carga.error;
      final lista = carga.value;
      if (lista != null) {
        final comGente = [
          for (final i in lista)
            if (i.total > 0) i,
        ];
        opcoes = [
          if (comGente.isNotEmpty)
            GrupoDeEscolha('Importações', [
              for (final i in comGente)
                OpcaoDeEscolha(
                  valor: i.id,
                  texto:
                      '${i.nome} · ${f.data(i.criadoEm)} · ${_contagem(i.total)}',
                ),
            ]),
        ];
      }
    } else if (tipo == 'perfil') {
      final carga = ref.watch(segmentosProvider);
      erro = carga.error;
      final lista = carga.value;
      if (lista != null) {
        final comGente = [
          for (final s in lista)
            if (s.total > 0) s,
        ];
        opcoes = [
          if (comGente.isNotEmpty)
            GrupoDeEscolha('Perfis', [
              for (final s in comGente)
                OpcaoDeEscolha(
                  valor: s.id,
                  texto: '${s.nome} · ${_contagem(s.total)}',
                ),
            ]),
        ];
      }
    } else if (tipo == 'publico') {
      final publicos = ref.watch(publicosProntosProvider);
      final produtos = ref.watch(produtosDaBaseProvider);
      erro = publicos.error ?? produtos.error;
      final r = publicos.value;
      final p = produtos.value;
      if (r != null && p != null) {
        final porId = {
          for (final x in r.publicos)
            if (x.total > 0 && (x.id != 'conversaram_7d' || r.conversasLigadas))
              x.id: x,
        };
        String chave(String publico, [String? valor]) =>
            '$publico|${valor ?? ''}';
        opcoes = [
          for (final g in gruposDePublicos)
            GrupoDeEscolha(g.titulo, [
              for (final id in g.ids)
                if (porId[id] != null)
                  OpcaoDeEscolha(
                    valor: chave(id),
                    texto:
                        '${porId[id]!.nome} · ${_contagem(porId[id]!.total)}',
                  ),
            ]),
          GrupoDeEscolha('Já compraram', [
            for (final x in p)
              if (x.total > 0)
                OpcaoDeEscolha(
                  valor: chave('produto', x.nome),
                  texto: '${x.nome} · ${_contagem(x.total)}',
                ),
          ]),
          GrupoDeEscolha('Bairros', [
            for (final b in r.bairros)
              OpcaoDeEscolha(
                valor: chave('bairro', b.bairro),
                texto: '${b.bairro} · ${_contagem(b.total)}',
              ),
          ]),
          GrupoDeEscolha('Aniversariantes', [
            for (final a in r.aniversarios)
              if (a.total > 0)
                OpcaoDeEscolha(
                  valor: chave('aniversario', '${a.mes}'),
                  texto:
                      '${a.mes >= 1 && a.mes <= 12 ? nomesDosMeses[a.mes - 1] : a.mes}${a.mes == r.mesAtual ? ' (este mês)' : ''} · ${_contagem(a.total)}',
                ),
          ]),
        ].where((g) => g.opcoes.isNotEmpty).toList();
      }
    }

    final valorDoSegundo = switch (_daBase) {
      null => null,
      final d when d.origem != tipo => null,
      final d when d.origem == 'importacao' => d.origemId,
      final d when d.origem == 'perfil' => d.segmento,
      final d => '${d.publico}|${d.publicoValor ?? ''}',
    };

    return [
      CampoDeEscolha<String>(
        key: const ValueKey('c-de-onde'),
        rotulo: 'De onde',
        valor: tipo,
        grupos: [
          GrupoDeEscolha(null, [
            for (final e in _tiposDaBase.entries)
              OpcaoDeEscolha(valor: e.key, texto: e.value),
          ]),
        ],
        aoEscolher: (t) => setState(() {
          _tipoDaBase = t;
          _daBase = t == 'base'
              ? const PublicoDaCampanha(origem: 'base')
              : null;
          _mexeu = true;
          _erro = null;
        }),
      ),
      if (tipo != null && tipo != 'base') ...[
        const SizedBox(height: 12),
        CampoDeEscolha<String>(
          key: const ValueKey('c-qual'),
          rotulo: 'Qual',
          valor: valorDoSegundo,
          carregando: opcoes == null && erro == null,
          habilitado: opcoes != null && opcoes.isNotEmpty,
          grupos: opcoes ?? const [],
          aoEscolher: (v) => setState(() {
            _daBase = switch (tipo) {
              'importacao' => PublicoDaCampanha(
                origem: 'importacao',
                origemId: v,
              ),
              'perfil' => PublicoDaCampanha(origem: 'perfil', segmento: v),
              _ => PublicoDaCampanha(
                origem: 'publico',
                publico: v.split('|').first,
                publicoValor: v.split('|').skip(1).join('|').isEmpty
                    ? null
                    : v.split('|').skip(1).join('|'),
              ),
            };
            _mexeu = true;
            _erro = null;
          }),
        ),
        if (erro != null) ...[
          const SizedBox(height: 8),
          Aviso(
            tom: TomPilula.erro,
            icone: Icons.error_outline_rounded,
            texto: mensagemDoErro(erro),
          ),
        ] else if (opcoes != null && opcoes.isEmpty) ...[
          const SizedBox(height: 8),
          Text(
            _vazioDaBase[tipo]!,
            style: TextStyle(color: c.tintaSuave, fontSize: 12.5),
          ),
        ],
      ],
      const SizedBox(height: 8),
      if (_daBase != null && previa != null)
        _Alcance(
          previa: previa,
          fim:
              '. O público é copiado ao montar a campanha: quem entrar na base depois não recebe esta.',
        )
      else
        Text(
          'Toda a base, uma importação (os contatos importados sem lista estão aqui), um perfil ou um público pronto. Quem pediu para sair fica de fora automaticamente.',
          style: TextStyle(color: c.tintaSuave, fontSize: 12.5, height: 1.4),
        ),
    ];
  }

  Widget _descanso(Cores c, PreviaDoPublico previa, bool ehDono) {
    final n = previa.emDescanso;
    final dias = previa.descansoDias;
    return Material(
      color: c.superficie2,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: BorderSide(color: c.borda),
      ),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '${f.numero(n)} ${n == 1 ? 'pessoa deste público recebeu' : 'pessoas deste público receberam'} campanha de marketing nos últimos $dias ${dias == 1 ? 'dia' : 'dias'} e ${n == 1 ? 'fica' : 'ficam'} de fora — é o descanso entre campanhas. Não conta no plano. O prazo se ajusta em Conta.',
              style: const TextStyle(fontSize: 13.5, height: 1.45),
            ),
            if (ehDono) ...[
              const SizedBox(height: 6),
              CheckboxListTile(
                key: const ValueKey('c-ignorar-descanso'),
                value: _ignorarDescanso,
                contentPadding: EdgeInsets.zero,
                controlAffinity: ListTileControlAffinity.leading,
                onChanged: (v) => setState(() {
                  _ignorarDescanso = v ?? false;
                  _mexeu = true;
                }),
                title: Text(
                  'Enviar mesmo para quem está em descanso (só nesta campanha). Mensagem demais faz a Meta segurar o marketing dessa pessoa e derruba a qualidade do número.',
                  style: TextStyle(fontSize: 13, color: c.tinta, height: 1.4),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  // ------------------------------------------------------------------ janela

  Widget _janela(Cores c) {
    const nomesDias = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    final problema = _problemaDaJanela();
    // Material, e não caixa colorida: o toque do interruptor aparece.
    return Material(
      color: _janelaAtiva
          ? c.acentoSuave.withValues(alpha: 0.3)
          : Colors.transparent,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(18),
        side: BorderSide(color: _janelaAtiva ? c.acento : c.borda),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SwitchListTile(
            key: const ValueKey('c-janela'),
            value: _janelaAtiva,
            onChanged: (v) => setState(() {
              _janelaAtiva = v;
              _mexeu = true;
              _erro = null;
            }),
            activeThumbColor: c.acentoContraste,
            activeTrackColor: c.acento,
            title: const Text(
              'Agendar e controlar o ritmo',
              style: TextStyle(fontWeight: FontWeight.w600),
            ),
            subtitle: Text(
              'Sem isto, a campanha começa a sair assim que você disparar.',
              style: TextStyle(color: c.tintaSuave, fontSize: 13),
            ),
          ),
          if (_janelaAtiva)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'DIAS E HORÁRIO',
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                      letterSpacing: 0.6,
                      color: c.tintaSuave,
                    ),
                  ),
                  const SizedBox(height: 10),
                  Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: [
                      for (var d = 0; d < 7; d++)
                        _Pilula(
                          key: ValueKey('c-dia-$d'),
                          rotulo: nomesDias[d],
                          ativo: _dias.contains(d),
                          aoTocar: () => setState(() {
                            _dias.contains(d) ? _dias.remove(d) : _dias.add(d);
                            _mexeu = true;
                          }),
                        ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(
                        child: _CampoHora(
                          key: const ValueKey('c-inicio'),
                          rotulo: 'Das',
                          valor: _inicio,
                          aoTocar: () => _escolherHora(true),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: _CampoHora(
                          key: const ValueKey('c-fim'),
                          rotulo: 'Até',
                          valor: _fim,
                          aoTocar: () => _escolherHora(false),
                        ),
                      ),
                    ],
                  ),
                  if (_inicio != null || _fim != null)
                    TextButton(
                      onPressed: () => setState(() {
                        _inicio = null;
                        _fim = null;
                        _mexeu = true;
                      }),
                      child: const Text('Sem horário (qualquer hora)'),
                    ),
                  const SizedBox(height: 6),
                  Text(
                    'Nenhum dia marcado = qualquer dia. Horário vazio = qualquer hora. Aceita janela que passa da meia-noite, como das 22h às 2h. O horário é o do fuso da sua conta.',
                    style: TextStyle(
                      color: c.tintaSuave,
                      fontSize: 12.5,
                      height: 1.4,
                    ),
                  ),
                  const SizedBox(height: 18),
                  Text(
                    'RITMO',
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                      letterSpacing: 0.6,
                      color: c.tintaSuave,
                    ),
                  ),
                  const SizedBox(height: 10),
                  _CampoNumero(
                    key: const ValueKey('c-pausa'),
                    controller: _pausa,
                    rotulo: 'Pausa entre mensagens',
                    sufixo: 'segundos',
                    dica: '0',
                  ),
                  const SizedBox(height: 10),
                  _CampoNumero(
                    key: const ValueKey('c-max-dia'),
                    controller: _maxDia,
                    rotulo: 'Máx. por dia',
                    sufixo: 'mensagens',
                  ),
                  const SizedBox(height: 10),
                  _CampoNumero(
                    key: const ValueKey('c-max-semana'),
                    controller: _maxSemana,
                    rotulo: 'Máx. por semana',
                    sufixo: 'mensagens',
                  ),
                  const SizedBox(height: 10),
                  _CampoNumero(
                    key: const ValueKey('c-max-mes'),
                    controller: _maxMes,
                    rotulo: 'Máx. por mês',
                    sufixo: 'mensagens',
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'A pausa espaça as mensagens: mil envios em dois minutos parecem robô para os sistemas antifraude. O limite da Meta continua valendo por cima destes.',
                    style: TextStyle(
                      color: c.tintaSuave,
                      fontSize: 12.5,
                      height: 1.4,
                    ),
                  ),
                  if (problema != null) ...[
                    const SizedBox(height: 8),
                    Text(
                      problema,
                      style: TextStyle(color: c.erro, fontSize: 13),
                    ),
                  ],
                ],
              ),
            ),
        ],
      ),
    );
  }
}

// -------------------------------------------------------------------- peças

/// "N pessoas vão receber" — e, com variável de cashback, de quantos do público.
class _Alcance extends StatelessWidget {
  const _Alcance({required this.previa, required this.fim});

  final PreviaDoPublico previa;
  final String fim;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final n = previa.total;
    final cashback = previa.cashbackDoPublico;
    return Text.rich(
      TextSpan(
        children: [
          TextSpan(
            text: f.numero(n),
            style: TextStyle(fontWeight: FontWeight.w700, color: c.tinta),
          ),
          TextSpan(
            text: n == 1 ? ' pessoa vai receber' : ' pessoas vão receber',
          ),
          if (cashback != null)
            TextSpan(
              text:
                  ' — só quem tem cashback válido, de ${f.numero(cashback)} no público. Quem usar ou perder o saldo antes do envio não recebe',
            ),
          TextSpan(text: fim),
        ],
      ),
      key: const ValueKey('c-alcance'),
      style: TextStyle(color: c.tintaSuave, fontSize: 12.5, height: 1.4),
    );
  }
}

/// Em que período o público pede e a janela sugerida — a mensagem chega pouco
/// antes do pedido. Com pouca gente com compra, fica calada: uma porcentagem
/// de meia dúzia de pessoas engana mais do que ajuda.
class _SugestaoDeHorario extends StatelessWidget {
  const _SugestaoDeHorario({
    required this.dados,
    required this.aplicada,
    required this.aoUsar,
  });

  final SugestaoDeHorario? dados;
  final bool Function(String inicio, String fim) aplicada;
  final void Function(String inicio, String fim) aoUsar;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final d = dados;
    if (d == null || d.comHabito == 0) return const SizedBox.shrink();
    final s = d.sugestao;
    Widget caixa(List<Widget> filhos) => Container(
      margin: const EdgeInsets.only(top: 14),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: c.superficie2,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: c.borda),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: filhos,
      ),
    );
    if (s == null) {
      if (d.comHabito < d.minimo) return const SizedBox.shrink();
      final partes = d.periodos
          .take(3)
          .map(
            (p) =>
                '${nomeDoPeriodo(p.periodo)} ${(p.total * 100 ~/ d.comHabito)}%',
          )
          .join(', ');
      return caixa([
        Text(
          'Quem já comprou neste público pede em horários variados ($partes). Nenhum período se destaca para sugerir um horário de envio.',
          style: const TextStyle(fontSize: 13.5, height: 1.45),
        ),
      ]);
    }
    final faixa = 'das ${horaCurta(s.inicio)} às ${horaCurta(s.fim)}';
    return caixa([
      Text(
        '${s.percentual}% de quem já comprou neste público costuma pedir ${quandoPede(s.periodo)} (${f.numero(d.comHabito)} com compras de ${f.numero(d.total)}). Para a mensagem chegar antes do pedido, envie $faixa.',
        style: const TextStyle(fontSize: 13.5, height: 1.45),
      ),
      const SizedBox(height: 8),
      if (aplicada(s.inicio, s.fim))
        Text(
          'Horário aplicado na janela de envio abaixo.',
          style: TextStyle(fontWeight: FontWeight.w600, color: c.tinta),
        )
      else
        OutlinedButton(
          key: const ValueKey('c-usar-horario'),
          style: OutlinedButton.styleFrom(minimumSize: const Size(0, 40)),
          onPressed: () => aoUsar(s.inicio, s.fim),
          child: Text('Usar $faixa'),
        ),
    ]);
  }
}

/// Escolha em pílula: marcada = cor da marca.
class _Pilula extends StatelessWidget {
  const _Pilula({
    super.key,
    required this.rotulo,
    required this.ativo,
    required this.aoTocar,
    this.habilitado = true,
  });

  final String rotulo;
  final bool ativo;
  final bool habilitado;
  final VoidCallback aoTocar;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    return Semantics(
      button: true,
      toggled: ativo,
      enabled: habilitado,
      child: Opacity(
        opacity: habilitado ? 1 : 0.45,
        child: Material(
          color: ativo ? c.acento : c.superficie,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(99),
            side: BorderSide(color: ativo ? c.acento : c.borda),
          ),
          child: InkWell(
            customBorder: const StadiumBorder(),
            onTap: habilitado ? aoTocar : null,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
              child: Text(
                rotulo,
                style: TextStyle(
                  fontWeight: FontWeight.w600,
                  fontSize: 13.5,
                  color: ativo ? c.acentoContraste : c.tintaSuave,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Campo de hora que abre o relógio do Android — nunca digitação.
class _CampoHora extends StatelessWidget {
  const _CampoHora({
    super.key,
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
    super.key,
    required this.controller,
    required this.rotulo,
    required this.sufixo,
    this.dica = 'sem limite',
  });

  final TextEditingController controller;
  final String rotulo;
  final String sufixo;
  final String dica;

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
      hintText: dica,
    ),
  );
}
