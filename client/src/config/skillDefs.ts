/**
 * Skill Definitions (Client — Card Art + Mods Text)
 * =================================================
 * Client-side skill data for RENDERING ONLY. Behavior (damage, cooldown,
 * chain, color tiers) is server-authoritative (server/src/config/skillDefs.ts).
 *
 * CARD SPRITESHEET (cardSpritesheet128_200.png, 9 cols x 4 rows, 128x200):
 *   Row 0 (frames  0..8): card backs
 *   Row 1 (frames  9..17): RARITY BASES — the card frame/floor whose color
 *                          encodes rarity (white common / green uncommon /
 *                          blue rare / purple epic / gold legendary /
 *                          blue-gold unique). Drawn at full opacity under
 *                          the art.
 *   Row 2 (frames 18..26): base skill art (drawn ON TOP of the rarity base
 *                          at reduced opacity)
 *   Row 3 (frames 27..35): upgraded skill art (level > 5)
 *
 * CARD COMPOSITION RULE
 * ---------------------
 * Every card is rendered as: rarity base (row 1) at alpha 1, then the
 * skill art (row 2/3) on top at reduced opacity. The base provides the
 * rounded edges; the art identifies the skill.
 */

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

export type CardTier = "base" | "upgraded";

export interface SkillCardArt {
  /** Skill id. */
  id: SkillId;
  /** Column (1..9) in the skill rows of the card spritesheet. */
  column: number;
  /** Display title. */
  title: string;
  /** Description. */
  description: string;
}

export const SKILL_CARDS: Record<SkillId, SkillCardArt> = {
  bolter: {
    id: "bolter",
    column: 1,
    title: "Bolter",
    description: "Fires a bullet toward your aim. Chains at higher levels.",
  },
  shield: { id: "shield", column: 2, title: "Shield", description: "Raises a protective barrier." },
  dash: { id: "dash", column: 3, title: "Dash", description: "Quick burst of movement." },
  pulse: { id: "pulse", column: 4, title: "Pulse", description: "Radial shockwave." },
  vortex: { id: "vortex", column: 5, title: "Vortex", description: "Pulls enemies toward a point." },
  claw: { id: "claw", column: 6, title: "Claw", description: "Close-range melee slash." },
  slam: { id: "slam", column: 7, title: "Slam", description: "Ground slam AoE knockback." },
  shock: { id: "shock", column: 8, title: "Shock", description: "Chain lightning." },
  heal: { id: "heal", column: 9, title: "Heal", description: "Restore health over time." },
};

export const CARD_SPRITESHEET_COLUMNS = 9;

// ============================================================
// RARITY
// ============================================================

/** All card rarities (order matches loot roll tiers). */
export type Rarity =
  | "common"
  | "uncommon"
  | "rare"
  | "epic"
  | "legendary"
  | "exotic"
  | "unique";

/** Column (1..9) of each rarity's base frame in spritesheet ROW 1. */
export const RARITY_BASE_COLUMNS: Record<Rarity, number> = {
  common: 1, // white
  uncommon: 2, // green
  rare: 3, // blue
  epic: 4, // purple
  legendary: 5, // gold
  exotic: 6, // red (reserved — not dropping yet)
  unique: 7, // blue with gold hint
};

/** Accent colors for labels / strokes (must match server loot.ts). */
export const RARITY_COLORS: Record<Rarity, number> = {
  common: 0x9e9e9e,
  uncommon: 0x00c853,
  rare: 0x2979ff,
  epic: 0xaa00ff,
  legendary: 0xffd700,
  exotic: 0xd50000,
  unique: 0x00e5ff,
};

/** Human-readable rarity names. */
export const RARITY_NAMES: Record<Rarity, string> = {
  common: "Common",
  uncommon: "Uncommon",
  rare: "Rare",
  epic: "Epic",
  legendary: "Legendary",
  exotic: "Exotic",
  unique: "Unique",
};

/** Spritesheet ROW 1 holds the rarity bases. */
const RARITY_BASE_ROW = 1;

/**
 * Spritesheet frame for a rarity's base card (row 1). Draw this at FULL
 * opacity under everything else — it provides the card shape + rounded
 * edges and encodes the rarity by color.
 */
export function rarityBaseFrame(rarity: string): number {
  const r = (rarity as Rarity) ?? "common";
  const col = RARITY_BASE_COLUMNS[r] ?? RARITY_BASE_COLUMNS.common;
  return cardFrameAt(RARITY_BASE_ROW, col);
}

/** Coerce an unknown string into a valid Rarity (default common). */
export function asRarity(rarity: string | undefined | null): Rarity {
  const r = rarity as Rarity;
  return RARITY_BASE_COLUMNS[r] ? r : "common";
}

