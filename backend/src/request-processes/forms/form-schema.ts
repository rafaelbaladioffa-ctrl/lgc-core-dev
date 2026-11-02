// TypeScript types for axis-bpm/1 form schema (P02+).
// Backward-compatible: P01 definitions use a flat FieldDef[] as `form`.
// P02 definitions may use { sections: FormSection[] } as `form`.

export type FieldType =
  | 'text'
  | 'textarea'
  | 'integer'
  | 'decimal'
  | 'date'
  | 'select'
  | 'boolean'
  | 'attachment'
  | 'money'
  | 'reference'
  | 'repeatable_table';

export const FIELD_TYPES: ReadonlySet<string> = new Set<FieldType>([
  'text', 'textarea', 'integer', 'decimal', 'date',
  'select', 'boolean', 'attachment', 'money', 'reference', 'repeatable_table',
]);

export interface SelectOption {
  id: string;
  label: string;
}

export interface FieldBinding {
  key: string;
}

interface BaseFieldDef {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  requiredOn?: Array<'submit' | 'complete'>;
  help?: string;
  maxLength?: number;
  visibleWhen?: Condition;
  requiredWhen?: Condition;
  writableWhen?: Condition;
}

export interface TextField extends BaseFieldDef { type: 'text'; }
export interface TextareaField extends BaseFieldDef { type: 'textarea'; }
export interface IntegerField extends BaseFieldDef {
  type: 'integer';
  min?: number;
  max?: number;
}
export interface DecimalField extends BaseFieldDef {
  type: 'decimal';
  min?: string;
  max?: string;
}
export interface DateField extends BaseFieldDef {
  type: 'date';
  minDate?: string;
  maxDate?: string;
}
export interface SelectField extends BaseFieldDef {
  type: 'select';
  options?: Array<SelectOption | string>;
  source?: FieldBinding;
}
export interface BooleanField extends BaseFieldDef {
  type: 'boolean';
  mustBeTrue?: boolean;
}
export interface AttachmentField extends BaseFieldDef {
  type: 'attachment';
  minItems?: number;
  maxItems?: number;
}
export interface MoneyField extends BaseFieldDef {
  type: 'money';
  currency?: string;
  min?: string;
  max?: string;
  binding?: 'request.estimatedValue';
}
export interface ReferenceField extends BaseFieldDef {
  type: 'reference';
  source: FieldBinding;
  binding?: 'request.costCenterId' | 'request.projectId';
}

export interface RepeatableColumn {
  key: string;
  label: string;
  type: Exclude<FieldType, 'repeatable_table'>;
  required?: boolean;
  maxLength?: number;
  min?: number | string;
  max?: number | string;
  options?: Array<SelectOption | string>;
  source?: FieldBinding;
}

export interface RepeatableTableField extends BaseFieldDef {
  type: 'repeatable_table';
  columns: RepeatableColumn[];
  minRows?: number;
  maxRows?: number;
}

export type FieldDef =
  | TextField
  | TextareaField
  | IntegerField
  | DecimalField
  | DateField
  | SelectField
  | BooleanField
  | AttachmentField
  | MoneyField
  | ReferenceField
  | RepeatableTableField;

export interface FormSection {
  id: string;
  title: string;
  order?: number;
  fields: FieldDef[];
}

export type FormShape =
  | FieldDef[]
  | { sections: FormSection[] };

export function extractFields(form: FormShape): FieldDef[] {
  if (Array.isArray(form)) return form;
  return form.sections
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .flatMap((s) => s.fields);
}

export function toSections(form: FormShape): FormSection[] {
  if (Array.isArray(form)) {
    return [{ id: 'main', title: '', fields: form }];
  }
  return form.sections
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

// --- Condition AST types ---

export type Operand = { path: string } | { literal: unknown };

export type Condition =
  | { op: 'and'; args: Condition[] }
  | { op: 'or'; args: Condition[] }
  | { op: 'not'; arg: Condition }
  | { op: 'exists'; path: string }
  | { op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'; left: Operand; right: Operand }
  | { op: 'in'; value: Operand; set: Operand[] };

export const ALLOWED_PATH_PREFIXES = ['request.', 'fields.', 'context.'] as const;
