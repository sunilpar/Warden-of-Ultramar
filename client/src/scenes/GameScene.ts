/**
 * Game Scene — Client-Side Rendering
 * ==================================
 *
 * ARCHITECTURE: Server-Authoritative Multiplayer
 *   - The SERVER owns all game state (position, collision)
 *   - The CLIENT only:
 *       1. Renders what the server tells it
 *       2. Sends player input to the server
 *       3. Predicts local player movement for responsiveness
 *       4. Interpolates remote players for smooth visuals
 *
 * CLIENT-SIDE PREDICTION:
 *   For the LOCAL player, we apply movement immediately (before the server
 *   confirms). If the server's position differs significantly, we snap to it.
 *   This hides network latency and makes movement feel instant.
 *
 * LAYERED MAP (layerbasedMap1.json — the source of truth):
 *   - "baselayer"    → floor tiles, always drawn (depth 0)
 *   - "interactive"  → walls / decor / spawn / exit markers; 0 = skip (depth 1)
 *   - "ememy spawn"  → object layer; rectangles where enemies will spawn
 *   Collision is O(1) tile-grid lookup (see resolveTileCollision).
 *
 * CHARACTER SPRITE SHEET (CharacterSpriteSheet64.png):
 *   4x4 grid, each frame 64x64 pixels.
 *   Row 0: walk RIGHT (frames  0,  1,  2,  3)
 *   Row 1: walk LEFT  (frames  4,  5,  6,  7)
 *   Row 2: walk UP    (frames  8,  9, 10, 11)
 *   Row 3: walk DOWN  (frames 12, 13, 14, 15)
 */

import Phaser from "phaser";
import { Client, Callbacks } from "@colyseus/sdk";
import { BACKEND_URL } from "../backend";

import {
  LAYERED_MAP,
  resolveTileCollision,
} from "../maps/layeredMapData";
import type { LayeredMapData } from "../maps/layeredMapData";
import { LAYERED_MAP_2 } from "../maps/layeredMap2Data";

// ============================================================
// Game Scene
// ============================================================

export class GameScene extends Phaser.Scene {
  client = new Client(BACKEND_URL);
  room: any = null;

  // ---- Entity tracking ----
  currentPlayer!: Phaser.GameObjects.Sprite;
  playerEntities: { [sessionId: string]: Phaser.GameObjects.Sprite } = {};

  // ---- Input ----
  wasdKeys!: {
    left: Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
    up: Phaser.Input.Keyboard.Key;
    down: Phaser.Input.Keyboard.Key;
  };

  inputPayload: {
    left: boolean;
    right: boolean;
    up: boolean;
    down: boolean;
    tick?: number;
  } = {
    left: false,
    right: false,
    up: false,
    down: false,
    tick: undefined,
  };

  // ---- Fixed timestep for client-side prediction ----
  elapsedTime = 0;
  fixedTimeStep = 1000 / 60;
  currentTick: number = 0;

  // ---- Player settings (must match server GAME_CONFIG) ----
  private readonly PLAYER_SPEED = 120; // pixels per second
  private readonly PLAYER_COLLISION_RADIUS = 20;

  // ---- Character animation state ----
  private animationsCreated: boolean = false;
  private lastDirection: string = "down"; // default facing direction

  // ---- Debug HUD (fixed to screen) ----
  private debugFPS!: Phaser.GameObjects.Text;
  private showHitboxes: boolean = false;
  private debugHitboxes: Phaser.GameObjects.Graphics | null = null;
  private hitboxToggleKey!: Phaser.Input.Keyboard.Key;
  private hitboxToggleButton!: Phaser.GameObjects.Text;

  /**
   * Per-scene config: which Colyseus room to join, which map to render,
   * and (optionally) which scene to switch to when the player reaches the
   * exit tile of this map.
   */
  static readonly CONFIGS: Record<
    string,
    {
      roomName: string;
      mapData: LayeredMapData;
      nextSceneKey?: string;
    }
  > = {
    game: {
      roomName: "game_room",
      mapData: LAYERED_MAP,
      nextSceneKey: "game2",
    },
    game2: {
      roomName: "game_room_2",
      mapData: LAYERED_MAP_2,
    },
  };

