'use client';

import { useMemo, useState } from 'react';

import type { DadosModelo } from '@/lib/tipos';

/**
 * A prévia: um celular recebendo a mensagem no WhatsApp.
 *
 * Não é enfeite. Quem escreve um modelo precisa julgar três coisas que só
 * aparecem em escala real:
 *
 * - se a frase fecha depois de a variável entrar;
 * - se o texto do cartão cabe antes de ser cortado;
 * - se o botão faz sentido do lado de quem recebe, e não do lado de quem
 *   escreveu o formulário.
 *
 * Por isso o texto usa os TAMANHOS do WhatsApp, o balão tem a hora no canto, e
 * os botões ficam presos embaixo com a divisória — é assim que chega.
 *
 * O seletor claro/escuro existe porque metade das pessoas usa o WhatsApp no
 * escuro, e o contraste da mensagem muda. É informação, não preferência de
 * quem está desenhando.
 */

/** O papel de parede do WhatsApp, aproximado: rabiscos bem fracos sobre bege. */
const PAPEL_CLARO =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='56' height='56' viewBox='0 0 56 56'%3E%3Cg fill='none' stroke='%23000' stroke-opacity='0.035' stroke-width='1.2'%3E%3Ccircle cx='10' cy='12' r='4'/%3E%3Cpath d='M30 8h10v8H30z'/%3E%3Cpath d='M6 34c4-5 9-5 13 0'/%3E%3Ccircle cx='42' cy='40' r='5'/%3E%3Cpath d='M22 44h8M26 40v8'/%3E%3C/g%3E%3C/svg%3E\")";

const PAPEL_ESCURO =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='56' height='56' viewBox='0 0 56 56'%3E%3Cg fill='none' stroke='%23fff' stroke-opacity='0.04' stroke-width='1.2'%3E%3Ccircle cx='10' cy='12' r='4'/%3E%3Cpath d='M30 8h10v8H30z'/%3E%3Cpath d='M6 34c4-5 9-5 13 0'/%3E%3Ccircle cx='42' cy='40' r='5'/%3E%3Cpath d='M22 44h8M26 40v8'/%3E%3C/g%3E%3C/svg%3E\")";

/**
 * As cores do WhatsApp, nos dois temas.
 *
 * Cruas de propósito, e não tokens da nossa marca: esta é a tela DELE. Pintar a
 * prévia com a nossa paleta mostraria uma mensagem que ninguém vai receber.
 */
interface Cor {
  papel: string;
  fundo: string;
  barra: string;
  barraTexto: string;
  balao: string;
  texto: string;
  secundario: string;
  divisoria: string;
  botao: string;
  entrada: string;
  cartao: string;
  placeholder: string;
  statusTexto: string;
  statusFundo: string;
}

const TEMA: Record<'claro' | 'escuro', Cor> = {
  claro: {
    papel: PAPEL_CLARO,
    fundo: '#e5ddd5',
    barra: '#008069',
    barraTexto: '#ffffff',
    balao: '#ffffff',
    texto: '#111b21',
    secundario: '#667781',
    divisoria: '#e9edef',
    botao: '#027eb5',
    entrada: '#f0f2f5',
    cartao: '#ffffff',
    placeholder: '#d7d0c6',
    statusTexto: '#111b21',
    statusFundo: '#dcd6cd',
  },
  escuro: {
    papel: PAPEL_ESCURO,
    fundo: '#0b141a',
    barra: '#1f2c34',
    barraTexto: '#e9edef',
    balao: '#1f2c34',
    texto: '#e9edef',
    secundario: '#8696a0',
    divisoria: '#2a3942',
    botao: '#53bdeb',
    entrada: '#1f2c34',
    cartao: '#1f2c34',
    placeholder: '#2a3942',
    statusTexto: '#e9edef',
    statusFundo: '#0b141a',
  },
};

/** Glifo do botão, como o WhatsApp mostra ao lado do texto. */
const GLIFO: Record<string, string> = {
  URL: '↗',
  PHONE_NUMBER: '✆',
  COPY_CODE: '⧉',
  QUICK_REPLY: '↩',
};

