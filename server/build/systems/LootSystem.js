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
import { GroundCard } from "../schema/GroundCard";
import { CardInstance } from "../schema/CardInstance";
import { PREFIX_POOL, SUFFIX_POOL, UNIQUE_POOL, rarityForModCount, CARD_DROP, } from "../config/loot";
/** Zero-effect baseline (used when no card / wrong skill). */
export const NO_CARD_STATS = {
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
export const MOD_EFFECTS = {
    inc_crit_rate: (t) => ({ critRate: 0.1 * t }),
    inc_crit_damage: (t) => ({ critDamage: 0.2 * t }),
    inc_atk_damage: (t) => ({ damageMult: 1 + 0.1 * t }),
    wide_sweep: () => ({ radiusMult: 2.0, damageMult: 0.5 }),
    inc_shield_amount: () => ({}), // applied in Player.cardShieldBonus()
};
export class LootSystem {
    constructor(state) {
        this.state = state;
    }
    // ============================================================
    // ROLLING
    // ============================================================
    /**
     * Spawn-time card roll. Returns null when the enemy gets no card.
     * Card skill is drawn from the enemy's OWN skill pool (so what it
     * drops is what it casts); unique only rolls on pulse/vortex.
     */
    rollEnemyCard(enemy) {
        // 50% of enemies spawn with no card.
        if (Math.random() > CARD_DROP.SPAWN_WITH_CARD)
            return null;
        // Skill = random skill from the enemy's unlocked pool (castable ones).
        const castable = enemy.skillPool.filter((s) => s !== "shield");
        if (castable.length === 0)
            return null;
        const skill = castable[Math.floor(Math.random() * castable.length)];
        // Rarity roll.
        const rarity = this.rollRarity();
        const card = new CardInstance();
        card.skill = skill;
        card.level = enemy.skillLevels.get(skill) ?? 1;
        if (rarity === "unique") {
            // Unique: pulse/vortex only, ONE unique mod, nothing else.
            const allowed = UNIQUE_POOL.filter((u) => u.appliesTo.includes(skill));
            if (allowed.length === 0)
                return null;
            card.modIds = new ArraySchema(allowed[0].id);
            card.rarity = "unique";
            return card;
        }
        // Mod count from rarity: uncommon 1, rare 2, epic 3, legendary 4.
        const modCount = rarity === "uncommon" ? 1 : rarity === "rare" ? 2 : rarity === "epic" ? 3 : 4;
        const mods = [];
        let prefixes = 0;
        let suffixes = 0;
        for (let i = 0; i < modCount; i++) {
            // Alternate prefix/suffix fills to respect 2+2 max slots.
            const wantPrefix = i < 2 ? prefixes < 2 : suffixes < 2;
            const pool = wantPrefix
                ? PREFIX_POOL.filter((m) => m.appliesTo.length === 0 || m.appliesTo.includes(skill))
                : SUFFIX_POOL.filter((m) => m.appliesTo.length === 0 || m.appliesTo.includes(skill));
            if (pool.length === 0)
                break;
            const pick = pool[Math.floor(Math.random() * pool.length)];
            mods.push(pick.id);
            if (wantPrefix)
                prefixes++;
            else
                suffixes++;
        }
        card.modIds = new ArraySchema(...mods);
        card.rarity = rarityForModCount(prefixes, suffixes, false);
        return card;
    }
    /**
     * Elite/boss spawn: always attach a card (skip the 50% gate) rolled
     * from the same rarity table. Unique fails -> falls back to legendary.
     */
    rollEnemyCardForced(enemy) {
        const base = this.rollEnemyCard(enemy);
        if (base)
            return base;
        // No card rolled by the 50% gate: force a roll with no gate.
        const card = this.rollEnemyCardUngated(enemy);
        return card;
    }
    /** Same as rollEnemyCard but skips the 50% spawn gate. */
    rollEnemyCardUngated(enemy) {
        // Temporarily force the gate open by rolling directly.
        const castable = enemy.skillPool.filter((s) => s !== "shield");
        if (castable.length === 0)
            return null;
        const skill = castable[Math.floor(Math.random() * castable.length)];
        const rarity = this.rollRarity();
        const card = new CardInstance();
        card.skill = skill;
        card.level = enemy.skillLevels.get(skill) ?? 1;
        if (rarity === "unique") {
            const allowed = UNIQUE_POOL.filter((u) => u.appliesTo.includes(skill));
            if (allowed.length === 0)
                return this.rollEnemyCardUngated(enemy);
            card.modIds = new ArraySchema(allowed[0].id);
            card.rarity = "unique";
            return card;
        }
        const modCount = rarity === "uncommon" ? 1 : rarity === "rare" ? 2 : rarity === "epic" ? 3 : 4;
        const mods = [];
        let prefixes = 0;
        let suffixes = 0;
        for (let i = 0; i < modCount; i++) {
            const wantPrefix = i < 2 ? prefixes < 2 : suffixes < 2;
            const pool = wantPrefix
                ? PREFIX_POOL.filter((m) => m.appliesTo.length === 0 || m.appliesTo.includes(skill))
                : SUFFIX_POOL.filter((m) => m.appliesTo.length === 0 || m.appliesTo.includes(skill));
            if (pool.length === 0)
                break;
            const pick = pool[Math.floor(Math.random() * pool.length)];
            mods.push(pick.id);
            if (wantPrefix)
                prefixes++;
            else
                suffixes++;
        }
        card.modIds = new ArraySchema(...mods);
        card.rarity = rarityForModCount(prefixes, suffixes, false);
        return card;
    }
    /** Rarity roll using the configured weights. */
    rollRarity() {
        const w = CARD_DROP.RARITY_WEIGHTS;
        const total = w.common + w.uncommon + w.rare + w.epic + w.legendary + w.unique;
        let r = Math.random() * total;
        for (const key of ["unique", "legendary", "epic", "rare", "uncommon", "common"]) {
            const weight = w[key];
            r -= weight;
            if (r <= 0)
                return key;
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
    applyCardMods(card, skill) {
        if (!card || card.skill !== skill)
            return { ...NO_CARD_STATS };
        const stats = { ...NO_CARD_STATS };
        stats.damageMult = 1;
        for (const id of card.modIds) {
            const fn = MOD_EFFECTS[id];
            if (!fn)
                continue;
            const delta = fn(1); // tier 1 for now
            if (delta.critRate)
                stats.critRate += delta.critRate;
            if (delta.critDamage)
                stats.critDamage += delta.critDamage;
            if (delta.damageMult)
                stats.damageMult *= delta.damageMult;
            if (delta.radiusMult)
                stats.radiusMult *= delta.radiusMult;
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
    dropOnDeath(enemy, nextId) {
        const card = enemy.card;
        if (!card)
            return null;
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
