import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/conta.dart';
import '../api/erro_api.dart';
import '../api/leituras.dart';
import '../api/seguranca.dart';
import '../componentes/basicos.dart';
import '../componentes/dialogos.dart';
import '../sessao/sessao.dart';
import '../tema/cores.dart';
import '../util/senha.dart';
import 'seguranca.dart';

/// A conta e o acesso de quem está logado — a página "Conta e usuários" do
/// site (`(app)/conta/page.tsx`), menos as pessoas, que têm tela própria no
/// "Mais": a situação da conta, os dados da empresa, a senha e a verificação
/// em duas etapas.
///
/// Nome, fuso e descanso são do dono; o operador vê, mas não muda. O fuso não
/// é detalhe: é por ele que a janela de envio das campanhas é contada.
class TelaConta extends ConsumerWidget {
  const TelaConta({super.key});

  static TomPilula _tomDaSituacao(String status) => switch (status) {
    'ativa' => TomPilula.sucesso,
    'suspensa' => TomPilula.atencao,
    'cancelada' => TomPilula.erro,
    _ => TomPilula.acento,
  };

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final carga = ref.watch(dadosContaProvider);
    final estado = ref.watch(sessaoProvider);
    final sessao = estado is SessaoAtiva ? estado.sessao : null;
    final ehDono = sessao?.usuario.ehDono ?? false;
    // Com a conta ainda carregando (ou se a leitura falhar), a situação vem
    // da sessão: o selo continua verdadeiro — como no site.
    final status = carga.value?.status ?? sessao?.conta.status ?? 'ativa';

