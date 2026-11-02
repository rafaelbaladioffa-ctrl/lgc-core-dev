import type { Condition, Operand, ALLOWED_PATH_PREFIXES } from './form-schema.js';
import { ALLOWED_PATH_PREFIXES as PREFIXES } from './form-schema.js';

const MAX_DEPTH = 10;
const MAX_OPS = 100;

export type ConditionContext = {
  request?: Record<string, unknown>;
  fields?: Record<string, unknown>;
  context?: Record<string, unknown>;
};

function resolvePath(
  path: string,
  ctx: ConditionContext,
): { found: boolean; value: unknown } {
  const dot = path.indexOf('.');
  if (dot < 0) return { found: false, value: undefined };
  const prefix = (path.slice(0, dot + 1)) as (typeof PREFIXES)[number];
  const key = path.slice(dot + 1);
  const obj: Record<string, unknown> | undefined =
    prefix === 'request.' ? ctx.request
    : prefix === 'fields.' ? ctx.fields
    : prefix === 'context.' ? ctx.context
    : undefined;
  if (!obj) return { found: false, value: undefined };
  return key in obj ? { found: true, value: obj[key] } : { found: false, value: undefined };
}

function resolveOperand(
  op: Operand,
  ctx: ConditionContext,
): { found: boolean; value: unknown } {
  if ('literal' in op) return { found: true, value: op.literal };
  return resolvePath((op as { path: string }).path, ctx);
}

function eval_(
  cond: Condition,
  ctx: ConditionContext,
  depth: number,
  counter: { n: number },
): boolean {
  if (depth > MAX_DEPTH) throw new Error('CONDITION_DEPTH_EXCEEDED');
  if (++counter.n > MAX_OPS) throw new Error('CONDITION_OPS_EXCEEDED');

  switch (cond.op) {
    case 'and':
      return cond.args.every((a) => eval_(a, ctx, depth + 1, counter));
    case 'or':
      return cond.args.some((a) => eval_(a, ctx, depth + 1, counter));
    case 'not':
      return !eval_(cond.arg, ctx, depth + 1, counter);
    case 'exists': {
      const { found } = resolvePath(cond.path, ctx);
      return found;
    }
    case 'in': {
      const val = resolveOperand(cond.value, ctx);
      if (!val.found) return false;
      return cond.set.some((s) => {
        const { found, value } = resolveOperand(s, ctx);
        return found && value === val.value;
      });
    }
    case 'eq':
    case 'neq':
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const left = resolveOperand(cond.left, ctx);
      const right = resolveOperand(cond.right, ctx);
      if (!left.found || !right.found) return false;
      const l = left.value;
      const r = right.value;
      if (cond.op === 'eq') return l === r;
      if (cond.op === 'neq') return l !== r;
      if (
        (typeof l !== 'number' && typeof l !== 'string') ||
        typeof l !== typeof r
      )
        return false;
      if (cond.op === 'gt') return (l as number) > (r as number);
      if (cond.op === 'gte') return (l as number) >= (r as number);
      if (cond.op === 'lt') return (l as number) < (r as number);
      if (cond.op === 'lte') return (l as number) <= (r as number);
      return false;
    }
    default:
      throw new Error(`UNKNOWN_CONDITION_OP: ${(cond as any).op}`);
  }
}

export function evaluateCondition(cond: Condition, ctx: ConditionContext): boolean {
  return eval_(cond, ctx, 0, { n: 0 });
}

export function validateConditionAst(cond: unknown, depth = 0): string[] {
  if (depth > MAX_DEPTH) return ['CONDITION_DEPTH_EXCEEDED'];
  if (!cond || typeof cond !== 'object' || Array.isArray(cond))
    return ['CONDITION_NOT_OBJECT'];
  const c = cond as Record<string, unknown>;
  const op = c.op;
  if (typeof op !== 'string') return ['CONDITION_MISSING_OP'];

  const validatePath = (path: unknown, name: string): string[] => {
    if (typeof path !== 'string') return [`${name}_NOT_STRING`];
    if (!PREFIXES.some((p) => (path as string).startsWith(p)))
      return [`${name}_INVALID_PREFIX`];
    return [];
  };

  const validateOperand = (o: unknown, name: string): string[] => {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return [`${name}_NOT_OBJECT`];
    const obj = o as Record<string, unknown>;
    if ('path' in obj) return validatePath(obj.path, name);
    if ('literal' in obj) return [];
    return [`${name}_MISSING_PATH_OR_LITERAL`];
  };

  if (op === 'and' || op === 'or') {
    if (!Array.isArray(c.args) || c.args.length === 0)
      return [`${op.toUpperCase()}_MISSING_ARGS`];
    return c.args.flatMap((a, i) =>
      validateConditionAst(a, depth + 1).map((e) => `args[${i}].${e}`),
    );
  }
  if (op === 'not') {
    if (!c.arg) return ['NOT_MISSING_ARG'];
    return validateConditionAst(c.arg, depth + 1).map((e) => `arg.${e}`);
  }
  if (op === 'exists') return validatePath(c.path, 'path');
  if (['eq', 'neq', 'gt', 'gte', 'lt', 'lte'].includes(op)) {
    return [
      ...validateOperand(c.left, 'left'),
      ...validateOperand(c.right, 'right'),
    ];
  }
  if (op === 'in') {
    if (!Array.isArray(c.set) || c.set.length === 0) return ['IN_MISSING_SET'];
    return [
      ...validateOperand(c.value, 'value'),
      ...c.set.flatMap((s, i) => validateOperand(s, `set[${i}]`)),
    ];
  }
  return [`UNKNOWN_OP_${op}`];
}
