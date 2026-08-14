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
  SKILL_CARDS,
} from "../config/skillDefs";
import { MAP_INFO, MODIFIER_DISPLAY } from "../config/modifiers";

// ============================================================
// Game Scene
// ============================================================

// Alias for skill card lookup in character screen
const SKILL_CARDS_LOOKUP = SKILL_CARDS;

/**
 * Format large numbers with suffixes: k, mil, bil, tril, quadr, etc.
 * Below 100,000 the raw number is shown. Above that, suffixes apply.
 */
function formatNumber(n: number): string {
  if (n < 100_000) return Math.floor(n).toString();
  const tiers: [number, string][] = [
    [1e15, "quadr"],
    [1e12, "tril"],
    [1e9, "bil"],
    [1e6, "mil"],
    [1e3, "k"],
  ];
  for (const [threshold, suffix] of tiers) {
    if (n >= threshold) {
      const val = n / threshold;
      return (
        (val >= 100
          ? val.toFixed(0)
          : val >= 10
            ? val.toFixed(1)
            : val.toFixed(2)) +
        " " +
        suffix
      );
    }
  }
  return Math.floor(n).toString();
}

export class GameScene extends Phaser.Scene {
  client = new Client(BACKEND_URL);
  room: any = null;

  // ---- Entity tracking ----
  currentPlayer!: Phaser.GameObjects.Sprite;
  /** The local player's state object (for reading HP/XP/level). */
  currentPlayerState: any = null;
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
  private pulseAnimCreated: boolean = false;
  /** Slam VFX sprites keyed by slam id. */
  slamEntities: { [id: string]: Phaser.GameObjects.Sprite } = {};
  private slamAnimCreated: boolean = false;
  private shockAnimCreated: boolean = false;
  /** Death screen overlay container (null when hidden). */
  private deathOverlay: Phaser.GameObjects.Container | null = null;
  private wasDead: boolean = false;

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

  // ---- Shock card (slot 5) + Claw card (slot 3) ----
  private shockCard!: Phaser.GameObjects.Image;
  private localShockLevel: number = 1;
  private shockCooldownFill!: Phaser.GameObjects.Rectangle;
  private shockCooldownFillBaseH: number = 0;
  private clawCard!: Phaser.GameObjects.Image;
  private localClawLevel: number = 1;
  private clawCooldownFill!: Phaser.GameObjects.Rectangle;
  private clawCooldownFillBaseH: number = 0;

  // ---- Heal card (slot 4) ----
  private healCard!: Phaser.GameObjects.Image;
  private localHealLevel: number = 1;
  private healCooldownFill!: Phaser.GameObjects.Rectangle;
  private healCooldownFillBaseH: number = 0;

  // ---- Pulse card (slot 2) ----
  private pulseCard!: Phaser.GameObjects.Image;
  private localPulseLevel: number = 1;
  private pulseCooldownFill!: Phaser.GameObjects.Rectangle;
  private pulseCooldownFillBaseH: number = 0;

  // ---- Skill-on-cooldown toast (shown above the HUD in light grey) ----
  private cooldownToast!: Phaser.GameObjects.Text;

  // ---- XP bar (top-center): thin blue bar + level badge + gain popups ----
  private xpBarBack!: Phaser.GameObjects.Rectangle;
  private xpBarFill!: Phaser.GameObjects.Rectangle;
  /** White overlay that shows the XP gained portion; fades to reveal blue. */
  private xpBarGain!: Phaser.GameObjects.Rectangle;
  /** Small pill/badge in front of the XP bar showing current level. */
  private levelBadge!: Phaser.GameObjects.Container;
  private levelBadgeText!: Phaser.GameObjects.Text;
  /** Numeric text overlay inside the XP bar ("120 / 1000"). */
  private xpBarText!: Phaser.GameObjects.Text;
  /** Last synced XP/level values used to detect gains. */
  private lastKnownXp: number = -1;
  private lastKnownLevel: number = -1;
  /** Reusable "+N xp" floating text objects (pooled to avoid per-gain alloc). */
  private xpGainPopups: Phaser.GameObjects.Text[] = [];
  /** Pooled floating damage number texts (world-space). */
  private damageTexts: Phaser.GameObjects.Text[] = [];
  /** Per-entity last seen hitSeq (to detect new damage events). */
  private entityHitSeqs: Record<string, number> = {};
  /** Reusable level-up celebration toast. */
  private levelUpToast!: Phaser.GameObjects.Text;
  /** Full unscaled width of the XP bar (px). */
  private xpBarFullWidth: number = 0;
  /** Screen-space Y of the XP bar (px). */
  private xpBarY: number = 0;

  // ---- Map info button (top-right corner) + hover tooltip ----
  private mapInfoButton!: Phaser.GameObjects.Image;
  private mapInfoTooltip!: Phaser.GameObjects.Container;
  private mapInfoTooltipBg!: Phaser.GameObjects.Graphics;

  // ---- Character stats screen (toggle with C) ----
  private charScreen!: Phaser.GameObjects.Container;
  private charScreenVisible: boolean = false;
  private charScreenKey!: Phaser.Input.Keyboard.Key;
  private testSkillPointKey!: Phaser.Input.Keyboard.Key;
  // Skill point badge (blinking) on the XP bar level text
  private skillPointBadge!: Phaser.GameObjects.Container;
  private skillPointBadgePulse: Phaser.Tweens.Tween | null = null;
  private skillPointBadgeText!: Phaser.GameObjects.Text;
  // Confirmation popup (reused)
  private confirmPopup!: Phaser.GameObjects.Container;

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
  private readonly PLAYER_COLLISION_RADIUS = 10;

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
  // Shield bar (light blue) drawn just above the HP bar.
  private shieldFill!: Phaser.GameObjects.Rectangle;
  private shieldText!: Phaser.GameObjects.Text;
  private shieldBarFullHeight: number = 0;
  private shieldBarFullWidth: number = 0;
  // Low-HP / low-shield edge vignettes (local player only).
  private lowHpVignette: Phaser.GameObjects.Rectangle[] = [];
  private lowShieldVignette: Phaser.GameObjects.Rectangle[] = [];

  // ---- Character animation state ----
  private animationsCreated: boolean = false;
  private lastDirection: string = "down"; // default facing direction

