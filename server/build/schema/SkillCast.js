var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
/**
 * Skill Cast (VFX) Schema
 * =======================
 * A transient synced entity representing an instant, non-projectile skill's
 * visual effect (e.g. the claw cone slash). It has NO gameplay collision —
 * damage is applied immediately at cast time by the system. The client renders
 * the appropriate animation + auto-removes when the effect ends.
 *
 * Lifecycle: the server creates it, the client plays the anim, and the server
 * removes it after EFFECT_TTL_MS (well past the client animation length).
 */
import { Schema, type } from "@colyseus/schema";
export class SkillCast extends Schema {
    constructor() {
        super(...arguments);
        /** Position where the cast originated (the caster's center). */
        this.x = 0;
        this.y = 0;
        /** Skill id (e.g. "claw"). */
        this.skillId = "claw";
        /** Aim angle in radians (cone direction). */
        this.angle = 0;
        /** Skill level (drives tier art). */
        this.level = 1;
        /** Claw tier string (small/mid/big) for client art selection. */
        this.tier = "small";
        /** Faction of the caster (for client tint: player vs enemy). */
        this.faction = "player";
        /** Cone range in pixels (the outer edge of the hitbox). */
        this.range = 0;
    }
}
__decorate([
    type("number")
], SkillCast.prototype, "x", void 0);
__decorate([
    type("number")
], SkillCast.prototype, "y", void 0);
__decorate([
    type("string")
], SkillCast.prototype, "skillId", void 0);
__decorate([
    type("number")
], SkillCast.prototype, "angle", void 0);
__decorate([
    type("number")
], SkillCast.prototype, "level", void 0);
__decorate([
    type("string")
], SkillCast.prototype, "tier", void 0);
__decorate([
    type("string")
], SkillCast.prototype, "faction", void 0);
__decorate([
    type("number")
], SkillCast.prototype, "range", void 0);
