/**
 * Card HUD
 * ==============================
 * Renders the bottom-left HUD with:
 *   - HUD background image (hud.png), scaled down
 *   - Player HP bar (vertical, decreases top-to-bottom)
 *   - 5 card slots with base + skill overlays
 *   - Cooldown overlays (dark sweep from bottom)
 *   - Drag-and-drop: drag cards between slots, or drag out to drop
 */

import Phaser from "phaser";
import {
  CardSlot,
  CardActionContext,
  CardInputBinding,
} from "./CardTypes";
import { getCard } from "./CardRegistry";

// ============================================================
// LAYOUT CONFIGURATION
// ============================================================

const HUD_LAYOUT = {
  bgScale: 0.4,
  marginLeft: 1,
  marginBottom: 8,
  cardWidth: 59,
  cardHeight: 100,
  cardGap: 3,
  hpBar: {
    x: 30,
    y: 30,
    width: 50,
    height: 120,
  },
  cardsRelativeX: 140,
  cardsRelativeY: 30,
  bgRelativeX: -30,
  bgRelativeY: -38,
};

const BINDING_LABELS: Record<CardInputBinding, string> = {
  leftClick: "LMB",
  rightClick: "RMB",
  space: "SPC",
  key1: "1",
  key2: "2",
};

// ============================================================
// CARD SLOT MANAGER (State)
// ============================================================

export class CardSlotManager {
  slots: CardSlot[];

  constructor() {
    this.slots = [
      { card: null, binding: "leftClick", bindingLabel: "LMB", cooldown: { lastUsedTime: 0, cooldownMs: 0, currentKills: 0, killsRequired: 0 } },
      { card: null, binding: "rightClick", bindingLabel: "RMB", cooldown: { lastUsedTime: 0, cooldownMs: 0, currentKills: 0, killsRequired: 0 } },
      { card: null, binding: "space", bindingLabel: "SPC", cooldown: { lastUsedTime: 0, cooldownMs: 0, currentKills: 0, killsRequired: 0 } },
      { card: null, binding: "key1", bindingLabel: "1", cooldown: { lastUsedTime: 0, cooldownMs: 0, currentKills: 0, killsRequired: 0 } },
      { card: null, binding: "key2", bindingLabel: "2", cooldown: { lastUsedTime: 0, cooldownMs: 0, currentKills: 0, killsRequired: 0 } },
    ];
  }

  equipCard(slotIndex: number, cardId: string): boolean {
    const card = getCard(cardId);
    if (!card) return false;
    if (slotIndex < 0 || slotIndex >= this.slots.length) return false;
    this.slots[slotIndex].card = card;
    this.slots[slotIndex].cooldown.cooldownMs = card.cooldownMs;
    if (card.killsRequired) {
      this.slots[slotIndex].cooldown.killsRequired = card.killsRequired;
    }
    return true;
  }

  unequipCard(slotIndex: number): string | null {
    if (slotIndex < 0 || slotIndex >= this.slots.length) return null;
    const card = this.slots[slotIndex].card;
    if (!card) return null;
    this.slots[slotIndex].card = null;
    this.slots[slotIndex].cooldown = { lastUsedTime: 0, cooldownMs: 0, currentKills: 0, killsRequired: 0 };
    return card.id;
  }

  swapCards(slotA: number, slotB: number): void {
    if (slotA < 0 || slotA >= this.slots.length) return;
    if (slotB < 0 || slotB >= this.slots.length) return;
    // Swap both the card AND its cooldown config so they stay in sync
    const tmpCard = this.slots[slotA].card;
    const tmpCd = this.slots[slotA].cooldown;
    this.slots[slotA].card = this.slots[slotB].card;
    this.slots[slotA].cooldown = this.slots[slotB].cooldown;
    this.slots[slotB].card = tmpCard;
    this.slots[slotB].cooldown = tmpCd;
  }