  private mapData!: LayeredMapData;
  private roomName: string = "game_room";
  private nextSceneKey?: string;
  private transitioning: boolean = false;

  constructor(config: Phaser.Types.Scenes.SettingsConfig) {
    super(config);
  }

  // ============================================================
  // INITIALIZATION
  // ============================================================

  async create() {
    // ---- Set up keyboard input (WASD) ----
    this.wasdKeys = this.input.keyboard.addKeys({
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
      up: Phaser.Input.Keyboard.KeyCodes.W,
      down: Phaser.Input.Keyboard.KeyCodes.S,
    }) as any;

    // ---- Resolve this scene's map + room config from its scene key ----
    const cfg =
      GameScene.CONFIGS[this.sys.settings.key] ?? GameScene.CONFIGS["game"];
    this.mapData = cfg.mapData;
    this.roomName = cfg.roomName;
    this.nextSceneKey = cfg.nextSceneKey;
    this.transitioning = false;

    // ---- Transition intro: if launched with { fadeIn }, this scene is
    //      the destination of a map transition. Cover the screen with a
    //      black rectangle + the loading image while the room connects,
    //      then fade them out to reveal the loaded map. ----
    const startData = this.sys.settings.data as { fadeIn?: boolean } | undefined;
    const isFadeIn = !!startData?.fadeIn;

    let cover: Phaser.GameObjects.Rectangle | null = null;
    let loadingImg: Phaser.GameObjects.Image | null = null;
    if (isFadeIn) {
      const { width, height } = this.scale;
      cover = this.add
        .rectangle(0, 0, width, height, 0x000000)
        .setOrigin(0, 0)
        .setScrollFactor(0)
        .setDepth(1000);
      loadingImg = this.add
        .image(this.cameras.main.centerX, this.cameras.main.centerY, "loading_screen")
        .setScrollFactor(0)
        .setDepth(1001);
    }

    // ---- Render the layered map (baselayer + interactive + zones) ----
    this.renderLayeredMap();
    this.renderDebugHitboxes();

    // ---- Debug HUD (FPS + hitbox toggle button) ----
    this.createDebugHUD();

    // ---- F3 to toggle hitbox overlay ----
    this.hitboxToggleKey = this.input.keyboard.addKey(
      Phaser.Input.Keyboard.KeyCodes.F3,
    );

    // ---- Connect to the Colyseus server ----
    await this.connect();

    if (!this.room) {
      // Connection failed — still drop the cover so the player isn't stuck.
      if (cover) cover.destroy();
      if (loadingImg) loadingImg.destroy();
      return;
    }

    // ---- If this was a map transition, fade the black cover + loading
    //      image out to reveal the freshly loaded map. ----
    if (isFadeIn && cover && loadingImg) {
      const FADE_MS = 400;
      this.tweens.add({
        targets: [cover, loadingImg],
        alpha: { from: 1, to: 0 },
        duration: FADE_MS,
        ease: "Linear",
        onComplete: () => {
          cover?.destroy();
          loadingImg?.destroy();
        },
      });
    }

    // ============================================================
    // COLYSEUS STATE LISTENERS (v0.17 API — use Callbacks.get())
    // ============================================================
    const callbacks = Callbacks.get(this.room as any) as any;

    // Player added to the room
    callbacks.onAdd("players", (player: any, sessionId: string) => {
      const sprite = this.add
        .sprite(player.x, player.y, "character_sheet", 0)
        .setDisplaySize(64, 64)
        .setDepth(3);

      // Create walk/idle animations once (shared by all sprites)
      if (!this.animationsCreated) {
        this.createCharacterAnimations();
        this.animationsCreated = true;
      }

      sprite.anims.play("char_idle_down");
      this.playerEntities[sessionId] = sprite;

      if (sessionId === this.room.sessionId) {
        // ---- LOCAL PLAYER ----
        this.currentPlayer = sprite;

        // Camera follows the local player
        this.cameras.main.startFollow(sprite, true, 0.1, 0.1);
        this.cameras.main.setBounds(
          0,
          0,
          this.mapData.widthPx,
          this.mapData.heightPx,
        );

        // When the server sends a new position, reconcile if needed
        callbacks.onChange(player, () => {
          if (this.currentPlayer) {
            const dx = Math.abs(player.x - this.currentPlayer.x);
            const dy = Math.abs(player.y - this.currentPlayer.y);
            // Snap to server position if we're far off (teleport, correction)
            if (dx > 32 || dy > 32) {
              this.currentPlayer.x = player.x;
              this.currentPlayer.y = player.y;
            }
          }
        });
      } else {
        // ---- REMOTE PLAYER ----
        // Store server position for interpolation
        callbacks.onChange(player, () => {
          sprite.setData("serverX", player.x);
          sprite.setData("serverY", player.y);
        });
      }
    });

    // Player removed from the room
    callbacks.onRemove("players", (_player: any, sessionId: string) => {
      const entity = this.playerEntities[sessionId];
      if (entity) {
        entity.destroy();
        delete this.playerEntities[sessionId];
      }
    });
  }

