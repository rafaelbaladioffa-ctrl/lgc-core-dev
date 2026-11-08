import { useState } from "react";
import { useI18n, usePageText } from "../../i18n";
import Modal from "./Modal";
import FileInput from "./FileInput";

const TEXT = {
  "pt-BR": {
    instrucao: "Selecione um arquivo CSV (delimitador ; ou ,) com as colunas correspondentes aos campos do cadastro. Linhas com erro são reportadas individualmente e não impedem a importação das demais.",
  },
  "en-US": {
    instrucao: "Select a CSV file (delimiter ; or ,) with columns matching the record fields. Error rows are reported individually and do not prevent other rows from being imported.",
  },
  "es-ES": {
    instrucao: "Seleccione un archivo CSV (delimitador ; o ,) con columnas correspondientes a los campos del registro. Las filas con error se reportan individualmente y no impiden la importación de las demás.",
  },
};

export default function CsvImportModal({
  title,
  onClose,
  onImport,
  onImported,
}: {
  title: string;
  onClose: () => void;
  onImport: (file: File) => Promise<{ created: number; errors: string[] }>;
  onImported: () => void;
}) {
  const { t } = useI18n();
  const p = usePageText(TEXT);
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ created: number; errors: string[] } | null>(null);
  const [error, setError] = useState("");

  async function handleImport() {
    if (!file) return;
    setImporting(true);
    setError("");
    setResult(null);
    try {
      const data = await onImport(file);
      setResult(data);
      if (data.created && !data.errors.length) onImported();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      setError(axiosErr.response?.data?.detail || t.common.erroImportar);
    } finally {
      setImporting(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose} width={520}>
      <p style={{ color: "var(--text-muted)", fontSize: 12.5, marginBottom: 12 }}>
        {p.instrucao}
      </p>
      <FileInput
        value={file}
        accept=".csv,text/csv"
        onChange={(f) => {
          setFile(f);
          setResult(null);
          setError("");
        }}
      />
      {error && <p style={{ color: "var(--red)", fontSize: 13, marginTop: 10 }}>{error}</p>}
      {result && (
        <div style={{ marginTop: 12 }}>
          <p style={{ fontSize: 13, color: "var(--green)" }}>{t.common.registrosImportados(result.created)}</p>
          {result.errors.length > 0 && (
            <ul style={{ fontSize: 12.5, color: "var(--red)", paddingLeft: 18, marginTop: 6 }}>
              {result.errors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
        <button className="btn btn-outline" onClick={onClose}>
          {t.common.fechar}
        </button>
        <button className="btn btn-primary" onClick={handleImport} disabled={importing || !file}>
          {importing ? t.common.importando : t.common.importar}
        </button>
      </div>
    </Modal>
  );
}
