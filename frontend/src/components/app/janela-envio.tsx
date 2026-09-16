'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/cn';

/**
 * Janela de envio e ritmo da campanha.
 *
 * Fica recolhida por padrão, e isso é decisão, não esquecimento: a maioria das
 * campanhas pequenas sai direto, e abrir seis campos para quem só quer mandar
 * uma mensagem para cinquenta pessoas é atrito sem retorno.
 *
 * Mas quando ela importa, importa muito. Mandar promoção às três da manhã é o
 * jeito mais rápido de a pessoa bloquear o número — e bloqueio derruba a nota
 * de qualidade na Meta, que reduz o limite diário de TODAS as campanhas
 * seguintes. Por isso o texto de apoio explica o porquê, e não só o como.
 */

export interface Janela {
  ativa: boolean;
  dias: number[];
  inicio: string;
  fim: string;
  pausa: string;
  maxDia: string;
  maxSemana: string;
  maxMes: string;
}

export const JANELA_VAZIA: Janela = {
  ativa: false,
  dias: [],
  inicio: '',
  fim: '',
  pausa: '',
  maxDia: '',
  maxSemana: '',
  maxMes: '',
};

const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/** Os tetos, quando informados, precisam ser crescentes. */
export function problemaDosTetos(j: Janela): string | null {
  const n = (v: string) => (v.trim() ? Number(v) : null);
  const [dia, semana, mes] = [n(j.maxDia), n(j.maxSemana), n(j.maxMes)];
  if ((dia && semana && dia > semana) || (semana && mes && semana > mes) || (dia && mes && dia > mes)) {
    return 'Os limites precisam ser crescentes: o do dia não pode passar o da semana, nem o da semana o do mês.';
  }
  if ((j.inicio && !j.fim) || (!j.inicio && j.fim)) {
    return 'Preencha o início E o fim do horário, ou deixe os dois vazios.';
  }
  return null;
}

/** A janela no formato que a API recebe. Só manda o que foi preenchido. */
export function janelaParaEnvio(j: Janela) {
  if (!j.ativa) return {};
  const n = (v: string) => (v.trim() ? Number(v) : undefined);
  return {
    janelaDias: j.dias,
    janelaInicio: j.inicio && j.fim ? j.inicio : undefined,
    janelaFim: j.inicio && j.fim ? j.fim : undefined,
    pausaSegundos: n(j.pausa),
    maxPorDia: n(j.maxDia),
    maxPorSemana: n(j.maxSemana),
    maxPorMes: n(j.maxMes),
  };
}

export function JanelaEnvio({ valor, aoMudar }: { valor: Janela; aoMudar: (j: Janela) => void }) {
  const mudar = <K extends keyof Janela>(campo: K, v: Janela[K]) => aoMudar({ ...valor, [campo]: v });
  const problema = problemaDosTetos(valor);

  return (
    <div
      className={cn(
        'rounded-card border p-3 transition-colors',
        valor.ativa ? 'border-acento bg-acento-suave/30' : 'border-dashed border-borda',
      )}
    >
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={valor.ativa}
          onChange={(e) => mudar('ativa', e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0"
        />
        <span className="text-sm leading-relaxed text-tinta">
          <strong>Agendar e controlar o ritmo</strong>
          <span className="block text-xs text-tinta-suave">
            Sem isto, a campanha começa a sair assim que você disparar.
          </span>
        </span>
      </label>

      {valor.ativa && (
        <div className="mt-4 space-y-5">
          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold uppercase tracking-wide text-tinta-suave">
              Dias e horário
            </legend>

            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Dias da semana">
              {DIAS.map((rotulo, i) => {
                const marcado = valor.dias.includes(i);
                return (
                  <button
                    key={rotulo}
                    type="button"
                    aria-pressed={marcado}
                    onClick={() =>
                      mudar(
                        'dias',
                        marcado ? valor.dias.filter((d) => d !== i) : [...valor.dias, i].sort(),
                      )
                    }
                    className={cn(
                      'h-9 w-11 rounded-lg border text-xs font-medium transition-colors',
                      marcado
                        ? 'border-transparent bg-acento text-acento-contraste'
                        : 'border-borda bg-superficie text-tinta-suave hover:border-acento',
                    )}
                  >
                    {rotulo}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label htmlFor="j-inicio">Das</Label>
                <Input
                  id="j-inicio"
                  type="time"
                  value={valor.inicio}
                  onChange={(e) => mudar('inicio', e.target.value)}
                  className="w-32"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="j-fim">Até</Label>
                <Input
                  id="j-fim"
                  type="time"
                  value={valor.fim}
                  onChange={(e) => mudar('fim', e.target.value)}
                  className="w-32"
                />
              </div>
            </div>

            <p className="text-xs leading-relaxed text-tinta-suave">
              Nenhum dia marcado = qualquer dia. Horário vazio = qualquer hora. Aceita janela que
              passa da meia-noite, como das 22h às 2h. O horário é o do fuso da sua conta.
            </p>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold uppercase tracking-wide text-tinta-suave">
              Ritmo
            </legend>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="space-y-1">
                <Label htmlFor="j-pausa">Pausa (seg)</Label>
                <Input
                  id="j-pausa"
                  type="number"
                  min={0}
                  max={3600}
                  inputMode="numeric"
                  value={valor.pausa}
                  onChange={(e) => mudar('pausa', e.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="j-dia">Máx. por dia</Label>
                <Input
                  id="j-dia"
                  type="number"
                  min={1}
                  inputMode="numeric"
                  value={valor.maxDia}
                  onChange={(e) => mudar('maxDia', e.target.value)}
                  placeholder="sem limite"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="j-semana">Máx. por semana</Label>
                <Input
                  id="j-semana"
                  type="number"
                  min={1}
                  inputMode="numeric"
                  value={valor.maxSemana}
                  onChange={(e) => mudar('maxSemana', e.target.value)}
                  placeholder="sem limite"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="j-mes">Máx. por mês</Label>
                <Input
                  id="j-mes"
                  type="number"
                  min={1}
                  inputMode="numeric"
                  value={valor.maxMes}
                  onChange={(e) => mudar('maxMes', e.target.value)}
                  placeholder="sem limite"
                />
              </div>
            </div>

            <p className="text-xs leading-relaxed text-tinta-suave">
              A pausa espaça as mensagens: mil envios em dois minutos parecem robô para os sistemas
              antifraude. O limite da Meta continua valendo por cima destes.
            </p>
          </fieldset>

          {problema && <p className="text-xs text-erro">{problema}</p>}
        </div>
      )}
    </div>
  );
}
