/**
 * Skill Definitions (Server-Authoritative Behavior)
 * =================================================
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

/** Max skill level. */
export const MAX_SKILL_LEVEL = 10;

export type BolterColorTier = "yellow" | "blue" | "purple";

// Helper to get a numeric value that might be a function
function num(
  v: number | ((skillLevel: number) => number),
  skillLevel: number,
): number {
  if (typeof v === "function") return v(skillLevel);
  return v;
}

// Helper to get a boolean value that might be a function
function bool(
  v: boolean | ((skillLevel: number) => boolean),
  skillLevel: number,
): boolean {
  if (typeof v === "function") return v(skillLevel);
  return v;
}

export interface SkillDef {
  id: SkillId;
  cooldown: number;
  /** Additive damage bonus over base attack (0.2 = +20%). Damage = attack * (1 + attackFactor). */
  attackFactor: number;
  damageMultiplierPerLevel?: number;
  /** Base crit chance at skill level 1 (0.1 = 10%). */
  baseCritRate?: number;
  /** Crit chance added per skill level above 1 (0.01 = +1% per level). */
  critRatePerLevel?: number;
  hitFeedbackMs?: number | ((skillLevel: number) => number);
}

export interface BolterDef extends SkillDef {
  id: "bolter";
  projectileSpeed: number | ((skillLevel: number) => number);
  projectileRadius: number;
  maxRange: number;
  chainUnlockLevel: number;
  chainCount: (skillLevel: number) => number;
}

export interface ClawDef extends SkillDef {
  id: "claw";
  coneHalfAngle: (skillLevel: number) => number;
  range: (skillLevel: number) => number;
  bleedUnlockLevel: number;
  bleedDps: (skillLevel: number) => number;
  bleedDuration: (skillLevel: number) => number;
}

export interface SlamDef extends SkillDef {
  id: "slam";
  range: (skillLevel: number) => number;
  speed: number;
  halfWidth: number | ((skillLevel: number) => number);
  halfHeight: number | ((skillLevel: number) => number);
  bypassWalls?: (skillLevel: number) => boolean;
  hitInterval: number;
}

export interface HealDef extends SkillDef {
  id: "heal";
  /** Heal amount at level 1 (L1-4 only; L5+ stays fixed). */
  baseHeal: number;
  /** Heal increase per level (L1-4 only). */
  healPerLevel: number;
  /** Level at which heal becomes AoE. */
  aoeUnlockLevel: number;
  /** AoE radius in pixels. Grows with level from aoeUnlockLevel. */
  aoeRadius: (skillLevel: number) => number;
  /** Kills required to recharge (L1 to aoeUnlockLevel-1). */
  killsToRecharge: number;
  /** Cooldown in seconds (aoeUnlockLevel and above). */
  cooldown: number;
}

export interface PulseDef extends SkillDef {
  id: "pulse";
  /** Base damage at level 1. */
  baseDamage: number;
  /** Damage multiplier per level (0.2 = +20% per level). */
  damagePerLevel: number;
  /** Base radius in pixels. */
  baseRadius: number;
  /** Radius growth per level in pixels. */
  radiusPerLevel: number;
  /** Base cooldown in seconds. */
  baseCooldown: number;
  /** Cooldown increase per level in seconds. */
  cooldownPerLevel: number;
  /** Level at which shock chance unlocks. */
  shockUnlockLevel: number;
  /** Chance to inflict shock at unlock level (0.1 = 10%). */
  baseShockChance: number;
  /** Shock chance increase per level above unlock (0.1 = +10%). */
  shockChancePerLevel: number;
  /** Shock duration in seconds. */
  shockDuration: number;
}

