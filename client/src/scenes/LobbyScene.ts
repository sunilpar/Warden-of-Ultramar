/**
 * Lobby Scene
 * ===========
 * Safe-zone scene. The player spawns here on join, roams freely with
 * WASD, and clicks the "Play" polygon to enter the room's gameplay map.
 *
 * Responsibilities:
 *   - Load lobby assets (tilesheet, player sprite sheet, animations).
 *   - Connect to the Colyseus room on create().
 *   - Render the lobby baselayer + the Play polygon as a clickable
 *     button.
 *   - Show player sprites for everyone in the lobby.
 *   - Stream WASD input to the server each fixed tick.
 *   - Listen for the local player's `currentMapId` to flip to
 *     `state.mapId` -> switch to GameScene.
 *
 * The room connection is shared with GameScene: when this scene hands
 * off to GameScene, it passes the room + client in the scene data so
 * GameScene doesn't open a duplicate connection. When GameScene later
 * detects the local player has been moved back to the lobby, it does
 * the reverse and passes the room back.
 *
 * SOLO-REDIRECT: When the local player is the ONLY one in the lobby
 * while the rest of the group is mid-run, pressing Play would normally
 * be rejected ("run in progress"). Instead the server creates a
 * FRESH GameRoom and tells this client to leave the old room and join
 * the new one (message `playRedirected` -> `swapToRoom`). The scene
 * tears down all lobby sprites/HUDs, then re-binds state on the new
 * room's Callbacks.
 */
import Phaser from "phaser";
import { Client } from "@colyseus/sdk";
import { Callbacks } from "@colyseus/schema";
import { BACKEND_URL } from "../backend";
import { LOBBY_MAP_DATA, LOBBY_PLAY_POLYGON } from "../maps/lobbyMapData";
import { resolveTileCollision } from "../maps/layeredMapData";
import { createCharacterAnimations } from "../vfx/animations";
import { bindKeyboard } from "../systems/input";
import { defaultJoinOptions } from "../clientIdentity";
import {
  attachPlayerHud,
  updatePlayerHud,
  destroyPlayerHud,
  type PlayerHud,
} from "../systems/nameLabel";

/** Message type that matches server/src/rooms/GameRoom.ts (lobby -> play). */
const MSG_PLAY = 22;

/** Player collision radius (MUST match GAME_CONFIG.PLAYER.COLLISION_RADIUS
 *  on the server so client prediction matches server authority). */
const PLAYER_COLLISION_RADIUS = 10;

export class LobbyScene extends Phaser.Scene {
  client!: Client;
  /** May be null on first create (SceneSelector-style flow). When
   *  GameScene hands off to us we receive the existing room here. */
  room: any = null;
  /** Phaser sprite for the LOCAL player (created once we own the room). */
  currentPlayer: Phaser.GameObjects.Sprite | null = null;
  /** Local player state (synced via Colyseus Callbacks). */
  currentPlayerState: any = null;
  /** Remote players also in the lobby (sessionId -> sprite). */
  playerEntities: { [sessionId: string]: Phaser.GameObjects.Sprite } = {};
  /** Display-name HUD strip per player sprite (sessionId -> PlayerHud). */
  playerHuds: { [sessionId: string]: PlayerHud } = {};
  /** Clickable Play polygon. */
  playButton!: Phaser.GameObjects.Rectangle;
  /** Status text shown during room connect / errors. */
  statusText!: Phaser.GameObjects.Text;
  /** FPS counter (debug overlay). */
  debugFPS!: Phaser.GameObjects.Text;
  /** True while the room's players are mid-run on the gameplay map.
   *  Play is disabled in that case — nobody can join a map mid-run. */
  private runInProgress = false;

  private wasdKeys!: ReturnType<typeof bindKeyboard>["wasdKeys"];
  private inputPayload = {
    left: false,
    right: false,
    up: false,
    down: false,
    tick: undefined as number | undefined,
  };
  private elapsedTime = 0;
  private fixedTimeStep = 1000 / 60;
  private currentTick = 0;
  private moveSpeed = 120;
  /** Last `currentMapId` we saw for the local player (used to detect
   *  transitions out of the lobby). */
  private lastLocalMapId: string | null = null;

  constructor() {
    super({ key: "lobby", active: true });
  }

  /**
   * Accept an existing room+client from a previous scene (GameScene ->
   * LobbyScene handoff). Called by GameScene right before scene.start().
   * If no data is supplied we connect from scratch in create().
   */
  init(data?: { room?: any; client?: Client }) {
    if (data?.room && data?.client) {
      this.room = data.room;
      this.client = data.client;
    }
  }

