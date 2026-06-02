/**
 * Combat System
 * ==============
 * Handles all damage-related logic:
 *   - Player bullet vs enemy collisions
 *   - Enemy bullet vs player collisions
 *   - Applying damage to players and enemies
 *   - Player death handling
 *   - Enemy death handling (marks isDead for cleanup by EnemyAISystem)
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
import { MapSystem } from "./MapSystem";
import { GAME_CONFIG } from "../config/game";
import { ELDER_CONFIG, ORK_CONFIG, TYRANID_CONFIG } from "../config/enemies";
import { CLAW_WEAPON } from "../config/weapons";
import { circleCollision, coneCollision } from "../utils/collision";

export class CombatSystem {
  private state: RoomState;
  private bulletSystem: BulletSystem;
  private mapSystem: MapSystem;

  constructor(
    state: RoomState,
    bulletSystem: BulletSystem,
    mapSystem: MapSystem,
  ) {
    this.state = state;
    this.bulletSystem = bulletSystem;
    this.mapSystem = mapSystem;
  }

  /**
   * Check all bullet collisions for this tick.
   *
   * HOW IT WORKS:
   *   - Player bullets (isPlayerBullet=true): check against enemies
   *   - Enemy bullets (isPlayerBullet=false): check against players
   *   - Each bullet can only hit one target (multi-hit fix)
   *
   * @param currentTime - Current game time (not used yet, but useful for future combat logs)
   */
  update(currentTime: number): void {
    this.state.bullets.forEach((bullet, bulletId) => {
      // Skip bullets that already hit something this tick
      if (this.bulletSystem.isBulletHit(bulletId)) {
        return;
      }

      // ---- BULLET vs OBSTACLES ----
      // Check if bullet hit a wall/obstacle before checking entity collisions
      if (
        this.mapSystem.checkBulletObstacleCollision(
          bullet.x,
          bullet.y,
          GAME_CONFIG.BULLET.COLLISION_RADIUS,
        )
      ) {
        this.bulletSystem.markBulletAsHit(bulletId);
        return;
      }

      if (bullet.isPlayerBullet) {
        // ---- PLAYER BULLET vs ENEMIES ----
        this.checkPlayerBulletVsEnemies(bullet, bulletId);
      } else {
        // ---- ENEMY BULLET vs PLAYERS ----
        this.checkEnemyBulletVsPlayers(bullet, bulletId);
      }
    });

    // ---- CLAW SLASH vs PLAYERS ----
    this.state.clawSlashes.forEach((claw, clawId) => {
      if (claw.processed) return;

      if (!claw.isPlayerClaw) {
        // Enemy claw → check against players
        this.checkEnemyClawVsPlayers(claw);
      }
    });
  }

  /**
   * Check a player bullet against all alive enemies.
   * Applies damage and marks enemy as dead if HP <= 0.
   */
  private checkPlayerBulletVsEnemies(bullet: any, bulletId: string): void {
    this.state.enemies.forEach((enemy) => {
      // Skip dead enemies
      if (enemy.isDead) return;

      // Skip if bullet already hit something
      if (this.bulletSystem.isBulletHit(bulletId)) return;

      // Get collision radius based on enemy type
      const enemyRadius =
        enemy.enemyType === "ork"
          ? ORK_CONFIG.collisionRadius
          : enemy.enemyType === "tyranid"
            ? TYRANID_CONFIG.collisionRadius
            : ELDER_CONFIG.collisionRadius;

      // Check collision
      const hit = circleCollision(
        bullet.x,
        bullet.y,
        GAME_CONFIG.BULLET.COLLISION_RADIUS,
        enemy.x,
        enemy.y,
        enemyRadius,
      );

      if (hit) {
        // Apply damage
        enemy.hp -= bullet.damage;

        // Check for death
        if (enemy.hp <= 0) {
          enemy.hp = 0;
          enemy.isDead = true;

          // Track kill for the bullet's owner (for heal card cooldown)
          const owner = this.state.players.get(bullet.ownerId);
          if (owner) {
            owner.killsSinceLastHeal++;
          }
        }

        // Mark bullet as hit — one bullet = one damage event
        this.bulletSystem.markBulletAsHit(bulletId);
      }
    });
  }

  /**
   * Check an enemy bullet against all alive players.
   * Applies damage and marks player as dead if HP <= 0.
   */
  private checkEnemyBulletVsPlayers(bullet: any, bulletId: string): void {
    this.state.players.forEach((player) => {
      // Skip dead players
      if (player.isDead) return;

      // Skip if bullet already hit someone else this tick
      if (this.bulletSystem.isBulletHit(bulletId)) return;

      // Check collision using circle vs circle
      const hit = circleCollision(
        bullet.x,
        bullet.y,
        GAME_CONFIG.BULLET.COLLISION_RADIUS,
        player.x,
        player.y,
        GAME_CONFIG.PLAYER.COLLISION_RADIUS,
      );

      if (hit) {
        // Apply damage
        player.hp -= bullet.damage;

        // Check for death
        if (player.hp <= 0) {
          player.hp = 0;
          player.isDead = true;
        }

        // Mark bullet as hit — one bullet = one damage event
        this.bulletSystem.markBulletAsHit(bulletId);
      }
    });
  }

  /**
   * Check an enemy claw slash against all alive players.
   * Uses cone collision for the melee arc attack.
   */
  private checkEnemyClawVsPlayers(claw: any): void {
    this.state.players.forEach((player) => {
      // Skip dead players
      if (player.isDead) return;

      // Check if player is within the claw's cone
      const hit = coneCollision(
        claw.x, claw.y,
        claw.directionX, claw.directionY,
        CLAW_WEAPON.range, CLAW_WEAPON.halfAngle,
        player.x, player.y,
        GAME_CONFIG.PLAYER.COLLISION_RADIUS,
      );

      if (hit) {
        // Apply damage
        player.hp -= claw.damage;

        // Check for death
        if (player.hp <= 0) {
          player.hp = 0;
          player.isDead = true;
        }
      }
    });

    // Mark claw as processed (whether it hit or missed)
    claw.processed = true;
  }
}
