'use client';

import { useCallback, useEffect, useState } from 'react';

import { useSessao } from '@/components/app/sessao';
import { Alerta } from '@/components/ui/alerta';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardCabecalho, CardCorpo } from '@/components/ui/card';
import { mensagemDoErro } from '@/lib/api';
import { formatarDataHora } from '@/lib/formato';
import { aplicativos } from '@/lib/servicos';
import type { AplicativoConectado } from '@/lib/tipos';

/**
 * Aplicativos conectados: os produtos que têm acesso a esta conta pela
 * integração, e o que cada um pode fazer.
 *
 * A decisão de expor a conta é de quem é dono dela: qualquer pessoa da conta
 * vê a lista, e o dono desliga — o acesso para de valer na hora. Sem nenhum
 * aplicativo, o cartão nem aparece.
 */
export function AplicativosConectados() {
  const { sessao } = useSessao();
  const ehDono = sessao.usuario.papel === 'dono';

  const [lista, setLista] = useState<AplicativoConectado[] | null>(null);
  const [erro, setErro] = useState('');
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [desligando, setDesligando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      setLista(await aplicativos.listar());
    } catch {
      // Sem a lista, o cartão não aparece; o resto da página não depende dele.
      setLista([]);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function desligar(id: string) {
    setErro('');
    setDesligando(true);
    try {
      setLista(await aplicativos.revogar(id));
      setConfirmando(null);
    } catch (falha) {
      setErro(mensagemDoErro(falha));
    } finally {
      setDesligando(false);
    }
  }

  if (!lista?.length) return null;

  return (
    <Card>
      <CardCabecalho
        titulo="Aplicativos conectados"
        descricao="Produtos que têm acesso a esta conta pela integração, e o que cada um pode fazer. Desligar corta o acesso na hora."
      />
      <CardCorpo className="space-y-4">
        {erro && <Alerta tom="erro">{erro}</Alerta>}
        <ul className="divide-y divide-borda">
          {lista.map((a) => (
            <li key={a.id} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-tinta">{a.nome}</span>
                  <Badge tom={a.revogadoEm ? 'neutro' : 'sucesso'}>{a.revogadoEm ? 'Desligado' : 'Ativo'}</Badge>
                  <span className="text-xs text-tinta-suave">{a.classe === 'dms' ? 'Produto da DMS' : 'Aplicativo de fora'}</span>
                </div>
                <ul className="space-y-1 text-sm">
                  {a.escopos.map((e) => (
                    <li key={e.id} className="leading-relaxed text-tinta-suave">
                      <span className="text-tinta">{e.rotulo}.</span> {e.descricao}
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-tinta-suave">
                  {a.revogadoEm
                    ? `Desligado em ${formatarDataHora(a.revogadoEm)}${a.revogadoPor ? ` por ${a.revogadoPor}` : ''}.`
                    : a.ultimoUsoEm
                      ? `Usado pela última vez em ${formatarDataHora(a.ultimoUsoEm)}.`
                      : 'Ainda não foi usado.'}{' '}
                  Conectado em {formatarDataHora(a.criadoEm)}.
                </p>
              </div>
              {!a.revogadoEm && ehDono && (
                <div className="shrink-0">
                  {confirmando === a.id ? (
                    <span className="flex flex-wrap gap-2">
                      <Button tamanho="sm" variante="perigo" carregando={desligando} onClick={() => void desligar(a.id)}>
                        Confirmar
                      </Button>
                      <Button tamanho="sm" variante="discreto" disabled={desligando} onClick={() => setConfirmando(null)}>
                        Cancelar
                      </Button>
                    </span>
                  ) : (
                    <Button tamanho="sm" variante="secundario" onClick={() => setConfirmando(a.id)}>
                      Desligar
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
        {!ehDono && <p className="text-xs text-tinta-suave">Só o dono da conta desliga um aplicativo.</p>}
      </CardCorpo>
    </Card>
  );
}
