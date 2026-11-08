import { useState } from "react";
import { rackPositionsApi } from "../../api/resources";
import type { RackPosition } from "../../api/types";
import { useI18n, usePageText } from "../../i18n";
import DynamicForm, { type FieldConfig, type FormValues } from "../ui/DynamicForm";
import Modal from "../ui/Modal";

type ApiErrors = Record<string, string[]>;

const FIELDS: FieldConfig[] = [
  { name: "position", label: "Rack Position", type: "text", required: true },
  { name: "dh", label: "DH", type: "text" },
  { name: "links", label: "Links", type: "number" },
  { name: "utp", label: "UTP", type: "number" },
];

const TEXT = {
  "pt-BR": {
    editar: (pos: string) => `Editar Rack Position — ${pos}`,
    novo: "Novo Rack Position",
  },
  "en-US": {
    editar: (pos: string) => `Edit Rack Position — ${pos}`,
    novo: "New Rack Position",
  },
  "es-ES": {
    editar: (pos: string) => `Editar Rack Position — ${pos}`,
    novo: "Nuevo Rack Position",
  },
};

export default function RackPositionFormModal({
  projectId,
  rackPosition,
  onClose,
  onSaved,
}: {
  projectId: number;
  rackPosition: RackPosition | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const p = usePageText(TEXT);
  const [values, setValues] = useState<FormValues>(
    rackPosition ? { ...rackPosition } : { position: "", dh: "", links: 0, utp: 0 }
  );
  const [errors, setErrors] = useState<ApiErrors>({});
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    setErrors({});
    try {
      if (rackPosition) {
        await rackPositionsApi.update(rackPosition.id, values);
      } else {
        await rackPositionsApi.create({ ...values, project: projectId });
      }
      onSaved();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: ApiErrors } };
      if (axiosErr.response?.data) setErrors(axiosErr.response.data);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={rackPosition ? p.editar(rackPosition.position) : p.novo} onClose={onClose} width={480}>
      <DynamicForm fields={FIELDS} values={values} errors={errors} onChange={(name, value) => setValues((prev) => ({ ...prev, [name]: value }))} />
      {errors.non_field_errors && <p style={{ color: "var(--red)", fontSize: 13, marginBottom: 10 }}>{errors.non_field_errors.join(" ")}</p>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
        <button className="btn btn-outline" onClick={onClose}>
          {t.common.cancelar}
        </button>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? t.common.salvando : t.common.salvar}
        </button>
      </div>
    </Modal>
  );
}
