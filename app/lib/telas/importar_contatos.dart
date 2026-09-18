import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/contatos.dart';
import '../api/erro_api.dart';
import '../componentes/basicos.dart';
import '../tema/cores.dart';
import '../util/formato.dart' as f;

/// Importar contatos em três passos: de onde vêm, o que o servidor leu, e o
/// resultado.
///
/// Nada é gravado antes do último toque. A prévia existe para a pessoa ver o
/// que o arquivo realmente tinha (quantos números valem, quantos já estavam na
/// base) antes de assumir o compromisso do consentimento.
///
/// Devolve (pop) `true` quando gravou.
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
  String _destino = _semLista;
  bool _consentimento = false;
  bool _ocupado = false;
  String? _erro;

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
      final r = await servico.importar(
        previa: previa,
        consentimento: _consentimento,
        evidencia: _evidencia.text,
        listaId: listaId,
      );
      if (!mounted) return;
      ref.invalidate(listasContatosProvider);
      setState(() => _resultado = r);
    } catch (e) {
      if (mounted) setState(() => _erro = mensagemDoErro(e));
    } finally {
      if (mounted) setState(() => _ocupado = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final titulo = _resultado != null
        ? 'Importação concluída'
        : _previa != null
        ? 'Conferir e importar'
        : 'Importar contatos';
    return PopScope(
      canPop: _resultado == null,
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
            ? _Resultado(resultado: _resultado!)
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
    const girando = SizedBox(
      width: 18,
      height: 18,
      child: CircularProgressIndicator(strokeWidth: 2),
    );

    if (_resultado != null) {
      return embrulhar(
        FilledButton(
          onPressed: () => Navigator.of(context).pop(true),
          child: const Text('Concluir'),
        ),
      );
    }
    final p = _previa;
    if (p == null || p.validos == 0) return null;
    final n = p.contatos.length;
    return embrulhar(
      FilledButton(
        onPressed: _ocupado || !_consentimento ? null : _gravar,
        child: _ocupado
            ? girando
            : Text('Importar ${f.plural(n, 'contato', 'contatos')}'),
      ),
    );
  }

  Widget _passoOrigem(BuildContext context) {
    final c = Cores.de(context);
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
                      style: TextStyle(fontWeight: FontWeight.w600, fontSize: 15),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      'Contatos do celular (.vcf), planilha (.csv, .xlsx) ou .txt — até 5 MB.',
                      style: TextStyle(color: c.tintaSuave, fontSize: 13, height: 1.4),
                    ),
                  ],
                ),
              ),
              Icon(Icons.chevron_right_rounded, color: c.tintaSuave),
            ],
          ),
        ),
        const SizedBox(height: 20),
        Text('Ou cole os números', style: Theme.of(context).textTheme.titleSmall),
        const SizedBox(height: 8),
        TextField(
          controller: _texto,
          minLines: 5,
          maxLines: 10,
          keyboardType: TextInputType.multiline,
          decoration: const InputDecoration(
            hintText: 'Um por linha. Pode ter o nome antes:\nMaria, 11 99999-8888\n5521988887777',
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
          Aviso(tom: TomPilula.erro, icone: Icons.error_outline_rounded, texto: _erro!),
        ],
      ],
    );
  }

  Widget _passoPrevia(BuildContext context, PreviaImportacao p) {
    final c = Cores.de(context);
    final listas = ref.watch(listasContatosProvider).value ?? const <ListaContatos>[];
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
            _Numero(rotulo: 'válidos', valor: p.validos, tom: TomPilula.sucesso),
            _Numero(rotulo: 'novos', valor: p.novos),
            _Numero(rotulo: 'já na base', valor: p.jaExistem),
            if (p.invalidos > 0)
              _Numero(rotulo: 'inválidos', valor: p.invalidos, tom: TomPilula.erro),
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
          if (p.truncado)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Aviso(
                icone: Icons.content_cut_rounded,
                texto:
                    'Cada importação aceita até ${f.numero(p.limite)} contatos. Entram os primeiros ${f.numero(p.limite)}; importe o resto em outra vez.',
              ),
            ),
          if (p.assumiramPais > 0)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Aviso(
                icone: Icons.flag_outlined,
                texto:
                    '${f.plural(p.assumiramPais, 'número veio', 'números vieram')} sem o código do país. Consideramos Brasil (+55).',
              ),
            ),
          if (p.jaExistem > 0)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Text(
                'Quem já está na base não é duplicado — só entra na lista escolhida.',
                style: TextStyle(color: c.tintaSuave, fontSize: 12.5, height: 1.4),
              ),
            ),
          Cartao(
            padding: EdgeInsets.zero,
            child: Column(
              children: [
                for (var i = 0; i < amostra.length; i++) ...[
                  if (i > 0) Divider(height: 1, indent: 16, color: c.borda),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 9),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(
                            amostra[i].nome.trim().isEmpty
                                ? f.telefone(amostra[i].telefone)
                                : '${amostra[i].nome} · ${f.telefone(amostra[i].telefone)}',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(fontSize: 13.5),
                          ),
                        ),
                        if (!amostra[i].novo)
                          Text(
                            'já na base',
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
          Text('Colocar numa lista', style: Theme.of(context).textTheme.titleSmall),
          const SizedBox(height: 8),
          DropdownButtonFormField<String>(
            initialValue: _destino,
            isExpanded: true,
            dropdownColor: c.superficie,
            items: [
              const DropdownMenuItem(value: _semLista, child: Text('Só na base, sem lista')),
              for (final l in listas)
                DropdownMenuItem(
                  value: l.id,
                  child: Text(
                    '${l.nome} (${f.numero(l.total)})',
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              const DropdownMenuItem(value: _novaLista, child: Text('＋ Criar lista nova')),
            ],
            onChanged: _ocupado ? null : (v) => setState(() => _destino = v ?? _semLista),
          ),
          if (_destino == _novaLista) ...[
            const SizedBox(height: 10),
            TextField(
              controller: _nomeLista,
              maxLength: 120,
              decoration: const InputDecoration(labelText: 'Nome da lista nova'),
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
                  value: _consentimento,
                  onChanged: _ocupado
                      ? null
                      : (v) => setState(() => _consentimento = v ?? false),
                  controlAffinity: ListTileControlAffinity.leading,
                  contentPadding: EdgeInsets.zero,
                  title: const Text(
                    'Estas pessoas autorizaram receber mensagens da minha empresa pelo WhatsApp.',
                    style: TextStyle(fontSize: 14, height: 1.4),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.only(left: 10),
                  child: Text(
                    'É a regra da Meta para mensagem iniciada pela empresa. Mandar para quem não autorizou gera bloqueios e derruba a qualidade do seu número.',
                    style: TextStyle(color: c.tintaSuave, fontSize: 12.5, height: 1.45),
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
                      hintText: 'Ex.: cadastro na loja, formulário do site',
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
        if (_erro != null) ...[
          const SizedBox(height: 14),
          Aviso(tom: TomPilula.erro, icone: Icons.error_outline_rounded, texto: _erro!),
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

class _Resultado extends StatelessWidget {
  const _Resultado({required this.resultado});

  final ResultadoImportacao resultado;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 24, 20, 28),
      children: [
        Icon(Icons.check_circle_rounded, color: c.sucesso, size: 56),
        const SizedBox(height: 14),
        Text(
          f.plural(resultado.gravados, 'contato novo na base', 'contatos novos na base'),
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.titleLarge,
        ),
        if (resultado.jaExistiam > 0) ...[
          const SizedBox(height: 6),
          Text(
            '${f.plural(resultado.jaExistiam, 'já estava', 'já estavam')} na base e não ${resultado.jaExistiam == 1 ? 'foi duplicado' : 'foram duplicados'}.',
            textAlign: TextAlign.center,
            style: TextStyle(color: c.tintaSuave),
          ),
        ],
        const SizedBox(height: 18),
        Text(
          'Para mandar uma campanha a eles, monte-a pelo site escolhendo a lista.',
          textAlign: TextAlign.center,
          style: TextStyle(color: c.tintaSuave, height: 1.45),
        ),
      ],
    );
  }
}