export function PreviaWhatsapp({
  dados,
  variaveis,
}: {
  dados: DadosModelo;
  variaveis: number[];
}) {
  const [tema, setTema] = useState<'claro' | 'escuro'>('claro');
  const c = TEMA[tema];

  const corpo = useMemo(() => {
    let texto = dados.corpo || 'Sua mensagem aparece aqui.';
    variaveis.forEach((n, i) => {
      const exemplo = dados.corpoExemplos?.[i]?.trim() || `exemplo ${n}`;
      texto = texto.replace(new RegExp(`\\{\\{\\s*${n}\\s*\\}\\}`, 'g'), exemplo);
    });
    return texto;
  }, [dados.corpo, dados.corpoExemplos, variaveis]);

  const cabecalho = (dados.cabecalhoTexto ?? '').replace(
    /\{\{\s*1\s*\}\}/g,
    dados.cabecalhoExemplo?.trim() || 'exemplo',
  );

  const ehCarrossel = dados.tipo === 'carrossel';
  const botoes = ehCarrossel ? [] : (dados.botoes ?? []);

  return (
    <div className="space-y-3 p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-tinta-suave">
          Como vai chegar
        </p>

        {/* Metade das pessoas usa o WhatsApp no escuro, e o contraste muda. */}
        <div className="flex rounded-full border border-borda p-0.5" role="group" aria-label="Tema do WhatsApp">
          {(['claro', 'escuro'] as const).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={tema === t}
              onClick={() => setTema(t)}
              className={[
                'rounded-full px-2 py-0.5 text-[0.65rem] font-medium capitalize transition-colors',
                tema === t ? 'bg-acento text-acento-contraste' : 'text-tinta-suave hover:text-tinta',
              ].join(' ')}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Moldura do aparelho */}
      <div className="mx-auto w-full max-w-[17.5rem] rounded-[2rem] bg-tinta p-[3px] shadow-card ring-1 ring-black/10">
        <div className="overflow-hidden rounded-[1.85rem]" style={{ backgroundColor: c.fundo }}>
          <BarraDeStatus cor={c} />
          <BarraDoTopo cor={c} />

          <div
            className="max-h-[24rem] space-y-1.5 overflow-y-auto px-2.5 py-3"
            style={{ backgroundColor: c.fundo, backgroundImage: c.papel }}
          >
            <Balao cor={c} temBotoes={botoes.length > 0}>
              {dados.ltoAtivo && !ehCarrossel && (
                <p className="text-[0.72rem] font-semibold" style={{ color: c.botao }}>
                  ⏳ {dados.ltoTexto?.trim() || 'Oferta!'} · termina em 23:59
                </p>
              )}

              {cabecalho && !ehCarrossel && (
                <p className="text-[0.82rem] font-semibold leading-snug" style={{ color: c.texto }}>
                  {cabecalho}
                </p>
              )}

              <p
                className="whitespace-pre-wrap text-[0.82rem] leading-[1.35]"
                style={{ color: c.texto }}
              >
                {corpo}
              </p>

              {dados.rodape && !dados.ltoAtivo && !ehCarrossel && (
                <p className="text-[0.68rem]" style={{ color: c.secundario }}>
                  {dados.rodape}
                </p>
              )}

              {/* A hora dentro do balão, alinhada à direita — como o WhatsApp faz.
                  Mensagem recebida não tem os tiques de entrega. */}
              <p className="pt-0.5 text-right text-[0.6rem]" style={{ color: c.secundario }}>
                9:41
              </p>
            </Balao>

            {botoes.length > 0 && (
              <div
                className="overflow-hidden rounded-b-[0.45rem]"
                style={{ backgroundColor: c.balao }}
              >
                {botoes.map((b, i) => (
                  <div
                    key={i}
                    className="border-t py-2 text-center text-[0.78rem] font-medium"
                    style={{ borderColor: c.divisoria, color: c.botao }}
                  >
                    <span className="mr-1 opacity-70">{GLIFO[b.tipo] ?? '↩'}</span>
                    {b.texto || 'Botão'}
                  </div>
                ))}
              </div>
            )}

            {ehCarrossel && <Carrossel cartoes={dados.cartoes ?? []} cor={c} />}
          </div>

          <BarraDeEntrada cor={c} />
        </div>
      </div>

      <p className="text-xs leading-relaxed text-tinta-suave">
        As variáveis aparecem com os exemplos preenchidos, que é como a mensagem chega de verdade.
      </p>
    </div>
  );
}

