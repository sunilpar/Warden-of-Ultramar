/**
 * Lobby Map Data (32px — from Tiled editor export)
 * ================================================
 * Parses the lobby map + its tileset properties to build:
 *   - baselayer + interactiveLayer tile grids (for rendering)
 *   - a collision grid (for O(1) tile collision)
 *   - a spawn point (hard-coded to the map center - no marker tiles exist)
 *   - the "Play" interactive polygon (for click-to-start)
 *
 * The lobby map JSON exports layers named "base" and "interactive" (the
 * game maps use "baselayer" and "collision"). Both naming styles are
 * supported here for clarity.
 *
 * MUST produce the EXACT same collision grid as the server
 * (server/src/config/lobbyMap.ts). Keep them in sync.
 */
import mapJson from "./lobby map.json";
import tilesetJson from "./lobby tilesheet.json";

// We re-use the same LayeredMapData type as the game maps. The lobby
// doesn't have enemies/exit so we set those to no-op values.
interface LobbyInteractivePolygon {
  /** World-space pixel position of the polygon's anchor (Tiled origin). */
  x: number;
  y: number;
  /**
   * Raw polygon vertices relative to (x, y) in Tiled. Tiled exports
   * polygons with width=0/height=0 because the shape is defined by
   * these vertices; we keep them so we can compute the AABB ourselves
   * when needed for input hit-testing.
   */
  vertices: { x: number; y: number }[];
  /** Bounding-box derived from the vertices (cached, world pixels). */
  bbox: { x: number; y: number; width: number; height: number };
  /** Property names declared on the polygon (we only use "Play"). */
  properties: string[];
}

export interface LobbyMapData {
  id: string;
  name: string;
  tileSize: number;
  cols: number;
  rows: number;
  widthPx: number;
  heightPx: number;
  /** Baselayer tile grid [row][col] — always drawn. */
  baselayer: number[][];
  /** Collision layer tile grid [row][col] — 0 means empty/skip. */
  interactiveLayer: number[][];
  /** Flat collision grid: 1 = blocked, 0 = walkable. Index = row * cols + col. */
  collisionGrid: Uint8Array;
  /** Tileset columns (for computing source-rect from tile id). */
  tilesetColumns: number;
  /** Phaser texture key for the lobby tilesheet spritesheet. */
  tilesetKey: string;
  /** firstgid from the map (globalId = localId + firstgid). */
  firstgid: number;
  /** Player spawn position in pixels (center of the lobby). */
  spawnPoint: { x: number; y: number };
  /**
   * Interactive POLYGONS from the "interactive" object layer. The lobby
   * only has ONE meaningful polygon ("Play"); the others (Settings,
   * Multiplayer, Loadout) are present in the file but unused for now.
   */
  interactiveObjects: LobbyInteractivePolygon[];
}

const TILE_SIZE: number = mapJson.tilewidth; // 32
const COLS: number = mapJson.width; // 45
const ROWS: number = mapJson.height; // 33
const FIRST_GID: number = mapJson.tilesets[0].firstgid; // 1

// ---- Build tile-property sets from the tileset ----
const collisionTileIds = new Set<number>();
for (const tile of tilesetJson.tiles as Array<{
  id: number;
  properties: Array<{ name: string; value: any }>;
}>) {
  const globalId = tile.id + FIRST_GID;
  for (const prop of tile.properties) {
    if (prop.name === "collision" && prop.value === true) {
      collisionTileIds.add(globalId);
    }
  }
}

// ---- Extract layers by name (lobby export uses "base" + "interactive") ----
const layers = mapJson.layers as Array<{
  name: string;
  data?: number[];
  type: string;
  objects?: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
    polygon?: Array<{ x: number; y: number }>;
    properties?: Array<{ name: string; value: any }>;
  }>;
}>;
const baseLayer = layers.find((l) => {
  const n = l.name.toLowerCase();
  return n === "baselayer" || n === "base";
});
const interactiveLayerRaw = layers.find(
  (l) => l.name.toLowerCase() === "interactive",
);

if (!baseLayer?.data) throw new Error("base layer not found in Lobby map.json");

// The "interactive" entry can be either a tile layer (collision data)
// OR an object layer (the Play polygon). We accept both shapes.
const interactiveIsTileLayer = !!interactiveLayerRaw?.data;
const interactiveIsObjectLayer =
  interactiveLayerRaw?.type === "objectgroup" &&
  Array.isArray(interactiveLayerRaw.objects);