export interface DashDef extends SkillDef {
  id: "dash";
  /** Base dash distance in pixels (L1). */
  baseRange: number;
  /** Range growth per level (L1-5, very minimal). */
  rangePerLevel: number;
  /** Base cooldown in seconds (L1 = 5s). */
  baseCooldown: number;
  /** Cooldown at L5 (2.5s). Linear interpolation L1..L5. */
  level5Cooldown: number;
  /** Level at which ice blast unlocks. */
  iceBlastUnlockLevel: number;
  /** Base ice blast damage at unlock level. */
  iceBlastBaseDamage: number;
  /** Ice blast damage increase per level above unlock (0.1 = +10%). */
  iceBlastDamagePerLevel: number;
  /** Base ice blast radius in pixels. */
  iceBlastBaseRadius: number;
  /** Ice blast radius growth per level above unlock. */
  iceBlastRadiusPerLevel: number;
}

export interface ShockDef extends SkillDef {
  id: "shock";
  /** Base damage (same as bolter base attack). */
  baseDamage: number;
  /** Damage multiplier per alternating level (0.1 = +10%). Applied at L2,4,6,8,10. */
  damagePerAlternateLevel: number;
  /** Base cone range in pixels. */
  baseRange: number;
  /** Range growth per alternating level (L1,3,5,7,9). */
  rangePerAlternateLevel: number;
  /** Cone half-angle in radians. */
  coneHalfAngle: number;
  /** Base cooldown in seconds. */
  baseCooldown: number;
  /** Max targets per level. */
  targetsPerLevel: (lvl: number) => number;
  /** Chain count per level (0 = no chain). */
  chainsPerLevel: (lvl: number) => number;
  /** Chain search radius in pixels. */
  chainRadius: (lvl: number) => number;
  /** Chain damage multiplier (each chain does this fraction of the previous). */
  chainDamageFalloff: number;
}

export interface VortexDef extends SkillDef {
  id: "vortex";
  /** Base pull radius in pixels. */
  radiusBase: number;
  /** Radius growth per level. */
  radiusPerLevel: number;
  /** Base pull force (px/sec) — how fast entities are dragged to centre. */
  pullForceBase: number;
  /** Pull force growth per level. */
  pullForcePerLevel: number;
  /** Duration of the pull phase in seconds. */
  pullDuration: number;
  /** Level at which explosion unlocks. */
  explosionUnlockLevel: number;
  /** Base explosion damage. */
  baseExplosionDamage: number;
  /** Explosion damage growth per level above unlock (0.1 = +10%). */
  explosionDamagePerLevel: number;
  /** Base explosion radius in pixels. */
  baseExplosionRadius: number;
  /** Explosion radius growth per level above unlock. */
  explosionRadiusPerLevel: number;
}

/**
 * Bolter:
 * - +20% base damage over attack (attackFactor)
 * - +10% damage per level (default levelFactor)
 * - Projectile speed: +2% per level
 * - Chain counts: L3-6=2 chains, L7-9=3 chains, L10=4 chains
 */
const BOLTER: BolterDef = {
  id: "bolter",
  cooldown: 0.5,
  attackFactor: 0.2, // +20% damage over base attack
  baseCritRate: 0.1, // 10% crit at level 1
  critRatePerLevel: 0.01, // +1% crit per level
  projectileSpeed: (lvl: number) => Math.round(520 * Math.pow(1.02, lvl - 1)),
  projectileRadius: 6,
  maxRange: 900,
  chainUnlockLevel: 3,
  chainCount: (lvl: number) => {
    if (lvl >= 10) return 4;
    if (lvl >= 7) return 3;
    if (lvl >= 3) return 2;
    return 0;
  },
  hitFeedbackMs: 100,
};

/**
 * Claw:
 * - +20% damage per level (damageMultiplierPerLevel)
 * - Cone angle + range: +10% per level from L5-10
 * - Hit feedback: +20% per level from L5-10
 * - Bleed: L5 unlocks, 500 dps at L5, +100 dps per level, 10 sec at L5, +1 sec per level
 */
