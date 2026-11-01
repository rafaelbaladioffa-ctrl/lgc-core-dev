import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, api, loadSettings, saveSettings, type Bootstrap, type Settings, type Warehouse } from './lib/api';
import { resolveCode, type Scanned } from './lib/codes';
import { idbStore, kv } from './lib/db';
import { fmtDateTime, fmtQty, parseQty } from './lib/format';
import { OfflineQueue, type OpType, type QueueOp } from './lib/queue';
import { cameraSupported, startCamera } from './lib/scanner';

type Tab = 'sep' | 'arm' | 'inv' | 'sync';
const TYPE_LABEL: Record<OpType, string> = { 'picking.start': 'Iniciar separação', 'picking.scan': 'Leitura de separação', 'picking.complete': 'Concluir separação', 'putaway.confirm': 'Armazenagem', 'count.submit': 'Contagem' };

function useOnline() {
  const [on, setOn] = useState(navigator.onLine);
  useEffect(() => {
    const up = () => setOn(true), down = () => setOn(false);
    addEventListener('online', up); addEventListener('offline', down);
    return () => { removeEventListener('online', up); removeEventListener('offline', down); };
  }, []);
  return on;
}

/** Campo de leitura: coletor USB/teclado (Enter) ou câmera. */
function ScanInput({ label, onCode, hint }: { label: string; onCode: (code: string) => void; hint?: string }) {
  const [text, setText] = useState('');
  const [cam, setCam] = useState(false);
  const [camError, setCamError] = useState('');
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (!cam || !video.current) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    startCamera(video.current, (c) => { onCode(c); setCam(false); })
      .then((s) => { if (cancelled) s(); else stop = s; })
      .catch(() => { setCamError('Não foi possível abrir a câmera. Digite o código.'); setCam(false); });
    return () => { cancelled = true; stop?.(); };
  }, [cam, onCode]);
  const submit = () => { const v = text.trim(); if (v) { onCode(v); setText(''); } };
  return (
    <div className="card">
      <label className="lbl" htmlFor="scan">{label}</label>
      {hint && <p className="hint">{hint}</p>}
      <div className="row">
        <input id="scan" className="inp big" value={text} autoFocus autoComplete="off" inputMode="text" placeholder="Leia ou digite o código" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
        <button className="btn" onClick={submit} disabled={!text.trim()}>OK</button>
      </div>
      {cameraSupported() && <button className="btn ghost" onClick={() => { setCamError(''); setCam((v) => !v); }}>{cam ? 'Fechar câmera' : 'Ler com a câmera'}</button>}
      {cam && <video ref={video} className="video" playsInline muted />}
      {camError && <p className="err">{camError}</p>}
    </div>
  );
}

