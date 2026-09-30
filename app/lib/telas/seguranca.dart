import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/erro_api.dart';
import '../api/seguranca.dart';
import '../componentes/basicos.dart';
import '../componentes/dialogos.dart';
import '../sessao/sessao.dart';
import '../tema/cores.dart';

/// Abre um endereço fora do app — aqui, o `otpauth://` que o aplicativo
/// autenticador recebe. Atrás de um provider para o teste trocar pelo falso:
/// o canal nativo não existe no `flutter test`.
final abrirForaDoAppProvider = Provider<Future<bool> Function(Uri)>(
  (ref) =>
      (uri) => launchUrl(uri, mode: LaunchMode.externalApplication),
);

enum _Fluxo { aplicativo, email, desativar }

/// A verificação em duas etapas de quem está logado — a seção "Segurança do
/// seu acesso" do site (`seguranca-conta.tsx`), com os mesmos dois caminhos:
/// o aplicativo autenticador ou o código por e-mail.
///
/// No site, o autenticador lê um QR code na tela do computador. No celular
/// ele costuma estar no MESMO aparelho, e a câmera não lê a própria tela:
/// aqui o app abre o autenticador direto pelo endereço `otpauth://` (o mesmo
/// que o QR carrega) e mostra a chave para copiar ou digitar.
class TelaSeguranca extends ConsumerStatefulWidget {
  const TelaSeguranca({super.key});

  @override
  ConsumerState<TelaSeguranca> createState() => _TelaSegurancaState();
}

class _TelaSegurancaState extends ConsumerState<TelaSeguranca> {
  _Fluxo? _fluxo;
  CadastroDoAplicativo? _cadastro;
  CodigoEnviado? _enviado;

  /// O que ligar ou desligar devolveu. Vale até a leitura seguinte — como o
  /// `setSituacao` do site.
  SituacaoSeguranca? _situacao;

  final _codigo = TextEditingController();
  final _senha = TextEditingController();
  String? _erro;
  String? _aviso;
  bool _ocupado = false;
  bool _senhaVisivel = false;

  @override
  void dispose() {
    _codigo.dispose();
    _senha.dispose();
    super.dispose();
  }

  /// Um pedido por vez. Dois toques em "Configurar aplicativo" gerariam duas
  /// chaves: a tela mostraria uma enquanto o servidor guarda a outra, e o
  /// código nunca conferiria.
  Future<void> _executar(Future<void> Function() acao) async {
    if (_ocupado) return;
    setState(() {
      _erro = null;
      _ocupado = true;
    });
    try {
      await acao();
    } catch (e) {
      if (mounted) setState(() => _erro = mensagemDoErro(e));
    } finally {
      if (mounted) setState(() => _ocupado = false);
    }
  }

  void _fechar() {
    _codigo.clear();
    _senha.clear();
    setState(() {
      _fluxo = null;
      _cadastro = null;
      _enviado = null;
      _erro = null;
      _senhaVisivel = false;
    });
  }

  void _concluir(SituacaoSeguranca nova, String aviso) {
    _codigo.clear();
    _senha.clear();
    setState(() {
      _situacao = nova;
      _fluxo = null;
      _cadastro = null;
      _enviado = null;
      _erro = null;
      _senhaVisivel = false;
      _aviso = aviso;
    });
    // A tela da Conta mostra a mesma situação: ela relê.
    ref.invalidate(situacaoSegurancaProvider);
  }

  Future<void> _configurarAplicativo() => _executar(() async {
    final r = await ref.read(servicoSegurancaProvider).iniciarApp();
    if (!mounted) return;
    setState(() {
      _aviso = null;
      _cadastro = r;
      _fluxo = _Fluxo.aplicativo;
    });
  });

  Future<void> _ativarPorEmail() => _executar(() async {
    final r = await ref.read(servicoSegurancaProvider).enviarCodigoEmail();
    if (!mounted) return;
    setState(() {
      _aviso = null;
      _enviado = r;
      _fluxo = _Fluxo.email;
    });
  });

  Future<void> _reenviar() => _executar(() async {
    final r = await ref.read(servicoSegurancaProvider).enviarCodigoEmail();
    if (!mounted) return;
    _codigo.clear();
    setState(() => _enviado = r);
    avisar(context, 'Enviamos um código novo para ${r.emailMascarado}.');
  });

