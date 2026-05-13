/**
 * Card HUD
 * ==============================
 * Renders the bottom-left HUD with:
 *   - HUD background image (hud.png), scaled down
 *   - Player HP bar (vertical, decreases top-to-bottom)
 *   - 5 card slots with base + skill overlays
 *   - Cooldown overlays (dark sweep from bottom)
 *
 * LAYOUT:
 *   Anchored to the BOTTOM-LEFT corner of the camera viewport.
 *   All element positions are computed relative to the HP bar
 *   position, so moving the HP bar moves everything.
 *
 * HOW IT WORKS:
 *   - CardSlotManager manages the state (which card in which slot)
 *   - CardHUD renders the visual representation each frame
 *   - The scene calls update() every frame for cooldown animations
 */

import Phaser from "phaser";
import {
  CardSlot,
  CardDefinition,
  CardActionContext,
  CardInputBinding,
} from "./CardTypes";
import { getCard } from "./CardRegistry";

// ============================================================
// LAYOUT CONFIGURATION
// ============================================================

/**
 * All layout values relative to the HP bar.
 *
 * HOW TO REPOSITION THE ENTIRE HUD:
 *   Change `hpBar.x` and `hpBar.y` — all other elements
 *   (cards, labels) are positioned relative to the HP bar.
 */
const HUD_LAYOUT = {
  /** Scale factor applied to the HUD background image */
  bgScale: 0.4,

  /** Padding from the bottom-left corner of the screen */
  marginLeft: 1,
  marginBottom: 8,

  /** Card display size */
  cardWidth: 59,
  cardHeight: 100,

  /** Gap between cards */
  cardGap: 3,

  /**
   * HP bar — the ANCHOR point for the entire HUD.
   * All other positions are offsets from the HP bar's top-left.
   */
  hpBar: {
    /** X position of HP bar top-left (screen coords) */
    x: 30,
    /** Y position of HP bar top-left (screen coords) */
    y: 30,
    width: 50,
    height: 120,
  },

  /**
   * Card row position, relative to HP bar top-left.
   * cardsX = hpBar.x + cardsRelativeX
   * cardsY = hpBar.y + cardsRelativeY
   */
  cardsRelativeX: 140,
  cardsRelativeY: 30,

  /**
   * HUD background position, relative to HP bar top-left.
   * bgX = hpBar.x + bgRelativeX
   * bgY = hpBar.y + bgRelativeY
   */
  bgRelativeX: -30,
  bgRelativeY: -38,
};

/**
 * Binding labels shown below each card slot.
 */
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

/**
 * Manages the 5 card slots: what card is equipped, cooldowns.
 */
export class CardSlotManager {
  slots: CardSlot[];

  constructor() {
    this.slots = [
      {
        card: null,
        binding: "leftClick",
        bindingLabel: "LMB",
        cooldown: { lastUsedTime: 0, cooldownMs: 0 },
      },
      {
        card: null,
        binding: "rightClick",
        bindingLabel: "RMB",
        cooldown: { lastUsedTime: 0, cooldownMs: 0 },
      },
      {
        card: null,
        binding: "space",
        bindingLabel: "SPC",
        cooldown: { lastUsedTime: 0, cooldownMs: 0 },
      },
      {
        card: null,
        binding: "key1",
        bindingLabel: "1",
        cooldown: { lastUsedTime: 0, cooldownMs: 0 },
      },
      {
        card: null,
        binding: "key2",
        bindingLabel: "2",
        cooldown: { lastUsedTime: 0, cooldownMs: 0 },
      },
    ];
  }

  equipCard(slotIndex: number, cardId: string): boolean {
    const card = getCard(cardId);
    if (!card) {
      console.warn(`CardHUD: Card "${cardId}" not found in registry.`);
      return false;
    }
    if (slotIndex < 0 || slotIndex >= this.slots.length) {
      console.warn(`CardHUD: Invalid slot index ${slotIndex}.`);
      return false;
    }
    this.slots[slotIndex].card = card;
    this.slots[slotIndex].cooldown.cooldownMs = card.cooldownMs;
    console.log(
      `CardHUD: Equipped "${card.label}" in slot ${slotIndex} (${this.slots[slotIndex].bindingLabel})`,
    );
    return true;
  }

