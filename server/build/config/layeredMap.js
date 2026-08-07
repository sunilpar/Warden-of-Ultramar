/**
 * Layered Map (Server-Side Authoritative)
 * =======================================
 * Parses the Tiled export (layerbasedMap1.json) + tileset properties
 * (bigobssym.json) to build the collision grid used by the server for
 * authoritative O(1) tile collision.
 *
 * MUST produce the EXACT same collision grid as the client
 * (client/src/maps/layeredMapData.ts). Keep them in sync.
 */
import mapJson from "./maps/layerbasedMap1.json";
import tilesetJson from "./maps/bigobssym.json";
function buildLayeredMap() {
    const tileSize = mapJson.tilewidth;
    const cols = mapJson.width;
    const rows = mapJson.height;
    const firstGid = mapJson.tilesets[0].firstgid;
    // ---- Build the set of colliding tile ids from the tileset properties ----
    const collisionTileIds = new Set();
    for (const tile of tilesetJson.tiles) {
        const globalId = tile.id + firstGid;
        for (const prop of tile.properties) {
            if (prop.name === "collide" && prop.value === true) {
                collisionTileIds.add(globalId);
            }
        }
    }
    // ---- Find the interactive layer (where walls / collide tiles live) ----
    const layers = mapJson.layers;
    const interactive = layers.find((l) => l.name === "interactive");
    if (!interactive?.data)
        throw new Error("interactive layer not found");
    const interactiveData = interactive.data;
    // ---- Build collision grid ----
    const collisionGrid = new Uint8Array(cols * rows);
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const tid = interactiveData[r * cols + c];
            if (collisionTileIds.has(tid)) {
                collisionGrid[r * cols + c] = 1;
            }
        }
    }
    // ---- Find spawn tile ----
    const spawnTileIds = new Set();
    for (const tile of tilesetJson.tiles) {
        const globalId = tile.id + firstGid;
        for (const prop of tile.properties) {
            if (prop.name === "spawnpoint" && prop.value === true) {
                spawnTileIds.add(globalId);
            }
        }
    }
    let spawnPoint = { x: tileSize / 2, y: tileSize / 2 };
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            if (spawnTileIds.has(interactiveData[r * cols + c])) {
                spawnPoint = {
                    x: c * tileSize + tileSize / 2,
                    y: r * tileSize + tileSize / 2,
                };
            }
        }
    }
    // ---- Extract enemy spawn zones from the object layer ----
    const enemySpawnZones = [];
    const enemySpawnLayer = layers.find((l) => l.name === "ememy spawn");
    if (enemySpawnLayer?.objects) {
        enemySpawnLayer.objects.forEach((obj, i) => {
            enemySpawnZones.push({
                name: `enemy_zone_${i + 1}`,
                x: obj.x,
                y: obj.y,
                width: obj.width,
                height: obj.height,
            });
        });
    }
    return {
        tileSize,
        cols,
        rows,
        widthPx: cols * tileSize,
        heightPx: rows * tileSize,
        collisionGrid,
        spawnPoint,
        enemySpawnZones,
    };
}
export const LAYERED_MAP = buildLayeredMap();
