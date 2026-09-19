'use client';

import { useEffect, useRef, useState } from 'react';

import { Alerta } from '@/components/ui/alerta';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { ImportarCardapioWeb } from '@/components/app/importar-cardapioweb';
import { mensagemDoErro } from '@/lib/api';
import { formatarNumero } from '@/lib/formato';
import { contatos } from '@/lib/servicos';
import type { ListaDeContatos, PreviaDaImportacao } from '@/lib/tipos';

/**
 * Importação de contatos, em dois passos.
 *
 * Prévia e confirmação são passos separados de propósito. O cliente está
 * prestes a autorizar mensagens para pessoas que ele acredita terem autorizado
 * ele; antes de gravar, ele vê quantos entram, quantos já existem, quantos
 * foram descartados e — o que mais importa — **quantos números tiveram o código
 * do país acrescentado por nós**.
 *
 * Esse último número está na tela porque o silêncio sobre ele já custou caro:
 * um número sem o `55` passava adiante e a Meta o lia como um destinatário
 * internacional inexistente. A correção estava certa; o problema era ser
 * invisível.
 */

type Fonte = 'arquivo' | 'texto' | 'cardapioweb';

export function ImportarContatos({
  aoConcluir,
  fonteInicial = 'arquivo',
}: {
  aoConcluir: () => void;
  /** `cardapioweb` quando chega pela CW App Store (?importar=cardapioweb). */
  fonteInicial?: Fonte;
}) {
  const [fonte, setFonte] = useState<Fonte>(fonteInicial);
  const [texto, setTexto] = useState('');
  const [previa, setPrevia] = useState<PreviaDaImportacao | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');

  // Confirmação
  const [consentimento, setConsentimento] = useState(false);
  const [evidencia, setEvidencia] = useState('');
  const [listaId, setListaId] = useState('');
  const [listas, setListas] = useState<ListaDeContatos[]>([]);
  const [novaLista, setNovaLista] = useState('');
  const [salvando, setSalvando] = useState(false);
  /** Arquivo grande: quantos já foram gravados, para a tela não ficar muda. */
  const [progresso, setProgresso] = useState<{ feitos: number; total: number } | null>(null);
  const [pronto, setPronto] = useState<{ gravados: number; jaExistiam: number } | null>(null);

  const campoArquivo = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let vivo = true;
    contatos
      .listas()
      .then((l) => vivo && setListas(l))
      .catch(() => {
        /* Lista é opcional: falhar aqui não pode impedir a importação. */
      });
    return () => {
      vivo = false;
    };
  }, []);

  function limpar() {
    setPrevia(null);
    setErro('');
    setConsentimento(false);
    setEvidencia('');
    setListaId('');
    setNovaLista('');
    if (campoArquivo.current) campoArquivo.current.value = '';
  }

  async function enviarArquivo(arquivo: File) {
    setErro('');
    setCarregando(true);
    try {
      setPrevia(await contatos.previaDeArquivo(arquivo));
    } catch (e) {
      setErro(mensagemDoErro(e));
      setPrevia(null);
    } finally {
      setCarregando(false);
    }
  }

  async function enviarTexto() {
    setErro('');
    setCarregando(true);
    try {
      setPrevia(await contatos.previaDeTexto(texto));
    } catch (e) {
      setErro(mensagemDoErro(e));
      setPrevia(null);
    } finally {
      setCarregando(false);
    }
  }

  async function confirmar() {
    if (!previa) return;
    setErro('');
    setSalvando(true);
    try {
      let alvo = listaId;

      // Criar a lista aqui evita mandar a pessoa para outra tela no meio da
      // importação — e voltar com o arquivo perdido.
      if (!alvo && novaLista.trim()) {
        const { id } = await contatos.criarLista(novaLista.trim());
        alvo = id;
      }

      // Arquivo grande vai em blocos: o corpo de uma requisição não comporta
      // dezenas de milhares de contatos. O primeiro bloco cria o registro da
      // importação; os seguintes somam nele, então o histórico tem uma linha só.
      const porEnvio = Math.max(1, Math.min(previa.porEnvio ?? 5000, 5000));
      const total = previa.contatos.length;
      let importacaoId: string | undefined;
      let gravados = 0;
      let jaExistiam = 0;

      for (let i = 0; i < total; i += porEnvio) {
        if (total > porEnvio) setProgresso({ feitos: i, total });
        const parcial = await contatos.importar({
          formato: previa.formato,
          arquivoNome: previa.arquivoNome,
          listaId: alvo || undefined,
          consentimento,
          evidencia: evidencia.trim() || undefined,
          importacaoId,
          contatos: previa.contatos.slice(i, i + porEnvio).map((c) => ({
            telefone: c.telefone,
            nome: c.nome || undefined,
            email: c.email,
            dataNascimento: c.dataNascimento,
            pedidos: c.pedidos,
            totalGastoCentavos: c.totalGastoCentavos,
            ultimoPedidoEm: c.ultimoPedidoEm,
          })),
        });
        importacaoId = parcial.importacaoId;
        gravados += parcial.gravados;
        jaExistiam += parcial.jaExistiam;
      }

      setProgresso(null);
      setPronto({ gravados, jaExistiam });
      setPrevia(null);
      aoConcluir();
    } catch (e) {
      setErro(mensagemDoErro(e));
    } finally {
      setSalvando(false);
      setProgresso(null);
    }
  }

  if (pronto) {
    return (
      <Card>
        <div className="space-y-3">
          <Alerta tom="sucesso">
            {pronto.gravados === 1 ? '1 contato entrou' : `${pronto.gravados} contatos entraram`} na
            sua base
            {pronto.jaExistiam > 0 && `; ${pronto.jaExistiam} já estavam lá e não foram duplicados`}.
          </Alerta>
          <Button
            variante="secundario"
            onClick={() => {
              setPronto(null);
              limpar();
            }}
          >
            Importar mais
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="space-y-5">
        {erro && <Alerta tom="erro">{erro}</Alerta>}

        {!previa && (
          <>
            <div className="flex flex-wrap gap-2">
              <Button
                variante={fonte === 'arquivo' ? 'primario' : 'secundario'}
                onClick={() => setFonte('arquivo')}
                aria-pressed={fonte === 'arquivo'}
              >
                Arquivo
              </Button>
              <Button
                variante={fonte === 'texto' ? 'primario' : 'secundario'}
                onClick={() => setFonte('texto')}
                aria-pressed={fonte === 'texto'}
              >
                Colar números
              </Button>
              <Button
                variante={fonte === 'cardapioweb' ? 'primario' : 'secundario'}
                onClick={() => setFonte('cardapioweb')}
                aria-pressed={fonte === 'cardapioweb'}
              >
                Cardápio Web
              </Button>
            </div>

            {fonte === 'cardapioweb' ? (
              <ImportarCardapioWeb aoConcluir={aoConcluir} />
            ) : fonte === 'arquivo' ? (
              <div className="space-y-2">
                <Label htmlFor="arquivo-contatos">Arquivo de contatos</Label>
                <input
                  id="arquivo-contatos"
                  ref={campoArquivo}
                  type="file"
                  accept=".vcf,.vcard,.csv,.txt,.xlsx"
                  onChange={(e) => {
                    const arquivo = e.target.files?.[0];
                    if (arquivo) void enviarArquivo(arquivo);
                  }}
                  className="block w-full rounded-lg border border-borda bg-superficie px-3 py-2 text-sm text-tinta file:mr-3 file:rounded-md file:border-0 file:bg-superficie-2 file:px-3 file:py-1 file:text-sm file:text-tinta"
                />
                <p className="text-xs leading-relaxed text-tinta-suave">
                  Aceita <strong>.vcf</strong> (os contatos exportados do seu celular, Android ou
                  iPhone), <strong>.csv</strong>, <strong>.txt</strong> e <strong>.xlsx</strong>.
                  Numa planilha, dê à coluna dos números o título <strong>telefone</strong> ou{' '}
                  <strong>celular</strong>. Se a planilha tiver, também trazemos <strong>e-mail</strong>,{' '}
                  <strong>aniversário</strong>, <strong>pedidos</strong>, <strong>total gasto</strong> e{' '}
                  <strong>última compra</strong> (ou dias sem comprar).
                </p>
                <p className="text-xs leading-relaxed text-tinta-suave">
                  Usa a <strong>Anota Aí</strong>? Em <strong>Relatórios → Clientes</strong>, exporte em
                  Excel ou CSV e envie o arquivo aqui.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="numeros-colados">Números</Label>
                <textarea
                  id="numeros-colados"
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  rows={6}
                  placeholder={'21999998888\n21988887777\nMaria, 21977776666'}
                  className="w-full rounded-lg border border-borda bg-superficie px-3 py-2 text-sm text-tinta"
                />
                <p className="text-xs text-tinta-suave">
                  Um por linha, ou separados por vírgula. Pode colar <em>nome, telefone</em>.
                </p>
                <Button onClick={() => void enviarTexto()} carregando={carregando}>
                  Conferir
                </Button>
              </div>
            )}

            {carregando && fonte === 'arquivo' && (
              <div className="flex items-center gap-3 text-sm text-tinta-suave">
                <Spinner /> Lendo o arquivo…
              </div>
            )}
          </>
        )}

        {previa && (
          <ConferirPrevia
            previa={previa}
            listas={listas}
            listaId={listaId}
            aoTrocarLista={setListaId}
            novaLista={novaLista}
            aoTrocarNovaLista={setNovaLista}
            consentimento={consentimento}
            aoTrocarConsentimento={setConsentimento}
            evidencia={evidencia}
            aoTrocarEvidencia={setEvidencia}
            salvando={salvando}
            progresso={progresso}
            aoConfirmar={() => void confirmar()}
            aoCancelar={limpar}
          />
        )}
      </div>
    </Card>
  );
}

