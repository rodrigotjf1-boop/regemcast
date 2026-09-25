'use client';

import { useState } from 'react';

import { Alerta } from '@/components/ui/alerta';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Conectar a loja com o token que o próprio Cardápio Web gera — ou trocar o
 * token de uma loja já conectada, sem perder o que já veio. Conferido na hora
 * com o Cardápio Web e guardado cifrado: ninguém vê de novo.
 */
export function ConectarCardapioWeb({
  ehDono,
  ocupado,
  erro,
  aoConectar,
  aoCancelar,
  lojaNome,
}: {
  ehDono: boolean;
  ocupado: boolean;
  erro: string;
  aoConectar: (chave: string) => void;
  /** Presente quando é troca de token de uma loja já conectada. */
  aoCancelar?: () => void;
  lojaNome?: string | null;
}) {
  const [chave, setChave] = useState('');
  const troca = Boolean(aoCancelar);

  return (
    <div className="space-y-4">
      {erro && <Alerta tom="erro">{erro}</Alerta>}
      {troca && (
        <p className="max-w-prose text-sm leading-relaxed text-tinta">
          Token novo da loja <strong>{lojaNome ?? 'conectada'}</strong>. O que já veio continua, e a busca retoma de
          onde parou. Token de outra loja recomeça a busca de pedidos.
        </p>
      )}
      {!troca && (
        <p className="max-w-prose text-sm leading-relaxed text-tinta-suave">
          Traga quem já comprou de você, com o histórico de pedidos de cada um: quanto gastou, quantas vezes
          comprou, a última compra, o bairro e o que pediu. É o que permite separar a base para as campanhas — e
          só entra quem está com o WhatsApp liberado na loja.
        </p>
      )}
      {!ehDono ? (
        <Alerta tom="informacao">Só o dono da conta pode conectar a loja do Cardápio Web.</Alerta>
      ) : (
        <>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-tinta">
            <li>
              No Portal do Cardápio Web, abra <strong>Configurações → Integrações → API</strong>.
            </li>
            <li>Copie o token da loja e cole abaixo.</li>
          </ol>
          <Alerta tom="atencao">
            Se já existe um token, copie o que está lá. <strong>Gerar um novo</strong> desliga os outros
            sistemas que usam o antigo, como um PDV ou outra integração.
          </Alerta>
          <div className="max-w-md space-y-1.5">
            <Label htmlFor="chave-cw">{troca ? 'Token novo da loja' : 'Token da loja'}</Label>
            <Input
              id="chave-cw"
              value={chave}
              onChange={(e) => setChave(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-xs text-tinta-suave">
              Conferimos na hora com o Cardápio Web e guardamos cifrado. Ninguém vê de novo, nem você.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => aoConectar(chave)} carregando={ocupado} disabled={chave.trim().length < 10}>
              {troca ? 'Salvar token novo' : 'Conectar loja'}
            </Button>
            {aoCancelar && (
              <Button variante="discreto" onClick={aoCancelar} disabled={ocupado}>
                Cancelar
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
