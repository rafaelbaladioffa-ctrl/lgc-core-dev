import type { FieldDef, FormShape, RepeatableColumn } from './form-schema.js';
import { extractFields, FIELD_TYPES } from './form-schema.js';
import { validateConditionAst } from './condition-evaluator.js';

const DECIMAL_RE = /^-?\d{1,15}(\.\d{1,4})?$/;
const MONEY_AMOUNT_RE = /^\d{1,15}(\.\d{1,2})?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const FIELD_KEY_RE = /^[a-z][a-z0-9_]{0,63}$/;

function isValidDate(v: string): boolean {
  const [y, m, d] = v.split('-').map(Number);
  const p = new Date(Date.UTC(y, m - 1, d));
  return (
    p.getUTCFullYear() === y && p.getUTCMonth() === m - 1 && p.getUTCDate() === d
  );
}

// Validate a single field value. Returns an error string or null.
function validateFieldValue(
  f: FieldDef,
  value: unknown,
  submitMode: boolean,
): string | null {
  if (value === undefined || value === null) return null;

  switch (f.type) {
    case 'text':
    case 'textarea': {
      if (typeof value !== 'string') return 'Tipo inválido: esperado string';
      if (f.maxLength && value.length > f.maxLength)
        return 'Valor excede o limite do campo';
      return null;
    }
    case 'integer': {
      if (typeof value !== 'number' || !Number.isSafeInteger(value))
        return 'Tipo inválido: esperado inteiro';
      const fi = f as import('./form-schema.js').IntegerField;
      if (fi.min !== undefined && value < fi.min) return 'Valor abaixo do mínimo';
      if (fi.max !== undefined && value > fi.max) return 'Valor acima do máximo';
      return null;
    }
    case 'decimal': {
      const text =
        typeof value === 'number' && Number.isFinite(value)
          ? String(value)
          : typeof value === 'string'
            ? value
            : '';
      if (!DECIMAL_RE.test(text)) return 'Tipo inválido: decimal esperado';
      return null;
    }
    case 'boolean': {
      if (typeof value !== 'boolean') return 'Tipo inválido: esperado boolean';
      const fb = f as import('./form-schema.js').BooleanField;
      if (fb.mustBeTrue && !value) return 'Este campo deve ser verdadeiro';
      return null;
    }
    case 'date': {
      if (typeof value !== 'string' || !DATE_RE.test(value) || !isValidDate(value))
        return 'Tipo inválido: esperado data YYYY-MM-DD';
      return null;
    }
    case 'select': {
      if (typeof value !== 'string') return 'Tipo inválido: esperado string';
      const fs = f as import('./form-schema.js').SelectField;
      if (fs.options && fs.options.length > 0) {
        const valid = fs.options.some((o) =>
          typeof o === 'string' ? o === value : o.id === value,
        );
        if (!valid) return 'Opção inválida';
      }
      return null;
    }
    case 'attachment': {
      if (!Array.isArray(value) || !value.every((id) => typeof id === 'string'))
        return 'Tipo inválido: esperado array de IDs';
      const fa = f as import('./form-schema.js').AttachmentField;
      if (fa.minItems !== undefined && value.length < fa.minItems)
        return `Mínimo ${fa.minItems} anexo(s)`;
      if (fa.maxItems !== undefined && value.length > fa.maxItems)
        return `Máximo ${fa.maxItems} anexo(s)`;
      return null;
    }
    case 'money': {
      if (
        typeof value !== 'object' ||
        value === null ||
        Array.isArray(value)
      )
        return 'Tipo inválido: esperado { amount: string, currency: string }';
      const m = value as Record<string, unknown>;
      if (typeof m.amount !== 'string' || !MONEY_AMOUNT_RE.test(m.amount))
        return 'Valor monetário inválido';
      if (typeof m.currency !== 'string' || m.currency.length !== 3)
        return 'Moeda inválida (esperado código ISO de 3 letras)';
      return null;
    }
    case 'reference': {
      if (typeof value !== 'string' || !value.trim())
        return 'Tipo inválido: esperado ID de referência';
      return null;
    }
    case 'repeatable_table': {
      if (!Array.isArray(value)) return 'Tipo inválido: esperado array';
      const ft = f as import('./form-schema.js').RepeatableTableField;
      if (ft.minRows !== undefined && value.length < ft.minRows)
        return `Mínimo ${ft.minRows} linha(s)`;
      if (ft.maxRows !== undefined && value.length > ft.maxRows)
        return `Máximo ${ft.maxRows} linha(s)`;
      for (const [ri, row] of value.entries()) {
        if (!row || typeof row !== 'object' || Array.isArray(row))
          return `Linha ${ri}: deve ser um objeto`;
        const rowObj = row as Record<string, unknown>;
        for (const col of ft.columns) {
          const cellVal = rowObj[col.key];
          const colErr = validateColumnValue(col, cellVal, submitMode);
          if (colErr) return `Linha ${ri}, coluna "${col.key}": ${colErr}`;
        }
      }
      return null;
    }
    default:
      return 'Tipo desconhecido';
  }
}