/** O passo de conferência. Nada foi gravado até o botão do fim. */
function ConferirPrevia({
  previa,
  listas,
  listaId,
  aoTrocarLista,
  novaLista,
  aoTrocarNovaLista,
  consentimento,
  aoTrocarConsentimento,
  evidencia,
  aoTrocarEvidencia,
  salvando,
  progresso,
  aoConfirmar,
  aoCancelar,
}: {
  previa: PreviaDaImportacao;
  listas: ListaDeContatos[];
  listaId: string;
  aoTrocarLista: (v: string) => void;
  novaLista: string;
  aoTrocarNovaLista: (v: string) => void;
  consentimento: boolean;
  aoTrocarConsentimento: (v: boolean) => void;
  evidencia: string;
  aoTrocarEvidencia: (v: string) => void;
  salvando: boolean;
  progresso: { feitos: number; total: number } | null;
  aoConfirmar: () => void;
  aoCancelar: () => void;
}) {
  const mostrados = previa.contatos.slice(0, 50);

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-tinta">Confira antes de importar</h3>

        <div className="flex flex-wrap gap-2">
          <Badge tom="sucesso">{previa.novos} entram</Badge>
          {previa.jaExistem > 0 && <Badge tom="neutro">{previa.jaExistem} já estão na base</Badge>}
          {previa.invalidos > 0 && <Badge tom="erro">{previa.invalidos} sem telefone válido</Badge>}
        </div>

        {previa.extras && previa.extras.length > 0 && (
          <p className="text-sm text-tinta-suave">
            Também vêm da planilha: <strong className="text-tinta">{previa.extras.join(', ')}</strong>. Quem já
            está na base ganha o histórico de compra novo; e-mail e aniversário só preenchem o que estiver vazio.
          </p>
        )}

        {/*
          O aviso que não pode faltar: corrigir o número em silêncio é o que
          transformou um erro de digitação comum num erro da Meta ilegível.
        */}
        {previa.assumiramPais > 0 && (
          <Alerta tom="informacao">
            <strong>
              {previa.assumiramPais === 1
                ? '1 número estava'
                : `${previa.assumiramPais} números estavam`}{' '}
              sem o código do país.
            </strong>{' '}
            Acrescentamos o <strong>55</strong> (Brasil). Confira na lista abaixo — se algum for de
            fora, corrija no arquivo e importe de novo.
          </Alerta>
        )}

        {previa.truncado && (
          <Alerta tom="atencao">
            O arquivo tem mais de {formatarNumero(previa.limite)} contatos. Vamos importar os primeiros{' '}
            {formatarNumero(previa.limite)}; para o resto, divida o arquivo e importe de novo.
          </Alerta>
        )}

        {previa.contatos.length > (previa.porEnvio ?? 5000) && (
          <Alerta tom="informacao">
            São {formatarNumero(previa.contatos.length)} contatos: vamos gravar em blocos de{' '}
            {formatarNumero(previa.porEnvio ?? 5000)}, num registro só de importação.{' '}
            <strong>Mantenha esta página aberta até terminar.</strong>
          </Alerta>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[28rem] text-left text-sm">
          <caption className="sr-only">Contatos que serão importados</caption>
          <thead>
            <tr className="border-b border-borda text-xs uppercase tracking-wide text-tinta-suave">
              <th scope="col" className="py-2 pr-3 font-medium">Nome</th>
              <th scope="col" className="py-2 pr-3 font-medium">Telefone</th>
              <th scope="col" className="py-2 font-medium">Situação</th>
            </tr>
          </thead>
          <tbody>
            {mostrados.map((c) => (
              <tr key={c.telefone} className="border-b border-borda/60">
                <td className="py-2 pr-3 text-tinta">{c.nome || '—'}</td>
                <td className="numerico py-2 pr-3 text-tinta">{c.telefone}</td>
                <td className="py-2 text-tinta-suave">
                  {!c.novo ? 'Já está na base' : c.assumiuPais ? 'Entra · 55 acrescentado' : 'Entra'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {previa.contatos.length > mostrados.length && (
        <p className="text-xs text-tinta-suave">
          Mostrando os primeiros {mostrados.length} de {previa.contatos.length}.
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="lista-destino">Colocar numa lista (opcional)</Label>
          <Select
            id="lista-destino"
            value={listaId}
            onChange={(e) => {
              aoTrocarLista(e.target.value);
              if (e.target.value) aoTrocarNovaLista('');
            }}
          >
            <option value="">Não colocar em lista</option>
            {listas.map((l) => (
              <option key={l.id} value={l.id}>
                {l.nome} · {l.total}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="nova-lista">Ou criar uma lista nova</Label>
          <Input
            id="nova-lista"
            value={novaLista}
            onChange={(e) => {
              aoTrocarNovaLista(e.target.value);
              if (e.target.value) aoTrocarLista('');
            }}
            placeholder="Clientes de setembro"
          />
        </div>
      </div>

      {/*
        O consentimento não é caixinha de termo de uso: é a condição que a Meta
        exige para disparo iniciado pela empresa, e a que declaramos no App
        Review. Sem ela, nada entra.
      */}
      <div className="space-y-3 rounded-card border border-borda bg-superficie-2 p-3">
        <label className="flex items-start gap-3 text-sm text-tinta">
          <input
            type="checkbox"
            checked={consentimento}
            onChange={(e) => aoTrocarConsentimento(e.target.checked)}
            className="mt-1 h-4 w-4 shrink-0"
          />
          <span>
            Declaro que estas pessoas <strong>autorizaram</strong> receber mensagens desta empresa no
            WhatsApp.
          </span>
        </label>

        <div className="space-y-1">
          <Label htmlFor="evidencia">Como elas autorizaram? (opcional)</Label>
          <Input
            id="evidencia"
            value={evidencia}
            onChange={(e) => aoTrocarEvidencia(e.target.value)}
            placeholder="Cadastro na loja, formulário do site, aceite no atendimento…"
          />
          <p className="text-xs leading-relaxed text-tinta-suave">
            Fica gravado junto de cada contato. É o que sustenta a campanha se a Meta perguntar — e
            ela pergunta.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={aoConfirmar} carregando={salvando} disabled={!consentimento}>
          {progresso
            ? `Gravando ${formatarNumero(progresso.feitos)} de ${formatarNumero(progresso.total)}…`
            : previa.novos === 0 && previa.extras?.length
              ? 'Atualizar os dados dos contatos'
              : `Importar ${formatarNumero(previa.novos)} ${previa.novos === 1 ? 'contato' : 'contatos'}`}
        </Button>
        <Button variante="secundario" onClick={aoCancelar}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
