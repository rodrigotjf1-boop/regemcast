import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/erro_api.dart';
import '../api/regem.dart';
import '../componentes/basicos.dart';
import '../componentes/dialogos.dart';
import '../componentes/integracao.dart';
import '../sessao/sessao.dart';
import '../tema/cores.dart';
import '../util/formato.dart' as f;

/// Lendo os clientes, a tela relê depressa; lendo as vendas, sem pressa.
const _releituraClientes = Duration(seconds: 3);
const _releituraVendas = Duration(seconds: 8);
const _emailSuporte = 'suporte@dmsregem.com';

/// A empresa no Regem inteira num cartão: os clientes, as compras e a 99 — o
/// cartão do site (`components/app/integracoes/regem.tsx`). Quem liga é a
/// equipe do Regemcast (a loja não copia token). Tudo roda no servidor;
/// enquanto a leitura completa anda, o cartão relê sozinho.
class CartaoRegem extends ConsumerStatefulWidget {
  const CartaoRegem({super.key});

  @override
  ConsumerState<CartaoRegem> createState() => _CartaoRegemState();
}

class _CartaoRegemState extends ConsumerState<CartaoRegem> {
  SituacaoRegem? _s;
  Object? _erroDeLeitura;
  bool _ocupado = false;
  Timer? _proxima;

  ServicoRegem get _servico => ref.read(servicoRegemProvider);

  @override
  void initState() {
    super.initState();
    _carregar();
  }

  @override
  void dispose() {
    _proxima?.cancel();
    super.dispose();
  }

  Future<void> _carregar() async {
    _proxima?.cancel();
    try {
      final s = await _servico.situacao();
      if (!mounted) return;
      setState(() {
        _s = s;
        _erroDeLeitura = null;
      });
      // Lendo: relê sozinho — uma falha de rede aqui não para nada, a
      // leitura roda no servidor.
      if (s.lendo) {
        _proxima = Timer(
          s.clientes.status == 'carga' ? _releituraClientes : _releituraVendas,
          _carregar,
        );
      }
    } catch (e) {
      if (!mounted) return;
      if (_s == null) {
        setState(() => _erroDeLeitura = e);
      } else if (_s!.lendo) {
        _proxima = Timer(_releituraVendas, _carregar);
      }
    }
  }

  /// Faz a ação e relê a situação. Devolve se deu certo.
  Future<bool> _agir(Future<void> Function() acao, {String? feito}) async {
    setState(() => _ocupado = true);
    try {
      await acao();
      await _carregar();
      if (feito != null && mounted) avisar(context, feito);
      return true;
    } catch (e) {
      if (mounted) avisar(context, mensagemDoErro(e));
      return false;
    } finally {
      if (mounted) setState(() => _ocupado = false);
    }
  }

  Future<void> _desfazer99() async {
    final ok = await confirmar(
      context,
      titulo: 'Desfazer a autorização da 99?',
      texto:
          'Sai da sua base, na hora, as compras da 99 e os clientes que vieram só por ela. Quem pediu para sair continua bloqueado.',
      botao: 'Desfazer',
      perigo: true,
    );
    if (!ok || !mounted) return;
    await _agir(
      () => _servico.autorizar99(false),
      feito: 'Autorização da 99 desfeita.',
    );
  }

  Future<void> _desligar() async {
    final ok = await confirmar(
      context,
      titulo: 'Desligar do Regem?',
      texto:
          'Para de trazer clientes e compras do Regem. O que já está na sua base fica. Para ligar de novo, fale com o suporte.',
      botao: 'Desligar',
      perigo: true,
    );
    if (!ok || !mounted) return;
    await _agir(_servico.desligar, feito: 'Desligado do Regem.');
  }

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final sessao = ref.watch(sessaoProvider);
    final ehDono = sessao is SessaoAtiva && sessao.sessao.usuario.ehDono;
    final s = _s;

