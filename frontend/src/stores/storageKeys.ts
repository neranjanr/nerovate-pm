/** Nerovate-PM storage keys. Writes use `nv_*`; reads fall back to legacy `nrg_*` for one release. */

export const AUTH_KEYS = {
  access: "nv_access",
  role: "nv_role",
  user: "nv_user",
} as const;

export const LEGACY_AUTH_KEYS = {
  access: "nrg_access",
  role: "nrg_role",
  user: "nrg_user",
} as const;

export const THEME_KEY = "nv-theme";
export const LEGACY_THEME_KEY = "nrg-theme";

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Read the new key first, fall back to the legacy key (one-release compat). */
export function readWithFallback(
  store: Pick<KeyValueStore, "getItem">,
  key: string,
  legacyKey: string
): string | null {
  return store.getItem(key) ?? store.getItem(legacyKey);
}

/** Write the new key and drop the legacy key so old sessions migrate forward. */
export function writeNewKey(
  store: KeyValueStore,
  key: string,
  legacyKey: string,
  value: string
): void {
  store.setItem(key, value);
  if (legacyKey !== key) store.removeItem(legacyKey);
}
