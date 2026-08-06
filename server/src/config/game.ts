/**
 * Game Configuration
 * ==================
 * Central place for all tunable game values.
 * These are server-authoritative — the client never reads this file.
 */
export const GAME_CONFIG = {
  /** Server simulation tick rate (60 ticks per second) */
  FIXED_TIME_STEP_MS: 1000 / 60,

  /** Max inputs processed per player per tick (prevents lag exploit) */
  MAX_INPUTS_PER_TICK: 5,

  /** Player settings */
  PLAYER: {
    SPEED: 120, // pixels per second
    COLLISION_RADIUS: 20,
  },

  /** Enemy settings */
  ENEMY: {
    /** Default level a freshly spawned enemy is created at. */
    DEFAULT_LEVEL: 1,
    /**
     * Per-tick chance (0..1) that an enemy attempts to use a skill.
     * Each tick the enemy rolls; on success it picks a random skill from
     * its pool and tries to cast (gated by cooldown). Tuned low so skills
     * don't fire every frame.
     */
    SKILL_ATTEMPT_CHANCE: 0.1,
  },
};
