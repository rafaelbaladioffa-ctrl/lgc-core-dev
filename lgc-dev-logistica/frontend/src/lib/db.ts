import type { QueueOp, Store } from './queue';

/** IndexedDB mínimo: fila de operações e cache chave/valor (dados do almoxarifado para uso offline). */
const DB_NAME = 'axis-logistica';
const open = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('queue', { keyPath: 'opId' });
      req.result.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

function run<T>(store: 'queue' | 'kv', mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        tx.oncomplete = () => { resolve(req.result); db.close(); };
        tx.onerror = () => { reject(tx.error); db.close(); };
      }),
  );
}

export const idbStore: Store = {
  all: () => run<QueueOp[]>('queue', 'readonly', (s) => s.getAll()),
  put: async (op) => { await run('queue', 'readwrite', (s) => s.put(op)); },
  delete: async (opId) => { await run('queue', 'readwrite', (s) => s.delete(opId)); },
};

export const kv = {
  get: <T>(key: string) => run<T | undefined>('kv', 'readonly', (s) => s.get(key)),
  set: async (key: string, value: unknown) => { await run('kv', 'readwrite', (s) => s.put(value, key)); },
};
