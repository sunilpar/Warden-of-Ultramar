/**
 * Loot Tier System
 * =================
 * Tiers scale rolled mod VALUES with the level of the enemy/map that
 * dropped the card. A low-level legendary can drop — but all of its
 * modifiers roll within tier-1 ranges (weak stats). Higher tiers
 * unlock wider/stronger ranges for the SAME mods.
 *
 * TIER STRUCTURE (tied to enemy level; map level later):
 *   level  0-9  -> tier 1
 *   level 10-19 -> tier 2
 *   level 20-29 -> tier 3
 *   level 30-39 -> tier 4
 *   level 40+   -> tier 5
 *
 * All ranges are inclusive [min, max]; the rolled value is uniform
 * inside the range and stored on the card itself (per-mod value), so
 * two identical cards can roll different power within one tier.
 */
/** Number of defined tiers. */
export const MAX_TIER = 5;
/** Levels per tier band (tier n covers levels [n*10, n*10+9]). */
export const LEVELS_PER_TIER = 10;
/**
 * Map a level to its loot tier (1..MAX_TIER).
 * Level 0-9 -> 1, 10-19 -> 2, ... 40+ -> 5 (clamped).
 */
export function tierForLevel(level) {
    const t = Math.floor(level / LEVELS_PER_TIER) + 1;
    return Math.max(1, Math.min(MAX_TIER, t));
}
export const MOD_TIER_RANGES = {
    // Increased crit rate: T1 1-5%, T2 5-10%, T3 10-20%, T4 20-30%, T5 30-40%
    inc_crit_rate: {
        1: { min: 0.01, max: 0.05 },
        2: { min: 0.05, max: 0.10 },
        3: { min: 0.10, max: 0.20 },
        4: { min: 0.20, max: 0.30 },
        5: { min: 0.30, max: 0.40 },
    },
    // Increased crit damage: T1 10-50%, T2 50-100%, T3 100-150%, T4 150-200%, T5 200-300%
    inc_crit_damage: {
        1: { min: 0.10, max: 0.50 },
        2: { min: 0.50, max: 1.00 },
        3: { min: 1.00, max: 1.50 },
        4: { min: 1.50, max: 2.00 },
        5: { min: 2.00, max: 3.00 },
    },
    // Increased attack damage: T1 1-5%, T2 5-10%, T3 10-20%, T4 20-30%, T5 30-40%
    inc_atk_damage: {
        1: { min: 0.01, max: 0.05 },
        2: { min: 0.05, max: 0.10 },
        3: { min: 0.10, max: 0.20 },
        4: { min: 0.20, max: 0.30 },
        5: { min: 0.30, max: 0.40 },
    },
    // Increased cooldown reduction: T1 1-5%, T2 5-10%, T3 10-20%, T4 20-30%, T5 30-40%
    inc_cooldown: {
        1: { min: 0.01, max: 0.05 },
        2: { min: 0.05, max: 0.10 },
        3: { min: 0.10, max: 0.20 },
        4: { min: 0.20, max: 0.30 },
        5: { min: 0.30, max: 0.40 },
    },
    // Increased shield (flat points; reserved — shield cards roll this).
    inc_shield_amount: {
        1: { min: 40, max: 80 },
        2: { min: 80, max: 140 },
        3: { min: 140, max: 220 },
        4: { min: 220, max: 320 },
        5: { min: 320, max: 450 },
    },
};
/** Unique mods are tier-less (fixed effects) — they simply skip ranges. */
/**
 * Roll a uniform value inside the mod's tier range. Returns the tier-1
 * midpoint when the mod has no range table (uniques, unknown ids) so a
 * card always carries a value for every mod id.
 */
export function rollModValue(modId, tier) {
    const ranges = MOD_TIER_RANGES[modId];
    if (!ranges)
        return 1; // unique/unknown: neutral placeholder
    const r = ranges[tier] ?? ranges[1];
    return r.min + Math.random() * (r.max - r.min);
}
