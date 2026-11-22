'use client';

import { useCallback, useEffect, useId, useState } from 'react';

import { useSessao } from '@/components/app/sessao';
import { Alerta } from '@/components/ui/alerta';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardCabecalho, CardCorpo } from '@/components/ui/card';
import { Esqueleto } from '@/components/ui/esqueleto';
import { EstadoErro } from '@/components/ui/estado-erro';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { mensagemDoErro } from '@/lib/api';
import { conta, dmsGraph } from '@/lib/servicos';
import type { SituacaoDmsGraph } from '@/lib/tipos';

const RECURSO = {
  nome: 'Ajustar vídeo',
  motivo: 'Corta o trecho, muda a proporção, comprime e põe um texto curto. Sem custo de IA.',
};

/** "Indo para o Graph": só endereço https (ou da própria máquina, em teste). O servidor monta, a tela confere. */
function paginaDoGraph(url: string): string | null {
  try {
    const u = new URL(url);
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    return u.protocol === 'https:' || (u.protocol === 'http:' && local) ? u.toString() : null;
  } catch {
    return null;
  }
}

function dia(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR');
}

function Recurso({ rotulo, detalhe, liberado }: { rotulo: string; detalhe: string; liberado: boolean }) {
  return (
    <li className="flex items-start gap-3 py-2">
      <span
        aria-hidden
        className={[
          'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold',
          liberado ? 'bg-sucesso/15 text-sucesso' : 'bg-superficie-2 text-tinta-suave',
        ].join(' ')}
      >
        {liberado ? '✓' : '–'}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-tinta">{rotulo}</span>
        <span className="block text-xs leading-relaxed text-tinta-suave">{detalhe}</span>
      </span>
    </li>
  );
}

/**
 * O DMS Graph (o produto da DMS que trata imagem e vídeo; não é a Graph API da Meta) num cartão. Só aparece quando a
 * distribuição ligou o Graph para a conta. Quem conecta e desliga é o dono; a ligação vale para a empresa inteira.
 */
