'use client';

import { useCallback, useEffect, useState } from 'react';

import { Alerta } from '@/components/ui/alerta';
import { Button } from '@/components/ui/button';
import { mensagemDoErro } from '@/lib/api';
import { formatarData, formatarNumero, formatarTelefone } from '@/lib/formato';
import { contatos as servico } from '@/lib/servicos';
import type { PaginaDeContatos } from '@/lib/tipos';

/**
 * Números que a Meta recusou (131026) em duas campanhas diferentes: não têm
 * WhatsApp, não aceitaram os termos do aplicativo ou usam uma versão antiga.
 * Saíram sozinhos dos envios e dos públicos.
 *
 * Não é pedido de saída — é número que não recebe. Por isso "tentar de novo"
 * não pede justificativa: a pessoa atualizou o app ou trocou de aparelho, e
 * só as recusas daqui em diante contam para marcar de novo.
 */
export function NumerosSemWhatsapp() {
  const [pagina, setPagina] = useState<PaginaDeContatos | null>(null);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [ocupado, setOcupado] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      setPagina(await servico.semWhatsapp(1, 100));
    } catch {
      // Esta seção é complementar: se falhar, a tela de bloqueios segue inteira.
      setPagina(null);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function tentarDeNovo(id: string) {
    setErro('');
    setAviso('');
    setOcupado(id);
    try {
      await servico.tentarWhatsappDeNovo(id);
      setAviso('Número de volta aos envios. Se a Meta recusar de novo em duas campanhas, ele volta para esta lista.');
      await carregar();
    } catch (e) {
      setErro(mensagemDoErro(e));
    } finally {
      setOcupado(null);
    }
  }

  if (!pagina || pagina.total === 0) return null;

  return (
    <section aria-labelledby="sem-whatsapp" className="anima-entrada space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="sem-whatsapp" className="text-base font-semibold text-tinta">
          Sem WhatsApp{' '}
          <span className="numerico text-sm font-normal text-tinta-suave">{formatarNumero(pagina.total)}</span>
        </h2>
        <p className="text-xs text-tinta-suave">A Meta recusou o número em duas campanhas diferentes.</p>
      </div>
      <p className="max-w-prose text-sm leading-relaxed text-tinta-suave">
        O número não tem WhatsApp, não aceitou os termos do aplicativo ou usa uma versão antiga. Ele saiu sozinho dos
        envios — mandar de novo só gastaria o plano. Se a pessoa atualizou o app ou você corrigiu o número, tente de
        novo.
      </p>
      {erro && <Alerta tom="erro">{erro}</Alerta>}
      {aviso && <Alerta tom="sucesso">{aviso}</Alerta>}
      <div className="overflow-hidden rounded-card border border-borda bg-superficie shadow-card">
        {/* `relative`: o texto escondido da tabela (sr-only, absoluto) fica preso aqui e não alarga a página (LIC-059). */}
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <caption className="sr-only">Números sem WhatsApp, com a data em que saíram dos envios</caption>
            <thead>
              <tr className="bg-superficie-2/60 text-xs uppercase tracking-wide text-tinta-suave">
                <th scope="col" className="px-5 py-2.5 font-medium">Contato</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Telefone</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Desde</th>
                <th scope="col" className="px-5 py-2.5 font-medium">
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-borda">
              {pagina.itens.map((c) => (
                <tr key={c.id} className="align-middle">
                  <td className="px-5 py-3 text-tinta">{c.nome || <span className="text-tinta-suave">Sem nome</span>}</td>
                  <td className="numerico whitespace-nowrap px-3 py-3 text-tinta">{formatarTelefone(c.telefone)}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-tinta-suave">{formatarData(c.semWhatsappEm)}</td>
                  <td className="px-5 py-3 text-right">
                    <Button
                      tamanho="sm"
                      variante="secundario"
                      carregando={ocupado === c.id}
                      disabled={ocupado !== null}
                      onClick={() => void tentarDeNovo(c.id)}
                    >
                      Tentar de novo
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
