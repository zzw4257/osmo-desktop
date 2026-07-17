import type { Grade } from "@osmo/color-engine";
import { hydrateGrade } from "@osmo/color-engine";

/**
 * Grade persistence, M1 driver: IndexedDB — works identically in the
 * browser and WKWebView with zero native dependencies. The clips/devices
 * relational store (SQLite via tauri-plugin-sql / wa-sqlite) arrives in M2;
 * this interface is what it will implement.
 */
export interface GradeStore {
  load(clipKey: string): Promise<Grade | null>;
  save(clipKey: string, grade: Grade): Promise<void>;
  listKeys(): Promise<string[]>;
  /** Undo history (oldest→newest snapshots), persisted so undo survives
   * reopening the app. */
  loadHistory(clipKey: string): Promise<Grade[]>;
  saveHistory(clipKey: string, history: Grade[]): Promise<void>;
}

const DB_NAME = "osmo-desktop";
const STORE = "grades";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
  });
}

export class IdbGradeStore implements GradeStore {
  #db: Promise<IDBDatabase> | null = null;

  #database(): Promise<IDBDatabase> {
    this.#db ??= openDb();
    return this.#db;
  }

  async load(clipKey: string): Promise<Grade | null> {
    const db = await this.#database();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(clipKey);
      req.onsuccess = () => resolve(req.result ? hydrateGrade(req.result) : null);
      req.onerror = () => reject(req.error ?? new Error("grade load failed"));
    });
  }

  async save(clipKey: string, grade: Grade): Promise<void> {
    const db = await this.#database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(grade, clipKey);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("grade save failed"));
    });
  }

  async listKeys(): Promise<string[]> {
    const db = await this.#database();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).getAllKeys();
      req.onsuccess = () =>
        resolve((req.result as string[]).filter((k) => !k.endsWith(HISTORY_SUFFIX)));
      req.onerror = () => reject(req.error ?? new Error("grade listKeys failed"));
    });
  }

  async loadHistory(clipKey: string): Promise<Grade[]> {
    const db = await this.#database();
    return new Promise((resolve, reject) => {
      const req = db
        .transaction(STORE, "readonly")
        .objectStore(STORE)
        .get(clipKey + HISTORY_SUFFIX);
      req.onsuccess = () =>
        resolve(Array.isArray(req.result) ? (req.result as unknown[]).map(hydrateGrade) : []);
      req.onerror = () => reject(req.error ?? new Error("history load failed"));
    });
  }

  async saveHistory(clipKey: string, history: Grade[]): Promise<void> {
    const db = await this.#database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(history.slice(-MAX_HISTORY), clipKey + HISTORY_SUFFIX);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("history save failed"));
    });
  }
}

const HISTORY_SUFFIX = "::history";
const MAX_HISTORY = 40;

/** Stable identity for a local file until content hashing lands (M2). */
export function clipKeyForFile(file: File): string {
  return `${file.name}:${file.size}`;
}
