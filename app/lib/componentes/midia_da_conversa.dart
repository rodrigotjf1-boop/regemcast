import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:video_player/video_player.dart';

import '../api/conversas.dart';
import '../api/erro_api.dart';
import '../sessao/sessao.dart';
import '../tema/cores.dart';
import 'dialogos.dart';

/// Como a mídia se chama quando não dá mais para abrir (histórico antigo).
/// `media_placeholder` é a mídia que o histórico trouxe sem o arquivo — o
/// `ROTULO_DA_MIDIA` do site.
const rotulosDaMidia = {
  'image': '📷 Foto',
  'video': '🎥 Vídeo',
  'audio': '🎤 Áudio',
  'document': '📄 Documento',
  'sticker': 'Figurinha',
  'media_placeholder': '📎 Mídia',
};

bool ehMidia(String tipo) => rotulosDaMidia.containsKey(tipo);

const _indisponivel =
    'Esta mídia não está mais disponível. Veja no WhatsApp Business do celular.';

/// Salva um arquivo no celular, na pasta que a pessoa escolher (a janela do
/// Android — sem permissão de armazenamento). Devolve `false` se ela
/// cancelou. Fica atrás de um provider: o canal nativo não existe no teste.
typedef SalvarArquivo =
    Future<bool> Function({
      required String nome,
      required Uint8List bytes,
      required String tipoMime,
    });

final salvarArquivoProvider = Provider<SalvarArquivo>(
  (ref) =>
      ({required nome, required bytes, required tipoMime}) async =>
          await FilePicker.saveFile(
            fileName: nome,
            bytes: bytes,
            mimeType: tipoMime,
          ) !=
          null,
);

/// Cria o reprodutor de áudio e vídeo, que lê o arquivo aos poucos pela nossa
/// rota (com a sessão no cabeçalho). Atrás de um provider pelo mesmo motivo.
typedef FabricaDeReprodutor =
    VideoPlayerController Function(Uri endereco, Map<String, String> cabecalho);

final fabricaDeReprodutorProvider = Provider<FabricaDeReprodutor>(
  (ref) =>
      (endereco, cabecalho) =>
          VideoPlayerController.networkUrl(endereco, httpHeaders: cabecalho),
);

/// O nome do arquivo ao salvar: o que veio na mensagem, ou um pelo tipo.
String nomeDoArquivo(MensagemDaConversa m) {
  final nome = m.midiaNome?.trim();
  if (nome != null && nome.isNotEmpty) return nome;
  final extensao = switch ((m.midiaMime ?? '').split(';').first.trim()) {
    'image/jpeg' => 'jpg',
    'image/png' => 'png',
    'image/webp' => 'webp',
    'audio/ogg' => 'ogg',
    'audio/mpeg' => 'mp3',
    'audio/mp4' || 'audio/aac' => 'm4a',
    'video/mp4' => 'mp4',
    'video/3gpp' => '3gp',
    'application/pdf' => 'pdf',
    _ => 'bin',
  };
  return 'whatsapp-${m.id.split('-').first}.$extensao';
}

/// A mídia de uma mensagem. O arquivo não fica guardado no Regemcast: mora na
/// Meta e é buscado quando alguém abre — foto ao aparecer na tela; áudio e
/// vídeo só no play; documento só ao salvar. Mídia antiga sai da Meta, e a
/// mensagem diz isso em vez de mostrar um arquivo quebrado.
class MidiaDaMensagem extends StatelessWidget {
  const MidiaDaMensagem({
    super.key,
    required this.conversaId,
    required this.mensagem,
    required this.cor,
  });

  final String conversaId;
  final MensagemDaConversa mensagem;

  /// A cor do texto da bolha (escuro no lima, tinta no branco).
  final Color cor;

  @override
  Widget build(BuildContext context) => switch (mensagem.tipo) {
    'image' ||
    'sticker' => _Foto(conversaId: conversaId, mensagem: mensagem, cor: cor),
    'audio' => _Reprodutor(
      conversaId: conversaId,
      mensagem: mensagem,
      cor: cor,
      video: false,
    ),
    'video' => _Reprodutor(
      conversaId: conversaId,
      mensagem: mensagem,
      cor: cor,
      video: true,
    ),
    _ => _Documento(conversaId: conversaId, mensagem: mensagem, cor: cor),
  };
}

class _Indisponivel extends StatelessWidget {
  const _Indisponivel({required this.cor});

  final Color cor;

  @override
  Widget build(BuildContext context) => Text(
    _indisponivel,
    style: TextStyle(
      color: cor.withValues(alpha: .8),
      fontSize: 12.5,
      fontStyle: FontStyle.italic,
      height: 1.35,
    ),
  );
}

class _Foto extends ConsumerWidget {
  const _Foto({
    required this.conversaId,
    required this.mensagem,
    required this.cor,
  });

