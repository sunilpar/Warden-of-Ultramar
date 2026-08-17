/**
 * Ground Card
 * ===========
 * A card dropped onto the map (world space). For now it is just a
 * skill card (skill id + level). Later, loot rarity etc. will extend
 * this schema - clients already render a simple box from these fields.
 */
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Schema, type } from "@colyseus/schema";
import { CardInstance } from "./CardInstance";
export class GroundCard extends Schema {
    constructor() {
        super(...arguments);
        this.skill = "";
        /** Skill level carried by the card (card tier / art frame). */
        this.level = 1;
        this.x = 0;
        this.y = 0;
        /** Server timestamp (ms) until which pickup is blocked (drop grace). */
        this.pickupLockUntil = 0;
        /** The full rolled card (mods + rarity). Synced nested schema. */
        this.card = new CardInstance();
    }
}
__decorate([
    type("string")
], GroundCard.prototype, "skill", void 0);
__decorate([
    type("number")
], GroundCard.prototype, "level", void 0);
__decorate([
    type("number")
], GroundCard.prototype, "x", void 0);
__decorate([
    type("number")
], GroundCard.prototype, "y", void 0);
__decorate([
    type("number")
], GroundCard.prototype, "pickupLockUntil", void 0);
__decorate([
    type(CardInstance)
], GroundCard.prototype, "card", void 0);