const CLAW: ClawDef = {
  id: "claw",
  cooldown: 0.5,
  attackFactor: 0.0,
  damageMultiplierPerLevel: 0.2,
  baseCritRate: 0.15, // 15% crit at level 1
  critRatePerLevel: 0.01, // +1% crit per level
  coneHalfAngle: (lvl: number) => {
    const base = lvl >= 8 ? 0.9 : lvl >= 4 ? 0.7 : 0.5;
    if (lvl >= 5 && lvl <= 10) {
      const levelsAbove4 = lvl - 4;
      return base * Math.pow(1.1, levelsAbove4);
    }
    return base;
  },
  range: (lvl: number) => {
    const base = lvl >= 8 ? 110 : lvl >= 4 ? 85 : 60;
    if (lvl >= 5 && lvl <= 10) {
      const levelsAbove4 = lvl - 4;
      return Math.round(base * Math.pow(1.1, levelsAbove4));
    }
    return base;
  },
  bleedUnlockLevel: 10,
  bleedDps: (lvl: number) => {
    if (lvl < 5) return 0;
    return 10; // flat 10 damage per tick
  },
  bleedDuration: (lvl: number) => {
    if (lvl < 5) return 0;
    return 10; // flat 10 seconds
  },
  hitFeedbackMs: (lvl: number) => {
    const base = 120;
    if (lvl >= 5 && lvl <= 10) {
      const levelsAbove4 = lvl - 4;
      return Math.round(base * Math.pow(1.2, levelsAbove4));
    }
    return base;
  },
};

/**
 * Slam:
 * - +20% damage per level (damageMultiplierPerLevel)
 * - Hitbox: +10% per level from L3+
 * - Hit feedback: +20% per level from L3-10
 * - Bypass walls at L5+
 */
const SLAM: SlamDef = {
  id: "slam",
  cooldown: 2.0,
  attackFactor: 0.0,
  damageMultiplierPerLevel: 0.2,
  baseCritRate: 0.1, // 10% crit at level 1
  critRatePerLevel: 0.01, // +1% crit per level
  range: (lvl: number) => (lvl >= 6 ? 200 : 120),
  speed: 300,
  halfWidth: (lvl: number) => {
    const base = 40;
    if (lvl >= 3) {
      const levelsAbove2 = lvl - 2;
      return Math.round(base * Math.pow(1.1, levelsAbove2));
    }
    return base;
  },
  halfHeight: (lvl: number) => {
    const base = 20;
    if (lvl >= 3) {
      const levelsAbove2 = lvl - 2;
      return Math.round(base * Math.pow(1.1, levelsAbove2));
    }
    return base;
  },
  bypassWalls: (lvl: number) => lvl >= 5,
  hitInterval: 0.5,
  hitFeedbackMs: (lvl: number) => {
    const base = 250;
    if (lvl >= 3 && lvl <= 10) {
      const levelsAbove2 = lvl - 2;
      return Math.round(base * Math.pow(1.2, levelsAbove2));
    }
    return base;
  },
};

/**
 * Heal:
 * - L1-4: Self-only. Charged by kills (5 kills per use). Heals 100 + 100/level.
 * - L5-10: AoE circle, heals all players + enemies in radius. Cooldown-based.
 *           Heal amount frozen at L4 value; only radius grows (+20px/level).
 */
const HEAL: HealDef = {
  id: "heal",
  cooldown: 10.0,
  attackFactor: 0.0,
  baseHeal: 100,
  healPerLevel: 100,
  aoeUnlockLevel: 5,
  aoeRadius: (lvl: number) => {
    if (lvl < 5) return 0;
    return 80 + (lvl - 5) * 20;
  },
  killsToRecharge: 5,
};

/**
 * Pulse:
 * - Lightning damage in a circle around the caster.
 * - Base 300 damage, +20% per level.
 * - Base radius 80px, +8px per level.
 * - Base cooldown 5s, +0.2s per level.
 * - Ignores collision/walls.
 * - L5+: chance to inflict shock (reduces defence by 20%, slows 50%).
 *   Shock chance: 10% at L5, +10% per level (50% at L10). Duration 10s.
 */
