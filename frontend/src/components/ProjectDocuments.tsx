import { useCallback, useEffect, useState } from 'react';
import { projectsApi, PROJECT_DOCUMENT_LABEL, type ProjectDocument, type ProjectDocumentKind } from '../api/projects';
import { useAuth } from '../context/AuthContext';
import { Button } from './Button';
import { translateApiError } from '../utils/apiError';
import { formatDateTime } from '../utils/formatDate';
import { DOCUMENT_ACCEPT, readFileAsBase64 } from '../utils/fileUpload';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

interface Props {
  projectId: string;
  kind?: ProjectDocumentKind;
}

/**
 * Documentos do projeto na tela de edição. Enviar exige `project:update`; ver e baixar exige
 * `project:read_documents`. Cada envio vira uma versão nova; a mais recente é a que vale.
 */
export function ProjectDocuments({ projectId, kind = 'sow' }: Props) {
  const { hasPermission } = useAuth();
  const canRead = hasPermission('project:read_documents');
  const canUpload = hasPermission('project:update');
  const [documents, setDocuments] = useState<ProjectDocument[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!canRead) return Promise.resolve();
    return projectsApi
      .listDocuments(projectId)
      .then((docs) => setDocuments(docs.filter((d) => d.kind === kind)))
      .catch((err) => setError(translateApiError(err, 'Erro ao carregar os documentos do projeto.')));
  }, [projectId, kind, canRead]);

  useEffect(() => {
    void load();
  }, [load]);

  const upload = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const contentBase64 = await readFileAsBase64(file);
      const created = await projectsApi.addDocument(projectId, { kind, filename: file.name, contentBase64 });
      setNotice(`${PROJECT_DOCUMENT_LABEL[kind]} versão ${created.version} anexada.`);
      setFile(null);
      setInputKey((k) => k + 1);
      await load();
    } catch (err) {
      setError(translateApiError(err, `Erro ao anexar a ${PROJECT_DOCUMENT_LABEL[kind]}.`));
    } finally {
      setBusy(false);
    }
  };

  const download = async (doc: ProjectDocument) => {
    setError(null);
    try {
      const blob = await projectsApi.downloadDocument(projectId, doc.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = doc.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(translateApiError(err, `Não foi possível baixar "${doc.filename}".`));
    }
  };

  if (!canRead && !canUpload) return null;
  const label = PROJECT_DOCUMENT_LABEL[kind];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {canUpload && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            key={inputKey}
            type="file"
            accept={DOCUMENT_ACCEPT}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            disabled={busy}
          />
          <Button type="button" variant="positive" onClick={() => void upload()} disabled={!file || busy}>
            {busy ? 'Enviando…' : documents.length > 0 ? `Enviar nova versão da ${label}` : `Anexar ${label}`}
          </Button>
        </div>
      )}
      {canUpload && (
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
          PDF, DOCX, XLSX, PNG ou JPG, até 25MB. As versões anteriores ficam guardadas; o Axis Financeiro usa a mais recente.
        </p>
      )}
      {notice && <p style={{ color: 'var(--success)', fontSize: 13, margin: 0 }}>{notice}</p>}
      {error && <p style={{ color: 'var(--danger)', fontSize: 13, margin: 0 }}>{error}</p>}
      {canRead &&
        (documents.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>Nenhuma {label} anexada.</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {documents.map((doc, index) => (
              <li key={doc.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, fontSize: 13 }}>
                <span>
                  <strong>v{doc.version}</strong>
                  {index === 0 && <span style={{ color: 'var(--success)', marginLeft: 6 }}>(vigente)</span>} {doc.filename}{' '}
                  <span style={{ color: 'var(--text-muted)' }}>
                    · {formatFileSize(doc.sizeBytes)} · {formatDateTime(doc.createdAt)}
                    {doc.uploadedBy ? ` · ${doc.uploadedBy.email}` : ''}
                  </span>
                </span>
                <Button type="button" variant="secondary" onClick={() => void download(doc)}>
                  Baixar
                </Button>
              </li>
            ))}
          </ul>
        ))}
      {!canRead && canUpload && (
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>Você pode anexar, mas não tem permissão para ver os documentos.</p>
      )}
    </div>
  );
}
