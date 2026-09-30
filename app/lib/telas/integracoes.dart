import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/erro_api.dart';
import '../api/integracoes.dart';
import '../componentes/basicos.dart';
import '../componentes/dialogos.dart';
import '../sessao/sessao.dart';
import '../tema/cores.dart';
import '../util/formato.dart' as f;
import 'importar_contatos.dart';

/// Importando clientes, a tela relê depressa; buscando pedidos, sem pressa (é
/// uma página a cada 15 s no servidor).
const _releituraClientes = Duration(seconds: 2);
const _releituraPedidos = Duration(seconds: 8);

/// Integrações: o Regemcast ligado ao cardápio digital da loja — a tela do
/// site (`(app)/integracoes`). Diferente de importar um arquivo, a integração
/// traz o HISTÓRICO de compras de cada cliente e continua trazendo.
class TelaIntegracoes extends ConsumerWidget {
  const TelaIntegracoes({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = Cores.de(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Integrações')),
      body: ListView(
        padding: respiroDaTela(context, topo: 4),
        children: [
          Text(
            'Ligue o Regemcast ao cardápio digital da sua loja: os clientes e o histórico de compras de cada um chegam sozinhos, prontos para separar a base das campanhas.',
            style: TextStyle(color: c.tintaSuave, height: 1.45),
          ),
          const SizedBox(height: 16),
          const CartaoCardapioWeb(),
          const SizedBox(height: 14),
          Cartao(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Row(
                  children: [
                    Expanded(
                      child: Text(
                        'Cardápio digital do Regem',
                        style: TextStyle(
                          fontWeight: FontWeight.w600,
                          fontSize: 16,
                        ),
                      ),
                    ),
                    Pilula(
                      'Em preparação',
                      tom: TomPilula.acento,
                      ponto: false,
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                Text(
                  'Para quem vende pelo cardápio digital e pelo PDV do Regem.',
                  style: TextStyle(color: c.tintaSuave, fontSize: 13),
                ),
                const SizedBox(height: 8),
                Text(
                  'Os clientes e as compras vão chegar direto do Regem, sem planilha e sem token para copiar. Quando estiver liberado, a conexão aparece aqui.',
                  style: TextStyle(color: c.tintaSuave, height: 1.45),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          Cartao(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Lista do celular ou planilha',
                  style: TextStyle(fontWeight: FontWeight.w600, fontSize: 16),
                ),
                const SizedBox(height: 4),
                Text(
                  'Contatos só com nome e número, sem pedidos.',
                  style: TextStyle(color: c.tintaSuave, fontSize: 13),
                ),
                const SizedBox(height: 8),
                Text(
                  'Exportou os contatos do celular (.vcf) ou tem uma planilha só com nome e número? Importe em Contatos. Sem histórico de compras, organize a base de outro jeito: em blocos do tamanho do seu limite de envio e por região, pelo DDD.',
                  style: TextStyle(color: c.tintaSuave, height: 1.45),
                ),
                const SizedBox(height: 12),
                OutlinedButton.icon(
                  key: const ValueKey('ir-importar'),
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size(0, 42),
                  ),
                  onPressed: () => Navigator.of(context).push(
                    MaterialPageRoute<Object?>(
                      builder: (_) => const TelaImportarContatos(),
                    ),
                  ),
                  icon: const Icon(Icons.upload_file_rounded),
                  label: const Text('Importar contatos'),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// A loja do Cardápio Web inteira num cartão: conectar, os clientes, as
/// compras e o cashback. Enquanto algo anda no servidor, a tela relê sozinha.
class CartaoCardapioWeb extends ConsumerStatefulWidget {
  const CartaoCardapioWeb({super.key});

  @override
  ConsumerState<CartaoCardapioWeb> createState() => _CartaoCardapioWebState();
}

class _CartaoCardapioWebState extends ConsumerState<CartaoCardapioWeb> {
  SituacaoCardapioWeb? _s;
  Object? _erroDeLeitura;
  bool _ocupado = false;
  bool _trocando = false;
  Timer? _proxima;

  ServicoCardapioWeb get _servico => ref.read(servicoCardapioWebProvider);

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
      // Algo andando: relê sozinha — uma falha de rede aqui não para nada,
      // o trabalho roda no servidor.
      if (s.trabalhando) {
        _proxima = Timer(
          s.clientes.rodando ? _releituraClientes : _releituraPedidos,
          _carregar,
        );
      }
    } catch (e) {
      if (!mounted) return;
      if (_s == null) {
        setState(() => _erroDeLeitura = e);
      } else if (_s!.trabalhando) {
        _proxima = Timer(_releituraPedidos, _carregar);
      }
    }
  }

  /// Faz a ação e relê a situação. Devolve se deu certo.
  Future<bool> _agir(Future<void> Function() acao) async {
    setState(() => _ocupado = true);
    try {
      await acao();
      await _carregar();
      return true;
    } catch (e) {
      if (mounted) avisar(context, mensagemDoErro(e));
      return false;
    } finally {
      if (mounted) setState(() => _ocupado = false);
    }
  }

  Future<void> _conectar(String chave) async {
    String? loja;
    final ok = await _agir(() async => loja = await _servico.conectar(chave));
    if (ok && mounted) {
      setState(() => _trocando = false);
      avisar(context, 'Loja $loja conectada.');
    }
  }

  Future<void> _desconectar() async {
    final ok = await confirmar(
      context,
      titulo: 'Desconectar a loja?',
      texto:
          'Para de trazer clientes e compras. O que já está na sua base fica — menos o saldo de cashback, que sem a conexão ficaria velho.',
      botao: 'Desconectar',
      perigo: true,
    );
    if (!ok || !mounted) return;
    if (await _agir(_servico.desconectar) && mounted) {
      avisar(context, 'Loja desconectada.');
    }
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
              titulo: 'Não consegui ler a conexão com o Cardápio Web',
              mensagem: mensagemDoErro(_erroDeLeitura!),
              aoTentar: () {
                setState(() => _erroDeLeitura = null);
                _carregar();
              },
            )
          : const Esqueleto(altura: 90);
    } else if (!s.conectado || _trocando) {
      corpo = _Conectar(
        ehDono: ehDono,
        ocupado: _ocupado,
        lojaNome: _trocando ? s.lojaNome : null,
        aoConectar: _conectar,
        aoCancelar: _trocando ? () => setState(() => _trocando = false) : null,
      );
    } else {
      corpo = Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text.rich(
            TextSpan(
              children: [
                const TextSpan(text: 'Loja conectada: '),
                TextSpan(
                  text: s.lojaNome ?? '—',
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          _Clientes(
            situacao: s,
            ehDono: ehDono,
            ocupado: _ocupado,
            aoImportar: (consentimento, evidencia) => _agir(
              () => _servico.importar(
                consentimento: consentimento,
                evidencia: evidencia,
              ),
            ),
          ),
          if (s.compras != null) ...[
            const SizedBox(height: 12),
            _Compras(
              situacao: s,
              ehDono: ehDono,
              ocupado: _ocupado,
              aoBuscar: () => _agir(_servico.buscarPedidos),
              aoTrocarToken: () => setState(() => _trocando = true),
            ),
          ],
          if (s.cashback != null && s.clientes.status != 'parada') ...[
            const SizedBox(height: 12),
            _Cashback(cashback: s.cashback!),
          ],
          if (ehDono) ...[
            const SizedBox(height: 14),
            Divider(height: 1, color: c.borda),
            const SizedBox(height: 12),
            Text(
              'O Cardápio Web recusou o token? Troque por um novo: o que já veio continua, e a busca retoma de onde parou. Desconectar para de trazer clientes e compras; o que já está na sua base fica — menos o saldo de cashback, que sem a conexão ficaria velho.',
              style: TextStyle(
                color: c.tintaSuave,
                fontSize: 12.5,
                height: 1.45,
              ),
            ),
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                OutlinedButton(
                  key: const ValueKey('trocar-token'),
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size(0, 42),
                  ),
                  onPressed: _ocupado
                      ? null
                      : () => setState(() => _trocando = true),
                  child: const Text('Trocar token'),
                ),
                OutlinedButton(
                  key: const ValueKey('desconectar'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: c.erro,
                    minimumSize: const Size(0, 42),
                  ),
                  onPressed: _ocupado ? null : _desconectar,
                  child: const Text('Desconectar loja'),
                ),
              ],
            ),
          ],
        ],
      );
    }

    return Cartao(
      key: const ValueKey('cardapio-web'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              const Expanded(
                child: Text(
                  'Cardápio Web',
                  style: TextStyle(fontWeight: FontWeight.w600, fontSize: 16),
                ),
              ),
              if (s != null)
                s.conectado
                    ? const Pilula('Conectada', tom: TomPilula.sucesso)
                    : const Pilula('Não conectada', ponto: false),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            'A base de clientes da sua loja, o histórico de compras e o cashback de cada um.',
            style: TextStyle(color: c.tintaSuave, fontSize: 13),
          ),
          const SizedBox(height: 14),
          corpo,
        ],
      ),
    );
  }
}

/// Conectar a loja com o token que o próprio Cardápio Web gera — ou trocar o
/// token de uma loja já conectada, sem perder o que já veio. Conferido na hora
/// e guardado cifrado: ninguém vê de novo.
class _Conectar extends StatefulWidget {
  const _Conectar({
    required this.ehDono,
    required this.ocupado,
    required this.aoConectar,
    this.aoCancelar,
    this.lojaNome,
  });

  final bool ehDono;
  final bool ocupado;
  final ValueChanged<String> aoConectar;

  /// Presente quando é troca de token de uma loja já conectada.
  final VoidCallback? aoCancelar;
  final String? lojaNome;

  @override
  State<_Conectar> createState() => _ConectarState();
}

class _ConectarState extends State<_Conectar> {
  final _chave = TextEditingController();

  @override
  void dispose() {
    _chave.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final troca = widget.aoCancelar != null;
    final suave = TextStyle(color: c.tintaSuave, height: 1.45, fontSize: 13.5);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (troca)
          Text(
            'Token novo da loja ${widget.lojaNome ?? 'conectada'}. O que já veio continua, e a busca retoma de onde parou. Token de outra loja recomeça a busca de pedidos.',
            style: const TextStyle(height: 1.45),
          )
        else
          Text(
            'Traga quem já comprou de você, com o histórico de pedidos de cada um: quanto gastou, quantas vezes comprou, a última compra, o bairro e o que pediu. É o que permite separar a base para as campanhas — e só entra quem está com o WhatsApp liberado na loja.',
            style: suave,
          ),
        const SizedBox(height: 12),
        if (!widget.ehDono)
          const Aviso(
            tom: TomPilula.acento,
            icone: Icons.lock_outline_rounded,
            texto: 'Só o dono da conta pode conectar a loja do Cardápio Web.',
          )
        else ...[
          const Text(
            '1. No Portal do Cardápio Web, abra Configurações → Integrações → API.',
          ),
          const SizedBox(height: 4),
          const Text('2. Copie o token da loja e cole abaixo.'),
          const SizedBox(height: 10),
          const Aviso(
            icone: Icons.warning_amber_rounded,
            texto:
                'Se já existe um token, copie o que está lá. Gerar um novo desliga os outros sistemas que usam o antigo, como um PDV ou outra integração.',
          ),
          const SizedBox(height: 12),
          TextField(
            key: const ValueKey('chave-cw'),
            controller: _chave,
            autocorrect: false,
            enableSuggestions: false,
            onChanged: (_) => setState(() {}),
            decoration: InputDecoration(
              labelText: troca ? 'Token novo da loja' : 'Token da loja',
              helperText:
                  'Conferimos na hora com o Cardápio Web e guardamos cifrado. Ninguém vê de novo, nem você.',
              helperMaxLines: 3,
            ),
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              FilledButton(
                key: const ValueKey('conectar-cw'),
                style: FilledButton.styleFrom(minimumSize: const Size(0, 44)),
                onPressed: widget.ocupado || _chave.text.trim().length < 10
                    ? null
                    : () => widget.aoConectar(_chave.text),
                child: widget.ocupado
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : Text(troca ? 'Salvar token novo' : 'Conectar loja'),
              ),
              if (troca)
                TextButton(
                  onPressed: widget.ocupado ? null : widget.aoCancelar,
                  child: const Text('Cancelar'),
                ),
            ],
          ),
        ],
      ],
    );
  }
}

/// Um bloco do cartão (Clientes, Compras, Cashback): título e o selo.
class _Bloco extends StatelessWidget {
  const _Bloco({
    required this.titulo,
    required this.selo,
    required this.tom,
    required this.filhos,
    this.vivo = false,
  });

