/**
 * Game Room
 * =========
 * The authoritative server room. ONE ROOM = ONE GAME SESSION (one party
 * of players). Maps are DATA (config/mapRegistry.ts): when this map's
 * elite is dead and ALL alive players reach the exit, the SAME room
 * swaps to the next map in place — connections and Player objects
 * (cards/XP/inventory) are never torn down. Rotation: map1 -> map2 -> map1...
 *
 * Handles:
 *   - Player join/leave
 *   - Movement input (message type 0)
 *   - Skill cast by HUD SLOT (message type 1)
 *   - Skill upgrade (message type 2)
 *   - Fixed timestep simulation (60 ticks/sec)
 *   - Enemy AI + projectile simulation
 *
 * MESSAGE TYPES:
 *   0: Movement input { left, right, up, down, tick }
 *   1: Cast slot      { slot: number (0..4), angle: number }
 *   2: Upgrade skill  { skill: SkillId }
 *   3: Viewport rect  { x, y, w, h } (camera world view)
 *   4: Respawn
 *   5: Map transition XP
 *   6: Stat point spend { stat }
 *   7: Card upgrade    { skill }
 *   8: Grant skill point (debug)
 *   9: Force level-up (debug)
 *  10: Drop slot card  { slot: number }
 *  11: Pick up card    { cardId, slot: number }
 *  12: Move ground card{ cardId, x, y }
 *  22: Lobby "Play" — starts a run for everyone in the lobby (blocked
 *      while a run is in progress; nobody joins a map mid-run)
 *
 * CARD MODEL
 * The player HUD is `player.equippedSlots` — a synced array of 5 card
 * slots (null = empty). Each slot is a pure skill TRIGGER: message 1 names
 * the SLOT, and the card in that slot casts its skill with ITS OWN mods.
 * Duplicates of the same skill are allowed (each slot independent).
 */
import { Room, Client, matchMaker } from "colyseus";
import { RoomState } from "../schema/RoomState";
import { GroundCard } from "../schema/GroundCard";
import { CardInstance } from "../schema/CardInstance";
import { LootSystem } from "../systems/LootSystem";
import {
  Player,
  InputData,
  NUM_CARD_SLOTS,
  NUM_INVENTORY_SLOTS,
} from "../schema/Player";
import { GAME_CONFIG } from "../config/game";
import { MapSystem } from "../systems/MapSystem";
import { PlayerSystem } from "../systems/PlayerSystem";
import { EnemySystem } from "../systems/EnemySystem";
import type { Enemy } from "../schema/Enemy";
import { ProjectileSystem } from "../systems/ProjectileSystem";
import { ClawSystem } from "../systems/ClawSystem";
import { SlamSystem } from "../systems/SlamSystem";
import { HealSystem } from "../systems/HealSystem";
import { PulseSystem } from "../systems/PulseSystem";
import { ShockSystem } from "../systems/ShockSystem";
import { DashSystem } from "../systems/DashSystem";
import { VortexSystem } from "../systems/VortexSystem";
import {
  MAPS,
  DEFAULT_MAP,
  type MapId,
  type GameMapId,
} from "../config/mapRegistry";
import { LOBBY_SPAWN_POINT } from "../config/lobbyMap";
import {
  SKILL_DEFS,
  MAX_SKILL_LEVEL,
  skillCritRate,
  pulseCooldown,
  dashCooldown,
  healCooldown,
  type SkillId,
} from "../config/skillDefs";
import {
  MODIFIER_DEFS,
  applyPlayerModifiers,
  applyEnemyModifiers,
  type ModifierId,
} from "../config/modifiers";
import { cardModMetadata } from "../config/cardMods";
import {
  rollThreeOffers,
  rolledMapStatId,
  readAppliedStats,
  getActiveDropRateMult,
  getActiveRarityBias,
  applyActiveMapStatsToPlayer,
  applyActiveMapStatsToEnemy,
  tierForLevel,
  type RolledMapStat,
} from "../config/mapStats";
import { MapStat } from "../schema/MapStat";
import { pickUniqueName } from "../config/namePool";
import {
  registerLobby,
  unregisterLobby,
  setLeaderInLobby,
} from "../lobbyRegistry";

/** Serialized map-stat offer sent over the wire to the picker UI. */
export interface SerializedMapStatOffer {
  index: number;
  defId: string;
  goodName: string;
  badName: string;
  goodEffect: string;
  badEffect: string;
  goodValue: number;
  badValue: number;
  durationMaps: number;
}

/**
 * Stable per-browser identifier the client persists in localStorage
 * and re-sends on every join. The server uses it to give the same
 * player the same display name across rooms (within one process).
 */
const CLIENT_PLAYER_ID_KEY = "clientPlayerId";

/** Starter cards handed to FRESH players (all 5 slots filled). */
const STARTER_CARDS: { skill: SkillId; level: number }[] = [
  { skill: "shock", level: 1 },
  { skill: "pulse", level: 1 },
  { skill: "dash", level: 1 },
  { skill: "heal", level: 1 },
  { skill: "vortex", level: 1 },
];

export class GameRoom extends Room {
  state = new RoomState();
  fixedTimeStep = GAME_CONFIG.FIXED_TIME_STEP_MS;

  private mapSystem!: MapSystem;
  private playerSystem!: PlayerSystem;
  /** Lobby-side PlayerSystem: processes movement for players whose
   *  currentMapId === "lobby" using the lobby's MapSystem. */
  private lobbyPlayerSystem!: PlayerSystem;
  /** Lobby MapSystem - never changes; used by lobbyPlayerSystem for
   *  movement collision against the lobby's collision grid. */
  private lobbyMapSystem!: MapSystem;
  private enemySystem!: EnemySystem;
  private lootSystem!: LootSystem;
  private projectileSystem!: ProjectileSystem;
  private clawSystem!: ClawSystem;
  private slamSystem!: SlamSystem;
  private healSystem!: HealSystem;
  private pulseSystem!: PulseSystem;
  private shockSystem!: ShockSystem;
  private dashSystem!: DashSystem;
  private vortexSystem!: VortexSystem;
  /** Spawn zones that have already triggered (one-time spawn each). */
  private spawnedZones = new Set<number>();
  /** Enemies killed so far this map (drives the elite spawn threshold). */
  private enemiesKilled: number = 0;
  /** True once this map's single elite enemy has spawned. */
  private eliteSpawned: boolean = false;
  private mapId: GameMapId = DEFAULT_MAP;
  private activeModifiers: ModifierId[] = [];
  /** True while a map transition is in progress (blocks re-trigger). */
  private transitioning: boolean = false;
  /**
   * Snapshot of the map stats that were in effect on the map being left
   * (taken BEFORE expiry deletions). initMap undoes exactly these from
   * players, then re-applies only what is still active - so expired
   * stats are fully removed and nothing compounds across transitions.
   */
  private lastAppliedStats: import("../config/mapStats").AppliedMapStat[] = [];
  /** Per-player pending 3 offers sent to each player at the exit point. */
  private currentMapStatOffers = new Map<string, SerializedMapStatOffer[]>();
  /** Count of alive players who have a picker open. 0 = no picker active. */
  private mapStatPickersOpen: number = 0;
  /** Last reported viewport (world rect) per player session. */
  private viewports = new Map<
    string,
    { x: number; y: number; w: number; h: number }
  >();
  /**
   * How many players are in the CURRENT run. Used to scale the number
   * of map-stat offers each player sees at the exit (base = 3 per
   * player, multiplied by the party size so a 4-player party gets 4x
   * the choice of mods).
   *   - Set in `startRun()` to the lobby count at run start.
   *   - Incremented in `joinExistingRun()` for late joiners.
   *   - Reset in `endRunIfNeeded()` so the next run starts clean.
   */
  private runPartySize: number = 0;
  /**
   * Sticky name assignment cache: maps a client's persistent
   * `clientPlayerId` to the display name the server gave them.
   * Cleared when the room is disposed (process restart).
   */
  private nameByClientId = new Map<string, string>();
  /**
   * Names currently in use by ANY player connected to THIS room
   * (across the live roster). Updated on join + leave so freshly
   * joining players don't collide with current neighbours.
   */
  private namesInUse = new Set<string>();
  /**
   * Set when this room was created by `spawnSoloRunFor` (matches the
   * `soloRun: true` option passed to `matchMaker.createRoom`). When
   * true, the FIRST player that joins is auto-teleported to map1 by
   * `startRun()` so the dead-loner Play press takes them straight to
   * the map without requiring a second click on the new room's lobby.
   */
  private isSoloRun = false;
  /**
   * 6-character lobby code or empty string. Populated in onCreate
   * from options.lobbyCode. When non-empty this room is a joinable
   * code lobby - registered in the lobby registry so the HTTP join
   * route can route other players into it. Empty means private/solo.
   */
  private lobbyCode: string = "";
  /**
   * sessionId of the FIRST player to join the room. The leader is
   * the gatekeeper for new joiners (only they being in the lobby
   * state allows HTTP join calls to succeed). On leader disconnect
   * the entire room is destroyed - the lobby loses its identity.
   */
  private leaderId: string = "";
  /**
   * Mirror of leader Player.currentMapId === "lobby". Updated in
   * onJoin, sendPlayerToLobby and startRun so the registry always
   * answers the join gate without racing against a player schema.
   */
  private leaderInLobby: boolean = false;

