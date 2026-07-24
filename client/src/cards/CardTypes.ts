/**
 * Card System Type Definitions
 * ==============================
 * Defines the data structures for the card system.
 *
 * ARCHITECTURE:
 *   - A CardSlot has 5 slots, each bound to an input key
 *   - Each slot can hold one CardDefinition
 *   - Cards are registered in CardRegistry and referenced by ID
 *   - To add a new card: add an entry to CardRegistry
 *
 * CARD STRUCTURE:
 *   - baseImage: the card background surface
 *   - skillImage: the skill overlay on top of the base
 *   - action: the function that fires when the key is pressed
 *
 * INPUT BINDINGS:
 *   Slot 0 → Left Click
 *   Slot 1 → Right Click
 *   Slot 2 → Space
 *   Slot 3 → Key "1"
 *   Slot 4 → Key "2"
 */

/** Input binding for a card slot */
export type CardInputBinding = "leftClick" | "rightClick" | "space" | "key1" | "key2";

/** Cooldown mode for a card */
export type CooldownMode = "time" | "kills";

/** Phases a card cooldown overlay goes through */
export interface CardCooldownState {
  /** Timestamp when the card was last used */
  lastUsedTime: number;
  /** Cooldown duration in ms */
  cooldownMs: number;
  /** Current kill count for kill-based cooldowns */
  currentKills: number;
  /** Kills required to unlock (for kill-based cooldowns) */
  killsRequired: number;
}

/**
 * A card definition describes what a card does and how it looks.
 * To add a new card, create a new entry in CardRegistry.
 */
export interface CardDefinition {
  /** Unique identifier for this card */
  id: string;
  /**
   * The server skill id this card activates (e.g. "boltershot", "pulse",
   * "heal", "vortex"). Sent to the server via the generic activate message.
   */
  skillId: string;
  /** Display label shown on the card */
  label: string;
  /** Phaser texture key for the base surface image */
  baseImageKey: string;
  /** Phaser texture key for the skill overlay image */
  skillImageKey: string;
  /** Cooldown duration in milliseconds (for time-based cooldowns) */
  cooldownMs: number;
  /** Cooldown mode: "time" (default) or "kills" (fill based on enemy kills) */
  cooldownMode?: CooldownMode;
  /** Number of kills required to activate (only for kill-based cooldowns) */
  killsRequired?: number;
  /**
   * Whether this card needs the pointer (aim) when activated.
   * Projectile cards (bolter) set this to true.
   */
  requiresPointer?: boolean;
  /**
   * The action to perform when this card is activated.
   * Receives the scene and pointer (for mouse-based cards).
   * Returns true if the action was performed (starts cooldown).
   */
  performAction: (context: CardActionContext) => boolean;
}

/**
 * Context passed to a card's performAction function.
 * Provides everything a card might need to execute its effect.
 */
export interface CardActionContext {
  /** The Phaser scene */
  scene: Phaser.Scene;
  /** Pointer position (for mouse-based cards) */
  pointer?: { worldX: number; worldY: number };
  /** The Colyseus room reference */
  room: any;
  /** The local player's entity */
  player?: any;
  /** The player's current facing direction as a unit vector */
  facingDir?: { x: number; y: number };
}

/**
 * A card slot in the HUD. Binds a card to an input.
 * Empty slots show a locked/empty card visual.
 */
export interface CardSlot {
  /** The card equipped in this slot, or null if empty */
  card: CardDefinition | null;
  /** The input binding for this slot */
  binding: CardInputBinding;
  /** Display label for the binding key */
  bindingLabel: string;
  /** Current cooldown state */
  cooldown: CardCooldownState;
}