  // ============================================================
  // SERVER CONNECTION
  // ============================================================

  async connect() {
    try {
      this.room = await this.client.joinOrCreate(this.roomName);
    } catch (e) {
      console.error("Failed to connect:", e);
    }
  }

  // ============================================================
  // CHARACTER ANIMATIONS
  // ============================================================

  /**
   * Create walk and idle animations for all 4 directions.
   * The sprite sheet is a 4x4 grid:
   *   Row 0: walk RIGHT (frames 0-3)
   *   Row 1: walk LEFT  (frames 4-7)
   *   Row 2: walk UP    (frames 8-11)
   *   Row 3: walk DOWN  (frames 12-15)
   */
  private createCharacterAnimations(): void {
    const directions = [
      { dir: "right", startFrame: 0 },
      { dir: "left", startFrame: 4 },
      { dir: "up", startFrame: 8 },
      { dir: "down", startFrame: 12 },
    ];

    for (const { dir, startFrame } of directions) {
      // Walk animation (4 frames, looping at 10 fps)
      this.anims.create({
        key: `char_walk_${dir}`,
        frames: this.anims.generateFrameNumbers("character_sheet", {
          start: startFrame,
          end: startFrame + 3,
        }),
        frameRate: 10,
        repeat: -1,
      });

      // Idle animation (single frame, no repeat)
      this.anims.create({
        key: `char_idle_${dir}`,
        frames: [{ key: "character_sheet", frame: startFrame }],
        frameRate: 1,
        repeat: 0,
      });
    }
  }

  /**
   * Update the local player's animation based on current input.
   * Plays walk animation when moving, idle when standing still.
   */
  private updatePlayerAnimation(): void {
    if (!this.currentPlayer) return;

    let moving = false;
    let newDirection = this.lastDirection;

    // Determine direction (last pressed key wins for diagonals)
    if (this.inputPayload.left) {
      newDirection = "left";
      moving = true;
    }
    if (this.inputPayload.right) {
      newDirection = "right";
      moving = true;
    }
    if (this.inputPayload.up) {
      newDirection = "up";
      moving = true;
    }
    if (this.inputPayload.down) {
      newDirection = "down";
      moving = true;
    }

    this.lastDirection = newDirection;

    const animKey = moving
      ? `char_walk_${newDirection}`
      : `char_idle_${newDirection}`;

    // Only switch animation if it changed (avoids restarting every frame)
    const currentAnim = this.currentPlayer.anims.currentAnim;
    if (!currentAnim || currentAnim.key !== animKey) {
      this.currentPlayer.anims.play(animKey);
    }
  }

  // ============================================================
  // LAYERED MAP RENDERING
  // ============================================================

