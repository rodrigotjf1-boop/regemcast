'use client';

import { useMemo, useState } from 'react';

import { PreviaWhatsapp } from '@/components/app/previa-whatsapp';
import { Alerta } from '@/components/ui/alerta';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { mensagemDoErro } from '@/lib/api';
import { modelos } from '@/lib/servicos';
import type {
  BotaoDoModelo,
  CartaoDoModelo,
  CategoriaModelo,
  DadosModelo,
  ModeloSalvo,
  ProblemaNoModelo,
  TipoModelo,
} from '@/lib/tipos';

/**
 * Editor de modelo.
 *
 * Duas decisões estruturam esta tela.
 *
 * A primeira: **a conferência das regras da Meta não acontece aqui.** Ela é
 * perguntada ao servidor, que tem a única implementação delas. Duas
 * implementações da mesma regra divergem — foi assim que um telefone sem o
 * código do país passou na tela e foi recusado pela Meta. O que a tela faz
 * sozinha é apresentação: contar variáveis para montar os campos de exemplo e
 * desenhar a prévia. Nada disso decide se o modelo pode ir.
 *
 * A segunda: **a prévia fica fixa ao lado, num aparelho.** Escrever modelo é um
 * trabalho de ajuste fino — a frase que não fecha depois de a variável entrar, o
 * cartão cujo texto estoura. Ver o resultado só depois de rolar a página
 * esconde exatamente o que precisa ser visto enquanto se digita.
 */

const VAZIO: DadosModelo = {
  tipo: 'simples',
  nome: '',
  idioma: 'pt_BR',
  categoria: 'MARKETING',
  corpo: '',
  corpoExemplos: [],
  botoes: [],
  cartoes: [],
  ltoAtivo: false,
};

const CARTAO_VAZIO: CartaoDoModelo = { imagem: '', corpo: '', botoes: [] };