  final String titulo;
  final String selo;
  final TomPilula tom;
  final bool vivo;
  final List<Widget> filhos;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    return Container(
      key: ValueKey('bloco-$titulo'),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: c.borda),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  titulo,
                  style: const TextStyle(fontWeight: FontWeight.w600),
                ),
              ),
              Pilula(selo, tom: tom, vivo: vivo),
            ],
          ),
          const SizedBox(height: 10),
          ...filhos,
        ],
      ),
    );
  }
}

class _Numero extends StatelessWidget {
  const _Numero({required this.rotulo, required this.valor});

  final String rotulo;
  final String valor;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: c.superficie2,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(rotulo, style: TextStyle(color: c.tintaSuave, fontSize: 12)),
          Text(
            valor,
            style: const TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w700,
              fontFeatures: [FontFeature.tabularFigures()],
            ),
          ),
        ],
      ),
    );
  }
}

Widget _grade(List<Widget> numeros) => LayoutBuilder(
  builder: (_, limites) {
    final largura = (limites.maxWidth - 8) / 2;
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [for (final n in numeros) SizedBox(width: largura, child: n)],
    );
  },
);

Widget _barra(Cores c, double fracao) => ClipRRect(
  borderRadius: BorderRadius.circular(99),
  child: LinearProgressIndicator(
    value: fracao,
    minHeight: 8,
    color: c.acento,
    backgroundColor: c.superficie2,
  ),
);