export function App() {
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const online = useOnline();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [ops, setOps] = useState<QueueOp[]>([]);
  const [tab, setTab] = useState<Tab>('sep');
  const [msg, setMsg] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [whFilter, setWhFilter] = useState('');

  const queue = useMemo(() => new OfflineQueue(idbStore, (o) => api.batch(settings, o)), [settings]);
  const refreshOps = useCallback(async () => setOps(await queue.list()), [queue]);

  const loadBoot = useCallback(async (s: Settings) => {
    if (!s.warehouseId) return;
    const key = `boot:${s.warehouseId}`;
    try { const b = await api.bootstrap(s, s.warehouseId); setBoot(b); await kv.set(key, b); setMsg(''); }
    catch (e) {
      const cached = await kv.get<Bootstrap>(key).catch(() => undefined);
      if (cached) { setBoot(cached); setMsg(`Sem conexão: usando dados de ${fmtDateTime(cached.generatedAt)}.`); }
      else setMsg(e instanceof ApiError ? e.message : 'Sem conexão e sem dados salvos neste aparelho.');
    }
  }, []);

  const sync = useCallback(async () => {
    if (syncing || !settings.token) return;
    setSyncing(true);
    try {
      const r = await queue.flush();
      if (r.offline) setMsg('Sem conexão com o servidor. As leituras seguem salvas neste aparelho.');
      else if (r.applied + r.duplicated > 0) { setMsg(`${r.applied + r.duplicated} operação(ões) sincronizada(s).`); await loadBoot(settings); }
    } finally { setSyncing(false); await refreshOps(); }
  }, [syncing, settings, queue, loadBoot, refreshOps]);

  useEffect(() => { void refreshOps(); }, [refreshOps]);
  useEffect(() => { if (settings.token) api.warehouses(settings).then(setWarehouses).catch(() => undefined); }, [settings]);
  useEffect(() => { void loadBoot(settings); }, [settings.warehouseId, settings.token]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (online) void sync(); }, [online]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setInterval(() => { if (navigator.onLine) void sync(); }, 30_000); return () => clearInterval(t); }, [sync]);
  useEffect(() => { if ('serviceWorker' in navigator && import.meta.env.PROD) void navigator.serviceWorker.register('/sw.js'); }, []);

  const enqueue = async (type: OpType, payload: Record<string, unknown>, label: string) => {
    await queue.enqueue(type, payload, label);
    await refreshOps();
    if (navigator.onLine) void sync();
  };

  const pending = ops.filter((o) => o.state === 'PENDENTE').length;
  const problems = ops.filter((o) => o.state !== 'PENDENTE').length;

  if (!settings.token) {
    return <Login onSave={(s) => { saveSettings(s); setSettings(s); }} settings={settings} />;
  }
  if (!settings.warehouseId) {
    return (
      <main className="page">
        <h1>Selecione o almoxarifado</h1>
        {warehouses.length === 0 && <p className="hint">Carregando… (precisa de conexão na primeira vez)</p>}
        <input className="inp" aria-label="Buscar almoxarifado" placeholder="Buscar por código ou nome" value={whFilter} onChange={(e) => setWhFilter(e.target.value)} />
        {warehouses.filter((w) => `${w.code} ${w.name}`.toLowerCase().includes(whFilter.toLowerCase())).slice(0, 50).map((w) => <button key={w.id} className="btn block" onClick={() => { const s = { ...settings, warehouseId: w.id }; saveSettings(s); setSettings(s); }}>{w.code} — {w.name}</button>)}
        <button className="btn ghost" onClick={() => { const s = { ...settings, token: '' }; saveSettings(s); setSettings(s); }}>Sair</button>
      </main>
    );
  }

  return (
    <main className="page">
      <header className="top">
        <img src="/axis_logo_white.svg" alt="Axis" height={22} />
        <span className="badge-app">Logística</span>
        <span className={`dot ${online ? 'on' : 'off'}`} title={online ? 'Online' : 'Offline'} />
        <button className="chip" onClick={() => setTab('sync')}>{pending > 0 ? `${pending} pendente(s)` : 'Em dia'}{problems > 0 ? ` · ${problems} com problema` : ''}</button>
      </header>
      {msg && <p className="notice" role="status">{msg}</p>}
      {!boot && <p className="hint">Sem dados deste almoxarifado ainda. Conecte-se uma vez para baixar as tarefas.</p>}
      {boot && tab === 'sep' && <Picking boot={boot} ops={ops} enqueue={enqueue} />}
      {boot && tab === 'arm' && <Putaway boot={boot} ops={ops} enqueue={enqueue} />}
      {boot && tab === 'inv' && <Counting boot={boot} ops={ops} enqueue={enqueue} />}
      {tab === 'sync' && <SyncPanel ops={ops} syncing={syncing} onSync={sync} queue={queue} refresh={refreshOps} onChangeWarehouse={() => { const s = { ...settings, warehouseId: undefined }; saveSettings(s); setSettings(s); setBoot(null); }} />}
      <nav className="tabs">
        {([['sep', 'Separação'], ['arm', 'Armazenagem'], ['inv', 'Inventário'], ['sync', 'Pendências']] as const).map(([k, t]) => (
          <button key={k} className={tab === k ? 'tab active' : 'tab'} onClick={() => setTab(k)}>{t}</button>
        ))}
      </nav>
    </main>
  );
}

function Login({ settings, onSave }: { settings: Settings; onSave: (s: Settings) => void }) {
  const [token, setToken] = useState('');
  const [apiUrl, setApiUrl] = useState(settings.apiUrl);
  return (
    <main className="page">
      <h1>Axis Logística</h1>
      <p className="hint">O acesso usa o login do Axis. Abra este aplicativo pelo Axis ou cole abaixo o token da sessão.</p>
      <label className="lbl" htmlFor="api">Endereço da API</label>
      <input id="api" className="inp" value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} />
      <label className="lbl" htmlFor="tok">Token do Axis</label>
      <textarea id="tok" className="inp" rows={4} value={token} onChange={(e) => setToken(e.target.value.trim())} />
      <button className="btn block" disabled={token.length < 20} onClick={() => onSave({ ...settings, apiUrl: apiUrl.trim() || '/api/v1', token })}>Entrar</button>
    </main>
  );
}

type Enqueue = (type: OpType, payload: Record<string, unknown>, label: string) => Promise<void>;
interface ScreenProps { boot: Bootstrap; ops: QueueOp[]; enqueue: Enqueue }

const matName = (b: Bootstrap, id: string) => { const m = b.materials.find((x) => x.id === id); return m ? `${m.code} — ${m.description}` : id; };

