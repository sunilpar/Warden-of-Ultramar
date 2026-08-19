/**
 * Loot System
 * ===========
 * Card loot lifecycle:
 *   1. rollEnemyCard()  - enemy spawn: 50% chance a card, then rarity.
 *   2. applyCardMods()  - cast time: converts mod ids into stat deltas.
 *   3. dropOnDeath()    - enemy death: uncommon+ cards drop to ground.
 *
 * Each modifier id has its own effect function in MOD_EFFECTS so every
 * mod's numeric logic lives in exactly one place.
 */

import { ArraySchema } from "@colyseus/schema";
import { RoomState } from "../schema/RoomState";
import { GroundCard } from "../schema/GroundCard";
import { CardInstance } from "../schema/CardInstance";
import { Enemy } from "../schema/Enemy";
import {
  PREFIX_POOL,
  SUFFIX_POOL,
  UNIQUE_POOL,
  rarityForModCount,
  CARD_DROP,
  type Rarity,
} from "../config/loot";
import { type SkillId } from "../config/skillDefs";
import { tierForLevel, rollModValue } from "../config/lootTiers";

/** Cast-time stat deltas produced from a card's mods. */
export interface CardStats {
  critRate: number;
  critDamage: number;
  damageMult: number;
  radiusMult: number;
}

/** Zero-effect baseline (used when no card / wrong skill). */
export const NO_CARD_STATS: CardStats = {
  critRate: 0,
  critDamage: 0,
  damageMult: 1,
  radiusMult: 1,
};

/**
 * Per-mod effect functions. Each returns the delta it adds to the cast
 * stats for the skill it is rolled on. The signature is (tier) so tiers
 * can scale values later without touching call sites.
 */
export const MOD_EFFECTS: Record<string, (tier: number) => Partial<CardStats>> = {
  inc_crit_rate: (t) => ({ critRate: 0.1 * t }),
  inc_crit_damage: (t) => ({ critDamage: 0.2 * t }),
  inc_atk_damage: (t) => ({ damageMult: 1 + 0.1 * t }),
  wide_sweep: () => ({ radiusMult: 2.0, damageMult: 0.5 }),
  inc_shield_amount: () => ({}), // applied in Player.cardShieldBonus()
};

export class LootSystem {
  constructor(private state: RoomState) {}

  /**
   * Roll and attach per-mod values for a freshly built card. The tier is
   * derived from the enemy's LEVEL (map level will factor in later), so a
   * legendary dropped by a level-1 enemy rolls tier-1 values on all mods.
   */
  private attachModValues(card: CardInstance, level: number): CardInstance {
    const tier = tierForLevel(level);
    const values: number[] = [];
    for (const id of card.modIds) {
      values.push(rollModValue(id, tier));
    }
    card.modValues = new ArraySchema<number>(...values);
    return card;
  }

  // ============================================================
  // ROLLING
  // ============================================================

  /**
   * Spawn-time card roll. Returns null when the enemy gets no card.
   * Card skill is drawn from the enemy's OWN skill pool (so what it
   * drops is what it casts); unique only rolls on pulse/vortex.
   */
  rollEnemyCard(enemy: Enemy): CardInstance | null {
    return this.rollEnemyCardInner(enemy, true);
  }

  /**
   * Elite/boss spawn: always attach a card (skip the 50% gate) rolled
   * from the same rarity table. Unique fails -> falls back to legendary.
   */
  rollEnemyCardForced(enemy: Enemy): CardInstance | null {
    return this.rollEnemyCardInner(enemy, false);
  }

  /**
   * Shared roll body. `gate` = apply the 50% spawn-with-card chance.
   * Unique rarity forces the card's skill to pulse/vortex when the enemy
   * can cast either (mechanicus); enemies with neither fall back to a
   * legendary mod roll instead of dropping nothing.
   */
  private rollEnemyCardInner(enemy: Enemy, gate: boolean): CardInstance | null {
    // 50% of enemies spawn with no card.
    if (gate && Math.random() > CARD_DROP.SPAWN_WITH_CARD) return null;

    // Skill = random skill from the enemy's unlocked pool (castable ones).
    const castable = enemy.skillPool.filter((s) => s !== "shield");
    if (castable.length === 0) return null;
    const skill = castable[Math.floor(Math.random() * castable.length)];

    // Rarity roll.
    const rarity = this.rollRarity();

    if (rarity === "unique") {
      // Unique: pulse/vortex only, ONE unique mod, nothing else. If the
      // rolled skill can't host it, re-point at ANY unlocked pulse/vortex
      // so mechanicus uniques actually drop.
      const allowed = UNIQUE_POOL.filter((u) => u.appliesTo.includes(skill));
      if (allowed.length > 0) {
        const card = new CardInstance();
        card.skill = skill;
        card.level = enemy.skillLevels.get(skill) ?? 1;
        card.modIds = new ArraySchema<string>(allowed[0].id);
        card.rarity = "unique";
        this.attachModValues(card, enemy.level);
        return card;
      }
      const uniSkill = castable.find((sk) =>
        UNIQUE_POOL.some((u) => u.appliesTo.includes(sk)),
      );
      if (uniSkill) {
        const uni = UNIQUE_POOL.find((u) => u.appliesTo.includes(uniSkill))!;
        const card = new CardInstance();
        card.skill = uniSkill;
        card.level = enemy.skillLevels.get(uniSkill) ?? 1;
        card.modIds = new ArraySchema<string>(uni.id);
        card.rarity = "unique";
        this.attachModValues(card, enemy.level);
        return card;
      }
      // Enemy has no pulse/vortex: degrade to a legendary mod roll.
      return this.rollModdedCard(enemy, skill, 4);
    }

    // Mod count from rarity: uncommon 1, rare 2, epic 3, legendary 4.
    const modCount =
      rarity === "uncommon" ? 1 : rarity === "rare" ? 2 : rarity === "epic" ? 3 : 4;
    return this.rollModdedCard(enemy, skill, modCount);
  }

