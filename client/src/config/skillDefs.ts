/**
 * Skill Definitions (Client — Card Art + Mods Text)
 * =================================================
 * Client-side skill data for RENDERING ONLY. Behavior (damage, cooldown,
 * chain, color tiers) is server-authoritative (server/src/config/skillDefs.ts).
 *
 * This file defines:
 *   - The card spritesheet frame for each skill, by tier (base vs upgraded).
 *   - The "mods" array: human-readable strings shown on card hover, derived
 *     from the skill level.
 *   - Bolter bullet color tiers (must match the server).
 *
 * CARD SPRITESHEET (cardSpritesheet128_200.png, 9 cols x 4 rows, 128x200):
 *   Row 2 (frames 18..26): base skill art
 *   Row 3 (frames 27..35): upgraded skill art (shown at skill level > 5)
 *   Column for bolter = 1.
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
 * Spritesheet frame for a skill's card at a given level.
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
