import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/erro_api.dart';
import '../api/midia.dart';
import '../api/modelos.dart';
import '../componentes/basicos.dart';
import '../componentes/dialogos.dart';
import '../componentes/previa_modelo.dart';
import '../tema/cores.dart';

/// O que aconteceu no editor, para a tela de trás dizer em uma linha.
enum FimDoEditor { rascunho, enviado, alteradoNaMeta }

class ResultadoEditor {
  const ResultadoEditor(this.fim, {this.status});

  final FimDoEditor fim;

  /// O status que a Meta devolveu (envio ou alteração), quando há.
  final String? status;

  /// A linha que a tela de trás mostra. Só diz o que é fato: o status vem da
  /// Meta, e "em análise" é o normal até ela responder.
  String get mensagem => switch (fim) {
    FimDoEditor.rascunho =>
      'Rascunho salvo. Ele fica em "Rascunhos e recusados" até você enviar.',
    FimDoEditor.enviado =>
      status == 'aprovado'
          ? 'A Meta aprovou o modelo na hora. Ele já pode ir para campanha.'
          : 'Enviado para a Meta. A resposta costuma levar de minutos a algumas horas, e aparece na lista.',
    FimDoEditor.alteradoNaMeta => switch (status) {
      'aprovado' => 'Alteração aceita: a Meta manteve o modelo aprovado.',
      'rejeitado' => 'A Meta recusou a alteração. O motivo aparece no modelo.',
      _ =>
        'Alteração enviada. A Meta analisa o modelo de novo antes de liberar.',
    },
  };
}

/// O editor de modelo — o mesmo do site: cria do zero ou reabre um rascunho,
/// um recusado ou um modelo que já está na Meta.
///
/// Duas decisões do site valem aqui:
///
/// 1. **As regras da Meta não moram nesta tela.** Quem confere é o servidor
///    (`POST /modelos/conferir`), antes de qualquer envio. Duas implementações
///    da mesma regra divergem. O que a tela faz sozinha é apresentação: contar
///    variáveis para montar os campos de exemplo e desenhar a prévia.
/// 2. **Com problema, nada vai para a Meta.** Cada ponto aparece na seção dele,
///    em português, na hora — a recusa da Meta chega horas depois, com um
///    código só.
///
/// No celular a prévia não cabe ao lado do formulário (e o teclado come metade
/// da tela): ela abre numa folha, pelo botão "Prévia", com o tema claro e o
/// escuro do WhatsApp.
///
/// Devolve (pop) um `ResultadoEditor` quando salvou ou enviou.
class TelaEditorModelo extends ConsumerStatefulWidget {
  const TelaEditorModelo({super.key, this.inicial});

  /// Um modelo para reabrir. Ausente cria um novo.
  final ModeloSalvo? inicial;

  @override
  ConsumerState<TelaEditorModelo> createState() => _TelaEditorModeloState();
}

const _categorias = {
  'MARKETING': 'Marketing',
  'UTILITY': 'Utilidade',
  'AUTHENTICATION': 'Autenticação',
};

const _tiposBotao = {
  'QUICK_REPLY': 'Resposta rápida',
  'URL': 'Abrir link',
  'PHONE_NUMBER': 'Ligar',
  'COPY_CODE': 'Copiar código',
};

IconData _iconeDoBotao(String tipo) => switch (tipo) {
  'URL' => Icons.open_in_new_rounded,
  'PHONE_NUMBER' => Icons.call_rounded,
  'COPY_CODE' => Icons.copy_rounded,
  _ => Icons.reply_rounded,
};

/// Um botão sendo editado: os campos de texto guardam o cursor.
class _BotaoEmEdicao {
  _BotaoEmEdicao(BotaoModelo b, VoidCallback aoMudar)
    : tipo = b.tipo,
      texto = TextEditingController(text: b.texto),
      url = TextEditingController(text: b.url ?? ''),
      telefone = TextEditingController(text: b.telefone ?? '') {
    for (final c in [texto, url, telefone]) {
      c.addListener(aoMudar);
    }
  }

  final chave = UniqueKey();
  String tipo;
  final TextEditingController texto;
  final TextEditingController url;
  final TextEditingController telefone;

  BotaoModelo get valor => BotaoModelo(
    tipo: tipo,
    texto: texto.text.trim(),
    url: tipo == 'URL' ? url.text.trim() : null,
    telefone: tipo == 'PHONE_NUMBER' ? telefone.text.trim() : null,
  );

  void descartar() {
    texto.dispose();
    url.dispose();
    telefone.dispose();
  }
}

/// Um cartão do carrossel sendo editado.
class _CartaoEmEdicao {
  _CartaoEmEdicao(CartaoModelo c, this._aoMudar)
    : imagem = c.imagem,
      corpo = TextEditingController(text: c.corpo),
      botoes = [for (final b in c.botoes) _BotaoEmEdicao(b, _aoMudar)] {
    corpo.addListener(_aoMudar);
  }

  final VoidCallback _aoMudar;
  final chave = UniqueKey();
  String imagem;
  final TextEditingController corpo;
  final List<_BotaoEmEdicao> botoes;

  CartaoModelo get valor => CartaoModelo(
    imagem: imagem,
    corpo: corpo.text,
    botoes: [for (final b in botoes) b.valor],
  );

  _BotaoEmEdicao novoBotao(BotaoModelo b) => _BotaoEmEdicao(b, _aoMudar);

  void descartar() {
    corpo.dispose();
    for (final b in botoes) {
      b.descartar();
    }
  }
}

/// Minúsculas e `_` no lugar do espaço: o teclado do celular põe maiúscula
/// no começo sozinho, e a Meta só aceita `a-z`, `0-9` e `_`. Quem confere a
/// regra inteira é o servidor.
class _NomeTecnico extends TextInputFormatter {
  @override
  TextEditingValue formatEditUpdate(
    TextEditingValue antigo,
    TextEditingValue novo,
  ) {
    final t = novo.text.toLowerCase().replaceAll(' ', '_');
    return t.length == novo.text.length ? novo.copyWith(text: t) : novo;
  }
}

class _TelaEditorModeloState extends ConsumerState<TelaEditorModelo> {
  late final ModeloSalvo? _inicial = widget.inicial;
  late final DadosModelo _d0 = switch (widget.inicial) {
    null => const DadosModelo(),
    final m => DadosModelo.deSalvo(m),
  };

  /// O modelo já existe no servidor: do começo (reabrir) ou desde que o
  /// primeiro salvar desta tela criou o rascunho. Tentar enviar de novo depois
  /// de uma falha não cria outro rascunho com o mesmo nome.
  late String? _id = _inicial?.id;
  bool get _naMeta => _inicial?.naMeta ?? false;

