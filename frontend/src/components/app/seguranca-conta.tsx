'use client';

import QRCode from 'qrcode';
import { useState, type FormEvent } from 'react';

import { IconeCelular, IconeCheck, IconeConversa, IconeEscudo } from '@/components/app/icones';
import { useSessao } from '@/components/app/sessao';
import { Alerta } from '@/components/ui/alerta';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Esqueleto } from '@/components/ui/esqueleto';
import { EstadoErro } from '@/components/ui/estado-erro';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/cn';
import { mensagemDoErro } from '@/lib/api';
import { seguranca } from '@/lib/servicos';
import type { SituacaoSeguranca } from '@/lib/tipos';
import { useCarga } from '@/lib/use-carga';

/**
 * Verificação em duas etapas de quem está logado.
 *
 * É da PESSOA, não da conta: cada um liga a sua, porque o código chega no
 * celular ou no e-mail de quem entra. O dono não liga pelos operadores.
 *
 * Ligar exige provar que funciona (um código válido). Desligar exige a senha.
 */

type Fluxo = null | 'app' | 'email' | 'desativar';

export function SegurancaConta() {
  const { sessao } = useSessao();
  const carga = useCarga(() => seguranca.situacao());
  const [situacao, setSituacao] = useState<SituacaoSeguranca | null>(null);
  const atual = situacao ?? carga.dados;

  const [fluxo, setFluxo] = useState<Fluxo>(null);
  const [qr, setQr] = useState('');
  const [segredo, setSegredo] = useState('');
  const [codigo, setCodigo] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  function fechar() {
    setFluxo(null);
    setQr('');
    setSegredo('');
    setCodigo('');
    setSenha('');
    setErro(null);
  }

  async function executar(acao: () => Promise<void>) {
    setErro(null);
    setOcupado(true);
    try {
      await acao();
    } catch (falha) {
      setErro(mensagemDoErro(falha));
    } finally {
      setOcupado(false);
    }
  }

  const abrirApp = () =>
    executar(async () => {
      setAviso(null);
      const r = await seguranca.iniciarApp();
      setSegredo(r.segredo);
      setQr(await QRCode.toDataURL(r.endereco, { margin: 1, width: 200 }));
      setFluxo('app');
    });

  const abrirEmail = () =>
    executar(async () => {
      setAviso(null);
      const r = await seguranca.enviarCodigoEmail();
      setAviso(`Enviamos um código para ${r.emailMascarado}. Ele vale por ${r.minutos} minutos.`);
      setFluxo('email');
    });

  const confirmar = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void executar(async () => {
      const r = fluxo === 'app' ? await seguranca.ativarApp(codigo) : await seguranca.ativarEmail(codigo);
      setSituacao(r);
      fechar();
      setAviso(
        r.doisFatores === 'app'
          ? 'Pronto. No próximo login, vamos pedir o código do aplicativo.'
          : 'Pronto. No próximo login, vamos enviar um código para o seu e-mail.',
      );
    });
  };

  const desativar = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void executar(async () => {
      const r = await seguranca.desativar(senha);
      setSituacao(r);
      fechar();
      setAviso('Verificação em duas etapas desligada. Sua conta volta a entrar só com a senha.');
    });
  };

  return (
    <section className="anima-entrada overflow-hidden rounded-card border border-borda bg-superficie shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-borda px-5 py-4">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-acento text-acento-contraste">
            <IconeEscudo className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-base font-semibold text-tinta">Segurança do seu acesso</h2>
            <p className="text-sm text-tinta-suave">
              Verificação em duas etapas: além da senha, um código a cada login. Vale só para{' '}
              {sessao.usuario.email}.
            </p>
          </div>
        </div>
        {atual ? (
          atual.doisFatores === 'nenhum' ? (
            <Badge tom="atencao" ponto>
              Só senha
            </Badge>
          ) : (
            <Badge tom="sucesso" ponto>
              Protegido · {atual.doisFatores === 'app' ? 'aplicativo' : 'e-mail'}
            </Badge>
          )
        ) : null}
      </div>

      <div className="space-y-4 p-5">
        {carga.carregando && !atual ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" role="status" aria-label="Carregando">
            <Esqueleto className="h-28 rounded-xl" />
            <Esqueleto className="h-28 rounded-xl" />
          </div>
        ) : carga.erro && !atual ? (
          <EstadoErro
            titulo="Não consegui ler a sua segurança"
            mensagem={carga.erro}
            aoTentarDeNovo={() => void carga.recarregar()}
          />
        ) : atual ? (
          <>
            <p className="flex items-center gap-2 text-sm">
              {atual.emailVerificado ? (
                <>
                  <IconeCheck className="h-4 w-4 text-sucesso" />
                  <span className="text-tinta">E-mail verificado</span>
                </>
              ) : (
                <span className="text-tinta-suave">
                  E-mail ainda não verificado — ativar o código por e-mail confirma o endereço.
                </span>
              )}
            </p>

            {aviso ? <Alerta tom="sucesso">{aviso}</Alerta> : null}
            {erro && fluxo === null ? <Alerta>{erro}</Alerta> : null}

            {atual.doisFatores === 'nenhum' && fluxo === null ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <OpcaoMetodo
                  icone={<IconeCelular className="h-5 w-5" />}
                  titulo="Aplicativo autenticador"
                  descricao="Google Authenticator, Microsoft Authenticator ou Authy. Funciona sem internet no celular."
                  recomendado
                  disponivel={atual.appDisponivel}
                  acao="Configurar aplicativo"
                  aoEscolher={() => void abrirApp()}
                  ocupado={ocupado}
                />
                <OpcaoMetodo
                  icone={<IconeConversa className="h-5 w-5" />}
                  titulo="Código por e-mail"
                  descricao="Enviamos um código de 6 dígitos para o seu e-mail a cada login."
                  disponivel
                  acao="Ativar por e-mail"
                  aoEscolher={() => void abrirEmail()}
                  ocupado={ocupado}
                />
              </div>
            ) : null}

            {fluxo === 'app' || fluxo === 'email' ? (
              <form onSubmit={confirmar} className="anima-entrada space-y-4 rounded-xl border border-acento/50 p-4">
                {fluxo === 'app' ? (
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                    <div className="grid h-[200px] w-[200px] shrink-0 place-items-center self-center rounded-xl bg-white p-2 sm:self-start">
                      {qr ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={qr} alt="QR code para o aplicativo autenticador" width={200} height={200} />
                      ) : (
                        <Esqueleto className="h-full w-full" />
                      )}
                    </div>
                    <div className="space-y-2 text-sm text-tinta-suave">
                      <p className="font-medium text-tinta">1. Escaneie o QR code com o aplicativo</p>
                      <p>2. Digite abaixo o código de 6 dígitos que aparece para o RegemCast.</p>
                      {segredo ? (
                        <details className="text-xs">
                          <summary className="cursor-pointer">Não consigo escanear</summary>
                          <p className="mt-2">Digite esta chave no aplicativo:</p>
                          <code className="mt-1 block break-all rounded bg-superficie-2 p-2 font-mono text-tinta">
                            {segredo.match(/.{1,4}/g)?.join(' ')}
                          </code>
                        </details>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-tinta-suave">
                    Digite o código que chegou no seu e-mail para confirmar.
                  </p>
                )}

                <div className="max-w-xs space-y-1.5">
                  <Label htmlFor="codigo-seguranca">Código</Label>
                  <Input
                    id="codigo-seguranca"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={7}
                    value={codigo}
                    onChange={(e) => setCodigo(e.target.value)}
                    placeholder="000 000"
                    className="h-11 text-center font-mono text-lg tracking-[0.3em]"
                    autoFocus
                    required
                  />
                </div>

                {erro ? <Alerta>{erro}</Alerta> : null}

                <div className="flex flex-wrap gap-2">
                  <Button type="submit" carregando={ocupado}>
                    Ativar
                  </Button>
                  <Button variante="discreto" onClick={fechar}>
                    Cancelar
                  </Button>
                </div>
              </form>
            ) : null}

            {atual.doisFatores !== 'nenhum' && fluxo === null ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-superficie-2/60 p-4">
                <p className="text-sm text-tinta-suave">
                  {atual.doisFatores === 'app'
                    ? 'A cada login pedimos o código do aplicativo autenticador.'
                    : 'A cada login enviamos um código para o seu e-mail.'}
                </p>
                <Button variante="perigo" tamanho="sm" onClick={() => setFluxo('desativar')}>
                  Desativar
                </Button>
              </div>
            ) : null}

            {fluxo === 'desativar' ? (
              <form onSubmit={desativar} className="anima-entrada space-y-3 rounded-xl border border-erro/40 p-4">
                <p className="text-sm text-tinta">
                  Sem a segunda etapa, quem souber a sua senha entra na conta. Para desligar, confirme a sua senha.
                </p>
                <div className="max-w-xs space-y-1.5">
                  <Label htmlFor="senha-desativar">Senha</Label>
                  <Input
                    id="senha-desativar"
                    type="password"
                    autoComplete="current-password"
                    value={senha}
                    onChange={(e) => setSenha(e.target.value)}
                    autoFocus
                    required
                  />
                </div>
                {erro ? <Alerta>{erro}</Alerta> : null}
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" variante="perigo" carregando={ocupado}>
                    Desativar verificação
                  </Button>
                  <Button variante="discreto" onClick={fechar}>
                    Cancelar
                  </Button>
                </div>
              </form>
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  );
}

function OpcaoMetodo({
  icone,
  titulo,
  descricao,
  recomendado = false,
  disponivel,
  acao,
  aoEscolher,
  ocupado,
}: {
  icone: React.ReactNode;
  titulo: string;
  descricao: string;
  recomendado?: boolean;
  disponivel: boolean;
  acao: string;
  aoEscolher: () => void;
  ocupado: boolean;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-xl border p-4',
        recomendado ? 'border-acento/60 bg-acento-suave/40' : 'border-borda',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-superficie text-tinta shadow-sm">{icone}</span>
        {recomendado ? <Badge tom="acento">Recomendado</Badge> : null}
      </div>
      <div>
        <p className="text-sm font-semibold text-tinta">{titulo}</p>
        <p className="text-sm text-tinta-suave">{descricao}</p>
      </div>
      {disponivel ? (
        <Button variante={recomendado ? 'primario' : 'secundario'} tamanho="sm" onClick={aoEscolher} disabled={ocupado} className="mt-auto w-fit">
          {acao}
        </Button>
      ) : (
        <p className="mt-auto text-xs text-tinta-suave">Ainda não disponível neste servidor.</p>
      )}
    </div>
  );
}
