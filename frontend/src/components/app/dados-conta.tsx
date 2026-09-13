'use client';

import { useState, type FormEvent } from 'react';

import { Alerta } from '@/components/ui/alerta';
import { Button } from '@/components/ui/button';
import { Card, CardCabecalho, CardCorpo } from '@/components/ui/card';
import { AjudaCampo, Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { mensagemDoErro } from '@/lib/api';
import { conta as servicoConta } from '@/lib/servicos';
import { FUSOS } from '@/lib/timezones';
import type { Conta } from '@/lib/tipos';

export function DadosConta({
  conta,
  podeEditar,
  aoSalvar,
}: {
  conta: Conta;
  podeEditar: boolean;
  aoSalvar: (atualizada: Conta) => void;
}) {
  const [nome, setNome] = useState(conta.nome);
  const [timezone, setTimezone] = useState(conta.timezone);
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const mudou = nome.trim() !== conta.nome || timezone !== conta.timezone;
  // Fuso gravado que não está na lista (conta antiga, migração) continua
  // aparecendo — melhor do que trocar o valor do usuário sem ele pedir.
  const fusoForaDaLista = !FUSOS.some((f) => f.valor === timezone);

  async function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (salvando || !mudou) return;
    setErro(null);
    setSalvo(false);
    setSalvando(true);
    try {
      // `PATCH /conta` devolve a conta atualizada (ContaDados), e não o resumo
      // inteiro: quem manda é a resposta do servidor, que já vem normalizada.
      const atualizada = await servicoConta.atualizar({ nome: nome.trim(), timezone });
      aoSalvar(atualizada);
      setSalvo(true);
    } catch (falha) {
      setErro(mensagemDoErro(falha));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Card>
      <CardCabecalho
        titulo="Dados da conta"
        descricao="O fuso define a virada do ciclo e a janela de envio das campanhas."
      />
      <CardCorpo>
        <form onSubmit={enviar} noValidate className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="conta-nome">Nome da empresa</Label>
              <Input
                id="conta-nome"
                name="nome"
                required
                value={nome}
                disabled={!podeEditar}
                onChange={(e) => {
                  setNome(e.target.value);
                  setSalvo(false);
                }}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="conta-timezone">Fuso horário</Label>
              <Select
                id="conta-timezone"
                name="timezone"
                value={timezone}
                disabled={!podeEditar}
                onChange={(e) => {
                  setTimezone(e.target.value);
                  setSalvo(false);
                }}
              >
                {fusoForaDaLista ? <option value={timezone}>{timezone}</option> : null}
                {FUSOS.map((fuso) => (
                  <option key={fuso.valor} value={fuso.valor}>
                    {fuso.rotulo}
                  </option>
                ))}
              </Select>
              <AjudaCampo>Horário de referência: {timezone}.</AjudaCampo>
            </div>
          </div>

          {erro ? <Alerta>{erro}</Alerta> : null}
          {salvo && !erro ? <Alerta tom="sucesso">Dados da conta atualizados.</Alerta> : null}

          {podeEditar ? (
            <div className="flex flex-wrap gap-2">
              <Button type="submit" carregando={salvando} disabled={!mudou}>
                {salvando ? 'Salvando…' : 'Salvar alterações'}
              </Button>
              {mudou && !salvando ? (
                <Button
                  variante="discreto"
                  onClick={() => {
                    setNome(conta.nome);
                    setTimezone(conta.timezone);
                    setErro(null);
                  }}
                >
                  Descartar
                </Button>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-tinta-suave">
              Só o dono da conta altera estes dados. Fale com quem administra a sua empresa.
            </p>
          )}
        </form>
      </CardCorpo>
    </Card>
  );
}
