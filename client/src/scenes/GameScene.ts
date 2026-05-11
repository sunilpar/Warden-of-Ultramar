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

// ============================================================
// Entity interfaces — track visual objects for each entity
// ============================================================

interface EnemyEntity {
  sprite: Phaser.GameObjects.Image;
  hpBarBg: Phaser.GameObjects.Graphics;
  hpBarFill: Phaser.GameObjects.Graphics;
  serverX: number;
  serverY: number;
}

interface BulletEntity {
  sprite: Phaser.GameObjects.Shape; // Arc for enemy, Rectangle for player
  serverX: number;
  serverY: number;
}

interface PlayerEntity {
  sprite: Phaser.Types.Physics.Arcade.ImageWithDynamicBody;
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
  currentPlayer!: Phaser.Types.Physics.Arcade.ImageWithDynamicBody;
  playerEntities: { [sessionId: string]: PlayerEntity } = {};
  enemyEntities: { [enemyId: string]: EnemyEntity } = {};
  bulletEntities: { [bulletId: string]: BulletEntity } = {};

  // Debug
  debugFPS!: Phaser.GameObjects.Text;

  // Client-side prediction visual references
  localRef!: Phaser.GameObjects.Rectangle;
  remoteRef!: Phaser.GameObjects.Rectangle;

  // Game over state
  gameOverOverlay: Phaser.GameObjects.Container | null = null;
  isGameOver: boolean = false;
  deathBoxSprite: Phaser.GameObjects.Image | null = null;

  // Shooting cooldown (client-side tracking for visual feedback)
  lastShootTime: number = 0;
  private readonly SHOOT_COOLDOWN_MS: number = 500; // 0.5 seconds

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

    // Draw background
    this.add
      .image(this.cameras.main.centerX, this.cameras.main.centerY, "map1")
      .setDisplaySize(this.cameras.main.width, this.cameras.main.height);

    // FPS counter
    this.debugFPS = this.add.text(4, 4, "", { color: "#efbf68" });

    // Left-click to shoot
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      // Only fire on left-click
      if (!pointer.leftButtonDown()) return;
      if (this.isGameOver) return;
      if (!this.currentPlayer) return;

      // Get mouse world position
      const worldX = pointer.worldX;
      const worldY = pointer.worldY;

      // Client-side cooldown check (visual only, server enforces real cooldown)
      const now = performance.now();
      if (now - this.lastShootTime < this.SHOOT_COOLDOWN_MS) return;

      this.lastShootTime = now;

      // Send shoot message to server with mouse world position
      this.room.send(2, { x: worldX, y: worldY });
    });

    // Connect to server
    await this.connect();

    const callbacks = Callbacks.get(this.room);

    // ============================================================
    // PLAYER HANDLERS
    // ============================================================

    callbacks.onAdd("players", (player, sessionId) => {
      const entity = this.physics.add.image(player.x, player.y, "ship_0001");

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

        // Visual references for prediction debugging
        this.localRef = this.add.rectangle(0, 0, entity.width, entity.height);
        this.localRef.setStrokeStyle(1, 0x00ff00); // green = predicted
        this.remoteRef = this.add.rectangle(0, 0, entity.width, entity.height);
        this.remoteRef.setStrokeStyle(1, 0xff0000); // red = server confirmed

        // Update remote reference when server sends new position
        callbacks.onChange(player, () => {
          this.remoteRef.x = player.x;
          this.remoteRef.y = player.y;
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
      const spriteKey = enemy.enemyType === "ork" ? "orck" : "elder";
      const sprite = this.add
        .image(enemy.x, enemy.y, spriteKey)
        .setDisplaySize(32, 32);

      const hpBarBg = this.add.graphics();
      const hpBarFill = this.add.graphics();

      this.enemyEntities[enemyId] = {
        sprite,
        hpBarBg,
        hpBarFill,
        serverX: enemy.x,
        serverY: enemy.y,
      };

      // Update server position for interpolation
      callbacks.onChange(enemy, () => {
        if (this.enemyEntities[enemyId]) {
          this.enemyEntities[enemyId].serverX = enemy.x;
          this.enemyEntities[enemyId].serverY = enemy.y;
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
        sprite = this.add.rectangle(bullet.x, bullet.y, 12, 4, 0x66ccff).setDepth(5);
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

    this.cameras.main.setBounds(0, 0, 800, 600);
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

      const particle = this.add.circle(
        x + offsetX, y + offsetY, size,
        0xcc0000, 0.8
      ).setDepth(4);

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

    if (this.localRef) this.localRef.setVisible(true);
    if (this.remoteRef) this.remoteRef.setVisible(true);

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
    const offsetY = sprite.height / 2 + 14;

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

    this.debugFPS.text = `${Math.floor(this.game.loop.actualFps)}`;
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

    // ---- Client-side prediction (apply locally) ----
    // Uses same normalized movement as server for accurate prediction
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