/// Os clientes da loja: só entra quem está com o WhatsApp liberado no
/// Cardápio Web; quem desligou entra já descadastrado. A declaração de
/// consentimento é a condição da Meta para a empresa iniciar a conversa.
class _Clientes extends StatefulWidget {
  const _Clientes({
    required this.situacao,
    required this.ehDono,
    required this.ocupado,
    required this.aoImportar,
  });

  final SituacaoCardapioWeb situacao;
  final bool ehDono;
  final bool ocupado;
  final void Function(bool consentimento, String evidencia) aoImportar;

  @override
  State<_Clientes> createState() => _ClientesState();
}

class _ClientesState extends State<_Clientes> {
  bool _consentimento = false;
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
      'rodando' => ('Importando', TomPilula.acento),
      'concluida' => ('Importados', TomPilula.sucesso),
      'falhou' => ('Parou', TomPilula.erro),
      _ => ('Não importados', TomPilula.neutro),
    };
    final suave = TextStyle(color: c.tintaSuave, height: 1.45, fontSize: 13.5);

    return _Bloco(
      titulo: 'Clientes',
      selo: selo,
      tom: tom,
      vivo: k.rodando,
      filhos: k.rodando
          ? [
              Text(
                'Importando os clientes de ${s.lojaNome ?? 'sua loja'}… pode fechar esta tela, a importação continua no servidor.',
                style: const TextStyle(height: 1.45),
              ),
              const SizedBox(height: 10),
              _barra(c, k.progresso / 100),
              const SizedBox(height: 6),
              Text(
                '${f.numero(k.lidos)} lidos · ${f.numero(k.novos)} novos${(k.totalPaginas ?? 0) > 0 ? ' · página ${k.pagina} de ${k.totalPaginas}' : ''}',
                style: TextStyle(
                  color: c.tintaSuave,
                  fontSize: 12.5,
                  fontFeatures: const [FontFeature.tabularFigures()],
                ),
              ),
            ]
          : [
              if (k.status == 'falhou' && k.erro != null) ...[
                Aviso(
                  tom: TomPilula.erro,
                  icone: Icons.error_outline_rounded,
                  texto: k.erro!,
                ),
                const SizedBox(height: 10),
              ],
              if (k.status == 'concluida')
                Text(
                  'Importação de ${f.data(k.concluidaEm)}: ${f.plural(k.lidos, 'cliente lido', 'clientes lidos')}, ${f.plural(k.novos, 'novo', 'novos')} na base'
                  '${k.bloqueados > 0 ? ', ${f.numero(k.bloqueados)} com WhatsApp desligado (entraram descadastrados)' : ''}'
                  '${k.invalidos > 0 ? ', ${f.numero(k.invalidos)} sem telefone válido' : ''}. Os liberados estão na lista Clientes Cardápio Web.',
                  style: const TextStyle(height: 1.45),
                ),
              if (k.status == 'parada')
                Text(
                  'Traga a base de clientes da loja. O histórico de compras vem junto.',
                  style: suave,
                ),
              const SizedBox(height: 10),
              if (widget.ehDono) ...[
                // Material, e não Container colorido: o CheckboxListTile
                // pinta o toque no Material mais próximo.
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
                          key: const ValueKey('consentimento-cw'),
                          value: _consentimento,
                          onChanged: widget.ocupado
                              ? null
                              : (v) =>
                                    setState(() => _consentimento = v ?? false),
                          controlAffinity: ListTileControlAffinity.leading,
                          contentPadding: EdgeInsets.zero,
                          title: const Text(
                            'Declaro que os clientes da minha loja autorizaram receber mensagens desta empresa no WhatsApp.',
                            style: TextStyle(fontSize: 14, height: 1.4),
                          ),
                        ),
                        Padding(
                          padding: const EdgeInsets.only(left: 10),
                          child: TextField(
                            controller: _evidencia,
                            maxLength: 500,
                            decoration: const InputDecoration(
                              labelText: 'Como autorizaram? (opcional)',
                              hintText:
                                  'Aceite no cadastro do cardápio, pedido pelo WhatsApp…',
                            ),
                          ),
                        ),
                        Padding(
                          padding: const EdgeInsets.only(left: 10),
                          child: Text(
                            'Quem desligou o WhatsApp no Cardápio Web entra descadastrado. Quem já está na sua base mantém o cadastro que tinha — nada é sobrescrito.',
                            style: TextStyle(
                              color: c.tintaSuave,
                              fontSize: 12.5,
                              height: 1.45,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 10),
                Align(
                  alignment: Alignment.centerLeft,
                  child: FilledButton(
                    key: const ValueKey('importar-clientes'),
                    style: FilledButton.styleFrom(
                      minimumSize: const Size(0, 44),
                    ),
                    onPressed: !_consentimento || widget.ocupado
                        ? null
                        : () => widget.aoImportar(
                            _consentimento,
                            _evidencia.text,
                          ),
                    child: Text(
                      k.status == 'concluida'
                          ? 'Importar de novo'
                          : 'Importar clientes',
                    ),
                  ),
                ),
              ] else
                const Aviso(
                  tom: TomPilula.acento,
                  icone: Icons.lock_outline_rounded,
                  texto:
                      'Só o dono da conta pode importar os clientes da loja.',
                ),
            ],
    );
  }
}

