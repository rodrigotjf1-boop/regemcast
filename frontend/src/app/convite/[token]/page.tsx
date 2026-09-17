'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { IconeCheck, IconeEscudo, IconeVoltar } from '@/components/app/icones';
import { LayoutAcesso } from '@/components/app/layout-acesso';
import { Alerta } from '@/components/ui/alerta';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Esqueleto } from '@/components/ui/esqueleto';
import { AjudaCampo, Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { mensagemDoErro } from '@/lib/api';
import { AJUDA_SENHA, SENHA_MINIMO, erroDaSenha } from '@/lib/senha';
import { auth } from '@/lib/servicos';
import type { CnpjDoConvite, ConvitePendente } from '@/lib/tipos';

/** Tira a máscara. O CNPJ novo (2026) aceita letras nas 12 primeiras posições. */
function limparCnpj(valor: string): string {
  return valor.replace(/[^0-9A-Za-z]/g, '').toUpperCase().slice(0, 14);
}

/** 00.000.000/0000-00 conforme a pessoa digita. */
function formatarCnpj(valor: string): string {
  const c = limparCnpj(valor);
  return [c.slice(0, 2), c.slice(2, 5), c.slice(5, 8)].filter(Boolean).join('.') +
    (c.length > 8 ? '/' + c.slice(8, 12) : '') +
    (c.length > 12 ? '-' + c.slice(12, 14) : '');
}

/**
 * Criação da conta a partir do convite, em dois passos:
 *
 * 1. **Dados** — o CNPJ é conferido na Receita enquanto a pessoa preenche (a
 *    razão social aparece na tela, e CNPJ baixado ou já usado é avisado ali,
 *    antes de qualquer código).
 * 2. **Código** — um código de 6 dígitos vai para o e-mail do convite. É o que
 *    prova que o e-mail do login é de quem está criando a conta.
 */
export default function Convite({ params }: { params: { token: string } }) {
  const router = useRouter();
  const token = params.token;

  const [convite, setConvite] = useState<ConvitePendente | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erroConvite, setErroConvite] = useState<string | null>(null);

  const [passo, setPasso] = useState<'dados' | 'codigo'>('dados');
  const [cnpj, setCnpj] = useState('');
  const [consulta, setConsulta] = useState<CnpjDoConvite | null>(null);
  const [consultando, setConsultando] = useState(false);
  const [erroCnpj, setErroCnpj] = useState<string | null>(null);
  const [empresa, setEmpresa] = useState('');
  const [nome, setNome] = useState('');
  const [senha, setSenha] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [codigo, setCodigo] = useState('');
  const [emailMascarado, setEmailMascarado] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
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

  async function consultarCnpj(valor = cnpj) {
    const limpo = limparCnpj(valor);
    if (limpo.length !== 14) {
      setErroCnpj('Informe o CNPJ completo, com 14 caracteres.');
      return;
    }
    setErroCnpj(null);
    setConsulta(null);
    setConsultando(true);
    try {
      const r = await auth.consultarCnpjConvite(token, limpo);
      setConsulta(r);
      if (!empresa.trim()) setEmpresa(r.nomeFantasia || r.razaoSocial);
    } catch (falha) {
      setErroCnpj(mensagemDoErro(falha));
    } finally {
      setConsultando(false);
    }
  }

  const cnpjLiberado = Boolean(consulta?.ativa && !consulta.jaCadastrado);

  async function continuar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (enviando) return;
    setErro(null);

    if (!cnpjLiberado) {
      setErro('Confira o CNPJ antes de continuar: ele precisa estar ATIVO na Receita e sem conta no RegemCast.');
      return;
    }
    // Mesma regra do servidor (lib/senha.ts): barrar aqui evita pedir o código
    // para um cadastro que voltaria 400.
    const problema = erroDaSenha(senha);
    if (problema) {
      setErro(problema);
      return;
    }
    if (senha !== confirmacao) {
      setErro('As duas senhas precisam ser iguais.');
      return;
    }

    setEnviando(true);
    try {
      const r = await auth.enviarCodigoConvite(token);
      setEmailMascarado(r.emailMascarado);
      setPasso('codigo');
    } catch (falha) {
      setErro(mensagemDoErro(falha));
    } finally {
      setEnviando(false);
    }
  }

  async function criarConta(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (enviando) return;
    setErro(null);
    setAviso(null);
    setEnviando(true);
    try {
      await auth.aceitarConvite({
        token,
        nome: nome.trim(),
        senha,
        nomeEmpresa: empresa.trim(),
        cnpj: limparCnpj(cnpj),
        codigo,
      });
      router.replace('/painel');
    } catch (falha) {
      setErro(mensagemDoErro(falha));
      setEnviando(false);
    }
  }

  async function reenviar() {
    setErro(null);
    setAviso(null);
    try {
      const r = await auth.enviarCodigoConvite(token);
      setAviso(`Enviamos um código novo para ${r.emailMascarado}.`);
    } catch (falha) {
      setErro(mensagemDoErro(falha));
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

  if (passo === 'codigo') {
    return (
      <LayoutAcesso
        titulo="Confirme o seu e-mail"
        descricao={`Enviamos um código de 6 dígitos para ${emailMascarado}. Ele vale por 10 minutos.`}
      >
        <form onSubmit={criarConta} noValidate className="space-y-5">
          <div className="flex items-center gap-3 rounded-xl bg-acento-suave p-3 text-sm text-acento-forte">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-acento text-acento-contraste">
              <IconeEscudo className="h-5 w-5" />
            </span>
            Este e-mail será o seu login. Confirmar agora garante que só você entra nele.
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
            {enviando ? 'Criando sua conta…' : 'Criar conta e entrar'}
          </Button>

          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <button
              type="button"
              onClick={() => {
                setPasso('dados');
                setCodigo('');
                setErro(null);
                setAviso(null);
              }}
              className="inline-flex items-center gap-1.5 text-tinta-suave hover:text-tinta"
            >
              <IconeVoltar className="h-4 w-4" />
              Voltar aos dados
            </button>
            <Button variante="discreto" tamanho="sm" onClick={() => void reenviar()}>
              Reenviar código
            </Button>
          </div>
        </form>
      </LayoutAcesso>
    );
  }

  return (
    <LayoutAcesso
      titulo="Criar sua conta"
      descricao="Confirme os dados da empresa e escolha a sua senha. Depois, enviamos um código para confirmar o seu e-mail."
    >
      <form onSubmit={continuar} noValidate className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email-convidado">E-mail convidado</Label>
          <Input id="email-convidado" value={convite.email} readOnly aria-describedby="ajuda-convidado" />
          <AjudaCampo id="ajuda-convidado">Este será o seu login.</AjudaCampo>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="cnpj">CNPJ da empresa</Label>
          <div className="flex gap-2">
            <Input
              id="cnpj"
              inputMode="text"
              autoComplete="off"
              value={cnpj}
              onChange={(e) => {
                const formatado = formatarCnpj(e.target.value);
                setCnpj(formatado);
                setConsulta(null);
                setErroCnpj(null);
                // Consulta sozinha ao completar os 14 caracteres.
                if (limparCnpj(formatado).length === 14) void consultarCnpj(formatado);
              }}
              placeholder="00.000.000/0000-00"
              className="font-mono"
              aria-describedby="ajuda-cnpj"
              invalido={Boolean(erroCnpj) || Boolean(consulta && !cnpjLiberado)}
            />
            <Button
              variante="secundario"
              onClick={() => void consultarCnpj()}
              carregando={consultando}
              className="shrink-0"
            >
              Consultar
            </Button>
          </div>
          <AjudaCampo id="ajuda-cnpj">Conferimos na Receita: o CNPJ precisa estar ativo.</AjudaCampo>

          {consultando ? (
            <p className="flex items-center gap-2 text-sm text-tinta-suave">
              <Spinner rotulo={null} /> Consultando a Receita…
            </p>
          ) : null}
          {erroCnpj ? <Alerta>{erroCnpj}</Alerta> : null}
          {consulta ? (
            <div
              className={
                cnpjLiberado
                  ? 'anima-entrada rounded-xl border border-sucesso/30 bg-sucesso/10 p-3'
                  : 'anima-entrada rounded-xl border border-erro/30 bg-erro/10 p-3'
              }
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-tinta">{consulta.razaoSocial}</p>
                  {consulta.nomeFantasia ? (
                    <p className="text-xs text-tinta-suave">{consulta.nomeFantasia}</p>
                  ) : null}
                </div>
                <Badge tom={consulta.ativa ? 'sucesso' : 'erro'} ponto>
                  {consulta.situacao}
                </Badge>
              </div>
              {!consulta.ativa ? (
                <p className="mt-2 text-sm text-erro">Só é possível criar conta com CNPJ ativo na Receita.</p>
              ) : consulta.jaCadastrado ? (
                <p className="mt-2 text-sm text-erro">
                  Já existe uma conta no RegemCast com este CNPJ. Peça ao dono dela um acesso de operador.
                </p>
              ) : (
                <p className="mt-2 flex items-center gap-1.5 text-sm text-sucesso">
                  <IconeCheck className="h-4 w-4" /> CNPJ confirmado
                </p>
              )}
            </div>
          ) : null}
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
              placeholder="Como aparece para a equipe"
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

        <Button type="submit" larguraTotal carregando={enviando} disabled={!cnpjLiberado} className="h-11">
          {enviando ? 'Enviando o código…' : 'Continuar'}
        </Button>
      </form>
    </LayoutAcesso>
  );
}
