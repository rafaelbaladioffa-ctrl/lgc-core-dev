export type FieldMode = 'hidden' | 'read' | 'write';
import { evaluateCondition } from '../request-processes/forms/condition-evaluator.js';
const mode = (value: unknown): FieldMode | undefined =>
  value === 'hidden' || value === 'read' || value === 'write'
    ? value
    : typeof value === 'object' && value && 'details' in value
      ? mode(value.details)
      : undefined;
export function fieldMode(
  definition: Record<string, any>,
  record: {
    requesterId: string;
    status: string;
    currentQueueId?: string | null;
    activities: Array<{
      nodeId: string;
      state: string;
      assigneeId?: string | null;
      candidates?: Array<{ collaboratorId: string }>;
      queueId?: string | null;
    }>;
    teamMember: boolean;
  },
  collaboratorId: string | null | undefined,
  key: string,
  fields: Record<string, unknown> = {},
): FieldMode {
  const global = mode(definition.formAccess?.[key]);
  if (global === 'hidden') return 'hidden';
  if (record.requesterId === collaboratorId)
    return record.status === 'rascunho' ? (global ?? 'write') : 'read';
  const relevant = record.activities.filter(
    (a) =>
      a.assigneeId === collaboratorId ||
      a.candidates?.some((c) => c.collaboratorId === collaboratorId) ||
      (record.teamMember &&
        ['available', 'claimed'].includes(a.state) &&
        a.queueId === record.currentQueueId),
  );
  const rules = relevant.map((a) => {
    const node = definition.nodes?.find((candidate: any) => candidate.id === a.nodeId);
    const field = (definition.form && !Array.isArray(definition.form)
      ? definition.form.sections?.flatMap((section: any) => section.fields ?? [])
      : definition.form) ?.find((candidate: any) => candidate.key === key);
    if (field?.visibleWhen && !evaluateCondition(field.visibleWhen, { fields, context: { nodeId: a.nodeId } }))
      return 'hidden' as FieldMode;
    const configured = mode(node?.formAccess?.[key]);
    if (configured === 'write' && field?.writableWhen && !evaluateCondition(field.writableWhen, { fields, context: { nodeId: a.nodeId } }))
      return 'read' as FieldMode;
    return configured;
  }).filter(Boolean) as FieldMode[];
  if (rules.includes('hidden')) return 'hidden';
  if (global === 'read' || rules.includes('read')) return 'read';
  return rules.includes('write') ? 'write' : 'read';
}