export function IntegracaoDmsGraph() {
  const { sessao } = useSessao();
  const ehDono = sessao.usuario.papel === 'dono';
  const idCnpj = useId();

  const [s, setS] = useState<SituacaoDmsGraph | null>(null);
  const [erroDeLeitura, setErroDeLeitura] = useState('');
  const [erro, setErro] = useState('');
  const [indo, setIndo] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [desligando, setDesligando] = useState(false);
  const [cnpj, setCnpj] = useState('');
  const [salvandoCnpj, setSalvandoCnpj] = useState(false);
  const [aviso, setAviso] = useState('');

  const carregar = useCallback(async () => {
    setErroDeLeitura('');
    try {
      setS(await dmsGraph.situacao());
    } catch (e) {
      setErroDeLeitura(mensagemDoErro(e));
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function conectar() {
    setErro('');
    setAviso('');
    setIndo(true);
    try {
      const { url } = await dmsGraph.conectar();
      const destino = paginaDoGraph(url);
      if (!destino) throw new Error('O endereço do DMS Graph veio errado. Fale com o suporte do Regemcast.');
      window.location.assign(destino);
    } catch (e) {
      setErro(mensagemDoErro(e));
      setIndo(false);
    }
  }

  async function salvarCnpj() {
    setErro('');
    setSalvandoCnpj(true);
    try {
      await conta.atualizar({ cnpj: cnpj.trim() });
      setCnpj('');
      setAviso('CNPJ salvo.');
      await carregar();
    } catch (e) {
      setErro(mensagemDoErro(e));
    } finally {
      setSalvandoCnpj(false);
    }
  }

  async function desligar() {
    setErro('');
    setDesligando(true);
    try {
      await dmsGraph.desligar();
      setConfirmando(false);
      setAviso('DMS Graph desligado.');
      await carregar();
    } catch (e) {
      setErro(mensagemDoErro(e));
    } finally {
      setDesligando(false);
    }
  }

  if (erroDeLeitura && !s) {
    return (
      <Card>
        <EstadoErro titulo="Não deu para ler o DMS Graph" mensagem={erroDeLeitura} aoTentarDeNovo={() => void carregar()} />
      </Card>
    );
  }
  if (!s) {
    return (
      <Card>
        <Esqueleto className="h-24 w-full" />
      </Card>
    );
  }
  // Desligado para esta conta: a tela fica como sempre foi.
  if (!s.disponivel) return null;

  const ligada = s.ligacao;
  const tirado = !ligada && Boolean(s.desligadaPeloGraphEm);

  return (
    <Card>
      <CardCabecalho
        titulo="DMS Graph"
        descricao="Ajuste o vídeo do cabeçalho dos seus modelos de mensagem."
        acao={<Badge tom={ligada ? 'sucesso' : tirado ? 'erro' : 'neutro'}>{ligada ? 'Conectado' : tirado ? 'Acesso tirado' : 'Não conectado'}</Badge>}
      />
      <CardCorpo className="space-y-4">
        {aviso && <Alerta tom="sucesso">{aviso}</Alerta>}
        {erro && <Alerta tom="erro">{erro}</Alerta>}

        {ligada ? (
          <>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-tinta-suave">O que está liberado</h3>
              <ul className="mt-1 divide-y divide-borda">
                <Recurso rotulo={RECURSO.nome} detalhe={RECURSO.motivo} liberado={ligada.permissoes.includes('videos.ajustar')} />
              </ul>
            </div>
            <p className="text-xs leading-relaxed text-tinta-suave">
              Conectado desde {dia(ligada.desde)}
              {ligada.por ? ` por ${ligada.por}` : ''}
              {ligada.contaNome ? `, na conta ${ligada.contaNome} do DMS Graph` : ''}.
              {ligada.ultimoUso ? ` Último ajuste em ${dia(ligada.ultimoUso)}.` : ' Nenhum vídeo ajustado ainda.'} Use em Modelos, no cabeçalho com
              vídeo.
            </p>
            {ehDono &&
              (confirmando ? (
                <div role="alertdialog" aria-label="Desligar o DMS Graph" className="space-y-3 rounded-lg border border-erro/30 bg-erro/10 p-3">
                  <p className="text-sm text-tinta">
                    <strong>Desligar o DMS Graph do Regemcast?</strong> O Regemcast para de ajustar vídeo. Os modelos salvos continuam com a mídia que já
                    têm. A ligação de outros produtos da empresa continua.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button variante="perigo" carregando={desligando} onClick={() => void desligar()}>
                      Desligar
                    </Button>
                    <Button variante="secundario" disabled={desligando} onClick={() => setConfirmando(false)}>
                      Manter ligado
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  variante="secundario"
                  onClick={() => {
                    setAviso('');
                    setConfirmando(true);
                  }}
                >
                  Desligar
                </Button>
              ))}
          </>
        ) : (
          <>
            {tirado ? (
              <Alerta tom="erro">O acesso foi tirado no DMS Graph. O Regemcast parou de ajustar vídeo. Conecte de novo para voltar.</Alerta>
            ) : (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-tinta-suave">O que o Regemcast vai pedir ao DMS Graph</h3>
                <ul className="mt-1 divide-y divide-borda">
                  <Recurso rotulo={RECURSO.nome} detalhe={`Necessária. ${RECURSO.motivo}`} liberado />
                </ul>
              </div>
            )}
            {!ehDono ? (
              <Alerta tom="informacao">Só o dono da conta conecta o DMS Graph. Peça para essa pessoa abrir esta tela.</Alerta>
            ) : !s.contaTemCnpj ? (
              <div className="space-y-3">
                <Alerta tom="atencao">Falta o CNPJ da empresa. A conta da empresa no DMS Graph nasce pelo CNPJ. Informe uma vez.</Alerta>
                <div className="max-w-xs space-y-1.5">
                  <Label htmlFor={idCnpj}>CNPJ da empresa</Label>
                  <Input id={idCnpj} inputMode="numeric" value={cnpj} onChange={(e) => setCnpj(e.target.value)} placeholder="00.000.000/0000-00" />
                </div>
                <Button carregando={salvandoCnpj} disabled={cnpj.replace(/\D/g, '').length !== 14} onClick={() => void salvarCnpj()}>
                  Salvar CNPJ
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <Button carregando={indo} onClick={() => void conectar()}>
                  {tirado ? 'Conectar de novo' : 'Conectar ao DMS Graph'}
                </Button>
                <p className="max-w-prose text-xs leading-relaxed text-tinta-suave">
                  Abre a página do DMS Graph. Lá, você entra com o DMS ID, vê o que o Regemcast vai usar e confirma.
                </p>
              </div>
            )}
          </>
        )}
      </CardCorpo>
    </Card>
  );
}
