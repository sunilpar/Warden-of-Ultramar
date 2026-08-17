var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
/**
 * Card Instance
 * =============
 * One concretely rolled card: skill + level + rarity + modifiers.
 * A card IS a skill trigger: when the HUD slot holding it fires, the
 * card's skill casts with only this card's mods applied.
 * Used by:
 *   - Enemy.card       (the card an enemy spawns with; drops on death)
 *   - GroundCard.card  (the rolled card lying on the map)
 *   - Player.equippedSlots[i] (the card equipped in HUD slot i)
 */
import { Schema, type, ArraySchema } from "@colyseus/schema";
export class CardInstance extends Schema {
    constructor() {
        super(...arguments);
        /** Skill this card represents. */
        this.skill = "";
        /** Skill level carried by the card. */
        this.level = 1;
        /** Rolled rarity (derived from mods, but synced for cheap reads). */
        this.rarity = "common";
        /** Rolled modifier ids (prefix/suffix/unique ids from loot config). */
        this.modIds = new ArraySchema();
    }
}
__decorate([
    type("string")
], CardInstance.prototype, "skill", void 0);
__decorate([
    type("number")
], CardInstance.prototype, "level", void 0);
__decorate([
    type("string")
], CardInstance.prototype, "rarity", void 0);
__decorate([
    type(["string"])
], CardInstance.prototype, "modIds", void 0);
