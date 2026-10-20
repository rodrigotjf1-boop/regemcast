'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';

import { IconeAlerta, IconeCadeado, IconeEscudo, IconeIntegracao, IconePessoa, IconeSeta, IconeTroca } from '@/components/app/icones';
import { Logotipo } from '@/components/marca/logotipo';
import { Alerta } from '@/components/ui/alerta';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { TelaDaAutorizacao } from '@/lib/tipos';
import { ItemPermissao } from './item-permissao';
import { SeloDoAplicativo } from './selo-do-aplicativo';

export interface DecisaoDaTela {
  senha: string;
  opcionais: string[];
  confirmoOutraEmpresa: boolean;
}

/** O que o envio respondeu, quando não foi para a volta: o erro vai para o campo certo. */
export type ErroDoEnvio = { campo: 'senha' | 'geral'; mensagem: string } | null;

const dataCurta = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

function Secao({ numero, titulo, id, children }: { numero: number; titulo: string; id: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="grid gap-2.5">
      <h2 id={id} className="flex items-center gap-2 text-[15px] font-semibold text-tinta">
        <span aria-hidden="true" className="grid h-[21px] w-[21px] shrink-0 place-items-center rounded-full bg-tinta text-[11px] font-semibold text-superficie">
          {numero}
        </span>
        {titulo}
      </h2>
      {children}
    </section>
  );
}

const lista = 'overflow-hidden rounded-xl border border-borda';

/**
 * A decisão do dono, no desenho aprovado em 20/10/2026 (protótipo do Hub DMS):
 * quem pede, o que o aplicativo vai ver, o que ele não pode, a confirmação de
 * outra empresa, a senha e os botões (presos ao rodapé no celular). Tudo o que
 * está escrito vem do servidor (`tela`): é o mesmo texto que fica guardado.
 */
