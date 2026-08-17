var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
/**
 * Vortex Entity Schema
 * ====================
 * A vortex zone centred on the caster that pulls entities toward its centre.
 *
 * Lifecycle:
 *   1. L1-4: Pull only.
 *   2. L5-10: Pull, then an explosion damages everything near the centre.
 *
 * Phases: "pull" -> "explode" (VFX hold) -> remove
 */
import { Schema, type } from "@colyseus/schema";
export class Vortex extends Schema {
    constructor() {
        super(...arguments);
        // ---- Synced (visible to client for rendering) ----
        this.x = 0;
        this.y = 0;
        /** Skill id (always "vortex"). */
        this.skillId = "vortex";
        /** Skill level at cast time. */
        this.level = 1;
        /** Faction of the caster. */
        this.faction = "player";
        /** Current phase: pull / explode. */
        this.phase = "pull";
        /** Vortex pull radius in pixels. */
        this.radius = 80;
        /** Explosion radius (0 if no explosion). */
        this.explosionRadius = 0;
        /** Colour tier: grey (1-2), brown (3-5), purple (6-10). */
        this.colorTier = "grey";
        // ---- Server-only (not synced) ----
        /** Pull duration remaining (seconds). */
        this.pullTimer = 0;
        /** Pull force (px/sec). */
        this.pullForce = 120;
        /** Explosion damage (0 if no explosion). */
        this.explosionDamage = 0;
        /** Whether this vortex has an explosion phase. */
        this.hasExplosion = false;
        /** How long the "explode" phase lingers (client VFX time), seconds. */
        this.explodeTimer = 0;
        /** Session/id of the caster. */
        this.ownerId = "";
        /** Crit rate of the caster (fraction 0..1). */
        this.critRate = 0;
        /** Crit damage multiplier of the caster. */
        this.critDamage = 1.5;
        /** Track entities that were pulled (for explosion damage). */
        this.pulledEntities = new Set();
    }
}
__decorate([
    type("number")
], Vortex.prototype, "x", void 0);
__decorate([
    type("number")
], Vortex.prototype, "y", void 0);
__decorate([
    type("string")
], Vortex.prototype, "skillId", void 0);
__decorate([
    type("number")
], Vortex.prototype, "level", void 0);
__decorate([
    type("string")
], Vortex.prototype, "faction", void 0);
__decorate([
    type("string")
], Vortex.prototype, "phase", void 0);
__decorate([
    type("number")
], Vortex.prototype, "radius", void 0);
__decorate([
    type("number")
], Vortex.prototype, "explosionRadius", void 0);
__decorate([
    type("string")
], Vortex.prototype, "colorTier", void 0);