  /**
   * Place a card into a slot, replacing whatever is there.
   * Returns the old card id (or null if slot was empty).
   */
  placeCardInSlot(slotIndex: number, cardId: string): string | null {
    if (slotIndex < 0 || slotIndex >= this.slots.length) return null;
    const oldCardId = this.slots[slotIndex].card?.id ?? null;
    this.equipCard(slotIndex, cardId);
    return oldCardId;
  }

  getCardIdInSlot(slotIndex: number): string | null {
    if (slotIndex < 0 || slotIndex >= this.slots.length) return null;
    return this.slots[slotIndex].card?.id ?? null;
  }

  activateSlot(slotIndex: number, context: CardActionContext): boolean {
    if (slotIndex < 0 || slotIndex >= this.slots.length) return false;
    const slot = this.slots[slotIndex];
    if (!slot.card) return false;

    if (slot.card.cooldownMode === "kills") {
      if (slot.cooldown.currentKills < slot.cooldown.killsRequired) return false;
    } else {
      const now = performance.now();
      const elapsed = now - slot.cooldown.lastUsedTime;
      if (elapsed < slot.cooldown.cooldownMs) return false;
    }

    const success = slot.card.performAction(context);
    if (success) {
      if (slot.card.cooldownMode === "kills") {
        slot.cooldown.currentKills = 0;
      }
      slot.cooldown.lastUsedTime = performance.now();
    }
    return success;
  }

  getSlotByBinding(binding: CardInputBinding): number {
    return this.slots.findIndex((s) => s.binding === binding);
  }

  getCooldownProgress(slotIndex: number): number {
    if (slotIndex < 0 || slotIndex >= this.slots.length) return 1;
    const slot = this.slots[slotIndex];
    if (!slot.card) return 1;
    if (slot.card.cooldownMode === "kills" && slot.cooldown.killsRequired > 0) {
      return Math.min(slot.cooldown.currentKills / slot.cooldown.killsRequired, 1);
    }
    const now = performance.now();
    const elapsed = now - slot.cooldown.lastUsedTime;
    return Math.min(elapsed / slot.cooldown.cooldownMs, 1);
  }

  updateKillsForSlot(slotIndex: number, kills: number): void {
    if (slotIndex < 0 || slotIndex >= this.slots.length) return;
    this.slots[slotIndex].cooldown.currentKills = kills;
  }
}

// ============================================================
// CARD HUD (Visual Rendering + Drag-and-Drop)
// ============================================================

export class CardHUD {
  private scene: Phaser.Scene;
  private slotManager: CardSlotManager;

  private hudBg!: Phaser.GameObjects.Image;
  private cardBaseSprites: Phaser.GameObjects.Image[] = [];
  private cardSkillSprites: Phaser.GameObjects.Image[] = [];
  private cooldownOverlays: Phaser.GameObjects.Graphics[] = [];
  private bindingLabels: Phaser.GameObjects.Text[] = [];
  private cardLabels: Phaser.GameObjects.Text[] = [];
  private hpBarGraphics!: Phaser.GameObjects.Graphics;
  private hpText!: Phaser.GameObjects.Text;

  private anchorX: number = 0;
  private anchorY: number = 0;

  // Drag-and-drop state
  private draggingSlot: number = -1;
  private dragGhost: Phaser.GameObjects.Image | null = null;
  /** Called when the user drops a card outside any slot (to drop on ground) */
  public onCardDropToGround?: (slotIndex: number) => void;

  // Equip-mode state
  private equipMode: boolean = false;
  private equipCardId: string | null = null;
  private equipPlusIcons: Phaser.GameObjects.Text[] = [];
  /** Called when user clicks a slot during equip mode */
  public onCardEquipped?: (cardId: string, slotIndex: number) => void;

  constructor(scene: Phaser.Scene, slotManager: CardSlotManager) {
    this.scene = scene;
    this.slotManager = slotManager;
    this.create();
  }

  private computeAnchor() {
    this.anchorX = HUD_LAYOUT.marginLeft + HUD_LAYOUT.hpBar.x;
    this.anchorY =
      this.scene.cameras.main.height -
      HUD_LAYOUT.marginBottom -
      HUD_LAYOUT.hpBar.height -
      HUD_LAYOUT.hpBar.y;
  }

