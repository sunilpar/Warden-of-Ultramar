var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
/**
 * Slam Entity Schema
 * ==================
 * A moving rectangular hitbox for the slam skill. Travels in a fixed
 * direction for a set range, damaging anything in its path. Does NOT
 * despawn on hit — it persists until it finishes travelling.
 */
import { Schema, type } from "@colyseus/schema";
export class Slam extends Schema {
    constructor() {
        super(...arguments);
        // ---- Synced (visible to client for rendering) ----
        this.x = 0;
        this.y = 0;
        /** Skill id (always "slam"). */
        this.skillId = "slam";
        /** Skill level at cast time (drives frame row + range). */
        this.level = 1;
        /** Faction of the caster. */
        this.faction = "player";
        /** Travel direction in radians. */
        this.angle = 0;
        /** Remaining travel distance (px). */
        this.remainingRange = 0;
        // ---- Server-only (not synced) ----
        /** Velocity x (px/sec). */
        this.vx = 0;
        /** Velocity y (px/sec). */
        this.vy = 0;
        /** Damage per hit tick. */
        this.damage = 200;
        /** Hitbox half-width (perpendicular to travel direction). */
        this.halfWidth = 40;
        /** Hitbox half-height (along travel direction). */
        this.halfHeight = 20;
        /** Ids already hit recently (cooldown per target to prevent multi-hit per second). */
        this.hitCooldowns = new Map();
        /** Session/id of the caster. */
        this.ownerId = "";
        /** L5+ slams bypass walls. */
        this.bypassWalls = false;
        /** Crit rate of the caster (fraction 0..1). */
        this.critRate = 0;
        /** Crit damage multiplier of the caster (e.g. 1.5 = 150%). */
        this.critDamage = 1.5;
    }
}
__decorate([
    type("number")
], Slam.prototype, "x", void 0);
__decorate([
    type("number")
], Slam.prototype, "y", void 0);
__decorate([
    type("string")
], Slam.prototype, "skillId", void 0);
__decorate([
    type("number")
], Slam.prototype, "level", void 0);
__decorate([
    type("string")
], Slam.prototype, "faction", void 0);
__decorate([
    type("number")
], Slam.prototype, "angle", void 0);
__decorate([
    type("number")
], Slam.prototype, "remainingRange", void 0);
