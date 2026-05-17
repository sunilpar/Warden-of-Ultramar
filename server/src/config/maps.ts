/**
 * Map Configuration System
 * =========================
 * Defines the data structure for game maps and holds all map definitions.
 *
 * HOW IT WORKS:
 *   - Each map is a JSON-like TypeScript object
 *   - The server loads a map and uses it for: collision, spawning, bounds
 *   - The client loads the same map data for: tile rendering, debug hitboxes
 *   - Both sides share the same coordinate system
 *
 * MAP STRUCTURE:
 *   - Tile grid: 2D array of tile IDs (0 = floor, rendered from spritesheet)
 *   - Obstacles: positioned rectangles with hitboxes ( impassable )
 *   - Player spawns: where players appear on join / respawn
 *   - Enemy spawn zones: labeled areas where specific enemy types appear
 *   - Exit point: triggers map transition (teleports to spawn for now)
 *
 * HITBOXES:
 *   Every entity has a hitbox (the collision boundary) that may differ
 *   from its visual sprite. The hitbox is what actually collides.
 *   - Player hitbox: circle (radius defined in game config)
 *   - Obstacle hitbox: rectangle (defined per obstacle)
 *   - Spawn zone hitbox: rectangle (defines the spawn area)
 *   - Exit point hitbox: rectangle (trigger zone)
 *
 * COORDINATE SYSTEM:
 *   - (0,0) is top-left of the map
 *   - X increases rightward, Y increases downward
 *   - All positions are in pixels
 *   - Tile indices: tiles[row][col], where row=Y direction, col=X direction
 */

// ============================================================
// TYPE DEFINITIONS
// ============================================================

/** A rectangular hitbox used for obstacles, spawn zones, exit points */
export interface MapRect {
  /** Unique name for debugging */
  name: string;
  /** X position of top-left corner (pixels) */
  x: number;
  /** Y position of top-left corner (pixels) */
  y: number;
  /** Width in pixels */
  width: number;
  /** Height in pixels */
  height: number;
}

/** Types of obstacles */
export type ObstacleType = "small" | "big";

/**
 * Optional hitbox override.
 * If specified, the collision rect is centered within the visual bounds.
 * If omitted, the full visual width/height is used for collision.
 */
export interface HitboxOverride {
  /** Hitbox width in pixels (≤ visual width) */
  width: number;
  /** Hitbox height in pixels (≤ visual height) */
  height: number;
}

/** An obstacle that blocks movement and bullets */
export interface MapObstacle extends MapRect {
  /** Visual type (determines which sprite to use) */
  obstacleType: ObstacleType;
  /**
   * Optional hitbox override for collision.
   * Visual sprite stays at width/height, but collision uses this smaller rect.
   * The hitbox is automatically centered within the visual bounds.
   * If omitted, the full visual width/height is used for collision.
   */
  hitbox?: HitboxOverride;
}

/** An enemy spawn zone — enemies appear within this rectangle */
export interface EnemySpawnZone extends MapRect {
  /** Which enemy types can spawn here */
  enemyTypes: string[];
  /** Maximum concurrent enemies from this zone */
  maxAlive: number;
  /** Spawn interval in milliseconds */
  intervalMs: number;
  /**
   * Optional hitbox override for collision.
   * Visual sprite stays at width/height, but collision uses this smaller rect.
   * The hitbox is automatically centered within the visual bounds.
   * If omitted, the full visual width/height is used for collision.
   */
  hitbox?: HitboxOverride;
}

/** A player checkpoint — players spawn/respawn at the nearest one */
export interface PlayerSpawnPoint {
  /** Unique name for debugging */
  name: string;
  /** Center X position (pixels) */
  x: number;
  /** Center Y position (pixels) */
  y: number;
  /**
   * Optional visual size override for rendering.
   * The spawn point is a point (x, y), but the visual marker has a size.
   * This controls the visual display size on the client.
   */
  visualSize?: number;
}

/** The exit zone — triggers map transition */
export interface MapExitPoint {
  /** Unique name for debugging */
  name: string;
  /** X position of top-left corner (pixels) */
  x: number;
  /** Y position of top-left corner (pixels) */
  y: number;
  /** Width in pixels */
  width: number;
  /** Height in pixels */
  height: number;
  /**
   * Optional hitbox override for the trigger zone.
   * Visual sprite stays at width/height, but the trigger uses this smaller rect.
   * The hitbox is automatically centered within the visual bounds.
   * If omitted, the full visual width/height is used.
   */
  hitbox?: HitboxOverride;
}