  Future<void> _abrirAutenticador() async {
    final cadastro = _cadastro;
    if (cadastro == null) return;
    var abriu = false;
    try {
      abriu = await ref.read(abrirForaDoAppProvider)(
        Uri.parse(cadastro.endereco),
      );
    } catch (_) {
      abriu = false;
    }
    if (!abriu && mounted) {
      setState(
        () => _erro =
            'Nenhum aplicativo autenticador abriu neste celular. Instale um (Google Authenticator, Microsoft Authenticator ou Authy) ou copie a chave e digite nele.',
      );
    }
  }

  Future<void> _copiarChave() async {
    final cadastro = _cadastro;
    if (cadastro == null) return;
    await Clipboard.setData(ClipboardData(text: cadastro.segredo));
    if (mounted) {
      avisar(context, 'Chave copiada. Cole no aplicativo autenticador.');
    }
  }

  Future<void> _ativar() async {
    final codigo = _codigo.text.replaceAll(RegExp(r'\D'), '');
    if (codigo.length != 6) {
      setState(() => _erro = 'O código tem 6 dígitos.');
      return;
    }
    final peloAplicativo = _fluxo == _Fluxo.aplicativo;
    if (peloAplicativo && _senha.text.isEmpty) {
      setState(() => _erro = 'Informe a sua senha.');
      return;
    }
    FocusScope.of(context).unfocus();
    await _executar(() async {
      final servico = ref.read(servicoSegurancaProvider);
      final r = peloAplicativo
          ? await servico.ativarApp(codigo, _senha.text)
          : await servico.ativarEmail(codigo);
      if (!mounted) return;
      _concluir(
        r,
        r.peloAplicativo
            ? 'Pronto. No próximo login, vamos pedir o código do aplicativo.'
            : 'Pronto. No próximo login, vamos enviar um código para o seu e-mail.',
      );
    });
  }

