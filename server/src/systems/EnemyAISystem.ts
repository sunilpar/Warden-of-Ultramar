/**
 * Enemy AI System
 * ================
 * Manages all enemy AI behavior each tick:
 *   - Updates Elder/Tyranid AI (melee claw chase)
 *   - Updates Ork AI (ranged shooter)
 *   - Spawns Ork bullets when they fire
 *   - Spawns claw slashes when melee enemies attack
 *   - Cleans up dead enemies and their runtime state
 *
 * WHY A SEPARATE SYSTEM: AI logic is complex and enemy-specific.
 * Isolating it means you can add new enemy types without touching
 * the room or other systems. Just add a new AI file and hook it in here.
 *
 * MEMORY MANAGEMENT: Each enemy has a runtime state object (cooldowns,
 * phase, etc.). When an enemy dies or is removed, we MUST clean up
 * its runtime state to prevent memory leaks.
 */

import { RoomState } from "../schema/RoomState";
import { Player } from "../schema/Player";
import { Enemy } from "../schema/Enemy";
import { Bullet } from "../schema/Bullet";
import { ClawSlash } from "../schema/ClawSlash";
import { ElderRuntimeState, updateElderAI } from "../ai/ElderAI";
import { OrkRuntimeState, updateOrkAI } from "../ai/OrkAI";
import { distanceSq } from "../utils/math";
import { clampToMap } from "../utils/movement";
import { GAME_CONFIG } from "../config/game";
import { ELDER_CONFIG, ORK_CONFIG, TYRANID_CONFIG } from "../config/enemies";
import { MapSystem } from "./MapSystem";

export class EnemyAISystem {
  private state: RoomState;
  private mapSystem: MapSystem;

  /** Runtime state for Elders/Tyranids, keyed by enemy ID */
  private elderStates: Map<string, ElderRuntimeState> = new Map();

  /** Runtime state for Orks, keyed by enemy ID */
  private orkStates: Map<string, OrkRuntimeState> = new Map();

  /** Bullets that need to be spawned this tick */
  private pendingBullets: { bullet: Bullet; enemyId: string }[] = [];

  /** Claw slashes that need to be spawned this tick */
  private pendingClawSlashes: { claw: ClawSlash; enemyId: string }[] = [];

  constructor(state: RoomState, mapSystem: MapSystem) {
    this.state = state;
    this.mapSystem = mapSystem;
  }

  /**
   * Update all enemy AI for this tick.
   *
   * @param dt - Delta time in seconds
   * @param currentTime - Current game time in milliseconds
   * @returns Object with bullets and claw slashes to spawn
   */
  update(dt: number, currentTime: number): {
    bullets: { bullet: Bullet; enemyId: string }[];
    clawSlashes: { claw: ClawSlash; enemyId: string }[];
  } {
    this.pendingBullets = [];
    this.pendingClawSlashes = [];

    // Collect IDs of enemies that died this tick
    const deadEnemyIds: string[] = [];

    this.state.enemies.forEach((enemy, enemyId) => {
      // Skip already-dead enemies
      if (enemy.isDead) {
        deadEnemyIds.push(enemyId);
        return;
      }

      // Update AI based on enemy type
      if (enemy.enemyType === "elder" || enemy.enemyType === "tyranid") {
        this.updateElder(enemy, enemyId, dt, currentTime);
      } else if (enemy.enemyType === "ork") {
        this.updateOrk(enemy, enemyId, dt, currentTime);
      }

      // Clamp enemy position to actual map bounds
      const clamped = clampToMap(
        enemy.x, enemy.y,
        this.mapSystem.mapWidth, this.mapSystem.mapHeight
      );
      enemy.x = clamped.x;
      enemy.y = clamped.y;

      // Resolve blocking collisions for enemies (obstacles + enemy spawn zones)
      const enemyRadius = enemy.enemyType === "ork"
        ? ORK_CONFIG.collisionRadius
        : enemy.enemyType === "tyranid"
          ? TYRANID_CONFIG.collisionRadius
          : ELDER_CONFIG.collisionRadius;
      const hitBlocker = this.mapSystem.checkAllBlockingCollision(
        enemy.x, enemy.y, enemyRadius
      );
      if (hitBlocker) {
        const resolved = this.mapSystem.resolveBlockingCollision(
          enemy.x, enemy.y, enemyRadius, hitBlocker
        );
        enemy.x = resolved.x;
        enemy.y = resolved.y;
      }
    });

    // Clean up dead enemies
    for (const enemyId of deadEnemyIds) {
      this.cleanupEnemy(enemyId);
    }

    return {
      bullets: this.pendingBullets,
      clawSlashes: this.pendingClawSlashes,
    };
  }

