import { describe, expect, it } from 'vitest';
import { RequestProcessesService } from './request-processes.service.js';

const service = () => new RequestProcessesService({} as any, { get: () => 'true' } as any);
const base = () => ({
  format: 'axis-bpm/1', capabilities: ['human_tasks'],
  policy: { confidentiality: 'interna', requiresAcceptance: false, allowRepresentation: false, executorMayBeRequester: false, closure: { mode: 'manual' } },
  sla: { firstResponseMinutes: 10, resolutionMinutes: 20 }, form: [],
  nodes: [
    { id: 'start', type: 'start' },
    { id: 'triage_custom', type: 'human', phase: 'triage', queueId: 'q1' },
    { id: 'end', type: 'end', terminalOutcome: 'completed' },
  ],
  edges: [{ from: 'start', to: 'triage_custom' }, { from: 'triage_custom', to: 'end' }],
});

describe('P03 graph invariants', () => {
  it('accepts a triage node whose id is not triage', () => {
    expect(service().validateDefinition(base()).valid).toBe(true);
  });

  it('rejects disconnected nodes, cycles, and multiple human exits', () => {
    const definition: any = base();
    definition.nodes.push({ id: 'orphan', type: 'human', phase: 'execution', queueId: 'q2' });
    definition.edges.push({ from: 'triage_custom', to: 'start' }, { from: 'triage_custom', to: 'end' });
    const report = service().validateDefinition(definition);
    expect(report.valid).toBe(false);
    expect(report.errors.some((e: any) => e.message.includes('Ciclos'))).toBe(true);
    expect(report.errors.some((e: any) => e.message.includes('no máximo uma saída'))).toBe(true);
    expect(report.errors.some((e: any) => e.message.includes('desconectado'))).toBe(true);
  });

  it('accepts a structurally valid AND split/join and XOR conditions', () => {
    const definition: any = base();
    definition.nodes = [
      { id: 'start', type: 'start' }, { id: 'triage_custom', type: 'human', phase: 'triage', queueId: 'q1' },
      { id: 'split', type: 'gateway_and' }, { id: 'a', type: 'human', phase: 'execution', queueId: 'q2' },
      { id: 'b', type: 'human', phase: 'execution', queueId: 'q3' }, { id: 'join', type: 'gateway_and' },
      { id: 'choice', type: 'gateway_xor', conditions: [{ condition: 'fields.route == "a"', targetNodeId: 'a2' }, { targetNodeId: 'b2' }] },
      { id: 'a2', type: 'human', phase: 'execution', queueId: 'q2' }, { id: 'b2', type: 'human', phase: 'execution', queueId: 'q3' },
      { id: 'end', type: 'end', terminalOutcome: 'completed' },
    ];
    definition.edges = [
      { from: 'start', to: 'triage_custom' }, { from: 'triage_custom', to: 'split' }, { from: 'split', to: 'a' }, { from: 'split', to: 'b' },
      { from: 'a', to: 'join' }, { from: 'b', to: 'join' }, { from: 'join', to: 'choice' }, { from: 'choice', to: 'a2' }, { from: 'choice', to: 'b2' },
      { from: 'a2', to: 'end' }, { from: 'b2', to: 'end' },
    ];
    expect(service().validateDefinition(definition).valid).toBe(true);
  });
});
