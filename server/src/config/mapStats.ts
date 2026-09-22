import { MAX_TIER, tierForLevel } from "./lootTiers";

export type StatTarget = "player" | "enemy";
export type StatPolarity = "good" | "bad";

export type StatEffect =
  | "damage_mult"
  | "crit_rate"
  | "crit_damage"
  | "move_speed_mult"
  | "max_health_mult"
  | "defence"
  | "cooldown_reduction"
  | "rarity_bias"
  | "drop_rate_mult";

export interface StatComponentDef {
  name: string;
  target: StatTarget;
  effect: StatEffect;
  tierMin: [number, number, number, number, number];
  tierMax: [number, number, number, number, number];
}

export interface RolledMapStat {
  good: StatComponentDef;
  bad: StatComponentDef;
  goodValue: number;
  badValue: number;
  durationMaps: number;
}

export interface AppliedMapStat {
  defId: string;
  goodName: string;
  badName: string;
  goodEffect: StatEffect;
  badEffect: StatEffect;
  goodValue: number;
  badValue: number;
  durationMaps: number;
}

export const GOOD_POOL: StatComponentDef[] = [
  { name: "Furious", target: "player", effect: "damage_mult",
    tierMin: [0.01, 0.10, 0.20, 0.30, 0.40], tierMax: [0.10, 0.20, 0.30, 0.40, 0.50] },
  { name: "Precise", target: "player", effect: "crit_rate",
    tierMin: [0.01, 0.10, 0.20, 0.30, 0.40], tierMax: [0.10, 0.20, 0.30, 0.40, 0.50] },
  { name: "Focused", target: "player", effect: "crit_damage",
    tierMin: [0.10, 0.40, 0.80, 1.20, 1.60], tierMax: [0.40, 0.80, 1.20, 1.60, 2.00] },
  { name: "Fast", target: "player", effect: "move_speed_mult",
    tierMin: [0.01, 0.05, 0.10, 0.15, 0.20], tierMax: [0.05, 0.10, 0.15, 0.20, 0.25] },
  { name: "Vigorous", target: "player", effect: "max_health_mult",
    tierMin: [0.05, 0.10, 0.15, 0.20, 0.25], tierMax: [0.10, 0.15, 0.20, 0.25, 0.30] },
  { name: "Tanky", target: "player", effect: "defence",
    tierMin: [0.01, 0.03, 0.06, 0.12, 0.18], tierMax: [0.03, 0.06, 0.12, 0.18, 0.25] },
  { name: "Rejuvinated", target: "player", effect: "cooldown_reduction",
    tierMin: [0.05, 0.10, 0.15, 0.20, 0.25], tierMax: [0.10, 0.15, 0.20, 0.25, 0.30] },
  { name: "Potential Fortune", target: "player", effect: "rarity_bias",
    tierMin: [1, 5, 10, 15, 20], tierMax: [5, 10, 15, 20, 25] },
  { name: "Plunder", target: "player", effect: "drop_rate_mult",
    tierMin: [0.01, 0.03, 0.06, 0.12, 0.18], tierMax: [0.03, 0.06, 0.12, 0.18, 0.25] },
];

export const BAD_POOL: StatComponentDef[] = [
  { name: "Furious", target: "enemy", effect: "damage_mult",
    tierMin: [0.01, 0.10, 0.20, 0.30, 0.40], tierMax: [0.10, 0.20, 0.30, 0.40, 0.50] },
  { name: "Precise", target: "enemy", effect: "crit_rate",
    tierMin: [0.01, 0.10, 0.20, 0.30, 0.40], tierMax: [0.10, 0.20, 0.30, 0.40, 0.50] },
  { name: "Focused", target: "enemy", effect: "crit_damage",
    tierMin: [0.10, 0.40, 0.80, 1.20, 1.60], tierMax: [0.40, 0.80, 1.20, 1.60, 2.00] },
  { name: "Fast", target: "enemy", effect: "move_speed_mult",
    tierMin: [0.01, 0.05, 0.10, 0.15, 0.20], tierMax: [0.05, 0.10, 0.15, 0.20, 0.25] },
  { name: "Vigorous", target: "enemy", effect: "max_health_mult",
    tierMin: [0.05, 0.10, 0.15, 0.20, 0.25], tierMax: [0.10, 0.15, 0.20, 0.25, 0.30] },
  { name: "Tanky", target: "enemy", effect: "defence",
    tierMin: [0.01, 0.03, 0.06, 0.12, 0.18], tierMax: [0.03, 0.06, 0.12, 0.18, 0.25] },
  { name: "Rejuvinated", target: "enemy", effect: "cooldown_reduction",
    tierMin: [0.05, 0.10, 0.15, 0.20, 0.25], tierMax: [0.10, 0.15, 0.20, 0.25, 0.30] },
];

