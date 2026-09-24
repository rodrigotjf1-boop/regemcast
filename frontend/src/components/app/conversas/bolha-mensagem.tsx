'use client';

import { IconeCheck, IconeCheckDuplo, IconeRelogio } from '@/components/app/icones';
import { cn } from '@/lib/cn';
import { formatarHora } from '@/lib/formato';
import type { MensagemDaConversa } from '@/lib/tipos';

import { MidiaDaMensagem } from './midia-da-mensagem';

/** Como a mídia se chama quando não dá mais para abrir (histórico antigo). */
const ROTULO_DA_MIDIA: Record<string, string> = {
  image: '📷 Foto',
  video: '🎥 Vídeo',
  audio: '🎤 Áudio',
  document: '📄 Documento',
  sticker: 'Figurinha',
};

const TIPOS_DE_MIDIA = new Set(Object.keys(ROTULO_DA_MIDIA));

/**
 * Uma mensagem da conversa, como no WhatsApp: do cliente à esquerda, da
 * empresa à direita — em lima, a cor da marca, com o texto escuro por cima
 * (lima é fundo, nunca letra).
 *
 * Embaixo, a hora e, nas respostas, de onde saiu (celular ou quem respondeu
 * pelo painel) e o status de entrega. Falha aparece com o motivo real.
 */
export function BolhaMensagem({ conversaId, m }: { conversaId: string; m: MensagemDaConversa }) {
  const saida = m.direcao === 'saida';
  const ehMidia = TIPOS_DE_MIDIA.has(m.tipo);

  return (
    <div className={cn('flex', saida ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-sm sm:max-w-[70%]',
          saida ? 'rounded-br-md bg-acento text-acento-contraste' : 'rounded-bl-md border border-borda bg-superficie text-tinta',
        )}
      >
        {ehMidia ? (
          <div className="space-y-1.5">
            {m.temMidia ? (
              <MidiaDaMensagem conversaId={conversaId} m={m} />
            ) : (
              <p className="text-xs opacity-80">
                {ROTULO_DA_MIDIA[m.tipo]} <span className="italic">— só no celular</span>
              </p>
            )}
            {m.texto && <p className="whitespace-pre-wrap break-words">{m.texto}</p>}
          </div>
        ) : m.tipo === 'reaction' ? (
          <p className="italic">Reagiu com {m.texto ?? 'uma reação'}</p>
        ) : m.tipo === 'location' ? (
          <p className="whitespace-pre-wrap break-words">📍 {m.texto ?? 'Localização'}</p>
        ) : m.tipo === 'contacts' ? (
          <p className="whitespace-pre-wrap break-words">👤 {m.texto ?? 'Contato'}</p>
        ) : m.texto ? (
          <p className={cn('whitespace-pre-wrap break-words', m.tipo === 'system' && 'text-xs italic opacity-80')}>{m.texto}</p>
        ) : (
          <p className="text-xs italic opacity-80">Mensagem que só abre no celular.</p>
        )}

        <div className={cn('mt-1 flex items-center justify-end gap-1.5 text-[11px]', saida ? 'text-acento-contraste/75' : 'text-tinta-suave')}>
          {saida && m.origem === 'celular' && <span>pelo celular</span>}
          {saida && m.origem === 'painel' && m.enviadaPor && <span className="truncate">{m.enviadaPor}</span>}
          <time className="numerico" dateTime={m.criadaEm}>
            {formatarHora(m.criadaEm)}
          </time>
          {saida && <StatusDaMensagem status={m.status} />}
        </div>

        {m.status === 'falhou' && (
          <p className="mt-1 rounded-md bg-superficie/80 px-2 py-1 text-xs text-erro" role="status">
            Não entregue{m.erroTitulo ? ` — ${m.erroTitulo}` : ''}
            {m.erroCodigo ? <span className="numerico"> ({m.erroCodigo})</span> : null}
          </p>
        )}
      </div>
    </div>
  );
}

function StatusDaMensagem({ status }: { status: string | null }) {
  switch (status) {
    case 'enviando':
      return (
        <span title="Enviando" aria-label="Enviando">
          <IconeRelogio className="h-3.5 w-3.5" />
        </span>
      );
    case 'enviada':
      return (
        <span title="Enviada" aria-label="Enviada">
          <IconeCheck className="h-3.5 w-3.5" />
        </span>
      );
    case 'entregue':
      return (
        <span title="Entregue" aria-label="Entregue" className="opacity-70">
          <IconeCheckDuplo className="h-4 w-4" />
        </span>
      );
    case 'lida':
      return (
        <span title="Lida" aria-label="Lida" className="font-bold">
          <IconeCheckDuplo className="h-4 w-4 stroke-[2.4]" />
        </span>
      );
    default:
      return null;
  }
}
