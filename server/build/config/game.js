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
        COLLISION_RADIUS: 10,
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
    /** Elite enemy settings (one elite per map; killing it unlocks the exit). */
    ELITE: {
        /** Levels added on top of the highest player level. */
        LEVEL_BONUS: 4,
        /** Extra HP and shield on top of the level-scaled base (0.2 = +20%). */
        HP_SHIELD_BONUS: 0.2,
        /** XP multiplier vs what the underlying enemy type would give. */
        XP_MULTIPLIER: 2.0,
        /** Fraction of the map's target enemy count to kill before the elite spawns. */
        SPAWN_KILL_THRESHOLD: 0.5,
        /** Hitbox (and client sprite) size multiplier. */
        SIZE_MULTIPLIER: 1.6,
    },
};
