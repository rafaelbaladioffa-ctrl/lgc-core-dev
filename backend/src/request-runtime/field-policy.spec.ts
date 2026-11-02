import { describe, expect, it } from 'vitest';
import { fieldMode } from './field-policy.js';
const definition = {
  formAccess: { global_secret: 'hidden', readonly: 'read' },
  nodes: [
    { id: 'triage', formAccess: { document: 'hidden' } },
    { id: 'execute', formAccess: { document: 'read' } },
  ],
};
const record = {
  requesterId: 'author',
  status: 'em_triagem',
  currentQueueId: 'triage-q',
  teamMember: true,
  activities: [
    {
      nodeId: 'triage',
      queueId: 'triage-q',
      state: 'claimed',
      assigneeId: 'triager',
    },
    {
      nodeId: 'execute',
      queueId: 'exec-q',
      state: 'available',
      candidates: [{ collaboratorId: 'executor' }],
    },
  ],
};
describe('field and document policy by actor and stage', () => {
  it('does not apply a triage mask to the author or an execution candidate', () => {
    expect(fieldMode(definition, record, 'author', 'document')).toBe('read');
    expect(fieldMode(definition, record, 'triager', 'document')).toBe('hidden');
    expect(
      fieldMode(
        definition,
        { ...record, teamMember: false },
        'executor',
        'document',
      ),
    ).toBe('read');
  });
  it('preserves global hidden/read for drafts, current teams and terminal reads', () => {
    for (const status of [
      'rascunho',
      'em_triagem',
      'em_atendimento',
      'encerrada',
    ])
      for (const actor of ['author', 'triager', 'executor'])
        expect(
          fieldMode(definition, { ...record, status }, actor, 'global_secret'),
        ).toBe('hidden');
    expect(
      fieldMode(
        definition,
        { ...record, status: 'rascunho', activities: [] },
        'author',
        'readonly',
      ),
    ).toBe('read');
    expect(
      fieldMode(
        definition,
        { ...record, status: 'rascunho', activities: [] },
        'author',
        'editable',
      ),
    ).toBe('write');
    expect(
      fieldMode(
        definition,
        {
          ...record,
          status: 'encerrada',
          activities: record.activities.map((activity) => ({
            ...activity,
            state: 'completed',
          })),
        },
        'triager',
        'document',
      ),
    ).toBe('hidden');
  });
});
