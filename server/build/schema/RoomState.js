var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
/**
 * Room State Schema
 * =================
 * The top-level state object that gets synced to all clients.
 * Colyseus automatically detects changes to @type fields and
 * sends only the changed values to clients (bandwidth optimization).
 */
import { Schema, type, MapSchema } from "@colyseus/schema";
import { Player } from "./Player";
import { Enemy } from "./Enemy";
import { Projectile } from "./Projectile";
import { SkillCast } from "./SkillCast";
import { Slam } from "./Slam";
import { Vortex } from "./Vortex";
import { GroundCard } from "./GroundCard";
import { ShockCast } from "./ShockCast";
import { MapStat } from "./MapStat";
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
        /**
         * The map this room is currently running ("map1" | "map2" | ...).
         * One room = one game session; maps swap INSIDE the room (no room
         * change). Clients watch this field to rebuild their tilemap.
         */
        this.mapId = "map1";
        /**
         * True while a run is active (someone pressed Play and the group is
         * playing the gameplay maps). While true, players in the lobby CANNOT
         * press Play to join mid-run — only the players that were in the
         * lobby when the run started participate until the map empties.
         */
        this.runInProgress = false;
        /** Server timestamp (ms) until which enemy spawning is disabled
         *  (grace period after map start). 0 = spawning allowed. */
        this.spawnGraceUntil = 0;
        /**
         * Exit gate: false until this map's ELITE enemy has been killed.
         * The exit transition is fully server-authoritative.
         */
        this.exitUnlocked = false;
        /** True while this map's elite enemy is alive (client boss HUD). */
        this.eliteAlive = false;
        /**
         * Map stats carried over from prior transitions (each one good+bad,
         * with a remaining duration in maps). The LootSystem + enemy/player
         * systems query this list at runtime to apply their bonuses.
         */
        this.activeMapStats = new MapSchema();
        /**
         * How many maps this room has cleared so far. Used by the picker
         * to compute the offer tier (every 2 clears bumps the tier).
         */
        this.mapsCleared = 0;
        /**
         * 6-char alphanumeric lobby code ("ABC123") or empty string when
         * the room is private / solo (no other player can join it). Set
         * once in `onCreate` from the createRoom options; clients read it
         * to display "share this code with a friend" in the HUD.
         *
         * Lives on the state schema so it survives room-rebind races
         * (solo-redirect swap, etc.) without a second message round-trip.
         */
        this.lobbyCode = "";
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
    type("string")
], RoomState.prototype, "mapId", void 0);
__decorate([
    type("boolean")
], RoomState.prototype, "runInProgress", void 0);
__decorate([
    type("number")
], RoomState.prototype, "spawnGraceUntil", void 0);
__decorate([
    type("boolean")
], RoomState.prototype, "exitUnlocked", void 0);
__decorate([
    type("boolean")
], RoomState.prototype, "eliteAlive", void 0);
__decorate([
    type({ map: MapStat })
], RoomState.prototype, "activeMapStats", void 0);
__decorate([
    type("number")
], RoomState.prototype, "mapsCleared", void 0);
__decorate([
    type("string")
], RoomState.prototype, "lobbyCode", void 0);
