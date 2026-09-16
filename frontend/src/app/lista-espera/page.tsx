'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';

import { IconeCheck } from '@/components/app/icones';
import { LayoutAcesso } from '@/components/app/layout-acesso';
import { Alerta } from '@/components/ui/alerta';
import { Button } from '@/components/ui/button';
import { AjudaCampo, Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { mensagemDoErro } from '@/lib/api';
import { listaEspera } from '@/lib/servicos';

const LINK =
  'font-medium text-acento-forte underline decoration-acento decoration-2 underline-offset-4 hover:decoration-4';

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

  if (pronto) {
    return (
      <LayoutAcesso
        titulo="Pedido registrado"
        descricao="Seu lugar na fila está guardado."
        rodape={
          <Link href="/entrar" className={LINK}>
            Voltar para a entrada
          </Link>
        }
      >
        <div className="space-y-4 text-center">
          <span className="relative mx-auto grid h-16 w-16 place-items-center">
            <span className="ponto-vivo absolute inset-3 rounded-full text-acento/50" aria-hidden="true" />
            <span className="anima-surgir relative grid h-16 w-16 place-items-center rounded-full bg-acento text-acento-contraste shadow-brilho">
              <IconeCheck className="h-8 w-8" />
            </span>
          </span>
          <p className="text-sm leading-relaxed text-tinta-suave">
            Liberamos as vagas <strong className="text-tinta">por ordem de chegada</strong>, em lotes
            pequenos, porque a Meta limita quantos números novos conectamos por semana — assim
            ninguém fica preso no meio da conexão do número.
          </p>
          <p className="text-sm leading-relaxed text-tinta-suave">
            Quando for sua vez, enviamos um convite para{' '}
            <strong className="text-tinta">{email}</strong> com o link de criação da conta. Não é
            preciso fazer mais nada agora.
          </p>
        </div>
      </LayoutAcesso>
    );
  }

  return (
    <LayoutAcesso
      titulo="Lista de espera"
      descricao="Conte quem você é. Avisamos por e-mail quando a sua vaga for liberada."
      rodape={
        <>
          Já tem conta?{' '}
          <Link href="/entrar" className={LINK}>
            Entrar
          </Link>
        </>
      }
    >
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
            Telefone para contato
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
          <AjudaCampo id="ajuda-telefone">Com DDD. Usamos só para avisar da liberação.</AjudaCampo>
        </div>

        {erro ? <Alerta>{erro}</Alerta> : null}

        <Button type="submit" larguraTotal carregando={enviando} className="h-11">
          {enviando ? 'Enviando…' : 'Entrar na lista'}
        </Button>
      </form>
    </LayoutAcesso>
  );
}
