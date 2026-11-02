import { useState, useCallback, useEffect, useMemo, useRef, type CSSProperties, type ComponentType } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  addEdge,
  Handle,
  Position,
  MarkerType,
  type Node,
  type Edge,
  type Connection,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

// ── Types ──────────────────────────────────────────────────────────

export type BpmNodeDef = {
  id: string
  type: string
  phase?: string
  queueId?: string
  conditions?: Record<string, unknown>[]
  assigneeRule?: Record<string, unknown>
}

export type BpmEdgeDef = { from: string; to: string }

export type FieldDef = { key: string; label: string; type: string; [k: string]: unknown }

export type DesignerState = {
  bpmNodes: BpmNodeDef[]
  bpmEdges: BpmEdgeDef[]
  nodePositions: Record<string, { x: number; y: number }>
  fields: FieldDef[]
  sla: { firstResponseMinutes: number; resolutionMinutes: number }
}

export interface ProcessDesignerProps {
  bpmNodes: BpmNodeDef[]
  bpmEdges: BpmEdgeDef[]
  nodePositions: Record<string, { x: number; y: number }>
  fields: FieldDef[]
  sla: { firstResponseMinutes: number; resolutionMinutes: number }
  disabled: boolean
  queues: { id: string; name: string }[]
  onChange: (state: DesignerState) => void
}

// ── Node metadata ──────────────────────────────────────────────────

const NODE_META: Record<string, { bg: string; label: string }> = {
  start:       { bg: '#16a34a', label: 'Início' },
  end:         { bg: '#dc2626', label: 'Fim' },
  human:       { bg: '#2563eb', label: 'Humano' },
  gateway_xor: { bg: '#d97706', label: 'Desvio XOR' },
  gateway_and: { bg: '#7c3aed', label: 'Fork/Join AND' },
}

// ── Auto-layout (topological sort → columns) ───────────────────────

function autoLayout(
  nodes: BpmNodeDef[],
  edges: BpmEdgeDef[],
): Record<string, { x: number; y: number }> {
  const adj: Record<string, string[]> = {}
  const inDeg: Record<string, number> = {}
  nodes.forEach(n => { adj[n.id] = []; inDeg[n.id] = 0 })
  edges.forEach(e => {
    adj[e.from]?.push(e.to)
    if (inDeg[e.to] !== undefined) inDeg[e.to]++
  })
  const queue = nodes.filter(n => inDeg[n.id] === 0).map(n => n.id)
  const col: Record<string, number> = {}
  queue.forEach(id => { col[id] = 0 })
  const visited = new Set<string>()
  while (queue.length) {
    const id = queue.shift()!
    if (visited.has(id)) continue
    visited.add(id)
    for (const next of (adj[id] ?? [])) {
      col[next] = Math.max(col[next] ?? 0, (col[id] ?? 0) + 1)
      if (--inDeg[next] === 0) queue.push(next)
    }
  }
  const byCol: Record<number, string[]> = {}
  Object.entries(col).forEach(([id, c]) => { byCol[c] = byCol[c] ?? []; byCol[c].push(id) })
  nodes.forEach(n => {
    if (col[n.id] === undefined) {
      const c = Object.keys(byCol).length
      col[n.id] = c
      byCol[c] = [n.id]
    }
  })
  const positions: Record<string, { x: number; y: number }> = {}
  Object.entries(byCol).forEach(([cStr, ids]) => {
    const c = Number(cStr)
    ids.forEach((id, r) => { positions[id] = { x: c * 230, y: r * 130 } })
  })
  return positions
}

// ── BPM ↔ RF conversion ────────────────────────────────────────────

