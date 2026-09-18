import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/cn';
import { formatarNumero } from '@/lib/formato';

/**
 * Como a campanha e cada mensagem aparecem, num lugar só.
 *
 * Painel, lista e detalhe mostravam o mesmo estado com cores diferentes — e cor
 * que muda de significado entre telas ensina a pessoa a não confiar em cor.
 */

type Tom = 'neutro' | 'acento' | 'sucesso' | 'atencao' | 'erro';

const CAMPANHA: Record<string, { rotulo: string; tom: Tom; vivo?: boolean }> = {
  rascunho: { rotulo: 'Rascunho', tom: 'neutro' },
  agendada: { rotulo: 'Agendada', tom: 'atencao', vivo: true },
  enviando: { rotulo: 'Enviando', tom: 'acento', vivo: true },
  pausada: { rotulo: 'Pausada', tom: 'erro' },
  concluida: { rotulo: 'Concluída', tom: 'sucesso' },
};

export function BadgeCampanha({ status }: { status: string }) {
  const s = CAMPANHA[status] ?? { rotulo: status, tom: 'neutro' as Tom };
  return (
    <Badge tom={s.tom} ponto vivo={s.vivo}>
      {s.rotulo}
    </Badge>
  );
}

/** Estado de UMA mensagem. */
export const DESTINATARIO: Record<string, { rotulo: string; tom: Tom; barra: string }> = {
  lida: { rotulo: 'Lida', tom: 'sucesso', barra: 'bg-acento' },
  entregue: { rotulo: 'Entregue', tom: 'acento', barra: 'bg-realce' },
  enviada: { rotulo: 'Enviada', tom: 'atencao', barra: 'bg-tinta-suave/50' },
  enviando: { rotulo: 'Enviando', tom: 'neutro', barra: 'bg-tinta-suave/25' },
  pendente: { rotulo: 'Na fila', tom: 'neutro', barra: 'bg-borda' },
  falhou: { rotulo: 'Falhou', tom: 'erro', barra: 'bg-erro' },
  // Cancelado NÃO é falha: a campanha foi cancelada antes de sair. Misturar os
  // dois esconderia o sinal que denuncia número com problema.
  cancelado: { rotulo: 'Cancelado', tom: 'neutro', barra: 'bg-borda' },
};

/** Ordem do funil: do mais avançado ao que nem saiu, falha por último. */
const ORDEM = ['lida', 'entregue', 'enviada', 'enviando', 'pendente', 'cancelado', 'falhou'];

export function BadgeDestinatario({ status }: { status: string }) {
  const s = DESTINATARIO[status] ?? { rotulo: status, tom: 'neutro' as Tom };
  return (
    <Badge tom={s.tom} ponto vivo={status === 'enviando'}>
      {s.rotulo}
    </Badge>
  );
}

/**
 * A campanha numa barra: quanto foi lido, entregue, enviado e o que falhou.
 *
 * O número vem ao lado, na legenda — a barra dá a proporção de relance, mas
 * ninguém deve precisar medir pixel para saber quantos falharam.
 */
export function BarraStatus({
  porStatus,
  total,
  legenda = true,
  className,
}: {
  porStatus: Record<string, number>;
  total: number;
  legenda?: boolean;
  className?: string;
}) {
  const presentes = ORDEM.filter((s) => (porStatus[s] ?? 0) > 0);
  const base = Math.max(total, 1);

  return (
    <div className={cn('space-y-2', className)}>
      <div
        className="flex h-2 w-full overflow-hidden rounded-full bg-superficie-2"
        role="img"
        aria-label={presentes
          .map((s) => `${porStatus[s]} ${DESTINATARIO[s]?.rotulo.toLowerCase() ?? s}`)
          .join(', ')}
      >
        {presentes.map((s) => (
          <div
            key={s}
            className={cn('anima-preencher h-full', DESTINATARIO[s]?.barra ?? 'bg-borda')}
            style={{ width: `${((porStatus[s] ?? 0) / base) * 100}%` }}
          />
        ))}
      </div>
      {legenda && presentes.length > 0 ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-tinta-suave">
          {presentes.map((s) => (
            <li key={s} className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className={cn('h-2 w-2 rounded-full', DESTINATARIO[s]?.barra ?? 'bg-borda')}
              />
              <span className="numerico text-tinta">{formatarNumero(porStatus[s] ?? 0)}</span>
              {DESTINATARIO[s]?.rotulo.toLowerCase() ?? s}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
