/**
 * Card Registry
 * ==============================
 * Central registry of all available cards in the game.
 *
 * HOW TO ADD A NEW CARD:
 *   1. Add the skill image to `client/public/assets/cards/skillCards/`
 *   2. Add a preload entry in `SceneSelector.preload()`
 *   3. Add a new card definition below using `registerCard()`
 *   4. Equip it in a slot via `CardSlotManager.equipCard()`
 *
 * SERVER MESSAGE TYPES:
 *   - Message 5: Generic skill activation — sends { skillId, x?, y? }
 *   The server looks up the skillId and activates it. This means any card
 *   can go in any slot and still work correctly.
 */

import { CardDefinition, CardActionContext } from "./CardTypes";

// ============================================================
// REGISTRY
// ============================================================

const registry: Map<string, CardDefinition> = new Map();

/**
 * Register a card definition. Call this during initialization.
 */
export function registerCard(card: CardDefinition): void {
  registry.set(card.id, card);
}

/**
 * Get a card definition by ID.
 */
export function getCard(id: string): CardDefinition | undefined {
  return registry.get(id);
}

/**
 * Get all registered card IDs.
 */
export function getAllCardIds(): string[] {
  return Array.from(registry.keys());
}

// ============================================================
// CARD DEFINITIONS
// ============================================================

/**
 * Bolt Gun Card
 * -------------
 * Fires a bolter round toward the mouse cursor.
 */
registerCard({
  id: "bolt_gun",
  skillId: "boltershot",
  label: "Bolter",
  baseImageKey: "card_base",
  skillImageKey: "card_skill_boltgun",
  cooldownMs: 500,
  requiresPointer: true,
  performAction: (context: CardActionContext): boolean => {
    const { pointer, room } = context;
    if (!pointer) return false;
    room.send(5, {
      skillId: "boltershot",
      x: pointer.worldX,
      y: pointer.worldY,
    });
    return true;
  },
});

/**
 * Pulse Card
 * ----------
 * Close-combat AoE shockwave expanding from the player.
 */
registerCard({
  id: "pulse",
  skillId: "pulse",
  label: "Pulse",
  baseImageKey: "card_base",
  skillImageKey: "card_skill_pulse",
  cooldownMs: 3000,
  performAction: (context: CardActionContext): boolean => {
    const { scene, room, player } = context;
    if (!player) return false;

    room.send(5, { skillId: "pulse" });

    // ---- Client-side VFX ----
    const px = player.x;
    const py = player.y;
    const maxRadius = 100;

    const pulseCircle = scene.add.circle(px, py, 4, 0x66ccff, 0.7).setDepth(6);
    scene.tweens.add({
      targets: pulseCircle,
      scaleX: maxRadius / 4,
      scaleY: maxRadius / 4,
      alpha: 0,
      duration: 300,
      ease: "Cubic.easeOut",
      onComplete: () => pulseCircle.destroy(),
    });

    const ring = scene.add.circle(px, py, 8, 0x66ccff, 0.0)
      .setStrokeStyle(2, 0x99eeff, 0.8)
      .setDepth(6);
    scene.tweens.add({
      targets: ring,
      scaleX: maxRadius / 8,
      scaleY: maxRadius / 8,
      alpha: 0,
      duration: 400,
      ease: "Cubic.easeOut",
      onComplete: () => ring.destroy(),
    });

    const flash = scene.add.rectangle(
      scene.cameras.main.worldView.centerX,
      scene.cameras.main.worldView.centerY,
      scene.cameras.main.width,
      scene.cameras.main.height,
      0x66ccff,
      0.15,
    ).setScrollFactor(0).setDepth(99);
    scene.tweens.add({
      targets: flash,
      alpha: 0,
      duration: 150,
      ease: "Quad.easeOut",
      onComplete: () => flash.destroy(),
    });

    return true;
  },
});

/**
 * Heal Card
 * ---------
 * Restores 300 HP to the player.
 * Kill-based cooldown: must kill 6 enemies before reuse.
 */
registerCard({
  id: "heal",
  skillId: "heal",
  label: "+300 HP",
  baseImageKey: "card_base",
  skillImageKey: "card_skill_heal",
  cooldownMs: 0,
  cooldownMode: "kills",
  killsRequired: 6,
  performAction: (context: CardActionContext): boolean => {
    const { scene, room, player } = context;
    if (!player) return false;

    room.send(5, { skillId: "heal" });

    // ---- Client-side green heal VFX ----
    const px = player.x;
    const py = player.y;

    const healCircle = scene.add.circle(px, py, 10, 0x00ff44, 0.6).setDepth(6);
    scene.tweens.add({
      targets: healCircle,
      scaleX: 8,
      scaleY: 8,
      alpha: 0,
      duration: 500,
      ease: "Cubic.easeOut",
      onComplete: () => healCircle.destroy(),
    });

    const healRing = scene.add.circle(px, py, 12, 0x00ff44, 0.0)
      .setStrokeStyle(3, 0x44ff88, 0.9)
      .setDepth(6);
    scene.tweens.add({
      targets: healRing,
      scaleX: 6,
      scaleY: 6,
      alpha: 0,
      duration: 600,
      ease: "Cubic.easeOut",
      onComplete: () => healRing.destroy(),
    });

    const flash = scene.add.rectangle(
      scene.cameras.main.worldView.centerX,
      scene.cameras.main.worldView.centerY,
      scene.cameras.main.width,
      scene.cameras.main.height,
      0x00ff44,
      0.2,
    ).setScrollFactor(0).setDepth(99);
    scene.tweens.add({
      targets: flash,
      alpha: 0,
      duration: 300,
      ease: "Quad.easeOut",
      onComplete: () => flash.destroy(),
    });

    return true;
  },
});

/**
 * Vortex Card
 * -----------
 * Pulls all nearby enemies toward the player.
 * Radius is 2x the Pulse skill.
 */
registerCard({
  id: "vortex",
  skillId: "vortex",
  label: "Vortex",
  baseImageKey: "card_base",
  skillImageKey: "card_skill_vortex",
  cooldownMs: 8000,
  performAction: (context: CardActionContext): boolean => {
    const { scene, room, player } = context;
    if (!player) return false;

    room.send(5, { skillId: "vortex" });

    // ---- Client-side VFX ----
    const px = player.x;
    const py = player.y;
    const maxRadius = 200;

    const swirl = scene.add.graphics().setDepth(4);
    swirl.fillStyle(0x9933ff, 0.15);
    swirl.fillCircle(px, py, maxRadius);
    swirl.lineStyle(3, 0xcc66ff, 0.8);
    swirl.strokeCircle(px, py, maxRadius);

    scene.tweens.add({
      targets: swirl,
      alpha: 0,
      scale: 0.7,
      duration: 1500,
      ease: "Power2",
      onComplete: () => swirl.destroy(),
    });

    return true;
  },
});

// ============================================================
// ADD MORE CARDS HERE
// ============================================================