function toRfNodes(
  bpmNodes: BpmNodeDef[],
  storedPos: Record<string, { x: number; y: number }>,
  bpmEdges: BpmEdgeDef[],
): Node[] {
  const needsLayout = bpmNodes.some(n => !storedPos[n.id])
  const positions = needsLayout ? autoLayout(bpmNodes, bpmEdges) : storedPos
  return bpmNodes.map(n => ({
    id: n.id,
    type: 'bpmNode',
    position: positions[n.id] ?? { x: 0, y: 0 },
    data: { ...(n as unknown as Record<string, unknown>) },
  }))
}

function toRfEdges(bpmEdges: BpmEdgeDef[]): Edge[] {
  return bpmEdges.map((e, i) => ({
    id: `_e${i}_${e.from}_${e.to}`,
    source: e.from,
    target: e.to,
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
  }))
}

function fromRfNodes(rfNodes: Node[]): {
  bpmNodes: BpmNodeDef[]
  positions: Record<string, { x: number; y: number }>
} {
  const bpmNodes: BpmNodeDef[] = rfNodes.map(n => {
    const d = n.data as Record<string, unknown>
    return {
      id: n.id,
      type: (d['type'] ?? 'human') as string,
      ...(d['phase'] !== undefined ? { phase: d['phase'] as string } : {}),
      ...(d['queueId'] ? { queueId: d['queueId'] as string } : {}),
      ...(d['conditions'] ? { conditions: d['conditions'] as Record<string, unknown>[] } : {}),
      ...(d['assigneeRule'] ? { assigneeRule: d['assigneeRule'] as Record<string, unknown> } : {}),
    }
  })
  const positions: Record<string, { x: number; y: number }> = {}
  rfNodes.forEach(n => { positions[n.id] = { x: n.position.x, y: n.position.y } })
  return { bpmNodes, positions }
}

function fromRfEdges(rfEdges: Edge[]): BpmEdgeDef[] {
  return rfEdges.map(e => ({ from: e.source, to: e.target }))
}

function normalizeFields(form: unknown): FieldDef[] {
  if (!form) return []
  if (Array.isArray(form)) return form as FieldDef[]
  const f = form as Record<string, unknown>
  if (f.sections && Array.isArray(f.sections)) {
    return (f.sections as Record<string, unknown>[]).flatMap(
      s => (Array.isArray(s['fields']) ? s['fields'] : []) as FieldDef[],
    )
  }
  return []
}

// ── Custom node component ──────────────────────────────────────────