  activateSlot(slotIndex: number, context: CardActionContext): boolean {
    if (slotIndex < 0 || slotIndex >= this.slots.length) return false;
    const slot = this.slots[slotIndex];
    if (!slot.card) return false;
    const now = performance.now();
    const elapsed = now - slot.cooldown.lastUsedTime;
    if (elapsed < slot.cooldown.cooldownMs) return false;
    const success = slot.card.performAction(context);
    if (success) {
      slot.cooldown.lastUsedTime = now;
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
    const now = performance.now();
    const elapsed = now - slot.cooldown.lastUsedTime;
    return Math.min(elapsed / slot.cooldown.cooldownMs, 1);
  }
}

// ============================================================
// CARD HUD (Visual Rendering)
// ============================================================

/**
 * Renders the card HUD on screen.
 * Create one instance per scene that needs the HUD.
 */
export class CardHUD {
  private scene: Phaser.Scene;
  private slotManager: CardSlotManager;

  // Visual elements
  private hudBg!: Phaser.GameObjects.Image;

  // Per-slot visuals
  private cardBaseSprites: Phaser.GameObjects.Image[] = [];
  private cardSkillSprites: Phaser.GameObjects.Image[] = [];
  private cooldownOverlays: Phaser.GameObjects.Graphics[] = [];
  private bindingLabels: Phaser.GameObjects.Text[] = [];
  private cardLabels: Phaser.GameObjects.Text[] = [];

  // HP bar
  private hpBarGraphics!: Phaser.GameObjects.Graphics;
  private hpText!: Phaser.GameObjects.Text;

  // Anchor: top-left of the HP bar in screen coords
  private anchorX: number = 0;
  private anchorY: number = 0;

  constructor(scene: Phaser.Scene, slotManager: CardSlotManager) {
    this.scene = scene;
    this.slotManager = slotManager;
    this.create();
  }

  /**
   * Compute the anchor point (top-left of HP bar) in screen coords.
   */
  private computeAnchor() {
    this.anchorX = HUD_LAYOUT.marginLeft + HUD_LAYOUT.hpBar.x;
    this.anchorY =
      this.scene.cameras.main.height -
      HUD_LAYOUT.marginBottom -
      HUD_LAYOUT.hpBar.height -
      HUD_LAYOUT.hpBar.y;
  }

  /**
   * Get the center position of a card slot in screen coords.
   * Relative to the HP bar anchor.
   */
  private getCardSlotCenter(index: number): { x: number; y: number } {
    const x =
      this.anchorX +
      HUD_LAYOUT.cardsRelativeX +
      index * (HUD_LAYOUT.cardWidth + HUD_LAYOUT.cardGap) +
      HUD_LAYOUT.cardWidth / 2;
    const y =
      this.anchorY + HUD_LAYOUT.cardsRelativeY + HUD_LAYOUT.cardHeight / 2;
    return { x, y };
  }

