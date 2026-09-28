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
 */
import Phaser from "phaser";
import { Client } from "@colyseus/sdk";
import { Callbacks } from "@colyseus/schema";
import { BACKEND_URL } from "../backend";
import { LOBBY_MAP_DATA, LOBBY_PLAY_POLYGON } from "../maps/lobbyMapData";
import { resolveTileCollision } from "../maps/layeredMapData";
import { createCharacterAnimations } from "../vfx/animations";
import { bindKeyboard } from "../systems/input";

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
  /** Clickable Play polygon. */
  playButton!: Phaser.GameObjects.Rectangle;
  /** Status text shown during room connect / errors. */
  statusText!: Phaser.GameObjects.Text;
  /** FPS counter (debug overlay). */
  debugFPS!: Phaser.GameObjects.Text;

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
        this.room = await this.client.joinOrCreate("game_room", {});
      } catch (e) {
        console.error("LobbyScene failed to connect:", e);
        this.statusText.setText("Connection failed - refresh to retry");
        return;
      }
    }
    this.statusText.setText(
      `In lobby — click PLAY to begin (${this.room.sessionId.slice(0, 6)})`,
    );

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
    // Send the "play" message - server teleports us to the gameplay map.
    this.room.send(MSG_PLAY, {});
  }

  // ============================================================
  // ROOM STATE BINDINGS
  // ============================================================

  private bindRoomStateListeners(): void {
    const cb = Callbacks.get(this.room as any) as any;

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
    });
  }

  /**
   * Create the LOCAL player sprite and attach the camera.
   */
  private createLocalPlayer(player: any): void {
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
      this.handlePlayerMapChange(this.room.sessionId, player);
    });
  }

  private createRemotePlayer(player: any, sessionId: string): void {
    const sprite = this.add
      .sprite(player.x, player.y, "player_sheet", 0)
      .setDepth(4);
    sprite.setData("serverX", player.x);
    sprite.setData("serverY", player.y);
    this.playerEntities[sessionId] = sprite;
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

    // ---- Local player leaving the lobby -> switch to GameScene ----
    if (isLocal && mapId !== "lobby" && this.lastLocalMapId === "lobby") {
      this.lastLocalMapId = mapId;
      // Hand off the connection so GameScene doesn't reconnect.
      this.scene.start("game", { room: this.room, client: this.client });
      return;
    }
    this.lastLocalMapId = mapId;

    // ---- Remote player entering the lobby ----
    if (!isLocal && mapId === "lobby" && !this.playerEntities[sessionId]) {
      this.createRemotePlayer(player, sessionId);
      return;
    }
    // ---- Remote player leaving the lobby -> remove their sprite ----
    if (!isLocal && mapId !== "lobby" && this.playerEntities[sessionId]) {
      const sprite = this.playerEntities[sessionId];
      sprite.destroy();
      delete this.playerEntities[sessionId];
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
      if (targetKey === "player_idle") sprite.setFlipX(direction === "right");
    }
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
