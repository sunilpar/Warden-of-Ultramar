/**
 * Inventory Screen (press I to toggle; slides in from the right).
 */
import Phaser from "phaser";
import {
  asRarity,
  cardFrameForLevel,
  CARD_ART_ALPHA,
  CARD_ART_INSET_RATIO,
  rarityBaseFrame,
  type Rarity,
  type SkillId,
} from "../../config/skillDefs";
import { buildCardTooltipPanel } from "../cardTooltip";
import { buildOutlineFrame } from "../uiOutline";
import type { HudCardObj, SlotCard } from "../hud/statsHud";

const INV_COLS = 5;
const INV_ROWS = 4;
const INV_SLOT_GAP = 10;

export interface InventoryScreenRefs {
  container: Phaser.GameObjects.Container;
  overlay: Phaser.GameObjects.Rectangle;
  toggle: () => void;
  isVisible: () => boolean;
  rebuildCards: () => void;
  syncFromState: () => void;
  slotAtPointer: (p: Phaser.Input.Pointer) => number;
  slotCenter: (i: number) => { x: number; y: number };
  hideTooltip: () => void;
  close: () => void;
  getData: () => (SlotCard | null)[];
}

export interface InventoryScreenCallbacks {
  scene: Phaser.Scene;
  slotW: number;
  slotH: number;
  pullState: () => (SlotCard | null)[];
  sendSlotToInv: (slot: number, inv: number, empty: boolean) => void;
  sendInvSwap: (from: number, to: number) => void;
  sendInvToSlot: (inv: number, slot: number) => void;
  sendInvDrop: (inv: number) => void;
  isDragFree: () => boolean;
  onDragStart?: (invSlot: number) => void;
  onDragEnd?: (pointer: Phaser.Input.Pointer) => void;
}

