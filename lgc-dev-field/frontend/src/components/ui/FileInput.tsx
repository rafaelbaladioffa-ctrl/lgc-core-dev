import { useRef } from "react";
import { useI18n } from "../../i18n";

interface FileInputProps {
  value: File | null;
  onChange: (file: File | null) => void;
  accept?: string;
}

export default function FileInput({ value, onChange, accept }: FileInputProps) {
  const ref = useRef<HTMLInputElement>(null);
  const { t } = useI18n();

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <input
        ref={ref}
        type="file"
        accept={accept}
        style={{ display: "none" }}
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
      />
      <button
        type="button"
        className="btn btn-outline btn-sm"
        onClick={() => ref.current?.click()}
      >
        {value ? t.common.trocarArquivo : t.common.escolherArquivo}
      </button>
      <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
        {value ? value.name : t.common.nenhumArquivoSelecionado}
      </span>
    </div>
  );
}