export function FormularioAutorizacao({
  tela,
  enviando,
  erro,
  onAutorizar,
  onCancelar,
}: {
  tela: TelaDaAutorizacao;
  enviando: boolean;
  erro: ErroDoEnvio;
  onAutorizar: (d: DecisaoDaTela) => void;
  onCancelar: () => void;
}) {
  const app = tela.aplicativo.nome;
  const jaLigada = tela.jaLigada;
  const pedeMais = Boolean(jaLigada?.novas.length);
  // Já ligada: as opcionais que a ligação já tem continuam ligadas; "Liberar" liga as novas. Primeira vez: nascem desligadas.
  const [ligadas, setLigadas] = useState<string[]>(() =>
    jaLigada ? tela.opcionais.map((o) => o.id).filter((id) => jaLigada.escopos.some((e) => e.id === id) || jaLigada.novas.includes(id)) : [],
  );
  const [confirmo, setConfirmo] = useState(false);
  const [faltaConfirmar, setFaltaConfirmar] = useState(false);
  const [senha, setSenha] = useState('');
  const [faltaSenha, setFaltaSenha] = useState(false);
  const campoSenha = useRef<HTMLInputElement>(null);
  const caixaConfirmacao = useRef<HTMLInputElement>(null);
  const titulo = useRef<HTMLHeadingElement>(null);

  // O título recebe o foco ao abrir: o leitor de tela anuncia o que está sendo pedido.
  useEffect(() => titulo.current?.focus({ preventScroll: true }), []);

  const alternar = (id: string) => setLigadas((atual) => (atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id]));
  const outra = tela.contaQuePede.outraEmpresa;
  const erroSenha = faltaSenha ? 'Digite a sua senha do Regemcast para autorizar.' : erro?.campo === 'senha' ? erro.mensagem : null;

  function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (enviando) return;
    if (outra && !confirmo) {
      setFaltaConfirmar(true);
      caixaConfirmacao.current?.focus();
      return;
    }
    if (!senha) {
      setFaltaSenha(true);
      campoSenha.current?.focus();
      return;
    }
    onAutorizar({ senha, opcionais: ligadas, confirmoOutraEmpresa: outra ? confirmo : false });
  }

  const novas = jaLigada ? [...tela.necessarias, ...tela.opcionais].filter((p) => jaLigada.novas.includes(p.id)) : [];
  const temDadoPessoal = tela.opcionais.some((o) => o.dadoPessoal);

  return (
    <form
      onSubmit={enviar}
      noValidate
      aria-labelledby="titulo-autorizacao"
      className="grid w-full max-w-[640px] gap-6 rounded-t-2xl border border-borda bg-superficie p-4 pb-0 shadow-sm sm:rounded-2xl sm:p-7"
    >
      <header className="grid gap-2.5">
        <div className="flex items-center gap-2.5 text-tinta-suave" aria-hidden="true">
          <SeloDoAplicativo letra={tela.aplicativo.selo} />
          <IconeTroca className="h-[18px] w-[18px]" />
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-lateral">
            <Logotipo mostrarNome={false} sobreEscuro />
          </span>
        </div>
        <h1 ref={titulo} id="titulo-autorizacao" tabIndex={-1} className="text-balance text-xl font-bold leading-tight text-tinta focus:outline-none sm:text-[21px]">
          {tela.titulo}
        </h1>
        <p className="text-sm leading-relaxed text-tinta-suave">{tela.abertura}</p>
      </header>

      <Secao numero={1} titulo="Quem pede" id="secao-quem">
        <ul className={lista}>
          <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 px-4 py-3">
            <SeloDoAplicativo letra={tela.aplicativo.selo} pequeno />
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-semibold text-tinta">{app}</span>
              <span className="inline-flex items-center gap-1 rounded-full bg-sucesso/10 px-2 py-0.5 text-[11px] font-semibold text-sucesso">Produto da DMS</span>
            </div>
            <p className="col-start-2 text-[13px] text-tinta-suave">
              Aplicativo de {tela.aplicativo.empresa} · CNPJ {tela.aplicativo.cnpj}
            </p>
            <details className="group col-start-2 text-xs">
              <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded font-semibold text-acento-forte [&::-webkit-details-marker]:hidden">
                <IconeSeta className="h-3 w-3 transition-transform group-open:rotate-180 motion-reduce:transition-none" />
                Detalhes
              </summary>
              <p className="pt-1 text-tinta-suave">{tela.aplicativo.detalhes}</p>
            </details>
          </li>
          <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 border-t border-borda px-4 py-3">
            <IconePessoa className="mt-0.5 h-[18px] w-[18px] text-tinta-suave" />
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-semibold text-tinta">{outra ? `${tela.contaQuePede.nome}, no ${app}` : `A conta ${tela.contaQuePede.nome} no ${app}`}</span>
              {outra ? (
                <span className="rounded-full bg-atencao/10 px-2 py-0.5 text-[11px] font-semibold text-atencao">Outra empresa</span>
              ) : (
                <span className="rounded-full bg-sucesso/10 px-2 py-0.5 text-[11px] font-semibold text-sucesso">A mesma empresa desta conta</span>
              )}
            </div>
            <p className="col-start-2 break-words text-[13px] text-tinta-suave">
              {tela.contaQuePede.cnpj ? `CNPJ ${tela.contaQuePede.cnpj}` : 'Sem CNPJ'} · {tela.contaQuePede.email}
              {tela.contaQuePede.marca ? ` · para a marca ${tela.contaQuePede.marca}` : ''}
            </p>
          </li>
          <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 border-t border-borda px-4 py-3">
            <IconeIntegracao className="mt-0.5 h-[18px] w-[18px] text-tinta-suave" />
            <span className="font-semibold text-tinta">A sua conta {tela.conta.nome} no Regemcast</span>
            <p className="col-start-2 text-[13px] text-tinta-suave">
              {tela.conta.cnpj ? `CNPJ ${tela.conta.cnpj} · ` : ''}é a conta que o {app} vai ler
            </p>
          </li>
        </ul>
      </Secao>

      {pedeMais && jaLigada ? (
        <Secao numero={2} titulo="O que muda" id="secao-muda">
          <ul className={lista}>
            {novas.map((p) => (
              <ItemPermissao key={p.id} permissao={p} nomeDoAplicativo={app} icone="nova" novo />
            ))}
          </ul>
          <details className="group grid gap-2 text-[13px]">
            <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded font-semibold text-acento-forte [&::-webkit-details-marker]:hidden">
              <IconeSeta className="h-3 w-3 transition-transform group-open:rotate-180 motion-reduce:transition-none" />
              Já liberado desde {dataCurta(jaLigada.desde)} ({jaLigada.escopos.length})
            </summary>
            <ul className={`${lista} mt-2`}>
              {jaLigada.escopos.map((e) => (
                <li key={e.id} className="border-t border-borda px-4 py-2 first:border-t-0 text-tinta">
                  {e.rotulo}
                </li>
              ))}
            </ul>
          </details>
        </Secao>
      ) : (
        <Secao numero={2} titulo={`O que o ${app} vai ver`} id="secao-ve">
          <h3 className="text-[11.5px] font-semibold uppercase tracking-wider text-tinta-suave">Necessárias</h3>
          <p className="-mt-1 text-xs text-tinta-suave">Sem estas, o {app} não funciona. Para não liberar, cancele.</p>
          <ul className={lista}>
            {tela.necessarias.map((p) => (
              <ItemPermissao key={p.id} permissao={p} nomeDoAplicativo={app} />
            ))}
          </ul>
          {tela.opcionais.length ? (
            <>
              <h3 className="mt-1 text-[11.5px] font-semibold uppercase tracking-wider text-tinta-suave">
                {temDadoPessoal ? 'Dados dos seus clientes · você decide' : 'Opcional · você decide'}
              </h3>
              <ul className={lista}>
                {tela.opcionais.map((p) => (
                  <ItemPermissao key={p.id} permissao={p} nomeDoAplicativo={app} chave={{ ligada: ligadas.includes(p.id), alternar: () => alternar(p.id) }} />
                ))}
              </ul>
            </>
          ) : null}
        </Secao>
      )}

      <Secao numero={3} titulo={`O que o ${app} não pode`} id="secao-nao">
        <ul className={lista}>
          {tela.naoPode.map((n) => (
            <li key={n.rotulo} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 border-t border-borda px-4 py-3 first:border-t-0">
              <IconeCadeado className="mt-0.5 h-[18px] w-[18px] text-tinta-suave" />
              <span className="font-semibold text-tinta">{n.rotulo}</span>
              <p className="col-start-2 text-[13px] text-tinta-suave">{n.frase}</p>
            </li>
          ))}
        </ul>
      </Secao>

      <p className="flex gap-2.5 rounded-xl border border-borda bg-superficie-2 px-4 py-3 text-[13px] leading-relaxed text-tinta-suave">
        <IconeEscudo className="mt-0.5 h-[18px] w-[18px] shrink-0" />
        <span>{tela.nota}</span>
      </p>

      {outra ? (
        <div className="flex gap-2.5 rounded-xl border border-atencao/40 bg-atencao/10 px-4 py-3.5 text-sm">
          <IconeAlerta className="mt-0.5 h-[18px] w-[18px] shrink-0 text-atencao" />
          <div className="grid min-w-0 gap-2">
            <p className="font-semibold text-atencao">A conta que pede é de outra empresa</p>
            <p className="text-tinta">
              A {tela.contaQuePede.nome} ({tela.contaQuePede.cnpj ? `CNPJ ${tela.contaQuePede.cnpj}` : 'sem CNPJ'}) vai ver, pelo {app}, os dados da {tela.conta.nome}{' '}
              listados aqui. Continue só se você contratou essa empresa.
            </p>
            <label className="flex cursor-pointer items-start gap-2.5 font-semibold text-tinta">
              <input
                ref={caixaConfirmacao}
                type="checkbox"
                checked={confirmo}
                onChange={(e) => {
                  setConfirmo(e.target.checked);
                  setFaltaConfirmar(false);
                }}
                aria-invalid={faltaConfirmar || undefined}
                aria-describedby={faltaConfirmar ? 'erro-confirmacao' : undefined}
                className="mt-0.5 h-[18px] w-[18px] shrink-0 accent-[rgb(var(--cor-tinta))]"
              />
              Contratei a {tela.contaQuePede.nome} e quero ligar a conta dela à minha
            </label>
            {faltaConfirmar ? (
              <p id="erro-confirmacao" role="alert" className="text-[13px] font-semibold text-erro">
                Marque a confirmação para ligar a conta de outra empresa.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      <Secao numero={4} titulo="Confirme com a sua senha" id="secao-senha">
        <div className="grid max-w-sm gap-1.5">
          <Label htmlFor="senha-autorizacao">Senha do Regemcast</Label>
          <Input
            ref={campoSenha}
            id="senha-autorizacao"
            type="password"
            autoComplete="current-password"
            value={senha}
            invalido={Boolean(erroSenha)}
            aria-describedby={erroSenha ? 'erro-senha' : 'ajuda-senha'}
            onChange={(e) => {
              setSenha(e.target.value);
              setFaltaSenha(false);
            }}
          />
          {erroSenha ? (
            <p id="erro-senha" role="alert" className="text-[13px] font-semibold text-erro">
              {erroSenha}
            </p>
          ) : null}
          <p id="ajuda-senha" className="text-xs text-tinta-suave">
            A mesma senha de entrar no Regemcast. O {app} não recebe a senha.
          </p>
        </div>
      </Secao>

      {erro?.campo === 'geral' ? <Alerta>{erro.mensagem}</Alerta> : null}

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap justify-end gap-2.5 border-t border-borda bg-superficie px-4 py-3 sm:static sm:mx-0 sm:border-0 sm:p-0 [&>*]:flex-1 sm:[&>*]:flex-none">
        <Button type="button" variante="secundario" onClick={onCancelar} disabled={enviando}>
          {pedeMais ? 'Agora não' : 'Cancelar'}
        </Button>
        <Button type="submit" carregando={enviando}>
          {pedeMais ? (novas.length === 1 ? 'Liberar a permissão nova' : 'Liberar as permissões novas') : `Autorizar o ${app}`}
        </Button>
      </div>

      <p className="pb-5 text-xs text-tinta-suave sm:pb-0">{tela.rodape}</p>
    </form>
  );
}
