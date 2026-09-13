'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { Alerta } from '@/components/ui/alerta';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardCabecalho, CardCorpo } from '@/components/ui/card';
import { AjudaCampo, Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EmptyState } from '@/components/ui/empty-state';
import { EstadoErro } from '@/components/ui/estado-erro';
import { Spinner } from '@/components/ui/spinner';
import { mensagemDoErro } from '@/lib/api';
import { formatarDataHora } from '@/lib/formato';
import { AJUDA_SENHA, SENHA_MINIMO, erroDaSenha } from '@/lib/senha';
import { conta as servicoConta } from '@/lib/servicos';
import type { UsuarioDaConta } from '@/lib/tipos';

/**
 * Pessoas com acesso à conta.
 *
 * A lista tem TRÊS estados que não se misturam: carregando, falhou e vazia.
 * Quando a carga falha, a tela não pode cair no estado vazio — "só você por
 * aqui" seria uma afirmação falsa sobre dados que ninguém conseguiu ler.
 *
 * O erro da CARGA e o erro de uma AÇÃO também são separados: o primeiro tem
 * "Tentar de novo" (recarregar resolve), o segundo é só a resposta do servidor.
 */
export function UsuariosConta({ podeGerenciar, meuId }: { podeGerenciar: boolean; meuId: string }) {
  const [usuarios, setUsuarios] = useState<UsuarioDaConta[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [erroAcao, setErroAcao] = useState<string | null>(null);

  const [abrirForm, setAbrirForm] = useState(false);
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erroForm, setErroForm] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const [mudandoId, setMudandoId] = useState<string | null>(null);

  const carregar = useCallback(async (sinal?: AbortSignal) => {
    setCarregando(true);
    setErroCarga(null);
    try {
      const lista = await servicoConta.usuarios(sinal);
      setUsuarios(Array.isArray(lista) ? lista : []);
    } catch (falha) {
      if (falha instanceof DOMException && falha.name === 'AbortError') return;
      // Some com a lista antiga: melhor dizer "não consegui ler" do que manter
      // na tela uma foto velha como se fosse a situação de agora.
      setUsuarios([]);
      setErroCarga(mensagemDoErro(falha));
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    const controle = new AbortController();
    void carregar(controle.signal);
    return () => controle.abort();
  }, [carregar]);

  async function criar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (criando) return;
    const problema = erroDaSenha(senha);
    if (problema) {
      setErroForm(problema);
      return;
    }
    setErroForm(null);
    setCriando(true);
    try {
      // Sem `papel` no corpo: a rota cria sempre um operador e o DTO do
      // servidor não declara esse campo — mandá-lo derruba a criação com 400.
      await servicoConta.criarUsuario({
        nome: nome.trim(),
        email: email.trim(),
        senha,
      });
      setAviso('Acesso criado. Passe a senha para a pessoa e peça para trocá-la no primeiro login.');
      setNome('');
      setEmail('');
      setSenha('');
      setAbrirForm(false);
      await carregar();
    } catch (falha) {
      setErroForm(mensagemDoErro(falha));
    } finally {
      setCriando(false);
    }
  }

  async function alternarStatus(usuario: UsuarioDaConta) {
    const novo = usuario.status === 'ativo' ? 'suspenso' : 'ativo';
    setMudandoId(usuario.id);
    setErroAcao(null);
    setAviso(null);
    try {
      await servicoConta.mudarStatus(usuario.id, novo);
      setUsuarios((atual) =>
        atual.map((u) => (u.id === usuario.id ? { ...u, status: novo } : u)),
      );
      setAviso(
        novo === 'suspenso'
          ? 'Acesso de ' + usuario.nome + ' suspenso. A sessão dessa pessoa cai agora.'
          : 'Acesso de ' + usuario.nome + ' reativado.',
      );
    } catch (falha) {
      setErroAcao(mensagemDoErro(falha));
    } finally {
      setMudandoId(null);
    }
  }

  return (
    <Card>
      <CardCabecalho
        titulo="Pessoas com acesso"
        descricao="Quem entra no painel desta conta."
        acao={
          podeGerenciar ? (
            <Button
              variante={abrirForm ? 'discreto' : 'primario'}
              tamanho="sm"
              aria-expanded={abrirForm}
              aria-controls="form-novo-usuario"
              onClick={() => {
                setAbrirForm((v) => !v);
                setErroForm(null);
              }}
            >
              {abrirForm ? 'Cancelar' : 'Criar acesso'}
            </Button>
          ) : null
        }
      />

      <CardCorpo className="space-y-4">
        {aviso ? <Alerta tom="sucesso">{aviso}</Alerta> : null}
        {erroAcao ? <Alerta>{erroAcao}</Alerta> : null}

        {podeGerenciar && abrirForm ? (
          <form
            id="form-novo-usuario"
            onSubmit={criar}
            noValidate
            className="space-y-4 rounded-lg border border-borda bg-superficie-2/40 p-4"
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="novo-nome">Nome</Label>
                <Input
                  id="novo-nome"
                  required
                  autoComplete="off"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="novo-email">E-mail</Label>
                <Input
                  id="novo-email"
                  type="email"
                  inputMode="email"
                  required
                  autoComplete="off"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="nova-senha">Senha provisória</Label>
              <Input
                id="nova-senha"
                type="password"
                required
                minLength={SENHA_MINIMO}
                autoComplete="new-password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                aria-describedby="ajuda-nova-senha"
              />
              <AjudaCampo id="ajuda-nova-senha">
                {AJUDA_SENHA} A pessoa entra como operador — a conta tem um dono só.
              </AjudaCampo>
            </div>

            {erroForm ? <Alerta>{erroForm}</Alerta> : null}

            <Button type="submit" carregando={criando}>
              {criando ? 'Criando…' : 'Criar acesso'}
            </Button>
          </form>
        ) : null}

        {carregando ? (
          <p className="flex items-center gap-2 py-6 text-sm text-tinta-suave">
            <Spinner rotulo={null} />
            Carregando pessoas…
          </p>
        ) : erroCarga ? (
          <EstadoErro
            titulo="Não consegui carregar as pessoas"
            mensagem={erroCarga}
            aoTentarDeNovo={() => void carregar()}
          />
        ) : usuarios.length === 0 ? (
          <EmptyState
            titulo="Só você por aqui"
            descricao={
              podeGerenciar
                ? 'Crie um acesso para quem vai operar as campanhas com você. Cada pessoa entra com o próprio e-mail e senha.'
                : 'Ninguém mais foi cadastrado nesta conta ainda.'
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] border-collapse text-sm">
              <caption className="sr-only">
                Pessoas com acesso à conta, com papel, situação e último acesso.
              </caption>
              <thead>
                <tr className="border-b border-borda text-left text-xs uppercase tracking-wide text-tinta-suave">
                  <th scope="col" className="py-2 pr-3 font-medium">Nome</th>
                  <th scope="col" className="py-2 pr-3 font-medium">E-mail</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Papel</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Situação</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Último acesso</th>
                  {podeGerenciar ? (
                    <th scope="col" className="py-2 text-right font-medium">Ações</th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {usuarios.map((usuario) => {
                  const souEu = usuario.id === meuId;
                  return (
                    <tr key={usuario.id} className="border-b border-borda/70 last:border-0">
                      <td className="py-3 pr-3 font-medium text-tinta">
                        {usuario.nome}
                        {souEu ? <span className="ml-2 text-xs text-tinta-suave">(você)</span> : null}
                      </td>
                      <td className="py-3 pr-3 text-tinta-suave">{usuario.email}</td>
                      <td className="py-3 pr-3">
                        <Badge tom={usuario.papel === 'dono' ? 'acento' : 'neutro'}>
                          {usuario.papel === 'dono' ? 'Dono' : 'Operador'}
                        </Badge>
                      </td>
                      <td className="py-3 pr-3">
                        <Badge tom={usuario.status === 'ativo' ? 'sucesso' : 'atencao'}>
                          {usuario.status === 'ativo' ? 'Ativo' : 'Suspenso'}
                        </Badge>
                      </td>
                      <td className="numerico py-3 pr-3 text-xs text-tinta-suave">
                        {formatarDataHora(usuario.ultimoLoginEm)}
                      </td>
                      {podeGerenciar ? (
                        <td className="py-3 text-right">
                          {souEu ? (
                            <span className="text-xs text-tinta-suave">—</span>
                          ) : (
                            <Button
                              variante={usuario.status === 'ativo' ? 'perigo' : 'secundario'}
                              tamanho="sm"
                              carregando={mudandoId === usuario.id}
                              onClick={() => void alternarStatus(usuario)}
                            >
                              {usuario.status === 'ativo' ? 'Suspender' : 'Reativar'}
                            </Button>
                          )}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!podeGerenciar && !carregando && !erroCarga && usuarios.length > 0 ? (
          <p className="text-sm text-tinta-suave">
            Criar e suspender acessos é do dono da conta.
          </p>
        ) : null}
      </CardCorpo>
    </Card>
  );
}
