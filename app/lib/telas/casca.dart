import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/conta.dart';
import '../api/leituras.dart';
import '../api/modelos.dart';
import '../componentes/avisos_celular.dart';
import '../componentes/basicos.dart';
import '../componentes/marca.dart';
import '../config.dart';
import '../push/push.dart';
import '../sessao/sessao.dart';
import '../tema/cores.dart';
import 'campanha_detalhe.dart';
import 'campanhas.dart';
import 'conta.dart';
import 'contatos.dart';
import 'modelos.dart';
import 'painel.dart';
import 'plano.dart';
import 'regras.dart';
import 'usuarios.dart';
import 'whatsapp.dart';

/// A casca do app: cinco abas na barra de baixo, na ordem do menu do site,
/// onde o polegar alcança.
///
/// `IndexedStack` e não trocar de tela: voltar para uma aba mantém a rolagem
/// e o que já foi carregado. Quem conferiu uma campanha e foi ao Painel volta
/// para a mesma posição da lista.
class Casca extends ConsumerStatefulWidget {
  const Casca({super.key, this.abaInicial = 0});

  /// Aba aberta ao montar: 0 Painel, 1 Modelos, 2 Contatos, 3 Campanhas, 4 Mais.
  final int abaInicial;

  @override
  ConsumerState<Casca> createState() => _CascaState();
}

class _CascaState extends ConsumerState<Casca> {
  late int _aba = widget.abaInicial;
  bool _ofertaMostrada = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _ativarAvisos());
  }

  Future<void> _ativarAvisos() => ref
      .read(servicoPushProvider)
      .ativar(aoChegar: _chegou, aoTocar: _abrirPeloAviso);

  /// Aviso com o app aberto: o Android não mostra sozinho. Relê o que o aviso
  /// mudou e mostra uma faixa com atalho.
  void _chegou(RemoteMessage r) {
    if (!mounted) return;
    ref
      ..invalidate(campanhasProvider)
      ..invalidate(resumoContaProvider)
      ..invalidate(modelosSalvosProvider)
      ..invalidate(modelosNaMetaProvider)
      ..invalidate(situacaoPlanoProvider);
    final titulo = r.notification?.title ?? 'Novo aviso';
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(titulo),
        action: SnackBarAction(
          label: 'Ver',
          onPressed: () => _abrirPeloAviso(r.data),
        ),
      ),
    );
  }

  /// Toque no aviso: vai para onde ele fala.
  void _abrirPeloAviso(Map<String, dynamic> dados) {
    if (!mounted) return;
    final campanhaId = dados['campanhaId'];
    if (campanhaId is String && campanhaId.isNotEmpty) {
      setState(() => _aba = 3);
      ref.invalidate(campanhasProvider);
      Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => TelaCampanhaDetalhe(id: campanhaId),
        ),
      );
      return;
    }
    if (dados['modeloId'] is String) {
      ref
        ..invalidate(modelosSalvosProvider)
        ..invalidate(modelosNaMetaProvider);
      setState(() => _aba = 1);
      return;
    }
    if (dados['tipo'] == 'cobranca' || dados['tela'] == 'plano') {
      Navigator.of(
        context,
      ).push(MaterialPageRoute<void>(builder: (_) => const TelaPlano()));
    }
  }

  @override
  Widget build(BuildContext context) {
    final estado = ref.watch(sessaoProvider);
    if (estado is SessaoAtiva && estado.oferecerBiometria && !_ofertaMostrada) {
      _ofertaMostrada = true;
      WidgetsBinding.instance.addPostFrameCallback((_) => _oferecerBiometria());
    }

    return Scaffold(
      body: IndexedStack(
        index: _aba,
        children: const [
          TelaPainel(),
          TelaModelos(),
          TelaContatos(),
          TelaCampanhas(),
          _TelaMais(),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _aba,
        onDestinationSelected: (i) => setState(() => _aba = i),
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.space_dashboard_outlined),
            selectedIcon: Icon(Icons.space_dashboard_rounded),
            label: 'Painel',
          ),
          NavigationDestination(
            icon: Icon(Icons.description_outlined),
            selectedIcon: Icon(Icons.description_rounded),
            label: 'Modelos',
          ),
          NavigationDestination(
            icon: Icon(Icons.people_outline_rounded),
            selectedIcon: Icon(Icons.people_rounded),
            label: 'Contatos',
          ),
          NavigationDestination(
            icon: Icon(Icons.send_outlined),
            selectedIcon: Icon(Icons.send_rounded),
            label: 'Campanhas',
          ),
          NavigationDestination(
            icon: Icon(Icons.menu_rounded),
            selectedIcon: Icon(Icons.menu_open_rounded),
            label: 'Mais',
          ),
        ],
      ),
    );
  }

  /// Uma vez só, na primeira entrada: quer abrir o app com a digital?
  Future<void> _oferecerBiometria() async {
    final controle = ref.read(sessaoProvider.notifier);
    final c = Cores.de(context);
    final ligar = await showModalBottomSheet<bool>(
      context: context,
      showDragHandle: true,
      backgroundColor: c.superficie,
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 4, 24, 20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Icon(Icons.fingerprint_rounded, size: 48, color: c.tinta),
              const SizedBox(height: 12),
              Text(
                'Abrir com a biometria?',
                textAlign: TextAlign.center,
                style: Theme.of(ctx).textTheme.titleLarge,
              ),
              const SizedBox(height: 8),
              Text(
                'Sua sessão fica salva neste celular por 30 dias. Com a biometria, só você abre o app — mesmo com o celular desbloqueado na mão de outra pessoa.',
                textAlign: TextAlign.center,
                style: TextStyle(color: c.tintaSuave, height: 1.45),
              ),
              const SizedBox(height: 20),
              FilledButton(
                onPressed: () => Navigator.pop(ctx, true),
                child: const Text('Usar biometria'),
              ),
              const SizedBox(height: 8),
              TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: const Text('Agora não'),
              ),
            ],
          ),
        ),
      ),
    );
    if (ligar == true) {
      await controle.definirBiometria(true);
    } else {
      await controle.dispensarOfertaDeBiometria();
    }
  }
}

