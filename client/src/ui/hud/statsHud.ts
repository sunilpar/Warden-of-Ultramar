/**
 * Bottom-left Stats HUD (HP bar, shield bar, card slots, vignettes).
 *
 * The HUD_SCALE + slot rects are tunable in the constants block below.
 * Press F3 in-game to overlay hitboxes and align by eye.
 */
import Phaser from "phaser";
import {
  asRarity,
  cardFrameForLevel,
  CARD_ART_INSET_RATIO,
  rarityBaseFrame,
  type Rarity,
  type SkillId,
} from "../../config/skillDefs";

/** Cooldown fill tint per skill. Edit to recolor the bar fill. */
export const CARD_CD_COLORS: Partial<Record<SkillId, number>> = {
  shock: 0x4da6ff,
  pulse: 0xb266ff,
  dash: 0x66ccff,
  heal: 0x00ff00,
  vortex: 0x999999,
  claw: 0xff9955,
  slam: 0xffcc44,
  bolter: 0xffee88,
};

/** Slot binding keys (LMB / RMB / SPACE / 1 / 2). */
export const SLOT_INPUTS: string[] = ["LMB", "RMB", "SPC", "1", "2"];

/** Approximate full cooldown (ms) per skill, for the HUD fill animation. */
export const SLOT_CD_MS: Partial<Record<SkillId, number>> = {
  shock: 700,
  slam: 3000,
  claw: 500,
  vortex: 8000,
  pulse: 5000,
  dash: 5000,
  bolter: 500,
};

/** Live HUD card game object (one per equipped slot). */
export interface HudCardObj {
  skill: SkillId;
  container: Phaser.GameObjects.Container;
  base: Phaser.GameObjects.Image;
  img: Phaser.GameObjects.Image;
  cdFill: Phaser.GameObjects.Rectangle;
  targetSlot: number;
  rarity: Rarity;
  modIds: string[];
  modValues?: number[];
}

/** Mirrors the server CardInstance on the client. */
export interface SlotCard {
  skill: SkillId;
  level: number;
  rarity: Rarity;
  modIds: string[];
  modValues?: number[];
}

export interface StatsHudRefs {
  hudImage: Phaser.GameObjects.Image;
  hpFill: Phaser.GameObjects.Rectangle;
  hpText: Phaser.GameObjects.Text;
  statsText: Phaser.GameObjects.Text;
  cardSlots: Phaser.GameObjects.Rectangle[];
  shieldFill: Phaser.GameObjects.Rectangle;
  shieldText: Phaser.GameObjects.Text;
  hpBarFullWidth: number;
  hpBarFullHeight: number;
  shieldBarFullWidth: number;
  shieldBarFullHeight: number;
  lowHpVignette: Phaser.GameObjects.Rectangle[];
  lowShieldVignette: Phaser.GameObjects.Rectangle[];
  hudHitboxHP: Phaser.GameObjects.Rectangle;
  hudHitboxCards: Phaser.GameObjects.Rectangle[];
}

export interface StatsHudOptions {
  initialShowHitboxes: boolean;
}

