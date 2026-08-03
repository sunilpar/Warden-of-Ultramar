/**
 * Game Room — Per-Player Maps + Modifiers
 * =======================================
 *
 * PER-PLAYER MAPS:
 *   Each player has their OWN map instance (MapSystem is per-player).
 *   When a player reaches the exit zone:
 *     a. isChoosingMod=true (player frozen)
 *     b. 2 random mods sent in pendingModChoices
 *     c. Client shows ModifierSelect popup
 *     d. Player picks one (message 8)
 *     e. Mod added to activeMods, map swapped, old enemies purged
 *     f. isChoosingMod=false
 *   Other players are completely unaffected.
 *
 * MESSAGE TYPES:
 *   0: Movement input
 *   1: Respawn request
 *   5: Generic skill activation
 *   6: Pickup loot
 *   7: Drop card to ground
 *   8: Choose a modifier (map transition)
 */

import { Room, Client } from "colyseus";
import { RoomState } from "../schema/RoomState";
import { Player, InputData } from "../schema/Player";
import { ModifierData } from "../schema/ModifierData";
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
import { pickRandomMods } from "../config/modifiers";

export class GameRoom extends Room {
  state = new RoomState();
  fixedTimeStep = GAME_CONFIG.FIXED_TIME_STEP_MS;

  playerSystem!: PlayerSystem;
  enemyAISystem!: EnemyAISystem;
  skillSystem!: SkillSystem;
  statusSystem!: StatusSystem;
  spawnSystem!: SpawnSystem;
  mapSystem!: MapSystem;

  gameTime = 0;