function BpmFlowNode({ id, data, selected }: NodeProps) {
  const d = data as Record<string, unknown>
  const bpmType = (d['type'] ?? 'human') as string
  const phase = d['phase'] as string | undefined
  const meta = NODE_META[bpmType] ?? { bg: '#64748b', label: bpmType }
  return (
    <div
      style={{
        background: meta.bg,
        color: '#fff',
        borderRadius: 8,
        padding: '8px 16px',
        minWidth: 150,
        textAlign: 'center',
        outline: selected ? '3px solid #1e3a8a' : '2px solid rgba(255,255,255,0.25)',
        boxShadow: selected
          ? '0 0 0 4px rgba(59,130,246,.4)'
          : '0 2px 8px rgba(0,0,0,.2)',
        fontSize: 12,
        userSelect: 'none',
      }}
    >
      {bpmType !== 'start' && (
        <Handle
          type="target"
          position={Position.Top}
          style={{ background: '#fff', width: 10, height: 10, border: `2px solid ${meta.bg}` }}
        />
      )}
      <div style={{ fontWeight: 700, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>
        {id}
      </div>
      <div style={{ fontSize: 10, opacity: 0.85, marginTop: 2 }}>
        {meta.label}{phase ? ` · ${phase}` : ''}
      </div>
      {bpmType !== 'end' && (
        <Handle
          type="source"
          position={Position.Bottom}
          style={{ background: '#fff', width: 10, height: 10, border: `2px solid ${meta.bg}` }}
        />
      )}
    </div>
  )
}

const nodeTypes = { bpmNode: BpmFlowNode as ComponentType<NodeProps> }

// ── Inspector panel ────────────────────────────────────────────────

function NodeInspector({
  nodeId,
  rfNodes,
  disabled,
  queues,
  onUpdate,
  onDelete,
}: {
  nodeId: string | null
  rfNodes: Node[]
  disabled: boolean
  queues: { id: string; name: string }[]
  onUpdate: (id: string, patch: Record<string, unknown>) => void
  onDelete: (id: string) => void
}) {
  const node = rfNodes.find(n => n.id === nodeId)
  if (!node) {
    return (
      <div style={inspectorStyle}>
        <p style={{ color: '#6b7280', fontSize: 13, marginTop: 8 }}>
          Clique em um nó para editar suas propriedades.
        </p>
        <p style={{ color: '#9ca3af', fontSize: 11, marginTop: 8 }}>
          Arraste nós para reorganizar. Conecte nós arrastando de uma alça (ponto branco).
        </p>
      </div>
    )
  }
  const d = node.data as Record<string, unknown>
  const bpmType = (d['type'] ?? 'human') as string
  const phase = (d['phase'] ?? 'execution') as string
  const queueId = (d['queueId'] ?? '') as string
  const conditionsStr = d['conditions']
    ? JSON.stringify(d['conditions'], null, 2)
    : '[]'

  const set = (patch: Record<string, unknown>) => onUpdate(node.id, patch)

  return (
    <div style={inspectorStyle}>
      <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>
        Nó: <code style={{ fontWeight: 400, color: '#2563eb' }}>{node.id}</code>
      </h3>

      <label style={labelStyle}>
        Tipo
        <select
          value={bpmType}
          disabled={disabled}
          onChange={e => set({ type: e.target.value })}
          style={inputStyle}
        >
          {Object.keys(NODE_META).map(t => (
            <option key={t} value={t}>{NODE_META[t].label} ({t})</option>
          ))}
        </select>
      </label>

      {bpmType === 'human' && (
        <label style={labelStyle}>
          Fase
          <select
            value={phase}
            disabled={disabled}
            onChange={e => set({ phase: e.target.value })}
            style={inputStyle}
          >
            <option value="triage">Triagem</option>
            <option value="execution">Execução</option>
            <option value="approval">Aprovação</option>
            <option value="confirmation">Confirmação</option>
          </select>
        </label>
      )}

      {bpmType === 'human' && (
        <label style={labelStyle}>
          Fila (queueId)
          {queues.length > 0 ? (
            <select
              value={queueId}
              disabled={disabled}
              onChange={e => set({ queueId: e.target.value })}
              style={inputStyle}
            >
              <option value="">— sem fila (assigneeRule) —</option>
              {queues.map(q => (
                <option key={q.id} value={q.id}>{q.name}</option>
              ))}
            </select>
          ) : (
            <input
              value={queueId}
              disabled={disabled}
              placeholder="UUID da fila"
              onChange={e => set({ queueId: e.target.value })}
              style={inputStyle}
            />
          )}
        </label>
      )}

      {bpmType === 'gateway_xor' && (
        <label style={labelStyle}>
          Condições (JSON)
          <textarea
            value={conditionsStr}
            disabled={disabled}
            rows={6}
            onChange={e => {
              try {
                set({ conditions: JSON.parse(e.target.value) })
              } catch { /* invalid JSON, will be caught by validator */ }
            }}
            style={{ ...inputStyle, fontFamily: 'monospace', fontSize: 11, resize: 'vertical' }}
          />
        </label>
      )}

      {!disabled && (
        <button
          onClick={() => onDelete(node.id)}
          style={{
            marginTop: 12,
            padding: '6px 12px',
            background: '#fef2f2',
            color: '#dc2626',
            border: '1px solid #fca5a5',
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: 12,
            width: '100%',
          }}
        >
          Remover nó
        </button>
      )}
    </div>
  )
}

const inspectorStyle: CSSProperties = {
  width: 264,
  minWidth: 264,
  padding: '12px 14px',
  background: 'var(--bg-elevated, #f8fafc)',
  border: '1px solid var(--border, #e5e7eb)',
  borderRadius: 8,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  overflowY: 'auto',
  maxHeight: 520,
}

const labelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 12,
  color: '#374151',
  marginBottom: 10,
}

const inputStyle: CSSProperties = {
  padding: '5px 8px',
  border: '1px solid #d1d5db',
  borderRadius: 5,
  fontSize: 12,
  background: '#fff',
  width: '100%',
  boxSizing: 'border-box',
}

// ── Main component ─────────────────────────────────────────────────

export function ProcessDesigner({
  bpmNodes,
  bpmEdges,
  nodePositions,
  fields: initialFields,
  sla: initialSla,
  disabled,
  queues,
  onChange,
}: ProcessDesignerProps) {
  const [activeTab, setActiveTab] = useState<'fluxo' | 'formulario'>('fluxo')
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [fields, setFields] = useState<FieldDef[]>(() => normalizeFields(initialFields))
  const [sla, setSla] = useState(initialSla)

  const initialRfNodes = useMemo(
    () => toRfNodes(bpmNodes, nodePositions, bpmEdges),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  const initialRfEdges = useMemo(
    () => toRfEdges(bpmEdges),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const [rfNodes, setRfNodes, onRfNodesChange] = useNodesState(initialRfNodes)
  const [rfEdges, setRfEdges, onRfEdgesChange] = useEdgesState(initialRfEdges)

  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  // Emit changes upward (debounced by effect)
  useEffect(() => {
    const { bpmNodes: ns, positions } = fromRfNodes(rfNodes)
    const be = fromRfEdges(rfEdges)
    onChangeRef.current({ bpmNodes: ns, bpmEdges: be, nodePositions: positions, fields, sla })
  }, [rfNodes, rfEdges, fields, sla])

  const onConnect = useCallback(
    (connection: Connection) => {
      setRfEdges(eds => addEdge({ ...connection, markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 } }, eds))
    },
    [setRfEdges],
  )

  const handleNodeClick = useCallback((_: unknown, node: Node) => {
    setSelectedNodeId(node.id)
  }, [])

  const handlePaneClick = useCallback(() => {
    setSelectedNodeId(null)
  }, [])

  const handleNodeUpdate = useCallback((id: string, patch: Record<string, unknown>) => {
    setRfNodes(nds =>
      nds.map(n => n.id === id ? { ...n, data: { ...n.data, ...patch } } : n),
    )
  }, [setRfNodes])

  const handleNodeDelete = useCallback((id: string) => {
    setRfNodes(nds => nds.filter(n => n.id !== id))
    setRfEdges(eds => eds.filter(e => e.source !== id && e.target !== id))
    setSelectedNodeId(null)
  }, [setRfNodes, setRfEdges])

  const addNode = useCallback((type: string) => {
    const id = `${type}_${Date.now()}`
    const newNode: Node = {
      id,
      type: 'bpmNode',
      position: { x: 60 + rfNodes.length * 30, y: 60 + rfNodes.length * 20 },
      data: { type, phase: type === 'human' ? 'execution' : undefined } as Record<string, unknown>,
    }
    setRfNodes(nds => [...nds, newNode])
    setSelectedNodeId(id)
  }, [rfNodes.length, setRfNodes])

  // Fields helpers
  const updateField = useCallback((i: number, patch: Record<string, unknown>) => {
    setFields(fs => fs.map((f, n) => n === i ? { ...f, ...patch } : f))
  }, [])

  const removeField = useCallback((i: number) => {
    setFields(fs => fs.filter((_, n) => n !== i))
  }, [])

  const addField = useCallback(() => {
    setFields(fs => [...fs, { key: `campo_${fs.length + 1}`, label: 'Novo campo', type: 'text' }])
  }, [])

  return (
    <div style={{ border: '1px solid var(--border, #e5e7eb)', borderRadius: 8, overflow: 'hidden' }}>
      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border, #e5e7eb)', background: 'var(--bg-elevated, #f8fafc)' }}>
        {(['fluxo', 'formulario'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '10px 22px',
              border: 'none',
              borderBottom: activeTab === tab ? '2px solid #2563eb' : '2px solid transparent',
              background: 'none',
              color: activeTab === tab ? '#2563eb' : '#6b7280',
              fontWeight: activeTab === tab ? 600 : 400,
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            {tab === 'fluxo' ? '⬡ Fluxo' : '☰ Formulário'}
          </button>
        ))}
      </div>

      {/* Fluxo tab */}
      {activeTab === 'fluxo' && (
        <div>
          {/* Toolbar */}
          {!disabled && (
            <div style={{ padding: '8px 12px', display: 'flex', gap: 6, flexWrap: 'wrap', borderBottom: '1px solid var(--border, #e5e7eb)', background: 'var(--bg-elevated, #f8fafc)' }}>
              <span style={{ fontSize: 11, color: '#6b7280', alignSelf: 'center', marginRight: 4 }}>Adicionar:</span>
              {Object.keys(NODE_META).map(t => (
                <button
                  key={t}
                  onClick={() => addNode(t)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 5,
                    border: 'none',
                    background: NODE_META[t].bg,
                    color: '#fff',
                    cursor: 'pointer',
                    fontSize: 11,
                    fontWeight: 600,
                  }}
                >
                  + {NODE_META[t].label}
                </button>
              ))}
            </div>
          )}

          {/* Canvas + Inspector */}
          <div style={{ display: 'flex', gap: 0 }}>
            <div style={{ flex: 1, height: 520, minHeight: 520 }}>
              <ReactFlow
                nodes={rfNodes}
                edges={rfEdges}
                onNodesChange={onRfNodesChange}
                onEdgesChange={onRfEdgesChange}
                onConnect={disabled ? undefined : onConnect}
                onNodeClick={handleNodeClick}
                onPaneClick={handlePaneClick}
                nodeTypes={nodeTypes}
                fitView
                fitViewOptions={{ padding: 0.25 }}
                nodesDraggable={!disabled}
                nodesConnectable={!disabled}
                elementsSelectable={!disabled}
                deleteKeyCode={disabled ? null : 'Delete'}
              >
                <Background color="#e5e7eb" gap={20} />
                <Controls />
              </ReactFlow>
            </div>
            <div style={{ borderLeft: '1px solid var(--border, #e5e7eb)', padding: 12 }}>
              <NodeInspector
                nodeId={selectedNodeId}
                rfNodes={rfNodes}
                disabled={disabled}
                queues={queues}
                onUpdate={handleNodeUpdate}
                onDelete={handleNodeDelete}
              />
            </div>
          </div>
        </div>
      )}

      {/* Formulário tab */}
      {activeTab === 'formulario' && (
        <div style={{ padding: 16 }}>
          <fieldset disabled={disabled} style={{ border: 'none', padding: 0, margin: 0 }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 14 }}>Metas de SLA</h3>
            <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                Primeira resposta (min)
                <input
                  type="number" min={1} max={120000}
                  value={sla.firstResponseMinutes}
                  onChange={e => setSla(s => ({ ...s, firstResponseMinutes: Number(e.target.value) }))}
                  style={{ width: 120 }}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                Resolução (min)
                <input
                  type="number" min={1} max={120000}
                  value={sla.resolutionMinutes}
                  onChange={e => setSla(s => ({ ...s, resolutionMinutes: Number(e.target.value) }))}
                  style={{ width: 120 }}
                />
              </label>
            </div>

            <h3 style={{ margin: '0 0 12px', fontSize: 14 }}>Campos do formulário</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {fields.map((f, i) => (
                <FieldRow key={i} field={f} index={i} onChange={updateField} onRemove={removeField} />
              ))}
            </div>
            {!disabled && (
              <button
                onClick={addField}
                style={{ marginTop: 10, padding: '6px 14px', borderRadius: 6, border: '1px dashed #9ca3af', background: 'transparent', cursor: 'pointer', fontSize: 12 }}
              >
                + Adicionar campo
              </button>
            )}
          </fieldset>
        </div>
      )}
    </div>
  )
}

