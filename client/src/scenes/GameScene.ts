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

import { LAYERED_MAP, resolveTileCollision } from "../maps/layeredMapData";
import type { LayeredMapData } from "../maps/layeredMapData";
import { LAYERED_MAP_2 } from "../maps/layeredMap2Data";
import {
  cardFrameForLevel,
  BOLTER_COLORS,
  bolterColorTier,
  bolterBulletFrameForLevel,
  BOLTER_MUZZLE_FRAMES,
  clawRowStartFrame,
  CLAW_FRAMES_PER_ROW,
  type ClawTier,
  skillMods,
} from "../config/skillDefs";

// ============================================================
// Game Scene
// ============================================================

export class GameScene extends Phaser.Scene {
  client = new Client(BACKEND_URL);
  room: any = null;

  // ---- Entity tracking ----
  currentPlayer!: Phaser.GameObjects.Sprite;
  playerEntities: { [sessionId: string]: Phaser.GameObjects.Sprite } = {};
  // Enemy sprites keyed by enemy id (from server state.enemies)
  enemyEntities: { [id: string]: Phaser.GameObjects.Sprite } = {};
  private enemyAnimationsCreated: boolean = false;
  private bolterMuzzleAnimCreated: boolean = false;

  // ---- Projectiles (bolter bullets etc.) keyed by projectile id ----
  projectileEntities: { [id: string]: Phaser.GameObjects.Arc } = {};
  /** Claw VFX sprites keyed by skillCast id. */
  clawEntities: { [id: string]: Phaser.GameObjects.Sprite } = {};
  private clawAnimCreated: boolean = false;

  // ---- Enemy HP bars + last-known positions (for VFX on despawn) ----
  enemyHpBars: { [id: string]: Phaser.GameObjects.Container } = {};
  enemyLastPos: { [id: string]: { x: number; y: number } } = {};
  projLastPos: { [id: string]: { x: number; y: number } } = {};

  // ---- Skill (bolter) HUD: card image + level text in slot 1 ----
  private bolterCard!: Phaser.GameObjects.Image;
  private bolterLevelText!: Phaser.GameObjects.Text;
  private localBolterLevel: number = 1;

  // ---- Upgrade toast ----
  private upgradeToast!: Phaser.GameObjects.Text;

  // ---- Bolter cooldown overlay + tooltip ----
  private bolterCooldownFill!: Phaser.GameObjects.Rectangle;
  private bolterCooldownFillBaseH: number = 0;
  private bolterTooltip!: Phaser.GameObjects.Text;

  // ---- Aim / firing ----
  private aimAngle: number = 0;
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
  // moveSpeed is now read from the server-synced Player schema
  // (effective speed = base * speedMultiplier). Fall back to this
  // constant until the first state snapshot arrives.
  private moveSpeed: number = 120;
  private readonly PLAYER_COLLISION_RADIUS = 20;

  // ---- Stats HUD (bottom-left HUD image + vertical HP bar + cards) ----
  private hudImage!: Phaser.GameObjects.Image;
  private hpFill!: Phaser.GameObjects.Rectangle;
  private hpText!: Phaser.GameObjects.Text;
  private statsText!: Phaser.GameObjects.Text;
  private cardSlots: Phaser.GameObjects.Rectangle[] = [];
  // HUD hitbox overlays (visible when showHitboxes is true)
  private hudHitboxHP: Phaser.GameObjects.Rectangle | null = null;
  private hudHitboxCards: Phaser.GameObjects.Rectangle[] = [];
  // Scaled full-height of the HP bar (set in createStatsHUD)
  private hpBarFullHeight: number = 0;
  private hpBarFullWidth: number = 0;

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

