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
import { Slam } from "./Slam";
import { Vortex } from "./Vortex";
import { GroundCard } from "./GroundCard";
import { ShockCast } from "./ShockCast";
export class RoomState extends Schema {
    constructor() {
        super(...arguments);
        this.players = new MapSchema();
        this.enemies = new MapSchema();
        this.projectiles = new MapSchema();
        this.skillCasts = new MapSchema();
        this.slams = new MapSchema();
        this.shockCasts = new MapSchema();
        this.vortexes = new MapSchema();
        /** Cards dropped onto the map ground (loot-ready). */
        this.groundCards = new MapSchema();
        /** Server timestamp (ms) until which enemy spawning is disabled
         *  (grace period after room creation). 0 = spawning allowed. */
        this.spawnGraceUntil = 0;
        /**
         * Exit gate: false until this map's ELITE enemy has been killed.
         * Clients must not transition to the next map while this is false.
         */
        this.exitUnlocked = false;
        /** True while this map's elite enemy is alive (client boss HUD). */
        this.eliteAlive = false;
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
__decorate([
    type({ map: Slam })
], RoomState.prototype, "slams", void 0);
__decorate([
    type({ map: ShockCast })
], RoomState.prototype, "shockCasts", void 0);
__decorate([
    type({ map: Vortex })
], RoomState.prototype, "vortexes", void 0);
__decorate([
    type({ map: GroundCard })
], RoomState.prototype, "groundCards", void 0);
__decorate([
    type("number")
], RoomState.prototype, "spawnGraceUntil", void 0);
__decorate([
    type("boolean")
], RoomState.prototype, "exitUnlocked", void 0);
__decorate([
    type("boolean")
], RoomState.prototype, "eliteAlive", void 0);