  onCreate(options?: any) {
    // The lobby is a permanent, never-rotating map. Its MapSystem +
    // PlayerSystem live for the entire lifetime of the room.
    this.lobbyMapSystem = new MapSystem(MAPS.lobby.data);
    this.lobbyPlayerSystem = new PlayerSystem(
      this.state,
      this.lobbyMapSystem,
      "lobby",
    );
    // The gameplay map is initialized up front (map1). Its systems
    // reset on every map transition (map1 -> map2 etc).
    this.initMap(DEFAULT_MAP);
    this.startSimulation();
    // Solo-run flag: carried from matchMaker.createRoom options.
    if (options && options.soloRun) {
      this.isSoloRun = true;
      console.log("[ROOM] Solo-run room created - first join will auto-start");
    }
    // Lobby code: carried from matchMaker.createRoom options. When
    // present this room is a public code lobby; registration with
    // the registry happens in onJoin (needs leader sessionId) and
    // teardown happens automatically in onDispose.
    if (options && typeof options.lobbyCode === "string" && options.lobbyCode.length > 0) {
      this.lobbyCode = options.lobbyCode;
      this.state.lobbyCode = this.lobbyCode;
      console.log("[ROOM] Code-lobby room created with code " + this.lobbyCode);
    }
  }

  /** Fixed timestep simulation loop (started once, on room create). */
  startSimulation() {
    let elapsedTime = 0;
    this.setSimulationInterval((deltaTime) => {
      elapsedTime += deltaTime;
      while (elapsedTime >= this.fixedTimeStep) {
        elapsedTime -= this.fixedTimeStep;
        this.fixedTick(this.fixedTimeStep);
      }
    });
  }

  /**
   * (Re)initialize everything that is PER-MAP. Player objects are NEVER
   * touched here — cards, XP, skill points and inventory carry over.
   * Called on room creation (first map) and on every map transition.
   */
  private initMap(mapId: GameMapId): void {
    this.mapId = mapId;
    const def = MAPS[mapId];
    this.activeModifiers = def.modifiers;

    // ---- Per-map systems (fresh instances = zero stale state) ----
    this.mapSystem = new MapSystem(def.data);
    this.playerSystem = new PlayerSystem(this.state, this.mapSystem, mapId);
    this.enemySystem = new EnemySystem(this.state, this.mapSystem);
    this.lootSystem = new LootSystem(this.state);
    this.projectileSystem = new ProjectileSystem(this.state, this.mapSystem);
    this.clawSystem = new ClawSystem(this.state);
    this.slamSystem = new SlamSystem(this.state, this.mapSystem);
    this.healSystem = new HealSystem(this.state);
    this.pulseSystem = new PulseSystem(this.state);
    this.shockSystem = new ShockSystem(this.state, this.mapSystem);
    this.dashSystem = new DashSystem(this.state);
    this.vortexSystem = new VortexSystem(this.state, this.mapSystem);
    // Cross-link: enemies can fire projectiles + claws.
    this.enemySystem.setProjectileSystem(this.projectileSystem);
    this.enemySystem.setClawSystem(this.clawSystem);
    this.enemySystem.setSlamSystem(this.slamSystem);
    this.enemySystem.setHealSystem(this.healSystem);
    this.enemySystem.setShockSystem(this.shockSystem);
    this.enemySystem.setDashSystem(this.dashSystem);
    this.enemySystem.setVortexSystem(this.vortexSystem);
    this.enemySystem.setPulseSystem(this.pulseSystem);

    // ---- Per-map bookkeeping + synced state reset ----
    // Clear any lingering picker state so the next exit opens a
    // fresh picker (defensive: pickMapStatAndTransition already
    // clears this on a successful pick, but if a player dropped
    // the room mid-pick or the pick was never sent we still want
    // the next exit to work).
    this.currentMapStatOffers.clear();
    this.mapStatPickersOpen = 0;
    this.spawnedZones.clear();
    this.enemiesKilled = 0;
    this.eliteSpawned = false;
    this.transitioning = false;
    this.state.mapId = mapId;
    this.state.enemies.clear();
    this.state.projectiles.clear();
    this.state.skillCasts.clear();
    this.state.slams.clear();
    this.state.shockCasts.clear();
    this.state.vortexes.clear();
    this.state.groundCards.clear();
    this.state.eliteAlive = false;
    this.state.exitUnlocked = false;
    // Enemy spawn grace: no spawns for the first 5 seconds after the map
    // loads (gives arriving players a safe window).
    this.state.spawnGraceUntil = Date.now() + 5000;

    // ---- Reposition existing players at the new map's spawn ----
    // Only players ON A GAMEPLAY MAP move with the room (their
    // currentMapId is updated to the new map). Lobby players stay
    // where they are - they rejoin only when a new run starts.
    const spawn = this.mapSystem.getSpawnPoint();
    // Undo the stats that were in effect on the PREVIOUS map (snapshot
    // taken before expiry), then re-apply only what is STILL active.
    // This correctly removes expired stats' bonuses - reading the
    // current state after deletion would skip them entirely.
    const undoFrom = this.lastAppliedStats;
    const stillActive = readAppliedStats(this.state.activeMapStats.values());
    this.state.players.forEach((p) => {
      // Lobby players are not part of the run - skip them entirely.
      if (p.currentMapId === "lobby") return;
      p.currentMapId = mapId;
      p.x = spawn.x;
      p.y = spawn.y;
      p.inputQueue.length = 0;
      // CRITICAL: undo every map-derived bonus before re-applying,
      // otherwise each map transition would compound them. We do
      // NOT touch player base stats (attack, baseMoveSpeed, etc.)
      // - those are level-derived and survive map transitions.
      p.damageMultiplier = Math.max(
        0,
        p.damageMultiplier - this.appliedGoodSum(undoFrom, "damage_mult"),
      );
      p.speedMultiplier = Math.max(
        0,
        p.speedMultiplier - this.appliedGoodSum(undoFrom, "move_speed_mult"),
      );
      p.critRate = Math.max(
        0,
        p.critRate - this.appliedGoodSum(undoFrom, "crit_rate"),
      );
      p.critDamage = Math.max(
        1,
        p.critDamage - this.appliedGoodSum(undoFrom, "crit_damage"),
      );
      p.defence = Math.max(
        0,
        p.defence - this.appliedGoodSum(undoFrom, "defence"),
      );
      // Reverse prior max_health_mult bonuses. applyActiveMapStatsToPlayer
      // multiplies per-stat: newMax = round(max * Π(1+v_i)). Undo by
      // dividing by the same product, mirroring how they were applied.
      let hpDiv = 1;
      for (const a of undoFrom) {
        if (a.goodEffect === "max_health_mult") hpDiv *= 1 + a.goodValue;
      }
      if (hpDiv !== 1) {
        p.maxHealth = Math.max(1, Math.round(p.maxHealth / hpDiv));
        p.currentHealth = Math.min(
          p.maxHealth,
          Math.max(1, Math.round(p.currentHealth / hpDiv)),
        );
      }
      p.mapCooldownReduction = 0;
      applyActiveMapStatsToPlayer(p, stillActive);
    });

    // ---- Map metadata for client display ----
    this.setMetadata({
      mapName: def.info.name,
      mapDescription: def.info.description,
      modifiers: this.activeModifiers.map((id) => {
        const d = MODIFIER_DEFS[id];
        return d
          ? { id, title: d.title, description: d.description }
          : { id, title: id, description: "" };
      }),
      /**
       * Card mod display metadata (label/color/kind/fallback) lives in
       * `config/cardMods.ts`. Sending it here means the client never needs
       * hardcoded per-mod strings - a new mod shows up automatically.
       */
      cardMods: cardModMetadata(),
    });
    console.log(
      `[MAP] Map "${mapId}" initialized: ${def.data.cols}x${def.data.rows} tiles, ` +
        `${this.state.players.size} player(s) repositioned`,
    );
  }

  //core cycle
  fixedTick(timeStepMs: number) {
    const dt = timeStepMs / 1000;
    // Process movement for ALL players across ALL maps. Each system
    // filters internally by targetMapId so lobby players get lobby
    // collision and gameplay players get gameplay collision.
    this.lobbyPlayerSystem.update(dt);
    this.playerSystem.update(dt);
    this.enemySystem.update(dt);
    this.projectileSystem.update(dt);
    this.clawSystem.update(dt);
    this.slamSystem.update(dt);
    this.vortexSystem.update(dt);
    // Tick player skill cooldowns + bleed DoT + handle death.
    // Lobby players don't tick skills (they have nothing to cast and
    // can't take damage in the safe zone). When a gameplay-map player
    // dies, the server moves them to the lobby automatically and the
    // client tears down its scene on the next patch.
    this.state.players.forEach((p) => {
      // Lobby players: only their movement input is being processed by
      // PlayerSystem (already done above). Skip skill/shield ticks.
      if (p.currentMapId !== this.mapId) return;
      p.tickShield(dt);
      p.tickSlotCooldowns(dt);
      if (p.tickBleed(dt)) {
        // Player died from bleed
        p.die();
      }
      // Check if player died from any damage source
      if (p.isDead && p.currentHealth === 0) {
        p.die();
      }
      // PER-PLAYER DEATH → LOBBY.
      // The first tick the player's HP hits 0 we teleport them back to
      // the lobby, give them a fresh loadout, and mark them as a lobby
      // player. Subsequent ticks short-circuit on the `currentMapId`
      // check above (they're no longer on the gameplay map).
      if (p.isDead && p.currentMapId === this.mapId) {
        this.sendPlayerToLobby(p);
        // The run may now be over (this was the last player on the map).
        this.endRunIfNeeded();
      }
    });
    // Clean up dead enemies
    this.cleanupDeadEnemies();
    // Viewport-activated spawning
    this.checkSpawnZones();
    // Server-authoritative map exit check
    this.checkMapExit();
  }

