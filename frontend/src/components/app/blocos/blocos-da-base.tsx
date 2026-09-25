'use client';

import Link from 'next/link';
import { useState } from 'react';

import { IconeBlocos, IconeLixeira } from '@/components/app/icones';
import { Alerta } from '@/components/ui/alerta';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { mensagemDoErro } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatarData, formatarNumero } from '@/lib/formato';
import { contatos } from '@/lib/servicos';
import type { BlocoDaDivisao, DivisaoDeBlocos, OrdemDosBlocos, UsoDoBloco } from '@/lib/tipos';

const ORDEM: Record<OrdemDosBlocos, string> = {
  importacao: 'na ordem de importação',
  sorteio: 'por sorteio',
  recentes: 'mais recentes primeiro',
  regiao: 'por região',
  valor: 'melhores clientes primeiro',
};

function porcento(parte: number, todo: number): string {
  return todo > 0 ? `${Math.round((parte / todo) * 100)}%` : '—';
}

/**
 * As divisões em blocos, com o resultado de cada bloco já enviado.
 *
 * É o que deixa "aquecer" uma lista fria: o bloco 1 saiu, a tela mostra
 * quantos receberam, quantos leram e quantos pediram para sair — e só então o
 * dono decide mandar o próximo. O próximo bloco ainda não usado fica marcado.
 */
export function BlocosDaBase({
  divisoes,
  ehDono,
  aoMudar,
}: {
  divisoes: DivisaoDeBlocos[];
  ehDono: boolean;
  aoMudar: () => void;
}) {
  const [erro, setErro] = useState('');
  const [apagando, setApagando] = useState<string | null>(null);

  async function apagar(d: DivisaoDeBlocos) {
    if (!window.confirm(`Apagar "${d.nome}" e os ${d.totalBlocos} blocos dela? Os contatos continuam na base.`)) return;
    setErro('');
    setApagando(d.id);
    try {
      await contatos.apagarDivisao(d.id);
      aoMudar();
    } catch (e) {
      setErro(mensagemDoErro(e));
    } finally {
      setApagando(null);
    }
  }

  return (
    <section id="blocos" aria-label="Blocos" className="anima-entrada space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-tinta">Blocos</h2>
        <p className="text-xs text-tinta-suave">Cada bloco é uma lista: escolha o bloco ao montar a campanha.</p>
      </div>

      {erro && <Alerta tom="erro">{erro}</Alerta>}

      <ul className="space-y-3">
        {divisoes.map((d) => {
          const usada = d.blocos.some((b) => b.usos.length > 0);
          const proximo = d.blocos.find((b) => b.usos.length === 0 && b.total > 0)?.id ?? null;
          return (
            <li key={d.id} className="rounded-card border border-borda bg-superficie p-4 shadow-card">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-realce text-tinta">
                    <IconeBlocos className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-tinta">{d.nome}</p>
                    <p className="text-xs text-tinta-suave">
                      <span className="numerico text-tinta">{formatarNumero(d.totalContatos)}</span> pessoas em{' '}
                      <span className="numerico text-tinta">{formatarNumero(d.totalBlocos)}</span>{' '}
                      {d.totalBlocos === 1 ? 'bloco' : 'blocos'} de{' '}
                      <span className="numerico text-tinta">{formatarNumero(d.tamanho)}</span> · {ORDEM[d.ordem]}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {d.soNuncaReceberam && <Badge tom="neutro">Só quem nunca recebeu</Badge>}
                  {ehDono && !usada && (
                    <Button
                      variante="secundario"
                      tamanho="sm"
                      onClick={() => void apagar(d)}
                      carregando={apagando === d.id}
                      aria-label={`Apagar ${d.nome}`}
                    >
                      <IconeLixeira />
                      Apagar
                    </Button>
                  )}
                </div>
              </div>

              <ul className="mt-3 divide-y divide-borda rounded-card border border-borda">
                {d.blocos.map((b) => (
                  <LinhaDoBloco key={b.id} b={b} total={d.totalBlocos} proximo={b.id === proximo} />
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function LinhaDoBloco({ b, total, proximo }: { b: BlocoDaDivisao; total: number; proximo: boolean }) {
  const casas = Math.max(2, String(total).length);
  const ultimo: UsoDoBloco | undefined = b.usos[b.usos.length - 1];
  return (
    <li className={cn('flex flex-wrap items-center justify-between gap-2 px-3 py-2.5', proximo && 'bg-acento/5')}>
      <div className="min-w-0">
        <p className="text-sm text-tinta">
          <span className="numerico font-semibold">Bloco {String(b.bloco).padStart(casas, '0')}</span>
          <span className="text-tinta-suave">
            {' '}· <span className="numerico">{formatarNumero(b.total)}</span> {b.total === 1 ? 'pessoa' : 'pessoas'}
          </span>
        </p>
        {ultimo ? (
          <p className="text-xs text-tinta-suave">
            Enviado em {formatarData(ultimo.em)} em{' '}
            <Link href={`/campanhas/${ultimo.campanhaId}`} className="text-acento-forte underline underline-offset-4">
              {ultimo.campanhaNome}
            </Link>
            :{' '}
            <span className="numerico text-tinta">{porcento(ultimo.entregues, ultimo.total)}</span> entregues ·{' '}
            <span className="numerico text-tinta">{porcento(ultimo.lidas, ultimo.total)}</span> lidas
            {ultimo.falhas > 0 && (
              <>
                {' '}· <span className="numerico text-tinta">{formatarNumero(ultimo.falhas)}</span> não chegaram
              </>
            )}
            {ultimo.sairam > 0 && (
              <>
                {' '}·{' '}
                <span className={cn('numerico', ultimo.sairam / Math.max(1, ultimo.total) >= 0.02 ? 'text-erro' : 'text-tinta')}>
                  {formatarNumero(ultimo.sairam)}
                </span>{' '}
                {ultimo.sairam === 1 ? 'pediu' : 'pediram'} para sair
              </>
            )}
          </p>
        ) : (
          <p className="text-xs text-tinta-suave">Ainda não usado.</p>
        )}
      </div>
      <div className="flex items-center gap-2">
        {proximo && <Badge tom="acento">Próximo</Badge>}
        {!ultimo && b.total > 0 && (
          <Link href={`/campanhas?nova=1&lista=${b.id}`}>
            <Button tamanho="sm" variante={proximo ? 'primario' : 'secundario'}>
              Usar em campanha
            </Button>
          </Link>
        )}
      </div>
    </li>
  );
}