  late String _tipo = _d0.tipo;
  late String _categoria = _d0.categoria;
  late String? _cabecalhoFormato = _d0.cabecalhoFormato;
  late String _cabecalhoMidia = _d0.cabecalhoMidia;
  late bool _ltoAtivo = _d0.ltoAtivo;

  late final _nome = TextEditingController(text: _d0.nome);
  late final _idioma = TextEditingController(text: _d0.idioma);
  late final _cabecalhoTexto = TextEditingController(text: _d0.cabecalhoTexto);
  late final _cabecalhoExemplo = TextEditingController(
    text: _d0.cabecalhoExemplo,
  );
  late final _corpo = TextEditingController(text: _d0.corpo);
  late final _rodape = TextEditingController(text: _d0.rodape);
  late final _ltoTexto = TextEditingController(text: _d0.ltoTexto);
  final _exemplos = <TextEditingController>[];
  late final List<_BotaoEmEdicao> _botoes = [
    for (final b in _d0.botoes) _BotaoEmEdicao(b, _mudou),
  ];
  late final List<_CartaoEmEdicao> _cartoes = [
    for (final c in _d0.cartoes) _CartaoEmEdicao(c, _mudou),
  ];

  /// Os bytes do que foi escolhido nesta tela, por referência: a prévia mostra
  /// na hora, sem baixar de volta o que acabou de subir.
  final _locais = <String, Uint8List>{};

  final _rolagem = ScrollController();
  List<ProblemaModelo> _problemas = const [];
  String? _erro;
  String? _aviso;
  bool _ocupado = false;
  bool _saindo = false;

  /// O que está gravado no servidor, para saber se há o que perder ao sair.
  late String _salvo = _assinatura();

  @override
  void initState() {
    super.initState();
    _ajustarExemplos(_d0.corpoExemplos);
    for (final c in [
      _nome,
      _idioma,
      _cabecalhoTexto,
      _cabecalhoExemplo,
      _rodape,
      _ltoTexto,
    ]) {
      c.addListener(_mudou);
    }
    _corpo.addListener(() {
      _ajustarExemplos(const []);
      _mudou();
    });
  }

  @override
  void dispose() {
    for (final c in [
      _nome,
      _idioma,
      _cabecalhoTexto,
      _cabecalhoExemplo,
      _corpo,
      _rodape,
      _ltoTexto,
      ..._exemplos,
    ]) {
      c.dispose();
    }
    for (final b in _botoes) {
      b.descartar();
    }
    for (final c in _cartoes) {
      c.descartar();
    }
    _rolagem.dispose();
    super.dispose();
  }

  void _mudou() {
    if (!mounted) return;
    setState(() {
      // Mudou o texto: o que o servidor apontou pode não valer mais.
      _problemas = const [];
      _aviso = null;
    });
  }

  /// Um campo de exemplo por variável distinta do corpo, na ordem.
  void _ajustarExemplos(List<String> iniciais) {
    final n = quantasVariaveis(_corpo.text);
    while (_exemplos.length < n) {
      final i = _exemplos.length;
      _exemplos.add(
        TextEditingController(text: i < iniciais.length ? iniciais[i] : '')
          ..addListener(_mudou),
      );
    }
    while (_exemplos.length > n) {
      _exemplos.removeLast().dispose();
    }
  }

  DadosModelo get _dados => DadosModelo(
    tipo: _tipo,
    nome: _nome.text,
    idioma: _idioma.text,
    categoria: _categoria,
    cabecalhoFormato: _cabecalhoFormato,
    cabecalhoTexto: _cabecalhoTexto.text,
    cabecalhoExemplo: _cabecalhoExemplo.text,
    cabecalhoMidia: _cabecalhoMidia,
    corpo: _corpo.text,
    corpoExemplos: [for (final e in _exemplos) e.text],
    rodape: _rodape.text,
    botoes: [for (final b in _botoes) b.valor],
    cartoes: [for (final c in _cartoes) c.valor],
    ltoAtivo: _ltoAtivo,
    ltoTexto: _ltoTexto.text,
  );

  String _assinatura() => jsonEncode(_dados.paraJson());
  bool get _alterado => _assinatura() != _salvo;

  // ------------------------------------------------------------- mudanças

  void _trocarTipo(String tipo) {
    if (tipo == _tipo) return;
    setState(() {
      final novo = _dados.comTipo(tipo);
      _tipo = novo.tipo;
      _cabecalhoFormato = novo.cabecalhoFormato;
      _cabecalhoMidia = novo.cabecalhoMidia;
      _ltoAtivo = novo.ltoAtivo;
      if (tipo == 'carrossel') {
        _cabecalhoTexto.clear();
        _cabecalhoExemplo.clear();
        _rodape.clear();
        _ltoTexto.clear();
        for (final b in _botoes) {
          b.descartar();
        }
        _botoes.clear();
        if (_cartoes.isEmpty) {
          _cartoes.addAll([
            for (final c in novo.cartoes) _CartaoEmEdicao(c, _mudou),
          ]);
        }
      } else {
        for (final c in _cartoes) {
          c.descartar();
        }
        _cartoes.clear();
      }
      _problemas = const [];
      _aviso = null;
    });
  }

  void _trocarCabecalho(String? formato) {
    if (formato == _cabecalhoFormato) return;
    setState(() {
      final novo = _dados.comCabecalho(formato);
      _cabecalhoFormato = novo.cabecalhoFormato;
      _cabecalhoMidia = novo.cabecalhoMidia;
      if (formato != 'TEXT') {
        _cabecalhoTexto.clear();
        _cabecalhoExemplo.clear();
      }
      _problemas = const [];
      _aviso = null;
    });
  }

