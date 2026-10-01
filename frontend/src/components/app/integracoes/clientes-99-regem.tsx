'use client';

import { useState } from 'react';

import { Alerta } from '@/components/ui/alerta';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatarData } from '@/lib/formato';
import type { SituacaoRegem } from '@/lib/tipos';

/**
 * Os clientes da 99Food — só com a autorização do dono, sob a responsabilidade
 * da empresa. A 99 entrega ao Regem o número real, mas quem comprou pela 99
 * não deu aceite de promoções à loja: por isso a decisão é dele, registrada
 * aqui com o texto que ele aceitou (o texto vem do servidor, que é quem grava).
 *
 * O Regem só entrega a 99 quando a equipe do Regemcast libera no token; até
 * lá, a autorização fica registrada e a tela diz que falta a liberação.
 */
export function ClientesDa99Regem({
  situacao: s,
  ehDono,
  ocupado,
  aoAutorizar,
}: {
  situacao: SituacaoRegem;
  ehDono: boolean;
  ocupado: boolean;
  /** Autorizar (true) ou desfazer (false). Devolve se deu certo. */
  aoAutorizar: (autorizar: boolean) => Promise<boolean>;
}) {
  const [declaracao, setDeclaracao] = useState(false);
  const [desfazendo, setDesfazendo] = useState(false);

  const selo = !s.incluir99
    ? { texto: 'Não autorizada', tom: 'neutro' as const }
    : s.escopo99
      ? { texto: 'Incluídos', tom: 'sucesso' as const }
      : { texto: 'Aguardando a liberação', tom: 'acento' as const };

  return (
    <section aria-labelledby="clientes-99-regem" className="space-y-3 rounded-card border border-borda p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="clientes-99-regem" className="text-sm font-semibold text-tinta">
          Clientes da 99Food <span className="font-normal text-tinta-suave">(opcional)</span>
        </h3>
        <Badge tom={selo.tom} ponto>
          {selo.texto}
        </Badge>
      </div>

      {!s.incluir99 ? (
        <>
          <p className="max-w-prose text-sm leading-relaxed text-tinta-suave">
            A 99 entrega ao Regem o número de verdade de quem compra por ela, mas esse cliente não aceitou receber
            promoções da sua loja. Só traga esses clientes se a sua empresa tiver a autorização deles — a responsabilidade
            é da empresa. Os outros marketplaces (iFood e demais) nunca entram.
          </p>
          {ehDono ? (
            <div className="space-y-3">
              <label className="flex items-start gap-3 rounded-lg bg-superficie-2 p-3 text-sm text-tinta">
                <input
                  type="checkbox"
                  checked={declaracao}
                  onChange={(e) => setDeclaracao(e.target.checked)}
                  className="mt-1 h-4 w-4 shrink-0"
                />
                <span>{s.textoAutorizacao99}</span>
              </label>
              <Button
                variante="secundario"
                onClick={() =>
                  void aoAutorizar(true).then((ok) => {
                    if (ok) setDeclaracao(false);
                  })
                }
                carregando={ocupado}
                disabled={!declaracao}
              >
                Autorizar a 99
              </Button>
            </div>
          ) : (
            <Alerta tom="informacao">Só o dono da conta pode autorizar os clientes da 99.</Alerta>
          )}
        </>
      ) : (
        <>
          {s.escopo99 ? (
            <p className="text-sm leading-relaxed text-tinta">
              Os clientes e as compras da 99 estão incluídos, com a autorização de {formatarData(s.autorizacao99Em)}.
            </p>
          ) : (
            <p className="text-sm leading-relaxed text-tinta">
              Autorização registrada em {formatarData(s.autorizacao99Em)}. Falta a liberação no Regem, que a nossa equipe
              faz — você não precisa fazer nada. Quando sair, os clientes e as vendas da 99 são lidos do começo.
            </p>
          )}
          {ehDono &&
            (desfazendo ? (
              <div className="space-y-3 rounded-lg bg-superficie-2 p-3">
                <p className="text-sm leading-relaxed text-tinta">
                  Desfazer tira da sua base, na hora, as compras da 99 e os clientes que vieram só por ela. Quem pediu para
                  sair continua bloqueado.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button variante="discreto" tamanho="sm" onClick={() => setDesfazendo(false)} disabled={ocupado}>
                    Cancelar
                  </Button>
                  <Button
                    variante="perigo"
                    tamanho="sm"
                    carregando={ocupado}
                    onClick={() =>
                      void aoAutorizar(false).then((ok) => {
                        if (ok) setDesfazendo(false);
                      })
                    }
                  >
                    Desfazer a autorização
                  </Button>
                </div>
              </div>
            ) : (
              <Button variante="discreto" tamanho="sm" onClick={() => setDesfazendo(true)}>
                Desfazer a autorização
              </Button>
            ))}
        </>
      )}
    </section>
  );
}
