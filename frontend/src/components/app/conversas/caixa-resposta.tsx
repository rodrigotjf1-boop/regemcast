'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { IconeSetaDireita } from '@/components/app/icones';
import { Button } from '@/components/ui/button';
import { AreaDeTexto } from '@/components/ui/input';
import { formatarDataHora } from '@/lib/formato';

const LIMITE = 4096;

/**
 * Onde o atendente responde.
 *
 * A Meta só aceita texto livre dentro da janela de 24 horas aberta pela
 * ÚLTIMA MENSAGEM DO CLIENTE. Fora dela, a caixa não finge que funciona: diz
 * por que está fechada e aponta o caminho (modelo aprovado, pela tela de
 * Campanhas). Enter envia; Shift+Enter quebra a linha, como no WhatsApp Web.
 */
export function CaixaResposta({
  janelaAteEm,
  aoEnviar,
}: {
  janelaAteEm: string | null;
  /** Devolve `true` se a mensagem saiu — só então a caixa limpa. */
  aoEnviar: (texto: string) => Promise<boolean>;
}) {
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const campo = useRef<HTMLTextAreaElement>(null);

  // Cresce com o texto até ~6 linhas; daí para frente rola.
  useEffect(() => {
    const el = campo.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [texto]);

  if (!janelaAteEm) {
    return (
      <div className="border-t border-borda bg-superficie-2/70 p-3 text-sm leading-relaxed text-tinta-suave">
        <p>
          <strong className="text-tinta">A janela de 24 horas está fechada.</strong> Ela abre quando a pessoa manda
          mensagem — até lá, a Meta só aceita modelo aprovado.
        </p>
        <Link href="/campanhas" className="mt-1 inline-block font-medium text-acento-forte underline underline-offset-4">
          Enviar um modelo pela tela de Campanhas
        </Link>
      </div>
    );
  }

  async function enviar() {
    const corpo = texto.trim();
    if (!corpo || enviando) return;
    setEnviando(true);
    try {
      if (await aoEnviar(corpo)) setTexto('');
    } finally {
      setEnviando(false);
      campo.current?.focus();
    }
  }

  return (
    <form
      className="border-t border-borda p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void enviar();
      }}
    >
      <div className="flex items-end gap-2">
        <label htmlFor="resposta" className="sr-only">
          Escreva uma mensagem
        </label>
        <AreaDeTexto
          id="resposta"
          ref={campo}
          rows={1}
          value={texto}
          maxLength={LIMITE}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void enviar();
            }
          }}
          placeholder="Escreva uma mensagem"
          className="min-h-10 flex-1"
        />
        <Button type="submit" carregando={enviando} disabled={!texto.trim()} aria-label="Enviar mensagem" className="h-10 shrink-0">
          <IconeSetaDireita className="h-4 w-4" />
        </Button>
      </div>
      <p className="mt-1.5 text-[11px] text-tinta-suave">
        Dá para responder com texto até <span className="numerico">{formatarDataHora(janelaAteEm)}</span>.
        {texto.length > LIMITE - 200 && (
          <span className="numerico"> · {texto.length}/{LIMITE}</span>
        )}
      </p>
    </form>
  );
}
