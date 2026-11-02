import { useEffect, useRef, useState } from "react";
export type DraftSnapshot = {
  title: string;
  description: string;
  fields: Record<string, unknown>;
};
export type SaveAttempt = DraftSnapshot & {
  expectedVersion: number;
  commandKey: string;
  commandId: string;
};
export function useDraftAutosave(
  save: (attempt: SaveAttempt) => Promise<{ currentVersion: number }>,
  initialVersion: number,
) {
  const [state, setState] = useState("saved");
  const version = useRef(initialVersion),
    pending = useRef<DraftSnapshot | null>(null),
    failed = useRef<SaveAttempt | null>(null);
  const running = useRef<Promise<number> | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    alive = useRef(true),
    blocked = useRef(false);
  const saveRef = useRef(save);
  const lastError = useRef<unknown>(null);
  saveRef.current = save;
  const publish = (value: string) => {
    if (alive.current) setState(value);
  };
  const flush = async (retry = false): Promise<number> => {
    if (!alive.current) return version.current;
    clearTimeout(timer.current);
    if (running.current) {
      await running.current;
      return flush(retry);
    }
    if (blocked.current)
      throw new Error("Conflito: recarregue explicitamente para resolver.");
    if (failed.current && !retry)
      throw new Error("Falha de rede: repita a tentativa anterior.");
    if (!pending.current && !failed.current) return version.current;
    const snapshot = failed.current ?? pending.current!;
    const attempt = failed.current ?? {
      ...structuredClone(snapshot),
      expectedVersion: version.current,
      commandId: crypto.randomUUID(),
      commandKey: crypto.randomUUID(),
    };
    pending.current = failed.current ? pending.current : null;
    failed.current = null;
    publish("saving");
    const work = (async () => {
      try {
        const result = await saveRef.current(attempt);
        version.current = result.currentVersion;
        lastError.current = null;
        publish(pending.current ? "pending" : "saved");
        return version.current;
      } catch (error: any) {
        lastError.current = error;
        const status = error?.response?.status;
        failed.current = status >= 400 && status < 500 && status !== 409 ? null : attempt;
        blocked.current = error?.response?.status === 409;
        publish(blocked.current ? "conflict" : "error");
        throw error;
      } finally {
        running.current = null;
      }
    })();
    running.current = work;
    await work;
    if (pending.current && alive.current) return flush();
    return version.current;
  };
  const schedule = (value: DraftSnapshot) => {
    pending.current = structuredClone(value);
    clearTimeout(timer.current);
    if (blocked.current || failed.current) return;
    publish(running.current ? "saving" : "pending");
    timer.current = setTimeout(() => {
      void flush().catch(() => undefined);
    }, 350);
  };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clearTimeout(timer.current);
    };
  }, []);
  return {
    state,
    schedule,
    flush: () => flush(),
    retry: () => flush(true),
    currentVersion: version,
    lastError,
  };
}
