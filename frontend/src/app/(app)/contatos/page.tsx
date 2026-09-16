'use client';

import { useCallback, useEffect, useState } from 'react';

import { ImportarContatos } from '@/components/app/importar-contatos';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { EstadoErro } from '@/components/ui/estado-erro';
import { Spinner } from '@/components/ui/spinner';
import { mensagemDoErro } from '@/lib/api';
import { contatos as servico } from '@/lib/servicos';
import type { ListaDeContatos, PaginaDeContatos } from '@/lib/tipos';

/**
 * A base de contatos.
 *
 * Duas coisas aparecem aqui que costumam ficar escondidas em produto de
 * disparo: **de onde veio o consentimento de cada pessoa** e **quem pediu para
 * sair**. As duas ficam na mesma tabela, à vista, porque são a resposta que o
 * cliente precisa ter na mão quando a Meta pergunta — e porque descadastro que
 * ninguém vê é descadastro que volta a receber.
 */

const POR_PAGINA = 50;

/** Como o consentimento foi obtido, em uma palavra que o cliente entenda. */
const ORIGEM_CONSENTIMENTO: Record<string, string> = {
  declarado: 'Declarado na importação',
  formulario: 'Formulário',
  conversa: 'Conversa iniciada pela pessoa',
  api: 'Sistema do cliente',
};

export default function PaginaContatos() {
  const [pagina, setPagina] = useState<PaginaDeContatos | null>(null);
  const [listas, setListas] = useState<ListaDeContatos[]>([]);
  const [numero, setNumero] = useState(1);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [importando, setImportando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro('');
    try {
      const [p, l] = await Promise.all([servico.listar(numero, POR_PAGINA), servico.listas()]);
      setPagina(p);
      setListas(l);
    } catch (e) {
      setErro(mensagemDoErro(e));
      setPagina(null);
    } finally {
      setCarregando(false);
    }
  }, [numero]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function descadastrar(id: string) {
    try {
      await servico.descadastrar(id);
      await carregar();
    } catch (e) {
      setErro(mensagemDoErro(e));
    }
  }

  const total = pagina?.total ?? 0;
  const ultimaPagina = Math.max(1, Math.ceil(total / POR_PAGINA));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight text-tinta">Contatos</h1>
          <p className="max-w-prose text-sm leading-relaxed text-tinta-suave">
            Quem pode receber suas campanhas — com o registro de como cada pessoa autorizou.
          </p>
        </div>
        <Button
          variante={importando ? 'secundario' : 'primario'}
          onClick={() => setImportando((v) => !v)}
          aria-expanded={importando}
        >
          {importando ? 'Cancelar' : 'Importar contatos'}
        </Button>
      </header>

      {importando && (
        <ImportarContatos
          aoConcluir={() => {
            setNumero(1);
            void carregar();
          }}
        />
      )}

      {listas.length > 0 && (
        <Card>
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-tinta">Listas</h2>
            <div className="flex flex-wrap gap-2">
              {listas.map((l) => (
                <Badge key={l.id} tom="acento">
                  {l.nome} · {l.total}
                </Badge>
              ))}
            </div>
            <p className="text-xs text-tinta-suave">
              A contagem exclui quem pediu para sair.
            </p>
          </div>
        </Card>
      )}

      {carregando && (
        <div className="flex items-center gap-3 text-sm text-tinta-suave">
          <Spinner /> Carregando…
        </div>
      )}

      {!carregando && erro && (
        <EstadoErro
          titulo="Não consegui carregar seus contatos"
          mensagem={erro}
          aoTentarDeNovo={() => void carregar()}
        />
      )}

      {!carregando && !erro && total === 0 && !importando && (
        <EmptyState
          titulo="Nenhum contato ainda"
          descricao="Importe a agenda do seu celular, uma planilha ou cole uma lista de números."
          acao={<Button onClick={() => setImportando(true)}>Importar contatos</Button>}
        />
      )}

      {!carregando && !erro && total > 0 && (
        <Card>
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-tinta">
                {total === 1 ? '1 contato' : `${total} contatos`}
              </h2>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] text-left text-sm">
                <caption className="sr-only">
                  Contatos da sua base, com a origem do consentimento
                </caption>
                <thead>
                  <tr className="border-b border-borda text-xs uppercase tracking-wide text-tinta-suave">
                    <th scope="col" className="py-2 pr-3 font-medium">Nome</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Telefone</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Autorização</th>
                    <th scope="col" className="py-2 font-medium">
                      <span className="sr-only">Ações</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pagina?.itens.map((c) => (
                    <tr key={c.id} className="border-b border-borda/60 align-top">
                      <td className="py-2 pr-3 text-tinta">{c.nome || '—'}</td>
                      <td className="numerico py-2 pr-3 text-tinta">{c.telefone}</td>
                      <td className="py-2 pr-3 text-tinta-suave">
                        {c.optOut ? (
                          <Badge tom="erro">Pediu para sair</Badge>
                        ) : (
                          (c.consentimentoOrigem
                            ? ORIGEM_CONSENTIMENTO[c.consentimentoOrigem]
                            : null) ?? '—'
                        )}
                      </td>
                      <td className="py-2 text-right">
                        {!c.optOut && (
                          <button
                            type="button"
                            onClick={() => void descadastrar(c.id)}
                            className="text-xs text-tinta-suave underline-offset-4 hover:text-erro hover:underline"
                          >
                            Descadastrar
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {ultimaPagina > 1 && (
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <span className="text-xs text-tinta-suave">
                  Página <span className="numerico">{pagina?.pagina ?? 1}</span> de{' '}
                  <span className="numerico">{ultimaPagina}</span>
                </span>
                <div className="flex gap-2">
                  <Button
                    variante="secundario"
                    onClick={() => setNumero((n) => Math.max(1, n - 1))}
                    disabled={(pagina?.pagina ?? 1) <= 1}
                  >
                    Anterior
                  </Button>
                  <Button
                    variante="secundario"
                    onClick={() => setNumero((n) => Math.min(ultimaPagina, n + 1))}
                    disabled={(pagina?.pagina ?? 1) >= ultimaPagina}
                  >
                    Próxima
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