  /**
   * Roll a normal (non-unique) card with `modCount` mods on `skill`.
   * Rarity is re-derived from the actual prefix/suffix counts.
   */
  private rollModdedCard(
    enemy: Enemy,
    skill: SkillId,
    modCount: number,
  ): CardInstance {
    const card = new CardInstance();
    card.skill = skill;
    card.level = enemy.skillLevels.get(skill) ?? 1;
    const mods: string[] = [];
    let prefixes = 0;
    let suffixes = 0;
    for (let i = 0; i < modCount; i++) {
      // Fill prefix/suffix slots randomly (while respecting the 2+2 max)
      // so offensive AND defensive/utility mods can drop at every rarity.
      const canPrefix = prefixes < 2;
      const canSuffix = suffixes < 2;
      if (!canPrefix && !canSuffix) break;
      const wantPrefix =
        canPrefix && canSuffix ? Math.random() < 0.5 : canPrefix;
      const pool = wantPrefix
        ? PREFIX_POOL.filter(
            (m) => m.appliesTo.length === 0 || m.appliesTo.includes(skill),
          )
        : SUFFIX_POOL.filter(
            (m) => m.appliesTo.length === 0 || m.appliesTo.includes(skill),
          );
      if (pool.length === 0) break;
      const pick = pool[Math.floor(Math.random() * pool.length)];
      mods.push(pick.id);
      if (wantPrefix) prefixes++;
      else suffixes++;
    }
    card.modIds = new ArraySchema<string>(...mods);
    card.rarity = rarityForModCount(prefixes, suffixes, false);
    this.attachModValues(card, enemy.level);
    return card;
  }

  /** Rarity roll using the configured weights. */
  private rollRarity(): Rarity {
    const w = CARD_DROP.RARITY_WEIGHTS;
    const total =
      w.common + w.uncommon + w.rare + w.epic + w.legendary + w.unique;
    let r = Math.random() * total;
    for (const key of ["unique", "legendary", "epic", "rare", "uncommon", "common"] as Rarity[]) {
      const weight = (w as any)[key];
      r -= weight;
      if (r <= 0) return key;
    }
    return "common";
  }

  // ============================================================
  // CAST-TIME MOD APPLICATION
  // ============================================================

  /**
   * Convert a card's mod ids into cast stat deltas. `skill` must match
   * the card's skill - mods only apply to the card's own skill.
   */
  applyCardMods(card: CardInstance | null, skill: SkillId): CardStats {
    if (!card || card.skill !== skill) return { ...NO_CARD_STATS };
    const stats: CardStats = { ...NO_CARD_STATS };
    stats.damageMult = 1;
    for (const id of card.modIds) {
      const fn = MOD_EFFECTS[id];
      if (!fn) continue;
      const delta = fn(1); // tier 1 for now
      if (delta.critRate) stats.critRate += delta.critRate;
      if (delta.critDamage) stats.critDamage += delta.critDamage;
      if (delta.damageMult) stats.damageMult *= delta.damageMult;
      if (delta.radiusMult) stats.radiusMult *= delta.radiusMult;
    }
    return stats;
  }

  // ============================================================
  // DROPS
  // ============================================================

  /**
   * Enemy death: drop the enemy's card to the ground (uncommon+ only).
   * Returns the created GroundCard id or null.
   */
  dropOnDeath(enemy: Enemy, nextId: () => string): string | null {
    const card = enemy.card;
    if (!card) return null;
    if (CARD_DROP.DROP_ONLY_UNCOMMON_PLUS && card.rarity === "common") {
      return null;
    }
    const gc = new GroundCard();
    gc.skill = card.skill;
    gc.level = card.level;
    gc.x = enemy.x;
    gc.y = enemy.y;
    gc.card = card;
    gc.pickupLockUntil = Date.now() + 500;
    this.state.groundCards.set(nextId(), gc);
    return gc.skill;
  }
}
