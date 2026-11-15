'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { IconeIntegracao } from '@/components/app/icones';
import { Alerta } from '@/components/ui/alerta';
import { Button } from '@/components/ui/button';
import { CabecalhoPagina } from '@/components/ui/cabecalho-pagina';
import { Card, CardCabecalho, CardCorpo } from '@/components/ui/card';
import { mensagemDoErro } from '@/lib/api';
import { regem } from '@/lib/servicos';

type Estado =
  | { fase: 'concluindo' }
  | { fase: 'conectado'; empresa: string | null; importando: boolean }
  | { fase: 'recusado' }
  | { fase: 'erro'; mensagem: string };

/**
 * A volta do "Conectar pelo Regem" (o endereço cadastrado na ficha do Regemcast no Regem). O Regem manda
 * o navegador para cá com o código, o `state` e o `iss`; a página repassa ao servidor tal como veio (é
 * ele que confere tudo e troca o código pela ligação) e tira o código da barra de endereço. Dentro do
 * grupo `(app)`: sem sessão, a pessoa entra e volta para cá.
 */
export default function VoltaDoRegemPage() {
  const [estado, setEstado] = useState<Estado>({ fase: 'concluindo' });
  const feito = useRef(false);

  useEffect(() => {
    // Uma vez só: o código vale uma vez (o modo estrito do React roda o efeito duas vezes em desenvolvimento).
    if (feito.current) return;
    feito.current = true;
    // Lido do `window` de propósito: `useSearchParams` pediria um limite de Suspense só para ler quatro parâmetros.
    const q = new URLSearchParams(window.location.search);
    const campo = (nome: string) => q.get(nome) ?? undefined;
    const volta = { code: campo('code'), state: campo('state'), iss: campo('iss'), error: campo('error') };
    window.history.replaceState(null, '', window.location.pathname);
    regem.concluir(volta).then(
      (r) =>
        setEstado(
          r.situacao === 'conectado'
            ? { fase: 'conectado', empresa: r.regem.empresaNome, importando: r.regem.clientes.status === 'carga' }
            : { fase: 'recusado' },
        ),
      (e) => setEstado({ fase: 'erro', mensagem: mensagemDoErro(e) }),
    );
  }, []);

  return (
    <div className="space-y-6 lg:space-y-8">
      <CabecalhoPagina icone={<IconeIntegracao />} sobretitulo="Integrações" titulo="Conectar pelo Regem" />
      <Card>
        <CardCabecalho
          titulo={
            estado.fase === 'concluindo'
              ? 'Concluindo a conexão…'
              : estado.fase === 'conectado'
                ? 'Pronto: ligada pelo Regem'
                : estado.fase === 'recusado'
                  ? 'Nada foi ligado'
                  : 'Não deu para concluir'
          }
        />
        <CardCorpo className="space-y-4">
          {estado.fase === 'concluindo' && (
            <p className="text-sm text-tinta" role="status">
              Conferindo a autorização com o Regem…
            </p>
          )}
          {estado.fase === 'conectado' && (
            <p className="max-w-prose text-sm leading-relaxed text-tinta">
              <strong>{estado.empresa ?? 'A empresa'}</strong>, a empresa inteira, está ligada ao Regemcast.{' '}
              {estado.importando
                ? 'A primeira importação começou e segue sozinha: pode fechar esta tela.'
                : 'A importação continua de onde parou; o andamento aparece em Integrações.'}
            </p>
          )}
          {estado.fase === 'recusado' && (
            <p className="max-w-prose text-sm leading-relaxed text-tinta">
              O presidente da empresa não autorizou no Regem. Nada mudou aqui; quando quiser, comece de novo pelo botão
              “Conectar pelo Regem”.
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
