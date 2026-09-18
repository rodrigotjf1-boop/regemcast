import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/dados.dart';
import '../api/erro_api.dart';
import '../componentes/basicos.dart';
import '../componentes/marca.dart';
import '../config.dart';
import '../sessao/sessao.dart';
import '../tema/cores.dart';

/// Entrada. Duas telas no mesmo lugar: a senha e, para quem usa verificação
/// em duas etapas, o código. A senha sai da memória assim que é aceita — o
/// passo do código não precisa dela.
class TelaEntrar extends ConsumerStatefulWidget {
  const TelaEntrar({super.key, this.aviso});

  /// Por que a pessoa voltou para cá (sessão vencida, por exemplo).
  final String? aviso;

  @override
  ConsumerState<TelaEntrar> createState() => _TelaEntrarState();
}

class _TelaEntrarState extends ConsumerState<TelaEntrar> {
  final _email = TextEditingController();
  final _senha = TextEditingController();
  final _codigo = TextEditingController();

  EtapaCodigo? _etapa;
  String? _erro;
  String? _info;
  bool _enviando = false;
  bool _senhaVisivel = false;

  @override
  void initState() {
    super.initState();
    ref.read(cofreProvider).lerUltimoEmail().then((e) {
      if (e != null && mounted && _email.text.isEmpty) {
        setState(() => _email.text = e);
      }
    });
  }

  @override
  void dispose() {
    _email.dispose();
    _senha.dispose();
    _codigo.dispose();
    super.dispose();
  }

  Future<void> _entrar() async {
    if (_enviando) return;
    if (_email.text.trim().isEmpty || _senha.text.isEmpty) {
      setState(() => _erro = 'Informe o e-mail e a senha.');
      return;
    }
    setState(() {
      _enviando = true;
      _erro = null;
    });
    try {
      final etapa = await ref
          .read(sessaoProvider.notifier)
          .entrar(_email.text, _senha.text);
      if (!mounted) return;
      _senha.clear();
      setState(() {
        _etapa = etapa;
        _info = etapa == null
            ? null
            : etapa.porEmail
            ? 'Enviamos um código de 6 dígitos para ${etapa.emailMascarado}. Ele vale por 10 minutos.'
            : 'Abra o aplicativo autenticador e digite o código do Regemcast.';
      });
    } catch (e) {
      if (mounted) setState(() => _erro = mensagemDoErro(e));
    } finally {
      if (mounted) setState(() => _enviando = false);
    }
  }

  Future<void> _confirmar() async {
    if (_enviando) return;
    final codigo = _codigo.text.replaceAll(RegExp(r'\D'), '');
    if (codigo.length != 6) {
      setState(() => _erro = 'O código tem 6 dígitos.');
      return;
    }
    setState(() {
      _enviando = true;
      _erro = null;
    });
    try {
      await ref.read(sessaoProvider.notifier).confirmarCodigo(codigo);
    } catch (e) {
      if (mounted) {
        setState(() => _erro = mensagemDoErro(e));
        _codigo.clear();
      }
    } finally {
      if (mounted) setState(() => _enviando = false);
    }
  }

  Future<void> _reenviar() async {
    setState(() {
      _erro = null;
      _info = null;
    });
    try {
      final para = await ref.read(sessaoProvider.notifier).reenviarCodigo();
      if (mounted) {
        setState(() => _info = 'Enviamos um código novo para $para.');
      }
    } catch (e) {
      if (mounted) setState(() => _erro = mensagemDoErro(e));
    }
  }

