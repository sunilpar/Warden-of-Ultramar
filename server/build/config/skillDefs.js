/**
 * Skill Definitions (Server-Authoritative Behavior)
 * =================================================
 */
/** Max skill level. */
export const MAX_SKILL_LEVEL = 10;
// Helper to get a numeric value that might be a function
function num(v, skillLevel) {
    if (typeof v === "function")
        return v(skillLevel);
    return v;
}
// Helper to get a boolean value that might be a function
function bool(v, skillLevel) {
    if (typeof v === "function")
        return v(skillLevel);
    return v;
}
/**
 * Bolter:
 * - +20% base damage over attack (attackFactor)
 * - +10% damage per level (default levelFactor)
 * - Projectile speed: +2% per level
 * - Chain counts: L3-6=2 chains, L7-9=3 chains, L10=4 chains
 */
const BOLTER = {
    id: "bolter",
    cooldown: 0.5,
    attackFactor: 0.2, // +20% damage over base attack
    baseCritRate: 0.1, // 10% crit at level 1
    critRatePerLevel: 0.01, // +1% crit per level
    projectileSpeed: (lvl) => Math.round(520 * Math.pow(1.02, lvl - 1)),
    projectileRadius: 6,
    maxRange: 900,
    chainUnlockLevel: 3,
    chainCount: (lvl) => {
        if (lvl >= 10)
            return 4;
        if (lvl >= 7)
            return 3;
        if (lvl >= 3)
            return 2;
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
const CLAW = {
    id: "claw",
    cooldown: 0.5,
    attackFactor: 0.0,
    damageMultiplierPerLevel: 0.2,
    baseCritRate: 0.15, // 15% crit at level 1
    critRatePerLevel: 0.01, // +1% crit per level
    coneHalfAngle: (lvl) => {
        const base = lvl >= 8 ? 0.9 : lvl >= 4 ? 0.7 : 0.5;
        if (lvl >= 5 && lvl <= 10) {
            const levelsAbove4 = lvl - 4;
            return base * Math.pow(1.1, levelsAbove4);
        }
        return base;
    },
    range: (lvl) => {
        const base = lvl >= 8 ? 110 : lvl >= 4 ? 85 : 60;
        if (lvl >= 5 && lvl <= 10) {
            const levelsAbove4 = lvl - 4;
            return Math.round(base * Math.pow(1.1, levelsAbove4));
        }
        return base;
    },
    bleedUnlockLevel: 10,
    bleedDps: (lvl) => {
        if (lvl < 5)
            return 0;
        return 10; // flat 10 damage per tick
    },
    bleedDuration: (lvl) => {
        if (lvl < 5)
            return 0;
        return 10; // flat 10 seconds
    },
    hitFeedbackMs: (lvl) => {
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
const SLAM = {
    id: "slam",
    cooldown: 2.0,
    attackFactor: 0.0,
    damageMultiplierPerLevel: 0.2,
    baseCritRate: 0.1, // 10% crit at level 1
    critRatePerLevel: 0.01, // +1% crit per level
    range: (lvl) => (lvl >= 6 ? 200 : 120),
    speed: 300,
    halfWidth: (lvl) => {
        const base = 40;
        if (lvl >= 3) {
            const levelsAbove2 = lvl - 2;
            return Math.round(base * Math.pow(1.1, levelsAbove2));
        }
        return base;
    },
    halfHeight: (lvl) => {
        const base = 20;
        if (lvl >= 3) {
            const levelsAbove2 = lvl - 2;
            return Math.round(base * Math.pow(1.1, levelsAbove2));
        }
        return base;
    },
    bypassWalls: (lvl) => lvl >= 5,
    hitInterval: 0.5,
    hitFeedbackMs: (lvl) => {
        const base = 250;
        if (lvl >= 3 && lvl <= 10) {
            const levelsAbove2 = lvl - 2;
            return Math.round(base * Math.pow(1.2, levelsAbove2));
        }
        return base;
    },
};
/**
 * Heal — always percentage of max HP:
 * - L1-5: Self-only. Charged by kills (4/4/3/3/3 kills per use).
 * - L6-10: Cooldown-based. Gains range (AoE) — heals all players AND
 *          enemies in a growing radius.
 *
 * Level table:
 *   L1  30% | 4 kills      L6  45% | 15s cd | AoE  80px
 *   L2  35% | 4 kills      L7  50% | 13s cd | AoE 100px
 *   L3  40% | 3 kills      L8  50% | 11s cd | AoE 120px
 *   L4  45% | 3 kills      L9  55% | 10s cd | AoE 140px
 *   L5  50% | 3 kills      L10 60% | 10s cd | AoE 160px
 */
const HEAL = {
    id: "heal",
    cooldown: 15.0,
    attackFactor: 0.0,
    percentTable: [0.3, 0.35, 0.4, 0.45, 0.5, 0.45, 0.5, 0.5, 0.55, 0.6],
    cooldownUnlockLevel: 6,
    cooldownTable: [15, 13, 11, 10, 10],
    aoeUnlockLevel: 6,
    aoeRadius: (lvl) => {
        if (lvl < 6)
            return 0;
        return 80 + (lvl - 6) * 20;
    },
    killsToRecharge: (lvl) => {
        // L1-2: 4 kills, L3-5: 3 kills
        return lvl <= 2 ? 4 : 3;
    },
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
const PULSE = {
    id: "pulse",
    cooldown: 5.0,
    attackFactor: 0.0,
    baseCritRate: 0.2,
    critRatePerLevel: 0.0,
    baseDamage: 300,
    damagePerLevel: 0.2,
    baseRadius: 100,
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
const DASH = {
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
export const SHOCK = {
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
    targetsPerLevel: (lvl) => {
        const table = [1, 2, 2, 3, 3, 4, 4, 5, 5, 5];
        return table[Math.min(lvl - 1, 9)];
    },
    chainsPerLevel: (lvl) => {
        if (lvl >= 9)
            return 3;
        if (lvl >= 7)
            return 2;
        if (lvl >= 5)
            return 1;
        return 0;
    },
    chainRadius: (lvl) => {
        if (lvl >= 10)
            return 200; // increased chain radius at L10
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
export const VORTEX = {
    id: "vortex",
    cooldown: 8.0,
    attackFactor: 0.0,
    baseCritRate: 0.1,
    critRatePerLevel: 0.01,
    radiusBase: 120,
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
export const SKILL_DEFS = {
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
export function pulseDamage(skillLevel) {
    const lvl = Math.max(1, skillLevel);
    return PULSE.baseDamage * (1.0 + PULSE.damagePerLevel * (lvl - 1));
}
/** Pulse radius for a given level. */
export function pulseRadius(skillLevel) {
    const lvl = Math.max(1, skillLevel);
    return PULSE.baseRadius + PULSE.radiusPerLevel * (lvl - 1);
}
/** Pulse cooldown for a given level. */
export function pulseCooldown(skillLevel) {
    const lvl = Math.max(1, skillLevel);
    return PULSE.baseCooldown + PULSE.cooldownPerLevel * (lvl - 1);
}
/** Pulse shock chance for a given level (0 if below unlock). */
export function pulseShockChance(skillLevel) {
    if (skillLevel < PULSE.shockUnlockLevel)
        return 0;
    return (PULSE.baseShockChance +
        PULSE.shockChancePerLevel * (skillLevel - PULSE.shockUnlockLevel));
}
// ---- Shock helpers ----
/** Shock damage for a given level. +10% at L2,4,6,8,10. */
export function shockDamage(skillLevel) {
    const lvl = Math.max(1, skillLevel);
    const increases = Math.floor(lvl / 2); // L2→1, L4→2, L6→3, L8→4, L10→5
    return SHOCK.baseDamage * (1.0 + SHOCK.damagePerAlternateLevel * increases);
}
/** Shock cone range for a given level. +30px at L1,3,5,7,9. */
export function shockRange(skillLevel) {
    const lvl = Math.max(1, skillLevel);
    const increases = Math.floor((lvl - 1) / 2) + 1; // L1→1, L3→2, L5→3, L7→4, L9→5
    return SHOCK.baseRange + SHOCK.rangePerAlternateLevel * (increases - 1);
}
/** Max targets for a given level. */
export function shockTargets(skillLevel) {
    return SHOCK.targetsPerLevel(Math.max(1, skillLevel));
}
/** Chain count for a given level. */
export function shockChains(skillLevel) {
    return SHOCK.chainsPerLevel(Math.max(1, skillLevel));
}
/** Chain search radius for a given level. */
export function shockChainRadius(skillLevel) {
    return SHOCK.chainRadius(Math.max(1, skillLevel));
}
/** Heal percentage of max HP for a given level (always > 0). */
export function healPercent(skillLevel) {
    const lvl = Math.max(1, Math.min(10, skillLevel));
    return HEAL.percentTable[lvl - 1] ?? 0.3;
}
/** AoE radius for heal at a given level (0 if below unlock level). */
export function healRadius(skillLevel) {
    return HEAL.aoeRadius(skillLevel);
}
/** Heal cooldown in seconds for a given level (L6+; 0 for kill-charged L1-5). */
export function healCooldown(skillLevel) {
    const lvl = Math.max(1, Math.min(10, skillLevel));
    if (lvl < HEAL.cooldownUnlockLevel)
        return 0;
    return HEAL.cooldownTable[lvl - HEAL.cooldownUnlockLevel] ?? 15;
}
/** Kills needed to recharge heal at a given level (L1-5; 0 for L6+). */
export function healKillsToRecharge(skillLevel) {
    const lvl = Math.max(1, Math.min(10, skillLevel));
    if (lvl >= HEAL.cooldownUnlockLevel)
        return 0;
    return HEAL.killsToRecharge(lvl);
}
/** Heal amount in HP for a given level, given max health (percentage-based). */
export function healAmount(skillLevel, maxHealth = 1000) {
    return Math.round(maxHealth * healPercent(skillLevel));
}
/**
 * Per-skill damage growth with level.
 * Default: +10% per level.
 * Override per skill via damageMultiplierPerLevel.
 */
export function levelFactor(skillId, skillLevel) {
    const def = SKILL_DEFS[skillId];
    const mult = def?.damageMultiplierPerLevel ?? 0.1;
    return 1.0 + mult * Math.max(0, skillLevel - 1);
}
export function computeSkillDamage(skillId, casterAttack, skillLevel, casterDamageMultiplier) {
    const def = SKILL_DEFS[skillId];
    // attackFactor is now an additive percentage bonus (0.2 = +20% damage)
    const af = def ? def.attackFactor : 0.0;
    return (casterAttack *
        (1.0 + af) *
        levelFactor(skillId, skillLevel) *
        casterDamageMultiplier);
}
/**
 * Roll a critical hit and return the damage multiplier + crit flag.
 * Returns { damage, isCrit }.
 */
export function applyCrit(damage, critRate, critDamage) {
    if (critRate > 0 && Math.random() < critRate) {
        return { damage: damage * critDamage, isCrit: true };
    }
    return { damage, isCrit: false };
}
export function bolterColorTier(skillLevel) {
    if (skillLevel >= 8)
        return "purple";
    if (skillLevel >= 4)
        return "blue";
    return "yellow";
}
/**
 * Compute the crit rate for a given skill at a given level.
 * Combines the player's base crit rate with the skill's own crit rate
 * (baseCritRate + critRatePerLevel * (level - 1)).
 */
export function skillCritRate(skillId, skillLevel, playerCritRate) {
    const def = SKILL_DEFS[skillId];
    const base = def?.baseCritRate ?? 0;
    const perLvl = def?.critRatePerLevel ?? 0;
    return playerCritRate + base + perLvl * Math.max(0, skillLevel - 1);
}
export function chainDamageMultiplier(chainIndex) {
    return Math.pow(0.5, chainIndex);
}
export function clawTier(skillLevel) {
    if (skillLevel >= 8)
        return "big";
    if (skillLevel >= 4)
        return "mid";
    return "small";
}
export function clawInflictsBleed(skillLevel) {
    return skillLevel >= CLAW.bleedUnlockLevel;
}
/** Get bolter projectile speed (handles function or number). */
export function getBolterSpeed(skillLevel) {
    return num(BOLTER.projectileSpeed, skillLevel);
}
/** Get slam halfWidth (handles function or number). */
export function getSlamHalfWidth(skillLevel) {
    return num(SLAM.halfWidth, skillLevel);
}
/** Get slam halfHeight (handles function or number). */
export function getSlamHalfHeight(skillLevel) {
    return num(SLAM.halfHeight, skillLevel);
}
/** Does this slam level bypass walls? */
export function slamBypassesWalls(skillLevel) {
    return SLAM.bypassWalls ? bool(SLAM.bypassWalls, skillLevel) : false;
}
/** Get hit feedback ms for a skill at given level. */
export function getSkillHitFeedback(skill, skillLevel = 1) {
    const def = SKILL_DEFS[skill];
    if (!def?.hitFeedbackMs)
        return 80;
    return num(def.hitFeedbackMs, skillLevel);
}
/** Get claw cone half-angle for level. */
export function getClawHalfAngle(skillLevel) {
    return CLAW.coneHalfAngle(skillLevel);
}
/** Get claw range for level. */
export function getClawRange(skillLevel) {
    return CLAW.range(skillLevel);
}
/** Get claw bleed dps for level. */
export function getClawBleedDps(skillLevel) {
    return CLAW.bleedDps(skillLevel);
}
/** Get claw bleed duration for level. */
export function getClawBleedDuration(skillLevel) {
    return CLAW.bleedDuration(skillLevel);
}
// ---- Dash helpers ----
/** Dash distance for a given level. Minimal growth L1-5, flat L6-10. */
export function dashRange(skillLevel) {
    const lvl = Math.max(1, Math.min(5, skillLevel));
    return DASH.baseRange + DASH.rangePerLevel * (lvl - 1);
}
/** Dash cooldown for a given level. Linear L1(5s)->L5(2.5s), flat after. */
export function dashCooldown(skillLevel) {
    const lvl = Math.max(1, Math.min(5, skillLevel));
    const t = (lvl - 1) / 4; // 0 at L1, 1 at L5
    return DASH.baseCooldown + (DASH.level5Cooldown - DASH.baseCooldown) * t;
}
/** Whether ice blast is unlocked at this level. */
export function dashHasIceBlast(skillLevel) {
    return skillLevel >= DASH.iceBlastUnlockLevel;
}
/** Ice blast damage for a given level (0 if not unlocked). */
export function dashIceBlastDamage(skillLevel) {
    if (skillLevel < DASH.iceBlastUnlockLevel)
        return 0;
    const levelsAbove = skillLevel - DASH.iceBlastUnlockLevel;
    return (DASH.iceBlastBaseDamage * (1.0 + DASH.iceBlastDamagePerLevel * levelsAbove));
}
/** Ice blast radius for a given level (0 if not unlocked). */
export function dashIceBlastRadius(skillLevel) {
    if (skillLevel < DASH.iceBlastUnlockLevel)
        return 0;
    const levelsAbove = skillLevel - DASH.iceBlastUnlockLevel;
    return DASH.iceBlastBaseRadius + DASH.iceBlastRadiusPerLevel * levelsAbove;
}
// Typed helpers
export const CLAW_DEF = CLAW;
export const BOLTER_DEF = BOLTER;
export const SLAM_DEF = SLAM;
export const DASH_DEF = DASH;
// ---- Vortex helpers ----
/** Vortex pull radius for a given level. */
export function vortexRadius(skillLevel) {
    const lvl = Math.max(1, skillLevel);
    return VORTEX.radiusBase + VORTEX.radiusPerLevel * (lvl - 1);
}
/** Vortex pull force (speed) for a given level. */
export function vortexPullForce(skillLevel) {
    const lvl = Math.max(1, skillLevel);
    return VORTEX.pullForceBase + VORTEX.pullForcePerLevel * (lvl - 1);
}
/** Whether vortex has an explosion at this level. */
export function vortexHasExplosion(skillLevel) {
    return skillLevel >= VORTEX.explosionUnlockLevel;
}
/** Explosion damage for a given level (0 if not unlocked). */
export function vortexExplosionDamage(skillLevel) {
    if (skillLevel < VORTEX.explosionUnlockLevel)
        return 0;
    const levelsAbove = skillLevel - VORTEX.explosionUnlockLevel;
    return (VORTEX.baseExplosionDamage *
        (1.0 + VORTEX.explosionDamagePerLevel * levelsAbove));
}
/** Explosion radius for a given level (0 if not unlocked). */
export function vortexExplosionRadius(skillLevel) {
    if (skillLevel < VORTEX.explosionUnlockLevel)
        return 0;
    const levelsAbove = skillLevel - VORTEX.explosionUnlockLevel;
    return (VORTEX.baseExplosionRadius + VORTEX.explosionRadiusPerLevel * levelsAbove);
}
export function vortexColorTier(skillLevel) {
    if (skillLevel >= 6)
        return "purple";
    if (skillLevel >= 3)
        return "brown";
    return "grey";
}
export const VORTEX_DEF = VORTEX;
