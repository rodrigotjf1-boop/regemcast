import { Badge } from '@/components/ui/badge';
import { Card, CardCabecalho, CardCorpo } from '@/components/ui/card';

/**
 * O cardápio digital do Regem — em preparação: a ponte precisa nascer do lado
 * do Regem primeiro. O cartão já aparece para quem usa o Regem saber que vem.
 */
export function IntegracaoCardapioRegem() {
  return (
    <Card>
      <CardCabecalho
        titulo="Cardápio digital do Regem"
        descricao="Para quem vende pelo cardápio digital e pelo PDV do Regem."
        acao={<Badge tom="acento">Em preparação</Badge>}
      />
      <CardCorpo>
        <p className="max-w-prose text-sm leading-relaxed text-tinta-suave">
          Os clientes e as compras vão chegar direto do Regem, sem planilha e sem token para copiar. Quando estiver
          liberado, a conexão aparece aqui.
        </p>
      </CardCorpo>
    </Card>
  );
}
