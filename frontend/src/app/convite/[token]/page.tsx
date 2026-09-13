'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { Logotipo } from '@/components/marca/logotipo';
import { Alerta } from '@/components/ui/alerta';
import { Button } from '@/components/ui/button';
import { Card, CardCorpo } from '@/components/ui/card';
import { AjudaCampo, Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
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

  return (
    <main id="conteudo" className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-lg space-y-6">
        <div className="space-y-2 text-center">
          <Logotipo className="justify-center" />
          <h1 className="text-2xl">Criar sua conta</h1>
        </div>

        {carregando ? (
          <Card>
            <CardCorpo className="flex items-center justify-center gap-3 py-10 text-sm text-tinta-suave">
              <Spinner rotulo={null} />
              Conferindo o convite…
            </CardCorpo>
          </Card>
        ) : erroConvite || !convite ? (
          // Sem convite e sem erro não existe estado neutro a mostrar: se a
          // prévia não veio, o formulário não tem para quem criar a conta.
          <Card>
            <CardCorpo className="space-y-4 text-center">
              <h2 className="text-lg font-semibold">Não consegui abrir este convite</h2>
              <Alerta>
                {erroConvite ?? 'Não recebemos os dados deste convite. Abra o link do e-mail de novo.'}
              </Alerta>
              <p className="text-sm text-tinta-suave">
                Convites vencem. Se o seu expirou, entre de novo na lista de espera que enviamos um
                link novo.
              </p>
              <div className="flex flex-wrap justify-center gap-2 pt-1">
                <Button variante="secundario" onClick={() => void carregar()}>
                  Tentar de novo
                </Button>
                <Link href="/lista-espera">
                  <Button variante="discreto">Ir para a lista de espera</Button>
                </Link>
              </div>
            </CardCorpo>
          </Card>
        ) : (
          <Card>
            <CardCorpo>
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

                <div className="space-y-1.5">
                  <Label htmlFor="empresa">Nome da empresa</Label>
                  <Input
                    id="empresa"
                    name="empresa"
                    autoComplete="organization"
                    required
                    value={empresa}
                    onChange={(e) => setEmpresa(e.target.value)}
                    placeholder="Como sua empresa aparece para a equipe"
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

                <Button type="submit" larguraTotal carregando={enviando}>
                  {enviando ? 'Criando sua conta…' : 'Criar conta e entrar'}
                </Button>
              </form>
            </CardCorpo>
          </Card>
        )}
      </div>
    </main>
  );
}
