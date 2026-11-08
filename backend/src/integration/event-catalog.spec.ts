import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { EVENT_FAMILIES, EVENT_TYPES, eventTypeCatalog, isKnownEventType } from './event-catalog.js';
import { PROJECT_APPROVED_EVENT } from '../projects/project-approval.service.js';
import { PROJECT_DOCUMENT_EVENT } from '../projects/project-documents.service.js';
import { PROJECT_QUOTE_REQUESTED_EVENT } from '../projects/project-quotes.service.js';
import { MATERIAL_REQUEST_APPROVED_EVENT, MATERIAL_REQUEST_CANCEL_EVENT } from '../requests/envio-material.js';

/** O catálogo é a lista que a tela de satélite oferece: todo evento gravado no outbox precisa estar nele. */

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return name.endsWith('.ts') && !name.endsWith('.spec.ts') ? [path] : [];
  });
}

/** Tipos escritos como literal em `outbox.record(tx, '<tipo>', ...)` / `.record(tx, userEventType(...))` não entram (são user.*). */
function literalEventTypes(): Set<string> {
  const found = new Set<string>();
  const pattern = /\.record\(\s*tx\s*,\s*'([a-z_]+\.[a-z_]+)'/g;
  for (const file of sourceFiles(join(__dirname, '..'))) {
    for (const match of readFileSync(file, 'utf8').matchAll(pattern)) found.add(match[1]);
  }
  return found;
}

describe('catálogo de eventos do Core', () => {
  it('contém todo evento gravado no outbox pelo código', () => {
    const emitted = [
      ...literalEventTypes(),
      PROJECT_APPROVED_EVENT,
      PROJECT_DOCUMENT_EVENT,
      PROJECT_QUOTE_REQUESTED_EVENT,
      MATERIAL_REQUEST_APPROVED_EVENT,
      MATERIAL_REQUEST_CANCEL_EVENT,
      'user.updated',
      'user.disabled',
    ];
    expect(emitted.length).toBeGreaterThan(30);
    expect(emitted.filter((type) => !isKnownEventType(type))).toEqual([]);
  });

  it('não tem tipo repetido e toda família tem rótulo', () => {
    const types = EVENT_TYPES.map((e) => e.type);
    expect(new Set(types).size).toBe(types.length);
    const families = new Set(EVENT_FAMILIES.map((f) => f.key));
    expect(eventTypeCatalog().filter((e) => !families.has(e.family))).toEqual([]);
  });

  it('resposta da API traz família e rótulo para agrupar', () => {
    expect(eventTypeCatalog().find((e) => e.type === 'job_title.deleted')).toEqual({
      type: 'job_title.deleted',
      description: 'Cargo excluído',
      family: 'job_title',
      familyLabel: 'Cargos',
    });
  });
});