/** Quantas variáveis distintas o corpo usa. Serve só para montar os campos. */
function variaveisDoCorpo(corpo: string): number[] {
  const achadas = new Set<number>();
  const padrao = /\{\{\s*(\d+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = padrao.exec(corpo)) !== null) achadas.add(Number(m[1]));
  return Array.from(achadas).sort((a, b) => a - b);
}

/** O modelo salvo, no formato que o editor edita. */
function daListaParaEdicao(m: ModeloSalvo): DadosModelo {
  return {
    tipo: m.tipo,
    nome: m.nome,
    idioma: m.idioma,
    categoria: m.categoria as CategoriaModelo,
    cabecalhoFormato: m.cabecalhoFormato ?? undefined,
    cabecalhoTexto: m.cabecalhoTexto ?? undefined,
    cabecalhoExemplo: m.cabecalhoExemplo ?? undefined,
    corpo: m.corpo,
    corpoExemplos: m.corpoExemplos ?? [],
    rodape: m.rodape ?? undefined,
    botoes: m.botoes ?? [],
    cartoes: m.cartoes ?? [],
    ltoAtivo: m.ltoAtivo,
    ltoTexto: m.ltoTexto ?? undefined,
  };
}

export function EditorModelo({
  inicial,
  aoSalvar,
  aoCancelar,
}: {
  /** Um rascunho para reabrir. Ausente cria um modelo novo. */
  inicial?: ModeloSalvo;
  aoSalvar: () => void;
  aoCancelar: () => void;
}) {
  const [dados, setDados] = useState<DadosModelo>(
    inicial ? daListaParaEdicao(inicial) : VAZIO,
  );
  const [problemas, setProblemas] = useState<ProblemaNoModelo[]>([]);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const ehCarrossel = dados.tipo === 'carrossel';
  const variaveis = useMemo(() => variaveisDoCorpo(dados.corpo), [dados.corpo]);

  function mudar<K extends keyof DadosModelo>(campo: K, valor: DadosModelo[K]) {
    setDados((d) => ({ ...d, [campo]: valor }));
    setProblemas([]);
    setAviso('');
  }

  /** Trocar de forma limpa o que a outra forma não tem — em vez de guardar lixo. */
  function trocarTipo(tipo: TipoModelo) {
    setProblemas([]);
    setAviso('');
    setDados((d) =>
      tipo === 'carrossel'
        ? {
            ...d,
            tipo,
            cabecalhoFormato: undefined,
            cabecalhoTexto: undefined,
            cabecalhoExemplo: undefined,
            rodape: undefined,
            ltoAtivo: false,
            ltoTexto: undefined,
            botoes: [],
            cartoes: d.cartoes?.length ? d.cartoes : [{ ...CARTAO_VAZIO }, { ...CARTAO_VAZIO }],
          }
        : { ...d, tipo, cartoes: [] },
    );
  }

  const problemasDe = (campo: ProblemaNoModelo['campo']) =>
    problemas.filter((p) => p.campo === campo);

  async function conferir() {
    setErro('');
    setAviso('');
    setOcupado(true);
    try {
      const { problemas: achados } = await modelos.conferir(dados);
      setProblemas(achados);
      if (!achados.length) setAviso('Passou em todas as regras da Meta. Pode enviar.');
    } catch (e) {
      setErro(mensagemDoErro(e));
    } finally {
      setOcupado(false);
    }
  }

  async function salvar(enviar: boolean) {
    setErro('');
    setAviso('');
    setOcupado(true);
    try {
      const { id } = inicial
        ? await modelos.atualizar(inicial.id, dados)
        : await modelos.criar(dados);
      if (enviar) await modelos.enviar(id);
      aoSalvar();
    } catch (e) {
      setErro(mensagemDoErro(e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-card border border-borda bg-superficie shadow-card">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_21rem]">
        {/* ------------------------------------------------------ formulário */}
        <div className="min-w-0 divide-y divide-borda">
          <Cabecalho tipo={dados.tipo ?? 'simples'} aoTrocar={trocarTipo} />

          {(erro || aviso || problemas.length > 0) && (
            <div className="space-y-3 p-4 sm:p-5">
              {erro && <Alerta tom="erro">{erro}</Alerta>}
              {aviso && <Alerta tom="sucesso">{aviso}</Alerta>}
              {problemas.length > 0 && (
                <Alerta tom="atencao">
                  <strong>
                    {problemas.length === 1
                      ? 'Um ajuste antes de enviar'
                      : `${problemas.length} ajustes antes de enviar`}
                  </strong>
                  <p className="mt-1 text-xs opacity-80">
                    Estão marcados abaixo, na seção de cada um.
                  </p>
                </Alerta>
              )}
            </div>
          )}

          <Secao numero={1} titulo="Identificação" problemas={problemasDe('nome')}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="m-nome">Nome técnico</Label>
                <Input
                  id="m-nome"
                  value={dados.nome}
                  onChange={(e) => mudar('nome', e.target.value)}
                  placeholder="promo_frete_gratis"
                  invalido={problemasDe('nome').length > 0}
                />
                <p className="text-xs text-tinta-suave">Minúsculas, números e _</p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="m-categoria">Categoria</Label>
                <Select
                  id="m-categoria"
                  value={dados.categoria}
                  onChange={(e) => mudar('categoria', e.target.value as CategoriaModelo)}
                >
                  <option value="MARKETING">Marketing</option>
                  <option value="UTILITY">Utilidade</option>
                  <option value="AUTHENTICATION">Autenticação</option>
                </Select>
                <p className="text-xs text-tinta-suave">Define o preço na Meta</p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="m-idioma">Idioma</Label>
                <Input
                  id="m-idioma"
                  value={dados.idioma ?? 'pt_BR'}
                  onChange={(e) => mudar('idioma', e.target.value)}
                />
                <p className="text-xs text-tinta-suave">Código da Meta</p>
              </div>
            </div>
          </Secao>

          {!ehCarrossel && (
            <Secao numero={2} titulo="Cabeçalho" opcional problemas={problemasDe('cabecalho')}>
              <div className="space-y-1.5">
                <Label htmlFor="m-cabecalho">Título curto acima da mensagem</Label>
                <Campo
                  id="m-cabecalho"
                  valor={dados.cabecalhoTexto ?? ''}
                  limite={60}
                  invalido={problemasDe('cabecalho').length > 0}
                  aoMudar={(v) => {
                    mudar('cabecalhoTexto', v);
                    mudar('cabecalhoFormato', v ? 'TEXT' : undefined);
                  }}
                  placeholder="Oferta da semana"
                />
                <p className="text-xs leading-relaxed text-tinta-suave">
                  Sem emoji, quebra de linha ou formatação. Pode usar{' '}
                  <Codigo>{'{{1}}'}</Codigo> uma vez.
                </p>
              </div>

              {/\{\{\s*1\s*\}\}/.test(dados.cabecalhoTexto ?? '') && (
                <div className="space-y-1.5">
                  <Label htmlFor="m-cab-exemplo">Exemplo do valor no cabeçalho</Label>
                  <Input
                    id="m-cab-exemplo"
                    value={dados.cabecalhoExemplo ?? ''}
                    onChange={(e) => mudar('cabecalhoExemplo', e.target.value)}
                    placeholder="Maria"
                  />
                  <p className="text-xs text-tinta-suave">
                    A Meta exige o exemplo quando há variável no cabeçalho.
                  </p>
                </div>
              )}
            </Secao>
          )}

          <Secao
            numero={ehCarrossel ? 2 : 3}
            titulo={ehCarrossel ? 'Mensagem acima dos cartões' : 'Mensagem'}
            problemas={problemasDe('corpo')}
          >
            <div className="space-y-1.5">
              <Label htmlFor="m-corpo">Texto</Label>
              <Campo
                id="m-corpo"
                multilinha
                linhas={5}
                valor={dados.corpo}
                limite={1024}
                invalido={problemasDe('corpo').length > 0}
                aoMudar={(v) => mudar('corpo', v)}
                placeholder="Olá {{1}}! Hoje o frete é por nossa conta."
              />
              <p className="text-xs leading-relaxed text-tinta-suave">
                Use <Codigo>{'{{1}}'}</Codigo>, <Codigo>{'{{2}}'}</Codigo>… para personalizar. A
                mensagem <strong>não pode começar nem terminar com variável</strong>, e duas não
                podem ficar coladas — a Meta recusa.
              </p>
            </div>

            {variaveis.length > 0 && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {variaveis.map((n, i) => (
                  <div key={n} className="space-y-1.5">
                    <Label htmlFor={`m-ex-${n}`}>{`Exemplo de {{${n}}}`}</Label>
                    <Input
                      id={`m-ex-${n}`}
                      value={dados.corpoExemplos?.[i] ?? ''}
                      onChange={(e) => {
                        const novos = [...(dados.corpoExemplos ?? [])];
                        novos[i] = e.target.value;
                        mudar('corpoExemplos', novos);
                      }}
                      placeholder="Maria"
                    />
                  </div>
                ))}
              </div>
            )}
          </Secao>

          {ehCarrossel ? (
            <Secao numero={3} titulo="Cartões" problemas={problemasDe('cartoes')}>
              <Cartoes
                cartoes={dados.cartoes ?? []}
                aoMudar={(c) => mudar('cartoes', c)}
              />
            </Secao>
          ) : (
            <>
              <Secao
                numero={4}
                titulo="Oferta e rodapé"
                opcional
                problemas={[...problemasDe('lto'), ...problemasDe('rodape')]}
              >
                <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-borda bg-superficie-2 p-3 text-sm text-tinta transition-colors hover:border-acento">
                  <input
                    type="checkbox"
                    checked={!!dados.ltoAtivo}
                    onChange={(e) => mudar('ltoAtivo', e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-[rgb(var(--cor-acento))]"
                  />
                  <span className="leading-relaxed">
                    <strong>Oferta por tempo limitado</strong>
                    <span className="block text-xs text-tinta-suave">
                      Mostra um contador na mensagem. Só em Marketing, e não aceita rodapé nem
                      cabeçalho de texto.
                    </span>
                  </span>
                </label>

                {dados.ltoAtivo ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="m-lto">Texto da oferta</Label>
                    <Campo
                      id="m-lto"
                      valor={dados.ltoTexto ?? ''}
                      limite={16}
                      aoMudar={(v) => mudar('ltoTexto', v)}
                      placeholder="Oferta!"
                    />
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Label htmlFor="m-rodape">Rodapé</Label>
                    <Campo
                      id="m-rodape"
                      valor={dados.rodape ?? ''}
                      limite={60}
                      invalido={problemasDe('rodape').length > 0}
                      aoMudar={(v) => mudar('rodape', v)}
                      placeholder="Válido só hoje"
                    />
                    <p className="text-xs text-tinta-suave">Sem variáveis.</p>
                  </div>
                )}
              </Secao>

              <Secao numero={5} titulo="Botões" opcional problemas={problemasDe('botoes')}>
                <Botoes
                  botoes={dados.botoes ?? []}
                  aoMudar={(b) => mudar('botoes', b)}
                  ajuda="Até 10 no total: no máximo 2 links, 1 telefone e 1 cupom."
                />
              </Secao>
            </>
          )}

          {/* Barra de ação fixa: em formulário longo, rolar até o fim para salvar
              é o atrito que faz a pessoa perder o trabalho. */}
          <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 border-t border-borda bg-superficie/95 p-4 backdrop-blur sm:p-5">
            <Button onClick={() => void salvar(true)} carregando={ocupado}>
              Enviar para aprovação
            </Button>
            <Button variante="secundario" onClick={() => void salvar(false)} carregando={ocupado}>
              Salvar rascunho
            </Button>
            <Button variante="secundario" onClick={() => void conferir()} carregando={ocupado}>
              Conferir regras
            </Button>
            <button
              type="button"
              onClick={aoCancelar}
              className="ml-auto text-sm text-tinta-suave underline-offset-4 hover:text-tinta hover:underline"
            >
              Cancelar
            </button>
          </div>
        </div>

        {/* --------------------------------------------------------- prévia */}
        <aside className="border-t border-borda bg-superficie-2 lg:border-l lg:border-t-0">
          <div className="lg:sticky lg:top-4">
            <PreviaWhatsapp dados={dados} variaveis={variaveis} />
          </div>
        </aside>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- peças */

function Codigo({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-acento-suave px-1 py-0.5 font-mono text-[0.7rem] text-tinta">
      {children}
    </code>
  );
}

/** O topo do editor, com a escolha da forma. */
function Cabecalho({
  tipo,
  aoTrocar,
}: {
  tipo: TipoModelo;
  aoTrocar: (t: TipoModelo) => void;
}) {
  const opcoes: { valor: TipoModelo; rotulo: string; ajuda: string }[] = [
    { valor: 'simples', rotulo: 'Mensagem simples', ajuda: 'Texto, imagem e botões' },
    { valor: 'carrossel', rotulo: 'Carrossel', ajuda: 'De 2 a 10 produtos' },
  ];

  return (
    <div className="space-y-4 p-4 sm:p-5">
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-tinta">Novo modelo</h2>
        <p className="text-sm leading-relaxed text-tinta-suave">
          Conferimos as regras da Meta antes de enviar — a recusa dela leva horas e diz pouco.
        </p>
      </div>

      <div
        role="radiogroup"
        aria-label="Formato do modelo"
        className="grid grid-cols-1 gap-2 sm:grid-cols-2"
      >
        {opcoes.map((o) => {
          const ativo = tipo === o.valor;
          return (
            <button
              key={o.valor}
              type="button"
              role="radio"
              aria-checked={ativo}
              onClick={() => aoTrocar(o.valor)}
              className={[
                'rounded-lg border p-3 text-left transition-colors',
                ativo
                  ? 'border-transparent bg-acento text-acento-contraste'
                  : 'border-borda bg-superficie text-tinta hover:border-acento',
              ].join(' ')}
            >
              <span className="block text-sm font-semibold">{o.rotulo}</span>
              <span className={`block text-xs ${ativo ? 'opacity-75' : 'text-tinta-suave'}`}>
                {o.ajuda}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Uma seção do formulário.
 *
 * O número não é enfeite: escrever um modelo TEM ordem — identificar, escrever,
 * decorar. E a seção com problema ganha um trilho vermelho à esquerda em vez de
 * um bloco inteiro pintado: o destaque aponta onde olhar sem gritar.
 */
function Secao({
  numero,
  titulo,
  opcional,
  problemas,
  children,
}: {
  numero: number;
  titulo: string;
  opcional?: boolean;
  problemas: ProblemaNoModelo[];
  children: React.ReactNode;
}) {
  const comProblema = problemas.length > 0;

  return (
    <section
      className={`relative space-y-4 p-4 sm:p-5 ${comProblema ? 'bg-erro/[0.03]' : ''}`}
    >
      {comProblema && <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-erro" />}

      <div className="flex items-center gap-2">
        <span
          className={[
            'flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono text-[0.65rem] font-semibold',
            comProblema ? 'bg-erro text-white' : 'bg-acento text-acento-contraste',
          ].join(' ')}
        >
          {numero}
        </span>
        <h3 className="text-sm font-semibold text-tinta">{titulo}</h3>
        {opcional && (
          <span className="text-xs font-normal text-tinta-suave">opcional</span>
        )}
      </div>

      {children}

      {comProblema && (
        <ul className="space-y-1 text-xs text-erro">
          {problemas.map((p, i) => (
            <li key={i}>{p.mensagem}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Campo com contador. O limite aparece antes de ser estourado, não depois. */
function Campo({
  id,
  valor,
  limite,
  aoMudar,
  placeholder,
  multilinha,
  linhas = 3,
  invalido,
}: {
  id: string;
  valor: string;
  limite: number;
  aoMudar: (v: string) => void;
  placeholder?: string;
  multilinha?: boolean;
  linhas?: number;
  invalido?: boolean;
}) {
  const perto = valor.length > limite * 0.9;

  return (
    <div className="space-y-1">
      {multilinha ? (
        <textarea
          id={id}
          value={valor}
          onChange={(e) => aoMudar(e.target.value)}
          rows={linhas}
          maxLength={limite}
          placeholder={placeholder}
          className={[
            'w-full rounded-lg border bg-superficie px-3 py-2 text-sm text-tinta',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento',
            invalido ? 'border-erro' : 'border-borda',
          ].join(' ')}
        />
      ) : (
        <Input
          id={id}
          value={valor}
          onChange={(e) => aoMudar(e.target.value)}
          maxLength={limite}
          placeholder={placeholder}
          invalido={invalido}
        />
      )}
      <p
        className={`text-right font-mono text-[0.7rem] ${perto ? 'text-atencao' : 'text-tinta-suave'}`}
      >
        {valor.length}/{limite}
      </p>
    </div>
  );
}

/** Os cartões do carrossel. */
function Cartoes({
  cartoes,
  aoMudar,
}: {
  cartoes: CartaoDoModelo[];
  aoMudar: (c: CartaoDoModelo[]) => void;
}) {
  function atualizar(i: number, patch: Partial<CartaoDoModelo>) {
    aoMudar(cartoes.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  }

  return (
    <div className="space-y-4">
      <p className="text-xs leading-relaxed text-tinta-suave">
        De 2 a 10 cartões, cada um com imagem, texto e botões.{' '}
        <strong>Todos precisam ter os mesmos botões, na mesma ordem</strong> — a Meta recusa o
        carrossel inteiro se um estiver diferente, sem dizer qual.
      </p>

      <div className="space-y-3">
        {cartoes.map((c, i) => (
          <div key={i} className="space-y-3 rounded-lg border border-borda bg-superficie-2 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs font-semibold uppercase tracking-wide text-tinta-suave">
                Cartão {i + 1}
              </span>
              <div className="flex items-center gap-3 text-xs">
                {i > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      const novos = [...cartoes];
                      [novos[i - 1], novos[i]] = [novos[i], novos[i - 1]];
                      aoMudar(novos);
                    }}
                    className="text-tinta-suave underline-offset-4 hover:text-tinta hover:underline"
                  >
                    ← Mover
                  </button>
                )}
                {cartoes.length > 2 && (
                  <button
                    type="button"
                    onClick={() => aoMudar(cartoes.filter((_, j) => j !== i))}
                    className="text-tinta-suave underline-offset-4 hover:text-erro hover:underline"
                  >
                    Remover
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`c-img-${i}`}>Imagem</Label>
                <Input
                  id={`c-img-${i}`}
                  value={c.imagem ?? ''}
                  onChange={(e) => atualizar(i, { imagem: e.target.value })}
                  placeholder="https://… ou id da mídia"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`c-corpo-${i}`}>Texto do cartão</Label>
                <Campo
                  id={`c-corpo-${i}`}
                  valor={c.corpo}
                  limite={160}
                  aoMudar={(v) => atualizar(i, { corpo: v })}
                  placeholder="Hambúrguer artesanal com fritas"
                />
              </div>
            </div>

            <Botoes
              botoes={c.botoes ?? []}
              aoMudar={(b) => atualizar(i, { botoes: b })}
              ajuda="Um ou dois botões. Os mesmos em todos os cartões."
              maximo={2}
            />
          </div>
        ))}
      </div>

      {cartoes.length < 10 && (
        <Button
          variante="secundario"
          onClick={() => {
            // O cartão novo nasce com os MESMOS botões do primeiro: é a regra
            // que mais derruba carrossel, e adivinhar aqui evita o erro.
            const modelo = cartoes[0];
            aoMudar([
              ...cartoes,
              {
                ...CARTAO_VAZIO,
                botoes: (modelo?.botoes ?? []).map((b) => ({ ...b })),
              },
            ]);
          }}
        >
          + Cartão
        </Button>
      )}
    </div>
  );
}

/** Editor de botões, usado no modelo simples e dentro de cada cartão. */
function Botoes({
  botoes,
  aoMudar,
  ajuda,
  maximo = 10,
}: {
  botoes: BotaoDoModelo[];
  aoMudar: (b: BotaoDoModelo[]) => void;
  ajuda: string;
  maximo?: number;
}) {
  function atualizar(i: number, campo: keyof BotaoDoModelo, valor: string) {
    aoMudar(botoes.map((b, j) => (j === i ? { ...b, [campo]: valor } : b)));
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-tinta-suave">{ajuda}</p>

      {botoes.map((b, i) => (
        <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[8.5rem_minmax(0,1fr)_auto]">
          <Select value={b.tipo} onChange={(e) => atualizar(i, 'tipo', e.target.value)}>
            <option value="QUICK_REPLY">Resposta</option>
            <option value="URL">Link</option>
            <option value="PHONE_NUMBER">Telefone</option>
            <option value="COPY_CODE">Cupom</option>
          </Select>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Input
              value={b.texto}
              onChange={(e) => atualizar(i, 'texto', e.target.value)}
              placeholder="Texto do botão"
              maxLength={25}
            />
            {b.tipo === 'URL' && (
              <Input
                value={b.url ?? ''}
                onChange={(e) => atualizar(i, 'url', e.target.value)}
                placeholder="https://sualoja.com.br"
              />
            )}
            {b.tipo === 'PHONE_NUMBER' && (
              <Input
                value={b.telefone ?? ''}
                onChange={(e) => atualizar(i, 'telefone', e.target.value)}
                placeholder="5521999998888"
              />
            )}
          </div>

          <button
            type="button"
            onClick={() => aoMudar(botoes.filter((_, j) => j !== i))}
            className="justify-self-start text-xs text-tinta-suave underline-offset-4 hover:text-erro hover:underline sm:self-center sm:justify-self-auto"
          >
            Remover
          </button>
        </div>
      ))}

      {botoes.length < maximo && (
        <Button variante="secundario" onClick={() => aoMudar([...botoes, { tipo: 'QUICK_REPLY', texto: '' }])}>
          + Botão
        </Button>
      )}
    </div>
  );
}
