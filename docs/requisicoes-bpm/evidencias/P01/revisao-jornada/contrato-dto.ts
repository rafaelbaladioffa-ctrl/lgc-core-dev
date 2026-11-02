import { ValidationPipe } from '../../../../../backend/node_modules/@nestjs/common/index.js';
import { CommandDto, CompleteActivityDto, ReasonCommandDto } from '../../../../../backend/src/request-runtime/dto.ts';

async function main() {
  const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });
  const body = {
    expectedVersion: 7,
    commandKey: 'a9f9327a-7cd7-4f50-9ea8-f58ce19edada',
    commandId: '3bbdc602-583c-4c39-9cbc-f5747d9c8a44',
    reason: 'Encerramento manual',
    resolution: 'Resolvido em teste',
  };
  for (const [action, metatype] of [['submit/claim', CommandDto], ['complete', CompleteActivityDto], ['close/cancel/release', ReasonCommandDto]] as const) {
    try {
      await pipe.transform(body, { type: 'body', metatype });
      console.log(JSON.stringify({ action, accepted: true }));
    } catch (error: any) {
      console.log(JSON.stringify({ action, accepted: false, response: error.getResponse() }));
    }
  }
}
void main();
