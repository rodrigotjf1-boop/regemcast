'use client';

import { useCallback, useEffect, useState } from 'react';

import { DadosConta } from '@/components/app/dados-conta';
import { useSessao } from '@/components/app/sessao';
import { UsuariosConta } from '@/components/app/usuarios-conta';
import { Badge } from '@/components/ui/badge';
import { Card, CardCorpo } from '@/components/ui/card';
import { EstadoErro } from '@/components/ui/estado-erro';
import { Spinner } from '@/components/ui/spinner';
import { mensagemDoErro } from '@/lib/api';
import { conta as servicoConta } from '@/lib/servicos';
import type { Conta, ResumoConta, StatusConta } from '@/lib/tipos';

/** Cada status tem nome próprio: "Ativa" no lugar de "Cancelada" é mentira. */
const ROTULO_STATUS: Record<StatusConta, string> = {
  aprovada: 'Aprovada',
  ativa: 'Ativa',
  suspensa: 'Suspensa',
  cancelada: 'Cancelada',
};

const TOM_STATUS: Record<StatusConta, 'acento' | 'sucesso' | 'atencao' | 'erro'> = {
  aprovada: 'acento',
  ativa: 'sucesso',
  suspensa: 'atencao',
  cancelada: 'erro',
};

export default function ContaPage() {
  const { sessao } = useSessao();
  const ehDono = sessao.usuario.papel === 'dono';

  const [resumo, setResumo] = useState<ResumoConta | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async (sinal?: AbortSignal) => {
    setCarregando(true);
    setErro(null);
    try {
      setResumo(await servicoConta.resumo(sinal));
    } catch (falha) {
      if (falha instanceof DOMException && falha.name === 'AbortError') return;
      setResumo(null);
      setErro(mensagemDoErro(falha));
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    const controle = new AbortController();
    void carregar(controle.signal);
    return () => controle.abort();
  }, [carregar]);

  function aoSalvar(atualizada: Conta) {
    setResumo((atual) => (atual ? { ...atual, conta: atualizada } : atual));
  }

  // O status vem da sessão, que já está carregada: o selo continua verdadeiro
  // mesmo quando o resumo da conta falha.
  const status = resumo?.conta.status ?? sessao.conta.status;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl">Conta</h1>
        <Badge tom={TOM_STATUS[status]}>{ROTULO_STATUS[status]}</Badge>
        <Badge tom={ehDono ? 'acento' : 'neutro'}>
          {ehDono ? 'Você é o dono' : 'Você é operador'}
        </Badge>
      </div>

      {carregando ? (
        <Card>
          <CardCorpo className="flex items-center gap-3 py-10 text-sm text-tinta-suave">
            <Spinner rotulo={null} />
            Carregando dados da conta…
          </CardCorpo>
        </Card>
      ) : erro || !resumo ? (
        <Card>
          <CardCorpo>
            <EstadoErro
              titulo="Não consegui carregar os dados da conta"
              mensagem={erro ?? 'A resposta do servidor veio sem os dados da conta.'}
              aoTentarDeNovo={() => void carregar()}
            />
          </CardCorpo>
        </Card>
      ) : (
        <DadosConta conta={resumo.conta} podeEditar={ehDono} aoSalvar={aoSalvar} />
      )}

      <UsuariosConta podeGerenciar={ehDono} meuId={sessao.usuario.id} />
    </div>
  );
}
