import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/contatos.dart';
import '../api/erro_api.dart';
import '../componentes/basicos.dart';
import '../tema/cores.dart';
import '../util/formato.dart' as f;

/// As ordens dos blocos, com o que cada uma faz — as do site
/// (`frontend/src/components/app/blocos/dividir-em-blocos.tsx`).
const ordensDosBlocos = <({String valor, String titulo, String ajuda})>[
  (
    valor: 'importacao',
    titulo: 'Como foi importado',
    ajuda: 'Na ordem em que os contatos entraram na base.',
  ),
  (
    valor: 'sorteio',
    titulo: 'Sorteio',
    ajuda: 'Blocos parecidos entre si — bom para testar duas mensagens.',
  ),
  (
    valor: 'recentes',
    titulo: 'Mais recentes primeiro',
    ajuda: 'Quem entrou na base por último vem antes.',
  ),
  (
    valor: 'regiao',
    titulo: 'Por região (DDD)',
    ajuda: 'Cada bloco com gente da mesma região.',
  ),
  (
    valor: 'valor',
    titulo: 'Melhores clientes primeiro',
    ajuda: 'Quem mais gastou vem antes. Precisa de histórico de pedidos.',
  ),
];

/// "na ordem de importação", "por sorteio"… — como a divisão aparece na lista.
String ordemDaDivisao(String ordem) => switch (ordem) {
  'importacao' => 'na ordem de importação',
  'sorteio' => 'por sorteio',
  'recentes' => 'mais recentes primeiro',
  'regiao' => 'por região',
  'valor' => 'melhores clientes primeiro',
  _ => ordem,
};

/// O menor bloco que o servidor aceita.
const tamanhoMinimoDoBloco = 50;

/// Dividir em blocos: cada bloco vira uma lista, escolhida na campanha como
/// qualquer outra.
///
/// Os tamanhos prontos só aparecem liberados até o limite de envio que a Meta
/// dá ao número hoje — o servidor diz quais. É o "envio de um dia": um bloco
/// por vez, olhando o resultado antes do próximo.
///
/// Devolve (pop) a [DivisaoDeBlocos] criada.
class TelaDividirEmBlocos extends ConsumerStatefulWidget {
  const TelaDividirEmBlocos({super.key, required this.alvo});

  final AlvoDaDivisao alvo;

  @override
  ConsumerState<TelaDividirEmBlocos> createState() =>
      _TelaDividirEmBlocosState();
}

class _TelaDividirEmBlocosState extends ConsumerState<TelaDividirEmBlocos> {
  final _personalizado = TextEditingController();

  /// Escolhido nas pílulas; nulo = o sugerido pelo servidor.
  int? _tamanho;
  bool _usarPersonalizado = false;
  String _ordem = 'importacao';
  bool _soNunca = false;
  bool _dividindo = false;
  String? _erro;

  @override
  void dispose() {
    _personalizado.dispose();
    super.dispose();
  }

  int _escolhido(OpcoesDeBloco? o) => _usarPersonalizado
      ? int.tryParse(_personalizado.text.trim()) ?? 0
      : _tamanho ?? o?.sugerido ?? 0;

  bool _valido(OpcoesDeBloco? o) {
    final n = _escolhido(o);
    return o != null && n >= tamanhoMinimoDoBloco && n <= o.maximo;
  }

