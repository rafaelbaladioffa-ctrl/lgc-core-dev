import type { ReactNode } from 'react';

export interface TreeNode<T> {
  item: T;
  children: TreeNode<T>[];
}

/** Builds a forest from a flat list using each item's id/parentId accessors. */
export function buildTree<T>(items: T[], getId: (item: T) => string, getParentId: (item: T) => string | null): TreeNode<T>[] {
  const byId = new Map<string, TreeNode<T>>();
  for (const item of items) {
    byId.set(getId(item), { item, children: [] });
  }
  const roots: TreeNode<T>[] = [];
  for (const node of byId.values()) {
    const parentId = getParentId(node.item);
    if (parentId && byId.has(parentId)) {
      byId.get(parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

interface HierarchyTreeProps<T> {
  roots: TreeNode<T>[];
  renderItem: (item: T, depth: number) => ReactNode;
  emptyMessage?: string;
}

function TreeNodeView<T>({ node, depth, renderItem }: { node: TreeNode<T>; depth: number; renderItem: (item: T, depth: number) => ReactNode }) {
  return (
    <>
      <div style={{ borderBottom: '1px solid var(--border)', padding: '8px 10px', paddingLeft: 10 + depth * 24 }}>
        {renderItem(node.item, depth)}
      </div>
      {node.children.map((child, i) => (
        <TreeNodeView key={i} node={child} depth={depth + 1} renderItem={renderItem} />
      ))}
    </>
  );
}

export function HierarchyTree<T>({ roots, renderItem, emptyMessage = 'Nenhum registro cadastrado.' }: HierarchyTreeProps<T>) {
  if (roots.length === 0) {
    return (
      <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
        {emptyMessage}
      </div>
    );
  }
  return (
    <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
      {roots.map((root, i) => (
        <TreeNodeView key={i} node={root} depth={0} renderItem={renderItem} />
      ))}
    </div>
  );
}
