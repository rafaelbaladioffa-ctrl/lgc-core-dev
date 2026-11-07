import { useState } from 'react';
import { Button } from './Button';
import { FormSection } from './layout/FormPage';
import type { CompletionRule, RequestCategoryKind, RequestFieldType } from '../api/requestCategories';
import type { CollaboratorSafe } from '../api/collaborators';
import {
  FIELD_TYPE_LABELS,
  MANAGEMENT_LEVEL_ORDER,
  OPTIONS_SOURCE_LABELS,
  groupErrors,
  keyFromLabel,
  newFieldDraft,
  type ApprovalMode,
  type ApprovalState,
  type FieldDraft,
} from '../utils/requestCatalog';

/** Conteúdo editável de uma versão (rascunho): formulário, aprovação e SLA em horas úteis. */
export interface DraftContent {
  fields: FieldDraft[];
  approval: ApprovalState;
  firstResponseHours: string;
  resolutionHours: string;
}

interface Props {
  value: DraftContent;
  onChange: (next: DraftContent) => void;
  kind: RequestCategoryKind;
  useDynamicAuthority: boolean;
  onDynamicAuthorityChange: (value: boolean) => void;
  collaborators: CollaboratorSafe[];
  /** Erros de validação do servidor (ou locais), por campo/lista. */
  errors: string[];
  disabled?: boolean;
}

const LEVEL_LABELS = { supervisor: 'Supervisor', coordenador: 'Coordenador', gerente: 'Gerente', diretor: 'Diretor' } as const;

