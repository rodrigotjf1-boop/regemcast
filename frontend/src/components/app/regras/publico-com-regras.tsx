'use client';

import { useEffect, useRef, useState } from 'react';

import { ContagemDasRegras, type SituacaoDaContagem } from '@/components/app/regras/contagem-das-regras';
import { EditorDeRegras } from '@/components/app/regras/editor-de-regras';
import { ParteDoPublico } from '@/components/app/regras/parte-do-publico';
import { SalvarPublico } from '@/components/app/regras/salvar-publico';
import { useCatalogoDasRegras } from '@/components/app/regras/use-catalogo-das-regras';
import { Alerta } from '@/components/ui/alerta';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { mensagemDoErro } from '@/lib/api';
import { formatarNumero } from '@/lib/formato';
import {
  ajustarParte,
  mesmasRegras,
  paraATela,
  publicoDasRegras,
  regraNova,
  regrasCompletas,
  type RegraNaTela,
} from '@/lib/regras-do-publico';
import { publicosSalvos } from '@/lib/servicos';
import type { PreviaDoPublico, PublicoDaCampanha, PublicoSalvo } from '@/lib/tipos';

/** Ao ligar a parte, ela nasce com até 500 contatos. */
const PARTE_INICIAL = 500;
const PREFIXO = 'regras-campanha';

/**
 * "Quem recebe → Da base → Montar com regras": o público sai das regras
 * (campo + comparação + valor, todas valendo), de um público salvo, ou de uma
 * parte dele. Só avisa o formulário (`aoMudar`) com as regras completas — antes
 * disso, `null`. A contagem é a prévia que o formulário busca.
 */
