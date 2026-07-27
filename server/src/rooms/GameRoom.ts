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
import { StatusSystem } from "../systems/StatusSystem";
import { SpawnSystem } from "../systems/SpawnSystem";
import { MapSystem } from "../systems/MapSystem";
import { getDefaultMap, getMap } from "../config/maps";
import { CasterInfo } from "../skills/ISkill";
import { LootItem } from "../schema/LootItem";

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
  statusSystem!: StatusSystem;
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
    this.state.currentMapId = mapDef.id;

    // Initialize systems.
    // SkillSystem must be created before EnemyAISystem (enemy AI calls it).
    this.skillSystem = new SkillSystem(this.state, this.mapSystem);
    this.statusSystem = new StatusSystem(this.state, this.skillSystem.getContext());
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
      this.statusSystem.update(this.gameTime);

    // 5. Check exit zone (map transition)
    this.state.players.forEach((player) => {
      if (player.isDead) return;
      if (this.mapSystem.isInExitZone(player.x, player.y)) {
        const currentMap = this.mapSystem.getMap();
        const nextMapId = currentMap.nextMapId;
        if (nextMapId) {
          const nextMap = getMap(nextMapId);
          if (nextMap) {
            this.mapSystem.setMap(nextMap);
            this.state.currentMapId = nextMap.id;
            this.state.enemies.clear();
            this.state.skillEffects.clear();
            const spawn = this.mapSystem.getInitialSpawnPoint();
            player.x = spawn.x;
            player.y = spawn.y;
            console.log(`Player reached exit, transitioning to map: ${nextMap.name}`);
          }
        }
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

    // Generic skill activation — works for any card in any slot
    // Message 5: { skillId: string, x?: number, y?: number }
    5: (client: Client, data: { skillId: string; x?: number; y?: number }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.isDead) return;

      let dirX = 0;
      let dirY = 0;
      if (data.x !== undefined && data.y !== undefined) {
        const dx = data.x - player.x;
        const dy = data.y - player.y;
        const length = Math.sqrt(dx * dx + dy * dy);
        if (length > 0) {
          dirX = dx / length;
          dirY = dy / length;
        }
      }

      const caster: CasterInfo = {
        ownerId: client.sessionId,
        isPlayer: true,
        x: player.x,
        y: player.y,
        targetDirX: dirX,
        targetDirY: dirY,
      };
      this.skillSystem.activate(data.skillId, caster, this.gameTime);
    },

    // Pickup loot — removes loot from world (client adds to inventory)
    // Message 6: { lootId: string }
    6: (client: Client, data: { lootId: string }) => {
      const loot = this.state.lootItems.get(data.lootId);
      if (loot) {
        this.state.lootItems.delete(data.lootId);
      }
    },

    // Drop card to ground — creates loot at player position
    // Message 7: { cardId: string, skillId: string, label: string }
    7: (client: Client, data: { cardId: string; skillId: string; label: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      const loot = new LootItem();
      loot.x = player.x;
      loot.y = player.y;
      loot.itemType = "card";
      loot.lootId = data.cardId;
      loot.category = "Card";
      loot.label = data.label;
      loot.description = "";
      loot.textureKey = "card_skill_" + data.skillId;

      const id = `loot_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      this.state.lootItems.set(id, loot);
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