export function RequestCategoryDraftEditor({ value, onChange, kind, useDynamicAuthority, onDynamicAuthorityChange, collaborators, errors, disabled }: Props) {
  const [pickedCollaborator, setPickedCollaborator] = useState('');
  const grouped = groupErrors(errors);
  const { fields, approval } = value;

  const setFields = (next: FieldDraft[]) => onChange({ ...value, fields: next });
  const setApproval = (patch: Partial<ApprovalState>) => onChange({ ...value, approval: { ...approval, ...patch } });
  const patchField = (index: number, patch: Partial<FieldDraft>) => setFields(fields.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  const moveField = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= fields.length) return;
    const next = [...fields];
    [next[index], next[target]] = [next[target], next[index]];
    setFields(next);
  };

  const collaboratorName = (id: string) => collaborators.find((c) => c.id === id)?.fullName ?? id;
  const availableCollaborators = collaborators.filter((c) => !approval.collaboratorIds.includes(c.id));

  return (
    <>
      <FormSection title="Campos do formulário">
        {fields.length === 0 && <p className="axis-catalog-hint">Nenhum campo. A requisição terá só os dados padrão (título, descrição, centro de custo).</p>}
        {fields.map((field, index) => (
          <div className="axis-field-card" key={field.uid}>
            <div className="axis-field-card-head">
              <strong>Campo {index + 1}</strong>
              <div className="axis-field-card-tools">
                <button type="button" aria-label="Mover para cima" title="Mover para cima" disabled={disabled || index === 0} onClick={() => moveField(index, -1)}>
                  ↑
                </button>
                <button type="button" aria-label="Mover para baixo" title="Mover para baixo" disabled={disabled || index === fields.length - 1} onClick={() => moveField(index, 1)}>
                  ↓
                </button>
                <button type="button" aria-label="Remover campo" title="Remover campo" disabled={disabled} onClick={() => setFields(fields.filter((_, i) => i !== index))}>
                  ×
                </button>
              </div>
            </div>
            <div className="axis-catalog-grid">
              <label className="axis-catalog-field">
                <span>Rótulo</span>
                <input
                  value={field.label}
                  maxLength={120}
                  disabled={disabled}
                  onChange={(e) => patchField(index, { label: e.target.value, ...(field.keyTouched ? {} : { key: keyFromLabel(e.target.value) }) })}
                />
              </label>
              <label className="axis-catalog-field">
                <span>Chave (identificador interno)</span>
                <input value={field.key} maxLength={40} disabled={disabled} onChange={(e) => patchField(index, { key: e.target.value, keyTouched: true })} />
              </label>
              <label className="axis-catalog-field">
                <span>Tipo</span>
                <select value={field.type} disabled={disabled} onChange={(e) => patchField(index, { type: e.target.value as RequestFieldType })}>
                  {(Object.keys(FIELD_TYPE_LABELS) as RequestFieldType[]).map((t) => (
                    <option key={t} value={t}>
                      {FIELD_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="axis-catalog-check">
                <input type="checkbox" checked={field.required} disabled={disabled} onChange={(e) => patchField(index, { required: e.target.checked })} />
                Obrigatório
              </label>
            </div>
            {field.type === 'select' && (
              <div className="axis-catalog-grid">
                <label className="axis-catalog-field">
                  <span>Origem das opções</span>
                  <select value={field.optionsMode} disabled={disabled} onChange={(e) => patchField(index, { optionsMode: e.target.value as FieldDraft['optionsMode'] })}>
                    <option value="list">Lista própria</option>
                    <option value="source">Cadastro existente</option>
                  </select>
                </label>
                {field.optionsMode === 'list' ? (
                  <label className="axis-catalog-field">
                    <span>Opções (uma por linha)</span>
                    <textarea value={field.optionsText} disabled={disabled} onChange={(e) => patchField(index, { optionsText: e.target.value })} />
                  </label>
                ) : (
                  <label className="axis-catalog-field">
                    <span>Cadastro</span>
                    <select value={field.optionsSource} disabled={disabled} onChange={(e) => patchField(index, { optionsSource: e.target.value as FieldDraft['optionsSource'] })}>
                      {(Object.keys(OPTIONS_SOURCE_LABELS) as FieldDraft['optionsSource'][]).map((s) => (
                        <option key={s} value={s}>
                          {OPTIONS_SOURCE_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            )}
            {(grouped.byField.get(index) ?? []).map((message) => (
              <p className="axis-catalog-error" key={message}>
                {message}
              </p>
            ))}
          </div>
        ))}
        {grouped.other.length > 0 && (
          <ul className="axis-catalog-errors">
            {grouped.other.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        )}
        <Button type="button" variant="secondary" disabled={disabled} onClick={() => setFields([...fields, newFieldDraft()])}>
          + Adicionar campo
        </Button>
      </FormSection>

      <FormSection title="Aprovação">
        {kind === 'compra_material' ? (
          <p className="axis-catalog-notice">Nesta categoria, a aprovação é do responsável do centro de custo da requisição. Não há etapas para configurar.</p>
        ) : (
          <>
            <label className="axis-catalog-check">
              <input type="checkbox" checked={useDynamicAuthority} disabled={disabled} onChange={(e) => onDynamicAuthorityChange(e.target.checked)} />
              Alçada por valor (a cadeia de aprovação vem da matriz de alçada)
            </label>
            {!useDynamicAuthority && (
              <>
                <label className="axis-catalog-field">
                  <span>Fluxo de aprovação</span>
                  <select value={approval.mode} disabled={disabled} onChange={(e) => setApproval({ mode: e.target.value as ApprovalMode })}>
                    <option value="none">Sem aprovação</option>
                    <option value="gestor_direto">Gestor direto</option>
                    <option value="niveis">Cadeia por nível hierárquico</option>
                    <option value="colaboradores">Colaboradores específicos</option>
                    {approval.custom.length > 0 && <option value="custom">Fluxo avançado existente (mantido como está)</option>}
                  </select>
                </label>
                {approval.mode === 'custom' && <p className="axis-catalog-notice">Este fluxo tem uma estrutura que a tela não edita. Ele será mantido como está, a menos que você escolha outra opção.</p>}
                {approval.mode === 'niveis' && (
                  <div className="axis-level-list">
                    {MANAGEMENT_LEVEL_ORDER.map((level) => (
                      <label className="axis-catalog-check" key={level}>
                        <input
                          type="checkbox"
                          checked={approval.levels.includes(level)}
                          disabled={disabled}
                          onChange={(e) => setApproval({ levels: e.target.checked ? [...approval.levels, level] : approval.levels.filter((l) => l !== level) })}
                        />
                        {LEVEL_LABELS[level]}
                      </label>
                    ))}
                  </div>
                )}
                {approval.mode === 'colaboradores' && (
                  <>
                    <div className="axis-catalog-grid">
                      <label className="axis-catalog-field">
                        <span>Adicionar colaborador</span>
                        <select
                          value={pickedCollaborator}
                          disabled={disabled}
                          onChange={(e) => {
                            if (e.target.value) setApproval({ collaboratorIds: [...approval.collaboratorIds, e.target.value] });
                            setPickedCollaborator('');
                          }}
                        >
                          <option value="">Selecione...</option>
                          {availableCollaborators.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.fullName} ({c.matricula})
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="axis-catalog-field">
                        <span>Regra de conclusão</span>
                        <select value={approval.completionRule} disabled={disabled} onChange={(e) => setApproval({ completionRule: e.target.value as CompletionRule })}>
                          <option value="todos">Todos precisam aprovar</option>
                          <option value="qualquer_um">Qualquer um aprova</option>
                          <option value="n_de_m">N de M aprovam</option>
                        </select>
                      </label>
                      {approval.completionRule === 'n_de_m' && (
                        <label className="axis-catalog-field">
                          <span>Quantos (N)</span>
                          <input type="number" min={1} max={Math.max(1, approval.collaboratorIds.length)} value={approval.requiredCount} disabled={disabled} onChange={(e) => setApproval({ requiredCount: Number(e.target.value) })} />
                        </label>
                      )}
                    </div>
                    <div className="axis-chip-list">
                      {approval.collaboratorIds.map((id) => (
                        <span className="axis-chip" key={id}>
                          {collaboratorName(id)}
                          <button type="button" aria-label={`Remover ${collaboratorName(id)}`} disabled={disabled} onClick={() => setApproval({ collaboratorIds: approval.collaboratorIds.filter((x) => x !== id) })}>
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </>
        )}
        {grouped.workflow.length > 0 && (
          <ul className="axis-catalog-errors">
            {grouped.workflow.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        )}
      </FormSection>

      <FormSection title="Prazos (SLA) em horas úteis">
        <div className="axis-catalog-grid">
          <label className="axis-catalog-field">
            <span>Primeira resposta (horas)</span>
            <input inputMode="decimal" value={value.firstResponseHours} disabled={disabled} onChange={(e) => onChange({ ...value, firstResponseHours: e.target.value })} />
          </label>
          <label className="axis-catalog-field">
            <span>Solução (horas)</span>
            <input inputMode="decimal" value={value.resolutionHours} disabled={disabled} onChange={(e) => onChange({ ...value, resolutionHours: e.target.value })} />
          </label>
        </div>
        <p className="axis-catalog-hint">Use passos de 0,25 h (15 minutos). A solução não pode ser menor que a primeira resposta.</p>
        {grouped.sla.length > 0 && (
          <ul className="axis-catalog-errors">
            {grouped.sla.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        )}
      </FormSection>
    </>
  );
}
