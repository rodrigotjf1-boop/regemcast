import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../componentes/basicos.dart';
import '../componentes/marca.dart';
import '../config.dart';
import '../sessao/sessao.dart';
import '../tema/cores.dart';
import 'painel.dart';

/// A casca do app: quatro abas na barra de baixo, onde o polegar alcança.
///
/// `IndexedStack` e não trocar de tela: voltar para uma aba mantém a rolagem
/// e o que já foi carregado. Quem conferiu uma campanha e foi ao Painel volta
/// para a mesma posição da lista.
class Casca extends ConsumerStatefulWidget {
  const Casca({super.key});

  @override
  ConsumerState<Casca> createState() => _CascaState();
}

class _CascaState extends ConsumerState<Casca> {
  int _aba = 0;
  bool _ofertaMostrada = false;

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
          _EmBreve(
            titulo: 'Campanhas',
            icone: Icons.send_rounded,
            texto:
                'A lista completa, com métricas, disparo, pausa e edição, chega na próxima versão do app. '
                'O Painel já mostra as campanhas que estão saindo agora.',
            caminho: '/campanhas',
          ),
          _EmBreve(
            titulo: 'Modelos',
            icone: Icons.description_outlined,
            texto:
                'Os modelos, com a prévia de como a mensagem chega, entram na próxima versão do app.',
            caminho: '/modelos',
          ),
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
            icon: Icon(Icons.send_outlined),
            selectedIcon: Icon(Icons.send_rounded),
            label: 'Campanhas',
          ),
          NavigationDestination(
            icon: Icon(Icons.description_outlined),
            selectedIcon: Icon(Icons.description_rounded),
            label: 'Modelos',
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

/// Aba que ainda não chegou ao app: diz o que vem e leva ao site enquanto isso.
class _EmBreve extends StatelessWidget {
  const _EmBreve({
    required this.titulo,
    required this.icone,
    required this.texto,
    required this.caminho,
  });

  final String titulo;
  final IconData icone;
  final String texto;
  final String caminho;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    return SafeArea(
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
        children: [
          Text(titulo, style: Theme.of(context).textTheme.headlineSmall),
          const SizedBox(height: 18),
          Cartao(
            padding: const EdgeInsets.all(22),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 52,
                  height: 52,
                  decoration: BoxDecoration(
                    color: c.acentoSuave,
                    borderRadius: BorderRadius.circular(16),
                  ),
                  child: Icon(icone, color: c.tinta),
                ),
                const SizedBox(height: 16),
                const Text(
                  'Na próxima versão',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 6),
                Text(
                  texto,
                  style: TextStyle(color: c.tintaSuave, height: 1.45),
                ),
                const SizedBox(height: 18),
                OutlinedButton.icon(
                  onPressed: () => launchUrl(
                    Uri.parse('$urlWeb$caminho'),
                    mode: LaunchMode.externalApplication,
                  ),
                  icon: const Icon(Icons.open_in_new_rounded, size: 18),
                  label: const Text('Abrir no site'),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Mais: quem está logado, a biometria e sair.
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
    if (confirmar == true) await ref.read(sessaoProvider.notifier).sair();
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