  getCardSlotCenter(index: number): { x: number; y: number } {
    const x =
      this.anchorX +
      HUD_LAYOUT.cardsRelativeX +
      index * (HUD_LAYOUT.cardWidth + HUD_LAYOUT.cardGap) +
      HUD_LAYOUT.cardWidth / 2;
    const y = this.anchorY + HUD_LAYOUT.cardsRelativeY + HUD_LAYOUT.cardHeight / 2;
    return { x, y };
  }

  private create() {
    this.computeAnchor();

    const bgX = this.anchorX + HUD_LAYOUT.bgRelativeX;
    const bgY = this.anchorY + HUD_LAYOUT.bgRelativeY;
    this.hudBg = this.scene.add.image(bgX, bgY, "hud_bg");
    this.hudBg.setOrigin(0, 0).setScrollFactor(0).setDepth(90);
    this.hudBg.setScale(HUD_LAYOUT.bgScale);

    this.hpBarGraphics = this.scene.add.graphics();
    this.hpBarGraphics.setScrollFactor(0).setDepth(95);

    this.hpText = this.scene.add
      .text(0, 0, "", {
        color: "#ffffff",
        fontSize: "9px",
        fontFamily: "Georgia",
        stroke: "#000000",
        strokeThickness: 2,
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(95);

    for (let i = 0; i < 5; i++) {
      const { x, y } = this.getCardSlotCenter(i);

      const baseSprite = this.scene.add
        .image(x, y, "card_base")
        .setDisplaySize(HUD_LAYOUT.cardWidth, HUD_LAYOUT.cardHeight)
        .setScrollFactor(0)
        .setDepth(95);

      const skillSprite = this.scene.add
        .image(x, y, "card_locked")
        .setDisplaySize(HUD_LAYOUT.cardWidth - 6, HUD_LAYOUT.cardHeight - 6)
        .setScrollFactor(0)
        .setDepth(96)
        .setInteractive({ useHandCursor: true });

      skillSprite.setData("slotIndex", i);
      this.scene.input.setDraggable(skillSprite);

      const cooldownGfx = this.scene.add.graphics();
      cooldownGfx.setScrollFactor(0).setDepth(97);

      const bindLabel = this.scene.add
        .text(x, y + HUD_LAYOUT.cardHeight / 2 + 6, BINDING_LABELS[this.slotManager.slots[i].binding], {
          color: "#aaaaaa",
          fontSize: "8px",
          fontFamily: "Georgia",
          stroke: "#000000",
          strokeThickness: 2,
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(95);

      const cardLabel = this.scene.add
        .text(x, y + HUD_LAYOUT.cardHeight / 2 - 6, "", {
          color: "#efbf68",
          fontSize: "7px",
          fontFamily: "Georgia",
          stroke: "#000000",
          strokeThickness: 2,
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(98);

      this.cardBaseSprites.push(baseSprite);
      this.cardSkillSprites.push(skillSprite);
      this.cooldownOverlays.push(cooldownGfx);
      this.bindingLabels.push(bindLabel);
      this.cardLabels.push(cardLabel);
    }

    // Register global drag handlers once
    this.scene.input.on("dragstart", (_pointer: Phaser.Input.Pointer, gameObject: Phaser.GameObjects.Image) => {
      if (!gameObject.data || gameObject.data.get("slotIndex") === undefined) return;
      const slotIdx = gameObject.data.get("slotIndex") as number;
      if (!this.slotManager.slots[slotIdx].card) return;

      this.draggingSlot = slotIdx;
      const card = this.slotManager.slots[slotIdx].card!;
      this.dragGhost = this.scene.add
        .image(_pointer.x, _pointer.y, card.skillImageKey)
        .setDisplaySize(HUD_LAYOUT.cardWidth, HUD_LAYOUT.cardHeight)
        .setScrollFactor(0)
        .setDepth(300)
        .setAlpha(0.8);
    });

    this.scene.input.on("drag", (pointer: Phaser.Input.Pointer) => {
      if (this.dragGhost) {
        this.dragGhost.x = pointer.x;
        this.dragGhost.y = pointer.y;
      }
    });

    this.scene.input.on("dragend", (pointer: Phaser.Input.Pointer) => {
      if (this.draggingSlot < 0) return;

      let targetSlot = -1;
      for (let si = 0; si < 5; si++) {
        const c = this.getCardSlotCenter(si);
        const halfW = HUD_LAYOUT.cardWidth / 2;
        const halfH = HUD_LAYOUT.cardHeight / 2;
        if (
          pointer.x >= c.x - halfW && pointer.x <= c.x + halfW &&
          pointer.y >= c.y - halfH && pointer.y <= c.y + halfH
        ) {
          targetSlot = si;
          break;
        }
      }

      if (targetSlot >= 0 && targetSlot !== this.draggingSlot) {
        this.slotManager.swapCards(this.draggingSlot, targetSlot);
      } else if (targetSlot < 0) {
        if (this.onCardDropToGround) {
          this.onCardDropToGround(this.draggingSlot);
        }
      }

      if (this.dragGhost) {
        this.dragGhost.destroy();
        this.dragGhost = null;
      }
      this.draggingSlot = -1;
    });
  }

  update(hp: number, maxHp: number) {
    this.updateHpBar(hp, maxHp);
    this.updateCooldowns();
    this.updateCardVisuals();
  }

  private updateHpBar(hp: number, maxHp: number) {
    const barX = this.anchorX;
    const barY = this.anchorY;
    const barWidth = HUD_LAYOUT.hpBar.width;
    const barHeight = HUD_LAYOUT.hpBar.height;

    this.hpBarGraphics.clear();
    this.hpBarGraphics.fillStyle(0x333333, 0.8);
    this.hpBarGraphics.fillRect(barX, barY, barWidth, barHeight);

    const hpPercent = Math.max(0, hp / maxHp);
    const fillHeight = barHeight * hpPercent;
    const fillY = barY + barHeight - fillHeight;

    this.hpBarGraphics.fillStyle(0x7a2127, 1);
    this.hpBarGraphics.fillRect(barX, fillY, barWidth, fillHeight);

    this.hpBarGraphics.lineStyle(1, 0x666666, 0.8);
    this.hpBarGraphics.strokeRect(barX, barY, barWidth, barHeight);

    this.hpText.setPosition(barX + barWidth / 2, barY + barHeight / 2);
    this.hpText.setText(`${Math.ceil(hp)}/${maxHp}`);
  }

  private updateCooldowns() {
    for (let i = 0; i < 5; i++) {
      const slot = this.slotManager.slots[i];
      const overlay = this.cooldownOverlays[i];
      overlay.clear();
      if (!slot.card) continue;

      const progress = this.slotManager.getCooldownProgress(i);
      if (progress >= 1) continue;

      const { x: cx, y: cy } = this.getCardSlotCenter(i);
      const halfW = HUD_LAYOUT.cardWidth / 2;
      const halfH = HUD_LAYOUT.cardHeight / 2;

      const overlayHeight = HUD_LAYOUT.cardHeight * (1 - progress);
      overlay.fillStyle(0x000000, 0.6);
      overlay.fillRect(cx - halfW, cy - halfH, HUD_LAYOUT.cardWidth, overlayHeight);
    }
  }

  private updateCardVisuals() {
    for (let i = 0; i < 5; i++) {
      const slot = this.slotManager.slots[i];
      const skillSprite = this.cardSkillSprites[i];
      const cardLabel = this.cardLabels[i];
      const baseSprite = this.cardBaseSprites[i];

      if (slot.card) {
        skillSprite.setTexture(slot.card.skillImageKey);
        baseSprite.setAlpha(1);

        if (slot.card.cooldownMode === "kills" && slot.cooldown.killsRequired > 0) {
          const kills = slot.cooldown.currentKills;
          const required = slot.cooldown.killsRequired;
          if (kills >= required) {
            cardLabel.setText(slot.card.label);
          } else {
            cardLabel.setText(`${kills}/${required}`);
          }
        } else {
          cardLabel.setText(slot.card.label);
        }
      } else {
        skillSprite.setTexture("card_locked");
        cardLabel.setText("");
        baseSprite.setAlpha(0.5);
      }
    }
  }

  /**
   * Enter equip mode: show + icons on all slots for the given card.
   * Clicking a slot equips the card there (dropping the old one if any).
   */
  enterEquipMode(cardId: string): void {
    this.equipMode = true;
    this.equipCardId = cardId;

    // Create + icons on each slot
    for (let i = 0; i < 5; i++) {
      const { x, y } = this.getCardSlotCenter(i);
      const plus = this.scene.add
        .text(x, y, "+", {
          color: "#00ff00",
          fontSize: "28px",
          fontFamily: "Georgia",
          fontStyle: "bold",
          stroke: "#000000",
          strokeThickness: 3,
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(200)
        .setInteractive({ useHandCursor: true });

      plus.on("pointerdown", () => {
        if (!this.equipMode || !this.equipCardId) return;
        this.onCardEquipped?.(this.equipCardId, i);
        this.exitEquipMode();
      });

      this.equipPlusIcons.push(plus);
    }
  }

  /** Exit equip mode: remove all + icons */
  exitEquipMode(): void {
    this.equipMode = false;
    this.equipCardId = null;
    for (const p of this.equipPlusIcons) {
      p.destroy();
    }
    this.equipPlusIcons = [];
  }

  // ============================================================
  // DROP INDICATORS (shown when dragging a loot card to equip)
  // ============================================================

  private dropIndicators: Phaser.GameObjects.Text[] = [];

  /**
   * Show "+" indicators on all card slots, signaling the user can drop
   * a card here to equip it.
   */
  showDropIndicators(): void {
    // Create if not yet created
    if (this.dropIndicators.length === 0) {
      for (let i = 0; i < 5; i++) {
        const { x, y } = this.getCardSlotCenter(i);
        const plus = this.scene.add
          .text(x, y, "+", {
            color: "#00ff00",
            fontSize: "32px",
            fontFamily: "Georgia",
            fontStyle: "bold",
            stroke: "#000000",
            strokeThickness: 3,
          })
          .setOrigin(0.5)
          .setScrollFactor(0)
          .setDepth(250)
          .setAlpha(0);
        this.dropIndicators.push(plus);
      }
    }
    for (const ind of this.dropIndicators) {
      ind.setAlpha(0.7);
    }
  }

  /**
   * Hide the "+" indicators.
   */
  hideDropIndicators(): void {
    for (const ind of this.dropIndicators) {
      ind.setAlpha(0);
    }
  }

  /**
   * Check if the pointer (screen coords) is over a card slot.
   * Returns the slot index (0-4) or -1 if not over any slot.
   */
  isPointerOverSlot(screenX: number, screenY: number): number {
    for (let i = 0; i < 5; i++) {
      const c = this.getCardSlotCenter(i);
      const halfW = HUD_LAYOUT.cardWidth / 2;
      const halfH = HUD_LAYOUT.cardHeight / 2;
      if (
        screenX >= c.x - halfW && screenX <= c.x + halfW &&
        screenY >= c.y - halfH && screenY <= c.y + halfH
      ) {
        return i;
      }
    }
    return -1;
  }

  destroy() {
    this.hudBg.destroy();
    this.hpBarGraphics.destroy();
    this.hpText.destroy();
    for (const ind of this.dropIndicators) {
      ind.destroy();
    }
    for (let i = 0; i < 5; i++) {
      this.cardBaseSprites[i]?.destroy();
      this.cardSkillSprites[i]?.destroy();
      this.cooldownOverlays[i].destroy();
      this.bindingLabels[i].destroy();
      this.cardLabels[i].destroy();
    }
  }
}