  preload() {
    // ============================================================
    // Lobby tilesheet
    // ============================================================
    // 1088 × 736 image: 34 cols × 23 rows of 32px tiles (782 frames).
    // Sized to match the camera viewport (1080 × 720) almost exactly,
    // so the whole lobby fits on screen at default zoom.
    this.load.spritesheet(
      LOBBY_MAP_DATA.tilesetKey,
      "assets/maps/map1/lobby tilesheet fi.png",
      {
        frameWidth: LOBBY_MAP_DATA.tileSize,
        frameHeight: LOBBY_MAP_DATA.tileSize,
      },
    );

    // ============================================================
    // EVERYTHING ELSE - formerly loaded in SceneSelector.preload().
    // We replicate the whole preload here because LobbyScene is now
    // the entry scene. Without these textures the GameScene (and
    // map1/map2 rendering, enemies, skills, HUD, etc.) all fail to
    // draw and the canvas shows the green game background instead.
    // ============================================================

    // ---- Player sprite sheet (shared with GameScene so we look the same) ----
    this.load.spritesheet("player_sheet", "assets/waliking-sheet64.png", {
      frameWidth: 64,
      frameHeight: 64,
    });

    // ---- UI / menu ----
    this.load.image("game_menu", "assets/menu_final.png");
    this.load.image("loading_screen", "assets/loading_up.png");
    this.load.image("hud", "assets/hud.png");

    // ---- Skill card spritesheet (9 cols x 4 rows, 128x200) ----
    this.load.spritesheet(
      "card_sheet",
      "assets/cards/cardSpritesheet128_200.png",
      { frameWidth: 128, frameHeight: 200 },
    );

    // ---- Enemy spritesheets ----
    this.load.spritesheet("tyranid_sheet", "assets/spriteSheetTRI64.png", {
      frameWidth: 64,
      frameHeight: 64,
    });
    this.load.spritesheet("orck_sheet", "assets/skills/ocksSlamSheet.png", {
      frameWidth: 256,
      frameHeight: 256,
    });
    this.load.spritesheet("tau_sheet", "assets/skills/tauShootSheet.png", {
      frameWidth: 256,
      frameHeight: 256,
    });
    this.load.spritesheet(
      "mechanicus_sheet",
      "assets/skills/mechshoot1-sheet.png",
      {
        frameWidth: 256,
        frameHeight: 256,
      },
    );
    this.load.spritesheet(
      "caster_sheet",
      "assets/skills/pulseenemy-sheet.png",
      {
        frameWidth: 256,
        frameHeight: 256,
      },
    );

    // ---- Map1 tiles + obstacles (legacy 64px frames; not used by
    //      renderLayeredMap but kept for any UI that still references
    //      the keys "map1_tiles" / "map1_obstacles".) ----
    this.load.spritesheet(
      "map1_tiles",
      "assets/maps/map1/MapTilesSpriteSheet64.png",
      { frameWidth: 64, frameHeight: 64 },
    );
    this.load.spritesheet(
      "map1_obstacles",
      "assets/maps/map1/MapObsSpriteSheet128.png",
      { frameWidth: 128, frameHeight: 128 },
    );

    // ---- bigobs tileset - the SAME image is loaded under two keys:
    //   "bigobs_tiles"     = 64px frames  (legacy)
    //   "bigobs_tiles_32"  = 32px frames  (used by GameScene.renderLayeredMap)
    // Without "bigobs_tiles_32" specifically, map1 and map2 render a
    // blank canvas (and you see the green game background through it).
    this.load.spritesheet("bigobs_tiles", "assets/maps/map1/BIGOBS64sym.png", {
      frameWidth: 64,
      frameHeight: 64,
    });
    this.load.spritesheet(
      "bigobs_tiles_32",
      "assets/maps/map1/BIGOBS64sym.png",
      { frameWidth: 32, frameHeight: 32 },
    );

    // ---- Skill spritesheets ----
    this.load.spritesheet(
      "bolter_sheet",
      "assets/skills/BolterSpriteSheet-0002.png",
      { frameWidth: 64, frameHeight: 64 },
    );
    this.load.spritesheet(
      "claw_sheet",
      "assets/skills/clawSpritesheet-0003.png",
      { frameWidth: 64, frameHeight: 64 },
    );
    this.load.spritesheet("slam_sheet", "assets/skills/slamSpritesheet.png", {
      frameWidth: 64,
      frameHeight: 64,
    });
    this.load.spritesheet("pulse_sheet", "assets/skills/pulseskillsheet.png", {
      frameWidth: 64,
      frameHeight: 64,
    });

    // ---- HUD overlays ----
    this.load.image("map_info_icon", "assets/40k icon2.png");
    this.load.spritesheet(
      "indicators_sheet",
      "assets/indicators sprite sheet.png",
      { frameWidth: 32, frameHeight: 32 },
    );
    this.load.spritesheet("ui_outline", "assets/outlinev1spritesheet.png", {
      frameWidth: 64,
      frameHeight: 64,
    });
  }