/// As compras: o histórico de pedidos de cada cliente, que vira os totais do
/// contato e alimenta os perfis da base. Primeiro a carga dos últimos 3 anos;
/// depois, os pedidos novos a cada 30 minutos.
class _Compras extends StatelessWidget {
  const _Compras({
    required this.situacao,
    required this.ehDono,
    required this.ocupado,
    required this.aoBuscar,
    required this.aoTrocarToken,
  });

  final SituacaoCardapioWeb situacao;
  final bool ehDono;
  final bool ocupado;
  final VoidCallback aoBuscar;
  final VoidCallback aoTrocarToken;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final s = situacao;
    final p = s.compras!;
    final (selo, tom) = switch (p.status) {
      'carga' => ('Buscando histórico', TomPilula.acento),
      'em_dia' => ('Em dia', TomPilula.sucesso),
      'falhou' => ('Parou', TomPilula.erro),
      _ => ('Não buscadas', TomPilula.neutro),
    };
    final esperandoClientes = p.buscando && s.clientes.rodando;
    final suave = TextStyle(color: c.tintaSuave, height: 1.45, fontSize: 13.5);
    final pequeno = TextStyle(
      color: c.tintaSuave,
      fontSize: 12.5,
      height: 1.45,
    );

    return _Bloco(
      titulo: 'Compras',
      selo: selo,
      tom: tom,
      vivo: p.buscando,
      filhos: [
        if (p.status == 'parado') ...[
          Text(
            'Os pedidos dos últimos 3 anos, cliente por cliente: quanto gastou, quantas vezes comprou, a primeira e a última compra, o bairro e o que pediu.${s.clientes.status == 'parada' ? ' Vêm junto com a importação dos clientes.' : ''}',
            style: suave,
          ),
          if (ehDono && s.clientes.status != 'parada') ...[
            const SizedBox(height: 10),
            Align(
              alignment: Alignment.centerLeft,
              child: FilledButton(
                key: const ValueKey('buscar-pedidos'),
                style: FilledButton.styleFrom(minimumSize: const Size(0, 44)),
                onPressed: ocupado ? null : aoBuscar,
                child: const Text('Buscar pedidos'),
              ),
            ),
          ],
        ],
        if (p.status == 'carga')
          if (esperandoClientes)
            Text(
              'A busca dos pedidos começa assim que a importação dos clientes terminar.',
              style: suave,
            )
          else ...[
            Text(
              'Lendo os pedidos de ${f.data(p.cargaDe)} a ${f.data(p.cargaAte)}. Pode fechar esta tela: a busca continua no servidor.',
              style: const TextStyle(height: 1.45),
            ),
            const SizedBox(height: 10),
            _barra(c, p.progresso / 100),
            const SizedBox(height: 6),
            Text(
              '${p.progresso}% · ${f.numero(p.lidos)} pedidos lidos · ${f.numero(p.compras)} compras de ${f.numero(p.clientes)} clientes até agora',
              style: pequeno,
            ),
            if (p.erro != null) ...[
              const SizedBox(height: 8),
              Aviso(icone: Icons.info_outline_rounded, texto: p.erro!),
            ],
          ],
        if (p.status == 'em_dia') ...[
          _grade([
            _Numero(rotulo: 'Compras', valor: f.numero(p.compras)),
            _Numero(
              rotulo: 'Clientes que compraram',
              valor: f.numero(p.clientes),
            ),
            _Numero(rotulo: 'Primeira compra', valor: f.data(p.primeira)),
            _Numero(rotulo: 'Última compra', valor: f.data(p.ultima)),
          ]),
          if (p.compras == 0) ...[
            const SizedBox(height: 8),
            Text(
              'Nenhum pedido virou compra ainda: entram só os feitos no seu cardápio, com telefone.',
              style: suave,
            ),
          ],
          if (p.erro != null) ...[
            const SizedBox(height: 8),
            Aviso(icone: Icons.info_outline_rounded, texto: p.erro!),
          ],
          const SizedBox(height: 8),
          Text(
            'Atualizado em ${f.dataHora(p.ultimaConsulta)}. Os pedidos novos chegam a cada 30 minutos, e os totais de cada cliente aparecem em Contatos e nos perfis da base.',
            style: pequeno,
          ),
          if (ehDono) ...[
            const SizedBox(height: 8),
            Align(
              alignment: Alignment.centerLeft,
              child: OutlinedButton(
                key: const ValueKey('atualizar-pedidos'),
                style: OutlinedButton.styleFrom(minimumSize: const Size(0, 42)),
                onPressed: ocupado ? null : aoBuscar,
                child: const Text('Atualizar agora'),
              ),
            ),
          ],
        ],
        if (p.status == 'falhou') ...[
          Aviso(
            tom: TomPilula.erro,
            icone: Icons.error_outline_rounded,
            texto: p.erro ?? 'A busca de pedidos parou.',
          ),
          if (ehDono) ...[
            const SizedBox(height: 8),
            Text(
              'Se o Cardápio Web recusou o token, troque por um novo: a busca retoma de onde parou. Senão, tente de novo — o que já foi guardado não é lido outra vez.',
              style: pequeno,
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                FilledButton(
                  key: const ValueKey('tentar-pedidos'),
                  style: FilledButton.styleFrom(minimumSize: const Size(0, 44)),
                  onPressed: ocupado ? null : aoBuscar,
                  child: const Text('Tentar de novo'),
                ),
                OutlinedButton(
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size(0, 42),
                  ),
                  onPressed: ocupado ? null : aoTrocarToken,
                  child: const Text('Trocar token'),
                ),
              ],
            ),
          ],
        ],
        if (p.status != 'parado') ...[
          const SizedBox(height: 10),
          Divider(height: 1, color: c.borda),
          const SizedBox(height: 8),
          Text(
            'Ficam de fora os pedidos do iFood e de outros marketplaces (o cliente é do marketplace), os sem telefone e os de quem pediu para não receber mensagens. Pedido cancelado sai das compras.',
            style: pequeno,
          ),
        ],
      ],
    );
  }
}

