import type { FieldDef, FormShape, FormSection } from './form-schema.js';
import { extractFields, toSections } from './form-schema.js';
import type { ConditionContext } from './condition-evaluator.js';
import { evaluateCondition } from './condition-evaluator.js';

export type FieldMode = 'hidden' | 'read' | 'write';

export interface ProjectedField {
  field: FieldDef;
  mode: FieldMode;
  required: boolean;
}

export interface ProjectedSection {
  id: string;
  title: string;
  fields: ProjectedField[];
}

/**
 * Projects a form's fields given:
 * - The form definition (flat or sectioned)
 * - A base access map (key → mode) from formAccess + node rules
 * - The current field values (for conditional visibility/required)
 * - Condition context (request metadata, etc.)
 * - Whether this is submit-mode (required check)
 */
export function projectFields(
  form: FormShape,
  accessMap: Record<string, FieldMode>,
  values: Record<string, unknown>,
  ctx: ConditionContext,
  submitMode = false,
): ProjectedSection[] {
  const sections = toSections(form);
  return sections.map((sec) => ({
    id: sec.id,
    title: sec.title,
    fields: sec.fields
      .map((f) => {
        const baseMode = accessMap[f.key] ?? 'read';
        if (baseMode === 'hidden') return null;

        // Evaluate conditional visibility
        if (f.visibleWhen) {
          try {
            if (!evaluateCondition(f.visibleWhen, { ...ctx, fields: values }))
              return null;
          } catch {
            // Condition evaluation failure → treat as hidden
            return null;
          }
        }

        let mode: FieldMode = baseMode;
        // Evaluate conditional writability
        if (f.writableWhen && mode === 'write') {
          try {
            if (!evaluateCondition(f.writableWhen, { ...ctx, fields: values }))
              mode = 'read';
          } catch {
            mode = 'read';
          }
        }

        // Required: from schema `required`/`requiredOn` + conditional
        let required = false;
        if (submitMode) {
          required =
            f.required === true ||
            (f.requiredOn ?? []).includes('submit');
          if (f.requiredWhen) {
            try {
              required = required || evaluateCondition(f.requiredWhen, { ...ctx, fields: values });
            } catch { /* ignore */ }
          }
        }

        return { field: f, mode, required } as ProjectedField;
      })
      .filter((f): f is ProjectedField => f !== null),
  }));
}

/**
 * Flat extraction helper: returns all projected fields across all sections.
 */
export function projectFieldsFlat(
  form: FormShape,
  accessMap: Record<string, FieldMode>,
  values: Record<string, unknown>,
  ctx: ConditionContext,
  submitMode = false,
): ProjectedField[] {
  return projectFields(form, accessMap, values, ctx, submitMode)
    .flatMap((s) => s.fields);
}

/**
 * Build an access map from definition formAccess + active node formAccess.
 * Keys absent from the map default to 'read' (safe: no accidental write exposure).
 */
export function buildAccessMap(
  definition: Record<string, any>,
  activeNodeIds: string[],
): Record<string, FieldMode> {
  const modeOf = (v: unknown): FieldMode | undefined =>
    v === 'hidden' || v === 'read' || v === 'write'
      ? v
      : typeof v === 'object' && v && 'details' in v
        ? modeOf((v as any).details)
        : undefined;

  const map: Record<string, FieldMode> = {};

  // Global access
  for (const [key, value] of Object.entries(definition.formAccess ?? {})) {
    const m = modeOf(value);
    if (m) map[key] = m;
  }

  // Per-node access for active nodes
  const activeSet = new Set(activeNodeIds);
  for (const node of (definition.nodes ?? []).filter((n: any) => activeSet.has(n.id))) {
    for (const [key, value] of Object.entries(node.formAccess ?? {})) {
      const m = modeOf(value);
      if (!m) continue;
      const current = map[key];
      // Most restrictive wins: hidden > read > write
      if (!current || RANK[m] > RANK[current]) map[key] = m;
    }
  }

  return map;
}

const RANK: Record<FieldMode, number> = { write: 0, read: 1, hidden: 2 };

/**
 * Returns the set of keys that are visible (not hidden) for the given access map and conditions.
 */
export function visibleKeys(
  form: FormShape,
  accessMap: Record<string, FieldMode>,
  values: Record<string, unknown>,
  ctx: ConditionContext,
): Set<string> {
  const projected = projectFieldsFlat(form, accessMap, values, ctx);
  return new Set(projected.map((p) => p.field.key));
}
