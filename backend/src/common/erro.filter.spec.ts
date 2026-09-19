/**
 * O que o usuário lê quando algo dá errado.
 *
 * Estes testes existem por causa de um sintoma concreto: quem errava a senha
 * nove vezes na tela de login lia "ThrottlerException: Too Many Requests" —
 * texto de biblioteca, em inglês, sem dizer o que fazer. O filtro traduz os
 * status que o framework responde sozinho e guarda o original no log; e, do
 * outro lado, NÃO pode atropelar as frases que nós escrevemos.
 */
import type { ArgumentsHost } from '@nestjs/common';
import {
  BadRequestException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import { ErroFilter } from './erro.filter';

interface Resultado {
  status: number;
  corpo: { mensagem: string; detalhes?: unknown; referencia?: string };
}

function responder(excecao: unknown): Resultado {
  const capturado: Resultado = { status: 0, corpo: { mensagem: '' } };

  const json = (corpo: Resultado['corpo']) => {
    capturado.corpo = corpo;
    return undefined;
  };
  const res = {
    status: (codigo: number) => {
      capturado.status = codigo;
      return { json };
    },
  } as unknown as Response;
  const req = { method: 'POST', url: '/api/v1/auth/login' } as unknown as Request;
  const host = {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }),
  } as unknown as ArgumentsHost;

  new ErroFilter().catch(excecao, host);
  return capturado;
}

describe('ErroFilter', () => {
  let debug: jest.SpyInstance;
  let erro: jest.SpyInstance;

  beforeEach(() => {
    debug = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    erro = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    debug.mockRestore();
    erro.mockRestore();
  });

  it('corpo acima do limite vira 413 com instrução, não "erro do nosso lado"', () => {
    // O express-json lança este erro ANTES do controlador: sem tradução, a
    // importação grande morria como 500 genérico (era o caso de 1.539 contatos).
    const grande = Object.assign(new Error('request entity too large'), {
      name: 'PayloadTooLargeError',
      type: 'entity.too.large',
    });
    const avisar = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const { status, corpo } = responder(grande);

    expect(status).toBe(413);
    expect(corpo.mensagem).toMatch(/Divida o arquivo/);
    expect(corpo).not.toHaveProperty('referencia');
    avisar.mockRestore();
  });

  it('traduz o 429 do throttler e não vaza o nome da exceção', () => {
    const { status, corpo } = responder(new ThrottlerException());

    expect(status).toBe(429);
    expect(corpo.mensagem).toBe('Muitas tentativas em pouco tempo. Espere um minuto e tente de novo.');
    expect(corpo.mensagem).not.toMatch(/throttler/i);
    // O texto original não some: ele fica no log, para quem investiga.
    expect(String(debug.mock.calls[0]?.[0])).toContain('ThrottlerException');
  });

  it('traduz 404 de rota inexistente e 413 de corpo grande demais', () => {
    expect(responder(new NotFoundException('Cannot POST /api/v1/nada')).corpo.mensagem).toBe(
      'Não encontramos este endereço. Confira o link e tente de novo.',
    );
    expect(responder(new PayloadTooLargeException()).corpo.mensagem).toBe(
      'O conteúdo enviado é grande demais. Envie um arquivo menor.',
    );
  });

  it('não atropela a frase que nós escrevemos', () => {
    const { status, corpo } = responder(
      new NotFoundException('Não encontramos este usuário na sua conta.'),
    );

    expect(status).toBe(404);
    expect(corpo.mensagem).toBe('Não encontramos este usuário na sua conta.');
    // Nada foi trocado, então não há o que registrar.
    expect(debug).not.toHaveBeenCalled();
  });

  it('esconde o "should not exist" do whitelist e explica o que fazer', () => {
    const { status, corpo } = responder(
      new BadRequestException({
        statusCode: 400,
        message: ['property papel should not exist', 'property admin should not exist'],
        error: 'Bad Request',
      }),
    );

    expect(status).toBe(400);
    expect(corpo.mensagem).toBe(
      'A requisição trouxe campos que este formulário não aceita. Recarregue a página e envie de novo.',
    );
    expect(JSON.stringify(corpo)).not.toContain('should not exist');
    expect(String(debug.mock.calls[0]?.[0])).toContain('property papel should not exist');
  });

  it('mantém as mensagens de validação que dizem o que corrigir', () => {
    const { corpo } = responder(
      new BadRequestException({
        statusCode: 400,
        message: [
          'A senha precisa ter pelo menos 10 caracteres.',
          'property admin should not exist',
        ],
        error: 'Bad Request',
      }),
    );

    expect(corpo.mensagem).toBe('A senha precisa ter pelo menos 10 caracteres.');
    expect(corpo.detalhes).toEqual(['A senha precisa ter pelo menos 10 caracteres.']);
  });

  it('5xx nosso vai inteiro para o log, com a mensagem que o cliente leu', () => {
    const { status, corpo } = responder(
      new InternalServerErrorException('Não conseguimos remover este acesso agora.'),
    );

    expect(status).toBe(500);
    expect(corpo.mensagem).toBe('Não conseguimos remover este acesso agora.');
    expect(erro).toHaveBeenCalled();
  });

  it('erro que não é HttpException vira 500 com referência, sem vazar o motivo', () => {
    const { status, corpo } = responder(
      Object.assign(new Error('relation "usuario" does not exist'), { code: '42P01' }),
    );

    expect(status).toBe(500);
    expect(corpo.mensagem).toBe('Algo deu errado do nosso lado. Tente de novo em instantes.');
    expect(corpo.referencia).toHaveLength(8);
    // O motivo real (código e mensagem do Postgres) tem de estar no log, com a
    // mesma referência que o usuário viu na tela.
    const linha = String(erro.mock.calls[0]?.[0]);
    expect(linha).toContain('code 42P01');
    expect(linha).toContain(corpo.referencia as string);
  });
});