  /**
   * Build the HUD visuals. Call once after the scene is ready.
   */
  private create() {
    this.computeAnchor();

    // HUD background image — positioned relative to HP bar
    const bgX = this.anchorX + HUD_LAYOUT.bgRelativeX;
    const bgY = this.anchorY + HUD_LAYOUT.bgRelativeY;
    this.hudBg = this.scene.add.image(bgX, bgY, "hud_bg");
    this.hudBg.setOrigin(0, 0).setScrollFactor(0).setDepth(90);
    this.hudBg.setScale(HUD_LAYOUT.bgScale);

    // HP bar graphics
    this.hpBarGraphics = this.scene.add.graphics();
    this.hpBarGraphics.setScrollFactor(0).setDepth(95);

    // HP text
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

    // Create card slots
    for (let i = 0; i < 5; i++) {
      const { x, y } = this.getCardSlotCenter(i);

      // Card base sprite
      const baseSprite = this.scene.add
        .image(x, y, "card_base")
        .setDisplaySize(HUD_LAYOUT.cardWidth, HUD_LAYOUT.cardHeight)
        .setScrollFactor(0)
        .setDepth(95);

      // Skill overlay sprite
      const skillSprite = this.scene.add
        .image(x, y, "card_locked")
        .setDisplaySize(HUD_LAYOUT.cardWidth - 6, HUD_LAYOUT.cardHeight - 6)
        .setScrollFactor(0)
        .setDepth(96);

      // Cooldown overlay
      const cooldownGfx = this.scene.add.graphics();
      cooldownGfx.setScrollFactor(0).setDepth(97);

      // Binding label (below card)
      const bindLabel = this.scene.add
        .text(
          x,
          y + HUD_LAYOUT.cardHeight / 2 + 6,
          BINDING_LABELS[this.slotManager.slots[i].binding],
          {
            color: "#aaaaaa",
            fontSize: "8px",
            fontFamily: "Georgia",
            stroke: "#000000",
            strokeThickness: 2,
          },
        )
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(95);

      // Card label (on card)
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
  }

  /**
   * Update visuals each frame.
   */
  update(hp: number, maxHp: number) {
    this.updateHpBar(hp, maxHp);
    this.updateCooldowns();
    this.updateCardVisuals();
  }

  /**
   * Update the HP bar fill.
   * Vertical bar: fill from BOTTOM, decreases toward TOP.
   * Color: #7a2127
   */
  private updateHpBar(hp: number, maxHp: number) {
    const barX = this.anchorX;
    const barY = this.anchorY;
    const barWidth = HUD_LAYOUT.hpBar.width;
    const barHeight = HUD_LAYOUT.hpBar.height;

    this.hpBarGraphics.clear();

    // Background (dark bar showing max HP area)
    this.hpBarGraphics.fillStyle(0x333333, 0.8);
    this.hpBarGraphics.fillRect(barX, barY, barWidth, barHeight);

    // HP fill: starts at BOTTOM, fills upward
    // As HP decreases, the fill shrinks from the TOP
    const hpPercent = Math.max(0, hp / maxHp);
    const fillHeight = barHeight * hpPercent;
    const fillY = barY + barHeight - fillHeight; // anchor to bottom

    this.hpBarGraphics.fillStyle(0x7a2127, 1); // #7a2127
    this.hpBarGraphics.fillRect(barX, fillY, barWidth, fillHeight);

    // Border
    this.hpBarGraphics.lineStyle(1, 0x666666, 0.8);
    this.hpBarGraphics.strokeRect(barX, barY, barWidth, barHeight);

    // HP text — centered in the bar
    this.hpText.setPosition(barX + barWidth / 2, barY + barHeight / 2);
    this.hpText.setText(`${Math.ceil(hp)}/${maxHp}`);
  }

  /**
   * Update cooldown overlays for all card slots.
   */
  private updateCooldowns() {
    for (let i = 0; i < 5; i++) {
      const slot = this.slotManager.slots[i];
      const overlay = this.cooldownOverlays[i];
      overlay.clear();

      if (!slot.card) continue;

      const progress = this.slotManager.getCooldownProgress(i);
      if (progress >= 1) continue;

      // Draw dark overlay from top down (unfilled portion)
      const { x: cx, y: cy } = this.getCardSlotCenter(i);
      const halfW = HUD_LAYOUT.cardWidth / 2;
      const halfH = HUD_LAYOUT.cardHeight / 2;

      const overlayHeight = HUD_LAYOUT.cardHeight * (1 - progress);
      overlay.fillStyle(0x000000, 0.6);
      overlay.fillRect(
        cx - halfW,
        cy - halfH,
        HUD_LAYOUT.cardWidth,
        overlayHeight,
      );
    }
  }

  /**
   * Update card visuals based on equipped cards.
   */
  private updateCardVisuals() {
    for (let i = 0; i < 5; i++) {
      const slot = this.slotManager.slots[i];
      const skillSprite = this.cardSkillSprites[i];
      const cardLabel = this.cardLabels[i];
      const baseSprite = this.cardBaseSprites[i];

      if (slot.card) {
        skillSprite.setTexture(slot.card.skillImageKey);
        cardLabel.setText(slot.card.label);
        baseSprite.setAlpha(1);
      } else {
        skillSprite.setTexture("card_locked");
        cardLabel.setText("");
        baseSprite.setAlpha(0.5);
      }
    }
  }

  /**
   * Destroy all HUD visual elements.
   */
  destroy() {
    this.hudBg.destroy();
    this.hpBarGraphics.destroy();
    this.hpText.destroy();
    for (let i = 0; i < 5; i++) {
      this.cardBaseSprites[i]?.destroy();
      this.cardSkillSprites[i]?.destroy();
      this.cooldownOverlays[i].destroy();
      this.bindingLabels[i].destroy();
      this.cardLabels[i].destroy();
    }
  }
}
