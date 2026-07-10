/**
 * Enemy AI System (Generic)
 * =========================
 * Manages enemy AI behavior each tick using the new skill system:
 *   - Runs the generic skill-based AI for every enemy
 *   - Asks SkillSystem to trigger skills when enemies are in range
 *   - Cleans up dead enemies and their runtime state
 *
 * REFACTOR: This no longer knows about Elder/Ork/Tyranid specifically.
 * It reads each enemy's `skills` array and uses the generic EnemyAI.
 * All damage/cooldown/range is handled by the skill itself.
 *
 * MEMORY MANAGEMENT: Each enemy has a runtime state object. When an
 * enemy dies or is removed, we clean it up to prevent memory leaks.
 */

import { RoomState } from "../schema/RoomState";
import { Player } from "../schema/Player";
import { Enemy } from "../schema/Enemy";
import { EnemyRuntimeState, updateEnemyAI } from "../ai/EnemyAI";
import { distanceSq } from "../utils/math";
import { clampToMap } from "../utils/movement";
import { getEnemyConfig } from "../config/enemies";
import { MapSystem } from "./MapSystem";
import { SkillSystem } from "./SkillSystem";
import { CasterInfo } from "../skills/ISkill";

export class EnemyAISystem {
  private state: RoomState;
  private mapSystem: MapSystem;
  private skillSystem: SkillSystem;

  /** Runtime state per enemy, keyed by enemy ID */
  private enemyStates: Map<string, EnemyRuntimeState> = new Map();

  constructor(
    state: RoomState,
    mapSystem: MapSystem,
    skillSystem: SkillSystem,
  ) {
    this.state = state;
    this.mapSystem = mapSystem;
    this.skillSystem = skillSystem;
  }

  /**
   * Update all enemy AI for this tick.
   *
   * @param dt - Delta time in seconds
   * @param currentTime - Current game time in milliseconds
   */
  update(dt: number, currentTime: number): void {
    const deadEnemyIds: string[] = [];

    this.state.enemies.forEach((enemy, enemyId) => {
      if (enemy.isDead) {
        deadEnemyIds.push(enemyId);
        return;
      }

      // Get or create runtime state
      //NOTE: know more about this state

      let state = this.enemyStates.get(enemyId);
      if (!state) {
        state = new EnemyRuntimeState();
        this.enemyStates.set(enemyId, state);
      }

      // Run generic AI -> may request a skill use
      const result = updateEnemyAI(
        enemy,
        state,
        (x, y) => this.findNearestAlivePlayer(x, y),
        dt,
        currentTime,
      );

      // Trigger the skill via SkillSystem (cooldown checked there)
      if (result.skillId) {
        const caster: CasterInfo = {
          ownerId: enemyId,
          isPlayer: false,
          x: enemy.x,
          y: enemy.y,
          targetDirX: result.targetDirX,
          targetDirY: result.targetDirY,
        };
        this.skillSystem.activate(result.skillId, caster, currentTime);
      }

      // Clamp enemy position to map bounds
      const clamped = clampToMap(
        enemy.x,
        enemy.y,
        this.mapSystem.mapWidth,
        this.mapSystem.mapHeight,
      );
      enemy.x = clamped.x;
      enemy.y = clamped.y;

      // Resolve blocking collisions for enemies
      const enemyCfg = getEnemyConfig(enemy.enemyType);
      const hitBlocker = this.mapSystem.checkAllBlockingCollision(
        enemy.x,
        enemy.y,
        enemyCfg.collisionRadius,
      );
      if (hitBlocker) {
        const resolved = this.mapSystem.resolveBlockingCollision(
          enemy.x,
          enemy.y,
          enemyCfg.collisionRadius,
          hitBlocker,
        );
        enemy.x = resolved.x;
        enemy.y = resolved.y;
      }
    });

    // Clean up dead enemies
    for (const enemyId of deadEnemyIds) {
      this.cleanupEnemy(enemyId);
    }
  }

  /**
   * Find the nearest alive player to a given position.
   * Uses squared distance for performance (no sqrt).
   */
  findNearestAlivePlayer(
    x: number,
    y: number,
  ): { player: Player; distSq: number } | null {
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

    return nearestPlayer
      ? { player: nearestPlayer, distSq: nearestDistSq }
      : null;
  }

  /**
   * Register a newly spawned enemy (creates runtime state).
   * Called by SpawnSystem.
   */
  registerEnemy(enemyId: string, _type: string): void {
    if (!this.enemyStates.has(enemyId)) {
      this.enemyStates.set(enemyId, new EnemyRuntimeState());
    }
  }

  /**
   * Clean up an enemy's runtime state when it's removed.
   * Prevents the enemyStates Map from growing forever (memory leak).
   */
  cleanupEnemy(enemyId: string): void {
    this.enemyStates.delete(enemyId);
    this.state.enemies.delete(enemyId);
  }
}

