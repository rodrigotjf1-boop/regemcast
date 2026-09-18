import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/dados.dart';
import '../api/erro_api.dart';
import '../api/leituras.dart';
import '../componentes/basicos.dart';
import '../config.dart';
import '../tema/cores.dart';
import '../util/formato.dart' as f;

/// O WhatsApp da conta: cada número, a qualidade que a Meta dá a ele e quanto
/// ele pode enviar.
///
/// Conectar é pelo site: o cadastro incorporado da Meta roda no navegador,
/// com o login do Facebook. Aqui se acompanha — e quando algo exige ação (a
/// cópia da coexistência com prazo correndo, um número suspenso), a tela diz
/// qual e leva ao site.
class TelaWhatsapp extends ConsumerWidget {
  const TelaWhatsapp({super.key});

  static (String, TomPilula) qualidade(String q) => switch (q) {
    'verde' => ('Qualidade alta', TomPilula.sucesso),
    'amarela' => ('Qualidade média', TomPilula.atencao),
    'vermelha' => ('Qualidade baixa', TomPilula.erro),
    _ => ('Qualidade em avaliação', TomPilula.neutro),
  };

  static (String, TomPilula) situacao(String s) => switch (s) {
    'registrado' => ('Enviando', TomPilula.sucesso),
    'pendente' => ('Conexão pendente', TomPilula.atencao),
    'suspenso' => ('Suspenso pela Meta', TomPilula.erro),
    'removido' => ('Removido', TomPilula.neutro),
    _ => (s, TomPilula.neutro),
  };

  void _abrirSite() => launchUrl(
    Uri.parse('$urlWeb/whatsapp'),
    mode: LaunchMode.externalApplication,
  );

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = Cores.de(context);
    final carga = ref.watch(situacaoWhatsappProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('WhatsApp')),
      body: carga.when(
        loading: () => const Padding(
          padding: EdgeInsets.all(20),
          child: Cartao(child: Esqueleto(altura: 160)),
        ),
        error: (e, _) => Padding(
          padding: const EdgeInsets.all(20),
          child: EstadoErro(
            titulo: 'Não consegui ler a conexão',
            mensagem: mensagemDoErro(e),
            aoTentar: () => ref.invalidate(situacaoWhatsappProvider),
          ),
        ),
        data: (s) => RefreshIndicator(
          color: c.acentoContraste,
          backgroundColor: c.acento,
          onRefresh: () async {
            ref.invalidate(situacaoWhatsappProvider);
            await ref
                .read(situacaoWhatsappProvider.future)
                .catchError((_) => s);
          },
          child: ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.fromLTRB(20, 8, 20, 28),
            children: [
              if (!s.conectado || s.numeros.isEmpty)
                Aviso(
                  tom: TomPilula.acento,
                  icone: Icons.link_rounded,
                  texto:
                      'Nenhum número conectado. A conexão é feita pelo site, com o login da sua empresa na Meta — leva poucos minutos.',
                  acao: TextButton(
                    onPressed: _abrirSite,
                    child: const Text('Conectar no site'),
                  ),
                )
              else ...[
                if (s.contaNome != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: Text(
                      'Conta na Meta: ${s.contaNome}',
                      style: TextStyle(color: c.tintaSuave, fontSize: 13),
                    ),
                  ),
                for (final n in s.numeros)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: _CartaoNumero(numero: n, aoAbrirSite: _abrirSite),
                  ),
              ],
              const SizedBox(height: 8),
              Text(
                'Trocar ou acrescentar número, e refazer a conexão, é pelo site.',
                style: TextStyle(color: c.tintaSuave, fontSize: 12.5),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _CartaoNumero extends StatelessWidget {
  const _CartaoNumero({required this.numero, required this.aoAbrirSite});

  final NumeroWhatsapp numero;
  final VoidCallback aoAbrirSite;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final n = numero;
    final (rotuloQ, tomQ) = TelaWhatsapp.qualidade(n.qualidade);
    final (rotuloS, tomS) = TelaWhatsapp.situacao(n.status);
    final copiando =
        n.sincronizacao == 'pendente' || n.sincronizacao == 'sincronizando';

    return Cartao(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            n.telefone ?? 'Número sem telefone informado',
            style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600),
          ),
          if (n.nome != null)
            Text(n.nome!, style: TextStyle(color: c.tintaSuave, fontSize: 13)),
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              Pilula(rotuloS, tom: tomS),
              Pilula(rotuloQ, tom: tomQ),
            ],
          ),
          const SizedBox(height: 12),
          _Dado(
            rotulo: 'Limite da Meta',
            valor: n.tierLimite == null
                ? 'Ilimitado ou em apuração'
                : '${f.numero(n.tierLimite!)} pessoas a cada 24 h',
          ),
          if (n.vazaoMaxima != null)
            _Dado(
              rotulo: 'Velocidade',
              valor:
                  'até ${n.vazaoMaxima} mensagens por segundo${n.coexistencia ? ' (app no celular)' : ''}',
            ),
          if (n.coexistencia)
            _Dado(
              rotulo: 'App no celular',
              valor: 'Abra o WhatsApp Business ao menos a cada 13 dias',
            ),
          if (copiando) ...[
            const SizedBox(height: 10),
            Aviso(
              tom: TomPilula.atencao,
              icone: Icons.sync_rounded,
              texto: n.horasParaSincronizar == null
                  ? 'Copiando contatos e conversas do celular. Mantenha o WhatsApp Business aberto até terminar.'
                  : 'Copiando contatos e conversas do celular. A Meta dá ${n.horasParaSincronizar!.toStringAsFixed(0)} h para terminar — mantenha o WhatsApp Business aberto.',
            ),
          ],
          if (n.sincronizacao == 'erro') ...[
            const SizedBox(height: 10),
            Aviso(
              tom: TomPilula.erro,
              icone: Icons.sync_problem_rounded,
              texto:
                  'A cópia de contatos e conversas não terminou. Refaça pelo site.',
              acao: TextButton(
                onPressed: aoAbrirSite,
                child: const Text('Abrir no site'),
              ),
            ),
          ],
          if (n.status == 'suspenso' || n.status == 'pendente') ...[
            const SizedBox(height: 10),
            Aviso(
              tom: n.status == 'suspenso' ? TomPilula.erro : TomPilula.atencao,
              icone: Icons.info_outline_rounded,
              texto: n.status == 'suspenso'
                  ? 'A Meta suspendeu este número: nada sai por ele. O motivo aparece no Meta Business Suite.'
                  : 'A conexão deste número não foi concluída. Termine pelo site.',
              acao: n.status == 'pendente'
                  ? TextButton(
                      onPressed: aoAbrirSite,
                      child: const Text('Concluir no site'),
                    )
                  : null,
            ),
          ],
        ],
      ),
    );
  }
}

class _Dado extends StatelessWidget {
  const _Dado({required this.rotulo, required this.valor});

  final String rotulo;
  final String valor;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 118,
            child: Text(
              rotulo,
              style: TextStyle(color: c.tintaSuave, fontSize: 13),
            ),
          ),
          Expanded(child: Text(valor, style: const TextStyle(fontSize: 13.5))),
        ],
      ),
    );
  }
}