export function PublicoComRegras({
  valor,
  aoMudar,
  previa,
  erroDaPrevia,
}: {
  /** O público com que a tela abre (rascunho reaberto, ou "Usar em campanha" de um público salvo). */
  valor: PublicoDaCampanha | null;
  aoMudar: (publico: PublicoDaCampanha | null) => void;
  previa: PreviaDoPublico | null;
  erroDaPrevia: string;
}) {
  const { catalogo, erro: erroDoCatalogo, tentarDeNovo } = useCatalogoDasRegras();
  // O que a tela abriu, lido uma vez só: depois, quem manda é o que a pessoa faz aqui.
  const inicial = useRef(valor?.origem === 'regras' ? valor : null);
  const [regras, setRegras] = useState<RegraNaTela[] | null>(() =>
    inicial.current?.regras?.length ? paraATela(inicial.current.regras) : null,
  );
  const [salvoId, setSalvoId] = useState<string | null>(inicial.current?.publicoSalvoId ?? null);
  const [salvos, setSalvos] = useState<PublicoSalvo[] | null>(null);
  const [erroSalvos, setErroSalvos] = useState('');
  const [painelSalvar, setPainelSalvar] = useState(false);
  const [aviso, setAviso] = useState('');
  const temParteInicial = Boolean(inicial.current?.parteDe && inicial.current?.parteAte);
  const [parteLigada, setParteLigada] = useState(temParteInicial);
  const [deTexto, setDeTexto] = useState(temParteInicial ? String(inicial.current!.parteDe) : '1');
  const [ateTexto, setAteTexto] = useState(temParteInicial ? String(inicial.current!.parteAte) : String(PARTE_INICIAL));

  useEffect(() => {
    let vivo = true;
    publicosSalvos.listar().then(
      (r) => vivo && setSalvos(r.publicos),
      (e) => {
        if (!vivo) return;
        setSalvos([]);
        setErroSalvos(mensagemDoErro(e));
      },
    );
    return () => {
      vivo = false;
    };
  }, []);

  // A primeira regra: as do público salvo com que a tela abriu, ou uma em branco.
  useEffect(() => {
    if (regras !== null || !catalogo) return;
    if (salvoId) {
      if (salvos === null) return;
      const s = salvos.find((x) => x.id === salvoId);
      if (s) {
        setRegras(paraATela(s.regras));
        return;
      }
      setSalvoId(null);
    }
    const nova = regraNova(catalogo);
    setRegras(nova ? [nova] : []);
  }, [regras, catalogo, salvoId, salvos]);

  const lista = regras ?? [];
  const completas = regrasCompletas(lista);
  const salvo = salvos?.find((s) => s.id === salvoId) ?? null;
  // O público salvo só vale enquanto as regras da tela são as dele: com ele, o servidor usa as gravadas.
  const salvoQueVale = salvoId && (salvos === null || (salvo && mesmasRegras(lista, salvo.regras))) ? salvoId : null;

  // Quantos o público inteiro tem: com a parte, o servidor manda à parte (`publicoInteiro`).
  const totalSemParte = previa ? (previa.cashback?.doPublico ?? previa.total) : null;
  const totalDoPublico = previa && parteLigada ? (previa.publicoInteiro ?? totalSemParte) : totalSemParte;
  const parte = parteLigada && completas ? ajustarParte(Number(deTexto), Number(ateTexto), totalDoPublico) : null;

  const publico = regras === null ? null : publicoDasRegras(lista, salvoQueVale, parte);
  const chave = publico ? JSON.stringify(publico) : '';
  const avisar = useRef(aoMudar);
  avisar.current = aoMudar;
  useEffect(() => {
    // Antes das regras existirem, o formulário fica com o que abriu.
    if (regras === null) return;
    avisar.current(chave ? (JSON.parse(chave) as PublicoDaCampanha) : null);
  }, [chave, regras]);

  function mudarRegras(novas: RegraNaTela[]) {
    setRegras(novas);
    setAviso('');
    // Sem a lista dos salvos não dá para comparar: mexeu, deixa de ser o público salvo.
    if (salvos === null) setSalvoId(null);
  }

  function escolherSalvo(id: string) {
    setAviso('');
    setPainelSalvar(false);
    if (!id) {
      setSalvoId(null);
      return;
    }
    const s = salvos?.find((x) => x.id === id);
    if (!s) return;
    setSalvoId(s.id);
    setRegras(paraATela(s.regras));
  }

  function ligarParte(ligada: boolean) {
    setParteLigada(ligada);
    if (ligada) {
      setDeTexto('1');
      setAteTexto(
        String(totalSemParte !== null && totalSemParte > 0 ? Math.min(totalSemParte, PARTE_INICIAL) : PARTE_INICIAL),
      );
    }
  }

  function fixarParte() {
    if (!parte) return;
    setDeTexto(String(parte.de));
    setAteTexto(String(parte.ate));
  }

  if (erroDoCatalogo) {
    return (
      <div className="space-y-2">
        <Alerta tom="erro">Não consegui carregar os campos das regras: {erroDoCatalogo}</Alerta>
        <Button variante="secundario" tamanho="sm" onClick={tentarDeNovo}>
          Tentar de novo
        </Button>
      </div>
    );
  }
  if (!catalogo || regras === null) {
    return <p className="text-sm text-tinta-suave">Carregando as regras…</p>;
  }

  const situacao: SituacaoDaContagem = !lista.length
    ? { tipo: 'sem-regra' }
    : !completas
      ? { tipo: 'incompleta' }
      : erroDaPrevia
        ? { tipo: 'erro', mensagem: erroDaPrevia }
        : previa && totalDoPublico !== null
          ? { tipo: 'pronta', total: totalDoPublico, soComCashback: Boolean(previa.cashback) }
          : { tipo: 'contando' };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 basis-64 space-y-1">
          <Label htmlFor={`${PREFIXO}-salvo`} opcional>
            Usar um público salvo
          </Label>
          <Select
            id={`${PREFIXO}-salvo`}
            value={salvoQueVale ?? ''}
            disabled={salvos === null}
            onChange={(e) => escolherSalvo(e.target.value)}
          >
            <option value="">
              {salvos === null ? 'Carregando…' : salvos.length ? 'Escolha um público salvo…' : 'Nenhum público salvo ainda'}
            </option>
            {(salvos ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.nome}
                {s.total !== null ? ` · ${formatarNumero(s.total)} ${s.total === 1 ? 'contato' : 'contatos'}` : ''}
              </option>
            ))}
          </Select>
        </div>
        <Button
          variante="secundario"
          onClick={() => {
            setPainelSalvar(true);
            setAviso('');
          }}
          disabled={!completas || painelSalvar}
          aria-expanded={painelSalvar}
        >
          Salvar estas regras
        </Button>
      </div>

      {erroSalvos && <Alerta tom="atencao">Não consegui carregar os públicos salvos: {erroSalvos}</Alerta>}
      {salvo?.problema && salvoQueVale && <Alerta tom="atencao">{salvo.problema}</Alerta>}

      {painelSalvar && (
        <SalvarPublico
          prefixo={PREFIXO}
          regras={lista}
          aoCancelar={() => setPainelSalvar(false)}
          aoSalvar={(novo) => {
            setSalvos((atual) => [...(atual ?? []), novo]);
            // As regras como o servidor gravou ("80" vira "80.00"): é com elas que o público salvo continua valendo.
            setRegras(paraATela(novo.regras));
            setSalvoId(novo.id);
            setPainelSalvar(false);
            setAviso(`Público "${novo.nome}" salvo. Ele fica na lista acima e em Contatos › Públicos salvos.`);
          }}
        />
      )}

      {aviso && <Alerta tom="sucesso">{aviso}</Alerta>}

      <EditorDeRegras catalogo={catalogo} regras={lista} aoMudar={mudarRegras} prefixo={PREFIXO} />

      <ContagemDasRegras situacao={situacao} />

      <ParteDoPublico
        prefixo={PREFIXO}
        ligada={parteLigada && completas}
        habilitada={completas}
        deTexto={deTexto}
        ateTexto={ateTexto}
        parte={parte}
        total={totalDoPublico}
        aoLigar={ligarParte}
        aoMudarDe={setDeTexto}
        aoMudarAte={setAteTexto}
        aoTerminarDeDigitar={fixarParte}
      />
    </div>
  );
}
