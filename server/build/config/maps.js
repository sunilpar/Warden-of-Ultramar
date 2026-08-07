/**
 * Map Configuration (JSON-driven)
 * ================================
 * Loads map definitions from JSON files in the maps/ directory.
 * Currently only map1.json is loaded.
 *
 * HOW TO ADD A NEW MAP:
 *   1. Create maps/map2.json (same structure as map1.json)
 *   2. Import and registerMap() it below
 */
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// ---- Load map JSON at runtime ----
const map1Data = JSON.parse(fs.readFileSync(path.join(__dirname, "maps", "map1.json"), "utf-8"));
// ============================================================
// MAP REGISTRY
// ============================================================
const mapRegistry = new Map();
export function registerMap(map) {
    mapRegistry.set(map.id, map);
}
export function getMap(id) {
    return mapRegistry.get(id);
}
export function getDefaultMap() {
    return mapRegistry.values().next().value;
}
// ============================================================
// JSON MAP LOADER
// ============================================================
function generateFloorTiles(rows, cols) {
    const tiles = [];
    for (let row = 0; row < rows; row++) {
        const tileRow = [];
        for (let col = 0; col < cols; col++) {
            const rand = Math.random();
            if (rand < 0.45) {
                tileRow.push(2);
            }
            else if (rand < 0.90) {
                tileRow.push(3);
            }
            else {
                tileRow.push(5 + Math.floor(Math.random() * 4));
            }
        }
        tiles.push(tileRow);
    }
    return tiles;
}
function loadMapFromJSON(data) {
    const rows = Math.ceil(data.heightPx / data.tileSize);
    const cols = Math.ceil(data.widthPx / data.tileSize);
    let tiles;
    if (data.tiles === "generated") {
        tiles = generateFloorTiles(rows, cols);
    }
    else {
        tiles = data.tiles;
    }
    return {
        id: data.id,
        name: data.name,
        widthPx: data.widthPx,
        heightPx: data.heightPx,
        tileSize: data.tileSize,
        tiles,
        obstacles: data.obstacles,
        playerSpawns: data.playerSpawns,
        exitPoint: data.exitPoint,
        spriteSheets: data.spriteSheets,
        playerSpawnTileFrame: data.playerSpawnTileFrame,
        exitTileFrame: data.exitTileFrame,
    };
}
// Register map1
registerMap(loadMapFromJSON(map1Data));
