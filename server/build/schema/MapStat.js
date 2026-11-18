var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
/**
 * MapStat Schema (synced)
 * =======================
 * A single active "map stat" carried over from a previous map.
 * Lives on RoomState.activeMapStats; expires when durationMaps hits 0.
 *
 * The client mirrors this struct purely for display (chip + tooltip);
 * the actual effects are applied server-side by querying this list.
 */
import { Schema, type } from "@colyseus/schema";
export class MapStat extends Schema {
    constructor() {
        super(...arguments);
        /** Stable id "<good>-but-<bad>" (good + bad names kebab-cased). */
        this.defId = "";
        /** Display name of the player-buff component (e.g. "Furious"). */
        this.goodName = "";
        /** Display name of the enemy-buff component (e.g. "Tanky"). */
        this.badName = "";
        /** Effect id for the good component (see mapStats.StatEffect). */
        this.goodEffect = "";
        /** Effect id for the bad component (see mapStats.StatEffect). */
        this.badEffect = "";
        /** Rolled value of the good component (fraction or weight unit). */
        this.goodValue = 0;
        /** Rolled value of the bad component (fraction or weight unit). */
        this.badValue = 0;
        /** Maps remaining. 1 = expires on next transition. */
        this.durationMaps = 0;
    }
}
__decorate([
    type("string")
], MapStat.prototype, "defId", void 0);
__decorate([
    type("string")
], MapStat.prototype, "goodName", void 0);
__decorate([
    type("string")
], MapStat.prototype, "badName", void 0);
__decorate([
    type("string")
], MapStat.prototype, "goodEffect", void 0);
__decorate([
    type("string")
], MapStat.prototype, "badEffect", void 0);
__decorate([
    type("number")
], MapStat.prototype, "goodValue", void 0);
__decorate([
    type("number")
], MapStat.prototype, "badValue", void 0);
__decorate([
    type("number")
], MapStat.prototype, "durationMaps", void 0);
