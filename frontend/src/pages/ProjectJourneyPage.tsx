import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AppLayout } from '../components/layout/AppLayout';
import { ProjectJourney } from '../components/ProjectJourney';
import { projectsApi, type Project } from '../api/projects';
import { useAuth } from '../context/AuthContext';
import { translateApiError } from '../utils/apiError';

/** Jornada do projeto em tela própria (PT-11): vale para quem só lê projetos (`project:read`). */
export function ProjectJourneyPage() {
  const { id } = useParams<{ id: string }>();
  const { hasPermission } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    projectsApi
      .get(id)
      .then(setProject)
      .catch((err) => setError(translateApiError(err, 'Erro ao carregar o projeto.')));
  }, [id]);

  return (
    <AppLayout breadcrumb={['Axis', 'Projetos', project?.code ?? 'Jornada']}>
      <h2 style={{ margin: '0 0 4px', fontSize: 'var(--text-xl)' }}>{project?.name ?? 'Jornada do projeto'}</h2>
      <p style={{ margin: '0 0 16px', fontSize: 'var(--text-sm)', color: 'var(--foreground-muted)' }}>
        {project?.code}
        {project && hasPermission('project:update') && (
          <>
            {' · '}
            <Link to={`/projects/${project.id}/edit`}>Editar o projeto</Link>
          </>
        )}
      </p>
      {error && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}
      {id && <ProjectJourney projectId={id} />}
    </AppLayout>
  );
}