function Picking({ boot, ops, enqueue }: ScreenProps) {
  const [taskId, setTaskId] = useState<string | null>(null);
  const [itemId, setItemId] = useState<string | null>(null);
  const [step, setStep] = useState<'loc' | 'mat' | 'qty'>('loc');
  const [qty, setQty] = useState('');
  const [err, setErr] = useState('');
  const task = boot.pickingTasks.find((t) => t.id === taskId);
  const item = task?.items.find((i) => i.id === itemId);
  const queued = (id: string) => ops.filter((o) => o.type === 'picking.scan' && o.payload.pickingItemId === id && o.state === 'PENDENTE').reduce((s, o) => s + Number(o.payload.quantity), 0);
  const remaining = (i: NonNullable<typeof item>) => Number(i.planned) - Number(i.picked) - queued(i.id);

  const onCode = useCallback((code: string) => {
    if (!item) return;
    const r: Scanned = resolveCode(code, boot.materials, boot.locations);
    setErr('');
    if (step === 'loc') {
      if (r.kind === 'location' && r.id === item.locationId) setStep('mat'); else setErr(`Endereço incorreto. Vá para ${item.locationCode}.`);
    } else if (step === 'mat') {
      if (r.kind === 'material' && r.id === item.materialId) { setStep('qty'); setQty(String(remaining(item) > 0 ? remaining(item) : '')); } else setErr('Material diferente do da tarefa.');
    }
  }, [item, step, boot, ops]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!task) {
    return (
      <section>
        <h2>Tarefas de separação</h2>
        {boot.pickingTasks.length === 0 && <p className="hint">Nenhuma tarefa aberta neste almoxarifado.</p>}
        {boot.pickingTasks.map((t) => (
          <button key={t.id} className="card btn-card" onClick={() => setTaskId(t.id)}>
            <strong>{t.code}</strong> <span className="hint">{t.status === 'ABERTA' ? 'Aberta' : 'Em separação'} · {t.items.length} item(ns)</span>
          </button>
        ))}
      </section>
    );
  }
  if (!item) {
    const started = ops.some((o) => o.type === 'picking.start' && o.payload.id === task.id) || task.status === 'EM_SEPARACAO';
    return (
      <section>
        <button className="btn ghost" onClick={() => setTaskId(null)}>← Tarefas</button>
        <h2>{task.code}</h2>
        {!started && <button className="btn block" onClick={() => enqueue('picking.start', { id: task.id }, `Iniciar ${task.code}`)}>Iniciar separação</button>}
        {task.items.map((i) => (
          <button key={i.id} className="card btn-card" disabled={!started} onClick={() => { setItemId(i.id); setStep('loc'); setErr(''); }}>
            <strong>{i.locationCode}</strong> · {matName(boot, i.materialId)}
            <div className="hint">Separado {fmtQty(Number(i.picked) + queued(i.id))} de {fmtQty(i.planned)}{i.status !== 'PENDENTE' ? ` · ${i.status}` : ''}</div>
          </button>
        ))}
        {started && <button className="btn block" onClick={() => enqueue('picking.complete', { id: task.id }, `Concluir ${task.code}`)}>Concluir separação</button>}
      </section>
    );
  }
  const q = parseQty(qty);
  const m = boot.materials.find((x) => x.id === item.materialId);
  const invalid = q === null || q <= 0 || (m !== undefined && q > remaining(item) + 1e-9) || (m !== undefined && !Number.isInteger(q * 10 ** m.uomPrecision));
  return (
    <section>
      <button className="btn ghost" onClick={() => setItemId(null)}>← Itens</button>
      <h2>{matName(boot, item.materialId)}</h2>
      <p>Endereço <strong>{item.locationCode}</strong> · faltam <strong>{fmtQty(remaining(item))}</strong> {m?.uom}</p>
      {step === 'loc' && <ScanInput label="1. Leia o endereço" hint={`Esperado: ${item.locationCode}`} onCode={onCode} />}
      {step === 'mat' && <ScanInput label="2. Leia o material" hint="Código de barras, QR ou SKU" onCode={onCode} />}
      {step === 'qty' && (
        <div className="card">
          <label className="lbl" htmlFor="q">3. Quantidade ({m?.uom})</label>
          <input id="q" className="inp big" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
          {m?.serialControlled && <p className="err">Item seriado: leia a série pelo cadastro online (não disponível offline).</p>}
          <button className="btn block" disabled={invalid || !!m?.serialControlled} onClick={async () => {
            await enqueue('picking.scan', { id: task.id, pickingItemId: item.id, locationId: item.locationId, materialId: item.materialId, ...(item.lotId ? { lotId: item.lotId } : {}), quantity: q }, `${fmtQty(q!)} × ${matName(boot, item.materialId)}`);
            setItemId(null);
          }}>Confirmar</button>
        </div>
      )}
      {err && <p className="err" role="alert">{err}</p>}
    </section>
  );
}

