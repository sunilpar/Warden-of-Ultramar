/**
 * Display Name Pool
 * =================
 * The server picks each player's persistent display name from this
 * curated pool. The pool has 60 distinct names so a single room's
 * roster (typically <= 4 players, capped by gameplay scope) almost
 * never sees a duplicate; when one WOULD happen we suffix a small
 * numeric tag so everyone still has a unique label.
 *
 * Server is the single source of truth for display names. Clients
 * only read `player.displayName` and never edit it themselves.
 */

/**
 * The pool of Latin / Imperial-flavored handles players draw from
 * when they first connect. Order is irrelevant (random draw).
 */
export const NAME_POOL: readonly string[] = [
  "Aquila",
  "Cassian",
  "Marius",
  "Tiberius",
  "Valerian",
  "Severus",
  "Octavian",
  "Decimus",
  "Maximus",
  "Aurelius",
  "Remus",
  "Lucian",
  "Corvin",
  "Hadrian",
  "Varro",
  "Cato",
  "Drusus",
  "Galen",
  "Titus",
  "Vespian",
  "Marcellus",
  "Quintus",
  "Acastus",
  "Leontus",
  "Castor",
  "Pollux",
  "Nerva",
  "Scipio",
  "Agrippa",
  "Ferrus",
  "Aegis",
  "Dominus",
  "Invictus",
  "Praetor",
  "Centurius",
  "Victorus",
  "Leonis",
  "Valens",
  "Regulus",
  "Asterion",
  "Helion",
  "Orion",
  "Magnus",
  "Veritus",
  "Justicar",
  "Fortis",
  "Gladius",
  "Imperius",
  "Ultion",
  "Vigilus",
  "Aurelian",
  "Corvus",
  "Livius",
  "Faustus",
  "Romulus",
  "Gaius",
  "Vindex",
  "Pelagius",
  "Solanus",
  "Aximand",
];

/**
 * Pick a UNIQUE name that doesn't collide with `taken`. Falls back to
 * `<base> #<n>` if the entire pool is exhausted (would require >60
 * players — basically impossible at this game's scale, but we want a
 * safe, deterministic answer regardless).
 *
 * Sticky: the same `clientPlayerId` should always get the same name.
 * The GameRoom caches `nameByClientId` and reuses it on subsequent
 * joins (across rooms, on the same server instance) so the name sticks
 * for the lifetime of the server process. A fresh process starts with
 * an empty cache, so players get re-rolled there.
 */
export function pickUniqueName(
  taken: ReadonlySet<string>,
  clientPlayerId: string,
): string {
  // Try the pool first - up to a couple of full passes is enough since
  // rooms have at most a handful of players.
  const pool = NAME_POOL;
  const poolSize = pool.length;
  for (let attempt = 0; attempt < poolSize * 2; attempt++) {
    const candidate = pool[Math.floor(Math.random() * poolSize)];
    if (!taken.has(candidate)) return candidate;
  }
  // Extremely unlikely fallback: entire pool taken. Use a stable hash
  // of the client id so the same player always gets the same suffix.
  let h = 0;
  for (let i = 0; i < clientPlayerId.length; i++) {
    h = (h * 31 + clientPlayerId.charCodeAt(i)) | 0;
  }
  const tag = Math.abs(h) % 1000;
  return `${pool[h % poolSize]} #${tag}`;
}
