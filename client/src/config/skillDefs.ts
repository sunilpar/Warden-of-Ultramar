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
export type BolterColorTier = "white" | "yellow" | "blue";

export function bolterColorTier(level: number): BolterColorTier {
  if (level >= 5) return "blue";
  if (level >= 3) return "yellow";
  return "white";
}

export const BOLTER_COLORS: Record<BolterColorTier, number> = {
  white: 0xffffff,
  yellow: 0xffe14d,
  blue: 0x4da6ff,
};

/**
 * Build the "mods" array (human-readable detail strings) for a skill at a
 * given level. Shown on card hover. Strings describe the current effects.
 */
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
