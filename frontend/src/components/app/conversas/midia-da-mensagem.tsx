'use client';

import { useState } from 'react';

import { conversas } from '@/lib/servicos';
import type { MensagemDaConversa } from '@/lib/tipos';

/**
 * A mídia de uma mensagem: foto, figurinha, áudio, vídeo ou documento.
 *
 * O arquivo não fica guardado no Regemcast — mora na Meta e é buscado quando
 * alguém abre. Foto carrega só ao aparecer na tela (`loading="lazy"`); áudio e
 * vídeo só quando a pessoa aperta o play (`preload="none"`), para uma conversa
 * longa não baixar tudo de uma vez.
 *
 * Mídia antiga sai da Meta: quando isso acontece, a mensagem diz, em vez de
 * mostrar uma imagem quebrada.
 */
export function MidiaDaMensagem({ conversaId, m }: { conversaId: string; m: MensagemDaConversa }) {
  const [falhou, setFalhou] = useState(false);
  const endereco = conversas.enderecoDaMidia(conversaId, m.id);

  if (falhou) {
    return (
      <p className="text-xs italic opacity-80">
        Esta mídia não está mais disponível. Veja no WhatsApp Business do celular.
      </p>
    );
  }

  switch (m.tipo) {
    case 'image':
    case 'sticker':
      return (
        <a href={endereco} target="_blank" rel="noopener noreferrer" className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento">
          {/* eslint-disable-next-line @next/next/no-img-element -- arquivo servido pela nossa API, com o cookie da sessão */}
          <img
            src={endereco}
            alt={m.texto ?? (m.tipo === 'sticker' ? 'Figurinha' : 'Foto recebida')}
            loading="lazy"
            onError={() => setFalhou(true)}
            className={m.tipo === 'sticker' ? 'h-28 w-28 object-contain' : 'max-h-64 max-w-full rounded-lg object-cover'}
          />
        </a>
      );
    case 'audio':
      return <audio src={endereco} controls preload="none" onError={() => setFalhou(true)} className="w-60 max-w-full" />;
    case 'video':
      return (
        <video src={endereco} controls preload="none" onError={() => setFalhou(true)} className="max-h-64 max-w-full rounded-lg" />
      );
    default:
      return (
        <a
          href={endereco}
          download={m.midiaNome ?? undefined}
          className="inline-flex max-w-full items-center gap-2 rounded-lg border border-current/20 px-3 py-2 text-xs font-medium underline-offset-4 hover:underline"
        >
          <span aria-hidden="true">📄</span>
          <span className="truncate">{m.midiaNome ?? 'Documento'}</span>
          <span className="shrink-0 opacity-80">— baixar</span>
        </a>
      );
  }
}
