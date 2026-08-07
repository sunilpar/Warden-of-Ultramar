/**
 * Player Stats Configuration
 * ==========================
 * Base (starting) values for player stats. These are the values a freshly
 * spawned player begins with. They grow as the player levels up.
 *
 * All values are server-authoritative — the client only reads them via the
 * synced Player schema in order to render the HUD / prediction.
 */
export const PLAYER_STATS = {
    /** Starting (level-1) base stats */
    BASE: {
        MAX_HEALTH: 1000,
        MOVE_SPEED: 120, // pixels per second
        ATTACK: 100,
        CRIT_RATE: 0.1, // 10% (stored as a fraction, 0..1)
        CRIT_DAMAGE: 1.5, // 150% of base damage (ie +50% on a crit)
    },
    /** Leveling */
    LEVELING: {
        LEVEL_1_XP: 500, // xp needed to go from level 1 -> 2
        /** XP needed for the NEXT level, given the current level.
         *  Override this to change the XP curve. */
        xpForNextLevel: (currentLevel) => {
            // Simple geometric curve: each level needs 25% more than the last.
            return Math.round(500 * Math.pow(1.25, currentLevel - 1));
        },
        /** Stat growth per level. Added to base when leveling up. */
        GROWTH: {
            MAX_HEALTH: 100,
            MOVE_SPEED: 0, // speed typically doesn't grow with level
            ATTACK: 10,
            CRIT_RATE: 0.005, // +0.5% per level
            CRIT_DAMAGE: 0.02, // +2% per level
        },
        /** Heal applied on level up (fraction of max health). */
        HEAL_ON_LEVEL_UP: 1.0, // full heal
    },
    /** Combat */
    COMBAT: {
        /**Invulnerability window after taking a hit, in ms (0 = none). */
        HIT_INVULN_MS: 0,
    },
};
