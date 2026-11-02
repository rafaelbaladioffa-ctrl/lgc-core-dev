import { describe, expect, it } from 'vitest';
import { ValidationPipe } from '@nestjs/common';
import {
  CommandDto,
  CompleteActivityDto,
  ReasonCommandDto,
  ReassignDto,
  CreateBpmRequestDto,
  DraftPatchDto,
  AttachmentDto,
} from './dto.js';
import {
  buildCommand,
  createPayload,
  draftPayload,
  attachmentPayload,
} from '../../../frontend/src/features/requisicoes-bpm/commands.js';
const pipe = new ValidationPipe({
  whitelist: true,
  transform: true,
  forbidNonWhitelisted: true,
});
const id = 'c7c11546-10ac-4c35-8f20-c90b79aa7a91';
const meta = { expectedVersion: 7, commandKey: id, commandId: id };
describe('client producers against the production ValidationPipe and DTOs', () => {
  it.each([
    ['submit', CommandDto],
    ['claim', CommandDto],
    ['complete', CompleteActivityDto],
    ['release', ReasonCommandDto],
    ['close', ReasonCommandDto],
    ['cancel', ReasonCommandDto],
    ['reassign', ReassignDto],
  ] as const)(
    '%s contains only fields permitted by its real DTO',
    async (action, metatype) => {
      const attempt = buildCommand(
        action,
        'target',
        meta,
        'Explicit resolution or reason',
        id,
      );
      await expect(
        pipe.transform(attempt.body, { type: 'body', metatype }),
      ).resolves.toMatchObject(attempt.body);
    },
  );
  it('validates the exact create/draft/upload producers used by the API client', async () => {
    const cases = [
      [
        CreateBpmRequestDto,
        createPayload({
          categoryId: id,
          versionId: id,
          title: 'Request title',
          description: 'Description',
          fields: { flag: false, count: 0 },
          commandKey: id,
          commandId: id,
        }),
      ],
      [
        DraftPatchDto,
        draftPayload({
          ...meta,
          title: 'Edited title',
          fields: { flag: false, count: 0 },
        }),
      ],
      [
        AttachmentDto,
        attachmentPayload({
          ...meta,
          filename: 'file.pdf',
          contentBase64: Buffer.from('%PDF-1.7').toString('base64'),
          fieldKey: 'docs',
        }),
      ],
    ] as const;
    for (const [metatype, payload] of cases)
      await expect(
        pipe.transform(JSON.parse(JSON.stringify(payload)), {
          type: 'body',
          metatype,
        }),
      ).resolves.toBeDefined();
  });
  it('keeps invalid explicit resolution invalid, allowing the UI to receive a definitive rejection', async () => {
    await expect(
      pipe.transform(buildCommand('complete', 'target', meta, 'x').body, {
        type: 'body',
        metatype: CompleteActivityDto,
      }),
    ).rejects.toThrow();
  });
});
