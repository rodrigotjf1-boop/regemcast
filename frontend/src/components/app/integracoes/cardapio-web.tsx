'use client';

import { useCallback, useEffect, useState } from 'react';

import { ClientesCardapioWeb } from '@/components/app/integracoes/clientes-cardapio-web';
import { ComprasCardapioWeb } from '@/components/app/integracoes/compras-cardapio-web';
import { ConectarCardapioWeb } from '@/components/app/integracoes/conectar-cardapio-web';
import { useSessao } from '@/components/app/sessao';
import { Alerta } from '@/components/ui/alerta';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardCabecalho, CardCorpo } from '@/components/ui/card';
import { Esqueleto } from '@/components/ui/esqueleto';
import { EstadoErro } from '@/components/ui/estado-erro';
import { mensagemDoErro } from '@/lib/api';
import { cardapioWeb } from '@/lib/servicos';
import type { SituacaoCardapioWeb } from '@/lib/tipos';

/** Importando clientes, a tela relê depressa. Buscando pedidos, sem pressa: é uma página a cada 15 s. */
const RELEITURA_CLIENTES_MS = 2_000;
const RELEITURA_PEDIDOS_MS = 8_000;

/**
 * A loja do Cardápio Web inteira num cartão: conectar, os clientes e as
 * compras (o histórico de pedidos de cada cliente).
 *
 * Tudo roda no servidor — a pessoa pode fechar a tela no meio. Enquanto algo
 * está andando, a tela relê a situação sozinha.
 */
export function IntegracaoCardapioWeb() {
  const { sessao } = useSessao();
  const ehDono = sessao.usuario.papel === 'dono';

  const [s, setS] = useState<SituacaoCardapioWeb | null>(null);
  const [erroDeLeitura, setErroDeLeitura] = useState('');
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [trocandoToken, setTrocandoToken] = useState(false);

  const carregar = useCallback(async () => {
    try {
      setS(await cardapioWeb.situacao());
      setErroDeLeitura('');
    } catch (e) {
      setErroDeLeitura(mensagemDoErro(e));
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const importando = s?.sincronizacao.status === 'rodando';
  const buscandoPedidos = s?.pedidos.status === 'carga';
  useEffect(() => {
    if (!importando && !buscandoPedidos) return;
    const t = window.setInterval(
      () => {
        // Uma falha de rede aqui não interrompe nada: o trabalho roda no servidor.
        cardapioWeb.situacao().then(setS, () => undefined);
      },
      importando ? RELEITURA_CLIENTES_MS : RELEITURA_PEDIDOS_MS,
    );
    return () => window.clearInterval(t);
  }, [importando, buscandoPedidos]);

  /** Faz a ação e relê a situação. Devolve se deu certo. */
  async function agir(acao: () => Promise<unknown>): Promise<boolean> {
    setErro('');
    setOcupado(true);
    try {
      await acao();
      await carregar();
      return true;
    } catch (e) {
      setErro(mensagemDoErro(e));
      return false;
    } finally {
      setOcupado(false);
    }
  }

  async function conectar(chave: string) {
    if (await agir(() => cardapioWeb.conectarChave(chave))) setTrocandoToken(false);
  }

  function abrirTroca() {
    setErro('');
    setTrocandoToken(true);
  }

  return (
    <Card>
      <CardCabecalho
        titulo="Cardápio Web"
        descricao="A base de clientes da sua loja e o histórico de compras de cada um."
        acao={
          s ? (
            s.conectado ? (
              <Badge tom="sucesso" ponto>
                Conectada
              </Badge>
            ) : (
              <Badge>Não conectada</Badge>
            )
          ) : null
        }
      />
      <CardCorpo className="space-y-5">
        {!s ? (
          erroDeLeitura ? (
            <EstadoErro
              titulo="Não consegui ler a conexão com o Cardápio Web"
              mensagem={erroDeLeitura}
              aoTentarDeNovo={() => void carregar()}
            />
          ) : (
            <div className="space-y-3" role="status" aria-label="Conferindo a conexão com o Cardápio Web">
              <Esqueleto className="h-4 w-56" />
              <Esqueleto className="h-10 w-full max-w-md" />
            </div>
          )
        ) : !s.conectado ? (
          <ConectarCardapioWeb
            ehDono={ehDono}
            ocupado={ocupado}
            erro={erro}
            aoConectar={(chave) => void conectar(chave)}
          />
        ) : trocandoToken ? (
          <ConectarCardapioWeb
            ehDono={ehDono}
            ocupado={ocupado}
            erro={erro}
            aoConectar={(chave) => void conectar(chave)}
            aoCancelar={() => {
              setErro('');
              setTrocandoToken(false);
            }}
            lojaNome={s.lojaNome}
          />
        ) : (
          <>
            {erro && <Alerta tom="erro">{erro}</Alerta>}
            <p className="text-sm text-tinta">
              Loja conectada: <strong>{s.lojaNome}</strong>
            </p>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <ClientesCardapioWeb
                situacao={s}
                ehDono={ehDono}
                ocupado={ocupado}
                aoImportar={(consentimento, evidencia) =>
                  void agir(() => cardapioWeb.importar(consentimento, evidencia))
                }
              />
              <ComprasCardapioWeb
                situacao={s}
                ehDono={ehDono}
                ocupado={ocupado}
                aoBuscar={() => void agir(() => cardapioWeb.buscarPedidos())}
                aoTrocarToken={abrirTroca}
              />
            </div>
            {ehDono && (
              <div className="flex flex-col gap-3 border-t border-borda pt-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="max-w-prose text-xs leading-relaxed text-tinta-suave">
                  O Cardápio Web recusou o token? Troque por um novo: o que já veio continua, e a busca retoma de
                  onde parou. Desconectar para de trazer clientes e compras; o que já está na sua base fica.
                </p>
                <div className="flex flex-wrap gap-2 sm:shrink-0">
                  <Button variante="secundario" tamanho="sm" onClick={abrirTroca} disabled={ocupado}>
                    Trocar token
                  </Button>
                  <Button
                    variante="secundario"
                    tamanho="sm"
                    onClick={() => void agir(() => cardapioWeb.desconectar())}
                    disabled={ocupado}
                  >
                    Desconectar loja
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardCorpo>
    </Card>
  );
}
