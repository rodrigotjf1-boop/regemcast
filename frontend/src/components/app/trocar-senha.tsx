'use client';

import { useState, type FormEvent } from 'react';

import { Alerta } from '@/components/ui/alerta';
import { Button } from '@/components/ui/button';
import { Card, CardCabecalho, CardCorpo } from '@/components/ui/card';
import { AjudaCampo, Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { mensagemDoErro } from '@/lib/api';
import { AJUDA_SENHA, SENHA_MINIMO, erroDaSenha } from '@/lib/senha';
import { auth } from '@/lib/servicos';

/**
 * Trocar a própria senha. A troca derruba TODAS as sessões, inclusive esta —
 * por isso, depois de trocar, a tela leva para a entrada com um aviso, em vez
 * de deixar o próximo clique cair num "sessão expirada" sem explicação.
 */
export function TrocarSenha() {
  const [aberto, setAberto] = useState(false);
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function trocar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (ocupado) return;
    const problema = erroDaSenha(nova);
    if (problema) {
      setErro(problema);
      return;
    }
    setErro(null);
    setOcupado(true);
    try {
      await auth.trocarSenha(atual, nova);
      window.location.replace('/entrar?senha=trocada');
    } catch (falha) {
      setErro(mensagemDoErro(falha));
      setOcupado(false);
    }
  }

  return (
    <Card>
      <CardCabecalho
        titulo="Senha"
        descricao="Trocar a senha encerra as sessões abertas em todos os aparelhos."
        acao={
          <Button
            variante={aberto ? 'discreto' : 'secundario'}
            tamanho="sm"
            aria-expanded={aberto}
            aria-controls="form-trocar-senha"
            onClick={() => {
              setAberto((v) => !v);
              setErro(null);
            }}
          >
            {aberto ? 'Cancelar' : 'Trocar senha'}
          </Button>
        }
      />
      {aberto ? (
        <CardCorpo>
          <form id="form-trocar-senha" onSubmit={trocar} noValidate className="max-w-md space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="senha-atual">Senha atual</Label>
              <Input
                id="senha-atual"
                type="password"
                autoComplete="current-password"
                required
                value={atual}
                onChange={(e) => setAtual(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="senha-nova-conta">Senha nova</Label>
              <Input
                id="senha-nova-conta"
                type="password"
                autoComplete="new-password"
                required
                minLength={SENHA_MINIMO}
                value={nova}
                onChange={(e) => setNova(e.target.value)}
                aria-describedby="ajuda-senha-nova-conta"
              />
              <AjudaCampo id="ajuda-senha-nova-conta">{AJUDA_SENHA}</AjudaCampo>
            </div>
            {erro ? <Alerta>{erro}</Alerta> : null}
            <Button type="submit" carregando={ocupado}>
              Salvar senha nova
            </Button>
          </form>
        </CardCorpo>
      ) : null}
    </Card>
  );
}