export function createInventoryScreen(cb: InventoryScreenCallbacks): InventoryScreenRefs {
  const { scene } = cb;
  const W = scene.cameras.main.width;
  const H = scene.cameras.main.height;
  const slotW = cb.slotW;
  const slotH = cb.slotH;
  const gridW = INV_COLS * slotW + (INV_COLS - 1) * INV_SLOT_GAP;
  const gridH = INV_ROWS * slotH + (INV_ROWS - 1) * INV_SLOT_GAP;
  const PANEL_W = gridW + 40;
  const PANEL_H = H;
  const px = W - PANEL_W - 24;
  const py = 0;
  const container = scene.add
    .container(0, 0)
    .setDepth(400)
    .setVisible(false)
    .setScrollFactor(0);
  const overlay = scene.add
    .rectangle(0, 0, W, H, 0x000000, 0)
    .setOrigin(0, 0)
    .setScrollFactor(0)
    .setDepth(399)
    .setVisible(false);
  const panelBg = scene.add.graphics().setScrollFactor(0);
  panelBg.fillStyle(0x0a0a14, 0.95);
  panelBg.fillRect(px, py, PANEL_W, PANEL_H);
  container.add(panelBg);
  container.add(buildOutlineFrame(scene, px, py, PANEL_W, PANEL_H).setDepth(1));
  container.add(
    scene.add
      .text(px + PANEL_W / 2, py + 14, "INVENTORY", {
        color: "#ffd700",
        fontSize: "20px",
        fontFamily: "monospace",
        fontStyle: "bold",
        stroke: "#000000",
        strokeThickness: 4,
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0),
  );
  container.add(
    scene.add
      .text(px + PANEL_W - 12, py + 10, "[I] Close", {
        color: "#888888",
        fontSize: "11px",
        fontFamily: "monospace",
        stroke: "#000000",
        strokeThickness: 2,
      })
      .setOrigin(1, 0)
      .setScrollFactor(0),
  );

  const cellG = scene.add.graphics().setScrollFactor(0);
  const shelfTop = py + 50;
  const slotRects: Phaser.GameObjects.Rectangle[] = [];
  for (let r = 0; r < INV_ROWS; r++) {
    for (let c = 0; c < INV_COLS; c++) {
      const x = px + 20 + c * (slotW + INV_SLOT_GAP);
      const y = shelfTop + r * (slotH + INV_SLOT_GAP);
      cellG.fillStyle(0x3a2a1a, 0.9);
      cellG.fillRect(x, y, slotW, slotH);
      cellG.fillStyle(0x57422a, 0.75);
      cellG.fillRect(x + 3, y + 3, slotW - 6, slotH - 6);
      const rect = scene.add
        .rectangle(x, y, slotW, slotH)
        .setOrigin(0, 0)
        .setScrollFactor(0);
      container.add(rect);
      slotRects.push(rect);
    }
  }
  container.add(cellG);

  let data: (SlotCard | null)[] = Array(20).fill(null);
  let cards: (HudCardObj | null)[] = Array(20).fill(null);
  let tooltip: Phaser.GameObjects.Container | null = null;
  const hideTooltip = () => {
    if (tooltip) {
      tooltip.destroy();
      tooltip = null;
    }
  };
  const showTooltip = (sc: SlotCard, x: number, y: number) => {
    hideTooltip();
    const tt = buildCardTooltipPanel(scene, {
      skill: sc.skill,
      level: sc.level,
      rarity: sc.rarity,
      modIds: sc.modIds,
      modValues: sc.modValues ?? [],
    });
    tt.setDepth(450).setScrollFactor(0);
    const cam = scene.cameras.main;
    const tx = Math.max(6, Math.min(cam.width - 226, x + 20));
    const ty = Math.max(6, Math.min(cam.height - 180, y + 10));
    tt.setPosition(tx, ty);
    tooltip = tt;
  };

  const rebuildCards = () => {
    for (const c of cards) c?.container.destroy();
    cards = Array(20).fill(null);
    for (let i = 0; i < 20; i++) {
      const sc = data[i];
      if (!sc) continue;
      const c = slotCenter(i);
      const inset = slotW * CARD_ART_INSET_RATIO;
      const base = scene.add
        .image(0, 0, "card_sheet", rarityBaseFrame(sc.rarity))
        .setDisplaySize(slotW, slotH);
      const img = scene.add
        .image(0, 0, "card_sheet", cardFrameForLevel(sc.skill, sc.level))
        .setDisplaySize(slotW - inset * 2, slotH - inset * 2)
        .setAlpha(CARD_ART_ALPHA);
      const cdFill = scene.add
        .rectangle(0, 0, slotW, slotH, 0xffffff, 0.45)
        .setOrigin(0, 0)
        .setVisible(false);
      const cardContainer = scene.add
        .container(c.x, c.y, [base, img, cdFill])
        .setScrollFactor(0)
        .setDepth(402);
      cardContainer.setSize(slotW, slotH);
      cardContainer.setInteractive(
        new Phaser.Geom.Rectangle(
          -slotW / 2 - 6,
          -slotH / 2 - 6,
          slotW + 12,
          slotH + 12,
        ),
        Phaser.Geom.Rectangle.Contains,
      );
      cardContainer.on("pointerdown", () => {
        if (!cb.isDragFree()) return;
        if (cb.onDragStart) cb.onDragStart(i);
      });
      cardContainer.on("pointerover", () => {
        if (!cb.isDragFree()) return;
        showTooltip(sc, c.x, c.y);
      });
      cardContainer.on("pointerout", () => hideTooltip());
      cards[i] = {
        skill: sc.skill,
        container: cardContainer,
        base,
        img,
        cdFill,
        targetSlot: i,
        rarity: sc.rarity,
        modIds: sc.modIds,
        modValues: sc.modValues,
      };
    }
  };

  const slotCenter = (i: number) => {
    const r = slotRects[i];
    return {
      x: r.x + r.width / 2 + container.x,
      y: r.y + r.height / 2 + container.y,
    };
  };

  const syncFromState = () => {
    const fresh = cb.pullState();
    const same =
      data.length === fresh.length &&
      data.every((d, i) => {
        const f = fresh[i];
        if (!d && !f) return true;
        if (!d || !f) return false;
        return (
          d.skill === f.skill &&
          d.level === f.level &&
          d.rarity === f.rarity &&
          d.modIds.length === f.modIds.length &&
          d.modIds.every((m, j) => m === f.modIds[j])
        );
      });
    if (!same) {
      data = fresh;
      rebuildCards();
    }
  };

  const slotAtPointer = (p: Phaser.Input.Pointer) => {
    for (let i = 0; i < slotRects.length; i++) {
      const s = slotRects[i];
      const x = s.x + container.x;
      const y = s.y + container.y;
      if (
        p.x >= x &&
        p.x <= x + s.width &&
        p.y >= y - 10 &&
        p.y <= y + s.height + 10
      ) {
        return i;
      }
    }
    return -1;
  };

  const offX = PANEL_W + 60;
  let visible = false;
  const open = () => {
    syncFromState();
    container.setPosition(offX, 0).setVisible(true);
    scene.tweens.add({
      targets: container,
      x: 0,
      duration: 250,
      ease: "Cubic.Out",
      onComplete: () => {
        rebuildCards();
        overlay.setVisible(true).setAlpha(0);
        scene.tweens.add({
          targets: overlay,
          alpha: 0.6,
          duration: 200,
        });
      },
    });
    visible = true;
  };
  const close = () => {
    for (const c of cards) c?.container.destroy();
    cards = Array(20).fill(null);
    hideTooltip();
    scene.tweens.add({
      targets: container,
      x: offX,
      duration: 200,
      ease: "Cubic.In",
      onComplete: () => container.setVisible(false),
    });
    scene.tweens.add({
      targets: overlay,
      alpha: 0,
      duration: 200,
      onComplete: () => overlay.setVisible(false),
    });
    visible = false;
  };
  const toggle = () => (visible ? close() : open());
  scene.input.keyboard
    ?.addKey(Phaser.Input.Keyboard.KeyCodes.I)
    ?.on("down", toggle);
  scene.input.keyboard
    ?.addKey(Phaser.Input.Keyboard.KeyCodes.ESC)
    ?.on("down", () => {
      if (visible) close();
    });

  return {
    container,
    overlay,
    toggle,
    isVisible: () => visible,
    rebuildCards,
    syncFromState,
    slotAtPointer,
    slotCenter,
    hideTooltip,
    close,
    getData: () => data,
  };
}
