import { useState } from "react";
import { projectsApi } from "../../api/resources";
import { useI18n, usePageText } from "../../i18n";
import Modal from "../ui/Modal";

const TEXT = {
  "pt-BR": {
    titulo: "Adicionar Rack Positions em Massa",
    instrucao: "Um Rack Position por linha, no formato",
    instrucaoOpcional: '(DH, Links e UTP são opcionais — ex.: apenas "RACK03" também é válido).',
    cadastrado: (n: number) => `${n} Rack Position(s) cadastrado(s) em massa.`,
    ignorado: (n: number) => ` ${n} já existia(m) e foi(ram) ignorado(s).`,
    erro: "Não foi possível importar os Rack Positions.",
  },
  "en-US": {
    titulo: "Bulk Add Rack Positions",
    instrucao: "One Rack Position per line, in the format",
    instrucaoOpcional: '(DH, Links and UTP are optional — e.g. just "RACK03" is also valid).',
    cadastrado: (n: number) => `${n} Rack Position(s) bulk-created.`,
    ignorado: (n: number) => ` ${n} already existed and were skipped.`,
    erro: "Could not import the Rack Positions.",
  },
  "es-ES": {
    titulo: "Agregar Rack Positions en Masa",
    instrucao: "Un Rack Position por línea, en el formato",
    instrucaoOpcional: '(DH, Links y UTP son opcionales — ej.: solo "RACK03" también es válido).',
    cadastrado: (n: number) => `${n} Rack Position(s) creado(s) en masa.`,
    ignorado: (n: number) => ` ${n} ya existía(n) y fue(ron) ignorado(s).`,
    erro: "No se pudo importar los Rack Positions.",
  },
};

export default function RackPositionBulkModal({
  projectId,
  onClose,
  onSaved,
}: {
  projectId: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const p = usePageText(TEXT);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      const result = await projectsApi.rackPositionsBulk(projectId, text);
      let message = p.cadastrado(result.created);
      if (result.skipped) message += p.ignorado(result.skipped);
      alert(message);
      onSaved();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      setError(axiosErr.response?.data?.detail || p.erro);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={p.titulo} onClose={onClose} width={520}>
      <p style={{ color: "var(--text-muted)", fontSize: 12.5, marginBottom: 10 }}>
        {p.instrucao} <strong>Rack Position;DH;Links;UTP</strong> {p.instrucaoOpcional}
      </p>
      <textarea
        className="input"
        style={{ height: 160, fontFamily: "monospace" }}
        placeholder={"RACK01;DH1;24;48\nRACK02;DH2;12;24\nRACK03"}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {error && <p style={{ color: "var(--red)", fontSize: 13, marginTop: 10 }}>{error}</p>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 14 }}>
        <button className="btn btn-outline" onClick={onClose}>
          {t.common.cancelar}
        </button>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving || !text.trim()}>
          {saving ? t.common.importando : t.common.importar}
        </button>
      </div>
    </Modal>
  );
}
