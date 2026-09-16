'use client';

import { useMemo, useState } from 'react';

import { Alerta } from '@/components/ui/alerta';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { mensagemDoErro } from '@/lib/api';
import { modelos } from '@/lib/servicos';
import type { BotaoDoModelo, CategoriaModelo, DadosModelo, ProblemaNoModelo } from '@/lib/tipos';

/**
 * Editor de modelo, com prévia.
 *
 * A conferência das regras da Meta **não** acontece aqui: ela é perguntada ao
 * servidor, que tem a única implementação delas. Duas implementações da mesma
 * regra divergem — foi assim que um telefone sem o código do país passou na
 * tela e foi recusado pela Meta.
 *
 * O que esta tela faz por conta própria é presentação: contar variáveis para
 * montar os campos de exemplo e desenhar a prévia. Nada disso decide se o
 * modelo pode ou não ir.
 */

const VAZIO: DadosModelo = {
  nome: '',
  idioma: 'pt_BR',
  categoria: 'MARKETING',
  corpo: '',
  corpoExemplos: [],
  botoes: [],
  ltoAtivo: false,
};

/** Quantas variáveis distintas o corpo usa. Serve só para montar os campos. */
function variaveisDoCorpo(corpo: string): number[] {
  const achadas = new Set<number>();
  const padrao = /\{\{\s*(\d+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = padrao.exec(corpo)) !== null) achadas.add(Number(m[1]));
  return Array.from(achadas).sort((a, b) => a - b);
}

export function EditorModelo({ aoSalvar, aoCancelar }: { aoSalvar: () => void; aoCancelar: () => void }) {
  const [dados, setDados] = useState<DadosModelo>(VAZIO);
  const [problemas, setProblemas] = useState<ProblemaNoModelo[]>([]);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const variaveis = useMemo(() => variaveisDoCorpo(dados.corpo), [dados.corpo]);

  function mudar<K extends keyof DadosModelo>(campo: K, valor: DadosModelo[K]) {
    setDados((d) => ({ ...d, [campo]: valor }));
    setProblemas([]);
    setAviso('');
  }

  function problemasDe(campo: ProblemaNoModelo['campo']) {
    return problemas.filter((p) => p.campo === campo);
  }

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
      const { id } = await modelos.criar(dados);
      if (enviar) await modelos.enviar(id);
      aoSalvar();
    } catch (e) {
      setErro(mensagemDoErro(e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Card>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-5">
          {erro && <Alerta tom="erro">{erro}</Alerta>}
          {aviso && <Alerta tom="sucesso">{aviso}</Alerta>}

          {problemas.length > 0 && (
            <Alerta tom="atencao">
              <strong>
                {problemas.length === 1
                  ? 'Um ajuste antes de enviar:'
                  : `${problemas.length} ajustes antes de enviar:`}
              </strong>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {problemas.map((p, i) => (
                  <li key={i}>{p.mensagem}</li>
                ))}
              </ul>
            </Alerta>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="m-nome">Nome técnico</Label>
              <Input
                id="m-nome"
                value={dados.nome}
                onChange={(e) => mudar('nome', e.target.value)}
                placeholder="promo_frete_gratis"
              />
              <p className="text-xs text-tinta-suave">Minúsculas, números e _</p>
            </div>

            <div className="space-y-1">
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
            </div>

            <div className="space-y-1">
              <Label htmlFor="m-idioma">Idioma</Label>
              <Input
                id="m-idioma"
                value={dados.idioma ?? 'pt_BR'}
                onChange={(e) => mudar('idioma', e.target.value)}
              />
            </div>
          </div>

          <Campo problemas={problemasDe('cabecalho')}>
            <div className="space-y-1">
              <Label htmlFor="m-cabecalho">Cabeçalho (opcional)</Label>
              <Input
                id="m-cabecalho"
                value={dados.cabecalhoTexto ?? ''}
                onChange={(e) => {
                  mudar('cabecalhoTexto', e.target.value);
                  mudar('cabecalhoFormato', e.target.value ? 'TEXT' : undefined);
                }}
                placeholder="Oferta da semana"
              />
              <p className="text-xs leading-relaxed text-tinta-suave">
                Sem emoji, quebra de linha ou formatação. Pode usar <code>{'{{1}}'}</code> uma vez —
                e aí o exemplo abaixo vira obrigatório.
              </p>
            </div>

            {/\{\{\s*1\s*\}\}/.test(dados.cabecalhoTexto ?? '') && (
              <div className="space-y-1">
                <Label htmlFor="m-cab-exemplo">Exemplo do valor no cabeçalho</Label>
                <Input
                  id="m-cab-exemplo"
                  value={dados.cabecalhoExemplo ?? ''}
                  onChange={(e) => mudar('cabecalhoExemplo', e.target.value)}
                  placeholder="Maria"
                />
              </div>
            )}
          </Campo>

          <Campo problemas={problemasDe('corpo')}>
            <div className="space-y-1">
              <Label htmlFor="m-corpo">Mensagem</Label>
              <textarea
                id="m-corpo"
                value={dados.corpo}
                onChange={(e) => mudar('corpo', e.target.value)}
                rows={5}
                maxLength={1024}
                placeholder="Olá {{1}}! Hoje o frete é por nossa conta."
                className="w-full rounded-lg border border-borda bg-superficie px-3 py-2 text-sm text-tinta"
              />
              <p className="text-xs leading-relaxed text-tinta-suave">
                Use <code>{'{{1}}'}</code>, <code>{'{{2}}'}</code>… para personalizar.{' '}
                <strong>A mensagem não pode começar nem terminar com variável</strong>, e duas não
                podem ficar coladas — a Meta recusa. <span className="numerico">{dados.corpo.length}</span>/1024
              </p>
            </div>

            {variaveis.length > 0 && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {variaveis.map((n, i) => (
                  <div key={n} className="space-y-1">
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
          </Campo>

          <Campo problemas={[...problemasDe('lto'), ...problemasDe('rodape')]}>
            <label className="flex items-start gap-3 text-sm text-tinta">
              <input
                type="checkbox"
                checked={!!dados.ltoAtivo}
                onChange={(e) => mudar('ltoAtivo', e.target.checked)}
                className="mt-1 h-4 w-4 shrink-0"
              />
              <span>
                <strong>Oferta por tempo limitado</strong> — mostra um contador na mensagem. Só em
                Marketing, e não aceita rodapé nem cabeçalho de texto.
              </span>
            </label>

            {dados.ltoAtivo && (
              <div className="space-y-1">
                <Label htmlFor="m-lto">Texto da oferta</Label>
                <Input
                  id="m-lto"
                  value={dados.ltoTexto ?? ''}
                  onChange={(e) => mudar('ltoTexto', e.target.value)}
                  maxLength={16}
                  placeholder="Oferta!"
                />
              </div>
            )}

            {!dados.ltoAtivo && (
              <div className="space-y-1">
                <Label htmlFor="m-rodape">Rodapé (opcional)</Label>
                <Input
                  id="m-rodape"
                  value={dados.rodape ?? ''}
                  onChange={(e) => mudar('rodape', e.target.value)}
                  maxLength={60}
                  placeholder="Válido só hoje"
                />
                <p className="text-xs text-tinta-suave">Sem variáveis. Até 60 caracteres.</p>
              </div>
            )}
          </Campo>

          <Campo problemas={problemasDe('botoes')}>
            <Botoes
              botoes={dados.botoes ?? []}
              aoMudar={(b) => mudar('botoes', b)}
            />
          </Campo>

          <div className="flex flex-wrap gap-2 pt-1">
            <Button variante="secundario" onClick={() => void conferir()} carregando={ocupado}>
              Conferir regras da Meta
            </Button>
            <Button variante="secundario" onClick={() => void salvar(false)} carregando={ocupado}>
              Salvar rascunho
            </Button>
            <Button onClick={() => void salvar(true)} carregando={ocupado}>
              Enviar para aprovação
            </Button>
            <Button variante="secundario" onClick={aoCancelar}>
              Cancelar
            </Button>
          </div>
          <p className="text-xs leading-relaxed text-tinta-suave">
            &ldquo;Conferir&rdquo; pergunta ao servidor se o modelo passa nas regras da Meta, sem
            gravar nem enviar nada. Vale usar antes de enviar: a recusa dela leva horas e diz pouco.
          </p>
        </div>

        <Previa dados={dados} variaveis={variaveis} />
      </div>
    </Card>
  );
}

/** Agrupa um bloco do formulário com os problemas que dizem respeito a ele. */
function Campo({
  problemas,
  children,
}: {
  problemas: ProblemaNoModelo[];
  children: React.ReactNode;
}) {
  return (
    <div
      className={`space-y-3 rounded-card border p-3 ${
        problemas.length ? 'border-erro/60 bg-erro/5' : 'border-borda bg-superficie-2'
      }`}
    >
      {children}
      {problemas.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-xs text-erro">
          {problemas.map((p, i) => (
            <li key={i}>{p.mensagem}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Os botões do modelo. Os tetos da Meta aparecem como texto, e travam no envio. */
function Botoes({
  botoes,
  aoMudar,
}: {
  botoes: BotaoDoModelo[];
  aoMudar: (b: BotaoDoModelo[]) => void;
}) {
  function adicionar(tipo: BotaoDoModelo['tipo']) {
    aoMudar([...botoes, { tipo, texto: '' }]);
  }

  function atualizar(i: number, campo: keyof BotaoDoModelo, valor: string) {
    const novos = [...botoes];
    novos[i] = { ...novos[i], [campo]: valor };
    aoMudar(novos);
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label>Botões (opcional)</Label>
        <p className="text-xs text-tinta-suave">
          Até 10 no total: no máximo 2 links, 1 telefone e 1 cupom.
        </p>
      </div>

      {botoes.map((b, i) => (
        <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[8rem_minmax(0,1fr)_auto]">
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
            className="justify-self-start text-xs text-tinta-suave underline-offset-4 hover:text-erro hover:underline sm:justify-self-auto"
          >
            Remover
          </button>
        </div>
      ))}

      <Button variante="secundario" onClick={() => adicionar('QUICK_REPLY')}>
        + Botão
      </Button>
    </div>
  );
}

/**
 * A prévia, no formato do balão do WhatsApp.
 *
 * As variáveis aparecem com os exemplos preenchidos, e não como `{{1}}`: é
 * assim que a mensagem chega, e ver o texto cru esconde o erro mais comum —
 * a frase que não fecha depois de a variável entrar.
 */
function Previa({ dados, variaveis }: { dados: DadosModelo; variaveis: number[] }) {
  const corpo = useMemo(() => {
    let texto = dados.corpo || 'Sua mensagem aparece aqui.';
    variaveis.forEach((n, i) => {
      const exemplo = dados.corpoExemplos?.[i]?.trim() || `exemplo ${n}`;
      texto = texto.replace(new RegExp(`\\{\\{\\s*${n}\\s*\\}\\}`, 'g'), exemplo);
    });
    return texto;
  }, [dados.corpo, dados.corpoExemplos, variaveis]);

  const cabecalho = (dados.cabecalhoTexto ?? '').replace(
    /\{\{\s*1\s*\}\}/g,
    dados.cabecalhoExemplo?.trim() || 'exemplo',
  );

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-tinta-suave">
        Como vai chegar
      </p>
      <div className="rounded-card bg-[#e5ddd5] p-3">
        <div className="space-y-2 rounded-lg rounded-tl-none bg-white p-3 shadow-sm">
          {dados.ltoAtivo && (
            <p className="text-xs font-semibold text-[#1f7a5c]">
              ⏳ {dados.ltoTexto?.trim() || 'Oferta!'}
            </p>
          )}
          {cabecalho && <p className="text-sm font-semibold text-[#111b21]">{cabecalho}</p>}
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-[#111b21]">{corpo}</p>
          {dados.rodape && !dados.ltoAtivo && (
            <p className="text-xs text-[#667781]">{dados.rodape}</p>
          )}
        </div>

        {(dados.botoes ?? []).length > 0 && (
          <div className="mt-1 space-y-1">
            {(dados.botoes ?? []).map((b, i) => (
              <div
                key={i}
                className="rounded-lg bg-white p-2 text-center text-sm text-[#1f7a5c] shadow-sm"
              >
                {b.texto || 'Botão'}
              </div>
            ))}
          </div>
        )}
      </div>
      <p className="text-xs leading-relaxed text-tinta-suave">
        As variáveis aparecem com os exemplos preenchidos, que é como a mensagem chega de verdade.
      </p>
    </div>
  );
}