    return Scaffold(
      appBar: AppBar(title: const Text('Conta')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 28),
        children: [
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              Pilula(
                rotuloDaSituacaoDaConta(status),
                key: ValueKey('situacao-$status'),
                tom: _tomDaSituacao(status),
              ),
              Pilula(
                ehDono ? 'Você é o dono' : 'Você é operador',
                tom: ehDono ? TomPilula.acento : TomPilula.neutro,
                ponto: false,
              ),
            ],
          ),
          const SizedBox(height: 18),
          carga.when(
            loading: () => const Cartao(child: Esqueleto(altura: 200)),
            error: (e, _) => EstadoErro(
              titulo: 'Não consegui ler a conta',
              mensagem: mensagemDoErro(e),
              aoTentar: () => ref.invalidate(dadosContaProvider),
            ),
            data: (d) => _FormularioConta(dados: d, editavel: ehDono),
          ),
          const SizedBox(height: 26),
          const _Senha(),
          const SizedBox(height: 26),
          const _ResumoDaSeguranca(),
        ],
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
  late final _descanso = TextEditingController(
    text: '${widget.dados.descansoMarketingDias ?? 3}',
  );
  late String _fuso = widget.dados.timezone;
  String? _erroDescanso;
  bool _salvando = false;

  static String _mascararCnpj(String v) {
    final c = v.replaceAll(RegExp(r'[^0-9A-Za-z]'), '').toUpperCase();
    if (c.length != 14) return v;
    return '${c.substring(0, 2)}.${c.substring(2, 5)}.${c.substring(5, 8)}/${c.substring(8, 12)}-${c.substring(12)}';
  }

  @override
  void initState() {
    super.initState();
    _nome.addListener(_mudou);
    _descanso.addListener(_mudou);
  }

  void _mudou() => setState(() {});

  @override
  void dispose() {
    _nome.dispose();
    _descanso.dispose();
    super.dispose();
  }

  bool get _temDescanso => widget.dados.descansoMarketingDias != null;

  bool get _alterado =>
      _nome.text.trim() != widget.dados.nome ||
      _fuso != widget.dados.timezone ||
      (_temDescanso &&
          _descanso.text.trim() != '${widget.dados.descansoMarketingDias}');

  void _descartar() {
    _nome.text = widget.dados.nome;
    _descanso.text = '${widget.dados.descansoMarketingDias ?? 3}';
    setState(() {
      _fuso = widget.dados.timezone;
      _erroDescanso = null;
    });
  }

  Future<void> _salvar() async {
    FocusScope.of(context).unfocus();
    int? descanso;
    if (_temDescanso) {
      descanso = int.tryParse(_descanso.text.trim());
      if (descanso == null || descanso < 0 || descanso > 30) {
        setState(
          () => _erroDescanso =
              'O descanso entre campanhas vai de 0 (desligado) a 30 dias.',
        );
        return;
      }
    }
    setState(() {
      _erroDescanso = null;
      _salvando = true;
    });
    try {
      await ref
          .read(servicoContaProvider)
          .atualizar(
            nome: _nome.text,
            timezone: _fuso,
            descansoMarketingDias: descanso,
          );
      if (!mounted) return;
      avisar(context, 'Dados da conta atualizados.');
      ref.invalidate(dadosContaProvider);
      // O nome da empresa aparece no Painel.
      ref.invalidate(resumoContaProvider);
    } catch (e) {
      if (mounted) avisar(context, mensagemDoErro(e));
    } finally {
      if (mounted) setState(() => _salvando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final cnpj = widget.dados.cnpj;
    final fusos = {
      ...fusosBrasil,
      // Fuso de fora do Brasil, escolhido no site: aparece como está.
      if (!fusosBrasil.containsKey(_fuso)) _fuso: _fuso,
    };
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('Dados da conta', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 4),
        Text(
          widget.editavel
              ? 'O fuso define a virada do ciclo e a janela de envio das campanhas.'
              : 'Só o dono da conta altera estes dados. Fale com quem administra a sua empresa.',
          style: TextStyle(color: c.tintaSuave, fontSize: 13, height: 1.45),
        ),
        const SizedBox(height: 14),
        TextField(
          key: const ValueKey('conta-nome'),
          controller: _nome,
          enabled: widget.editavel,
          maxLength: 120,
          textCapitalization: TextCapitalization.words,
          decoration: const InputDecoration(labelText: 'Nome da empresa'),
        ),
        const SizedBox(height: 4),
        DropdownButtonFormField<String>(
          key: const ValueKey('conta-fuso'),
          initialValue: _fuso,
          isExpanded: true,
          dropdownColor: c.superficie,
          decoration: InputDecoration(
            labelText: 'Fuso horário',
            helperText: 'Horário de referência: $_fuso.',
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
        if (_temDescanso) ...[
          const SizedBox(height: 18),
          TextField(
            key: const ValueKey('conta-descanso'),
            controller: _descanso,
            enabled: widget.editavel,
            keyboardType: TextInputType.number,
            inputFormatters: [
              FilteringTextInputFormatter.digitsOnly,
              LengthLimitingTextInputFormatter(2),
            ],
            decoration: InputDecoration(
              labelText: 'Descanso entre campanhas (dias)',
              errorText: _erroDescanso,
              errorMaxLines: 3,
              helperMaxLines: 6,
              helperText:
                  'Quem recebeu campanha de marketing nesse prazo fica de fora da próxima — a Meta segura o marketing de quem recebe demais, e isso derruba a qualidade do número. 0 desliga. Vale para as campanhas criadas daqui em diante.',
            ),
          ),
        ],
        if (cnpj != null && cnpj.isNotEmpty) ...[
          const SizedBox(height: 16),
          Container(
            key: const ValueKey('conta-cnpj'),
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: c.superficie2,
              borderRadius: BorderRadius.circular(14),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'CNPJ',
                  style: TextStyle(color: c.tintaSuave, fontSize: 12.5),
                ),
                const SizedBox(height: 2),
                Text(
                  _mascararCnpj(cnpj),
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  'É a identidade da conta na Meta. Para trocar (mudança na empresa), fale com o suporte.',
                  style: TextStyle(
                    color: c.tintaSuave,
                    fontSize: 12.5,
                    height: 1.4,
                  ),
                ),
              ],
            ),
          ),
        ],
        if (widget.editavel) ...[
          const SizedBox(height: 16),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              FilledButton(
                key: const ValueKey('salvar-conta'),
                style: FilledButton.styleFrom(minimumSize: const Size(0, 44)),
                onPressed: _salvando || !_alterado ? null : _salvar,
                child: _salvando
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Text('Salvar alterações'),
              ),
              if (_alterado && !_salvando)
                TextButton(
                  key: const ValueKey('descartar-conta'),
                  onPressed: _descartar,
                  child: const Text('Descartar'),
                ),
            ],
          ),
        ],
      ],
    );
  }
}