  /**
   * Returns the highest level among all currently connected players.
   * Falls back to GAME_CONFIG.ENEMY.DEFAULT_LEVEL (1) if no players.
   * Used to scale enemy stats on spawn.
   */
  private getHighestPlayerLevel(): number {
    let maxLevel = GAME_CONFIG.ENEMY.DEFAULT_LEVEL;
    this.state.players.forEach((p) => {
      if (p.level > maxLevel) maxLevel = p.level;
    });
    return maxLevel;
  }

  /**
   * Highest `dropRate` stat across all connected players. The room's
   * LootSystem uses this to scale the SPAWN_WITH_CARD gate (so a player
   * stacking increased drop rate makes the whole party see more cards).
   */
  private getHighestPlayerDropRate(): number {
    let max = 0;
    this.state.players.forEach((p) => {
      if (p.dropRate > max) max = p.dropRate;
    });
    return max;
  }

  /**
   * Push the current room-level loot context (drop rate + per-rarity
   * bias) into LootSystem. Called before each enemy card roll and after
   * any player stat change.
   */
  private refreshLootContext(): void {
    const applied = readAppliedStats(this.state.activeMapStats.values());
    const base = this.getHighestPlayerDropRate();
    const plunder = getActiveDropRateMult(applied); // additive 0..1
    // rarityBias: a flat additive weight shift toward better rarities.
    // We model it by shifting the rarities from 'rare' upward.
    const rb = getActiveRarityBias(applied);
    const rarityBias: Partial<
      Record<
        "common" | "uncommon" | "rare" | "epic" | "legendary" | "unique",
        number
      >
    > = {
      rare: rb,
      epic: rb * 0.7,
      legendary: rb * 0.4,
      unique: rb * 0.2,
    };
    this.lootSystem.setLootContext({
      dropRate: base + plunder,
      rarityBias,
    });
  }

  /**
   * Total enemies this map should host: 20 base + 1 per 2 player levels
   * (highest player level in the room).
   */
  private getTargetEnemyCount(): number {
    // Base scales with the highest player level; TOTAL scales with the
    // party size so a 4-player lobby faces 4x the enemies of a solo
    // run (each zone also spawns `partySize` enemies instead of 1 -
    // see checkSpawnZones).
    const base = 20 + Math.floor(this.getHighestPlayerLevel() / 2);
    return base * Math.max(1, this.runPartySize);
  }

  /** Drop a rolled card instance to the ground at the player's position. */
  private dropCardToGround(player: Player, card: CardInstance): GroundCard {
    const gc = new GroundCard();
    gc.card = card;
    gc.skill = card.skill;
    gc.level = card.level;
    gc.x = player.x;
    gc.y = player.y;
    gc.pickupLockUntil = Date.now() + 500;
    this.state.groundCards.set(this.nextGroundCardId(), gc);
    return gc;
  }

  /** Monotonic id counter for dropped ground cards. */
  private groundCardSeq: number = 0;
  private nextGroundCardId(): string {
    this.groundCardSeq += 1;
    return `gc_${Date.now().toString(36)}_${this.groundCardSeq}`;
  }

  /**
   * Pick an enemy type by spawn ratio: 40% tyranid / 30% mechanicus /
   * 20% tau / 10% orck.
   */
  private pickEnemyType():
    | "tyranid"
    | "orck"
    | "tau"
    | "mechanicus"
    | "caster" {
    const r = Math.random();
    if (r < 0.4) return "tyranid";
    if (r < 0.55) return "mechanicus"; // halved 30% -> 15%, rest moved to caster
    if (r < 0.7) return "caster"; // 15% (taken from mechanicus)
    if (r < 0.9) return "tau";
    return "orck";
  }

  /**
   * SERVER-AUTHORITATIVE MAP EXIT (per-player picker).
   * When the elite is dead (`exitUnlocked`), the moment ANY alive
   * player stands inside the exit zone, that player gets their own
   * map-stat picker (with their own 3 rolled offers). Stepping off
   * the exit closes only THAT player's picker; everyone else's stays
   * open. Picking resolves at the room level: the chosen stat is
   * added to `activeMapStats` and the whole room transitions to the
   * next map. No "wait for everyone" gating.
   */
  private checkMapExit(): void {
    if (this.transitioning) return;
    if (!this.state.exitUnlocked) return;
    const def = MAPS[this.mapId];
    const ex = def.data.exitPoint;
    // Per-player: walk every alive player on the map and toggle
    // their picker individually based on whether they are inside
    // the exit zone right now.
    this.state.players.forEach((p) => {
      // Only gameplay-map, alive players are eligible. Lobby and
      // dead players are skipped entirely (they have no business
      // holding a picker open).
      if (p.currentMapId !== this.mapId) return;
      if (p.isDead) return;
      const inside =
        p.x >= ex.x &&
        p.x <= ex.x + ex.width &&
        p.y >= ex.y &&
        p.y <= ex.y + ex.height;
      const hasOffer = this.currentMapStatOffers.has(p.sessionId);
      if (inside && !hasOffer) {
        // Player just stepped onto the exit: roll THEIR OWN set of
        // offers and ship them only to this player's client.
        // tierForLevel uses the highest-level player in the room,
        // so a level-100 player in the party still lifts the
        // offers to tier-5 instead of base-tier for everyone else.
        //
        // Offer count scales with party size: base = 3 per player,
        // multiplied by runPartySize so a 4-player party sees 12
        // offers each (4x the choice of a solo run).
        const tier = tierForLevel(this.getHighestPlayerLevel());
        const partySize = Math.max(1, this.runPartySize);
        const targetCount = 3 * partySize;
        const allRolled: RolledMapStat[] = [];
        while (allRolled.length < targetCount) {
          allRolled.push(...rollThreeOffers(tier));
        }
        const serialized = allRolled.map((o, i) => ({
          index: i,
          defId: rolledMapStatId(o),
          goodName: o.good.name,
          badName: o.bad.name,
          goodEffect: o.good.effect,
          badEffect: o.bad.effect,
          goodValue: o.goodValue,
          badValue: o.badValue,
          durationMaps: o.durationMaps,
        }));
        this.currentMapStatOffers.set(p.sessionId, serialized);
        this.mapStatPickersOpen++;
        // Colyseus 0.17: `this.clients` is a ClientArray with a
        // getById(sessionId) lookup (NOT a Map - .get doesn't exist).
        const client = this.clients.getById(p.sessionId);
        if (client) {
          client.send("mapStatOffer", {
            tier,
            offers: serialized,
            playerCount: partySize,
          });
        }
      } else if (!inside && hasOffer) {
        // Player stepped off the exit (or cancelled): close ONLY
        // their picker. Other players with their own pickers open
        // are untouched.
        this.currentMapStatOffers.delete(p.sessionId);
        this.mapStatPickersOpen--;
        const client = this.clients.getById(p.sessionId);
        if (client) {
          client.send("mapStatCancelled", {});
        }
      }
    });
  }

  /** Sum the GOOD-side values of a single effect across an AppliedMapStat list. */
  private appliedGoodSum(
    active: import("../config/mapStats").AppliedMapStat[],
    effect: import("../config/mapStats").StatEffect,
  ): number {
    let s = 0;
    for (const a of active) if (a.goodEffect === effect) s += a.goodValue;
    return s;
  }