    // ---- Mouse aim (world-space) + left-click to fire bolter ----
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      const wx = pointer.worldX;
      const wy = pointer.worldY;
      if (this.currentPlayer) {
        this.aimAngle = Math.atan2(
          wy - this.currentPlayer.y,
          wx - this.currentPlayer.x,
        );
      }
    });
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (!this.currentPlayer || !this.room) return;
      const wx = pointer.worldX;
      const wy = pointer.worldY;
      const angle = Math.atan2(
        wy - this.currentPlayer.y,
        wx - this.currentPlayer.x,
      );
      if (pointer.rightButtonDown()) {
        // Right-click: claw skill (cone melee in aim direction).
        this.room.send(1, { skill: "claw", angle });
        return;
      }
      // Left-click: bolter skill.
      if (!this.bolterMuzzleAnimCreated) {
        this.createBolterAnimations();
        this.bolterMuzzleAnimCreated = true;
      }
      this.spawnMuzzleFlash(this.currentPlayer.x, this.currentPlayer.y, angle);
      this.room.send(1, { skill: "bolter", angle });
    });

    // ---- "0" key upgrades the bolter (debug) ----
    this.input.keyboard
      ?.addKey(Phaser.Input.Keyboard.KeyCodes.ZERO)
      ?.on("down", () => {
        if (!this.room) return;
        this.room.send(2, { skill: "bolter" });
      });

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
    const startData = this.sys.settings.data as
      | { fadeIn?: boolean }
      | undefined;
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
        .image(
          this.cameras.main.centerX,
          this.cameras.main.centerY,
          "loading_screen",
        )
        .setScrollFactor(0)
        .setDepth(1001);
    }

    // ---- Render the layered map (baselayer + interactive + zones) ----
    this.renderLayeredMap();
    this.renderDebugHitboxes();

    // ---- Debug HUD (FPS + hitbox toggle button) ----
    this.createDebugHUD();

    // ---- Stats HUD (health / level / xp / attack / crit) ----
    this.createStatsHUD();
    // Place the bolter card in slot 1 (initial level 1).
    this.refreshBolterCard();

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
            // Keep our effective move speed synced with the server
            // (so a slow debuff slows our prediction too).
            this.moveSpeed = player.moveSpeed;

            const dx = Math.abs(player.x - this.currentPlayer.x);
            const dy = Math.abs(player.y - this.currentPlayer.y);
            // Snap to server position if we're far off (teleport, correction)
            if (dx > 32 || dy > 32) {
              this.currentPlayer.x = player.x;
              this.currentPlayer.y = player.y;
            }
            // Refresh the stats HUD
            this.updateStatsHUD(player);
            // Sync bolter level + card art
            const lvl =
              player.skillLevels && player.skillLevels.get
                ? (player.skillLevels.get("bolter") ?? 1)
                : 1;
            if (lvl !== this.localBolterLevel) {
              this.localBolterLevel = lvl;
              this.refreshBolterCard();
              this.showUpgradeToast(lvl);
            }
            // Track cooldown end + attack for the HUD overlay + tooltip.
            this.currentPlayer.setData(
              "bolterCdEndsAt",
              player.bolterCooldownEndsAt ?? 0,
            );
            this.currentPlayer.setData("attack", player.attack ?? 100);
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

    // ============================================================
    // ENEMY STATE LISTENERS
    // ============================================================
    callbacks.onAdd("enemies", (enemy: any, enemyId: string) => {
      // Create enemy animations once (shared by all enemy sprites)
      if (!this.enemyAnimationsCreated) {
        this.createEnemyAnimations();
        this.enemyAnimationsCreated = true;
      }

      const textureKey =
        enemy.typeId === "tyranid" ? "tyranid_sheet" : "tyranid_sheet";
      const sprite = this.add
        .sprite(enemy.x, enemy.y, textureKey, 0)
        .setDisplaySize(64, 64)
        .setDepth(3);
      sprite.anims.play("tri_idle");
      this.enemyEntities[enemyId] = sprite;

      // ---- Enemy HP bar (bg + fill) floating above the sprite ----
      const hpW = 38;
      const hpH = 5;
      const hpBg = this.add
        .rectangle(0, -42, hpW, hpH, 0x000000, 0.7)
        .setStrokeStyle(1, 0x000000, 0.9);
      const hpFill = this.add
        .rectangle(-hpW / 2, -42, hpW, hpH, 0xff3333)
        .setOrigin(0, 0.5);
      const hpBar = this.add
        .container(enemy.x, enemy.y, [hpBg, hpFill])
        .setDepth(5);
      this.enemyHpBars[enemyId] = hpBar;

      this.enemyLastPos[enemyId] = { x: enemy.x, y: enemy.y };

      callbacks.onChange(enemy, () => {
        sprite.setData("serverX", enemy.x);
        sprite.setData("serverY", enemy.y);
        sprite.setData("facingRight", !!enemy.facingRight);
        sprite.setData("hp", enemy.currentHealth);
        sprite.setData("maxHp", enemy.maxHealth);
        sprite.setData("hitFlashUntil", enemy.hitFlashUntil);
        sprite.setData("attacking", !!enemy.attacking);
        this.enemyLastPos[enemyId] = { x: enemy.x, y: enemy.y };
      });
    });

    callbacks.onRemove("enemies", (_enemy: any, enemyId: string) => {
      const entity = this.enemyEntities[enemyId];
      if (entity) {
        entity.destroy();
        delete this.enemyEntities[enemyId];
      }
      const hpBar = this.enemyHpBars[enemyId];
      if (hpBar) {
        hpBar.destroy();
        delete this.enemyHpBars[enemyId];
      }
      delete this.enemyLastPos[enemyId];
    });

    // ============================================================
    // PROJECTILE STATE LISTENERS
    // ============================================================
    callbacks.onAdd("projectiles", (proj: any, projId: string) => {
      // Ensure the muzzle flash animation exists (created once).
      if (!this.bolterMuzzleAnimCreated) {
        this.createBolterAnimations();
        this.bolterMuzzleAnimCreated = true;
      }
      // Bolter bullet: a 64x64 art frame, scaled small so the visible bullet
      // is ~10px (the server-side hitbox stays its own small radius).
      const tier = bolterColorTier(proj.level);
      const tint = proj.skillId === "bolter" ? BOLTER_COLORS[tier] : 0xffffff;
      const frame =
        proj.skillId === "bolter" ? bolterBulletFrameForLevel(proj.level) : 0;
      const bullet = this.add
        .sprite(proj.x, proj.y, "bolter_sheet", frame)
        .setDepth(4)
        .setScale(0.4)
        .setTint(tint);
      this.projectileEntities[projId] = bullet as any;
      this.projLastPos[projId] = { x: proj.x, y: proj.y };

      callbacks.onChange(proj, () => {
        bullet.setPosition(proj.x, proj.y);
        // Orient the sprite along its travel direction.
        const prev = this.projLastPos[projId];
        if (prev) {
          const a = Math.atan2(proj.y - prev.y, proj.x - prev.x);
          bullet.setRotation(a);
        }
        this.projLastPos[projId] = { x: proj.x, y: proj.y };
      });
    });

    callbacks.onRemove("projectiles", (_proj: any, projId: string) => {
      const entity = this.projectileEntities[projId];
      const pos = this.projLastPos[projId];
      if (entity) {
        entity.destroy();
        delete this.projectileEntities[projId];
      }
      // Spawn bullet-hit VFX at last known position.
      if (pos) {
        this.spawnBulletHitVfx(pos.x, pos.y);
        delete this.projLastPos[projId];
      }
    });

    // ============================================================
    // SKILL CAST (CLAW CONE) STATE LISTENERS
    // ============================================================
    callbacks.onAdd("skillCasts", (cast: any, castId: string) => {
      if (!this.clawAnimCreated) {
        this.createClawAnimations();
        this.clawAnimCreated = true;
      }
      if (cast.skillId === "claw") {
        const startFrame = clawRowStartFrame(cast.level);
        const tier: ClawTier = cast.tier ?? "small";
        // Scale by tier: small=1.0, mid=1.4, big=1.8
        const scl = tier === "big" ? 1.8 : tier === "mid" ? 1.4 : 1.0;
        // Player claws render white/blue; enemy claws render red.
        const tint = cast.faction === "enemy" ? 0xff5555 : 0xffffff;
        const animKey = `claw_${tier}`;
        const sprite = this.add
          .sprite(cast.x, cast.y, "claw_sheet", startFrame)
          .setDepth(5)
          .setScale(scl)
          .setRotation(cast.angle)
          .setTint(tint);
        sprite.anims.play(animKey);
        this.clawEntities[castId] = sprite;
      }
    });

    callbacks.onRemove("skillCasts", (_cast: any, castId: string) => {
      const entity = this.clawEntities[castId];
      if (entity) {
        entity.destroy();
        delete this.clawEntities[castId];
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
  // ENEMY ANIMATIONS
  // ============================================================

  /**
   * Create animations for enemy sprite sheets.
   *
   * TYRANID (spriteSheetTRI64.png), 64x64 per frame:
   *   Row 0 (frames 0-3) = idle animation. Per spec this idle animation is
   *                        also shown while the enemy moves.
   *   Row 1 (frames 4-7) = attack animation.
   * The art faces LEFT by default. When the enemy faces right
   * (enemy.facingRight === true) the sprite is flipped HORIZONTALLY
   * (setFlipX) so it mirrors to face right.
   */
  private createEnemyAnimations(): void {
    // Tyranid idle / move animation (loops)
    this.anims.create({
      key: "tri_idle",
      frames: this.anims.generateFrameNumbers("tyranid_sheet", {
        start: 0,
        end: 3,
      }),
      frameRate: 8,
      repeat: -1,
    });

    // Tyranid attack animation (plays once)
    this.anims.create({
      key: "tri_attack",
      frames: this.anims.generateFrameNumbers("tyranid_sheet", {
        start: 4,
        end: 7,
      }),
      frameRate: 10,
      repeat: 0,
    });
  }

  // ============================================================
  // BOLTER ANIMATIONS + MUZZLE FLASH
  // ============================================================

  /**
   * Create the bolter muzzle-flash animation once.
   * BolterSpriteSheet-0002.png row 1 (frames 3,4,5) = muzzle flash frames.
   */
  private createBolterAnimations(): void {
    if (this.anims.exists("bolter_muzzle")) return;
    this.anims.create({
      key: "bolter_muzzle",
      frames: this.anims.generateFrameNumbers("bolter_sheet", {
        frames: BOLTER_MUZZLE_FRAMES,
      }),
      frameRate: 18,
      repeat: 0,
    });
  }

  /**
   * Spawn a one-shot muzzle flash, offset out from the player's center along
   * the aim direction by half the hitbox width (PLAYER_COLLISION_RADIUS) so it
   * plays just OUTSIDE the player hitbox. Rotated to the firing direction and
   * auto-destroyed on completion.
   */
  private spawnMuzzleFlash(x: number, y: number, angle: number): void {
    const offset = this.PLAYER_COLLISION_RADIUS * 1.4; // hitbox width / 2, pushed out a bit
    const ox = x + Math.cos(angle) * offset;
    const oy = y + Math.sin(angle) * offset;
    const flash = this.add
      .sprite(ox, oy, "bolter_sheet", BOLTER_MUZZLE_FRAMES[0])
      .setDepth(6)
      .setScale(0.9)
      .setRotation(angle);
    flash.anims.play("bolter_muzzle");
    flash.on("animationcomplete", () => flash.destroy());
  }

  // ============================================================
  // CLAW ANIMATIONS + VIEWPORT SYNC
  // ============================================================

  /**
   * Create the claw slash animations once (per tier).
   * clawSpritesheet-0003.png is 4 cols x 3 rows.
   */
  private createClawAnimations(): void {
    const rows: { tier: ClawTier; start: number }[] = [
      { tier: "small", start: 0 },
      { tier: "mid", start: 4 },
      { tier: "big", start: 8 },
    ];
    for (const { tier, start } of rows) {
      const key = `claw_${tier}`;
      if (this.anims.exists(key)) continue;
      this.anims.create({
        key,
        frames: this.anims.generateFrameNumbers("claw_sheet", {
          start,
          end: start + CLAW_FRAMES_PER_ROW - 1,
        }),
        frameRate: 16,
        repeat: 0,
      });
    }
  }

  /**
   * Send the camera's world-space viewport rect to the server so it can
   * activate enemy spawning only where players can see.
   */
  private sendViewport(): void {
    if (!this.room) return;
    const cam = this.cameras.main;
    const wv = cam.worldView;
    this.room.send(3, {
      x: wv.x,
      y: wv.y,
      w: wv.width,
      h: wv.height,
    });
  }

  // ============================================================
  // SKILL CARD (BOLTER in slot 1) + UPGRADE TOAST
  // ============================================================

  /** Place / refresh the bolter card art in HUD slot 1 (no level text on card). */
  private refreshBolterCard(): void {
    if (!this.cardSlots || this.cardSlots.length === 0) return;
    const slot = this.cardSlots[0];
    const frame = cardFrameForLevel("bolter", this.localBolterLevel);

    if (this.bolterCard) {
      this.bolterCard.setFrame(frame);
    } else {
      this.bolterCard = this.add
        .image(slot.x, slot.y, "card_sheet", frame)
        .setOrigin(0, 0)
        .setDisplaySize(slot.width, slot.height)
        .setScrollFactor(0)
        .setDepth(102)
        .setInteractive({ useHandCursor: true });

      // Cooldown fill overlay (blue, grows bottom-up). Hidden when ready.
      this.bolterCooldownFill = this.add
        .rectangle(slot.x, slot.y, slot.width, slot.height, 0x4da6ff, 0.45)
        .setOrigin(0, 0)
        .setScrollFactor(0)
        .setDepth(103)
        .setVisible(false);
      this.bolterCooldownFillBaseH = slot.height;

      // Hover tooltip.
      this.bolterCard.on("pointerover", () => this.showBolterTooltip(slot));
      this.bolterCard.on("pointerout", () => this.hideBolterTooltip());
    }
  }

  /** Update the cooldown dim/fill overlay based on bolterCooldownEndsAt. */
  private updateBolterCooldownOverlay(): void {
    if (!this.bolterCard || !this.bolterCooldownFill || !this.currentPlayer)
      return;
    const endsAt =
      (this.currentPlayer.data.get("bolterCdEndsAt") as number) ?? 0;
    const now = Date.now();
    if (endsAt > now) {
      // On cooldown: dim the card + show filling overlay.
      this.bolterCard.setAlpha(0.45);
      this.bolterCooldownFill.setVisible(true);
      const totalMs = 500; // bolter cooldown
      const remaining = endsAt - now;
      const fillPct = Math.max(0, Math.min(1, 1 - remaining / totalMs));
      const h = this.bolterCooldownFillBaseH * fillPct;
      // Grow from the bottom upward: move origin + reduce height.
      this.bolterCooldownFill.setSize(this.bolterCard.displayWidth, h);
      this.bolterCooldownFill.setPosition(
        this.bolterCard.x,
        this.bolterCard.y + this.bolterCooldownFillBaseH - h,
      );
    } else {
      this.bolterCard.setAlpha(1);
      this.bolterCooldownFill.setVisible(false);
    }
  }

  private showBolterTooltip(slot: Phaser.GameObjects.Rectangle): void {
    const mods = skillMods("bolter", this.localBolterLevel);
    const atk = this.currentPlayer ? Math.round(this.localPlayerAttack()) : 0;
    const cd = 0.5;
    const lines = [
      "Bolter",
      "Fires a bullet toward your aim. Chains at higher levels.",
      "ATK: " + atk,
      "Cooldown: " + cd + "s",
      "Level: " + this.localBolterLevel,
      ...mods,
    ];
    const txt = lines.join("\n");
    const tx = slot.x + slot.width + 6;
    const ty = slot.y;
    if (this.bolterTooltip) {
      this.bolterTooltip.setText(txt).setPosition(tx, ty).setVisible(true);
    } else {
      this.bolterTooltip = this.add
        .text(tx, ty, txt, {
          color: "#ffffff",
          fontSize: "13px",
          fontFamily: "monospace",
          backgroundColor: "#000000cc",
          padding: { x: 6, y: 4 },
        })
        .setOrigin(0, 0)
        .setScrollFactor(0)
        .setDepth(300);
    }
  }

  private hideBolterTooltip(): void {
    if (this.bolterTooltip) this.bolterTooltip.setVisible(false);
  }

  /** Approximate local player attack value for the tooltip. */
  private localPlayerAttack(): number {
    if (!this.currentPlayer) return 0;
    // attack is tracked via stats HUD; read from the synced schema via data.
    return (this.currentPlayer.data.get("attack") as number) ?? 100;
  }

  /** Show a transient "cards upgraded to Lv X" toast. */
  private showUpgradeToast(level: number): void {
    const msg = `Cards upgraded to Lv ${level}`;
    if (this.upgradeToast) {
      this.upgradeToast.setText(msg);
    } else {
      this.upgradeToast = this.add
        .text(this.cameras.main.centerX, 60, msg, {
          color: "#ffd700",
          fontSize: "20px",
          fontFamily: "monospace",
          stroke: "#000000",
          strokeThickness: 4,
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(200);
    }
    this.upgradeToast.setAlpha(1);
    this.tweens.killTweensOf(this.upgradeToast);
    this.time.delayedCall(1200, () => {
      this.tweens.add({
        targets: this.upgradeToast,
        alpha: 0,
        duration: 600,
      });
    });
  }

  // ============================================================
  // STATS HUD
  // ============================================================
  // ============================================================
  // HUD LAYOUT CONSTANTS (native hud.png pixels — tweak these!)
  // ============================================================
  //
  // Adjust these constants in createStatsHUD() to perfectly align the HP
  // bar and card slots with the hud.png art. All values are in NATIVE
  // image pixels (1366x479). The HUD_SCALE multiplier is applied
  // automatically so everything scales together.
  //
  //   - Hitboxes are SHOWN when you press F3 (toggleHitboxes) so you can
  //     see exactly where the regions are and align them visually.
  //   - Red colors: hpFillColor / hpBackColor are the HP bar colors.
  //   - Cards: 64x200 native card image goes into the region you define.
  //
  // ============================================================

  /**
   * Bottom-left HUD drawn over the hud.png image.
   *
   * TUNABLE CONSTANTS BELOW — adjust for perfect alignment.
   */
  private createStatsHUD(): void {
    //
    // ============================================================
    // 🔧 TUNABLE CONSTANTS START (edit these!)
    // ============================================================
    //

    // Overall HUD scale (native is 1366x479; tweak if HUD is too big/small)
    const HUD_SCALE = 0.3;

    // ---- HP bar region (native hud.png pixels) ----
    // These define WHERE on the HUD image the HP fill goes.
    const HP_X = 87; // left edge of HP fill area
    const HP_Y_TOP = 90; // top edge (HP drains DOWN from here)
    const HP_Y_BOT = 400; // bottom edge (fill is anchored here)
    const HP_WIDTH = 120; // width of HP bar

    // ---- HP bar colors ----
    const HP_BACK_COLOR = 0x1a0000; // dark empty-bar backing (deeper red)
    const HP_FILL_COLOR = 0xaa0000; // HP fill color (deeper red, not bright)
    const HP_FILL_ALPHA = 1.0;

    // ---- 5 card slot regions (native hud.png pixels) ----
    // Each slot defines WHERE on the HUD the 64x200 card goes.
    const SLOT_Y_TOP = 200;
    const SLOT_Y_BOT = 400;
    const SLOT_WIDTH = 128;
    const SLOT_X0 = 440; // slot 0 left
    const SLOT_GAP = 25; // gap between slots

    // Hitbox colors (visible when F3 is pressed)
    const HITBOX_HP_COLOR = 0x00ffff; // cyan for HP bar region
    const HITBOX_CARD_COLOR = 0xff00ff; // magenta for card slots
    const HITBOX_STROKE = 2;

    //
    // ============================================================
    // 🔧 TUNABLE CONSTANTS END
    // ============================================================
    //

    const HUD_IMG_W = 1366;
    const HUD_IMG_H = 479;
    const hudW = HUD_IMG_W * HUD_SCALE;
    const hudH = HUD_IMG_H * HUD_SCALE;

    const hudOriginX = 0;
    const hudOriginY = this.cameras.main.height - hudH;

    const nx = (x: number) => hudOriginX + x * HUD_SCALE;
    const ny = (y: number) => hudOriginY + y * HUD_SCALE;

    // ---- HUD background image ----
    this.hudImage = this.add
      .image(hudOriginX, hudOriginY, "hud")
      .setOrigin(0, 0)
      .setDisplaySize(hudW, hudH)
      .setScrollFactor(0)
      .setDepth(100);

    // ---- HP bar: back + fill ----
    const hpFullW = HP_WIDTH * HUD_SCALE;
    const hpFullH = (HP_Y_BOT - HP_Y_TOP) * HUD_SCALE;
    this.hpBarFullWidth = hpFullW;
    this.hpBarFullHeight = hpFullH;

    // Dark backing (empty bar behind the fill)
    this.add
      .rectangle(nx(HP_X), ny(HP_Y_TOP), hpFullW, hpFullH, HP_BACK_COLOR)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(101);

    // HP fill (anchored at bottom so it drains TOP->BOTTOM as HP drops)
    this.hpFill = this.add
      .rectangle(
        nx(HP_X),
        ny(HP_Y_BOT),
        hpFullW,
        hpFullH,
        HP_FILL_COLOR,
        HP_FILL_ALPHA,
      )
      .setOrigin(0, 1)
      .setScrollFactor(0)
      .setDepth(102);

    // HP text overlay
    this.hpText = this.add
      .text(nx(HP_X) + hpFullW / 2, ny(HP_Y_TOP) + hpFullH / 2, "", {
        color: "#ffffff",
        fontSize: "14px",
        fontFamily: "monospace",
        stroke: "#000000",
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(103);

    // ---- 5 card slots (empty frames ready for 64x200 cards) ----
    const slotW = SLOT_WIDTH * HUD_SCALE;
    const slotH = (SLOT_Y_BOT - SLOT_Y_TOP) * HUD_SCALE;
    const slotStep = (SLOT_WIDTH + SLOT_GAP) * HUD_SCALE;
    const slot0X = nx(SLOT_X0);
    const slot0Y = ny(SLOT_Y_TOP);

    this.cardSlots = [];
    this.hudHitboxCards = [];
    for (let i = 0; i < 5; i++) {
      const x = slot0X + i * slotStep;
      const y = slot0Y;

      // Invisible placeholder frame (for later card placement)
      const frame = this.add
        .rectangle(x, y, slotW, slotH, 0x000000, 0.0)
        .setOrigin(0, 0)
        .setScrollFactor(0)
        .setDepth(101);
      this.cardSlots.push(frame);

      // Hitbox overlay (visible when showHitboxes is true)
      const hb = this.add
        .rectangle(x, y, slotW, slotH, 0x000000, 0.0)
        .setStrokeStyle(HITBOX_STROKE, HITBOX_CARD_COLOR, 0.9)
        .setOrigin(0, 0)
        .setScrollFactor(0)
        .setDepth(1000);
      hb.setVisible(this.showHitboxes);
      this.hudHitboxCards.push(hb);
    }

    // ---- HP bar hitbox overlay ----
    this.hudHitboxHP = this.add
      .rectangle(nx(HP_X), ny(HP_Y_TOP), hpFullW, hpFullH, 0x000000, 0.0)
      .setStrokeStyle(HITBOX_STROKE, HITBOX_HP_COLOR, 0.9)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(1000);
    this.hudHitboxHP.setVisible(this.showHitboxes);

    // ---- Secondary stats text (top-right) ----
    this.statsText = this.add
      .text(this.cameras.main.width - 10, 10, "", {
        color: "#ffffff",
        fontSize: "12px",
        fontFamily: "monospace",
        align: "right",
        stroke: "#000000",
        strokeThickness: 3,
      })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(100);
  }

  /** Update the HP bar + stats text from a Player state object. */
  private updateStatsHUD(player: any): void {
    if (!this.hpFill) return;

    // ---- Vertical HP bar (anchored at bottom) ----
    const ratio =
      player.maxHealth > 0
        ? Phaser.Math.Clamp(player.currentHealth / player.maxHealth, 0, 1)
        : 0;
    // Keep width constant; shrink height with HP. Origin (0,1) keeps
    // the fill pinned to the bottom so it drains from the top.
    this.hpFill.setSize(
      this.hpBarFullWidth,
      Math.max(0.001, this.hpBarFullHeight * ratio),
    );
    this.hpText.setText(`${Math.round(ratio * 100)}%`);

    // ---- Secondary stats (top-right) ----
    if (this.statsText) {
      const pct = (v: number) => `${Math.round(v * 100)}%`;
      this.statsText.setText(
        [
          `Lv ${Math.floor(player.level)}  XP ${Math.floor(player.currentXp)}/${Math.floor(player.xpToLevelUp)}`,
          `ATK ${Math.round(player.attack)}  CRIT ${pct(player.critRate)} / ${pct(player.critDamage)}`,
        ].join("\n"),
      );
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
    // Also toggle the HUD hitbox overlays (HP bar + card slots)
    if (this.hudHitboxHP) {
      this.hudHitboxHP.setVisible(this.showHitboxes);
    }
    this.hudHitboxCards.forEach((hb) => {
      hb.setVisible(this.showHitboxes);
    });
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

    this.currentPlayer.x += dirX * this.moveSpeed * dt;
    this.currentPlayer.y += dirY * this.moveSpeed * dt;

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

    // ---- Interpolate enemies toward their server position + apply facing ----
    const now = Date.now();
    for (const enemyId in this.enemyEntities) {
      const entity = this.enemyEntities[enemyId];
      const serverX = entity.data.get("serverX") as number;
      const serverY = entity.data.get("serverY") as number;

      // Smoother interpolation (higher factor = snappier).
      if (serverX !== undefined && serverY !== undefined) {
        entity.x = Phaser.Math.Linear(entity.x, serverX, 0.35);
        entity.y = Phaser.Math.Linear(entity.y, serverY, 0.35);
      }

      // Facing: sprite faces LEFT by default; flip horizontally when right.
      const facingRight = entity.data.get("facingRight") as boolean;
      entity.setFlipX(!!facingRight);

      // Animation: attack when attacking, otherwise idle (shown for move+stand).
      const attacking = entity.data.get("attacking") as boolean;
      const eAnim = entity.anims.currentAnim;
      if (attacking) {
        if (!eAnim || eAnim.key !== "tri_attack") {
          entity.anims.play("tri_attack");
        }
      } else {
        if (!eAnim || eAnim.key !== "tri_idle") {
          entity.anims.play("tri_idle");
        }
      }

      // Hit flash: tint white while hitFlashUntil > now.
      const flashUntil = entity.data.get("hitFlashUntil") as number;
      if (flashUntil && now < flashUntil) {
        entity.setTintFill(0xffffff);
      } else {
        entity.clearTint();
      }

      // ---- Update the floating HP bar ----
      const hpBar = this.enemyHpBars[enemyId];
      if (hpBar) {
        hpBar.setPosition(entity.x, entity.y);
        const fill = hpBar.getAt(1) as Phaser.GameObjects.Rectangle;
        const hp = entity.data.get("hp") as number;
        const maxHp = entity.data.get("maxHp") as number;
        if (fill && maxHp > 0) {
          const pct = Math.max(0, hp / maxHp);
          fill.scaleX = pct;
        }
      }
    }

    // ---- Update bolter cooldown fill on the card ----
    this.updateBolterCooldownOverlay();
    // ---- Sync viewport to server (for viewport-activated spawning) ----
    this.sendViewport();
  }

  // ============================================================
  // BULLET HIT VFX
  // ============================================================

  /** Spawn a brief impact burst at a position (bullet hit wall/target). */
  private spawnBulletHitVfx(x: number, y: number): void {
    const burst = this.add.circle(x, y, 3, 0xffffff).setDepth(6);
    this.tweens.add({
      targets: burst,
      scale: 4,
      alpha: 0,
      duration: 180,
      onComplete: () => burst.destroy(),
    });
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

      for (const id in this.enemyEntities) {
        const e = this.enemyEntities[id];
        if (e) e.destroy();
        delete this.enemyEntities[id];
      }
      this.enemyEntities = {};

      for (const id in this.projectileEntities) {
        const e = this.projectileEntities[id];
        if (e) e.destroy();
        delete this.projectileEntities[id];
      }
      this.projectileEntities = {};

      for (const id in this.clawEntities) {
        const e = this.clawEntities[id];
        if (e) e.destroy();
        delete this.clawEntities[id];
      }
      this.clawEntities = {};

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
