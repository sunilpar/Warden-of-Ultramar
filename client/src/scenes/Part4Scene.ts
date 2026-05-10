/**
 * ---------------------------
 * Phaser + Colyseus - Part 4.
 * ---------------------------
 * - Connecting with the room
 * - Sending inputs at the user's framerate
 * - Update other player's positions WITH interpolation (for other players)
 * - Client-predicted input for local (current) player
 * - Fixed tickrate on both client and server
 * - Enemy system with HP, HP bars, bullets, and game over
 */

import Phaser from "phaser";

import { Room, Client, Callbacks } from "@colyseus/sdk";

import { BACKEND_URL } from "../backend";

// Import server types for strong-typing Colyseus SDK
import type server from "../../../server/src/app.config";
import type { InputData, Part4Room } from "../../../server/src/rooms/Part4Room";

interface EnemyEntity {
  sprite: Phaser.GameObjects.Image;
  hpBarBg: Phaser.GameObjects.Graphics;
  hpBarFill: Phaser.GameObjects.Graphics;
  serverX: number;
  serverY: number;
}

interface BulletEntity {
  sprite: Phaser.GameObjects.Arc;
  serverX: number;
  serverY: number;
}

interface PlayerEntity {
  sprite: Phaser.Types.Physics.Arcade.ImageWithDynamicBody;
  hpBarBg: Phaser.GameObjects.Graphics;
  hpBarFill: Phaser.GameObjects.Graphics;
  hpText: Phaser.GameObjects.Text;
}

export class Part4Scene extends Phaser.Scene {
  client = new Client<typeof server>(BACKEND_URL);
  room!: Room<Part4Room>;

  currentPlayer!: Phaser.Types.Physics.Arcade.ImageWithDynamicBody;
  playerEntities: {
    [sessionId: string]: PlayerEntity;
  } = {};

  enemyEntities: {
    [enemyId: string]: EnemyEntity;
  } = {};

  bulletEntities: {
    [bulletId: string]: BulletEntity;
  } = {};

  debugFPS!: Phaser.GameObjects.Text;

  localRef!: Phaser.GameObjects.Rectangle;
  remoteRef!: Phaser.GameObjects.Rectangle;

  // Game over overlay
  gameOverOverlay: Phaser.GameObjects.Container | null = null;
  isGameOver: boolean = false;
  deathBoxSprite: Phaser.GameObjects.Image | null = null;

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

  elapsedTime = 0;
  fixedTimeStep = 1000 / 60;

  currentTick: number = 0;

  constructor() {
    super({ key: "part1" });
  }

  async create() {
    this.wasdKeys = this.input.keyboard.addKeys({
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
      up: Phaser.Input.Keyboard.KeyCodes.W,
      down: Phaser.Input.Keyboard.KeyCodes.S,
    }) as any;

    this.add
      .image(this.cameras.main.centerX, this.cameras.main.centerY, "map1")
      .setDisplaySize(this.cameras.main.width, this.cameras.main.height);

    this.debugFPS = this.add.text(4, 4, "", { color: "#efbf68" });

    // connect with the room
    await this.connect();

    const callbacks = Callbacks.get(this.room);

    callbacks.onAdd("players", (player, sessionId) => {
      const entity = this.physics.add.image(player.x, player.y, "ship_0001");

      // HP bar background (below sprite)
      const hpBarBg = this.add.graphics();
      // HP bar fill (below sprite)
      const hpBarFill = this.add.graphics();
      // HP text (below sprite, under the bar)
      const hpText = this.add.text(0, 0, "", {
        color: "#ffffff",
        fontSize: "10px",
        fontFamily: "Georgia",
        stroke: "#000000",
        strokeThickness: 2,
      }).setOrigin(0.5);

      this.playerEntities[sessionId] = {
        sprite: entity,
        hpBarBg,
        hpBarFill,
        hpText,
      };

      // is current player
      if (sessionId === this.room.sessionId) {
        this.currentPlayer = entity;

        this.localRef = this.add.rectangle(0, 0, entity.width, entity.height);
        this.localRef.setStrokeStyle(1, 0x00ff00);

        this.remoteRef = this.add.rectangle(0, 0, entity.width, entity.height);
        this.remoteRef.setStrokeStyle(1, 0xff0000);

        callbacks.onChange(player, () => {
          this.remoteRef.x = player.x;
          this.remoteRef.y = player.y;
        });
      } else {
        // listening for server updates
        callbacks.onChange(player, () => {
          entity.setData("serverX", player.x);
          entity.setData("serverY", player.y);
        });
      }
    });

    // remove local reference when entity is removed from the server
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

    // Handle enemies
    callbacks.onAdd("enemies", (enemy, enemyId) => {
      // Choose sprite based on enemy type
      const spriteKey = enemy.enemyType === "ork" ? "orck" : "elder";
      const sprite = this.add.image(enemy.x, enemy.y, spriteKey).setDisplaySize(32, 32);

      const hpBarBg = this.add.graphics();
      const hpBarFill = this.add.graphics();

      this.enemyEntities[enemyId] = {
        sprite,
        hpBarBg,
        hpBarFill,
        serverX: enemy.x,
        serverY: enemy.y,
      };

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
        enemyEntity.sprite.destroy();
        enemyEntity.hpBarBg.destroy();
        enemyEntity.hpBarFill.destroy();
        delete this.enemyEntities[enemyId];
      }
    });