  /**
   * Apply the picked map stat to the room and trigger the transition.
   * Called when a player sends message 20.
   */
  private pickMapStatAndTransition(
    client: { sessionId: string },
    offerIndex: number,
  ): void {
    if (this.transitioning) return;
    // Per-player offers: each player's own 3 rolled offers, keyed by
    // their sessionId (not a shared "__shared__" key anymore).
    const offers = this.currentMapStatOffers.get(client.sessionId);
    // -1 = "no mods" (transition without applying a stat).
    // Otherwise: validate the index is in range.
    if (offerIndex !== -1) {
      if (!offers || offerIndex < 0 || offerIndex >= offers.length) return;
    }
    const offer = offerIndex === -1 ? null : offers![offerIndex];

    // Snapshot what is currently in effect BEFORE adding the new pick:
    // initMap must undo exactly what players currently carry (the new
    // pick hasn't been applied yet, so it must not be in the snapshot).
    this.lastAppliedStats = readAppliedStats(
      this.state.activeMapStats.values(),
    );

    // Key of the newly picked stat (empty when "no mods"). Used below
    // to skip it during the duration decrement.
    let newStatKey = "";

    // Add the picked stat to the room's active list (if any).
    if (offer) {
      const stat = new MapStat();
      stat.defId = offer.defId;
      stat.goodName = offer.goodName;
      stat.badName = offer.badName;
      stat.goodEffect = offer.goodEffect;
      stat.badEffect = offer.badEffect;
      stat.goodValue = offer.goodValue;
      stat.badValue = offer.badValue;
      stat.durationMaps = offer.durationMaps;
      // Pick a key that won't collide if an earlier stat just expired.
      // We use Date.now() + a random suffix so two picks in the same
      // tick don't overwrite each other, and post-expiration picks
      // never reuse a stale id.
      newStatKey = `stat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      this.state.activeMapStats.set(newStatKey, stat);
      console.log(
        `[MAPSTAT] Added ${newStatKey}: ${stat.goodName}+${stat.badName} dur=${stat.durationMaps}`,
      );
      this.broadcast("mapStatPicked", {
        pickerId: client.sessionId,
        defId: offer.defId,
        goodName: offer.goodName,
        badName: offer.badName,
        goodValue: offer.goodValue,
        badValue: offer.badValue,
        durationMaps: offer.durationMaps,
      });
    } else {
      this.broadcast("mapStatPicked", {
        pickerId: client.sessionId,
        defId: "none",
        goodName: "(no mods)",
        badName: "",
        goodValue: 0,
        badValue: 0,
        durationMaps: 0,
      });
    }
    this.currentMapStatOffers.clear();
    this.mapStatPickersOpen = 0;

    // ---- Decrement remaining duration on PRE-EXISTING stats only ----
    // The stat picked just now (if any) counts the NEXT map as its
    // first, so it must NOT be decremented (identified by the unique
    // statKey captured above). Stats whose timer hits 0 expire
    // immediately (and won't affect the next map).
    const expired: string[] = [];
    this.state.activeMapStats.forEach((st, sid) => {
      if (sid === newStatKey) return; // skip the newly picked one
      st.durationMaps -= 1;
      if (st.durationMaps <= 0) expired.push(sid);
    });
    for (const sid of expired) this.state.activeMapStats.delete(sid);
    // One more map cleared -> the next picker tier scales up.
    this.state.mapsCleared += 1;

    // ---- Everyone is on the exit: transition now ----
    this.transitioning = true;
    const nextMapId = MAPS[this.mapId].next;
    const modLabel = offer ? `${offer.goodName}+${offer.badName}` : "(no mods)";
    console.log(
      `[MAP] Exit picked ${modLabel} — transitioning ${this.mapId} -> ${nextMapId}`,
    );

    // Transition XP reward (was client-driven message 5). map2 -> map1
    // awards 1000 XP, map1 -> map2 awards 500 XP (previous behavior).
    const transitionXp = this.mapId === "map2" ? 1000 : 500;
    this.state.players.forEach((p) => {
      if (!p.isDead) p.addXp(transitionXp);
    });

    // Tell clients to swap maps (they rebuild tilemap + entities locally).
    this.broadcast("mapTransition", { from: this.mapId, to: nextMapId });

    // Swap all per-map state + systems (initMap resets `transitioning`).
    this.initMap(nextMapId);
  }

  /**
   * Spawn one enemy at the center of each spawn zone the FIRST time any
   * player's viewport touches it. Each zone spawns exactly once.
   */
  private checkSpawnZones(): void {
    // Spawn grace: block all zone spawning during the grace period.
    if (Date.now() < this.state.spawnGraceUntil) return;
    const zones = MAPS[this.mapId].data.enemySpawnZones;
    if (zones.length === 0 || this.viewports.size === 0) return;
    const enemyLevel = this.getHighestPlayerLevel();
    for (let i = 0; i < zones.length; i++) {
      if (this.spawnedZones.has(i)) continue;
      const z = zones[i];
      let touched = false;
      for (const vp of this.viewports.values()) {
        if (
          vp.x < z.x + z.width &&
          vp.x + vp.w > z.x &&
          vp.y < z.y + z.height &&
          vp.y + vp.h > z.y
        ) {
          touched = true;
          break;
        }
      }
      if (touched) {
        // Spawn until the map's target enemy count is reached. Each
        // zone spawns `partySize` enemies (1 per player) so a 4-player
        // party faces 4x the density of a solo run, still capped by
        // the room-wide target from getTargetEnemyCount().
        const target = this.getTargetEnemyCount();
        const spawnsPerZone = Math.max(1, this.runPartySize);
        for (let s = 0; s < spawnsPerZone; s++) {
          const alive = this.state.enemies.size;
          if (alive >= target) break;
          const spawnId = this.enemySystem.spawn(
            this.pickEnemyType(),
            // Spread the batch slightly so they don't stack: offset
            // each extra enemy within the zone's bounds.
            z.x + z.width / 2 + (s % 2 === 0 ? -s * 24 : s * 24),
            z.y + z.height / 2 + (s % 2 === 0 ? s * 16 : -s * 16),
            enemyLevel,
          );
          const spawnedEnemy = this.state.enemies.get(spawnId);
          if (spawnedEnemy) {
            applyEnemyModifiers(spawnedEnemy, this.activeModifiers);
            applyActiveMapStatsToEnemy(
              spawnedEnemy,
              readAppliedStats(this.state.activeMapStats.values()),
            );
            // Loot roll: may attach a modded card to this enemy.
            this.refreshLootContext();
            const card = this.lootSystem.rollEnemyCard(spawnedEnemy);
            if (card) spawnedEnemy.card = card;
          }
        }
        this.spawnedZones.add(i);
      }
    }
  }

  /**
   * Award XP for a killed enemy.
   * The killer (last attacker) gets 100% XP.
   * Other players who damaged the enemy get 50% XP each.
   * Falls back to equal split if no damage was tracked.
   */
  private awardKillXp(enemy: Enemy): void {
    const trackers = enemy.damageTrackers;
    if (trackers.size === 0) {
      // No damage tracked — split among all alive players.
      let alive = 0;
      this.state.players.forEach((p) => {
        if (!p.isDead) alive++;
      });
      if (alive > 0) {
        const share = Math.floor(enemy.xpReward / alive);
        this.state.players.forEach((p) => {
          if (!p.isDead) p.addXp(share);
        });
      }
      return;
    }

    // Find the killer: the player who dealt the most damage.
    let killerId: string | null = null;
    let maxDmg = 0;
    for (const [pid, dmg] of trackers) {
      if (dmg > maxDmg) {
        maxDmg = dmg;
        killerId = pid;
      }
    }

    // Killer gets 100%.
    if (killerId) {
      const killer = this.state.players.get(killerId);
      if (killer && !killer.isDead) {
        killer.addXp(enemy.xpReward);
        // Charge heal skill by kill count (L1-4 mode)
        killer.addHealKill();
      }
    }

    // Other damagers get 50%.
    const halfXp = Math.floor(enemy.xpReward * 0.5);
    for (const pid of trackers.keys()) {
      if (pid === killerId) continue;
      const teammate = this.state.players.get(pid);
      if (teammate && !teammate.isDead) {
        teammate.addXp(halfXp);
      }
    }
  }

  /** Remove dead enemies from state. */
  private cleanupDeadEnemies(): void {
    const dead: string[] = [];
    this.state.enemies.forEach((enemy, id) => {
      if (enemy.isDead) dead.push(id);
    });
    for (const id of dead) {
      const enemy = this.state.enemies.get(id);
      if (enemy) {
        // Award XP: killer gets 100%, other damagers get 50%.
        this.awardKillXp(enemy);
        // Loot drop: uncommon+ cards drop to the ground.
        this.lootSystem.dropOnDeath(enemy, () => this.nextGroundCardId());
        // Kill bookkeeping: elite threshold + exit unlock.
        this.onEnemyKilled(enemy);
      }
      // Despawn any slams/projectiles owned by this enemy.
      if (this.enemySystem) this.enemySystem.cleanupOnEnemyDeath(id);
      this.state.enemies.delete(id);
    }
  }

  /**
   * Kill bookkeeping: unlocks the map exit when the ELITE enemy dies,
   * and triggers the one-time elite spawn once ~50% of the map's
   * enemies have been killed.
   */
  private onEnemyKilled(enemy: Enemy): void {
    if (enemy.isElite) {
      this.state.eliteAlive = false;
      this.state.exitUnlocked = true;
      console.log("[ELITE] Elite defeated - map exit unlocked!");
      return;
    }
    this.enemiesKilled++;
    this.maybeSpawnElite();
  }

  /**
   * Spawn the map's single ELITE enemy once players have killed ~50% of
   * the map's target enemy count. The elite is a random type drawn from
   * the normal enemy pool, ELITE.LEVEL_BONUS levels above the highest
   * player, with +20% HP/shield and double XP on top of that. It spawns
   * at the center of a random enemy spawn zone.
   */
  private maybeSpawnElite(): void {
    if (this.eliteSpawned) return;
    const zones = MAPS[this.mapId].data.enemySpawnZones;
    if (zones.length === 0) return;
    // Threshold is based on the map's ACTUAL spawnable pool (one enemy
    // per zone, zones never respawn) - NOT getTargetEnemyCount(), which
    // can exceed the pool on maps with few zones (e.g. map2's 15 zones
    // vs a 20+ target), making the elite unreachable and locking the exit.
    const threshold = Math.ceil(
      zones.length * GAME_CONFIG.ELITE.SPAWN_KILL_THRESHOLD,
    );
    if (this.enemiesKilled < threshold) {
      return;
    }
    const zone = zones[Math.floor(Math.random() * zones.length)];
    const eliteLevel =
      this.getHighestPlayerLevel() + GAME_CONFIG.ELITE.LEVEL_BONUS;
    const spawnId = this.enemySystem.spawn(
      this.pickEnemyType(),
      zone.x + zone.width / 2,
      zone.y + zone.height / 2,
      eliteLevel,
    );
    const elite = this.state.enemies.get(spawnId);
    if (!elite) return;
    // Elites always carry a card (no spawn-with-card gate).
    this.refreshLootContext();
    const eliteCard = this.lootSystem.rollEnemyCardForced(elite);
    if (eliteCard) elite.card = eliteCard;
    elite.makeElite(
      GAME_CONFIG.ELITE.HP_SHIELD_BONUS,
      GAME_CONFIG.ELITE.XP_MULTIPLIER,
      GAME_CONFIG.ELITE.SIZE_MULTIPLIER,
    );
    applyEnemyModifiers(elite, this.activeModifiers);
    applyActiveMapStatsToEnemy(
      elite,
      readAppliedStats(this.state.activeMapStats.values()),
    );
    this.eliteSpawned = true;
    this.state.eliteAlive = true;
    console.log(
      `[ELITE] Spawned elite ${elite.typeId} (level ${elite.level}) at ` +
        `(${Math.round(elite.x)}, ${Math.round(elite.y)})`,
    );
  }

  // ============================================================
  // MESSAGE HANDLERS
  // ============================================================

  messages = {
    // Movement input
    0: (client: Client, input: InputData) => {
      const player = this.state.players.get(client.sessionId);
      if (player) player.inputQueue.push(input);
    },

    // Cast the card in a HUD slot. { slot: 0..4, angle }
    1: (client: Client, msg: { slot: number; angle: number }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.isDead) return;
      const slot = msg?.slot | 0;
      if (slot < 0 || slot >= NUM_CARD_SLOTS) return;
      // The slot IS the skill trigger: cast its card with ITS mods.
      const card = player.slotCard(slot);
      if (!card) return; // empty slot — nothing to cast
      const skill = card.skill as SkillId;
      // THIS card's own level — duplicates never share cast power.
      const level = Math.max(1, Math.floor(card.level || 1));
      if (!player.isSlotReady(slot)) return; // this SLOT is on cooldown

      if (skill === "heal") {
        const healed = this.healSystem.castPlayerHeal(player, slot);
        if (healed) {
          const lvl6 = level >= SKILL_DEFS.heal.aoeUnlockLevel;
          if (lvl6) {
            player.startSlotCooldown(slot, healCooldown(level));
          } else {
            player.consumeHealCharge(slot);
          }
        }
        return;
      }

      if (skill === "bolter") {
        const fired = this.projectileSystem.castBolter(
          client.sessionId,
          "player",
          player.x,
          player.y,
          msg.angle,
          player.attack,
          level,
          player.damageMultiplier * player.slotDamageBonus(slot),
          skillCritRate("bolter", level, player.critRate) +
            player.slotCritRateBonus(slot),
          player.critDamage + player.slotCritDamageBonus(slot),
        );
        if (fired) {
          player.startSlotCooldown(slot, SKILL_DEFS.bolter.cooldown);
        }
      } else if (skill === "claw") {
        this.clawSystem.castClaw(
          client.sessionId,
          "player",
          player.x,
          player.y,
          msg.angle,
          player.attack,
          level,
          player.damageMultiplier * player.slotDamageBonus(slot),
          10,
          skillCritRate("claw", level, player.critRate) +
            player.slotCritRateBonus(slot),
          player.critDamage + player.slotCritDamageBonus(slot),
        );
        player.startSlotCooldown(slot, SKILL_DEFS.claw.cooldown);
      } else if (skill === "slam") {
        this.slamSystem.castSlam(
          client.sessionId,
          "player",
          player.x,
          player.y,
          msg.angle,
          level,
          player.attack,
          player.damageMultiplier * player.slotDamageBonus(slot),
          skillCritRate("slam", level, player.critRate) +
            player.slotCritRateBonus(slot),
          player.critDamage + player.slotCritDamageBonus(slot),
          player.slotRadiusMult(slot),
        );
        player.startSlotCooldown(slot, SKILL_DEFS.slam.cooldown);
      } else if (skill === "pulse") {
        this.pulseSystem.castPlayerPulse(
          player,
          client.sessionId,
          level,
          skillCritRate("pulse", level, player.critRate) +
            player.slotCritRateBonus(slot),
          player.critDamage + player.slotCritDamageBonus(slot),
          player.slotRadiusMult(slot),
          player.slotDamageBonus(slot) * player.slotUniqueDamageMult(slot),
        );
        player.startSlotCooldown(slot, pulseCooldown(level));
      } else if (skill === "shock") {
        this.shockSystem.castPlayerShock(
          player,
          client.sessionId,
          level,
          skillCritRate("shock", level, player.critRate) +
            player.slotCritRateBonus(slot),
          player.critDamage + player.slotCritDamageBonus(slot),
          msg.angle,
        );
        player.startSlotCooldown(slot, SKILL_DEFS.shock.baseCooldown);
      } else if (skill === "dash") {
        this.dashSystem.castPlayerDash(
          player,
          client.sessionId,
          level,
          msg.angle,
          skillCritRate("dash", level, player.critRate) +
            player.slotCritRateBonus(slot),
          player.critDamage + player.slotCritDamageBonus(slot),
        );
        player.startSlotCooldown(slot, dashCooldown(level));
      } else if (skill === "vortex") {
        this.vortexSystem.castVortex(
          client.sessionId,
          "player",
          player.x,
          player.y,
          msg.angle,
          level,
          player.attack,
          player.damageMultiplier * player.slotDamageBonus(slot),
          skillCritRate("vortex", level, player.critRate) +
            player.slotCritRateBonus(slot),
          player.critDamage + player.slotCritDamageBonus(slot),
          player.slotRadiusMult(slot),
          player.slotDamageBonus(slot) * player.slotUniqueDamageMult(slot),
        );
        player.startSlotCooldown(slot, SKILL_DEFS.vortex.cooldown);
      } else if (skill === "shield") {
        // Shield has no active cast — it's a passive equipped card.
        return;
      }
    },

    // Upgrade a skill (debug "0" key). { skill }
    2: (client: Client, msg: { skill: SkillId }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const skill = msg.skill;
      const cur = player.getSkillLevel(skill);
      if (cur <= 0) {
        // Not owned — can only be gained by equipping a card now.
        return;
      } else if (cur < MAX_SKILL_LEVEL) {
        player.upgradeSkill(skill);
      }
    },

    // Viewport rect { x, y, w, h } — the client's camera world view.
    3: (
      client: Client,
      msg: { x: number; y: number; w: number; h: number },
    ) => {
      this.viewports.set(client.sessionId, msg);
    },

    // Respawn request (player pressed Respawn button).
    4: (client: Client, _msg: any) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      // In the lobby era: "respawn" means "send me back to the lobby".
      // The server already auto-teleports a dead player to the lobby in
      // fixedTick(), so this handler is mostly defensive - it lets the
      // client force a teleport if it gets stuck on the death screen
      // for any reason. It works whether the player is currently on a
      // gameplay map (dead or alive - no-op for alive) or already in
      // the lobby (no-op).
      if (player.currentMapId === "lobby") return;
      this.sendPlayerToLobby(player);
      // The run may now be over (this was the last player on the map).
      this.endRunIfNeeded();
    },

    // (5 was "map transition XP" — transitions are now fully
    // server-authoritative; see checkMapExit(). Number reserved.)

    // ---- Spend skill point on a stat upgrade ----
    6: (client: Client, msg: { stat: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.skillPoints <= 0) return;
      const stat = msg.stat;
      if (stat === "health") {
        player.maxHealth += 500;
        player.currentHealth += 500;
      } else if (stat === "attack") {
        player.attack += 20;
      } else if (stat === "defence") {
        player.defence = Math.min(0.95, player.defence + 0.02);
      } else if (stat === "critRate") {
        player.critRate += 0.02;
      } else if (stat === "critDamage") {
        player.critDamage += 0.2;
      } else if (stat === "moveSpeed") {
        player.speedMultiplier += 0.05;
        player.recalcDerivedStats();
      } else if (stat === "shield") {
        // Upgrades shield CARD/SLOT level (faster recovery), NOT shield amount.
        // Shield amount grows automatically with player level.
        // Don't spend a skill point if already at max level (10).
        if (player.shieldCardLevel >= 10) return;
        player.upgradeShieldSlot();
      } else {
        return;
      }
      player.skillPoints -= 1;
      player.recalcDerivedStats();
    },

    // ---- Spend skill point on ONE card upgrade ----
    // msg: { slot } preferred (the CARD is upgraded, not the skill —
    // duplicates in other slots keep their own level). Legacy { skill }
    // still works: it upgrades the FIRST slot holding that skill.
    7: (client: Client, msg: { slot?: number; skill?: SkillId }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.skillPoints <= 0) return;
      let slot = typeof msg?.slot === "number" ? msg.slot | 0 : -1;
      if (slot < 0 || slot >= NUM_CARD_SLOTS || !player.hasSlotCard(slot)) {
        // Legacy fallback: first slot with the named skill.
        const skill = msg?.skill as SkillId | undefined;
        if (!skill) return;
        slot = player.firstSlotWithSkill(skill);
        if (slot < 0) return;
      }
      const card = player.slotCard(slot);
      if (!card || card.level >= MAX_SKILL_LEVEL) return;
      if (player.upgradeSlotCard(slot)) {
        player.skillPoints -= 1;
      }
    },

    // ---- Test: grant a skill point (debug key 9) ----
    8: (client: Client, _msg: any) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      player.skillPoints += 1;
      console.log(
        `Player ${client.sessionId} granted test skill point (total: ${player.skillPoints})`,
      );
    },

    // ---- Debug: force a level-up (press 0) ----
    9: (client: Client, _msg: any) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      player.addXp(player.xpToLevelUp);
      console.log(
        `Player ${client.sessionId} forced level-up (now level ${player.level})`,
      );
    },

    // ---- Batch upgrade from the C tab (SAVE button) ----
    // Applies ALL of a player's pending point allocations in one shot,
    // after the single confirmation popup. Caps (defence 95%, shield
    // card L10, card L10) are respected on the server.
    // msg: {
    //   stats:    { [statId]: count, ... }   // health/attack/defence/critRate/critDamage/moveSpeed
    //   shieldLevels: number                  // shield card slot upgrades
    //   cards:    { slot: number, levels: number }[]   // per HUD slot
    // }
    21: (
      client: Client,
      msg: {
        stats?: Record<string, number>;
        shieldLevels?: number;
        cards?: { slot: number; levels: number }[];
      },
    ) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      // ---- Count requested points ----
      let requested = 0;
      const stats = msg?.stats ?? {};
      for (const v of Object.values(stats)) {
        if (typeof v === "number" && v > 0) requested += v;
      }
      const shieldReq = Math.max(0, Math.floor(msg?.shieldLevels ?? 0));
      requested += shieldReq;
      const cards = Array.isArray(msg?.cards) ? msg.cards : [];
      for (const c of cards) {
        if (c && typeof c.levels === "number" && c.levels > 0)
          requested += c.levels;
      }
      // Not enough skill points -> reject the whole batch.
      if (requested <= 0) return;
      if (requested > player.skillPoints) return;

      // ---- Apply stat upgrades ----
      for (const [stat, raw] of Object.entries(stats)) {
        const count = Math.max(0, Math.floor(raw ?? 0));
        for (let i = 0; i < count; i++) {
          if (stat === "health") {
            player.maxHealth += 500;
            player.currentHealth += 500;
          } else if (stat === "attack") {
            player.attack += 20;
          } else if (stat === "defence") {
            player.defence = Math.min(0.95, player.defence + 0.02);
          } else if (stat === "critRate") {
            player.critRate += 0.02;
          } else if (stat === "critDamage") {
            player.critDamage += 0.2;
          } else if (stat === "moveSpeed") {
            player.speedMultiplier += 0.05;
          }
          // Unknown stats are silently ignored (already paid the SP).
        }
      }

      // ---- Apply shield slot upgrades (cap at MAX_SHIELD_CARD_LEVEL = 10) ----
      for (let i = 0; i < shieldReq; i++) {
        if (player.shieldCardLevel >= Player.MAX_SHIELD_CARD_LEVEL) break;
        player.upgradeShieldSlot();
      }

      // ---- Apply per-slot card upgrades (each card caps at level 10) ----
      for (const c of cards) {
        const slot = (c?.slot ?? -1) | 0;
        const levels = Math.max(0, Math.floor(c?.levels ?? 0));
        if (slot < 0 || slot >= NUM_CARD_SLOTS || levels <= 0) continue;
        for (let i = 0; i < levels; i++) {
          if (!player.upgradeSlotCard(slot)) break; // already at card L10
        }
      }

      // ---- Bill the skill points ----
      player.skillPoints -= requested;
      player.recalcDerivedStats();
      console.log(
        `[UPGRADE] ${client.sessionId} applied batch (${requested} SP spent) ` +
          `stats=${JSON.stringify(stats)} shield=${shieldReq} cards=${JSON.stringify(cards)}`,
      );
    },

    // ---- Drop the card in a HUD slot to the ground ----
    // msg: { slot: number }
    10: (client: Client, msg: { slot: number }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.isDead) return;
      const slot = msg?.slot | 0;
      if (slot < 0 || slot >= NUM_CARD_SLOTS) return;
      // Empty slot: nothing to drop, no-op (fixes the "empty card drop" bug).
      if (!player.hasSlotCard(slot)) return;
      const card = player.clearSlotCard(slot);
      if (!card) return;
      this.dropCardToGround(player, card);
      console.log(
        `[GROUND] ${client.sessionId} dropped slot ${slot} (${card.skill} ` +
          `L${card.level}) at (${Math.round(player.x)}, ${Math.round(player.y)})`,
      );
    },

    // ---- Pick up a ground card into a HUD slot ----
    // msg: { cardId: string, slot: number }
    // The picked card lands EXACTLY in `slot` — no shifting. The
    // previous occupant of that slot (if any) drops to the ground at the
    // player's feet. Reordering/shifting is a separate drag-only action
    // (message 13), never a side effect of equipping from the ground.
    11: (client: Client, msg: { cardId: string; slot: number }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.isDead) return;
      const gc = this.state.groundCards.get(msg?.cardId ?? "");
      if (!gc) return;
      if (Date.now() < gc.pickupLockUntil) return;
      const slot = msg?.slot | 0;
      if (slot < 0 || slot >= NUM_CARD_SLOTS) return;
      // Must be close enough to pick up (2 tiles ~ 96px).
      const dx = gc.x - player.x;
      const dy = gc.y - player.y;
      if (dx * dx + dy * dy > 96 * 96) return;
      const card = gc.card;
      if (!card || !card.skill) return;
      // Equip into the exact slot; the replaced card (if any) drops.
      const old = player.setSlotCard(slot, card);
      if (old) this.dropCardToGround(player, old);
      // Remove from the ground.
      this.state.groundCards.delete(msg.cardId);
      console.log(
        `[GROUND] ${client.sessionId} picked up ${card.skill} L${card.level} ` +
          `into slot ${slot}` +
          (old ? ` (dropped ${old.skill} L${old.level})` : ""),
      );
    },

    // ---- Move (re-drop) a grabbed ground card to a new map position ----
    // msg: { cardId: string, x: number, y: number }
    12: (client: Client, msg: { cardId: string; x: number; y: number }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.isDead) return;
      const card = this.state.groundCards.get(msg?.cardId ?? "");
      if (!card) return;
      if (!msg || typeof msg.x !== "number" || typeof msg.y !== "number")
        return;
      // Reach: 3 tiles (~160px) from the player.
      const dx = msg.x - player.x;
      const dy = msg.y - player.y;
      if (dx * dx + dy * dy > 160 * 160) return;
      // Clamp to map bounds so the card never leaves the map.
      const map = MAPS[this.mapId].data;
      card.x = Math.max(16, Math.min(map.widthPx - 16, msg.x));
      card.y = Math.max(16, Math.min(map.heightPx - 16, msg.y));
      card.pickupLockUntil = Date.now() + 500; // re-arm pickup grace
    },

    // ---- Reorder the card in one HUD slot to another slot ----
    // msg: { from: number, to: number }
    // The dragged card lands in 'to'; the cards between shift by one to
    // fill the freed slot (no swap: untouched cards keep their order).
    13: (client: Client, msg: { from: number; to: number }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.isDead) return;
      const from = msg?.from | 0;
      const to = msg?.to | 0;
      if (from === to) return;
      player.moveSlotCard(from, to);
    },
    // ---- Store the HUD card of slot X into inventory slot Y ----
    // msg: { slot: number, inv: number }
    14: (client: Client, msg: { slot: number; inv: number }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.isDead) return;
      const slot = msg?.slot | 0;
      const inv = msg?.inv | 0;
      if (slot < 0 || slot >= NUM_CARD_SLOTS) return;
      if (inv < 0 || inv >= NUM_INVENTORY_SLOTS) return;
      const card = player.slotCard(slot);
      if (!card) return;
      // Target inventory slot occupied: refuse (no silent card loss).
      if (player.hasInventoryCard(inv)) return;
      player.setInventoryCard(inv, player.clearSlotCard(slot)!);
    },

    // ---- Take a card from inventory slot X into HUD slot Y ----
    // msg: { inv: number, slot: number }
    15: (client: Client, msg: { inv: number; slot: number }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.isDead) return;
      const inv = msg?.inv | 0;
      const slot = msg?.slot | 0;
      if (inv < 0 || inv >= NUM_INVENTORY_SLOTS) return;
      if (slot < 0 || slot >= NUM_CARD_SLOTS) return;
      const card = player.inventoryCard(inv);
      if (!card) return;
      // Equip into that HUD slot; the displaced HUD card (if any)
      // lands in the freed inventory slot - no card is ever lost.
      const displaced = player.setSlotCard(slot, card);
      player.clearInventoryCard(inv);
      if (displaced) player.setInventoryCard(inv, displaced);
      console.log(
        `[INVENTORY] ${client.sessionId} equipped ${card.skill} L${card.level} from inv ${inv} into slot ${slot}`,
      );
    },

    // ---- Drop an inventory card to the ground ----
    // msg: { inv: number }
    16: (client: Client, msg: { inv: number }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.isDead) return;
      const inv = msg?.inv | 0;
      if (inv < 0 || inv >= NUM_INVENTORY_SLOTS) return;
      const card = player.clearInventoryCard(inv);
      if (!card) return;
      this.dropCardToGround(player, card);
      console.log(
        `[INVENTORY] ${client.sessionId} dropped ${card.skill} L${card.level} from inv ${inv}`,
      );
    },

    // ---- Pick a ground card up into the inventory ----
    // msg: { cardId: string, inv: number }
    17: (client: Client, msg: { cardId: string; inv: number }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.isDead) return;
      const gc = this.state.groundCards.get(msg?.cardId ?? "");
      if (!gc) return;
      if (Date.now() < gc.pickupLockUntil) return;
      const inv = msg?.inv | 0;
      if (inv < 0 || inv >= NUM_INVENTORY_SLOTS) return;
      // Same 96px reach rule as HUD pickup (msg 11).
      const dx = gc.x - player.x;
      const dy = gc.y - player.y;
      if (dx * dx + dy * dy > 96 * 96) return;
      const card = gc.card;
      if (!card || !card.skill) return;
      // Pickup should NEVER silently fail — if the target inventory slot
      // is occupied, drop the old card to the ground and equip the new
      // one in its place (swap semantics). Same rule as HUD pickup (11).
      if (player.hasInventoryCard(inv)) {
        const old = player.clearInventoryCard(inv);
        if (old) this.dropCardToGround(player, old);
      }
      player.setInventoryCard(inv, card);
      this.state.groundCards.delete(msg.cardId);
      console.log(
        `[INVENTORY] ${client.sessionId} stashed ${card.skill} L${card.level} into inv ${inv}`,
      );
    },

    // ---- Reorder inside the inventory ----
    // msg: { from: number, to: number } (insert-shift into empty,
    // swap when both slots hold cards)
    18: (client: Client, msg: { from: number; to: number }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.isDead) return;
      const from = msg?.from | 0;
      const to = msg?.to | 0;
      if (from === to) return;
      if (from < 0 || to < 0) return;
      if (from >= NUM_INVENTORY_SLOTS || to >= NUM_INVENTORY_SLOTS) return;
      if (player.hasInventoryCard(to) && player.hasInventoryCard(from)) {
        player.swapInventoryCards(from, to);
      } else {
        player.moveInventoryCard(from, to);
      }
    },

    // ---- Swap HUD slot card <-> inventory slot card ----
    // msg: { slot: number, inv: number }
    19: (client: Client, msg: { slot: number; inv: number }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.isDead) return;
      const slot = msg?.slot | 0;
      const inv = msg?.inv | 0;
      if (slot < 0 || slot >= NUM_CARD_SLOTS) return;
      if (inv < 0 || inv >= NUM_INVENTORY_SLOTS) return;
      const invCard = player.inventoryCard(inv);
      const hudCard = player.slotCard(slot);
      // Nothing to swap: plain take-out / put-in handled by 14/15.
      if (!invCard && !hudCard) return;
      if (invCard && hudCard) {
        player.setInventoryCard(inv, player.setSlotCard(slot, invCard)!);
      } else if (invCard && !hudCard) {
        player.setSlotCard(slot, player.clearInventoryCard(inv)!);
      } else if (!invCard && hudCard) {
        player.setInventoryCard(inv, player.clearSlotCard(slot)!);
      }
    },

    // ---- Pick one of the map-stat offers (sent at the exit picker) ----
    // msg: { index: number } (0..2 into the per-player offer list)
    20: (client: Client, msg: { index: number }) => {
      this.pickMapStatAndTransition(client, msg?.index | 0);
    },

    // ---- Lobby: player pressed "Play" (clicked the Play polygon) ----
    // msg: {}  (no payload). Starts a NEW RUN for the whole lobby group:
    // every player currently in the lobby is teleported to the (fresh)
    // gameplay map together.
    //
    // Three scenarios this handler distinguishes:
    //
    //   (a) GROUP press — 2+ lobby players. The press waits until the
    //       current run ends (so the new group doesn't split the
    //       existing run-in-progress).
    //
    //   (b) LATE JOIN — exactly 1 lobby player, BUT a run is currently
    //       active with other players on the map. The lobby player is
    //       teleported straight onto the active map so they can join
    //       the existing group (this is the bug-fix: previously the
    //       late joiner was spun off into a separate solo room and
    //       could never see/touch the group's map-stat picker).
    //
    //   (c) TRULY SOLO press — exactly 1 lobby player AND no one else
    //       is on the map (run ended or freshly created room). Spin
    //       up a brand new GameRoom via matchMaker so the solo player
    //       gets their own clean run with no cross-talk.
    22: (client: Client, _msg: any) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      if (player.currentMapId !== "lobby") return;
      if (this.state.runInProgress) {
        // Count how many players are still in THIS room's lobby AND on
        // the active gameplay map. The lobby count alone is misleading
        // because the FIRST player to press Play already left the
        // lobby - they are now on the map, mid-run, and a late-joining
        // second player should join THEM, not spin off into a solo room.
        let lobbyCount = 0;
        let onMapCount = 0;
        this.state.players.forEach((p) => {
          if (p.currentMapId === "lobby") lobbyCount++;
          else if (p.currentMapId === this.mapId && !p.isDead) onMapCount++;
        });
        if (lobbyCount >= 2) {
          // (a) Group press while a run is active: must wait for it to
          // finish. Tell the client so its status text can show this.
          client.send("playRejected", { reason: "run_in_progress" });
          return;
        }
        if (onMapCount > 0) {
          // (b) Late join: drop the player straight onto the active
          // map so they share the same exit, picker, and map-stat
          // offers as the rest of the group. No solo redirect, no
          // duplicate room.
          this.joinExistingRun(player);
          return;
        }
        // (c) Solo press while a run is in progress but no one is on
        // the map (e.g. everyone died and runInProgress hasn't been
        // cleared yet). Spin up a fresh GameRoom for this player.
        void this.spawnSoloRunFor(client);
        return;
      }
      this.startRun();
    },
  };

  // ============================================================
  // CONNECTION LIFECYCLE
  // ============================================================

  onJoin(client: Client, options?: any) {
    console.log("Player joined GameRoom:", client.sessionId);

    const player = new Player();
    // Bind the owning client's session id so server-side code can do
    // this.clients.get(player.sessionId) lookups (per-player messages
    // like the map-stat picker offer). See Player.sessionId docs.
    player.sessionId = client.sessionId;
    // Fresh player: starter cards fill all 5 slots. (There is no longer
    // any client-supplied playerState to restore — progression lives in
    // the room and survives map transitions server-side.)
    player.initBaseStats();
    for (let i = 0; i < NUM_CARD_SLOTS && i < STARTER_CARDS.length; i++) {
      const sc = STARTER_CARDS[i];
      const card = new CardInstance();
      card.skill = sc.skill;
      card.level = sc.level;
      card.rarity = "common";
      player.equippedSlots[i] = card;
    }
    player.recomputeSkillLevels();
    player.recomputeShield();
    applyPlayerModifiers(player, this.activeModifiers);
    // Apply the room's ACTIVE map stats (picked at map exits) so
    // mid-session joiners carry the same bonuses as everyone else.
    applyActiveMapStatsToPlayer(
      player,
      readAppliedStats(this.state.activeMapStats.values()),
    );
    // ---- Assign a sticky display name ----
    // Re-use the cached name if the same client reconnects (same
    // browser, same localStorage id) AND it's not currently claimed
    // by someone else in this room. Otherwise pick a unique one
    // from the pool and update the cache so subsequent joins stick.
    const clientId =
      (options && typeof options[CLIENT_PLAYER_ID_KEY] === "string"
        ? (options[CLIENT_PLAYER_ID_KEY] as string)
        : client.sessionId) || client.sessionId;
    const cached = this.nameByClientId.get(clientId);
    let name: string;
    if (cached && !this.namesInUse.has(cached)) {
      // Cached but free (e.g. previous connection dropped) - reuse.
      name = cached;
    } else {
      // No cache, or another live connection already owns it -> draw
      // fresh and rebind this client to the new name (sticky from now on).
      name = pickUniqueName(this.namesInUse, clientId);
      this.nameByClientId.set(clientId, name);
    }
    this.namesInUse.add(name);
    player.displayName = name;
    console.log(
      `[NAME] ${client.sessionId} (${clientId.slice(0, 8)}...) -> "${name}"`,
    );
    // ---- LOBBY SPAWN ----
    // Every player joins in the lobby (safe zone). They have to click
    // the "Play" polygon to join the room's main gameplay map.
    player.currentMapId = "lobby";
    player.x = LOBBY_SPAWN_POINT.x;
    player.y = LOBBY_SPAWN_POINT.y;

    this.state.players.set(client.sessionId, player);

    // ---- LEADER TRACKING ----
    // The first player to join a code-lobby room is the leader:
    //   - They are the gatekeeper (new joiners only allowed when
    //     leader is in the lobby state).
    //   - If they disconnect, the entire room is destroyed - the
    //     lobby identity dies with the leader.
    // For private / solo rooms there is no leader - the room is
    // throwaway and never enters the registry.
    if (this.lobbyCode && this.leaderId === "") {
      this.leaderId = client.sessionId;
      this.leaderInLobby = true;
      const registered = registerLobby(
        this.lobbyCode,
        this.roomId,
        this.leaderId,
      );
      if (!registered) {
        console.warn(
          "[ROOM] Code " + this.lobbyCode + " already taken in registry; room created but not joinable",
        );
      } else {
        console.log(
          "[ROOM] Code-lobby " + this.lobbyCode + " registered, leader=" + this.leaderId,
        );
      }
    }

    // ---- SOLO RUN: auto-start the run on first join ----
    // The room was created via matchMaker with `soloRun: true`. The
    // player who joined is the dead-loner; take them straight to map1
    // (no second Play click needed in the new room). We use a small
    // timeout so the client's joinById handshake completes + the
    // initial state is in their hands before we mutate the player.
    if (this.isSoloRun) {
      console.log(
        `[RUN] Solo-run room auto-starting run for ${client.sessionId}`,
      );
      setTimeout(() => {
        // Guard: re-check the flag in case the room got disposed.
        if (this.isSoloRun && this.state.players.has(client.sessionId)) {
          this.startRun();
        }
      }, 100);
    }
  }

  /**
   * TELEPORT a player to the lobby with a fresh loadout.
   * Used by both the auto-death flow (server-authoritative) and the
   * "respawn" handler (message 4, defensive). Player must currently
   * be on a gameplay map; lobby players are a no-op.
   */
  private sendPlayerToLobby(player: Player): void {
    if (player.currentMapId === "lobby") return;
    // Halve XP, then wipe loadout (initBaseStats resets XP to 0 anyway,
    // but we call die() so the existing XP-loss behaviour stays).
    player.die();
    player.freshLoadout();
    // Re-apply room-level bonuses so the player keeps map-stat
    // modifiers + active map modifiers when they re-enter the gameplay
    // map (freshLoadout zeroes damageMultiplier etc.).
    applyPlayerModifiers(player, this.activeModifiers);
    applyActiveMapStatsToPlayer(
      player,
      readAppliedStats(this.state.activeMapStats.values()),
    );
    // Clean up any pending map-stat offers for this player (they
    // can't pick from a hospital bed). Without this, the per-player
    // picker key would leak and mapStatPickersOpen would drift up.
    if (this.currentMapStatOffers.delete(player.sessionId)) {
      this.mapStatPickersOpen = Math.max(0, this.mapStatPickersOpen - 1);
    }
    player.currentMapId = "lobby";
    player.x = LOBBY_SPAWN_POINT.x;
    player.y = LOBBY_SPAWN_POINT.y;
    // Leader just returned to lobby -> flip registry flag so new
    // joiners can be accepted again.
    if (player.sessionId === this.leaderId && this.lobbyCode) {
      this.leaderInLobby = true;
      setLeaderInLobby(this.roomId, true);
    }
  }

  /**
   * START A RUN: every player currently in the lobby joins the room's
   * gameplay map together. The map is re-initialized (fresh enemies,
   * fresh spawn grace) so the whole group starts clean from map1's
   * spawn. Only lobby players participate; late joiners (connected
   * after the run started) must wait in the lobby until the run ends.
   */
  private startRun(): void {
    // Collect everyone who is in the lobby RIGHT NOW — they are the
    // run's fixed roster. Players still connecting are out of luck.
    const lobbyPlayers: Player[] = [];
    this.state.players.forEach((p) => {
      if (p.currentMapId === "lobby") lobbyPlayers.push(p);
    });
    if (lobbyPlayers.length === 0) return;
    // Leader just left the lobby for a map -> mark them out so
    // the join endpoint rejects new drop-ins mid-run. The leader
    // must lead.
    if (this.lobbyCode) {
      this.leaderInLobby = false;
      setLeaderInLobby(this.roomId, false);
    }

    // Fresh map for the new run: resets per-map state (enemies, zones,
    // exit gate, spawn counters) and re-arms the 5s spawn grace. The
    // room always restarts runs on map1 (DEFAULT_MAP) so mid-run joins
    // can't inherit a half-cleared deeper map.
    this.initMap(DEFAULT_MAP);

    this.state.runInProgress = true;
    // Party size = whoever was in the lobby when the run started.
    // This drives the per-player offer count at the exit (3 * size).
    this.runPartySize = lobbyPlayers.length;
    console.log(
      `[RUN] Started with ${lobbyPlayers.length} player(s) from the lobby`,
    );

    const spawn = this.mapSystem.getSpawnPoint();
    for (const p of lobbyPlayers) {
      // Reset stat-derived fields to a clean base BEFORE re-applying the
      // room's bonuses. Players already carry one application from their
      // lobby entry (onJoin / sendPlayerToLobby) — applying again without
      // resetting would double every map-stat bonus. initBaseStats is
      // safe here: death already zeroed level/XP (freshLoadout) and
      // fresh joiners are at base stats anyway.
      p.initBaseStats();
      // Refill starter cards (lobby state has them already but be
      // explicit in case a future change clears them).
      for (let i = 0; i < NUM_CARD_SLOTS && i < STARTER_CARDS.length; i++) {
        if (!p.hasSlotCard(i)) {
          const sc = STARTER_CARDS[i];
          const card = new CardInstance();
          card.skill = sc.skill;
          card.level = sc.level;
          card.rarity = "common";
          p.equippedSlots[i] = card;
        }
      }
      p.recomputeSkillLevels();
      p.recomputeShield();
      applyPlayerModifiers(p, this.activeModifiers);
      applyActiveMapStatsToPlayer(
        p,
        readAppliedStats(this.state.activeMapStats.values()),
      );
      p.currentMapId = this.mapId;
      p.x = spawn.x;
      p.y = spawn.y;
      p.inputQueue.length = 0;
    }
  }

  /**
   * LATE-JOIN: drop a lobby player straight onto the currently active
   * gameplay map so they share the same exit / picker / map-stat
   * offers as the rest of the group. Used by message 22 when the
   * solo-press branch used to send players off into their own room
   * (the old behaviour stranded them with no way to interact with
   * the group's run).
   *
   * This does NOT call `initMap()` - the map is in flight and stays
   * exactly as it is. It only repositions the joining player at the
   * map's spawn point, applies the room's active bonuses, and flips
   * their `currentMapId` so the GameScene transition fires.
   */
  private joinExistingRun(player: Player): void {
    const spawn = this.mapSystem.getSpawnPoint();
    // Reset stat-derived fields to a clean base BEFORE re-applying
    // bonuses. The player already carried one application from their
    // lobby entry (onJoin) - applying again without resetting would
    // double every map-stat bonus.
    player.initBaseStats();
    // Refill starter cards (lobby state has them already but be
    // explicit in case a future change clears them).
    for (let i = 0; i < NUM_CARD_SLOTS && i < STARTER_CARDS.length; i++) {
      if (!player.hasSlotCard(i)) {
        const sc = STARTER_CARDS[i];
        const card = new CardInstance();
        card.skill = sc.skill;
        card.level = sc.level;
        card.rarity = "common";
        player.equippedSlots[i] = card;
      }
    }
    player.recomputeSkillLevels();
    player.recomputeShield();
    applyPlayerModifiers(player, this.activeModifiers);
    applyActiveMapStatsToPlayer(
      player,
      readAppliedStats(this.state.activeMapStats.values()),
    );
    player.currentMapId = this.mapId;
    player.x = spawn.x;
    player.y = spawn.y;
    player.inputQueue.length = 0;
    // Late joiner counts toward the party size so they get the same
    // scaled offer count as everyone else when they reach the exit.
    this.runPartySize++;
    console.log(
      `[RUN] Late-join: ${player.displayName ?? "(no name)"} dropped onto ` +
        `${this.mapId} at (${Math.round(spawn.x)}, ${Math.round(spawn.y)}) ` +
        `(party size now ${this.runPartySize})`,
    );
  }

  /**
   * SPAWN A NEW ROOM for a solo player who's the only one in the
   * lobby while another run is active. The new room has its OWN
   * GameRoom state (fresh `initMap(DEFAULT_MAP)` on its first
   * `startRun()` call), so the solo player starts a clean run that
   * doesn't disturb the original group's run.
   *
   * Implementation note: Colyseus does NOT await user message
   * handlers, so we kick off the async create and rely on the
   * client to `room.leave()` + `client.joinById(roomId)` once it
   * receives the `playRedirected` message. If the create fails
   * the client falls back to the regular lobby-waiting state.
   */
  private async spawnSoloRunFor(client: Client): Promise<void> {
    try {
      // Mark the new room as a solo-run room so onCreate flips the
      // auto-start flag. The FIRST player to join it (our dead-loner)
      // will be teleported to map1 automatically — they don't have to
      // press Play a second time inside the new room's lobby.
      const cache = await matchMaker.createRoom("game_room", { soloRun: true });
      // Hand the new room id back to the client. It will leave this
      // room and joinById the new one (see client LobbyScene).
      client.send("playRedirected", {
        reason: "solo_run",
        roomId: cache.roomId,
      });
      console.log(
        `[RUN] Solo redirect for ${client.sessionId} -> ${cache.roomId}`,
      );
    } catch (e) {
      console.error("[RUN] Failed to create solo room:", e);
      client.send("playRejected", { reason: "spawn_failed" });
    }
  }

  /**
   * END THE RUN: called when the last player leaves the gameplay map
   * (death -> lobby or disconnect). Resets the room's run flag so the
   * next "Play" press in the lobby can start a fresh group run.
   * Per-map state is NOT reset here — startRun() re-initializes the
   * map when the next run begins.
   */
  private endRunIfNeeded(): void {
    if (!this.state.runInProgress) return;
    let onMap = 0;
    this.state.players.forEach((p) => {
      if (p.currentMapId !== "lobby") onMap++;
    });
    if (onMap === 0) {
      this.state.runInProgress = false;
      // Reset party size so the next run starts fresh (otherwise
      // a 4-player wipe would still scale offers as if 4 were here).
      this.runPartySize = 0;
      console.log("[RUN] Ended (no players left on the gameplay map)");
    }
  }
  onLeave(client: Client, _code: number) {
    console.log("Player left:", client.sessionId);

    // ---- LEADER DISCONNECT -> ROOM DEAD ----
    // If the leader drops, the lobby loses its identity. Anyone
    // still connected gets disconnected (Colyseus sends the
    // standard leave code on dispose) and the registry entry is
    // cleared by onDispose. We unregister synchronously here so a
    // concurrent join attempt for this code gets a 404 instead of
    // being routed to a room that is about to be torn down.
    if (this.lobbyCode && client.sessionId === this.leaderId) {
      console.log(
        "[ROOM] Leader of code-lobby " + this.lobbyCode + " left - destroying room",
      );
      unregisterLobby(this.roomId);
      try {
        this.disconnect();
      } catch (e) {
        console.warn("[ROOM] disconnect() after leader-leave failed:", e);
      }
      return;
    }
    // Free the display name so a future join from this same browser
    // (same localStorage id) re-binds to it instead of drawing fresh.
    const player = this.state.players.get(client.sessionId);
    if (player && player.displayName) {
      this.namesInUse.delete(player.displayName);
    }
    // Clean up any pending per-player map-stat offers so the
    // counters stay accurate after a disconnect mid-pick.
    if (this.currentMapStatOffers.delete(client.sessionId)) {
      this.mapStatPickersOpen = Math.max(0, this.mapStatPickersOpen - 1);
    }
    this.state.players.delete(client.sessionId);
    this.viewports.delete(client.sessionId);
    // A disconnect can empty the gameplay map -> run over.
    this.endRunIfNeeded();
  }

  onDispose() {
    console.log("GameRoom disposed:", this.roomId);
    // Clear the lobby code registry too (the leader-leave path
    // unregisters synchronously above; this is the catch-all for
    // every other dispose route). Idempotent.
    if (this.lobbyCode) {
      unregisterLobby(this.roomId);
      console.log("[ROOM] Code-lobby " + this.lobbyCode + " disposed");
    }
  }
}
