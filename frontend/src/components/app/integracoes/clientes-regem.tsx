'use client';

import { useState } from 'react';

import { Alerta } from '@/components/ui/alerta';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatarDataHora, formatarNumero } from '@/lib/formato';
import type { SituacaoRegem, StatusRegem } from '@/lib/tipos';

const SELO: Record<StatusRegem, { texto: string; tom: 'neutro' | 'acento' | 'sucesso' | 'erro' }> = {
  parado: { texto: 'Não importados', tom: 'neutro' },
  carga: { texto: 'Importando', tom: 'acento' },
  em_dia: { texto: 'Em dia', tom: 'sucesso' },
  falhou: { texto: 'Parou', tom: 'erro' },
};

/**
 * Os clientes da empresa no Regem. Quem pediu para sair lá entra descadastrado
 * (o número não volta por uma planilha depois); quem foi esquecido lá, a
 * pedido, é anonimizado aqui. A declaração de consentimento é a condição da
 * Meta para a empresa iniciar a conversa.
 */
export function ClientesRegem({
  situacao: s,
  ehDono,
  ocupado,
  aoImportar,
  aoTentarDeNovo,
}: {
  situacao: SituacaoRegem;
  ehDono: boolean;
  ocupado: boolean;
  aoImportar: (consentimento: boolean, evidencia: string) => void;
  aoTentarDeNovo: () => void;
}) {
  const c = s.clientes;
  const selo = SELO[c.status];
  // Em dia, ler tudo de novo é raro: o formulário fica atrás de um botão.
  const [releitura, setReleitura] = useState(false);
  const mostrarFormulario = c.status === 'parado' || releitura;

  return (
    <section aria-labelledby="clientes-regem" className="space-y-3 rounded-card border border-borda p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="clientes-regem" className="text-sm font-semibold text-tinta">
          Clientes
        </h3>
        <Badge tom={selo.tom} ponto={c.status !== 'carga'} vivo={c.status === 'carga'}>
          {selo.texto}
        </Badge>
      </div>

      {c.status === 'carga' && (
        <div className="space-y-2" role="status">
          <p className="text-sm text-tinta">
            Lendo os clientes de <strong>{s.empresaNome}</strong>… pode fechar esta tela, a leitura continua no servidor.
          </p>
          <p className="numerico text-xs text-tinta-suave">
            {formatarNumero(c.lidos)} lidos · {formatarNumero(c.novos)} novos na base
          </p>
          {c.erro && <Alerta tom="atencao">{c.erro}</Alerta>}
        </div>
      )}

      {c.status === 'em_dia' && (
        <div className="space-y-2">
          <p className="text-sm leading-relaxed text-tinta">
            {formatarNumero(c.lidos)} clientes lidos, {formatarNumero(c.novos)} novos na base
            {c.bloqueados ? `, ${formatarNumero(c.bloqueados)} que pediram para sair (entraram descadastrados)` : ''}
            {c.invalidos ? `, ${formatarNumero(c.invalidos)} sem telefone válido` : ''}
            {c.removidos ? `, ${formatarNumero(c.removidos)} esquecidos a pedido (anonimizados aqui)` : ''}. Quem pode
            receber está na lista <strong>Clientes Regem</strong>.
          </p>
          <p className="text-xs leading-relaxed text-tinta-suave">
            Atualizado em {formatarDataHora(c.ultimaConsulta)}. Cliente novo, saída e esquecimento chegam a cada 30
            minutos.
          </p>
          {c.erro && <Alerta tom="atencao">{c.erro}</Alerta>}
        </div>
      )}

      {c.status === 'falhou' && (
        <div className="space-y-3">
          <Alerta tom="erro">{c.erro ?? 'A leitura dos clientes parou.'}</Alerta>
          {ehDono && (
            <Button onClick={aoTentarDeNovo} carregando={ocupado}>
              Tentar de novo
            </Button>
          )}
        </div>
      )}

      {c.status === 'parado' && (
        <p className="text-sm leading-relaxed text-tinta-suave">
          Traga a base de clientes da empresa. As compras de cada um vêm em seguida.
        </p>
      )}

      {c.status !== 'carga' && c.status !== 'falhou' && (
        ehDono ? (
          mostrarFormulario ? (
            <Declaracao
              ocupado={ocupado}
              rotulo={c.status === 'parado' ? 'Importar clientes' : 'Ler tudo de novo'}
              aoConfirmar={(consentimento, evidencia) => {
                aoImportar(consentimento, evidencia);
                setReleitura(false);
              }}
              aoCancelar={c.status === 'parado' ? undefined : () => setReleitura(false)}
            />
          ) : (
            <Button variante="discreto" tamanho="sm" onClick={() => setReleitura(true)}>
              Ler tudo de novo
            </Button>
          )
        ) : (
          c.status === 'parado' && <Alerta tom="informacao">Só o dono da conta pode importar os clientes.</Alerta>
        )
      )}
    </section>
  );
}

/** A declaração do dono (a condição da Meta) e o botão que começa a leitura completa. */
function Declaracao({
  ocupado,
  rotulo,
  aoConfirmar,
  aoCancelar,
}: {
  ocupado: boolean;
  rotulo: string;
  aoConfirmar: (consentimento: boolean, evidencia: string) => void;
  aoCancelar?: () => void;
}) {
  const [consentimento, setConsentimento] = useState(false);
  const [evidencia, setEvidencia] = useState('');
  return (
    <div className="space-y-3">
      <div className="space-y-3 rounded-lg bg-superficie-2 p-3">
        <label className="flex items-start gap-3 text-sm text-tinta">
          <input
            type="checkbox"
            checked={consentimento}
            onChange={(e) => setConsentimento(e.target.checked)}
            className="mt-1 h-4 w-4 shrink-0"
          />
          <span>
            Declaro que os clientes da minha empresa <strong>autorizaram</strong> receber mensagens desta empresa no
            WhatsApp.
          </span>
        </label>
        <div className="space-y-1">
          <Label htmlFor="evidencia-regem">Como eles autorizaram? (opcional)</Label>
          <Input
            id="evidencia-regem"
            value={evidencia}
            onChange={(e) => setEvidencia(e.target.value)}
            placeholder="Aceite no cardápio, pedido pelo WhatsApp…"
          />
        </div>
        <p className="text-xs leading-relaxed text-tinta-suave">
          Quem aceitou receber promoções no cardápio do Regem entra com esse aceite, que é a prova mais forte. Quem pediu
          para sair lá entra descadastrado. Quem já está na sua base mantém o cadastro que tinha — nada é sobrescrito.
          Clientes só de marketplace (iFood e outros) ficam de fora.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => aoConfirmar(consentimento, evidencia)} carregando={ocupado} disabled={!consentimento}>
          {rotulo}
        </Button>
        {aoCancelar && (
          <Button variante="discreto" onClick={aoCancelar} disabled={ocupado}>
            Cancelar
          </Button>
        )}
      </div>
    </div>
  );
}