// ------------------------------------------------------------------ senha

class _Senha extends StatelessWidget {
  const _Senha();

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('Senha', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 4),
        Text(
          'Trocar a senha encerra as sessões abertas em todos os aparelhos, inclusive neste.',
          style: TextStyle(color: c.tintaSuave, fontSize: 13, height: 1.45),
        ),
        const SizedBox(height: 10),
        Align(
          alignment: Alignment.centerLeft,
          child: OutlinedButton.icon(
            key: const ValueKey('trocar-senha'),
            style: OutlinedButton.styleFrom(minimumSize: const Size(0, 44)),
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
        ),
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

  /// A regra do site e do servidor (`util/senha.dart`), para o erro vir antes
  /// do envio.
  String? _conferir() {
    if (_atual.text.isEmpty) return 'Informe a senha atual.';
    final problema = erroDaSenha(_nova.text, rotulo: 'A senha nova');
    if (problema != null) return problema;
    if (_nova.text != _repetir.text) {
      return 'As duas senhas novas não são iguais.';
    }
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
            key: const ValueKey('senha-atual'),
            controller: _atual,
            obscureText: true,
            autofillHints: const [AutofillHints.password],
            decoration: const InputDecoration(labelText: 'Senha atual'),
          ),
          const SizedBox(height: 10),
          TextField(
            key: const ValueKey('senha-nova'),
            controller: _nova,
            obscureText: true,
            autofillHints: const [AutofillHints.newPassword],
            decoration: const InputDecoration(
              labelText: 'Senha nova',
              helperText: ajudaSenha,
              helperMaxLines: 2,
            ),
          ),
          const SizedBox(height: 10),
          TextField(
            key: const ValueKey('senha-repetir'),
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
            key: const ValueKey('salvar-senha'),
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

// -------------------------------------------------------------- segurança

/// A verificação em duas etapas numa linha: a situação e o caminho para a
/// tela onde se liga e desliga.
class _ResumoDaSeguranca extends ConsumerWidget {
  const _ResumoDaSeguranca();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = Cores.de(context);
    final carga = ref.watch(situacaoSegurancaProvider);
    final s = carga.value;

    final Widget situacao;
    if (s != null) {
      situacao = s.ligada
          ? Pilula(
              'Protegido · ${s.peloAplicativo ? 'aplicativo' : 'e-mail'}',
              key: const ValueKey('seguranca-ligada'),
              tom: TomPilula.sucesso,
            )
          : const Pilula(
              'Só senha',
              key: ValueKey('seguranca-desligada'),
              tom: TomPilula.atencao,
            );
    } else if (carga.hasError) {
      situacao = Text(
        'Não consegui ler a situação agora.',
        style: TextStyle(color: c.tintaSuave, fontSize: 12.5),
      );
    } else {
      situacao = const Esqueleto(altura: 22, largura: 120);
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          'Segurança do seu acesso',
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: 4),
        Text(
          'Além da senha, um código a cada login. Cada pessoa liga a sua.',
          style: TextStyle(color: c.tintaSuave, fontSize: 13, height: 1.45),
        ),
        const SizedBox(height: 10),
        Cartao(
          key: const ValueKey('abrir-seguranca'),
          padding: const EdgeInsets.fromLTRB(16, 14, 10, 14),
          aoTocar: () => Navigator.of(context).push(
            MaterialPageRoute<void>(builder: (_) => const TelaSeguranca()),
          ),
          child: Row(
            children: [
              Icon(Icons.verified_user_outlined, color: c.tinta),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Verificação em duas etapas',
                      style: TextStyle(fontWeight: FontWeight.w600),
                    ),
                    const SizedBox(height: 6),
                    situacao,
                  ],
                ),
              ),
              Icon(Icons.chevron_right_rounded, color: c.tintaSuave),
            ],
          ),
        ),
      ],
    );
  }
}
