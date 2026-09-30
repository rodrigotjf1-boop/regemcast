import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/acesso.dart';
import '../api/erro_api.dart';
import '../componentes/acesso.dart';
import '../componentes/basicos.dart';
import '../componentes/dialogos.dart';
import '../tema/cores.dart';
import '../util/senha.dart';

/// "Esqueci minha senha", como a página do site (`/recuperar-senha`): o
/// e-mail e, depois, o código que chegou com a senha nova — no mesmo lugar.
///
/// A primeira resposta é sempre a mesma, exista o e-mail ou não: a tela não
/// pode dizer a ninguém quem tem conta. A verificação em duas etapas continua
/// valendo depois da troca — quem usa o aplicativo autenticador ainda precisa
/// dele para entrar.
///
/// Ao terminar, devolve o e-mail para a entrada, que já o deixa preenchido.
class TelaRecuperarSenha extends ConsumerStatefulWidget {
  const TelaRecuperarSenha({super.key, this.email});

  /// O que estava digitado na entrada.
  final String? email;

  @override
  ConsumerState<TelaRecuperarSenha> createState() => _TelaRecuperarSenhaState();
}

class _TelaRecuperarSenhaState extends ConsumerState<TelaRecuperarSenha> {
  late final _email = TextEditingController(text: widget.email ?? '');
  final _codigo = TextEditingController();
  final _senha = TextEditingController();

  bool _enviado = false;
  String? _aviso;
  String? _concluido;
  String? _erro;
  bool _ocupado = false;
  bool _senhaVisivel = false;

  @override
  void dispose() {
    _email.dispose();
    _codigo.dispose();
    _senha.dispose();
    super.dispose();
  }

  Future<void> _pedirCodigo() async {
    if (_ocupado) return;
    if (!_email.text.contains('@')) {
      setState(() => _erro = 'Informe o e-mail de acesso.');
      return;
    }
    FocusScope.of(context).unfocus();
    setState(() {
      _erro = null;
      _ocupado = true;
    });
    try {
      final mensagem = await ref
          .read(servicoAcessoProvider)
          .esqueciSenha(_email.text);
      if (!mounted) return;
      final reenvio = _enviado;
      setState(() {
        _aviso = mensagem;
        _enviado = true;
      });
      if (reenvio) {
        _codigo.clear();
        avisar(context, 'Pedimos outro código. Confira também o spam.');
      }
    } catch (e) {
      if (mounted) setState(() => _erro = mensagemDoErro(e));
    } finally {
      if (mounted) setState(() => _ocupado = false);
    }
  }

