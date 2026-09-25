'use client';

import { useEffect, useState } from 'react';

import { IconeBlocos } from '@/components/app/icones';
import { Alerta } from '@/components/ui/alerta';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { mensagemDoErro } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatarNumero } from '@/lib/formato';
import { contatos } from '@/lib/servicos';
import type { DivisaoDeBlocos, OpcoesDeBloco, OrdemDosBlocos, OrigemDaDivisao, Publico, Segmento } from '@/lib/tipos';

/** O que vai ser dividido, como a tela descreve. */
export interface AlvoDaDivisao {
  origem: OrigemDaDivisao;
  origemId?: string;
  segmento?: Segmento;
  uf?: string;
  /** Um público pronto (VIP, bairro…) e o valor que ele pede. */
  publico?: Publico;
  publicoValor?: string | null;
  /** "Contatos do celular.vcf", "Em risco", "Rio de Janeiro"… */
  rotulo: string;
  /** Quantos podem receber, quando a tela já sabe. */
  total?: number | null;
  /** Lista só com nome e número (sem pedidos): o caso típico do arquivo do celular. */
  soNomeENumero?: boolean;
}

const ORDENS: { valor: OrdemDosBlocos; titulo: string; ajuda: string }[] = [
  { valor: 'importacao', titulo: 'Como foi importado', ajuda: 'Na ordem em que os contatos entraram na base.' },
  { valor: 'sorteio', titulo: 'Sorteio', ajuda: 'Blocos parecidos entre si — bom para testar duas mensagens.' },
  { valor: 'recentes', titulo: 'Mais recentes primeiro', ajuda: 'Quem entrou na base por último vem antes.' },
  { valor: 'regiao', titulo: 'Por região (DDD)', ajuda: 'Cada bloco com gente da mesma região.' },
  { valor: 'valor', titulo: 'Melhores clientes primeiro', ajuda: 'Quem mais gastou vem antes. Precisa de histórico de pedidos.' },
];

/**
 * Dividir em blocos: cada bloco vira uma lista, escolhida na campanha como
 * qualquer outra.
 *
 * Os tamanhos prontos (250, 500, 750, 1.000) só aparecem liberados até o limite
 * de envio que a Meta dá ao número hoje — o servidor diz quais. É o "envio de
 * um dia": um bloco por vez, olhando o resultado antes do próximo.
 */
