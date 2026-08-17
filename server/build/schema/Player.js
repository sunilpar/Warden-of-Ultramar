var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
/**
 * Player Schema
 * =============
 * The synced state for a single player.
 *
 * STAT MODEL
 * ----------
 * Stats are split into three layers so debuffs/buffs can be applied
 * cleanly without losing the player's "true" progression values:
 *
 *   1. BASE stats      — the permanent, level-grown values
 *                        (maxHealth, baseMoveSpeed, attack, critRate, ...).
 *   2. MULTIPLIERS     — transient modifiers from buffs/debuffs
 *                        (speedMultiplier, damageMultiplier, ...).
 *                        Default to 1.0 (no change). A 40% slow debuff
 *                        sets speedMultiplier = 0.6 for its duration.
 *   3. EFFECTIVE stats — computed = base * multiplier; what the simulation
 *                        and combat actually use
 *                        (moveSpeed is synced so the client can predict).
 *
 * SHIELD
 *   The shield is an equippable item (equipped by default). It absorbs
 *   damage before health. When broken (reaches 0) it begins recharging
 *   after a recovery delay. Shield amount grows with the shield SLOT level
 *   (SHIELD_LEVEL), not with a castable skill.
 *
 * EQUIPPED CARD SLOTS (the HUD)
 * -----------------------------
 * `equippedSlots` is a SYNCED array of exactly 5 entries (one per HUD
 * slot; null = empty). Each entry is a rolled CardInstance. A slot is a
 * pure skill TRIGGER: when the input bound to slot i fires, the card in
 * slot i casts its skill using ONLY that card's modifiers. Duplicates of
 * the same skill are allowed across slots — each copy casts with its own
 * mods. Skill levels (skillLevels) are derived: a skill's level = the
 * highest card level among that skill's cards across all slots.
 *
 * Only the fields marked @type are sent to clients; inputQueue is local.
 */