  final String conversaId;
  final MensagemDaConversa mensagem;
  final Color cor;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = Cores.de(context);
    final figurinha = mensagem.tipo == 'sticker';
    final carga = ref.watch(
      bytesDaMidiaDaConversaProvider((conversaId, mensagem.id)),
    );
    final lado = figurinha ? 112.0 : 200.0;
    return carga.when(
      loading: () => Container(
        width: lado,
        height: figurinha ? lado : 150,
        decoration: BoxDecoration(
          color: c.superficie2,
          borderRadius: BorderRadius.circular(12),
        ),
      ),
      error: (_, _) => _Indisponivel(cor: cor),
      data: (bytes) => Semantics(
        button: true,
        label: mensagem.texto ?? (figurinha ? 'Figurinha' : 'Foto recebida'),
        child: GestureDetector(
          onTap: () => Navigator.of(context).push(
            MaterialPageRoute<void>(
              builder: (_) => TelaDaFoto(mensagem: mensagem, bytes: bytes),
            ),
          ),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(12),
            child: Image.memory(
              bytes,
              width: figurinha ? lado : null,
              height: figurinha ? lado : null,
              fit: figurinha ? BoxFit.contain : BoxFit.cover,
              gaplessPlayback: true,
              errorBuilder: (_, _, _) => _Indisponivel(cor: cor),
              frameBuilder: (_, filho, quadro, sincrono) {
                if (quadro == null && !sincrono) {
                  return Container(
                    width: lado,
                    height: figurinha ? lado : 150,
                    color: c.superficie2,
                  );
                }
                return figurinha
                    ? filho
                    : ConstrainedBox(
                        constraints: const BoxConstraints(maxHeight: 260),
                        child: filho,
                      );
              },
            ),
          ),
        ),
      ),
    );
  }
}

/// A foto na tela inteira, com zoom — e "Salvar" no celular.
class TelaDaFoto extends ConsumerWidget {
  const TelaDaFoto({super.key, required this.mensagem, required this.bytes});

  final MensagemDaConversa mensagem;
  final Uint8List bytes;

  Future<void> _salvar(BuildContext context, WidgetRef ref) async {
    try {
      final salvou = await ref.read(salvarArquivoProvider)(
        nome: nomeDoArquivo(mensagem),
        bytes: bytes,
        tipoMime: mensagem.midiaMime ?? 'image/jpeg',
      );
      if (salvou && context.mounted) avisar(context, 'Foto salva no celular.');
    } catch (e) {
      if (context.mounted) avisar(context, mensagemDoErro(e));
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        actions: [
          IconButton(
            key: const ValueKey('salvar-foto'),
            tooltip: 'Salvar no celular',
            icon: const Icon(Icons.download_rounded),
            onPressed: () => _salvar(context, ref),
          ),
        ],
      ),
      body: Center(
        child: InteractiveViewer(
          maxScale: 5,
          child: Image.memory(bytes, fit: BoxFit.contain),
        ),
      ),
    );
  }
}

/// Áudio e vídeo: nada é baixado antes do play (como o `preload="none"` do
/// site) — uma conversa longa não gasta os dados móveis à toa.
class _Reprodutor extends ConsumerStatefulWidget {
  const _Reprodutor({
    required this.conversaId,
    required this.mensagem,
    required this.cor,
    required this.video,
  });

  final String conversaId;
  final MensagemDaConversa mensagem;
  final Color cor;
  final bool video;

  @override
  ConsumerState<_Reprodutor> createState() => _ReprodutorState();
}

class _ReprodutorState extends ConsumerState<_Reprodutor> {
  VideoPlayerController? _controle;
  bool _abrindo = false;
  bool _falhou = false;

  @override
  void dispose() {
    _controle?.dispose();
    super.dispose();
  }

  Future<void> _tocar() async {
    final atual = _controle;
    if (atual != null) {
      atual.value.isPlaying ? await atual.pause() : await atual.play();
      return;
    }
    setState(() => _abrindo = true);
    final api = ref.read(clienteApiProvider);
    final controle = ref.read(fabricaDeReprodutorProvider)(
      api.endereco(
        ServicoConversas.caminhoDaMidia(widget.conversaId, widget.mensagem.id),
      ),
      api.cabecalhoDaSessao,
    );
    try {
      await controle.initialize().timeout(const Duration(seconds: 20));
      if (!mounted) {
        await _descartar(controle);
        return;
      }
      setState(() => _controle = controle);
      await controle.play();
    } catch (_) {
      // A Meta já apagou o arquivo, ou o formato não abre neste celular.
      await _descartar(controle);
      if (mounted) setState(() => _falhou = true);
    } finally {
      if (mounted) setState(() => _abrindo = false);
    }
  }

  Future<void> _descartar(VideoPlayerController controle) async {
    try {
      await controle.dispose();
    } catch (_) {
      // Nunca abriu: não há o que soltar.
    }
  }