function Putaway({ boot, ops, enqueue }: ScreenProps) {
  const [id, setId] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const done = (taskId: string) => ops.some((o) => o.type === 'putaway.confirm' && o.payload.id === taskId);
  const task = boot.putawayTasks.find((t) => t.id === id);
  const onCode = useCallback((code: string) => {
    if (!task) return;
    const r = resolveCode(code, boot.materials, boot.locations);
    if (r.kind !== 'location') { setErr('Leia o código do endereço de destino.'); return; }
    setErr('');
    void enqueue('putaway.confirm', { id: task.id, locationId: r.id }, `${task.code} → ${r.code}`).then(() => setId(null));
  }, [task, boot]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!task) {
    const list = boot.putawayTasks.filter((t) => !done(t.id));
    return (
      <section>
        <h2>Armazenagem</h2>
        {list.length === 0 && <p className="hint">Nenhuma tarefa de armazenagem.</p>}
        {list.map((t) => <button key={t.id} className="card btn-card" onClick={() => setId(t.id)}><strong>{t.code}</strong> · {matName(boot, t.materialId)}<div className="hint">{fmtQty(t.quantity)} · sugerido: {t.suggestedLocationCode ?? 'sem sugestão'}</div></button>)}
      </section>
    );
  }
  return (
    <section>
      <button className="btn ghost" onClick={() => setId(null)}>← Tarefas</button>
      <h2>{matName(boot, task.materialId)}</h2>
      <p>Quantidade {fmtQty(task.quantity)} · destino sugerido <strong>{task.suggestedLocationCode ?? '—'}</strong></p>
      <ScanInput label="Leia o endereço de destino" onCode={onCode} />
      {err && <p className="err" role="alert">{err}</p>}
    </section>
  );
}

function Counting({ boot, ops, enqueue }: ScreenProps) {
  const [vals, setVals] = useState<Record<string, string>>({});
  const counted = (lineId: string) => ops.some((o) => o.type === 'count.submit' && o.payload.lineId === lineId);
  if (boot.countSheets.length === 0) return <section><h2>Inventário</h2><p className="hint">Nenhuma contagem em andamento.</p></section>;
  return (
    <section>
      <h2>Inventário (contagem cega)</h2>
      {boot.countSheets.map((s) => (
        <div key={s.id} className="card">
          <strong>{s.code}</strong> <span className="hint">{s.round}ª contagem</span>
          {s.lines.filter((l) => !counted(l.id)).map((l) => {
            const q = parseQty(vals[l.id] ?? '');
            return (
              <div key={l.id} className="line">
                <div><strong>{l.locationCode}</strong> · {matName(boot, l.materialId)}<div className="hint">{l.condition}</div></div>
                <div className="row">
                  <input className="inp" aria-label="Quantidade contada" inputMode="decimal" value={vals[l.id] ?? ''} onChange={(e) => setVals({ ...vals, [l.id]: e.target.value })} />
                  <button className="btn" disabled={q === null || q < 0} onClick={() => enqueue('count.submit', { id: s.id, lineId: l.id, quantity: q }, `Contagem ${l.locationCode}`)}>Contei</button>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </section>
  );
}

function SyncPanel({ ops, syncing, onSync, queue, refresh, onChangeWarehouse }: { ops: QueueOp[]; syncing: boolean; onSync: () => void; queue: OfflineQueue; refresh: () => Promise<void>; onChangeWarehouse: () => void }) {
  return (
    <section>
      <h2>Pendências de sincronização</h2>
      <button className="btn block" onClick={onSync} disabled={syncing}>{syncing ? 'Sincronizando…' : 'Sincronizar agora'}</button>
      {ops.length === 0 && <p className="hint">Tudo sincronizado.</p>}
      {ops.map((o) => (
        <div key={o.opId} className={`card state-${o.state}`}>
          <strong>{o.label ?? TYPE_LABEL[o.type]}</strong>
          <div className="hint">{fmtDateTime(o.clientAt)} · {o.state === 'PENDENTE' ? 'aguardando envio' : o.state === 'CONFLITO' ? 'conflito' : 'rejeitada'}{o.attempts > 0 ? ` · ${o.attempts} tentativa(s)` : ''}</div>
          {o.message && <p className="err">{o.message}</p>}
          {o.state !== 'PENDENTE' && (
            <div className="row">
              <button className="btn ghost" onClick={async () => { await queue.dismiss(o.opId); await refresh(); }}>Dispensar</button>
              {o.state === 'REJEITADA' && <button className="btn ghost" onClick={async () => { await queue.retryAsNew(o.opId); await refresh(); onSync(); }}>Tentar de novo</button>}
            </div>
          )}
        </div>
      ))}
      <button className="btn ghost" onClick={onChangeWarehouse}>Trocar de almoxarifado</button>
    </section>
  );
}