/** Complete map definition */
export interface MapDefinition {
  /** Unique map identifier */
  id: string;
  /** Human-readable map name */
  name: string;
  /** Width of the map in pixels */
  widthPx: number;
  /** Height of the map in pixels */
  heightPx: number;
  /** Size of each tile in pixels (tiles are square) */
  tileSize: number;
  /**
   * Tile grid: tiles[row][col] = tile ID
   * Tile ID 0 = empty/void (not rendered)
   * Tile ID 1-4 = floor variations from the spritesheet
   * The grid dimensions determine the map size.
   */
  tiles: number[][];
  /** Obstacles — block all movement and bullets */
  obstacles: MapObstacle[];
  /** Player spawn points (checkpoints) */
  playerSpawns: PlayerSpawnPoint[];
  /** Enemy spawn zones */
  enemySpawnZones: EnemySpawnZone[];
  /** Exit zone (map transition trigger) */
  exitPoint: MapExitPoint;
  /** Path to the tile spritesheet image (client-only) */
  tilesetImage: string;
  /** Number of tile columns in the spritesheet */
  tilesetColumns: number;
  /** Sprites for obstacles (client-only rendering) */
  obstacleSprites: Record<ObstacleType, string>;
  /** Sprites for spawn points (client-only rendering) */
  spawnSprites: {
    player: string;
    enemy: string[];
  };
  /** Sprite for exit point (client-only rendering) */
  exitSprite: string;
  /** Next map ID (for map progression) */
  nextMapId: string | null;
}

// ============================================================
// MAP DEFINITIONS
// ============================================================

/**
 * Map 1 — "The First Hall"
 * ========================
 * A simple rectangular map to test all systems:
 *   - 40×30 tiles at 32px each = 1280×960 pixels (2× the viewport)
 *   - Floor: alternating tile patterns for visual variety
 *   - 2 large obstacles + 2 small obstacles
 *   - 1 player spawn point (top-left area)
 *   - 1 additional checkpoint (center)
 *   - 3 enemy spawn zones (spread across the map)
 *   - 1 exit point (bottom-right corner)
 *
 * LAYOUT (approximate):
 *
 *   ┌──────────────────────────────────────┐
 *   │ [P1]           │  obs1  │            │
 *   │        enemy1   │       │   enemy2   │
 *   │                 │       │            │
 *   │    obs_s1       └───────┘            │
 *   │                                      │
 *   │           [CP]                        │
 *   │                                      │
 *   │              │  obs2  │    obs_s2    │
 *   │    enemy3    │       │              │
 *   │              │       │        [EXIT]│
 *   └──────────────────────────────────────┘
 *
 *   P1 = Player spawn, CP = Checkpoint, EXIT = Exit point
 *   obs = big obstacle, obs_s = small obstacle
 */
