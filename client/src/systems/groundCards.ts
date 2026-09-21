/**
 * Ground Card Pickup System
 *
 * Owns world-space entities for dropped cards + their dwell-then-show tooltip
 * and grab/drag/release flow.
 *
 * SERVER MESSAGES:
 *   11 = pickup to slot        { cardId, slot }
 *   12 = move ground card      { cardId, x, y }
 *   17 = pickup to inventory   { cardId, inv }
 *
 * HIDE LOOT TILL TIMER:
 *   Each synced GroundCard has a `pickupLockUntil` server timestamp. Cards
 *   remain VISIBLE but their click target is disabled until the timer
 *   expires. Add `pickupLocked()` gate calls wherever the entity is
 *   grabbed/dragged to respect this lock.
 *
 * GROUP PICKUP:
 *   Single-card grab/release is wired. The drag handler is structured so
 *   adding a group-pickup mode (e.g. shift+click to grab all visible)
 *   is one new release branch.
 */
import Phaser from "phaser";
import {
  asRarity,
  cardFrameForLevel,
  CARD_ART_INSET_RATIO,
  rarityBaseFrame,
  RARITY_COLORS,
  type SkillId,
} from "../config/skillDefs";
import { buildCardTooltipPanel } from "../ui/cardTooltip";
import { showPickupFailedToast } from "../ui/toasts";
import type { HudCardObj } from "../ui/hud/statsHud";

const PICKUP_RANGE_PX = 96;
// Server tolerance added to its 96 px check so a tiny client-prediction
// vs server-authoritative disagreement (moveSpeed * RTT) doesn't fail
// pickup silently. Client uses this slightly larger value for its
// pre-check; server still gates with the smaller radius.
const PICKUP_REACH_TOLERANCE_PX = 28;
const PICKUP_RANGE_CLIENT_PX = PICKUP_RANGE_PX + PICKUP_REACH_TOLERANCE_PX;
const TOOLTIP_DWELL_MS = 350;

export interface GroundCardsState {
  entities: Map<string, Phaser.GameObjects.Container>;
  tooltip: Phaser.GameObjects.Container | null;
  dwellTimer: Phaser.Time.TimerEvent | null;
  grab: {
    cardId: string;
    card: any;
    entity: Phaser.GameObjects.Container;
    obj: HudCardObj;
  } | null;
  pendingPickups: Set<string>;
  pendingPickupSlots: Map<string, number>;
}

export interface GroundCardCallbacks {
  canGrab: () => boolean;
  getPlayer: () => Phaser.GameObjects.Sprite | null;
  getSlotTemplate: () => HudCardObj | null;
  sendPickupToSlot: (cardId: string, slot: number) => void;
  sendPickupToInventory: (cardId: string, inv: number) => void;
  sendRedrop: (cardId: string, x: number, y: number) => void;
  invAtPointer: (p: Phaser.Input.Pointer) => number;
  slotAtPointer: (p: Phaser.Input.Pointer) => number;
  refreshHud: () => void;
  updatePlusHints: () => void;
  getCardCdColor: (s: SkillId) => number | undefined;
}

export function createGroundCards(): GroundCardsState {
  return {
    entities: new Map(),
    tooltip: null,
    dwellTimer: null,
    grab: null,
    pendingPickups: new Set(),
    pendingPickupSlots: new Map(),
  };
}

