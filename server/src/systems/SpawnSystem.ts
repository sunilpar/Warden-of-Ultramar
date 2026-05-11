/**
 * Spawn System
 * =============
 * Handles spawning new enemies at timed intervals:
 *   - Tracks spawn timers for each enemy type
 *   - Limits max alive enemies per type
 *   - Spawns enemies at random map edges
 *   - Registers new enemies with the AI system
 *
 * WHY A SEPARATE SYSTEM: Spawning is timing logic, not AI or combat.
 * Isolating it means:
 *   - Spawn rates are easy to tune
 *   - Adding new enemy types = adding a new spawn config
 *   - Spawn logic doesn't clutter the main game loop
 *
 * SCALABILITY: To add a new enemy type:
 *   1. Add config to config/enemies.ts
 *   2. Create AI file in ai/
 *   3. Add spawn case here
 *   4. Add update case in EnemyAISystem
 */

import { RoomState } from "../schema/RoomState";
import { Enemy } from "../schema/Enemy";
import { EnemyAISystem } from "./EnemyAISystem";
import { GAME_CONFIG } from "../config/game";
import { ELDER_CONFIG, ORK_CONFIG } from "../config/enemies";

export class SpawnSystem {
  private state: RoomState;
  private enemyAISystem: EnemyAISystem;

  /** Counter for unique enemy IDs */
  private enemyIdCounter = 0;

  /** Time accumulator for Elder spawns (milliseconds) */
  private elderSpawnTimer: number = 0;

  /** Time accumulator for Ork spawns (milliseconds) */
  private orkSpawnTimer: number = 0;

  constructor(state: RoomState, enemyAISystem: EnemyAISystem) {
    this.state = state;
    this.enemyAISystem = enemyAISystem;
  }

  /**
   * Check if it's time to spawn new enemies.
   *
   * HOW IT WORKS:
   *   1. Accumulate delta time each tick
   *   2. When timer exceeds spawn interval, attempt a spawn
   *   3. Only spawn if we're below the max alive limit
   *   4. Reset timer after spawn attempt
   *
   * @param dt - Delta time in MILLISECONDS (we convert internally)
   * @param currentTime - Current game time in milliseconds
   */
  update(dtMs: number, currentTime: number): void {
    // --- Elder Spawning ---
    this.elderSpawnTimer += dtMs;
    if (this.elderSpawnTimer >= ELDER_CONFIG.spawn.intervalMs) {
      this.elderSpawnTimer = 0;

      // Count current elders
      const elderCount = this.countEnemyType("elder");
      if (elderCount < ELDER_CONFIG.spawn.maxAlive) {
        this.spawnEnemy("elder");
      }
    }

    // --- Ork Spawning ---
    this.orkSpawnTimer += dtMs;
    if (this.orkSpawnTimer >= ORK_CONFIG.spawn.intervalMs) {
      this.orkSpawnTimer = 0;

      const orkCount = this.countEnemyType("ork");
      if (orkCount < ORK_CONFIG.spawn.maxAlive) {
        this.spawnEnemy("ork");
      }
    }
  }

  /**
   * Count how many alive enemies of a given type exist.
   */
  private countEnemyType(type: string): number {
    let count = 0;
    this.state.enemies.forEach((enemy) => {
      if (enemy.enemyType === type && !enemy.isDead) {
        count++;
      }
    });
    return count;
  }

  /**
   * Spawn a new enemy at a random map edge.
   *
   * WHY EDGES: Spawning at edges prevents enemies from appearing
   * on top of players in the middle of the map, which feels unfair.
   */
  private spawnEnemy(type: "elder" | "ork"): void {
    const enemy = new Enemy();
    enemy.enemyType = type;
    enemy.isDead = false;

    // Configure based on type
    if (type === "elder") {
      enemy.hp = ELDER_CONFIG.hp;
      enemy.maxHp = ELDER_CONFIG.hp;
      enemy.attack = ELDER_CONFIG.attackDamage;
    } else if (type === "ork") {
      enemy.hp = ORK_CONFIG.hp;
      enemy.maxHp = ORK_CONFIG.hp;
      enemy.attack = 0; // orks use bullets, not melee
    }

    // Spawn at a random map edge
    const edge = Math.floor(Math.random() * 4);
    switch (edge) {
      case 0: // top
        enemy.x = Math.random() * this.state.mapWidth;
        enemy.y = 0;
        break;
      case 1: // bottom
        enemy.x = Math.random() * this.state.mapWidth;
        enemy.y = this.state.mapHeight;
        break;
      case 2: // left
        enemy.x = 0;
        enemy.y = Math.random() * this.state.mapHeight;
        break;
      case 3: // right
        enemy.x = this.state.mapWidth;
        enemy.y = Math.random() * this.state.mapHeight;
        break;
    }

    // Add to state and register with AI system
    const enemyId = `enemy_${this.enemyIdCounter++}`;
    this.state.enemies.set(enemyId, enemy);
    this.enemyAISystem.registerEnemy(enemyId, type);
  }
}