  /**
   * Render the layered Tiled map:
   *   - Baselayer: every tile drawn (depth 0) — the floor.
   *   - Interactive layer: every non-zero tile drawn (depth 1) — walls,
   *     decor, spawn & exit markers.
   *
   * Both layers are blitted into a single canvas texture each (one draw call
   * per layer) using the BIGOBS64sym.png spritesheet.
   *
   * Tile ids are Tiled global ids (firstgid=1); frame index = id - firstgid.
   */
  private renderLayeredMap(): void {
    const map = this.mapData;
    const { tileSize, tilesetColumns, tilesetKey, firstgid, cols, rows } = map;

    const tilesetImg = this.textures
      .get(tilesetKey)
      .getSourceImage() as HTMLImageElement;

    // ---- 1) Baselayer canvas (depth 0) ----
    const baseKey = "layered_baselayer";
    if (this.textures.exists(baseKey)) this.textures.remove(baseKey);
    const baseCanvas = this.textures.createCanvas(
      baseKey,
      cols * tileSize,
      rows * tileSize,
    );
    const baseCtx = baseCanvas.getContext();

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const tileId = map.baselayer[r][c];
        if (tileId === 0) continue;
        const frameIndex = tileId - firstgid;
        const fc = frameIndex % tilesetColumns;
        const fr = Math.floor(frameIndex / tilesetColumns);
        baseCtx.drawImage(
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
    baseCanvas.refresh();
    this.add.image(0, 0, baseKey).setOrigin(0, 0).setDepth(0);

    // ---- 2) Interactive layer canvas (depth 1) — skip tile 0 ----
    const interKey = "layered_interactive";
    if (this.textures.exists(interKey)) this.textures.remove(interKey);
    const interCanvas = this.textures.createCanvas(
      interKey,
      cols * tileSize,
      rows * tileSize,
    );
    const interCtx = interCanvas.getContext();

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const tileId = map.interactiveLayer[r][c];
        if (tileId === 0) continue; // empty — nothing to draw
        const frameIndex = tileId - firstgid;
        const fc = frameIndex % tilesetColumns;
        const fr = Math.floor(frameIndex / tilesetColumns);
        interCtx.drawImage(
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
    interCanvas.refresh();
    this.add.image(0, 0, interKey).setOrigin(0, 0).setDepth(1);

    // Enemy spawn zones are NOT drawn here — they only appear in the debug
    // hitbox overlay (toggle F3), so the map is clean during normal play.
  }

  // ============================================================
  // DEBUG HITBOX OVERLAY
  // ============================================================

  /**
   * Render debug hitbox overlays (toggle with F3 or button).
   *
   * Colors:
   *   RED (thick)   = collision tile (blocks movement)
   *   YELLOW (thin) = player spawn point
   *   CYAN (thin)   = exit zone
   *   MAGENTA (thin)= enemy spawn zone
   *   WHITE (thin)  = map boundary
   */
  private renderDebugHitboxes(): void {
    const gfx = this.add.graphics().setDepth(10);
    const map = this.mapData;
    const { tileSize, cols, rows } = map;

    // Collision tiles (RED)
    gfx.lineStyle(3, 0xff0000, 0.7);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (map.collisionGrid[r * cols + c]) {
          gfx.strokeRect(c * tileSize, r * tileSize, tileSize, tileSize);
        }
      }
    }

    // Player spawn point (YELLOW)
    gfx.lineStyle(2, 0xffff00, 0.9);
    const sp = map.spawnPoint;
    gfx.strokeRect(
      sp.x - tileSize / 2,
      sp.y - tileSize / 2,
      tileSize,
      tileSize,
    );

    // Exit zone (CYAN)
    gfx.lineStyle(2, 0x00ffff, 0.9);
    const ex = map.exitPoint;
    gfx.strokeRect(ex.x, ex.y, ex.width, ex.height);

    // Enemy spawn zones (MAGENTA)
    gfx.lineStyle(2, 0xff00ff, 0.7);
    for (const zone of map.enemySpawnZones) {
      gfx.strokeRect(zone.x, zone.y, zone.width, zone.height);
    }

    // Map boundary (WHITE)
    gfx.lineStyle(1, 0xffffff, 0.3);
    gfx.strokeRect(0, 0, map.widthPx, map.heightPx);

    gfx.setVisible(this.showHitboxes);
    this.debugHitboxes = gfx;
  }

  // ============================================================
  // DEBUG HUD (FPS + Hitbox Toggle Button)
  // ============================================================

