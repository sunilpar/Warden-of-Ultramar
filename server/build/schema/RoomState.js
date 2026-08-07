/**
 * Room State Schema
 * =================
 * The top-level state object that gets synced to all clients.
 * Colyseus automatically detects changes to @type fields and
 * sends only the changed values to clients (bandwidth optimization).
 */
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Schema, type, MapSchema } from "@colyseus/schema";
import { Player } from "./Player";
import { Enemy } from "./Enemy";
import { Projectile } from "./Projectile";
import { SkillCast } from "./SkillCast";
export class RoomState extends Schema {
    constructor() {
        super(...arguments);
        this.players = new MapSchema();
        this.enemies = new MapSchema();
        this.projectiles = new MapSchema();
        this.skillCasts = new MapSchema();
    }
}
__decorate([
    type({ map: Player })
], RoomState.prototype, "players", void 0);
__decorate([
    type({ map: Enemy })
], RoomState.prototype, "enemies", void 0);
__decorate([
    type({ map: Projectile })
], RoomState.prototype, "projectiles", void 0);
__decorate([
    type({ map: SkillCast })
], RoomState.prototype, "skillCasts", void 0);