  Future<void> _dividir(OpcoesDeBloco o) async {
    if (!_valido(o)) return;
    FocusScope.of(context).unfocus();
    setState(() {
      _dividindo = true;
      _erro = null;
    });
    try {
      final d = await ref
          .read(servicoContatosProvider)
          .dividir(
            widget.alvo.pedido(
              tamanho: _escolhido(o),
              ordem: _ordem,
              soNuncaReceberam: _soNunca,
            ),
          );
      if (!mounted) return;
      ref
        ..invalidate(divisoesProvider)
        ..invalidate(listasContatosProvider);
      Navigator.of(context).pop(d);
    } catch (e) {
      if (mounted) setState(() => _erro = mensagemDoErro(e));
    } finally {
      if (mounted) setState(() => _dividindo = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final alvo = widget.alvo;
    final carga = ref.watch(opcoesDeBlocoProvider);
    final o = carga.value;
    final escolhido = _escolhido(o);
    final total = alvo.total;
    final blocos = total != null && total > 0 && _valido(o) && !_soNunca
        ? (total / escolhido).ceil()
        : null;
    final ultimo = blocos == null ? 0 : total! - (blocos - 1) * escolhido;

    return Scaffold(
      appBar: AppBar(title: const Text('Dividir em blocos')),
      body: ListView(
        padding: respiroDaTela(context),
        children: [
          Text(alvo.rotulo, style: Theme.of(context).textTheme.titleMedium),
          if (total != null)
            Text(
              total == 1
                  ? '1 pessoa pode receber'
                  : '${f.numero(total)} pessoas podem receber',
              style: TextStyle(color: c.tintaSuave, fontSize: 13),
            ),
          if (alvo.soNomeENumero) ...[
            const SizedBox(height: 14),
            const Aviso(
              tom: TomPilula.acento,
              icone: Icons.contact_phone_outlined,
              texto:
                  'Lista só com nome e número — é o que vem no arquivo de contatos exportado do celular. Sem histórico de pedidos para filtrar, os blocos são o jeito de enviar aos poucos: um bloco por vez, dentro do limite do seu número, olhando o resultado de cada um antes de mandar o próximo.',
            ),
          ],
          const SizedBox(height: 20),
          Text(
            'Contatos por bloco',
            style: Theme.of(context).textTheme.titleSmall,
          ),
          const SizedBox(height: 10),
          carga.when(
            loading: () => const Esqueleto(altura: 40),
            error: (e, _) => EstadoErro(
              titulo: 'Não consegui ler os tamanhos',
              mensagem: mensagemDoErro(e),
              aoTentar: () => ref.invalidate(opcoesDeBlocoProvider),
            ),
            data: (o) => _Tamanhos(
              opcoes: o,
              escolhido: _usarPersonalizado ? null : _tamanho ?? o.sugerido,
              personalizado: _usarPersonalizado,
              aoEscolher: (v) => setState(() {
                _usarPersonalizado = false;
                _tamanho = v;
              }),
              aoPersonalizar: () => setState(() {
                _usarPersonalizado = true;
                if (_personalizado.text.isEmpty) {
                  _personalizado.text = '${o.sugerido}';
                }
              }),
            ),
          ),
          if (_usarPersonalizado && o != null) ...[
            const SizedBox(height: 12),
            TextField(
              key: const ValueKey('b-personalizado'),
              controller: _personalizado,
              keyboardType: TextInputType.number,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              onChanged: (_) => setState(() {}),
              decoration: InputDecoration(
                labelText: 'Quantos contatos por bloco',
                helperText: 'De $tamanhoMinimoDoBloco a ${f.numero(o.maximo)}.',
                errorText: _personalizado.text.isNotEmpty && !_valido(o)
                    ? 'Escolha de $tamanhoMinimoDoBloco a ${f.numero(o.maximo)}.'
                    : null,
              ),
            ),
          ],
          if (o != null) ...[
            const SizedBox(height: 10),
            Text(
              !o.limiteConhecido
                  ? 'O limite de envio do seu número ainda não foi lido — por enquanto, blocos de até 250 (o limite de quem começa).'
                  : o.limite == null
                  ? 'Seu número não tem teto diário na Meta: qualquer tamanho cabe.'
                  : 'Seu número pode falar com ${f.numero(o.limite!)} pessoas diferentes por dia hoje. Tamanhos maiores ficam disponíveis quando a Meta aumentar o limite.',
              style: TextStyle(
                color: c.tintaSuave,
                fontSize: 12.5,
                height: 1.45,
              ),
            ),
          ],
          const SizedBox(height: 22),
          Text(
            'Em que ordem os contatos entram',
            style: Theme.of(context).textTheme.titleSmall,
          ),
          const SizedBox(height: 6),
          RadioGroup<String>(
            groupValue: _ordem,
            onChanged: (v) {
              if (_dividindo || v == null) return;
              setState(() => _ordem = v);
            },
            child: Column(
              children: [
                for (final ordem in ordensDosBlocos)
                  RadioListTile<String>(
                    key: ValueKey('b-ordem-${ordem.valor}'),
                    value: ordem.valor,
                    contentPadding: EdgeInsets.zero,
                    title: Text(ordem.titulo),
                    subtitle: Text(
                      ordem.ajuda,
                      style: TextStyle(color: c.tintaSuave, fontSize: 12.5),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 6),
          CheckboxListTile(
            key: const ValueKey('b-so-nunca'),
            value: _soNunca,
            onChanged: _dividindo
                ? null
                : (v) => setState(() => _soNunca = v ?? false),
            controlAffinity: ListTileControlAffinity.leading,
            contentPadding: EdgeInsets.zero,
            title: const Text('Só quem ainda não recebeu nenhuma campanha'),
            subtitle: Text(
              'Para dividir de novo o que sobrou — por exemplo, quando o limite do número aumentar.',
              style: TextStyle(color: c.tintaSuave, fontSize: 12.5),
            ),
          ),
          if (blocos != null) ...[
            const SizedBox(height: 10),
            Container(
              key: const ValueKey('b-previa'),
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              decoration: BoxDecoration(
                color: c.superficie2,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: c.borda),
              ),
              child: Text(
                '${f.numero(total!)} pessoas → ${f.plural(blocos, 'bloco', 'blocos')} de ${f.numero(escolhido)}'
                '${blocos > 1 && ultimo != escolhido ? ' (o último com ${f.numero(ultimo)})' : ''}.',
                style: const TextStyle(
                  fontWeight: FontWeight.w600,
                  fontFeatures: [FontFeature.tabularFigures()],
                ),
              ),
            ),
          ],
          const SizedBox(height: 14),
          Text(
            'Lista fria? Mande o bloco 1, acompanhe entrega, leitura e quem pediu para sair, e só então siga para o próximo. Os blocos são uma foto de agora: quem entrar na base depois não entra sozinho — é só dividir de novo.',
            style: TextStyle(color: c.tintaSuave, fontSize: 12.5, height: 1.45),
          ),
          if (_erro != null) ...[
            const SizedBox(height: 14),
            Aviso(
              tom: TomPilula.erro,
              icone: Icons.error_outline_rounded,
              texto: _erro!,
            ),
          ],
        ],
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 12),
          child: FilledButton.icon(
            key: const ValueKey('b-dividir'),
            onPressed: _dividindo || o == null || !_valido(o)
                ? null
                : () => _dividir(o),
            icon: _dividindo
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.view_module_rounded),
            label: const Text('Dividir em blocos'),
          ),
        ),
      ),
    );
  }
}

/// As pílulas de tamanho: as que passam do limite de hoje ficam apagadas.
class _Tamanhos extends StatelessWidget {
  const _Tamanhos({
    required this.opcoes,
    required this.escolhido,
    required this.personalizado,
    required this.aoEscolher,
    required this.aoPersonalizar,
  });

  final OpcoesDeBloco opcoes;
  final int? escolhido;
  final bool personalizado;
  final ValueChanged<int> aoEscolher;
  final VoidCallback aoPersonalizar;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    Widget pilula({
      required Key key,
      required String rotulo,
      required bool ativa,
      required VoidCallback? aoTocar,
      String? dica,
    }) {
      final chip = ChoiceChip(
        key: key,
        label: Text(rotulo),
        selected: ativa,
        onSelected: aoTocar == null ? null : (_) => aoTocar(),
        showCheckmark: false,
        selectedColor: c.acento,
        backgroundColor: c.superficie,
        disabledColor: c.superficie2,
        side: BorderSide(color: ativa ? c.acento : c.borda),
        labelStyle: TextStyle(
          fontWeight: FontWeight.w600,
          fontFeatures: const [FontFeature.tabularFigures()],
          color: ativa
              ? c.acentoContraste
              : aoTocar == null
              ? c.tintaSuave.withValues(alpha: .6)
              : c.tinta,
        ),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(99)),
      );
      return dica == null ? chip : Tooltip(message: dica, child: chip);
    }

    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        for (final t in opcoes.tamanhos)
          pilula(
            key: ValueKey('b-tamanho-${t.valor}'),
            rotulo: f.numero(t.valor),
            ativa: !personalizado && escolhido == t.valor,
            aoTocar: t.disponivel ? () => aoEscolher(t.valor) : null,
            dica: t.disponivel
                ? null
                : 'Libera quando a Meta aumentar o limite do seu número',
          ),
        pilula(
          key: const ValueKey('b-tamanho-personalizado'),
          rotulo: 'Personalizado',
          ativa: personalizado,
          aoTocar: aoPersonalizar,
        ),
      ],
    );
  }
}
