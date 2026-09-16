'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { LayoutAcesso } from '@/components/app/layout-acesso';
import { Alerta } from '@/components/ui/alerta';
import { Button } from '@/components/ui/button';
import { Esqueleto } from '@/components/ui/esqueleto';
import { AjudaCampo, Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { mensagemDoErro } from '@/lib/api';
import { AJUDA_SENHA, SENHA_MINIMO, erroDaSenha } from '@/lib/senha';
import { auth } from '@/lib/servicos';
import type { ConvitePendente } from '@/lib/tipos';

export default function Convite({ params }: { params: { token: string } }) {
  const router = useRouter();
  const token = params.token;

  const [convite, setConvite] = useState<ConvitePendente | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erroConvite, setErroConvite] = useState<string | null>(null);

  const [empresa, setEmpresa] = useState('');
  const [nome, setNome] = useState('');
  const [senha, setSenha] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const carregar = useCallback(
    async (sinal?: AbortSignal) => {
      setCarregando(true);
      setErroConvite(null);
      try {
        const dados = await auth.lerConvite(token, sinal);
        setConvite(dados);
        // O convite já traz nome e empresa da lista de espera; começamos
        // preenchidos para o usuário só confirmar.
        setNome((atual) => atual || dados.nome || '');
        setEmpresa((atual) => atual || dados.empresa || '');
      } catch (falha) {
        if (falha instanceof DOMException && falha.name === 'AbortError') return;
        setErroConvite(mensagemDoErro(falha));
      } finally {
        setCarregando(false);
      }
    },
    [token],
  );

  useEffect(() => {
    const controle = new AbortController();
    void carregar(controle.signal);
    return () => controle.abort();
  }, [carregar]);

  async function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (enviando) return;
    // Mesma regra do servidor (lib/senha.ts): barrar aqui evita mandar um
    // cadastro que voltaria 400 com a senha já digitada duas vezes.
    const problema = erroDaSenha(senha);
    if (problema) {
      setErro(problema);
      return;
    }
    if (senha !== confirmacao) {
      setErro('As duas senhas precisam ser iguais.');
      return;
    }
    setErro(null);
    setEnviando(true);
    try {
      await auth.aceitarConvite({
        token,
        nome: nome.trim(),
        senha,
        nomeEmpresa: empresa.trim(),
      });
      router.replace('/painel');
    } catch (falha) {
      setErro(mensagemDoErro(falha));
      setEnviando(false);
    }
  }

  if (carregando) {
    return (
      <LayoutAcesso titulo="Criar sua conta" descricao="Conferindo o seu convite…">
        <div role="status" aria-label="Conferindo o convite" className="space-y-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-2">
              <Esqueleto className="h-3.5 w-28" />
              <Esqueleto className="h-10 w-full" />
            </div>
          ))}
        </div>
      </LayoutAcesso>
    );
  }

  // Sem convite e sem erro não existe estado neutro a mostrar: se a prévia não
  // veio, o formulário não tem para quem criar a conta.
  if (erroConvite || !convite) {
    return (
      <LayoutAcesso
        titulo="Não consegui abrir este convite"
        descricao="Convites vencem. Se o seu expirou, entre de novo na lista de espera que enviamos um link novo."
      >
        <div className="space-y-4">
          <Alerta>
            {erroConvite ?? 'Não recebemos os dados deste convite. Abra o link do e-mail de novo.'}
          </Alerta>
          <div className="flex flex-wrap gap-2">
            <Button variante="secundario" onClick={() => void carregar()}>
              Tentar de novo
            </Button>
            <Link href="/lista-espera">
              <Button variante="discreto">Ir para a lista de espera</Button>
            </Link>
          </div>
        </div>
      </LayoutAcesso>
    );
  }

  return (
    <LayoutAcesso
      titulo="Criar sua conta"
      descricao="Confirme os dados e escolha a sua senha. Em um minuto você está no painel."
    >
      <form onSubmit={enviar} noValidate className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email-convidado">E-mail convidado</Label>
          <Input
            id="email-convidado"
            value={convite.email}
            readOnly
            aria-describedby="ajuda-convidado"
          />
          <AjudaCampo id="ajuda-convidado">
            Este será o seu login. Convites vencem — conclua o cadastro agora.
          </AjudaCampo>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="empresa">Nome da empresa</Label>
            <Input
              id="empresa"
              name="empresa"
              autoComplete="organization"
              required
              value={empresa}
              onChange={(e) => setEmpresa(e.target.value)}
              placeholder="Sua empresa"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="nome">Seu nome</Label>
            <Input
              id="nome"
              name="nome"
              autoComplete="name"
              required
              value={nome}
              onChange={(e) => setNome(e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="senha">Senha</Label>
            <Input
              id="senha"
              name="senha"
              type="password"
              autoComplete="new-password"
              required
              minLength={SENHA_MINIMO}
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              aria-describedby="ajuda-senha"
            />
            <AjudaCampo id="ajuda-senha">{AJUDA_SENHA}</AjudaCampo>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="confirmacao">Repita a senha</Label>
            <Input
              id="confirmacao"
              name="confirmacao"
              type="password"
              autoComplete="new-password"
              required
              value={confirmacao}
              onChange={(e) => setConfirmacao(e.target.value)}
              invalido={Boolean(confirmacao) && confirmacao !== senha}
            />
          </div>
        </div>

        {erro ? <Alerta>{erro}</Alerta> : null}

        <Button type="submit" larguraTotal carregando={enviando} className="h-11">
          {enviando ? 'Criando sua conta…' : 'Criar conta e entrar'}
        </Button>
      </form>
    </LayoutAcesso>
  );
}
