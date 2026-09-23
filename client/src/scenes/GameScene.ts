/**
 * Game Scene - Core Orchestrator
 * ==============================
 *
 * Thin orchestrator. All concerns live in dedicated modules:
 *   ui/        - card tooltip, HUD, screens, toasts, damage numbers
 *   vfx/       - per-skill animations + effects
 *   systems/   - input, ground-card pickup
 *   config/    - skill/card mod definitions
 *
 * Edit the matching module - this file only wires them up and runs the
 * per-tick loop.
 */
import Phaser from "phaser";
import { Client } from "@colyseus/sdk";
import { Callbacks } from "@colyseus/schema";
import { BACKEND_URL } from "../backend";

import { LAYERED_MAP, resolveTileCollision } from "../maps/layeredMapData";
import type { LayeredMapData } from "../maps/layeredMapData";
import { LAYERED_MAP_2 } from "../maps/layeredMap2Data";
import {
  type SkillId,
  asRarity,
  cardFrameForLevel,
  CARD_ART_INSET_RATIO,
  CARD_ART_ALPHA,
  rarityBaseFrame,
  BOLTER_COLORS,
  bolterColorTier,
  bolterBulletFrameForLevel,
} from "../config/skillDefs";
import { spawnDamageNumber } from "../ui/damageNumbers";

import { buildCardTooltipPanel } from "../ui/cardTooltip";
import {
  showCooldownToast,
  showLevelUpToast,
  showSpawnCountdownToast,
  announce,
  showExitLockedToast,
} from "../ui/toasts";
import {
  createStatsHud,
  slotCenter,
  createSlotCardObj,
  updateStatsHud,
  updateVignettes,
  updateSlotCooldowns,
  type StatsHudRefs,
  type HudCardObj,
  type SlotCard,
} from "../ui/hud/statsHud";
import {
  createXpBar,
  setLevelClickHandler,
  updateXpBar,
  type XpBarRefs,
} from "../ui/hud/xpBar";
import {
  createMapInfoButton,
  rebuildMapInfoTooltip,
  type MapInfoRefs,
} from "../ui/hud/mapInfoButton";
import { createConfirmPopup } from "../ui/confirmPopup";
import {
  createMapStatPicker,
  type MapStatOffer,
  type MapStatPickerRefs,
} from "../ui/mapStatPicker";
import { createEliteIndicator } from "../ui/hud/eliteIndicator";
import {
  showDeathScreen,
  hideDeathScreen,
  type DeathScreenRefs,
} from "../ui/screens/deathScreen";
import { createCharacterScreen } from "../ui/screens/characterScreen";
import { createInventoryScreen } from "../ui/screens/inventoryScreen";

import {
  createCharacterAnimations,
  createEnemyAnimations,
  createBolterAnimations,
  createPulseAnimations,
  createClawAnimations,
} from "../vfx/animations";
import { drawLightningBolt } from "../vfx/shock";
import { spawnVortex, showVortexExplosion } from "../vfx/vortex";
import { spawnMuzzleFlash, spawnBulletHitVfx } from "../vfx/bolter";
import { spawnBloodSplat } from "../vfx/blood";
import {
  spawnClawVfx,
  spawnPulseVfx,
  spawnHealVfx,
  spawnDashVfx,
  spawnDashIceBlastVfx,
  spawnSlamSprite,
  updateSlamFrame,
} from "../vfx/castVfx";

import {
  bindKeyboard,
  updateAimAngle,
  slotIndexForPointer,
} from "../systems/input";
import {
  createGroundCards,
  createGroundCardEntity,
  updateGroundGrab,
  endGroundGrab,
  pointerOverGroundCard,
  resetGroundCards,
  type GroundCardsState,
  type GroundCardCallbacks,
} from "../systems/groundCards";
import { updateEntityVisuals } from "../systems/entityRenderer";
import { getSkillTargeting } from "../config/targeting";

export class GameScene extends Phaser.Scene {
  client = new Client(BACKEND_URL);
  room: any = null;

  currentPlayer!: Phaser.GameObjects.Sprite;
  currentPlayerState: any = null;
  playerEntities: { [sessionId: string]: Phaser.GameObjects.Sprite } = {};
  enemyEntities: { [id: string]: Phaser.GameObjects.Sprite } = {};
  projectileEntities: { [id: string]: Phaser.GameObjects.Sprite } = {};
  clawEntities: { [id: string]: Phaser.GameObjects.Sprite } = {};
  slamEntities: { [id: string]: Phaser.GameObjects.Sprite } = {};
  vortexEntities: { [id: string]: Phaser.GameObjects.Container } = {};
  enemyHpBars: { [id: string]: Phaser.GameObjects.Container } = {};
  enemyLastPos: { [id: string]: { x: number; y: number } } = {};
  projLastPos: { [id: string]: { x: number; y: number } } = {};

  private statsHud!: StatsHudRefs;
  private mapStatPicker!: MapStatPickerRefs;
  private pendingMapStatOffers: MapStatOffer[] = [];
  private xpBar!: XpBarRefs;
  private mapInfo!: MapInfoRefs;
  private groundCards!: GroundCardsState;
  private groundCardCallbacks!: GroundCardCallbacks;
  private deathScreen: DeathScreenRefs = { container: null };
  private invScreen: any = null;
  private charScreen: any = null;

  private slotCards: (SlotCard | null)[] = Array(5).fill(null);
  private hudCards: (HudCardObj | null)[] = Array(5).fill(null);
  private skillLevelCache: Partial<Record<SkillId, number>> = {};
  private invCardsData: (SlotCard | null)[] = Array(20).fill(null);

  private dragCard: {
    obj: HudCardObj;
    fromSlot: number;
    hoverSlot: number;
  } | null = null;
  private invDrag: {
    obj: HudCardObj;
    fromInv: number;
    hoverInv: number;
  } | null = null;

  private levelUpToast!: Phaser.GameObjects.Text;
  private spawnCountdownToast: Phaser.GameObjects.Text | null = null;
  private exitLockedToast: Phaser.GameObjects.Text | null = null;
  private spawnCountdownLastSec = -1;
  private eliteEnemyId: string | null = null;
  private lastEliteAlive = false;
  private eliteIndicator: ReturnType<typeof createEliteIndicator> | null = null;
  private _lastEliteDiag: string | null = null;
  private wasDead = false;
  private slotsSyncedOnce = false;
  private lastKnownXp = -1;
  private lastKnownLevel = -1;

  private damageTexts: Phaser.GameObjects.Text[] = [];
  private entityHitSeqs: Record<string, number> = {};

  private mapData!: LayeredMapData;
  private mapId = "map1";
  private transitioning = false;
  private aimAngle = 0;
  private debugHitboxes: Phaser.GameObjects.Graphics | null = null;
  private debugEntityHitboxes: Phaser.GameObjects.Graphics | null = null;
  private showHitboxes = false;
  private hitboxToggleKey!: Phaser.Input.Keyboard.Key;
  private hitboxToggleButton!: Phaser.GameObjects.Text;
  private debugFPS!: Phaser.GameObjects.Text;

  private wasdKeys!: {
    left: Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
    up: Phaser.Input.Keyboard.Key;
    down: Phaser.Input.Keyboard.Key;
  };
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
  private readonly PLAYER_COLLISION_RADIUS = 10;

  private readonly VFX_GAPS = {
    bolter: 28,
    claw: 12,
    pulse: 0,
    shock: 10,
    slam: 30,
    heal: 0,
  };

  private bolterTooltip: Phaser.GameObjects.Container | null = null;
  private slotPlusHints: Phaser.GameObjects.Text[] = [];

  static readonly MAP_CONFIGS: Record<
    string,
    { mapData: LayeredMapData; mapInfoKey: string }
  > = {
    map1: { mapData: LAYERED_MAP, mapInfoKey: "game_room" },
    map2: { mapData: LAYERED_MAP_2, mapInfoKey: "game_room_2" },
  };

  constructor(config: Phaser.Types.Scenes.SettingsConfig) {
    super(config);
  }

