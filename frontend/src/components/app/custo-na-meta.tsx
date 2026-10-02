import { Card } from '@/components/ui/card';
import type { CustoNaMeta } from '@/lib/tipos';

/**
 * Quanto a campanha custa na Meta: a estimativa antes de disparar, o gasto e o
 * que ainda pode sair depois.
 *
 * As frases e os valores vêm prontos do servidor (`orcamento/custo.regras.ts`):
 * a tela não faz conta de dinheiro nem decide o que dizer quando falta a
 * tarifa ou a moeda. Sem linha e sem aviso, não há o que mostrar.
 */

function temOQueMostrar(custo: CustoNaMeta | null | undefined): custo is CustoNaMeta {
  return Boolean(custo && (custo.linhas.length > 0 || custo.avisos.length > 0));
}

/** O cartão do detalhe da campanha. */
export function CartaoDoCusto({ custo }: { custo: CustoNaMeta | null | undefined }) {
  if (!temOQueMostrar(custo)) return null;

  return (
    <Card className="anima-entrada">
      <div className="space-y-3">
        <h2 className="text-base font-semibold text-tinta">Custo na Meta</h2>
        {custo.linhas.length > 0 && (
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {custo.linhas.map((l) => (
              <div key={l.rotulo} className="min-w-0">
                <dt className="text-xs text-tinta-suave">{l.rotulo}</dt>
                <dd className="numerico text-2xl font-semibold text-tinta">{l.valor}</dd>
                {l.detalhe && <dd className="text-xs text-tinta-suave">{l.detalhe}</dd>}
              </div>
            ))}
          </dl>
        )}
        {custo.avisos.map((a) => (
          <p key={a} className="rounded-lg border border-atencao/30 bg-atencao/10 px-3 py-2 text-xs leading-relaxed text-tinta">
            {a}
          </p>
        ))}
        {custo.nota && <p className="text-xs leading-relaxed text-tinta-suave">{custo.nota}</p>}
      </div>
    </Card>
  );
}

/** A estimativa na montagem da campanha, ao lado de "quantas pessoas vão receber". */
export function CustoDaPrevia({ custo }: { custo: CustoNaMeta | null | undefined }) {
  if (!temOQueMostrar(custo)) return null;

  return (
    <div className="space-y-1 rounded-lg border border-borda bg-superficie-2 p-3 text-xs leading-relaxed text-tinta">
      {custo.linhas.map((l) => (
        <p key={l.rotulo}>
          {l.rotulo}: <strong className="numerico">{l.valor}</strong>
          {l.detalhe ? <span className="text-tinta-suave"> ({l.detalhe})</span> : null}
        </p>
      ))}
      {custo.avisos.map((a) => (
        <p key={a}>{a}</p>
      ))}
      {custo.nota && <p className="text-tinta-suave">{custo.nota}</p>}
    </div>
  );
}
