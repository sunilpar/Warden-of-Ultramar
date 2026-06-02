/**
 * Weapon Configuration
 * ====================
 * All weapon/bullet tuning values live here.
 *
 * WHY: Weapons are separate from enemies so they can be reused.
 * A future player rifle could use the same RIFLE_WEAPON config.
 *
 * SCALIBILITY: To add a new weapon, just add a new config object.
 * Then reference it from whatever entity fires it.
 */

/**
 * Player Bolter Configuration
 * ============================
 * The player's ranged weapon. High damage, moderate cooldown.
 */
export const PLAYER_BOLTER_WEAPON = {
  /** Bullet travel speed in pixels per second */
  bulletSpeed: 1000,

  /** Milliseconds between shots (0.5 second cooldown) */
  cooldown: 500,

  /** Damage per bullet hit */
  damage: 80,

  /** How long a bullet lives before auto-removal (milliseconds) */
  lifetime: 3000,
};

/**
 * Player Pulse Weapon Configuration
 * ==================================
 * Close-combat AoE shockwave expanding from the player.
 */
export const PLAYER_PULSE_WEAPON = {
  /** Pulse effect radius in pixels */
  radius: 100,

  /** Milliseconds between pulses (3 second cooldown) */
  cooldown: 3000,

  /** Damage dealt to all enemies within radius */
  damage: 150,
};

/**
 * Claw Weapon Configuration
 * ==========================
 * Melee cone attack used by Elders and Tyranids.
 * Short range, instant damage in a cone arc.
 */
export const CLAW_WEAPON = {
  /** Range of the cone attack in pixels */
  range: 50,

  /** Half-angle of the cone arc in radians (45° = π/4 → full cone is 90°) */
  halfAngle: Math.PI / 4,

  /** Milliseconds between claw attacks (increased for animation visibility) */
  cooldown: 3000,

  /** Damage per claw hit */
  damage: 15,
};

export const ORK_RIFLE_WEAPON = {
  /** Bullet travel speed in pixels per second */
  bulletSpeed: 500,

  /** Milliseconds between shots (server-authoritative cooldown) */
  cooldown: 2500,

  /** Damage per bullet hit */
  damage: 20,

  /** How long a bullet lives before auto-removal (milliseconds) */
  lifetime: 2000,

  /** Collision radius of the bullet */
  collisionRadius: 8,
};
