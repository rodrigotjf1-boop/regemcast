'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { mensagemDoErro } from '@/lib/api';
import { contatos } from '@/lib/servicos';
import type { ListaDeContatos } from '@/lib/tipos';

/**
 * Põe a pessoa da conversa numa lista.
 *
 * É o substituto das etiquetas do WhatsApp Business, que a Meta não
 * sincroniza: o atendente organiza a base enquanto conversa, e a lista vira
 * público de campanha.
 */
export function AdicionarNaLista({ contatoId, aoFechar }: { contatoId: string; aoFechar: () => void }) {
  const [listas, setListas] = useState<ListaDeContatos[] | null>(null);
  const [escolhida, setEscolhida] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [resultado, setResultado] = useState<{ tom: 'sucesso' | 'erro'; texto: string } | null>(null);

  useEffect(() => {
    let vivo = true;
    contatos
      .listas()
      .then((l) => vivo && setListas(l))
      .catch((e) => vivo && setResultado({ tom: 'erro', texto: mensagemDoErro(e) }));
    return () => {
      vivo = false;
    };
  }, []);

  async function adicionar() {
    if (!escolhida) return;
    setSalvando(true);
    setResultado(null);
    try {
      const r = await contatos.adicionarNaLista(contatoId, escolhida);
      setResultado({ tom: 'sucesso', texto: r.jaEstava ? `Já estava em "${r.lista}".` : `Adicionado a "${r.lista}".` });
    } catch (e) {
      setResultado({ tom: 'erro', texto: mensagemDoErro(e) });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="space-y-2 border-b border-borda bg-superficie-2/70 p-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <label htmlFor="lista-da-conversa" className="mb-1 block text-xs font-medium text-tinta">
            Adicionar à lista
          </label>
          <Select
            id="lista-da-conversa"
            value={escolhida}
            onChange={(e) => setEscolhida(e.target.value)}
            disabled={!listas || salvando}
          >
            <option value="">{listas ? (listas.length ? 'Escolha uma lista' : 'Nenhuma lista criada') : 'Carregando listas…'}</option>
            {listas?.map((l) => (
              <option key={l.id} value={l.id}>
                {l.nome}
              </option>
            ))}
          </Select>
        </div>
        <Button tamanho="sm" onClick={() => void adicionar()} carregando={salvando} disabled={!escolhida} className="h-10">
          Adicionar
        </Button>
        <Button tamanho="sm" variante="discreto" onClick={aoFechar} className="h-10">
          Fechar
        </Button>
      </div>
      {resultado && (
        <p className={resultado.tom === 'erro' ? 'text-xs text-erro' : 'text-xs text-sucesso'} role="status">
          {resultado.texto}
        </p>
      )}
    </div>
  );
}
