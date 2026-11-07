/** Validação pura (sem banco) do formSchema e do workflowSchema de uma versão do catálogo.
 * Devolve mensagens em pt-BR com o caminho do problema (ex.: `formSchema[2].key`).
 *
 * Escolha de projeto: `stepOrder` precisa ser único, começando em 1 e crescente (1, 2, 3...).
 * Nós paralelos se montam com UM passo `colaboradores` com vários `collaboratorIds` — e não com
 * vários passos de mesmo `stepOrder` —, o que cobre o mesmo caso e simplifica a edição. */

export const FORM_FIELD_TYPES = ['text', 'textarea', 'number', 'date', 'select', 'checkbox', 'attachment'] as const;
export const OPTIONS_SOURCES = ['projects', 'collaborators', 'clients', 'cost_centers', 'job_titles'] as const;
export const APPROVER_RULES = ['gestor_direto', 'management_level', 'colaboradores'] as const;
export const MANAGEMENT_LEVELS = ['supervisor', 'coordenador', 'gerente', 'diretor'] as const;
export const COMPLETION_RULES = ['todos', 'qualquer_um', 'n_de_m'] as const;
export const CONFIDENTIALITIES = ['interna', 'confidencial', 'restrita'] as const;
export const CATEGORY_KINDS = ['padrao', 'compra_material', 'denuncia'] as const;

export const MAX_FORM_FIELDS = 50;
export const MAX_SLA_MINUTES = 525600;
export const FIELD_KEY_REGEX = /^[a-z][a-z0-9_]{0,39}$/;
export const CATEGORY_CODE_REGEX = /^[A-Z][A-Z0-9-]{1,39}$/;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

export function validateFormSchema(schema: unknown): string[] {
  const errors: string[] = [];
  if (!Array.isArray(schema)) return ['formSchema: deve ser uma lista de campos.'];
  if (schema.length > MAX_FORM_FIELDS) errors.push(`formSchema: no máximo ${MAX_FORM_FIELDS} campos.`);
  const keys = new Set<string>();
  schema.forEach((raw, i) => {
    const at = `formSchema[${i}]`;
    if (!isObj(raw)) {
      errors.push(`${at}: campo inválido.`);
      return;
    }
    const { key, label, type, required, options, optionsSource } = raw;
    if (typeof key !== 'string' || key === '') errors.push(`${at}.key: a chave é obrigatória.`);
    else if (!FIELD_KEY_REGEX.test(key))
      errors.push(`${at}.key: use letras minúsculas, números e "_", começando por letra (até 40 caracteres).`);
    else if (keys.has(key)) errors.push(`${at}.key: a chave "${key}" está repetida.`);
    else keys.add(key);
    if (typeof label !== 'string' || label.trim().length < 1 || label.length > 120)
      errors.push(`${at}.label: o rótulo é obrigatório (até 120 caracteres).`);
    const typeOk = typeof type === 'string' && (FORM_FIELD_TYPES as readonly string[]).includes(type);
    if (!typeOk) errors.push(`${at}.type: tipo de campo inválido.`);
    if (required !== undefined && typeof required !== 'boolean') errors.push(`${at}.required: deve ser verdadeiro ou falso.`);
    const hasOptions = options !== undefined && options !== null;
    const hasSource = optionsSource !== undefined && optionsSource !== null;
    if (typeOk && type !== 'select') {
      if (hasOptions) errors.push(`${at}.options: só campos do tipo lista aceitam opções.`);
      if (hasSource) errors.push(`${at}.optionsSource: só campos do tipo lista aceitam fonte de opções.`);
    } else if (typeOk) {
      if (hasOptions && hasSource) errors.push(`${at}: informe opções OU fonte de opções, não os dois.`);
      else if (!hasOptions && !hasSource) errors.push(`${at}: campo do tipo lista exige opções ou fonte de opções.`);
      else if (hasOptions) {
        if (!Array.isArray(options) || options.length === 0) errors.push(`${at}.options: informe ao menos uma opção.`);
        else if (options.some((o) => typeof o !== 'string' || o.trim() === ''))
          errors.push(`${at}.options: as opções não podem ser vazias.`);
        else if (new Set(options as string[]).size !== options.length) errors.push(`${at}.options: há opções repetidas.`);
      } else if (typeof optionsSource !== 'string' || !(OPTIONS_SOURCES as readonly string[]).includes(optionsSource))
        errors.push(`${at}.optionsSource: fonte de opções inválida.`);
    }
  });
  return errors;
}

