import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/conta.dart';
import '../api/erro_api.dart';
import '../componentes/basicos.dart';
import '../componentes/dialogos.dart';
import '../sessao/sessao.dart';
import '../tema/cores.dart';
import '../util/formato.dart' as f;

/// Quem tem acesso à conta.
///
/// O dono cria operadores, suspende e remove. Operador enxerga a lista, mas
/// não mexe. Ninguém cria um segundo dono — o servidor nem aceita.
class TelaUsuarios extends ConsumerWidget {
  const TelaUsuarios({super.key});

  Future<void> _novo(BuildContext context, WidgetRef ref) async {
    final c = Cores.de(context);
    final criou = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      backgroundColor: c.superficie,
      builder: (_) => const _NovoUsuario(),
    );
    if (criou == true && context.mounted) {
      avisar(context, 'Acesso criado. Passe o e-mail e a senha para a pessoa.');
      ref.invalidate(usuariosProvider);
    }
  }

  Future<void> _suspender(
    BuildContext context,
    WidgetRef ref,
    UsuarioConta u,
  ) async {
    final suspender = !u.suspenso;
    if (suspender) {
      final ok = await confirmar(
        context,
        titulo: 'Suspender ${u.nome}?',
        texto:
            'A pessoa sai na hora de todos os aparelhos e não entra mais até você reativar.',
        botao: 'Suspender',
        perigo: true,
      );
      if (!ok || !context.mounted) return;
    }
    try {
      await ref.read(servicoContaProvider).suspender(u.id, suspenso: suspender);
      if (!context.mounted) return;
      avisar(context, suspender ? 'Acesso suspenso.' : 'Acesso reativado.');
      ref.invalidate(usuariosProvider);
    } catch (e) {
      if (context.mounted) avisar(context, mensagemDoErro(e));
    }
  }

  Future<void> _remover(
    BuildContext context,
    WidgetRef ref,
    UsuarioConta u,
  ) async {
    final ok = await confirmar(
      context,
      titulo: 'Remover ${u.nome}?',
      texto:
          'O acesso é apagado. O que a pessoa fez continua no histórico da conta.',
      botao: 'Remover',
      perigo: true,
    );
    if (!ok || !context.mounted) return;
    try {
      await ref.read(servicoContaProvider).remover(u.id);
      if (!context.mounted) return;
      avisar(context, 'Acesso removido.');
      ref.invalidate(usuariosProvider);
    } catch (e) {
      if (context.mounted) avisar(context, mensagemDoErro(e));
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = Cores.de(context);
    final carga = ref.watch(usuariosProvider);
    final sessao = ref.watch(sessaoProvider);
    final eu = sessao is SessaoAtiva ? sessao.sessao.usuario : null;
    final ehDono = eu?.ehDono ?? false;

    return Scaffold(
      appBar: AppBar(title: const Text('Usuários')),
      bottomNavigationBar: ehDono
          ? SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 8, 20, 12),
                child: FilledButton.icon(
                  onPressed: () => _novo(context, ref),
                  icon: const Icon(Icons.person_add_alt_rounded),
                  label: const Text('Novo acesso'),
                ),
              ),
            )
          : null,
      body: carga.when(
        loading: () => const Padding(
          padding: EdgeInsets.all(20),
          child: Cartao(child: Esqueleto(altura: 140)),
        ),
        error: (e, _) => Padding(
          padding: const EdgeInsets.all(20),
          child: EstadoErro(
            titulo: 'Não consegui ler os usuários',
            mensagem: mensagemDoErro(e),
            aoTentar: () => ref.invalidate(usuariosProvider),
          ),
        ),
        data: (lista) => ListView(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 28),
          children: [
            if (!ehDono)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Text(
                  'Só o dono da conta cria, suspende ou remove acessos.',
                  style: TextStyle(color: c.tintaSuave, fontSize: 13),
                ),
              ),
            Cartao(
              padding: EdgeInsets.zero,
              child: Column(
                children: [
                  for (var i = 0; i < lista.length; i++) ...[
                    if (i > 0) Divider(height: 1, indent: 16, color: c.borda),
                    _LinhaUsuario(
                      usuario: lista[i],
                      souEu: lista[i].id == eu?.id,
                      podeAgir: ehDono && !lista[i].ehDono,
                      aoSuspender: () => _suspender(context, ref, lista[i]),
                      aoRemover: () => _remover(context, ref, lista[i]),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _LinhaUsuario extends StatelessWidget {
  const _LinhaUsuario({
    required this.usuario,
    required this.souEu,
    required this.podeAgir,
    required this.aoSuspender,
    required this.aoRemover,
  });

  final UsuarioConta usuario;
  final bool souEu;
  final bool podeAgir;
  final VoidCallback aoSuspender;
  final VoidCallback aoRemover;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final u = usuario;
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 4, 12),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  souEu ? '${u.nome} (você)' : u.nome,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontWeight: FontWeight.w600,
                    color: u.suspenso ? c.tintaSuave : null,
                  ),
                ),
                Text(
                  u.email,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: c.tintaSuave, fontSize: 12.5),
                ),
                const SizedBox(height: 6),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    Pilula(
                      u.ehDono ? 'Dono' : 'Operador',
                      tom: u.ehDono ? TomPilula.acento : TomPilula.neutro,
                      ponto: false,
                    ),
                    if (u.suspenso)
                      const Pilula('Suspenso', tom: TomPilula.erro),
                    Text(
                      u.ultimoLoginEm == null
                          ? 'nunca entrou'
                          : 'entrou ${f.quando(u.ultimoLoginEm)}',
                      style: TextStyle(color: c.tintaSuave, fontSize: 12),
                    ),
                  ],
                ),
              ],
            ),
          ),
          if (podeAgir)
            PopupMenuButton<String>(
              tooltip: 'Ações do acesso',
              color: c.superficie,
              icon: Icon(Icons.more_vert_rounded, color: c.tintaSuave),
              onSelected: (v) => v == 'remover' ? aoRemover() : aoSuspender(),
              itemBuilder: (_) => [
                PopupMenuItem(
                  value: 'suspender',
                  child: ListTile(
                    leading: Icon(
                      u.suspenso
                          ? Icons.play_circle_outline_rounded
                          : Icons.pause_circle_outline_rounded,
                    ),
                    title: Text(u.suspenso ? 'Reativar' : 'Suspender'),
                    contentPadding: EdgeInsets.zero,
                  ),
                ),
                PopupMenuItem(
                  value: 'remover',
                  child: ListTile(
                    leading: Icon(Icons.person_remove_outlined, color: c.erro),
                    title: Text('Remover', style: TextStyle(color: c.erro)),
                    contentPadding: EdgeInsets.zero,
                  ),
                ),
              ],
            )
          else
            const SizedBox(width: 12),
        ],
      ),
    );
  }
}

