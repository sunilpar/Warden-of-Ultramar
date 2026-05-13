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
 * CARD IMAGES:
 *   - Base images: `assets/cards/base.png`, `assets/cards/rareBase.png`, etc.
 *   - Skill images: `assets/cards/skillCards/boltGun.png`, etc.
 *
 * SERVER MESSAGE TYPES:
 *   Each card's performAction sends the appropriate message type to the server:
 *   - Message 2: Shoot (bolter) — sends { x, y } mouse world position
 *   - Message 3: Pulse — no data needed
 *   - Add more as you add cards
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
 * Bound to Left Click by default.
 * Server message type: 2, payload: { x, y }
 */
registerCard({
  id: "bolt_gun",
  label: "Bolter",
  baseImageKey: "card_base",
  skillImageKey: "card_skill_boltgun",
  cooldownMs: 500,
  performAction: (context: CardActionContext): boolean => {
    const { pointer, room } = context;
    if (!pointer) return false;

    room.send(2, { x: pointer.worldX, y: pointer.worldY });
    return true;
  },
});

/**
 * Pulse Card
 * ----------
 * Close-combat AoE shockwave expanding from the player.
 * Bound to Right Click by default.
 * Server message type: 3
 *
 * CLIENT-SIDE VFX:
 *   - Skyblue expanding circle with fade
 *   - Slight camera shake for the local player
 *   - Ring effect at max radius
 */
registerCard({
  id: "pulse",
  label: "Pulse",
  baseImageKey: "card_base",
  skillImageKey: "card_skill_pulse",
  cooldownMs: 3000,
  performAction: (context: CardActionContext): boolean => {
    const { scene, room, player } = context;
    if (!player) return false;

    // Send pulse request to server
    room.send(3);

    // ---- Client-side VFX ----
    const px = player.x;
    const py = player.y;
    const maxRadius = 100;

    // Main expanding skyblue circle
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

    // Outer ring effect
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

    // Subtle screen flash instead of camera shake
    // (shake can desync physics body when camera has setBounds)
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

// ============================================================
// ADD MORE CARDS HERE
// ============================================================
// Copy the registerCard({ ... }) pattern above.
// Each card needs: id, label, baseImageKey, skillImageKey, cooldownMs, performAction.