  String _tempo(Duration d) {
    final s = d.inSeconds;
    return '${s ~/ 60}:${(s % 60).toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    if (_falhou) return _Indisponivel(cor: widget.cor);
    final controle = _controle;
    final rotulo = rotulosDaMidia[widget.mensagem.tipo]!;
    final botao = IconButton(
      key: ValueKey('tocar-${widget.mensagem.id}'),
      tooltip: widget.video ? 'Tocar o vídeo' : 'Tocar o áudio',
      color: widget.cor,
      onPressed: _abrindo ? null : _tocar,
      icon: _abrindo
          ? SizedBox(
              width: 20,
              height: 20,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: widget.cor,
              ),
            )
          : controle == null
          ? const Icon(Icons.play_circle_fill_rounded, size: 34)
          : ValueListenableBuilder<VideoPlayerValue>(
              valueListenable: controle,
              builder: (_, v, _) => Icon(
                v.isPlaying
                    ? Icons.pause_circle_filled_rounded
                    : Icons.play_circle_fill_rounded,
                size: 34,
              ),
            ),
    );

    if (controle == null) {
      return Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          botao,
          Text(
            rotulo,
            style: TextStyle(color: widget.cor, fontWeight: FontWeight.w600),
          ),
        ],
      );
    }

    return ValueListenableBuilder<VideoPlayerValue>(
      valueListenable: controle,
      builder: (_, v, _) {
        if (v.hasError) return _Indisponivel(cor: widget.cor);
        final total = v.duration.inMilliseconds;
        final fracao = total <= 0
            ? 0.0
            : (v.position.inMilliseconds / total).clamp(0.0, 1.0);
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            if (widget.video && v.isInitialized)
              ClipRRect(
                borderRadius: BorderRadius.circular(12),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxHeight: 260),
                  child: AspectRatio(
                    aspectRatio: v.aspectRatio,
                    child: VideoPlayer(controle),
                  ),
                ),
              ),
            SizedBox(
              width: 230,
              child: Row(
                children: [
                  botao,
                  Expanded(
                    child: LinearProgressIndicator(
                      value: fracao,
                      minHeight: 3,
                      color: widget.cor,
                      backgroundColor: widget.cor.withValues(alpha: .2),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    '${_tempo(v.position)} / ${_tempo(v.duration)}',
                    style: TextStyle(
                      color: widget.cor,
                      fontSize: 11.5,
                      fontFeatures: const [FontFeature.tabularFigures()],
                    ),
                  ),
                ],
              ),
            ),
          ],
        );
      },
    );
  }
}

/// Documento: o nome e "Salvar" — baixa só quando a pessoa pede.
class _Documento extends ConsumerStatefulWidget {
  const _Documento({
    required this.conversaId,
    required this.mensagem,
    required this.cor,
  });

  final String conversaId;
  final MensagemDaConversa mensagem;
  final Color cor;

  @override
  ConsumerState<_Documento> createState() => _DocumentoState();
}

class _DocumentoState extends ConsumerState<_Documento> {
  bool _salvando = false;
  bool _falhou = false;

  Future<void> _salvar() async {
    setState(() => _salvando = true);
    try {
      final bytes = await ref
          .read(clienteApiProvider)
          .baixar(
            ServicoConversas.caminhoDaMidia(
              widget.conversaId,
              widget.mensagem.id,
            ),
          );
      final salvou = await ref.read(salvarArquivoProvider)(
        nome: nomeDoArquivo(widget.mensagem),
        bytes: bytes,
        tipoMime: widget.mensagem.midiaMime ?? 'application/octet-stream',
      );
      if (salvou && mounted) avisar(context, 'Documento salvo no celular.');
    } on ErroApi catch (e) {
      // A Meta já apagou o arquivo: a mensagem diz, em vez de erro técnico.
      if (mounted) {
        if (e.status == 400 || e.status == 404) {
          setState(() => _falhou = true);
        } else {
          avisar(context, e.mensagem);
        }
      }
    } catch (e) {
      if (mounted) avisar(context, mensagemDoErro(e));
    } finally {
      if (mounted) setState(() => _salvando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_falhou) return _Indisponivel(cor: widget.cor);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text('📄', style: TextStyle(color: widget.cor, fontSize: 18)),
        const SizedBox(width: 6),
        Flexible(
          child: Text(
            widget.mensagem.midiaNome ?? 'Documento',
            overflow: TextOverflow.ellipsis,
            style: TextStyle(color: widget.cor, fontWeight: FontWeight.w600),
          ),
        ),
        const SizedBox(width: 4),
        TextButton(
          key: ValueKey('salvar-${widget.mensagem.id}'),
          style: TextButton.styleFrom(
            foregroundColor: widget.cor,
            minimumSize: const Size(0, 36),
            padding: const EdgeInsets.symmetric(horizontal: 8),
          ),
          onPressed: _salvando ? null : _salvar,
          child: _salvando
              ? SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: widget.cor,
                  ),
                )
              : const Text('Salvar'),
        ),
      ],
    );
  }
}
