export const RECOVERY_STORAGE_KEY = "monitoring-schedule:recovery:v1";
const CLOUD_BASE_STORAGE_KEY = "monitoring-schedule:cloud-base:v1";
export type RecoveryCopy<T> = { savedAt: string; reason: string; payload: T };

export function sameSnapshot(a: unknown, b: unknown) {
  const sort = (value: unknown): unknown => Array.isArray(value) ? value.map(sort)
    : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sort(item)])) : value;
  return JSON.stringify(sort(a)) === JSON.stringify(sort(b));
}

export function readCloudBase<T>(storage: Pick<Storage, "getItem">, workspaceId: string): T | null {
  try {
    const raw = storage.getItem(`${CLOUD_BASE_STORAGE_KEY}:${workspaceId}`);
    return raw ? JSON.parse(raw) as T : null;
  } catch { return null; }
}

export function writeCloudBase<T>(storage: Pick<Storage, "setItem">, workspaceId: string, payload: T) {
  storage.setItem(`${CLOUD_BASE_STORAGE_KEY}:${workspaceId}`, JSON.stringify(payload));
}

export function recoveryCopies<T>(storage: Pick<Storage, "getItem">): RecoveryCopy<T>[] {
  const raw = storage.getItem(RECOVERY_STORAGE_KEY);
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.some((copy) => !copy || typeof copy !== "object" || !copy.payload || typeof copy.savedAt !== "string")) {
    throw new Error("Не удалось прочитать резервные копии этого браузера");
  }
  return parsed;
}

export function preserveRecoveryCopy<T>(storage: Pick<Storage, "getItem" | "setItem">, payload: T, reason: string) {
  const copies = recoveryCopies<T>(storage);
  if (copies.length && sameSnapshot(copies.at(-1)!.payload, payload)) return;
  storage.setItem(RECOVERY_STORAGE_KEY, JSON.stringify([...copies, { savedAt: new Date().toISOString(), reason, payload }]));
  // Do not prune old copies automatically. A full store stops destructive actions.
}