export function createGroundCardEntity(
  scene: Phaser.Scene,
  card: any,
  cardId: string,
  state: GroundCardsState,
  cb: GroundCardCallbacks,
): void {
  const skill = card.skill as SkillId;
  const def = (scene as any).SKILL_CARDS_LOOKUP?.[skill];
  const W = 84;
  const H = 20;
  const rarity = (card.card?.rarity as string) ?? "common";
  const rarityColor =
    RARITY_COLORS[rarity as keyof typeof RARITY_COLORS] ?? 0x9e9e9e;
  const box = scene.add
    .rectangle(0, 0, W, H, 0x1c1c1c, 0.92)
    .setStrokeStyle(2, rarityColor, 1);
  const label = scene.add
    .text(0, 0, def ? def.title : skill, {
      color: "#" + rarityColor.toString(16).padStart(6, "0"),
      fontSize: "11px",
      fontFamily: "monospace",
      fontStyle: "bold",
      stroke: "#000000",
      strokeThickness: 2,
    })
    .setOrigin(0.5);
  const container = scene.add
    .container(card.x, card.y, [box, label])
    .setDepth(2);
  container.setSize(W, H);
  const GPAD = 14;
  container.setInteractive(
    new Phaser.Geom.Rectangle(
      -W / 2 - GPAD,
      -H / 2 - GPAD,
      W + GPAD * 2,
      H + GPAD * 2,
    ),
    Phaser.Geom.Rectangle.Contains,
  );
  const pickupLocked = () =>
    typeof card.pickupLockUntil === "number" &&
    card.pickupLockUntil > Date.now();
  container.on("pointerover", () => {
    if (pickupLocked()) return;
    container.setAlpha(0.9);
    scheduleTooltip(scene, state, card, container);
  });
  container.on("pointerout", () => {
    container.setAlpha(1);
    cancelTooltip(scene, state);
  });
  container.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
    if (pointer.rightButtonDown()) return;
    if (!cb.canGrab()) return;
    if (pickupLocked()) {
      showPickupFailedToast(scene, "LOOT IS SETTLING...");
      return;
    }
    beginGrab(scene, state, cb, cardId, card, container);
  });
  state.entities.set(cardId, container);
}

function scheduleTooltip(
  scene: Phaser.Scene,
  state: GroundCardsState,
  card: any,
  entity: Phaser.GameObjects.Container,
): void {
  cancelTooltip(scene, state);
  state.dwellTimer = scene.time.delayedCall(TOOLTIP_DWELL_MS, () => {
    state.dwellTimer = null;
    showTooltip(scene, state, card, entity);
  });
}

function cancelTooltip(scene: Phaser.Scene, state: GroundCardsState): void {
  if (state.dwellTimer) {
    state.dwellTimer.remove(false);
    state.dwellTimer = null;
  }
  hideTooltip(state);
}

function showTooltip(
  scene: Phaser.Scene,
  state: GroundCardsState,
  card: any,
  entity: Phaser.GameObjects.Container,
): void {
  hideTooltip(state);
  const panel = buildCardTooltipPanel(scene, {
    skill: card.skill as SkillId,
    level: card.level ?? 1,
    rarity: asRarity(card.card?.rarity ?? "common"),
    modIds: (card.card?.modIds as string[]) ?? [],
    modValues: (card.card?.modValues as number[]) ?? [],
  });
  state.tooltip = panel;
  panel.setPosition(entity.x, entity.y - panel.height / 2 - 28);
  panel.setDepth(100);
}

function hideTooltip(state: GroundCardsState): void {
  if (state.tooltip) {
    state.tooltip.destroy();
    state.tooltip = null;
  }
}

function beginGrab(
  scene: Phaser.Scene,
  state: GroundCardsState,
  cb: GroundCardCallbacks,
  cardId: string,
  card: any,
  entity: Phaser.GameObjects.Container,
): void {
  if (state.grab) return;
  const p = cb.getPlayer();
  if (!p) return;
  const ex = entity.x;
  const ey = entity.y;
  const cardDist = Math.hypot(card.x - p.x, card.y - p.y);
  const entDist = Math.hypot(ex - p.x, ey - p.y);
  if (cardDist > PICKUP_RANGE_CLIENT_PX && entDist > PICKUP_RANGE_CLIENT_PX) {
    showPickupFailedToast(scene, "TOO FAR TO GRAB");
    return;
  }
  cancelTooltip(scene, state);
  const skill = ((card.card?.skill as SkillId) ?? card.skill) as SkillId;
  const slot0 = cb.getSlotTemplate();
  if (!slot0) return;
  const gRarity = asRarity(card.card?.rarity);
  const gInset = slot0.container.width * CARD_ART_INSET_RATIO;
  const base = scene.add
    .image(0, 0, "card_sheet", rarityBaseFrame(gRarity))
    .setDisplaySize(slot0.container.width, slot0.container.height);
  const img = scene.add
    .image(0, 0, "card_sheet", cardFrameForLevel(skill, card.level ?? 1))
    .setDisplaySize(
      slot0.container.width - gInset * 2,
      slot0.container.height - gInset * 2,
    )
    .setAlpha(1);
  const cdFill = scene.add
    .rectangle(
      0,
      0,
      slot0.container.width,
      slot0.container.height,
      cb.getCardCdColor(skill) ?? 0xffffff,
      0.45,
    )
    .setOrigin(0, 0)
    .setVisible(false);
  cdFill.setData("baseH", slot0.container.height);
  cdFill.setData("baseW", slot0.container.width);
  cdFill.x = -slot0.container.width / 2;
  const container = scene.add
    .container(scene.input.activePointer.x, scene.input.activePointer.y, [
      base,
      img,
      cdFill,
    ])
    .setScrollFactor(0)
    .setDepth(2000);
  container.setScale(1.08);
  const obj: HudCardObj = {
    skill,
    container,
    base,
    img,
    cdFill,
    targetSlot: -1,
    rarity: gRarity,
    modIds: card.card?.modIds ? Array.from(card.card.modIds) : [],
    modValues: card.card?.modValues
      ? Array.from(card.card.modValues as number[])
      : [],
  };
  entity.setVisible(false);
  state.grab = { cardId, card, entity, obj };
  cb.updatePlusHints();
}