export function validateWorkflowSchema(schema: unknown): string[] {
  const errors: string[] = [];
  if (!Array.isArray(schema)) return ['workflowSchema: deve ser uma lista de etapas.'];
  const rules: string[] = [];
  const levels: string[] = [];
  schema.forEach((raw, i) => {
    const at = `workflowSchema[${i}]`;
    if (!isObj(raw)) {
      errors.push(`${at}: etapa inválida.`);
      return;
    }
    if (!isInt(raw.stepOrder) || raw.stepOrder < 1) errors.push(`${at}.stepOrder: deve ser um inteiro a partir de 1.`);
    else if (raw.stepOrder !== i + 1)
      errors.push(`${at}.stepOrder: as etapas devem ser numeradas em sequência a partir de 1 (esperado ${i + 1}).`);
    const rule = raw.approverRule;
    if (typeof rule !== 'string' || !(APPROVER_RULES as readonly string[]).includes(rule)) {
      errors.push(`${at}.approverRule: regra de aprovador inválida.`);
      return;
    }
    rules.push(rule);
    if (rule === 'management_level') {
      const lvl = raw.requiredLevel;
      if (typeof lvl !== 'string' || !(MANAGEMENT_LEVELS as readonly string[]).includes(lvl))
        errors.push(`${at}.requiredLevel: informe o nível (supervisor, coordenador, gerente ou diretor).`);
      else levels.push(lvl);
    } else if (raw.requiredLevel !== undefined && raw.requiredLevel !== null)
      errors.push(`${at}.requiredLevel: só vale para a regra de nível hierárquico.`);
    if (rule === 'colaboradores') {
      const ids = raw.collaboratorIds;
      if (!Array.isArray(ids) || ids.length === 0 || ids.some((x) => typeof x !== 'string' || x === ''))
        errors.push(`${at}.collaboratorIds: selecione ao menos um colaborador.`);
      else if (new Set(ids as string[]).size !== ids.length) errors.push(`${at}.collaboratorIds: há colaboradores repetidos.`);
      const cr = raw.completionRule;
      if (typeof cr !== 'string' || !(COMPLETION_RULES as readonly string[]).includes(cr))
        errors.push(`${at}.completionRule: informe a regra de conclusão (todos, qualquer_um ou n_de_m).`);
      else if (cr === 'n_de_m') {
        const total = Array.isArray(ids) ? ids.length : 0;
        if (!isInt(raw.requiredCount) || raw.requiredCount < 1 || raw.requiredCount > total)
          errors.push(`${at}.requiredCount: informe um número inteiro entre 1 e ${total}.`);
      } else if (raw.requiredCount !== undefined && raw.requiredCount !== null)
        errors.push(`${at}.requiredCount: só vale para a regra "n de m".`);
    } else {
      for (const f of ['collaboratorIds', 'completionRule', 'requiredCount'] as const)
        if (raw[f] !== undefined && raw[f] !== null) errors.push(`${at}.${f}: só vale para a regra de colaboradores específicos.`);
    }
  });
  if (rules.includes('colaboradores') && rules.some((r) => r !== 'colaboradores'))
    errors.push('workflowSchema: colaboradores específicos não podem ser misturados com gestor direto ou nível hierárquico.');
  const gestor = rules.filter((r) => r === 'gestor_direto').length;
  if (gestor > 1) errors.push('workflowSchema: o gestor direto só pode aparecer em uma etapa.');
  if (gestor > 0 && rules.includes('management_level'))
    errors.push('workflowSchema: gestor direto não pode ser misturado com cadeia por nível hierárquico.');
  const rank = (l: string) => (MANAGEMENT_LEVELS as readonly string[]).indexOf(l);
  for (let i = 1; i < levels.length; i++)
    if (rank(levels[i]) <= rank(levels[i - 1]))
      errors.push('workflowSchema: os níveis hierárquicos devem ser estritamente crescentes.');
  return errors;
}

export function validateSla(first: unknown, resolution: unknown): string[] {
  const errors: string[] = [];
  const ok = (v: unknown) => isInt(v) && v >= 1 && v <= MAX_SLA_MINUTES;
  if (!ok(first)) errors.push(`slaFirstResponseMinutes: informe minutos inteiros entre 1 e ${MAX_SLA_MINUTES}.`);
  if (!ok(resolution)) errors.push(`slaResolutionMinutes: informe minutos inteiros entre 1 e ${MAX_SLA_MINUTES}.`);
  if (ok(first) && ok(resolution) && (first as number) > (resolution as number))
    errors.push('SLA: o prazo da primeira resposta não pode ser maior que o da solução.');
  return errors;
}

export interface KindRuleInput {
  kind: string;
  confidentiality: string;
  useDynamicAuthority: boolean;
  workflowSchema: unknown;
}

/** Regras que dependem do tipo da categoria. Compra de material ignora o workflow (a aprovação
 * vem do responsável do centro de custo), então qualquer workflow válido — inclusive vazio — é aceito. */
export function validateKindRules(input: KindRuleInput): string[] {
  const errors: string[] = [];
  if (input.kind === 'compra_material') {
    if (input.useDynamicAuthority)
      errors.push('Compra de material: a aprovação vem do responsável do centro de custo; não use alçada por valor.');
  }
  if (input.kind === 'denuncia' && input.confidentiality !== 'restrita')
    errors.push('Denúncia: a confidencialidade deve ser "restrita".');
  return errors;
}

/** Validação completa de uma versão (formulário + fluxo + SLA + regras do tipo). */
export function validateVersionContent(
  input: KindRuleInput & { formSchema: unknown; slaFirstResponseMinutes: unknown; slaResolutionMinutes: unknown },
): string[] {
  return [
    ...validateFormSchema(input.formSchema),
    ...validateWorkflowSchema(input.workflowSchema),
    ...validateSla(input.slaFirstResponseMinutes, input.slaResolutionMinutes),
    ...validateKindRules(input),
  ];
}

/** Ids de colaboradores citados no fluxo (para a checagem de existência/ativo no serviço). */
export function workflowCollaboratorIds(schema: unknown): string[] {
  if (!Array.isArray(schema)) return [];
  const ids = new Set<string>();
  for (const s of schema)
    if (isObj(s) && Array.isArray(s.collaboratorIds)) for (const id of s.collaboratorIds) if (typeof id === 'string') ids.add(id);
  return [...ids];
}