  // ---- Debug HUD (fixed to screen) ----
  private debugFPS!: Phaser.GameObjects.Text;
  private showHitboxes: boolean = false;
  private debugHitboxes: Phaser.GameObjects.Graphics | null = null;
  /** Live entity hitbox overlay (player/enemy/projectile/claw circles). */
  private debugEntityHitboxes: Phaser.GameObjects.Graphics | null = null;
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
      nextSceneKey: "game", // Map2 exit goes back to Map1
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
    // ---- Clear ALL stale state from any previous run of this scene ----
    // When the scene is stopped and relaunched (e.g. map2 -> map1),
    // Phaser destroys all game objects but the TS class fields still
    // hold references to them. Using those references crashes.
    // We must null-out every field that holds a game object or
    // per-scene mutable state so that create() can build fresh ones.
    this.currentPlayer = null as any;
    this.currentPlayerState = null;
    this.transitioning = false;
    this.wasDead = false;
    this.room = null;
    this.playerEntities = {};
    this.enemyEntities = {};
    this.projectileEntities = {};
    this.clawEntities = {};
    this.slamEntities = {};
    this.enemyHpBars = {};
    this.enemyLastPos = {};
    this.projLastPos = {};
    this.entityHitSeqs = {};
    this.cardSlots = [];
    this.hudHitboxCards = [];
    this.xpGainPopups = [];
    this.damageTexts = [];
    this.animationsCreated = false;
    this.enemyAnimationsCreated = false;
    this.bolterMuzzleAnimCreated = false;
    this.clawAnimCreated = false;
    this.pulseAnimCreated = false;
    this.slamAnimCreated = false;
    this.shockAnimCreated = false;
    this.lastKnownXp = -1;
    this.lastKnownLevel = -1;
    this.localBolterLevel = 1;
    this.localShockLevel = 1;
    this.localClawLevel = 1;
    this.localHealLevel = 1;
    // Null out game object references so create* methods rebuild them
    this.bolterCard = null as any;
    this.bolterCooldownFill = null as any;
    this.bolterTooltip = null as any;
    this.shockCard = null as any;
    this.shockCooldownFill = null as any;
    this.clawCard = null as any;
    this.clawCooldownFill = null as any;
    this.healCard = null as any;
    this.healCooldownFill = null as any;
    this.hudImage = null as any;
    this.hpFill = null as any;
    this.hpText = null as any;
    this.statsText = null as any;
    this.debugFPS = null as any;
    this.xpBarBack = null as any;
    this.xpBarFill = null as any;
    this.xpBarGain = null as any;
    this.levelBadge = null as any;
    this.levelBadgeText = null as any;
    this.xpBarText = null as any;
    this.levelUpToast = null as any;
    this.mapInfoButton = null as any;
    this.mapInfoTooltip = null as any;
    this.mapInfoTooltipBg = null as any;
    this.charScreen = null as any;
    this.charScreenVisible = false;
    this.skillPointBadge = null as any;
    this.skillPointBadgeText = null as any;
    this.confirmPopup = null as any;
    this.upgradeToast = null as any;
    this.cooldownToast = null as any;
    this.debugHitboxes = null;
    this.debugEntityHitboxes = null;
    this.hitboxToggleButton = null as any;
    this.deathOverlay = null;

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
        // Right-click: pulse skill.
        if (!this.isSkillReady("pulse")) {
          this.showCooldownToast();
          return;
        }
        this.room.send(1, { skill: "pulse", angle });
        return;
      }
      // Left-click: bolter skill.
      if (!this.isSkillReady("bolter")) {
        this.showCooldownToast();
        return;
      }
      if (!this.bolterMuzzleAnimCreated) {
        this.createBolterAnimations();
        this.bolterMuzzleAnimCreated = true;
      }
      this.spawnMuzzleFlash(this.currentPlayer.x, this.currentPlayer.y, angle);
      this.room.send(1, { skill: "bolter", angle });
    });

    // ---- "0" key levels up the player (debug — test enemy scaling) ----
    this.input.keyboard
      ?.addKey(Phaser.Input.Keyboard.KeyCodes.ZERO)
      ?.on("down", () => {
        if (!this.room) return;
        this.room.send(9, {});
      });

    // ---- Space key casts claw skill ----
    this.input.keyboard
      ?.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE)
      ?.on("down", () => {
        if (!this.currentPlayer || !this.room) return;
        if (!this.isSkillReady("claw")) {
          this.showCooldownToast();
          return;
        }
        const angle = this.aimAngle;
        this.room.send(1, { skill: "claw", angle });
      });

    // ---- "1" key casts heal skill ----
    this.input.keyboard
      ?.addKey(Phaser.Input.Keyboard.KeyCodes.ONE)
      ?.on("down", () => {
        if (!this.currentPlayer || !this.room) return;
        if (!this.isSkillReady("heal")) {
          this.showCooldownToast();
          return;
        }
        this.room.send(1, { skill: "heal", angle: this.aimAngle });
      });

    // ---- "2" key casts shock skill ----
    this.input.keyboard
      ?.addKey(Phaser.Input.Keyboard.KeyCodes.TWO)
      ?.on("down", () => {
        if (!this.currentPlayer || !this.room) return;
        if (!this.isSkillReady("shock")) {
          this.showCooldownToast();
          return;
        }
        this.room.send(1, { skill: "shock", angle: this.aimAngle });
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

    // Live entity hitbox overlay (redrawn each frame)
    this.debugEntityHitboxes = this.add.graphics().setDepth(11);
    this.debugEntityHitboxes.setVisible(false);

    // ---- Debug HUD (FPS + hitbox toggle button) ----
    this.createDebugHUD();

    // ---- Stats HUD (health / level / xp / attack / crit) ----
    this.createStatsHUD();
    // ---- XP bar (top-center) ----
    this.createXpBar();
    // ---- Map info button (top-right) ----
    this.createMapInfoButton();
    // ---- Character stats screen (press C) ----
    this.createCharacterScreen();
    // Place the skill cards in slots 1-3 (initial level 1).
    this.refreshBolterCard();
    this.refreshPulseCard();
    this.refreshShockCard();
    this.refreshClawCard();
    this.refreshHealCard();

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
        this.currentPlayerState = player;

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
            // Refresh the XP bar (detects XP gain / level-up)
            this.updateXpBar(player);
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
            this.currentPlayer.setData(
              "slamCdEndsAt",
              player.slamCooldownEndsAt ?? 0,
            );
            this.currentPlayer.setData(
              "shockCdEndsAt",
              player.shockCooldownEndsAt ?? 0,
            );
            this.currentPlayer.setData(
              "clawCdEndsAt",
              player.clawCooldownEndsAt ?? 0,
            );
            this.currentPlayer.setData(
              "pulseCdEndsAt",
              player.pulseCooldownEndsAt ?? 0,
            );
            // Heal readiness + cooldown
            this.currentPlayer.setData("healReady", player.healReady ?? true);
            this.currentPlayer.setData(
              "healCdEndsAt",
              player.healCooldownEndsAt ?? 0,
            );
            this.currentPlayer.setData("healKills", player.healKills ?? 0);
            this.currentPlayer.setData(
              "hitFlashUntil",
              player.hitFlashUntil ?? 0,
            );
            this.currentPlayer.setData("shockUntil", player.shockUntil ?? 0);
            this.currentPlayer.setData("hitboxW", player.hitboxW ?? 10);
            this.currentPlayer.setData("hitboxH", player.hitboxH ?? 10);
            // Detect damage taken by local player.
            const pseq = player.hitSeq ?? 0;
            const pprev = this.entityHitSeqs["__local__"] ?? 0;
            if (pseq !== pprev) {
              this.entityHitSeqs["__local__"] = pseq;
              if (player.lastHitDamage > 0) {
                this.showDamageNumber(
                  this.currentPlayer.x,
                  this.currentPlayer.y,
                  player.lastHitDamage,
                  !!player.lastHitCrit,
                  (player as any).lastShieldDamage,
                  (player as any).lastHpDamage,
                );
              }
            }
            // Sync claw level + card art
            const clawLvl =
              player.skillLevels && player.skillLevels.get
                ? (player.skillLevels.get("claw") ?? 1)
                : 1;
            if (clawLvl !== this.localClawLevel) {
              this.localClawLevel = clawLvl;
              this.refreshClawCard();
            }
            // Sync heal level + card art
            const healLvl =
              player.skillLevels && player.skillLevels.get
                ? (player.skillLevels.get("heal") ?? 1)
                : 1;
            if (healLvl !== this.localHealLevel) {
              this.localHealLevel = healLvl;
              this.refreshHealCard();
            }
            // Sync pulse level + card art
            const pulseLvl =
              player.skillLevels && player.skillLevels.get
                ? (player.skillLevels.get("pulse") ?? 1)
                : 1;
            if (pulseLvl !== this.localPulseLevel) {
              this.localPulseLevel = pulseLvl;
              this.refreshPulseCard();
            }
            // Sync shock level + card art
            const shockLvl =
              player.skillLevels && player.skillLevels.get
                ? (player.skillLevels.get("shock") ?? 1)
                : 1;
            if (shockLvl !== this.localShockLevel) {
              this.localShockLevel = shockLvl;
              this.refreshShockCard();
            }
          }
        });
      } else {
        // ---- REMOTE PLAYER ----
        // Store server position for interpolation
        callbacks.onChange(player, () => {
          sprite.setData("serverX", player.x);
          sprite.setData("serverY", player.y);
          sprite.setData("hitFlashUntil", player.hitFlashUntil ?? 0);
          sprite.setData("hitboxW", player.hitboxW ?? 10);
          sprite.setData("hitboxH", player.hitboxH ?? 10);
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

      const isOrck = enemy.typeId === "orck";
      const textureKey = isOrck ? "orck_sheet" : "tyranid_sheet";
      const idleAnim = isOrck ? "orck_idle" : "tri_idle";
      const displaySize = isOrck ? 80 : 64;
      const sprite = this.add
        .sprite(enemy.x, enemy.y, textureKey, 0)
        .setDisplaySize(displaySize, displaySize)
        .setDepth(3);
      sprite.anims.play(idleAnim);
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
      // White translucent shield bar overlaid on top of the HP bar.
      // Visible only when the enemy has a shield (maxShield > 0).
      const shieldFill = this.add
        .rectangle(-hpW / 2, -42, hpW, hpH, 0xffffff, 0.6)
        .setOrigin(0, 0.5)
        .setVisible(false);
      // Enemy level text shown in front of (left of) the HP bar
      const lvText = this.add
        .text(-hpW / 2 - 4, -42, String(enemy.level ?? 1), {
          color: "#ffffff",
          fontSize: "9px",
          fontFamily: "monospace",
          stroke: "#000000",
          strokeThickness: 2,
        })
        .setOrigin(1, 0.5);
      const hpBar = this.add
        .container(enemy.x, enemy.y, [hpBg, hpFill, shieldFill, lvText])
        .setDepth(5);
      this.enemyHpBars[enemyId] = hpBar;

      this.enemyLastPos[enemyId] = { x: enemy.x, y: enemy.y };

      // Initialize data so render loop works from the first frame.
      sprite.setData("hitFlashUntil", enemy.hitFlashUntil ?? 0);
      sprite.setData("shockUntil", enemy.shockUntil ?? 0);
      sprite.setData("hitboxW", enemy.hitboxW ?? 12);
      sprite.setData("hitboxH", enemy.hitboxH ?? 12);
      sprite.setData("hp", enemy.currentHealth);
      sprite.setData("maxHp", enemy.maxHealth);
      sprite.setData("shield", enemy.shield ?? 0);
      sprite.setData("maxShield", enemy.maxShield ?? 0);
      sprite.setData("level", enemy.level ?? 1);
      sprite.setData("attacking", false);

      callbacks.onChange(enemy, () => {
        sprite.setData("serverX", enemy.x);
        sprite.setData("serverY", enemy.y);
        sprite.setData("facingRight", !!enemy.facingRight);
        sprite.setData("hp", enemy.currentHealth);
        sprite.setData("maxHp", enemy.maxHealth);
        sprite.setData("shield", enemy.shield ?? 0);
        sprite.setData("maxShield", enemy.maxShield ?? 0);
        sprite.setData("level", enemy.level ?? 1);
        sprite.setData("hitFlashUntil", enemy.hitFlashUntil);
        sprite.setData("shockUntil", enemy.shockUntil ?? 0);
        sprite.setData("hitboxW", enemy.hitboxW ?? 12);
        sprite.setData("hitboxH", enemy.hitboxH ?? 12);
        sprite.setData("attacking", !!enemy.attacking);
        this.enemyLastPos[enemyId] = { x: enemy.x, y: enemy.y };
        // Detect new damage events via hitSeq counter.
        const seq = enemy.hitSeq ?? 0;
        const prev = this.entityHitSeqs[enemyId] ?? 0;
        if (seq !== prev) {
          this.entityHitSeqs[enemyId] = seq;
          if (enemy.lastHitDamage > 0) {
            this.showDamageNumber(
              enemy.x,
              enemy.y,
              enemy.lastHitDamage,
              !!enemy.lastHitCrit,
              (enemy as any).lastShieldDamage,
              (enemy as any).lastHpDamage,
            );
          }
        }
      });
    });

    callbacks.onRemove("enemies", (enemy: any, enemyId: string) => {
      // Show killing blow damage number (often missed when enemy is one-shot)
      if (enemy && enemy.lastHitDamage > 0) {
        this.showDamageNumber(
          enemy.x ?? this.enemyLastPos[enemyId]?.x ?? 0,
          enemy.y ?? this.enemyLastPos[enemyId]?.y ?? 0,
          enemy.lastHitDamage,
          !!enemy.lastHitCrit,
          (enemy as any).lastShieldDamage,
          (enemy as any).lastHpDamage,
        );
      }
      // Spawn blood splat VFX at enemy death position
      const dx = enemy?.x ?? this.enemyLastPos[enemyId]?.x ?? 0;
      const dy = enemy?.y ?? this.enemyLastPos[enemyId]?.y ?? 0;
      this.spawnBloodSplat(dx, dy);

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
      delete this.entityHitSeqs[enemyId];
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
      console.log(
        "[DEBUG] skillCast onAdd:",
        cast.skillId,
        "level:",
        cast.level,
        "tier:",
        cast.tier,
        "angle:",
        cast.angle,
        "range:",
        cast.range,
        "faction:",
        cast.faction,
      );
      if (!this.clawAnimCreated) {
        this.createClawAnimations();
        this.clawAnimCreated = true;
      }
      if (cast.skillId === "claw") {
        const startFrame = clawRowStartFrame(cast.level);
        const tier: ClawTier = cast.tier ?? "small";
        // Place the UNSCALED 64px sprite at the OUTER EDGE of the hitbox cone
        // so the animation visually covers the tip of the hitbox.
        // If the cone range is 200px and the sprite is 64px, the sprite sits
        // from (200-64)=136px to 200px from the caster along the aim direction.
        // The sprite CENTER is at: castPos + (range - 32) along the aim angle.
        // (32 = half the sprite width since the sprite is drawn centered.)
        // This applies in ALL directions because we use the aim angle vector.
        const range: number =
          cast.range || (tier === "big" ? 110 : tier === "mid" ? 85 : 60);
        const SPRITE_NATIVE = 64;
        // Scale sprite to match hitbox size (range = hitbox radius)
        // At base range (60px for small), scale = 1.0 (64px sprite ≈ 60px hitbox)
        // At higher levels with larger hitboxes, scale up proportionally
        const clawScale = Math.max(1.0, range / 60);
        const scaledSpriteSize = SPRITE_NATIVE * clawScale;
        const halfSprite = scaledSpriteSize / 2;
        const edgeDist = range - halfSprite;
        const edgeX = cast.x + Math.cos(cast.angle) * edgeDist;
        const edgeY = cast.y + Math.sin(cast.angle) * edgeDist;
        // Player claws render white/blue; enemy claws render red.
        const tint = cast.faction === "enemy" ? 0xff5555 : 0xffffff;
        const animKey = `claw_${tier}`;
        const sprite = this.add
          .sprite(edgeX, edgeY, "claw_sheet", startFrame)
          .setDepth(5)
          .setScale(clawScale)
          .setRotation(cast.angle)
          .setTint(tint);
        sprite.anims.play(animKey);
        (sprite as any).castData = cast; // store for debug hitbox overlay
        this.clawEntities[castId] = sprite;
      } else if (cast.skillId === "heal") {
        // Heal VFX: green flash for self-heal (range=0), green circle for AoE
        const radius = cast.range ?? 0;
        if (radius > 0) {
          // AoE heal circle — expanding green ring
          const circle = this.add
            .circle(cast.x, cast.y, radius, 0x00ff00, 0.2)
            .setStrokeStyle(3, 0x00ff00, 0.8)
            .setDepth(6);
          this.tweens.add({
            targets: circle,
            alpha: 0,
            scale: 1.3,
            duration: 700,
            ease: "Cubic.out",
            onComplete: () => circle.destroy(),
          });
          this.clawEntities[castId] = circle as any;
        } else {
          // Self-heal green flash
          const flash = this.add
            .circle(cast.x, cast.y, 24, 0x00ff00, 0.6)
            .setDepth(6);
          this.tweens.add({
            targets: flash,
            alpha: 0,
            scale: 2.5,
            duration: 500,
            ease: "Cubic.out",
            onComplete: () => flash.destroy(),
          });
          this.clawEntities[castId] = flash as any;
        }
      } else if (cast.skillId === "pulse") {
        // Pulse VFX: use pulse spritesheet animation (like claw/slam pattern)
        if (!this.pulseAnimCreated) {
          this.createPulseAnimations();
          this.pulseAnimCreated = true;
        }
        const tier: string = cast.level >= 6 ? "big" : "small";
        const startFrame = tier === "big" ? 4 : 0;
        const radius: number = cast.range ?? 80;
        // Scale sprite to match the pulse radius
        const SPRITE_NATIVE = 64;
        const pulseScale = Math.max(1.0, (radius * 2) / SPRITE_NATIVE);
        const animKey = `pulse_${tier}`;
        const sprite = this.add
          .sprite(cast.x, cast.y, "pulse_sheet", startFrame)
          .setDepth(7)
          .setScale(pulseScale);
        sprite.anims.play(animKey);
        sprite.on("animationcomplete", () => sprite.destroy());
        (sprite as any).castData = cast;
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

    // ---- Shock VFX listeners (Phaser-drawn lightning) ----
    callbacks.onAdd("shockCasts", (shock: any, shockId: string) => {
      // Blue for L1-5, purple for L6+
      const color = shock.level >= 6 ? 0xb266ff : 0x4da6ff;
      const fillColor = shock.level >= 6 ? 0x6a1fb2 : 0x1a5cad;

      // Parse segments from flat string
      const segStr: string = shock.segments || "";
      const segments: {
        x1: number;
        y1: number;
        x2: number;
        y2: number;
        delay: number;
      }[] = [];
      if (segStr.length > 0) {
        for (const part of segStr.split(";")) {
          const [x1, y1, x2, y2, delay] = part.split(",").map(Number);
          if (!isNaN(x1)) segments.push({ x1, y1, x2, y2, delay });
        }
      }

      // Store hitbox reference for F3 overlay
      const hbRef = this.add.rectangle(shock.x, shock.y, 1, 1, 0xffffff, 0);
      hbRef.setDepth(7);
      (hbRef as any).castData = {
        skillId: "shock",
        x: shock.x,
        y: shock.y,
        angle: shock.aimAngle ?? 0,
        level: shock.level,
      };
      this.clawEntities[shockId] = hbRef;
      this.time.delayedCall(500, () => {
        if (hbRef && hbRef.active) hbRef.destroy();
        delete this.clawEntities[shockId];
      });

      // Draw each lightning segment
      for (const seg of segments) {
        this.time.delayedCall(seg.delay, () => {
          if (!this.scene.isActive()) return;
          this.drawLightningBolt(
            seg.x1,
            seg.y1,
            seg.x2,
            seg.y2,
            color,
            fillColor,
          );
        });
      }
    });

    callbacks.onRemove("shockCasts", (_shock: any, shockId: string) => {
      const entity = this.clawEntities[shockId];
      if (entity) {
        entity.destroy();
        delete this.clawEntities[shockId];
      }
    });

    // ============================================================
    // SLAM STATE LISTENERS
    // ============================================================
    callbacks.onAdd("slams", (slam: any, slamId: string) => {
      const isUpgraded = slam.level >= 6;
      // Scale slam sprite with hitbox size: base scale 1.5, +10% per level above 2
      const slamScale = 1.5 * Math.pow(1.1, Math.max(0, slam.level - 2));
      const sprite = this.add
        .sprite(slam.x, slam.y, "slam_sheet", 0)
        .setDepth(4)
        .setScale(slamScale)
        .setRotation(slam.angle);
      sprite.setData("slamLevel", slam.level);
      sprite.setData("isUpgraded", isUpgraded);
      sprite.setData("angle", slam.angle);
      sprite.setData("remainingRange", slam.remainingRange);
      this.slamEntities[slamId] = sprite;

      callbacks.onChange(slam, () => {
        sprite.setPosition(slam.x, slam.y);
        sprite.setData("remainingRange", slam.remainingRange);
      });
    });

    callbacks.onRemove("slams", (_slam: any, slamId: string) => {
      const entity = this.slamEntities[slamId];
      if (entity) {
        entity.destroy();
        delete this.slamEntities[slamId];
      }
    });
  }

  // ============================================================
  // SERVER CONNECTION
  // ============================================================

  async connect() {
    // Read playerState from previous scene (passed via scene.launch)
    const data = this.sys.settings.data as any;
    const playerState = data?.playerState ?? null;
    console.log(
      `[CONNECT] Scene "${this.sys.settings.key}" connecting to room "${this.roomName}" with playerState=${playerState ? "yes" : "no"}`,
    );
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      // When carrying playerState (a map transition), always CREATE a fresh
      // room instance so enemies spawn correctly. Otherwise joinOrCreate
      // might rejoin a stale room that has all spawn zones exhausted.
      const roomPromise = playerState
        ? this.client.create(this.roomName, { playerState })
        : this.client.joinOrCreate(this.roomName, { playerState });
      // Add a timeout so we don't hang on the loading screen forever
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error("Room connection timeout")),
          10000,
        );
      });
      this.room = await Promise.race([roomPromise, timeoutPromise]);
      console.log(
        `[CONNECT] Connected to room "${this.roomName}" successfully`,
      );
    } catch (e) {
      console.error("Failed to connect:", e);
      this.room = null;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
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
   * Create the pulse skill animations once (per tier).
   * pulseskillsheet.png is 4 cols x 2 rows, 64x64 each.
   * Row 0 (frames 0-3): base pulse (levels 1-5).
   * Row 1 (frames 4-7): upgraded pulse (levels 6-10).
   */
  private createPulseAnimations(): void {
    const rows: { tier: string; start: number }[] = [
      { tier: "small", start: 0 },
      { tier: "big", start: 4 },
    ];
    for (const { tier, start } of rows) {
      const key = `pulse_${tier}`;
      if (this.anims.exists(key)) continue;
      this.anims.create({
        key,
        frames: this.anims.generateFrameNumbers("pulse_sheet", {
          start,
          end: start + 3,
        }),
        frameRate: 20,
        repeat: 0,
      });
    }
  }

  /**
   * Draw a jagged lightning bolt from (x1,y1) to (x2,y2) using Phaser graphics.
   * Renders a bright core line + a wider glow line + spark circle at impact.
   * Auto-fades and destroys.
   */
  private drawLightningBolt(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: number,
    fillColor: number,
  ): void {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dist = Math.hypot(dx, dy);
    if (dist < 1) return;
    const nx = -dy / dist; // perpendicular normal
    const ny = dx / dist;

    // Generate jagged midpoint offsets
    const segments = Math.max(4, Math.floor(dist / 30));
    const points: { x: number; y: number }[] = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const px = x1 + dx * t;
      const py = y1 + dy * t;
      // Jagged offset, less at start/end
      const jag = i === 0 || i === segments ? 0 : (Math.random() - 0.5) * 24;
      points.push({ x: px + nx * jag, y: py + ny * jag });
    }

    // --- Glow layer (wide, semi-transparent) ---
    const glow = this.add.graphics();
    glow.setDepth(6);
    glow.lineStyle(8, fillColor, 0.35);
    glow.beginPath();
    glow.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++)
      glow.lineTo(points[i].x, points[i].y);
    glow.strokePath();

    // --- Core layer (bright, thin) ---
    const core = this.add.graphics();
    core.setDepth(7);
    core.lineStyle(2.5, color, 1.0);
    core.beginPath();
    core.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++)
      core.lineTo(points[i].x, points[i].y);
    core.strokePath();

    // --- Impact spark at target ---
    const spark = this.add.circle(x2, y2, 12, color, 0.9);
    spark.setDepth(8);
    const sparkGlow = this.add.circle(x2, y2, 20, fillColor, 0.4);
    sparkGlow.setDepth(7);

    // Animate: flicker then fade
    this.tweens.add({
      targets: [core, glow],
      alpha: 0,
      duration: 250,
      delay: 60,
      onComplete: () => {
        core.destroy();
        glow.destroy();
      },
    });
    this.tweens.add({
      targets: [spark, sparkGlow],
      alpha: 0,
      scale: 2.5,
      duration: 300,
      onComplete: () => {
        spark.destroy();
        sparkGlow.destroy();
      },
    });

    // Re-draw the bolt once with different jaggedness for a flicker effect
    this.time.delayedCall(30, () => {
      if (!core.active) return;
      core.clear();
      core.lineStyle(2.5, color, 0.9);
      core.beginPath();
      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const px = x1 + dx * t;
        const py = y1 + dy * t;
        const jag = i === 0 || i === segments ? 0 : (Math.random() - 0.5) * 24;
        const px2 = px + nx * jag;
        const py2 = py + ny * jag;
        if (i === 0) core.moveTo(px2, py2);
        else core.lineTo(px2, py2);
      }
      core.strokePath();
    });
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

    // Orck walk animation (row 0, frames 0-4, loops)
    this.anims.create({
      key: "orck_idle",
      frames: this.anims.generateFrameNumbers("orck_sheet", {
        start: 0,
        end: 4,
      }),
      frameRate: 10,
      repeat: -1,
    });

    // Orck attack animation (row 1, frames 5-9, plays once)
    this.anims.create({
      key: "orck_attack",
      frames: this.anims.generateFrameNumbers("orck_sheet", {
        start: 5,
        end: 9,
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

  /** Place / refresh the shock card art in HUD slot 5. */
  private refreshShockCard(): void {
    if (!this.cardSlots || this.cardSlots.length < 5) return;
    const slot = this.cardSlots[4];
    const frame = cardFrameForLevel("shock", this.localShockLevel);
    if (this.shockCard) {
      this.shockCard.setFrame(frame);
    } else {
      this.shockCard = this.add
        .image(slot.x, slot.y, "card_sheet", frame)
        .setOrigin(0, 0)
        .setDisplaySize(slot.width, slot.height)
        .setScrollFactor(0)
        .setDepth(102);

      // Cooldown fill overlay (purple, grows bottom-up).
      this.shockCooldownFill = this.add
        .rectangle(slot.x, slot.y, slot.width, slot.height, 0xb266ff, 0.45)
        .setOrigin(0, 0)
        .setScrollFactor(0)
        .setDepth(103)
        .setVisible(false);
      this.shockCooldownFillBaseH = slot.height;
    }
  }

  /** Place / refresh the claw card art in HUD slot 3. */
  private refreshClawCard(): void {
    if (!this.cardSlots || this.cardSlots.length < 3) return;
    const slot = this.cardSlots[2];
    const frame = cardFrameForLevel("claw", this.localClawLevel);
    if (this.clawCard) {
      this.clawCard.setFrame(frame);
    } else {
      this.clawCard = this.add
        .image(slot.x, slot.y, "card_sheet", frame)
        .setOrigin(0, 0)
        .setDisplaySize(slot.width, slot.height)
        .setScrollFactor(0)
        .setDepth(102);

      // Cooldown fill overlay (green, grows bottom-up).
      this.clawCooldownFill = this.add
        .rectangle(slot.x, slot.y, slot.width, slot.height, 0x44ff44, 0.45)
        .setOrigin(0, 0)
        .setScrollFactor(0)
        .setDepth(103)
        .setVisible(false);
      this.clawCooldownFillBaseH = slot.height;
    }
  }

  /** Place / refresh the heal card art in HUD slot 4. */
  private refreshHealCard(): void {
    if (!this.cardSlots || this.cardSlots.length < 4) return;
    const slot = this.cardSlots[3];
    const frame = cardFrameForLevel("heal", this.localHealLevel);
    if (this.healCard) {
      this.healCard.setFrame(frame);
    } else {
      this.healCard = this.add
        .image(slot.x, slot.y, "card_sheet", frame)
        .setOrigin(0, 0)
        .setDisplaySize(slot.width, slot.height)
        .setScrollFactor(0)
        .setDepth(102);

      this.healCooldownFill = this.add
        .rectangle(slot.x, slot.y, slot.width, slot.height, 0x00ff00, 0.45)
        .setOrigin(0, 0)
        .setScrollFactor(0)
        .setDepth(103)
        .setVisible(false);
      this.healCooldownFillBaseH = slot.height;
    }
  }

  /** Place / refresh the pulse card art in HUD slot 2. */
  private refreshPulseCard(): void {
    if (!this.cardSlots || this.cardSlots.length < 2) return;
    const slot = this.cardSlots[1];
    const frame = cardFrameForLevel("pulse", this.localPulseLevel);
    if (this.pulseCard) {
      this.pulseCard.setFrame(frame);
    } else {
      this.pulseCard = this.add
        .image(slot.x, slot.y, "card_sheet", frame)
        .setOrigin(0, 0)
        .setDisplaySize(slot.width, slot.height)
        .setScrollFactor(0)
        .setDepth(102);

      // Cooldown fill overlay (purple, grows bottom-up).
      this.pulseCooldownFill = this.add
        .rectangle(slot.x, slot.y, slot.width, slot.height, 0xb266ff, 0.45)
        .setOrigin(0, 0)
        .setScrollFactor(0)
        .setDepth(103)
        .setVisible(false);
      this.pulseCooldownFillBaseH = slot.height;
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

  /** Update the shock cooldown overlay. */
  private updateShockCooldownOverlay(): void {
    if (!this.shockCard || !this.shockCooldownFill || !this.currentPlayer)
      return;
    const endsAt =
      (this.currentPlayer.data.get("shockCdEndsAt") as number) ?? 0;
    const now = Date.now();
    if (endsAt > now) {
      this.shockCard.setAlpha(0.45);
      this.shockCooldownFill.setVisible(true);
      const totalMs = 700;
      const remaining = endsAt - now;
      const fillPct = Math.max(0, Math.min(1, 1 - remaining / totalMs));
      const h = this.shockCooldownFillBaseH * fillPct;
      this.shockCooldownFill.setSize(this.shockCard.displayWidth, h);
      this.shockCooldownFill.setPosition(
        this.shockCard.x,
        this.shockCard.y + this.shockCooldownFillBaseH - h,
      );
    } else {
      this.shockCard.setAlpha(1);
      this.shockCooldownFill.setVisible(false);
    }
  }

  /** Update the claw cooldown overlay. */
  private updateClawCooldownOverlay(): void {
    if (!this.clawCard || !this.clawCooldownFill || !this.currentPlayer) return;
    const endsAt = (this.currentPlayer.data.get("clawCdEndsAt") as number) ?? 0;
    const now = Date.now();
    if (endsAt > now) {
      this.clawCard.setAlpha(0.45);
      this.clawCooldownFill.setVisible(true);
      const totalMs = 500;
      const remaining = endsAt - now;
      const fillPct = Math.max(0, Math.min(1, 1 - remaining / totalMs));
      const h = this.clawCooldownFillBaseH * fillPct;
      this.clawCooldownFill.setSize(this.clawCard.displayWidth, h);
      this.clawCooldownFill.setPosition(
        this.clawCard.x,
        this.clawCard.y + this.clawCooldownFillBaseH - h,
      );
    } else {
      this.clawCard.setAlpha(1);
      this.clawCooldownFill.setVisible(false);
    }
  }

  /** Update heal card overlay: dim when not ready, show charge/cooldown fill. */
  private updateHealCooldownOverlay(): void {
    if (!this.healCard || !this.healCooldownFill || !this.currentPlayer) return;
    const ready = (this.currentPlayer.data.get("healReady") as boolean) ?? true;
    if (ready) {
      this.healCard.setAlpha(1);
      this.healCooldownFill.setVisible(false);
      return;
    }
    // Not ready — check if it's cooldown-based (L5+) or kill-based (L1-4)
    const endsAt = (this.currentPlayer.data.get("healCdEndsAt") as number) ?? 0;
    const now = Date.now();
    this.healCard.setAlpha(0.45);
    this.healCooldownFill.setVisible(true);
    if (endsAt > now) {
      // Cooldown-based (L5+)
      const totalMs = 10000;
      const remaining = endsAt - now;
      const fillPct = Math.max(0, Math.min(1, 1 - remaining / totalMs));
      const h = this.healCooldownFillBaseH * fillPct;
      this.healCooldownFill.setSize(this.healCard.displayWidth, h);
      this.healCooldownFill.setPosition(
        this.healCard.x,
        this.healCard.y + this.healCooldownFillBaseH - h,
      );
    } else {
      // Kill-based (L1-4): show partial fill based on kills
      const kills = (this.currentPlayer.data.get("healKills") as number) ?? 0;
      const fillPct = kills / 5;
      const h = this.healCooldownFillBaseH * fillPct;
      this.healCooldownFill.setSize(this.healCard.displayWidth, h);
      this.healCooldownFill.setPosition(
        this.healCard.x,
        this.healCard.y + this.healCooldownFillBaseH - h,
      );
    }
  }

  /** Update the pulse cooldown overlay. */
  private updatePulseCooldownOverlay(): void {
    if (!this.pulseCard || !this.pulseCooldownFill || !this.currentPlayer)
      return;
    const endsAt =
      (this.currentPlayer.data.get("pulseCdEndsAt") as number) ?? 0;
    const now = Date.now();
    if (endsAt > now) {
      this.pulseCard.setAlpha(0.45);
      this.pulseCooldownFill.setVisible(true);
      const totalMs = 5000;
      const remaining = endsAt - now;
      const fillPct = Math.max(0, Math.min(1, 1 - remaining / totalMs));
      const h = this.pulseCooldownFillBaseH * fillPct;
      this.pulseCooldownFill.setSize(this.pulseCard.displayWidth, h);
      this.pulseCooldownFill.setPosition(
        this.pulseCard.x,
        this.pulseCard.y + this.pulseCooldownFillBaseH - h,
      );
    } else {
      this.pulseCard.setAlpha(1);
      this.pulseCooldownFill.setVisible(false);
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

  /** True if a skill is off cooldown (client-side check using synced data). */
  private isSkillReady(
    skill: "bolter" | "claw" | "shock" | "heal" | "pulse",
  ): boolean {
    if (!this.currentPlayer) return true;
    if (skill === "heal") {
      return (this.currentPlayer.data.get("healReady") as boolean) ?? true;
    }
    if (skill === "pulse") {
      const endsAt =
        (this.currentPlayer.data.get("pulseCdEndsAt") as number) ?? 0;
      return endsAt <= Date.now();
    }
    if (skill === "shock") {
      const endsAt =
        (this.currentPlayer.data.get("shockCdEndsAt") as number) ?? 0;
      return endsAt <= Date.now();
    }
    const key = skill + "CdEndsAt";
    const endsAt = (this.currentPlayer.data.get(key) as number) ?? 0;
    return endsAt <= Date.now();
  }

  /** Show a transient "skill in cooldown" message above the HUD. */
  private showCooldownToast(): void {
    const msg = "skill in cooldown";
    const x = this.cameras.main.centerX;
    const y = this.hudImage
      ? this.hudImage.y - 18
      : this.cameras.main.height - 160;
    if (this.cooldownToast) {
      this.cooldownToast.setText(msg).setPosition(x, y);
    } else {
      this.cooldownToast = this.add
        .text(x, y, msg, {
          color: "#cccccc",
          fontSize: "16px",
          fontFamily: "monospace",
          stroke: "#000000",
          strokeThickness: 3,
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(200);
    }
    this.cooldownToast.setAlpha(1);
    this.tweens.killTweensOf(this.cooldownToast);
    this.time.delayedCall(600, () => {
      this.tweens.add({
        targets: this.cooldownToast,
        alpha: 0,
        duration: 400,
      });
    });
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

    // ---- Shield bar region (native hud.png pixels) ----
    // The shield bar sits just ABOVE the HP bar (further toward the top of
    // the HUD image), same width as HP. Tune SHIELD_Y_TOP to move it.
    // SHIELD_Y_BOT == HP_Y_TOP so the shield bar's bottom touches the HP bar's top.
    const SHIELD_Y_TOP = 90; // top edge of the shield bar (higher = taller)
    const SHIELD_Y_BOT = 400; // bottom edge of the shield bar (== HP_Y_TOP)
    // X position of the shield bar (native hud.png pixels). Defaults to the
    // same X as the HP bar; change this to move the shield bar elsewhere.
    const SHIELD_X = 238;
    const SHIELD_BACK_COLOR = 0x06141c; // dark empty backing (deep blue)
    const SHIELD_FILL_COLOR = 0x33b5ff; // light-blue shield fill
    const SHIELD_FILL_ALPHA = 0.9;

    // ---- 5 card slot regions (native hud.png pixels) ----
    // Each slot defines WHERE on the HUD the 64x200 card goes.
    const SLOT_Y_TOP = 150;
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

    // ---- Shield bar: back + fill + text (drawn ABOVE the HP bar) ----
    // Use the same width as the HP bar. The shield bar extends upward from
    // the top of the HP bar (SHIELD_Y_BOT == HP_Y_TOP).
    const shieldFullW = hpFullW;
    const shieldFullH = (SHIELD_Y_BOT - SHIELD_Y_TOP) * HUD_SCALE;
    this.shieldBarFullWidth = shieldFullW;
    this.shieldBarFullHeight = shieldFullH;
    this.add
      .rectangle(
        nx(SHIELD_X),
        ny(SHIELD_Y_TOP),
        shieldFullW,
        shieldFullH,
        SHIELD_BACK_COLOR,
      )
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(101);
    this.shieldFill = this.add
      .rectangle(
        nx(SHIELD_X),
        ny(SHIELD_Y_BOT),
        shieldFullW,
        shieldFullH,
        SHIELD_FILL_COLOR,
        SHIELD_FILL_ALPHA,
      )
      .setOrigin(0, 1)
      .setScrollFactor(0)
      .setDepth(102);
    this.shieldText = this.add
      .text(
        nx(SHIELD_X) + shieldFullW / 2,
        ny(SHIELD_Y_TOP) + shieldFullH / 2,
        "",
        {
          color: "#eaf6ff",
          fontSize: "11px",
          fontFamily: "monospace",
          stroke: "#000000",
          strokeThickness: 3,
        },
      )
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(103);

    // ---- Low-HP / low-shield edge vignettes (screen-edge tints) ----
    // Four thin rectangles per color around the playable window edges.
    // They start invisible and are driven by updateVignettes() each tick.
    const camW = this.cameras.main.width;
    const camH = this.cameras.main.height;
    const V_THICK = 36; // edge thickness in px (tune)
    // Left and right edge bars only (cleaner look than full-frame vignette).
    const makeVignette = (color: number): Phaser.GameObjects.Rectangle[] => {
      const lef = this.add
        .rectangle(V_THICK / 2, camH / 2, V_THICK, camH, color)
        .setScrollFactor(0)
        .setDepth(490)
        .setAlpha(0);
      const rig = this.add
        .rectangle(camW - V_THICK / 2, camH / 2, V_THICK, camH, color)
        .setScrollFactor(0)
        .setDepth(490)
        .setAlpha(0);
      return [lef, rig];
    };
    this.lowHpVignette = makeVignette(0xff0000);
    this.lowShieldVignette = makeVignette(0x33b5ff);

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

  // ============================================================
  // XP BAR (top-center)
  // ============================================================

  /**
   * Create the thin blue XP bar at the top-center of the screen.
   * Layout:  [ Lv 5 ]  [========blue bar showing xp=========]
   *                ^- level badge in front of the bar.
   *
   * Structure (left to right):
   *   1. levelBadge  - rounded blue pill with "Lv N" text
   *   2. xpBarBack   - dark backing rectangle (empty bar)
   *   3. xpBarFill   - blue fill (current xp progress)
   *   4. xpBarGain   - white overlay on newly gained portion
   *   5. xpBarText   - "120 / 1000" centered text
   */
  private createXpBar(): void {
    const W = this.cameras.main.width;
    const OFFSET_X = -300;
    const cx = W / 2 + OFFSET_X;

    // ============================================================
    // 🔧 TUNABLE XP BAR CONSTANTS — edit these to reposition!
    // ============================================================
    //
    // BAR_W        Width of the XP bar in pixels.
    // BAR_H        Height of the XP bar in pixels.
    // BADGE_GAP    Gap between level text and bar left edge.
    // ABOVE_HUD_GAP  How many px ABOVE the HUD image top edge.
    //               Increase to push the bar higher above the HUD.
    //               Set to 0 to sit directly on top of the HUD.
    // OFFSET_X     Horizontal shift of the whole XP bar row.
    //               0 = screen center (default).
    //               Negative = shift LEFT  (e.g. -200 moves it left).
    //               Positive = shift RIGHT (e.g. 200 moves it right).
    //
    // ============================================================
    const BAR_W = Math.min(W * 0.35, 196);
    const BAR_H = 6;
    const BADGE_GAP = 6;
    const ABOVE_HUD_GAP = -34;
    const BACK_COLOR = 0x0a1a2a;
    const FILL_COLOR = 0x2f8fff;

    // Position the bar ABOVE the HUD image (above the cards).
    // hudOriginY = top edge of the HUD image on screen.
    const HUD_SCALE_TMP = 0.3;
    const HUD_IMG_H_TMP = 479;
    const hudTopY = this.cameras.main.height - HUD_IMG_H_TMP * HUD_SCALE_TMP;
    const TOP_Y = hudTopY - ABOVE_HUD_GAP - BAR_H;

    // Measure the level text so we can lay out: [Lv N]  [==bar==]
    // We will create the text first, then position the bar to its right.
    // For now compute approximate layout assuming text width ~ 36px.
    const levelTextApproxW = 36;
    const totalW = levelTextApproxW + BADGE_GAP + BAR_W;
    const rowLeft = cx - totalW / 2;
    const barX = rowLeft + levelTextApproxW + BADGE_GAP;
    const levelTextX = rowLeft + levelTextApproxW / 2;
    const cy = TOP_Y + BAR_H / 2;

    this.xpBarFullWidth = BAR_W;
    this.xpBarY = cy;

    // ---- XP bar back (dark empty bar) ----
    this.xpBarBack = this.add
      .rectangle(barX, TOP_Y, BAR_W, BAR_H, BACK_COLOR)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(150);

    // ---- XP bar fill (blue, grows left to right) ----
    this.xpBarFill = this.add
      .rectangle(barX, TOP_Y, 0, BAR_H, FILL_COLOR)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(151);

    // ---- XP bar gain overlay (white, starts invisible) ----
    this.xpBarGain = this.add
      .rectangle(barX, TOP_Y, 0, BAR_H, 0xffffff)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(152)
      .setAlpha(0);

    // ---- Numeric text overlay inside the bar ----
    this.xpBarText = this.add
      .text(barX + BAR_W / 2, cy, "", {
        color: "#ffffff",
        fontSize: "10px",
        fontFamily: "monospace",
        stroke: "#000000",
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(153);

    // ---- Level text (gold, no background) ----
    this.levelBadgeText = this.add
      .text(levelTextX, cy, "Lv 1", {
        color: "#ffd700",
        fontSize: "14px",
        fontFamily: "monospace",
        fontStyle: "bold",
        stroke: "#000000",
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(153);

    // Dummy container reference (no background graphic anymore)
    this.levelBadge = this.add
      .container(0, 0, [this.levelBadgeText])
      .setScrollFactor(0)
      .setDepth(151);

    // ---- Skill point badge (blinking dot top-right of level text) ----
    const badgeX = levelTextX + 16;
    const badgeY = cy - 10;
    const badgeBg = this.add.graphics().setScrollFactor(0).setDepth(154);
    badgeBg.fillStyle(0xffd700, 1);
    badgeBg.fillCircle(badgeX, badgeY, 6);
    badgeBg.lineStyle(2, 0xffffff, 0.9);
    badgeBg.strokeCircle(badgeX, badgeY, 6);
    this.skillPointBadgeText = this.add
      .text(badgeX, badgeY, "1", {
        color: "#000000",
        fontSize: "10px",
        fontFamily: "monospace",
        fontStyle: "bold",
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(155);
    this.skillPointBadge = this.add
      .container(0, 0, [badgeBg, this.skillPointBadgeText])
      .setScrollFactor(0)
      .setDepth(154)
      .setVisible(false);

    // ---- Make level text clickable to open character screen ----
    this.levelBadgeText.setInteractive({ useHandCursor: true });
    this.levelBadgeText.on("pointerdown", () => {
      if (!this.charScreenVisible) this.toggleCharacterScreen();
    });
  }

  /**
   * Refresh the XP bar from a Player state object.
   * Detects XP gain (currentXp increased without a level change) and triggers
   *   - white flash on the gained portion that fades to reveal blue
   *   - "+N xp" popup text at top-center
   * Detects level-up and triggers a celebration toast.
   *
   * @param player - the synced Player state for the local player.
   */
  private updateXpBar(player: any): void {
    if (!this.xpBarFill) return;

    const level = Math.floor(player.level ?? 1);
    const currentXp = Math.floor(player.currentXp ?? 0);
    const xpToLevelUp = Math.max(1, Math.floor(player.xpToLevelUp ?? 1));

    // ---- Update level badge text ----
    this.levelBadgeText.setText("Lv " + level);

    // ---- Compute fill ratio ----
    const ratio = Phaser.Math.Clamp(currentXp / xpToLevelUp, 0, 1);
    const fillW = this.xpBarFullWidth * ratio;
    this.xpBarFill.setSize(fillW, this.xpBarFill.height);

    // ---- Update numeric overlay ----
    this.xpBarText.setText(
      formatNumber(currentXp) + " / " + formatNumber(xpToLevelUp),
    );

    // ---- Detect XP gain / level-up ----
    if (this.lastKnownLevel !== -1) {
      // Normal XP gain (same level, xp went up)
      if (level === this.lastKnownLevel && currentXp > this.lastKnownXp) {
        const gained = currentXp - this.lastKnownXp;
        this.flashXpBarGain(this.lastKnownXp, currentXp, xpToLevelUp);
        this.showXpGainPopup(gained);
      } else if (level > this.lastKnownLevel) {
        // Level-up occurred. The server addXp() rolls excess XP into the
        // new level, so show: (a) XP that completed the previous bar + (b)
        // XP carried into the new level as a separate gain popup.
        this.showLevelUpToast(level);
        // Flash full bar white then reset for new level
        this.flashLevelUpBar();
        // Show popup for XP already in new level (if any)
        if (currentXp > 0) {
          this.flashXpBarGain(0, currentXp, xpToLevelUp);
          this.showXpGainPopup(currentXp);
        }
      }
      // XP loss (death penalty) - just silently update the bar
    }

    this.lastKnownXp = currentXp;
    this.lastKnownLevel = level;

    // ---- Update skill point badge visibility ----
    const sp = Math.floor(player.skillPoints ?? 0);
    if (sp > 0) {
      this.skillPointBadgeText.setText(String(sp));
      this.skillPointBadge.setVisible(true);
      if (!this.skillPointBadgePulse) {
        this.skillPointBadgePulse = this.tweens.add({
          targets: this.skillPointBadge,
          alpha: { from: 0.4, to: 1.0 },
          duration: 500,
          yoyo: true,
          repeat: -1,
          ease: "Sine.inOut",
        });
      }
    } else {
      this.skillPointBadge.setVisible(false);
      if (this.skillPointBadgePulse) {
        this.skillPointBadgePulse.stop();
        this.skillPointBadgePulse = null;
        this.skillPointBadge.setAlpha(1);
      }
    }
  }

  /**
   * White flash overlay on the gained portion of the XP bar, fades out to
   * reveal the blue fill underneath.
   */
  private flashXpBarGain(
    fromXp: number,
    toXp: number,
    xpToLevelUp: number,
  ): void {
    if (!this.xpBarGain) return;
    const startX = this.xpBarFill.x;
    const fromRatio = Phaser.Math.Clamp(fromXp / xpToLevelUp, 0, 1);
    const toRatio = Phaser.Math.Clamp(toXp / xpToLevelUp, 0, 1);
    const gainX = startX + this.xpBarFullWidth * fromRatio;
    const gainW = this.xpBarFullWidth * (toRatio - fromRatio);
    if (gainW < 0.5) return;

    // Position the white gain overlay over the newly gained portion
    this.xpBarGain
      .setPosition(gainX, this.xpBarFill.y)
      .setSize(gainW, this.xpBarFill.height)
      .setAlpha(1);

    // Fade the white overlay out so the blue fill shows through
    this.tweens.killTweensOf(this.xpBarGain);
    this.tweens.add({
      targets: this.xpBarGain,
      alpha: 0,
      duration: 600,
      ease: "Cubic.out",
      delay: 80,
    });
  }

  /** Full-bar white flash used on level-up. */
  private flashLevelUpBar(): void {
    if (!this.xpBarGain) return;
    this.xpBarGain
      .setPosition(this.xpBarFill.x, this.xpBarFill.y)
      .setSize(this.xpBarFullWidth, this.xpBarFill.height)
      .setAlpha(1);
    this.tweens.killTweensOf(this.xpBarGain);
    this.tweens.add({
      targets: this.xpBarGain,
      alpha: 0,
      duration: 800,
      ease: "Cubic.out",
      delay: 150,
    });
  }

  /**
   * Show a small "+N xp" popup at the top-center of the screen.
   * The text rises and fades out over ~1 second.
   * Uses a simple pool to avoid allocating a new Text each gain.
   */
  private showXpGainPopup(amount: number): void {
    if (amount <= 0) return;
    // Center the popup above the middle of the XP bar
    const x = this.xpBarFill.x + this.xpBarFullWidth / 2;
    const y = this.xpBarY + 18;

    // Try to reuse an idle popup from the pool
    let popup: Phaser.GameObjects.Text | null = null;
    for (const p of this.xpGainPopups) {
      if (p.alpha === 0 || !p.active) {
        popup = p;
        break;
      }
    }
    if (!popup) {
      // Cap pool size to avoid runaway allocations
      if (this.xpGainPopups.length >= 8) {
        // Reuse the oldest one
        popup = this.xpGainPopups[0];
      } else {
        popup = this.add
          .text(x, y, "", {
            color: "#bfe3ff",
            fontSize: "12px",
            fontFamily: "monospace",
            fontStyle: "bold",
            stroke: "#000000",
            strokeThickness: 3,
          })
          .setOrigin(0.5)
          .setScrollFactor(0)
          .setDepth(201);
        this.xpGainPopups.push(popup);
      }
    }

    popup
      .setPosition(x, y)
      .setText("+" + formatNumber(amount) + " xp")
      .setAlpha(1)
      .setActive(true)
      .setVisible(true);

    this.tweens.killTweensOf(popup);
    this.tweens.add({
      targets: popup,
      y: y - 24,
      alpha: 0,
      duration: 1000,
      ease: "Cubic.out",
      delay: 100,
      onComplete: () => {
        popup!.setActive(false);
      },
    });
  }

  /**
   * Spawn a floating damage number at a world position.
   * White for normal hits, gold + larger for critical hits.
   */
  private showDamageNumber(
    x: number,
    y: number,
    damage: number,
    isCrit: boolean,
    shieldDamage?: number,
    hpDamage?: number,
  ): void {
    // Determine color: blue for shield damage, white for HP damage.
    const sd = shieldDamage ?? 0;
    const hd = hpDamage ?? (sd > 0 ? damage - sd : damage);
    // If shield absorbed everything, show blue; if split, show both.
    const isShieldHit = sd > 0 && hd <= 0;
    if (damage <= 0) return;
    // Random horizontal jitter so overlapping hits don't stack perfectly.
    const jitterX = (Math.random() - 0.5) * 16;
    const startY = y - 20;

    // Reuse an idle text from the pool.
    let txt: Phaser.GameObjects.Text | null = null;
    for (const t of this.damageTexts) {
      if (t.alpha === 0 || !t.active) {
        txt = t;
        break;
      }
    }
    if (!txt) {
      if (this.damageTexts.length >= 30) {
        txt = this.damageTexts[0];
      } else {
        txt = this.add
          .text(x, startY, "", {
            color: "#ffffff",
            fontSize: "14px",
            fontFamily: "monospace",
            fontStyle: "bold",
            stroke: "#000000",
            strokeThickness: 3,
          })
          .setOrigin(0.5)
          .setDepth(300);
        this.damageTexts.push(txt);
      }
    }

    // Blue for shield damage, white for HP damage, gold for crit.
    const baseColor = isShieldHit ? "#33b5ff" : "#ffffff";
    const label = isCrit
      ? Math.round(damage) + "!"
      : String(Math.round(damage));
    txt
      .setPosition(x + jitterX, startY)
      .setText(label)
      .setFontSize(isCrit ? "20px" : "14px")
      .setColor(isCrit ? "#ffd700" : baseColor)
      .setAlpha(1)
      .setActive(true)
      .setVisible(true);

    this.tweens.killTweensOf(txt);
    this.tweens.add({
      targets: txt,
      y: startY - 32,
      alpha: 0,
      duration: isCrit ? 900 : 700,
      ease: "Cubic.out",
      delay: 80,
      onComplete: () => {
        txt!.setActive(false);
      },
    });
  }

  /** Show a level-up celebration toast at top-center. */
  private showLevelUpToast(level: number): void {
    const msg = "LEVEL UP!  Lv " + level;
    const x = this.cameras.main.width / 2;
    const y = 36;
    if (this.levelUpToast) {
      this.levelUpToast.setText(msg).setPosition(x, y);
    } else {
      this.levelUpToast = this.add
        .text(x, y, msg, {
          color: "#ffd700",
          fontSize: "18px",
          fontFamily: "monospace",
          fontStyle: "bold",
          stroke: "#000000",
          strokeThickness: 4,
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(201);
    }
    this.levelUpToast.setAlpha(1);
    this.tweens.killTweensOf(this.levelUpToast);
    // Quick scale pop on appear
    this.levelUpToast.setScale(1.3);
    this.tweens.add({
      targets: this.levelUpToast,
      scale: 1,
      duration: 250,
      ease: "Back.out",
    });
    this.time.delayedCall(1500, () => {
      this.tweens.add({
        targets: this.levelUpToast,
        alpha: 0,
        duration: 600,
      });
    });
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

    // ---- Vertical shield bar (same anchoring pattern as HP) ----
    if (this.shieldFill) {
      const maxS = (player as any).maxShield ?? 0;
      const curS = (player as any).shield ?? 0;
      if (maxS > 0) {
        const sRatio = Phaser.Math.Clamp(curS / maxS, 0, 1);
        this.shieldFill.setVisible(true);
        this.shieldFill.setSize(
          this.shieldBarFullWidth,
          Math.max(0.001, this.shieldBarFullHeight * sRatio),
        );
        if (this.shieldText) {
          this.shieldText.setVisible(true);
          this.shieldText.setText(`${Math.round(sRatio * 100)}%`);
        }
      } else {
        // No shield equipped: hide the bar + text.
        this.shieldFill.setVisible(false);
        if (this.shieldText) this.shieldText.setVisible(false);
      }
    }

    // ---- Secondary stats (top-right) ----
    if (this.statsText) {
      const pct = (v: number) => `${Math.round(v * 100)}%`;
      this.statsText.setText(
        [
          `Lv ${Math.floor(player.level)}  XP ${formatNumber(player.currentXp)}/${formatNumber(player.xpToLevelUp)}`,
          `ATK ${Math.round(player.attack)}  CRIT ${pct(player.critRate)} / ${pct(player.critDamage)}`,
        ].join("\n"),
      );
    }
  }

  /**
   * Update the low-HP (red) and low-shield (blue) edge vignettes for the
   * LOCAL player only. Effects are per-client (only this player sees their
   * own low-health/low-shield warning). Both fade in/out smoothly.
   *
   * Low-HP: red edges when currentHealth/maxHealth < 0.30 (grows stronger as
   *         HP drops, fully visible near death).
   * Low-shield: light-blue edges when shield/maxShield <= 0.20 AND the shield
   *         is still active (shield > 0). When the shield is fully broken
   *         (shield === 0) the effect goes away.
   */
  private updateVignettes(): void {
    const p = this.currentPlayerState;
    if (!p || !this.lowHpVignette.length) return;

    // ---- Low-HP red vignette (< 30% health) ----
    let hpAlpha = 0;
    if (p.maxHealth > 0) {
      const hpRatio = p.currentHealth / p.maxHealth;
      if (hpRatio < 0.3) {
        // 0 at 0.30 -> 0.55 at 0 (strong, but not fully opaque).
        hpAlpha = Phaser.Math.Clamp(((0.3 - hpRatio) / 0.3) * 0.55, 0, 0.55);
      }
    }
    for (const r of this.lowHpVignette) r.setAlpha(hpAlpha);

    // ---- Low-shield blue vignette (<= 20% shield, still active) ----
    let shAlpha = 0;
    const maxS = (p as any).maxShield ?? 0;
    const curS = (p as any).shield ?? 0;
    if (maxS > 0 && curS > 0) {
      const sRatio = curS / maxS;
      if (sRatio <= 0.2) {
        shAlpha = Phaser.Math.Clamp(((0.2 - sRatio) / 0.2) * 0.5, 0, 0.5);
      }
    }
    // When shield is broken (0) the effect goes away (shAlpha stays 0).
    for (const r of this.lowShieldVignette) r.setAlpha(shAlpha);
  }

  // ============================================================
  // MAP INFO BUTTON + TOOLTIP
  // ============================================================

  private createMapInfoButton(): void {
    const W = this.cameras.main.width;
    const ICON_SIZE = 40;
    const MARGIN = 50;

    this.mapInfoButton = this.add
      .image(W - ICON_SIZE / 2 - MARGIN, ICON_SIZE / 2 + 5, "map_info_icon")
      .setDisplaySize(ICON_SIZE, ICON_SIZE)
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(150)
      .setInteractive({ useHandCursor: true });

    this.mapInfoTooltip = this.add
      .container(0, 0)
      .setDepth(300)
      .setVisible(false)
      .setScrollFactor(0);

    const tooltipW = 320;
    const padding = 12;
    let tooltipY = padding;

    const roomName = this.roomName ?? "game_room";
    const mapInfo = MAP_INFO[roomName] ?? { name: roomName, description: "" };

    const nameText = this.add
      .text(padding, tooltipY, mapInfo.name, {
        color: "#ffd700",
        fontSize: "16px",
        fontFamily: "monospace",
        fontStyle: "bold",
        stroke: "#000000",
        strokeThickness: 3,
      })
      .setOrigin(0, 0)
      .setScrollFactor(0);
    this.mapInfoTooltip.add(nameText);
    tooltipY += nameText.height + 6;

    if (mapInfo.description) {
      const descText = this.add
        .text(padding, tooltipY, mapInfo.description, {
          color: "#cccccc",
          fontSize: "12px",
          fontFamily: "monospace",
          wordWrap: { width: tooltipW - padding * 2 },
          stroke: "#000000",
          strokeThickness: 2,
        })
        .setOrigin(0, 0)
        .setScrollFactor(0);
      this.mapInfoTooltip.add(descText);
      tooltipY += descText.height + 8;
    }

    const modHeader = this.add
      .text(padding, tooltipY, "Active Modifiers", {
        color: "#ffffff",
        fontSize: "12px",
        fontFamily: "monospace",
        fontStyle: "bold",
        stroke: "#000000",
        strokeThickness: 2,
      })
      .setOrigin(0, 0)
      .setScrollFactor(0);
    this.mapInfoTooltip.add(modHeader);
    tooltipY += modHeader.height + 4;

    const modifiers: any[] = (this.room?.metadata?.modifiers as any[]) ?? [];
    if (modifiers.length === 0) {
      const noneText = this.add
        .text(padding, tooltipY, "None", {
          color: "#888888",
          fontSize: "11px",
          fontFamily: "monospace",
          stroke: "#000000",
          strokeThickness: 2,
        })
        .setOrigin(0, 0)
        .setScrollFactor(0);
      this.mapInfoTooltip.add(noneText);
      tooltipY += noneText.height + 4;
    } else {
      for (const mod of modifiers) {
        const disp = MODIFIER_DISPLAY[mod.id as keyof typeof MODIFIER_DISPLAY];
        const color = disp?.color ?? "#ffffff";
        const title = disp?.title ?? mod.title ?? mod.id;
        const desc = disp?.description ?? mod.description ?? "";
        const modText = this.add
          .text(padding, tooltipY, "\u25cf " + title, {
            color: color,
            fontSize: "11px",
            fontFamily: "monospace",
            fontStyle: "bold",
            stroke: "#000000",
            strokeThickness: 2,
          })
          .setOrigin(0, 0)
          .setScrollFactor(0);
        this.mapInfoTooltip.add(modText);
        tooltipY += modText.height + 2;
        const modDesc = this.add
          .text(padding + 14, tooltipY, desc, {
            color: "#aaaaaa",
            fontSize: "10px",
            fontFamily: "monospace",
            wordWrap: { width: tooltipW - padding * 2 - 14 },
            stroke: "#000000",
            strokeThickness: 2,
          })
          .setOrigin(0, 0)
          .setScrollFactor(0);
        this.mapInfoTooltip.add(modDesc);
        tooltipY += modDesc.height + 4;
      }
    }

    const tooltipH = tooltipY + padding;
    this.mapInfoTooltipBg = this.add
      .graphics()
      .setScrollFactor(0)
      .setDepth(299);
    this.mapInfoTooltipBg.fillStyle(0x0a0a14, 0.92);
    this.mapInfoTooltipBg.fillRoundedRect(0, 0, tooltipW, tooltipH, 8);
    this.mapInfoTooltipBg.lineStyle(2, 0x4a6a8a, 0.8);
    this.mapInfoTooltipBg.strokeRoundedRect(0, 0, tooltipW, tooltipH, 8);
    this.mapInfoTooltip.add(this.mapInfoTooltipBg);
    this.mapInfoTooltip.sendToBack(this.mapInfoTooltipBg);

    const tx = this.mapInfoButton.x - ICON_SIZE / 2 - tooltipW - 4;
    const ty = this.mapInfoButton.y - ICON_SIZE / 2;
    this.mapInfoTooltip.setPosition(tx, ty);

    this.mapInfoButton.on("pointerover", () => {
      this.mapInfoTooltip.setVisible(true);
    });
    this.mapInfoButton.on("pointerout", () => {
      this.mapInfoTooltip.setVisible(false);
    });
  }

  // ============================================================
  // CHARACTER STATS SCREEN (press C to toggle)
  // ============================================================

  private createCharacterScreen(): void {
    const W = this.cameras.main.width;
    const H = this.cameras.main.height;
    const PANEL_W = 520;
    const PANEL_H = Math.min(H - 60, 600);
    const px = Math.round((W - PANEL_W) / 2);
    const py = Math.round((H - PANEL_H) / 2);

    this.charScreen = this.add
      .container(0, 0)
      .setDepth(400)
      .setVisible(false)
      .setScrollFactor(0);

    // ---- Dim overlay ----
    const overlay = this.add
      .rectangle(0, 0, W, H, 0x000000, 0.6)
      .setOrigin(0, 0)
      .setScrollFactor(0);
    overlay.setInteractive(); // block clicks going through
    overlay.on("pointerdown", () => {
      if (this.charScreenVisible) this.toggleCharacterScreen();
    });
    this.charScreen.add(overlay);

    // ---- Panel background ----
    const panelBg = this.add.graphics().setScrollFactor(0);
    panelBg.fillStyle(0x0a0a14, 0.95);
    panelBg.fillRoundedRect(px, py, PANEL_W, PANEL_H, 12);
    panelBg.lineStyle(2, 0x4a6a8a, 0.9);
    panelBg.strokeRoundedRect(px, py, PANEL_W, PANEL_H, 12);
    this.charScreen.add(panelBg);

    // ---- Title ----
    const titleText = this.add
      .text(px + PANEL_W / 2, py + 14, "CHARACTER", {
        color: "#ffd700",
        fontSize: "20px",
        fontFamily: "monospace",
        fontStyle: "bold",
        stroke: "#000000",
        strokeThickness: 4,
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0);
    this.charScreen.add(titleText);

    // ---- Close hint + skill points display ----
    const closeHint = this.add
      .text(px + PANEL_W - 12, py + 8, "[C] Close", {
        color: "#888888",
        fontSize: "11px",
        fontFamily: "monospace",
        stroke: "#000000",
        strokeThickness: 2,
      })
      .setOrigin(1, 0)
      .setScrollFactor(0);
    this.charScreen.add(closeHint);

    // Skill points banner
    const spBanner = this.add
      .text(px + 20, py + 8, "", {
        color: "#ffd700",
        fontSize: "13px",
        fontFamily: "monospace",
        fontStyle: "bold",
        stroke: "#000000",
        strokeThickness: 3,
      })
      .setOrigin(0, 0)
      .setScrollFactor(0);
    this.charScreen.add(spBanner);
    (this.charScreen as any)._spBanner = spBanner;

    // Store layout constants for updates
    (this.charScreen as any)._px = px;
    (this.charScreen as any)._py = py;
    (this.charScreen as any)._panelW = PANEL_W;
    (this.charScreen as any)._panelH = PANEL_H;

    // Dynamic content container (destroyed and rebuilt on each update)
    (this.charScreen as any)._dynChildren = [];

    // ---- C key to toggle ----
    this.charScreenKey = this.input.keyboard.addKey(
      Phaser.Input.Keyboard.KeyCodes.C,
    );
    this.charScreenKey.on("down", () => {
      this.toggleCharacterScreen();
    });

    // ---- ESC key to close ----
    const escKey = this.input.keyboard.addKey(
      Phaser.Input.Keyboard.KeyCodes.ESC,
    );
    escKey.on("down", () => {
      if (this.charScreenVisible) this.toggleCharacterScreen();
    });

    // ---- Key 9: test skill point ----
    this.testSkillPointKey = this.input.keyboard.addKey(
      Phaser.Input.Keyboard.KeyCodes.NINE,
    );
    this.testSkillPointKey.on("down", () => {
      if (this.room) this.room.send(8, {});
    });

    // ---- Confirmation popup (reused, hidden by default) ----
    this.confirmPopup = this.add
      .container(0, 0)
      .setDepth(500)
      .setVisible(false)
      .setScrollFactor(0);
    const cOverlay = this.add
      .rectangle(0, 0, W, H, 0x000000, 0.3)
      .setOrigin(0, 0)
      .setScrollFactor(0);
    cOverlay.setInteractive();
    const cBg = this.add.graphics().setScrollFactor(0);
    const cW = 300,
      cH = 120;
    const cx2 = Math.round((W - cW) / 2),
      cy2 = Math.round((H - cH) / 2);
    cBg.fillStyle(0x12121e, 0.97);
    cBg.fillRoundedRect(cx2, cy2, cW, cH, 10);
    cBg.lineStyle(2, 0x4a6a8a, 0.9);
    cBg.strokeRoundedRect(cx2, cy2, cW, cH, 10);
    const cText = this.add
      .text(W / 2, cy2 + 18, "", {
        color: "#ffffff",
        fontSize: "14px",
        fontFamily: "monospace",
        align: "center",
        wordWrap: { width: cW - 40 },
        stroke: "#000000",
        strokeThickness: 3,
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0);
    const cYes = this.add
      .text(W / 2 - 50, cy2 + cH - 32, "[ YES ]", {
        color: "#66bb6a",
        fontSize: "14px",
        fontFamily: "monospace",
        fontStyle: "bold",
        stroke: "#000000",
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true });
    const cNo = this.add
      .text(W / 2 + 50, cy2 + cH - 32, "[ NO ]", {
        color: "#ef5350",
        fontSize: "14px",
        fontFamily: "monospace",
        fontStyle: "bold",
        stroke: "#000000",
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true });
    this.confirmPopup.add([cOverlay, cBg, cText, cYes, cNo]);
    (this.confirmPopup as any)._text = cText;
    (this.confirmPopup as any)._yes = cYes;
    (this.confirmPopup as any)._no = cNo;
    (this.confirmPopup as any)._bg = cBg;
    (this.confirmPopup as any)._cx = cx2;
    (this.confirmPopup as any)._cy = cy2;
    (this.confirmPopup as any)._cW = cW;
    (this.confirmPopup as any)._cH = cH;
    (this.confirmPopup as any)._W = W;
    // Start hidden (no-op callback)
    (this.confirmPopup as any)._callback = () => {};
    cYes.on("pointerdown", () => {
      const cb = (this.confirmPopup as any)._callback;
      this.confirmPopup.setVisible(false);
      (this.confirmPopup as any)._callback = () => {};
      cb();
    });
    cNo.on("pointerdown", () => {
      this.confirmPopup.setVisible(false);
      (this.confirmPopup as any)._callback = () => {};
    });
  }

  /** Show confirmation popup with a message and callback on YES.
   *  Dynamically resizes the background and repositions the Yes/No buttons
   *  so they never overlap the text. */
  private showConfirm(message: string, onYes: () => void): void {
    const pp: any = this.confirmPopup as any;
    const cText: Phaser.GameObjects.Text = pp._text;
    const cYes: Phaser.GameObjects.Text = pp._yes;
    const cNo: Phaser.GameObjects.Text = pp._no;
    const cBg: Phaser.GameObjects.Graphics = pp._bg;
    const W: number = pp._W;
    const cW: number = pp._cW;
    const baseCy: number = pp._cy;

    cText.setText(message);

    // Measure the rendered text height to know how tall the popup needs to be.
    const textHeight: number = cText.height;
    // Minimum height so short messages still look good.
    const minH: number = pp._cH;
    // text starts at baseCy + 18; add 18px top + text + 16px gap + 32px buttons + 12px bottom
    const neededH: number = Math.max(minH, 18 + textHeight + 16 + 32 + 12);

    // Recenter the popup vertically based on new height.
    const newCy: number = Math.round((this.cameras.main.height - neededH) / 2);

    // Redraw the background at the new size.
    cBg.clear();
    cBg.fillStyle(0x12121e, 0.97);
    cBg.fillRoundedRect(pp._cx, newCy, cW, neededH, 10);
    cBg.lineStyle(2, 0x4a6a8a, 0.9);
    cBg.strokeRoundedRect(pp._cx, newCy, cW, neededH, 10);

    // Position the text at the top of the popup.
    cText.setPosition(W / 2, newCy + 18);

    // Position Yes/No buttons below the text, always clear of it.
    const btnY: number = newCy + 18 + textHeight + 16;
    cYes.setPosition(W / 2 - 50, btnY);
    cNo.setPosition(W / 2 + 50, btnY);

    pp._callback = onYes;
    this.confirmPopup.setVisible(true);
  }

  private toggleCharacterScreen(): void {
    this.charScreenVisible = !this.charScreenVisible;
    if (this.charScreenVisible) {
      // Hide map tooltip if open
      this.mapInfoTooltip.setVisible(false);
      this.updateCharacterScreen();
    } else {
      // Clean up dynamic children
      const dyn: Phaser.GameObjects.GameObject[] =
        (this.charScreen as any)._dynChildren ?? [];
      for (const d of dyn) d.destroy();
      (this.charScreen as any)._dynChildren = [];
    }
    this.charScreen.setVisible(this.charScreenVisible);
  }

  /** Destroy all dynamic children of the char screen. */
  private clearCharScreenDyn(): void {
    const dyn: Phaser.GameObjects.GameObject[] =
      (this.charScreen as any)._dynChildren ?? [];
    for (const d of dyn) d.destroy();
    (this.charScreen as any)._dynChildren = [];
  }

  /** Add a GameObject to char screen and track it as dynamic. */
  private addDyn(
    obj: Phaser.GameObjects.GameObject,
  ): Phaser.GameObjects.GameObject {
    this.charScreen.add(obj);
    (
      (this.charScreen as any)._dynChildren as Phaser.GameObjects.GameObject[]
    ).push(obj);
    return obj;
  }

  private updateCharacterScreen(): void {
    const p = this.currentPlayerState;
    if (!p) return;
    const px: number = (this.charScreen as any)._px;
    const py: number = (this.charScreen as any)._py;
    const panelW: number = (this.charScreen as any)._panelW;

    // Clear previous dynamic content
    this.clearCharScreenDyn();

    const sp = Math.floor(p.skillPoints ?? 0);
    const spBanner: Phaser.GameObjects.Text = (this.charScreen as any)
      ._spBanner;
    spBanner.setText(sp > 0 ? "Skill Points: " + sp : "");

    let y = py + 42;

    // ---- STAT SECTION ----
    const statHeader = this.add
      .text(px + 20, y, "STATS", {
        color: "#ffd700",
        fontSize: "14px",
        fontFamily: "monospace",
        fontStyle: "bold",
        stroke: "#000000",
        strokeThickness: 3,
      })
      .setOrigin(0, 0)
      .setScrollFactor(0);
    this.addDyn(statHeader);
    y += statHeader.height + 6;

    const pct = (v: number) => Math.round(v * 100) + "%";
    const stats: [string, string, string][] = [
      [
        "Health",
        Math.round(p.currentHealth ?? 0) + " / " + Math.round(p.maxHealth ?? 0),
        "health",
      ],
      ["Base ATK", String(Math.round(p.attack ?? 0)), "attack"],
      ["Defence", pct(p.defence ?? 0), "defence"],
      ["Crit Rate", pct(p.critRate ?? 0), "critRate"],
      ["Crit Damage", pct(p.critDamage ?? 0), "critDamage"],
      [
        "Move Speed",
        "+" + Math.round(((p.moveSpeed ?? 120) / 120 - 1) * 100) + "%",
        "moveSpeed",
      ],
      [
        "Shield",
        Math.round((p as any).shield ?? 0) +
          " / " +
          Math.round((p as any).maxShield ?? 0),
        "shield",
      ],
    ];

    for (const [label, val, statId] of stats) {
      // Stat label + value
      const line = this.add
        .text(px + 20, y, label + ":  " + val, {
          color: "#ffffff",
          fontSize: "13px",
          fontFamily: "monospace",
          stroke: "#000000",
          strokeThickness: 2,
        })
        .setOrigin(0, 0)
        .setScrollFactor(0);
      this.addDyn(line);

      // Upgrade button (gold [+]) if player has skill points
      if (sp > 0) {
        const btnX = px + panelW - 50;
        // Build upgrade description for this stat
        let upgradeDesc = "";
        if (statId === "health") upgradeDesc = "+500 Max Health";
        else if (statId === "attack") upgradeDesc = "+20 Attack";
        else if (statId === "defence") upgradeDesc = "+2% Defence";
        else if (statId === "critRate") upgradeDesc = "+2% Crit Rate";
        else if (statId === "critDamage") upgradeDesc = "+20% Crit Damage";
        else if (statId === "moveSpeed") upgradeDesc = "+5% Move Speed";
        else if (statId === "shield") upgradeDesc = "faster shield recovery";
        const btn = this.add
          .text(btnX, y, "[ + ]", {
            color: "#ffd700",
            fontSize: "14px",
            fontFamily: "monospace",
            fontStyle: "bold",
            stroke: "#000000",
            strokeThickness: 3,
          })
          .setOrigin(0, 0)
          .setScrollFactor(0)
          .setInteractive({ useHandCursor: true });
        this.addDyn(btn);
        // Hover tooltip showing what the upgrade gives (ABOVE the button)
        btn.on("pointerover", () => {
          btn.setStyle({ color: "#ffffff" });
          const tt = this.add
            .text(btnX + 20, y - 6, upgradeDesc, {
              color: "#88ccff",
              fontSize: "11px",
              fontFamily: "monospace",
              backgroundColor: "#0a0a14",
              padding: { x: 6, y: 4 },
            })
            .setOrigin(0, 1)
            .setScrollFactor(0)
            .setDepth(450);
          (this.charScreen as any)._statHoverTT = tt;
          this.charScreen.add(tt);
        });
        btn.on("pointerout", () => {
          btn.setStyle({ color: "#ffd700" });
          const tt = (this.charScreen as any)._statHoverTT;
          if (tt) {
            tt.destroy();
            (this.charScreen as any)._statHoverTT = null;
          }
        });
        btn.on("pointerdown", () => {
          const statLabel = label;
          this.showConfirm(
            "Increase " + statLabel + " by " + upgradeDesc + "?\nAre you sure?",
            () => {
              if (this.room) this.room.send(6, { stat: statId });
              this.time.delayedCall(200, () => {
                if (this.charScreenVisible) this.updateCharacterScreen();
              });
            },
          );
        });
      }
      y += line.height + 4;
    }

    y += 16;

    // ---- EQUIPPED ITEMS SECTION (shield + future equippables) ----
    const itemHeader = this.add
      .text(px + 20, y, "EQUIPPED ITEMS", {
        color: "#88ccff",
        fontSize: "14px",
        fontFamily: "monospace",
        fontStyle: "bold",
        stroke: "#000000",
        strokeThickness: 3,
      })
      .setOrigin(0, 0)
      .setScrollFactor(0);
    this.addDyn(itemHeader);
    y += itemHeader.height + 8;

    const equippedItems: {
      id: string;
      name: string;
      level: number;
      statId: string;
    }[] = [];
    const pShieldLvl = (p as any).shieldCardLevel ?? 1;
    if ((p as any).maxShield && (p as any).maxShield > 0) {
      equippedItems.push({
        id: "shield",
        name: "Shield",
        level: pShieldLvl,
        statId: "shield",
      });
    }

    const itemDispW = 48;
    const itemDispH = 75;
    const itemGap = 12;
    const itemStartX = px + 30;
    for (let i = 0; i < equippedItems.length; i++) {
      const it = equippedItems[i];
      const itX = itemStartX + i * (itemDispW + itemGap);
      // Shield uses the shield card art frame (column 2, tier 0).
      const frame = (cardFrameForLevel as any)("shield", 1) ?? 0;
      const slotBg = this.add
        .rectangle(itX, y, itemDispW + 6, itemDispH + 6, 0x113355, 0.8)
        .setOrigin(0, 0)
        .setScrollFactor(0)
        .setStrokeStyle(2, 0x33b5ff);
      this.addDyn(slotBg);
      const slotImg = this.add
        .sprite(itX + 3, y + 3, "card_sheet", frame)
        .setOrigin(0, 0)
        .setDisplaySize(itemDispW, itemDispH)
        .setScrollFactor(0)
        .setInteractive({ useHandCursor: true });
      this.addDyn(slotImg);
      // Right-click on the shield card upgrades the slot. Left-click is free for later use.
      slotImg.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
        if (!pointer.rightButtonDown()) return;
        if (sp <= 0) return;
        this.showConfirm(
          "Upgrade Shield card slot?\nFaster recovery delay.\nAre you sure?",
          () => {
            if (this.room) this.room.send(6, { stat: "shield" });
            this.time.delayedCall(200, () => {
              if (this.charScreenVisible) this.updateCharacterScreen();
            });
          },
        );
      });
      const lvlBg = this.add
        .rectangle(
          itX + itemDispW / 2,
          y + itemDispH - 2,
          itemDispW - 6,
          16,
          0x000000,
          0.85,
        )
        .setOrigin(0.5, 1)
        .setScrollFactor(0);
      this.addDyn(lvlBg);
      const lvlText = this.add
        .text(itX + itemDispW / 2, y + itemDispH - 4, "Lv " + it.level, {
          color: "#ffffff",
          fontSize: "10px",
          fontFamily: "monospace",
          stroke: "#000000",
          strokeThickness: 2,
        })
        .setOrigin(0.5, 1)
        .setScrollFactor(0);
      this.addDyn(lvlText);
    }
    y += itemDispH + 18;

    // ---- CARD SECTION ----
    const cardHeader = this.add
      .text(px + 20, y, "EQUIPPED CARDS", {
        color: "#ffd700",
        fontSize: "14px",
        fontFamily: "monospace",
        fontStyle: "bold",
        stroke: "#000000",
        strokeThickness: 3,
      })
      .setOrigin(0, 0)
      .setScrollFactor(0);
    this.addDyn(cardHeader);
    y += cardHeader.height + 10;

    // Get equipped skills (level > 0)
    const equipped: string[] = [];
    if (p.skillLevels && p.skillLevels.forEach) {
      p.skillLevels.forEach((lvl: number, skill: string) => {
        if (lvl > 0) equipped.push(skill);
      });
    }

    // Lay out cards horizontally (like in the HUD)
    const cardDispW = 48;
    const cardDispH = 75;
    const cardGap = 12;
    const cardStartX = px + 30;

    for (let i = 0; i < equipped.length; i++) {
      const skillId = equipped[i];
      const skillLvl = p.skillLevels.get(skillId) ?? 1;
      const cardX = cardStartX + i * (cardDispW + cardGap);
      const cardInfo =
        SKILL_CARDS_LOOKUP[skillId as keyof typeof SKILL_CARDS_LOOKUP];

      // Card sprite from spritesheet
      const frame = cardFrameForLevel(skillId as any, skillLvl);
      const cardImg = this.add
        .image(cardX, y, "card_sheet", frame)
        .setDisplaySize(cardDispW, cardDispH)
        .setOrigin(0, 0)
        .setScrollFactor(0)
        .setInteractive({ useHandCursor: true });
      this.addDyn(cardImg);

      // Level badge on the card
      const lvlBg = this.add.graphics().setScrollFactor(0);
      lvlBg.fillStyle(0x000000, 0.7);
      lvlBg.fillRoundedRect(
        cardX + cardDispW / 2 - 14,
        y + cardDispH - 18,
        28,
        14,
        4,
      );
      this.addDyn(lvlBg);
      const lvlText = this.add
        .text(cardX + cardDispW / 2, y + cardDispH - 11, "Lv" + skillLvl, {
          color: "#ffd700",
          fontSize: "9px",
          fontFamily: "monospace",
          fontStyle: "bold",
          stroke: "#000000",
          strokeThickness: 2,
        })
        .setOrigin(0.5)
        .setScrollFactor(0);
      this.addDyn(lvlText);

      // Hover tooltip for card
      const title = cardInfo?.title ?? skillId;
      const desc = cardInfo?.description ?? "";
      const mods = skillMods(skillId as any, skillLvl);
      const hoverLines = [title + "  (Lv " + skillLvl + ")", desc, ...mods];
      const hoverStr = hoverLines.join("\n");
      cardImg.on("pointerover", () => {
        const tt = this.add
          .text(cardX, y + cardDispH + 4, hoverStr, {
            color: "#ffffff",
            fontSize: "11px",
            fontFamily: "monospace",
            backgroundColor: "#0a0a14",
            padding: { x: 6, y: 4 },
            wordWrap: { width: 220 },
          })
          .setOrigin(0, 0)
          .setScrollFactor(0)
          .setDepth(450);
        (this.charScreen as any)._hoverTT = tt;
        this.charScreen.add(tt);
      });
      cardImg.on("pointerout", () => {
        const tt = (this.charScreen as any)._hoverTT;
        if (tt) {
          tt.destroy();
          (this.charScreen as any)._hoverTT = null;
        }
      });

      // Right-click to upgrade card. Left-click is free for later use.
      cardImg.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
        if (!pointer.rightButtonDown()) return;
        if (sp <= 0) return;
        // Build upgrade description for the card
        let cardUpgradeDesc = "";
        if (skillId === "bolter") {
          cardUpgradeDesc = "+10% damage, +2% projectile speed";
          const nextChain = (l: number) => {
            if (l >= 10) return 4;
            if (l >= 7) return 3;
            if (l >= 3) return 2;
            return 0;
          };
          const curChain = nextChain(skillLvl);
          const newChain = nextChain(skillLvl + 1);
          if (newChain > curChain)
            cardUpgradeDesc += ", chain to " + newChain + " enemies";
        } else if (skillId === "claw") {
          cardUpgradeDesc = "+20% damage";
          if (skillLvl + 1 >= 5) {
            cardUpgradeDesc += ", inflict bleed (10 dmg/tick, 10s)";
          }
          if (skillLvl + 1 >= 5) cardUpgradeDesc += ", +10% hitbox size";
        } else if (skillId === "slam") {
          cardUpgradeDesc = "+20% damage, +10% hitbox size";
          if (skillLvl + 1 >= 5) cardUpgradeDesc += ", bypasses walls";
        } else {
          cardUpgradeDesc = "upgrade to level " + (skillLvl + 1);
        }
        this.showConfirm(
          title +
            ": " +
            cardUpgradeDesc +
            "\nAre you sure you want to upgrade the card?",
          () => {
            if (this.room) this.room.send(7, { skill: skillId });
            this.time.delayedCall(200, () => {
              if (this.charScreenVisible) this.updateCharacterScreen();
            });
          },
        );
      });
    }

    // ---- Level / XP info below cards ----
    y += cardDispH + 20;
    const level = Math.floor(p.level ?? 1);
    const currentXp = Math.floor(p.currentXp ?? 0);
    const xpToLevelUp = Math.floor(p.xpToLevelUp ?? 0);
    const xpRemaining = Math.max(0, xpToLevelUp - currentXp);
    const xpInfo = this.add
      .text(
        px + 20,
        y,
        [
          "Level: " +
            level +
            "    XP: " +
            formatNumber(currentXp) +
            " / " +
            formatNumber(xpToLevelUp),
          "XP to next level: " + formatNumber(xpRemaining),
        ].join("\n"),
        {
          color: "#aaaaff",
          fontSize: "12px",
          fontFamily: "monospace",
          stroke: "#000000",
          strokeThickness: 2,
        },
      )
      .setOrigin(0, 0)
      .setScrollFactor(0);
    this.addDyn(xpInfo);
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
    if (this.debugEntityHitboxes) {
      this.debugEntityHitboxes.setVisible(this.showHitboxes);
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
    const now = Date.now();

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
    // Extra guard: ensure the player sprite is active and positioned
    // (not stale from the previous scene before server state arrives).
    if (
      !this.transitioning &&
      this.nextSceneKey &&
      this.currentPlayer &&
      this.currentPlayer.active &&
      (this.currentPlayer.x !== 0 || this.currentPlayer.y !== 0) &&
      this.isOnExitTile()
    ) {
      this.transitionToScene(this.nextSceneKey);
      return;
    }

    // ---- Local player hit flash ----
    if (this.currentPlayer) {
      const localFlash = this.currentPlayer.data.get("hitFlashUntil") as number;
      const localShock = this.currentPlayer.data.get("shockUntil") as number;
      if (localFlash && now < localFlash) {
        // Flash blue when the last hit was absorbed by shield, white otherwise.
        const shielded =
          this.currentPlayerState &&
          (this.currentPlayerState as any).lastHitShielded === true;
        this.currentPlayer.setTintFill(shielded ? 0x33b5ff : 0xffffff);
      } else if (localShock && now < localShock) {
        this.currentPlayer.setTint(0xb266ff);
      } else {
        this.currentPlayer.clearTint();
      }
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

      // Hit flash: tint white while hitFlashUntil > now.
      const playerFlash = entity.data.get("hitFlashUntil") as number;
      if (playerFlash && now < playerFlash) {
        entity.setTintFill(0xffffff);
      } else {
        entity.clearTint();
      }
    }

    // ---- Interpolate enemies toward their server position + apply facing ----
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
      const isOrck = entity.texture.key === "orck_sheet";
      const atkKey = isOrck ? "orck_attack" : "tri_attack";
      const idleKey = isOrck ? "orck_idle" : "tri_idle";
      const eAnim = entity.anims.currentAnim;
      if (attacking) {
        if (!eAnim || eAnim.key !== atkKey) {
          entity.anims.play(atkKey);
        }
      } else {
        if (!eAnim || eAnim.key !== idleKey) {
          entity.anims.play(idleKey);
        }
      }

      // Hit flash: tint white while hitFlashUntil > now.
      const flashUntil = entity.data.get("hitFlashUntil") as number;
      const shockUntil = entity.data.get("shockUntil") as number;
      if (flashUntil && now < flashUntil) {
        entity.setTintFill(0xffffff);
      } else if (shockUntil && now < shockUntil) {
        // Shock: purple tint
        entity.setTint(0xb266ff);
      } else {
        entity.clearTint();
      }

      // ---- Update the floating HP bar ----
      const hpBar = this.enemyHpBars[enemyId];
      if (hpBar) {
        hpBar.setPosition(entity.x, entity.y);
        const fill = hpBar.getAt(1) as Phaser.GameObjects.Rectangle;
        const shieldFillEl = hpBar.getAt(2) as Phaser.GameObjects.Rectangle;
        const lvText = hpBar.getAt(3) as Phaser.GameObjects.Text;
        const hp = entity.data.get("hp") as number;
        const maxHp = entity.data.get("maxHp") as number;
        if (fill && maxHp > 0) {
          const pct = Math.max(0, hp / maxHp);
          fill.scaleX = pct;
        }
        // Shield overlay: white translucent bar that shrinks as the shield
        // depletes. Hidden when the enemy has no shield.
        if (shieldFillEl) {
          const sh = entity.data.get("shield") as number;
          const maxSh = entity.data.get("maxShield") as number;
          if (maxSh > 0 && sh > 0) {
            shieldFillEl.setVisible(true);
            shieldFillEl.scaleX = Math.max(0, sh / maxSh);
          } else {
            shieldFillEl.setVisible(false);
          }
        }
        if (lvText) {
          const lv = entity.data.get("level") as number;
          const newText = String(lv ?? 1);
          if (lvText.text !== newText) lvText.setText(newText);
        }
      }
    }

    // ---- Slam VFX: update sprite frame based on travel progress ----
    for (const slamId in this.slamEntities) {
      const sprite = this.slamEntities[slamId];
      const isUpgraded = sprite.data.get("isUpgraded") as boolean;
      const remaining = sprite.data.get("remainingRange") as number;
      const totalRange = isUpgraded ? 200 : 120;
      const travelled = Math.max(0, 1 - remaining / totalRange); // 0..1

      if (isUpgraded) {
        // Row 1: 4 frames (0=start, 1=travel1, 2=travel2, 3=impact)
        // Show 0 at start, alternate 1/2 during travel, 3 at end.
        let frame: number;
        if (travelled >= 0.95) {
          frame = 4 + 3; // row 1 frame 3 (index 7 in the 4-col sheet)
        } else if (travelled <= 0.05) {
          frame = 4 + 0; // row 1 frame 0
        } else {
          // Alternate frames 1 and 2 during travel
          frame = 4 + (Math.floor(travelled * 20) % 2 === 0 ? 1 : 2);
        }
        sprite.setFrame(frame);
      } else {
        // Row 0: 3 frames (0=start, 1=travel, 2=impact)
        let frame: number;
        if (travelled >= 0.9) {
          frame = 2; // impact frame
        } else if (travelled <= 0.05) {
          frame = 0; // start frame
        } else {
          frame = 1; // travel frame
        }
        sprite.setFrame(frame);
      }
    }

    // ---- Check death state ----
    if (this.currentPlayerState) {
      if (this.currentPlayerState.currentHealth <= 0 && !this.wasDead) {
        this.wasDead = true;
        this.showDeathScreen();
      } else if (this.currentPlayerState.currentHealth > 0 && this.wasDead) {
        this.hideDeathScreen();
      }
      this.updateVignettes();
    }
    // ---- Update bolter cooldown fill on the card ----
    this.updateBolterCooldownOverlay();
    this.updatePulseCooldownOverlay();
    this.updateShockCooldownOverlay();
    this.updateClawCooldownOverlay();
    this.updateHealCooldownOverlay();
    // ---- Sync viewport to server (for viewport-activated spawning) ----
    // ---- Update live entity hitbox overlay ----
    this.updateEntityHitboxes();
    this.sendViewport();
  }

  // ============================================================
  // LIVE ENTITY HITBOX OVERLAY
  // ============================================================

  /**
   * Redraw the live entity hitbox overlay (call each frame).
   * Only visible when showHitboxes is true (toggle F3).
   *
   * Colors:
   *   GREEN  (circle) = player hitbox (radius 10)
   *   RED    (circle) = enemy hitbox (radius 9)
   *   BLUE   (circle) = bolter projectile hitbox (radius 6)
   *   ORANGE (cone)   = claw skill VFX hitbox
   */
  private updateEntityHitboxes(): void {
    const gfx = this.debugEntityHitboxes;
    if (!gfx) return;
    gfx.clear();

    if (!this.showHitboxes) return;

    // ---- Players (GREEN rectangles, from synced hitboxW/H) ----
    gfx.lineStyle(1.5, 0x00ff00, 0.9);
    if (this.currentPlayer) {
      const pw = (this.currentPlayer.data.get("hitboxW") as number) ?? 10;
      const ph = (this.currentPlayer.data.get("hitboxH") as number) ?? 10;
      gfx.strokeRect(
        this.currentPlayer.x - pw,
        this.currentPlayer.y - ph,
        pw * 2,
        ph * 2,
      );
    }
    for (const sessionId in this.playerEntities) {
      if (sessionId === this.room?.sessionId) continue;
      const sp = this.playerEntities[sessionId];
      const pw = (sp.data.get("hitboxW") as number) ?? 10;
      const ph = (sp.data.get("hitboxH") as number) ?? 10;
      gfx.strokeRect(sp.x - pw, sp.y - ph, pw * 2, ph * 2);
    }

    // ---- Enemies (RED rectangles, from synced hitboxW/H) ----
    gfx.lineStyle(1.5, 0xff0000, 0.9);
    for (const id in this.enemyEntities) {
      const sp = this.enemyEntities[id];
      const ew = (sp.data.get("hitboxW") as number) ?? 12;
      const eh = (sp.data.get("hitboxH") as number) ?? 12;
      gfx.strokeRect(sp.x - ew, sp.y - eh, ew * 2, eh * 2);
    }

    // ---- Bolter projectiles (BLUE circles, radius 6) ----
    gfx.lineStyle(1.5, 0x00aaff, 0.9);
    for (const id in this.projectileEntities) {
      const e = this.projectileEntities[id];
      gfx.strokeCircle(e.x, e.y, 6);
    }

    // ---- Claw VFX (ORANGE cones) ----
    gfx.lineStyle(1.5, 0xff8800, 0.8);
    for (const id in this.clawEntities) {
      const e = this.clawEntities[id];
      // Read range from the synced cast data (stored on the sprite).
      const castData = (e as any).castData as any;
      const range = castData?.range || 60;
      const tier: string = castData?.tier || "small";
      const halfAngle = tier === "big" ? 0.9 : tier === "mid" ? 0.7 : 0.5;
      const angle = castData?.angle ?? e.rotation ?? 0;
      // The cone originates from the CASTER's position (castData.x/y),
      // not the sprite position (which is at the cone edge).
      const cx = castData?.x ?? e.x;
      const cy = castData?.y ?? e.y;
      gfx.beginPath();
      gfx.moveTo(cx, cy);
      gfx.lineTo(
        cx + Math.cos(angle - halfAngle) * range,
        cy + Math.sin(angle - halfAngle) * range,
      );
      gfx.moveTo(cx, cy);
      gfx.lineTo(
        cx + Math.cos(angle + halfAngle) * range,
        cy + Math.sin(angle + halfAngle) * range,
      );
      gfx.strokePath();
      gfx.beginPath();
      gfx.arc(cx, cy, range, angle - halfAngle, angle + halfAngle);
      gfx.strokePath();
    }

    // ---- Pulse VFX (PURPLE circles) ----
    gfx.lineStyle(1.5, 0xb266ff, 0.8);
    for (const id in this.clawEntities) {
      const e = this.clawEntities[id];
      const castData = (e as any).castData as any;
      // Only draw pulse hitbox for pulse casts
      if (castData?.skillId !== "pulse") continue;
      const radius = castData?.range || 80;
      // The pulse is centered on the caster
      const cx = castData?.x ?? e.x;
      const cy = castData?.y ?? e.y;
      gfx.strokeCircle(cx, cy, radius);
    }

    // ---- Shock VFX (YELLOW-GREEN cones) ----
    gfx.lineStyle(1.5, 0xccff00, 0.8);
    for (const id in this.clawEntities) {
      const e = this.clawEntities[id];
      const castData = (e as any).castData as any;
      if (castData?.skillId !== "shock") continue;
      // Range: base 200px, +30 per odd level
      const lvl = castData?.level ?? 1;
      const increases = Math.floor((lvl - 1) / 2) + 1;
      const range = 200 + 30 * (increases - 1);
      const halfAngle = 0.6; // ~34 degrees
      const angle = castData?.angle ?? 0;
      const cx = castData?.x ?? e.x;
      const cy = castData?.y ?? e.y;
      gfx.beginPath();
      gfx.moveTo(cx, cy);
      gfx.lineTo(
        cx + Math.cos(angle - halfAngle) * range,
        cy + Math.sin(angle - halfAngle) * range,
      );
      gfx.moveTo(cx, cy);
      gfx.lineTo(
        cx + Math.cos(angle + halfAngle) * range,
        cy + Math.sin(angle + halfAngle) * range,
      );
      gfx.strokePath();
      gfx.beginPath();
      gfx.arc(cx, cy, range, angle - halfAngle, angle + halfAngle);
      gfx.strokePath();
    }
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

  /** Spawn a blood splat mist effect at the given position. */
  private spawnBloodSplat(x: number, y: number): void {
    // Central dark-red burst
    const splat = this.add.circle(x, y, 8, 0x8b0000, 0.7).setDepth(6);
    this.tweens.add({
      targets: splat,
      scale: 3,
      alpha: 0,
      duration: 450,
      ease: "Cubic.out",
      onComplete: () => splat.destroy(),
    });
    // Scattered small blood particles
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI * 2 * i) / 6 + Math.random() * 0.5;
      const dist = 12 + Math.random() * 16;
      const px = x + Math.cos(angle) * dist;
      const py = y + Math.sin(angle) * dist;
      const drop = this.add
        .circle(px, py, 2 + Math.random() * 2, 0xaa1111, 0.6)
        .setDepth(6);
      this.tweens.add({
        targets: drop,
        x: x + Math.cos(angle) * (dist + 10),
        y: y + Math.sin(angle) * (dist + 10),
        alpha: 0,
        duration: 350 + Math.random() * 200,
        ease: "Cubic.out",
        onComplete: () => drop.destroy(),
      });
    }
  }

  /**
   * Returns true if the local player's center is inside this map's exit zone.
   */
  private isOnExitTile(): boolean {
    if (!this.currentPlayer) return false;
    const ex = this.mapData.exitPoint;
    const inside =
      this.currentPlayer.x >= ex.x &&
      this.currentPlayer.x <= ex.x + ex.width &&
      this.currentPlayer.y >= ex.y &&
      this.currentPlayer.y <= ex.y + ex.height;
    if (inside) {
      console.log(
        `[EXIT] Player at (${this.currentPlayer.x}, ${this.currentPlayer.y}) inside exit zone (${ex.x},${ex.y},${ex.width},${ex.height}), nextScene=${this.nextSceneKey}, transitioning=${this.transitioning}`,
      );
    }
    return inside;
  }

  /**
   * Fade to black, show the loading screen image, then switch to the next
   * Phaser scene. The destination scene fades in from black once its room
   * has finished connecting (see create()).
   *
   * The old Colyseus room is left during the dark phase and is
   * auto-disposed by Colyseus once it has no clients.
   */
  // ============================================================
  // DEATH SCREEN OVERLAY
  // ============================================================

  /**
   * Show the death screen: translucent black overlay + gold-lined box
   * with Respawn and Quit buttons.
   */
  private showDeathScreen(): void {
    if (this.deathOverlay) return; // already shown
    const cam = this.cameras.main;
    const cx = cam.width / 2;
    const cy = cam.height / 2;

    // Translucent black background
    const bg = this.add
      .rectangle(cx, cy, cam.width, cam.height, 0x000000, 0.75)
      .setScrollFactor(0)
      .setDepth(2000);

    // Gold-lined box (wood-colored fill)
    const boxW = 360;
    const boxH = 220;
    const box = this.add
      .rectangle(cx, cy, boxW, boxH, 0x3d2b1f, 0.95)
      .setStrokeStyle(4, 0xd4a017, 1) // gold border
      .setScrollFactor(0)
      .setDepth(2001);

    // "YOU DIED" title
    const title = this.add
      .text(cx, cy - 70, "YOU DIED", {
        fontFamily: "Georgia, serif",
        fontSize: "28px",
        color: "#d4a017",
        stroke: "#000000",
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(2002);

    // Respawn button
    const respawnBtn = this.add
      .rectangle(cx, cy + 10, 180, 44, 0x2d4a2b, 0.9)
      .setStrokeStyle(2, 0xd4a017, 0.8)
      .setScrollFactor(0)
      .setDepth(2002)
      .setInteractive({ useHandCursor: true });
    const respawnText = this.add
      .text(cx, cy + 10, "Respawn", {
        fontFamily: "Georgia, serif",
        fontSize: "18px",
        color: "#ffffff",
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(2003);

    // Quit button
    const quitBtn = this.add
      .rectangle(cx, cy + 64, 180, 44, 0x4a2b2b, 0.9)
      .setStrokeStyle(2, 0xd4a017, 0.8)
      .setScrollFactor(0)
      .setDepth(2002)
      .setInteractive({ useHandCursor: true });
    const quitText = this.add
      .text(cx, cy + 64, "Quit", {
        fontFamily: "Georgia, serif",
        fontSize: "18px",
        color: "#ffffff",
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(2003);

    // Button actions
    respawnBtn.on("pointerdown", () => {
      // If dead in map2 (game2), transition back to map1 with fresh state.
      if (this.sys.settings.key === "game2") {
        this.hideDeathScreen();
        // Leave the room and start a fresh map1 scene (no playerState = fresh player)
        try {
          this.room?.leave();
        } catch (_e) {
          /* ignore */
        }
        this.room = null;
        // Clear all local entity sprites
        for (const id in this.playerEntities) {
          this.playerEntities[id]?.destroy();
          delete this.playerEntities[id];
        }
        for (const id in this.enemyEntities) {
          this.enemyEntities[id]?.destroy();
          delete this.enemyEntities[id];
        }
        for (const id in this.projectileEntities) {
          this.projectileEntities[id]?.destroy();
          delete this.projectileEntities[id];
        }
        for (const id in this.clawEntities) {
          this.clawEntities[id]?.destroy();
          delete this.clawEntities[id];
        }
        // Launch a fresh game scene (no playerState = base stats)
        this.scene.launch("game", { playerState: null, fadeIn: true });
        this.scene.stop();
        return;
      }
      // Normal respawn (same map)
      if (this.room) {
        this.room.send(4, {});
      }
      this.hideDeathScreen();
    });
    quitBtn.on("pointerdown", () => {
      // Quit does nothing for now
    });

    // Hover effects
    respawnBtn.on("pointerover", () => respawnBtn.setFillStyle(0x3d6a3d, 0.95));
    respawnBtn.on("pointerout", () => respawnBtn.setFillStyle(0x2d4a2b, 0.9));
    quitBtn.on("pointerover", () => quitBtn.setFillStyle(0x6a3d3d, 0.95));
    quitBtn.on("pointerout", () => quitBtn.setFillStyle(0x4a2b2b, 0.9));

    this.deathOverlay = this.add
      .container(0, 0, [
        bg,
        box,
        title,
        respawnBtn,
        respawnText,
        quitBtn,
        quitText,
      ])
      .setScrollFactor(0)
      .setDepth(2000);
  }

  /** Hide the death screen overlay. */
  private hideDeathScreen(): void {
    if (this.deathOverlay) {
      this.deathOverlay.destroy();
      this.deathOverlay = null;
    }
    this.wasDead = false;
  }

  // ============================================================
  // MAP TRANSITION
  // ============================================================

  private transitionToScene(sceneKey: string): void {
    if (this.transitioning) return;
    this.transitioning = true;
    console.log(
      `[TRANSITION] Starting transition from "${this.sys.settings.key}" to "${sceneKey}"`,
    );

    const cam = this.cameras.main;
    // Duration of each fade half (ms). Total dark time ~= 2 * FADE_MS
    // plus the room-connect wait in the destination scene.
    const FADE_MS = 400;

    // Once the camera has fully faded to black, swap scenes.
    cam.once("camerafadeoutcomplete", () => {
      // Leave the old room (it auto-disposes when empty).
      // Transition XP is applied in the serialized playerState below.
      try {
        this.room?.send(5, {});
      } catch (_e) {
        // ignore
      }
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

      // Serialize player state for the next map
      let playerState: any = null;
      if (this.currentPlayerState) {
        const p = this.currentPlayerState;
        const skillLevels: Record<string, number> = {};
        if (p.skillLevels && p.skillLevels.forEach) {
          p.skillLevels.forEach((lvl: number, skill: string) => {
            skillLevels[skill] = lvl;
          });
        }
        // Apply map transition XP bonus directly to the serialized state
        const TRANSITION_XP = this.sys.settings.key === "game2" ? 1000 : 500;
        let txp = (p.currentXp ?? 0) + TRANSITION_XP;
        let tLevel = p.level ?? 1;
        let tXpToLevel = p.xpToLevelUp ?? 1000;
        let tSkillPoints = p.skillPoints ?? 0;
        while (txp >= tXpToLevel) {
          txp -= tXpToLevel;
          tLevel += 1;
          tSkillPoints += 1;
          tXpToLevel = Math.round(tXpToLevel * 1.5);
        }
        playerState = {
          level: tLevel,
          currentXp: txp,
          xpToLevelUp: tXpToLevel,
          maxHealth: p.maxHealth,
          currentHealth: p.currentHealth, // carry actual HP, not full
          attack: p.attack,
          defence: p.defence ?? 0,
          critRate: p.critRate,
          critDamage: p.critDamage,
          baseMoveSpeed: p.baseMoveSpeed,
          speedMultiplier: p.speedMultiplier ?? 1.0,
          moveSpeed: p.moveSpeed,
          skillLevels,
          skillPoints: tSkillPoints,
        };
      }

      // Start the destination scene under a black cover so the player
      // never sees the unloaded map.
      console.log(
        `[TRANSITION] Launching "${sceneKey}" with playerState, fadeIn: true`,
      );
      this.scene.launch(sceneKey, { playerState, fadeIn: true });
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
