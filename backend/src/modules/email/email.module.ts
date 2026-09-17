import { Global, Module } from '@nestjs/common';

import { EmailService } from './email.service';

/**
 * Global, como a telemetria: e-mail é consumido por quem precisa avisar alguém
 * (convite, código de login), não é uma feature com tela própria.
 */
@Global()
@Module({
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
