'use client';

import Link from 'next/link';

import { IconeImportar, IconeIntegracao } from '@/components/app/icones';
import { IntegracaoCardapioWeb } from '@/components/app/integracoes/cardapio-web';
import { IntegracaoRegem } from '@/components/app/integracoes/regem';
import { Button } from '@/components/ui/button';
import { CabecalhoPagina } from '@/components/ui/cabecalho-pagina';
import { Card, CardCabecalho, CardCorpo } from '@/components/ui/card';

/**
 * Integrações: o Regemcast ligado ao cardápio digital da loja e ao Regem.
 *
 * Diferente de importar um arquivo, a integração traz o HISTÓRICO de compras
 * de cada cliente e continua trazendo — é o que permite separar a base por
 * quem compra mais, quem sumiu, quem pede entrega. Quem só tem nome e número
 * (a lista exportada do celular) importa em Contatos e organiza em blocos.
 */
export default function IntegracoesPage() {
  return (
    <div className="space-y-6 lg:space-y-8">
      <CabecalhoPagina
        icone={<IconeIntegracao />}
        sobretitulo="Configuração"
        titulo="Integrações"
        descricao="Ligue o Regemcast ao cardápio digital e ao Regem da sua loja: os clientes e o histórico de compras de cada um chegam sozinhos, prontos para separar a base das campanhas."
      />

      <IntegracaoCardapioWeb />

      <IntegracaoRegem />

      <Card>
        <CardCabecalho
          titulo="Lista do celular ou planilha"
          descricao="Contatos só com nome e número, sem pedidos."
        />
        <CardCorpo className="space-y-4">
          <p className="max-w-prose text-sm leading-relaxed text-tinta-suave">
            Exportou os contatos do celular (.vcf) ou tem uma planilha só com nome e número? Importe em
            Contatos. Sem histórico de compras, organize a base de outro jeito: em blocos do tamanho do seu
            limite de envio e por região, pelo DDD.
          </p>
          <Link href="/contatos?importar=1">
            <Button variante="secundario">
              <IconeImportar />
              Importar contatos
            </Button>
          </Link>
        </CardCorpo>
      </Card>
    </div>
  );
}
