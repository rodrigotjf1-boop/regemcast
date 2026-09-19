import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { ErroFilter } from './common/erro.filter';
import { TelemetriaService } from './modules/telemetria/telemetria.service';
import { env } from './config/env';

async function bootstrap() {
  // Tipado como Express: `set('trust proxy', ...)` é da instância do Express,
  // não da interface genérica do Nest.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Obrigatório para verificar a assinatura HMAC do webhook da Meta
    // (X-Hub-Signature-256 é calculado sobre os BYTES do corpo, não sobre o
    // JSON reserializado). Sem isto, 100% dos eventos são rejeitados — e o
    // sintoma é silencioso: a Meta só para de entregar.
    rawBody: true,
  });

  /*
   * Corpo de até 3 MB no JSON.
   *
   * O padrão do Express é 100 KB, e isso NÃO cabia a importação que a própria
   * tela promete: 5.000 contatos com nome, telefone e histórico de compra dão
   * cerca de 1 MB. Na prática a importação quebrava por volta de 800 contatos,
   * com "erro do nosso lado" — o corpo nem chegava ao controlador, então o teto
   * de 5.000 do DTO nunca era alcançado.
   *
   * O limite continua existindo (não é ilimitado) e vale para todas as rotas;
   * o teto real da importação segue sendo TETO_IMPORTACAO, conferido no DTO.
   */
  app.useBodyParser('json', { limit: '3mb' });

  app.setGlobalPrefix('api/v1');
  app.use(helmet());
  app.use(cookieParser());
  app.set('trust proxy', env.rede.trustProxy);

  app.enableCors({
    origin: env.rede.corsOrigin,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.useGlobalFilters(new ErroFilter(app.get(TelemetriaService)));
  app.enableShutdownHooks();

  if (env.rede.swagger) {
    const doc = new DocumentBuilder()
      .setTitle('Regemcast')
      .setDescription('API do Regemcast — disparo de WhatsApp por API oficial.')
      .setVersion('0.1.0')
      .addCookieAuth(env.sessao.cookieNome)
      .build();
    SwaggerModule.setup('api/v1/docs', app, SwaggerModule.createDocument(app, doc));
  }

  await app.listen(env.porta, '0.0.0.0');
  new Logger('Bootstrap').log(
    `Regemcast API em http://localhost:${env.porta}/api/v1` +
      (env.rede.swagger ? ` · docs em /api/v1/docs` : ''),
  );
}

bootstrap().catch((erro) => {
  // Falha de boot precisa aparecer inteira: é quase sempre env faltando.
  new Logger('Bootstrap').error(`Não subiu: ${erro?.message ?? erro}`, erro?.stack);
  process.exit(1);
});
