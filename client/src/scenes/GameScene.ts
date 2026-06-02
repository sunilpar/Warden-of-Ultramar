/**
 * Game Scene — Phaser Client for GameRoom
 * =========================================
 * This is the CLIENT-SIDE rendering layer. It does NOT run game logic.
 *
 * ARCHITECTURE: Server-Authoritative Multiplayer
 *   - The SERVER owns all game state (position, HP, AI, collisions)
 *   - The CLIENT only:
 *       1. Renders what the server tells it
 *       2. Sends player input to the server
 *       3. Interpolates between server updates for smooth visuals
 *       4. Draws health bars and plays animations
 *
 * CLIENT-SIDE PREDICTION:
 *   For the LOCAL player, we predict movement by applying input
 *   immediately (before the server confirms). The server's position
 *   is the "remote ref" — if they differ, we snap to the server.
 *   This makes movement feel responsive despite network latency.
 *
 * INTERPOLATION:
 *   For OTHER players and enemies, we smoothly interpolate toward
 *   the server position each frame. This prevents jittery teleporting.
 *   Bullets move fast, so we snap them directly (no interpolation).
 *
 * BULLET RENDERING:
 *   Bullets have directionX/directionY from the server.
 *   We use these to rotate the bullet sprite so it faces its travel
 *   direction. This gives the long rifle bullet visual effect.
 */

import Phaser from "phaser";
import { Room, Client, Callbacks } from "@colyseus/sdk";
import { BACKEND_URL } from "../backend";

// Import server types for strong-typing Colyseus SDK
import type server from "../../../server/src/app.config";
import type { InputData } from "../../../server/src/schema/Player";
import type { GameRoom } from "../../../server/src/rooms/GameRoom";

// Card system
import { CardSlotManager, CardHUD } from "../cards/CardHUD";
import { CardActionContext } from "../cards/CardTypes";

// Map system
import { MAP_1, getHitboxRect } from "../maps/mapData";

// ============================================================
// Entity interfaces — track visual objects for each entity
// ============================================================

interface EnemyEntity {
  sprite: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite;
  hpBarBg: Phaser.GameObjects.Graphics;
  hpBarFill: Phaser.GameObjects.Graphics;
  serverX: number;
  serverY: number;
  lastHp: number;
  /** Tyranid-specific: facing direction ("left" or "right") */
  facing?: "left" | "right";
  /** Tyranid-specific: true when playing attack animation */
  isAttacking?: boolean;
  /** Enemy type for animation logic */
  enemyType?: string;
}

interface BulletEntity {
  sprite: Phaser.GameObjects.Shape; // Arc for enemy, Rectangle for player
  serverX: number;
  serverY: number;
}

interface PlayerEntity {
  sprite: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
  hpBarBg: Phaser.GameObjects.Graphics;
  hpBarFill: Phaser.GameObjects.Graphics;
  hpText: Phaser.GameObjects.Text;
}

// ============================================================
// Game Scene
// ============================================================

export class GameScene extends Phaser.Scene {
  client = new Client<typeof server>(BACKEND_URL);
  room!: Room<GameRoom>;

  // Entity tracking
  currentPlayer!: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
  playerEntities: { [sessionId: string]: PlayerEntity } = {};
  enemyEntities: { [enemyId: string]: EnemyEntity } = {};
  bulletEntities: { [bulletId: string]: BulletEntity } = {};

  // Debug HUD (fixed to screen, top-left)
  debugFPS!: Phaser.GameObjects.Text;
  private showHitboxes: boolean = false; // Start OFF, toggle with button or F3
  private hitboxToggleButton!: Phaser.GameObjects.Text;
  private hitboxToggleKey!: Phaser.Input.Keyboard.Key;

  // Client-side prediction visual references
  localRef!: Phaser.GameObjects.Rectangle;
  remoteRef!: Phaser.GameObjects.Rectangle;

  // Character animation state
  private animationsCreated: boolean = false;
  private tyranidAnimationsCreated: boolean = false;
  private lastDirection: string = "down"; // default facing direction

  // Game over state
  gameOverOverlay: Phaser.GameObjects.Container | null = null;
  isGameOver: boolean = false;
  deathBoxSprite: Phaser.GameObjects.Image | null = null;

  // Card system
  cardSlotManager!: CardSlotManager;
  cardHUD!: CardHUD;

  // Map rendering
  private currentMap = MAP_1;
  private debugHitboxes: Phaser.GameObjects.Graphics | null = null;

  // Card input keys (space, 1, 2)
  cardKeys!: {
    space: Phaser.Input.Keyboard.Key;
    one: Phaser.Input.Keyboard.Key;
    two: Phaser.Input.Keyboard.Key;
  };

  // Input
  wasdKeys!: {
    left: Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
    up: Phaser.Input.Keyboard.Key;
    down: Phaser.Input.Keyboard.Key;
  };

  inputPayload: InputData = {
    left: false,
    right: false,
    up: false,
    down: false,
    tick: undefined,
  };

  // Fixed timestep for client-side prediction
  elapsedTime = 0;
  fixedTimeStep = 1000 / 60;
  currentTick: number = 0;

  /** Player speed — must match server config for accurate prediction */
  private readonly PLAYER_SPEED = 120; // pixels per second (matches GAME_CONFIG.PLAYER.SPEED)

  /** Player hitbox — independent of sprite size.
   * MUST match server GAME_CONFIG.PLAYER values for accurate prediction. */
  private readonly PLAYER_HITBOX_WIDTH = 40;
  private readonly PLAYER_HITBOX_HEIGHT = 40;
  private readonly PLAYER_COLLISION_RADIUS = 20; // matches GAME_CONFIG.PLAYER.COLLISION_RADIUS

  constructor() {
    super({ key: "game" });
  }

  // ============================================================
  // INITIALIZATION
  // ============================================================

