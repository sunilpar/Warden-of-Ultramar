/**
 * Bullet System
 * ==============
 * Manages all bullet logic each tick:
 *   - Spawning new bullets (from Ork shooting)
 *   - Moving bullets using velocity + delta time
 *   - Removing out-of-bounds bullets
 *   - Removing expired bullets (lifetime)
 *
 * NOTE: Collision detection between bullets and players is handled
 * by the CombatSystem, not here. This system only handles
 * bullet movement and lifecycle.
 *
 * WHY SEPARATE FROM COMBAT: Bullets have lifecycle logic (movement,
 * lifetime, bounds) that's separate from damage. Keeping them
 * separate means you could add non-damaging projectiles (scout
 * drones, flares) without touching combat code.
 *
 * MULTI-HIT FIX: Each bullet tracks whether it has already hit
 * something. The CombatSystem marks bullets as "hit" on collision,
 * and this system removes them. This prevents one bullet from
 * damaging multiple targets in a single tick.
 */

import { RoomState } from "../schema/RoomState";
import { Bullet } from "../schema/Bullet";
import { GAME_CONFIG } from "../config/game";
import { ORK_RIFLE_WEAPON, PLAYER_BOLTER_WEAPON } from "../config/weapons";

/** Server-only tracking for bullet lifetime */
interface BulletRuntimeState {
  /** When this bullet was created (milliseconds) */
  spawnTime: number;
  /** Speed of this bullet (pixels per second) */
  speed: number;
  /** Lifetime of this bullet in milliseconds */
  lifetime: number;
  /** Whether this bullet has already hit something */
  hasHit: boolean;
}

export class BulletSystem {
  private state: RoomState;

  /** Runtime state per bullet, keyed by bullet ID */
  private bulletStates: Map<string, BulletRuntimeState> = new Map();

  /** Counter for generating unique bullet IDs */
  private bulletIdCounter = 0;

  constructor(state: RoomState) {
    this.state = state;
  }

  /**
   * Update all bullets for this tick.
   *
   * @param dt - Delta time in seconds
   * @param currentTime - Current game time in milliseconds
   */
  update(dt: number, currentTime: number): void {
    const bulletsToRemove: string[] = [];

    this.state.bullets.forEach((bullet, bulletId) => {
      const bulletState = this.bulletStates.get(bulletId);

      // Skip bullets that already hit something (they'll be removed)
      if (bulletState && bulletState.hasHit) {
        bulletsToRemove.push(bulletId);
        return;
      }

      // Move bullet in its direction using speed and delta time
      const speed = bulletState ? bulletState.speed : ORK_RIFLE_WEAPON.bulletSpeed;
      bullet.x += bullet.directionX * speed * dt;
      bullet.y += bullet.directionY * speed * dt;

      // Check if bullet is out of bounds
      const margin = GAME_CONFIG.BULLET.OUT_OF_BOUNDS_MARGIN;
      if (
        bullet.x < -margin ||
        bullet.x > this.state.mapWidth + margin ||
        bullet.y < -margin ||
        bullet.y > this.state.mapHeight + margin
      ) {
        bulletsToRemove.push(bulletId);
        return;
      }

      // Check if bullet has exceeded its lifetime
      if (bulletState) {
        const age = currentTime - bulletState.spawnTime;
        if (age >= bulletState.lifetime) {
          bulletsToRemove.push(bulletId);
          return;
        }
      }
    });

    // Remove expired/hit bullets
    for (const bulletId of bulletsToRemove) {
      this.removeBullet(bulletId);
    }
  }

  /**
   * Spawn a new bullet into the game world.
   *
   * @param bullet - Pre-configured bullet object (position, direction, damage)
   * @param currentTime - Current game time in milliseconds
   * @param speed - Bullet speed in pixels per second (defaults to rifle speed)
   * @param lifetime - Bullet lifetime in milliseconds (defaults to rifle lifetime)
   * @returns The bullet ID
   */
  spawnBullet(bullet: Bullet, currentTime: number, speed?: number, lifetime?: number): string {
    const bulletId = `bullet_${this.bulletIdCounter++}`;
    this.state.bullets.set(bulletId, bullet);

    // Create runtime state for lifetime tracking
    this.bulletStates.set(bulletId, {
      spawnTime: currentTime,
      speed: speed ?? ORK_RIFLE_WEAPON.bulletSpeed,
      lifetime: lifetime ?? ORK_RIFLE_WEAPON.lifetime,
      hasHit: false,
    });

    return bulletId;
  }

  /**
   * Mark a bullet as "hit" so it gets removed next update.
   *
   * WHY: This fixes the multi-hit bug. In the old code, a bullet
   * could collide with multiple players in the same tick before
   * being removed. Now, the combat system marks it as hit, and
   * no further collisions are checked.
   */
  markBulletAsHit(bulletId: string): void {
    const state = this.bulletStates.get(bulletId);
    if (state) {
      state.hasHit = true;
    }
  }

  /**
   * Check if a bullet has already hit something.
   * Used by CombatSystem to skip already-hit bullets.
   */
  isBulletHit(bulletId: string): boolean {
    const state = this.bulletStates.get(bulletId);
    return state ? state.hasHit : false;
  }

  /**
   * Remove a bullet and clean up its runtime state.
   */
  private removeBullet(bulletId: string): void {
    this.state.bullets.delete(bulletId);
    this.bulletStates.delete(bulletId);
  }
}