  async create() {
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
    this.vortexEntities = {};
    this.enemyHpBars = {};
    this.enemyLastPos = {};
    this.projLastPos = {};
    this.entityHitSeqs = {};
    this.slotsSyncedOnce = false;
    this.slotCards = Array(5).fill(null);
    this.hudCards = Array(5).fill(null);
    this.skillLevelCache = {};
    this.slotPlusHints = [];
    this.dragCard = null;
    this.invDrag = null;
    this.spawnCountdownToast = null;
    this.spawnCountdownLastSec = -1;
    this.eliteEnemyId = null;
    this.eliteIndicator?.setVisible(false);
    this.lastEliteAlive = false;
    this.lastKnownXp = -1;
    this.lastKnownLevel = -1;
    this.aimAngle = 0;
    this.debugHitboxes = null;
    this.debugEntityHitboxes = null;
    this.bolterTooltip = null;
    this.deathScreen = { container: null };
    this.groundCards = createGroundCards();

    const bindings = bindKeyboard(this);
    this.wasdKeys = bindings.wasdKeys;

    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      updateAimAngle(pointer, this.currentPlayer, { angle: this.aimAngle });
    });
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (!this.currentPlayer || !this.room) return;
      // Map-stat picker is open: block skill casting so clicks on the
      // mod rows / buttons don't also fire a cast underneath.
      if (this.mapStatPicker?.root?.visible) return;
      if (this.dragCard || this.invDrag || this.groundCards.grab) return;
      if (pointerOverGroundCard(this.groundCards, pointer)) return;
      if (this.pointerOverHudCard(pointer)) return;
      const angle = Math.atan2(
        pointer.worldY - this.currentPlayer.y,
        pointer.worldX - this.currentPlayer.x,
      );
      const slotIdx = slotIndexForPointer(pointer);
      this.castSlot(slotIdx, angle);
    });
    this.input.on("pointerup", (pointer: Phaser.Input.Pointer) => {
      if (this.dragCard) this.endCardDrag(pointer);
      else if (this.invDrag) this.endInvCardDrag(pointer);
      else if (this.groundCards.grab)
        endGroundGrab(
          this,
          this.groundCards,
          this.groundCardCallbacks,
          pointer,
        );
    });
    this.input.on("pointerupoutside", (pointer: Phaser.Input.Pointer) => {
      if (this.dragCard) this.endCardDrag(pointer);
      else if (this.invDrag) this.endInvCardDrag(pointer);
      else if (this.groundCards.grab)
        endGroundGrab(
          this,
          this.groundCards,
          this.groundCardCallbacks,
          pointer,
        );
    });

    this.input.keyboard
      ?.addKey(Phaser.Input.Keyboard.KeyCodes.ZERO)
      ?.on("down", () => {
        if (this.room) this.room.send(9, {});
      });
    this.input.keyboard
      ?.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE)
      ?.on("down", () => {
        this.castSlot(2, this.currentAimAngle());
      });
    this.input.keyboard
      ?.addKey(Phaser.Input.Keyboard.KeyCodes.ONE)
      ?.on("down", () => {
        this.castSlot(3, this.currentAimAngle());
      });
    this.input.keyboard
      ?.addKey(Phaser.Input.Keyboard.KeyCodes.TWO)
      ?.on("down", () => {
        this.castSlot(4, this.currentAimAngle());
      });

    this.mapId = "map1";
    this.mapData = (GameScene.MAP_CONFIGS as any)["map1"].mapData;
    this.transitioning = false;

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

    this.renderLayeredMap();
    this.renderDebugHitboxes();
    this.debugEntityHitboxes = this.add.graphics().setDepth(11);
    this.debugEntityHitboxes.setVisible(false);

    this.createDebugHUD();
    this.statsHud = createStatsHud(this, { initialShowHitboxes: false });
    this.xpBar = createXpBar(this);
    this.mapInfo = createMapInfoButton(
      this,
      () => GameScene.MAP_CONFIGS[this.mapId]?.mapInfoKey ?? "game_room",
      () => (this.room?.metadata?.modifiers as any[]) ?? [],
      () => this.pullActiveMapStats(),
    );
    this.eliteIndicator = createEliteIndicator(
      this,
      () => !!(this.room as any)?.state?.eliteAlive,
      () => this.getEliteWorldPos(),
    );
    const confirmPopup = createConfirmPopup(this);
    this.mapStatPicker = createMapStatPicker(this);
    this.charScreen = createCharacterScreen({
      scene: this,
      confirmPopup,
      getPlayer: () => this.currentPlayerState,
      sendStatSpend: (stat: string) => this.room?.send(6, { stat }),
      sendCardUpgrade: (slot: number) => this.room?.send(7, { slot }),
    });
    this.charScreen.setHideMapInfoTooltip(() => {
      if (this.mapInfo?.tooltip) this.mapInfo.tooltip.setVisible(false);
    });
    setLevelClickHandler(this.xpBar, () => {
      if (!this.charScreen.isVisible()) this.charScreen.toggle();
    });
    this.invScreen = createInventoryScreen({
      scene: this,
      slotW: this.statsHud.cardSlots[0].width,
      slotH: this.statsHud.cardSlots[0].height,
      pullState: () => this.pullInventoryState(),
      getMapStats: () => this.pullActiveMapStats(),
      sendSlotToInv: (slot, inv, empty) =>
        this.room?.send(empty ? 14 : 19, { slot, inv }),
      sendInvSwap: (from, to) => this.room?.send(18, { from, to }),
      sendInvToSlot: (inv, slot) => this.room?.send(15, { inv, slot }),
      sendInvDrop: (inv) => this.room?.send(16, { inv }),
      isDragFree: () =>
        !this.dragCard && !this.invDrag && !this.groundCards.grab,
      onDragStart: (i: number) => this.beginInvCardDrag(i),
    });
    this.initSlotCards();

    this.hitboxToggleKey = this.input.keyboard.addKey(
      Phaser.Input.Keyboard.KeyCodes.F3,
    );

    this.groundCardCallbacks = {
      canGrab: () => !this.dragCard && !this.invDrag,
      getPlayer: () => this.currentPlayer as any,
      // Fallback template is used only as a size source when the player
      // has no card in HUD slot 0. Without it, beginGrab bails out and
      // ground-card pickup is silently disabled until slot 0 is filled.
      getSlotTemplate: () =>
        this.hudCards[0] ?? ({
          container: {
            width: this.statsHud.cardSlots[0].width,
            height: this.statsHud.cardSlots[0].height,
          } as unknown as Phaser.GameObjects.Container,
          base: null as any,
          img: null as any,
          cdFill: null as any,
          targetSlot: -1,
          skill: "shock",
          rarity: "common",
          modIds: [],
          modValues: [],
        } as HudCardObj),
      sendPickupToSlot: (cardId, slot) => this.room?.send(11, { cardId, slot }),
      sendPickupToInventory: (cardId, inv) =>
        this.room?.send(17, { cardId, inv }),
      sendRedrop: (cardId, x, y) => this.room?.send(12, { cardId, x, y }),
      invAtPointer: (p) =>
        this.invScreen ? this.invScreen.slotAtPointer(p) : -1,
      slotAtPointer: (p) => this.slotAtPointer(p),
      refreshHud: () => {
        this.syncSlotsFromServer(true);
        this.syncInventoryFromServer(true);
      },
      updatePlusHints: () => this.updatePlusHints(),
      getCardCdColor: () => undefined,
    };

    await this.connect();
    if (!this.room) {
      if (cover) cover.destroy();
      if (loadingImg) loadingImg.destroy();
      return;
    }

    const serverMapId: string = (this.room as any)?.state?.mapId ?? "map1";
    const cfgLate = (GameScene.MAP_CONFIGS as any)[serverMapId];
    if (cfgLate && serverMapId !== this.mapId) {
      this.children.list
        .filter(
          (obj) =>
            (obj as any).texture &&
            ((obj as any).texture.key === "layered_baselayer" ||
              (obj as any).texture.key === "layered_interactive"),
        )
        .forEach((obj) => obj.destroy());
      if (this.debugHitboxes) {
        this.debugHitboxes.destroy();
        this.debugHitboxes = null;
      }
      this.mapId = serverMapId;
      this.mapData = cfgLate.mapData;
      this.renderLayeredMap();
      this.renderDebugHitboxes();
      if (this.debugHitboxes) this.debugHitboxes.setVisible(this.showHitboxes);
    }

    this.bindRoomStateListeners();
    // Rebuild the map-info tooltip now that live room state exists
    // (covers mid-session joins) and whenever active map mods change.
    rebuildMapInfoTooltip(this, this.mapInfo);
    console.log('[MAPSTAT] registered listeners, current state:',
      (this.room as any)?.state?.activeMapStats
        ? Array.from((this.room as any).state.activeMapStats.entries())
        : 'no stats field');
    {
      const cb2 = Callbacks.get(this.room as any) as any;
      const refreshMapModUI = () => {
        const cur = this.pullActiveMapStats();
        console.log(`[MAPSTAT] refresh triggered, ${cur.length} active:`,
          cur.map(s => s.goodName + "+" + s.badName + "(" + s.durationMaps + ")").join(", "));
        rebuildMapInfoTooltip(this, this.mapInfo);
        this.invScreen?.refreshMapStats();
      };
      cb2.onAdd("activeMapStats", refreshMapModUI);
      cb2.onRemove("activeMapStats", refreshMapModUI);
      // durationMaps decrements each map - keep the 'maps left'
      // counters in the tooltip/inventory accurate.
      cb2.onChange("activeMapStats", refreshMapModUI);
    }

    if (isFadeIn && cover) {
      this.cameras.main.fadeIn(400, 0, 0, 0);
      cover.destroy();
      if (loadingImg) loadingImg.destroy();
    }
  }

  async connect() {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      const roomPromise = this.client.joinOrCreate("game_room", {});
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error("Room connection timeout")),
          10000,
        );
      });
      this.room = await Promise.race([roomPromise, timeoutPromise]);
    } catch (e) {
      console.error("Failed to connect:", e);
      this.room = null;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  /** Active map mods synced from the room (inventory + map tooltip). */
  pullActiveMapStats(): any[] {
    const stats = (this.room as any)?.state?.activeMapStats;
    if (!stats) return [];
    const out: any[] = [];
    stats.forEach((s: any) => out.push(s));
    return out;
  }

  bindRoomStateListeners() {
    const cb = Callbacks.get(this.room as any) as any;

    cb.onAdd("players", (player: any, sessionId: string) => {
      if (sessionId === this.room.sessionId) {
        this.createLocalPlayer(player);
      } else {
        this.createRemotePlayer(player, sessionId);
      }
    });

    cb.onRemove("players", (_p: any, sessionId: string) => {
      const entity = this.playerEntities[sessionId];
      if (entity) {
        entity.destroy();
        delete this.playerEntities[sessionId];
      }
    });

    cb.onAdd("enemies", (enemy: any, enemyId: string) => {
      if (!this.anims.exists("tri_idle")) createEnemyAnimations(this);
      const isOrck = enemy.typeId === "orck";
      const isTau = enemy.typeId === "tau";
      const isMech = enemy.typeId === "mechanicus";
      const isCaster = enemy.typeId === "caster";
      const textureKey = isTau
        ? "tau_sheet"
        : isMech
          ? "mechanicus_sheet"
          : isCaster
            ? "caster_sheet"
            : isOrck
              ? "orck_sheet"
              : "tyranid_sheet";
      const idleAnim = isTau
        ? "tau_idle"
        : isMech
          ? "mechanicus_idle"
          : isCaster
            ? "caster_idle"
            : isOrck
              ? "orck_idle"
              : "tri_idle";
      const isElite = !!enemy.isElite;
      const displaySize = isTau || isMech || isCaster ? 88 : isOrck ? 80 : 64;
      const eliteSize = Math.round(displaySize * 1.6);
      const sprite = this.add
        .sprite(enemy.x, enemy.y, textureKey, 0)
        .setDisplaySize(
          isElite ? eliteSize : displaySize,
          isElite ? eliteSize : displaySize,
        )
        .setDepth(isElite ? 8 : 3);
      sprite.anims.play(idleAnim);
      this.enemyEntities[enemyId] = sprite;
      sprite.setData("isElite", isElite);
      sprite.setData("title", enemy.title ?? "");
      if (isElite) this.eliteEnemyId = enemyId;

      const hpW = isElite ? 64 : 38;
      const hpH = isElite ? 7 : 5;
      const barY = isElite ? -58 : -42;
      const hpBg = this.add
        .rectangle(0, barY, hpW, hpH, 0x000000, 0.7)
        .setStrokeStyle(1, isElite ? 0xffd700 : 0x000000, 0.9);
      const hpFill = this.add
        .rectangle(-hpW / 2, barY, hpW, hpH, isElite ? 0xff9900 : 0xff3333)
        .setOrigin(0, 0.5);
      const shieldFill = this.add
        .rectangle(-hpW / 2, barY, hpW, hpH, 0xffffff, 0.6)
        .setOrigin(0, 0.5)
        .setVisible(false);
      const lvText = this.add
        .text(-hpW / 2 - 4, barY, String(enemy.level ?? 1), {
          color: isElite ? "#ffd700" : "#ffffff",
          fontSize: "9px",
          fontFamily: "monospace",
          stroke: "#000000",
          strokeThickness: 2,
        })
        .setOrigin(1, 0.5);
      const barChildren: Phaser.GameObjects.GameObject[] = [
        hpBg,
        hpFill,
        shieldFill,
        lvText,
      ];
      if (isElite) {
        barChildren.push(
          this.add
            .text(0, barY - 11, "ELITE", {
              color: "#ffd700",
              fontSize: "10px",
              fontFamily: "monospace",
              fontStyle: "bold",
              stroke: "#000000",
              strokeThickness: 3,
            })
            .setOrigin(0.5),
        );
      }
      const hpBar = this.add
        .container(enemy.x, enemy.y, barChildren)
        .setDepth(5);
      this.enemyHpBars[enemyId] = hpBar;
      this.enemyLastPos[enemyId] = { x: enemy.x, y: enemy.y };
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

      cb.onChange(enemy, () => {
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
        sprite.setData("invincibleUntil", enemy.invincibleUntil ?? 0);
        sprite.setData("hitboxW", enemy.hitboxW ?? 12);
        sprite.setData("hitboxH", enemy.hitboxH ?? 12);
        sprite.setData("attacking", !!enemy.attacking);
        this.enemyLastPos[enemyId] = { x: enemy.x, y: enemy.y };
        // Client-authoritative hit flash: trigger the moment a NEW hit is
        // detected (hitSeq bump) instead of trusting the server timestamp,
        // which is often already expired by the time the patch arrives.
        const seq = enemy.hitSeq ?? 0;
        const prev = this.entityHitSeqs[enemyId] ?? 0;
        if (seq !== prev) {
          this.entityHitSeqs[enemyId] = seq;
          // Damage taken -> white flash ALWAYS (blue when shield absorbed it all).
          sprite.setData("flashShielded", !!enemy.lastHitShielded);
          sprite.setData("clientFlashUntil", Date.now() + 160);
          if (enemy.lastHitDamage > 0) {
            spawnDamageNumber(
              this,
              this.damageTexts,
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

    cb.onRemove("enemies", (enemy: any, enemyId: string) => {
      if (enemy && enemy.lastHitDamage > 0) {
        spawnDamageNumber(
          this,
          this.damageTexts,
          enemy.x ?? this.enemyLastPos[enemyId]?.x ?? 0,
          enemy.y ?? this.enemyLastPos[enemyId]?.y ?? 0,
          enemy.lastHitDamage,
          !!enemy.lastHitCrit,
          (enemy as any).lastShieldDamage,
          (enemy as any).lastHpDamage,
        );
      }
      const dx = enemy?.x ?? this.enemyLastPos[enemyId]?.x ?? 0;
      const dy = enemy?.y ?? this.enemyLastPos[enemyId]?.y ?? 0;
      spawnBloodSplat(this, dx, dy);
      if (enemyId === this.eliteEnemyId) {
        this.eliteEnemyId = null;
        this.eliteIndicator?.setVisible(false);
      }
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
    cb.onAdd("projectiles", (proj: any, projId: string) => {
      if (!this.anims.exists("bolter_muzzle")) createBolterAnimations(this);
      const tier = bolterColorTier(proj.level);
      const tint = proj.skillId === "bolter" ? BOLTER_COLORS[tier] : 0xffffff;
      const frame =
        proj.skillId === "bolter" ? bolterBulletFrameForLevel(proj.level) : 0;
      const bullet = this.add
        .sprite(proj.x, proj.y, "bolter_sheet", frame)
        .setDepth(4)
        .setScale(0.4)
        .setTint(tint);
      this.projectileEntities[projId] = bullet;
      this.projLastPos[projId] = { x: proj.x, y: proj.y };
      cb.onChange(proj, () => {
        bullet.setPosition(proj.x, proj.y);
        const prev = this.projLastPos[projId];
        if (prev) {
          const a = Math.atan2(proj.y - prev.y, proj.x - prev.x);
          bullet.setRotation(a);
        }
        this.projLastPos[projId] = { x: proj.x, y: proj.y };
      });
    });

    cb.onRemove("projectiles", (_p: any, projId: string) => {
      const entity = this.projectileEntities[projId];
      const pos = this.projLastPos[projId];
      if (entity) {
        entity.destroy();
        delete this.projectileEntities[projId];
      }
      if (pos) {
        spawnBulletHitVfx(this, pos.x, pos.y);
        delete this.projLastPos[projId];
      }
    });

    cb.onAdd("skillCasts", (cast: any, castId: string) => {
      if (cast.skillId === "claw") {
        if (!this.anims.exists("claw_small")) createClawAnimations(this);
        this.clawEntities[castId] = spawnClawVfx(this, cast);
      } else if (cast.skillId === "heal") {
        this.clawEntities[castId] = spawnHealVfx(this, cast) as any;
      } else if (cast.skillId === "pulse") {
        if (!this.anims.exists("pulse_small")) createPulseAnimations(this);
        const sprite = spawnPulseVfx(this, cast);
        (sprite as any).castData = cast;
        this.clawEntities[castId] = sprite;
      } else if (cast.skillId === "dash") {
        this.clawEntities[castId] = spawnDashVfx(this, cast)[1] as any;
      } else if (cast.skillId === "dash_ice") {
        const objs = spawnDashIceBlastVfx(this, cast);
        this.clawEntities[castId] = objs[0] as any;
      }
    });

    cb.onRemove("skillCasts", (_c: any, castId: string) => {
      const entity = this.clawEntities[castId];
      if (entity) {
        (entity as any).destroy?.();
        delete this.clawEntities[castId];
      }
    });

    cb.onAdd("shockCasts", (shock: any, shockId: string) => {
      const color = shock.level >= 6 ? 0xb266ff : 0x4da6ff;
      const fillColor = shock.level >= 6 ? 0x6a1fb2 : 0x1a5cad;
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
      const hbRef = this.add
        .rectangle(shock.x, shock.y, 1, 1, 0xffffff, 0)
        .setDepth(7);
      (hbRef as any).castData = {
        skillId: "shock",
        x: shock.x,
        y: shock.y,
        angle: shock.aimAngle ?? 0,
        level: shock.level,
      };
      this.clawEntities[shockId] = hbRef as any;
      this.time.delayedCall(500, () => {
        if (hbRef && hbRef.active) hbRef.destroy();
        delete this.clawEntities[shockId];
      });
      const gap = this.VFX_GAPS.shock;
      const sAngle = shock.aimAngle ?? 0;
      for (const seg of segments) {
        this.time.delayedCall(seg.delay, () => {
          if (!this.scene.isActive()) return;
          let sx = seg.x1;
          let sy = seg.y1;
          if (Math.hypot(seg.x1 - shock.x, seg.y1 - shock.y) < 5) {
            sx =
              shock.x + Math.cos(sAngle) * (this.PLAYER_COLLISION_RADIUS + gap);
            sy =
              shock.y + Math.sin(sAngle) * (this.PLAYER_COLLISION_RADIUS + gap);
          }
          drawLightningBolt(this, sx, sy, seg.x2, seg.y2, color, fillColor);
        });
      }
    });

    cb.onRemove("shockCasts", (_s: any, shockId: string) => {
      const entity = this.clawEntities[shockId];
      if (entity) {
        (entity as any).destroy?.();
        delete this.clawEntities[shockId];
      }
    });

    cb.onAdd("groundCards", (card: any, cardId: string) => {
      createGroundCardEntity(
        this,
        card,
        cardId,
        this.groundCards,
        this.groundCardCallbacks,
      );
    });
    // Track schema x/y → entity position. Registered once per room (not
    // inside onAdd) so re-spawning / re-adding a card doesn't accumulate
    // duplicate listeners.
    cb.onChange("groundCards", (card: any, cardId: string) => {
      const entity = this.groundCards.entities.get(cardId);
      if (entity) entity.setPosition(card.x, card.y);
    });

    cb.onRemove("groundCards", (_card: any, cardId: string) => {
      const entity = this.groundCards.entities.get(cardId);
      if (entity) entity.destroy();
      this.groundCards.entities.delete(cardId);
      if (this.groundCards.pendingPickups.has(cardId)) {
        this.groundCards.pendingPickups.delete(cardId);
        this.groundCards.pendingPickupSlots.delete(cardId);
        this.syncSlotsFromServer(true);
      }
    });

    cb.onAdd("slams", (slam: any, slamId: string) => {
      const sprite = spawnSlamSprite(
        this,
        slam.x,
        slam.y,
        slam.level,
        slam.angle,
        this.VFX_GAPS.slam,
      );
      this.slamEntities[slamId] = sprite;
      cb.onChange(slam, () => {
        const g = this.VFX_GAPS.slam;
        sprite.setPosition(
          slam.x + Math.cos(slam.angle) * g,
          slam.y + Math.sin(slam.angle) * g,
        );
        sprite.setData("remainingRange", slam.remainingRange);
      });
    });

    cb.onRemove("slams", (_s: any, slamId: string) => {
      const entity = this.slamEntities[slamId];
      if (entity) {
        entity.destroy();
        delete this.slamEntities[slamId];
      }
    });

    cb.onAdd("vortexes", (vortex: any, vortexId: string) => {
      const tier = (vortex.colorTier ?? "grey") as "grey" | "brown" | "purple";
      const { container, spinEvent } = spawnVortex(
        this,
        vortex.x,
        vortex.y,
        vortex.radius,
        tier,
      );
      this.vortexEntities[vortexId] = container;
      let exploded = false;
      cb.onChange(vortex, () => {
        container.setPosition(vortex.x, vortex.y);
        if (
          vortex.phase === "explode" &&
          vortex.explosionRadius > 0 &&
          !exploded
        ) {
          exploded = true;
          spinEvent.remove();
          showVortexExplosion(this, vortex.x, vortex.y, vortex.explosionRadius);
        }
      });
    });

    cb.onRemove("vortexes", (_v: any, vortexId: string) => {
      const entity = this.vortexEntities[vortexId];
      if (entity) {
        const spinEvent = (entity as any).spinEvent;
        if (spinEvent) spinEvent.remove();
        this.tweens.killTweensOf(entity);
        entity.list.forEach((child: any) => this.tweens.killTweensOf(child));
        entity.destroy();
        delete this.vortexEntities[vortexId];
      }
    });

    (this.room as any).onMessage("mapTransition", (nextMapId: string) => {
      this.performMapSwap(nextMapId);
    });
    (this.room as any).onMessage(
      "mapStatOffer",
      (msg: { tier: number; offers: MapStatOffer[]; playerCount: number }) => {
        this.pendingMapStatOffers = msg.offers ?? [];
        this.mapStatPicker.show(msg.tier ?? 1, this.pendingMapStatOffers, {
          onCancel: () => {
            // Close-only: this player steps out of the choice.
            // Others can still pick. No message to server.
          },
          onNoMods: () => {
            if (!this.room) return;
            this.room.send(20, { index: -1 });
          },
          onChoose: (i) => {
            if (!this.room) return;
            this.room.send(20, { index: i });
          },
        });
      },
    );
    (this.room as any).onMessage("mapStatPicked", (_msg: any) => {
      this.mapStatPicker.hide();
    });
    (this.room as any).onMessage("mapStatCancelled", (_msg: any) => {
      // Server reset the picker (someone stepped off the exit). Close
      // the local popup so a future re-entry can re-open it.
      this.mapStatPicker.hide();
    });
  }

  createLocalPlayer(player: any) {
    createCharacterAnimations(this);
    const sprite = this.add
      .sprite(player.x, player.y, "player_sheet", 0)
      .setDepth(4);
    sprite.setData("serverX", player.x);
    sprite.setData("serverY", player.y);
    this.currentPlayer = sprite;
    this.cameras.main.startFollow(sprite);
    this.cameras.main.setBounds(
      0,
      0,
      this.mapData.widthPx,
      this.mapData.heightPx,
    );
    const cb = Callbacks.get(this.room as any) as any;
    cb.onChange(player, () => {
      this.currentPlayerState = player;
      const dx = Math.abs(sprite.x - player.x);
      const dy = Math.abs(sprite.y - player.y);
      if (dx > 32 || dy > 32) {
        sprite.x = player.x;
        sprite.y = player.y;
      }
      updateStatsHud(this.statsHud, player);
      updateXpBar(this.xpBar, player, {
        onLevelUp: (level) => {
          this.showLevelUp(level);
        },
        scene: this,
        state: {
          lastKnownXp: this.lastKnownXp,
          lastKnownLevel: this.lastKnownLevel,
        },
      });
      this.lastKnownXp = Math.floor(player.currentXp ?? 0);
      this.lastKnownLevel = Math.floor(player.level ?? 1);
      for (const skill of [
        "shock",
        "claw",
        "heal",
        "pulse",
        "slam",
        "dash",
        "vortex",
        "bolter",
        "shield",
      ] as SkillId[]) {
        this.syncSkillLevel(player, skill);
      }
      this.syncSlotsFromServer(false);
      this.syncInventoryFromServer(false);
      sprite.setData("attack", player.attack ?? 100);
      sprite.setData(
        "slotCooldownEndsAt",
        Array.from(player.slotCooldownEndsAt ?? []),
      );
      sprite.setData("slotHealKills", Array.from(player.slotHealKills ?? []));
      sprite.setData("hitFlashUntil", player.hitFlashUntil ?? 0);
      sprite.setData("shockUntil", player.shockUntil ?? 0);
      sprite.setData("invincibleUntil", player.invincibleUntil ?? 0);
      sprite.setData("hitboxW", player.hitboxW ?? 10);
      sprite.setData("hitboxH", player.hitboxH ?? 10);
      const seq = player.hitSeq ?? 0;
      const prev = this.entityHitSeqs["__local__"] ?? 0;
      if (seq !== prev) {
        this.entityHitSeqs["__local__"] = seq;
        // Client-authoritative flash (white, blue when shield absorbed).
        sprite.setData("flashShielded", !!player.lastHitShielded);
        sprite.setData("clientFlashUntil", Date.now() + 160);
        if (player.lastHitDamage > 0) {
          spawnDamageNumber(
            this,
            this.damageTexts,
            sprite.x,
            sprite.y,
            player.lastHitDamage,
            !!player.lastHitCrit,
            (player as any).lastShieldDamage,
            (player as any).lastHpDamage,
          );
        }
      }
    });
  }
  createRemotePlayer(player: any, sessionId: string) {
    const sprite = this.add
      .sprite(player.x, player.y, "player_sheet", 0)
      .setDepth(4);
    sprite.setData("serverX", player.x);
    sprite.setData("serverY", player.y);
    this.playerEntities[sessionId] = sprite;
    const cb = Callbacks.get(this.room as any) as any;
    cb.onChange(player, () => {
      sprite.setData("serverX", player.x);
      sprite.setData("serverY", player.y);
      sprite.setData("hitFlashUntil", player.hitFlashUntil ?? 0);
      sprite.setData("hitboxW", player.hitboxW ?? 10);
      sprite.setData("hitboxH", player.hitboxH ?? 10);
    });
  }

  updatePlayerAnimation(): void {
    if (!this.currentPlayer) return;
    let moving = false;
    let newDirection = (this as any).lastDirection || "left";
    if (this.inputPayload.left) {
      newDirection = "left";
      moving = true;
    }
    if (this.inputPayload.right) {
      newDirection = "right";
      moving = true;
    }
    if (this.inputPayload.up || this.inputPayload.down) {
      moving = true;
    }
    (this as any).lastDirection = newDirection;
    if (moving) {
      const animKey =
        newDirection === "right" ? "player_walk_right" : "player_walk_left";
      const currentAnim = this.currentPlayer.anims.currentAnim;
      if (!currentAnim || currentAnim.key !== animKey)
        this.currentPlayer.anims.play(animKey);
      this.currentPlayer.setFlipX(false);
    } else {
      const currentAnim = this.currentPlayer.anims.currentAnim;
      if (!currentAnim || currentAnim.key !== "player_idle")
        this.currentPlayer.anims.play("player_idle");
      this.currentPlayer.setFlipX(newDirection === "right");
    }
  }

  // ---- Slot-based card system ----
  private slotSkill(i: number): SkillId | null {
    return this.slotCards[i]?.skill ?? null;
  }

  private castSlot(i: number, angle: number): void {
    if (!this.currentPlayer || !this.room) return;
    const skill = this.slotSkill(i);
    if (!skill) return;
    if (!this.isSlotReady(i)) {
      showCooldownToast(this, this.statsHud?.hudImage?.y);
      return;
    }
    // Per-skill targeting: a skill decides whether it uses the angle
    // or is self-centered. The slot is irrelevant — this lets the same
    // skill (e.g. shock) behave correctly in any HUD slot.
    const targeting = getSkillTargeting(skill);
    const finalAngle = targeting === "self" ? 0 : angle;
    this.room.send(1, { slot: i, angle: finalAngle });
  }

  /**
   * Compute the aim angle from the CURRENT mouse pointer (not a stale
   * cached value). Called from keyboard cast paths so a skill that aims
   * at the mouse always uses the mouse position at the moment of the
   * keypress, even if `pointermove` hasn't fired recently.
   */
  private currentAimAngle(): number {
    const p = this.input.activePointer;
    if (!p || !this.currentPlayer) return this.aimAngle;
    return Math.atan2(
      p.worldY - this.currentPlayer.y,
      p.worldX - this.currentPlayer.x,
    );
  }

  private isSlotReady(i: number): boolean {
    if (!this.currentPlayer) return true;
    const cds =
      (this.currentPlayer.data.get("slotCooldownEndsAt") as
        | number[]
        | undefined) ?? [];
    if ((cds[i] ?? 0) > Date.now()) return false;
    const sc = this.slotCards[i];
    if (sc && sc.skill === "heal" && sc.level < 6) {
      const healKills =
        (this.currentPlayer.data.get("slotHealKills") as
          | number[]
          | undefined) ?? [];
      const threshold = sc.level <= 2 ? 4 : 3;
      return (healKills[i] ?? 0) >= threshold;
    }
    return true;
  }

  private syncSkillLevel(player: any, skill: SkillId): void {
    const lvl =
      player.skillLevels && player.skillLevels.get
        ? (player.skillLevels.get(skill) ?? 0)
        : 0;
    if (lvl !== this.skillLevelCache[skill]) {
      this.skillLevelCache[skill] = lvl;
      for (let i = 0; i < this.hudCards.length; i++) {
        const card = this.hudCards[i];
        const sc = this.slotCards[i];
        if (card && card.skill === skill && sc) {
          card.img.setFrame(cardFrameForLevel(skill, sc.level));
        }
      }
    }
  }

  private initSlotCards(): void {
    this.slotCards = Array(5).fill(null);
    this.hudCards = Array(5).fill(null);
    this.slotPlusHints = [];
    for (let i = 0; i < this.statsHud.cardSlots.length; i++) {
      const c = slotCenter(this.statsHud, i);
      const plus = this.add
        .text(c.x, c.y, "+", {
          color: "#ffffff",
          fontSize: "22px",
          fontFamily: "monospace",
          fontStyle: "bold",
          stroke: "#000000",
          strokeThickness: 3,
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(101)
        .setAlpha(0.55)
        .setVisible(false);
      this.slotPlusHints.push(plus);
    }
    this.syncSlotsFromServer(false);
  }

  private syncSlotsFromServer(rebuildAlways: boolean): void {
    const p = this.currentPlayerState;
    if (!p || !p.equippedSlots) return;
    const slots: (SlotCard | null)[] = Array(5).fill(null);
    for (let i = 0; i < 5; i++) {
      const c = p.equippedSlots[i];
      if (c && c.skill) {
        slots[i] = {
          skill: c.skill as SkillId,
          level: c.level ?? 1,
          rarity: asRarity(c.rarity),
          modIds: c.modIds ? Array.from(c.modIds) : [],
          modValues: c.modValues ? Array.from(c.modValues as number[]) : [],
        };
      }
    }
    const same =
      !rebuildAlways &&
      this.slotsSyncedOnce &&
      slots.every((s, i) => {
        const cur = this.slotCards[i];
        if (!s && !cur) return true;
        if (!s || !cur) return false;
        return (
          s.skill === cur.skill &&
          s.level === cur.level &&
          s.rarity === cur.rarity &&
          s.modIds.length === cur.modIds.length &&
          s.modIds.every((m, j) => m === cur.modIds[j])
        );
      });
    if (!same) {
      for (const card of this.hudCards) card?.container.destroy();
      this.hudCards = Array(5).fill(null);
      this.slotCards = slots.slice(0, 5);
      while (this.slotCards.length < 5) this.slotCards.push(null);
      for (let i = 0; i < this.slotCards.length; i++) {
        const sc = this.slotCards[i];
        if (!sc) continue;
        this.hudCards[i] = createSlotCardObj(this, this.statsHud, sc, i);
        this.attachCardHandlers(this.hudCards[i]!);
      }
      this.slotsSyncedOnce = true;
      this.updatePlusHints();
    }
  }

  private attachCardHandlers(obj: HudCardObj): void {
    obj.container.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (pointer.rightButtonDown()) return;
      this.beginCardDrag(obj);
    });
    obj.container.on("pointerover", () => {
      const i = this.hudCards.indexOf(obj);
      if (i >= 0 && !this.dragCard)
        this.showBolterTooltip(this.statsHud.cardSlots[i]);
    });
    obj.container.on("pointerout", () => this.hideBolterTooltip());
  }

  private beginCardDrag(obj: HudCardObj): void {
    if (this.dragCard) return;
    const fromSlot = this.hudCards.indexOf(obj);
    if (fromSlot < 0) return;
    this.dragCard = { obj, fromSlot, hoverSlot: fromSlot };
    obj.targetSlot = -1;
    obj.container.setDepth(2000);
    obj.container.setScale(1.08);
    this.updatePlusHints();
  }

  private slotAtPointer(pointer: Phaser.Input.Pointer): number {
    for (let i = 0; i < this.statsHud.cardSlots.length; i++) {
      const s = this.statsHud.cardSlots[i];
      if (
        pointer.x >= s.x &&
        pointer.x <= s.x + s.width &&
        pointer.y >= s.y - 20 &&
        pointer.y <= s.y + s.height + 30
      ) {
        return i;
      }
    }
    return -1;
  }

  private pointerOverHudCard(pointer: Phaser.Input.Pointer): boolean {
    for (const card of this.hudCards) {
      if (!card) continue;
      const c = card.container;
      const w = c.input?.hitArea?.width ?? this.statsHud.cardSlots[0].width;
      const h = c.input?.hitArea?.height ?? this.statsHud.cardSlots[0].height;
      if (
        pointer.x >= c.x - w / 2 &&
        pointer.x <= c.x + w / 2 &&
        pointer.y >= c.y - h / 2 &&
        pointer.y <= c.y + h / 2
      ) {
        return true;
      }
    }
    return false;
  }

  private updatePlusHints(): void {
    for (let i = 0; i < this.slotPlusHints.length; i++) {
      const hint = this.slotPlusHints[i];
      if (!hint) continue;
      const empty = this.dragCard
        ? i === this.dragCard.hoverSlot
        : !this.slotCards[i];
      hint.setVisible(empty);
    }
  }

  private showBolterTooltip(slot: Phaser.GameObjects.Rectangle): void {
    this.hideBolterTooltip();
    const i = this.statsHud.cardSlots.indexOf(slot);
    const skill = this.slotSkill(i) ?? "shock";
    const lvl = this.skillLevelCache[skill] ?? 1;
    const card = this.hudCards[i];
    const panel = buildCardTooltipPanel(this, {
      skill,
      level: lvl,
      rarity: card ? card.rarity : "common",
      modIds: card ? card.modIds : [],
      modValues: card ? ((card.modValues as number[] | undefined) ?? []) : [],
    });
    panel.setScrollFactor(0).setDepth(300);
    const cam = this.cameras.main;
    let px = slot.x + slot.width / 2;
    px = Math.max(
      panel.width / 2 + 4,
      Math.min(cam.width - panel.width / 2 - 4, px),
    );
    const hudTop = this.statsHud ? this.statsHud.hudImage.y : slot.y;
    let py = hudTop - panel.height / 2 - 30;
    if (py < panel.height / 2 + 4)
      py = slot.y + slot.height + panel.height / 2 + 10;
    panel.setPosition(px, py);
    this.bolterTooltip = panel;
  }

  private hideBolterTooltip(): void {
    if (this.bolterTooltip) {
      this.bolterTooltip.destroy();
      this.bolterTooltip = null;
    }
  }

  private updateCardDrag(pointer: Phaser.Input.Pointer): void {
    if (!this.dragCard) return;
    const d = this.dragCard;
    d.obj.container.setPosition(pointer.x, pointer.y);
    const over = this.slotAtPointer(pointer);
    if (over !== d.hoverSlot) {
      d.hoverSlot = over;
      this.updatePlusHints();
    }
  }

  private endCardDrag(pointer: Phaser.Input.Pointer): void {
    if (!this.dragCard) return;
    const d = this.dragCard;
    const dropSlot = this.slotAtPointer(pointer);
    const invDrop = this.invScreen ? this.invScreen.slotAtPointer(pointer) : -1;
    if (invDrop >= 0) {
      d.obj.container.destroy();
      this.hudCards[d.fromSlot] = null;
      this.dragCard = null;
      const invEmpty = !this.invCardsData[invDrop];
      if (this.room)
        this.room.send(invEmpty ? 14 : 19, { slot: d.fromSlot, inv: invDrop });
      this.syncSlotsFromServer(true);
      this.syncInventoryFromServer(true);
      this.updatePlusHints();
      return;
    }
    if (dropSlot < 0) {
      if (this.room) this.room.send(10, { slot: d.fromSlot });
      d.obj.container.destroy();
      this.hudCards[d.fromSlot] = null;
      this.dragCard = null;
      this.updatePlusHints();
      this.hideBolterTooltip();
      return;
    }
    if (dropSlot !== d.fromSlot) {
      if (this.room) this.room.send(13, { from: d.fromSlot, to: dropSlot });
      const myCard = this.slotCards[d.fromSlot] ?? null;
      const myObj = d.obj;
      if (d.fromSlot < dropSlot) {
        for (let i = d.fromSlot; i < dropSlot; i++) {
          this.slotCards[i] = this.slotCards[i + 1];
          this.hudCards[i] = this.hudCards[i + 1];
        }
      } else {
        for (let i = d.fromSlot; i > dropSlot; i--) {
          this.slotCards[i] = this.slotCards[i - 1];
          this.hudCards[i] = this.hudCards[i - 1];
        }
      }
      this.slotCards[dropSlot] = myCard;
      this.hudCards[dropSlot] = myObj;
    }
    d.obj.container.setScale(1);
    d.obj.container.setDepth(102);
    for (let i = 0; i < this.hudCards.length; i++) {
      const c = this.hudCards[i];
      if (c && c !== d.obj) {
        const ctr = slotCenter(this.statsHud, i);
        this.tweens.killTweensOf(c.container);
        this.tweens.add({
          targets: c.container,
          x: ctr.x,
          y: ctr.y,
          duration: 140,
          ease: "Quad.easeOut",
        });
        c.targetSlot = i;
      }
    }
    const final = slotCenter(this.statsHud, dropSlot);
    this.tweens.killTweensOf(d.obj.container);
    this.tweens.add({
      targets: d.obj.container,
      x: final.x,
      y: final.y,
      duration: 140,
      ease: "Quad.easeOut",
    });
    d.obj.targetSlot = dropSlot;
    this.dragCard = null;
    this.updatePlusHints();
  }

  // ---- Inventory mirror + sync ----
  pullInventoryState(): (SlotCard | null)[] {
    const p = this.currentPlayerState;
    if (!p || !(p as any).inventorySlots) return Array(20).fill(null);
    const arr = (p as any).inventorySlots;
    const out: (SlotCard | null)[] = Array(20).fill(null);
    for (let i = 0; i < 20; i++) {
      const c = arr[i];
      if (c && c.skill) {
        out[i] = {
          skill: c.skill as SkillId,
          level: c.level ?? 1,
          rarity: asRarity(c.rarity),
          modIds: c.modIds ? Array.from(c.modIds) : [],
          modValues: c.modValues ? Array.from(c.modValues as number[]) : [],
        };
      }
    }
    this.invCardsData = out;
    return out;
  }

  syncInventoryFromServer(rebuildAlways: boolean): void {
    const p = this.currentPlayerState;
    if (!p || !(p as any).inventorySlots) return;
    const arr = (p as any).inventorySlots;
    const fresh: (SlotCard | null)[] = Array(20).fill(null);
    for (let i = 0; i < 20; i++) {
      const c = arr[i];
      if (c && c.skill) {
        fresh[i] = {
          skill: c.skill as SkillId,
          level: c.level ?? 1,
          rarity: asRarity(c.rarity),
          modIds: c.modIds ? Array.from(c.modIds) : [],
          modValues: c.modValues ? Array.from(c.modValues as number[]) : [],
        };
      }
    }
    const same =
      !rebuildAlways &&
      fresh.every((s, i) => {
        const cur = this.invCardsData[i];
        if (!s && !cur) return true;
        if (!s || !cur) return false;
        return (
          s.skill === cur.skill &&
          s.level === cur.level &&
          s.rarity === cur.rarity
        );
      });
    if (!same) {
      this.invCardsData = fresh;
      if (this.invScreen?.isVisible()) this.invScreen.syncFromState();
    }
  }

  beginInvCardDrag(i: number): void {
    if (this.invDrag || this.dragCard || this.groundCards.grab) return;
    const sc = this.invCardsData[i];
    if (!sc) return;
    const slot0 = this.statsHud.cardSlots[0];
    const slotW = slot0.width;
    const slotH = slot0.height;
    const inset = slotW * CARD_ART_INSET_RATIO;
    const base = this.add
      .image(0, 0, "card_sheet", rarityBaseFrame(sc.rarity))
      .setDisplaySize(slotW, slotH);
    const img = this.add
      .image(0, 0, "card_sheet", cardFrameForLevel(sc.skill, sc.level))
      .setDisplaySize(slotW - inset * 2, slotH - inset * 2)
      .setAlpha(CARD_ART_ALPHA);
    const cdFill = this.add
      .rectangle(0, 0, slotW, slotH, 0xffffff, 0.45)
      .setOrigin(0, 0)
      .setVisible(false);
    cdFill.setData("baseH", slotH);
    cdFill.setData("baseW", slotW);
    cdFill.x = -slotW / 2;
    const container = this.add
      .container(this.input.activePointer.x, this.input.activePointer.y, [
        base,
        img,
        cdFill,
      ])
      .setScrollFactor(0)
      .setDepth(2000);
    container.setScale(1.08);
    this.invDrag = {
      obj: {
        skill: sc.skill,
        container,
        base,
        img,
        cdFill,
        targetSlot: i,
        rarity: sc.rarity,
        modIds: sc.modIds,
        modValues: sc.modValues,
      },
      fromInv: i,
      hoverInv: i,
    };
  }

  endInvCardDrag(pointer: Phaser.Input.Pointer): void {
    if (!this.invDrag || !this.invScreen) return;
    const d = this.invDrag;
    this.invDrag = null;
    const hudSlot = this.slotAtPointer(pointer);
    const invSlot = this.invScreen.slotAtPointer(pointer);
    if (invSlot >= 0 && invSlot !== d.fromInv) {
      this.room?.send(18, { from: d.fromInv, to: invSlot });
    } else if (hudSlot >= 0) {
      this.room?.send(15, { inv: d.fromInv, slot: hudSlot });
    } else {
      this.room?.send(16, { inv: d.fromInv });
    }
    d.obj.container.destroy();
    this.syncSlotsFromServer(true);
    this.syncInventoryFromServer(true);
  }

  // ---- Toasts / overlays ----
  private showLevelUp(level: number): void {
    this.levelUpToast = showLevelUpToast(this, this.levelUpToast, level);
  }

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

  private updateInvCardDrag(pointer: Phaser.Input.Pointer): void {
    if (!this.invDrag) return;
    const d = this.invDrag;
    d.obj.container.setPosition(pointer.x, pointer.y);
    d.hoverInv = this.invScreen?.slotAtPointer(pointer) ?? -1;
  }

  private updateSpawnCountdown(): void {
    const until = (this.room as any)?.state?.spawnGraceUntil ?? 0;
    const now = Date.now();
    if (until <= now) {
      if (this.spawnCountdownToast) {
        this.spawnCountdownToast.destroy();
        this.spawnCountdownToast = null;
        this.spawnCountdownLastSec = -1;
      }
      return;
    }
    const secsLeft = Math.max(1, Math.ceil((until - now) / 1000));
    if (secsLeft === this.spawnCountdownLastSec) return;
    this.spawnCountdownLastSec = secsLeft;
    this.spawnCountdownToast = showSpawnCountdownToast(
      this,
      this.spawnCountdownToast,
      secsLeft,
    );
  }

  private updateEliteHud(): void {
    const eliteAlive = !!((this.room as any)?.state?.eliteAlive ?? false);
    if (eliteAlive !== this.lastEliteAlive) {
      this.lastEliteAlive = eliteAlive;
      announce(
        this,
        eliteAlive
          ? "AN ELITE ENEMY HAS AWAKENED"
          : "ELITE SLAIN - EXIT UNLOCKED",
        eliteAlive ? "#ffd700" : "#66ff66",
      );
    }
    this.eliteIndicator?.update(this.cameras.main);
  }

  /** Read the elite enemy's current world position from the synced state. */
  private getEliteWorldPos(): { x: number; y: number } | null {
    if (!this.eliteEnemyId) {
      if (this._lastEliteDiag !== 'no-id') {
        console.log('[ELITE_INDICATOR] no eliteEnemyId yet');
        this._lastEliteDiag = 'no-id';
      }
      return null;
    }
    const enemies = (this.room as any)?.state?.enemies;
    if (!enemies) return null;
    const e = enemies.get ? enemies.get(this.eliteEnemyId) : enemies[this.eliteEnemyId];
    if (!e) {
      if (this._lastEliteDiag !== 'no-entity') {
        console.log('[ELITE_INDICATOR] eliteEnemyId set but entity missing:', this.eliteEnemyId);
        this._lastEliteDiag = 'no-entity';
      }
      return null;
    }
    if (this._lastEliteDiag !== 'ok') {
      console.log('[ELITE_INDICATOR] tracking elite', this.eliteEnemyId, 'at', e.x, e.y);
      this._lastEliteDiag = 'ok';
    }
    return { x: e.x, y: e.y };
  }

  // ---- Layered map + debug hitbox rendering ----
  private renderLayeredMap(): void {
    const map = this.mapData;
    const { tileSize, tilesetColumns, tilesetKey, firstgid, cols, rows } = map;
    const tilesetImg = this.textures
      .get(tilesetKey)
      .getSourceImage() as HTMLImageElement;
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
        if (tileId === 0) continue;
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
  }

  private renderDebugHitboxes(): void {
    const gfx = this.add.graphics().setDepth(10);
    const map = this.mapData;
    const { tileSize, cols, rows } = map;
    gfx.lineStyle(3, 0xff0000, 0.7);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (map.collisionGrid[r * cols + c])
          gfx.strokeRect(c * tileSize, r * tileSize, tileSize, tileSize);
      }
    }
    gfx.lineStyle(2, 0xffff00, 0.9);
    const sp = map.spawnPoint;
    gfx.strokeRect(
      sp.x - tileSize / 2,
      sp.y - tileSize / 2,
      tileSize,
      tileSize,
    );
    gfx.lineStyle(2, 0x00ffff, 0.9);
    const ex = map.exitPoint;
    gfx.strokeRect(ex.x, ex.y, ex.width, ex.height);
    gfx.lineStyle(2, 0xff00ff, 0.7);
    for (const zone of map.enemySpawnZones)
      gfx.strokeRect(zone.x, zone.y, zone.width, zone.height);
    gfx.lineStyle(1, 0xffffff, 0.3);
    gfx.strokeRect(0, 0, map.widthPx, map.heightPx);
    gfx.setVisible(this.showHitboxes);
    this.debugHitboxes = gfx;
  }

  private createDebugHUD(): void {
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
      .on("pointerdown", () => this.toggleHitboxes());
  }

  private toggleHitboxes(): void {
    this.showHitboxes = !this.showHitboxes;
    if (this.debugHitboxes) this.debugHitboxes.setVisible(this.showHitboxes);
    if (this.statsHud?.hudHitboxHP)
      this.statsHud.hudHitboxHP.setVisible(this.showHitboxes);
    this.statsHud?.hudHitboxCards.forEach((hb) =>
      hb.setVisible(this.showHitboxes),
    );
    if (this.debugEntityHitboxes)
      this.debugEntityHitboxes.setVisible(this.showHitboxes);
    this.hitboxToggleButton.setText(
      this.showHitboxes ? "[F3] Hitboxes: ON" : "[F3] Hitboxes: OFF",
    );
  }

  // ---- Death screen ----
  private showDeathScreen(): void {
    if (this.deathScreen.container) return;
    this.deathScreen.container = showDeathScreen(
      this,
      () => {
        if (this.mapId !== "map1") {
          this.deathScreen = hideDeathScreen(this.deathScreen);
          try {
            this.room?.leave();
          } catch (_e) {
            /* ignore */
          }
          this.room = null;
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
          this.scene.restart({ fadeIn: true });
          return;
        }
        if (this.room) this.room.send(4, {});
        this.slotCards = Array(5).fill(null);
        this.hudCards = Array(5).fill(null);
        this.slotsSyncedOnce = false;
        this.hideBolterTooltip();
        this.deathScreen = hideDeathScreen(this.deathScreen);
      },
      () => {
        /* Quit no-op */
      },
    );
  }

  private hideDeathScreen(): void {
    this.deathScreen = hideDeathScreen(this.deathScreen);
    this.wasDead = false;
  }

  // ---- Map swap (in-place) ----
  private performMapSwap(nextMapId: string): void {
    if (this.transitioning) return;
    const cfg = (GameScene.MAP_CONFIGS as any)[nextMapId];
    if (!cfg) return;
    this.transitioning = true;
    const cam = this.cameras.main;
    const FADE_MS = 400;
    cam.once("camerafadeoutcomplete", () => {
      const destroyMap = (entities: Record<string, any>) => {
        for (const id in entities) {
          entities[id]?.destroy?.();
          delete entities[id];
        }
      };
      destroyMap(this.enemyEntities);
      destroyMap(this.projectileEntities);
      destroyMap(this.clawEntities);
      destroyMap(this.slamEntities);
      destroyMap(this.vortexEntities);
      for (const [id, bar] of Object.entries(this.enemyHpBars)) {
        bar?.destroy?.();
        delete this.enemyHpBars[id];
      }
      this.enemyLastPos = {};
      this.projLastPos = {};
      this.entityHitSeqs = {};
      resetGroundCards(this, this.groundCards);
      this.dragCard = null;
      this.children.list
        .filter(
          (obj) =>
            (obj as any).texture &&
            ((obj as any).texture.key === "layered_baselayer" ||
              (obj as any).texture.key === "layered_interactive"),
        )
        .forEach((obj) => obj.destroy());
      if (this.debugHitboxes) {
        this.debugHitboxes.destroy();
        this.debugHitboxes = null;
      }
      this.mapId = nextMapId;
      this.mapData = cfg.mapData;
      this.renderLayeredMap();
      this.renderDebugHitboxes();
      if (this.debugHitboxes) this.debugHitboxes.setVisible(this.showHitboxes);
      const spawn = this.mapData.spawnPoint;
      for (const id in this.playerEntities) {
        const s = this.playerEntities[id];
        if (s?.active) {
          s.x = spawn.x;
          s.y = spawn.y;
          s.setData("serverX", spawn.x);
          s.setData("serverY", spawn.y);
        }
      }
      if (this.currentPlayer) {
        this.currentPlayer.x = spawn.x;
        this.currentPlayer.y = spawn.y;
      }
      this.cameras.main.centerOn(spawn.x, spawn.y);
      this.cameras.main.setBounds(
        0,
        0,
        this.mapData.widthPx,
        this.mapData.heightPx,
      );
      rebuildMapInfoTooltip(this, this.mapInfo);
      cam.fadeIn(FADE_MS, 0, 0, 0);
      this.transitioning = false;
    });
    cam.fadeOut(FADE_MS, 0, 0, 0);
  }

  // ---- Fixed-timestep tick ----
  fixedTick(): void {
    this.currentTick++;
    const now = Date.now();
    if (Phaser.Input.Keyboard.JustDown(this.hitboxToggleKey))
      this.toggleHitboxes();
    this.debugFPS.setText("FPS: " + Math.round(this.game.loop.actualFps));
    if (!this.currentPlayer || !this.room) return;
    this.inputPayload.left = this.wasdKeys.left.isDown;
    this.inputPayload.right = this.wasdKeys.right.isDown;
    this.inputPayload.up = this.wasdKeys.up.isDown;
    this.inputPayload.down = this.wasdKeys.down.isDown;
    this.inputPayload.tick = this.currentTick;
    this.room.send(0, this.inputPayload);
    this.updatePlayerAnimation();

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
    this.currentPlayer.x += dirX * this.moveSpeed * dt;
    this.currentPlayer.y += dirY * this.moveSpeed * dt;
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

    // ---- Exit-locked toast while standing on the exit before elite death ----
    const onExit =
      this.currentPlayer &&
      this.currentPlayer.active &&
      (this.currentPlayer.x !== 0 || this.currentPlayer.y !== 0) &&
      this.isOnExitTile();
    this.exitLockedToast = showExitLockedToast(
      this,
      this.exitLockedToast,
      !!(onExit && !(this.room as any)?.state?.exitUnlocked),
    );

    // ---- Entity visuals: interpolation, anims, HP bars, hit flash ----
    updateEntityVisuals(this as any);

    // ---- Inventory card drag follow ----
    if (this.invDrag) this.updateInvCardDrag(this.input.activePointer);

    this.sendViewport();
    updateSlotCooldowns(
      this,
      this.statsHud,
      this.hudCards,
      this.slotCards,
      this.currentPlayer,
    );
    if (this.dragCard) this.updateCardDrag(this.input.activePointer);
    else if (this.groundCards.grab)
      updateGroundGrab(this.groundCards, this.input.activePointer);

    this.updateSpawnCountdown();
    this.updateEliteHud();
    updateVignettes(this.statsHud, this.currentPlayerState);
    if (this.currentPlayerState) {
      if (this.currentPlayerState.currentHealth <= 0 && !this.wasDead) {
        this.wasDead = true;
        this.showDeathScreen();
      } else if (this.currentPlayerState.currentHealth > 0 && this.wasDead) {
        this.hideDeathScreen();
      }
    }

    for (const slamId in this.slamEntities) {
      const sprite = this.slamEntities[slamId];
      const remaining = sprite.data.get("remainingRange") as number;
      updateSlamFrame(sprite, remaining);
    }
  }

  sendViewport(): void {
    if (!this.room) return;
    const cam = this.cameras.main;
    const wv = cam.worldView;
    this.room.send(3, { x: wv.x, y: wv.y, w: wv.width, h: wv.height });
  }

  update(_t: number, delta: number): void {
    if (!this.room) return;
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
