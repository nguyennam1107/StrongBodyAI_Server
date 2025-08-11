// Simple in-memory idempotency store (can swap with Redis)
interface Entry { status: 'success' | 'error'; response: any; createdAt: number; }

const store = new Map<string, Entry>();
const TTL_MS = 5 * 60 * 1000; // 5 minutes

export function setIdempotent(key: string, entry: Entry) {
  store.set(key, entry);
}

export function getIdempotent(key: string): Entry | undefined {
  const val = store.get(key);
  if (!val) return undefined;
  if (Date.now() - val.createdAt > TTL_MS) {
    store.delete(key);
    return undefined;
  }
  return val;
}

export function cleanupIdempotency() {
  const now = Date.now();
  for (const [k, v] of store) {
    if (now - v.createdAt > TTL_MS) store.delete(k);
  }
}

// run periodic cleanup
setInterval(cleanupIdempotency, TTL_MS);
