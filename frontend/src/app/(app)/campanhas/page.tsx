'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { CabecalhoPagina } from '@/components/ui/cabecalho-pagina';
import { Alerta } from '@/components/ui/alerta';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { EstadoErro } from '@/components/ui/estado-erro';
import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { mensagemDoErro } from '@/lib/api';
import { campanhas, whatsapp } from '@/lib/servicos';
import type { ModeloDeMensagem, ResumoCampanha } from '@/lib/tipos';

/**
 * Campanhas.
 *
 * A tela separa **montar** de **disparar**, e isso não é preciosismo: a
 * campanha é gravada antes de qualquer mensagem sair, então um erro no meio do
 * envio deixa o registro de pé — dá para ver o que ia ser enviado, o que saiu e
 * o que falhou. Fazer os dois no mesmo clique significa que um erro no fim
 * apaga o registro de mensagens que já foram cobradas.
 *
 * Por enquanto o disparo acontece no próprio request, com teto de
 * destinatários. É limite de arquitetura, não de produto — some quando a fila
 * entrar —, e aparece na tela como número, não como surpresa.
 */

const TETO_DESTINATARIOS = 10;

export default function PaginaCampanhas() {
  const [lista, setLista] = useState<ResumoCampanha[] | null>(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [montando, setMontando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro('');
    try {
      setLista(await campanhas.listar());
    } catch (e) {
      setErro(mensagemDoErro(e));
      setLista(null);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  return (
    <div className="space-y-6">
      <CabecalhoPagina
        titulo="Campanhas"
        descricao="Cada campanha usa um modelo aprovado e mostra, por pessoa, o que de fato aconteceu com a mensagem."
        acao={
          <Button
            variante={montando ? 'secundario' : 'primario'}
            onClick={() => setMontando((v) => !v)}
            aria-expanded={montando}
          >
            {montando ? 'Cancelar' : 'Nova campanha'}
          </Button>
        }
      />

      {montando && (
        <FormularioCampanha
          aoCriar={() => {
            setMontando(false);
            void carregar();
          }}
        />
      )}

      {carregando && (
        <div className="flex items-center gap-3 text-sm text-tinta-suave">
          <Spinner /> Carregando…
        </div>
      )}

      {!carregando && erro && (
        <EstadoErro
          titulo="Não consegui carregar suas campanhas"
          mensagem={erro}
          aoTentarDeNovo={() => void carregar()}
        />
      )}

      {!carregando && !erro && lista?.length === 0 && !montando && (
        <EmptyState
          titulo="Nenhuma campanha ainda"
          descricao="Monte a primeira escolhendo um modelo aprovado e os números que vão receber."
          acao={<Button onClick={() => setMontando(true)}>Nova campanha</Button>}
        />
      )}

      {!carregando && !erro && lista && lista.length > 0 && (
        <ul className="space-y-3">
          {lista.map((c) => (
            <li key={c.id}>
              <LinhaCampanha campanha={c} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Tom por status do destinatário, usado nas contagens. */
const TOM_STATUS: Record<string, 'sucesso' | 'atencao' | 'erro' | 'acento' | 'neutro'> = {
  pendente: 'neutro',
  enviando: 'neutro',
  enviada: 'atencao',
  entregue: 'acento',
  lida: 'sucesso',
  falhou: 'erro',
};

function LinhaCampanha({ campanha }: { campanha: ResumoCampanha }) {
  const entradas = Object.entries(campanha.porStatus);

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <Link
            href={`/campanhas/${campanha.id}`}
            className="text-base font-semibold text-tinta underline-offset-4 hover:underline"
          >
            {campanha.nome}
          </Link>
          <p className="text-xs text-tinta-suave">
            Modelo <span className="numerico">{campanha.modeloNome}</span> ·{' '}
            {campanha.total === 1 ? '1 destinatário' : `${campanha.total} destinatários`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {entradas.length === 0 ? (
            <Badge tom="neutro">{campanha.status}</Badge>
          ) : (
            entradas.map(([status, quantos]) => (
              <Badge key={status} tom={TOM_STATUS[status] ?? 'neutro'}>
                {quantos} {status}
              </Badge>
            ))
          )}
        </div>
      </div>
    </Card>
  );
}

/**
 * Montagem da campanha.
 *
 * O modelo vem da lista real da Meta, e só os **aprovados** aparecem: oferecer
 * um modelo em análise seria oferecer um disparo que a Meta vai recusar, e o
 * cliente descobriria isso depois de montar a lista inteira.
 */
function FormularioCampanha({ aoCriar }: { aoCriar: () => void }) {
  const [modelos, setModelos] = useState<ModeloDeMensagem[] | null>(null);
  const [erroModelos, setErroModelos] = useState('');
  const [nome, setNome] = useState('');
  const [modeloId, setModeloId] = useState('');
  const [telefones, setTelefones] = useState('');
  const [variaveis, setVariaveis] = useState<string[]>([]);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const todos = await whatsapp.modelos();
        if (!vivo) return;
        setModelos(todos.filter((m) => m.status === 'aprovado'));
      } catch (e) {
        if (!vivo) return;
        setErroModelos(mensagemDoErro(e));
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  const escolhido = modelos?.find((m) => m.id === modeloId) ?? null;

  const numeros = telefones
    .split(/[\s,;]+/)
    .map((t) => t.replace(/\D/g, ''))
    .filter((t) => t.length > 0);

  async function enviar() {
    setErro('');
    if (!escolhido) {
      setErro('Escolha um modelo aprovado.');
      return;
    }
    if (numeros.length === 0) {
      setErro('Informe ao menos um número.');
      return;
    }
    if (numeros.length > TETO_DESTINATARIOS) {
      setErro(
        `Por enquanto cada campanha aceita até ${TETO_DESTINATARIOS} números. O envio em volume entra com a fila.`,
      );
      return;
    }

    setSalvando(true);
    try {
      const { id } = await campanhas.criar({
        nome: nome.trim(),
        modeloNome: escolhido.nome,
        modeloIdioma: escolhido.idioma,
        modeloId: escolhido.id,
        modeloCategoria: escolhido.categoria,
        destinatarios: numeros.map((telefone) => ({
          telefone,
          // Mesmas variáveis para todos nesta versão. Variável por pessoa vem
          // com o import de contatos, onde cada linha traz os próprios valores.
          variaveis: variaveis.slice(0, escolhido.variaveis),
        })),
      });
      aoCriar();
      // Leva direto para a campanha: é lá que se dispara e se acompanha.
      window.location.href = `/campanhas/${id}`;
    } catch (e) {
      setErro(mensagemDoErro(e));
    } finally {
      setSalvando(false);
    }
  }

  if (erroModelos) {
    return (
      <Card>
        <Alerta tom="erro">{erroModelos}</Alerta>
      </Card>
    );
  }

  if (!modelos) {
    return (
      <Card>
        <div className="flex items-center gap-3 text-sm text-tinta-suave">
          <Spinner /> Carregando seus modelos…
        </div>
      </Card>
    );
  }

  if (modelos.length === 0) {
    return (
      <Card>
        <EmptyState
          titulo="Nenhum modelo aprovado"
          descricao="Só modelo aprovado pela Meta pode iniciar conversa. Assim que o primeiro for aprovado, ele aparece aqui."
          acao={<Link href="/modelos" className="text-sm text-acento-forte underline">Ver meus modelos</Link>}
        />
      </Card>
    );
  }

  return (
    <Card>
      <div className="space-y-4">
        {erro && <Alerta tom="erro">{erro}</Alerta>}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="nome-campanha">Nome da campanha</Label>
            <Input
              id="nome-campanha"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Promoção de sexta"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="modelo-campanha">Modelo</Label>
            <Select
              id="modelo-campanha"
              value={modeloId}
              onChange={(e) => {
                setModeloId(e.target.value);
                setVariaveis([]);
              }}
            >
              <option value="">Escolha…</option>
              {modelos.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nome} · {m.categoria}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {escolhido && (
          <div className="space-y-3 rounded-card border border-borda bg-superficie-2 p-3">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-tinta">
              {escolhido.corpo}
            </p>

            {escolhido.variaveis > 0 && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {Array.from({ length: escolhido.variaveis }, (_, i) => (
                  <div key={i} className="space-y-1">
                    <Label htmlFor={`var-${i}`}>{`Valor de {{${i + 1}}}`}</Label>
                    <Input
                      id={`var-${i}`}
                      value={variaveis[i] ?? ''}
                      onChange={(e) => {
                        const novo = [...variaveis];
                        novo[i] = e.target.value;
                        setVariaveis(novo);
                      }}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="space-y-1">
          <Label htmlFor="numeros">Números</Label>
          <textarea
            id="numeros"
            value={telefones}
            onChange={(e) => setTelefones(e.target.value)}
            rows={3}
            placeholder="5521999998888, 5511988887777"
            className="w-full rounded-lg border border-borda bg-superficie px-3 py-2 text-sm text-tinta"
          />
          <p className="text-xs text-tinta-suave">
            País + DDD + número, separados por vírgula ou quebra de linha. Reconhecidos até agora:{' '}
            <strong className="numerico">{numeros.length}</strong> de {TETO_DESTINATARIOS}.
          </p>
        </div>

        <Button onClick={() => void enviar()} carregando={salvando}>
          Montar campanha
        </Button>
        <p className="text-xs text-tinta-suave">
          Montar não envia nada. Você confere a campanha e dispara na tela seguinte.
        </p>
      </div>
    </Card>
  );
}
