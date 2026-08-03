/**
 * Spawn System (Per-Player)
 * ==========================
 * Spawns enemies for each player's map instance independently.
 * Enemies are tagged with ownerId (player's sessionId).
 * Applies enemyHpMult, enemySpeedMult, enemyAtkMult from mods at spawn.
 */

import { RoomState } from "../schema/RoomState";
import { Enemy } from "../schema/Enemy";
import { EnemyAISystem } from "./EnemyAISystem";
import { MapSystem } from "./MapSystem";
import { EnemySpawnZone } from "../config/maps";
import { getEnemyConfig } from "../config/enemies";
import { MODIFIER_POOL } from "../config/modifiers";

const ALL_MODS_BY_ID: Record<string, typeof MODIFIER_POOL[number]> = {};
for (const m of MODIFIER_POOL) ALL_MODS_BY_ID[m.id] = m;

interface ZoneTimer {
  timer: number;
}

export class SpawnSystem {
  private state: RoomState;
  private enemyAISystem: EnemyAISystem;
  private mapSystem: MapSystem;
  private enemyIdCounter = 0;
  /** Per-player zone timers: `${sessionId}:${zoneName}` */
  private zoneTimers: Map<string, ZoneTimer> = new Map();

  constructor(state: RoomState, enemyAISystem: EnemyAISystem, mapSystem: MapSystem) {
    this.state = state;
    this.enemyAISystem = enemyAISystem;
    this.mapSystem = mapSystem;
  }

  registerPlayer(sessionId: string): void {
    const zones = this.mapSystem.getEnemySpawnZones(sessionId);
    for (const zone of zones) {
      this.zoneTimers.set(sessionId + ":" + zone.name, { timer: 0 });
    }
  }

  unregisterPlayer(sessionId: string): void {
    for (const key of this.zoneTimers.keys()) {
      if (key.startsWith(sessionId + ":")) this.zoneTimers.delete(key);
    }
  }

  /** Remove ALL enemies belonging to a player (memory cleanup on map transition). */
  removeEnemiesForPlayer(sessionId: string): void {
    const toRemove: string[] = [];
    this.state.enemies.forEach((enemy, enemyId) => {
      if (enemy.ownerId === sessionId) toRemove.push(enemyId);
    });
    for (const id of toRemove) this.state.enemies.delete(id);
  }

  /** Remove skill effects belonging to a player's map instance. */
  removeSkillEffectsForPlayer(sessionId: string): void {
    const toRemove: string[] = [];
    this.state.skillEffects.forEach((effect, effectId) => {
      if (effect.isPlayer && effect.ownerId === sessionId) {
        toRemove.push(effectId);
      } else if (!effect.isPlayer) {
        const enemy = this.state.enemies.get(effect.ownerId);
        if (enemy && enemy.ownerId === sessionId) toRemove.push(effectId);
      }
    });
    for (const id of toRemove) this.state.skillEffects.delete(id);
  }

  update(dtMs: number, _currentTime: number): void {
    for (const sessionId of this.mapSystem.getPlayerIds()) {
      const player = this.state.players.get(sessionId);
      if (!player || player.isDead || player.isChoosingMod) continue;

      const zones = this.mapSystem.getEnemySpawnZones(sessionId);
      const mods = this.getActiveMods(sessionId);

      for (const zone of zones) {
        const key = sessionId + ":" + zone.name;
        let timerState = this.zoneTimers.get(key);
        if (!timerState) {
          timerState = { timer: 0 };
          this.zoneTimers.set(key, timerState);
        }

        timerState.timer += dtMs;
        if (timerState.timer >= zone.intervalMs) {
          timerState.timer = 0;
          const aliveCount = this.countEnemiesForPlayer(sessionId, zone.enemyTypes);
          if (aliveCount < zone.maxAlive) {
            this.spawnEnemyInZone(sessionId, zone, mods);
          }
        }
      }
    }
  }

  private getActiveMods(sessionId: string): typeof MODIFIER_POOL {
    const player = this.state.players.get(sessionId);
    if (!player || player.activeMods.length === 0) return [];
    const result: typeof MODIFIER_POOL = [];
    for (const md of player.activeMods) {
      const mod = ALL_MODS_BY_ID[md.id];
      if (mod) result.push(mod);
    }
    return result;
  }

  private countEnemiesForPlayer(sessionId: string, types: string[]): number {
    let count = 0;
    this.state.enemies.forEach((enemy) => {
      if (!enemy.isDead && enemy.ownerId === sessionId && types.includes(enemy.enemyType)) {
        count++;
      }
    });
    return count;
  }

  private spawnEnemyInZone(sessionId: string, zone: EnemySpawnZone, mods: typeof MODIFIER_POOL): void {
    const type = zone.enemyTypes[Math.floor(Math.random() * zone.enemyTypes.length)];
    const cfg = getEnemyConfig(type);

    const enemy = new Enemy();
    enemy.enemyType = type;
    enemy.ownerId = sessionId;
    enemy.isDead = false;

    let hp = cfg.hp;
    let speed = cfg.speed;
    let atkMult = 1;
    for (const mod of mods) {
      if (mod.enemyHpMult) hp *= mod.enemyHpMult;
      if (mod.enemySpeedMult) speed *= mod.enemySpeedMult;
      if (mod.enemyAtkMult) atkMult *= mod.enemyAtkMult;
    }

    enemy.hp = hp;
    enemy.maxHp = hp;
    enemy.speed = speed;
    enemy.collisionRadius = cfg.collisionRadius;
    enemy.atkMult = atkMult;

    for (const skillId of cfg.skills) {
      enemy.skills.push(skillId);
    }

    enemy.spritesheet.key = cfg.spritesheet.key;
    enemy.spritesheet.displayWidth = cfg.spritesheet.displayWidth;
    enemy.spritesheet.displayHeight = cfg.spritesheet.displayHeight;
    enemy.spritesheet.frameWidth = cfg.spritesheet.frameWidth;
    enemy.spritesheet.frameHeight = cfg.spritesheet.frameHeight;
    enemy.spritesheet.walkStart = cfg.spritesheet.walkStart;
    enemy.spritesheet.walkEnd = cfg.spritesheet.walkEnd;
    enemy.spritesheet.attackStart = cfg.spritesheet.attackStart;
    enemy.spritesheet.attackEnd = cfg.spritesheet.attackEnd;
    enemy.spritesheet.walkFrameRate = cfg.spritesheet.walkFrameRate;
    enemy.spritesheet.attackFrameRate = cfg.spritesheet.attackFrameRate;

    const margin = cfg.collisionRadius + 2;
    const edge = Math.floor(Math.random() * 4);
    switch (edge) {
      case 0:
        enemy.x = zone.x + Math.random() * zone.width;
        enemy.y = zone.y - margin;
        break;
      case 1:
        enemy.x = zone.x + Math.random() * zone.width;
        enemy.y = zone.y + zone.height + margin;
        break;
      case 2:
        enemy.x = zone.x - margin;
        enemy.y = zone.y + Math.random() * zone.height;
        break;
      default:
        enemy.x = zone.x + zone.width + margin;
        enemy.y = zone.y + Math.random() * zone.height;
        break;
    }

    const enemyId = "enemy_" + this.enemyIdCounter++;
    this.state.enemies.set(enemyId, enemy);
    this.enemyAISystem.registerEnemy(enemyId, type);
  }
}
