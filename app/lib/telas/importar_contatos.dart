import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/contatos.dart';
import '../api/erro_api.dart';
import '../componentes/basicos.dart';
import '../tema/cores.dart';
import '../util/formato.dart' as f;
import 'dividir_em_blocos.dart';
import 'integracoes.dart';

/// Importar contatos em três passos: de onde vêm, o que o servidor leu, e o
/// resultado.
///
/// Nada é gravado antes do último toque. A prévia existe para a pessoa ver o
/// que o arquivo realmente tinha (quantos números valem, quantos já estavam na
/// base, quantos ganharam o 55) antes de assumir o compromisso do
/// consentimento.
///
/// Devolve (pop) `true` quando gravou — ou a [DivisaoDeBlocos], quando a
/// pessoa já dividiu o que entrou em blocos.
class TelaImportarContatos extends ConsumerStatefulWidget {
  const TelaImportarContatos({super.key});

  @override
  ConsumerState<TelaImportarContatos> createState() =>
      _TelaImportarContatosState();
}

/// Extensões que o servidor lê — ele é quem decide; isto só poupa o envio.
const _extensoes = {'vcf', 'vcard', 'csv', 'tsv', 'txt', 'xlsx', 'xlsm'};
const _tamanhoMaximo = 5 * 1024 * 1024;

/// "Sem lista" e "lista nova" no mesmo seletor das listas existentes.
const _semLista = '';
const _novaLista = '+';

class _TelaImportarContatosState extends ConsumerState<TelaImportarContatos> {
  final _texto = TextEditingController();
  final _nomeLista = TextEditingController();
  final _evidencia = TextEditingController();

  PreviaImportacao? _previa;
  ResultadoImportacao? _resultado;

  /// Já gravou nesta visita (mesmo que depois tenha tocado em "Importar
  /// mais"): sair por qualquer caminho avisa a lista para reler.
  bool _importou = false;
  String _destino = _semLista;
  bool _consentimento = false;
  bool _ocupado = false;
  String? _erro;

  /// Arquivo grande vai em partes: quantos já foram gravados.
  ({int feitos, int total})? _progresso;

  @override
  void dispose() {
    _texto.dispose();
    _nomeLista.dispose();
    _evidencia.dispose();
    super.dispose();
  }

  Future<void> _lerArquivo() async {
    setState(() => _erro = null);
    // FileType.any: filtrar por extensão no Android esconde arquivos cujo tipo
    // o aparelho não conhece (um .csv que veio pelo WhatsApp, por exemplo).
    final arquivo = await FilePicker.pickFile(type: FileType.any);
    if (arquivo == null || !mounted) return;

    final ext = (arquivo.extension ?? '').toLowerCase();
    if (!_extensoes.contains(ext)) {
      setState(
        () => _erro =
            'Este arquivo não serve. Envie .vcf (contatos do celular), .csv, .txt ou .xlsx.',
      );
      return;
    }
    final tamanho = arquivo.lengthSync() ?? await arquivo.length();
    if (tamanho != null && tamanho > _tamanhoMaximo) {
      setState(
        () => _erro =
            'O arquivo passa de 5 MB. Divida em partes menores e importe uma de cada vez.',
      );
      return;
    }

    await _pedirPrevia(() async {
      final bytes = await arquivo.readAsBytes();
      return ref
          .read(servicoContatosProvider)
          .previaDeArquivo(bytes, arquivo.name);
    });
  }

  Future<void> _lerTexto() async {
    if (_texto.text.trim().length < 3) {
      setState(() => _erro = 'Cole ao menos um número.');
      return;
    }
    FocusScope.of(context).unfocus();
    await _pedirPrevia(
      () => ref.read(servicoContatosProvider).previaDeTexto(_texto.text),
    );
  }

  Future<void> _pedirPrevia(Future<PreviaImportacao> Function() pedir) async {
    setState(() {
      _ocupado = true;
      _erro = null;
    });
    try {
      final p = await pedir();
      if (!mounted) return;
      setState(() => _previa = p);
    } catch (e) {
      if (mounted) setState(() => _erro = mensagemDoErro(e));
    } finally {
      if (mounted) setState(() => _ocupado = false);
    }
  }