  Future<void> _desativar() async {
    if (_senha.text.isEmpty) {
      setState(() => _erro = 'Informe a sua senha.');
      return;
    }
    FocusScope.of(context).unfocus();
    await _executar(() async {
      final r = await ref.read(servicoSegurancaProvider).desativar(_senha.text);
      if (!mounted) return;
      _concluir(
        r,
        'Verificação em duas etapas desligada. Sua conta volta a entrar só com a senha.',
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final carga = ref.watch(situacaoSegurancaProvider);
    final estado = ref.watch(sessaoProvider);
    final email = estado is SessaoAtiva ? estado.sessao.usuario.email : null;
    final s = _situacao ?? carga.value;

    return Scaffold(
      appBar: AppBar(title: const Text('Verificação em duas etapas')),
      body: ListView(
        padding: respiroDaTela(context),
        children: [
          _Cabecalho(email: email, situacao: s),
          const SizedBox(height: 18),
          if (s == null)
            carga.hasError
                ? EstadoErro(
                    titulo: 'Não consegui ler a sua segurança',
                    mensagem: mensagemDoErro(carga.error!),
                    aoTentar: () => ref.invalidate(situacaoSegurancaProvider),
                  )
                : const Cartao(child: Esqueleto(altura: 150))
          else
            ..._conteudo(c, s),
        ],
      ),
    );
  }

  List<Widget> _conteudo(Cores c, SituacaoSeguranca s) => [
    Row(
      children: [
        Icon(
          s.emailVerificado
              ? Icons.check_circle_rounded
              : Icons.info_outline_rounded,
          size: 18,
          color: s.emailVerificado ? c.sucesso : c.tintaSuave,
        ),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            s.emailVerificado
                ? 'E-mail verificado'
                : 'E-mail ainda não verificado — ativar o código por e-mail confirma o endereço.',
            style: TextStyle(
              color: s.emailVerificado ? c.tinta : c.tintaSuave,
              fontSize: 13.5,
              height: 1.4,
            ),
          ),
        ),
      ],
    ),
    const SizedBox(height: 16),
    if (_aviso != null) ...[
      Aviso(
        key: const ValueKey('aviso-seguranca'),
        tom: TomPilula.sucesso,
        icone: Icons.check_circle_outline_rounded,
        texto: _aviso!,
      ),
      const SizedBox(height: 14),
    ],
    if (_erro != null && _fluxo == null) ...[
      Aviso(
        tom: TomPilula.erro,
        icone: Icons.error_outline_rounded,
        texto: _erro!,
      ),
      const SizedBox(height: 14),
    ],
    if (!s.ligada && _fluxo == null) ...[
      _OpcaoMetodo(
        icone: Icons.phone_android_rounded,
        titulo: 'Aplicativo autenticador',
        descricao:
            'Google Authenticator, Microsoft Authenticator ou Authy. Funciona sem internet no celular.',
        recomendado: true,
        disponivel: s.appDisponivel,
        acao: 'Configurar aplicativo',
        chaveDoBotao: 'configurar-aplicativo',
        ocupado: _ocupado,
        aoEscolher: _configurarAplicativo,
      ),
      const SizedBox(height: 12),
      _OpcaoMetodo(
        icone: Icons.mail_outline_rounded,
        titulo: 'Código por e-mail',
        descricao:
            'Enviamos um código de 6 dígitos para o seu e-mail a cada login.',
        disponivel: true,
        acao: 'Ativar por e-mail',
        chaveDoBotao: 'ativar-por-email',
        ocupado: _ocupado,
        aoEscolher: _ativarPorEmail,
      ),
    ],
    if (_fluxo == _Fluxo.aplicativo && _cadastro != null)
      _passosDoAplicativo(c, _cadastro!),
    if (_fluxo == _Fluxo.email) _passosDoEmail(c),
    if (s.ligada && _fluxo == null)
      Cartao(
        key: const ValueKey('seguranca-ativa'),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              s.peloAplicativo
                  ? 'A cada login pedimos o código do aplicativo autenticador.'
                  : 'A cada login enviamos um código para o seu e-mail.',
              style: TextStyle(color: c.tintaSuave, height: 1.45),
            ),
            const SizedBox(height: 12),
            OutlinedButton(
              key: const ValueKey('desativar'),
              style: OutlinedButton.styleFrom(
                minimumSize: const Size(0, 42),
                foregroundColor: c.erro,
                side: BorderSide(color: c.erro.withValues(alpha: 0.4)),
              ),
              onPressed: () => setState(() {
                _aviso = null;
                _erro = null;
                _fluxo = _Fluxo.desativar;
              }),
              child: const Text('Desativar'),
            ),
          ],
        ),
      ),
    if (_fluxo == _Fluxo.desativar) _confirmarDesativacao(c),
  ];

  Widget _campoDoCodigo({required bool autofocus}) => TextField(
    key: const ValueKey('codigo-seguranca'),
    controller: _codigo,
    autofocus: autofocus,
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
    decoration: const InputDecoration(labelText: 'Código', hintText: '000000'),
  );

  Widget _campoDaSenha({required String rotulo, String? ajuda}) => TextField(
    key: const ValueKey('senha-seguranca'),
    controller: _senha,
    obscureText: !_senhaVisivel,
    autofillHints: const [AutofillHints.password],
    decoration: InputDecoration(
      labelText: rotulo,
      helperText: ajuda,
      helperMaxLines: 3,
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
  );

  Widget _erroDoFluxo(Cores c) => _erro == null
      ? const SizedBox.shrink()
      : Padding(
          padding: const EdgeInsets.only(top: 12),
          child: Text(
            _erro!,
            key: const ValueKey('erro-seguranca'),
            style: TextStyle(color: c.erro, height: 1.4),
          ),
        );

  Widget _acoes({
    required String rotulo,
    required String chave,
    required VoidCallback aoConfirmar,
    bool perigo = false,
  }) {
    final c = Cores.de(context);
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        FilledButton(
          key: ValueKey(chave),
          style: FilledButton.styleFrom(
            minimumSize: const Size(0, 44),
            backgroundColor: perigo ? c.erro : null,
            foregroundColor: perigo
                ? (Theme.of(context).brightness == Brightness.dark
                      ? const Color(0xFF231632)
                      : Colors.white)
                : null,
          ),
          onPressed: _ocupado ? null : aoConfirmar,
          child: _ocupado
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : Text(rotulo),
        ),
        TextButton(
          key: const ValueKey('cancelar-seguranca'),
          onPressed: _ocupado ? null : _fechar,
          child: const Text('Cancelar'),
        ),
      ],
    );
  }

  Widget _passosDoAplicativo(Cores c, CadastroDoAplicativo cadastro) => Cartao(
    key: const ValueKey('passos-aplicativo'),
    destaque: true,
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const _Passo(
          numero: 1,
          texto:
              'Abra o aplicativo autenticador. O Regemcast entra na lista dele com o seu e-mail.',
        ),
        const SizedBox(height: 12),
        FilledButton.icon(
          key: const ValueKey('abrir-autenticador'),
          onPressed: _abrirAutenticador,
          icon: const Icon(Icons.open_in_new_rounded, size: 18),
          label: const Text('Abrir no aplicativo autenticador'),
        ),
        const SizedBox(height: 14),
        Text(
          'Não abriu, ou o aplicativo está em outro aparelho? Digite esta chave nele:',
          style: TextStyle(color: c.tintaSuave, fontSize: 13, height: 1.4),
        ),
        const SizedBox(height: 8),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          decoration: BoxDecoration(
            color: c.superficie2,
            borderRadius: BorderRadius.circular(12),
          ),
          child: SelectableText(
            cadastro.segredoEmGrupos,
            key: const ValueKey('chave-autenticador'),
            style: const TextStyle(
              fontSize: 15,
              letterSpacing: 1.5,
              height: 1.5,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
        Align(
          alignment: Alignment.centerLeft,
          child: TextButton.icon(
            key: const ValueKey('copiar-chave'),
            onPressed: _copiarChave,
            icon: const Icon(Icons.copy_rounded, size: 18),
            label: const Text('Copiar a chave'),
          ),
        ),
        const SizedBox(height: 6),
        const _Passo(
          numero: 2,
          texto: 'Digite o código de 6 dígitos que aparece para o Regemcast.',
        ),
        const SizedBox(height: 12),
        _campoDoCodigo(autofocus: false),
        const SizedBox(height: 12),
        _campoDaSenha(
          rotulo: 'Sua senha',
          ajuda:
              'Pedimos a senha para ninguém cadastrar outro celular numa sessão esquecida aberta.',
        ),
        _erroDoFluxo(c),
        const SizedBox(height: 16),
        _acoes(
          rotulo: 'Ativar',
          chave: 'ativar-seguranca',
          aoConfirmar: _ativar,
        ),
      ],
    ),
  );

  Widget _passosDoEmail(Cores c) {
    final enviado = _enviado;
    return Cartao(
      key: const ValueKey('passos-email'),
      destaque: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (enviado != null)
            Text(
              'Enviamos um código para ${enviado.emailMascarado}. Ele vale por ${enviado.minutos} minutos.',
              style: const TextStyle(fontWeight: FontWeight.w600, height: 1.4),
            ),
          const SizedBox(height: 6),
          Text(
            'Digite o código que chegou no seu e-mail para confirmar.',
            style: TextStyle(color: c.tintaSuave, height: 1.4),
          ),
          const SizedBox(height: 14),
          _campoDoCodigo(autofocus: true),
          _erroDoFluxo(c),
          const SizedBox(height: 16),
          _acoes(
            rotulo: 'Ativar',
            chave: 'ativar-seguranca',
            aoConfirmar: _ativar,
          ),
          const SizedBox(height: 4),
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton(
              key: const ValueKey('reenviar-codigo'),
              onPressed: _ocupado ? null : _reenviar,
              child: const Text('Enviar outro código'),
            ),
          ),
        ],
      ),
    );
  }

  Widget _confirmarDesativacao(Cores c) => Container(
    key: const ValueKey('confirmar-desativacao'),
    padding: const EdgeInsets.all(18),
    decoration: BoxDecoration(
      color: c.superficie,
      borderRadius: BorderRadius.circular(18),
      border: Border.all(color: c.erro.withValues(alpha: 0.4)),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Text(
          'Sem a segunda etapa, quem souber a sua senha entra na conta. Para desligar, confirme a sua senha.',
          style: TextStyle(height: 1.45),
        ),
        const SizedBox(height: 14),
        _campoDaSenha(rotulo: 'Senha'),
        _erroDoFluxo(c),
        const SizedBox(height: 16),
        _acoes(
          rotulo: 'Desativar verificação',
          chave: 'confirmar-desativar',
          aoConfirmar: _desativar,
          perigo: true,
        ),
      ],
    ),
  );
}

