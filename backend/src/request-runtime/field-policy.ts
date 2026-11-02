export type FieldMode = 'hidden' | 'read' | 'write';
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
  const rules = relevant
    .map((a) =>
      mode(
        definition.nodes?.find((node: any) => node.id === a.nodeId)
          ?.formAccess?.[key],
      ),
    )
    .filter(Boolean);
  if (rules.includes('hidden')) return 'hidden';
  if (global === 'read' || rules.includes('read')) return 'read';
  return rules.includes('write') ? 'write' : 'read';
}