/// Mais: quem está logado, plano, conta, usuários, WhatsApp, regras,
/// a biometria e sair.
class _TelaMais extends ConsumerStatefulWidget {
  const _TelaMais();

  @override
  ConsumerState<_TelaMais> createState() => _TelaMaisState();
}

class _TelaMaisState extends ConsumerState<_TelaMais> {
  bool? _biometria;
  bool _disponivel = false;

  @override
  void initState() {
    super.initState();
    _ler();
  }

  Future<void> _ler() async {
    final controle = ref.read(sessaoProvider.notifier);
    final disponivel = await controle.biometriaDisponivel();
    final ligada = await controle.biometriaLigada();
    if (mounted) {
      setState(() {
        _disponivel = disponivel;
        _biometria = ligada;
      });
    }
  }

  Future<void> _sair() async {
    final c = Cores.de(context);
    final confirmar = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: c.superficie,
        title: const Text('Sair da conta?'),
        content: const Text(
          'A sessão é encerrada neste e em todos os outros aparelhos. Para voltar, entre com e-mail e senha.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(minimumSize: const Size(0, 44)),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Sair'),
          ),
        ],
      ),
    );
    if (confirmar != true) return;
    // Antes de encerrar a sessão: depois dela, o servidor não aceita mais o
    // pedido para desligar os avisos deste aparelho.
    await ref.read(servicoPushProvider).desativar();
    await ref.read(sessaoProvider.notifier).sair();
  }

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final estado = ref.watch(sessaoProvider);
    final sessao = estado is SessaoAtiva ? estado.sessao : null;

    return SafeArea(
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
        children: [
          Text('Mais', style: Theme.of(context).textTheme.headlineSmall),
          const SizedBox(height: 18),
          if (sessao != null)
            Cartao(
              child: Row(
                children: [
                  CircleAvatar(
                    radius: 24,
                    backgroundColor: c.acento,
                    child: Text(
                      sessao.usuario.nome.isEmpty
                          ? '?'
                          : sessao.usuario.nome.trim()[0].toUpperCase(),
                      style: TextStyle(
                        color: c.acentoContraste,
                        fontWeight: FontWeight.w700,
                        fontSize: 18,
                      ),
                    ),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          sessao.usuario.nome,
                          style: const TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        Text(
                          sessao.usuario.email,
                          style: TextStyle(color: c.tintaSuave, fontSize: 13),
                        ),
                        const SizedBox(height: 6),
                        Pilula(
                          '${sessao.conta.nome} · ${sessao.usuario.ehDono ? 'dono' : 'operador'}',
                          tom: TomPilula.neutro,
                          ponto: false,
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          const SizedBox(height: 14),
          Padding(
            padding: const EdgeInsets.only(left: 4, bottom: 8),
            child: Text(
              'Avisos neste celular',
              style: Theme.of(context).textTheme.titleMedium,
            ),
          ),
          AvisosCelular(
            aoPermitir: () => ref.read(servicoPushProvider).ativar(),
          ),
          const SizedBox(height: 14),
          if (_disponivel)
            Cartao(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              child: SwitchListTile(
                value: _biometria ?? false,
                activeThumbColor: c.acentoContraste,
                activeTrackColor: c.acento,
                title: const Text(
                  'Abrir com biometria',
                  style: TextStyle(fontWeight: FontWeight.w600),
                ),
                subtitle: Text(
                  'Pede a digital ou o rosto ao abrir o app.',
                  style: TextStyle(color: c.tintaSuave, fontSize: 13),
                ),
                onChanged: (v) async {
                  await ref.read(sessaoProvider.notifier).definirBiometria(v);
                  await _ler();
                },
              ),
            ),
          const SizedBox(height: 14),
          Cartao(
            padding: EdgeInsets.zero,
            child: Column(
              children: [
                _LinhaTela(
                  icone: Icons.credit_card_rounded,
                  texto: 'Plano e pagamento',
                  tela: const TelaPlano(),
                ),
                const Divider(height: 1),
                _LinhaTela(
                  icone: Icons.chat_bubble_outline_rounded,
                  texto: 'WhatsApp',
                  tela: const TelaWhatsapp(),
                ),
                const Divider(height: 1),
                _LinhaTela(
                  icone: Icons.business_rounded,
                  texto: 'Conta',
                  tela: const TelaConta(),
                ),
                const Divider(height: 1),
                _LinhaTela(
                  icone: Icons.group_outlined,
                  texto: 'Usuários',
                  tela: const TelaUsuarios(),
                ),
                const Divider(height: 1),
                _LinhaTela(
                  icone: Icons.shield_outlined,
                  texto: 'Regras da Meta',
                  tela: const TelaRegras(),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          Cartao(
            padding: EdgeInsets.zero,
            child: Column(
              children: [
                _Linha(
                  icone: Icons.language_rounded,
                  texto: 'Abrir o RegemCast no site',
                  aoTocar: () => launchUrl(
                    Uri.parse(urlWeb),
                    mode: LaunchMode.externalApplication,
                  ),
                ),
                const Divider(height: 1),
                _Linha(
                  icone: Icons.privacy_tip_outlined,
                  texto: 'Política de privacidade',
                  aoTocar: () => launchUrl(
                    Uri.parse('$urlWeb/privacidade'),
                    mode: LaunchMode.externalApplication,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 22),
          OutlinedButton.icon(
            style: OutlinedButton.styleFrom(
              foregroundColor: c.erro,
              side: BorderSide(color: c.erro.withValues(alpha: 0.4)),
            ),
            onPressed: _sair,
            icon: const Icon(Icons.logout_rounded),
            label: const Text('Sair da conta'),
          ),
          const SizedBox(height: 28),
          const Center(
            child: Opacity(opacity: 0.6, child: Logotipo(tamanho: 22)),
          ),
        ],
      ),
    );
  }
}

/// Linha que abre uma tela do próprio app.
class _LinhaTela extends StatelessWidget {
  const _LinhaTela({
    required this.icone,
    required this.texto,
    required this.tela,
  });

  final IconData icone;
  final String texto;
  final Widget tela;

  @override
  Widget build(BuildContext context) => ListTile(
    leading: Icon(icone),
    title: Text(texto, style: const TextStyle(fontWeight: FontWeight.w500)),
    trailing: const Icon(Icons.chevron_right_rounded),
    onTap: () => Navigator.of(
      context,
    ).push(MaterialPageRoute<void>(builder: (_) => tela)),
  );
}

class _Linha extends StatelessWidget {
  const _Linha({
    required this.icone,
    required this.texto,
    required this.aoTocar,
  });

  final IconData icone;
  final String texto;
  final VoidCallback aoTocar;

  @override
  Widget build(BuildContext context) => ListTile(
    leading: Icon(icone),
    title: Text(texto, style: const TextStyle(fontWeight: FontWeight.w500)),
    trailing: const Icon(Icons.open_in_new_rounded, size: 18),
    onTap: aoTocar,
  );
}
