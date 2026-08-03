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
 * CHARACTER SPRITE SHEET (CharacterSpriteSheet64.png):
 *   4x4 grid, each frame 64x64 pixels.
 *   Row 0: walk RIGHT (frames  0,  1,  2,  3)
 *   Row 1: walk LEFT  (frames  4,  5,  6,  7)
 *   Row 2: walk UP    (frames  8,  9, 10, 11)
 *   Row 3: walk DOWN  (frames 12, 13, 14, 15)
 *
 * DEBUG HUD (top-left, fixed to screen):
 *   - FPS counter (updates every frame)
 *   - Hitbox toggle button (click or press F3)
 */

import Phaser from "phaser";
import { Client, Callbacks } from "@colyseus/sdk";
import { BACKEND_URL } from "../backend";

import { MAP_1, getHitboxRect } from "../maps/mapData";

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

  // ---- Map ----
  private currentMap = MAP_1;
  private mapObjects: Phaser.GameObjects.GameObject[] = [];

  // ---- Debug HUD (fixed to screen) ----
  private debugFPS!: Phaser.GameObjects.Text;
  private showHitboxes: boolean = false;
  private debugHitboxes: Phaser.GameObjects.Graphics | null = null;
  private hitboxToggleKey!: Phaser.Input.Keyboard.Key;
  private hitboxToggleButton!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: "game" });
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

    // ---- Render the map (tiles + obstacles + spawn + exit) ----
    this.renderMapTiles();
    this.renderMapEntities();
    this.renderDebugHitboxes();

    // ---- Debug HUD (FPS + hitbox toggle button) ----
    this.createDebugHUD();

    // ---- F3 to toggle hitbox overlay ----
    this.hitboxToggleKey = this.input.keyboard.addKey(
      Phaser.Input.Keyboard.KeyCodes.F3,
    );

    // ---- Connect to the Colyseus server ----
    await this.connect();

    if (!this.room) return;

    // ============================================================
    // COLYSEUS STATE LISTENERS (v0.17 API — use Callbacks.get())
    // ============================================================
    const callbacks = Callbacks.get(this.room as any) as any;

    // Player added to the room
    callbacks.onAdd("players", (player: any, sessionId: string) => {
      const sprite = this.add
        .sprite(player.x, player.y, "character_sheet", 0)
        .setDisplaySize(64, 64)
        .setDepth(2);

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
          this.currentMap.widthPx,
          this.currentMap.heightPx,
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
      this.room = await this.client.joinOrCreate("game_room");
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
  // MAP RENDERING
  // ============================================================

  /**
   * Render the floor tiles onto a canvas texture.
   * Tiles are drawn from the tile sprite sheet based on tile ID.
   */
  private renderMapTiles(): void {
    const map = this.currentMap;
    const { tileSize, tiles } = map;
    const rows = tiles.length;
    const cols = tiles[0].length;
    const ss = map.spriteSheets.tiles;

    const canvasKey = "map_floor_canvas";
    if (this.textures.exists(canvasKey)) {
      this.textures.remove(canvasKey);
    }

    const canvas = this.textures.createCanvas(
      canvasKey,
      cols * tileSize,
      rows * tileSize,
    );
    const tilesetImg = this.textures
      .get("map1_tiles")
      .getSourceImage() as HTMLImageElement;
    const ctx = canvas.getContext();

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const tileId = tiles[row][col];
        if (tileId === 0) continue;

        // tileId maps to sprite frame (tileId - 1)
        const frameIndex = tileId - 1;
        const frameCol = frameIndex % ss.columns;
        const frameRow = Math.floor(frameIndex / ss.columns);

        ctx.drawImage(
          tilesetImg,
          frameCol * ss.frameWidth,
          frameRow * ss.frameHeight, // source
          ss.frameWidth,
          ss.frameHeight,
          col * tileSize,
          row * tileSize, // destination
          tileSize,
          tileSize,
        );
      }
    }
    canvas.refresh();

    const floorImg = this.add
      .image(0, 0, canvasKey)
      .setOrigin(0, 0)
      .setDepth(0);
    this.mapObjects.push(floorImg);
  }

  /**
   * Render obstacles, player spawn point, and exit zone using sprite sheets.
   */
  private renderMapEntities(): void {
    const map = this.currentMap;

    // Obstacles — use spriteFrame from map data
    for (const obs of map.obstacles) {
      const img = this.add
        .image(
          obs.x + obs.width / 2,
          obs.y + obs.height / 2,
          "map1_obstacles",
          obs.spriteFrame,
        )
        .setDepth(1)
        .setDisplaySize(obs.width, obs.height);
      this.mapObjects.push(img);
    }

    // Player spawn point
    for (const spawn of map.playerSpawns) {
      const size = spawn.visualSize ?? 64;
      const img = this.add
        .image(spawn.x, spawn.y, "map1_tiles", map.playerSpawnTileFrame)
        .setDepth(1)
        .setDisplaySize(size, size);
      this.mapObjects.push(img);
    }

    // Exit zone
    const exit = map.exitPoint;
    const exitImg = this.add
      .image(
        exit.x + exit.width / 2,
        exit.y + exit.height / 2,
        "map1_tiles",
        map.exitTileFrame,
      )
      .setDepth(1)
      .setDisplaySize(exit.width, exit.height);
    this.mapObjects.push(exitImg);
  }

  // ============================================================
  // DEBUG HITBOX OVERLAY
  // ============================================================

  /**
   * Render debug hitbox overlays (toggle with F3 or button).
   *
   * Colors:
   *   RED (thick)   = obstacle collision hitbox (what actually blocks)
   *   YELLOW (thin) = player spawn visual bounds
   *   CYAN (thin)   = exit zone visual bounds
   *   WHITE (thin)  = map boundary
   */
  private renderDebugHitboxes(): void {
    const map = this.currentMap;
    const gfx = this.add.graphics().setDepth(10);

    // Obstacle collision hitboxes (RED thick)
    gfx.lineStyle(3, 0xff0000, 0.9);
    for (const obs of map.obstacles) {
      const hb = getHitboxRect(obs.x, obs.y, obs.width, obs.height, obs.hitbox);
      gfx.strokeRect(hb.x, hb.y, hb.width, hb.height);
    }

    // Player spawn bounds (YELLOW)
    gfx.lineStyle(2, 0xffff00, 0.6);
    for (const spawn of map.playerSpawns) {
      const size = spawn.visualSize ?? 64;
      gfx.strokeRect(spawn.x - size / 2, spawn.y - size / 2, size, size);
    }

    // Exit zone bounds (CYAN)
    gfx.lineStyle(2, 0x00ffff, 0.6);
    const exit = map.exitPoint;
    gfx.strokeRect(exit.x, exit.y, exit.width, exit.height);

    // Map boundary (WHITE)
    gfx.lineStyle(1, 0xffffff, 0.3);
    gfx.strokeRect(0, 0, map.widthPx, map.heightPx);

    // Start hidden
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
   *   5. Resolve obstacle collisions
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
      this.currentMap.widthPx,
    );
    this.currentPlayer.y = Phaser.Math.Clamp(
      this.currentPlayer.y,
      0,
      this.currentMap.heightPx,
    );

    // ---- Client-side obstacle collision (match server) ----
    const PLAYER_RADIUS = this.PLAYER_COLLISION_RADIUS;
    for (const obs of this.currentMap.obstacles) {
      const hb = getHitboxRect(obs.x, obs.y, obs.width, obs.height, obs.hitbox);

      const closestX = Phaser.Math.Clamp(
        this.currentPlayer.x,
        hb.x,
        hb.x + hb.width,
      );
      const closestY = Phaser.Math.Clamp(
        this.currentPlayer.y,
        hb.y,
        hb.y + hb.height,
      );

      const dx = this.currentPlayer.x - closestX;
      const dy = this.currentPlayer.y - closestY;
      const distSq = dx * dx + dy * dy;

      if (distSq < PLAYER_RADIUS * PLAYER_RADIUS) {
        // Push the player out along the smallest penetration axis
        const entityLeft = this.currentPlayer.x - PLAYER_RADIUS;
        const entityRight = this.currentPlayer.x + PLAYER_RADIUS;
        const entityTop = this.currentPlayer.y - PLAYER_RADIUS;
        const entityBottom = this.currentPlayer.y + PLAYER_RADIUS;

        const pushLeft = hb.x - entityRight;
        const pushRight = hb.x + hb.width - entityLeft;
        const pushUp = hb.y - entityBottom;
        const pushDown = hb.y + hb.height - entityTop;

        const pushes = [
          { dx: pushLeft, dy: 0 },
          { dx: pushRight, dy: 0 },
          { dx: 0, dy: pushUp },
          { dx: 0, dy: pushDown },
        ];
        pushes.sort((a, b) => Math.abs(a.dx + a.dy) - Math.abs(b.dx + b.dy));

        this.currentPlayer.x += pushes[0].dx;
        this.currentPlayer.y += pushes[0].dy;
      }
    }

    // ---- Interpolate remote players toward server position ----
    for (const sessionId in this.playerEntities) {
      if (sessionId === this.room.sessionId) continue;

      const entity = this.playerEntities[sessionId];
      const serverX = entity.data.get("serverX") as number;
      const serverY = entity.data.get("serverY") as number;

      if (serverX !== undefined && serverY !== undefined) {
        entity.x = Phaser.Math.Linear(entity.x, serverX, 0.2);
        entity.y = Phaser.Math.Linear(entity.y, serverY, 0.2);
      }
    }
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
