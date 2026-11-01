import { Global, Module } from '@nestjs/common';
import { FieldEncryptionService } from './field-encryption.service.js';

@Global()
@Module({
  providers: [FieldEncryptionService],
  exports: [FieldEncryptionService],
})
export class FieldEncryptionModule {}