class _Cabecalho extends StatelessWidget {
  const _Cabecalho({required this.email, required this.situacao});

  final String? email;
  final SituacaoSeguranca? situacao;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final s = situacao;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 44,
          height: 44,
          decoration: BoxDecoration(
            color: c.acento,
            borderRadius: BorderRadius.circular(14),
          ),
          child: Icon(Icons.shield_outlined, color: c.acentoContraste),
        ),
        const SizedBox(width: 14),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Segurança do seu acesso',
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: 4),
              Text(
                email == null
                    ? 'Além da senha, um código a cada login.'
                    : 'Além da senha, um código a cada login. Vale só para $email.',
                style: TextStyle(
                  color: c.tintaSuave,
                  fontSize: 13,
                  height: 1.45,
                ),
              ),
              if (s != null) ...[
                const SizedBox(height: 8),
                s.ligada
                    ? Pilula(
                        'Protegido · ${s.peloAplicativo ? 'aplicativo' : 'e-mail'}',
                        key: const ValueKey('situacao-protegido'),
                        tom: TomPilula.sucesso,
                      )
                    : const Pilula(
                        'Só senha',
                        key: ValueKey('situacao-so-senha'),
                        tom: TomPilula.atencao,
                      ),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

/// Um dos dois caminhos: o aplicativo (recomendado) ou o e-mail.
class _OpcaoMetodo extends StatelessWidget {
  const _OpcaoMetodo({
    required this.icone,
    required this.titulo,
    required this.descricao,
    required this.disponivel,
    required this.acao,
    required this.chaveDoBotao,
    required this.ocupado,
    required this.aoEscolher,
    this.recomendado = false,
  });

  final IconData icone;
  final String titulo;
  final String descricao;
  final bool disponivel;
  final String acao;
  final String chaveDoBotao;
  final bool ocupado;
  final VoidCallback aoEscolher;
  final bool recomendado;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    return Cartao(
      destaque: recomendado,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 38,
                height: 38,
                decoration: BoxDecoration(
                  color: c.superficie2,
                  borderRadius: BorderRadius.circular(11),
                ),
                child: Icon(icone, color: c.tinta, size: 20),
              ),
              const Spacer(),
              if (recomendado)
                const Pilula(
                  'Recomendado',
                  tom: TomPilula.acento,
                  ponto: false,
                ),
            ],
          ),
          const SizedBox(height: 12),
          Text(titulo, style: const TextStyle(fontWeight: FontWeight.w600)),
          const SizedBox(height: 2),
          Text(
            descricao,
            style: TextStyle(color: c.tintaSuave, fontSize: 13.5, height: 1.4),
          ),
          const SizedBox(height: 12),
          if (disponivel)
            recomendado
                ? FilledButton(
                    key: ValueKey(chaveDoBotao),
                    style: FilledButton.styleFrom(
                      minimumSize: const Size(0, 42),
                    ),
                    onPressed: ocupado ? null : aoEscolher,
                    child: Text(acao),
                  )
                : OutlinedButton(
                    key: ValueKey(chaveDoBotao),
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size(0, 42),
                    ),
                    onPressed: ocupado ? null : aoEscolher,
                    child: Text(acao),
                  )
          else
            Text(
              'Ainda não disponível neste servidor.',
              style: TextStyle(color: c.tintaSuave, fontSize: 12.5),
            ),
        ],
      ),
    );
  }
}

/// Um passo numerado do cadastro do aplicativo — a ordem aqui importa.
class _Passo extends StatelessWidget {
  const _Passo({required this.numero, required this.texto});

  final int numero;
  final String texto;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 24,
          height: 24,
          alignment: Alignment.center,
          decoration: BoxDecoration(color: c.acento, shape: BoxShape.circle),
          child: Text(
            '$numero',
            style: TextStyle(
              color: c.acentoContraste,
              fontWeight: FontWeight.w700,
              fontSize: 13,
            ),
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Text(
            texto,
            style: const TextStyle(fontWeight: FontWeight.w600, height: 1.4),
          ),
        ),
      ],
    );
  }
}