/// O cashback: quantos têm saldo que vale hoje, quantos vencem em 7 dias, a
/// soma e quando foi a última leitura — e para onde isso vai.
class _Cashback extends StatelessWidget {
  const _Cashback({required this.cashback});

  final CashbackDaLoja cashback;

  @override
  Widget build(BuildContext context) {
    final c = Cores.de(context);
    final k = cashback;
    final (selo, tom) = k.lendo
        ? ('Lendo', TomPilula.acento)
        : k.erro != null
        ? ('Parou', TomPilula.atencao)
        : k.ultimaLeitura != null
        ? ('Em dia', TomPilula.sucesso)
        : ('Aguardando', TomPilula.neutro);
    return _Bloco(
      titulo: 'Cashback',
      selo: selo,
      tom: tom,
      vivo: k.lendo,
      filhos: [
        if (k.ultimaLeitura != null)
          _grade([
            _Numero(
              rotulo: 'Clientes com cashback',
              valor: f.numero(k.comCashback),
            ),
            _Numero(
              rotulo: 'Vencem em até 7 dias',
              valor: f.numero(k.vencendo),
            ),
            _Numero(
              rotulo: 'Cashback na base',
              valor: f.reais(k.totalCentavos),
            ),
          ])
        else
          Text(
            'O saldo de cashback de cada cliente vem com a importação e é relido todo dia às 4h da manhã.',
            style: TextStyle(color: c.tintaSuave, height: 1.45),
          ),
        if (k.erro != null) ...[
          const SizedBox(height: 8),
          Aviso(icone: Icons.info_outline_rounded, texto: k.erro!),
        ],
        const SizedBox(height: 8),
        Text(
          '${k.ultimaLeitura != null ? 'Última leitura em ${f.dataHora(k.ultimaLeitura)}. ' : ''}'
          '${k.proximaLeitura != null ? 'Próxima: ${f.dataHora(k.proximaLeitura)}. ' : ''}'
          'A cada pedido novo, o saldo de quem comprou é relido. Use os públicos Têm cashback e Cashback vence em até 7 dias em Contatos e as variáveis Saldo do cashback e Validade do cashback na campanha — que só vai para quem tem saldo.',
          style: TextStyle(color: c.tintaSuave, fontSize: 12.5, height: 1.45),
        ),
      ],
    );
  }
}
