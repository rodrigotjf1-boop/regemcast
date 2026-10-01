'use client';

import { useCallback, useEffect, useState } from 'react';

import { ClientesDa99Regem } from '@/components/app/integracoes/clientes-99-regem';
import { ClientesRegem } from '@/components/app/integracoes/clientes-regem';
import { ComprasRegem } from '@/components/app/integracoes/compras-regem';
import { useSessao } from '@/components/app/sessao';
import { Alerta } from '@/components/ui/alerta';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardCabecalho, CardCorpo } from '@/components/ui/card';
import { Esqueleto } from '@/components/ui/esqueleto';
import { EstadoErro } from '@/components/ui/estado-erro';
import { mensagemDoErro } from '@/lib/api';
import { regem } from '@/lib/servicos';
import type { SituacaoRegem } from '@/lib/tipos';

/** Lendo os clientes, a tela relê depressa; lendo as vendas, sem pressa. */
const RELEITURA_CLIENTES_MS = 3_000;
const RELEITURA_VENDAS_MS = 8_000;
const EMAIL_SUPORTE = 'suporte@dmsregem.com';

/**
 * A empresa no Regem inteira num cartão: os clientes, as compras e a 99.
 *
 * Quem liga a conta ao Regem é a equipe do Regemcast (a loja não copia token
 * nenhum). Tudo roda no servidor — a pessoa pode fechar a tela no meio.
 * Enquanto a leitura completa anda, a tela relê a situação sozinha.
 */
export function IntegracaoRegem() {
  const { sessao } = useSessao();
  const ehDono = sessao.usuario.papel === 'dono';

  const [s, setS] = useState<SituacaoRegem | null>(null);
  const [erroDeLeitura, setErroDeLeitura] = useState('');
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [desligando, setDesligando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      setS(await regem.situacao());
      setErroDeLeitura('');
    } catch (e) {
      setErroDeLeitura(mensagemDoErro(e));
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const lendoClientes = s?.clientes.status === 'carga';
  const lendoVendas = s?.pedidos.status === 'carga';
  useEffect(() => {
    if (!lendoClientes && !lendoVendas) return;
    const t = window.setInterval(
      () => {
        // Uma falha de rede aqui não interrompe nada: a leitura roda no servidor.
        regem.situacao().then(setS, () => undefined);
      },
      lendoClientes ? RELEITURA_CLIENTES_MS : RELEITURA_VENDAS_MS,
    );
    return () => window.clearInterval(t);
  }, [lendoClientes, lendoVendas]);

  /** Faz a ação e mostra a situação que ela devolveu (ou relê). Devolve se deu certo. */
  async function agir(acao: () => Promise<SituacaoRegem | void>): Promise<boolean> {
    setErro('');
    setOcupado(true);
    try {
      const nova = await acao();
      if (nova) setS(nova);
      else await carregar();
      return true;
    } catch (e) {
      setErro(mensagemDoErro(e));
      return false;
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Card>
      <CardCabecalho
        titulo="Regem"
        descricao="Os clientes e as compras da sua empresa no Regem: cardápio próprio, Anota Aí e delivery direto."
        acao={
          s ? (
            s.ligado ? (
              <Badge tom="sucesso" ponto>
                Ligada
              </Badge>
            ) : (
              <Badge>Não ligada</Badge>
            )
          ) : null
        }
      />
      <CardCorpo className="space-y-5">
        {!s ? (
          erroDeLeitura ? (
            <EstadoErro
              titulo="Não consegui ler a ligação com o Regem"
              mensagem={erroDeLeitura}
              aoTentarDeNovo={() => void carregar()}
            />
          ) : (
            <div className="space-y-3" role="status" aria-label="Conferindo a ligação com o Regem">
              <Esqueleto className="h-4 w-56" />
              <Esqueleto className="h-10 w-full max-w-md" />
            </div>
          )
        ) : !s.ligado ? (
          <div className="space-y-3">
            <p className="max-w-prose text-sm leading-relaxed text-tinta-suave">
              Usa o Regem na sua empresa? Os clientes e o histórico de compras de cada um chegam direto, sem planilha —
              e <strong className="text-tinta">quem usa o Regem não paga o Regemcast</strong>. Quem liga é a nossa equipe:
              você não copia nenhum token.
            </p>
            <p className="text-sm text-tinta">
              Peça a ligação em{' '}
              <a
                href={`mailto:${EMAIL_SUPORTE}?subject=${encodeURIComponent('Ligar o Regemcast ao Regem')}`}
                className="font-medium text-acento-forte underline-offset-2 hover:underline"
              >
                {EMAIL_SUPORTE}
              </a>
              .
            </p>
          </div>
        ) : (
          <>
            {erro && <Alerta tom="erro">{erro}</Alerta>}
            <p className="text-sm text-tinta">
              Empresa ligada: <strong>{s.empresaNome}</strong>
              {s.lojas.length > 0 && (
                <span className="text-tinta-suave">
                  {' '}
                  · {s.lojas.length === 1 ? '1 loja' : `${s.lojas.length} lojas`} ({s.lojas.map((l) => l.nome).join(', ')})
                </span>
              )}
            </p>
            <p className="text-sm text-tinta-suave">
              Com a integração ativa, o Regemcast é <strong className="text-tinta">grátis</strong> para a sua empresa, sem
              teto de disparos do plano.
            </p>
            {s.cardapioWebDireto && (
              <Alerta tom="informacao">
                O Cardápio Web também está ligado direto aqui: as vendas dele que chegam pelo Regem ficam de fora, para a
                mesma compra não contar duas vezes.
              </Alerta>
            )}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <ClientesRegem
                situacao={s}
                ehDono={ehDono}
                ocupado={ocupado}
                aoImportar={(consentimento, evidencia) => void agir(() => regem.importar(consentimento, evidencia))}
                aoTentarDeNovo={() => void agir(() => regem.atualizar())}
              />
              <ComprasRegem
                situacao={s}
                ehDono={ehDono}
                ocupado={ocupado}
                aoAtualizar={() => void agir(() => regem.atualizar())}
              />
            </div>
            <ClientesDa99Regem
              situacao={s}
              ehDono={ehDono}
              ocupado={ocupado}
              aoAutorizar={(autorizar) => agir(() => regem.autorizar99(autorizar, autorizar ? true : undefined))}
            />
            {ehDono && (
              <div className="flex flex-col gap-3 border-t border-borda pt-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="max-w-prose text-xs leading-relaxed text-tinta-suave">
                  Desligar para de trazer clientes e compras do Regem, e a gratuidade acaba: sem plano pago, os disparos
                  param em {s.carenciaDias ?? 5} dias. O que já está na sua base fica. Para ligar de novo, fale com o suporte.
                </p>
                {desligando ? (
                  <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
                    <span className="text-xs text-tinta-suave">Desligar mesmo?</span>
                    <Button variante="discreto" tamanho="sm" onClick={() => setDesligando(false)} disabled={ocupado}>
                      Cancelar
                    </Button>
                    <Button
                      variante="perigo"
                      tamanho="sm"
                      carregando={ocupado}
                      onClick={() =>
                        void agir(() => regem.desligar()).then((ok) => {
                          if (ok) setDesligando(false);
                        })
                      }
                    >
                      Desligar do Regem
                    </Button>
                  </div>
                ) : (
                  <Button
                    variante="secundario"
                    tamanho="sm"
                    className="sm:shrink-0"
                    onClick={() => setDesligando(true)}
                    disabled={ocupado}
                  >
                    Desligar do Regem
                  </Button>
                )}
              </div>
            )}
          </>
        )}
      </CardCorpo>
    </Card>
  );
}
