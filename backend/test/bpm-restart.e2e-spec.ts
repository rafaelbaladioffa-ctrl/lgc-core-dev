import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { requireBpmTestDatabaseUrl } from './support/bpm-test-database.js';

describe.skipIf(!process.env.BPM_TEST_DATABASE_URL)('BPM process restart persistence', () => {
  const worker = resolve(process.cwd(), 'test/support/bpm-restart-worker.ts');
  const tsx = resolve(process.cwd(), 'node_modules/tsx/dist/cli.mjs');
  const run = (phase: 'one' | 'two', fixture?: unknown) => new Promise<any>((resolveResult, reject) => {
    const child = spawn(process.execPath, [tsx, worker], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        BPM_TEST_DATABASE_URL: requireBpmTestDatabaseUrl(),
        BPM_RESTART_PHASE: phase,
        ...(fixture ? { BPM_RESTART_FIXTURE: JSON.stringify(fixture) } : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`restart worker ${phase} exited ${code}: ${stderr}`));
      try {
        resolveResult(JSON.parse(stdout.trim().split(/\r?\n/).at(-1) ?? ''));
      } catch (error) {
        reject(new Error(`restart worker ${phase} returned invalid JSON: ${stdout}\n${stderr}`, { cause: error }));
      }
    });
  });

  it('persists activity, assignee, lock version and SLA across independent Node processes', async () => {
    const phaseOne = await run('one');
    expect(phaseOne.activityState).toBe('claimed');
    expect(phaseOne.assigneeId).toBe(phaseOne.collaboratorId);
    expect(phaseOne.clocks).toHaveLength(2);
    expect(phaseOne.clocks.map((clock: any) => clock.metric)).toEqual(['first_response', 'resolution']);
    expect(phaseOne.clocks.every((clock: any) => clock.budgetSeconds > 0 && clock.targetAt)).toBe(true);

    const phaseTwo = await run('two', phaseOne);
    expect(phaseTwo.before).toMatchObject({
      lockVersion: phaseOne.lockVersion,
      assigneeId: phaseOne.collaboratorId,
      state: 'claimed',
    });
    expect(phaseTwo.after.lockVersion).toBeGreaterThan(phaseTwo.before.lockVersion);
    expect(phaseTwo.after.assigneeId).toBe(phaseOne.collaboratorId);
    expect(phaseTwo.after.state).toBe('completed');
    expect(phaseTwo.after.status).toBe('em_atendimento');
    expect(phaseTwo.before.clocks).toEqual(phaseOne.clocks);
    expect(phaseTwo.after.clocks).toHaveLength(2);
    expect(phaseTwo.after.clocks.map((clock: any) => clock.metric)).toEqual(['first_response', 'resolution']);
    expect(phaseTwo.after.clocks.every((clock: any) => clock.budgetSeconds > 0 && clock.targetAt)).toBe(true);
  }, 60000);
});
