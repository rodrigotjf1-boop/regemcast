'use client';

import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { EstadoErro } from '@/components/ui/estado-erro';
import { Spinner } from '@/components/ui/spinner';
import { mensagemDoErro } from '@/lib/api';
import { whatsapp } from '@/lib/servicos';
import type { ModeloDeMensagem } from '@/lib/tipos';

/**
 * Modelos de mensagem.
 *
 * Os modelos vivem na Meta, não aqui — e esta tela lê de lá a cada visita, em
 * vez de mostrar cópia nossa. O status muda do lado dela sem aviso (aprovação,
 * recusa, pausa por qualidade), e uma cópia desatualizada faria o cliente
 * montar campanha com modelo que a Meta já recusou.
 *
 * Por isso a tela mostra o status com destaque: no WhatsApp oficial, **modelo
 * aprovado é a licença para iniciar conversa**. Sem ele não existe disparo, e
 * quem não entende isso acha que o produto está travado.
 */

/** Tom do crachá por status. Desconhecido fica neutro, e o texto cru aparece. */
function tomDoStatus(status: string): 'sucesso' | 'atencao' | 'erro' | 'neutro' {
  if (status === 'aprovado') return 'sucesso';
  if (status === 'em análise' || status === 'em recurso' || status === 'pausado') return 'atencao';
  if (status === 'recusado' || status === 'desativado' || status === 'sendo excluído') return 'erro';
  return 'neutro';
}

export default function PaginaModelos() {
  const [modelos, setModelos] = useState<ModeloDeMensagem[] | null>(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro('');
    try {
      setModelos(await whatsapp.modelos());
    } catch (e) {
      // Lista vazia por engano é pior que erro visível: o cliente concluiria
      // que não tem modelo nenhum e iria criar um que já existe.
      setErro(mensagemDoErro(e));
      setModelos(null);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight text-tinta">Modelos de mensagem</h1>
        <p className="max-w-prose text-sm leading-relaxed text-tinta-suave">
          No WhatsApp oficial, toda conversa que <strong>você</strong> começa precisa usar um
          modelo aprovado pela Meta. Estes são os seus, lidos direto da Meta agora.
        </p>
      </header>

      {carregando && (
        <div className="flex items-center gap-3 text-sm text-tinta-suave">
          <Spinner /> Carregando…
        </div>
      )}

      {!carregando && erro && (
        <EstadoErro
          titulo="Não consegui carregar seus modelos"
          mensagem={erro}
          aoTentarDeNovo={() => void carregar()}
        />
      )}

      {!carregando && !erro && modelos?.length === 0 && (
        <EmptyState
          titulo="Nenhum modelo ainda"
          descricao={
            <>
              Modelos são criados no WhatsApp Manager da Meta e passam por aprovação, o que
              costuma levar de alguns minutos a algumas horas. Assim que o primeiro for aprovado,
              ele aparece aqui.
            </>
          }
        />
      )}

      {!carregando && !erro && modelos && modelos.length > 0 && (
        <div className="space-y-4">
          {modelos.map((m) => (
            <CartaoModelo key={m.id} modelo={m} />
          ))}
        </div>
      )}
    </div>
  );
}

function CartaoModelo({ modelo }: { modelo: ModeloDeMensagem }) {
  return (
    <Card>
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="numerico break-words text-base font-semibold text-tinta">{modelo.nome}</p>
            <p className="text-xs text-tinta-suave">
              {modelo.categoria} · {modelo.idioma}
            </p>
          </div>
          <Badge tom={tomDoStatus(modelo.status)}>{modelo.status}</Badge>
        </div>

        {/*
          A prévia mostra a mensagem como ela vai chegar, com as partes na ordem
          em que o WhatsApp as exibe. Ler `{{1}}` numa lista de campos não diz
          nada; ler a frase inteira diz na hora se o modelo serve.
        */}
        <div className="space-y-2 rounded-card border border-borda bg-superficie-2 p-3">
          {modelo.cabecalho && (
            <p className="text-sm font-semibold text-tinta">{modelo.cabecalho}</p>
          )}
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-tinta">{modelo.corpo}</p>
          {modelo.rodape && <p className="text-xs text-tinta-suave">{modelo.rodape}</p>}

          {modelo.botoes.length > 0 && (
            <ul className="flex flex-wrap gap-2 pt-1">
              {modelo.botoes.map((b) => (
                <li
                  key={b}
                  className="rounded-lg border border-acento/25 bg-superficie px-2 py-1 text-xs font-medium text-acento-forte"
                >
                  {b}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-tinta-suave">
          <span>
            {modelo.variaveis === 0
              ? 'Sem variáveis'
              : modelo.variaveis === 1
                ? '1 variável a preencher'
                : `${modelo.variaveis} variáveis a preencher`}
          </span>
        </div>

        {modelo.motivo && (
          <p className="rounded-card border border-erro/30 bg-erro/10 p-3 text-sm leading-relaxed text-erro">
            A Meta recusou este modelo. Motivo informado por ela: {modelo.motivo}. Corrija no
            WhatsApp Manager e envie para análise de novo.
          </p>
        )}
      </div>
    </Card>
  );
}
