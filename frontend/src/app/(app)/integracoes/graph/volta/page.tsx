'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { IconeIntegracao } from '@/components/app/icones';
import { Alerta } from '@/components/ui/alerta';
import { Button } from '@/components/ui/button';
import { CabecalhoPagina } from '@/components/ui/cabecalho-pagina';
import { Card, CardCabecalho, CardCorpo } from '@/components/ui/card';
import { mensagemDoErro } from '@/lib/api';
import { dmsGraph } from '@/lib/servicos';

type Estado = { fase: 'concluindo' } | { fase: 'conectado'; conta: string | null } | { fase: 'recusado' } | { fase: 'erro'; mensagem: string };

/**
 * A volta do "Conectar ao DMS Graph". A página repassa ao servidor o que veio (é ele que confere tudo e troca o código pela
 * ligação) e tira o código da barra de endereço. Dentro do grupo `(app)`: sem sessão, a pessoa entra e volta para cá.
 */
export default function VoltaDoGraphPage() {
  const [estado, setEstado] = useState<Estado>({ fase: 'concluindo' });
  const feito = useRef(false);

  useEffect(() => {
    // Uma vez só: o código vale uma vez (o modo estrito do React roda o efeito duas vezes em desenvolvimento).
    if (feito.current) return;
    feito.current = true;
    const q = new URLSearchParams(window.location.search);
    const campo = (nome: string) => q.get(nome) ?? undefined;
    const volta = { code: campo('code'), state: campo('state'), iss: campo('iss'), error: campo('error') };
    window.history.replaceState(null, '', window.location.pathname);
    dmsGraph.concluir(volta).then(
      (r) => setEstado(r.situacao === 'conectado' ? { fase: 'conectado', conta: r.contaNome } : { fase: 'recusado' }),
      (e) => setEstado({ fase: 'erro', mensagem: mensagemDoErro(e) }),
    );
  }, []);

  const titulo =
    estado.fase === 'concluindo'
      ? 'Concluindo a conexão…'
      : estado.fase === 'conectado'
        ? 'Pronto: DMS Graph conectado'
        : estado.fase === 'recusado'
          ? 'Nada foi ligado'
          : 'Não deu para concluir';

  return (
    <div className="space-y-6 lg:space-y-8">
      <CabecalhoPagina icone={<IconeIntegracao />} sobretitulo="Integrações" titulo="Conectar ao DMS Graph" />
      <Card>
        <CardCabecalho titulo={titulo} />
        <CardCorpo className="space-y-4">
          {estado.fase === 'concluindo' && (
            <p className="text-sm text-tinta" role="status">
              Conferindo a autorização com o DMS Graph…
            </p>
          )}
          {estado.fase === 'conectado' && (
            <p className="max-w-prose text-sm leading-relaxed text-tinta">
              {estado.conta ? (
                <>
                  A conta <strong>{estado.conta}</strong> do DMS Graph está ligada ao Regemcast.
                </>
              ) : (
                'O DMS Graph está ligado ao Regemcast.'
              )}{' '}
              Para usar, abra um modelo com vídeo no cabeçalho.
            </p>
          )}
          {estado.fase === 'recusado' && (
            <p className="max-w-prose text-sm leading-relaxed text-tinta">
              Você não autorizou no DMS Graph. Nada mudou aqui; quando quiser, comece de novo pelo botão “Conectar ao DMS Graph”.
            </p>
          )}
          {estado.fase === 'erro' && <Alerta tom="erro">{estado.mensagem}</Alerta>}
          {estado.fase !== 'concluindo' && (
            <Link href="/integracoes">
              <Button variante={estado.fase === 'conectado' ? 'primario' : 'secundario'}>Ver a integração</Button>
            </Link>
          )}
        </CardCorpo>
      </Card>
    </div>
  );
}
