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
 */

import { Room, Client } from "colyseus";
import { RoomState } from "../schema/RoomState";
import { Player, InputData } from "../schema/Player";
import { GAME_CONFIG } from "../config/game";
import { PlayerSystem } from "../systems/PlayerSystem";
import { EnemyAISystem } from "../systems/EnemyAISystem";
import { BulletSystem } from "../systems/BulletSystem";
import { CombatSystem } from "../systems/CombatSystem";
import { SpawnSystem } from "../systems/SpawnSystem";

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

  /** Running game time accumulator in milliseconds */
  gameTime = 0;

  // ============================================================
  // LIFECYCLE
  // ============================================================

  onCreate(options: any) {
    // Set up map dimensions
    this.state.mapWidth = GAME_CONFIG.MAP_WIDTH;
    this.state.mapHeight = GAME_CONFIG.MAP_HEIGHT;

    // Initialize all game systems
    // Order matters: BulletSystem must exist before CombatSystem
    this.playerSystem = new PlayerSystem(this.state);
    this.enemyAISystem = new EnemyAISystem(this.state);
    this.bulletSystem = new BulletSystem(this.state);
    this.combatSystem = new CombatSystem(this.state, this.bulletSystem);
    this.spawnSystem = new SpawnSystem(this.state, this.enemyAISystem);

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

    console.log("GameRoom created");
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
  }

  // ============================================================
  // CLIENT CONNECTION HANDLERS
  // ============================================================

  /**
   * Handle message types from clients.
   *
   * Message 0: Movement input (WASD state)
   * Message 1: Respawn request
   */
  messages = {
    // Movement input
    0: (client: Client, input: InputData) => {
      const player = this.state.players.get(client.sessionId);
      if (player) {
        player.inputQueue.push(input);
      }
    },

    // Respawn request
    1: (client: Client) => {
      const player = this.state.players.get(client.sessionId);
      if (player && player.isDead) {
        player.hp = GAME_CONFIG.PLAYER.RESPAWN_HP;
        player.isDead = false;
        player.x = Math.random() * this.state.mapWidth;
        player.y = Math.random() * this.state.mapHeight;
        player.inputQueue = [];
      }
    },
  };

  /**
   * Called when a new client connects.
   * Creates a player entity at a random position.
   */
  onJoin(client: Client, options: any) {
    console.log("Player joined:", client.sessionId);

    const player = new Player();
    player.x = Math.random() * this.state.mapWidth;
    player.y = Math.random() * this.state.mapHeight;
    player.hp = GAME_CONFIG.PLAYER.HP;
    player.maxHp = GAME_CONFIG.PLAYER.HP;
    player.speed = GAME_CONFIG.PLAYER.SPEED;

    this.state.players.set(client.sessionId, player);
  }

  /**
   * Called when a client disconnects.
   * Removes their player entity from the game.
   */
  onLeave(client: Client, code: number) {
    console.log("Player left:", client.sessionId);
    this.state.players.delete(client.sessionId);
  }

  /**
   * Called when the room is disposed (no more clients).
   */
  onDispose() {
    console.log("GameRoom disposed:", this.roomId);
  }
}