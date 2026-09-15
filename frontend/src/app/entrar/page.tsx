'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { Logotipo } from '@/components/marca/logotipo';
import { Alerta } from '@/components/ui/alerta';
import { Button } from '@/components/ui/button';
import { Card, CardCorpo } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { mensagemDoErro } from '@/lib/api';
import { auth } from '@/lib/servicos';

/** Só aceita caminho interno — `?de=https://outro.site` não vira redirect. */
function destinoSeguro(bruto: string | null): string {
  if (!bruto) return '/painel';
  if (!bruto.startsWith('/') || bruto.startsWith('//')) return '/painel';
  return bruto;
}

export default function Entrar() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [destino, setDestino] = useState('/painel');
  const campoEmail = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Lido do `window` de propósito: `useSearchParams` obrigaria um limite de
    // Suspense só para ler um parâmetro opcional.
    const busca = new URLSearchParams(window.location.search);
    setDestino(destinoSeguro(busca.get('de')));
    campoEmail.current?.focus();
  }, []);

  async function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (enviando) return;
    setErro(null);
    setEnviando(true);
    try {
      await auth.entrar({ email: email.trim(), senha });
      router.replace(destino);
    } catch (falha) {
      setErro(mensagemDoErro(falha));
      setEnviando(false);
    }
  }

  return (
    <main id="conteudo" className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-2 text-center">
          <Logotipo className="justify-center" />
          <p className="text-sm text-tinta-suave">
            Entre para gerenciar seus disparos.
          </p>
        </div>

        <Card>
          <CardCorpo>
            <form onSubmit={enviar} noValidate className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">E-mail</Label>
                <Input
                  ref={campoEmail}
                  id="email"
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="voce@suaempresa.com.br"
                  invalido={Boolean(erro)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="senha">Senha</Label>
                <Input
                  id="senha"
                  name="senha"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  invalido={Boolean(erro)}
                />
              </div>

              {erro ? <Alerta>{erro}</Alerta> : null}

              <Button type="submit" larguraTotal carregando={enviando}>
                {enviando ? 'Entrando…' : 'Entrar'}
              </Button>
            </form>
          </CardCorpo>
        </Card>

        <p className="text-center text-sm text-tinta-suave">
          Ainda não tem acesso?{' '}
          <Link
            href="/lista-espera"
            className="font-medium text-acento-forte underline underline-offset-4 decoration-acento decoration-2 hover:decoration-4"
          >
            Entre na lista de espera
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
