/**
 * Game Room — The Main Multiplayer Room
 * ======================================
 * This is the Colyseus room that manages the game session.
 *
 * ARCHITECTURE OVERVIEW:
 *   The room is a thin orchestrator. It:
 *     1. Receives client connections/disconnections
 *     2. Receives client inputs
 *     3. Runs the fixed timestep simulation loop
 *     4. Delegates all logic to systems
 *
 * WHY THIS DESIGN:
 *   - The room file stays small and readable
 *   - Each system has one clear responsibility
 *   - Easy to test systems in isolation
 *   - Easy to add new features (just add a system)
 *
 * SERVER AUTHORITY:
 *   The room owns the simulation. Clients only send inputs.
 *   The server decides: position, HP, damage, AI, bullets, everything.
 *   The client only renders what the server tells it.
 *
 * TICK ORDER MATTERS:
 *   Systems run in a specific order each tick:
 *     1. SpawnSystem   — create new enemies
 *     2. PlayerSystem   — process player inputs & move players
 *     3. EnemyAISystem  — update enemy AI, move enemies, melee attacks
 *     4. BulletSystem   — move bullets, handle bullet lifecycle
 *     5. CombatSystem   — check bullet collisions, apply damage
 *     6. MapSystem      — check exit zones, obstacle collisions
 */

import { Room, Client } from "colyseus";
import { RoomState } from "../schema/RoomState";
import { Player, InputData } from "../schema/Player";
import { Bullet } from "../schema/Bullet";
import { GAME_CONFIG } from "../config/game";
import { PLAYER_BOLTER_WEAPON, PLAYER_PULSE_WEAPON } from "../config/weapons";
import { PlayerSystem } from "../systems/PlayerSystem";
import { EnemyAISystem } from "../systems/EnemyAISystem";
import { BulletSystem } from "../systems/BulletSystem";
import { CombatSystem } from "../systems/CombatSystem";
import { SpawnSystem } from "../systems/SpawnSystem";
import { MapSystem } from "../systems/MapSystem";
import { getDefaultMap } from "../config/maps";

export class GameRoom extends Room {
  // ============================================================
  // STATE & CONFIG
  // ============================================================

  state = new RoomState();
  fixedTimeStep = GAME_CONFIG.FIXED_TIME_STEP_MS;

  // ============================================================
  // SYSTEMS (initialized in onCreate)
  // ============================================================

  playerSystem!: PlayerSystem;
  enemyAISystem!: EnemyAISystem;
  bulletSystem!: BulletSystem;
  combatSystem!: CombatSystem;
  spawnSystem!: SpawnSystem;
  mapSystem!: MapSystem;

  /** Running game time accumulator in milliseconds */
  gameTime = 0;

  // ============================================================
  // LIFECYCLE
  // ============================================================

  onCreate(options: any) {
    // ---- Load the map ----
    const mapDef = getDefaultMap();
    if (!mapDef) throw new Error("No maps registered!");
    this.mapSystem = new MapSystem(mapDef);

    // Set up map dimensions from the loaded map
    this.state.mapWidth = this.mapSystem.mapWidth;
    this.state.mapHeight = this.mapSystem.mapHeight;

    // Initialize all game systems
    // Order matters: BulletSystem must exist before CombatSystem
    this.playerSystem = new PlayerSystem(this.state, this.mapSystem);
    this.enemyAISystem = new EnemyAISystem(this.state, this.mapSystem);
    this.bulletSystem = new BulletSystem(this.state);
    this.combatSystem = new CombatSystem(this.state, this.bulletSystem, this.mapSystem);
    this.spawnSystem = new SpawnSystem(this.state, this.enemyAISystem, this.mapSystem);

    // Start the fixed timestep simulation
    let elapsedTime = 0;
    this.setSimulationInterval((deltaTime) => {
      elapsedTime += deltaTime;

      // Process ticks at fixed rate (60 per second)
      while (elapsedTime >= this.fixedTimeStep) {
        elapsedTime -= this.fixedTimeStep;
        this.fixedTick(this.fixedTimeStep);
      }
    });

    console.log("GameRoom created with map:", mapDef.name);
  }

  /**
   * The main simulation tick. Runs 60 times per second.
   * All game logic is delegated to systems.
   *
   * @param timeStepMs - Fixed timestep in milliseconds (1000/60 ≈ 16.67ms)
   */
  fixedTick(timeStepMs: number) {
    // Convert to seconds for movement calculations
    const dt = timeStepMs / 1000;

    // Accumulate game time
    this.gameTime += timeStepMs;

    // Run systems in order
    // 1. Spawn new enemies
    this.spawnSystem.update(timeStepMs, this.gameTime);

    // 2. Process player inputs & move players
    this.playerSystem.update(dt);

    // 3. Update enemy AI, move enemies, handle melee attacks
    const pendingBullets = this.enemyAISystem.update(dt, this.gameTime);

    // 4. Spawn any bullets that enemies fired
    for (const { bullet } of pendingBullets) {
      this.bulletSystem.spawnBullet(bullet, this.gameTime);
    }

    // 5. Move bullets & handle lifecycle
    this.bulletSystem.update(dt, this.gameTime);

    // 6. Check bullet-player collisions & apply damage
    this.combatSystem.update(this.gameTime);

    // 7. Check exit zone (teleport players who reach the exit)
    this.state.players.forEach((player) => {
      if (player.isDead) return;
      if (this.mapSystem.isInExitZone(player.x, player.y)) {
        // For now: teleport to initial spawn point (same map)
        const spawn = this.mapSystem.getInitialSpawnPoint();
        player.x = spawn.x;
        player.y = spawn.y;
        console.log(`Player reached exit, teleported to spawn`);
      }
    });
  }