export function DividirEmBlocos({
  alvo,
  aoConcluir,
  aoCancelar,
}: {
  alvo: AlvoDaDivisao;
  aoConcluir: (divisao: DivisaoDeBlocos) => void;
  aoCancelar: () => void;
}) {
  const [opcoes, setOpcoes] = useState<OpcoesDeBloco | null>(null);
  const [tamanho, setTamanho] = useState<number | null>(null);
  const [personalizado, setPersonalizado] = useState(false);
  const [textoPersonalizado, setTextoPersonalizado] = useState('');
  const [ordem, setOrdem] = useState<OrdemDosBlocos>('importacao');
  const [soNunca, setSoNunca] = useState(false);
  const [erro, setErro] = useState('');
  const [dividindo, setDividindo] = useState(false);

  useEffect(() => {
    let vivo = true;
    contatos
      .opcoesDeBloco()
      .then((o) => {
        if (!vivo) return;
        setOpcoes(o);
        setTamanho(o.sugerido);
      })
      .catch((e) => vivo && setErro(mensagemDoErro(e)));
    return () => {
      vivo = false;
    };
  }, []);

  const valorPersonalizado = Number(textoPersonalizado);
  const escolhido = personalizado ? (Number.isInteger(valorPersonalizado) ? valorPersonalizado : 0) : (tamanho ?? 0);
  const valido = Boolean(opcoes) && escolhido >= 50 && escolhido <= (opcoes?.maximo ?? 0);
  const previa =
    alvo.total && valido && !soNunca
      ? {
          blocos: Math.ceil(alvo.total / escolhido),
          ultimo: alvo.total - (Math.ceil(alvo.total / escolhido) - 1) * escolhido,
        }
      : null;

  async function dividir() {
    if (!valido) return;
    setErro('');
    setDividindo(true);
    try {
      const d = await contatos.dividir({
        origem: alvo.origem,
        origemId: alvo.origemId,
        segmento: alvo.segmento,
        uf: alvo.uf,
        publico: alvo.publico,
        publicoValor: alvo.publicoValor ?? undefined,
        tamanho: escolhido,
        ordem,
        soNuncaReceberam: soNunca || undefined,
      });
      aoConcluir(d);
    } catch (e) {
      setErro(mensagemDoErro(e));
    } finally {
      setDividindo(false);
    }
  }

  return (
    <Card className="anima-entrada">
      <div className="space-y-5">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-acento text-acento-contraste">
            <IconeBlocos className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-tinta">Dividir em blocos</h2>
            <p className="text-sm text-tinta-suave">
              <span className="font-medium text-tinta">{alvo.rotulo}</span>
              {alvo.total != null && (
                <>
                  {' '}· <span className="numerico">{formatarNumero(alvo.total)}</span>{' '}
                  {alvo.total === 1 ? 'pessoa pode receber' : 'pessoas podem receber'}
                </>
              )}
            </p>
          </div>
        </div>

        {alvo.soNomeENumero && (
          <Alerta tom="informacao">
            Lista só com nome e número — é o que vem no arquivo de contatos exportado do celular. Sem
            histórico de pedidos para filtrar, os blocos são o jeito de enviar aos poucos: um bloco por
            vez, dentro do limite do seu número, olhando o resultado de cada um antes de mandar o próximo.
          </Alerta>
        )}

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-tinta">Contatos por bloco</legend>
          <div className="flex flex-wrap gap-2">
            {(opcoes?.tamanhos ?? []).map((t) => {
              const ativo = !personalizado && tamanho === t.valor;
              return (
                <button
                  key={t.valor}
                  type="button"
                  disabled={!t.disponivel}
                  aria-pressed={ativo}
                  title={t.disponivel ? undefined : 'Libera quando a Meta aumentar o limite do seu número'}
                  onClick={() => {
                    setPersonalizado(false);
                    setTamanho(t.valor);
                  }}
                  className={cn(
                    'numerico rounded-full border px-4 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento',
                    ativo
                      ? 'border-acento bg-acento text-acento-contraste'
                      : 'border-borda bg-superficie text-tinta hover:border-acento',
                    !t.disponivel && 'cursor-not-allowed opacity-45 hover:border-borda',
                  )}
                >
                  {formatarNumero(t.valor)}
                </button>
              );
            })}
            <button
              type="button"
              aria-pressed={personalizado}
              onClick={() => {
                setPersonalizado(true);
                if (!textoPersonalizado && opcoes) setTextoPersonalizado(String(opcoes.sugerido));
              }}
              className={cn(
                'rounded-full border px-4 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento',
                personalizado
                  ? 'border-acento bg-acento text-acento-contraste'
                  : 'border-borda bg-superficie text-tinta hover:border-acento',
              )}
            >
              Personalizado
            </button>
          </div>
          {personalizado && opcoes && (
            <div className="max-w-xs space-y-1">
              <Label htmlFor="tamanho-personalizado">Quantos contatos por bloco</Label>
              <Input
                id="tamanho-personalizado"
                type="number"
                inputMode="numeric"
                min={50}
                max={opcoes.maximo}
                value={textoPersonalizado}
                onChange={(e) => setTextoPersonalizado(e.target.value)}
              />
              <p className="text-xs text-tinta-suave">
                De 50 a <span className="numerico">{formatarNumero(opcoes.maximo)}</span>.
              </p>
            </div>
          )}
          {opcoes && (
            <p className="text-xs leading-relaxed text-tinta-suave">
              {!opcoes.limiteConhecido
                ? 'O limite de envio do seu número ainda não foi lido — por enquanto, blocos de até 250 (o limite de quem começa).'
                : opcoes.limite === null
                  ? 'Seu número não tem teto diário na Meta: qualquer tamanho cabe.'
                  : `Seu número pode falar com ${formatarNumero(opcoes.limite)} pessoas diferentes por dia hoje. Tamanhos maiores ficam disponíveis quando a Meta aumentar o limite.`}
            </p>
          )}
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-tinta">Em que ordem os contatos entram</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {ORDENS.map((o) => (
              <label
                key={o.valor}
                className={cn(
                  'flex cursor-pointer items-start gap-2 rounded-card border p-3 text-sm transition-colors focus-within:ring-2 focus-within:ring-acento',
                  ordem === o.valor ? 'border-acento bg-acento/5' : 'border-borda bg-superficie hover:border-acento/60',
                )}
              >
                <input
                  type="radio"
                  name="ordem-blocos"
                  value={o.valor}
                  checked={ordem === o.valor}
                  onChange={() => setOrdem(o.valor)}
                  className="mt-0.5 h-4 w-4 shrink-0"
                />
                <span className="min-w-0">
                  <span className="block font-medium text-tinta">{o.titulo}</span>
                  <span className="block text-xs text-tinta-suave">{o.ajuda}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={soNunca}
            onChange={(e) => setSoNunca(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0"
          />
          <span>
            <span className="block font-medium text-tinta">Só quem ainda não recebeu nenhuma campanha</span>
            <span className="block text-xs text-tinta-suave">
              Para dividir de novo o que sobrou — por exemplo, quando o limite do número aumentar.
            </span>
          </span>
        </label>

        {previa && (
          <p className="rounded-card border border-borda bg-superficie-2/60 px-3 py-2 text-sm text-tinta">
            <span className="numerico">{formatarNumero(alvo.total ?? 0)}</span> pessoas →{' '}
            <strong className="numerico">{formatarNumero(previa.blocos)}</strong>{' '}
            {previa.blocos === 1 ? 'bloco' : 'blocos'} de <span className="numerico">{formatarNumero(escolhido)}</span>
            {previa.blocos > 1 && previa.ultimo !== escolhido && (
              <>
                {' '}(o último com <span className="numerico">{formatarNumero(previa.ultimo)}</span>)
              </>
            )}
            .
          </p>
        )}

        <p className="text-xs leading-relaxed text-tinta-suave">
          Lista fria? Mande o bloco 1, acompanhe entrega, leitura e quem pediu para sair, e só então siga
          para o próximo. Os blocos são uma foto de agora: quem entrar na base depois não entra sozinho — é
          só dividir de novo.
        </p>

        {erro && <Alerta tom="erro">{erro}</Alerta>}

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void dividir()} carregando={dividindo} disabled={!valido}>
            Dividir em blocos
          </Button>
          <Button variante="secundario" onClick={aoCancelar}>
            Cancelar
          </Button>
        </div>
      </div>
    </Card>
  );
}
