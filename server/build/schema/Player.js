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
 * Only the fields marked @type are sent to clients; inputQueue is local.
 */
import { Schema, type, MapSchema } from "@colyseus/schema";
import { PLAYER_STATS } from "../config/playerStats";
export class Player extends Schema {
    constructor() {
        super(...arguments);
        // ---- Position (synced) ----
        this.x = 0;
        this.y = 0;
        this.tick = 0;
        // ---- Health (synced) ----
        this.maxHealth = PLAYER_STATS.BASE.MAX_HEALTH;
        this.currentHealth = PLAYER_STATS.BASE.MAX_HEALTH;
        // ---- Movement (synced) ----
        /** Effective move speed in px/sec (already includes multipliers). */
        this.moveSpeed = PLAYER_STATS.BASE.MOVE_SPEED;
        // ---- Combat (synced) ----
        this.attack = PLAYER_STATS.BASE.ATTACK;
        /** Crit chance, fraction 0..1 (0.1 = 10%). */
        this.critRate = PLAYER_STATS.BASE.CRIT_RATE;
        /** Crit damage multiplier (1.5 = 150% of base damage). */
        this.critDamage = PLAYER_STATS.BASE.CRIT_DAMAGE;
        // ---- Progression (synced) ----
        this.level = 1;
        this.currentXp = 0;
        this.xpToLevelUp = PLAYER_STATS.LEVELING.LEVEL_1_XP;
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
        // ---- Skill levels (synced) — per-skill level owned by this player.
        //      Drives damage, color tiers, chain count, card art tier. Keys are
        //      SkillId strings; values are the skill level (1..MAX_SKILL_LEVEL). ----
        this.skillLevels = new MapSchema();
        /** Server timestamp (ms) when the bolter comes off cooldown (for HUD fill). */
        this.bolterCooldownEndsAt = 0;
        /** Server timestamp (ms) until which the player is bleeding (DoT). */
        this.bleedUntil = 0;
        // ---- Skill cooldowns (NOT synced; server-only) — remaining seconds
        //      before each skill can be cast again. ----
        this.skillCooldowns = new Map();
        /** Bleed damage per second (server-only; applied while bleedUntil > now). */
        this.bleedDps = 0;
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
        this.level = 1;
        this.currentXp = 0;
        this.xpToLevelUp = PLAYER_STATS.LEVELING.LEVEL_1_XP;
        // Reset transient multipliers
        this.speedMultiplier = 1.0;
        this.damageMultiplier = 1.0;
        this.incomingDamageMultiplier = 1.0;
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
        this.moveSpeed = this.baseMoveSpeed * this.speedMultiplier;
        // attack / critRate / critDamage currently have no multiplier in the
        // base design; if buffs/debuffs to those are added later, fold them
        // in here in the same pattern (e.g. attack * damageMultiplier).
    }
    // ============================================================
    // HEALTH
    // ============================================================
    /** Apply damage to the player (respects incomingDamageMultiplier). */
    takeDamage(rawDamage) {
        const dmg = rawDamage * this.incomingDamageMultiplier;
        this.currentHealth = Math.max(0, this.currentHealth - dmg);
        return dmg; // actual damage applied
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
        const g = PLAYER_STATS.LEVELING.GROWTH;
        this.maxHealth += g.MAX_HEALTH;
        this.attack += g.ATTACK;
        this.critRate += g.CRIT_RATE;
        this.critDamage += g.CRIT_DAMAGE;
        this.baseMoveSpeed += g.MOVE_SPEED;
        // Recompute the XP required for the NEXT level
        this.xpToLevelUp = PLAYER_STATS.LEVELING.xpForNextLevel(this.level);
        // Heal on level up
        this.heal(this.maxHealth * PLAYER_STATS.LEVELING.HEAL_ON_LEVEL_UP);
        this.recalcDerivedStats();
    }
    // ============================================================
    // SKILLS
    // ============================================================
    /** Get a skill's level (0 if not owned/learned). */
    getSkillLevel(skill) {
        return this.skillLevels.get(skill) ?? 0;
    }
    /** Set a skill's level (clamped to >=1). */
    setSkillLevel(skill, level) {
        this.skillLevels.set(skill, Math.max(1, Math.floor(level)));
    }
    /** Advance a skill's level by 1 (for the "0" upgrade key). */
    upgradeSkill(skill) {
        this.setSkillLevel(skill, this.getSkillLevel(skill) + 1);
    }
    /** Advance ALL owned skills by 1 (used by the debug upgrade key). */
    upgradeAllSkills() {
        this.skillLevels.forEach((_lvl, skill) => {
            this.skillLevels.set(skill, (_lvl ?? 0) + 1);
        });
    }
    /** True if a skill is off cooldown. */
    isSkillReady(skill) {
        return (this.skillCooldowns.get(skill) ?? 0) <= 0;
    }
    /** Put a skill on cooldown (seconds). Also stamps the synced end-time
     *  for the bolter so the client HUD can render a fill animation. */
    startSkillCooldown(skill, cooldown) {
        this.skillCooldowns.set(skill, cooldown);
        if (skill === "bolter") {
            this.bolterCooldownEndsAt = Date.now() + cooldown * 1000;
        }
    }
    /** Advance all skill cooldowns by dt seconds (clamped at 0). */
    tickSkillCooldowns(dt) {
        for (const [skill, cd] of this.skillCooldowns) {
            this.skillCooldowns.set(skill, Math.max(0, cd - dt));
        }
    }
    /**
     * Advance bleed DoT: apply bleedDps * dt damage while active.
     * Returns true if the player died from bleed this tick.
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
    /** Inflict bleed: set dps + until timestamp. */
    applyBleed(dps, durationSec) {
        this.bleedDps = dps;
        this.bleedUntil = Date.now() + durationSec * 1000;
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
], Player.prototype, "level", void 0);
__decorate([
    type("number")
], Player.prototype, "currentXp", void 0);
__decorate([
    type("number")
], Player.prototype, "xpToLevelUp", void 0);
__decorate([
    type({ map: "number" })
], Player.prototype, "skillLevels", void 0);
__decorate([
    type("number")
], Player.prototype, "bolterCooldownEndsAt", void 0);
__decorate([
    type("number")
], Player.prototype, "bleedUntil", void 0);