  /**
   * Create the debug HUD fixed to the top-left of the screen.
   * Uses setScrollFactor(0) so it stays in place while the camera moves.
   */
  private createDebugHUD(): void {
    // ---- FPS counter (top-left) ----
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

    // ---- Hitbox toggle button (below FPS) ----
    this.hitboxToggleButton = this.add
      .text(10, 32, "[F3] Hitboxes: OFF", {
        color: "#ffaa00",
        fontSize: "12px",
        fontFamily: "monospace",
        stroke: "#000000",
        strokeThickness: 3,
      })
      .setScrollFactor(0)
      .setDepth(100)
      .setInteractive({ useHandCursor: true })
      .on("pointerdown", () => {
        this.toggleHitboxes();
      });
  }

  /** Toggle hitbox visibility and update button text. */
  private toggleHitboxes(): void {
    this.showHitboxes = !this.showHitboxes;
    if (this.debugHitboxes) {
      this.debugHitboxes.setVisible(this.showHitboxes);
    }
    this.hitboxToggleButton.setText(
      this.showHitboxes ? "[F3] Hitboxes: ON" : "[F3] Hitboxes: OFF",
    );
  }

  // ============================================================
  // FIXED TIMESTEP UPDATE LOOP
  // ============================================================

  /**
   * This runs at a fixed 60Hz. Each tick we:
   *   1. Read keyboard input
   *   2. Send input to server (message type 0)
   *   3. Predict movement locally (apply same formula as server)
   *   4. Clamp to map boundaries
   *   5. Resolve tile collisions (O(1) grid lookup)
   *   6. Interpolate remote players toward their server positions
   *   7. Update FPS counter
   */
  fixedTick() {
    this.currentTick++;

    // Toggle hitbox overlay on F3 press
    if (Phaser.Input.Keyboard.JustDown(this.hitboxToggleKey)) {
      this.toggleHitboxes();
    }

    // Update FPS counter
    this.debugFPS.setText("FPS: " + Math.round(this.game.loop.actualFps));

    if (!this.currentPlayer || !this.room) return;

    // ---- Read input ----
    this.inputPayload.left = this.wasdKeys.left.isDown;
    this.inputPayload.right = this.wasdKeys.right.isDown;
    this.inputPayload.up = this.wasdKeys.up.isDown;
    this.inputPayload.down = this.wasdKeys.down.isDown;
    this.inputPayload.tick = this.currentTick;

    // ---- Send input to server ----
    this.room.send(0, this.inputPayload);

    // ---- Update character animation ----
    this.updatePlayerAnimation();

    // ---- Client-side prediction (apply same movement as server) ----
    const dt = this.fixedTimeStep / 1000;
    let dirX = 0;
    let dirY = 0;
    if (this.inputPayload.left) dirX -= 1;
    if (this.inputPayload.right) dirX += 1;
    if (this.inputPayload.up) dirY -= 1;
    if (this.inputPayload.down) dirY += 1;

    // Normalize diagonal (same as server)
    const length = Math.sqrt(dirX * dirX + dirY * dirY);
    if (length > 0) {
      dirX /= length;
      dirY /= length;
    }

    this.currentPlayer.x += dirX * this.PLAYER_SPEED * dt;
    this.currentPlayer.y += dirY * this.PLAYER_SPEED * dt;

    // Clamp to map boundaries
    this.currentPlayer.x = Phaser.Math.Clamp(
      this.currentPlayer.x,
      0,
      this.mapData.widthPx,
    );
    this.currentPlayer.y = Phaser.Math.Clamp(
      this.currentPlayer.y,
      0,
      this.mapData.heightPx,
    );

    // ---- Resolve tile collisions (O(1) — matches server) ----
    const resolved = resolveTileCollision(
      this.currentPlayer.x,
      this.currentPlayer.y,
      this.PLAYER_COLLISION_RADIUS,
      this.mapData.collisionGrid,
      this.mapData.cols,
      this.mapData.rows,
      this.mapData.tileSize,
    );
    this.currentPlayer.x = resolved.x;
    this.currentPlayer.y = resolved.y;

    // ---- Map exit transition ----
    // When the player steps onto this map's exit tile, move them to the
    // next room/scene. `transitioning` guards against re-entry.
    if (!this.transitioning && this.nextSceneKey && this.isOnExitTile()) {
      this.transitionToScene(this.nextSceneKey);
      return;
    }

    // ---- Interpolate remote players toward server position ----
    for (const sessionId in this.playerEntities) {
      if (sessionId === this.room.sessionId) continue;

      const entity = this.playerEntities[sessionId];
      const serverX = entity.data.get("serverX") as number;
      const serverY = entity.data.get("serverY") as number;

      if (serverX !== undefined && serverY !== undefined) {
        // Distance to server target - used to detect movement and direction
        const dx = serverX - entity.x;
        const dy = serverY - entity.y;
        const dist = Math.hypot(dx, dy);

        entity.x = Phaser.Math.Linear(entity.x, serverX, 0.2);
        entity.y = Phaser.Math.Linear(entity.y, serverY, 0.2);

        // ---- Animation driving for remote players ----
        // Direction is derived client-side from the position delta
        // because the Player schema does not sync facing direction.
        const moving = dist > 1.5; // small threshold to ignore jitter
        let direction = entity.data.get("lastDirection") as string;
        if (!direction) direction = "down";

        if (moving) {
          // Dominant axis wins (mirrors local diagonal handling)
          if (Math.abs(dx) > Math.abs(dy)) {
            direction = dx > 0 ? "right" : "left";
          } else {
            direction = dy > 0 ? "down" : "up";
          }
        }
        entity.setData("lastDirection", direction);

        const animKey = moving
          ? `char_walk_${direction}`
          : `char_idle_${direction}`;

        // Only switch animation if it changed (avoids restarting every tick)
        const currentAnim = entity.anims.currentAnim;
        if (!currentAnim || currentAnim.key !== animKey) {
          entity.anims.play(animKey);
        }
      }
    }
  }

