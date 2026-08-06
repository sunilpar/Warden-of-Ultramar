/**
 * Skill Configuration
 * ===================
 * Central definition of every skill in the game.
 *
 * Each skill has a base version (row 3 of the card spritesheet) and an
 * upgraded version (row 4). The card spritesheet is a 9x4 grid where each
 * frame is 128x200 px:
 *
 *   Row 0 (frames 0..8):   card BACKS   (red, blue, green, purple, ...)
 *   Row 1 (frames 9..17):  RARITY overlays (normal, green, blue, ...)
 *   Row 2 (frames 18..26): skill art (base version)
 *   Row 3 (frames 27..35): skill art (upgraded version)
 *
 * Frame index = (row * 9) + col, 0-indexed.
 *
 * THIS FILE IS DATA-ONLY for now. Game logic (cooldowns, damage, effects)
 * will be wired up later; for the moment this serves as the source of
 * truth for names, spritesheet frames, and metadata so the HUD/inventory
 * can render the right card art.
 */

// ============================================================
// TYPES
// ============================================================

export type SkillId =
  | "bolter"
  | "shield"
  | "dash"
  | "pulse"
  | "vortex"
  | "claw"
  | "slam"
  | "shock"
  | "heal";

export type SkillTier = "base" | "upgraded";

export interface SkillTierData {
  /** Spritesheet frame index (0..35) for this tier's card art. */
  frame: number;
  /** Display name shown on the card / UI. */
  name: string;
}

export interface SkillConfig {
  id: SkillId;
  /** Column index (1..9) in the skill rows of the spritesheet. */
  column: number;
  /** Human-readable description (placeholder until logic is wired). */
  description: string;
  base: SkillTierData;
  upgraded: SkillTierData;
}

// ============================================================
// SPRITESHEET GEOMETRY  (9 columns x 4 rows, each 128x200)
// ============================================================

export const CARD_SPRITESHEET = {
  textureKey: "card_sheet",
  path: "assets/cards/cardSpritesheet128_200.png",
  frameWidth: 128,
  frameHeight: 200,
  columns: 9,
  rows: 4,
} as const;

/** Frame index for a given row (0-indexed) and column (1-indexed). */
function frameAt(row: number, col1: number): number {
  return row * CARD_SPRITESHEET.columns + (col1 - 1);
}

// ============================================================
// ROW 0 — CARD BACKS  (frames 0..8)
// ============================================================

export const CARD_BACKS = {
  redBack:     { frame: frameAt(0, 1), name: "Red Back" },
  blueBack:    { frame: frameAt(0, 2), name: "Blue Back" },
  greenBack:   { frame: frameAt(0, 3), name: "Green Back" },
  purpleBack:  { frame: frameAt(0, 4), name: "Purple Back" },
  orangeBack:  { frame: frameAt(0, 5), name: "Orange Back" },
  cyanBack:    { frame: frameAt(0, 6), name: "Cyan Back" },
  yellowBack:  { frame: frameAt(0, 7), name: "Yellow Back" },
  greyBack:    { frame: frameAt(0, 8), name: "Grey Back" },
  triBack:     { frame: frameAt(0, 9), name: "Tri Back" },
} as const;

// ============================================================
// ROW 1 — RARITY OVERLAYS  (frames 9..17)
// ============================================================

export const CARD_RARITIES = {
  normal:          { frame: frameAt(1, 1), name: "Normal",     opacity: 0.0 },
  green:           { frame: frameAt(1, 2), name: "Green",      opacity: 0.35 },
  blue:            { frame: frameAt(1, 3), name: "Blue",       opacity: 0.35 },
  purple:          { frame: frameAt(1, 4), name: "Purple",     opacity: 0.35 },
  gold:            { frame: frameAt(1, 5), name: "Gold",       opacity: 0.35 },
  red:             { frame: frameAt(1, 6), name: "Red",        opacity: 0.35 },
  exotic:          { frame: frameAt(1, 7), name: "Exotic",     opacity: 0.35 },
  chromatic:       { frame: frameAt(1, 8), name: "Chromatic",  opacity: 0.35 },
  chromaticV2:     { frame: frameAt(1, 9), name: "Chromatic V2", opacity: 0.35 },
} as const;

export type CardRarity = keyof typeof CARD_RARITIES;

// ============================================================
// ROW 2 & 3 — SKILLS  (base + upgraded)
// ============================================================

export const SKILLS: Record<SkillId, SkillConfig> = {
  bolter: {
    id: "bolter",
    column: 1,
    description: "Ranged projectile attack.",
    base:     { frame: frameAt(2, 1), name: "Bolter" },
    upgraded: { frame: frameAt(3, 1), name: "Bolter+" },
  },
  shield: {
    id: "shield",
    column: 2,
    description: "Raises a protective barrier.",
    base:     { frame: frameAt(2, 2), name: "Shield" },
    upgraded: { frame: frameAt(3, 2), name: "Shield+" },
  },
  dash: {
    id: "dash",
    column: 3,
    description: "Quick burst of movement.",
    base:     { frame: frameAt(2, 3), name: "Dash" },
    upgraded: { frame: frameAt(3, 3), name: "Dash+" },
  },
  pulse: {
    id: "pulse",
    column: 4,
    description: "Radial shockwave that damages nearby foes.",
    base:     { frame: frameAt(2, 4), name: "Pulse" },
    upgraded: { frame: frameAt(3, 4), name: "Pulse+" },
  },
  vortex: {
    id: "vortex",
    column: 5,
    description: "Pulls enemies toward a point.",
    base:     { frame: frameAt(2, 5), name: "Vortex" },
    upgraded: { frame: frameAt(3, 5), name: "Vortex+" },
  },
  claw: {
    id: "claw",
    column: 6,
    description: "Close-range melee slash.",
    base:     { frame: frameAt(2, 6), name: "Claw" },
    upgraded: { frame: frameAt(3, 6), name: "Claw+" },
  },
  slam: {
    id: "slam",
    column: 7,
    description: "Ground slam AoE knockback.",
    base:     { frame: frameAt(2, 7), name: "Slam" },
    upgraded: { frame: frameAt(3, 7), name: "Slam+" },
  },
  shock: {
    id: "shock",
    column: 8,
    description: "Chain lightning between enemies.",
    base:     { frame: frameAt(2, 8), name: "Shock" },
    upgraded: { frame: frameAt(3, 8), name: "Shock+" },
  },
  heal: {
    id: "heal",
    column: 9,
    description: "Restore health over time.",
    base:     { frame: frameAt(2, 9), name: "Heal" },
    upgraded: { frame: frameAt(3, 9), name: "Heal+" },
  },
};

/** All skills as an ordered list (useful for UI grids). */
export const SKILL_LIST: SkillConfig[] = Object.values(SKILLS);

/**
 * Get the spritesheet frame for a skill at a given tier.
 * Use this when rendering a skill card on the HUD / inventory.
 */
export function getSkillFrame(id: SkillId, tier: SkillTier = "base"): number {
  return SKILLS[id][tier].frame;
}