/** Opacity applied to the skill-art layer drawn over the rarity base. */
export const CARD_ART_ALPHA = 0.85;

/** Frame index for a card at a given row (0-indexed) and column (1-indexed). */
export function cardFrameAt(row: number, column1: number): number {
  return row * CARD_SPRITESHEET_COLUMNS + (column1 - 1);
}

/**
 * Card tier for a skill at a given level: "upgraded" art at level > 5,
 * otherwise "base".
 */
export function cardTierForLevel(level: number): CardTier {
  return level > 5 ? "upgraded" : "base";
}

/**
 * Spritesheet frame for a skill's ART at a given level.
 * Row 2 = base art, Row 3 = upgraded art.
 */
export function cardFrameForLevel(skill: SkillId, level: number): number {
  const art = SKILL_CARDS[skill];
  const row = cardTierForLevel(level) === "upgraded" ? 3 : 2;
  return cardFrameAt(row, art.column);
}

/** Bolter bullet color tier (must match server). */
export type BolterColorTier = "yellow" | "blue" | "purple";

export function bolterColorTier(level: number): BolterColorTier {
  if (level >= 8) return "purple";
  if (level >= 4) return "blue";
  return "yellow";
}

export const BOLTER_COLORS: Record<BolterColorTier, number> = {
  yellow: 0xffe14d,
  blue: 0x4da6ff,
  purple: 0xb266ff,
};

/**
 * Build the "mods" array (human-readable detail strings) for a skill at a
 * given level. Shown on card hover. Strings describe the current effects.
 */
/**
 * Bolter bullet spritesheet frame for a given level.
 * BolterSpriteSheet-0002.png is 3 cols x 2 rows, 64x64 each.
 *   Row 0 (frames 0,1,2): bullet art per tier
 *     frame 0 = levels 1-3 (yellow)
 *     frame 1 = levels 4-7 (blue)
 *     frame 2 = levels 8-10 (purple)
 *   Row 1 (frames 3,4,5): muzzle flash animation frames.
 */
export function bolterBulletFrameForLevel(level: number): number {
  const tier = bolterColorTier(level);
  if (tier === "purple") return 2;
  if (tier === "blue") return 1;
  return 0;
}

/** Muzzle flash animation frames (row 1): indices 3,4,5 in the 3-col sheet. */
export const BOLTER_MUZZLE_FRAMES = [3, 4, 5];

// ============================================================
// CLAW TIER
// ============================================================

/** Claw visual tier. small (1-3), mid (4-7), big (8-10). */
export type ClawTier = "small" | "mid" | "big";

export function clawTier(level: number): ClawTier {
  if (level >= 8) return "big";
  if (level >= 4) return "mid";
  return "small";
}

/**
 * Claw spritesheet frame for a given level.
 * clawSpritesheet-0003.png is 4 cols x 3 rows, 64x64 each.
 *   Row 0 (frames 0-3): tier "small" animation (levels 1-3).
 *   Row 1 (frames 4-7): tier "mid" animation (levels 4-7).
 *   Row 2 (frames 8-11): tier "big" animation (levels 8-10).
 * Returns the START frame of the tier's row (use frames start..start+3).
 */
export function clawRowStartFrame(level: number): number {
  const t = clawTier(level);
  if (t === "big") return 8;
  if (t === "mid") return 4;
  return 0;
}
export const CLAW_FRAMES_PER_ROW = 4;

export function skillMods(skill: SkillId, level: number): string[] {
  const mods: string[] = [];
  if (skill === "bolter") {
    mods.push(`Level ${level}`);
    mods.push(`Damage scales with ATK`);
    const tier = bolterColorTier(level);
    mods.push(`Bullet color: ${tier}`);
    if (level > 3) {
      mods.push(`Chains ${level - 3}x (50% damage each bounce)`);
    } else {
      mods.push(`No chain (unlocks at level 4)`);
    }
    if (level > 5) {
      mods.push(`Upgraded card art`);
    }
  }
  return mods;
}
// ============================================================
// VORTEX COLOR TIER
// ============================================================

/** Vortex visual colour tier. grey (1-2), brown (3-5), purple (6-10). */
export type VortexColorTier = "grey" | "brown" | "purple";
export function vortexColorTier(level: number): VortexColorTier {
  if (level >= 6) return "purple";
  if (level >= 3) return "brown";
  return "grey";
}
export const VORTEX_COLORS: Record<VortexColorTier, number> = {
  grey: 0x999999,
  brown: 0x8b4513,
  purple: 0xb266ff,
};