    // Handle bullets
    callbacks.onAdd("bullets", (bullet, bulletId) => {
      // Purple circle for bullets
      const sprite = this.add.circle(bullet.x, bullet.y, 4, 0x9933ff).setDepth(5);

      this.bulletEntities[bulletId] = {
        sprite,
        serverX: bullet.x,
        serverY: bullet.y,
      };

      callbacks.onChange(bullet, () => {
        if (this.bulletEntities[bulletId]) {
          this.bulletEntities[bulletId].serverX = bullet.x;
          this.bulletEntities[bulletId].serverY = bullet.y;
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

  async connect() {
    // add connection status text
    const connectionStatusText = this.add
      .text(0, 0, "Trying to connect with the server...")
      .setStyle({ color: "#ff0000" })
      .setPadding(4);

    try {
      this.room = await this.client.joinOrCreate("part4_room", {});

      // connection successful!
      connectionStatusText.destroy();
    } catch (e) {
      // couldn't connect
      connectionStatusText.text = "Could not connect with the server.";
    }
  }

  showGameOver() {
    if (this.isGameOver) return;
    this.isGameOver = true;

    const { centerX, centerY } = this.cameras.main;

    // Semi-transparent background
    const bg = this.add.rectangle(
      centerX,
      centerY,
      this.cameras.main.width,
      this.cameras.main.height,
      0x000000,
      0.7
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
        // Send respawn request to server
        this.room.send(1);
      });

    this.gameOverOverlay = this.add.container(0, 0, [
      bg,
      gameOverText,
      respawnButton,
    ]);
    // Bring to top
    this.gameOverOverlay.setDepth(1000);
  }

  respawnPlayer() {
    if (!this.isGameOver) return;
    this.isGameOver = false;

    // Destroy game over overlay
    if (this.gameOverOverlay) {
      this.gameOverOverlay.destroy();
      this.gameOverOverlay = null;
    }

    // Show player sprite again
    const sessionId = this.room.sessionId;
    const playerEntity = this.playerEntities[sessionId];
    if (playerEntity) {
      playerEntity.sprite.setVisible(true);
      playerEntity.hpBarBg.setVisible(true);
      playerEntity.hpBarFill.setVisible(true);
      playerEntity.hpText.setVisible(true);
    }

    // Show local/remote refs
    if (this.localRef) this.localRef.setVisible(true);
    if (this.remoteRef) this.remoteRef.setVisible(true);

    // Remove deathbox
    if (this.deathBoxSprite) {
      this.deathBoxSprite.destroy();
      this.deathBoxSprite = null;
    }
  }

  hidePlayerEntity(sessionId: string) {
    const playerEntity = this.playerEntities[sessionId];
    if (playerEntity) {
      // Show deathbox at player's death position
      if (sessionId === this.room.sessionId && !this.deathBoxSprite) {
        this.deathBoxSprite = this.add.image(
          playerEntity.sprite.x,
          playerEntity.sprite.y,
          "deathbox"
        ).setDisplaySize(48, 48).setDepth(1);
      }
      playerEntity.sprite.setVisible(false);
      playerEntity.hpBarBg.setVisible(false);
      playerEntity.hpBarFill.setVisible(false);
      playerEntity.hpText.setVisible(false);
    }
  }

  drawPlayerHpBar(playerEntity: PlayerEntity, hp: number, maxHp: number) {
    const sprite = playerEntity.sprite;
    const barWidth = 48;
    const barHeight = 4;
    const offsetY = sprite.height / 2 + 14; // below sprite

    const x = sprite.x - barWidth / 2;
    const y = sprite.y + offsetY;

    playerEntity.hpBarBg.clear();
    playerEntity.hpBarBg.fillStyle(0x333333, 0.8);
    playerEntity.hpBarBg.fillRect(x, y, barWidth, barHeight);

    playerEntity.hpBarFill.clear();
    const hpPercent = Math.max(0, hp / maxHp);
    const fillColor = hpPercent > 0.5 ? 0x00ff00 : hpPercent > 0.25 ? 0xffff00 : 0xff0000;
    playerEntity.hpBarFill.fillStyle(fillColor, 1);
    playerEntity.hpBarFill.fillRect(x, y, barWidth * hpPercent, barHeight);

    playerEntity.hpText.setPosition(sprite.x, y + barHeight + 6);
    playerEntity.hpText.setText(`${Math.ceil(hp)}/${maxHp}`);
  }

  drawEnemyHpBar(enemyEntity: EnemyEntity, hp: number, maxHp: number) {
    const sprite = enemyEntity.sprite;
    const barWidth = 36;
    const barHeight = 3;
    const offsetY = -(sprite.displayHeight / 2) - 8; // above sprite

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

  update(time: number, delta: number): void {
    // skip loop if not connected yet.
    if (!this.currentPlayer) {
      return;
    }

    // Check if current player respawned (was dead, now alive)
    const currentPlayerState = this.room.state.players.get(this.room.sessionId);
    if (this.isGameOver && currentPlayerState && !currentPlayerState.isDead) {
      // Snap player to server position on respawn
      this.currentPlayer.x = currentPlayerState.x;
      this.currentPlayer.y = currentPlayerState.y;
      this.respawnPlayer();
    }

    // Update player HP bars every frame for smooth rendering
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

    // Update enemy HP bars
    this.room.state.enemies.forEach((enemy, enemyId) => {
      const enemyEntity = this.enemyEntities[enemyId];
      if (enemyEntity) {
        this.drawEnemyHpBar(enemyEntity, enemy.hp, enemy.maxHp);
      }
    });

    // Update bullet sprites to follow server position
    this.room.state.bullets.forEach((bullet, bulletId) => {
      const bulletEntity = this.bulletEntities[bulletId];
      if (bulletEntity) {
        bulletEntity.serverX = bullet.x;
        bulletEntity.serverY = bullet.y;
      }
    });

    this.elapsedTime += delta;
    while (this.elapsedTime >= this.fixedTimeStep) {
      this.elapsedTime -= this.fixedTimeStep;
      this.fixedTick(time, this.fixedTimeStep);
    }

    //framerate count
    this.debugFPS.text = `${Math.floor(this.game.loop.actualFps)}`;
  }

  fixedTick(time, delta) {
    this.currentTick++;

    // Don't process input if game is over
    if (this.isGameOver) return;

    // Check if current player is dead
    const currentPlayerState = this.room.state.players.get(this.room.sessionId);
    if (currentPlayerState && currentPlayerState.isDead) {
      return;
    }

    const velocity = 2;
    this.inputPayload.left = this.wasdKeys.left.isDown;
    this.inputPayload.right = this.wasdKeys.right.isDown;
    this.inputPayload.up = this.wasdKeys.up.isDown;
    this.inputPayload.down = this.wasdKeys.down.isDown;
    this.inputPayload.tick = this.currentTick;
    this.room.send(0, this.inputPayload);

    if (this.inputPayload.left) {
      this.currentPlayer.x -= velocity;
    } else if (this.inputPayload.right) {
      this.currentPlayer.x += velocity;
    }

    if (this.inputPayload.up) {
      this.currentPlayer.y -= velocity;
    } else if (this.inputPayload.down) {
      this.currentPlayer.y += velocity;
    }

    this.localRef.x = this.currentPlayer.x;
    this.localRef.y = this.currentPlayer.y;

    for (let sessionId in this.playerEntities) {
      // interpolate all player entities
      // (except the current player)
      if (sessionId === this.room.sessionId) {
        continue;
      }

      const entity = this.playerEntities[sessionId].sprite;
      const { serverX, serverY } = entity.data.values;

      entity.x = Phaser.Math.Linear(entity.x, serverX, 0.2);
      entity.y = Phaser.Math.Linear(entity.y, serverY, 0.2);
    }

    // Interpolate enemy positions
    for (let enemyId in this.enemyEntities) {
      const enemyEntity = this.enemyEntities[enemyId];
      enemyEntity.sprite.x = Phaser.Math.Linear(
        enemyEntity.sprite.x,
        enemyEntity.serverX,
        0.2
      );
      enemyEntity.sprite.y = Phaser.Math.Linear(
        enemyEntity.sprite.y,
        enemyEntity.serverY,
        0.2
      );
    }

    // Snap bullet positions (bullets move fast, direct snap for accuracy)
    for (let bulletId in this.bulletEntities) {
      const bulletEntity = this.bulletEntities[bulletId];
      bulletEntity.sprite.x = bulletEntity.serverX;
      bulletEntity.sprite.y = bulletEntity.serverY;
    }
  }
}