export const MAP_1: MapDefinition = {
  id: "map_1_first_hall",
  name: "The First Hall",

  // Map dimensions: 40 tiles wide × 50 tiles tall at 64px each
  widthPx: 40 * 64, // 2560 pixels
  heightPx: 50 * 64, // 3200 pixels
  tileSize: 64,

  // Tile grid: 50 rows × 40 columns
  tiles: generateFloorTiles(50, 40),

  // Obstacles (impassable rectangles)
  // Each has an optional `hitbox` that is SMALLER than the visual sprite.
  // The hitbox is centered within the visual bounds automatically.
  // Adjust hitbox values here to fine-tune collision per asset.
  obstacles: [
    // ---- BIG OBSTACLES (ruined buildings / churches) ----
    {
      name: "big_obstacle_1",
      x: 768,
      y: 192,
      width: 150,
      height: 180,
      obstacleType: "big",
      //broken curch type
      hitbox: { width: 100, height: 160 },
    },
    {
      name: "big_obstacle_2",
      x: 1280,
      y: 2048,
      width: 150,
      height: 180,
      obstacleType: "big",
      //broken curch type
      hitbox: { width: 100, height: 160 },
    },
    {
      name: "big_obstacle_3",
      x: 384,
      y: 1152,
      width: 150,
      height: 180,
      obstacleType: "big",
      //broken curch type
      hitbox: { width: 100, height: 160 },
    },
    {
      name: "big_obstacle_4",
      x: 1984,
      y: 1152,
      width: 150,
      height: 180,
      obstacleType: "big",
      //broken curch type
      hitbox: { width: 100, height: 160 },
    },
    {
      name: "big_obstacle_5",
      x: 704,
      y: 2432,
      width: 150,
      height: 180,
      obstacleType: "big",
      //broken curch type
      hitbox: { width: 100, height: 160 },
    },
    {
      name: "big_obstacle_6",
      x: 1536,
      y: 640,
      width: 150,
      height: 180,
      obstacleType: "big",
      //broken curch type
      hitbox: { width: 100, height: 160 },
    },
    // ---- SMALL OBSTACLES (pillars) ----
    {
      name: "small_obstacle_1",
      x: 384,
      y: 576,
      width: 66,
      height: 160,
      obstacleType: "small",
      //piller type
      hitbox: { width: 66, height: 140 },
    },
    {
      name: "small_obstacle_2",
      x: 1728,
      y: 2560,
      width: 66,
      height: 160,
      obstacleType: "small",
      //piller type
      hitbox: { width: 66, height: 140 },
    },
    {
      name: "small_obstacle_3",
      x: 1088,
      y: 832,
      width: 66,
      height: 160,
      obstacleType: "small",
      //piller type
      hitbox: { width: 66, height: 140 },
    },
    {
      name: "small_obstacle_4",
      x: 640,
      y: 1728,
      width: 66,
      height: 160,
      obstacleType: "small",
      //piller type
      hitbox: { width: 66, height: 140 },
    },
    {
      name: "small_obstacle_5",
      x: 1920,
      y: 1728,
      width: 66,
      height: 160,
      obstacleType: "small",
      //piller type
      hitbox: { width: 66, height: 140 },
    },
    {
      name: "small_obstacle_6",
      x: 1152,
      y: 1472,
      width: 66,
      height: 160,
      obstacleType: "small",
      //piller type
      hitbox: { width: 66, height: 140 },
    },
    {
      name: "small_obstacle_7",
      x: 320,
      y: 2816,
      width: 66,
      height: 160,
      obstacleType: "small",
      //piller type
      hitbox: { width: 66, height: 140 },
    },
    {
      name: "small_obstacle_8",
      x: 2112,
      y: 768,
      width: 66,
      height: 160,
      obstacleType: "small",
      //piller type
      hitbox: { width: 66, height: 140 },
    },
    {
      name: "small_obstacle_9",
      x: 1408,
      y: 2880,
      width: 66,
      height: 160,
      obstacleType: "small",
      //piller type
      hitbox: { width: 66, height: 140 },
    },
    {
      name: "small_obstacle_10",
      x: 832,
      y: 384,
      width: 66,
      height: 160,
      obstacleType: "small",
      //piller type
      hitbox: { width: 66, height: 140 },
    },
  ],

  // Player spawn points (checkpoints)
  // `visualSize` controls the client-side marker size (default 32px if omitted)
  playerSpawns: [
    { name: "spawn_start", x: 192, y: 192, visualSize: 50 },
    { name: "checkpoint_mid", x: 1280, y: 1600, visualSize: 50 },
  ],

  // Enemy spawn zones (also act as obstacles for players)
  // `hitbox` is the collision zone (centered within visual bounds)
  // 10 total spawn zones spread across the map for dynamic combat
  enemySpawnZones: [
    // ---- TOP SECTION (y: 0-640) ----
    {
      name: "enemy_zone_top",
      x: 512,
      y: 128,
      width: 192,
      height: 192,
      enemyTypes: ["elder"],
      maxAlive: 3,
      intervalMs: 3000,
      //chrch type
      hitbox: { width: 134, height: 160 },
    },
    {
      name: "enemy_zone_top_right",
      x: 1920,
      y: 256,
      width: 147,
      height: 130,
      enemyTypes: ["ork"],
      maxAlive: 2,
      intervalMs: 4000,
      //trynids type
      hitbox: { width: 128, height: 130 },
    },
    {
      name: "enemy_zone_top_center",
      x: 1152,
      y: 320,
      width: 192,
      height: 192,
      enemyTypes: ["elder", "ork"],
      maxAlive: 3,
      intervalMs: 3500,
      //sightly broken curch type
      hitbox: { width: 148, height: 158 },
    },
    // ---- MIDDLE SECTION (y: 640-1920) ----
    {
      name: "enemy_zone_mid_left",
      x: 128,
      y: 896,
      width: 192,
      height: 192,
      enemyTypes: ["ork"],
      maxAlive: 3,
      intervalMs: 3000,
      //chrch type
      hitbox: { width: 134, height: 160 },
    },
    {
      name: "enemy_zone_mid_center",
      x: 1088,
      y: 1088,
      width: 147,
      height: 130,
      enemyTypes: ["elder"],
      maxAlive: 2,
      intervalMs: 3500,
      //trynids type
      hitbox: { width: 128, height: 130 },
    },
    {
      name: "enemy_zone_mid_right",
      x: 2048,
      y: 1408,
      width: 192,
      height: 192,
      enemyTypes: ["ork", "elder"],
      maxAlive: 3,
      intervalMs: 3000,
      //sightly broken curch type
      hitbox: { width: 148, height: 158 },
    },
    // ---- LOWER SECTION (y: 1920-3200) ----
    {
      name: "enemy_zone_bottom",
      x: 896,
      y: 2560,
      width: 192,
      height: 192,
      enemyTypes: ["elder", "ork"],
      maxAlive: 4,
      intervalMs: 2500,
      //sightly broken curch type
      hitbox: { width: 148, height: 158 },
    },
    {
      name: "enemy_zone_bottom_left",
      x: 256,
      y: 2240,
      width: 147,
      height: 130,
      enemyTypes: ["ork"],
      maxAlive: 3,
      intervalMs: 3000,
      //trynids type
      hitbox: { width: 128, height: 130 },
    },
    {
      name: "enemy_zone_bottom_far_left",
      x: 128,
      y: 2880,
      width: 192,
      height: 192,
      enemyTypes: ["elder"],
      maxAlive: 3,
      intervalMs: 3500,
      //chrch type
      hitbox: { width: 134, height: 160 },
    },
    {
      name: "enemy_zone_bottom_right",
      x: 1792,
      y: 2880,
      width: 147,
      height: 130,
      enemyTypes: ["ork", "elder"],
      maxAlive: 3,
      intervalMs: 2500,
      //trynids type
      hitbox: { width: 128, height: 130 },
    },
  ],

  // Exit point (bottom-right corner)
  // `hitbox` is the trigger zone (centered within visual bounds)
  exitPoint: {
    name: "exit_bottom_right",
    x: 2304,
    y: 3008,
    width: 200,
    height: 140,
    hitbox: { width: 150, height: 80 },
  },

  // Client-only: asset paths
  tilesetImage: "assets/maps/map1/maptileBasic.png",
  tilesetColumns: 4, // 4 tiles in a row in the spritesheet
  obstacleSprites: {
    big: "assets/maps/map1/mapObsticalBig.png",
    small: "assets/maps/map1/smallObstical.png",
  },
  spawnSprites: {
    player: "assets/maps/map1/playerSpawnPoint.png",
    enemy: [
      "assets/maps/map1/enemyspawnPoint1.png",
      "assets/maps/map1/enemyswpanPoint2.png",
      "assets/maps/map1/enemyspawnpoint3.png",
    ],
  },
  exitSprite: "assets/maps/map1/mapExitpoint.png",
  nextMapId: null, // No next map yet
};

// ============================================================
// MAP REGISTRY
// ============================================================

/** All maps indexed by ID */
const mapRegistry: Map<string, MapDefinition> = new Map();

/** Register a map */
export function registerMap(map: MapDefinition): void {
  mapRegistry.set(map.id, map);
}

/** Get a map by ID */
export function getMap(id: string): MapDefinition | undefined {
  return mapRegistry.get(id);
}

/** Get the first registered map (default) */
export function getDefaultMap(): MapDefinition | undefined {
  return mapRegistry.values().next().value;
}

// Register all maps
registerMap(MAP_1);

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Generate a simple floor tile grid filled with alternating tile IDs.
 * All tiles get IDs 1-4 for visual variety.
 *
 * @param rows - Number of tile rows
 * @param cols - Number of tile columns
 * @returns 2D array of tile IDs
 */
function generateFloorTiles(rows: number, cols: number): number[][] {
  const tiles: number[][] = [];
  for (let row = 0; row < rows; row++) {
    const tileRow: number[] = [];
    for (let col = 0; col < cols; col++) {
      // Create a simple alternating pattern using 4 tile variations
      tileRow.push(((row + col) % 4) + 1);
    }
    tiles.push(tileRow);
  }
  return tiles;
}
