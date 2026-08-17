var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
/**
 * Shock Cast (VFX) Schema
 * =======================
 * Chain-lightning skill visual. Segments are encoded as a flat string
 * to avoid nested schema serialization overhead.
 *
 * Format: "x1,y1,x2,y2,delay;x1,y1,x2,y2,delay;..."
 */
import { Schema, type } from "@colyseus/schema";
export class ShockCast extends Schema {
    constructor() {
        super(...arguments);
        /** Caster position (for the activation hand VFX). */
        this.x = 0;
        this.y = 0;
        /** Skill level (drives which art row to use). */
        this.level = 1;
        /** Faction of the caster (player vs enemy). */
        this.faction = "player";
        /** Aim angle in radians (for hitbox cone direction). */
        this.aimAngle = 0;
        /** Segments as flat string: "x1,y1,x2,y2,delay;..." */
        this.segments = "";
    }
}
__decorate([
    type("number")
], ShockCast.prototype, "x", void 0);
__decorate([
    type("number")
], ShockCast.prototype, "y", void 0);
__decorate([
    type("number")
], ShockCast.prototype, "level", void 0);
__decorate([
    type("string")
], ShockCast.prototype, "faction", void 0);
__decorate([
    type("number")
], ShockCast.prototype, "aimAngle", void 0);
__decorate([
    type("string")
], ShockCast.prototype, "segments", void 0);