const PULSE: PulseDef = {
  id: "pulse",
  cooldown: 5.0,
  attackFactor: 0.0,
  baseCritRate: 0.2,
  critRatePerLevel: 0.0,
  baseDamage: 300,
  damagePerLevel: 0.2,
  baseRadius: 80,
  radiusPerLevel: 8,
  baseCooldown: 5.0,
  cooldownPerLevel: 0.2,
  shockUnlockLevel: 5,
  baseShockChance: 0.1,
  shockChancePerLevel: 0.1,
  shockDuration: 10.0,
};

/**
 * Dash:
 * - Evasion skill: dash toward mouse, invincible during dash.
 * - L1-5: cooldown decreases 5s -> 2.5s (linear), range increases minimally.
 * - L6-10: ice blast on landing (small radius AoE, ice damage). +10% dmg/level, slight radius growth.
 */
const DASH: DashDef = {
  id: "dash",
  cooldown: 5.0,
  attackFactor: 0.0,
  baseRange: 120,
  rangePerLevel: 5,
  baseCooldown: 5.0,
  level5Cooldown: 2.5,
  iceBlastUnlockLevel: 6,
  iceBlastBaseDamage: 100,
  iceBlastDamagePerLevel: 0.1,
  iceBlastBaseRadius: 50,
  iceBlastRadiusPerLevel: 3,
};

/**
 * Shock (Chain Lightning):
 * - Cone-based targeting: finds N enemies in the cone hitbox.
 * - L1=1 target, L2=2, L3=2, L4=3, L5=3, L6=4, L7=4, L8=5, L9=5, L10=5.
 * - Chains: L1-4=0, L5=1, L6=1, L7=2, L8=2, L9=3, L10=3.
 *   Each chain finds nearest enemy in radius, does 50% damage, chain does 50% of that, etc.
 * - Damage increases at L2,4,6,8,10 (+10% each).
 * - Range increases at L1,3,5,7,9.
 * - Base cooldown 0.7s. Crit rate 20%.
 */
export const SHOCK: ShockDef = {
  id: "shock",
  cooldown: 0.7,
  attackFactor: 0.0,
  baseCritRate: 0.2,
  critRatePerLevel: 0.0,
  baseDamage: 200,
  damagePerAlternateLevel: 0.2, // +20% at L2,4,6,8,10
  baseRange: 200,
  rangePerAlternateLevel: 30, // +30px at L1,3,5,7,9
  coneHalfAngle: 0.6, // ~34 degrees half-angle
  baseCooldown: 0.7,
  targetsPerLevel: (lvl: number) => {
    const table = [1, 2, 2, 3, 3, 4, 4, 5, 5, 5];
    return table[Math.min(lvl - 1, 9)];
  },
  chainsPerLevel: (lvl: number) => {
    if (lvl >= 9) return 3;
    if (lvl >= 7) return 2;
    if (lvl >= 5) return 1;
    return 0;
  },
  chainRadius: (lvl: number) => {
    if (lvl >= 10) return 200; // increased chain radius at L10
    return 150;
  },
  chainDamageFalloff: 0.5, // each chain does 50% of previous
};

/**
 * Vortex:
 * - Pulls enemies/players toward its centre, centred on the caster.
 * - L1-4: Pull only. Radius + pull rate grow per level.
 * - L5-10: Pull + explosion after pull completes.
 *         Explosion damage (+10%/level), explosion radius, vortex radius grow per level.
 * - Colour: grey (L1-2), brown (L3-5), purple (L6-10).
 */
export const VORTEX: VortexDef = {
  id: "vortex",
  cooldown: 8.0,
  attackFactor: 0.0,
  baseCritRate: 0.1,
  critRatePerLevel: 0.01,
  radiusBase: 60,
  radiusPerLevel: 12,
  pullForceBase: 100,
  pullForcePerLevel: 20,
  pullDuration: 2.0,
  explosionUnlockLevel: 5,
  baseExplosionDamage: 300,
  explosionDamagePerLevel: 0.1,
  baseExplosionRadius: 80,
  explosionRadiusPerLevel: 6,
  hitFeedbackMs: 100,
};

