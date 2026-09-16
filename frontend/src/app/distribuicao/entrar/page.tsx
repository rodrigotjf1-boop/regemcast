'use client';

import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

import { Logotipo } from '@/components/marca/logotipo';
import { Alerta } from '@/components/ui/alerta';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { mensagemDoErro } from '@/lib/api';
import { distribuicao, type EtapaLogin } from '@/lib/servicos';

/**
 * Login do console de distribuição.
 *
 * Três telas num fluxo só: senha → código, ou senha → cadastro do código no
 * primeiro acesso. Não existe caminho da senha direto para o console — e a tela
 * não oferece um, para ninguém procurar.
 *
 * O cadastro mostra o QR code E o segredo em texto. O texto não é redundância:
 * quem abre o console no próprio celular não tem como escanear a tela em que
 * está, e precisa digitar a chave no aplicativo.
 */

type Passo = 'senha' | EtapaLogin;

export default function EntrarDistribuicao() {
  const router = useRouter();
  const [passo, setPasso] = useState<Passo>('senha');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [codigo, setCodigo] = useState('');
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [qr, setQr] = useState('');
  const [segredo, setSegredo] = useState('');

  // No cadastro, gera o QR assim que a etapa aparece.
  useEffect(() => {
    if (passo !== 'cadastrar_codigo') return;
    let vivo = true;
    (async () => {
      try {
        const r = await distribuicao.iniciarCodigo();
        if (!vivo) return;
        setSegredo(r.segredo);
        setQr(await QRCode.toDataURL(r.endereco, { margin: 1, width: 220 }));
      } catch (e) {
        if (vivo) setErro(mensagemDoErro(e));
      }
    })();
    return () => {
      vivo = false;
    };
  }, [passo]);

  async function enviarSenha(e: React.FormEvent) {
    e.preventDefault();
    setErro('');
    setOcupado(true);
    try {
      const r = await distribuicao.entrar(email, senha);
      setSenha(''); // não fica na memória da tela depois de usada
      setPasso(r.etapa);
    } catch (err) {
      setErro(mensagemDoErro(err));
    } finally {
      setOcupado(false);
    }
  }

  async function enviarCodigo(e: React.FormEvent) {
    e.preventDefault();
    setErro('');
    setOcupado(true);
    try {
      if (passo === 'cadastrar_codigo') await distribuicao.confirmarCadastro(codigo);
      else await distribuicao.confirmarCodigo(codigo);
      router.replace('/distribuicao');
    } catch (err) {
      setErro(mensagemDoErro(err));
      setCodigo('');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="relative isolate flex min-h-screen items-center justify-center overflow-hidden bg-lateral px-4 py-10">
      <div aria-hidden="true" className="fundo-pontos-claro absolute inset-0 -z-10" />
      <div aria-hidden="true" className="anima-aurora absolute left-1/2 top-1/3 -z-10 h-96 w-96 -translate-x-1/2 rounded-full bg-acento/15 blur-3xl" />
      <div className="anima-entrada w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <Logotipo sobreEscuro animado tamanho="lg" />
          <span className="rounded-full bg-acento px-3 py-1 text-xs font-semibold uppercase tracking-wider text-acento-contraste">
            Distribuição
          </span>
          <p className="text-sm text-lateral-suave">
            Console interno. Aqui você vê dados de todas as contas — cada acesso fica registrado.
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-superficie p-6 shadow-flutuante">
          {erro && (
            <div className="mb-4">
              <Alerta tom="erro">{erro}</Alerta>
            </div>
          )}

          {passo === 'senha' && (
            <form onSubmit={(e) => void enviarSenha(e)} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="d-email">E-mail</Label>
                <Input
                  id="d-email"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="d-senha">Senha</Label>
                <Input
                  id="d-senha"
                  type="password"
                  autoComplete="current-password"
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" carregando={ocupado} className="w-full">
                Continuar
              </Button>
            </form>
          )}

          {passo !== 'senha' && (
            <form onSubmit={(e) => void enviarCodigo(e)} className="space-y-4">
              {passo === 'cadastrar_codigo' ? (
                <div className="space-y-3">
                  <div>
                    <h1 className="text-base font-semibold text-tinta">Ative a verificação em duas etapas</h1>
                    <p className="mt-1 text-sm leading-relaxed text-tinta-suave">
                      Obrigatória para entrar no console. Escaneie com o Google Authenticator,
                      Microsoft Authenticator ou Authy.
                    </p>
                  </div>

                  <div className="flex justify-center rounded-lg bg-white p-3">
                    {qr ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={qr} alt="QR code para o aplicativo autenticador" width={220} height={220} />
                    ) : (
                      <div className="h-[220px] w-[220px] animate-pulse rounded bg-superficie-2" />
                    )}
                  </div>

                  {segredo && (
                    <details className="text-xs text-tinta-suave">
                      <summary className="cursor-pointer">Não consigo escanear</summary>
                      <p className="mt-2">Digite esta chave no aplicativo:</p>
                      <code className="mt-1 block break-all rounded bg-superficie-2 p-2 font-mono text-[0.7rem] text-tinta">
                        {segredo.match(/.{1,4}/g)?.join(' ')}
                      </code>
                    </details>
                  )}
                </div>
              ) : (
                <div>
                  <h1 className="text-base font-semibold text-tinta">Código de verificação</h1>
                  <p className="mt-1 text-sm text-tinta-suave">
                    Abra o aplicativo autenticador e digite o código de 6 dígitos.
                  </p>
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="d-codigo">Código</Label>
                <Input
                  id="d-codigo"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={7}
                  value={codigo}
                  onChange={(e) => setCodigo(e.target.value)}
                  placeholder="000 000"
                  className="text-center font-mono text-lg tracking-[0.3em]"
                  autoFocus
                  required
                />
              </div>

              <Button type="submit" carregando={ocupado} className="w-full">
                {passo === 'cadastrar_codigo' ? 'Ativar e entrar' : 'Entrar'}
              </Button>

              <button
                type="button"
                onClick={() => {
                  setPasso('senha');
                  setCodigo('');
                  setErro('');
                  setQr('');
                  setSegredo('');
                }}
                className="w-full text-center text-xs text-tinta-suave underline-offset-4 hover:underline"
              >
                Voltar para a senha
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
