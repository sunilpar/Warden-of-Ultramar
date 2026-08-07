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
 */
import { Schema, type } from "@colyseus/schema";
import { ENEMY_STATS, } from "../config/enemyStats";
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
        // ---- Movement (synced) — effective speed (base * speedMultiplier) ----
        this.moveSpeed = 0;
        // ---- Combat (synced) ----
        this.attack = 0;
        // ---- Facing (synced) — true = facing right, false = facing left.
        //      The tyranid sprite faces LEFT by default; the client flips when
        //      this is true. Synced so all clients render the same facing. ----
        this.facingRight = false;
        // ---- Visual state (synced) ----
        /** Server timestamp (ms) until which the enemy flashes white (recent hit). */
        this.hitFlashUntil = 0;
        /** True while the enemy is playing its attack animation. */
        this.attacking = false;
        /** Server timestamp (ms) until which the enemy is bleeding (DoT). */
        this.bleedUntil = 0;
        // ---- Base stats (NOT synced — server-authoritative source of truth) ----
        this.baseMoveSpeed = 0;
        // ---- Debuff / buff multipliers (NOT synced; server-only) ----
        this.speedMultiplier = 1.0;
        this.damageMultiplier = 1.0;
        this.incomingDamageMultiplier = 1.0;
        // ---- AI / skill state (NOT synced; server-only) ----
        /** Collision radius (used by tile resolution). */
        this.collisionRadius = 18;
        /** Skills this enemy may cast (copied from config). */
        this.skillPool = [];
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
    }
    // ============================================================
    // LIFECYCLE
    // ============================================================
    /**
     * Initialize this enemy from its type config at the given level.
     * Applies level-based growth to base stats.
     */
    init(typeId, level) {
        const cfg = ENEMY_STATS[typeId];
        if (!cfg)
            throw new Error(`Unknown enemy type: ${typeId}`);
        this.typeId = typeId;
        this.title = cfg.title;
        this.description = cfg.description;
        this.level = level;
        // Base stats grown by level (level 1 = base; each extra level adds growth)
        const extraLevels = Math.max(0, level - 1);
        this.maxHealth = cfg.maxHealth + cfg.growth.maxHealth * extraLevels;
        this.currentHealth = this.maxHealth;
        this.baseMoveSpeed = cfg.moveSpeed + cfg.growth.moveSpeed * extraLevels;
        this.attack = cfg.attack + cfg.growth.attack * extraLevels;
        this.shield = cfg.shield;
        this.collisionRadius = cfg.collisionRadius;
        // Skill pool + reset cooldowns (ready immediately)
        this.skillPool = [...cfg.skillPool];
        this.skillCooldownsRemaining = new Map();
        for (const skill of this.skillPool) {
            this.skillCooldownsRemaining.set(skill, 0);
        }
        // Reset transient multipliers
        this.speedMultiplier = 1.0;
        this.damageMultiplier = 1.0;
        this.incomingDamageMultiplier = 1.0;
        // Reset visual / AI state
        this.hitFlashUntil = 0;
        this.attacking = false;
        this.pausedUntil = 0;
        this.attackCooldownUntil = 0;
        this.bleedUntil = 0;
        this.bleedDps = 0;
        this.recalcDerivedStats();
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
        this.moveSpeed = this.baseMoveSpeed * this.speedMultiplier;
    }
    // ============================================================
    // HEALTH / SHIELD
    // ============================================================
    /**
     * Apply damage to the enemy. Shield absorbs first, then health.
     * Respects incomingDamageMultiplier. Returns actual damage applied
     * (shield + health).
     */
    takeDamage(rawDamage) {
        let dmg = rawDamage * this.incomingDamageMultiplier;
        // Shield absorbs first
        if (this.shield > 0) {
            const absorbed = Math.min(this.shield, dmg);
            this.shield -= absorbed;
            dmg -= absorbed;
        }
        this.currentHealth = Math.max(0, this.currentHealth - dmg);
        // Hit feedback: white flash + brief hit-stun pause (mimics being hit).
        const now = Date.now();
        this.hitFlashUntil = now + 120;
        this.pausedUntil = now + 120;
        return rawDamage * this.incomingDamageMultiplier;
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
     * Advance bleed DoT: apply bleedDps * dt damage while active.
     * Returns true if the enemy died from bleed this tick.
     */
    tickBleed(dt) {
        if (this.bleedUntil <= 0)
            return false;
        const now = Date.now();
        if (now >= this.bleedUntil) {
            this.bleedUntil = 0;
            this.bleedDps = 0;
            return false;
        }
        this.takeDamage(this.bleedDps * dt);
        return this.isDead;
    }
    /** Inflict bleed: set dps + extend/until timestamp. */
    applyBleed(dps, durationSec) {
        this.bleedDps = dps;
        this.bleedUntil = Date.now() + durationSec * 1000;
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
], Enemy.prototype, "moveSpeed", void 0);
__decorate([
    type("number")
], Enemy.prototype, "attack", void 0);
__decorate([
    type("boolean")
], Enemy.prototype, "facingRight", void 0);
__decorate([
    type("number")
], Enemy.prototype, "hitFlashUntil", void 0);
__decorate([
    type("boolean")
], Enemy.prototype, "attacking", void 0);
__decorate([
    type("number")
], Enemy.prototype, "bleedUntil", void 0);