function validateColumnValue(
  col: RepeatableColumn,
  value: unknown,
  submitMode: boolean,
): string | null {
  if (value === undefined || value === null) {
    if (submitMode && col.required) return 'Coluna obrigatória';
    return null;
  }
  const fakeField = { ...col, required: false } as unknown as FieldDef;
  return validateFieldValue(fakeField, value, submitMode);
}

export interface ValidationErrors {
  [key: string]: string;
}

/**
 * Validates field values against the form schema.
 * `submitMode = true` enforces required fields.
 * Returns errors map (empty = valid).
 */
export function validateFormValues(
  form: FormShape,
  values: Record<string, unknown>,
  submitMode = false,
): ValidationErrors {
  const fields = extractFields(form);
  const errors: ValidationErrors = {};
  const allowed = new Set(fields.map((f) => f.key));

  for (const key of Object.keys(values))
    if (!allowed.has(key)) errors[key] = 'Campo desconhecido';

  for (const f of fields) {
    const value = values[f.key];
    if (value !== undefined && value !== null) {
      const err = validateFieldValue(f, value, submitMode);
      if (err) errors[f.key] = err;
    }
    if (submitMode) {
      const missing =
        value === undefined ||
        value === null ||
        (typeof value === 'string' && value.trim() === '') ||
        (Array.isArray(value) && value.length === 0);
      if (missing && (f.required || (f.requiredOn ?? []).includes('submit')))
        errors[f.key] = 'Campo obrigatório';
    }
  }
  return errors;
}

// --- Schema structure validation (used by request-processes service) ---

export interface SchemaError {
  path: string;
  message: string;
}

function validateField(f: Record<string, unknown>, path: string): SchemaError[] {
  const errors: SchemaError[] = [];
  if (typeof f.key !== 'string' || !FIELD_KEY_RE.test(f.key))
    errors.push({ path: `${path}.key`, message: 'Chave inválida' });
  if (typeof f.label !== 'string' || !(f.label as string).trim())
    errors.push({ path: `${path}.label`, message: 'Label obrigatório' });
  if (typeof f.type !== 'string' || !FIELD_TYPES.has(f.type))
    errors.push({ path: `${path}.type`, message: 'Tipo não suportado' });

  if (f.type === 'select') {
    const opts = f.options as unknown;
    if (
      !Array.isArray(opts) ||
      opts.length === 0 ||
      opts.some(
        (o: unknown) =>
          typeof o !== 'string' &&
          (!o || typeof (o as any).id !== 'string' || typeof (o as any).label !== 'string'),
      )
    )
      errors.push({ path: `${path}.options`, message: 'Select exige opções válidas' });
  }
  if (
    f.maxLength !== undefined &&
    (!Number.isInteger(f.maxLength) || (f.maxLength as number) < 1 || (f.maxLength as number) > 10000)
  )
    errors.push({ path: `${path}.maxLength`, message: 'Limite de texto inválido' });

  if (f.type === 'repeatable_table') {
    const cols = f.columns as unknown;
    if (!Array.isArray(cols) || cols.length === 0)
      errors.push({ path: `${path}.columns`, message: 'Tabela exige ao menos uma coluna' });
    else {
      const colKeys = new Set<string>();
      for (const [ci, col] of (cols as unknown[]).entries()) {
        if (!col || typeof col !== 'object' || Array.isArray(col)) {
          errors.push({ path: `${path}.columns[${ci}]`, message: 'Coluna inválida' });
          continue;
        }
        const c = col as Record<string, unknown>;
        if (typeof c.key !== 'string' || !FIELD_KEY_RE.test(c.key))
          errors.push({ path: `${path}.columns[${ci}].key`, message: 'Chave de coluna inválida' });
        else if (colKeys.has(c.key as string))
          errors.push({ path: `${path}.columns[${ci}].key`, message: 'Chave de coluna duplicada' });
        else colKeys.add(c.key as string);
        if (typeof c.label !== 'string' || !(c.label as string).trim())
          errors.push({ path: `${path}.columns[${ci}].label`, message: 'Label de coluna obrigatório' });
        if (
          typeof c.type !== 'string' ||
          !FIELD_TYPES.has(c.type) ||
          c.type === 'repeatable_table' ||
          c.type === 'attachment'
        )
          errors.push({ path: `${path}.columns[${ci}].type`, message: 'Tipo de coluna inválido' });
      }
    }
  }
  if (f.type === 'reference') {
    const src = f.source as unknown;
    if (!src || typeof src !== 'object' || typeof (src as any).key !== 'string')
      errors.push({ path: `${path}.source`, message: 'Reference exige source.key' });
  }

  for (const condKey of ['visibleWhen', 'requiredWhen', 'writableWhen']) {
    if (f[condKey] !== undefined) {
      const condErrs = validateConditionAst(f[condKey]);
      for (const e of condErrs)
        errors.push({ path: `${path}.${condKey}.${e}`, message: 'Condição inválida' });
    }
  }
  return errors;
}