/** Barra de status do sistema. Hora fixa: é maquete, não relógio. */
function BarraDeStatus({ cor }: { cor: Cor }) {
  return (
    <div
      className="flex items-center justify-between px-4 pb-1 pt-2 text-[0.6rem] font-semibold"
      style={{ backgroundColor: cor.statusFundo, color: cor.statusTexto }}
    >
      <span className="font-mono">9:41</span>
      <span className="flex items-center gap-1" aria-hidden>
        <span className="inline-flex items-end gap-[1px]">
          {[3, 5, 7, 9].map((h) => (
            <span key={h} style={{ width: 2, height: h, backgroundColor: 'currentColor' }} />
          ))}
        </span>
        <span
          className="inline-block rounded-[2px] border"
          style={{ width: 14, height: 7, borderColor: 'currentColor' }}
        >
          <span
            className="block h-full"
            style={{ width: '70%', backgroundColor: 'currentColor' }}
          />
        </span>
      </span>
    </div>
  );
}

/** Cabeçalho da conversa: voltar, foto, nome, estado. */
function BarraDoTopo({ cor }: { cor: Cor }) {
  return (
    <div
      className="flex items-center gap-2 px-2.5 py-2"
      style={{ backgroundColor: cor.barra, color: cor.barraTexto }}
    >
      <span className="text-[0.85rem] leading-none opacity-90" aria-hidden>
        ‹
      </span>
      <span className="h-7 w-7 shrink-0 rounded-full bg-white/25" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[0.75rem] font-semibold">Sua empresa</span>
        <span className="block text-[0.6rem] opacity-70">online</span>
      </span>
      <span className="text-[0.75rem] opacity-80" aria-hidden>
        ⋮
      </span>
    </div>
  );
}

/** O balão da mensagem recebida, com a ponta à esquerda. */
function Balao({
  cor,
  temBotoes,
  children,
}: {
  cor: Cor;
  temBotoes: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="relative max-w-[93%]">
      {/* A pontinha do balão. É o detalhe que faz a maquete parar de parecer
          um retângulo com texto dentro. */}
      <span
        aria-hidden
        className="absolute -left-1 top-0 h-3 w-2"
        style={{
          backgroundColor: cor.balao,
          clipPath: 'polygon(100% 0, 100% 100%, 0 0)',
        }}
      />
      <div
        className={`space-y-1 px-2.5 py-2 ${temBotoes ? 'rounded-t-[0.45rem]' : 'rounded-[0.45rem]'} rounded-tl-none`}
        style={{ backgroundColor: cor.balao }}
      >
        {children}
      </div>
    </div>
  );
}

/** Os cartões do carrossel, rolando na horizontal como no aparelho. */
function Carrossel({
  cartoes,
  cor,
}: {
  cartoes: NonNullable<DadosModelo['cartoes']>;
  cor: Cor;
}) {
  if (!cartoes.length) return null;

  return (
    <div className="-mx-0.5 flex snap-x gap-2 overflow-x-auto px-0.5 pb-1">
      {cartoes.map((c, i) => (
        <div
          key={i}
          className="w-[9.5rem] shrink-0 snap-start overflow-hidden rounded-[0.45rem]"
          style={{ backgroundColor: cor.cartao }}
        >
          <div
            className="flex h-[5.5rem] items-center justify-center text-[0.6rem]"
            style={{ backgroundColor: cor.placeholder, color: cor.secundario }}
          >
            {c.imagem ? '🖼 imagem' : 'sem imagem'}
          </div>
          <p
            className="line-clamp-3 px-2 py-1.5 text-[0.72rem] leading-snug"
            style={{ color: cor.texto }}
          >
            {c.corpo || 'Texto do cartão'}
          </p>
          {(c.botoes ?? []).map((b, j) => (
            <div
              key={j}
              className="border-t py-1.5 text-center text-[0.72rem] font-medium"
              style={{ borderColor: cor.divisoria, color: cor.botao }}
            >
              <span className="mr-1 opacity-70">{GLIFO[b.tipo] ?? '↩'}</span>
              {b.texto || 'Botão'}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** A barra de digitação. Fecha a ilusão de tela inteira. */
function BarraDeEntrada({ cor }: { cor: Cor }) {
  return (
    <div className="flex items-center gap-1.5 px-2 py-2" style={{ backgroundColor: cor.fundo }}>
      <div
        className="flex flex-1 items-center gap-1.5 rounded-full px-2.5 py-1.5"
        style={{ backgroundColor: cor.entrada }}
      >
        <span className="text-[0.7rem]" style={{ color: cor.secundario }} aria-hidden>
          ☺
        </span>
        <span className="text-[0.68rem]" style={{ color: cor.secundario }}>
          Mensagem
        </span>
      </div>
      <span
        className="flex h-7 w-7 items-center justify-center rounded-full text-[0.7rem]"
        style={{ backgroundColor: cor.barra, color: cor.barraTexto }}
        aria-hidden
      >
        ⏺
      </span>
    </div>
  );
}