  /**
   * Update a single Elder/Tyranid enemy.
   */
  private updateElder(enemy: Enemy, enemyId: string, dt: number, currentTime: number): void {
    // Get or create runtime state
    let state = this.elderStates.get(enemyId);
    if (!state) {
      state = new ElderRuntimeState();
      this.elderStates.set(enemyId, state);
    }

    // Run Elder AI (shared by Elder and Tyranid)
    const result = updateElderAI(
      enemy,
      state,
      (x, y) => this.findNearestAlivePlayer(x, y),
      dt,
      currentTime
    );

    // If the Elder/Tyranid attacked, create a ClawSlash
    if (result.attacked && result.target) {
      const damage = enemy.enemyType === "tyranid"
        ? TYRANID_CONFIG.attackDamage
        : ELDER_CONFIG.attackDamage;

      const claw = new ClawSlash();
      claw.x = enemy.x;
      claw.y = enemy.y;
      claw.directionX = result.directionX;
      claw.directionY = result.directionY;
      claw.damage = damage;
      claw.isPlayerClaw = false;
      claw.ownerId = enemyId;

      this.pendingClawSlashes.push({ claw, enemyId });
    }
  }

  /**
   * Update a single Ork enemy.
   */
  private updateOrk(enemy: Enemy, enemyId: string, dt: number, currentTime: number): void {
    // Get or create runtime state
    let state = this.orkStates.get(enemyId);
    if (!state) {
      state = new OrkRuntimeState();
      this.orkStates.set(enemyId, state);
    }

    // Run Ork AI
    const result = updateOrkAI(
      enemy,
      state,
      (x, y) => this.findNearestAlivePlayer(x, y),
      dt,
      currentTime
    );

    // If the Ork fired, queue the bullet for spawning
    if (result.firedBullet && result.bullet) {
      result.bullet.ownerId = enemyId;
      this.pendingBullets.push({ bullet: result.bullet, enemyId });
    }
  }

  /**
   * Find the nearest alive player to a given position.
   * Uses squared distance for performance (no sqrt).
   *
   * @returns The nearest player and squared distance, or null
   */
  findNearestAlivePlayer(x: number, y: number): { player: Player; distSq: number } | null {
    let nearestPlayer: Player | null = null;
    let nearestDistSq = Infinity;

    this.state.players.forEach((player) => {
      if (player.isDead) return;

      const dSq = distanceSq(x, y, player.x, player.y);
      if (dSq < nearestDistSq) {
        nearestDistSq = dSq;
        nearestPlayer = player;
      }
    });

    return nearestPlayer ? { player: nearestPlayer, distSq: nearestDistSq } : null;
  }

  /**
   * Register a newly spawned enemy (creates runtime state).
   * Called by SpawnSystem when a new enemy is created.
   */
  registerEnemy(enemyId: string, type: string): void {
    if (type === "elder" || type === "tyranid") {
      this.elderStates.set(enemyId, new ElderRuntimeState());
    } else if (type === "ork") {
      this.orkStates.set(enemyId, new OrkRuntimeState());
    }
  }

  /**
   * Clean up an enemy's runtime state when it's removed.
   *
   * WHY: If we don't clean up, the Maps grow forever = memory leak.
   * This is especially important for games that run for hours.
   */
  cleanupEnemy(enemyId: string): void {
    this.elderStates.delete(enemyId);
    this.orkStates.delete(enemyId);
    this.state.enemies.delete(enemyId);
  }
}