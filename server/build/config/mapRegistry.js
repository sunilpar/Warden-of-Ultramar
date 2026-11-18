/**
 * Map Registry
 * ============
 * Single source of truth for all maps in the game.
 *
 * ONE ROOM = ONE GAME SESSION (one party of players). The room runs a
 * single GAMEPLAY map at a time (the "main" map, where enemies spawn).
 * Players also have a `currentMapId` field:
 *
 *   - "lobby"   = safe zone (no enemies). Each player can be in the
 *                 lobby independently; they can roam and click the
 *                 "Play" polygon to leave the lobby and join the
 *                 room's main gameplay map.
 *   - "map1" / "map2" = gameplay maps. The room's main gameplay map
 *                 is `state.mapId` and rotates map1 -> map2 -> map1
 *                 on exits (server-authoritative). Only players whose
 *                 `currentMapId === state.mapId` participate in the
 *                 enemy / pickup simulation.
 *
 * Rotation: map1 -> map2 -> map1 -> ... (see `next`).
 */
import { LAYERED_MAP } from "./layeredMap";
import { LAYERED_MAP_2 } from "./layeredMap2";
import { LOBBY_MAP } from "./lobbyMap";
export const MAPS = {
    lobby: {
        data: LOBBY_MAP,
        modifiers: [],
        info: {
            name: "Lobby",
            description: "Safe zone. Free movement, click Play to begin a run.",
        },
        // The lobby never rotates out - clicking Play always drops the
        // player onto the room's current gameplay map (or map1 by default).
        next: "map1",
    },
    map1: {
        data: LAYERED_MAP,
        modifiers: [],
        info: {
            name: "Sector 1: Outskirts",
            description: "The entrance to the hive. Tyranids and Orcks roam freely.",
        },
        next: "map2",
    },
    map2: {
        data: LAYERED_MAP_2,
        modifiers: ["swift_movement"],
        info: {
            name: "Sector 2: Deep Hive",
            description: "The tunnels deepen. Swift movement is afoot.",
        },
        next: "map1",
    },
};
/** The first gameplay map a new room starts on. */
export const DEFAULT_MAP = "map1";