if (!interactiveLayerRaw) {
  throw new Error("interactive layer not found in Lobby map.json");
}

// ---- Convert flat arrays to 2D grids ----
function to2D(flat: number[], cols: number): number[][] {
  const rows: number[][] = [];
  for (let r = 0; r < flat.length / cols; r++) {
    rows.push(flat.slice(r * cols, (r + 1) * cols));
  }
  return rows;
}

const baselayer = to2D(baseLayer.data, COLS);
// When "interactive" is an object layer (the lobby case) there's no
// collision tile grid - we synthesise an empty one so the renderer can
// still iterate it. Real collision comes from the baselayer tiles via
// the tileset property below.
const interactiveLayer = interactiveIsTileLayer
  ? to2D(interactiveLayerRaw.data!, COLS)
  : Array.from({ length: ROWS }, () => Array(COLS).fill(0));

// ---- Build collision grid ----
// The lobby tileset uses "collision" bool tiles. Collision is determined
// by checking if the baselayer tile id is in `collisionTileIds` (the
// lobby doesn't use a separate collision layer).
const collisionGrid = new Uint8Array(COLS * ROWS);
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    if (collisionTileIds.has(baselayer[r][c])) {
      collisionGrid[r * COLS + c] = 1;
    }
  }
}

// ---- No spawn tiles in the lobby - hard-code to the center ----
const spawnPoint = { x: (COLS * TILE_SIZE) / 2, y: (ROWS * TILE_SIZE) / 2 };

// ---- Extract interactive objects (only the "Play" polygon matters now) ----
const interactiveObjects: LobbyInteractivePolygon[] = [];
if (interactiveIsObjectLayer && interactiveLayerRaw.objects) {
  for (const obj of interactiveLayerRaw.objects) {
    const props = (obj.properties ?? []).map((p) => String(p.name));
    const vertices = (obj as any).polygon ?? [];
    // Compute the AABB from the polygon's vertices (Tiled's polygon
    // vertex coordinates are RELATIVE to the polygon's (x, y) anchor).
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const v of vertices) {
      if (typeof v?.x === "number" && typeof v?.y === "number") {
        minX = Math.min(minX, v.x);
        minY = Math.min(minY, v.y);
        maxX = Math.max(maxX, v.x);
        maxY = Math.max(maxY, v.y);
      }
    }
    const bbox =
      vertices.length > 0
        ? {
            x: obj.x + minX,
            y: obj.y + minY,
            width: maxX - minX,
            height: maxY - minY,
          }
        : // Fallback to the polygon's stored size (rare; rect objects).
          {
            x: obj.x,
            y: obj.y,
            width: obj.width || 0,
            height: obj.height || 0,
          };
    interactiveObjects.push({
      x: obj.x,
      y: obj.y,
      vertices,
      bbox,
      properties: props,
    });
  }
}

export const LOBBY_MAP_DATA: LobbyMapData = {
  id: "lobby",
  name: "Lobby",
  tileSize: TILE_SIZE,
  cols: COLS,
  rows: ROWS,
  widthPx: COLS * TILE_SIZE,
  heightPx: ROWS * TILE_SIZE,
  baselayer,
  interactiveLayer,
  collisionGrid,
  tilesetColumns: tilesetJson.columns,
  tilesetKey: "lobby_tiles",
  firstgid: FIRST_GID,
  spawnPoint,
  interactiveObjects,
};

/**
 * The "Play" interactive polygon (the only one the player can click to
 * start a run). Null if the lobby map doesn't have it (defensive).
 */
export const LOBBY_PLAY_POLYGON: LobbyInteractivePolygon | null =
  LOBBY_MAP_DATA.interactiveObjects.find((o) =>
    o.properties.includes("Play"),
  ) ?? null;

/**
 * The "MULTIPLYER" polygon (only one; the map JSON has a single
 * polygon with property name "multiplayer" set to true). Clicking it
 * opens the multiplayer lobby code dialog. Falls back to null if the
 * map data didn't include it (defensive).
 */
export const LOBBY_MULTIPLAYER_POLYGON: LobbyInteractivePolygon | null =
  LOBBY_MAP_DATA.interactiveObjects.find((o) =>
    o.properties.includes("multiplayer"),
  ) ?? null;