export function updateGroundGrab(
  state: GroundCardsState,
  pointer: Phaser.Input.Pointer,
): void {
  if (!state.grab) return;
  state.grab.obj.container.setPosition(pointer.x, pointer.y);
}

export function endGroundGrab(
  scene: Phaser.Scene,
  state: GroundCardsState,
  cb: GroundCardCallbacks,
  pointer: Phaser.Input.Pointer,
): void {
  const g = state.grab;
  if (!g) return;
  state.grab = null;
  const invIdx = cb.invAtPointer(pointer);
  if (invIdx >= 0) {
    state.pendingPickups.add(g.cardId);
    cb.sendPickupToInventory(g.cardId, invIdx);
    g.obj.container.destroy();
    g.entity.setVisible(true);
    const grabbedId = g.cardId;
    scene.time.delayedCall(500, () => {
      if (state.pendingPickups.has(grabbedId)) {
        state.pendingPickups.delete(grabbedId);
        showPickupFailedToast(scene, "PICKUP FAILED - TRY AGAIN");
      }
    });
    cb.updatePlusHints();
    return;
  }
  const slotIdx = cb.slotAtPointer(pointer);
  if (slotIdx >= 0) {
    state.pendingPickups.add(g.cardId);
    state.pendingPickupSlots.set(g.cardId, slotIdx);
    cb.sendPickupToSlot(g.cardId, slotIdx);
    g.obj.container.destroy();
    g.entity.setVisible(true);
    const grabbedId = g.cardId;
    scene.time.delayedCall(500, () => {
      if (state.pendingPickups.has(grabbedId)) {
        state.pendingPickups.delete(grabbedId);
        state.pendingPickupSlots.delete(grabbedId);
        showPickupFailedToast(scene, "PICKUP FAILED - TRY AGAIN");
      }
    });
  } else {
    cb.sendRedrop(g.cardId, pointer.worldX, pointer.worldY);
    g.obj.container.destroy();
    g.entity.setVisible(true);
  }
  cb.updatePlusHints();
}

export function pointerOverGroundCard(
  state: GroundCardsState,
  pointer: Phaser.Input.Pointer,
): boolean {
  if (state.grab) return true;
  for (const entity of state.entities.values()) {
    if (!entity.visible) continue;
    const w = entity.input?.hitArea?.width ?? 84;
    const h = entity.input?.hitArea?.height ?? 20;
    if (
      pointer.x >= entity.x - w / 2 &&
      pointer.x <= entity.x + w / 2 &&
      pointer.y >= entity.y - h / 2 &&
      pointer.y <= entity.y + h / 2
    ) {
      return true;
    }
  }
  return false;
}

export function resetGroundCards(
  scene: Phaser.Scene,
  state: GroundCardsState,
): void {
  for (const [, ent] of state.entities) ent.destroy();
  state.entities.clear();
  cancelTooltip(scene, state);
  state.pendingPickups.clear();
  state.pendingPickupSlots.clear();
  state.grab = null;
}
