import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/conta.dart';
import '../api/erro_api.dart';
import '../componentes/basicos.dart';
import '../componentes/dialogos.dart';
import '../sessao/sessao.dart';
import '../tema/cores.dart';

/// Os dados da empresa e a senha de quem está logado.
///
/// Nome, CNPJ e fuso são do dono; o operador vê, mas não muda. O fuso não é
/// detalhe: é por ele que a janela de envio das campanhas é contada.
class TelaConta extends ConsumerWidget {
  const TelaConta({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = Cores.de(context);
    final carga = ref.watch(dadosContaProvider);
    final sessao = ref.watch(sessaoProvider);
    final ehDono = sessao is SessaoAtiva && sessao.sessao.usuario.ehDono;

    return Scaffold(
      appBar: AppBar(title: const Text('Conta')),
      body: carga.when(
        loading: () => const Padding(
          padding: EdgeInsets.all(20),
          child: Cartao(child: Esqueleto(altura: 200)),
        ),
        error: (e, _) => Padding(
          padding: const EdgeInsets.all(20),
          child: EstadoErro(
            titulo: 'Não consegui ler a conta',
            mensagem: mensagemDoErro(e),
            aoTentar: () => ref.invalidate(dadosContaProvider),
          ),
        ),
        data: (d) => ListView(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 28),
          children: [
            _FormularioConta(dados: d, editavel: ehDono),
            const SizedBox(height: 24),
            Text('Sua senha', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 6),
            Text(
              'Trocar a senha encerra a sessão em todos os aparelhos, inclusive neste.',
              style: TextStyle(color: c.tintaSuave, fontSize: 13, height: 1.45),
            ),
            const SizedBox(height: 10),
            OutlinedButton.icon(
              onPressed: () => showModalBottomSheet<void>(
                context: context,
                isScrollControlled: true,
                showDragHandle: true,
                backgroundColor: c.superficie,
                builder: (_) => const _TrocarSenha(),
              ),
              icon: const Icon(Icons.key_rounded),
              label: const Text('Trocar senha'),
            ),
          ],
        ),
      ),
    );
  }
}

class _FormularioConta extends ConsumerStatefulWidget {
  const _FormularioConta({required this.dados, required this.editavel});

  final DadosConta dados;
  final bool editavel;

  @override
  ConsumerState<_FormularioConta> createState() => _FormularioContaState();
}

class _FormularioContaState extends ConsumerState<_FormularioConta> {
  late final _nome = TextEditingController(text: widget.dados.nome);
  late final _cnpj = TextEditingController(
    text: _mascararCnpj(widget.dados.cnpj),
  );
  late String _fuso = widget.dados.timezone;
  bool _salvando = false;

  static String _mascararCnpj(String? v) {
    final d = (v ?? '').replaceAll(RegExp(r'\D'), '');
    if (d.length != 14) return v ?? '';
    return '${d.substring(0, 2)}.${d.substring(2, 5)}.${d.substring(5, 8)}/${d.substring(8, 12)}-${d.substring(12)}';
  }

  @override
  void dispose() {
    _nome.dispose();
    _cnpj.dispose();
    super.dispose();
  }