// Export as object with helper accessors that handle function values
export const SKILL_DEFS: Record<string, SkillDef> & {
  bolter: BolterDef;
  claw: ClawDef;
  slam: SlamDef;
  heal: HealDef;
  pulse: PulseDef;
  shock: ShockDef;
  dash: DashDef;
  vortex: VortexDef;
} = {
  bolter: BOLTER,
  claw: CLAW,
  slam: SLAM,
  heal: HEAL,
  pulse: PULSE,
  shock: SHOCK,
  dash: DASH,
  vortex: VORTEX,
};

/** Pulse damage for a given level. */
export function pulseDamage(skillLevel: number): number {
  const lvl = Math.max(1, skillLevel);
  return PULSE.baseDamage * (1.0 + PULSE.damagePerLevel * (lvl - 1));
}

/** Pulse radius for a given level. */
export function pulseRadius(skillLevel: number): number {
  const lvl = Math.max(1, skillLevel);
  return PULSE.baseRadius + PULSE.radiusPerLevel * (lvl - 1);
}

/** Pulse cooldown for a given level. */
export function pulseCooldown(skillLevel: number): number {
  const lvl = Math.max(1, skillLevel);
  return PULSE.baseCooldown + PULSE.cooldownPerLevel * (lvl - 1);
}

/** Pulse shock chance for a given level (0 if below unlock). */
export function pulseShockChance(skillLevel: number): number {
  if (skillLevel < PULSE.shockUnlockLevel) return 0;
  return (
    PULSE.baseShockChance +
    PULSE.shockChancePerLevel * (skillLevel - PULSE.shockUnlockLevel)
  );
}

// ---- Shock helpers ----

/** Shock damage for a given level. +10% at L2,4,6,8,10. */
export function shockDamage(skillLevel: number): number {
  const lvl = Math.max(1, skillLevel);
  const increases = Math.floor(lvl / 2); // L2→1, L4→2, L6→3, L8→4, L10→5
  return SHOCK.baseDamage * (1.0 + SHOCK.damagePerAlternateLevel * increases);
}

/** Shock cone range for a given level. +30px at L1,3,5,7,9. */
export function shockRange(skillLevel: number): number {
  const lvl = Math.max(1, skillLevel);
  const increases = Math.floor((lvl - 1) / 2) + 1; // L1→1, L3→2, L5→3, L7→4, L9→5
  return SHOCK.baseRange + SHOCK.rangePerAlternateLevel * (increases - 1);
}

/** Max targets for a given level. */
export function shockTargets(skillLevel: number): number {
  return SHOCK.targetsPerLevel(Math.max(1, skillLevel));
}

/** Chain count for a given level. */
export function shockChains(skillLevel: number): number {
  return SHOCK.chainsPerLevel(Math.max(1, skillLevel));
}

/** Chain search radius for a given level. */
export function shockChainRadius(skillLevel: number): number {
  return SHOCK.chainRadius(Math.max(1, skillLevel));
}

/** Heal amount for a given level. L1-4 scales, L5+ frozen at L4 value. */
export function healAmount(skillLevel: number): number {
  const lvl = Math.max(1, skillLevel);
  const effectiveLvl =
    lvl >= HEAL.aoeUnlockLevel ? HEAL.aoeUnlockLevel - 1 : lvl;
  return HEAL.baseHeal + HEAL.healPerLevel * (effectiveLvl - 1);
}

/** AoE radius for heal at a given level (0 if below unlock level). */
export function healRadius(skillLevel: number): number {
  return HEAL.aoeRadius(skillLevel);
}

/**
 * Heal percentage of max HP for L7-10. Returns 0 for L1-6 (use flat healAmount instead).
 * L7: 30%, L8: 40%, L9: 50%, L10: 60%.
 */
export function healPercent(skillLevel: number): number {
  if (skillLevel < 7) return 0;
  const table: Record<number, number> = { 7: 0.3, 8: 0.4, 9: 0.5, 10: 0.6 };
  return table[skillLevel] ?? 0.6;
}