  /**
   * Returns true if the local player's center is inside this map's exit zone.
   */
  private isOnExitTile(): boolean {
    if (!this.currentPlayer) return false;
    const ex = this.mapData.exitPoint;
    return (
      this.currentPlayer.x >= ex.x &&
      this.currentPlayer.x <= ex.x + ex.width &&
      this.currentPlayer.y >= ex.y &&
      this.currentPlayer.y <= ex.y + ex.height
    );
  }

  /**
   * Fade to black, show the loading screen image, then switch to the next
   * Phaser scene. The destination scene fades in from black once its room
   * has finished connecting (see create()).
   *
   * The old Colyseus room is left during the dark phase and is
   * auto-disposed by Colyseus once it has no clients.
   */
  private transitionToScene(sceneKey: string): void {
    if (this.transitioning) return;
    this.transitioning = true;

    const cam = this.cameras.main;
    // Duration of each fade half (ms). Total dark time ~= 2 * FADE_MS
    // plus the room-connect wait in the destination scene.
    const FADE_MS = 400;

    // Once the camera has fully faded to black, swap scenes.
    cam.once("camerafadeoutcomplete", () => {
      // Leave the old room (it auto-disposes when empty).
      try {
        this.room?.leave();
      } catch (_e) {
        // ignore
      }
      this.room = null;

      // Tear down local entity sprites.
      for (const id in this.playerEntities) {
        const e = this.playerEntities[id];
        if (e) e.destroy();
        delete this.playerEntities[id];
      }
      this.playerEntities = {};

      // Start the destination scene under a black cover so the player
      // never sees the unloaded map.
      this.scene.launch(sceneKey, { fadeIn: true });
      this.scene.stop();
    });

    cam.fadeOut(FADE_MS, 0, 0, 0);
  }

  // ============================================================
  // PHASER UPDATE (routes to fixed timestep)
  // ============================================================

  update(_time: number, delta: number) {
    if (!this.room) return;

    this.elapsedTime += delta;
    while (this.elapsedTime >= this.fixedTimeStep) {
      this.elapsedTime -= this.fixedTimeStep;
      this.fixedTick();
    }
  }
}
