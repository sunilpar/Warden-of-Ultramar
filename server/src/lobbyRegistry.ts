/**
 * Lobby Code Registry
 * ===================
 * In-memory index that maps a 6-char alphanumeric lobby code to the
 * Colyseus room that hosts it. The HTTP routes in app.config.ts use
 * this to resolve `POST /api/lobby/join?code=XYZ` -> roomId without
 * paying the cost of a matchMaker query against every active room.
 *
 * Why not matchMaker.query({ name: "game_room", lobbyCode })?
 *   matchMaker filters by name/private roomId only - it can't query
 *   by our custom metadata. We could store the code in the room name
 *   suffix and parse it, but that makes the "private vs code" branch
 *   ugly and would leak the code in the matchMaker URL. Keeping our
 *   own Map is the cleanest:
 *     - Create-lobby registers the code as soon as the room does.
 *     - Join-lobby is O(1) and can immediately check leader-presence.
 *     - On dispose we unregister; no leaks.
 *
 * Thread / event-loop safety: Colyseus is single-threaded (Node
 * event loop) so a plain Map is safe; no locks needed.
 */

export interface LobbyRegistryEntry {
  /** 6-character lobby code (the user-facing key). */
  code: string;
  /** Colyseus roomId for the lobby host room. */
  roomId: string;
  /**
   * sessionId of the FIRST player to join the room. They are the
   * "leader" - only they can start runs, and only they need to be
   * present in the lobby for new joiners to be allowed in.
   */
  leaderId: string;
  /**
   * True while the leader's Player.currentMapId === "lobby". The
   * join endpoint reads this to reject new joiners when the leader
   * is mid-run (so the group can't get a late drop-in).
   */
  leaderInLobby: boolean;
  /** Server timestamp (ms) the entry was created - for debugging. */
  createdAt: number;
}

const entries = new Map<string, LobbyRegistryEntry>();
/**
 * Inverse index so GameRoom.onDispose can unregister by roomId without
 * having to scan every code (codes are random; scan would be fine but
 * the lookup is O(1) anyway).
 */
const byRoom = new Map<string, string>();

/**
 * Generate a 6-character lobby code from the alphabet 0-9 A-Z (uppercase
 * only - lowercase letters are intentionally excluded so codes are easy
 * to read and shout across the room). 36 chars; 36^6 = ~2.2B combinations
 * -> collision probability for 1k concurrent lobbies is ~5e-7, so retrying
 * on collision is fine.
 *
 * Pure random, server-authoritative. The seed text in the brief
 * (1-9, A-Z) IS the alphabet; the code is just sampled from it.
 */
export function generateLobbyCode(): string {
  const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let out = "";
  // crypto.getRandomValues is available in modern Node (we are 18+).
  // Fall back to Math.random if not (older runtimes/tests).
  const buf = new Uint32Array(6);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(buf);
    for (let i = 0; i < 6; i++) {
      out += ALPHABET[buf[i] % ALPHABET.length];
    }
  } else {
    for (let i = 0; i < 6; i++) {
      out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    }
  }
  return out;
}

/**
 * Try to register a new code->room mapping. Returns true on success,
 * false if the code is already taken (very rare; caller should retry
 * with a fresh code).
 *
 * Called by:
 *   - The Create-Lobby HTTP route, RIGHT AFTER matchMaker.createRoom
 *     resolves - so the code is in the registry BEFORE the JSON
 *     response goes back to the client. This closes the race where
 *     a second player could paste the auto-copied code and hit JOIN
 *     before the creator's `joinById` handshake (which would have
 *     been the only trigger that previously inserted the entry).
 *     `leaderId` is empty at this point; `setLobbyLeader` fills it
 *     in when the creator's `onJoin` fires.
 *   - Not called by solo/private rooms - they never appear in here.
 */
export function registerLobby(
  code: string,
  roomId: string,
  leaderId: string,
): boolean {
  if (entries.has(code)) return false;
  entries.set(code, {
    code,
    roomId,
    leaderId,
    leaderInLobby: true,
    createdAt: Date.now(),
  });
  byRoom.set(roomId, code);
  return true;
}

/**
 * Stamp the leader's sessionId onto an already-registered lobby.
 * Called from GameRoom.onJoin when the first player connects - we
 * know the room is already in the registry (registered at create
 * time), we just need to record who the leader is so onLeave can
 * detect a leader-disconnect and tear the room down.
 *
 * Idempotent: only writes when the entry exists AND the leader has
 * not already been recorded (a reconnecting leader doesn't reset
 * their own id).
 */
export function setLobbyLeader(roomId: string, leaderId: string): void {
  const code = byRoom.get(roomId);
  if (!code) return;
  const entry = entries.get(code);
  if (!entry) return;
  if (entry.leaderId !== "") return;
  entry.leaderId = leaderId;
}

/**
 * Remove the registration for a room. Idempotent - safe to call from
 * onDispose (the room might never have been registered if it was a
 * private/solo room).
 */
export function unregisterLobby(roomId: string): void {
  const code = byRoom.get(roomId);
  if (!code) return;
  entries.delete(code);
  byRoom.delete(roomId);
}

/**
 * Look up the entry for a code. Returns null if no such lobby exists.
 * The HTTP join route uses this to resolve code -> roomId and to
 * check leader presence.
 */
export function lookupLobby(code: string): LobbyRegistryEntry | null {
  return entries.get(code) ?? null;
}

/**
 * Mark whether the lobby's leader is currently in the walkable lobby
 * (vs. mid-map on map1/map2). Called by GameRoom whenever the
 * leader's Player.currentMapId flips.
 *
 * The join route rejects new joiners when leaderInLobby is false
 * (leader is on a map mid-run -> group can't accept a new drop-in).
 */
export function setLeaderInLobby(roomId: string, inLobby: boolean): void {
  const code = byRoom.get(roomId);
  if (!code) return;
  const entry = entries.get(code);
  if (!entry) return;
  entry.leaderInLobby = inLobby;
}

/** Debug helper - returns a snapshot of all registered lobbies. */
export function debugDump(): Array<{
  code: string;
  entry: LobbyRegistryEntry;
}> {
  return Array.from(entries.entries()).map(([code, entry]) => ({
    code,
    entry,
  }));
}
