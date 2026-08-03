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
 * VFX (electricity arcs) handled by skill effect handler in GameScene.
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

    // Subtle screen flash
    const flash = scene.add.rectangle(
      scene.cameras.main.worldView.centerX,
      scene.cameras.main.worldView.centerY,
      scene.cameras.main.width,
      scene.cameras.main.height,
      0x66ccff,
      0.1,
    ).setScrollFactor(0).setDepth(99);
    scene.tweens.add({
      targets: flash,
      alpha: 0,
      duration: 200,
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
 * VFX (green tint on sprite) handled by skill effect handler in GameScene.
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
    const { room, player } = context;
    if (!player) return false;

    room.send(5, { skillId: "heal" });

    // Heal VFX is handled by the skill effect handler (green tint on sprite)
    return true;
  },
});

/**
 * Vortex Card
 * -----------
 * Pulls all nearby enemies toward the player.
 * VFX (hurricane animation) handled by skill effect handler in GameScene.
 */
registerCard({
  id: "vortex",
  skillId: "vortex",
  label: "Vortex",
  baseImageKey: "card_base",
  skillImageKey: "card_skill_vortex",
  cooldownMs: 8000,
  performAction: (context: CardActionContext): boolean => {
    const { room, player } = context;
    if (!player) return false;

    room.send(5, { skillId: "vortex" });

    // Vortex VFX is handled by the skill effect handler (hurricane animation)
    return true;
  },
});

/**
 * Claw Card
 * ---------
 * Melee cone attack. Damages all enemies in a cone in front of the player.
 * Uses sword.png art.
 */
registerCard({
  id: "claw",
  skillId: "claw",
  label: "Claw",
  baseImageKey: "card_base",
  skillImageKey: "card_skill_sword",
  cooldownMs: 800,
  requiresPointer: true,
  performAction: (context: CardActionContext): boolean => {
    const { pointer, room } = context;
    if (!pointer) return false;
    room.send(5, {
      skillId: "claw",
      x: pointer.worldX,
      y: pointer.worldY,
    });
    return true;
  },
});

/**
 * Blink Card
 * ----------
 * Teleport 100px in facing direction + brief invincibility.
 * Uses ice.png art.
 */
registerCard({
  id: "blink",
  skillId: "blink",
  label: "Blink",
  baseImageKey: "card_base",
  skillImageKey: "card_skill_blink",
  cooldownMs: 6000,
  performAction: (context: CardActionContext): boolean => {
    const { room, player, facingDir } = context;
    if (!player) return false;
    // Send target position = player position + facing direction * 100
    room.send(5, {
      skillId: "blink",
      x: player.x + (facingDir?.x ?? 1) * 100,
      y: player.y + (facingDir?.y ?? 0) * 100,
    });

    // Client-side VFX: brief ice flash at player position
    const scene = context.scene;
    const flash = scene.add.circle(player.x, player.y, 15, 0x99ddff, 0.6).setDepth(6);
    scene.tweens.add({
      targets: flash,
      scaleX: 3,
      scaleY: 3,
      alpha: 0,
      duration: 300,
      ease: "Cubic.easeOut",
      onComplete: () => flash.destroy(),
    });
    return true;
  },
});

// ============================================================
// ADD MORE CARDS HERE
// ============================================================
