'use client';

import { Spinner } from '@/components/ui/spinner';
import { formatarNumero } from '@/lib/formato';

export type SituacaoDaContagem =
  | { tipo: 'sem-regra' }
  | { tipo: 'incompleta' }
  | { tipo: 'contando' }
  | { tipo: 'erro'; mensagem: string }
  | { tipo: 'pronta'; total: number; soComCashback: boolean };

/**
 * O número grande: quantos contatos combinam com as regras. É a prévia da
 * campanha (`POST /campanhas/previa`), a mesma conta da montagem — o número
 * da tela é o que a campanha envia.
 */
export function ContagemDasRegras({ situacao }: { situacao: SituacaoDaContagem }) {
  return (
    <div role="status" aria-live="polite" className="space-y-1 rounded-2xl bg-acento-suave px-4 py-3 text-tinta sm:px-5 sm:py-4">
      {situacao.tipo === 'sem-regra' && (
        <>
          <p className="text-sm font-semibold">Adicione uma regra</p>
          <p className="text-xs text-tinta-suave">para saber quantos contatos combinam.</p>
        </>
      )}
      {situacao.tipo === 'incompleta' && (
        <>
          <p className="text-sm font-semibold">Preencha o valor de cada regra</p>
          <p className="text-xs text-tinta-suave">para saber quantos contatos combinam.</p>
        </>
      )}
      {situacao.tipo === 'contando' && (
        <p className="flex items-center gap-2 text-sm text-tinta-suave">
          <Spinner rotulo={null} className="h-4 w-4" /> Contando quem combina com as regras…
        </p>
      )}
      {situacao.tipo === 'erro' && (
        <p className="text-sm text-erro" role="alert">
          {situacao.mensagem}
        </p>
      )}
      {situacao.tipo === 'pronta' && (
        <>
          <p className="text-sm">
            <strong className="numerico mr-1 text-2xl font-bold tracking-tight sm:text-3xl">
              {formatarNumero(situacao.total)}
            </strong>
            {situacao.total === 1 ? 'contato combina com as regras e pode receber' : 'contatos combinam com as regras e podem receber'}
          </p>
          <p className="text-xs text-tinta-suave">
            Já sem quem pediu para sair e sem número sem WhatsApp.
            {situacao.soComCashback ? ' A mensagem usa cashback: recebe só quem tem saldo válido (o total abaixo).' : ''}
          </p>
        </>
      )}
    </div>
  );
}
