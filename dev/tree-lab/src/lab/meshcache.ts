// Persistent cache of built specimens (IndexedDB), keyed by build commit and specimen. Generation is deterministic
// for a given commit, so a specimen built once is reused on every later visit: no growth, no meshing, only the
// GPU upload. Entries from other commits are dropped on open. Uncommitted builds ("dev", "…+") are not cached.
import type { BuiltSpecimen } from '../build.ts';

const DB = 'tree-lab-meshes', STORE = 'specimens';
let dbp: Promise<IDBDatabase | null> | null = null;

function open(commit: string): Promise<IDBDatabase | null> {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined' || commit === 'dev' || commit.endsWith('+')) return resolve(null);
    const rq = indexedDB.open(DB, 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore(STORE);
    rq.onerror = () => resolve(null);
    rq.onsuccess = () => {
      const db = rq.result;
      // drop other commits' entries
      const tx = db.transaction(STORE, 'readwrite'), st = tx.objectStore(STORE), cur = st.openKeyCursor();
      cur.onsuccess = () => { const c = cur.result; if (!c) return; if (!String(c.key).startsWith(commit + ':')) st.delete(c.key); c.continue(); };
      tx.oncomplete = () => resolve(db); tx.onerror = () => resolve(db);
    };
  });
  return dbp;
}
export async function cacheGet(commit: string, id: string): Promise<BuiltSpecimen | null> {
  const db = await open(commit); if (!db) return null;
  return new Promise((resolve) => {
    const rq = db.transaction(STORE).objectStore(STORE).get(`${commit}:${id}`);
    rq.onsuccess = () => resolve((rq.result as BuiltSpecimen) ?? null); rq.onerror = () => resolve(null);
  });
}
export async function cachePut(commit: string, id: string, b: BuiltSpecimen): Promise<void> {
  const db = await open(commit); if (!db) return;
  await new Promise<void>((resolve) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(b, `${commit}:${id}`); tx.oncomplete = () => resolve(); tx.onerror = () => resolve(); tx.onabort = () => resolve(); });
}
