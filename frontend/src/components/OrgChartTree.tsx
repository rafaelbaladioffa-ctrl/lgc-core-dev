import type { OrgChartNode } from '../api/collaborators';

function OrgChartNodeView({ node }: { node: OrgChartNode }) {
  return (
    <li>
      <div
        style={{
          display: 'inline-block',
          border: '1px solid var(--border)',
          background: 'var(--bg)',
          borderRadius: 6,
          padding: '6px 10px',
          margin: 4,
        }}
      >
        <strong style={{ fontSize: 13 }}>{node.fullName}</strong>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{node.jobTitleName}</div>
      </div>
      {node.children.length > 0 && (
        <ul style={{ listStyle: 'none', paddingLeft: 24, borderLeft: '1px dashed var(--border)', marginLeft: 8 }}>
          {node.children.map((child) => (
            <OrgChartNodeView key={child.id} node={child} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function OrgChartTree({ roots }: { roots: OrgChartNode[] }) {
  if (roots.length === 0) return <p>Nenhum colaborador cadastrado.</p>;
  return (
    <ul style={{ listStyle: 'none', paddingLeft: 0 }}>
      {roots.map((root) => (
        <OrgChartNodeView key={root.id} node={root} />
      ))}
    </ul>
  );
}