  Future<void> _salvar() async {
    FocusScope.of(context).unfocus();
    setState(() => _salvando = true);
    try {
      await ref
          .read(servicoContaProvider)
          .atualizar(nome: _nome.text, cnpj: _cnpj.text, timezone: _fuso);
      if (!mounted) return;
      avisar(context, 'Dados da conta salvos.');
      ref.invalidate(dadosContaProvider);
    } catch (e) {
      if (mounted) avisar(context, mensagemDoErro(e));
    } finally {
      if (mounted) setState(() => _salvando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final fusos = {
      ...fusosBrasil,
      // Fuso de fora do Brasil, escolhido no site: aparece como está.
      if (!fusosBrasil.containsKey(_fuso)) _fuso: _fuso,
    };
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('Empresa', style: Theme.of(context).textTheme.titleMedium),
        if (!widget.editavel)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(
              'Só o dono da conta muda estes dados.',
              style: TextStyle(color: c.tintaSuave, fontSize: 13),
            ),
          ),
        const SizedBox(height: 12),
        TextField(
          controller: _nome,
          enabled: widget.editavel,
          maxLength: 120,
          decoration: const InputDecoration(labelText: 'Nome da empresa'),
        ),
        const SizedBox(height: 4),
        TextField(
          controller: _cnpj,
          enabled: widget.editavel,
          keyboardType: TextInputType.number,
          maxLength: 18,
          decoration: const InputDecoration(
            labelText: 'CNPJ (opcional)',
            hintText: '00.000.000/0000-00',
          ),
        ),
        const SizedBox(height: 4),
        DropdownButtonFormField<String>(
          initialValue: _fuso,
          isExpanded: true,
          dropdownColor: c.superficie,
          decoration: const InputDecoration(
            labelText: 'Fuso horário',
            helperText:
                'As janelas de envio das campanhas seguem este horário.',
          ),
          items: [
            for (final e in fusos.entries)
              DropdownMenuItem(
                value: e.key,
                child: Text(e.value, overflow: TextOverflow.ellipsis),
              ),
          ],
          onChanged: widget.editavel
              ? (v) => setState(() => _fuso = v ?? _fuso)
              : null,
        ),
        if (widget.editavel) ...[
          const SizedBox(height: 16),
          FilledButton(
            onPressed: _salvando ? null : _salvar,
            child: _salvando
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Text('Salvar dados'),
          ),
        ],
      ],
    );
  }
}

class _TrocarSenha extends ConsumerStatefulWidget {
  const _TrocarSenha();

  @override
  ConsumerState<_TrocarSenha> createState() => _TrocarSenhaState();
}

class _TrocarSenhaState extends ConsumerState<_TrocarSenha> {
  final _atual = TextEditingController();
  final _nova = TextEditingController();
  final _repetir = TextEditingController();
  bool _enviando = false;
  String? _erro;

  @override
  void dispose() {
    _atual.dispose();
    _nova.dispose();
    _repetir.dispose();
    super.dispose();
  }

  /// A mesma regra do servidor (`SenhaForte`), para o erro vir antes do envio.
  String? _conferir() {
    final nova = _nova.text;
    if (_atual.text.isEmpty) return 'Informe a senha atual.';
    if (nova.length < 10 ||
        !RegExp(r'[A-Za-zÀ-ÿ]').hasMatch(nova) ||
        !RegExp(r'\d').hasMatch(nova)) {
      return 'A senha nova precisa de ao menos 10 caracteres, com letra e número.';
    }
    if (nova != _repetir.text) return 'As duas senhas novas não são iguais.';
    return null;
  }

  Future<void> _trocar() async {
    final problema = _conferir();
    if (problema != null) {
      setState(() => _erro = problema);
      return;
    }
    setState(() {
      _enviando = true;
      _erro = null;
    });
    try {
      await ref.read(servicoContaProvider).trocarSenha(_atual.text, _nova.text);
      if (!mounted) return;
      Navigator.of(context).popUntil((r) => r.isFirst);
      await ref.read(sessaoProvider.notifier).encerrarAposTrocaDeSenha();
    } catch (e) {
      if (mounted) {
        setState(() {
          _erro = mensagemDoErro(e);
          _enviando = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    return Padding(
      padding: EdgeInsets.fromLTRB(
        20,
        0,
        20,
        20 + MediaQuery.viewInsetsOf(context).bottom,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Trocar senha', style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 14),
          TextField(
            controller: _atual,
            obscureText: true,
            autofillHints: const [AutofillHints.password],
            decoration: const InputDecoration(labelText: 'Senha atual'),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _nova,
            obscureText: true,
            autofillHints: const [AutofillHints.newPassword],
            decoration: const InputDecoration(
              labelText: 'Senha nova',
              helperText: 'Ao menos 10 caracteres, com letra e número.',
            ),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _repetir,
            obscureText: true,
            decoration: const InputDecoration(labelText: 'Repita a senha nova'),
          ),
          if (_erro != null) ...[
            const SizedBox(height: 10),
            Text(_erro!, style: TextStyle(color: c.erro)),
          ],
          const SizedBox(height: 16),
          FilledButton(
            onPressed: _enviando ? null : _trocar,
            child: _enviando
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Text('Trocar e entrar de novo'),
          ),
        ],
      ),
    );
  }
}