class _NovoUsuario extends ConsumerStatefulWidget {
  const _NovoUsuario();

  @override
  ConsumerState<_NovoUsuario> createState() => _NovoUsuarioState();
}

class _NovoUsuarioState extends ConsumerState<_NovoUsuario> {
  final _nome = TextEditingController();
  final _email = TextEditingController();
  final _senha = TextEditingController();
  bool _enviando = false;
  String? _erro;

  @override
  void dispose() {
    _nome.dispose();
    _email.dispose();
    _senha.dispose();
    super.dispose();
  }

  Future<void> _criar() async {
    final senha = _senha.text;
    if (_nome.text.trim().length < 2) {
      setState(() => _erro = 'Informe o nome da pessoa.');
      return;
    }
    if (!_email.text.contains('@')) {
      setState(
        () => _erro =
            'Confira o e-mail: ele precisa ter o formato nome@empresa.com.',
      );
      return;
    }
    if (senha.length < 10 ||
        !RegExp(r'[A-Za-zÀ-ÿ]').hasMatch(senha) ||
        !RegExp(r'\d').hasMatch(senha)) {
      setState(
        () => _erro =
            'A senha precisa de ao menos 10 caracteres, com letra e número.',
      );
      return;
    }
    setState(() {
      _enviando = true;
      _erro = null;
    });
    try {
      await ref
          .read(servicoContaProvider)
          .criarUsuario(nome: _nome.text, email: _email.text, senha: senha);
      if (mounted) Navigator.of(context).pop(true);
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
          Text('Novo acesso', style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 4),
          Text(
            'A pessoa entra como operadora: vê e opera campanhas, modelos e contatos, mas não mexe em plano, conta nem usuários.',
            style: TextStyle(color: c.tintaSuave, fontSize: 13, height: 1.45),
          ),
          const SizedBox(height: 14),
          TextField(
            controller: _nome,
            textCapitalization: TextCapitalization.words,
            decoration: const InputDecoration(labelText: 'Nome'),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _email,
            keyboardType: TextInputType.emailAddress,
            autocorrect: false,
            decoration: const InputDecoration(labelText: 'E-mail'),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _senha,
            obscureText: true,
            autofillHints: const [AutofillHints.newPassword],
            decoration: const InputDecoration(
              labelText: 'Senha inicial',
              helperText: 'Ao menos 10 caracteres, com letra e número.',
            ),
          ),
          if (_erro != null) ...[
            const SizedBox(height: 10),
            Text(_erro!, style: TextStyle(color: c.erro)),
          ],
          const SizedBox(height: 16),
          FilledButton(
            onPressed: _enviando ? null : _criar,
            child: _enviando
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Text('Criar acesso'),
          ),
        ],
      ),
    );
  }
}