    final Widget corpo;
    if (s == null) {
      corpo = _erroDeLeitura != null
          ? EstadoErro(
              titulo: 'Não consegui ler a ligação com o Regem',
              mensagem: mensagemDoErro(_erroDeLeitura!),
              aoTentar: () {
                setState(() => _erroDeLeitura = null);
                _carregar();
              },
            )
          : const Esqueleto(altura: 90);
    } else if (!s.ligado) {
      corpo = Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Usa o Regem na sua empresa? Os clientes e o histórico de compras de cada um chegam direto, sem planilha. Quem liga é a nossa equipe — você não copia nenhum token.',
            style: TextStyle(color: c.tintaSuave, height: 1.45),
          ),
          const SizedBox(height: 10),
          OutlinedButton.icon(
            key: const ValueKey('pedir-ligacao-regem'),
            style: OutlinedButton.styleFrom(minimumSize: const Size(0, 42)),
            onPressed: () => launchUrl(
              Uri(
                scheme: 'mailto',
                path: _emailSuporte,
                query:
                    'subject=${Uri.encodeComponent('Ligar o Regemcast ao Regem')}',
              ),
            ),
            icon: const Icon(Icons.mail_outline_rounded),
            label: const Text('Pedir a ligação ao suporte'),
          ),
          const SizedBox(height: 6),
          SelectableText(
            _emailSuporte,
            style: TextStyle(color: c.tintaSuave, fontSize: 12.5),
          ),
        ],
      );
    } else {
      corpo = Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text.rich(
            TextSpan(
              children: [
                const TextSpan(text: 'Empresa ligada: '),
                TextSpan(
                  text: s.empresaNome ?? '—',
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
                if (s.lojas.isNotEmpty)
                  TextSpan(
                    text:
                        ' · ${s.lojas.length == 1 ? '1 loja' : '${s.lojas.length} lojas'} (${s.lojas.join(', ')})',
                    style: TextStyle(color: c.tintaSuave),
                  ),
              ],
            ),
          ),
          if (s.cardapioWebDireto) ...[
            const SizedBox(height: 10),
            const Aviso(
              tom: TomPilula.acento,
              icone: Icons.info_outline_rounded,
              texto:
                  'O Cardápio Web também está ligado direto aqui: as vendas dele que chegam pelo Regem ficam de fora, para a mesma compra não contar duas vezes.',
            ),
          ],
          const SizedBox(height: 12),
          _ClientesRegem(
            key: ValueKey('clientes-regem-${s.clientes.status}'),
            situacao: s,
            ehDono: ehDono,
            ocupado: _ocupado,
            aoImportar: (consentimento, evidencia) => _agir(
              () => _servico.importar(
                consentimento: consentimento,
                evidencia: evidencia,
              ),
            ),
            aoTentarDeNovo: () => _agir(_servico.atualizar),
          ),
          const SizedBox(height: 12),
          _ComprasRegem(
            situacao: s,
            ehDono: ehDono,
            ocupado: _ocupado,
            aoAtualizar: () => _agir(_servico.atualizar),
          ),
          const SizedBox(height: 12),
          _ClientesDa99(
            key: ValueKey('99-${s.incluir99}'),
            situacao: s,
            ehDono: ehDono,
            ocupado: _ocupado,
            aoAutorizar: () => _agir(
              () => _servico.autorizar99(true),
              feito: 'Autorização da 99 registrada.',
            ),
            aoDesfazer: _desfazer99,
          ),
          if (ehDono) ...[
            const SizedBox(height: 14),
            Divider(height: 1, color: c.borda),
            const SizedBox(height: 12),
            Text(
              'Desligar para de trazer clientes e compras do Regem. O que já está na sua base fica. Para ligar de novo, fale com o suporte.',
              style: TextStyle(
                color: c.tintaSuave,
                fontSize: 12.5,
                height: 1.45,
              ),
            ),
            const SizedBox(height: 10),
            Align(
              alignment: Alignment.centerLeft,
              child: OutlinedButton(
                key: const ValueKey('desligar-regem'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: c.erro,
                  minimumSize: const Size(0, 42),
                ),
                onPressed: _ocupado ? null : _desligar,
                child: const Text('Desligar do Regem'),
              ),
            ),
          ],
        ],
      );
    }

    return Cartao(
      key: const ValueKey('regem'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              const Expanded(
                child: Text(
                  'Regem',
                  style: TextStyle(fontWeight: FontWeight.w600, fontSize: 16),
                ),
              ),
              if (s != null)
                s.ligado
                    ? const Pilula('Ligada', tom: TomPilula.sucesso)
                    : const Pilula('Não ligada', ponto: false),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            'Os clientes e as compras da sua empresa no Regem: cardápio próprio, Anota Aí e delivery direto.',
            style: TextStyle(color: c.tintaSuave, fontSize: 13),
          ),
          const SizedBox(height: 14),
          corpo,
        ],
      ),
    );
  }
}

