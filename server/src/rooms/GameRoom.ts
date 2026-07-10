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
 * REFACTOR — SKILL SYSTEM:
 *   Player abilities (shoot/pulse/heal) and enemy attacks (claw) now all
 *   flow through ONE SkillSystem. The room no longer creates Bullet or
 *   ClawSlash objects directly. It just calls skillSystem.activate() with
 *   a CasterInfo and the skill handles everything (effects, damage, memory).
 *
 * TICK ORDER:
 *   1. SpawnSystem    — create new enemies
 *   2. PlayerSystem   — process player inputs & move players
 *   3. EnemyAISystem  — update enemy AI, move enemies, trigger skills
 *   4. SkillSystem    — update all active skill effects (move/damage/despawn)
 *   5. MapSystem      — check exit zones
 */

import { Room, Client } from "colyseus";
import { RoomState } from "../schema/RoomState";
import { Player, InputData } from "../schema/Player";
import { GAME_CONFIG } from "../config/game";
import { PlayerSystem } from "../systems/PlayerSystem";
import { EnemyAISystem } from "../systems/EnemyAISystem";
import { SkillSystem } from "../systems/SkillSystem";
import { SpawnSystem } from "../systems/SpawnSystem";
import { MapSystem } from "../systems/MapSystem";
import { getDefaultMap } from "../config/maps";
import { CasterInfo } from "../skills/ISkill";

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
  skillSystem!: SkillSystem;
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

    this.state.mapWidth = this.mapSystem.mapWidth;
    this.state.mapHeight = this.mapSystem.mapHeight;

    // Initialize systems.
    // SkillSystem must be created before EnemyAISystem (enemy AI calls it).
    this.skillSystem = new SkillSystem(this.state, this.mapSystem);
    this.playerSystem = new PlayerSystem(this.state, this.mapSystem);
    this.enemyAISystem = new EnemyAISystem(this.state, this.mapSystem, this.skillSystem);
    this.spawnSystem = new SpawnSystem(this.state, this.enemyAISystem, this.mapSystem);

    // Start the fixed timestep simulation
    let elapsedTime = 0;
    this.setSimulationInterval((deltaTime) => {
      elapsedTime += deltaTime;
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
   */
  fixedTick(timeStepMs: number) {
    const dt = timeStepMs / 1000;
    this.gameTime += timeStepMs;

    // 1. Spawn new enemies
    this.spawnSystem.update(timeStepMs, this.gameTime);

    // 2. Process player inputs & move players
    this.playerSystem.update(dt);

    // 3. Update enemy AI (movement + triggering skills)
    this.enemyAISystem.update(dt, this.gameTime);

    // 4. Update all skill effects (move bullets, apply cone/aoe damage, despawn)
    this.skillSystem.update(dt, this.gameTime);

    // 5. Check exit zone (teleport players who reach the exit)
    this.state.players.forEach((player) => {
      if (player.isDead) return;
      if (this.mapSystem.isInExitZone(player.x, player.y)) {
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
   * Message 2: Shoot (mouse world position)  -> skill "boltershot"
   * Message 3: Pulse (AoE)                    -> skill "pulse"
   * Message 4: Heal                           -> skill "heal"
   *
   * Each skill message builds a CasterInfo and hands it to SkillSystem.
   * Cooldowns/damage/visuals are all handled by the skill implementation.
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
        const spawn = this.mapSystem.getNearestSpawnPoint(player.x, player.y);
        player.x = spawn.x;
        player.y = spawn.y;
        player.inputQueue = [];
      }
    },

    // Shoot (bolter) -> skill "boltershot"
    2: (client: Client, data: { x: number; y: number }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.isDead) return;

      // Direction from player to mouse
      const dx = data.x - player.x;
      const dy = data.y - player.y;
      const length = Math.sqrt(dx * dx + dy * dy);
      if (length === 0) return; // mouse on top of player
      const dirX = dx / length;
      const dirY = dy / length;

      const caster: CasterInfo = {
        ownerId: client.sessionId,
        isPlayer: true,
        x: player.x,
        y: player.y,
        targetDirX: dirX,
        targetDirY: dirY,
      };
      this.skillSystem.activate("boltershot", caster, this.gameTime);
    },

    // Pulse (AoE) -> skill "pulse"
    3: (client: Client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.isDead) return;

      const caster: CasterInfo = {
        ownerId: client.sessionId,
        isPlayer: true,
        x: player.x,
        y: player.y,
        targetDirX: 0,
        targetDirY: 0,
      };
      this.skillSystem.activate("pulse", caster, this.gameTime);
    },

    // Heal -> skill "heal"
    4: (client: Client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.isDead) return;

      const caster: CasterInfo = {
        ownerId: client.sessionId,
        isPlayer: true,
        x: player.x,
        y: player.y,
        targetDirX: 0,
        targetDirY: 0,
      };
      this.skillSystem.activate("heal", caster, this.gameTime);
    },
  };

  /**
   * Called when a new client connects.
   */
  onJoin(client: Client, options: any) {
    console.log("Player joined:", client.sessionId);

    const player = new Player();
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