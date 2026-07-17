/**
 * Shared IndexedDB handle for the app's persistent state. One database,
 * versioned schema, identical in the browser and WKWebView — the storage
 * consistency layer both shells share.
 *
 * Stores:
 * - grades:  clipKey → Grade JSON (+ "::history" undo stacks)
 * - library: kv — active source association, clip states (edit/export)
 */
export const DB_NAME = "osmo-desktop";
export const DB_VERSION = 2;
export const STORE_GRADES = "grades";
export const STORE_LIBRARY = "library";

let dbPromise: Promise<IDBDatabase> | null = null;

export function openAppDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_GRADES)) {
        db.createObjectStore(STORE_GRADES);
      }
      if (!db.objectStoreNames.contains(STORE_LIBRARY)) {
        db.createObjectStore(STORE_LIBRARY);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
  });
  return dbPromise;
}

export function idbGet<T>(store: string, key: string): Promise<T | null> {
  return openAppDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const req = db.transaction(store, "readonly").objectStore(store).get(key);
        req.onsuccess = () => resolve((req.result as T) ?? null);
        req.onerror = () => reject(req.error ?? new Error(`get ${store}/${key} failed`));
      }),
  );
}

export function idbPut(store: string, key: string, value: unknown): Promise<void> {
  return openAppDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(store, "readwrite");
        tx.objectStore(store).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error(`put ${store}/${key} failed`));
      }),
  );
}

export function idbDelete(store: string, key: string): Promise<void> {
  return openAppDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(store, "readwrite");
        tx.objectStore(store).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error(`delete ${store}/${key} failed`));
      }),
  );
}

export function idbKeys(store: string): Promise<string[]> {
  return openAppDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const req = db.transaction(store, "readonly").objectStore(store).getAllKeys();
        req.onsuccess = () => resolve(req.result as string[]);
        req.onerror = () => reject(req.error ?? new Error(`keys ${store} failed`));
      }),
  );
}