// ── Field row ──────────────────────────────────────────────────────

function FieldRow({
  field,
  index,
  onChange,
  onRemove,
}: {
  field: FieldDef
  index: number
  onChange: (i: number, patch: Record<string, unknown>) => void
  onRemove: (i: number) => void
}) {
  const set = (patch: Record<string, unknown>) => onChange(index, patch)
  const f = field
  const rowStyle: CSSProperties = {
    border: '1px solid var(--border, #e5e7eb)',
    borderRadius: 6,
    padding: '10px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    background: 'var(--bg-elevated, #f9fafb)',
  }
  return (
    <div style={rowStyle}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12, flex: '1 1 120px' }}>
          Chave
          <input value={f.key ?? ''} onChange={e => set({ key: e.target.value })} placeholder="campo_id" style={{ ...inputStyle, minWidth: 0 }} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12, flex: '2 1 180px' }}>
          Rótulo
          <input value={f.label ?? ''} onChange={e => set({ label: e.target.value })} placeholder="Nome do campo" style={{ ...inputStyle, minWidth: 0 }} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12, flex: '1 1 130px' }}>
          Tipo
          <select
            value={f.type ?? 'text'}
            onChange={e => set({ type: e.target.value, options: undefined, currency: undefined, columns: undefined })}
            style={{ ...inputStyle, minWidth: 0 }}
          >
            <option>text</option>
            <option>textarea</option>
            <option>integer</option>
            <option>decimal</option>
            <option>date</option>
            <option>select</option>
            <option>boolean</option>
            <option>attachment</option>
            <option>money</option>
            <option>reference</option>
            <option>repeatable_table</option>
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
          <input type="checkbox" checked={!!f.required} onChange={e => set({ required: e.target.checked })} />
          obrigatório
        </label>
        <button
          onClick={() => onRemove(index)}
          style={{ padding: '4px 10px', borderRadius: 5, border: '1px solid #fca5a5', background: '#fef2f2', color: '#dc2626', cursor: 'pointer', fontSize: 11, whiteSpace: 'nowrap' }}
        >
          Remover
        </button>
      </div>

      {(f.type === 'text' || f.type === 'textarea') && (
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 }}>
          Máx. caracteres
          <input type="number" min={1} max={10000} value={(f.maxLength as number) ?? 1000} onChange={e => set({ maxLength: Number(e.target.value) })} style={{ width: 80, ...inputStyle }} />
        </label>
      )}

      {f.type === 'select' && (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12 }}>
          Opções (id=rótulo, uma por linha)
          <textarea
            rows={3}
            value={((f.options as Array<{ id: string; label: string }>) ?? []).map(o => `${o.id}=${o.label}`).join('\n')}
            onChange={e =>
              set({
                options: e.target.value.split('\n').filter(Boolean).map(line => {
                  const [id, ...rest] = line.split('=')
                  return { id, label: rest.join('=') || id }
                }),
              })
            }
            style={{ ...inputStyle, fontFamily: 'monospace', fontSize: 11 }}
          />
        </label>
      )}

      {f.type === 'money' && (
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 }}>
          Moeda
          <input value={(f.currency as string) ?? 'BRL'} onChange={e => set({ currency: e.target.value })} style={{ width: 70, ...inputStyle }} />
        </label>
      )}

      {f.type === 'reference' && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12, flex: '1 1 180px' }}>
            Origem dos dados
            <select
              value={(f.source as { key: string } | undefined)?.key ?? ''}
              onChange={e => set({ source: e.target.value ? { key: e.target.value } : undefined, binding: undefined })}
              style={{ ...inputStyle, minWidth: 0 }}
            >
              <option value="">-- selecione --</option>
              <optgroup label="Financeiro / Operacional">
                <option value="cost_centers">Centros de custo</option>
                <option value="projects">Projetos</option>
              </optgroup>
              <optgroup label="Cadastros">
                <option value="clients">Clientes</option>
                <option value="collaborators">Colaboradores</option>
                <option value="sectors">Setores</option>
              </optgroup>
              <optgroup label="Logística">
                <option value="logistics.catalog">Catálogo de logística</option>
              </optgroup>
            </select>
          </label>
          {((f.source as { key: string } | undefined)?.key === 'cost_centers' || (f.source as { key: string } | undefined)?.key === 'projects') && (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12, flex: '1 1 200px' }}>
              Vincular ao campo do pedido (opcional)
              <select
                value={(f.binding as string) ?? ''}
                onChange={e => set({ binding: e.target.value || undefined })}
                style={{ ...inputStyle, minWidth: 0 }}
              >
                <option value="">Sem vínculo</option>
                {(f.source as { key: string } | undefined)?.key === 'cost_centers' && <option value="request.costCenterId">request.costCenterId</option>}
                {(f.source as { key: string } | undefined)?.key === 'projects' && <option value="request.projectId">request.projectId</option>}
              </select>
            </label>
          )}
        </div>
      )}

      {f.type === 'repeatable_table' && (
        <div style={{ fontSize: 12 }}>
          <b>Colunas</b>
          {((f.columns as Array<{ key: string; label: string; type: string }>) ?? []).map((col, ci) => (
            <div key={ci} style={{ display: 'flex', gap: 6, marginTop: 4 }}>
              <input
                placeholder="chave"
                value={col.key ?? ''}
                onChange={e => {
                  const cols = [...((f.columns as Array<Record<string, unknown>>) ?? [])]
                  cols[ci] = { ...cols[ci], key: e.target.value }
                  set({ columns: cols })
                }}
                style={{ ...inputStyle, flex: 1 }}
              />
              <input
                placeholder="rótulo"
                value={col.label ?? ''}
                onChange={e => {
                  const cols = [...((f.columns as Array<Record<string, unknown>>) ?? [])]
                  cols[ci] = { ...cols[ci], label: e.target.value }
                  set({ columns: cols })
                }}
                style={{ ...inputStyle, flex: 1 }}
              />
              <select
                value={col.type ?? 'text'}
                onChange={e => {
                  const cols = [...((f.columns as Array<Record<string, unknown>>) ?? [])]
                  cols[ci] = { ...cols[ci], type: e.target.value }
                  set({ columns: cols })
                }}
                style={{ ...inputStyle, width: 100 }}
              >
                <option>text</option>
                <option>integer</option>
                <option>decimal</option>
                <option>date</option>
                <option>select</option>
                <option>boolean</option>
                <option>money</option>
              </select>
              <button onClick={() => set({ columns: ((f.columns as unknown[]) ?? []).filter((_, n) => n !== ci) })} style={{ border: '1px solid #fca5a5', background: '#fef2f2', color: '#dc2626', borderRadius: 4, cursor: 'pointer', padding: '2px 8px' }}>–</button>
            </div>
          ))}
          <button onClick={() => set({ columns: [...((f.columns as unknown[]) ?? []), { key: '', label: '', type: 'text' }] })} style={{ marginTop: 4, fontSize: 11, padding: '3px 8px', borderRadius: 4, border: '1px dashed #9ca3af', background: 'transparent', cursor: 'pointer' }}>
            + coluna
          </button>
        </div>
      )}
    </div>
  )
}