export function validateFormSchema(
  form: unknown,
  maxFields = 200,
): SchemaError[] {
  const errors: SchemaError[] = [];

  if (Array.isArray(form)) {
    if (form.length > maxFields) {
      errors.push({ path: 'form', message: 'Formulário excede o limite de campos' });
      return errors;
    }
    const keys = new Set<string>();
    for (const [i, f] of form.entries()) {
      if (!f || typeof f !== 'object' || Array.isArray(f)) {
        errors.push({ path: `form[${i}]`, message: 'Campo inválido' });
        continue;
      }
      const fd = f as Record<string, unknown>;
      if (typeof fd.key === 'string') {
        if (keys.has(fd.key))
          errors.push({ path: `form[${i}].key`, message: 'Chave duplicada' });
        keys.add(fd.key);
      }
      errors.push(...validateField(fd, `form[${i}]`));
    }
    return errors;
  }

  if (
    !form ||
    typeof form !== 'object' ||
    !('sections' in (form as object)) ||
    !Array.isArray((form as any).sections)
  ) {
    errors.push({ path: 'form', message: 'Formulário inválido (array ou {sections:[]} esperado)' });
    return errors;
  }

  const sections = (form as { sections: unknown[] }).sections;
  const keys = new Set<string>();
  let totalFields = 0;

  for (const [si, sec] of sections.entries()) {
    if (!sec || typeof sec !== 'object' || Array.isArray(sec)) {
      errors.push({ path: `form.sections[${si}]`, message: 'Seção inválida' });
      continue;
    }
    const s = sec as Record<string, unknown>;
    if (typeof s.id !== 'string' || !(s.id as string).trim())
      errors.push({ path: `form.sections[${si}].id`, message: 'ID de seção obrigatório' });
    if (typeof s.title !== 'string')
      errors.push({ path: `form.sections[${si}].title`, message: 'Título de seção obrigatório' });
    if (!Array.isArray(s.fields)) {
      errors.push({ path: `form.sections[${si}].fields`, message: 'Fields deve ser array' });
      continue;
    }
    for (const [fi, f] of (s.fields as unknown[]).entries()) {
      if (!f || typeof f !== 'object' || Array.isArray(f)) {
        errors.push({ path: `form.sections[${si}].fields[${fi}]`, message: 'Campo inválido' });
        continue;
      }
      const fd = f as Record<string, unknown>;
      if (typeof fd.key === 'string') {
        if (keys.has(fd.key))
          errors.push({ path: `form.sections[${si}].fields[${fi}].key`, message: 'Chave duplicada' });
        keys.add(fd.key);
      }
      errors.push(...validateField(fd, `form.sections[${si}].fields[${fi}]`));
      totalFields++;
    }
  }
  if (totalFields > maxFields)
    errors.push({ path: 'form', message: 'Formulário excede o limite de campos' });
  return errors;
}
