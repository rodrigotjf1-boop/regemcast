'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';

import { IconeSetaDireita, IconeVoltar } from '@/components/app/icones';
import { LayoutAcesso } from '@/components/app/layout-acesso';
import { Alerta } from '@/components/ui/alerta';
import { Button } from '@/components/ui/button';
import { AjudaCampo, Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { mensagemDoErro } from '@/lib/api';
import { AJUDA_SENHA, SENHA_MINIMO, erroDaSenha } from '@/lib/senha';
import { auth } from '@/lib/servicos';

/**
 * "Esqueci minha senha", em dois passos na mesma tela: o e-mail e, depois, o
 * código que chegou com a senha nova.
 *
 * A primeira resposta é sempre a mesma, exista o e-mail ou não — a tela não
 * pode dizer a ninguém quem tem conta. A verificação em duas etapas continua
 * valendo depois da troca: quem usa o aplicativo autenticador ainda precisa
 * dele para entrar.
 */
export default function RecuperarSenha() {
  const [email, setEmail] = useState('');
  const [codigo, setCodigo] = useState('');
  const [senha, setSenha] = useState('');
  const [enviado, setEnviado] = useState(false);
  const [concluido, setConcluido] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function pedirCodigo(evento?: FormEvent<HTMLFormElement>) {
    evento?.preventDefault();
    if (ocupado) return;
    setErro(null);
    setOcupado(true);
    try {
      const r = await auth.esqueciSenha(email.trim());
      setAviso(r.mensagem);
      setEnviado(true);
    } catch (falha) {
      setErro(mensagemDoErro(falha));
    } finally {
      setOcupado(false);
    }
  }

  async function redefinir(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (ocupado) return;
    const problema = erroDaSenha(senha);
    if (problema) {
      setErro(problema);
      return;
    }
    setErro(null);
    setOcupado(true);
    try {
      const r = await auth.redefinirSenha({ email: email.trim(), codigo, senhaNova: senha });
      setSenha('');
      setConcluido(r.mensagem);
    } catch (falha) {
      setErro(mensagemDoErro(falha));
    } finally {
      setOcupado(false);
    }
  }

  const voltarParaEntrar = (
    <Link
      href="/entrar"
      className="inline-flex items-center gap-1.5 font-medium text-acento-forte underline decoration-acento decoration-2 underline-offset-4 hover:decoration-4"
    >
      <IconeVoltar className="h-4 w-4" />
      Voltar para entrar
    </Link>
  );

  if (concluido) {
    return (
      <LayoutAcesso titulo="Senha nova criada" descricao={concluido}>
        <Button
          larguraTotal
          className="group h-11 text-[0.95rem]"
          onClick={() => window.location.assign('/entrar')}
        >
          Entrar com a senha nova
          <IconeSetaDireita className="transition-transform duration-200 group-hover:translate-x-1" />
        </Button>
      </LayoutAcesso>
    );
  }

  if (!enviado) {
    return (
      <LayoutAcesso
        titulo="Esqueceu a senha?"
        descricao="Informe o e-mail de acesso. Enviamos um código para você criar uma senha nova."
        rodape={voltarParaEntrar}
      >
        <form onSubmit={pedirCodigo} noValidate className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="email">E-mail</Label>
            <Input
              id="email"
              type="email"
              inputMode="email"
              autoComplete="username"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="voce@suaempresa.com.br"
              className="h-11"
            />
          </div>
          {erro ? <Alerta>{erro}</Alerta> : null}
          <Button type="submit" larguraTotal carregando={ocupado} className="h-11 text-[0.95rem]">
            Enviar código
          </Button>
        </form>
      </LayoutAcesso>
    );
  }

  return (
    <LayoutAcesso titulo="Crie a senha nova" descricao={aviso ?? undefined} rodape={voltarParaEntrar}>
      <form onSubmit={redefinir} noValidate className="space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor="codigo">Código do e-mail</Label>
          <Input
            id="codigo"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            required
            autoFocus
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            placeholder="000 000"
            className="h-11 text-center font-mono text-lg tracking-[0.3em]"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="senha-nova">Senha nova</Label>
          <Input
            id="senha-nova"
            type="password"
            autoComplete="new-password"
            required
            minLength={SENHA_MINIMO}
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            aria-describedby="ajuda-senha-nova"
            className="h-11"
          />
          <AjudaCampo id="ajuda-senha-nova">{AJUDA_SENHA}</AjudaCampo>
        </div>
        {erro ? <Alerta>{erro}</Alerta> : null}
        <Button type="submit" larguraTotal carregando={ocupado} className="h-11 text-[0.95rem]">
          Criar senha nova
        </Button>
        <p className="text-center text-sm text-tinta-suave">
          Não chegou?{' '}
          <button
            type="button"
            className="font-medium text-acento-forte underline underline-offset-4"
            onClick={() => void pedirCodigo()}
            disabled={ocupado}
          >
            Enviar outro código
          </button>{' '}
          (confira também o spam).
        </p>
      </form>
    </LayoutAcesso>
  );
}