const DURATION_TIER_MIN: [number, number, number, number, number] = [1, 2, 4, 6, 8];
const DURATION_TIER_MAX: [number, number, number, number, number] = [2, 4, 6, 8, 10];

function clampTier(t: number): number {
  return Math.max(1, Math.min(MAX_TIER, Math.floor(t)));
}

export function rollStatTierValue(def: StatComponentDef, tier: number): number {
  const t = clampTier(tier);
  return def.tierMin[t - 1] + Math.random() * (def.tierMax[t - 1] - def.tierMin[t - 1]);
}

export function rollDurationMaps(tier: number): number {
  const t = clampTier(tier);
  return Math.round(DURATION_TIER_MIN[t - 1] + Math.random() * (DURATION_TIER_MAX[t - 1] - DURATION_TIER_MIN[t - 1]));
}

export function rollMapStat(tier: number): RolledMapStat {
  const good = GOOD_POOL[Math.floor(Math.random() * GOOD_POOL.length)];
  const bad = BAD_POOL[Math.floor(Math.random() * BAD_POOL.length)];
  return {
    good,
    bad,
    goodValue: rollStatTierValue(good, tier),
    badValue: rollStatTierValue(bad, tier),
    durationMaps: rollDurationMaps(tier),
  };
}

export function rollThreeOffers(tier: number): RolledMapStat[] {
  const out: RolledMapStat[] = [];
  const usedGood = new Set<number>();
  const usedBad = new Set<number>();
  while (out.length < 3) {
    const gi = Math.floor(Math.random() * GOOD_POOL.length);
    const bi = Math.floor(Math.random() * BAD_POOL.length);
    if (usedGood.has(gi) || usedBad.has(bi)) continue;
    usedGood.add(gi);
    usedBad.add(bi);
    const good = GOOD_POOL[gi];
    const bad = BAD_POOL[bi];
    out.push({
      good,
      bad,
      goodValue: rollStatTierValue(good, tier),
      badValue: rollStatTierValue(bad, tier),
      durationMaps: rollDurationMaps(tier),
    });
  }
  return out;
}

export function rolledMapStatId(rs: RolledMapStat): string {
  return rs.good.name + "-but-" + rs.bad.name;
}

export function tierForMapsCleared(mapsCleared: number): number {
  return Math.max(1, Math.min(MAX_TIER, Math.floor((mapsCleared + 1) / 2)));
}

export { tierForLevel };

export function getActivePlayerMults(active: AppliedMapStat[]) {
  const out = {
    damageMult: 1, critRate: 0, critDamage: 1,
    moveSpeedMult: 1, maxHealthMult: 1,
    defence: 0, cooldownReduction: 0,
  };
  for (const s of active) {
    if (s.goodEffect === "damage_mult") out.damageMult += s.goodValue;
    else if (s.goodEffect === "crit_rate") out.critRate += s.goodValue;
    else if (s.goodEffect === "crit_damage") out.critDamage += s.goodValue;
    else if (s.goodEffect === "move_speed_mult") out.moveSpeedMult += s.goodValue;
    else if (s.goodEffect === "max_health_mult") out.maxHealthMult += s.goodValue;
    else if (s.goodEffect === "defence") out.defence += s.goodValue;
    else if (s.goodEffect === "cooldown_reduction") out.cooldownReduction += s.goodValue;
  }
  return out;
}

export function getActiveEnemyMults(active: AppliedMapStat[]) {
  const out = {
    damageMult: 1, critRate: 0, critDamage: 1,
    moveSpeedMult: 1, maxHealthMult: 1,
    defence: 0, cooldownReduction: 0,
  };
  for (const s of active) {
    if (s.badEffect === "damage_mult") out.damageMult += s.badValue;
    else if (s.badEffect === "crit_rate") out.critRate += s.badValue;
    else if (s.badEffect === "crit_damage") out.critDamage += s.badValue;
    else if (s.badEffect === "move_speed_mult") out.moveSpeedMult += s.badValue;
    else if (s.badEffect === "max_health_mult") out.maxHealthMult += s.badValue;
    else if (s.badEffect === "defence") out.defence += s.badValue;
    else if (s.badEffect === "cooldown_reduction") out.cooldownReduction += s.badValue;
  }
  return out;
}

export function getActiveDropRateMult(active: AppliedMapStat[]): number {
  let m = 0;
  for (const s of active) {
    if (s.goodEffect === "drop_rate_mult") m += s.goodValue;
  }
  return m;
}

export function getActiveRarityBias(active: AppliedMapStat[]): number {
  let b = 0;
  for (const s of active) {
    if (s.goodEffect === "rarity_bias") b += s.goodValue;
  }
  return b;
}