/// Os clientes da empresa no Regem. Quem pediu para sair lá entra
/// descadastrado; quem foi esquecido lá, a pedido, é anonimizado aqui. A
/// declaração de consentimento é a condição da Meta.
class _ClientesRegem extends StatefulWidget {
  const _ClientesRegem({
    super.key,
    required this.situacao,
    required this.ehDono,
    required this.ocupado,
    required this.aoImportar,
    required this.aoTentarDeNovo,
  });

  final SituacaoRegem situacao;
  final bool ehDono;
  final bool ocupado;
  final void Function(bool consentimento, String evidencia) aoImportar;
  final VoidCallback aoTentarDeNovo;

  @override
  State<_ClientesRegem> createState() => _ClientesRegemState();
}

class _ClientesRegemState extends State<_ClientesRegem> {
  bool _consentimento = false;

  /// Em dia, ler tudo de novo é raro: o formulário fica atrás de um botão.
  bool _releitura = false;
  final _evidencia = TextEditingController();

  @override
  void dispose() {
    _evidencia.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final s = widget.situacao;
    final k = s.clientes;
    final (selo, tom) = switch (k.status) {
      'carga' => ('Importando', TomPilula.acento),
      'em_dia' => ('Em dia', TomPilula.sucesso),
      'falhou' => ('Parou', TomPilula.erro),
      _ => ('Não importados', TomPilula.neutro),
    };
    final suave = TextStyle(color: c.tintaSuave, height: 1.45, fontSize: 13.5);
    final pequeno = TextStyle(
      color: c.tintaSuave,
      fontSize: 12.5,
      height: 1.45,
    );
    final formulario = k.status == 'parado' || _releitura;

    return BlocoIntegracao(
      titulo: 'Clientes',
      chave: 'regem-clientes',
      selo: selo,
      tom: tom,
      vivo: k.status == 'carga',
      filhos: [
        if (k.status == 'carga') ...[
          Text(
            'Lendo os clientes de ${s.empresaNome ?? 'sua empresa'}… pode fechar esta tela, a leitura continua no servidor.',
            style: const TextStyle(height: 1.45),
          ),
          const SizedBox(height: 6),
          Text(
            '${f.numero(k.lidos)} lidos · ${f.numero(k.novos)} novos na base',
            style: pequeno.copyWith(
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
        ],
        if (k.status == 'em_dia') ...[
          Text(
            '${f.plural(k.lidos, 'cliente lido', 'clientes lidos')}, ${f.plural(k.novos, 'novo', 'novos')} na base'
            '${k.bloqueados > 0 ? ', ${f.numero(k.bloqueados)} que pediram para sair (entraram descadastrados)' : ''}'
            '${k.invalidos > 0 ? ', ${f.numero(k.invalidos)} sem telefone válido' : ''}'
            '${k.removidos > 0 ? ', ${f.numero(k.removidos)} esquecidos a pedido (anonimizados aqui)' : ''}. Quem pode receber está na lista Clientes Regem.',
            style: const TextStyle(height: 1.45),
          ),
          const SizedBox(height: 6),
          Text(
            'Atualizado em ${f.dataHora(k.ultimaConsulta)}. Cliente novo, saída e esquecimento chegam a cada 30 minutos.',
            style: pequeno,
          ),
        ],
        if ((k.status == 'carga' || k.status == 'em_dia') &&
            k.erro != null) ...[
          const SizedBox(height: 8),
          Aviso(icone: Icons.info_outline_rounded, texto: k.erro!),
        ],
        if (k.status == 'falhou') ...[
          Aviso(
            tom: TomPilula.erro,
            icone: Icons.error_outline_rounded,
            texto: k.erro ?? 'A leitura dos clientes parou.',
          ),
          if (widget.ehDono) ...[
            const SizedBox(height: 10),
            Align(
              alignment: Alignment.centerLeft,
              child: FilledButton(
                key: const ValueKey('tentar-clientes-regem'),
                style: FilledButton.styleFrom(minimumSize: const Size(0, 44)),
                onPressed: widget.ocupado ? null : widget.aoTentarDeNovo,
                child: const Text('Tentar de novo'),
              ),
            ),
          ],
        ],
        if (k.status == 'parado')
          Text(
            'Traga a base de clientes da empresa. As compras de cada um vêm em seguida.',
            style: suave,
          ),
        if (k.status == 'parado' || k.status == 'em_dia') ...[
          const SizedBox(height: 10),
          if (!widget.ehDono)
            if (k.status == 'parado')
              const Aviso(
                tom: TomPilula.acento,
                icone: Icons.lock_outline_rounded,
                texto: 'Só o dono da conta pode importar os clientes.',
              )
            else
              const SizedBox.shrink()
          else if (formulario) ...[
            // Material, e não Container colorido: o CheckboxListTile pinta o
            // toque no Material mais próximo.
            Material(
              color: c.superficie2,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
              ),
              child: Padding(
                padding: const EdgeInsets.fromLTRB(4, 4, 12, 12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    CheckboxListTile(
                      key: const ValueKey('consentimento-regem'),
                      value: _consentimento,
                      onChanged: widget.ocupado
                          ? null
                          : (v) => setState(() => _consentimento = v ?? false),
                      controlAffinity: ListTileControlAffinity.leading,
                      contentPadding: EdgeInsets.zero,
                      title: const Text(
                        'Declaro que os clientes da minha empresa autorizaram receber mensagens desta empresa no WhatsApp.',
                        style: TextStyle(fontSize: 14, height: 1.4),
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.only(left: 10),
                      child: TextField(
                        key: const ValueKey('evidencia-regem'),
                        controller: _evidencia,
                        maxLength: 500,
                        decoration: const InputDecoration(
                          labelText: 'Como autorizaram? (opcional)',
                          hintText: 'Aceite no cardápio, pedido pelo WhatsApp…',
                        ),
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.only(left: 10),
                      child: Text(
                        'Quem aceitou receber promoções no cardápio do Regem entra com esse aceite, que é a prova mais forte. Quem pediu para sair lá entra descadastrado. Quem já está na sua base mantém o cadastro que tinha — nada é sobrescrito. Clientes só de marketplace (iFood e outros) ficam de fora.',
                        style: pequeno,
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                FilledButton(
                  key: const ValueKey('importar-regem'),
                  style: FilledButton.styleFrom(minimumSize: const Size(0, 44)),
                  onPressed: !_consentimento || widget.ocupado
                      ? null
                      : () =>
                            widget.aoImportar(_consentimento, _evidencia.text),
                  child: Text(
                    k.status == 'parado'
                        ? 'Importar clientes'
                        : 'Ler tudo de novo',
                  ),
                ),
                if (k.status != 'parado')
                  TextButton(
                    onPressed: widget.ocupado
                        ? null
                        : () => setState(() => _releitura = false),
                    child: const Text('Cancelar'),
                  ),
              ],
            ),
          ] else
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton(
                key: const ValueKey('reler-regem'),
                onPressed: () => setState(() => _releitura = true),
                child: const Text('Ler tudo de novo'),
              ),
            ),
        ],
      ],
    );
  }
}

/// As compras: as vendas de cada cliente nos últimos 3 anos. Começam quando os
/// clientes terminam; depois, as novas e as canceladas chegam a cada 30 min.
class _ComprasRegem extends StatelessWidget {
  const _ComprasRegem({
    required this.situacao,
    required this.ehDono,
    required this.ocupado,
    required this.aoAtualizar,
  });

  final SituacaoRegem situacao;
  final bool ehDono;
  final bool ocupado;
  final VoidCallback aoAtualizar;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final s = situacao;
    final p = s.vendas;
    final (selo, tom) = switch (p.status) {
      'carga' => ('Lendo o histórico', TomPilula.acento),
      'em_dia' => ('Em dia', TomPilula.sucesso),
      'falhou' => ('Parou', TomPilula.erro),
      _ => ('Não buscadas', TomPilula.neutro),
    };
    final suave = TextStyle(color: c.tintaSuave, height: 1.45, fontSize: 13.5);
    final pequeno = TextStyle(
      color: c.tintaSuave,
      fontSize: 12.5,
      height: 1.45,
    );

    return BlocoIntegracao(
      titulo: 'Compras',
      chave: 'regem-compras',
      selo: selo,
      tom: tom,
      vivo: p.status == 'carga',
      filhos: [
        if (p.status == 'parado')
          Text(
            'As vendas dos últimos 3 anos, cliente por cliente: quanto gastou, quantas vezes comprou, a primeira e a última compra, o bairro e o que pediu. '
            '${s.clientes.status == 'carga' ? 'Começam assim que a leitura dos clientes terminar.' : 'Vêm depois da importação dos clientes.'}',
            style: suave,
          ),
        if (p.status == 'carga') ...[
          const Text(
            'Lendo as vendas dos últimos 3 anos. Pode fechar esta tela: a leitura continua no servidor.',
            style: TextStyle(height: 1.45),
          ),
          const SizedBox(height: 6),
          Text(
            '${f.numero(p.lidas)} vendas lidas · ${f.numero(p.compras)} compras de ${f.numero(p.clientes)} clientes até agora',
            style: pequeno,
          ),
          if (p.erro != null) ...[
            const SizedBox(height: 8),
            Aviso(icone: Icons.info_outline_rounded, texto: p.erro!),
          ],
        ],
        if (p.status == 'em_dia') ...[
          gradeDeNumeros([
            NumeroIntegracao(rotulo: 'Compras', valor: f.numero(p.compras)),
            NumeroIntegracao(
              rotulo: 'Clientes que compraram',
              valor: f.numero(p.clientes),
            ),
            NumeroIntegracao(
              rotulo: 'Primeira compra',
              valor: f.data(p.primeira),
            ),
            NumeroIntegracao(rotulo: 'Última compra', valor: f.data(p.ultima)),
          ]),
          if (p.compras == 0) ...[
            const SizedBox(height: 8),
            Text(
              'Nenhuma venda virou compra ainda: entram só as dos canais da sua empresa, com telefone.',
              style: suave,
            ),
          ],
          if (p.erro != null) ...[
            const SizedBox(height: 8),
            Aviso(icone: Icons.info_outline_rounded, texto: p.erro!),
          ],
          const SizedBox(height: 8),
          Text(
            'Atualizado em ${f.dataHora(p.ultimaConsulta)}. As vendas novas chegam a cada 30 minutos, e os totais de cada cliente aparecem em Contatos e nos perfis da base.',
            style: pequeno,
          ),
          if (ehDono) ...[
            const SizedBox(height: 8),
            Align(
              alignment: Alignment.centerLeft,
              child: OutlinedButton(
                key: const ValueKey('atualizar-regem'),
                style: OutlinedButton.styleFrom(minimumSize: const Size(0, 42)),
                onPressed: ocupado ? null : aoAtualizar,
                child: const Text('Atualizar agora'),
              ),
            ),
          ],
        ],
        if (p.status == 'falhou') ...[
          Aviso(
            tom: TomPilula.erro,
            icone: Icons.error_outline_rounded,
            texto: p.erro ?? 'A leitura das vendas parou.',
          ),
          if (ehDono) ...[
            const SizedBox(height: 10),
            Align(
              alignment: Alignment.centerLeft,
              child: FilledButton(
                key: const ValueKey('tentar-vendas-regem'),
                style: FilledButton.styleFrom(minimumSize: const Size(0, 44)),
                onPressed: ocupado ? null : aoAtualizar,
                child: const Text('Tentar de novo'),
              ),
            ),
          ],
        ],
        if (p.status != 'parado') ...[
          const SizedBox(height: 10),
          Divider(height: 1, color: c.borda),
          const SizedBox(height: 8),
          Text(
            'Ficam de fora as vendas do iFood e dos outros marketplaces (a 99, só com a sua autorização), as sem telefone e as de quem pediu para não receber mensagens. Venda cancelada sai das compras.',
            style: pequeno,
          ),
        ],
      ],
    );
  }
}

/// Os clientes da 99Food — só com a autorização do dono, sob a
/// responsabilidade da empresa. O texto aceito vem do servidor, que é quem
/// grava. O Regem só entrega a 99 quando a equipe do Regemcast libera no
/// token; até lá, a autorização fica registrada e o bloco diz que falta.
class _ClientesDa99 extends StatefulWidget {
  const _ClientesDa99({
    super.key,
    required this.situacao,
    required this.ehDono,
    required this.ocupado,
    required this.aoAutorizar,
    required this.aoDesfazer,
  });

  final SituacaoRegem situacao;
  final bool ehDono;
  final bool ocupado;
  final VoidCallback aoAutorizar;
  final VoidCallback aoDesfazer;

  @override
  State<_ClientesDa99> createState() => _ClientesDa99State();
}

class _ClientesDa99State extends State<_ClientesDa99> {
  bool _declaracao = false;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final s = widget.situacao;
    final (selo, tom) = !s.incluir99
        ? ('Não autorizada', TomPilula.neutro)
        : s.escopo99
        ? ('Incluídos', TomPilula.sucesso)
        : ('Aguardando a liberação', TomPilula.acento);

    return BlocoIntegracao(
      titulo: 'Clientes da 99Food (opcional)',
      chave: 'regem-99',
      selo: selo,
      tom: tom,
      filhos: !s.incluir99
          ? [
              Text(
                'A 99 entrega ao Regem o número de verdade de quem compra por ela, mas esse cliente não aceitou receber promoções da sua loja. Só traga esses clientes se a sua empresa tiver a autorização deles — a responsabilidade é da empresa. Os outros marketplaces (iFood e demais) nunca entram.',
                style: TextStyle(
                  color: c.tintaSuave,
                  height: 1.45,
                  fontSize: 13.5,
                ),
              ),
              const SizedBox(height: 10),
              if (widget.ehDono) ...[
                Material(
                  color: c.superficie2,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(4, 4, 12, 4),
                    child: CheckboxListTile(
                      key: const ValueKey('declaracao-99'),
                      value: _declaracao,
                      onChanged: widget.ocupado
                          ? null
                          : (v) => setState(() => _declaracao = v ?? false),
                      controlAffinity: ListTileControlAffinity.leading,
                      contentPadding: EdgeInsets.zero,
                      title: Text(
                        s.textoAutorizacao99,
                        style: const TextStyle(fontSize: 14, height: 1.4),
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 10),
                Align(
                  alignment: Alignment.centerLeft,
                  child: OutlinedButton(
                    key: const ValueKey('autorizar-99'),
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size(0, 42),
                    ),
                    onPressed: !_declaracao || widget.ocupado
                        ? null
                        : widget.aoAutorizar,
                    child: const Text('Autorizar a 99'),
                  ),
                ),
              ] else
                const Aviso(
                  tom: TomPilula.acento,
                  icone: Icons.lock_outline_rounded,
                  texto: 'Só o dono da conta pode autorizar os clientes da 99.',
                ),
            ]
          : [
              Text(
                s.escopo99
                    ? 'Os clientes e as compras da 99 estão incluídos, com a autorização de ${f.data(s.autorizacao99Em)}.'
                    : 'Autorização registrada em ${f.data(s.autorizacao99Em)}. Falta a liberação no Regem, que a nossa equipe faz — você não precisa fazer nada. Quando sair, os clientes e as vendas da 99 são lidos do começo.',
                style: const TextStyle(height: 1.45),
              ),
              if (widget.ehDono) ...[
                const SizedBox(height: 8),
                Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton(
                    key: const ValueKey('desfazer-99'),
                    onPressed: widget.ocupado ? null : widget.aoDesfazer,
                    child: const Text('Desfazer a autorização'),
                  ),
                ),
              ],
            ],
    );
  }
}