/**
 * Per-skill damage growth with level.
 * Default: +10% per level.
 * Override per skill via damageMultiplierPerLevel.
 */
export function levelFactor(skillId: SkillId, skillLevel: number): number {
  const def = SKILL_DEFS[skillId];
  const mult = def?.damageMultiplierPerLevel ?? 0.1;
  return 1.0 + mult * Math.max(0, skillLevel - 1);
}

export function computeSkillDamage(
  skillId: SkillId,
  casterAttack: number,
  skillLevel: number,
  casterDamageMultiplier: number,
): number {
  const def = SKILL_DEFS[skillId];
  // attackFactor is now an additive percentage bonus (0.2 = +20% damage)
  const af = def ? def.attackFactor : 0.0;
  return (
    casterAttack *
    (1.0 + af) *
    levelFactor(skillId, skillLevel) *
    casterDamageMultiplier
  );
}

/**
 * Roll a critical hit and return the damage multiplier + crit flag.
 * Returns { damage, isCrit }.
 */
export function applyCrit(
  damage: number,
  critRate: number,
  critDamage: number,
): { damage: number; isCrit: boolean } {
  if (critRate > 0 && Math.random() < critRate) {
    return { damage: damage * critDamage, isCrit: true };
  }
  return { damage, isCrit: false };
}

export function bolterColorTier(skillLevel: number): BolterColorTier {
  if (skillLevel >= 8) return "purple";
  if (skillLevel >= 4) return "blue";
  return "yellow";
}

/**
 * Compute the crit rate for a given skill at a given level.
 * Combines the player's base crit rate with the skill's own crit rate
 * (baseCritRate + critRatePerLevel * (level - 1)).
 */
export function skillCritRate(
  skillId: SkillId,
  skillLevel: number,
  playerCritRate: number,
): number {
  const def = SKILL_DEFS[skillId];
  const base = def?.baseCritRate ?? 0;
  const perLvl = def?.critRatePerLevel ?? 0;
  return playerCritRate + base + perLvl * Math.max(0, skillLevel - 1);
}

export function chainDamageMultiplier(chainIndex: number): number {
  return Math.pow(0.5, chainIndex);
}

export type ClawTier = "small" | "mid" | "big";

export function clawTier(skillLevel: number): ClawTier {
  if (skillLevel >= 8) return "big";
  if (skillLevel >= 4) return "mid";
  return "small";
}

export function clawInflictsBleed(skillLevel: number): boolean {
  return skillLevel >= CLAW.bleedUnlockLevel;
}

/** Get bolter projectile speed (handles function or number). */
export function getBolterSpeed(skillLevel: number): number {
  return num(BOLTER.projectileSpeed, skillLevel);
}

/** Get slam halfWidth (handles function or number). */
export function getSlamHalfWidth(skillLevel: number): number {
  return num(SLAM.halfWidth, skillLevel);
}

/** Get slam halfHeight (handles function or number). */
export function getSlamHalfHeight(skillLevel: number): number {
  return num(SLAM.halfHeight, skillLevel);
}

/** Does this slam level bypass walls? */
export function slamBypassesWalls(skillLevel: number): boolean {
  return SLAM.bypassWalls ? bool(SLAM.bypassWalls, skillLevel) : false;
}

/** Get hit feedback ms for a skill at given level. */
export function getSkillHitFeedback(
  skill: SkillId,
  skillLevel: number = 1,
): number {
  const def = SKILL_DEFS[skill];
  if (!def?.hitFeedbackMs) return 80;
  return num(def.hitFeedbackMs, skillLevel);
}

/** Get claw cone half-angle for level. */
export function getClawHalfAngle(skillLevel: number): number {
  return CLAW.coneHalfAngle(skillLevel);
}

/** Get claw range for level. */
export function getClawRange(skillLevel: number): number {
  return CLAW.range(skillLevel);
}

/** Get claw bleed dps for level. */
export function getClawBleedDps(skillLevel: number): number {
  return CLAW.bleedDps(skillLevel);
}

