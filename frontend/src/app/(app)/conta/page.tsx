'use client';

import { useCallback, useEffect, useState } from 'react';

import { DadosConta } from '@/components/app/dados-conta';
import { IconeConta } from '@/components/app/icones';
import { SegurancaConta } from '@/components/app/seguranca-conta';
import { TrocarSenha } from '@/components/app/trocar-senha';
import { useSessao } from '@/components/app/sessao';
import { UsuariosConta } from '@/components/app/usuarios-conta';
import { Badge } from '@/components/ui/badge';
import { CabecalhoPagina } from '@/components/ui/cabecalho-pagina';
import { Card, CardCorpo } from '@/components/ui/card';
import { Esqueleto } from '@/components/ui/esqueleto';
import { EstadoErro } from '@/components/ui/estado-erro';
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
    <div className="space-y-6 lg:space-y-8">
      <CabecalhoPagina
        icone={<IconeConta />}
        sobretitulo="Configuração"
        titulo="Conta e usuários"
        descricao="Dados da empresa, segurança do seu acesso e quem entra no painel."
        acao={
          <>
            <Badge tom={TOM_STATUS[status]} ponto>
              {ROTULO_STATUS[status]}
            </Badge>
            <Badge tom={ehDono ? 'acento' : 'neutro'}>{ehDono ? 'Você é o dono' : 'Você é operador'}</Badge>
          </>
        }
      />

      {carregando ? (
        <Card>
          <CardCorpo className="space-y-4" role="status" aria-label="Carregando dados da conta">
            <Esqueleto className="h-4 w-40" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Esqueleto className="h-10" />
              <Esqueleto className="h-10" />
            </div>
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

      <TrocarSenha />

      <SegurancaConta />

      <UsuariosConta podeGerenciar={ehDono} meuId={sessao.usuario.id} />
    </div>
  );
}
