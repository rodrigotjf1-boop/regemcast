'use client';

import { useCallback, useEffect, useState } from 'react';

import { CartaoPublicoSalvo } from '@/components/app/regras/cartao-publico-salvo';
import { useCatalogoDasRegras } from '@/components/app/regras/use-catalogo-das-regras';
import { Alerta } from '@/components/ui/alerta';
import { EsqueletoLista } from '@/components/ui/esqueleto';
import { EstadoErro } from '@/components/ui/estado-erro';
import { mensagemDoErro } from '@/lib/api';
import { formatarNumero } from '@/lib/formato';
import { publicosSalvos } from '@/lib/servicos';
import type { PublicoSalvo } from '@/lib/tipos';

/**
 * Contatos › Públicos salvos: as regras com nome que nascem na campanha
 * ("Salvar estas regras"). Guardam as regras, não as pessoas — o número de
 * cada público é conferido de novo a cada leitura e a cada uso.
 */
export function PublicosSalvos({ ehDono }: { ehDono: boolean }) {
  const [lista, setLista] = useState<PublicoSalvo[] | null>(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [aviso, setAviso] = useState('');
  const { catalogo, erro: erroDoCatalogo } = useCatalogoDasRegras();

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro('');
    try {
      setLista((await publicosSalvos.listar()).publicos);
    } catch (e) {
      setErro(mensagemDoErro(e));
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  return (
    <section aria-labelledby="titulo-publicos-salvos" className="anima-entrada space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="titulo-publicos-salvos" className="text-base font-semibold text-tinta">
          Públicos salvos
          {lista && (
            <span className="numerico ml-1 font-normal text-tinta-suave">({formatarNumero(lista.length)})</span>
          )}
        </h2>
        <p className="text-xs text-tinta-suave">Guardam as regras, não as pessoas: a contagem é a de hoje.</p>
      </div>

      {aviso && <Alerta tom="sucesso">{aviso}</Alerta>}

      {carregando && !lista && <EsqueletoLista linhas={2} />}

      {!carregando && erro && (
        <EstadoErro
          titulo="Não consegui carregar os públicos salvos"
          mensagem={erro}
          aoTentarDeNovo={() => void carregar()}
        />
      )}

      {lista && lista.length === 0 && !erro && (
        <p className="rounded-card border border-dashed border-borda bg-superficie p-4 text-sm text-tinta-suave">
          Nenhum público salvo ainda. Monte as regras em Campanhas › Nova campanha › Quem recebe › Da base › Montar com
          regras e toque em &quot;Salvar estas regras&quot;.
        </p>
      )}

      {lista && lista.length > 0 && (
        <ul className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {lista.map((s) => (
            <CartaoPublicoSalvo
              key={s.id}
              salvo={s}
              catalogo={catalogo}
              erroDoCatalogo={erroDoCatalogo}
              ehDono={ehDono}
              aoMudar={(novo, texto) => {
                setLista((atual) => (atual ?? []).map((x) => (x.id === novo.id ? novo : x)));
                setAviso(texto);
              }}
              aoDuplicar={(novo) => {
                setLista((atual) => {
                  const xs = [...(atual ?? [])];
                  const onde = xs.findIndex((x) => x.id === s.id);
                  xs.splice(onde + 1, 0, novo);
                  return xs;
                });
                setAviso(`Público duplicado: "${novo.nome}".`);
              }}
              aoExcluir={(id, nome) => {
                setLista((atual) => (atual ?? []).filter((x) => x.id !== id));
                setAviso(`Público "${nome}" excluído.`);
              }}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