export function readAppliedStats(
  active: Iterable<{
    defId: string;
    goodName: string;
    badName: string;
    goodEffect: string;
    badEffect: string;
    goodValue: number;
    badValue: number;
    durationMaps: number;
  }>,
): AppliedMapStat[] {
  const out: AppliedMapStat[] = [];
  for (const s of active) {
    out.push({
      defId: s.defId,
      goodName: s.goodName,
      badName: s.badName,
      goodEffect: s.goodEffect as StatEffect,
      badEffect: s.badEffect as StatEffect,
      goodValue: s.goodValue,
      badValue: s.badValue,
      durationMaps: s.durationMaps,
    });
  }
  return out;
}


// ============================================================
// APPLY MAP STATS TO ENTITIES
// ============================================================

import type { Player } from "../schema/Player";
import type { Enemy } from "../schema/Enemy";

/**
 * Apply every active map-stat's GOOD component to a player.
 * Multiplies/adds onto the player's TRANSIENT multipliers + stats, then
 * re-runs the derived-stat recompute so moveSpeed etc. update.
 *
 * Effects:
 *   damage_mult          -> player.damageMultiplier += v
 *   crit_rate            -> player.critRate          += v
 *   crit_damage          -> player.critDamage        += v
 *   move_speed_mult      -> player.speedMultiplier   += v
 *   max_health_mult      -> player.maxHealth = round(player.maxHealth * (1+v))
 *                            and clamps currentHealth
 *   defence              -> player.defence           += v (clamped to [0, 0.9])
 *   cooldown_reduction   -> stored in player.cooldownReduction (read by cast code)
 *   rarity_bias / drop_rate_mult: NOT applied to player here (loot context owns those)
 */
export function applyActiveMapStatsToPlayer(
  player: Player,
  active: AppliedMapStat[],
): void {
  let hpMult = 1.0;
  let cooldownReduction = 0;
  for (const s of active) {
    const e = s.goodEffect;
    const v = s.goodValue;
    switch (e) {
      case "damage_mult":
        player.damageMultiplier += v;
        break;
      case "crit_rate":
        player.critRate += v;
        break;
      case "crit_damage":
        player.critDamage += v;
        break;
      case "move_speed_mult":
        player.speedMultiplier += v;
        break;
      case "max_health_mult":
        hpMult *= 1 + v;
        break;
      case "defence":
        player.defence = Math.min(0.9, Math.max(0, player.defence + v));
        break;
      case "cooldown_reduction":
        cooldownReduction += v;
        break;
      default:
        // rarity_bias / drop_rate_mult handled by loot context.
        break;
    }
  }
  if (hpMult !== 1.0) {
    const newMax = Math.round(player.maxHealth * hpMult);
    if (newMax !== player.maxHealth) {
      const ratio = player.maxHealth > 0 ? newMax / player.maxHealth : 1;
      player.maxHealth = newMax;
      player.currentHealth = Math.min(
        player.maxHealth,
        Math.max(1, Math.round(player.currentHealth * ratio)),
      );
    }
  }
  if (cooldownReduction > 0) {
    player.mapCooldownReduction += cooldownReduction;
  }
  player.recalcDerivedStats();
  player.recomputeShield();
}

/**
 * Apply every active map-stat's BAD component to an enemy. Mirror of
 * applyActiveMapStatsToPlayer but operating on enemy stat fields.
 */
export function applyActiveMapStatsToEnemy(
  enemy: Enemy,
  active: AppliedMapStat[],
): void {
  let hpMult = 1.0;
  for (const s of active) {
    const e = s.badEffect;
    const v = s.badValue;
    switch (e) {
      case "damage_mult":
        enemy.damageMultiplier += v;
        break;
      case "crit_rate":
        enemy.critRate += v;
        break;
      case "crit_damage":
        enemy.critDamage += v;
        break;
      case "move_speed_mult":
        enemy.speedMultiplier += v;
        break;
      case "max_health_mult":
        hpMult *= 1 + v;
        break;
      case "defence":
        enemy.defence = Math.min(0.9, Math.max(0, enemy.defence + v));
        break;
      default:
        break;
    }
  }
  if (hpMult !== 1.0) {
    const newMax = Math.round(enemy.maxHealth * hpMult);
    if (newMax !== enemy.maxHealth) {
      const ratio = enemy.maxHealth > 0 ? newMax / enemy.maxHealth : 1;
      enemy.maxHealth = newMax;
      enemy.currentHealth = Math.min(
        enemy.maxHealth,
        Math.max(1, Math.round(enemy.currentHealth * ratio)),
      );
    }
  }
  enemy.recalcDerivedStats();
}
