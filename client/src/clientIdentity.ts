/**
 * Client Identity
 * ===============
 * Generates and persists a stable per-browser identifier that the
 * server uses to give the same player the same display name across
 * rooms and reconnects. Lives in localStorage; cleared only when the
 * user wipes site data (which is the natural boundary).
 *
 * The server is the source of truth for the display name itself; the
 * client just sends its id along on join.
 */

const STORAGE_KEY = "warden.clientPlayerId";

/**
 * Read the persistent id from localStorage, or mint a new one if
 * none exists yet. Safe to call from any browser context that has
 * access to `localStorage` (we never throw on missing storage).
 */
export function getOrCreateClientPlayerId(): string {
  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing && existing.length > 0) return existing;
  } catch {
    // localStorage can throw in privacy-mode / SSR / sandboxed iframes.
    // Fall through and mint an in-memory id (won't persist across reloads).
  }
  const fresh = generateId();
  try {
    window.localStorage.setItem(STORAGE_KEY, fresh);
  } catch {
    /* ignore - the in-memory value is still usable for this session */
  }
  return fresh;
}

/**
 * Generate a reasonably-unique id without bringing in a uuid dep.
 * Uses crypto.randomUUID when available, else falls back to a
 * 16-byte time+random hex string.
 */
function generateId(): string {
  try {
    const c = (typeof crypto !== "undefined" ? crypto : undefined) as any;
    if (c && typeof c.randomUUID === "function") {
      return c.randomUUID();
    }
  } catch {
    /* ignore */
  }
  let s = "";
  for (let i = 0; i < 32; i++) {
    s += Math.floor(Math.random() * 16).toString(16);
  }
  // Tag with a timestamp prefix so ids from the same browser are still
  // distinguishable from random data in logs.
  return `cpid-${Date.now().toString(36)}-${s}`;
}

/** Default join options that ALL rooms should send on join. */
export function defaultJoinOptions(): Record<string, unknown> {
  return { clientPlayerId: getOrCreateClientPlayerId() };
}