  async create() {
    createCharacterAnimations(this);

    // ---- Render the lobby baselayer exactly like GameScene does ----
    this.renderLobbyMap();
    this.renderDebugHitboxes();

    // ---- Status text (top center) ----
    this.statusText = this.add
      .text(this.cameras.main.centerX, 20, "Connecting...", {
        color: "#ffffff",
        fontSize: "16px",
        fontFamily: "monospace",
        stroke: "#000000",
        strokeThickness: 3,
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(100);

    // ---- FPS overlay (debug) ----
    this.debugFPS = this.add
      .text(10, 10, "FPS: 0", {
        color: "#00ff00",
        fontSize: "14px",
        fontFamily: "monospace",
        stroke: "#000000",
        strokeThickness: 3,
      })
      .setScrollFactor(0)
      .setDepth(100);

    // ---- "Click Play to begin" hint + the Play polygon itself ----
    this.buildPlayButton();

    // ---- Input bindings ----
    const bindings = bindKeyboard(this);
    this.wasdKeys = bindings.wasdKeys;

    // ---- Connect to the room ----
    if (!this.room) {
      try {
        this.client = new Client(BACKEND_URL);
        this.room = await this.client.joinOrCreate(
          "game_room",
          defaultJoinOptions(),
        );
      } catch (e) {
        console.error("LobbyScene failed to connect:", e);
        this.statusText.setText("Connection failed - refresh to retry");
        return;
      }
    }
    // ---- Initial status text (will be re-rendered by updateLobbyStatus
    //      once the local player is registered) ----
    this.statusText.setText("In lobby - click PLAY to begin");
    this.runInProgress = !!this.room.state?.runInProgress;

    // ---- Production fullscreen (mirrors the old SceneSelector behavior) ----
    if (
      import.meta.env.MODE === "production" &&
      this.scale.fullscreen?.available
    ) {
      if (!this.scale.isFullscreen) this.scale.startFullscreen();
    }

    this.bindRoomStateListeners();
    this.bindCameraToLocalPlayer();
  }

  // ============================================================
  // LOBBY MAP RENDERING
  // ============================================================

  /**
   * Bake the lobby baselayer into a single canvas texture (same trick
   * GameScene uses for the gameplay maps) and add it as one sprite.
   * Each tile id is converted to its frame in the lobby tilesheet.
   */
  private renderLobbyMap(): void {
    const map = LOBBY_MAP_DATA;
    const { tileSize, tilesetColumns, tilesetKey, firstgid, cols, rows } = map;
    const tilesetImg = this.textures
      .get(tilesetKey)
      .getSourceImage() as HTMLImageElement;
    const baseKey = "lobby_baselayer";
    if (this.textures.exists(baseKey)) this.textures.remove(baseKey);
    const canvas = this.textures.createCanvas(
      baseKey,
      cols * tileSize,
      rows * tileSize,
    );
    const ctx = canvas.getContext();
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const tileId = map.baselayer[r][c];
        if (tileId === 0) continue;
        const frameIndex = tileId - firstgid;
        const fc = frameIndex % tilesetColumns;
        const fr = Math.floor(frameIndex / tilesetColumns);
        ctx.drawImage(
          tilesetImg,
          fc * tileSize,
          fr * tileSize,
          tileSize,
          tileSize,
          c * tileSize,
          r * tileSize,
          tileSize,
          tileSize,
        );
      }
    }
    canvas.refresh();
    this.add.image(0, 0, baseKey).setOrigin(0, 0).setDepth(0);
  }

