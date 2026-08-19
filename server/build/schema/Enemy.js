var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
/**
 * Enemy Schema
 * ============
 * The synced state for a single enemy.
 *
 * Stat model mirrors the player (see Player.ts):
 *   1. BASE stats      — level-grown values (maxHealth, baseMoveSpeed, attack)
 *   2. MULTIPLIERS     — transient (speedMultiplier, damageMultiplier,
 *                        incomingDamageMultiplier). Default 1.0.
 *   3. EFFECTIVE stats — computed = base * multiplier (moveSpeed is synced so
 *                        the client can interpolate/render).
 *
 * Level determines base damage, move speed, hp, skill cooldowns, etc. Skills
 * are drawn from a shared pool (same SkillId space as the player) and gated
 * by per-skill cooldowns tracked server-side.
 *
 * SKILL POOL & SKILL LEVELS
 *   The config declares an ORDERED `potentialSkills` list. At init, the enemy
 *   unlocks the first `1 + floor(level / 5)` entries into `skillPool`. The
 *   enemy's level is then distributed randomly across the unlocked skills as
 *   per-skill levels (each capped at MAX_SKILL_LEVEL). `skillLevels` maps a
 *   SkillId to its current level; EnemySystem reads it when casting.
 */
import { Schema, type } from "@colyseus/schema";
import { getSkillHitFeedback, MAX_SKILL_LEVEL, } from "../config/skillDefs";
import { ENEMY_STATS } from "../config/enemyStats";
export class Enemy extends Schema {
    constructor() {
        super(...arguments);
        // ---- Identity (synced) ----
        /** Enemy type id (e.g. "tyranid"). Client uses this to pick the sprite. */
        this.typeId = "tyranid";
        /** Display title. */
        this.title = "";
        /** Description. */
        this.description = "";
        // ---- Position (synced) ----
        this.x = 0;
        this.y = 0;
        this.tick = 0;
        // ---- Level (synced) — drives damage, move speed, hp, skill cooldowns ----
        this.level = 1;
        // ---- Health (synced) ----
        this.maxHealth = 0;
        this.currentHealth = 0;
        // ---- Shield (synced) — absorbs damage before health. 0 for now. ----
        this.shield = 0;
        /** Maximum shield capacity (drives the floating shield bar). 0 = no shield. */
        this.maxShield = 0;
        /** Server timestamp (ms) before which a broken shield will not recharge. */
        this.shieldRechargeAt = 0;
        /** Shield slot level (distributed from enemy level alongside skills). Synced for HUD. */
        this.shieldLevel = 1;
        // ---- Movement (synced) — effective speed (base * speedMultiplier) ----
        this.moveSpeed = 0;
        // ---- Combat (synced) ----
        this.attack = 0;
        /** Defence, fraction 0..1 (0.1 = take 10% less damage). Ignored on crits. */
        this.defence = 0;
        /** Crit chance, fraction 0..1 (0.2 = 20%). */
        this.critRate = 0;
        /** Crit damage multiplier (1.5 = 150% of base damage). */
        this.critDamage = 1.5;
        /** XP awarded when this enemy is killed. */
        this.xpReward = 0;
        // ---- Elite (synced) - true for the map's elite (buffed boss variant). ----
        this.isElite = false;
        /**
         * Loot card this enemy spawned with (skill + mods). When this enemy
         * dies, the card drops to the ground (if uncommon+). The enemy's
         * casts of the card's skill use the card's mods.
         */
        this.card = null;
        // ---- Facing (synced) — true = facing right, false = facing left.
        //      The tyranid sprite faces LEFT by default; the client flips when
        //      this is true. Synced so all clients render the same facing. ----
        this.facingRight = false;
        // ---- Visual state (synced) ----
        /** Server timestamp (ms) until which the enemy flashes white (recent hit). */
        this.hitFlashUntil = 0;
        /** Last damage taken (for floating damage numbers on client). */
        this.lastHitDamage = 0;
        /** Whether the last hit was a critical hit. */
        this.lastHitCrit = false;
        /** Monotonic counter — increments every time damage is taken (so client can detect new hits). */
        this.hitSeq = 0;
        /** True while the enemy is playing its attack animation. */
        this.attacking = false;
        /** Server timestamp (ms) until which the attack animation is considered active. */
        this.attackingUntil = 0;
        /** Server timestamp (ms) until which the enemy is bleeding (DoT). */
        this.bleedUntil = 0;
        /** Server timestamp (ms) until which the enemy is shocked (takes more damage, slowed). */
        this.shockUntil = 0;
        /** Server timestamp (ms) until which the enemy is invincible (dash i-frames). */
        this.invincibleUntil = 0;
        // ---- Base stats (NOT synced — server-authoritative source of truth) ----
        this.baseMoveSpeed = 0;
        // ---- Debuff / buff multipliers (NOT synced; server-only) ----
        this.speedMultiplier = 1.0;
        this.damageMultiplier = 1.0;
        this.incomingDamageMultiplier = 1.0;
        // ---- AI / skill state (NOT synced; server-only) ----
        /** Collision radius (used by tile resolution). */
        this.collisionRadius = 9;
        /** Hitbox half-width (rectangle, synced for debug overlay). */
        this.hitboxW = 12;
        /** Hitbox half-height (rectangle, synced for debug overlay). */
        this.hitboxH = 12;
        /** Unlocked skills this enemy may cast (subset of config potentialSkills). */
        this.skillPool = [];
        /**
         * Per-skill level for each unlocked skill (1..MAX_SKILL_LEVEL). Drives
         * damage scaling when the EnemySystem casts that skill. Built once at init.
         */
        this.skillLevels = new Map();
        /**
         * Remaining cooldown in SECONDS for each skill. When <= 0 the skill is
         * ready. Set back to the skill's cooldown after it is used.
         */
        this.skillCooldownsRemaining = new Map();
        /** Server timestamp (ms) until which the enemy is paused (hit-stun). */
        this.pausedUntil = 0;
        /** Server timestamp (ms) until which the enemy can attack again. */
        this.attackCooldownUntil = 0;
        /** Bleed damage per second (server-only; applied while bleedUntil > now). */
        this.bleedDps = 0;
        /** Attacker who applied the bleed (for XP credit on kill). */
        this.bleedAttackerId = "";
        /** Damage per bleed tick (10% of claw damage). */
        this.bleedTickDamage = 0;
        /** Whether the bleed is a critical bleed (from crit claw hit). */
        this.bleedIsCrit = false;
        /** Accumulator for 0.5-second bleed ticks. */
        this.bleedTickAccum = 0;
        /** Tracks total damage dealt by each player (sessionId -> damage). */
        this.damageTrackers = new Map();
        /** Aggro radius (px): hunt players only within this distance (server-only). */
        this.aggroRadius = 500;
        // ---- Wander state (server-only; used when no player is in aggro range) ----
        /** Current wander target x (world px). */
        this.wanderX = 0;
        /** Current wander target y (world px). */
        this.wanderY = 0;
        /** Timestamp (ms) until which the enemy keeps wandering to the current target. */
        this.wanderUntil = 0;
    }
    // ============================================================
    // LIFECYCLE
    // ============================================================
    /**
     * Initialize this enemy from its type config at the given level.
     * Applies level-based growth to base stats, unlocks skills from the
     * potential pool, and randomly distributes the enemy's level as per-skill
     * levels across the unlocked skills.
     */
    init(typeId, level) {
        const cfg = ENEMY_STATS[typeId];
        if (!cfg)
            throw new Error(`Unknown enemy type: ${typeId}`);
        this.typeId = typeId;
        this.title = cfg.title;
        this.description = cfg.description;
        this.level = level;
        // ---- Percentage-based scaling per level ----
        // Each stat scales as: base * (1 + rate * extraLevels)
        // Defence scales additively and is capped at 0.75 (75%).
        // MoveSpeed scales by percentage (always relative to base).
        const extraLevels = Math.max(0, level - 1);
        const hpMult = 1 + 0.6 * extraLevels; // +60% HP per level
        const atkMult = 1 + 0.1 * extraLevels; // +10% ATK per level
        const xpMult = Math.pow(level, 1.5) / 4; // scales with player XP curve (~20 kills per level)
        // Move speed does NOT scale with level — stays at base.
        this.maxHealth = Math.round(cfg.maxHealth * hpMult);
        this.currentHealth = this.maxHealth;
        this.baseMoveSpeed = cfg.moveSpeed;
        this.attack = Math.round(cfg.attack * atkMult);
        this.defence = Math.min(0.75, (cfg.defence ?? 0) + 0.005 * extraLevels);
        this.critRate = (cfg.critRate ?? 0) + 0.02 * extraLevels;
        this.critDamage = cfg.critDamage ?? 1.5;
        this.xpReward = Math.round(cfg.xpReward * xpMult);
        this.collisionRadius = cfg.collisionRadius;
        this.hitboxW = cfg.hitboxW ?? cfg.collisionRadius;
        this.hitboxH = cfg.hitboxH ?? cfg.collisionRadius;
        this.aggroRadius = cfg.aggroRadius ?? 500;
        // ---- Skill pool + skill-level distribution (includes shield slot) ----
        this.buildSkillPool(cfg.potentialSkills, level);
        // ---- Shield: base + growth from distributed shield level ----
        // Each shield level point adds 20 shield (mirrors player SHIELD.AMOUNT_PER_LEVEL).
        this.maxShield = cfg.shield + (this.shieldLevel - 1) * 20;
        this.shield = this.maxShield;
        this.shieldRechargeAt = 0;
        // Reset transient multipliers
        this.speedMultiplier = 1.0;
        this.damageMultiplier = 1.0;
        this.incomingDamageMultiplier = 1.0;
        // Reset visual / AI state
        this.hitFlashUntil = 0;
        this.attacking = false;
        this.attackingUntil = 0;
        this.pausedUntil = 0;
        this.attackCooldownUntil = 0;
        this.bleedUntil = 0;
        this.bleedDps = 0;
        this.shockUntil = 0;
        this.invincibleUntil = 0;
        this.damageTrackers.clear();
        this.recalcDerivedStats();
    }
    // ============================================================
    // LOOT CARD MODIFIER HELPERS
    // ============================================================
    /** True if the enemy has a card for the given skill. */
    hasCardFor(skill) {
        return !!this.card && this.card.skill === skill;
    }
    /**
     * Crit-rate bonus from the card (sums all inc_crit_rate mods).
     * Applies ONLY when casting the card's own skill.
     */
    /**
     * Sum the ROLLED values of every mod with the given id on this
     * enemy's card. Falls back to 'fallback * count' for legacy cards
     * without stored values (approximates tier-1).
     */
    sumModValues(modId, fallback) {
        const c = this.card;
        let total = 0;
        let count = 0;
        for (let i = 0; i < c.modIds.length; i++) {
            if (c.modIds[i] !== modId)
                continue;
            count++;
            const v = c.modValues[i];
            total += typeof v === "number" && v > 0 ? v : fallback;
        }
        if (count === 0)
            return 0;
        return total > 0 ? total : fallback * count;
    }
    cardCritRateBonus(skill) {
        if (!this.hasCardFor(skill))
            return 0;
        return this.sumModValues("inc_crit_rate", 0.03);
    }
    /** Crit-damage bonus from the card (inc_crit_damage). */
    cardCritDamageBonus(skill) {
        if (!this.hasCardFor(skill))
            return 0;
        return this.sumModValues("inc_crit_damage", 0.3);
    }
    /** Skill-damage multiplier bonus (inc_atk_damage). */
    cardDamageBonus(skill) {
        if (!this.hasCardFor(skill))
            return 0;
        return 1 + this.sumModValues("inc_atk_damage", 0.03);
    }
    /** Radius multiplier (unique: wide_sweep -> 2x radius / 0.5x damage). */
    cardRadiusMult(skill) {
        if (!this.hasCardFor(skill))
            return 1;
        return this.card.modIds.includes("wide_sweep") ? 2.0 : 1;
    }
    /** Damage multiplier from the unique wide_sweep (0.5 when present). */
    cardUniqueDamageMult(skill) {
        if (!this.hasCardFor(skill))
            return 1;
        return this.card.modIds.includes("wide_sweep") ? 0.5 : 1;
    }
    /**
     * Turn this enemy into the map's ELITE variant. Call AFTER init() -
     * init() must already be given the boosted level (highest player level
     * + ELITE.LEVEL_BONUS) so level scaling applies; this then layers the
     * unique elite buffs on top:
     *   - +20% HP and shield
     *   - double XP vs the underlying enemy type
     *   - bigger combat hitbox (client also renders a bigger sprite)
     *
     * NOTE: collisionRadius (tile collision) is intentionally NOT grown so
     * the elite can still navigate 1-tile corridors.
     */
    makeElite(hpBonus = 0.2, xpMultiplier = 2.0, sizeMultiplier = 1.6) {
        this.isElite = true;
        this.title = `Elite ${this.title}`;
        const hpMult = 1 + hpBonus;
        this.maxHealth = Math.round(this.maxHealth * hpMult);
        this.currentHealth = this.maxHealth;
        this.maxShield = Math.round(this.maxShield * hpMult);
        this.shield = this.maxShield;
        this.xpReward = Math.round(this.xpReward * xpMultiplier);
        this.hitboxW = Math.round(this.hitboxW * sizeMultiplier);
        this.hitboxH = Math.round(this.hitboxH * sizeMultiplier);
    }
    /**
     * Unlock the first `1 + floor(level / 5)` entries of `potentialSkills` into
     * `skillPool`, then randomly distribute the enemy's level as per-skill
     * levels across those unlocked skills (each capped at MAX_SKILL_LEVEL).
     *
     * Distribution (no per-level loop — at most ~3 skills): for every skill
     * except the last, pick a random amount in [1, remaining - skillsLeftAfter]
     * so each later skill still gets at least 1; the last skill receives all
     * remaining points. Each pick is clamped to MAX_SKILL_LEVEL.
     */
    buildSkillPool(potential, level) {
        // How many skills are unlocked: 1 at lvl 1-4, 2 at 5-9, 3 at 10-14, ...
        const unlockedCount = Math.min(potential.length, 1 + Math.floor(level / 5));
        this.skillPool = potential.slice(0, unlockedCount);
        this.skillLevels = new Map();
        this.skillCooldownsRemaining = new Map();
        if (unlockedCount === 0)
            return;
        // Total recipients = unlocked skills + 1 shield slot.
        const totalSlots = unlockedCount + 1;
        let remaining = level;
        // Distribute across unlocked skills first; shield gets the remainder last.
        for (let i = 0; i < unlockedCount; i++) {
            const skill = this.skillPool[i];
            const slotsAfterThis = totalSlots - 1 - i;
            let lvl;
            if (slotsAfterThis === 0) {
                lvl = Math.min(MAX_SKILL_LEVEL, remaining);
            }
            else {
                const minForOthers = slotsAfterThis; // 1 each for remaining slots
                const maxAllowed = Math.min(MAX_SKILL_LEVEL, remaining - minForOthers);
                const lo = Math.max(1, Math.min(maxAllowed, 1));
                const hi = Math.max(lo, maxAllowed);
                lvl = lo + Math.floor(Math.random() * (hi - lo + 1));
            }
            this.skillLevels.set(skill, lvl);
            remaining -= lvl;
            this.skillCooldownsRemaining.set(skill, 0);
        }
        // Shield slot: takes whatever remains (clamped to MAX_SKILL_LEVEL, min 1).
        this.shieldLevel = Math.max(1, Math.min(MAX_SKILL_LEVEL, remaining));
    }
    // ============================================================
    // DERIVED-STAT RECOMPUTE
    // ============================================================
    /**
     * Recompute effective stats from base + multipliers. Call whenever a base
     * stat or multiplier changes. moveSpeed is synced; attack currently has no
     * multiplier but the hook is here for symmetry with the player.
     */
    recalcDerivedStats() {
        let speed = this.speedMultiplier;
        if (Date.now() < this.shockUntil)
            speed *= 0.5;
        this.moveSpeed = this.baseMoveSpeed * speed;
    }
    // ============================================================
    // HEALTH / SHIELD
    // ============================================================
    /**
     * Apply damage to the enemy. Shield absorbs first, then health.
     * Respects incomingDamageMultiplier. Returns actual damage applied
     * (shield + health).
     */
    takeDamage(rawDamage, sourceSkillId, attackerId, isCrit = false) {
        if (Date.now() < this.invincibleUntil)
            return 0;
        // Defence reduces incoming damage. Crits bypass only 50% of defence.
        // Shock reduces defence by 20% (can go negative = bonus damage).
        const isShocked = Date.now() < this.shockUntil;
        const shockMod = isShocked ? -0.2 : 0.0;
        const effectiveDefence = (isCrit ? this.defence * 0.5 : this.defence) + shockMod;
        const mitigated = rawDamage * (1.0 - effectiveDefence);
        let dmg = mitigated * this.incomingDamageMultiplier;
        let shieldAbsorbed = 0;
        // Shield absorbs first
        if (this.shield > 0) {
            const absorbed = Math.min(this.shield, dmg);
            shieldAbsorbed = absorbed;
            this.shield -= absorbed;
            dmg -= absorbed;
            // ANY shield damage re-arms the recovery delay.
            if (absorbed > 0 && this.maxShield > 0) {
                this.shieldRechargeAt = Date.now() + 30000;
            }
            if (this.shield <= 0) {
                this.shield = 0;
            }
        }
        this.currentHealth = Math.max(0, this.currentHealth - dmg);
        // Track damage contribution for XP rewards.
        if (attackerId) {
            this.damageTrackers.set(attackerId, (this.damageTrackers.get(attackerId) ?? 0) + dmg);
        }
        // Hit feedback: white flash + brief hit-stun pause.
        // Duration scales with skill power (e.g. slam > claw > bolter).
        const fbMs = Math.max(150, sourceSkillId ? getSkillHitFeedback(sourceSkillId) : 150);
        const now = Date.now();
        this.hitFlashUntil = Math.max(this.hitFlashUntil, now + fbMs);
        // Hit-stun removed — only flash, no movement freeze.
        // Record last hit for client-side damage numbers.
        const totalDmg = mitigated * this.incomingDamageMultiplier;
        this.lastHitDamage = Math.round(totalDmg);
        this.lastHitCrit = isCrit;
        this.lastShieldDamage = shieldAbsorbed;
        this.lastHpDamage = totalDmg - shieldAbsorbed;
        this.hitSeq += 1;
        return totalDmg;
    }
    /** Heal the enemy (clamped to maxHealth). Returns amount healed. */
    heal(amount) {
        const before = this.currentHealth;
        this.currentHealth = Math.min(this.maxHealth, before + amount);
        return this.currentHealth - before;
    }
    get isDead() {
        return this.currentHealth <= 0;
    }
    // ============================================================
    // SKILL COOLDOWNS
    // ============================================================
    /**
     * Advance bleed DoT: apply bleedTickDamage every 0.5s while active.
     * Returns true if the enemy died from bleed this tick.
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
        // BLEED BYPASSES SHIELD â€” damages HP directly.
        this.bleedTickAccum += dt;
        if (this.bleedTickAccum >= 0.5) {
            this.bleedTickAccum -= 0.5;
            this.currentHealth = Math.max(0, this.currentHealth - this.bleedTickDamage);
            // Track damage for XP attribution
            if (this.bleedAttackerId) {
                this.damageTrackers.set(this.bleedAttackerId, (this.damageTrackers.get(this.bleedAttackerId) ?? 0) +
                    this.bleedTickDamage);
            }
            this.lastHitCrit = this.bleedIsCrit;
            this.lastHitDamage = this.bleedTickDamage;
            this.hitSeq += 1;
            this.hitFlashUntil = Math.max(this.hitFlashUntil, Date.now() + 100);
            return this.isDead;
        }
        return false;
    }
    /** Inflict bleed: set tick damage + crit status + until timestamp. */
    applyBleed(tickDamage, durationSec, attackerId, isCritBleed) {
        this.bleedTickDamage = tickDamage;
        this.bleedDps = tickDamage * 2; // backwards compat (dps = tickDamage * 2 ticks/sec)
        this.bleedIsCrit = isCritBleed ?? false;
        this.bleedUntil = Date.now() + durationSec * 1000;
        this.bleedTickAccum = 0;
        if (attackerId)
            this.bleedAttackerId = attackerId;
    }
    /**
     * Advance shield recovery by `dt` seconds. A broken shield (0) recharges
     * after a 30s delay, refilling 20% of maxShield per second until full.
     */
    tickShield(dt) {
        if (this.maxShield <= 0)
            return;
        if (this.shield >= this.maxShield) {
            this.shield = this.maxShield;
            return;
        }
        if (Date.now() < this.shieldRechargeAt)
            return;
        const recharge = this.maxShield * 0.2 * dt;
        this.shield = Math.min(this.maxShield, this.shield + recharge);
    }
    /** Advance all skill cooldowns by `dt` seconds (clamped at 0). */
    tickCooldowns(dt) {
        for (const [skill, cd] of this.skillCooldownsRemaining) {
            this.skillCooldownsRemaining.set(skill, Math.max(0, cd - dt));
        }
    }
    /** True if the given skill is off cooldown. */
    isSkillReady(skill) {
        return (this.skillCooldownsRemaining.get(skill) ?? 0) <= 0;
    }
    /** Put a skill on cooldown based on its configured cooldown duration. */
    startCooldown(skill) {
        const cfg = ENEMY_STATS[this.typeId];
        const cd = cfg.skillCooldown[skill] ?? 0;
        this.skillCooldownsRemaining.set(skill, cd);
    }
}
__decorate([
    type("string")
], Enemy.prototype, "typeId", void 0);
__decorate([
    type("string")
], Enemy.prototype, "title", void 0);
__decorate([
    type("string")
], Enemy.prototype, "description", void 0);
__decorate([
    type("number")
], Enemy.prototype, "x", void 0);
__decorate([
    type("number")
], Enemy.prototype, "y", void 0);
__decorate([
    type("number")
], Enemy.prototype, "tick", void 0);
__decorate([
    type("number")
], Enemy.prototype, "level", void 0);
__decorate([
    type("number")
], Enemy.prototype, "maxHealth", void 0);
__decorate([
    type("number")
], Enemy.prototype, "currentHealth", void 0);
__decorate([
    type("number")
], Enemy.prototype, "shield", void 0);
__decorate([
    type("number")
], Enemy.prototype, "maxShield", void 0);
__decorate([
    type("number")
], Enemy.prototype, "shieldLevel", void 0);
__decorate([
    type("number")
], Enemy.prototype, "moveSpeed", void 0);
__decorate([
    type("number")
], Enemy.prototype, "attack", void 0);
__decorate([
    type("number")
], Enemy.prototype, "defence", void 0);
__decorate([
    type("number")
], Enemy.prototype, "critRate", void 0);
__decorate([
    type("number")
], Enemy.prototype, "critDamage", void 0);
__decorate([
    type("number")
], Enemy.prototype, "xpReward", void 0);
__decorate([
    type("boolean")
], Enemy.prototype, "isElite", void 0);
__decorate([
    type("boolean")
], Enemy.prototype, "facingRight", void 0);
__decorate([
    type("number")
], Enemy.prototype, "hitFlashUntil", void 0);
__decorate([
    type("number")
], Enemy.prototype, "lastHitDamage", void 0);
__decorate([
    type("boolean")
], Enemy.prototype, "lastHitCrit", void 0);
__decorate([
    type("number")
], Enemy.prototype, "hitSeq", void 0);
__decorate([
    type("boolean")
], Enemy.prototype, "attacking", void 0);
__decorate([
    type("number")
], Enemy.prototype, "attackingUntil", void 0);
__decorate([
    type("number")
], Enemy.prototype, "bleedUntil", void 0);
__decorate([
    type("number")
], Enemy.prototype, "shockUntil", void 0);
__decorate([
    type("number")
], Enemy.prototype, "invincibleUntil", void 0);
__decorate([
    type("number")
], Enemy.prototype, "hitboxW", void 0);
__decorate([
    type("number")
], Enemy.prototype, "hitboxH", void 0);