  Future<void> _gravar() async {
    final previa = _previa!;
    if (_destino == _novaLista && _nomeLista.text.trim().length < 2) {
      setState(() => _erro = 'Dê um nome à lista nova (ao menos 2 letras).');
      return;
    }
    setState(() {
      _ocupado = true;
      _erro = null;
    });
    final servico = ref.read(servicoContatosProvider);
    try {
      var listaId = _destino == _semLista ? null : _destino;
      if (_destino == _novaLista) {
        listaId = await servico.criarLista(_nomeLista.text);
        // Se a importação falhar daqui em diante, a lista já existe: na
        // próxima tentativa ela aparece entre as existentes, sem duplicar.
        if (mounted) setState(() => _destino = listaId!);
        ref.invalidate(listasContatosProvider);
      }
      final emPartes = previa.contatos.length > previa.porEnvio;
      final r = await servico.importar(
        previa: previa,
        consentimento: _consentimento,
        evidencia: _evidencia.text,
        listaId: listaId,
        aoAndar: emPartes
            ? (feitos, total) {
                if (mounted) {
                  setState(() => _progresso = (feitos: feitos, total: total));
                }
              }
            : null,
      );
      if (!mounted) return;
      ref.invalidate(listasContatosProvider);
      setState(() {
        _resultado = r;
        _importou = true;
      });
    } catch (e) {
      if (mounted) setState(() => _erro = mensagemDoErro(e));
    } finally {
      if (mounted) {
        setState(() {
          _ocupado = false;
          _progresso = null;
        });
      }
    }
  }

  /// Começa outra importação, do zero.
  void _importarMais() => setState(() {
    _previa = null;
    _resultado = null;
    _erro = null;
    _consentimento = false;
    _destino = _semLista;
    _texto.clear();
    _nomeLista.clear();
    _evidencia.clear();
  });

  Future<void> _dividir(PreviaImportacao previa, String importacaoId) async {
    final d = await Navigator.of(context).push<DivisaoDeBlocos>(
      MaterialPageRoute(
        builder: (_) => TelaDividirEmBlocos(
          alvo: AlvoDaDivisao(
            origem: 'importacao',
            origemId: importacaoId,
            rotulo: _rotulo(previa),
            soNomeENumero: previa.soNomeENumero,
          ),
        ),
      ),
    );
    if (d != null && mounted) Navigator.of(context).pop(d);
  }

  static String _rotulo(PreviaImportacao p) =>
      p.arquivoNome ??
      (p.formato == 'texto' ? 'Números colados' : 'Importação');

  @override
  Widget build(BuildContext context) {
    final titulo = _resultado != null
        ? 'Importação concluída'
        : _previa != null
        ? 'Conferir e importar'
        : 'Importar contatos';
    return PopScope(
      canPop: !_importou,
      onPopInvokedWithResult: (saiu, _) {
        if (!saiu) Navigator.of(context).pop(true);
      },
      child: Scaffold(
        appBar: AppBar(
          title: Text(titulo),
          leading: _previa != null && _resultado == null
              ? IconButton(
                  tooltip: 'Voltar',
                  icon: const Icon(Icons.arrow_back_rounded),
                  onPressed: _ocupado
                      ? null
                      : () => setState(() {
                          _previa = null;
                          _erro = null;
                        }),
                )
              : null,
        ),
        body: _resultado != null
            ? _Resultado(
                resultado: _resultado!,
                previa: _previa!,
                aoDividir: _dividir,
                aoImportarMais: _importarMais,
              )
            : _previa != null
            ? _passoPrevia(context, _previa!)
            : _passoOrigem(context),
        bottomNavigationBar: _barra(),
      ),
    );
  }

