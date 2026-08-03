/**
 * Enemy AI System (Per-Player)
 * ============================
 * Enemies only target the player on the SAME map (enemy.ownerId match).
 * Loot drops are scaled by the owner player's lootDropChanceMult mods.
 */

import { RoomState } from "../schema/RoomState";
import { Player } from "../schema/Player";
import { Enemy } from "../schema/Enemy";
import { EnemyRuntimeState, updateEnemyAI } from "../ai/EnemyAI";
import { distanceSq } from "../utils/math";
import { getEnemyConfig } from "../config/enemies";
import { MapSystem } from "./MapSystem";
import { SkillSystem } from "./SkillSystem";
import { CasterInfo } from "../skills/ISkill";
import { LootItem } from "../schema/LootItem";
import { getLootEntry } from "../config/loot";
import { MODIFIER_POOL } from "../config/modifiers";

const ALL_MODS_BY_ID: Record<string, typeof MODIFIER_POOL[number]> = {};
for (const m of MODIFIER_POOL) ALL_MODS_BY_ID[m.id] = m;

export class EnemyAISystem {
  private state: RoomState;
  private mapSystem: MapSystem;
  private skillSystem: SkillSystem;
  private enemyStates: Map<string, EnemyRuntimeState> = new Map();
  private lootCounter: number = 0;
  private aiCooldowns: Map<string, number> = new Map();

  constructor(state: RoomState, mapSystem: MapSystem, skillSystem: SkillSystem) {
    this.state = state;
    this.mapSystem = mapSystem;
    this.skillSystem = skillSystem;
  }

  update(dt: number, currentTime: number): void {
    const deadEnemyIds: string[] = [];

    this.state.enemies.forEach((enemy, enemyId) => {
      if (enemy.isDead) {
        deadEnemyIds.push(enemyId);
        return;
      }

      const ownerId = enemy.ownerId;

      let aiState = this.enemyStates.get(enemyId);
      if (!aiState) {
        aiState = new EnemyRuntimeState();
        this.enemyStates.set(enemyId, aiState);
      }

      const result = updateEnemyAI(
        enemy,
        aiState,
        (x, y) => this.findNearestAlivePlayerForOwner(x, y, ownerId),
        dt,
        currentTime,
      );

      if (result.skillId) {
        const aiCdKey = enemyId + ":" + result.skillId;
        const aiReadyAt = this.aiCooldowns.get(aiCdKey) ?? 0;
        if (currentTime >= aiReadyAt) {
          const caster: CasterInfo = {
            ownerId: enemyId,
            isPlayer: false,
            x: enemy.x,
            y: enemy.y,
            targetDirX: result.targetDirX,
            targetDirY: result.targetDirY,
          };
          this.skillSystem.activate(result.skillId, caster, currentTime);
          let aiCd = 1500;
          if (result.skillId === "claw") aiCd = 2000;
          else if (result.skillId === "vortex") aiCd = 8000;
          this.aiCooldowns.set(aiCdKey, currentTime + aiCd);
        }
      }

      // Clamp enemy to its owner's map bounds
      const mapW = this.mapSystem.getMapWidth(ownerId);
      const mapH = this.mapSystem.getMapHeight(ownerId);
      enemy.x = Math.max(0, Math.min(mapW, enemy.x));
      enemy.y = Math.max(0, Math.min(mapH, enemy.y));

      // Resolve blocking collisions on owner's map
      const enemyCfg = getEnemyConfig(enemy.enemyType);
      const hitBlocker = this.mapSystem.checkAllBlockingCollision(
        ownerId,
        enemy.x,
        enemy.y,
        enemyCfg.collisionRadius,
      );
      if (hitBlocker) {
        const resolved = this.mapSystem.resolveBlockingCollision(
          ownerId,
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
      const enemy = this.state.enemies.get(enemyId);
      if (enemy) this.dropLoot(enemy);
      this.enemyStates.delete(enemyId);
      this.state.enemies.delete(enemyId);
    }
  }

  findNearestAlivePlayerForOwner(
    x: number,
    y: number,
    ownerId: string,
  ): { player: Player; distSq: number } | null {
    const ownerPlayer = this.state.players.get(ownerId);
    if (!ownerPlayer || ownerPlayer.isDead) return null;
    const dSq = distanceSq(x, y, ownerPlayer.x, ownerPlayer.y);
    return { player: ownerPlayer, distSq: dSq };
  }

  registerEnemy(enemyId: string, _type: string): void {
    if (!this.enemyStates.has(enemyId)) {
      this.enemyStates.set(enemyId, new EnemyRuntimeState());
    }
  }

  dropLoot(enemy: Enemy): void {
    const cfg = getEnemyConfig(enemy.enemyType);
    if (!cfg.lootPool || cfg.lootPool.length === 0) return;

    const owner = this.state.players.get(enemy.ownerId);
    let lootMult = 1;
    if (owner) {
      for (const md of owner.activeMods) {
        const mod = ALL_MODS_BY_ID[md.id];
        if (mod && mod.lootDropChanceMult) lootMult *= mod.lootDropChanceMult;
      }
    }

    for (const lootId of cfg.lootPool) {
      const entry = getLootEntry(lootId);
      if (!entry) continue;
      const effectiveChance = Math.min(1, entry.dropChance * lootMult);
      if (Math.random() < effectiveChance) {
        const loot = new LootItem();
        loot.x = enemy.x;
        loot.y = enemy.y;
        loot.itemType = entry.type;
        loot.lootId = entry.lootId;
        loot.category = entry.category;
        loot.description = entry.description;
        loot.label = entry.label;
        loot.textureKey = entry.textureKey;
        const id = "loot_" + this.lootCounter++;
        this.state.lootItems.set(id, loot);
      }
    }
  }

  cleanupEnemy(enemyId: string): void {
    this.enemyStates.delete(enemyId);
    this.state.enemies.delete(enemyId);
  }
}
