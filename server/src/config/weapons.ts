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