/**
 * Enemy AI System
 * ================
 * Manages all enemy AI behavior each tick:
 *   - Updates Elder AI (melee chase)
 *   - Updates Ork AI (ranged shooter)
 *   - Spawns Ork bullets when they fire
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
import { ElderRuntimeState, updateElderAI } from "../ai/ElderAI";
import { OrkRuntimeState, updateOrkAI } from "../ai/OrkAI";
import { distanceSq } from "../utils/math";
import { clampToMap } from "../utils/movement";
import { GAME_CONFIG } from "../config/game";
import { ELDER_CONFIG } from "../config/enemies";

export class EnemyAISystem {
  private state: RoomState;

  /** Runtime state for Elders, keyed by enemy ID */
  private elderStates: Map<string, ElderRuntimeState> = new Map();

  /** Runtime state for Orks, keyed by enemy ID */
  private orkStates: Map<string, OrkRuntimeState> = new Map();

  /** Bullets that need to be spawned this tick */
  private pendingBullets: { bullet: Bullet; enemyId: string }[] = [];

  constructor(state: RoomState) {
    this.state = state;
  }

  /**
   * Update all enemy AI for this tick.
   *
   * @param dt - Delta time in seconds
   * @param currentTime - Current game time in milliseconds
   * @returns Array of bullets to spawn (from Ork shooting)
   */
  update(dt: number, currentTime: number): { bullet: Bullet; enemyId: string }[] {
    this.pendingBullets = [];

    // Collect IDs of enemies that died this tick
    const deadEnemyIds: string[] = [];

    this.state.enemies.forEach((enemy, enemyId) => {
      // Skip already-dead enemies
      if (enemy.isDead) {
        deadEnemyIds.push(enemyId);
        return;
      }

      // Update AI based on enemy type
      if (enemy.enemyType === "elder") {
        this.updateElder(enemy, enemyId, dt, currentTime);
      } else if (enemy.enemyType === "ork") {
        this.updateOrk(enemy, enemyId, dt, currentTime);
      }

      // Clamp enemy position to map bounds
      const clamped = clampToMap(enemy.x, enemy.y);
      enemy.x = clamped.x;
      enemy.y = clamped.y;
    });

    // Clean up dead enemies
    for (const enemyId of deadEnemyIds) {
      this.cleanupEnemy(enemyId);
    }

    return this.pendingBullets;
  }

  /**
   * Update a single Elder enemy.
   */
  private updateElder(enemy: Enemy, enemyId: string, dt: number, currentTime: number): void {
    // Get or create runtime state
    let state = this.elderStates.get(enemyId);
    if (!state) {
      state = new ElderRuntimeState();
      this.elderStates.set(enemyId, state);
    }

    // Run Elder AI
    const result = updateElderAI(
      enemy,
      state,
      (x, y) => this.findNearestAlivePlayer(x, y),
      dt,
      currentTime
    );

    // If the Elder attacked, apply damage
    if (result.attacked && result.target) {
      result.target.hp -= ELDER_CONFIG.attackDamage;
      if (result.target.hp <= 0) {
        result.target.hp = 0;
        result.target.isDead = true;
      }
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
    if (type === "elder") {
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