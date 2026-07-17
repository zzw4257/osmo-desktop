import type { Grade } from "@osmo/color-engine";
import { hydrateGrade } from "@osmo/color-engine";
import { STORE_GRADES, idbGet, idbKeys, idbPut } from "../store/idb";

/**
 * Grade persistence over the shared app database — identical in the browser
 * and WKWebView. The Repository shape stays SQL-swappable if a relational
 * store ever becomes necessary.
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

const HISTORY_SUFFIX = "::history";
const MAX_HISTORY = 40;

export class IdbGradeStore implements GradeStore {
  async load(clipKey: string): Promise<Grade | null> {
    const stored = await idbGet(STORE_GRADES, clipKey);
    return stored ? hydrateGrade(stored) : null;
  }

  async save(clipKey: string, grade: Grade): Promise<void> {
    await idbPut(STORE_GRADES, clipKey, grade);
  }

  async listKeys(): Promise<string[]> {
    const keys = await idbKeys(STORE_GRADES);
    return keys.filter((k) => !k.endsWith(HISTORY_SUFFIX));
  }

  async loadHistory(clipKey: string): Promise<Grade[]> {
    const stored = await idbGet(STORE_GRADES, clipKey + HISTORY_SUFFIX);
    return Array.isArray(stored) ? (stored as unknown[]).map(hydrateGrade) : [];
  }

  async saveHistory(clipKey: string, history: Grade[]): Promise<void> {
    await idbPut(STORE_GRADES, clipKey + HISTORY_SUFFIX, history.slice(-MAX_HISTORY));
  }
}

/** Stable identity for a local file until content hashing lands. */
export function clipKeyForFile(file: File): string {
  return `${file.name}:${file.size}`;
}
