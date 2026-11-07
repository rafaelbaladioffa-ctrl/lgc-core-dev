import { describe, expect, it } from 'vitest';
import {
  validateFormSchema,
  validateKindRules,
  validateSla,
  validateVersionContent,
  validateWorkflowSchema,
  workflowCollaboratorIds,
} from './category-schema.validator.js';

const field = (over: Record<string, unknown> = {}) => ({ key: 'campo', label: 'Campo', type: 'text', ...over });

describe('validateFormSchema', () => {
  it('aceita formulário válido (inclusive vazio)', () => {
    expect(validateFormSchema([])).toEqual([]);
    expect(
      validateFormSchema([
        field({ required: true }),
        field({ key: 'opcoes', type: 'select', options: ['A', 'B'] }),
        field({ key: 'fonte', type: 'select', optionsSource: 'projects' }),
      ]),
    ).toEqual([]);
  });

  it('rejeita o que não é lista e mais de 50 campos', () => {
    expect(validateFormSchema({})).toHaveLength(1);
    const many = Array.from({ length: 51 }, (_, i) => field({ key: `c${i}` }));
    expect(validateFormSchema(many).join()).toContain('no máximo 50');
  });

  it('valida chave: obrigatória, formato e unicidade', () => {
    expect(validateFormSchema([field({ key: '' })])[0]).toContain('formSchema[0].key');
    expect(validateFormSchema([field({ key: 'Maiuscula' })])[0]).toContain('formSchema[0].key');
    expect(validateFormSchema([field({ key: '1abc' })])).toHaveLength(1);
    expect(validateFormSchema([field({ key: 'a'.repeat(41) })])).toHaveLength(1);
    expect(validateFormSchema([field(), field()])[0]).toContain('formSchema[1].key');
  });

  it('valida rótulo, tipo e required', () => {
    expect(validateFormSchema([field({ label: '' })])[0]).toContain('label');
    expect(validateFormSchema([field({ label: 'x'.repeat(121) })])[0]).toContain('label');
    expect(validateFormSchema([field({ type: 'foo' })])[0]).toContain('type');
    expect(validateFormSchema([field({ required: 'sim' })])[0]).toContain('required');
  });

  it('select exige options ou optionsSource, nunca os dois', () => {
    expect(validateFormSchema([field({ type: 'select' })])[0]).toContain('exige opções');
    expect(validateFormSchema([field({ type: 'select', options: [] })])[0]).toContain('ao menos uma');
    expect(validateFormSchema([field({ type: 'select', options: ['A', ''] })])[0]).toContain('vazias');
    expect(validateFormSchema([field({ type: 'select', options: ['A', 'A'] })])[0]).toContain('repetidas');
    expect(validateFormSchema([field({ type: 'select', options: ['A'], optionsSource: 'projects' })])[0]).toContain('OU');
    expect(validateFormSchema([field({ type: 'select', optionsSource: 'x' })])[0]).toContain('fonte');
  });

  it('options/optionsSource só em select', () => {
    expect(validateFormSchema([field({ options: ['A'] })])[0]).toContain('options');
    expect(validateFormSchema([field({ optionsSource: 'clients' })])[0]).toContain('optionsSource');
  });
});