export function createStatsHud(
  scene: Phaser.Scene,
  opts: StatsHudOptions,
): StatsHudRefs {
  const HUD_SCALE = 0.3;
  const HP_X = 87;
  const HP_Y_TOP = 90;
  const HP_Y_BOT = 400;
  const HP_WIDTH = 120;
  const HP_BACK_COLOR = 0x1a0000;
  const HP_FILL_COLOR = 0xaa0000;
  const HP_FILL_ALPHA = 1.0;
  const SHIELD_Y_TOP = 90;
  const SHIELD_Y_BOT = 400;
  const SHIELD_X = 238;
  const SHIELD_BACK_COLOR = 0x06141c;
  const SHIELD_FILL_COLOR = 0x33b5ff;
  const SHIELD_FILL_ALPHA = 0.9;
  const SLOT_Y_TOP = 150;
  const SLOT_Y_BOT = 400;
  const SLOT_WIDTH = 128;
  const SLOT_X0 = 440;
  const SLOT_GAP = 25;
  const HITBOX_HP_COLOR = 0x00ffff;
  const HITBOX_CARD_COLOR = 0xff00ff;
  const HITBOX_STROKE = 2;

  const HUD_IMG_W = 1366;
  const HUD_IMG_H = 479;
  const hudW = HUD_IMG_W * HUD_SCALE;
  const hudH = HUD_IMG_H * HUD_SCALE;
  const hudOriginX = 0;
  const hudOriginY = scene.cameras.main.height - hudH;
  const nx = (x: number) => hudOriginX + x * HUD_SCALE;
  const ny = (y: number) => hudOriginY + y * HUD_SCALE;

  const hudImage = scene.add
    .image(hudOriginX, hudOriginY, "hud")
    .setOrigin(0, 0)
    .setDisplaySize(hudW, hudH)
    .setScrollFactor(0)
    .setDepth(100);

  const hpFullW = HP_WIDTH * HUD_SCALE;
  const hpFullH = (HP_Y_BOT - HP_Y_TOP) * HUD_SCALE;
  scene.add
    .rectangle(nx(HP_X), ny(HP_Y_TOP), hpFullW, hpFullH, HP_BACK_COLOR)
    .setOrigin(0, 0)
    .setScrollFactor(0)
    .setDepth(101);
  const hpFill = scene.add
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
  const hpText = scene.add
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

  const shieldFullW = hpFullW;
  const shieldFullH = (SHIELD_Y_BOT - SHIELD_Y_TOP) * HUD_SCALE;
  scene.add
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
  const shieldFill = scene.add
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
  const shieldText = scene.add
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

  const camW = scene.cameras.main.width;
  const camH = scene.cameras.main.height;
  const V_THICK = 36;
  const makeVignette = (color: number): Phaser.GameObjects.Rectangle[] => {
    const lef = scene.add
      .rectangle(V_THICK / 2, camH / 2, V_THICK, camH, color)
      .setScrollFactor(0)
      .setDepth(490)
      .setAlpha(0);
    const rig = scene.add
      .rectangle(camW - V_THICK / 2, camH / 2, V_THICK, camH, color)
      .setScrollFactor(0)
      .setDepth(490)
      .setAlpha(0);
    return [lef, rig];
  };
  const lowHpVignette = makeVignette(0xff0000);
  const lowShieldVignette = makeVignette(0x33b5ff);

  const slotW = SLOT_WIDTH * HUD_SCALE;
  const slotH = (SLOT_Y_BOT - SLOT_Y_TOP) * HUD_SCALE;
  const slotStep = (SLOT_WIDTH + SLOT_GAP) * HUD_SCALE;
  const slot0X = nx(SLOT_X0);
  const slot0Y = ny(SLOT_Y_TOP);
  const cardSlots: Phaser.GameObjects.Rectangle[] = [];
  const hudHitboxCards: Phaser.GameObjects.Rectangle[] = [];
  for (let i = 0; i < 5; i++) {
    const x = slot0X + i * slotStep;
    const y = slot0Y;
    const frame = scene.add
      .rectangle(x, y, slotW, slotH, 0x000000, 0.0)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(101);
    cardSlots.push(frame);
    const hb = scene.add
      .rectangle(x, y, slotW, slotH, 0x000000, 0.0)
      .setStrokeStyle(HITBOX_STROKE, HITBOX_CARD_COLOR, 0.9)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(1000);
    hb.setVisible(opts.initialShowHitboxes);
    hudHitboxCards.push(hb);
  }
  const hudHitboxHP = scene.add
    .rectangle(nx(HP_X), ny(HP_Y_TOP), hpFullW, hpFullH, 0x000000, 0.0)
    .setStrokeStyle(HITBOX_STROKE, HITBOX_HP_COLOR, 0.9)
    .setOrigin(0, 0)
    .setScrollFactor(0)
    .setDepth(1000);
  hudHitboxHP.setVisible(opts.initialShowHitboxes);

  const statsText = scene.add
    .text(scene.cameras.main.width - 10, 10, "", {
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

  return {
    hudImage,
    hpFill,
    hpText,
    statsText,
    cardSlots,
    shieldFill,
    shieldText,
    hpBarFullWidth: hpFullW,
    hpBarFullHeight: hpFullH,
    shieldBarFullWidth: shieldFullW,
    shieldBarFullHeight: shieldFullH,
    lowHpVignette,
    lowShieldVignette,
    hudHitboxHP,
    hudHitboxCards,
  };
}

export function slotCenter(
  refs: StatsHudRefs,
  i: number,
): { x: number; y: number } {
  const s = refs.cardSlots[i];
  return { x: s.x + s.width / 2, y: s.y + s.height / 2 };
}

export function createSlotCardObj(
  scene: Phaser.Scene,
  refs: StatsHudRefs,
  sc: SlotCard,
  i: number,
): HudCardObj {
  const slot = refs.cardSlots[i];
  const c = slotCenter(refs, i);
  const artFrame = cardFrameForLevel(sc.skill, sc.level);
  const inset = slot.width * CARD_ART_INSET_RATIO;
  const base = scene.add
    .image(0, 0, "card_sheet", rarityBaseFrame(sc.rarity))
    .setDisplaySize(slot.width, slot.height);
  const img = scene.add
    .image(0, 0, "card_sheet", artFrame)
    .setDisplaySize(slot.width - inset * 2, slot.height - inset * 2)
    .setAlpha(1);
  const cdFill = scene.add
    .rectangle(
      0,
      0,
      slot.width,
      slot.height,
      CARD_CD_COLORS[sc.skill] ?? 0xffffff,
      0.45,
    )
    .setOrigin(0, 0)
    .setVisible(false);
  cdFill.setData("baseH", slot.height);
  cdFill.setData("baseW", slot.width);
  cdFill.x = -slot.width / 2;
  const container = scene.add
    .container(c.x, c.y, [base, img, cdFill])
    .setScrollFactor(0)
    .setDepth(102);
  const obj: HudCardObj = {
    skill: sc.skill,
    container,
    base,
    img,
    cdFill,
    targetSlot: i,
    rarity: sc.rarity,
    modIds: sc.modIds,
    modValues: sc.modValues,
  };
  container.setSize(slot.width, slot.height);
  const PAD = 12;
  container.setInteractive(
    new Phaser.Geom.Rectangle(
      -slot.width / 2 - PAD,
      -slot.height / 2 - PAD,
      slot.width + PAD * 2,
      slot.height + PAD * 2,
    ),
    Phaser.Geom.Rectangle.Contains,
  );
  return obj;
}

export function updateStatsHud(refs: StatsHudRefs, player: any): void {
  if (!refs.hpFill) return;
  const ratio =
    player.maxHealth > 0
      ? Phaser.Math.Clamp(player.currentHealth / player.maxHealth, 0, 1)
      : 0;
  refs.hpFill.setSize(
    refs.hpBarFullWidth,
    Math.max(0.001, refs.hpBarFullHeight * ratio),
  );
  refs.hpText.setText(Math.round(ratio * 100) + "%");
  if (refs.shieldFill) {
    const maxS = player.maxShield ?? 0;
    const curS = player.shield ?? 0;
    if (maxS > 0) {
      const sRatio = Phaser.Math.Clamp(curS / maxS, 0, 1);
      refs.shieldFill.setVisible(true);
      refs.shieldFill.setSize(
        refs.shieldBarFullWidth,
        Math.max(0.001, refs.shieldBarFullHeight * sRatio),
      );
      if (refs.shieldText) {
        refs.shieldText.setVisible(true);
        refs.shieldText.setText(Math.round(sRatio * 100) + "%");
      }
    } else {
      refs.shieldFill.setVisible(false);
      if (refs.shieldText) refs.shieldText.setVisible(false);
    }
  }
  if (refs.statsText) {
    const pct = (v: number) => Math.round(v * 100) + "%";
    refs.statsText.setText(
      [
        "Lv " + Math.floor(player.level) + "  XP " + Math.floor(player.currentXp ?? 0) + "/" + Math.floor(player.xpToLevelUp ?? 0),
        "ATK " + Math.round(player.attack) + "  CRIT " + pct(player.critRate) + " / " + pct(player.critDamage),
      ].join("\n"),
    );
  }
}

export function updateVignettes(refs: StatsHudRefs, p: any): void {
  if (!p || !refs.lowHpVignette.length) return;
  let hpAlpha = 0;
  if (p.maxHealth > 0) {
    const hpRatio = p.currentHealth / p.maxHealth;
    if (hpRatio < 0.3) {
      hpAlpha = Phaser.Math.Clamp(((0.3 - hpRatio) / 0.3) * 0.55, 0, 0.55);
    }
  }
  for (const r of refs.lowHpVignette) r.setAlpha(hpAlpha);
  let shAlpha = 0;
  const maxS = p.maxShield ?? 0;
  const curS = p.shield ?? 0;
  if (maxS > 0 && curS > 0) {
    const sRatio = curS / maxS;
    if (sRatio <= 0.2) {
      shAlpha = Phaser.Math.Clamp(((0.2 - sRatio) / 0.2) * 0.5, 0, 0.5);
    }
  }
  for (const r of refs.lowShieldVignette) r.setAlpha(shAlpha);
}

export function updateSlotCooldowns(
  scene: Phaser.Scene,
  refs: StatsHudRefs,
  hudCards: (HudCardObj | null)[],
  slotCards: (SlotCard | null)[],
  currentPlayer: Phaser.GameObjects.GameObject | null,
): void {
  if (!currentPlayer) return;
  const now = Date.now();
  const cds = (currentPlayer.data.get("slotCooldownEndsAt") as
    | number[]
    | undefined) ?? [];
  const healKills = (currentPlayer.data.get("slotHealKills") as
    | number[]
    | undefined) ?? [];
  for (let i = 0; i < hudCards.length; i++) {
    const card = hudCards[i];
    if (!card) continue;
    const baseW: number = card.cdFill.data.get("baseW") ?? card.cdFill.width;
    const baseH: number = card.cdFill.data.get("baseH") ?? card.cdFill.height;
    const endAt = cds[i] ?? 0;
    const skill = card.skill;
    const cdMs = SLOT_CD_MS[skill] ?? 1000;
    if (endAt > now) {
      const remaining = endAt - now;
      const pct = Math.max(0, Math.min(1, remaining / cdMs));
      const bh = baseH;
      const height = bh * pct;
      card.cdFill.setSize(baseW, height);
      card.cdFill.y = bh / 2 - height;
      card.cdFill.visible = true;
    } else {
      const sc = slotCards[i];
      if (sc && sc.skill === "heal" && sc.level < 6) {
        const threshold = sc.level <= 2 ? 4 : 3;
        const ready = (healKills[i] ?? 0) >= threshold;
        if (!ready) {
          const have = healKills[i] ?? 0;
          const pct = Math.max(0.05, have / threshold);
          const bh = baseH;
          card.cdFill.setSize(baseW, bh * pct);
          card.cdFill.y = bh / 2 - bh * pct;
          card.cdFill.visible = true;
          card.cdFill.setFillStyle(0x888888, 0.45);
          continue;
        }
      }
      card.cdFill.visible = false;
    }
  }
}
