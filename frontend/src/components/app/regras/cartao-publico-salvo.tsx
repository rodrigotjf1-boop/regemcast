'use client';

import Link from 'next/link';
import { Fragment, useState } from 'react';

import { EditorDeRegras } from '@/components/app/regras/editor-de-regras';
import { Alerta } from '@/components/ui/alerta';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { mensagemDoErro } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatarData, formatarNumero } from '@/lib/formato';
import { paraATela, paraEnviar, regrasCompletas, type RegraNaTela } from '@/lib/regras-do-publico';
import { publicosSalvos } from '@/lib/servicos';
import type { CatalogoDasRegras, PublicoSalvo } from '@/lib/tipos';

type Modo = 'ver' | 'renomear' | 'editar' | 'excluir';

/** Mais que isso o servidor recusa. */
const TAMANHO_DO_NOME = 80;

function usos(s: PublicoSalvo): string {
  const n = s.usos.campanhas;
  if (n === 0) return 'Ainda não usado em campanha.';
  const data = s.usos.ultimaEm ? formatarData(s.usos.ultimaEm) : null;
  if (n === 1) return data ? `Usado em 1 campanha, em ${data}.` : 'Usado em 1 campanha.';
  return data
    ? `Usado em ${formatarNumero(n)} campanhas, a última em ${data}.`
    : `Usado em ${formatarNumero(n)} campanhas.`;
}

/**
 * Um público salvo em Contatos: as regras em frases, quantos podem receber
 * hoje, os usos, e as ações — usar em campanha, editar as regras, renomear,
 * duplicar e excluir (só o dono, com a confirmação no próprio cartão).
 */