describe('validateWorkflowSchema', () => {
  const colab = (over: Record<string, unknown> = {}) => ({
    stepOrder: 1,
    approverRule: 'colaboradores',
    collaboratorIds: ['a', 'b'],
    completionRule: 'todos',
    ...over,
  });

  it('aceita vazio, gestor direto, cadeia crescente e colaboradores', () => {
    expect(validateWorkflowSchema([])).toEqual([]);
    expect(validateWorkflowSchema([{ stepOrder: 1, approverRule: 'gestor_direto' }])).toEqual([]);
    expect(
      validateWorkflowSchema([
        { stepOrder: 1, approverRule: 'management_level', requiredLevel: 'supervisor' },
        { stepOrder: 2, approverRule: 'management_level', requiredLevel: 'gerente' },
      ]),
    ).toEqual([]);
    expect(validateWorkflowSchema([colab({ completionRule: 'n_de_m', requiredCount: 2 })])).toEqual([]);
  });

  it('exige stepOrder inteiro, sem buracos, a partir de 1', () => {
    expect(validateWorkflowSchema([{ stepOrder: 0, approverRule: 'gestor_direto' }])[0]).toContain('stepOrder');
    expect(validateWorkflowSchema([{ stepOrder: 1.5, approverRule: 'gestor_direto' }])[0]).toContain('stepOrder');
    expect(validateWorkflowSchema([{ stepOrder: 2, approverRule: 'gestor_direto' }])[0]).toContain('esperado 1');
    expect(validateWorkflowSchema([colab(), colab({ stepOrder: 1 })])[0]).toContain('workflowSchema[1].stepOrder');
  });

  it('management_level exige nível válido e estritamente crescente', () => {
    expect(validateWorkflowSchema([{ stepOrder: 1, approverRule: 'management_level' }])[0]).toContain('requiredLevel');
    expect(
      validateWorkflowSchema([{ stepOrder: 1, approverRule: 'management_level', requiredLevel: 'colaborador' }])[0],
    ).toContain('requiredLevel');
    const repetido = validateWorkflowSchema([
      { stepOrder: 1, approverRule: 'management_level', requiredLevel: 'gerente' },
      { stepOrder: 2, approverRule: 'management_level', requiredLevel: 'gerente' },
    ]);
    expect(repetido.join()).toContain('estritamente crescentes');
  });

  it('gestor_direto no máximo 1 e sem misturar com management_level', () => {
    expect(
      validateWorkflowSchema([
        { stepOrder: 1, approverRule: 'gestor_direto' },
        { stepOrder: 2, approverRule: 'gestor_direto' },
      ]).join(),
    ).toContain('só pode aparecer em uma etapa');
    expect(
      validateWorkflowSchema([
        { stepOrder: 1, approverRule: 'gestor_direto' },
        { stepOrder: 2, approverRule: 'management_level', requiredLevel: 'gerente' },
      ]).join(),
    ).toContain('não pode ser misturado');
  });

  it('colaboradores: lista, duplicatas, regra de conclusão, n_de_m e mistura', () => {
    expect(validateWorkflowSchema([colab({ collaboratorIds: [] })])[0]).toContain('collaboratorIds');
    expect(validateWorkflowSchema([colab({ collaboratorIds: ['a', 'a'] })])[0]).toContain('repetidos');
    expect(validateWorkflowSchema([colab({ completionRule: undefined })])[0]).toContain('completionRule');
    expect(validateWorkflowSchema([colab({ completionRule: 'n_de_m' })])[0]).toContain('requiredCount');
    expect(validateWorkflowSchema([colab({ completionRule: 'n_de_m', requiredCount: 3 })])[0]).toContain('entre 1 e 2');
    expect(validateWorkflowSchema([colab({ completionRule: 'n_de_m', requiredCount: 0 })])[0]).toContain('requiredCount');
    expect(
      validateWorkflowSchema([{ stepOrder: 1, approverRule: 'gestor_direto' }, colab({ stepOrder: 2 })]).join(),
    ).toContain('misturados');
  });

  it('rejeita o que não é lista', () => {
    expect(validateWorkflowSchema('x')).toHaveLength(1);
  });

  it('lista os ids de colaboradores do fluxo', () => {
    expect(workflowCollaboratorIds([colab(), { stepOrder: 2, approverRule: 'gestor_direto' }])).toEqual(['a', 'b']);
  });
});

describe('validateSla', () => {
  it('aceita 1 <= primeira <= solução <= 525600', () => {
    expect(validateSla(1, 1)).toEqual([]);
    expect(validateSla(240, 525600)).toEqual([]);
  });
  it('rejeita fora do intervalo, não inteiros e primeira > solução', () => {
    expect(validateSla(0, 10)[0]).toContain('slaFirstResponseMinutes');
    expect(validateSla(10, 525601)[0]).toContain('slaResolutionMinutes');
    expect(validateSla(1.5, 10)).toHaveLength(1);
    expect(validateSla('1', 10)).toHaveLength(1);
    expect(validateSla(100, 50)[0]).toContain('primeira resposta');
  });
});

describe('validateKindRules', () => {
  const base = { kind: 'padrao', confidentiality: 'interna', useDynamicAuthority: false, workflowSchema: [] };
  it('compra_material aceita workflow vazio e rejeita alçada por valor', () => {
    expect(validateKindRules({ ...base, kind: 'compra_material' })).toEqual([]);
    expect(validateKindRules({ ...base, kind: 'compra_material', useDynamicAuthority: true })[0]).toContain('alçada');
  });
  it('denuncia exige confidencialidade restrita', () => {
    expect(validateKindRules({ ...base, kind: 'denuncia' })[0]).toContain('restrita');
    expect(validateKindRules({ ...base, kind: 'denuncia', confidentiality: 'restrita' })).toEqual([]);
  });
  it('validateVersionContent junta todos os erros', () => {
    const errs = validateVersionContent({
      ...base,
      formSchema: [field({ key: '' })],
      workflowSchema: [{ stepOrder: 3, approverRule: 'gestor_direto' }],
      slaFirstResponseMinutes: 0,
      slaResolutionMinutes: 10,
    });
    expect(errs.length).toBeGreaterThanOrEqual(3);
  });
});
