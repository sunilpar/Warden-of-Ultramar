/**
 * Enemy Configuration
 * ===================
 * All enemy tuning values live here.
 *
 * WHY: When you want to make the Elder faster or the Ork shoot
 * slower, you only change this file. No digging through AI code.
 *
 * SCALABILITY: To add a new enemy type, just add a new config
 * object here and create a matching AI file in ai/.
 */

export const ELDER_CONFIG = {
  /** Display name */
  name: "Elder",

  /** Health points */
  hp: 100,

  /** Movement speed in pixels per second */
  speed: 80,

  /** Melee attack damage per hit */
  attackDamage: 15,

  /** Milliseconds between melee attacks (cooldown) */
  attackCooldown: 1000,

  /** Collision radius for melee contact */
  collisionRadius: 20,

  /** Spawning settings */
  spawn: {
    maxAlive: 5,          // max elders at once
    intervalMs: 5000,     // spawn attempt every 5 seconds
  },
};

export const TYRANID_CONFIG = {
  /** Display name */
  name: "Tyranid",

  /** Health points (same as Elder) */
  hp: 100,

  /** Movement speed in pixels per second */
  speed: 80,

  /** Melee attack damage per hit (same as Elder) */
  attackDamage: 15,

  /** Milliseconds between melee attacks (same as Elder) */
  attackCooldown: 1000,

  /** Collision radius for melee contact */
  collisionRadius: 20,

  /** Spawning settings */
  spawn: {
    maxAlive: 5,
    intervalMs: 5000,
  },
};

export const ORK_CONFIG = {
  /** Display name */
  name: "Ork",

  /** Health points */
  hp: 80,

  /** Movement speed in pixels per second */
  speed: 60,

  /** Rifle bullet damage per hit */
  attackDamage: 20,

  /** Milliseconds between rifle shots (long cooldown = tactical feel) */
  attackCooldown: 2500,

  /** Distance at which the Ork stops moving and starts shooting */
  shootingRange: 350,

  /** Collision radius */
  collisionRadius: 18,

  /** Strafe/reposition speed in pixels per second */
  strafeSpeed: 50,

  /** How long to strafe after shooting (milliseconds) */
  strafeDuration: 800,

  /** Spawning settings */
  spawn: {
    maxAlive: 3,          // max orks at once
    intervalMs: 6000,     // spawn attempt every 6 seconds
  },
};