  Widget? _barra() {
    Widget embrulhar(Widget botao) => SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 12),
        child: botao,
      ),
    );

    if (_resultado != null) {
      return embrulhar(
        FilledButton(
          key: const ValueKey('concluir'),
          onPressed: () => Navigator.of(context).pop(true),
          child: const Text('Concluir'),
        ),
      );
    }
    final p = _previa;
    if (p == null || p.validos == 0) return null;
    final progresso = _progresso;
    return embrulhar(
      FilledButton(
        key: const ValueKey('importar-confirmar'),
        onPressed: _ocupado || !_consentimento ? null : _gravar,
        child: progresso != null
            ? Text(
                'Gravando ${f.numero(progresso.feitos)} de ${f.numero(progresso.total)}…',
              )
            : _ocupado
            ? const SizedBox(
                width: 18,
                height: 18,
                child: CircularProgressIndicator(strokeWidth: 2),
              )
            : Text(
                p.novos == 0 && p.extras.isNotEmpty
                    ? 'Atualizar os dados dos contatos'
                    : 'Importar ${f.plural(p.novos, 'contato', 'contatos')}',
              ),
      ),
    );
  }

  Widget _passoOrigem(BuildContext context) {
    final c = Cores.de(context);
    final ajuda = TextStyle(color: c.tintaSuave, fontSize: 13, height: 1.45);
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 28),
      children: [
        Text(
          'Nada é gravado agora: primeiro você vê o que foi lido.',
          style: TextStyle(color: c.tintaSuave, height: 1.45),
        ),
        const SizedBox(height: 16),
        Cartao(
          aoTocar: _ocupado ? null : _lerArquivo,
          child: Row(
            children: [
              Icon(Icons.upload_file_rounded, color: c.acentoForte, size: 30),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Escolher arquivo',
                      style: TextStyle(
                        fontWeight: FontWeight.w600,
                        fontSize: 15,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      'Contatos do celular (.vcf), planilha (.csv, .xlsx) ou .txt — até 5 MB.',
                      style: TextStyle(
                        color: c.tintaSuave,
                        fontSize: 13,
                        height: 1.4,
                      ),
                    ),
                  ],
                ),
              ),
              Icon(Icons.chevron_right_rounded, color: c.tintaSuave),
            ],
          ),
        ),
        const SizedBox(height: 10),
        Text(
          'Numa planilha, dê à coluna dos números o título "telefone" ou "celular". Se a planilha tiver, também trazemos e-mail, aniversário, pedidos, total gasto e última compra (ou dias sem comprar).',
          style: ajuda,
        ),
        const SizedBox(height: 6),
        Text(
          'Usa a Anota Aí? Em Relatórios → Clientes, exporte em Excel ou CSV e envie o arquivo aqui.',
          style: ajuda,
        ),
        const SizedBox(height: 20),
        Text(
          'Ou cole os números',
          style: Theme.of(context).textTheme.titleSmall,
        ),
        const SizedBox(height: 8),
        TextField(
          controller: _texto,
          minLines: 5,
          maxLines: 10,
          keyboardType: TextInputType.multiline,
          decoration: const InputDecoration(
            hintText:
                'Um por linha. Pode ter o nome antes:\nMaria, 11 99999-8888\n5521988887777',
          ),
        ),
        const SizedBox(height: 10),
        Align(
          alignment: Alignment.centerRight,
          child: OutlinedButton(
            onPressed: _ocupado ? null : _lerTexto,
            child: const Text('Ler números'),
          ),
        ),
        if (_ocupado) ...[
          const SizedBox(height: 20),
          const Center(child: CircularProgressIndicator()),
        ],
        if (_erro != null) ...[
          const SizedBox(height: 16),
          Aviso(
            tom: TomPilula.erro,
            icone: Icons.error_outline_rounded,
            texto: _erro!,
          ),
        ],
        const SizedBox(height: 24),
        Cartao(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Cardápio Web',
                style: TextStyle(fontWeight: FontWeight.w600, fontSize: 15),
              ),
              const SizedBox(height: 4),
              Text(
                'A loja do Cardápio Web se conecta em Integrações: além dos clientes, traz o histórico de compras de cada um e continua trazendo os pedidos novos.',
                style: ajuda,
              ),
              const SizedBox(height: 10),
              OutlinedButton.icon(
                key: const ValueKey('abrir-integracoes'),
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => const TelaIntegracoes(),
                  ),
                ),
                icon: const Icon(Icons.hub_outlined, size: 18),
                label: const Text('Abrir Integrações'),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _passoPrevia(BuildContext context, PreviaImportacao p) {
    final c = Cores.de(context);
    final listas =
        ref.watch(listasContatosProvider).value ?? const <ListaContatos>[];
    // A lista escolhida pode ter sumido (outra pessoa excluiu no site).
    if (_destino != _semLista &&
        _destino != _novaLista &&
        !listas.any((l) => l.id == _destino)) {
      _destino = _semLista;
    }
    final amostra = p.contatos.take(20).toList();

    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 28),
      children: [
        if (p.arquivoNome != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Text(
              p.arquivoNome!,
              style: TextStyle(color: c.tintaSuave, fontSize: 13),
            ),
          ),
        Wrap(
          spacing: 10,
          runSpacing: 10,
          children: [
            _Numero(rotulo: 'entram', valor: p.novos, tom: TomPilula.sucesso),
            if (p.jaExistem > 0)
              _Numero(rotulo: 'já estão na base', valor: p.jaExistem),
            if (p.invalidos > 0)
              _Numero(
                rotulo: 'sem telefone válido',
                valor: p.invalidos,
                tom: TomPilula.erro,
              ),
          ],
        ),
        const SizedBox(height: 14),
        if (p.validos == 0)
          const Aviso(
            tom: TomPilula.erro,
            icone: Icons.error_outline_rounded,
            texto:
                'Nenhum número válido. Confira se o arquivo tem uma coluna de telefone com DDD.',
          )
        else ...[
          if (p.extras.isNotEmpty)
            Padding(
              key: const ValueKey('extras'),
              padding: const EdgeInsets.only(bottom: 10),
              child: Text.rich(
                TextSpan(
                  children: [
                    const TextSpan(text: 'Também vêm da planilha: '),
                    TextSpan(
                      text: p.extras.join(', '),
                      style: TextStyle(
                        color: c.tinta,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const TextSpan(
                      text:
                          '. Quem já está na base ganha o histórico de compra novo; e-mail e aniversário só preenchem o que estiver vazio.',
                    ),
                  ],
                ),
                style: TextStyle(
                  color: c.tintaSuave,
                  fontSize: 13,
                  height: 1.45,
                ),
              ),
            ),
          if (p.assumiramPais > 0)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Aviso(
                icone: Icons.flag_outlined,
                texto:
                    '${p.assumiramPais == 1 ? '1 número estava' : '${f.numero(p.assumiramPais)} números estavam'} sem o código do país. Acrescentamos o 55 (Brasil). Confira na lista abaixo — se algum for de fora, corrija no arquivo e importe de novo.',
              ),
            ),
          if (p.truncado)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Aviso(
                icone: Icons.content_cut_rounded,
                texto:
                    'O arquivo tem mais de ${f.numero(p.limite)} contatos. Vamos importar os primeiros ${f.numero(p.limite)}; para o resto, divida o arquivo e importe de novo.',
              ),
            ),
          if (p.contatos.length > p.porEnvio)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Aviso(
                tom: TomPilula.acento,
                icone: Icons.hourglass_top_rounded,
                texto:
                    'São ${f.numero(p.contatos.length)} contatos: vamos gravar em partes de ${f.numero(p.porEnvio)}, num registro só de importação. Mantenha esta tela aberta até terminar.',
              ),
            ),
          if (p.jaExistem > 0)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Text(
                'Quem já está na base não é duplicado — só entra na lista escolhida.',
                style: TextStyle(
                  color: c.tintaSuave,
                  fontSize: 12.5,
                  height: 1.4,
                ),
              ),
            ),
          Cartao(
            padding: EdgeInsets.zero,
            child: Column(
              children: [
                for (var i = 0; i < amostra.length; i++) ...[
                  if (i > 0) Divider(height: 1, indent: 16, color: c.borda),
                  Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 16,
                      vertical: 9,
                    ),
                    child: Row(
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              if (amostra[i].nome.trim().isNotEmpty)
                                Text(
                                  amostra[i].nome,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(fontSize: 13.5),
                                ),
                              // O número inteiro: é aqui que a pessoa confere
                              // o 55 acrescentado.
                              Text(
                                f.telefone(amostra[i].telefone),
                                style: TextStyle(
                                  fontSize: 13,
                                  color: amostra[i].nome.trim().isEmpty
                                      ? c.tinta
                                      : c.tintaSuave,
                                  fontFeatures: const [
                                    FontFeature.tabularFigures(),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(width: 8),
                        Text(
                          !amostra[i].novo
                              ? 'já está na base'
                              : amostra[i].assumiuPais
                              ? '55 acrescentado'
                              : 'entra',
                          style: TextStyle(color: c.tintaSuave, fontSize: 12),
                        ),
                      ],
                    ),
                  ),
                ],
                if (p.contatos.length > amostra.length)
                  Padding(
                    padding: const EdgeInsets.all(12),
                    child: Text(
                      'e mais ${f.numero(p.contatos.length - amostra.length)}',
                      style: TextStyle(color: c.tintaSuave, fontSize: 12.5),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 20),
          Text(
            'Colocar numa lista',
            style: Theme.of(context).textTheme.titleSmall,
          ),
          const SizedBox(height: 8),
          DropdownButtonFormField<String>(
            initialValue: _destino,
            isExpanded: true,
            dropdownColor: c.superficie,
            items: [
              const DropdownMenuItem(
                value: _semLista,
                child: Text('Só na base, sem lista'),
              ),
              for (final l in listas)
                DropdownMenuItem(
                  value: l.id,
                  child: Text(
                    '${l.nome} (${f.numero(l.total)})',
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              const DropdownMenuItem(
                value: _novaLista,
                child: Text('＋ Criar lista nova'),
              ),
            ],
            onChanged: _ocupado
                ? null
                : (v) => setState(() => _destino = v ?? _semLista),
          ),
          if (_destino == _novaLista) ...[
            const SizedBox(height: 10),
            TextField(
              controller: _nomeLista,
              maxLength: 120,
              decoration: const InputDecoration(
                labelText: 'Nome da lista nova',
              ),
            ),
          ],
          const SizedBox(height: 16),
          Cartao(
            destaque: true,
            padding: const EdgeInsets.fromLTRB(6, 6, 16, 12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                CheckboxListTile(
                  key: const ValueKey('consentimento'),
                  value: _consentimento,
                  onChanged: _ocupado
                      ? null
                      : (v) => setState(() => _consentimento = v ?? false),
                  controlAffinity: ListTileControlAffinity.leading,
                  contentPadding: EdgeInsets.zero,
                  title: const Text(
                    'Declaro que estas pessoas autorizaram receber mensagens desta empresa no WhatsApp.',
                    style: TextStyle(fontSize: 14, height: 1.4),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.only(left: 10),
                  child: Text(
                    'É a regra da Meta para mensagem iniciada pela empresa. Mandar para quem não autorizou gera bloqueios e derruba a qualidade do seu número.',
                    style: TextStyle(
                      color: c.tintaSuave,
                      fontSize: 12.5,
                      height: 1.45,
                    ),
                  ),
                ),
                const SizedBox(height: 10),
                Padding(
                  padding: const EdgeInsets.only(left: 10),
                  child: TextField(
                    controller: _evidencia,
                    maxLength: 500,
                    decoration: const InputDecoration(
                      labelText: 'Como autorizaram? (opcional)',
                      hintText:
                          'Cadastro na loja, formulário do site, aceite no atendimento…',
                      helperText:
                          'Fica gravado junto de cada contato. É o que sustenta a campanha se a Meta perguntar — e ela pergunta.',
                      helperMaxLines: 3,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
        if (_erro != null) ...[
          const SizedBox(height: 14),
          Aviso(
            tom: TomPilula.erro,
            icone: Icons.error_outline_rounded,
            texto: _erro!,
          ),
        ],
      ],
    );
  }
}

class _Numero extends StatelessWidget {
  const _Numero({required this.rotulo, required this.valor, this.tom});

  final String rotulo;
  final int valor;
  final TomPilula? tom;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final cor = switch (tom) {
      TomPilula.sucesso => c.sucesso,
      TomPilula.erro => c.erro,
      _ => c.tinta,
    };
    return Cartao(
      padding: const EdgeInsets.fromLTRB(14, 10, 14, 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            f.numero(valor),
            style: TextStyle(
              fontSize: 20,
              fontWeight: FontWeight.w700,
              color: cor,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
          Text(rotulo, style: TextStyle(color: c.tintaSuave, fontSize: 12)),
        ],
      ),
    );
  }
}

/// O que entrou — e o próximo passo: dividir em blocos (o caminho de quem
/// importou a agenda do celular, só com nome e número) ou importar mais.
class _Resultado extends StatelessWidget {
  const _Resultado({
    required this.resultado,
    required this.previa,
    required this.aoDividir,
    required this.aoImportarMais,
  });

  final ResultadoImportacao resultado;
  final PreviaImportacao previa;
  final void Function(PreviaImportacao previa, String importacaoId) aoDividir;
  final VoidCallback aoImportarMais;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final r = resultado;
    final importacaoId = r.importacaoId;
    final podeDividir = importacaoId != null && r.gravados + r.jaExistiam > 0;
    final soNomeENumero = previa.soNomeENumero;
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 24, 20, 28),
      children: [
        Icon(Icons.check_circle_rounded, color: c.sucesso, size: 56),
        const SizedBox(height: 14),
        Text(
          r.gravados == 1
              ? '1 contato entrou na sua base'
              : '${f.numero(r.gravados)} contatos entraram na sua base',
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.titleLarge,
        ),
        if (r.jaExistiam > 0) ...[
          const SizedBox(height: 6),
          Text(
            '${f.plural(r.jaExistiam, 'já estava', 'já estavam')} lá e não ${r.jaExistiam == 1 ? 'foi duplicado' : 'foram duplicados'}.',
            textAlign: TextAlign.center,
            style: TextStyle(color: c.tintaSuave),
          ),
        ],
        if (podeDividir && soNomeENumero) ...[
          const SizedBox(height: 18),
          Text(
            'Lista só com nome e número — como a agenda exportada do celular? Divida em blocos para enviar aos poucos, dentro do limite do seu número, e acompanhar o resultado de cada bloco.',
            textAlign: TextAlign.center,
            style: TextStyle(color: c.tintaSuave, height: 1.45),
          ),
        ],
        const SizedBox(height: 20),
        if (podeDividir)
          soNomeENumero
              ? FilledButton.icon(
                  key: const ValueKey('dividir-importacao'),
                  onPressed: () => aoDividir(previa, importacaoId),
                  icon: const Icon(Icons.view_module_outlined),
                  label: const Text('Dividir em blocos'),
                )
              : OutlinedButton.icon(
                  key: const ValueKey('dividir-importacao'),
                  onPressed: () => aoDividir(previa, importacaoId),
                  icon: const Icon(Icons.view_module_outlined),
                  label: const Text('Dividir em blocos'),
                ),
        const SizedBox(height: 8),
        OutlinedButton(
          key: const ValueKey('importar-mais'),
          onPressed: aoImportarMais,
          child: const Text('Importar mais'),
        ),
        const SizedBox(height: 18),
        Text(
          'Para mandar uma campanha a eles, monte-a em Campanhas e escolha a lista — ou um dos blocos.',
          textAlign: TextAlign.center,
          style: TextStyle(color: c.tintaSuave, fontSize: 13, height: 1.45),
        ),
      ],
    );
  }
}
