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
import { LootItem } from "../schema/LootItem";
import { getLootEntry } from "../config/loot";

export class EnemyAISystem {
  private state: RoomState;
  private mapSystem: MapSystem;
  private skillSystem: SkillSystem;

  /** Runtime state per enemy, keyed by enemy ID */
  private enemyStates: Map<string, EnemyRuntimeState> = new Map();
  /** Counter for unique loot IDs */
  private lootCounter: number = 0;

  /** Per-enemy AI-level skill cooldowns: `${enemyId}:${skillId}` -> readyAt (ms) */
  private aiCooldowns: Map<string, number> = new Map();

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

      // Trigger the skill via SkillSystem (with AI-level cooldown for enemies)
      if (result.skillId) {
        // AI cooldown: orks shoot slower (1500ms between shots)
        const aiCdKey = `${enemyId}:${result.skillId}`;
        const aiReadyAt = this.aiCooldowns.get(aiCdKey) ?? 0;
        if (currentTime < aiReadyAt) {
          // Still on AI cooldown, skip this shot
        } else {
        const caster: CasterInfo = {
          ownerId: enemyId,
          isPlayer: false,
          x: enemy.x,
          y: enemy.y,
          targetDirX: result.targetDirX,
          targetDirY: result.targetDirY,
        };
          this.skillSystem.activate(result.skillId, caster, currentTime);
          // Set AI cooldown based on skill type
          let aiCd = 0;
          if (result.skillId === "boltershot") aiCd = 1500;
          else if (result.skillId === "claw") aiCd = 2000;
          else if (result.skillId === "vortex") aiCd = 8000;
          this.aiCooldowns.set(aiCdKey, currentTime + aiCd);
        }
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

    // Clean up dead enemies (drop loot first, then remove)
    for (const enemyId of deadEnemyIds) {
      const enemy = this.state.enemies.get(enemyId);
      if (enemy) {
        this.dropLoot(enemy);
      }
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
   * Roll the enemy's loot pool and drop items at its death position.
   * Each loot entry is rolled independently against its dropChance.
   */
  dropLoot(enemy: Enemy): void {
    const cfg = getEnemyConfig(enemy.enemyType);
    if (!cfg.lootPool || cfg.lootPool.length === 0) return;

    for (const lootId of cfg.lootPool) {
      const entry = getLootEntry(lootId);
      if (!entry) continue;

      // Roll the drop chance
      if (Math.random() < entry.dropChance) {
        const loot = new LootItem();
        loot.x = enemy.x;
        loot.y = enemy.y;
        loot.itemType = entry.type;
        loot.lootId = entry.lootId;
        loot.category = entry.category;
        loot.description = entry.description;
        loot.label = entry.label;
        loot.textureKey = entry.textureKey;

        const id = `loot_${this.lootCounter++}`;
        this.state.lootItems.set(id, loot);
      }
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