  void _voltar() => setState(() {
    _etapa = null;
    _codigo.clear();
    _erro = null;
    _info = null;
  });

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    return Scaffold(
      backgroundColor: c.fundo,
      body: CustomScrollView(
        slivers: [
          SliverToBoxAdapter(child: _Topo(etapa: _etapa)),
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(20, 20, 20, 32),
            sliver: SliverToBoxAdapter(
              child: Cartao(
                padding: const EdgeInsets.all(22),
                child: AnimatedSwitcher(
                  duration: const Duration(milliseconds: 250),
                  child: _etapa == null ? _formSenha(c) : _formCodigo(c),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _formSenha(Cores c) {
    return AutofillGroup(
      key: const ValueKey('senha'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (widget.aviso != null) ...[
            Aviso(texto: widget.aviso!),
            const SizedBox(height: 16),
          ],
          TextField(
            controller: _email,
            keyboardType: TextInputType.emailAddress,
            autofillHints: const [AutofillHints.email, AutofillHints.username],
            textInputAction: TextInputAction.next,
            autocorrect: false,
            decoration: const InputDecoration(
              labelText: 'E-mail',
              prefixIcon: Icon(Icons.alternate_email_rounded),
            ),
          ),
          const SizedBox(height: 14),
          TextField(
            controller: _senha,
            obscureText: !_senhaVisivel,
            autofillHints: const [AutofillHints.password],
            textInputAction: TextInputAction.done,
            onSubmitted: (_) => _entrar(),
            decoration: InputDecoration(
              labelText: 'Senha',
              prefixIcon: const Icon(Icons.lock_outline_rounded),
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
          Align(
            alignment: Alignment.centerRight,
            child: TextButton(
              onPressed: () => launchUrl(
                Uri.parse('$urlWeb/recuperar-senha'),
                mode: LaunchMode.externalApplication,
              ),
              child: const Text('Esqueci minha senha'),
            ),
          ),
          if (_erro != null) ...[
            Aviso(
              texto: _erro!,
              tom: TomPilula.erro,
              icone: Icons.error_outline_rounded,
            ),
            const SizedBox(height: 14),
          ],
          FilledButton(
            onPressed: _enviando ? null : _entrar,
            child: _enviando
                ? SizedBox.square(
                    dimension: 22,
                    child: CircularProgressIndicator(
                      strokeWidth: 2.5,
                      color: c.acentoContraste,
                    ),
                  )
                : const Text('Entrar'),
          ),
          const SizedBox(height: 18),
          Text(
            'Ainda não tem acesso? Entre na lista de espera pelo site.',
            textAlign: TextAlign.center,
            style: TextStyle(color: c.tintaSuave, fontSize: 13),
          ),
          TextButton(
            onPressed: () => launchUrl(
              Uri.parse('$urlWeb/lista-espera'),
              mode: LaunchMode.externalApplication,
            ),
            child: const Text('Abrir a lista de espera'),
          ),
        ],
      ),
    );
  }

  Widget _formCodigo(Cores c) {
    final etapa = _etapa!;
    return Column(
      key: const ValueKey('codigo'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Icon(Icons.shield_outlined, color: c.tinta),
            const SizedBox(width: 10),
            Text(
              'Verificação em duas etapas',
              style: Theme.of(context).textTheme.titleMedium,
            ),
          ],
        ),
        const SizedBox(height: 10),
        if (_info != null)
          Text(_info!, style: TextStyle(color: c.tintaSuave, height: 1.45)),
        const SizedBox(height: 18),
        TextField(
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
            fontSize: 28,
            letterSpacing: 10,
            fontWeight: FontWeight.w600,
          ),
          onChanged: (v) {
            if (v.length == 6) _confirmar();
          },
          decoration: const InputDecoration(hintText: '000000'),
        ),
        const SizedBox(height: 16),
        if (_erro != null) ...[
          Aviso(
            texto: _erro!,
            tom: TomPilula.erro,
            icone: Icons.error_outline_rounded,
          ),
          const SizedBox(height: 14),
        ],
        FilledButton(
          onPressed: _enviando ? null : _confirmar,
          child: _enviando
              ? SizedBox.square(
                  dimension: 22,
                  child: CircularProgressIndicator(
                    strokeWidth: 2.5,
                    color: c.acentoContraste,
                  ),
                )
              : const Text('Confirmar'),
        ),
        const SizedBox(height: 8),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            TextButton.icon(
              onPressed: _voltar,
              icon: const Icon(Icons.arrow_back_rounded, size: 18),
              label: const Text('Voltar'),
            ),
            if (etapa.porEmail)
              TextButton(
                onPressed: _reenviar,
                child: const Text('Enviar outro código'),
              ),
          ],
        ),
      ],
    );
  }
}

/// O topo escuro da marca, como o lado esquerdo da entrada na web.
class _Topo extends StatelessWidget {
  const _Topo({required this.etapa});

  final EtapaCodigo? etapa;

  @override
  Widget build(BuildContext context) {
    final topo = MediaQuery.of(context).padding.top;
    return Container(
      padding: EdgeInsets.fromLTRB(24, topo + 28, 24, 36),
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Cores.lateral, Cores.lateral2],
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Logotipo(sobreEscuro: true, tamanho: 36),
          const SizedBox(height: 28),
          Text(
            'INTEGRAÇÃO VIA API OFICIAL DO WHATSAPP BUSINESS',
            style: TextStyle(
              color: const Color(0xFFA3E635).withValues(alpha: 0.95),
              fontSize: 11,
              letterSpacing: 1.4,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 10),
          Text(
            etapa == null ? 'Suas campanhas, no bolso.' : 'Só mais um passo.',
            style: const TextStyle(
              color: Cores.lateralTinta,
              fontSize: 28,
              fontWeight: FontWeight.w700,
              height: 1.15,
              letterSpacing: -0.5,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            etapa == null
                ? 'Acompanhe entregas, dispare e pause campanhas de onde estiver.'
                : 'Confirme que é você para abrir a conta.',
            style: const TextStyle(
              color: Cores.lateralSuave,
              fontSize: 15,
              height: 1.4,
            ),
          ),
        ],
      ),
    );
  }
}
