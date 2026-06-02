/**
 * Game Configuration
 * ==================
 * Central configuration for all game-wide settings.
 *
 * WHY: Keeping all magic numbers in one place makes it easy to
 * tune gameplay without hunting through code. Change a value here,
 * and it affects the entire game immediately.
 *
 * SERVER AUTHORITY: These values are only used on the server.
 * The client never reads this file — it only renders what the
 * server tells it. This prevents cheating.
 */

export const GAME_CONFIG = {
  /** World dimensions */
  MAP_WIDTH: 800,
  MAP_HEIGHT: 600,

  /** Server simulation tick rate (60 ticks per second) */
  FIXED_TIME_STEP_MS: 1000 / 60,

  /** Fixed timestep in seconds (used for delta-time movement) */
  FIXED_DELTA_TIME: 1000 / 60 / 1000,

  /** Maximum inputs processed per player per tick.
   * WHY: A lagging player could queue hundreds of inputs and
   * teleport across the map. This prevents that exploit. */
  MAX_INPUTS_PER_TICK: 5,

  /** Player settings */
  PLAYER: {
    HP: 1000,
    SPEED: 120, // pixels per second
    COLLISION_RADIUS: 20,
    RESPAWN_HP: 1000,
    /** Player hitbox dimensions (independent of sprite size).
     * This is the actual collision rectangle, centered on the player position.
     * Used for: debug visualization, bullet collision, and client prediction. */
    HITBOX_WIDTH: 40,
    HITBOX_HEIGHT: 40,
  },

  /** Bullet collision settings */
  BULLET: {
    COLLISION_RADIUS: 12,
    OUT_OF_BOUNDS_MARGIN: 50, // how far off-screen before removal
  },
};