/** Get claw bleed duration for level. */
export function getClawBleedDuration(skillLevel: number): number {
  return CLAW.bleedDuration(skillLevel);
}

// ---- Dash helpers ----

/** Dash distance for a given level. Minimal growth L1-5, flat L6-10. */
export function dashRange(skillLevel: number): number {
  const lvl = Math.max(1, Math.min(5, skillLevel));
  return DASH.baseRange + DASH.rangePerLevel * (lvl - 1);
}

/** Dash cooldown for a given level. Linear L1(5s)->L5(2.5s), flat after. */
export function dashCooldown(skillLevel: number): number {
  const lvl = Math.max(1, Math.min(5, skillLevel));
  const t = (lvl - 1) / 4; // 0 at L1, 1 at L5
  return DASH.baseCooldown + (DASH.level5Cooldown - DASH.baseCooldown) * t;
}

/** Whether ice blast is unlocked at this level. */
export function dashHasIceBlast(skillLevel: number): boolean {
  return skillLevel >= DASH.iceBlastUnlockLevel;
}

/** Ice blast damage for a given level (0 if not unlocked). */
export function dashIceBlastDamage(skillLevel: number): number {
  if (skillLevel < DASH.iceBlastUnlockLevel) return 0;
  const levelsAbove = skillLevel - DASH.iceBlastUnlockLevel;
  return DASH.iceBlastBaseDamage * (1.0 + DASH.iceBlastDamagePerLevel * levelsAbove);
}

/** Ice blast radius for a given level (0 if not unlocked). */
export function dashIceBlastRadius(skillLevel: number): number {
  if (skillLevel < DASH.iceBlastUnlockLevel) return 0;
  const levelsAbove = skillLevel - DASH.iceBlastUnlockLevel;
  return DASH.iceBlastBaseRadius + DASH.iceBlastRadiusPerLevel * levelsAbove;
}

// Typed helpers
export const CLAW_DEF: ClawDef = CLAW;
export const BOLTER_DEF: BolterDef = BOLTER;
export const SLAM_DEF: SlamDef = SLAM;

export const DASH_DEF: DashDef = DASH;

// ---- Vortex helpers ----

/** Vortex pull radius for a given level. */
export function vortexRadius(skillLevel: number): number {
  const lvl = Math.max(1, skillLevel);
  return VORTEX.radiusBase + VORTEX.radiusPerLevel * (lvl - 1);
}

/** Vortex pull force (speed) for a given level. */
export function vortexPullForce(skillLevel: number): number {
  const lvl = Math.max(1, skillLevel);
  return VORTEX.pullForceBase + VORTEX.pullForcePerLevel * (lvl - 1);
}

/** Whether vortex has an explosion at this level. */
export function vortexHasExplosion(skillLevel: number): boolean {
  return skillLevel >= VORTEX.explosionUnlockLevel;
}

/** Explosion damage for a given level (0 if not unlocked). */
export function vortexExplosionDamage(skillLevel: number): number {
  if (skillLevel < VORTEX.explosionUnlockLevel) return 0;
  const levelsAbove = skillLevel - VORTEX.explosionUnlockLevel;
  return VORTEX.baseExplosionDamage * (1.0 + VORTEX.explosionDamagePerLevel * levelsAbove);
}

/** Explosion radius for a given level (0 if not unlocked). */
export function vortexExplosionRadius(skillLevel: number): number {
  if (skillLevel < VORTEX.explosionUnlockLevel) return 0;
  const levelsAbove = skillLevel - VORTEX.explosionUnlockLevel;
  return VORTEX.baseExplosionRadius + VORTEX.explosionRadiusPerLevel * levelsAbove;
}

/** Vortex colour tier: grey (1-2), brown (3-5), purple (6-10). */
export type VortexColorTier = "grey" | "brown" | "purple";

export function vortexColorTier(skillLevel: number): VortexColorTier {
  if (skillLevel >= 6) return "purple";
  if (skillLevel >= 3) return "brown";
  return "grey";
}

export const VORTEX_DEF: VortexDef = VORTEX;