import { Schema, type, MapSchema, ArraySchema } from "@colyseus/schema";
import { PLAYER_STATS } from "../config/playerStats";
import { CardInstance } from "./CardInstance";
import { getSkillHitFeedback, SKILL_DEFS, } from "../config/skillDefs";
/** Number of HUD card slots (input bindings: LMB, RMB, SPC, 1, 2). */
export const NUM_CARD_SLOTS = 5;
export class Player extends Schema {
    constructor() {
        super();
        // ---- Position (synced) ----
        this.x = 0;
        this.y = 0;
        this.tick = 0;
        // ---- Health (synced) ----
        this.maxHealth = PLAYER_STATS.BASE.MAX_HEALTH;
        this.currentHealth = PLAYER_STATS.BASE.MAX_HEALTH;
        // ---- Shield (synced) — absorbs damage before health ----
        /** Current shield value (drains as it absorbs damage, recharges after a delay). */
        this.shield = 0;
        /** Maximum shield capacity (drives the HUD meter). Grows with shield slot level. */
        this.maxShield = 0;
        /**
         * Shield recharge state for the client HUD:
         *   0  = active (shield > 0, absorbing)
         *   1  = broken / recharging (waiting out the recovery delay or refilling)
         * The client uses this to hide the low-shield vignette once the shield is
         * fully broken (shield === 0 and not yet recharging).
         */
        this.shieldState = 0;
        // ---- Movement (synced) ----
        /** Effective move speed in px/sec (already includes multipliers). */
        this.moveSpeed = PLAYER_STATS.BASE.MOVE_SPEED;
        // ---- Combat (synced) ----
        this.attack = PLAYER_STATS.BASE.ATTACK;
        /** Crit chance, fraction 0..1 (0.1 = 10%). */
        this.critRate = PLAYER_STATS.BASE.CRIT_RATE;
        /** Crit damage multiplier (1.5 = 150% of base damage). */
        this.critDamage = PLAYER_STATS.BASE.CRIT_DAMAGE;
        /** Defence, fraction 0..1 (0.2 = take 20% less damage). Ignored on crits. */
        this.defence = PLAYER_STATS.BASE.DEFENCE;
        // ---- Shock status (synced) ----
        /** Server timestamp (ms) until which the player is shocked (takes more damage, slowed). */
        this.shockUntil = 0;
        // ---- Dash invincibility (synced) ----
        /** Server timestamp (ms) until which the player is invincible (dash i-frames). */
        this.invincibleUntil = 0;
        // ---- Progression (synced) ----
        this.level = 1;
        this.currentXp = 0;
        this.xpToLevelUp = PLAYER_STATS.LEVELING.LEVEL_1_XP;
        /** Unspent skill points (1 per level-up). Spend on stat or card upgrades. */
        this.skillPoints = 0;
        // ---- Base stats (NOT synced — server-authoritative source of truth) ----
        /** Permanent base move speed before debuffs/buffs. */
        this.baseMoveSpeed = PLAYER_STATS.BASE.MOVE_SPEED;
        // ---- Debuff / buff multipliers (NOT synced; server-only) ----
        /** Movement multiplier (1.0 = normal). A 40% slow = 0.6. */
        this.speedMultiplier = 1.0;
        /** Outgoing damage multiplier (1.0 = normal). */
        this.damageMultiplier = 1.0;
        /** Incoming damage multiplier (1.0 = normal). <1 = damage reduction. */
        this.incomingDamageMultiplier = 1.0;
        // ---- Input queue (local — never synced) ----
        this.inputQueue = [];
        // ---- Skill levels (synced) — DERIVED from the equipped slots.
        //      Level of a skill = highest level among that skill's cards in the
        //      HUD slots. 0 / absent = not equipped anywhere. ----
        this.skillLevels = new MapSchema();
        /**
         * Per-slot cooldown end timestamps (ms), synced for the HUD fill.
         * Every HUD slot cools down INDEPENDENTLY — duplicates of the same
         * skill each run their own cooldown, mods, and cast level.
         */
        this.slotCooldownEndsAt = new ArraySchema();
        /** Per-slot heal kill charges (kill-charged heal cards, L1-5). */
        this.slotHealKills = new ArraySchema();
        /** Server timestamp (ms) until which the player flashes white (hit feedback). */
        this.hitFlashUntil = 0;
        /** Last damage taken (for floating damage numbers on client). */
        this.lastHitDamage = 0;
        /** Whether the last hit was a critical hit. */
        this.lastHitCrit = false;
        /** True if the last hit taken was absorbed by shield (drives blue flash). */
        this.lastHitShielded = false;
        /** Monotonic counter — increments every time damage is taken (so client can detect new hits). */
        this.hitSeq = 0;
        /** Server timestamp (ms) until which the player is frozen (hit-stun). */
        this.pausedUntil = 0;
        /** Hitbox half-width (rectangle, synced for debug overlay). */
        this.hitboxW = 9;
        /** Hitbox half-height (rectangle, synced for debug overlay). */
        this.hitboxH = 20;
        /** Server timestamp (ms) until which the player is bleeding (DoT). */
        this.bleedUntil = 0;
        // ---- Per-slot cooldowns (NOT synced) — remaining seconds per slot. ----
        this.slotCooldownRemaining = [0, 0, 0, 0, 0];
        /** Bleed damage per second (server-only; applied while bleedUntil > now). */
        this.bleedDps = 0;
        /** Damage per bleed tick (10% of claw damage). */
        this.bleedTickDamage = 0;
        /** Whether the bleed is a critical bleed (from crit claw hit). */
        this.bleedIsCrit = false;
        this.bleedTickAccum = 0;
        // ---- Shield internals ----
        /** Shield STAT level (controls shield amount). +20 shield per stat level.
         *  Grows automatically with player level (levelUp increments this). */
        this.shieldStatLevel = 1;
        /**
         * THE HUD. Synced array of exactly NUM_CARD_SLOTS entries. Each entry is
         * the CardInstance equipped in that HUD slot; an EMPTY slot is a
         * CardInstance sentinel with skill === "" (ArraySchema cannot hold
         * nulls). Slots are skill triggers — the card's skill is cast with the
         * card's own mods when the slot's input fires. Duplicate skills are
         * allowed; each slot is independent.
         */
        this.equippedSlots = new ArraySchema();
        /** Shield CARD/SLOT level (controls recovery delay). Lower delay per level.
         *  Upgraded via the C-tab / message 6 (stat === "shield"). */
        this.shieldCardLevel = 1;
        /**
         * Server timestamp (ms) at which the broken shield begins recharging.
         * Set to (now + recoveryDelay) whenever the shield breaks or takes a hit
         * while at 0. While Date.now() < this value, no recharge happens.
         */
        this.shieldRechargeAt = 0;
        // Fixed-size HUD: 5 entries, all empty sentinels to start.
        // (ArraySchema cannot hold nulls — an empty slot is a CardInstance
        // with skill === ""; only access slots through the helpers below.)
        for (let i = 0; i < NUM_CARD_SLOTS; i++) {
            this.equippedSlots.push(new CardInstance());
            this.slotCooldownEndsAt.push(0);
            this.slotHealKills.push(0);
        }
    }
    // ============================================================
    // LIFECYCLE
    // ============================================================
    /** Re-sync the level-1 base stats onto this player. Call on spawn. */
    initBaseStats() {
        this.maxHealth = PLAYER_STATS.BASE.MAX_HEALTH;
        this.currentHealth = this.maxHealth;
        this.baseMoveSpeed = PLAYER_STATS.BASE.MOVE_SPEED;
        this.moveSpeed = this.baseMoveSpeed;
        this.attack = PLAYER_STATS.BASE.ATTACK;
        this.critRate = PLAYER_STATS.BASE.CRIT_RATE;
        this.critDamage = PLAYER_STATS.BASE.CRIT_DAMAGE;
        this.defence = PLAYER_STATS.BASE.DEFENCE;
        this.level = 1;
        this.currentXp = 0;
        this.xpToLevelUp = PLAYER_STATS.LEVELING.LEVEL_1_XP;
        this.skillPoints = 0;
        // Reset transient multipliers
        this.speedMultiplier = 1.0;
        this.damageMultiplier = 1.0;
        this.incomingDamageMultiplier = 1.0;
        // Reset per-slot cooldowns + heal charges
        this.resetSlotCooldowns();
        // Default shield: stat level 1 (controls amount), card level 1 (controls recovery)
        this.shieldStatLevel = 1;
        this.shieldCardLevel = 1;
        this.recomputeShield();
        this.invincibleUntil = 0;
    }
    // ============================================================
    // SHIELD
    // ============================================================
    /**
     * Recompute shield from the separate stat (amount) and card (recovery) levels.
     * - maxShield = SHIELD_STAT.BASE_AMOUNT + (shieldStatLevel - 1) * SHIELD_STAT.AMOUNT_PER_LEVEL
     * - Recovery delay = SHIELD_CARD.BASE_DELAY - (shieldCardLevel - 1) * REDUCTION
     * Called on spawn, respawn, and levelUp.
     */
    recomputeShield() {
        const S = PLAYER_STATS.SHIELD_STAT;
        this.maxShield =
            S.BASE_AMOUNT +
                (this.shieldStatLevel - 1) * S.AMOUNT_PER_LEVEL +
                this.cardShieldBonus();
        this.shield = this.maxShield;
        this.shieldRechargeAt = 0;
        this.shieldState = 0;
    }
    /** Recovery delay (seconds) for the current shield CARD/SLOT level. */
    shieldRecoveryDelay() {
        const S = PLAYER_STATS.SHIELD_CARD;
        return Math.max(S.MIN_RECOVERY_DELAY, S.BASE_RECOVERY_DELAY -
            S.RECOVERY_DELAY_REDUCTION_PER_LEVEL * (this.shieldCardLevel - 1));
    }
    /**
     * Advance shield recovery by `dt` seconds (called each fixedTick).
     * While the shield is at 0, wait out the recovery delay; then recharge a
     * fraction of maxShield per second until full. Once full, mark active.
     */
    tickShield(dt) {
        if (this.shieldStatLevel <= 0 || this.maxShield <= 0)
            return;
        // Already full — active.
        if (this.shield >= this.maxShield) {
            this.shield = this.maxShield;
            this.shieldState = 0;
            return;
        }
        const now = Date.now();
        // Waiting out the recovery delay (broken shield).
        if (now < this.shieldRechargeAt) {
            this.shieldState = 1;
            return;
        }
        // Recharging.
        this.shieldState = 1;
        const recharge = this.maxShield * PLAYER_STATS.SHIELD_CARD.RECHARGE_RATE * dt;
        this.shield = Math.min(this.maxShield, this.shield + recharge);
        if (this.shield >= this.maxShield) {
            this.shield = this.maxShield;
            this.shieldState = 0; // fully recharged -> active again
        }
    }
    /** Spend a skill point to upgrade the shield CARD/SLOT (faster recovery).
     *  Does NOT affect shield amount — shield amount is stat-based (grows with level). */
    /** Max shield card/slot level (recovery can't be upgraded past this). */
    static { this.MAX_SHIELD_CARD_LEVEL = 10; }
    upgradeShieldSlot() {
        if (this.shieldCardLevel >= Player.MAX_SHIELD_CARD_LEVEL)
            return;
        this.shieldCardLevel += 1;
        this.recomputeShield();
    }
    // ============================================================
    // DERIVED-STAT RECOMPUTE
    // ============================================================
    /**
     * Recompute effective stats from base + multipliers.
     * Call this whenever a base stat or a multiplier changes
     * (e.g. applying/removing a debuff, leveling up).
     */
    recalcDerivedStats() {
        let speed = this.speedMultiplier;
        // Shock slows movement by 50%.
        if (Date.now() < this.shockUntil)
            speed *= 0.5;
        this.moveSpeed = this.baseMoveSpeed * speed;
    }
    // ============================================================
    // HEALTH
    // ============================================================
    /** Apply damage to the player (respects incomingDamageMultiplier).
     *  Shield absorbs first, then health. sourceSkillId controls the
     *  hit-feedback duration (flash + pause). */
    takeDamage(rawDamage, sourceSkillId, _attackerId, isCrit = false) {
        if (Date.now() < this.invincibleUntil)
            return 0;
        // Defence reduces incoming damage. Crits bypass only 50% of defence.
        // Shock reduces defence by 20% (can go negative = bonus damage).
        const isShocked = Date.now() < this.shockUntil;
        const shockMod = isShocked ? -0.2 : 0.0;
        const effectiveDefence = (isCrit ? this.defence * 0.5 : this.defence) + shockMod;
        const mitigated = rawDamage * (1.0 - effectiveDefence);
        let dmg = mitigated * this.incomingDamageMultiplier;
        let shielded = false;
        let totalShieldAbsorbed = 0;
        // Shield absorbs first.
        if (this.shield > 0) {
            const absorbed = Math.min(this.shield, dmg);
            if (absorbed > 0) {
                shielded = true;
                totalShieldAbsorbed = absorbed;
            }
            this.shield -= absorbed;
            dmg -= absorbed;
            // ANY damage to the shield re-arms the recovery delay. The shield only
            // starts regenerating after the full delay passes with no new damage.
            if (absorbed > 0) {
                this.shieldRechargeAt = Date.now() + this.shieldRecoveryDelay() * 1000;
                this.shieldState = 1;
            }
            if (this.shield <= 0) {
                this.shield = 0;
            }
        }
        else {
            // No shield: keep the recovery delay armed from the last break so a
            // steady stream of hits doesn't begin recharging mid-combat.
            if (this.shieldCardLevel > 0 && this.shieldRechargeAt < Date.now()) {
                this.shieldRechargeAt = Date.now() + this.shieldRecoveryDelay() * 1000;
            }
        }
        this.currentHealth = Math.max(0, this.currentHealth - dmg);
        // Hit feedback: white flash + hit-stun — ALWAYS show on damage.
        const fbMs = Math.max(150, sourceSkillId ? getSkillHitFeedback(sourceSkillId) : 100);
        const now = Date.now();
        this.hitFlashUntil = Math.max(this.hitFlashUntil, now + fbMs);
        // Hit-stun removed — only flash, no movement freeze.
        // Record last hit for client-side damage numbers.
        const finalDmg = mitigated * this.incomingDamageMultiplier;
        this.lastHitDamage = Math.round(finalDmg);
        this.lastHitCrit = isCrit;
        this.lastHitShielded = shielded;
        this.lastShieldDamage = totalShieldAbsorbed;
        this.lastHpDamage = finalDmg - totalShieldAbsorbed;
        this.hitSeq += 1;
        return finalDmg;
    }
    /** Heal the player (clamped to maxHealth). Returns amount healed. */
    heal(amount) {
        const before = this.currentHealth;
        this.currentHealth = Math.min(this.maxHealth, before + amount);
        return this.currentHealth - before;
    }
    get isDead() {
        return this.currentHealth <= 0;
    }
    // ============================================================
    // XP / LEVEL
    // ============================================================
    /**
     * Add XP, leveling up as many times as needed.
     * Applies per-level stat growth + level-up heal.
     * Returns the number of levels gained.
     */
    addXp(amount) {
        this.currentXp += amount;
        let levelsGained = 0;
        while (this.currentXp >= this.xpToLevelUp) {
            this.currentXp -= this.xpToLevelUp;
            this.levelUp();
            levelsGained++;
        }
        return levelsGained;
    }
    /** Advance exactly one level: grow stats + bump the XP threshold. */
    levelUp() {
        this.level += 1;
        this.skillPoints += 1;
        const g = PLAYER_STATS.LEVELING.GROWTH;
        this.maxHealth += g.MAX_HEALTH;
        this.attack += g.ATTACK;
        this.critRate += g.CRIT_RATE;
        this.critDamage += g.CRIT_DAMAGE;
        this.baseMoveSpeed += g.MOVE_SPEED;
        // Recompute the XP required for the NEXT level
        this.xpToLevelUp = PLAYER_STATS.LEVELING.xpForNextLevel(this.level);
        // Shield stat grows with each level (+20 shield per level)
        this.shieldStatLevel += 1;
        this.recomputeShield();
        // Heal on level up
        this.heal(this.maxHealth * PLAYER_STATS.LEVELING.HEAL_ON_LEVEL_UP);
        this.recalcDerivedStats();
    }
    // ============================================================
    // DEATH / RESPAWN
    // ============================================================
    /**
     * Mark the player as dead: halve current XP and set HP to 0.
     * Called by the game loop when currentHealth reaches 0.
     */
    die() {
        this.currentHealth = 0;
        // Death penalty: halve current XP.
        this.currentXp = Math.floor(this.currentXp / 2);
    }
    /**
     * Respawn: reset to full health, reset XP/level to base stats, and
     * empty every HUD slot (death wipes equipped cards — they must be found
     * again). Derived skill levels drop to 0 until re-equipped.
     */
    respawn() {
        this.initBaseStats();
        // Death is the only thing that wipes equipped loot cards: empty all slots.
        this.clearSlots();
        this.resetSlotCooldowns();
        // Clear bleed
        this.bleedUntil = 0;
        this.bleedDps = 0;
        this.invincibleUntil = 0;
    }
    // ============================================================
    // SKILLS (levels derived from equipped slots)
    // ============================================================
    /** Get a skill's level (0 if not equipped in any slot). */
    getSkillLevel(skill) {
        return this.skillLevels.get(skill) ?? 0;
    }
    /** Set a skill's level directly (clamped to >=1). Debug/back-compat only. */
    setSkillLevel(skill, level) {
        this.skillLevels.set(skill, Math.max(1, Math.floor(level)));
    }
    /**
     * Recompute the derived skill-level map from the equipped slots.
     * A skill's level = the HIGHEST level among its cards in all slots.
     * Skills with no card anywhere are removed (level 0).
     * Called automatically after ANY equippedSlots change.
     */
    recomputeSkillLevels() {
        const highest = new Map();
        for (const card of this.equippedSlots) {
            if (!card || !card.skill)
                continue;
            const s = card.skill;
            const lvl = Math.max(1, Math.floor(card.level || 1));
            const cur = highest.get(s) ?? 0;
            if (lvl > cur)
                highest.set(s, lvl);
        }
        this.skillLevels.clear();
        highest.forEach((lvl, skill) => this.skillLevels.set(skill, lvl));
    }
    // ============================================================
    // EQUIPPED SLOT OPERATIONS (the HUD)
    // ============================================================
    /** The card in slot i, or null when the slot is empty. */
    slotCard(i) {
        const c = this.equippedSlots[i];
        return c && c.skill ? c : null;
    }
    /** True if slot i holds a card. */
    hasSlotCard(i) {
        return this.slotCard(i) !== null;
    }
    /**
     * Place a card into slot i (0..4). Returns the card that previously
     * occupied the slot (null when it was empty) — the CALLER is responsible
     * for dropping that card to the ground (replace = swap-out rule).
     * On an invalid index the card is returned unchanged so the caller can
     * abort without losing it.
     */
    setSlotCard(i, card) {
        if (i < 0 || i >= NUM_CARD_SLOTS)
            return card;
        const old = this.slotCard(i);
        this.equippedSlots[i] = card;
        this.onSlotsChanged();
        return old;
    }
    /** Remove + return the card in slot i (null when empty). The slot gets
     *  a fresh empty sentinel; the returned card is INTACT — its skill,
     *  level, rarity and mods survive so it can drop to the ground. */
    clearSlotCard(i) {
        if (i < 0 || i >= NUM_CARD_SLOTS)
            return null;
        const old = this.slotCard(i);
        if (!old)
            return null;
        this.equippedSlots[i] = new CardInstance();
        this.onSlotsChanged();
        return old;
    }
    /** Reset a CardInstance to the empty-slot sentinel state (synced). */
    emptyCardInPlace(c) {
        c.skill = "";
        c.level = 1;
        c.rarity = "common";
        c.modIds.clear();
    }
    /** Empty all slots (death). */
    clearSlots() {
        for (let i = 0; i < NUM_CARD_SLOTS; i++) {
            const c = this.equippedSlots[i];
            if (c && c.skill)
                this.emptyCardInPlace(c);
        }
        this.recomputeSkillLevels();
        this.recomputeShield();
    }
    /** Shared post-change hook: derive skill levels + refresh shield bonus. */
    onSlotsChanged() {
        this.recomputeSkillLevels();
        this.recomputeShield();
    }
    /** First slot containing a card for `skill` (search 0..4), or -1. */
    firstSlotWithSkill(skill) {
        for (let i = 0; i < this.equippedSlots.length; i++) {
            const c = this.equippedSlots[i];
            if (c && c.skill === skill)
                return i;
        }
        return -1;
    }
    // ============================================================
    // CARD MODIFIER HELPERS (per slot — mods come from THAT slot's card)
    // ============================================================
    /** Crit-rate bonus from the card in slot i. */
    slotCritRateBonus(i) {
        const c = this.slotCard(i);
        if (!c)
            return 0;
        return c.modIds.filter((m) => m === "inc_crit_rate").length * 0.1;
    }
    /** Crit-damage bonus from the card in slot i. */
    slotCritDamageBonus(i) {
        const c = this.slotCard(i);
        if (!c)
            return 0;
        return c.modIds.filter((m) => m === "inc_crit_damage").length * 0.2;
    }
    /** Skill-damage multiplier from the card in slot i (inc_atk_damage). */
    slotDamageBonus(i) {
        const c = this.slotCard(i);
        if (!c)
            return 1;
        return 1 + c.modIds.filter((m) => m === "inc_atk_damage").length * 0.1;
    }
    /** Radius multiplier from the card in slot i (unique wide_sweep -> 2x). */
    slotRadiusMult(i) {
        const c = this.slotCard(i);
        if (!c)
            return 1;
        return c.modIds.includes("wide_sweep") ? 2.0 : 1;
    }
    /** Damage multiplier from the unique wide_sweep in slot i (0.5 when present). */
    slotUniqueDamageMult(i) {
        const c = this.slotCard(i);
        if (!c)
            return 1;
        return c.modIds.includes("wide_sweep") ? 0.5 : 1;
    }
    /** Flat shield bonus from ALL equipped shield cards (any slot). */
    cardShieldBonus() {
        let bonus = 0;
        for (const card of this.equippedSlots) {
            if (!card || !card.skill)
                continue;
            if (card.skill === "shield") {
                bonus +=
                    card.modIds.filter((m) => m === "inc_shield_amount").length * 100;
            }
        }
        return bonus;
    }
    /** Advance a skill's level by 1 (upgrades its highest-level card). */
    upgradeSkill(skill) {
        // Upgrade EVERY card of that skill so duplicates stay in sync.
        for (const c of this.equippedSlots) {
            if (!c || c.skill !== skill || !c.skill)
                continue;
            c.level = Math.min(10, Math.max(1, c.level + 1));
        }
        this.recomputeSkillLevels();
    }
    /** Advance ALL equipped skills by 1 (debug key). */
    upgradeAllSkills() {
        for (const c of this.equippedSlots) {
            if (!c || !c.skill)
                continue;
            c.level = Math.min(10, Math.max(1, c.level + 1));
        }
        this.recomputeSkillLevels();
    }
    /** Kill threshold for a kill-charged heal card (L1-2: 4, L3-5: 3). */
    healKillThreshold(level) {
        return level <= 2 ? 4 : 3;
    }
    /**
     * True if slot i is ready: its cooldown has elapsed AND (for a
     * kill-charged heal card) its kill charge is full. Slots are fully
     * independent — a shock on cooldown in slot 0 never blocks the shock
     * in slot 1.
     */
    isSlotReady(i) {
        if (i < 0 || i >= NUM_CARD_SLOTS)
            return false;
        if ((this.slotCooldownRemaining[i] ?? 0) > 0)
            return false;
        const c = this.equippedSlots[i];
        if (c &&
            c.skill === "heal" &&
            c.level < SKILL_DEFS.heal.aoeUnlockLevel) {
            return (this.slotHealKills[i] ?? 0) >= this.healKillThreshold(c.level);
        }
        return true;
    }
    /** Put slot i on cooldown (seconds). Stamps the synced end-time for
     *  the HUD fill. Only THIS slot is affected. */
    startSlotCooldown(i, cooldown) {
        if (i < 0 || i >= NUM_CARD_SLOTS)
            return;
        this.slotCooldownRemaining[i] = cooldown;
        this.slotCooldownEndsAt[i] = Date.now() + cooldown * 1000;
    }
    /** Consume a kill-charged heal's charge in slot i. */
    consumeHealCharge(i) {
        if (i < 0 || i >= NUM_CARD_SLOTS)
            return;
        this.slotHealKills[i] = 0;
    }
    /** Register a kill: charges every kill-charged heal card that is not
     *  full yet (each slot charges independently from the same kills). */
    addHealKill() {
        for (let i = 0; i < NUM_CARD_SLOTS; i++) {
            const c = this.equippedSlots[i];
            if (!c || c.skill !== "heal")
                continue;
            if (c.level >= SKILL_DEFS.heal.aoeUnlockLevel)
                continue; // cd-based
            const threshold = this.healKillThreshold(c.level);
            const kills = this.slotHealKills[i] ?? 0;
            if (kills < threshold)
                this.slotHealKills[i] = kills + 1;
        }
    }
    /** Advance every slot cooldown by dt seconds (clamped at 0). */
    tickSlotCooldowns(dt) {
        for (let i = 0; i < NUM_CARD_SLOTS; i++) {
            const cd = this.slotCooldownRemaining[i] ?? 0;
            if (cd > 0)
                this.slotCooldownRemaining[i] = Math.max(0, cd - dt);
        }
    }
    /** Reset all slot cooldowns + heal charges (spawn / respawn). */
    resetSlotCooldowns() {
        for (let i = 0; i < NUM_CARD_SLOTS; i++) {
            this.slotCooldownRemaining[i] = 0;
            this.slotCooldownEndsAt[i] = 0;
            this.slotHealKills[i] = 0;
        }
    }
    /**
     * Advance bleed DoT: apply bleedTickDamage every 0.5s while active.
     * Returns true if the player died from bleed this tick.
     */
    tickBleed(dt) {
        if (this.bleedUntil <= 0) {
            this.bleedTickAccum = 0;
            return false;
        }
        const now = Date.now();
        if (now >= this.bleedUntil) {
            this.bleedUntil = 0;
            this.bleedDps = 0;
            this.bleedTickDamage = 0;
            this.bleedTickAccum = 0;
            return false;
        }
        // Tick bleed damage twice per second (every 0.5s).
        // BLEED BYPASSES SHIELD — damages HP directly.
        this.bleedTickAccum += dt;
        if (this.bleedTickAccum >= 0.5) {
            this.bleedTickAccum -= 0.5;
            this.currentHealth = Math.max(0, this.currentHealth - this.bleedTickDamage);
            this.lastHitCrit = this.bleedIsCrit;
            this.lastHitShielded = false;
            this.lastShieldDamage = 0;
            this.lastHpDamage = this.bleedTickDamage;
            this.lastHitDamage = this.bleedTickDamage;
            this.hitSeq += 1;
            this.hitFlashUntil = Math.max(this.hitFlashUntil, Date.now() + 100);
            return this.isDead;
        }
        return false;
    }
    /** Inflict bleed: set tick damage + crit status + until timestamp. */
    applyBleed(tickDamage, durationSec, _attackerId, isCritBleed) {
        this.bleedTickDamage = tickDamage;
        this.bleedDps = tickDamage * 2; // backwards compat
        this.bleedIsCrit = isCritBleed ?? false;
        this.bleedUntil = Date.now() + durationSec * 1000;
        this.bleedTickAccum = 0;
    }
}
__decorate([
    type("number")
], Player.prototype, "x", void 0);
__decorate([
    type("number")
], Player.prototype, "y", void 0);
__decorate([
    type("number")
], Player.prototype, "tick", void 0);
__decorate([
    type("number")
], Player.prototype, "maxHealth", void 0);
__decorate([
    type("number")
], Player.prototype, "currentHealth", void 0);
__decorate([
    type("number")
], Player.prototype, "shield", void 0);
__decorate([
    type("number")
], Player.prototype, "maxShield", void 0);
__decorate([
    type("number")
], Player.prototype, "shieldState", void 0);
__decorate([
    type("number")
], Player.prototype, "moveSpeed", void 0);
__decorate([
    type("number")
], Player.prototype, "attack", void 0);
__decorate([
    type("number")
], Player.prototype, "critRate", void 0);
__decorate([
    type("number")
], Player.prototype, "critDamage", void 0);
__decorate([
    type("number")
], Player.prototype, "defence", void 0);
__decorate([
    type("number")
], Player.prototype, "shockUntil", void 0);
__decorate([
    type("number")
], Player.prototype, "invincibleUntil", void 0);
__decorate([
    type("number")
], Player.prototype, "level", void 0);
__decorate([
    type("number")
], Player.prototype, "currentXp", void 0);
__decorate([
    type("number")
], Player.prototype, "xpToLevelUp", void 0);
__decorate([
    type("number")
], Player.prototype, "skillPoints", void 0);
__decorate([
    type({ map: "number" })
], Player.prototype, "skillLevels", void 0);
__decorate([
    type(["number"])
], Player.prototype, "slotCooldownEndsAt", void 0);
__decorate([
    type(["number"])
], Player.prototype, "slotHealKills", void 0);
__decorate([
    type("number")
], Player.prototype, "hitFlashUntil", void 0);
__decorate([
    type("number")
], Player.prototype, "lastHitDamage", void 0);
__decorate([
    type("boolean")
], Player.prototype, "lastHitCrit", void 0);
__decorate([
    type("boolean")
], Player.prototype, "lastHitShielded", void 0);
__decorate([
    type("number")
], Player.prototype, "hitSeq", void 0);
__decorate([
    type("number")
], Player.prototype, "hitboxW", void 0);
__decorate([
    type("number")
], Player.prototype, "hitboxH", void 0);
__decorate([
    type("number")
], Player.prototype, "bleedUntil", void 0);
__decorate([
    type("number")
], Player.prototype, "shieldStatLevel", void 0);
__decorate([
    type([CardInstance])
], Player.prototype, "equippedSlots", void 0);
__decorate([
    type("number")
], Player.prototype, "shieldCardLevel", void 0);