export function CartaoPublicoSalvo({
  salvo,
  catalogo,
  erroDoCatalogo,
  ehDono,
  aoMudar,
  aoDuplicar,
  aoExcluir,
}: {
  salvo: PublicoSalvo;
  /** Para editar as regras; nulo enquanto carrega. */
  catalogo: CatalogoDasRegras | null;
  erroDoCatalogo: string;
  ehDono: boolean;
  aoMudar: (novo: PublicoSalvo, aviso: string) => void;
  aoDuplicar: (novo: PublicoSalvo) => void;
  aoExcluir: (id: string, nome: string) => void;
}) {
  const [modo, setModo] = useState<Modo>('ver');
  const [nome, setNome] = useState(salvo.nome);
  const [regras, setRegras] = useState<RegraNaTela[]>([]);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState<'' | 'nome' | 'regras' | 'duplicar' | 'excluir'>('');
  const base = `salvo-${salvo.id}`;

  function abrir(novo: Modo) {
    setErro('');
    if (novo === 'renomear') setNome(salvo.nome);
    if (novo === 'editar') setRegras(paraATela(salvo.regras));
    setModo(novo);
  }

  async function fazer(qual: typeof ocupado, acao: () => Promise<void>) {
    setErro('');
    setOcupado(qual);
    try {
      await acao();
    } catch (e) {
      setErro(mensagemDoErro(e));
    } finally {
      setOcupado('');
    }
  }

  const salvarNome = () =>
    fazer('nome', async () => {
      const limpo = nome.replace(/\s+/g, ' ').trim();
      if (!limpo) throw new Error('Dê um nome ao público.');
      const novo = await publicosSalvos.editar(salvo.id, { nome: limpo });
      setModo('ver');
      aoMudar(novo, `Nome salvo: "${novo.nome}".`);
    });

  const salvarRegras = () =>
    fazer('regras', async () => {
      const novo = await publicosSalvos.editar(salvo.id, { regras: paraEnviar(regras) });
      setModo('ver');
      aoMudar(novo, `Regras de "${novo.nome}" salvas.`);
    });

  const duplicar = () =>
    fazer('duplicar', async () => {
      aoDuplicar(await publicosSalvos.duplicar(salvo.id));
    });

  const excluir = () =>
    fazer('excluir', async () => {
      await publicosSalvos.excluir(salvo.id);
      aoExcluir(salvo.id, salvo.nome);
    });

  return (
    <li
      className={cn(
        'space-y-3 rounded-card border border-borda bg-superficie p-4 shadow-card',
        modo === 'editar' && 'xl:col-span-2',
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="min-w-0 break-words text-sm font-semibold text-tinta">{salvo.nome}</h3>
        <p className="text-sm text-tinta">
          {salvo.total === null ? (
            <span className="text-tinta-suave">Sem contagem hoje</span>
          ) : (
            <>
              <strong className="numerico">{formatarNumero(salvo.total)}</strong>{' '}
              {salvo.total === 1 ? 'pode receber hoje' : 'podem receber hoje'}
            </>
          )}
        </p>
      </div>

      <ul aria-label="Regras" className="flex flex-wrap items-center gap-1.5 text-xs">
        {salvo.resumo.map((frase, i) => (
          <Fragment key={`${i}-${frase}`}>
            {i > 0 && (
              <li aria-hidden="true" className="font-bold uppercase tracking-wider text-tinta-suave">
                e
              </li>
            )}
            <li className="rounded-full bg-superficie-2 px-2.5 py-1 text-tinta">{frase}</li>
          </Fragment>
        ))}
      </ul>

      <p className="text-xs text-tinta-suave">{usos(salvo)}</p>

      {salvo.problema && <Alerta tom="atencao">{salvo.problema}</Alerta>}

      {modo === 'ver' && (
        <div className="flex flex-wrap gap-2">
          {!salvo.problema && (
            <Link
              href={`/campanhas?nova=1&publicoSalvo=${encodeURIComponent(salvo.id)}`}
              className="inline-flex h-8 items-center rounded-xl border border-tinta/40 bg-superficie px-3 text-xs font-semibold text-tinta transition-colors hover:bg-superficie-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento"
            >
              Usar em campanha
            </Link>
          )}
          <Button variante="secundario" tamanho="sm" onClick={() => abrir('editar')}>
            Editar regras
          </Button>
          <Button variante="secundario" tamanho="sm" onClick={() => abrir('renomear')}>
            Renomear
          </Button>
          <Button variante="secundario" tamanho="sm" onClick={() => void duplicar()} carregando={ocupado === 'duplicar'}>
            Duplicar
          </Button>
          {ehDono && (
            <Button variante="perigo" tamanho="sm" onClick={() => abrir('excluir')}>
              Excluir
            </Button>
          )}
        </div>
      )}

      {modo === 'renomear' && (
        <div className="space-y-2">
          <div className="max-w-md space-y-1">
            <Label htmlFor={`${base}-nome`}>Novo nome</Label>
            <Input
              id={`${base}-nome`}
              value={nome}
              maxLength={TAMANHO_DO_NOME}
              autoFocus
              onChange={(e) => setNome(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void salvarNome();
                }
              }}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button tamanho="sm" onClick={() => void salvarNome()} carregando={ocupado === 'nome'}>
              Salvar nome
            </Button>
            <Button variante="discreto" tamanho="sm" onClick={() => setModo('ver')} disabled={ocupado === 'nome'}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {modo === 'editar' &&
        (catalogo ? (
          <div className="space-y-2">
            <EditorDeRegras catalogo={catalogo} regras={regras} aoMudar={setRegras} prefixo={base} />
            {!regrasCompletas(regras) && (
              <p className="text-xs text-tinta-suave">Preencha o valor de cada regra para salvar.</p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                tamanho="sm"
                onClick={() => void salvarRegras()}
                carregando={ocupado === 'regras'}
                disabled={!regrasCompletas(regras)}
              >
                Salvar alterações
              </Button>
              <Button variante="discreto" tamanho="sm" onClick={() => setModo('ver')} disabled={ocupado === 'regras'}>
                Cancelar
              </Button>
            </div>
          </div>
        ) : erroDoCatalogo ? (
          <Alerta tom="erro">Não consegui carregar os campos das regras: {erroDoCatalogo}</Alerta>
        ) : (
          <p className="text-sm text-tinta-suave">Carregando as regras…</p>
        ))}

      {modo === 'excluir' && (
        <div role="group" aria-labelledby={`${base}-excluir`} className="space-y-2 rounded-xl border border-erro/40 p-3">
          <p id={`${base}-excluir`} className="text-sm font-semibold text-tinta">
            Excluir o público &quot;{salvo.nome}&quot;?
          </p>
          <p className="text-xs leading-relaxed text-tinta-suave">
            Só as regras saem. As campanhas que já usaram este público continuam com as pessoas que receberam.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variante="perigo" tamanho="sm" onClick={() => void excluir()} carregando={ocupado === 'excluir'}>
              Excluir público
            </Button>
            <Button variante="discreto" tamanho="sm" onClick={() => setModo('ver')} disabled={ocupado === 'excluir'}>
              Manter
            </Button>
          </div>
        </div>
      )}

      {erro && <Alerta tom="erro">{erro}</Alerta>}
    </li>
  );
}