  onCreate(_options: any) {
    const mapDef = getDefaultMap();
    if (!mapDef) throw new Error("No maps registered!");
    this.mapSystem = new MapSystem(mapDef);
    this.state.mapWidth = mapDef.widthPx;
    this.state.mapHeight = mapDef.heightPx;
    this.state.currentMapId = mapDef.id;

    this.skillSystem = new SkillSystem(this.state, this.mapSystem);
    this.statusSystem = new StatusSystem(this.state, this.skillSystem.getContext());
    this.playerSystem = new PlayerSystem(this.state, this.mapSystem);
    this.enemyAISystem = new EnemyAISystem(this.state, this.mapSystem, this.skillSystem);
    this.spawnSystem = new SpawnSystem(this.state, this.enemyAISystem, this.mapSystem);

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

  fixedTick(timeStepMs: number) {
    const dt = timeStepMs / 1000;
    this.gameTime += timeStepMs;

    this.spawnSystem.update(timeStepMs, this.gameTime);
    this.playerSystem.update(dt);
    this.enemyAISystem.update(dt, this.gameTime);
    this.skillSystem.update(dt, this.gameTime);
    this.statusSystem.update(this.gameTime);
    this.checkExitZones();
  }

  private checkExitZones(): void {
    this.state.players.forEach((player, sessionId) => {
      if (player.isDead || player.isChoosingMod) return;
      if (this.mapSystem.isInExitZone(sessionId, player.x, player.y)) {
        this.presentModifierChoice(sessionId);
      }
    });
  }

  private presentModifierChoice(sessionId: string): void {
    const player = this.state.players.get(sessionId);
    if (!player) return;

    const currentMap = this.mapSystem.getMap(sessionId);
    if (!currentMap.nextMapId) return;
    const nextMap = getMap(currentMap.nextMapId);
    if (!nextMap) return;

    const choices = pickRandomMods(2);

    player.isChoosingMod = true;
    player.inputQueue.length = 0;

    player.pendingModChoices.clear();
    for (const mod of choices) {
      const md = new ModifierData();
      md.id = mod.id;
      md.label = mod.label;
      md.description = mod.description;
      player.pendingModChoices.push(md);
    }

    console.log("Player", sessionId, "reached exit; presenting mod choices");
  }

  private transitionMapWithMod(sessionId: string, modId: string): void {
    const player = this.state.players.get(sessionId);
    if (!player || !player.isChoosingMod) return;

    const offered = player.pendingModChoices.find((m) => m.id === modId);
    if (!offered) {
      console.warn("Player", sessionId, "chose invalid mod", modId);
      return;
    }

    // Add chosen mod to active mods
    const chosen = new ModifierData();
    chosen.id = offered.id;
    chosen.label = offered.label;
    chosen.description = offered.description;
    player.activeMods.push(chosen);

    player.pendingModChoices.clear();

    // Swap to next map
    const currentMap = this.mapSystem.getMap(sessionId);
    const nextMap = getMap(currentMap.nextMapId!);
    if (!nextMap) {
      console.error("Next map not found for player", sessionId);
      player.isChoosingMod = false;
      return;
    }

    this.mapSystem.setPlayerMap(sessionId, nextMap);

    // Memory cleanup
    this.spawnSystem.removeEnemiesForPlayer(sessionId);
    this.spawnSystem.removeSkillEffectsForPlayer(sessionId);

    // Reposition to new map's spawn
    const spawn = this.mapSystem.getInitialSpawnPoint(sessionId);
    player.x = spawn.x;
    player.y = spawn.y;

    // Update synced per-player map id
    player.currentMapId = nextMap.id;

    // Re-register spawn zones for new map
    this.spawnSystem.unregisterPlayer(sessionId);
    this.spawnSystem.registerPlayer(sessionId);

    // Unfreeze player
    player.isChoosingMod = false;

    console.log("Player", sessionId, 'transitioned to "' + nextMap.name + '" with mod "' + chosen.label + '"');
  }

  // ============================================================
  // MESSAGE HANDLERS
  // ============================================================

  messages = {
    0: (client: Client, input: InputData) => {
      const player = this.state.players.get(client.sessionId);
      if (player) player.inputQueue.push(input);
    },

    1: (client: Client) => {
      const player = this.state.players.get(client.sessionId);
      if (player && player.isDead) {
        player.hp = GAME_CONFIG.PLAYER.RESPAWN_HP;
        player.isDead = false;
        const spawn = this.mapSystem.getNearestSpawnPoint(client.sessionId, player.x, player.y);
        player.x = spawn.x;
        player.y = spawn.y;
        player.inputQueue = [];
      }
    },

    5: (client: Client, data: { skillId: string; x?: number; y?: number }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.isDead || player.isChoosingMod) return;

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

    6: (client: Client, data: { lootId: string }) => {
      const loot = this.state.lootItems.get(data.lootId);
      if (loot) this.state.lootItems.delete(data.lootId);
    },

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
      const id = "loot_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
      this.state.lootItems.set(id, loot);
    },

    8: (client: Client, data: { modId: string }) => {
      this.transitionMapWithMod(client.sessionId, data.modId);
    },
  };

  // ============================================================
  // CONNECTION LIFECYCLE
  // ============================================================

  onJoin(client: Client, _options: any) {
    console.log("Player joined:", client.sessionId);

    const player = new Player();
    this.mapSystem.registerPlayer(client.sessionId);
    const spawn = this.mapSystem.getInitialSpawnPoint(client.sessionId);
    player.x = spawn.x;
    player.y = spawn.y;
    player.hp = GAME_CONFIG.PLAYER.HP;
    player.maxHp = GAME_CONFIG.PLAYER.HP;
    player.speed = GAME_CONFIG.PLAYER.SPEED;
    player.currentMapId = this.mapSystem.getMap(client.sessionId).id;

    this.state.players.set(client.sessionId, player);
    this.spawnSystem.registerPlayer(client.sessionId);
  }

  onLeave(client: Client, _code: number) {
    console.log("Player left:", client.sessionId);
    this.spawnSystem.removeEnemiesForPlayer(client.sessionId);
    this.spawnSystem.removeSkillEffectsForPlayer(client.sessionId);
    this.spawnSystem.unregisterPlayer(client.sessionId);
    this.mapSystem.unregisterPlayer(client.sessionId);
    this.state.players.delete(client.sessionId);
  }

  onDispose() {
    console.log("GameRoom disposed:", this.roomId);
  }
}
