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

// ============================================================
// ADD MORE CARDS HERE
// ============================================================
// Example:
//
// registerCard({
//   id: "pulse",
//   label: "Pulse",
//   baseImageKey: "card_base",
//   skillImageKey: "card_skill_pulse",
//   cooldownMs: 3000,
//   performAction: (context: CardActionContext): boolean => {
//     const { room } = context;
//     room.send(3);
//     return true;
//   },
// });