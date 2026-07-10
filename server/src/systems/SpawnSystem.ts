/**
 * Spawn System
 * =============
 * Handles spawning new enemies at map-defined spawn zones:
 *   - Tracks spawn timers per zone
 *   - Limits max alive enemies per zone
 *   - Spawns enemies at random positions within each zone
 *   - Registers new enemies with the AI system
 *
 * REFACTOR: Now uses the generic EnemyConfig (hp/speed/skills/spritesheet).
 * The spawned Enemy schema object is fully populated from config — no
 * per-type branching here anymore.
 */

import { RoomState } from "../schema/RoomState";
import { Enemy } from "../schema/Enemy";
import { EnemyAISystem } from "./EnemyAISystem";
import { MapSystem } from "./MapSystem";
import { EnemySpawnZone } from "../config/maps";
import { getEnemyConfig } from "../config/enemies";

/** Runtime timer state per spawn zone */
interface ZoneTimer {
  timer: number;
}

export class SpawnSystem {
  private state: RoomState;
  private enemyAISystem: EnemyAISystem;
  private mapSystem: MapSystem;

  /** Counter for unique enemy IDs */
  private enemyIdCounter = 0;

  /** Spawn timers per zone (keyed by zone name) */
  private zoneTimers: Map<string, ZoneTimer> = new Map();

  constructor(state: RoomState, enemyAISystem: EnemyAISystem, mapSystem: MapSystem) {
    this.state = state;
    this.enemyAISystem = enemyAISystem;
    this.mapSystem = mapSystem;

    for (const zone of this.mapSystem.getEnemySpawnZones()) {
      this.zoneTimers.set(zone.name, { timer: 0 });
    }
  }

  /**
   * Check if it's time to spawn new enemies in each zone.
   *
   * @param dtMs - Delta time in MILLISECONDS
   * @param _currentTime - Current game time in milliseconds (unused now)
   */
  update(dtMs: number, _currentTime: number): void {
    const zones = this.mapSystem.getEnemySpawnZones();

    for (const zone of zones) {
      const timerState = this.zoneTimers.get(zone.name);
      if (!timerState) continue;

      timerState.timer += dtMs;

      if (timerState.timer >= zone.intervalMs) {
        timerState.timer = 0;

        const aliveCount = this.countEnemiesOfTypes(zone.enemyTypes);
        if (aliveCount < zone.maxAlive) {
          this.spawnEnemyInZone(zone);
        }
      }
    }
  }

  /**
   * Count how many alive enemies match any of the given types.
   */
  private countEnemiesOfTypes(types: string[]): number {
    let count = 0;
    this.state.enemies.forEach((enemy) => {
      if (!enemy.isDead && types.includes(enemy.enemyType)) {
        count++;
      }
    });
    return count;
  }

  /**
   * Spawn a new enemy at a random position within a zone's rectangle.
   *
   * The enemy is fully configured from EnemyConfig (hp, speed, skills,
   * spritesheet, collision radius). No per-type branching needed.
   */
  private spawnEnemyInZone(zone: EnemySpawnZone): void {
    const type = zone.enemyTypes[Math.floor(Math.random() * zone.enemyTypes.length)];
    const cfg = getEnemyConfig(type);

    const enemy = new Enemy();
    enemy.enemyType = type;
    enemy.isDead = false;
    enemy.hp = cfg.hp;
    enemy.maxHp = cfg.hp;
    enemy.speed = cfg.speed;
    enemy.collisionRadius = cfg.collisionRadius;

    // Copy skills from config into the schema array
    for (const skillId of cfg.skills) {
      enemy.skills.push(skillId);
    }

    // Copy spritesheet config (not synced but used by client via the room object)
    enemy.spritesheet = cfg.spritesheet;

    // Spawn OUTSIDE the zone (adjacent to a random edge)
    const margin = cfg.collisionRadius + 2;
    const edge = Math.floor(Math.random() * 4);
    switch (edge) {
      case 0: // Top
        enemy.x = zone.x + Math.random() * zone.width;
        enemy.y = zone.y - margin;
        break;
      case 1: // Bottom
        enemy.x = zone.x + Math.random() * zone.width;
        enemy.y = zone.y + zone.height + margin;
        break;
      case 2: // Left
        enemy.x = zone.x - margin;
        enemy.y = zone.y + Math.random() * zone.height;
        break;
      case 3: // Right
        enemy.x = zone.x + zone.width + margin;
        enemy.y = zone.y + Math.random() * zone.height;
        break;
    }

    const enemyId = `enemy_${this.enemyIdCounter++}`;
    this.state.enemies.set(enemyId, enemy);
    this.enemyAISystem.registerEnemy(enemyId, type);
  }
}