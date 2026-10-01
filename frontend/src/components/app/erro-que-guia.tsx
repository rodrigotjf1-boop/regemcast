import Link from 'next/link';
import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { ErroQueGuia as Erro } from '@/lib/tipos';

/**
 * Um erro da Meta do jeito que guia: o que houve, o que fazer, quem resolve e
 * por onde.
 *
 * O texto vem pronto do servidor, que tem o catálogo dos códigos — a tela não
 * traduz nada. A frase da Meta, em inglês, nunca é a explicação: fica recolhida
 * em "O que a Meta respondeu", para quem quiser ler ou mandar ao suporte.
 */

const QUEM: Record<NonNullable<Erro['quem']>, { rotulo: string; tom: 'atencao' | 'acento' | 'neutro' }> = {
  voce: { rotulo: 'Depende de você', tom: 'atencao' },
  nos: { rotulo: 'É conosco', tom: 'acento' },
  ninguem: { rotulo: 'Sem ação sua', tom: 'neutro' },
};

/** A tela do Regemcast onde se resolve. */
const TELA: Record<NonNullable<Erro['tela']>, { rotulo: string; href: string }> = {
  whatsapp: { rotulo: 'Abrir WhatsApp', href: '/whatsapp' },
  modelos: { rotulo: 'Ver modelos', href: '/modelos' },
  contatos: { rotulo: 'Abrir contatos', href: '/contatos' },
  bloqueios: { rotulo: 'Ver bloqueios', href: '/contatos/bloqueios' },
};

export function ErroQueGuia({
  erro,
  compacto = false,
  acoes,
}: {
  erro: Erro;
  /**
   * Na linha de uma tabela: só o título e o que houve. O que fazer, os botões e
   * a frase da Meta ficam no bloco "Por que falhou", uma vez por motivo — e não
   * repetidos em quinhentas linhas.
   */
  compacto?: boolean;
  /** Botões da tela que usa o erro (retomar a campanha, por exemplo), ao lado dos do erro. */
  acoes?: ReactNode;
}) {
  if (compacto) {
    return (
      <div className="space-y-0.5 [overflow-wrap:anywhere]">
        <p className="font-medium text-erro">{erro.titulo}</p>
        <p>{erro.explicacao}</p>
      </div>
    );
  }

  const quem = erro.quem ? QUEM[erro.quem] : null;
  const tela = erro.tela ? TELA[erro.tela] : null;

  return (
    <div className="min-w-0 space-y-2 text-sm [overflow-wrap:anywhere]">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className="font-semibold text-tinta">{erro.titulo}</p>
        {quem ? <Badge tom={quem.tom}>{quem.rotulo}</Badge> : null}
      </div>
      <p className="leading-relaxed text-tinta-suave">{erro.explicacao}</p>
      {erro.acao ? (
        <p className="leading-relaxed text-tinta">
          <span className="font-semibold">O que fazer:</span> {erro.acao}
        </p>
      ) : null}

      {erro.link || tela || acoes ? (
        <div className="flex flex-wrap gap-2 pt-0.5">
          {erro.link ? (
            <a href={erro.link.url} target="_blank" rel="noopener noreferrer">
              <Button tamanho="sm" variante="secundario">
                {erro.link.rotulo} <span aria-hidden="true">↗</span>
                <span className="sr-only"> (abre em outra aba)</span>
              </Button>
            </a>
          ) : null}
          {tela ? (
            <Link href={tela.href}>
              <Button tamanho="sm" variante="secundario">
                {tela.rotulo}
              </Button>
            </Link>
          ) : null}
          {acoes}
        </div>
      ) : null}

      {erro.daMeta ? (
        <details className="text-xs text-tinta-suave">
          <summary className="cursor-pointer select-none underline-offset-4 hover:text-tinta hover:underline">
            O que a Meta respondeu
          </summary>
          <p className="mt-1 leading-relaxed">
            {erro.codigo !== null ? <span className="numerico">Código {erro.codigo}. </span> : null}
            {erro.daMeta}
          </p>
        </details>
      ) : null}
    </div>
  );
}
