/**
 * Spawn System
 * =============
 * Handles spawning new enemies at map-defined spawn zones:
 *   - Tracks spawn timers per zone
 *   - Limits max alive enemies per zone
 *   - Spawns enemies at random positions within each zone
 *   - Registers new enemies with the AI system
 *
 * MAP-DRIVEN SPAWNING:
 *   The old system spawned enemies at random map edges.
 *   The new system reads spawn zones from the MapDefinition.
 *   Each zone defines: position, size, enemy types, max alive, interval.
 *
 * WHY A SEPARATE SYSTEM: Spawning is timing logic, not AI or combat.
 * Isolating it means spawn rates are easy to tune and zone-based.
 */

import { RoomState } from "../schema/RoomState";
import { Enemy } from "../schema/Enemy";
import { EnemyAISystem } from "./EnemyAISystem";
import { MapSystem } from "./MapSystem";
import { EnemySpawnZone } from "../config/maps";
import { ELDER_CONFIG, ORK_CONFIG, TYRANID_CONFIG } from "../config/enemies";

/** Runtime timer state per spawn zone */
interface ZoneTimer {
  /** Accumulated time in milliseconds */
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

    // Initialize timers for each spawn zone
    for (const zone of this.mapSystem.getEnemySpawnZones()) {
      this.zoneTimers.set(zone.name, { timer: 0 });
    }
  }

  /**
   * Check if it's time to spawn new enemies in each zone.
   *
   * HOW IT WORKS:
   *   1. For each spawn zone on the map
   *   2. Accumulate delta time on the zone's timer
   *   3. When timer exceeds the zone's interval, attempt a spawn
   *   4. Only spawn if we're below the zone's max alive limit
   *   5. Pick a random position within the zone's rectangle
   *
   * @param dtMs - Delta time in MILLISECONDS
   * @param currentTime - Current game time in milliseconds
   */
  update(dtMs: number, currentTime: number): void {
    const zones = this.mapSystem.getEnemySpawnZones();

    for (const zone of zones) {
      const timerState = this.zoneTimers.get(zone.name);
      if (!timerState) continue;

      // Accumulate time
      timerState.timer += dtMs;

      // Check if it's time to spawn
      if (timerState.timer >= zone.intervalMs) {
        timerState.timer = 0;

        // Count alive enemies from this zone type
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
   * WHY ZONES: Instead of spawning at random map edges, enemies
   * appear in designated areas. This gives the map designer control
   * over where combat happens.
   */
  private spawnEnemyInZone(zone: EnemySpawnZone): void {
    // Pick a random enemy type from the zone's allowed types
    const type = zone.enemyTypes[Math.floor(Math.random() * zone.enemyTypes.length)];

    const enemy = new Enemy();
    enemy.enemyType = type;
    enemy.isDead = false;

    // Configure based on type
    if (type === "elder") {
      enemy.hp = ELDER_CONFIG.hp;
      enemy.maxHp = ELDER_CONFIG.hp;
      enemy.attack = ELDER_CONFIG.attackDamage;
    } else if (type === "tyranid") {
      enemy.hp = TYRANID_CONFIG.hp;
      enemy.maxHp = TYRANID_CONFIG.hp;
      enemy.attack = TYRANID_CONFIG.attackDamage;
    } else if (type === "ork") {
      enemy.hp = ORK_CONFIG.hp;
      enemy.maxHp = ORK_CONFIG.hp;
      enemy.attack = 0; // orks use bullets, not melee
    }

    // Spawn OUTSIDE the zone (adjacent to a random edge)
    // WHY: Enemy spawn zones are blocking rects — enemies can't be inside them.
    // Pick a random edge (top, bottom, left, right) and spawn just outside.
    const radius = type === "ork" ? ORK_CONFIG.collisionRadius
      : type === "tyranid" ? TYRANID_CONFIG.collisionRadius
      : ELDER_CONFIG.collisionRadius;
    const margin = radius + 2; // Small buffer so they don't immediately collide
    const edge = Math.floor(Math.random() * 4);
    switch (edge) {
      case 0: // Top edge
        enemy.x = zone.x + Math.random() * zone.width;
        enemy.y = zone.y - margin;
        break;
      case 1: // Bottom edge
        enemy.x = zone.x + Math.random() * zone.width;
        enemy.y = zone.y + zone.height + margin;
        break;
      case 2: // Left edge
        enemy.x = zone.x - margin;
        enemy.y = zone.y + Math.random() * zone.height;
        break;
      case 3: // Right edge
        enemy.x = zone.x + zone.width + margin;
        enemy.y = zone.y + Math.random() * zone.height;
        break;
    }

    // Add to state and register with AI system
    const enemyId = `enemy_${this.enemyIdCounter++}`;
    this.state.enemies.set(enemyId, enemy);
    this.enemyAISystem.registerEnemy(enemyId, type);
  }
}