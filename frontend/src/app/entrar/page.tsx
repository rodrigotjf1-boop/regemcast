'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { IconeEscudo, IconeSetaDireita, IconeVoltar } from '@/components/app/icones';
import { LayoutAcesso } from '@/components/app/layout-acesso';
import { Alerta } from '@/components/ui/alerta';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { mensagemDoErro } from '@/lib/api';
import { auth } from '@/lib/servicos';
import type { EtapaCodigoLogin } from '@/lib/tipos';

/** Só aceita caminho interno — `?de=https://outro.site` não vira redirect. */
function destinoSeguro(bruto: string | null): string {
  if (!bruto) return '/painel';
  if (!bruto.startsWith('/') || bruto.startsWith('//')) return '/painel';
  return bruto;
}

/**
 * Entrada. Duas telas no mesmo lugar: a senha e, para quem ligou a verificação
 * em duas etapas, o código. A senha é apagada da memória da tela assim que é
 * aceita — o passo do código não precisa dela.
 */
export default function Entrar() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [codigo, setCodigo] = useState('');
  const [etapa, setEtapa] = useState<EtapaCodigoLogin | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [reenviando, setReenviando] = useState(false);
  const [destino, setDestino] = useState('/painel');
  const campoEmail = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Lido do `window` de propósito: `useSearchParams` obrigaria um limite de
    // Suspense só para ler um parâmetro opcional.
    const busca = new URLSearchParams(window.location.search);
    setDestino(destinoSeguro(busca.get('de')));
    campoEmail.current?.focus();
  }, []);

  async function enviarSenha(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (enviando) return;
    setErro(null);
    setEnviando(true);
    try {
      const resposta = await auth.entrar({ email: email.trim(), senha });
      if ('etapa' in resposta) {
        setSenha('');
        setEtapa(resposta);
        setEnviando(false);
        return;
      }
      router.replace(destino);
    } catch (falha) {
      setErro(mensagemDoErro(falha));
      setEnviando(false);
    }
  }

  async function enviarCodigo(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (enviando) return;
    setErro(null);
    setAviso(null);
    setEnviando(true);
    try {
      await auth.confirmarCodigo(codigo);
      router.replace(destino);
    } catch (falha) {
      setErro(mensagemDoErro(falha));
      setCodigo('');
      setEnviando(false);
    }
  }

  async function reenviar() {
    setErro(null);
    setAviso(null);
    setReenviando(true);
    try {
      const r = await auth.reenviarCodigo();
      setAviso(`Enviamos um código novo para ${r.emailMascarado}.`);
    } catch (falha) {
      setErro(mensagemDoErro(falha));
    } finally {
      setReenviando(false);
    }
  }

  function voltar() {
    setEtapa(null);
    setCodigo('');
    setErro(null);
    setAviso(null);
  }

  if (etapa) {
    const porEmail = etapa.metodo === 'email';
    return (
      <LayoutAcesso
        titulo="Verificação em duas etapas"
        descricao={
          porEmail
            ? `Enviamos um código de 6 dígitos para ${etapa.emailMascarado}. Ele vale por 10 minutos.`
            : 'Abra o aplicativo autenticador no celular e digite o código do RegemCast.'
        }
      >
        <form onSubmit={enviarCodigo} noValidate className="space-y-5">
          <div className="flex items-center gap-3 rounded-xl bg-acento-suave p-3 text-sm text-acento-forte">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-acento text-acento-contraste">
              <IconeEscudo className="h-5 w-5" />
            </span>
            Sua conta está protegida. Sem o código, a senha sozinha não entra.
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="codigo">Código</Label>
            <Input
              id="codigo"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              placeholder="000 000"
              className="h-12 text-center font-mono text-xl tracking-[0.35em]"
              autoFocus
              required
              invalido={Boolean(erro)}
            />
          </div>

          {erro ? <Alerta>{erro}</Alerta> : null}
          {aviso ? <Alerta tom="sucesso">{aviso}</Alerta> : null}

          <Button type="submit" larguraTotal carregando={enviando} className="h-11">
            {enviando ? 'Conferindo…' : 'Entrar'}
          </Button>

          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <button
              type="button"
              onClick={voltar}
              className="inline-flex items-center gap-1.5 text-tinta-suave hover:text-tinta"
            >
              <IconeVoltar className="h-4 w-4" />
              Voltar para a senha
            </button>
            {porEmail ? (
              <Button variante="discreto" tamanho="sm" onClick={() => void reenviar()} carregando={reenviando}>
                Reenviar código
              </Button>
            ) : null}
          </div>
        </form>
      </LayoutAcesso>
    );
  }

  return (
    <LayoutAcesso
      titulo="Bem-vindo de volta"
      descricao="Entre para acompanhar e disparar suas campanhas."
      rodape={
        <>
          Ainda não tem acesso?{' '}
          <Link
            href="/lista-espera"
            className="font-medium text-acento-forte underline decoration-acento decoration-2 underline-offset-4 hover:decoration-4"
          >
            Entre na lista de espera
          </Link>
        </>
      }
    >
      <form onSubmit={enviarSenha} noValidate className="space-y-5">
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
            className="h-11"
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
            className="h-11"
          />
        </div>

        {erro ? <Alerta>{erro}</Alerta> : null}

        <Button type="submit" larguraTotal carregando={enviando} className="group h-11 text-[0.95rem]">
          {enviando ? 'Entrando…' : 'Entrar'}
          {enviando ? null : (
            <IconeSetaDireita className="transition-transform duration-200 group-hover:translate-x-1" />
          )}
        </Button>
      </form>
    </LayoutAcesso>
  );
}