  async create() {
    // Set up keyboard input
    this.wasdKeys = this.input.keyboard.addKeys({
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
      up: Phaser.Input.Keyboard.KeyCodes.W,
      down: Phaser.Input.Keyboard.KeyCodes.S,
    }) as any;

    // ---- Render the tile-based map ----
    this.renderMapTiles();
    this.renderMapEntities();
    // Hitboxes start hidden — rendered but invisible until toggled
    this.renderDebugHitboxes();
    if (this.debugHitboxes) {
      this.debugHitboxes.setVisible(this.showHitboxes);
    }

    // ---- Debug HUD (fixed to screen top-left) ----
    this.createDebugHUD();

    // Toggle key: F3
    this.hitboxToggleKey = this.input.keyboard.addKey(
      Phaser.Input.Keyboard.KeyCodes.F3,
    );

    // ============================================================
    // CARD SYSTEM SETUP
    // ============================================================

    // Initialize card slot manager and HUD
    this.cardSlotManager = new CardSlotManager();
    this.cardSlotManager.equipCard(0, "bolt_gun"); // Slot 0 = Left Click
    this.cardSlotManager.equipCard(1, "pulse"); // Slot 1 = Right Click
    this.cardSlotManager.equipCard(3, "heal"); // Slot 3 = Key "1"
    this.cardHUD = new CardHUD(this, this.cardSlotManager);

    // Card input keys
    this.cardKeys = {
      space: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
      one: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ONE),
      two: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.TWO),
    };

    // ---- Card input: Left Click (slot 0) ----
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (this.isGameOver || !this.currentPlayer) return;

      const slotIndex = pointer.leftButtonDown()
        ? this.cardSlotManager.getSlotByBinding("leftClick")
        : pointer.rightButtonDown()
          ? this.cardSlotManager.getSlotByBinding("rightClick")
          : -1;

      if (slotIndex < 0) return;

      this.cardSlotManager.activateSlot(slotIndex, {
        scene: this,
        pointer: { worldX: pointer.worldX, worldY: pointer.worldY },
        room: this.room,
        player: this.currentPlayer,
      });
    });

    // Disable right-click context menu for RMB card slot
    this.input.mouse.disableContextMenu();

    // Connect to server
    await this.connect();

    const callbacks = Callbacks.get(this.room);

    // ============================================================
    // PLAYER HANDLERS
    // ============================================================

    callbacks.onAdd("players", (player, sessionId) => {
      const entity = this.physics.add
        .sprite(player.x, player.y, "character_sheet", 0)
        .setDisplaySize(64, 64)
        .setDepth(2);

      // Create character animations once (shared across all player sprites)
      if (!this.animationsCreated) {
        this.createCharacterAnimations();
        this.animationsCreated = true;
      }

      // Start with idle (first frame of walk-down animation)
      entity.anims.play("char_idle_down");

      // HP bar graphics
      const hpBarBg = this.add.graphics();
      const hpBarFill = this.add.graphics();
      const hpText = this.add
        .text(0, 0, "", {
          color: "#ffffff",
          fontSize: "10px",
          fontFamily: "Georgia",
          stroke: "#000000",
          strokeThickness: 2,
        })
        .setOrigin(0.5);

      this.playerEntities[sessionId] = {
        sprite: entity,
        hpBarBg,
        hpBarFill,
        hpText,
      };

      if (sessionId === this.room.sessionId) {
        // ---- LOCAL PLAYER ----
        this.currentPlayer = entity;

        // Camera follows the local player
        this.cameras.main.startFollow(entity, true, 0.1, 0.1);
        this.cameras.main.setBounds(
          0,
          0,
          this.currentMap.widthPx,
          this.currentMap.heightPx,
        );

        // Visual references for prediction debugging
        // Uses PLAYER_HITBOX dimensions (independent of sprite size)
        this.localRef = this.add.rectangle(0, 0, this.PLAYER_HITBOX_WIDTH, this.PLAYER_HITBOX_HEIGHT);
        this.localRef.setStrokeStyle(1, 0x00ff00); // green = predicted
        this.localRef.setVisible(this.showHitboxes); // only visible when toggle is ON
        this.remoteRef = this.add.rectangle(0, 0, this.PLAYER_HITBOX_WIDTH, this.PLAYER_HITBOX_HEIGHT);
        this.remoteRef.setStrokeStyle(1, 0xff0000); // red = server confirmed
        this.remoteRef.setVisible(this.showHitboxes); // only visible when toggle is ON

        // Update remote reference when server sends new position
        // Also snap client prediction on teleport (exit zone, respawn, etc.)
        callbacks.onChange(player, () => {
          this.remoteRef.x = player.x;
          this.remoteRef.y = player.y;

          // Reconcile: if server position is far from prediction, snap
          // (happens on exit zone teleport, respawn, or significant desync)
          if (this.currentPlayer) {
            const dx = Math.abs(player.x - this.currentPlayer.x);
            const dy = Math.abs(player.y - this.currentPlayer.y);
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
          entity.setData("serverX", player.x);
          entity.setData("serverY", player.y);
        });
      }
    });

    callbacks.onRemove("players", (player, sessionId) => {
      const playerEntity = this.playerEntities[sessionId];
      if (playerEntity) {
        playerEntity.sprite.destroy();
        playerEntity.hpBarBg.destroy();
        playerEntity.hpBarFill.destroy();
        playerEntity.hpText.destroy();
        delete this.playerEntities[sessionId];
      }
    });

    // ============================================================
    // ENEMY HANDLERS
    // ============================================================

    callbacks.onAdd("enemies", (enemy, enemyId) => {
      let sprite: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite;

      if (enemy.enemyType === "tyranid") {
        // Tyranid: animated sprite using sprite sheet
        if (!this.tyranidAnimationsCreated) {
          this.createTyranidAnimations();
          this.tyranidAnimationsCreated = true;
        }
        sprite = this.add
          .sprite(enemy.x, enemy.y, "tyranid_sheet", 0)
          .setDisplaySize(48, 48)
          .setDepth(2);
        (sprite as Phaser.GameObjects.Sprite).anims.play("tyranid_walk_left");
      } else {
        // Ork or Elder: static image
        const spriteKey = enemy.enemyType === "ork" ? "orck" : "elder";
        sprite = this.add
          .image(enemy.x, enemy.y, spriteKey)
          .setDisplaySize(32, 32)
          .setDepth(2);
      }

      const hpBarBg = this.add.graphics();
      const hpBarFill = this.add.graphics();

      this.enemyEntities[enemyId] = {
        sprite,
        hpBarBg,
        hpBarFill,
        serverX: enemy.x,
        serverY: enemy.y,
        lastHp: enemy.hp,
        enemyType: enemy.enemyType,
        facing: "left",
        isAttacking: false,
      };

      // Update server position for interpolation + detect flinch/attack on HP drop
      callbacks.onChange(enemy, () => {
        if (this.enemyEntities[enemyId]) {
          this.enemyEntities[enemyId].serverX = enemy.x;
          this.enemyEntities[enemyId].serverY = enemy.y;

          // Detect damage: HP dropped → play directional flinch
          if (enemy.hp < this.enemyEntities[enemyId].lastHp) {
            this.showEnemyFlinch(enemyId);
          }
          this.enemyEntities[enemyId].lastHp = enemy.hp;
        }
      });
    });

    callbacks.onRemove("enemies", (enemy, enemyId) => {
      const enemyEntity = this.enemyEntities[enemyId];
      if (enemyEntity) {
        // Show blood splash at enemy position
        this.showBloodSplash(enemyEntity.sprite.x, enemyEntity.sprite.y);

        enemyEntity.sprite.destroy();
        enemyEntity.hpBarBg.destroy();
        enemyEntity.hpBarFill.destroy();
        delete this.enemyEntities[enemyId];
      }
    });

    // ============================================================
    // BULLET HANDLERS
    // ============================================================

    callbacks.onAdd("bullets", (bullet, bulletId) => {
      let sprite: Phaser.GameObjects.Shape;

      if (bullet.isPlayerBullet) {
        // Player bullet: light blue rectangle (bolter round)
        sprite = this.add
          .rectangle(bullet.x, bullet.y, 12, 4, 0x66ccff)
          .setDepth(5);
      } else {
        // Enemy bullet: purple circle (Ork rifle)
        sprite = this.add.circle(bullet.x, bullet.y, 4, 0x9933ff).setDepth(5);
      }

      /**
       * BULLET ROTATION:
       * The bullet has directionX and directionY from the server.
       * We calculate the angle and rotate the sprite so it faces
       * its travel direction. This gives the visual effect of a
       * long rifle bullet flying through the air.
       *
       * For a long bullet sprite, you would replace the circle
       * with an image and it would naturally look like a rifle round.
       */
      const angle = Math.atan2(bullet.directionY, bullet.directionX);
      sprite.setRotation(angle);

      this.bulletEntities[bulletId] = {
        sprite,
        serverX: bullet.x,
        serverY: bullet.y,
      };

      // Update position and rotation
      callbacks.onChange(bullet, () => {
        if (this.bulletEntities[bulletId]) {
          this.bulletEntities[bulletId].serverX = bullet.x;
          this.bulletEntities[bulletId].serverY = bullet.y;
          // Update rotation if direction changes
          const angle = Math.atan2(bullet.directionY, bullet.directionX);
          this.bulletEntities[bulletId].sprite.setRotation(angle);
        }
      });
    });

    callbacks.onRemove("bullets", (bullet, bulletId) => {
      const bulletEntity = this.bulletEntities[bulletId];
      if (bulletEntity) {
        bulletEntity.sprite.destroy();
        delete this.bulletEntities[bulletId];
      }
    });

    // ============================================================
    // CLAW SLASH HANDLERS
    // ============================================================

    callbacks.onAdd("clawSlashes", (claw, clawId) => {
      // Show a red cone slash visual effect
      this.showClawSlashEffect(claw.x, claw.y, claw.directionX, claw.directionY, claw.ownerId);

      // Trigger tyranid attack animation for the owner
      const enemyEntity = this.enemyEntities[claw.ownerId];
      if (enemyEntity && enemyEntity.enemyType === "tyranid") {
        const sprite = enemyEntity.sprite as Phaser.GameObjects.Sprite;
        sprite.anims.play("tyranid_attack_left", true);
        // Set facing direction from claw direction
        enemyEntity.facing = claw.directionX > 0 ? "right" : "left";
        sprite.setFlipX(enemyEntity.facing === "right");
        enemyEntity.isAttacking = true;
        // Return to walk after attack animation completes (4 frames at 8fps = 500ms)
        this.time.delayedCall(500, () => {
          if (enemyEntity) {
            enemyEntity.isAttacking = false;
          }
        });
      }
    });

    callbacks.onRemove("clawSlashes", (claw, clawId) => {
      // Claw slashes are short-lived, cleanup handled by the visual effect tween
    });

    // Camera bounds set when player joins (see player handler above)
  }

  // ============================================================
  // MAP RENDERING
  // ============================================================

  /**
   * Render floor tiles from the map data using a canvas texture.
   */
  private renderMapTiles(): void {
    const map = this.currentMap;
    const { tileSize, tiles, tilesetColumns } = map;
    const rows = tiles.length;
    const cols = tiles[0].length;

    const canvas = this.textures.createCanvas(
      "map_floor_canvas",
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

        const dx = col * tileSize;
        const dy = row * tileSize;

        // Draw the ENTIRE spritesheet image scaled to fit one tile
        // The full maptileBasic.png (all 4 variations) becomes one game tile
        ctx.drawImage(
          tilesetImg,
          0,
          0,
          tilesetImg.width,
          tilesetImg.height,
          dx,
          dy,
          tileSize,
          tileSize,
        );
      }
    }
    canvas.refresh();

    this.add.image(0, 0, "map_floor_canvas").setOrigin(0, 0).setDepth(0);
  }

  /**
   * Render obstacles, spawn points, and exit as sprites.
   * DEPTH ORDER:
   *   0 = floor tiles
   *   1 = map entities (obstacles, spawns, exit) — ABOVE floor, BELOW players
   *   2 = players, enemies
   *   5 = bullets
   */
  private renderMapEntities(): void {
    const map = this.currentMap;

    for (const obs of map.obstacles) {
      const key =
        obs.obstacleType === "big"
          ? "map1_obstacle_big"
          : "map1_obstacle_small";
      this.add
        .image(obs.x + obs.width / 2, obs.y + obs.height / 2, key)
        .setDepth(1)
        .setDisplaySize(obs.width, obs.height);
    }

    for (const spawn of map.playerSpawns) {
      const size = spawn.visualSize ?? 32;
      this.add
        .image(spawn.x, spawn.y, "map1_spawn_player")
        .setDepth(1)
        .setDisplaySize(size, size);
    }

    const enemySpawnKeys = [
      "map1_obstacle_big",
      "map1_spawn_enemy2",
      "map1_spawn_enemy3",
    ];
    map.enemySpawnZones.forEach((zone, i) => {
      const key = enemySpawnKeys[i % enemySpawnKeys.length];
      this.add
        .image(zone.x + zone.width / 2, zone.y + zone.height / 2, key)
        .setDepth(1)
        .setDisplaySize(zone.width, zone.height);
    });

    const exit = map.exitPoint;
    this.add
      .image(exit.x + exit.width / 2, exit.y + exit.height / 2, "map1_exit")
      .setDepth(1)
      .setDisplaySize(exit.width, exit.height);
  }

  /**
   * Render debug hitbox overlays.
   *
   * TWO LAYERS per entity:
   *   1. VISUAL bounds (original colors, thinner line) — the sprite size
   *   2. SERVER HITBOX (RED, thicker line) — the actual collision rect
   *
   * Colors:
   *   RED (thick)     = server collision hitbox (what actually blocks movement)
   *   RED (thin)      = obstacle visual bounds
   *   YELLOW (thin)   = player spawn visual bounds
   *   ORANGE (thin)   = enemy spawn zone visual bounds
   *   CYAN (thin)     = exit zone visual bounds
   *   WHITE           = map boundary
   */
  private renderDebugHitboxes(): void {
    const map = this.currentMap;
    const gfx = this.add.graphics().setDepth(10);

    // ---- Layer 1: Visual bounds (original colors, thin line) ----

    // Obstacles visual bounds (RED thin)
    gfx.lineStyle(1, 0xff0000, 0.4);
    for (const obs of map.obstacles) {
      gfx.strokeRect(obs.x, obs.y, obs.width, obs.height);
    }

    // Player spawns visual bounds (YELLOW)
    gfx.lineStyle(2, 0xffff00, 0.6);
    for (const spawn of map.playerSpawns) {
      const size = spawn.visualSize ?? 32;
      gfx.strokeRect(spawn.x - size / 2, spawn.y - size / 2, size, size);
    }

    // Enemy spawn zones visual bounds (ORANGE thin)
    gfx.lineStyle(1, 0xffaa00, 0.4);
    for (const zone of map.enemySpawnZones) {
      gfx.strokeRect(zone.x, zone.y, zone.width, zone.height);
    }

    // Exit zone visual bounds (CYAN thin)
    gfx.lineStyle(1, 0x00ffff, 0.4);
    const exit = map.exitPoint;
    gfx.strokeRect(exit.x, exit.y, exit.width, exit.height);

    // ---- Layer 2: Server collision hitboxes (RED thick) ----
    // These are the ACTUAL collision rectangles that block movement/bullets.

    // Obstacle hitboxes (RED thick)
    gfx.lineStyle(3, 0xff0000, 0.9);
    for (const obs of map.obstacles) {
      const hb = getHitboxRect(obs.x, obs.y, obs.width, obs.height, obs.hitbox);
      gfx.strokeRect(hb.x, hb.y, hb.width, hb.height);
    }

    // Enemy spawn zone hitboxes (RED thick)
    gfx.lineStyle(3, 0xff0000, 0.9);
    for (const zone of map.enemySpawnZones) {
      const hb = getHitboxRect(
        zone.x,
        zone.y,
        zone.width,
        zone.height,
        zone.hitbox,
      );
      gfx.strokeRect(hb.x, hb.y, hb.width, hb.height);
    }

    // Exit zone hitbox (RED thick, slightly different shade to distinguish)
    gfx.lineStyle(3, 0xff4444, 0.9);
    const exitHb = getHitboxRect(
      exit.x,
      exit.y,
      exit.width,
      exit.height,
      exit.hitbox,
    );
    gfx.strokeRect(exitHb.x, exitHb.y, exitHb.width, exitHb.height);

    // Map boundary (WHITE)
    gfx.lineStyle(1, 0xffffff, 0.3);
    gfx.strokeRect(0, 0, map.widthPx, map.heightPx);

    this.debugHitboxes = gfx;
  }

  // ============================================================
  // DEBUG HUD (FPS + Hitbox Toggle)
  // ============================================================

  /**
   * Create the debug HUD fixed to the top-left of the screen.
   * Contains:
   *   - FPS counter
   *   - Hitbox toggle button (click or press F3)
   *
   * Uses setScrollFactor(0) so it stays in place while the camera moves.
   */
  private createDebugHUD(): void {
    const hudX = 10; // 10px from left edge

    // FPS counter (top-left)
    this.debugFPS = this.add
      .text(hudX, 10, "", {
        color: "#00ff00",
        fontSize: "14px",
        fontFamily: "monospace",
        stroke: "#000000",
        strokeThickness: 3,
      })
      .setOrigin(0, 0) // Left-aligned
      .setScrollFactor(0) // Fixed to screen
      .setDepth(999);

    // Hitbox toggle button (below FPS)
    const toggleLabel = this.showHitboxes
      ? "[HITBOXES: ON]"
      : "[HITBOXES: OFF]";
    this.hitboxToggleButton = this.add
      .text(hudX, 30, toggleLabel, {
        color: this.showHitboxes ? "#00ff00" : "#888888",
        fontSize: "12px",
        fontFamily: "monospace",
        stroke: "#000000",
        strokeThickness: 3,
        backgroundColor: this.showHitboxes ? "#003300aa" : "#333333aa",
        padding: { x: 6, y: 3 },
      })
      .setOrigin(0, 0) // Left-aligned
      .setScrollFactor(0) // Fixed to screen
      .setDepth(999)
      .setInteractive({ useHandCursor: true })
      .on("pointerdown", () => {
        this.toggleHitboxes();
      });
  }

  /**
   * Toggle hitbox overlay visibility AND player prediction hitbox rectangles.
   * Called by the HUD button click or F3 key.
   */
  private toggleHitboxes(): void {
    this.showHitboxes = !this.showHitboxes;

    // Show/hide the map hitbox graphics
    if (this.debugHitboxes) {
      this.debugHitboxes.setVisible(this.showHitboxes);
    }

    // Show/hide the player prediction hitbox rectangles (localRef + remoteRef)
    if (this.localRef) {
      this.localRef.setVisible(this.showHitboxes);
    }
    if (this.remoteRef) {
      this.remoteRef.setVisible(this.showHitboxes);
    }

    // Update button label and style
    const label = this.showHitboxes ? "[HITBOXES: ON]" : "[HITBOXES: OFF]";
    this.hitboxToggleButton.setText(label);
    this.hitboxToggleButton.setColor(this.showHitboxes ? "#00ff00" : "#888888");
    this.hitboxToggleButton.setBackgroundColor(
      this.showHitboxes ? "#003300aa" : "#333333aa",
    );
  }

  // ============================================================
  // CHARACTER ANIMATION
  // ============================================================

  /**
   * Create walking animations from the 4x4 sprite sheet.
   *
   * Sprite sheet layout (4x4 grid, each frame 256x256):
   *   Row 0: walk RIGHT  (frames 0, 1, 2, 3)
   *   Row 1: walk LEFT   (frames 4, 5, 6, 7)
   *   Row 2: walk UP     (frames 8, 9, 10, 11)
   *   Row 3: walk DOWN   (frames 12, 13, 14, 15)
   */
  private createCharacterAnimations(): void {
    const directions = [
      { dir: "right", startFrame: 0 },
      { dir: "left", startFrame: 4 },
      { dir: "up", startFrame: 8 },
      { dir: "down", startFrame: 12 },
    ];

    for (const { dir, startFrame } of directions) {
      // Walk animation (4 frames, looping)
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
   * Update the local player's animation based on current input direction.
   * Plays walk animation when moving, idle animation when standing still.
   */
  private updatePlayerAnimation(): void {
    if (!this.currentPlayer) return;

    let moving = false;
    let newDirection = this.lastDirection;

    // Determine direction (last pressed wins for diagonals)
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

    // Play appropriate animation
    const animKey = moving
      ? `char_walk_${newDirection}`
      : `char_idle_${newDirection}`;

    const currentAnim = this.currentPlayer.anims.currentAnim;
    if (!currentAnim || currentAnim.key !== animKey) {
      this.currentPlayer.anims.play(animKey, true);
    }
  }

  // ============================================================
  // TYRANID ANIMATION
  // ============================================================

  /**
   * Create tyranid animations from the 2x4 sprite sheet.
   *
   * Sprite sheet layout (2 rows x 4 cols, each frame 64x64):
   *   Row 0: walk animation, left-facing (frames 0, 1, 2, 3)
   *   Row 1: attack animation, left-facing (frames 4, 5, 6, 7)
   *
   * For right-facing, we flip the sprite horizontally via setFlipX.
   */
  private createTyranidAnimations(): void {
    // Walk left (row 0, frames 0-3)
    this.anims.create({
      key: "tyranid_walk_left",
      frames: this.anims.generateFrameNumbers("tyranid_sheet", {
        start: 0,
        end: 3,
      }),
      frameRate: 8,
      repeat: -1,
    });

    // Attack left (row 1, frames 4-7) — play once per attack
    this.anims.create({
      key: "tyranid_attack_left",
      frames: this.anims.generateFrameNumbers("tyranid_sheet", {
        start: 4,
        end: 7,
      }),
      frameRate: 8,
      repeat: 0,
    });
  }

  /**
   * Update tyranid enemy animations each tick.
   * Determines facing direction from movement and plays appropriate animation.
   * For right-facing: flip the sprite horizontally.
   */
  private updateTyranidAnimations(): void {
    for (const enemyId in this.enemyEntities) {
      const entity = this.enemyEntities[enemyId];
      if (entity.enemyType !== "tyranid") continue;

      const sprite = entity.sprite as Phaser.GameObjects.Sprite;

      // When attacking, DON'T touch facing/flip/animation at all
      if (entity.isAttacking) continue;

      // Determine facing direction from server position delta
      const dx = entity.serverX - sprite.x;
      if (Math.abs(dx) > 1) {
        entity.facing = dx > 0 ? "right" : "left";
      }

      // Flip sprite based on facing direction
      sprite.setFlipX(entity.facing === "right");

      // Play walk animation
      const walkAnim = "tyranid_walk_left";
      if (sprite.anims && sprite.anims.currentAnim?.key !== walkAnim) {
        sprite.anims.play(walkAnim, true);
      }
    }
  }

  // ============================================================
  // CLAW SLASH VISUAL EFFECT
  // ============================================================

  /**
   * Show a red cone slash effect at the given position and direction.
   * The cone represents the melee attack arc.
   *
   * @param x - Origin X (attacker position)
   * @param y - Origin Y (attacker position)
   * @param dirX - Normalized direction X
   * @param dirY - Normalized direction Y
   * @param ownerId - The enemy that triggered the claw (for future use)
   */
  private showClawSlashEffect(
    x: number, y: number,
    dirX: number, dirY: number,
    ownerId: string
  ): void {
    const CLAW_RANGE = 50;
    const HALF_ANGLE = Math.PI / 4; // 45 degrees

    // Calculate the arc's start and end angles
    const centerAngle = Math.atan2(dirY, dirX);
    const startAngle = centerAngle - HALF_ANGLE;
    const endAngle = centerAngle + HALF_ANGLE;

    // Create a filled arc (cone shape) using Graphics
    const gfx = this.add.graphics().setDepth(4);

    // Draw filled cone
    gfx.fillStyle(0xff2200, 0.6);
    gfx.beginPath();
    gfx.moveTo(x, y);
    gfx.arc(x, y, CLAW_RANGE, startAngle, endAngle, false);
    gfx.closePath();
    gfx.fillPath();

    // Draw arc outline
    gfx.lineStyle(2, 0xff4400, 0.9);
    gfx.beginPath();
    gfx.arc(x, y, CLAW_RANGE, startAngle, endAngle, false);
    gfx.strokePath();

    // Draw slash lines inside the cone for a more dynamic look
    gfx.lineStyle(1, 0xff6600, 0.7);
    for (let i = 0; i < 3; i++) {
      const angle = startAngle + (endAngle - startAngle) * (i / 2);
      gfx.beginPath();
      gfx.moveTo(x, y);
      gfx.lineTo(
        x + Math.cos(angle) * CLAW_RANGE * (0.6 + Math.random() * 0.4),
        y + Math.sin(angle) * CLAW_RANGE * (0.6 + Math.random() * 0.4),
      );
      gfx.strokePath();
    }

    // Animate: fade out and expand slightly, then destroy
    this.tweens.add({
      targets: gfx,
      alpha: 0,
      duration: 300,
      ease: "Power2",
      onComplete: () => {
        gfx.destroy();
      },
    });
  }

  // ============================================================
  // BLOOD SPLASH EFFECT
  // ============================================================

  /**
   * Show a brief blood splash when an enemy dies.
   * Creates expanding red circles that fade out quickly.
   */
  showBloodSplash(x: number, y: number) {
    const particleCount = 3 + Math.floor(Math.random() * 3);

    for (let i = 0; i < particleCount; i++) {
      const offsetX = (Math.random() - 0.5) * 20;
      const offsetY = (Math.random() - 0.5) * 20;
      const size = 4 + Math.random() * 8;

      const particle = this.add
        .circle(x + offsetX, y + offsetY, size, 0xcc0000, 0.8)
        .setDepth(4);

      this.tweens.add({
        targets: particle,
        alpha: 0,
        scaleX: 1.5,
        scaleY: 1.5,
        duration: 400,
        ease: "Power2",
        onComplete: () => {
          particle.destroy();
        },
      });
    }

    // Main splash ring
    const splash = this.add.circle(x, y, 8, 0x880000, 0.6).setDepth(4);
    this.tweens.add({
      targets: splash,
      alpha: 0,
      scaleX: 3,
      scaleY: 3,
      duration: 500,
      ease: "Power2",
      onComplete: () => {
        splash.destroy();
      },
    });
  }

  // ============================================================
  // ENEMY FLINCH EFFECT
  // ============================================================

  /**
   * Show a directional flinch when an enemy takes damage.
   *
   * HOW IT WORKS:
   *   1. Calculate direction from local player → enemy (bullet travel direction)
   *   2. Push the enemy sprite in that direction (away from the attacker)
   *   3. Flash the sprite red briefly
   *   4. The interpolation in fixedTick naturally pulls the sprite back
   *      to serverX/serverY, creating a smooth snapback
   *
   * PURELY CLIENT-SIDE: The server position is never changed.
   * This is a cosmetic effect only.
   */
  showEnemyFlinch(enemyId: string) {
    const enemyEntity = this.enemyEntities[enemyId];
    if (!enemyEntity || !this.currentPlayer) return;

    const sprite = enemyEntity.sprite;

    // Direction from player to enemy (bullet impact direction)
    const dx = sprite.x - this.currentPlayer.x;
    const dy = sprite.y - this.currentPlayer.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Normalize; fallback to (0, -1) if positions overlap
    const dirX = dist > 0 ? dx / dist : 0;
    const dirY = dist > 0 ? dy / dist : -1;

    const FLINCH_DISTANCE = 4; // pixels to push
    const FLINCH_DURATION = 120; // ms for knockback
    const TINT_DURATION = 150; // ms for red flash

    // Red tint flash
    sprite.setTint(0xff4444);

    // Kill any active flinch tween on this sprite to avoid stacking
    this.tweens.killTweensOf(sprite);

    // Push sprite in the bullet's travel direction (away from player)
    this.tweens.add({
      targets: sprite,
      x: sprite.x + dirX * FLINCH_DISTANCE,
      y: sprite.y + dirY * FLINCH_DISTANCE,
      duration: FLINCH_DURATION,
      ease: "Quad.easeOut",
      onComplete: () => {
        // Clear tint after flinch
        sprite.clearTint();
      },
    });
  }

  // ============================================================
  // CONNECTION
  // ============================================================

  async connect() {
    const connectionStatusText = this.add
      .text(0, 0, "Trying to connect with the server...")
      .setStyle({ color: "#ff0000" })
      .setPadding(4);

    try {
      // Connect to the new refactored GameRoom
      this.room = await this.client.joinOrCreate("game_room", {});
      connectionStatusText.destroy();
    } catch (e) {
      connectionStatusText.text = "Could not connect with the server.";
    }
  }

  // ============================================================
  // GAME OVER / RESPAWN UI
  // ============================================================

  showGameOver() {
    if (this.isGameOver) return;
    this.isGameOver = true;

    const { centerX, centerY } = this.cameras.main;

    const bg = this.add.rectangle(
      centerX,
      centerY,
      this.cameras.main.width,
      this.cameras.main.height,
      0x000000,
      0.7,
    );

    const gameOverText = this.add
      .text(centerX, centerY - 40, "GAME OVER", {
        color: "#ff0000",
        fontSize: "64px",
        fontFamily: "Georgia",
        stroke: "#000000",
        strokeThickness: 6,
      })
      .setOrigin(0.5);

    const respawnButton = this.add
      .text(centerX, centerY + 40, "Respawn", {
        color: "#efbf68",
        fontSize: "24px",
        fontFamily: "Georgia",
        stroke: "#000000",
        strokeThickness: 3,
        backgroundColor: "#333333",
        padding: { x: 20, y: 10 },
      })
      .setOrigin(0.5)
      .setInteractive()
      .on("pointerdown", () => {
        this.room.send(1); // Send respawn request to server
      });

    this.gameOverOverlay = this.add.container(0, 0, [
      bg,
      gameOverText,
      respawnButton,
    ]);
    this.gameOverOverlay.setDepth(1000);
  }

  respawnPlayer() {
    if (!this.isGameOver) return;
    this.isGameOver = false;

    if (this.gameOverOverlay) {
      this.gameOverOverlay.destroy();
      this.gameOverOverlay = null;
    }

    const sessionId = this.room.sessionId;
    const playerEntity = this.playerEntities[sessionId];
    if (playerEntity) {
      playerEntity.sprite.setVisible(true);
      playerEntity.hpBarBg.setVisible(true);
      playerEntity.hpBarFill.setVisible(true);
      playerEntity.hpText.setVisible(true);
    }

    if (this.localRef) this.localRef.setVisible(this.showHitboxes);
    if (this.remoteRef) this.remoteRef.setVisible(this.showHitboxes);

    if (this.deathBoxSprite) {
      this.deathBoxSprite.destroy();
      this.deathBoxSprite = null;
    }
  }

  hidePlayerEntity(sessionId: string) {
    const playerEntity = this.playerEntities[sessionId];
    if (playerEntity) {
      if (sessionId === this.room.sessionId && !this.deathBoxSprite) {
        this.deathBoxSprite = this.add
          .image(playerEntity.sprite.x, playerEntity.sprite.y, "deathbox")
          .setDisplaySize(48, 48)
          .setDepth(1);
      }
      playerEntity.sprite.setVisible(false);
      playerEntity.hpBarBg.setVisible(false);
      playerEntity.hpBarFill.setVisible(false);
      playerEntity.hpText.setVisible(false);
    }
  }

  // ============================================================
  // HP BAR RENDERING
  // ============================================================

  /**
   * Draw a player's health bar below their sprite.
   *
   * WHY CLIENT-SIDE: The server only sends HP numbers.
   * The client decides how to visually display them.
   * This keeps rendering logic out of the server.
   */
  drawPlayerHpBar(playerEntity: PlayerEntity, hp: number, maxHp: number) {
    const sprite = playerEntity.sprite;
    const barWidth = 48;
    const barHeight = 4;
    const offsetY = sprite.displayHeight / 2 + 14;

    const x = sprite.x - barWidth / 2;
    const y = sprite.y + offsetY;

    // Background (dark bar showing max HP)
    playerEntity.hpBarBg.clear();
    playerEntity.hpBarBg.fillStyle(0x333333, 0.8);
    playerEntity.hpBarBg.fillRect(x, y, barWidth, barHeight);

    // Fill (colored bar showing current HP)
    playerEntity.hpBarFill.clear();
    const hpPercent = Math.max(0, hp / maxHp);
    // Color changes: green > 50%, yellow > 25%, red <= 25%
    const fillColor =
      hpPercent > 0.5 ? 0x00ff00 : hpPercent > 0.25 ? 0xffff00 : 0xff0000;
    playerEntity.hpBarFill.fillStyle(fillColor, 1);
    playerEntity.hpBarFill.fillRect(x, y, barWidth * hpPercent, barHeight);

    // HP text
    playerEntity.hpText.setPosition(sprite.x, y + barHeight + 6);
    playerEntity.hpText.setText(`${Math.ceil(hp)}/${maxHp}`);
  }

  /**
   * Draw an enemy's health bar above their sprite.
   */
  drawEnemyHpBar(enemyEntity: EnemyEntity, hp: number, maxHp: number) {
    const sprite = enemyEntity.sprite;
    const barWidth = 36;
    const barHeight = 3;
    const offsetY = -(sprite.displayHeight / 2) - 8;

    const x = sprite.x - barWidth / 2;
    const y = sprite.y + offsetY;

    enemyEntity.hpBarBg.clear();
    enemyEntity.hpBarBg.fillStyle(0x333333, 0.8);
    enemyEntity.hpBarBg.fillRect(x, y, barWidth, barHeight);

    enemyEntity.hpBarFill.clear();
    const hpPercent = Math.max(0, hp / maxHp);
    enemyEntity.hpBarFill.fillStyle(0xff0000, 1);
    enemyEntity.hpBarFill.fillRect(x, y, barWidth * hpPercent, barHeight);
  }

  // ============================================================
  // MAIN UPDATE LOOP (runs at display framerate, e.g. 60fps)
  // ============================================================

  update(time: number, delta: number): void {
    if (!this.currentPlayer) return;

    // Check if current player respawned
    const currentPlayerState = this.room.state.players.get(this.room.sessionId);
    if (this.isGameOver && currentPlayerState && !currentPlayerState.isDead) {
      this.currentPlayer.x = currentPlayerState.x;
      this.currentPlayer.y = currentPlayerState.y;
      this.respawnPlayer();
    }

    // Update all player HP bars every frame
    this.room.state.players.forEach((player, sessionId) => {
      const playerEntity = this.playerEntities[sessionId];
      if (playerEntity) {
        this.drawPlayerHpBar(playerEntity, player.hp, player.maxHp);

        if (player.isDead && sessionId === this.room.sessionId) {
          this.hidePlayerEntity(sessionId);
          this.showGameOver();
        }
      }
    });

    // Update all enemy HP bars
    this.room.state.enemies.forEach((enemy, enemyId) => {
      const enemyEntity = this.enemyEntities[enemyId];
      if (enemyEntity) {
        this.drawEnemyHpBar(enemyEntity, enemy.hp, enemy.maxHp);
      }
    });

    // Update bullet server positions (for snapping)
    this.room.state.bullets.forEach((bullet, bulletId) => {
      const bulletEntity = this.bulletEntities[bulletId];
      if (bulletEntity) {
        bulletEntity.serverX = bullet.x;
        bulletEntity.serverY = bullet.y;
      }
    });

    // Run client-side fixed timestep for input/prediction
    this.elapsedTime += delta;
    while (this.elapsedTime >= this.fixedTimeStep) {
      this.elapsedTime -= this.fixedTimeStep;
      this.fixedTick(time, this.fixedTimeStep);
    }

    // ---- Card system: keyboard card slots (space, 1, 2) ----
    if (!this.isGameOver && this.currentPlayer) {
      const cardContext: CardActionContext = {
        scene: this,
        room: this.room,
        player: this.currentPlayer,
      };

      if (Phaser.Input.Keyboard.JustDown(this.cardKeys.space)) {
        const slotIdx = this.cardSlotManager.getSlotByBinding("space");
        this.cardSlotManager.activateSlot(slotIdx, cardContext);
      }
      if (Phaser.Input.Keyboard.JustDown(this.cardKeys.one)) {
        const slotIdx = this.cardSlotManager.getSlotByBinding("key1");
        this.cardSlotManager.activateSlot(slotIdx, cardContext);
      }
      if (Phaser.Input.Keyboard.JustDown(this.cardKeys.two)) {
        const slotIdx = this.cardSlotManager.getSlotByBinding("key2");
        this.cardSlotManager.activateSlot(slotIdx, cardContext);
      }
    }

    // ---- Update card HUD ----
    if (this.currentPlayer) {
      const ps = this.room.state.players.get(this.room.sessionId);
      if (ps) {
        // Sync kill-based cooldown from server
        const healSlotIdx = this.cardSlotManager.getSlotByBinding("key1");
        this.cardSlotManager.updateKillsForSlot(
          healSlotIdx,
          ps.killsSinceLastHeal,
        );

        this.cardHUD.update(ps.hp, ps.maxHp);
      }
    }

    // Update FPS counter with color based on framerate
    const fps = Math.floor(this.game.loop.actualFps);
    this.debugFPS.setText(`FPS: ${fps}`);
    if (fps >= 60) {
      this.debugFPS.setColor("#00ff00"); // Green: 60+
    } else if (fps >= 50) {
      this.debugFPS.setColor("#ffff00"); // Yellow: 50-59
    } else {
      this.debugFPS.setColor("#ff0000"); // Red: below 50
    }

    // ---- F3: Toggle hitbox overlay ----
    if (Phaser.Input.Keyboard.JustDown(this.hitboxToggleKey)) {
      this.toggleHitboxes();
    }
  }

  // ============================================================
  // CLIENT-SIDE FIXED TICK (for input and prediction)
  // ============================================================

  /**
   * Fixed tick for client-side prediction.
   *
   * HOW PREDICTION WORKS:
   *   1. We read the player's input (WASD keys)
   *   2. We send the input to the server
   *   3. We IMMEDIATELY apply the input locally (prediction)
   *   4. The server processes the input and sends back the real position
   *   5. Our "remoteRef" shows the server position
   *   6. Our "localRef" shows our predicted position
   *   7. If they differ, we're slightly off — but it usually matches
   *
   * WHY: Without prediction, there's a delay between pressing a key
   * and seeing movement (round-trip to server). Prediction hides this.
   *
   * IMPORTANT: The client does NOT use normalized vectors here for
   * prediction — it uses the same velocity as the old code for
   * visual consistency. The SERVER uses the proper normalized movement.
   * If you want perfect prediction, match this to the server's formula.
   */
  fixedTick(time: number, delta: number) {
    this.currentTick++;

    if (this.isGameOver) return;

    const currentPlayerState = this.room.state.players.get(this.room.sessionId);
    if (currentPlayerState && currentPlayerState.isDead) return;

    // ---- Read input ----
    this.inputPayload.left = this.wasdKeys.left.isDown;
    this.inputPayload.right = this.wasdKeys.right.isDown;
    this.inputPayload.up = this.wasdKeys.up.isDown;
    this.inputPayload.down = this.wasdKeys.down.isDown;
    this.inputPayload.tick = this.currentTick;

    // ---- Send input to server ----
    this.room.send(0, this.inputPayload);

    // ---- Update character animation based on direction ----
    this.updatePlayerAnimation();

    // ---- Update tyranid enemy animations ----
    this.updateTyranidAnimations();

    // ---- Client-side prediction (apply locally) ----
    const dt = this.fixedTimeStep / 1000;
    let dirX = 0;
    let dirY = 0;
    if (this.inputPayload.left) dirX -= 1;
    if (this.inputPayload.right) dirX += 1;
    if (this.inputPayload.up) dirY -= 1;
    if (this.inputPayload.down) dirY += 1;

    // Normalize diagonal movement (same as server)
    const length = Math.sqrt(dirX * dirX + dirY * dirY);
    if (length > 0) {
      dirX /= length;
      dirY /= length;
    }

    this.currentPlayer.x += dirX * this.PLAYER_SPEED * dt;
    this.currentPlayer.y += dirY * this.PLAYER_SPEED * dt;

    // Clamp to map boundaries (match server bounds)
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

    // ---- Client-side blocking collision (match server) ----
    // WHY: Without this, the client prediction lets the player walk through
    // obstacles and enemy spawn zones. When the server corrects, there's a snap.
    // Blocking rects = obstacles + enemy spawn zones (using HITBOX dimensions, same as server).
    const PLAYER_RADIUS = this.PLAYER_COLLISION_RADIUS;
    const blockingRects = [
      ...this.currentMap.obstacles,
      ...this.currentMap.enemySpawnZones,
    ];
    for (const rect of blockingRects) {
      // Compute the hitbox rect (centered, smaller than visual if hitbox is defined)
      const hb = getHitboxRect(
        rect.x,
        rect.y,
        rect.width,
        rect.height,
        rect.hitbox,
      );
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
        const entityLeft = this.currentPlayer.x - PLAYER_RADIUS;
        const entityRight = this.currentPlayer.x + PLAYER_RADIUS;
        const entityTop = this.currentPlayer.y - PLAYER_RADIUS;
        const entityBottom = this.currentPlayer.y + PLAYER_RADIUS;

        // Use hitbox dimensions for push calculation (match server)
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

    // Update local prediction reference
    this.localRef.x = this.currentPlayer.x;
    this.localRef.y = this.currentPlayer.y;

    // ---- Interpolate remote players ----
    for (let sessionId in this.playerEntities) {
      if (sessionId === this.room.sessionId) continue;

      const entity = this.playerEntities[sessionId].sprite;
      const { serverX, serverY } = entity.data.values;

      // Smooth interpolation toward server position
      entity.x = Phaser.Math.Linear(entity.x, serverX, 0.2);
      entity.y = Phaser.Math.Linear(entity.y, serverY, 0.2);
    }

    // ---- Interpolate enemies ----
    for (let enemyId in this.enemyEntities) {
      const enemyEntity = this.enemyEntities[enemyId];
      enemyEntity.sprite.x = Phaser.Math.Linear(
        enemyEntity.sprite.x,
        enemyEntity.serverX,
        0.2,
      );
      enemyEntity.sprite.y = Phaser.Math.Linear(
        enemyEntity.sprite.y,
        enemyEntity.serverY,
        0.2,
      );
    }

    // ---- Snap bullets (fast-moving, no interpolation needed) ----
    for (let bulletId in this.bulletEntities) {
      const bulletEntity = this.bulletEntities[bulletId];
      bulletEntity.sprite.x = bulletEntity.serverX;
      bulletEntity.sprite.y = bulletEntity.serverY;
    }
  }
}