  // ============================================================
  // CLIENT CONNECTION HANDLERS
  // ============================================================

  /**
   * Handle message types from clients.
   *
   * Message 0: Movement input (WASD state)
   * Message 1: Respawn request
   * Message 2: Shoot (mouse world position)
   * Message 3: Pulse (AoE)
   * Message 4: Heal
   */
  messages = {
    // Movement input
    0: (client: Client, input: InputData) => {
      const player = this.state.players.get(client.sessionId);
      if (player) {
        player.inputQueue.push(input);
      }
    },

    // Respawn request — spawn at nearest checkpoint
    1: (client: Client) => {
      const player = this.state.players.get(client.sessionId);
      if (player && player.isDead) {
        player.hp = GAME_CONFIG.PLAYER.RESPAWN_HP;
        player.isDead = false;
        // Find the nearest checkpoint to where the player died
        const spawn = this.mapSystem.getNearestSpawnPoint(player.x, player.y);
        player.x = spawn.x;
        player.y = spawn.y;
        player.inputQueue = [];
      }
    },

    // Shoot — client sends mouse world position { x, y }
    2: (client: Client, data: { x: number; y: number }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.isDead) return;

      // Enforce cooldown
      if (this.gameTime - player.lastShootTime < PLAYER_BOLTER_WEAPON.cooldown) {
        return;
      }

      // Calculate direction from player to mouse position
      const dx = data.x - player.x;
      const dy = data.y - player.y;
      const length = Math.sqrt(dx * dx + dy * dy);

      // Don't shoot if mouse is on top of player
      if (length === 0) return;

      const dirX = dx / length;
      const dirY = dy / length;

      // Create bullet
      const bullet = new Bullet();
      bullet.x = player.x;
      bullet.y = player.y;
      bullet.directionX = dirX;
      bullet.directionY = dirY;
      bullet.damage = PLAYER_BOLTER_WEAPON.damage;
      bullet.isPlayerBullet = true;
      bullet.ownerId = client.sessionId;

      // Spawn bullet with player weapon speed and lifetime
      this.bulletSystem.spawnBullet(
        bullet,
        this.gameTime,
        PLAYER_BOLTER_WEAPON.bulletSpeed,
        PLAYER_BOLTER_WEAPON.lifetime
      );

      // Update cooldown
      player.lastShootTime = this.gameTime;
    },

    // Pulse — AoE shockwave around the player
    3: (client: Client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.isDead) return;

      // Enforce cooldown
      if (this.gameTime - player.lastPulseTime < PLAYER_PULSE_WEAPON.cooldown) {
        return;
      }

      // Apply damage to all enemies within pulse radius
      this.state.enemies.forEach((enemy) => {
        if (enemy.isDead) return;

        const dx = enemy.x - player.x;
        const dy = enemy.y - player.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist <= PLAYER_PULSE_WEAPON.radius) {
          enemy.hp -= PLAYER_PULSE_WEAPON.damage;
          if (enemy.hp <= 0) {
            enemy.hp = 0;
            enemy.isDead = true;
            player.killsSinceLastHeal++;
          }
        }
      });

      player.lastPulseTime = this.gameTime;
    },

    // Heal — Restore HP based on kill count cooldown (6 kills required)
    4: (client: Client) => {
      const HEAL_KILLS_REQUIRED = 6;
      const HEAL_AMOUNT = 300;

      const player = this.state.players.get(client.sessionId);
      if (!player || player.isDead) return;

      if (player.killsSinceLastHeal < HEAL_KILLS_REQUIRED) {
        return;
      }

      player.hp = Math.min(player.hp + HEAL_AMOUNT, player.maxHp);
      player.killsSinceLastHeal = 0;
    },
  };

  /**
   * Called when a new client connects.
   * Creates a player entity at the map's initial spawn point.
   */
  onJoin(client: Client, options: any) {
    console.log("Player joined:", client.sessionId);

    const player = new Player();
    // Spawn at the map's initial spawn point
    const spawn = this.mapSystem.getInitialSpawnPoint();
    player.x = spawn.x;
    player.y = spawn.y;
    player.hp = GAME_CONFIG.PLAYER.HP;
    player.maxHp = GAME_CONFIG.PLAYER.HP;
    player.speed = GAME_CONFIG.PLAYER.SPEED;

    this.state.players.set(client.sessionId, player);
  }

  /**
   * Called when a client disconnects.
   */
  onLeave(client: Client, code: number) {
    console.log("Player left:", client.sessionId);
    this.state.players.delete(client.sessionId);
  }

  /**
   * Called when the room is disposed.
   */
  onDispose() {
    console.log("GameRoom disposed:", this.roomId);
  }
}
