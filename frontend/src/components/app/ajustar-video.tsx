'use client';

import { useEffect, useId, useRef, useState } from 'react';

import { Alerta } from '@/components/ui/alerta';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { mensagemDoErro } from '@/lib/api';
import { dmsGraph, midia } from '@/lib/servicos';
import type { AjusteDeVideo, ProporcaoDoVideo } from '@/lib/tipos';

const PROPORCOES: { id: ProporcaoDoVideo; razao: number }[] = [
  { id: '16:9', razao: 16 / 9 },
  { id: '9:16', razao: 9 / 16 },
  { id: '1:1', razao: 1 },
];
const DURACAO_MAXIMA_S = 180;
const CONSULTAR_A_CADA_MS = 3_000;
/** O Graph tem 150 s para o ajuste; aqui, a ida e a volta a mais. */
const DESISTIR_EM_MS = 200_000;

const relogio = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const megas = (bytes: number) => `${(bytes / (1024 * 1024)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;

/** A proporção que menos corta o vídeo: se a pessoa não mexer, o resultado não perde a imagem à toa. */
function maisProxima(largura: number, altura: number): ProporcaoDoVideo {
  const r = largura / altura;
  return PROPORCOES.reduce((a, b) => (Math.abs(Math.log(b.razao / r)) < Math.abs(Math.log(a.razao / r)) ? b : a)).id;
}

type Leitura =
  | { fase: 'lendo' }
  /** Sem ligação (ou sem o recurso): o editor fica como sempre foi. */
  | { fase: 'fora' }
  | { fase: 'recusado'; motivo: string }
  | { fase: 'pronto' };

/**
 * O ajuste do vídeo do cabeçalho pelo DMS Graph: trecho, proporção e texto, sem IA. O resultado é uma mídia NOVA; a
 * original não muda, e o modelo só passa a usar a nova quando a pessoa salvar. Só aparece com a ligação viva.
 */
export function AjustarVideo({ referencia, aoAjustar }: { referencia: string; aoAjustar: (referencia: string, resumo: string) => void }) {
  const idInicio = useId();
  const idFim = useId();
  const idTexto = useId();
  const [leitura, setLeitura] = useState<Leitura>({ fase: 'lendo' });
  const [duracao, setDuracao] = useState<number | null>(null);
  const [inicio, setInicio] = useState(0);
  const [fim, setFim] = useState(0);
  const [proporcao, setProporcao] = useState<ProporcaoDoVideo | null>(null);
  const [texto, setTexto] = useState('');
  const [ajustando, setAjustando] = useState(false);
  const [erro, setErro] = useState('');
  const vivo = useRef(true);
  const relogioDaConsulta = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    vivo.current = true;
    return () => {
      vivo.current = false;
      if (relogioDaConsulta.current) clearTimeout(relogioDaConsulta.current);
    };
  }, []);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const s = await dmsGraph.situacao();
        if (cancelado) return;
        if (!s.disponivel || !s.ligacao?.permissoes.includes('videos.ajustar')) {
          setLeitura({ fase: 'fora' });
          return;
        }
        const m = await dmsGraph.midia(referencia.slice('midia:'.length));
        if (cancelado) return;
        setLeitura(m.podeAjustar ? { fase: 'pronto' } : { fase: 'recusado', motivo: m.motivo ?? 'Este vídeo não pode ser ajustado.' });
      } catch {
        // O ajuste é um extra do editor: sem conseguir ler, o modelo segue funcionando como sempre.
        if (!cancelado) setLeitura({ fase: 'fora' });
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [referencia]);

  if (leitura.fase === 'lendo' || leitura.fase === 'fora') return null;
  if (leitura.fase === 'recusado') return <Alerta tom="atencao">{leitura.motivo}</Alerta>;

  const endereco = midia.endereco(referencia);
  const teto = duracao === null ? 0 : Math.min(Math.floor(duracao), DURACAO_MAXIMA_S);
  const cortou = duracao !== null && (inicio > 0 || fim < teto);
  const trechoCurto = cortou && fim - inicio < 1;
  const temPedido = cortou || proporcao !== null || texto.trim() !== '';

  function terminar(a: Extract<AjusteDeVideo, { situacao: 'pronto' }>) {
    setAjustando(false);
    const s = a.duracaoMs ? `${Math.round(a.duracaoMs / 1000)} s` : 'Trecho escolhido';
    aoAjustar(a.referencia, `${s}${proporcao ? ` em ${proporcao}` : ''}, ${megas(a.bytes)}.`);
  }

  function acompanhar(a: AjusteDeVideo, desde: number) {
    if (!vivo.current) return;
    if (a.situacao === 'pronto') return terminar(a);
    if (a.situacao === 'erro') {
      setAjustando(false);
      setErro(a.frase);
      return;
    }
    if (Date.now() - desde > DESISTIR_EM_MS) {
      setAjustando(false);
      setErro('O ajuste está demorando mais do que o normal. Clique em “Ajustar vídeo” para conferir de novo.');
      return;
    }
    relogioDaConsulta.current = setTimeout(() => {
      dmsGraph.consultarAjuste(a.id).then(
        (novo) => acompanhar(novo, desde),
        // Uma consulta que falhou não muda o ajuste: pergunta de novo até o prazo.
        () => acompanhar(a, desde),
      );
    }, CONSULTAR_A_CADA_MS);
  }

  async function ajustar() {
    setErro('');
    setAjustando(true);
    try {
      const a = await dmsGraph.ajustar({
        referencia,
        ...(cortou ? { inicioSegundos: inicio, fimSegundos: fim } : {}),
        ...(proporcao ? { proporcao } : {}),
        ...(texto.trim() ? { texto: texto.trim() } : {}),
      });
      acompanhar(a, Date.now());
    } catch (e) {
      if (!vivo.current) return;
      setAjustando(false);
      setErro(mensagemDoErro(e));
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-borda bg-superficie-2/50 p-3">
      <div>
        <p className="text-sm font-medium text-tinta">Ajustar este vídeo</p>
        <p className="text-xs leading-relaxed text-tinta-suave">Pelo DMS Graph, sem custo de IA. O vídeo original não muda.</p>
      </div>

      {/* Só para ler a duração e as medidas: não aparece na tela. */}
      {endereco && (
        <video
          className="hidden"
          src={endereco}
          preload="metadata"
          muted
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            if (Number.isFinite(v.duration) && v.duration > 0) {
              const t = Math.min(Math.floor(v.duration), DURACAO_MAXIMA_S);
              setDuracao(v.duration);
              setInicio(0);
              setFim(t);
            }
            if (v.videoWidth > 0 && v.videoHeight > 0) setProporcao((p) => p ?? maisProxima(v.videoWidth, v.videoHeight));
          }}
        />
      )}

      {duracao !== null && teto >= 1 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor={idInicio}>Começa em {relogio(inicio)}</Label>
            <input
              id={idInicio}
              type="range"
              min={0}
              max={Math.max(teto - 1, 0)}
              step={1}
              value={inicio}
              disabled={ajustando}
              onChange={(e) => {
                const v = Number(e.target.value);
                setInicio(v);
                if (fim <= v) setFim(Math.min(v + 1, teto));
              }}
              className="w-full accent-acento-escuro"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={idFim}>Termina em {relogio(fim)}</Label>
            <input
              id={idFim}
              type="range"
              min={1}
              max={teto}
              step={1}
              value={fim}
              disabled={ajustando}
              onChange={(e) => {
                const v = Number(e.target.value);
                setFim(v);
                if (inicio >= v) setInicio(Math.max(v - 1, 0));
              }}
              className="w-full accent-acento-escuro"
            />
          </div>
        </div>
      )}

      <div role="group" aria-label="Proporção" className="flex flex-wrap gap-2">
        {PROPORCOES.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={proporcao === p.id}
            disabled={ajustando}
            onClick={() => setProporcao(p.id)}
            className={[
              'min-h-9 rounded-lg border px-3 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento-escuro disabled:opacity-60',
              proporcao === p.id ? 'border-acento-escuro bg-acento text-acento-contraste' : 'border-borda bg-superficie text-tinta hover:border-tinta/30',
            ].join(' ')}
          >
            {p.id}
          </button>
        ))}
      </div>

      <div className="space-y-1">
        <Label htmlFor={idTexto} opcional>
          Texto no vídeo
        </Label>
        <Input id={idTexto} value={texto} maxLength={80} disabled={ajustando} onChange={(e) => setTexto(e.target.value)} placeholder="Só hoje: 2 por 1" />
      </div>

      {erro && <Alerta tom="erro">{erro}</Alerta>}
      {ajustando && (
        <p className="text-xs text-tinta-suave" role="status">
          Ajustando o vídeo. Pode levar até 2 minutos.
        </p>
      )}

      <Button tamanho="sm" carregando={ajustando} disabled={!temPedido || trechoCurto} onClick={() => void ajustar()}>
        {ajustando ? 'Ajustando…' : 'Ajustar vídeo'}
      </Button>
    </div>
  );
}
