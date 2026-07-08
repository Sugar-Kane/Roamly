// localStorage that can never crash the app. Safari Private mode (older iOS),
// storage-disabled browsers, and full quotas all make raw localStorage THROW —
// and several of our reads run inside useState initializers, i.e. during
// render, where an exception means a white screen. These wrappers degrade to
// in-memory no-ops instead.

export function loadPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function savePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode / quota — preference just won't persist */
  }
}

export function removePref(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
