/**
 * Combat System
 * ==============
 * Handles all damage-related logic:
 *   - Bullet vs player collisions
 *   - Applying damage to players
 *   - Player death handling
 *   - Enemy death handling (when bullets can hit enemies in future)
 *
 * WHY A SEPARATE SYSTEM: Combat is a distinct concern from movement
 * or AI. Isolating it means:
 *   - Easy to add new damage sources (traps, AoE, etc.)
 *   - Easy to modify damage formulas without touching AI code
 *   - Clear audit trail of all damage events
 *
 * SERVER AUTHORITY: ALL damage is calculated here.
 * The client NEVER decides when a player takes damage.
 * The client only displays the HP bar based on synced state.
 *
 * MULTI-HIT FIX: We check if a bullet was already marked as "hit"
 * before processing its collision. This prevents one bullet from
 * damaging multiple players in the same tick.
 */

import { RoomState } from "../schema/RoomState";
import { BulletSystem } from "./BulletSystem";
import { GAME_CONFIG } from "../config/game";
import { circleCollision } from "../utils/collision";

export class CombatSystem {
  private state: RoomState;
  private bulletSystem: BulletSystem;

  constructor(state: RoomState, bulletSystem: BulletSystem) {
    this.state = state;
    this.bulletSystem = bulletSystem;
  }

  /**
   * Check all bullet-vs-player collisions for this tick.
   *
   * HOW IT WORKS:
   *   1. For each bullet, check against each alive player
   *   2. If collision detected AND bullet hasn't already hit:
   *      - Apply damage to the player
   *      - Mark bullet as hit (prevents multi-hit)
   *      - Check for player death
   *
   * @param currentTime - Current game time (not used yet, but useful for future combat logs)
   */
  update(currentTime: number): void {
    this.state.bullets.forEach((bullet, bulletId) => {
      // Skip bullets that already hit something this tick
      if (this.bulletSystem.isBulletHit(bulletId)) {
        return;
      }

      // Check collision with each player
      this.state.players.forEach((player) => {
        // Skip dead players
        if (player.isDead) return;

        // Skip if bullet already hit someone else this tick
        if (this.bulletSystem.isBulletHit(bulletId)) {
          return;
        }

        // Check collision using circle vs circle
        const hit = circleCollision(
          bullet.x, bullet.y, GAME_CONFIG.BULLET.COLLISION_RADIUS,
          player.x, player.y, GAME_CONFIG.PLAYER.COLLISION_RADIUS
        );

        if (hit) {
          // Apply damage
          player.hp -= bullet.damage;

          // Check for death
          if (player.hp <= 0) {
            player.hp = 0;
            player.isDead = true;
          }

          // Mark bullet as hit — it will be removed by BulletSystem
          // This is the MULTI-HIT FIX: one bullet = one damage event
          this.bulletSystem.markBulletAsHit(bulletId);
        }
      });
    });
  }
}