  Future<String?> _escolherTipoDeBotao() {
    return abrirFolha<String>(
      context,
      alca: false,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            for (final e in _tiposBotao.entries)
              ListTile(
                leading: Icon(_iconeDoBotao(e.key)),
                title: Text(e.value),
                onTap: () => Navigator.pop(ctx, e.key),
              ),
          ],
        ),
      ),
    );
  }

  // ---------------------------------------------------------------- ações

  List<String> _problemasDe(Set<String> campos) => [
    for (final p in _problemas)
      if (campos.any((c) => p.campo == c || p.campo.startsWith('$c.')))
        p.mensagem,
  ];

  /// Os campos que têm seção na forma atual; o resto aparece no topo.
  Set<String> get _camposComSecao => _tipo == 'carrossel'
      ? const {'nome', 'categoria', 'corpo', 'cartoes'}
      : const {
          'nome',
          'categoria',
          'cabecalho',
          'corpo',
          'lto',
          'rodape',
          'botoes',
        };

  void _rolarAoTopo() {
    if (!_rolagem.hasClients) return;
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

  Future<void> _conferir() async {
    FocusScope.of(context).unfocus();
    setState(() {
      _ocupado = true;
      _erro = null;
      _aviso = null;
    });
    try {
      final achados = await ref
          .read(servicoModelosProvider)
          .conferir(_dados, id: _id);
      if (!mounted) return;
      setState(() {
        _problemas = achados;
        if (achados.isEmpty) {
          _aviso =
              'Passou em todas as regras que dá para conferir antes de enviar. A Meta ainda revisa o conteúdo.';
        }
      });
      _rolarAoTopo();
    } catch (e) {
      if (mounted) setState(() => _erro = mensagemDoErro(e));
    } finally {
      if (mounted) setState(() => _ocupado = false);
    }
  }

  Future<void> _salvar({required bool enviar}) async {
    FocusScope.of(context).unfocus();
    final servico = ref.read(servicoModelosProvider);
    final dados = _dados;
    setState(() {
      _ocupado = true;
      _erro = null;
      _aviso = null;
    });
    var gravou = false;
    try {
      // Tudo que vai para a Meta passa ANTES pela conferência do servidor. Com
      // problema, nada sai daqui: cada ponto aparece na seção dele.
      if (enviar || _naMeta) {
        final achados = await servico.conferir(dados, id: _id);
        if (!mounted) return;
        setState(() => _problemas = achados);
        if (achados.isNotEmpty) {
          setState(
            () => _erro =
                'Nada foi enviado para a Meta: ${achados.length == 1 ? 'há 1 ponto' : 'há ${achados.length} pontos'} a corrigir antes. Veja abaixo, na seção de cada um.',
          );
          _rolarAoTopo();
          return;
        }
      }

      if (_naMeta) {
        final ok = await confirmar(
          context,
          titulo: 'Enviar a alteração à Meta?',
          texto:
              'Ela analisa o modelo de novo. Modelo aprovado aceita 1 edição por dia (e 10 por mês), e quem já recebeu a mensagem antiga continua com ela.',
          botao: 'Enviar',
        );
        if (!ok || !mounted) return;
        final status = await servico.salvar(_id!, dados);
        _salvo = jsonEncode(dados.paraJson());
        if (!mounted) return;
        Navigator.of(
          context,
        ).pop(ResultadoEditor(FimDoEditor.alteradoNaMeta, status: status));
        return;
      }

      final existente = _id;
      if (existente == null) {
        _id = await servico.criar(dados);
      } else {
        await servico.salvar(existente, dados);
      }
      gravou = true;
      _salvo = jsonEncode(dados.paraJson());

      if (!enviar) {
        if (mounted) {
          Navigator.of(
            context,
          ).pop(const ResultadoEditor(FimDoEditor.rascunho));
        }
        return;
      }
      final status = await servico.enviarParaAprovacao(_id!);
      if (!mounted) return;
      Navigator.of(
        context,
      ).pop(ResultadoEditor(FimDoEditor.enviado, status: status));
    } catch (e) {
      if (!mounted) return;
      // O rascunho gravou e só o envio falhou (número desconectado, recusa da
      // Meta): o trabalho não se perdeu, e a tela precisa dizer isso.
      setState(
        () => _erro = gravou
            ? '${mensagemDoErro(e)} O rascunho ficou salvo.'
            : mensagemDoErro(e),
      );
      _rolarAoTopo();
    } finally {
      if (mounted) setState(() => _ocupado = false);
    }
  }

  Future<void> _abrirPrevia() async {
    FocusScope.of(context).unfocus();
    await abrirFolha<void>(
      context,
      alca: false,
      forma: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
      ),
      builder: (_) => FractionallySizedBox(
        heightFactor: 0.9,
        child: FolhaDePrevia(dados: _dados, locais: Map.of(_locais)),
      ),
    );
  }

  Future<void> _tentarSair() async {
    final sair = await confirmar(
      context,
      titulo: 'Sair sem salvar?',
      texto: 'O que você mudou aqui se perde.',
      botao: 'Sair',
      perigo: true,
    );
    if (!sair || !mounted) return;
    setState(() => _saindo = true);
    Navigator.of(context).pop();
  }

  // ----------------------------------------------------------------- tela

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final carrossel = _tipo == 'carrossel';
    final horas = _inicial?.horasParaEditar ?? 0;
    final semSecao = [
      for (final p in _problemas)
        if (!_camposComSecao.any(
          (campo) => p.campo == campo || p.campo.startsWith('$campo.'),
        ))
          p.mensagem,
    ];
    var numero = 0;

    return PopScope(
      canPop: _saindo || !_alterado,
      onPopInvokedWithResult: (saiu, _) {
        if (!saiu) _tentarSair();
      },
      child: Scaffold(
        appBar: AppBar(
          title: Text(
            _inicial == null
                ? 'Novo modelo'
                : _naMeta
                ? 'Alterar modelo'
                : 'Editar modelo',
          ),
          actions: [
            TextButton.icon(
              onPressed: _abrirPrevia,
              icon: const Icon(Icons.visibility_outlined, size: 20),
              label: const Text('Prévia'),
            ),
            const SizedBox(width: 6),
          ],
        ),
        body: ListView(
          controller: _rolagem,
          padding: respiroDaTela(context),
          children: [
            Text(
              'Conferimos as regras da Meta antes de enviar — a recusa dela leva horas e diz pouco.',
              style: TextStyle(color: c.tintaSuave, height: 1.45),
            ),
            const SizedBox(height: 14),
            _EscolhaDeForma(tipo: _tipo, aoTrocar: _trocarTipo),
            const SizedBox(height: 14),
            if (_naMeta) ...[
              const Aviso(
                icone: Icons.cloud_sync_outlined,
                texto:
                    'Este modelo já está na Meta. Salvar manda a alteração direto para ela, e ela analisa de novo. Modelo aprovado aceita uma edição por dia (e dez por mês). A categoria não muda — para trocar, é modelo novo. Quem já recebeu a mensagem antiga continua com ela.',
              ),
              const SizedBox(height: 12),
            ],
            if (horas > 0) ...[
              Aviso(
                icone: Icons.schedule_rounded,
                texto:
                    'A Meta aceita 1 edição por dia em modelo aprovado. A próxima libera em ${horas == 1 ? '1 hora' : '$horas horas'}.',
              ),
              const SizedBox(height: 12),
            ],
            if (_erro != null) ...[
              Aviso(
                tom: TomPilula.erro,
                icone: Icons.error_outline_rounded,
                texto: _erro!,
              ),
              const SizedBox(height: 12),
            ],
            if (_aviso != null) ...[
              Aviso(
                tom: TomPilula.sucesso,
                icone: Icons.check_circle_outline_rounded,
                texto: _aviso!,
              ),
              const SizedBox(height: 12),
            ],
            if (_problemas.isNotEmpty) ...[
              Aviso(
                icone: Icons.rule_rounded,
                texto:
                    '${_problemas.length == 1 ? 'Um ajuste antes de enviar' : '${_problemas.length} ajustes antes de enviar'}. Estão marcados abaixo, na seção de cada um.',
              ),
              for (final m in semSecao)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(m, style: TextStyle(color: c.erro, height: 1.4)),
                ),
              const SizedBox(height: 12),
            ],

            _Secao(
              numero: ++numero,
              titulo: 'Identificação',
              problemas: _problemasDe(const {'nome', 'categoria'}),
              children: [
                TextField(
                  key: const ValueKey('m-nome'),
                  controller: _nome,
                  enabled: !_naMeta,
                  autocorrect: false,
                  enableSuggestions: false,
                  maxLength: 512,
                  inputFormatters: [_NomeTecnico()],
                  decoration: InputDecoration(
                    labelText: 'Nome técnico',
                    hintText: 'promo_frete_gratis',
                    counterText: '',
                    helperText: _naMeta
                        ? 'O nome é a chave do modelo na Meta: não muda.'
                        : 'Minúsculas, números e _',
                  ),
                ),
                const SizedBox(height: 14),
                DropdownButtonFormField<String>(
                  key: const ValueKey('m-categoria'),
                  initialValue: _categorias.containsKey(_categoria)
                      ? _categoria
                      : 'MARKETING',
                  dropdownColor: c.superficie,
                  decoration: InputDecoration(
                    labelText: 'Categoria',
                    helperText: _naMeta
                        ? 'A Meta não troca a categoria de um modelo que já existe. Outra categoria é outro modelo.'
                        : 'Define o preço na Meta',
                    helperMaxLines: 3,
                  ),
                  items: [
                    for (final e in _categorias.entries)
                      DropdownMenuItem(value: e.key, child: Text(e.value)),
                  ],
                  onChanged: _naMeta
                      ? null
                      : (v) {
                          if (v == null) return;
                          setState(() {
                            _categoria = v;
                            _problemas = const [];
                            _aviso = null;
                          });
                        },
                ),
                const SizedBox(height: 14),
                TextField(
                  key: const ValueKey('m-idioma'),
                  controller: _idioma,
                  enabled: !_naMeta,
                  autocorrect: false,
                  decoration: const InputDecoration(
                    labelText: 'Idioma',
                    helperText: 'Código da Meta',
                  ),
                ),
              ],
            ),

            if (!carrossel)
              _Secao(
                numero: ++numero,
                titulo: 'Cabeçalho',
                opcional: true,
                problemas: _problemasDe(const {'cabecalho'}),
                children: [
                  _EscolhaDeCabecalho(
                    formato: _cabecalhoFormato,
                    aoTrocar: _trocarCabecalho,
                  ),
                  if (_cabecalhoFormato != null &&
                      _cabecalhoFormato != 'TEXT') ...[
                    const SizedBox(height: 12),
                    SeletorDeMidia(
                      key: ValueKey('midia-$_cabecalhoFormato'),
                      formato: _cabecalhoFormato!,
                      valor: _cabecalhoMidia,
                      locais: _locais,
                      aoMudar: (referencia, bytes) => setState(() {
                        _cabecalhoMidia = referencia;
                        if (bytes != null) _locais[referencia] = bytes;
                        _problemas = const [];
                        _aviso = null;
                      }),
                    ),
                  ],
                  if (_cabecalhoFormato == 'TEXT') ...[
                    const SizedBox(height: 12),
                    TextField(
                      key: const ValueKey('m-cabecalho'),
                      controller: _cabecalhoTexto,
                      maxLength: 60,
                      decoration: const InputDecoration(
                        labelText: 'Título curto acima da mensagem',
                        hintText: 'Oferta da semana',
                        helperText:
                            'Sem emoji, quebra de linha ou formatação. Pode usar {{1}} uma vez.',
                        helperMaxLines: 2,
                      ),
                    ),
                    if (_dados.cabecalhoTemVariavel) ...[
                      const SizedBox(height: 12),
                      TextField(
                        key: const ValueKey('m-cab-exemplo'),
                        controller: _cabecalhoExemplo,
                        decoration: const InputDecoration(
                          labelText: 'Exemplo do valor no cabeçalho',
                          hintText: 'Maria',
                          helperText:
                              'A Meta exige o exemplo quando há variável no cabeçalho.',
                          helperMaxLines: 2,
                        ),
                      ),
                    ],
                  ],
                ],
              ),

            _Secao(
              numero: ++numero,
              titulo: carrossel ? 'Mensagem acima dos cartões' : 'Mensagem',
              problemas: _problemasDe(const {'corpo'}),
              children: [
                TextField(
                  key: const ValueKey('m-corpo'),
                  controller: _corpo,
                  minLines: 5,
                  maxLines: 14,
                  maxLength: 1024,
                  keyboardType: TextInputType.multiline,
                  decoration: const InputDecoration(
                    labelText: 'Texto',
                    alignLabelWithHint: true,
                    hintText: 'Olá {{1}}! Hoje o frete é por nossa conta.',
                    helperText:
                        'Use {{1}}, {{2}}… para personalizar. A mensagem não pode começar nem terminar com variável, e duas não podem ficar coladas — a Meta recusa.',
                    helperMaxLines: 4,
                  ),
                ),
                for (final (i, n) in variaveisDe(_corpo.text).indexed)
                  if (i < _exemplos.length)
                    Padding(
                      padding: const EdgeInsets.only(top: 12),
                      child: TextField(
                        key: ValueKey('m-ex-$n'),
                        controller: _exemplos[i],
                        decoration: InputDecoration(
                          labelText: 'Exemplo de {{$n}}',
                          hintText: 'Maria',
                        ),
                      ),
                    ),
              ],
            ),

            if (carrossel)
              _Secao(
                numero: ++numero,
                titulo: 'Cartões',
                problemas: _problemasDe(const {'cartoes'}),
                children: [_cartoesDoCarrossel(c)],
              )
            else ...[
              _Secao(
                numero: ++numero,
                titulo: 'Oferta e rodapé',
                opcional: true,
                problemas: _problemasDe(const {'lto', 'rodape'}),
                children: [
                  Cartao(
                    padding: EdgeInsets.zero,
                    child: SwitchListTile(
                      key: const ValueKey('m-lto'),
                      value: _ltoAtivo,
                      onChanged: (v) => setState(() {
                        _ltoAtivo = v;
                        _problemas = const [];
                        _aviso = null;
                      }),
                      title: const Text(
                        'Oferta por tempo limitado',
                        style: TextStyle(fontWeight: FontWeight.w600),
                      ),
                      subtitle: Text(
                        'Mostra um contador na mensagem. Só em Marketing, e não aceita rodapé nem cabeçalho de texto.',
                        style: TextStyle(color: c.tintaSuave, height: 1.4),
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  if (_ltoAtivo)
                    TextField(
                      key: const ValueKey('m-lto-texto'),
                      controller: _ltoTexto,
                      maxLength: 16,
                      decoration: const InputDecoration(
                        labelText: 'Texto da oferta',
                        hintText: 'Oferta!',
                      ),
                    )
                  else
                    TextField(
                      key: const ValueKey('m-rodape'),
                      controller: _rodape,
                      maxLength: 60,
                      decoration: const InputDecoration(
                        labelText: 'Rodapé',
                        hintText: 'Válido só hoje',
                        helperText: 'Sem variáveis.',
                      ),
                    ),
                ],
              ),
              _Secao(
                numero: ++numero,
                titulo: 'Botões',
                opcional: true,
                problemas: _problemasDe(const {'botoes'}),
                children: [_botoesDoModelo(c)],
              ),
            ],
          ],
        ),
        bottomNavigationBar: _barraDeAcoes(c, horas),
      ),
    );
  }

  Widget _botoesDoModelo(Cores c) {
    final comSaida = levaBotaoDeSaida(_categoria, _tipo);
    final limite = limiteBotoes(_categoria, _tipo);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          comSaida
              ? 'Até $limite seus (no máximo 2 links, 1 telefone e 1 cupom). O último botão é sempre "${botaoSaida.texto}".'
              : 'Até 10 no total: no máximo 2 links, 1 telefone e 1 cupom.',
          style: TextStyle(color: c.tintaSuave, fontSize: 13, height: 1.4),
        ),
        const SizedBox(height: 10),
        _ListaDeBotoes(
          botoes: _botoes,
          maximo: limite,
          aoRemover: (i) => setState(() {
            _botoes.removeAt(i).descartar();
            _problemas = const [];
          }),
          aoTrocarTipo: (i, tipo) => setState(() {
            _botoes[i].tipo = tipo;
            _problemas = const [];
          }),
          aoAdicionar: () async {
            final tipo = await _escolherTipoDeBotao();
            if (tipo == null || !mounted) return;
            setState(() {
              _botoes.add(
                _BotaoEmEdicao(BotaoModelo(tipo: tipo, texto: ''), _mudou),
              );
              _problemas = const [];
            });
          },
        ),
        if (comSaida) ...[
          const SizedBox(height: 4),
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: c.borda),
              color: c.superficie2,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(Icons.reply_rounded, size: 18, color: c.tinta),
                    const SizedBox(width: 6),
                    Flexible(
                      child: Text.rich(
                        TextSpan(
                          children: [
                            TextSpan(
                              text: botaoSaida.texto,
                              style: const TextStyle(
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                            TextSpan(
                              text: ' · nosso, sempre o último',
                              style: TextStyle(
                                color: c.tintaSuave,
                                fontSize: 12.5,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                Text(
                  'Todo modelo de marketing sai com este botão. Quem tocar nele entra na sua lista de bloqueio na hora e não recebe mais disparos. É o que evita que a pessoa bloqueie o seu número — e bloqueio derruba a qualidade, que leva semanas para voltar.',
                  style: TextStyle(
                    color: c.tintaSuave,
                    fontSize: 12.5,
                    height: 1.45,
                  ),
                ),
              ],
            ),
          ),
        ],
      ],
    );
  }

  Widget _cartoesDoCarrossel(Cores c) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text.rich(
          TextSpan(
            children: [
              const TextSpan(
                text: 'De 2 a 10 cartões, cada um com imagem, texto e botões. ',
              ),
              TextSpan(
                text: 'Todos precisam ter os mesmos botões, na mesma ordem',
                style: TextStyle(fontWeight: FontWeight.w600, color: c.tinta),
              ),
              const TextSpan(
                text:
                    ' — a Meta recusa o carrossel inteiro se um estiver diferente, sem dizer qual.',
              ),
            ],
          ),
          style: TextStyle(color: c.tintaSuave, fontSize: 13, height: 1.45),
        ),
        const SizedBox(height: 12),
        for (var i = 0; i < _cartoes.length; i++)
          Padding(
            key: _cartoes[i].chave,
            padding: const EdgeInsets.only(bottom: 12),
            child: _EditorDeCartao(
              numero: i + 1,
              cartao: _cartoes[i],
              locais: _locais,
              podeMover: i > 0,
              podeRemover: _cartoes.length > 2,
              aoMover: () => setState(() {
                final item = _cartoes.removeAt(i);
                _cartoes.insert(i - 1, item);
                _problemas = const [];
              }),
              aoRemover: () => setState(() {
                _cartoes.removeAt(i).descartar();
                _problemas = const [];
              }),
              aoMudarImagem: (referencia, bytes) => setState(() {
                _cartoes[i].imagem = referencia;
                if (bytes != null) _locais[referencia] = bytes;
                _problemas = const [];
                _aviso = null;
              }),
              aoMudar: () => setState(() => _problemas = const []),
              escolherTipoDeBotao: _escolherTipoDeBotao,
            ),
          ),
        if (_cartoes.length < 10)
          Align(
            alignment: Alignment.centerLeft,
            child: OutlinedButton.icon(
              style: OutlinedButton.styleFrom(minimumSize: const Size(0, 44)),
              onPressed: () => setState(() {
                // O cartão novo nasce com os MESMOS botões do primeiro: é a
                // regra que mais derruba carrossel, e adivinhar aqui evita o
                // erro.
                final primeiro = _cartoes.isEmpty ? null : _cartoes.first;
                final novo = _CartaoEmEdicao(const CartaoModelo(), _mudou);
                if (primeiro != null) {
                  novo.botoes.addAll([
                    for (final b in primeiro.botoes) novo.novoBotao(b.valor),
                  ]);
                }
                _cartoes.add(novo);
                _problemas = const [];
              }),
              icon: const Icon(Icons.add_rounded),
              label: const Text('Cartão'),
            ),
          ),
      ],
    );
  }

  Widget _barraDeAcoes(Cores c, int horas) {
    final carregando = SizedBox.square(
      dimension: 22,
      child: CircularProgressIndicator(
        strokeWidth: 2.5,
        color: c.acentoContraste,
      ),
    );
    return SafeArea(
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
            if (_naMeta)
              FilledButton(
                onPressed: _ocupado || horas > 0
                    ? null
                    : () => _salvar(enviar: false),
                child: _ocupado
                    ? carregando
                    : const Text('Salvar alteração na Meta'),
              )
            else
              FilledButton(
                onPressed: _ocupado ? null : () => _salvar(enviar: true),
                child: _ocupado
                    ? carregando
                    : const Text('Enviar para aprovação'),
              ),
            const SizedBox(height: 4),
            Row(
              children: [
                if (!_naMeta)
                  Expanded(
                    child: TextButton(
                      onPressed: _ocupado ? null : () => _salvar(enviar: false),
                      child: const Text('Salvar rascunho'),
                    ),
                  ),
                Expanded(
                  child: TextButton(
                    onPressed: _ocupado ? null : _conferir,
                    child: const Text('Conferir regras'),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

// ------------------------------------------------------------------ peças

/// Uma seção do formulário. O número não é enfeite: escrever um modelo TEM
/// ordem — identificar, escrever, decorar. A seção com problema ganha um
/// trilho vermelho à esquerda e a lista do que corrigir no fim.
class _Secao extends StatelessWidget {
  const _Secao({
    required this.numero,
    required this.titulo,
    required this.problemas,
    required this.children,
    this.opcional = false,
  });

  final int numero;
  final String titulo;
  final bool opcional;
  final List<String> problemas;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final comProblema = problemas.isNotEmpty;
    return Container(
      margin: const EdgeInsets.only(top: 18),
      padding: EdgeInsets.only(left: comProblema ? 12 : 0),
      decoration: BoxDecoration(
        border: comProblema
            ? Border(left: BorderSide(color: c.erro, width: 3))
            : null,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Container(
                width: 22,
                height: 22,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: comProblema ? c.erro : c.acento,
                  shape: BoxShape.circle,
                ),
                child: Text(
                  '$numero',
                  style: TextStyle(
                    fontSize: 11.5,
                    fontWeight: FontWeight.w700,
                    color: comProblema
                        ? (Theme.of(context).brightness == Brightness.dark
                              ? const Color(0xFF231632)
                              : Colors.white)
                        : c.acentoContraste,
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Flexible(
                child: Text(
                  titulo,
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ),
              if (opcional) ...[
                const SizedBox(width: 8),
                Text(
                  'opcional',
                  style: TextStyle(color: c.tintaSuave, fontSize: 12.5),
                ),
              ],
            ],
          ),
          const SizedBox(height: 12),
          ...children,
          if (comProblema) ...[
            const SizedBox(height: 10),
            for (final m in problemas)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: Icon(
                        Icons.error_outline_rounded,
                        size: 16,
                        color: c.erro,
                      ),
                    ),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        m,
                        style: TextStyle(
                          color: c.erro,
                          fontSize: 13,
                          height: 1.4,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
          ],
        ],
      ),
    );
  }
}

/// Uma opção de escolha única, em pílula: marcada = cor da marca.
class _Opcao extends StatelessWidget {
  const _Opcao({
    super.key,
    required this.rotulo,
    required this.ativo,
    required this.aoTocar,
    this.icone,
  });

  final String rotulo;
  final bool ativo;
  final VoidCallback aoTocar;
  final IconData? icone;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final frente = ativo ? c.acentoContraste : c.tintaSuave;
    return Semantics(
      button: true,
      inMutuallyExclusiveGroup: true,
      checked: ativo,
      child: Material(
        color: ativo ? c.acento : c.superficie,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: BorderSide(color: ativo ? c.acento : c.borda),
        ),
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: aoTocar,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (icone != null) ...[
                  Icon(icone, size: 17, color: frente),
                  const SizedBox(width: 6),
                ],
                Text(
                  rotulo,
                  style: TextStyle(
                    color: ativo ? c.acentoContraste : c.tinta,
                    fontWeight: FontWeight.w600,
                    fontSize: 13.5,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// A forma do modelo: mensagem simples ou carrossel.
class _EscolhaDeForma extends StatelessWidget {
  const _EscolhaDeForma({required this.tipo, required this.aoTrocar});

  final String tipo;
  final ValueChanged<String> aoTrocar;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    Widget opcao(String valor, String rotulo, String ajuda) {
      final ativo = tipo == valor;
      return Expanded(
        child: Semantics(
          button: true,
          inMutuallyExclusiveGroup: true,
          checked: ativo,
          child: Material(
            color: ativo ? c.acento : c.superficie,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(14),
              side: BorderSide(color: ativo ? c.acento : c.borda),
            ),
            child: InkWell(
              key: ValueKey('forma-$valor'),
              borderRadius: BorderRadius.circular(14),
              onTap: () => aoTrocar(valor),
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      rotulo,
                      style: TextStyle(
                        fontWeight: FontWeight.w600,
                        color: ativo ? c.acentoContraste : c.tinta,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      ajuda,
                      style: TextStyle(
                        fontSize: 12.5,
                        color: ativo
                            ? c.acentoContraste.withValues(alpha: 0.75)
                            : c.tintaSuave,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      );
    }

    return Row(
      children: [
        opcao('simples', 'Mensagem simples', 'Texto, imagem e botões'),
        const SizedBox(width: 10),
        opcao('carrossel', 'Carrossel', 'De 2 a 10 produtos'),
      ],
    );
  }
}

/// As quatro formas de cabeçalho da Meta, mais "nenhum".
class _EscolhaDeCabecalho extends StatelessWidget {
  const _EscolhaDeCabecalho({required this.formato, required this.aoTrocar});

  final String? formato;
  final ValueChanged<String?> aoTrocar;

  static const _formatos = <(String?, String, IconData)>[
    (null, 'Sem cabeçalho', Icons.remove_rounded),
    ('TEXT', 'Texto', Icons.title_rounded),
    ('IMAGE', 'Imagem', Icons.image_outlined),
    ('VIDEO', 'Vídeo', Icons.play_circle_outline_rounded),
    ('DOCUMENT', 'Documento', Icons.description_outlined),
  ];

  @override
  Widget build(BuildContext context) => Wrap(
    spacing: 8,
    runSpacing: 8,
    children: [
      for (final (valor, rotulo, icone) in _formatos)
        _Opcao(
          key: ValueKey('cabecalho-${valor ?? 'NENHUM'}'),
          rotulo: rotulo,
          icone: icone,
          ativo: formato == valor,
          aoTocar: () => aoTrocar(valor),
        ),
    ],
  );
}

/// Escolha da mídia: arquivo do celular OU endereço.
///
/// O arquivo é o caminho principal, e o endereço é a alternativa — quase
/// ninguém tem a foto do produto hospedada num endereço público; quase todo
/// mundo tem ela no celular. O arquivo sobe agora e só vira `header_handle`
/// na hora de submeter o modelo, no servidor.
class SeletorDeMidia extends ConsumerStatefulWidget {
  const SeletorDeMidia({
    super.key,
    required this.formato,
    required this.valor,
    required this.aoMudar,
    this.locais = const {},
    this.compacto = false,
  });

  /// `IMAGE`, `VIDEO` ou `DOCUMENT`.
  final String formato;

  /// A referência atual (`midia:<uuid>`, `https://…` ou vazio).
  final String valor;

  /// Nova referência; `bytes` quando veio de um arquivo escolhido agora.
  final void Function(String referencia, Uint8List? bytes) aoMudar;
  final Map<String, Uint8List> locais;

  /// Versão menor, para dentro do cartão do carrossel.
  final bool compacto;

  @override
  ConsumerState<SeletorDeMidia> createState() => _SeletorDeMidiaState();
}

class _SeletorDeMidiaState extends ConsumerState<SeletorDeMidia> {
  bool _enviando = false;
  String? _erro;
  String? _nome;
  late bool _porEndereco = ehEndereco(widget.valor);
  late final _endereco = TextEditingController(
    text: ehEndereco(widget.valor) ? widget.valor : '',
  );

  @override
  void dispose() {
    _endereco.dispose();
    super.dispose();
  }

  String get _rotulo => rotuloDoFormato(widget.formato);

  Future<void> _escolher() async {
    setState(() => _erro = null);
    final arquivo = await ref.read(escolherMidiaProvider)(widget.formato);
    if (arquivo == null || !mounted) return;
    final problema = problemaDoArquivo(
      arquivo.nome,
      arquivo.tamanho,
      widget.formato,
    );
    if (problema != null) {
      setState(() => _erro = problema);
      return;
    }
    setState(() => _enviando = true);
    try {
      final bytes = await arquivo.ler();
      final enviada = await ref
          .read(servicoMidiaProvider)
          .enviar(arquivo.nome, bytes);
      if (!mounted) return;
      setState(
        () => _nome = enviada.nome.isEmpty ? arquivo.nome : enviada.nome,
      );
      widget.aoMudar(enviada.referencia, bytes);
    } catch (e) {
      if (mounted) setState(() => _erro = mensagemDoErro(e));
    } finally {
      if (mounted) setState(() => _enviando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final tem = widget.valor.trim().isNotEmpty;
    final imagem = widget.formato == 'IMAGE' && tem
        ? imagemDaReferencia(ref, widget.valor, locais: widget.locais)
        : null;
    final escolhido = switch (widget.formato) {
      'IMAGE' => 'Imagem escolhida',
      'VIDEO' => 'Vídeo escolhido',
      _ => 'Documento escolhido',
    };
    final nenhum = switch (widget.formato) {
      'IMAGE' => 'Nenhuma imagem',
      'VIDEO' => 'Nenhum vídeo',
      _ => 'Nenhum documento',
    };

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (!_porEndereco)
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: tem ? c.acento : c.borda),
              color: tem ? c.acentoSuave.withValues(alpha: 0.4) : c.superficie,
            ),
            child: Row(
              children: [
                Container(
                  width: 52,
                  height: 52,
                  decoration: BoxDecoration(
                    color: c.superficie2,
                    borderRadius: BorderRadius.circular(10),
                    image: imagem == null
                        ? null
                        : DecorationImage(image: imagem, fit: BoxFit.cover),
                  ),
                  child: imagem == null
                      ? Icon(switch (widget.formato) {
                          'IMAGE' => Icons.image_outlined,
                          'VIDEO' => Icons.play_circle_outline_rounded,
                          _ => Icons.description_outlined,
                        }, color: c.tintaSuave)
                      : null,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        tem ? (_nome ?? escolhido) : nenhum,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontWeight: FontWeight.w600),
                      ),
                      if (!widget.compacto)
                        Text(
                          aceitaDoFormato(widget.formato),
                          style: TextStyle(color: c.tintaSuave, fontSize: 12.5),
                        ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                OutlinedButton(
                  key: ValueKey('escolher-${widget.formato}'),
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size(0, 40),
                    padding: const EdgeInsets.symmetric(horizontal: 14),
                  ),
                  onPressed: _enviando ? null : _escolher,
                  child: _enviando
                      ? const SizedBox.square(
                          dimension: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : Text(tem ? 'Trocar' : 'Escolher'),
                ),
              ],
            ),
          )
        else
          TextField(
            controller: _endereco,
            keyboardType: TextInputType.url,
            autocorrect: false,
            decoration: InputDecoration(
              labelText: 'Endereço da $_rotulo',
              hintText:
                  'https://sualoja.com.br/${switch (widget.formato) {
                    'IMAGE' => 'produto.jpg',
                    'VIDEO' => 'video.mp4',
                    _ => 'catalogo.pdf',
                  }}',
            ),
            onChanged: (v) => widget.aoMudar(v.trim(), null),
          ),
        if (_erro != null)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text(
              _erro!,
              style: TextStyle(color: c.erro, fontSize: 13, height: 1.4),
            ),
          ),
        TextButton(
          onPressed: _enviando
              ? null
              : () {
                  setState(() {
                    _porEndereco = !_porEndereco;
                    _erro = null;
                    _nome = null;
                    _endereco.clear();
                  });
                  widget.aoMudar('', null);
                },
          child: Text(
            _porEndereco
                ? 'Enviar arquivo do celular'
                : 'Usar um endereço da internet',
          ),
        ),
      ],
    );
  }
}

/// A lista de botões de um modelo (ou de um cartão), com o limite.
class _ListaDeBotoes extends StatelessWidget {
  const _ListaDeBotoes({
    required this.botoes,
    required this.maximo,
    required this.aoRemover,
    required this.aoTrocarTipo,
    required this.aoAdicionar,
  });

  final List<_BotaoEmEdicao> botoes;
  final int maximo;
  final ValueChanged<int> aoRemover;
  final void Function(int, String) aoTrocarTipo;
  final VoidCallback aoAdicionar;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (var i = 0; i < botoes.length; i++)
          Padding(
            key: botoes[i].chave,
            padding: const EdgeInsets.only(bottom: 10),
            child: _EditorBotao(
              botao: botoes[i],
              aoTrocarTipo: (t) => aoTrocarTipo(i, t),
              aoRemover: () => aoRemover(i),
            ),
          ),
        Row(
          children: [
            if (botoes.length < maximo)
              TextButton.icon(
                onPressed: aoAdicionar,
                icon: const Icon(Icons.add_rounded),
                label: const Text('Botão'),
              ),
            const Spacer(),
            Text(
              '${botoes.length} de $maximo',
              style: TextStyle(
                color: c.tintaSuave,
                fontSize: 12.5,
                fontFeatures: const [FontFeature.tabularFigures()],
              ),
            ),
          ],
        ),
      ],
    );
  }
}

class _EditorBotao extends StatelessWidget {
  const _EditorBotao({
    required this.botao,
    required this.aoTrocarTipo,
    required this.aoRemover,
  });

  final _BotaoEmEdicao botao;
  final ValueChanged<String> aoTrocarTipo;
  final VoidCallback aoRemover;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    return Cartao(
      padding: const EdgeInsets.fromLTRB(14, 4, 4, 12),
      child: Column(
        children: [
          Row(
            children: [
              Icon(_iconeDoBotao(botao.tipo), size: 18, color: c.tintaSuave),
              const SizedBox(width: 8),
              Expanded(
                child: DropdownButtonHideUnderline(
                  child: DropdownButton<String>(
                    value: botao.tipo,
                    isExpanded: true,
                    dropdownColor: c.superficie,
                    items: [
                      for (final e in _tiposBotao.entries)
                        DropdownMenuItem(value: e.key, child: Text(e.value)),
                    ],
                    onChanged: (v) {
                      if (v != null) aoTrocarTipo(v);
                    },
                  ),
                ),
              ),
              IconButton(
                tooltip: 'Remover botão',
                onPressed: aoRemover,
                icon: Icon(Icons.close_rounded, color: c.tintaSuave),
              ),
            ],
          ),
          Padding(
            padding: const EdgeInsets.only(right: 10),
            child: Column(
              children: [
                TextField(
                  controller: botao.texto,
                  maxLength: 25,
                  decoration: InputDecoration(
                    labelText: botao.tipo == 'COPY_CODE'
                        ? 'Código de exemplo'
                        : 'Texto do botão',
                  ),
                ),
                if (botao.tipo == 'URL')
                  TextField(
                    controller: botao.url,
                    keyboardType: TextInputType.url,
                    autocorrect: false,
                    decoration: const InputDecoration(
                      labelText: 'Link',
                      hintText: 'https://sualoja.com.br',
                    ),
                  ),
                if (botao.tipo == 'PHONE_NUMBER')
                  TextField(
                    controller: botao.telefone,
                    keyboardType: TextInputType.phone,
                    decoration: const InputDecoration(
                      labelText: 'Telefone com DDI',
                      hintText: '5521999998888',
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

/// Um cartão do carrossel: imagem, texto e até dois botões.
class _EditorDeCartao extends StatelessWidget {
  const _EditorDeCartao({
    required this.numero,
    required this.cartao,
    required this.locais,
    required this.podeMover,
    required this.podeRemover,
    required this.aoMover,
    required this.aoRemover,
    required this.aoMudarImagem,
    required this.aoMudar,
    required this.escolherTipoDeBotao,
  });

  final int numero;
  final _CartaoEmEdicao cartao;
  final Map<String, Uint8List> locais;
  final bool podeMover;
  final bool podeRemover;
  final VoidCallback aoMover;
  final VoidCallback aoRemover;
  final void Function(String, Uint8List?) aoMudarImagem;
  final VoidCallback aoMudar;
  final Future<String?> Function() escolherTipoDeBotao;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 8, 14, 12),
      decoration: BoxDecoration(
        color: c.superficie2,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: c.borda),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  'Cartão $numero',
                  style: TextStyle(
                    fontWeight: FontWeight.w700,
                    color: c.tintaSuave,
                    letterSpacing: 0.4,
                  ),
                ),
              ),
              if (podeMover)
                TextButton.icon(
                  onPressed: aoMover,
                  icon: const Icon(Icons.arrow_upward_rounded, size: 18),
                  label: const Text('Subir'),
                ),
              if (podeRemover)
                TextButton(
                  onPressed: aoRemover,
                  style: TextButton.styleFrom(foregroundColor: c.erro),
                  child: const Text('Remover'),
                ),
            ],
          ),
          const SizedBox(height: 4),
          SeletorDeMidia(
            formato: 'IMAGE',
            compacto: true,
            valor: cartao.imagem,
            locais: locais,
            aoMudar: aoMudarImagem,
          ),
          const SizedBox(height: 6),
          TextField(
            controller: cartao.corpo,
            maxLength: 160,
            minLines: 2,
            maxLines: 5,
            decoration: const InputDecoration(
              labelText: 'Texto do cartão',
              hintText: 'Hambúrguer artesanal com fritas',
            ),
          ),
          const SizedBox(height: 4),
          Text(
            'Um ou dois botões. Os mesmos em todos os cartões.',
            style: TextStyle(color: c.tintaSuave, fontSize: 12.5),
          ),
          const SizedBox(height: 8),
          _ListaDeBotoes(
            botoes: cartao.botoes,
            maximo: 2,
            aoRemover: (i) {
              cartao.botoes.removeAt(i).descartar();
              aoMudar();
            },
            aoTrocarTipo: (i, tipo) {
              cartao.botoes[i].tipo = tipo;
              aoMudar();
            },
            aoAdicionar: () async {
              final tipo = await escolherTipoDeBotao();
              if (tipo == null) return;
              cartao.botoes.add(
                cartao.novoBotao(BotaoModelo(tipo: tipo, texto: '')),
              );
              aoMudar();
            },
          ),
        ],
      ),
    );
  }
}

/// A folha da prévia: a mensagem como chega, no tema claro ou escuro do
/// WhatsApp — metade das pessoas usa no escuro, e o contraste muda.
class FolhaDePrevia extends StatefulWidget {
  const FolhaDePrevia({super.key, required this.dados, this.locais = const {}});

  final DadosModelo dados;
  final Map<String, Uint8List> locais;

  @override
  State<FolhaDePrevia> createState() => _FolhaDePreviaState();
}

class _FolhaDePreviaState extends State<FolhaDePrevia> {
  bool? _escuro;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final escuro = _escuro ?? Theme.of(context).brightness == Brightness.dark;
    return Column(
      children: [
        const SizedBox(height: 10),
        Container(
          width: 40,
          height: 4,
          decoration: BoxDecoration(
            color: c.borda,
            borderRadius: BorderRadius.circular(2),
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 14, 20, 10),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  'Como vai chegar',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ),
              _Opcao(
                key: const ValueKey('tema-claro'),
                rotulo: 'Claro',
                ativo: !escuro,
                aoTocar: () => setState(() => _escuro = false),
              ),
              const SizedBox(width: 6),
              _Opcao(
                key: const ValueKey('tema-escuro'),
                rotulo: 'Escuro',
                ativo: escuro,
                aoTocar: () => setState(() => _escuro = true),
              ),
            ],
          ),
        ),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(20, 4, 20, 20),
            children: [
              PreviaDoModelo(
                dados: widget.dados,
                locais: widget.locais,
                escuro: escuro,
              ),
              const SizedBox(height: 12),
              Text(
                'As variáveis aparecem com os exemplos preenchidos, que é como a mensagem chega de verdade.',
                style: TextStyle(
                  color: c.tintaSuave,
                  fontSize: 12.5,
                  height: 1.45,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
