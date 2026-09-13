'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';

import { Logotipo } from '@/components/marca/logotipo';
import { Alerta } from '@/components/ui/alerta';
import { Button } from '@/components/ui/button';
import { Card, CardCorpo } from '@/components/ui/card';
import { AjudaCampo, Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { mensagemDoErro } from '@/lib/api';
import { listaEspera } from '@/lib/servicos';

export default function ListaEspera() {
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [empresa, setEmpresa] = useState('');
  const [telefone, setTelefone] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [pronto, setPronto] = useState(false);

  async function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (enviando) return;
    setErro(null);
    setEnviando(true);
    try {
      await listaEspera.entrarNaFila({
        nome: nome.trim(),
        email: email.trim(),
        empresa: empresa.trim() || undefined,
        telefone: telefone.trim() || undefined,
        origem: 'site',
      });
      setPronto(true);
    } catch (falha) {
      setErro(mensagemDoErro(falha));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <main id="conteudo" className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-lg space-y-6">
        <div className="space-y-3 text-center">
          <Logotipo className="justify-center" />
          <h1 className="text-2xl">Lista de espera</h1>
          <p className="text-sm text-tinta-suave">
            O RegemCast dispara suas campanhas de WhatsApp pela API oficial da Meta — com número
            verificado, modelos aprovados e histórico de cada envio.
          </p>
        </div>

        {pronto ? (
          <Card>
            <CardCorpo className="space-y-4 text-center">
              <span
                aria-hidden="true"
                className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-sucesso/10 text-2xl text-sucesso"
              >
                ✓
              </span>
              <h2 className="text-lg font-semibold">Pedido registrado</h2>
              <p className="text-sm text-tinta-suave">
                Guardamos seu lugar na fila. Liberamos as vagas <strong>por ordem de chegada</strong>,
                em lotes pequenos, porque a Meta limita quantos números novos conectamos por semana —
                assim ninguém fica preso no meio da conexão do WhatsApp.
              </p>
              <p className="text-sm text-tinta-suave">
                Quando for sua vez, enviamos um convite para <strong>{email}</strong> com o link de
                criação da conta. Não é preciso fazer mais nada agora.
              </p>
              <div className="pt-1">
                <Link href="/entrar">
                  <Button variante="secundario">Voltar para a entrada</Button>
                </Link>
              </div>
            </CardCorpo>
          </Card>
        ) : (
          <Card>
            <CardCorpo>
              <form onSubmit={enviar} noValidate className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="nome">Seu nome</Label>
                    <Input
                      id="nome"
                      name="nome"
                      autoComplete="name"
                      required
                      value={nome}
                      onChange={(e) => setNome(e.target.value)}
                      placeholder="Como devemos te chamar"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="empresa" opcional>
                      Empresa
                    </Label>
                    <Input
                      id="empresa"
                      name="empresa"
                      autoComplete="organization"
                      value={empresa}
                      onChange={(e) => setEmpresa(e.target.value)}
                      placeholder="Nome do seu negócio"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="email">E-mail</Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="voce@suaempresa.com.br"
                    aria-describedby="ajuda-email"
                  />
                  <AjudaCampo id="ajuda-email">O convite chega neste endereço.</AjudaCampo>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="telefone" opcional>
                    WhatsApp para contato
                  </Label>
                  <Input
                    id="telefone"
                    name="telefone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    value={telefone}
                    onChange={(e) => setTelefone(e.target.value)}
                    placeholder="(11) 90000-0000"
                    aria-describedby="ajuda-telefone"
                  />
                  <AjudaCampo id="ajuda-telefone">
                    Com DDD. Usamos só para avisar da liberação.
                  </AjudaCampo>
                </div>

                {erro ? <Alerta>{erro}</Alerta> : null}

                <Button type="submit" larguraTotal carregando={enviando}>
                  {enviando ? 'Enviando…' : 'Entrar na lista'}
                </Button>

                <p className="text-center text-xs text-tinta-suave">
                  Já tem conta?{' '}
                  <Link
                    href="/entrar"
                    className="font-medium text-acento underline underline-offset-4 hover:text-acento-forte"
                  >
                    Entrar
                  </Link>
                  .
                </p>
              </form>
            </CardCorpo>
          </Card>
        )}
      </div>
    </main>
  );
}