  Future<void> _redefinir() async {
    if (_ocupado) return;
    final codigo = _codigo.text.replaceAll(RegExp(r'\D'), '');
    if (codigo.length != 6) {
      setState(() => _erro = 'O código tem 6 dígitos.');
      return;
    }
    final problema = erroDaSenha(_senha.text, rotulo: 'A senha nova');
    if (problema != null) {
      setState(() => _erro = problema);
      return;
    }
    FocusScope.of(context).unfocus();
    setState(() {
      _erro = null;
      _ocupado = true;
    });
    try {
      final mensagem = await ref
          .read(servicoAcessoProvider)
          .redefinirSenha(
            email: _email.text,
            codigo: codigo,
            senhaNova: _senha.text,
          );
      if (!mounted) return;
      _senha.clear();
      setState(() => _concluido = mensagem);
    } catch (e) {
      if (mounted) setState(() => _erro = mensagemDoErro(e));
    } finally {
      if (mounted) setState(() => _ocupado = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    return MoldeDeAcesso(
      podeVoltar: true,
      titulo: _concluido != null ? 'Pronto.' : 'Recupere o acesso.',
      texto: _concluido != null
          ? 'Sua senha nova já vale.'
          : 'Um código no seu e-mail e você cria uma senha nova.',
      child: AnimatedSwitcher(
        duration: const Duration(milliseconds: 250),
        child: _concluido != null
            ? _pronto(c)
            : _enviado
            ? _senhaNova(c)
            : _pedir(c),
      ),
    );
  }

  Widget _erroNaTela() => _erro == null
      ? const SizedBox.shrink()
      : Padding(
          padding: const EdgeInsets.only(bottom: 14),
          child: Aviso(
            key: const ValueKey('erro-recuperar'),
            texto: _erro!,
            tom: TomPilula.erro,
            icone: Icons.error_outline_rounded,
          ),
        );

  Widget _voltarParaEntrar() => TextButton.icon(
    key: const ValueKey('voltar-para-entrar'),
    onPressed: () => Navigator.of(context).maybePop(),
    icon: const Icon(Icons.arrow_back_rounded, size: 18),
    label: const Text('Voltar para entrar'),
  );

  Widget _pedir(Cores c) => Column(
    key: const ValueKey('pedir-codigo'),
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      const CabecalhoDoCartao(
        titulo: 'Esqueceu a senha?',
        texto:
            'Informe o e-mail de acesso. Enviamos um código para você criar uma senha nova.',
      ),
      const SizedBox(height: 18),
      TextField(
        key: const ValueKey('email-recuperar'),
        controller: _email,
        keyboardType: TextInputType.emailAddress,
        autofillHints: const [AutofillHints.email, AutofillHints.username],
        autocorrect: false,
        textInputAction: TextInputAction.done,
        onSubmitted: (_) => _pedirCodigo(),
        decoration: const InputDecoration(
          labelText: 'E-mail',
          prefixIcon: Icon(Icons.alternate_email_rounded),
        ),
      ),
      const SizedBox(height: 16),
      _erroNaTela(),
      BotaoDeAcesso(
        key: const ValueKey('enviar-codigo'),
        rotulo: 'Enviar código',
        ocupado: _ocupado,
        aoTocar: _pedirCodigo,
      ),
      const SizedBox(height: 8),
      _voltarParaEntrar(),
    ],
  );

  Widget _senhaNova(Cores c) => AutofillGroup(
    key: const ValueKey('criar-senha'),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        CabecalhoDoCartao(titulo: 'Crie a senha nova', texto: _aviso),
        const SizedBox(height: 18),
        TextField(
          key: const ValueKey('codigo-recuperar'),
          controller: _codigo,
          autofocus: true,
          keyboardType: TextInputType.number,
          autofillHints: const [AutofillHints.oneTimeCode],
          inputFormatters: [
            FilteringTextInputFormatter.digitsOnly,
            LengthLimitingTextInputFormatter(6),
          ],
          textAlign: TextAlign.center,
          style: const TextStyle(
            fontSize: 26,
            letterSpacing: 8,
            fontWeight: FontWeight.w600,
          ),
          decoration: const InputDecoration(
            labelText: 'Código do e-mail',
            hintText: '000000',
          ),
        ),
        const SizedBox(height: 14),
        TextField(
          key: const ValueKey('senha-recuperar'),
          controller: _senha,
          obscureText: !_senhaVisivel,
          autofillHints: const [AutofillHints.newPassword],
          textInputAction: TextInputAction.done,
          onSubmitted: (_) => _redefinir(),
          decoration: InputDecoration(
            labelText: 'Senha nova',
            helperText: ajudaSenha,
            helperMaxLines: 2,
            suffixIcon: IconButton(
              tooltip: _senhaVisivel ? 'Esconder a senha' : 'Mostrar a senha',
              icon: Icon(
                _senhaVisivel
                    ? Icons.visibility_off_outlined
                    : Icons.visibility_outlined,
              ),
              onPressed: () => setState(() => _senhaVisivel = !_senhaVisivel),
            ),
          ),
        ),
        const SizedBox(height: 16),
        _erroNaTela(),
        BotaoDeAcesso(
          key: const ValueKey('criar-senha-nova'),
          rotulo: 'Criar senha nova',
          ocupado: _ocupado,
          aoTocar: _redefinir,
        ),
        const SizedBox(height: 12),
        Text(
          'Não chegou? Confira também o spam.',
          textAlign: TextAlign.center,
          style: TextStyle(color: c.tintaSuave, fontSize: 13),
        ),
        TextButton(
          key: const ValueKey('reenviar-recuperar'),
          onPressed: _ocupado ? null : _pedirCodigo,
          child: const Text('Enviar outro código'),
        ),
        _voltarParaEntrar(),
      ],
    ),
  );

  Widget _pronto(Cores c) => Column(
    key: const ValueKey('senha-criada'),
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      CabecalhoDoCartao(
        titulo: 'Senha nova criada',
        texto: _concluido,
        icone: Icons.check_circle_outline_rounded,
      ),
      const SizedBox(height: 20),
      FilledButton(
        key: const ValueKey('entrar-com-senha-nova'),
        onPressed: () => Navigator.of(context).pop(_email.text.trim()),
        child: const Text('Entrar com a senha nova'),
      ),
    ],
  );
}
