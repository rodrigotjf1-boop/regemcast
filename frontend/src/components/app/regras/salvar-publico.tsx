'use client';

import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { AjudaCampo, Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { mensagemDoErro } from '@/lib/api';
import { paraEnviar } from '@/lib/regras-do-publico';
import { publicosSalvos } from '@/lib/servicos';
import type { PublicoSalvo, RegraDoPublico } from '@/lib/tipos';

/** Mais que isso o servidor recusa. */
const TAMANHO_DO_NOME = 80;

/**
 * "Salvar como público": dá nome às regras. Ficam guardadas as regras, não as
 * pessoas. O nome repetido volta como 409 e aparece aqui, no painel.
 */
export function SalvarPublico({
  prefixo,
  regras,
  aoSalvar,
  aoCancelar,
}: {
  prefixo: string;
  regras: RegraDoPublico[];
  aoSalvar: (salvo: PublicoSalvo) => void;
  aoCancelar: () => void;
}) {
  const [nome, setNome] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const campo = useRef<HTMLInputElement>(null);

  useEffect(() => {
    campo.current?.focus();
  }, []);

  async function salvar() {
    const limpo = nome.replace(/\s+/g, ' ').trim();
    if (!limpo) {
      setErro('Dê um nome ao público.');
      campo.current?.focus();
      return;
    }
    setErro('');
    setSalvando(true);
    try {
      aoSalvar(await publicosSalvos.criar(limpo, paraEnviar(regras)));
    } catch (e) {
      setErro(mensagemDoErro(e));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div
      role="group"
      aria-labelledby={`${prefixo}-salvar-titulo`}
      className="space-y-3 rounded-2xl border border-tinta/30 bg-superficie p-4 shadow-flutuante"
    >
      <h3 id={`${prefixo}-salvar-titulo`} className="text-sm font-semibold text-tinta">
        Salvar como público
      </h3>
      <p className="text-xs leading-relaxed text-tinta-suave">
        Ficam guardadas as regras, não as pessoas: a cada uso o Regemcast confere de novo quem combina. O público
        aparece aqui e em Contatos › Públicos salvos.
      </p>
      <div className="max-w-md space-y-1">
        <Label htmlFor={`${prefixo}-nome-publico`}>Nome do público</Label>
        <Input
          ref={campo}
          id={`${prefixo}-nome-publico`}
          value={nome}
          maxLength={TAMANHO_DO_NOME}
          placeholder="Ex.: Sumidos com 3 ou mais pedidos"
          invalido={Boolean(erro)}
          aria-describedby={erro ? `${prefixo}-nome-publico-erro` : undefined}
          onChange={(e) => {
            setNome(e.target.value);
            setErro('');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void salvar();
            }
          }}
        />
        {erro && (
          <AjudaCampo tom="erro" id={`${prefixo}-nome-publico-erro`}>
            {erro}
          </AjudaCampo>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void salvar()} carregando={salvando}>
          Salvar público
        </Button>
        <Button variante="discreto" onClick={aoCancelar} disabled={salvando}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
