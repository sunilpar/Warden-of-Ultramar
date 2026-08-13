/**
 * Player Stats Configuration
 * =========================
 * Base (starting) values for player stats. These are the values a freshly
 * spawned player begins with. They grow as the player levels up.
 *
 * All values are server-authoritative â€” the client only reads them via the
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
    DEFENCE: 0.0, // 0% damage reduction by default
  },

  /**
   * SHIELD STAT (amount) â€” grows automatically with player level.
   * This is the raw shield capacity. Each player level adds AMOUNT_PER_LEVEL.
   * BASE_AMOUNT is the starting shield at level 1.
   */
  SHIELD_STAT: {
    BASE_AMOUNT: 100, // shield capacity at level 1
    AMOUNT_PER_LEVEL: 20, // +20 max shield per player level
  },

  /**
   * SHIELD CARD / SLOT (recovery) â€” an equippable item. Equipped by default.
   * The card defines the BASE recovery delay (time after the shield breaks
   * before it starts recharging). Upgrading the shield slot level reduces
   * the recovery delay (faster recharge). Different shield cards (future
   * drops) can have different base recovery delays.
   */
  SHIELD_CARD: {
    BASE_RECOVERY_DELAY: 30, // seconds before a broken shield starts recharging (card lvl 1)
    RECOVERY_DELAY_REDUCTION_PER_LEVEL: 2, // -2s recovery delay per card slot level
    MIN_RECOVERY_DELAY: 6, // floor for recovery delay
    RECHARGE_RATE: 0.2, // fraction of maxShield regenerated per second while recharging
  },

  /** Leveling */
  LEVELING: {
    LEVEL_1_XP: 1000, // xp needed to go from level 1 -> 2
    /** XP needed for the NEXT level, given the current level.
     *  Override this to change the XP curve. */
    xpForNextLevel: (currentLevel: number): number => {
      // Polynomial curve: scales slower than geometric, stays viable at high levels.
      return Math.round(1000 * Math.pow(currentLevel, 1.5));
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
} as const;