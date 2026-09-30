import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/acesso.dart';
import '../api/erro_api.dart';
import '../componentes/acesso.dart';
import '../componentes/basicos.dart';
import '../tema/cores.dart';

/// A lista de espera, como a página do site (`/lista-espera`): quem ainda não
/// tem acesso deixa nome, e-mail e, se quiser, a empresa e um telefone. O
/// convite para criar a conta chega por e-mail, por ordem de chegada.
class TelaListaEspera extends ConsumerStatefulWidget {
  const TelaListaEspera({super.key});

  @override
  ConsumerState<TelaListaEspera> createState() => _TelaListaEsperaState();
}

class _TelaListaEsperaState extends ConsumerState<TelaListaEspera> {
  final _nome = TextEditingController();
  final _empresa = TextEditingController();
  final _email = TextEditingController();
  final _telefone = TextEditingController();

  String? _erro;
  bool _enviando = false;
  bool _pronto = false;

  @override
  void dispose() {
    _nome.dispose();
    _empresa.dispose();
    _email.dispose();
    _telefone.dispose();
    super.dispose();
  }

  Future<void> _enviar() async {
    if (_enviando) return;
    if (_nome.text.trim().isEmpty) {
      setState(() => _erro = 'Informe seu nome.');
      return;
    }
    if (!_email.text.contains('@')) {
      setState(
        () => _erro = 'Informe um e-mail válido, como maria@empresa.com.br.',
      );
      return;
    }
    FocusScope.of(context).unfocus();
    setState(() {
      _erro = null;
      _enviando = true;
    });
    try {
      await ref
          .read(servicoAcessoProvider)
          .entrarNaListaDeEspera(
            nome: _nome.text,
            email: _email.text,
            empresa: _empresa.text,
            telefone: _telefone.text,
          );
      if (mounted) setState(() => _pronto = true);
    } catch (e) {
      if (mounted) setState(() => _erro = mensagemDoErro(e));
    } finally {
      if (mounted) setState(() => _enviando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    return MoldeDeAcesso(
      podeVoltar: true,
      titulo: _pronto ? 'Lugar guardado.' : 'Quer usar o Regemcast?',
      texto: _pronto
          ? 'Avisamos por e-mail quando for a sua vez.'
          : 'Conte quem você é. Avisamos por e-mail quando a sua vaga for liberada.',
      child: AnimatedSwitcher(
        duration: const Duration(milliseconds: 250),
        child: _pronto ? _registrado(c) : _formulario(c),
      ),
    );
  }

  Widget _formulario(Cores c) => AutofillGroup(
    key: const ValueKey('formulario-lista'),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const CabecalhoDoCartao(titulo: 'Lista de espera'),
        const SizedBox(height: 16),
        TextField(
          key: const ValueKey('lista-nome'),
          controller: _nome,
          textCapitalization: TextCapitalization.words,
          autofillHints: const [AutofillHints.name],
          textInputAction: TextInputAction.next,
          decoration: const InputDecoration(
            labelText: 'Seu nome',
            hintText: 'Como devemos te chamar',
          ),
        ),
        const SizedBox(height: 12),
        TextField(
          key: const ValueKey('lista-empresa'),
          controller: _empresa,
          textCapitalization: TextCapitalization.words,
          autofillHints: const [AutofillHints.organizationName],
          textInputAction: TextInputAction.next,
          decoration: const InputDecoration(
            labelText: 'Empresa (opcional)',
            hintText: 'Nome do seu negócio',
          ),
        ),
        const SizedBox(height: 12),
        TextField(
          key: const ValueKey('lista-email'),
          controller: _email,
          keyboardType: TextInputType.emailAddress,
          autofillHints: const [AutofillHints.email],
          autocorrect: false,
          textInputAction: TextInputAction.next,
          decoration: const InputDecoration(
            labelText: 'E-mail',
            hintText: 'voce@suaempresa.com.br',
            helperText: 'O convite chega neste endereço.',
            helperMaxLines: 2,
          ),
        ),
        const SizedBox(height: 12),
        TextField(
          key: const ValueKey('lista-telefone'),
          controller: _telefone,
          keyboardType: TextInputType.phone,
          autofillHints: const [AutofillHints.telephoneNumber],
          textInputAction: TextInputAction.done,
          onSubmitted: (_) => _enviar(),
          decoration: const InputDecoration(
            labelText: 'Telefone para contato (opcional)',
            hintText: '(11) 90000-0000',
            helperText: 'Com DDD. Usamos só para avisar da liberação.',
            helperMaxLines: 2,
          ),
        ),
        const SizedBox(height: 18),
        if (_erro != null) ...[
          Aviso(
            key: const ValueKey('erro-lista'),
            texto: _erro!,
            tom: TomPilula.erro,
            icone: Icons.error_outline_rounded,
          ),
          const SizedBox(height: 14),
        ],
        BotaoDeAcesso(
          key: const ValueKey('entrar-na-lista'),
          rotulo: 'Entrar na lista',
          ocupado: _enviando,
          aoTocar: _enviar,
        ),
        const SizedBox(height: 8),
        TextButton(
          onPressed: () => Navigator.of(context).maybePop(),
          child: const Text('Já tem conta? Entrar'),
        ),
      ],
    ),
  );

  Widget _registrado(Cores c) {
    final corpo = TextStyle(color: c.tintaSuave, height: 1.5);
    final forte = TextStyle(color: c.tinta, fontWeight: FontWeight.w600);
    return Column(
      key: const ValueKey('pedido-registrado'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Center(
          child: Container(
            width: 64,
            height: 64,
            decoration: BoxDecoration(color: c.acento, shape: BoxShape.circle),
            child: Icon(
              Icons.check_rounded,
              size: 34,
              color: c.acentoContraste,
            ),
          ),
        ),
        const SizedBox(height: 16),
        const Text(
          'Pedido registrado',
          textAlign: TextAlign.center,
          style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 4),
        Text(
          'Seu lugar na fila está guardado.',
          textAlign: TextAlign.center,
          style: corpo,
        ),
        const SizedBox(height: 16),
        Text.rich(
          TextSpan(
            style: corpo,
            children: [
              const TextSpan(text: 'Liberamos as vagas '),
              TextSpan(text: 'por ordem de chegada', style: forte),
              const TextSpan(
                text:
                    ', em lotes pequenos, porque a Meta limita quantos números novos conectamos por semana — assim ninguém fica preso no meio da conexão do número.',
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        Text.rich(
          TextSpan(
            style: corpo,
            children: [
              const TextSpan(
                text: 'Quando for sua vez, enviamos um convite para ',
              ),
              TextSpan(text: _email.text.trim(), style: forte),
              const TextSpan(
                text:
                    ' com o link de criação da conta. Não é preciso fazer mais nada agora.',
              ),
            ],
          ),
        ),
        const SizedBox(height: 20),
        OutlinedButton(
          key: const ValueKey('voltar-da-lista'),
          onPressed: () => Navigator.of(context).maybePop(),
          child: const Text('Voltar para a entrada'),
        ),
      ],
    );
  }
}