  /** F3-style red boxes over collision tiles + spawn marker. */
  private renderDebugHitboxes(): void {
    const gfx = this.add.graphics().setDepth(9);
    const { tileSize, cols, rows, collisionGrid, spawnPoint } = LOBBY_MAP_DATA;
    gfx.lineStyle(2, 0xff0000, 0.6);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (collisionGrid[r * cols + c])
          gfx.strokeRect(c * tileSize, r * tileSize, tileSize, tileSize);
      }
    }
    gfx.lineStyle(2, 0x00ffff, 0.9);
    gfx.strokeRect(
      spawnPoint.x - tileSize / 2,
      spawnPoint.y - tileSize / 2,
      tileSize,
      tileSize,
    );
    // Always hidden unless the user toggles hitboxes (F3).
    gfx.setVisible(false);
    this.input.keyboard
      ?.addKey(Phaser.Input.Keyboard.KeyCodes.F3)
      ?.on("down", () => gfx.setVisible(!gfx.visible));
  }

  // ============================================================
  // PLAY POLYGON (CLICKABLE BUTTON)
  // ============================================================

  /**
   * The user explicitly asked: the Play polygon is triggered by
   * CLICKING it (not by walking onto it). The lobby tilesheet ALREADY
   * renders the Play button visually as part of the baselayer, so we
   * just need an INVISIBLE click target on top of the same area.
   *
   * We compute the AABB from the polygon's vertices (Tiled exports
   * polygons with width=0/height=0; the real shape is in the vertex
   * list, which we now preserve in `LOBBY_PLAY_POLYGON.bbox`).
   */
  private buildPlayButton(): void {
    const poly = LOBBY_PLAY_POLYGON;
    // Use the cached AABB computed in lobbyMapData.ts from the
    // polygon's vertices. Falls back to a last-resort hard-coded box
    // if the JSON has no Play polygon at all (shouldn't happen).
    const bbox = poly?.bbox ?? { x: 610, y: 898, width: 245, height: 75 };
    const cx = bbox.x + bbox.width / 2;
    const cy = bbox.y + bbox.height / 2;

    // Transparent clickable hit area on top of the Play polygon that's
    // already drawn in the tilesheet. No fill, no stroke - just an
    // input rectangle so clicks land on the same region the user sees.
    this.playButton = this.add
      .rectangle(cx, cy, bbox.width, bbox.height, 0x000000, 0)
      .setStrokeStyle(0)
      .setDepth(5)
      .setInteractive({ useHandCursor: true });
    this.playButton.on("pointerdown", () => this.requestPlay());
  }

  private requestPlay(): void {
    if (!this.room) return;
    // Always forward the press to the server - it's the only place
    // with the authority to decide what happens. The server handles
    // three cases:
    //   * lobby has 2+ players + runInProgress == false
    //       -> startRun() takes everyone to map1 together.
    //   * lobby has 2+ players + runInProgress == true
    //       -> playRejected("run_in_progress") - we wait.
    //   * lobby has 1 player (dead or fresh) + runInProgress == true
    //       -> playRedirected(...) - server spawns a fresh solo room.
    //   * lobby has 1 player + runInProgress == false
    //       -> startRun() takes us to a fresh map1 in this room.
    // We deliberately do NOT gate the button client-side on
    // runInProgress - that was swallowing the dead-loner solo press.
    this.room.send(MSG_PLAY, {});
  }

  // ============================================================
  // ROOM STATE BINDINGS
  // ============================================================

  /**
   * Wires Colyseus Callbacks to scene state. Safe to call AGAIN after
   * a solo-redirect (the new room gets a fresh Callbacks instance via
   * `Callbacks.get(this.room)`, so listeners from the old room become
   * inert once we leave it).
   */
  private bindRoomStateListeners(): void {
    const cb = Callbacks.get(this.room as any) as any;

    // ---- Run-in-progress watch ----
    // The button itself is never client-gated (the server is the only
    // authority) but the STATUS TEXT changes depending on whether we
    // could solo-start now vs have to wait for the group.
    cb.listen("runInProgress", (v: boolean) => {
      this.runInProgress = !!v;
      this.updateLobbyStatus();
    });

    // Server rejected our Play press (a run is already active, and
    // this player is NOT alone in the lobby - so we wait our turn).
    (this.room as any).onMessage("playRejected", (_msg: any) => {
      this.runInProgress = true;
      this.updateLobbyStatus();
    });

    // ---- Solo redirect ----
    // We pressed Play while the dead-only-in-lobby scenario was
    // active: the server created a fresh GameRoom and is telling us
    // to swap to it. We tear down all lobby-state sprites/HUDs,
    // leave the old room, join the new one, and rebind state. Our
    // sticky `clientPlayerId` keeps our display name across the swap.
    (this.room as any).onMessage("playRedirected", (msg: any) => {
      const newRoomId = msg?.roomId;
      if (!newRoomId) {
        console.warn("[LOBBY] playRedirected without roomId:", msg);
        return;
      }
      this.statusText.setText("Starting solo run...");
      this.swapToRoom(newRoomId).catch((e) => {
        console.error("[LOBBY] Solo swap failed:", e);
        this.statusText.setText("Solo run failed - press PLAY to retry");
      });
    });

    cb.onAdd("players", (player: any, sessionId: string) => {
      // Only render players that are CURRENTLY in the lobby. A player
      // who is mid-transition (their currentMapId changed in the same
      // patch) is added with their current value - we filter again in
      // onChange below.
      if (player.currentMapId !== "lobby") return;
      if (sessionId === this.room.sessionId) {
        this.createLocalPlayer(player);
      } else {
        this.createRemotePlayer(player, sessionId);
      }
      // Lobby count just changed - re-render the status line so the
      // "alone → can solo" hint is up to date.
      this.updateLobbyStatus();
      // Watch for currentMapId changes (lobby <-> gameplay swap).
      cb.onChange(player, () => {
        this.handlePlayerMapChange(sessionId, player);
      });
    });

    cb.onRemove("players", (_p: any, sessionId: string) => {
      if (sessionId === this.room.sessionId) {
        // We were kicked/disconnected; nothing to clean up.
        return;
      }
      const entity = this.playerEntities[sessionId];
      if (entity) {
        entity.destroy();
        delete this.playerEntities[sessionId];
      }
      const hud = this.playerHuds[sessionId];
      if (hud) {
        destroyPlayerHud(hud);
        delete this.playerHuds[sessionId];
      }
      // Lobby count may have changed - re-render status.
      this.updateLobbyStatus();
    });
  }

  // ============================================================
  // SOLO-REDIRECT SWAP
  // ============================================================

  /**
   * Leave the current (lobby) room and join the freshly-created solo
   * GameRoom the server told us about. Destroys every sprite/HUD that
   * belonged to the old room's lobby, then re-runs
   * `bindRoomStateListeners()` against the new room so the new room's
   * `onAdd("players")` fires and re-creates the local player sprite
   * (now in the new room's roster).
   */
  private async swapToRoom(roomId: string): Promise<void> {
    const oldRoom = this.room;
    console.log(`[LOBBY] Swapping to solo room ${roomId}`);

    // 1) Tear down all lobby-side visuals + bookkeeping BEFORE we leave
    // the old room, so the dying connection can't fire an onRemove that
    // touches half-cleared state.
    this.teardownLobbyState();

    // 2) Leave the old room. wrap:true means if the connection is
    // already dead we don't throw a confusing error.
    if (oldRoom) {
      try {
        await oldRoom.leave(true);
      } catch (e) {
        console.warn("[LOBBY] Old room leave failed (likely already closed):", e);
      }
    }

    // 3) Join the new room with our sticky clientPlayerId so the
    // server re-binds us to our existing display name in the new
    // room's fresh name cache.
    try {
      this.room = await this.client.joinById(roomId, defaultJoinOptions());
    } catch (e) {
      console.error("[LOBBY] joinById failed:", e);
      this.statusText.setText("Failed to join solo run - press PLAY to retry");
      throw e;
    }

    this.statusText.setText(
      `In solo run — entering map1... (${this.room.sessionId.slice(0, 6)})`,
    );

    // 4) Re-bind state on the NEW room. Its onAdd("players") will fire
    // for our Player object (the only one in the solo room) and
    // createLocalPlayer is called for it.
    this.bindRoomStateListeners();

    // 5) RACE-SAFE local-player setup: by the time we get here, the
    // solo room's onJoin already added our Player to state. If the
    //    cb.onAdd fired BEFORE we called bindRoomStateListeners, our
    //    createLocalPlayer never ran - meaning no onChange handler
    //    is registered, and the server-side soloRun auto-startRun
    //    (player.currentMapId -> "map1") would never trigger our
    //    scene.start("game"). Sweep the state once to ensure we have
    //    a local sprite + onChange ready for the upcoming patch.
    const localPlayer = this.room.state.players.get(this.room.sessionId);
    if (localPlayer && !this.currentPlayer) {
      console.log(
        "[LOBBY] cb.onAdd missed the local player - syncing manually",
      );
      this.createLocalPlayer(localPlayer);
    }
  }

  /**
   * Render the status line at the top of the screen using the rules
   * below. Read on every lobby-affecting state change (room connect,
   * runInProgress flip, player add/remove, map transition, server
   * rejection). The contract is:
   *
   *   * No room / no local player           -> "In lobby - click PLAY"
   *   * 1+ other players in the lobby + run in progress
   *                                          -> "Run in progress - wait
   *                                             for the group"
   *   * You are ALONE in lobby + run in progress
   *                                          -> "Press PLAY to start a
   *                                             solo run"  (key UX fix)
   *   * No run in progress                   -> "In lobby - click PLAY"
   */
  private updateLobbyStatus(): void {
    if (!this.statusText) return;
    if (!this.room || !this.currentPlayerState) return;
    // Count how many players are currently in the lobby (incl. us).
    let lobbyCount = 0;
    try {
      const players = this.room.state?.players;
      if (players?.forEach) {
        players.forEach((p: any) => {
          if (p && p.currentMapId === "lobby") lobbyCount++;
        });
      }
    } catch {
      // state may not be ready yet - fall through to default text
    }
    const aloneInLobby = lobbyCount <= 1;
    if (this.runInProgress) {
      this.statusText.setText(
        aloneInLobby
          ? `Press PLAY to start your solo run (${this.room.sessionId.slice(0, 6)})`
          : "Run in progress - wait for the group to finish",
      );
    } else {
      this.statusText.setText(
        `In lobby - click PLAY to begin (${this.room.sessionId.slice(0, 6)})`,
      );
    }
  }

  /**
   * Destroy every lobby-side sprite + HUD and clear the bookkeeping
   * maps. Called BEFORE we leave the current room so the dying
   * connection's onRemove can't touch cleared state.
   */
  private teardownLobbyState(): void {
    if (this.currentPlayer) {
      this.cameras.main.stopFollow();
      this.currentPlayer.destroy();
      this.currentPlayer = null;
    }
    this.currentPlayerState = null;
    this.lastLocalMapId = null;
    this.runInProgress = false;
    for (const id in this.playerEntities) {
      const s = this.playerEntities[id];
      if (s) s.destroy();
      delete this.playerEntities[id];
    }
    for (const id in this.playerHuds) {
      const hud = this.playerHuds[id];
      if (hud) destroyPlayerHud(hud);
      delete this.playerHuds[id];
    }
  }

  // ============================================================
  // PLAYER + HUD CREATION
  // ============================================================

  /**
   * Create the LOCAL player sprite and attach the camera.
   */
  private createLocalPlayer(player: any): void {
    // Idempotency guard: cb.onAdd can fire twice for the same player
    // (once via triggerAll for existing items, once if the manual
    // sync in swapToRoom races with the listener), and we don't want
    // a duplicate sprite floating around with no controller.
    if (this.currentPlayer) {
      const existing = this.currentPlayer;
      existing.setData("serverX", player.x);
      existing.setData("serverY", player.y);
      this.currentPlayerState = player;
      return;
    }
    const sprite = this.add
      .sprite(player.x, player.y, "player_sheet", 0)
      .setDepth(4);
    sprite.setData("serverX", player.x);
    sprite.setData("serverY", player.y);
    this.currentPlayer = sprite;
    this.currentPlayerState = player;
    this.lastLocalMapId = player.currentMapId;
    this.cameras.main.startFollow(sprite);
    this.cameras.main.setBounds(
      0,
      0,
      LOBBY_MAP_DATA.widthPx,
      LOBBY_MAP_DATA.heightPx,
    );
    // Name HUD above the local sprite (no HP bar in the lobby).
    if (this.playerHuds[this.room.sessionId]) {
      destroyPlayerHud(this.playerHuds[this.room.sessionId]);
    }
    this.playerHuds[this.room.sessionId] = attachPlayerHud(
      this,
      sprite,
      player.displayName ?? "",
      { showHpBar: false },
    );

    const cb = Callbacks.get(this.room as any) as any;
    cb.onChange(player, () => {
      this.currentPlayerState = player;
      // Server-authoritative position (snap if desync > 32 px, otherwise
      // we just predict locally).
      const dx = Math.abs(sprite.x - player.x);
      const dy = Math.abs(sprite.y - player.y);
      if (dx > 32 || dy > 32) {
        sprite.x = player.x;
        sprite.y = player.y;
      }
      sprite.setData("serverX", player.x);
      sprite.setData("serverY", player.y);
      // Refresh the local HUD text in case the name was reassigned.
      const hud = this.playerHuds[this.room.sessionId];
      if (hud) updatePlayerHud(hud, sprite, player.displayName ?? "", 0, 1, 0, 0, false);
      this.handlePlayerMapChange(this.room.sessionId, player);
    });
  }

  private createRemotePlayer(player: any, sessionId: string): void {
    // Idempotency guard: prevent a phantom duplicate remote sprite
    // if cb.onAdd fires twice for the same player.
    if (this.playerEntities[sessionId]) {
      const existing = this.playerEntities[sessionId];
      existing.setData("serverX", player.x);
      existing.setData("serverY", player.y);
      return;
    }
    const sprite = this.add
      .sprite(player.x, player.y, "player_sheet", 0)
      .setDepth(4);
    sprite.setData("serverX", player.x);
    sprite.setData("serverY", player.y);
    this.playerEntities[sessionId] = sprite;
    // Name HUD above the remote sprite (no HP bar in the lobby).
    if (this.playerHuds[sessionId]) {
      destroyPlayerHud(this.playerHuds[sessionId]);
    }
    this.playerHuds[sessionId] = attachPlayerHud(
      this,
      sprite,
      player.displayName ?? "",
      { showHpBar: false },
    );
    const cb = Callbacks.get(this.room as any) as any;
    cb.onChange(player, () => {
      // CRITICAL: keep the sprite's lerp target in sync with the
      // server-side Player position. Without this the remote sprite
      // stays at its initial position forever (the smoothing in
      // fixedTick lerps toward (serverX, serverY), which would be
      // stuck at the join coordinates).
      sprite.setData("serverX", player.x);
      sprite.setData("serverY", player.y);
      // Hard snap on large desync so the remote doesn't drift if
      // a packet is dropped or the lerp falls behind.
      const dx = Math.abs(sprite.x - player.x);
      const dy = Math.abs(sprite.y - player.y);
      if (dx > 64 || dy > 64) {
        sprite.x = player.x;
        sprite.y = player.y;
      }
      // Refresh the HUD text in case the display name was reassigned.
      const hud = this.playerHuds[sessionId];
      if (hud) updatePlayerHud(hud, sprite, player.displayName ?? "", 0, 1, 0, 0, false);
    });
  }

  /**
   * Whenever a player's currentMapId changes:
   *   - If they're the local player and they're leaving the lobby,
   *     hand off the room + client to GameScene and switch scenes.
   *   - If they're a remote player entering/leaving the lobby, create
   *     or destroy their sprite.
   */
  private handlePlayerMapChange(sessionId: string, player: any): void {
    const mapId = player.currentMapId;
    const isLocal = sessionId === this.room.sessionId;

    // ---- LOCAL PLAYER BRANCH ----
    // Only the local player's currentMapId drives scene transitions.
    // Critically, we MUST NOT touch `lastLocalMapId` for remote player
    // changes - a remote player leaving the lobby would otherwise
    // poison the local transition gate ("lastLocalMapId === lobby"
    // would no longer match when our own player's patch arrives a
    // moment later, and the local client would stay stuck in the
    // lobby while the rest of the group runs on the map).
    if (isLocal) {
      if (mapId !== "lobby" && this.lastLocalMapId === "lobby") {
        // Leaving the lobby -> handoff the room + client so GameScene
        // doesn't reconnect, then start it.
        this.lastLocalMapId = mapId;
        this.scene.start("game", { room: this.room, client: this.client });     
        return;
      }
      this.lastLocalMapId = mapId;
      // Local may have just died (map1 -> lobby): lobby count changed.
      this.updateLobbyStatus();
      return;
    }

    // ---- REMOTE PLAYER BRANCH ----
    // Remote player leaving the lobby -> remove their sprite + HUD.
    if (mapId !== "lobby" && this.playerEntities[sessionId]) {
      const sprite = this.playerEntities[sessionId];
      sprite.destroy();
      delete this.playerEntities[sessionId];
      const hud = this.playerHuds[sessionId];
      if (hud) {
        destroyPlayerHud(hud);
        delete this.playerHuds[sessionId];
      }
      this.updateLobbyStatus();
      return;
    }
    // Remote player entering the lobby (mid-game group dropping in,
    // or a freshly-connected second tab) -> spawn their sprite + HUD.
    if (mapId === "lobby" && !this.playerEntities[sessionId]) {
      this.createRemotePlayer(player, sessionId);
      this.updateLobbyStatus();
      return;
    }
  }

  private bindCameraToLocalPlayer(): void {
    // Camera follow is set in createLocalPlayer - this method is a
    // placeholder so future tweaks (camera lerp, zoom) have a hook.
  }

  // ============================================================
  // ANIMATION + INPUT + FIXED TICK
  // ============================================================

  private updatePlayerAnimation(sprite: Phaser.GameObjects.Sprite): void {
    let moving = false;
    let direction: "left" | "right" =
      (sprite.data.get("lastDirection") as "left" | "right") || "left";
    if (this.inputPayload.left) {
      direction = "left";
      moving = true;
    }
    if (this.inputPayload.right) {
      direction = "right";
      moving = true;
    }
    if (this.inputPayload.up || this.inputPayload.down) moving = true;
    sprite.data.set("lastDirection", direction);
    const targetKey = moving
      ? direction === "right"
        ? "player_walk_right"
        : "player_walk_left"
      : "player_idle";
    if (
      !sprite.anims.currentAnim ||
      sprite.anims.currentAnim.key !== targetKey
    ) {
      sprite.anims.play(targetKey);
    }
    // The walk animations have a facing per row; only the IDLE anim is
    // flipped to face the last direction. Reset the flip whenever we
    // play a walk anim — otherwise the flip set during a previous idle
    // leaks into the walk animation and the player appears to walk in
    // the OPPOSITE direction.
    if (moving) sprite.setFlipX(false);
    else sprite.setFlipX(direction === "right");
  }

  private fixedTick(): void {
    this.currentTick++;
    this.debugFPS.setText("FPS: " + Math.round(this.game.loop.actualFps));
    if (!this.currentPlayer || !this.room) return;
    this.inputPayload.left = this.wasdKeys.left.isDown;
    this.inputPayload.right = this.wasdKeys.right.isDown;
    this.inputPayload.up = this.wasdKeys.up.isDown;
    this.inputPayload.down = this.wasdKeys.down.isDown;
    this.inputPayload.tick = this.currentTick;
    this.room.send(0, this.inputPayload);
    this.updatePlayerAnimation(this.currentPlayer);

    // ---- Local prediction (mirrors server's PlayerSystem.update) ----
    const dt = this.fixedTimeStep / 1000;
    let dirX = 0,
      dirY = 0;
    if (this.inputPayload.left) dirX -= 1;
    if (this.inputPayload.right) dirX += 1;
    if (this.inputPayload.up) dirY -= 1;
    if (this.inputPayload.down) dirY += 1;
    const length = Math.sqrt(dirX * dirX + dirY * dirY);
    if (length > 0) {
      dirX /= length;
      dirY /= length;
    }
    const speed = this.moveSpeed;
    this.currentPlayer.x += dirX * speed * dt;
    this.currentPlayer.y += dirY * speed * dt;
    this.currentPlayer.x = Phaser.Math.Clamp(
      this.currentPlayer.x,
      0,
      LOBBY_MAP_DATA.widthPx,
    );
    this.currentPlayer.y = Phaser.Math.Clamp(
      this.currentPlayer.y,
      0,
      LOBBY_MAP_DATA.heightPx,
    );
    const resolved = resolveTileCollision(
      this.currentPlayer.x,
      this.currentPlayer.y,
      PLAYER_COLLISION_RADIUS,
      LOBBY_MAP_DATA.collisionGrid,
      LOBBY_MAP_DATA.cols,
      LOBBY_MAP_DATA.rows,
      LOBBY_MAP_DATA.tileSize,
    );
    this.currentPlayer.x = resolved.x;
    this.currentPlayer.y = resolved.y;

    // ---- Remotes: smooth toward server-synced position ----
    for (const id in this.playerEntities) {
      const sprite = this.playerEntities[id];
      if (!sprite?.active) continue;
      const sx = sprite.data.get("serverX") as number;
      const sy = sprite.data.get("serverY") as number;
      sprite.x += (sx - sprite.x) * 0.4;
      sprite.y += (sy - sprite.y) * 0.4;
      const hud = this.playerHuds[id];
      if (hud)
        updatePlayerHud(hud, sprite, hud.lastName, 0, 1, 0, 0, false);
    }
    // Local HUD tracks the local sprite (we move it directly above).
    if (this.currentPlayer && this.playerHuds[this.room.sessionId]) {
      const localHud = this.playerHuds[this.room.sessionId];
      updatePlayerHud(localHud, this.currentPlayer, localHud.lastName, 0, 1, 0, 0, false);
    }
  }

  update(_t: number, delta: number): void {
    this.elapsedTime += delta;
    let catchUpTicks = 0;
    while (this.elapsedTime >= this.fixedTimeStep) {
      this.elapsedTime -= this.fixedTimeStep;
      this.fixedTick();
      if (++catchUpTicks >= 5) {
        this.elapsedTime = 0;
        break;
      }
    }
  }
}
