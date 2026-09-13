import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { ErroFilter } from './common/erro.filter';
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
  app.useGlobalFilters(new ErroFilter());
  app.enableShutdownHooks();

  if (env.rede.swagger) {
    const doc = new DocumentBuilder()
      .setTitle('RegemCast')
      .setDescription('API do RegemCast — disparo de WhatsApp por API oficial.')
      .setVersion('0.1.0')
      .addCookieAuth(env.sessao.cookieNome)
      .build();
    SwaggerModule.setup('api/v1/docs', app, SwaggerModule.createDocument(app, doc));
  }

  await app.listen(env.porta, '0.0.0.0');
  new Logger('Bootstrap').log(
    `RegemCast API em http://localhost:${env.porta}/api/v1` +
      (env.rede.swagger ? ` · docs em /api/v1/docs` : ''),
  );
}

bootstrap().catch((erro) => {
  // Falha de boot precisa aparecer inteira: é quase sempre env faltando.
  new Logger('Bootstrap').error(`Não subiu: ${erro?.message ?? erro}`, erro?.stack);
  process.exit(1);
});
