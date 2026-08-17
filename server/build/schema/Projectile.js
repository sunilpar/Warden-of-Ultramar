var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
/**
 * Projectile Schema
 * =================
 * A synced entity representing a skill projectile (e.g. a bolter bullet).
 *
 * Synced fields let the client render position, color tier, and faction.
 * Server-only fields hold the simulation state (velocity, damage, chain,
 * already-hit ids, owner) so the server stays authoritative.
 *
 * FACTION RULES (friendly-fire)
 *   - "player" projectiles damage ENEMIES only (never players, never owner).
 *   - "enemy"  projectiles damage PLAYERS + OTHER ENEMIES (never the caster).
 */
import { Schema, type } from "@colyseus/schema";
export class Projectile extends Schema {
    constructor() {
        super(...arguments);
        // ---- Position (synced) ----
        this.x = 0;
        this.y = 0;
        /** Skill id this projectile belongs to (e.g. "bolter"). */
        this.skillId = "bolter";
        /** Skill level at cast time (drives color tier + chain). */
        this.level = 1;
        /** Color tier (white/yellow/blue) derived from level — synced for render. */
        this.colorTier = "yellow";
        /** Who fired it — determines what it can hit. */
        this.faction = "player";
        // ---- Simulation state (NOT synced; server-only) ----
        /** Velocity in px/sec. */
        this.vx = 0;
        this.vy = 0;
        /** Damage dealt on hit (already includes caster stats + level + multipliers). */
        this.damage = 0;
        /** Collision radius for hit detection. */
        this.radius = 7;
        /** Remaining travel distance before despawn (px). */
        this.remainingRange = 0;
        /** Remaining chain bounces (0 = no more chain). */
        this.chainRemaining = 0;
        /** Ids already hit (prevents hitting the same target twice). */
        this.hitSet = new Set();
        /** Session/id of the caster (never damage the caster itself). */
        this.ownerId = "";
        /** Crit rate of the caster (fraction 0..1). */
        this.critRate = 0;
        /** Crit damage multiplier of the caster (e.g. 1.5 = 150%). */
        this.critDamage = 1.5;
    }
}
__decorate([
    type("number")
], Projectile.prototype, "x", void 0);
__decorate([
    type("number")
], Projectile.prototype, "y", void 0);
__decorate([
    type("string")
], Projectile.prototype, "skillId", void 0);
__decorate([
    type("number")
], Projectile.prototype, "level", void 0);
__decorate([
    type("string")
], Projectile.prototype, "colorTier", void 0);
__decorate([
    type("string")
], Projectile.prototype, "faction", void 0);
