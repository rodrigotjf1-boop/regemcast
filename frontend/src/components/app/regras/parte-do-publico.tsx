'use client';

import { Input } from '@/components/ui/input';
import { formatarNumero } from '@/lib/formato';
import { tamanhoDaParte, type ParteDoPublico as Parte } from '@/lib/regras-do-publico';

/**
 * "Mandar só para uma parte deste público": do contato X ao Y, na ordem em
 * que entraram na base — ordem fixa, então o "do 1 ao 500" não muda entre a
 * prévia e a montagem. O servidor numera sobre quem pode receber.
 */
export function ParteDoPublico({
  prefixo,
  ligada,
  habilitada,
  deTexto,
  ateTexto,
  parte,
  total,
  aoLigar,
  aoMudarDe,
  aoMudarAte,
  aoTerminarDeDigitar,
}: {
  prefixo: string;
  ligada: boolean;
  /** Só com as regras completas dá para escolher uma parte. */
  habilitada: boolean;
  deTexto: string;
  ateTexto: string;
  /** A parte já ajustada ao tamanho do público (é a que vai para o servidor). */
  parte: Parte | null;
  /** Quantos o público inteiro tem; nulo enquanto conta. */
  total: number | null;
  aoLigar: (ligada: boolean) => void;
  aoMudarDe: (texto: string) => void;
  aoMudarAte: (texto: string) => void;
  /** Ao sair do campo, o texto vira o número ajustado. */
  aoTerminarDeDigitar: () => void;
}) {
  const base = total !== null && total > 0 ? total : null;
  const inicio = parte && base ? ((parte.de - 1) / base) * 100 : 0;
  const largura = parte && base ? Math.min(100 - inicio, (tamanhoDaParte(parte) / base) * 100) : 0;

  return (
    <div className="space-y-3 rounded-2xl border border-borda p-3 sm:p-4">
      <label htmlFor={`${prefixo}-parte`} className="flex cursor-pointer items-start gap-3 text-sm font-medium text-tinta">
        <input
          id={`${prefixo}-parte`}
          type="checkbox"
          checked={ligada}
          disabled={!habilitada}
          onChange={(e) => aoLigar(e.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0 accent-acento disabled:cursor-not-allowed"
        />
        <span>Mandar só para uma parte deste público</span>
      </label>

      {ligada && (
        <div className="space-y-3">
          <div className="grid max-w-sm grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor={`${prefixo}-parte-de`} className="text-xs font-medium text-tinta">
                Do contato
              </label>
              <Input
                id={`${prefixo}-parte-de`}
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                value={deTexto}
                onChange={(e) => aoMudarDe(e.target.value)}
                onBlur={aoTerminarDeDigitar}
                className="numerico"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor={`${prefixo}-parte-ate`} className="text-xs font-medium text-tinta">
                ao contato
              </label>
              <Input
                id={`${prefixo}-parte-ate`}
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                value={ateTexto}
                onChange={(e) => aoMudarAte(e.target.value)}
                onBlur={aoTerminarDeDigitar}
                className="numerico"
              />
            </div>
          </div>
          <div aria-hidden="true" className="relative h-2.5 overflow-hidden rounded-full bg-borda">
            <span
              className="absolute inset-y-0 rounded-full bg-acento"
              style={{ left: `${inicio}%`, width: `${largura}%` }}
            />
          </div>
          {parte && (
            <p className="text-xs leading-relaxed text-tinta">
              Vai para <strong className="numerico">{formatarNumero(tamanhoDaParte(parte))}</strong>
              {base !== null && (
                <>
                  {' '}
                  de <span className="numerico">{formatarNumero(base)}</span>
                </>
              )}{' '}
              contatos: do <span className="numerico">{formatarNumero(parte.de)}</span> ao{' '}
              <span className="numerico">{formatarNumero(parte.ate)}</span>, na ordem em que entraram na base. Para
              mandar o resto em outros dias, use os blocos em Contatos.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
