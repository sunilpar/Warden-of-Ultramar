/**
 * Client-Side Map Data
 * =====================
 * Mirror of the server's map configuration.
 * KEEP IN SYNC with server/src/config/maps.ts!
 */

export interface MapRect {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

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

export interface MapObstacle extends MapRect {
  obstacleType: ObstacleType;
  /**
   * Optional hitbox override for collision.
   * Visual sprite stays at width/height, but collision uses this smaller rect.
   * The hitbox is automatically centered within the visual bounds.
   * If omitted, the full visual width/height is used for collision.
   */
  hitbox?: HitboxOverride;
}

export interface EnemySpawnZone extends MapRect {
  enemyTypes: string[];
  maxAlive: number;
  intervalMs: number;
  /**
   * Optional hitbox override for collision.
   * Visual sprite stays at width/height, but collision uses this smaller rect.
   * The hitbox is automatically centered within the visual bounds.
   * If omitted, the full visual width/height is used for collision.
   */
  hitbox?: HitboxOverride;
}

export interface PlayerSpawnPoint {
  name: string;
  x: number;
  y: number;
  /**
   * Optional visual size override for rendering.
   * Controls the visual display size of the spawn marker on the client.
   */
  visualSize?: number;
}

export interface MapExitPoint {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /**
   * Optional hitbox override for the trigger zone.
   * Visual sprite stays at width/height, but the trigger uses this smaller rect.
   * The hitbox is automatically centered within the visual bounds.
   * If omitted, the full visual width/height is used.
   */
  hitbox?: HitboxOverride;
}

export interface MapDefinition {
  id: string;
  name: string;
  widthPx: number;
  heightPx: number;
  tileSize: number;
  tiles: number[][];
  obstacles: MapObstacle[];
  playerSpawns: PlayerSpawnPoint[];
  enemySpawnZones: EnemySpawnZone[];
  exitPoint: MapExitPoint;
  tilesetColumns: number;
}

function generateFloorTiles(rows: number, cols: number): number[][] {
  const tiles: number[][] = [];
  for (let row = 0; row < rows; row++) {
    const tileRow: number[] = [];
    for (let col = 0; col < cols; col++) {
      tileRow.push(((row + col) % 4) + 1);
    }
    tiles.push(tileRow);
  }
  return tiles;
}

// ============================================================
// HELPER: Compute centered hitbox rect from visual rect + hitbox override
// ============================================================

/**
 * Given a visual rect (x, y, width, height) and an optional hitbox override,
 * compute the actual collision rect (x, y, width, height).
 *
 * If hitbox is omitted, returns the visual rect as-is.
 * If hitbox is specified, it is centered within the visual bounds.
 */
export function getHitboxRect(
  x: number,
  y: number,
  width: number,
  height: number,
  hitbox?: HitboxOverride,
): { x: number; y: number; width: number; height: number } {
  if (!hitbox) {
    return { x, y, width, height };
  }
  // Center the hitbox within the visual bounds
  const offsetX = (width - hitbox.width) / 2;
  const offsetY = (height - hitbox.height) / 2;
  return {
    x: x + offsetX,
    y: y + offsetY,
    width: hitbox.width,
    height: hitbox.height,
  };
}

export const MAP_1: MapDefinition = {
  id: "map_1_first_hall",
  name: "The First Hall",
  widthPx: 40 * 64, // 2560 pixels
  heightPx: 50 * 64, // 3200 pixels
  tileSize: 64,
  tiles: generateFloorTiles(50, 40),

  // Obstacles — visual size + smaller hitbox for collision
  obstacles: [
    {
      name: "big_obstacle_1",
      x: 768,
      y: 192,
      width: 256,
      height: 256,
      obstacleType: "big",
      hitbox: { width: 100, height: 100 },
    },
    {
      name: "big_obstacle_2",
      x: 1280,
      y: 2048,
      width: 256,
      height: 192,
      obstacleType: "big",
      hitbox: { width: 180, height: 134 },
    },
    {
      name: "small_obstacle_1",
      x: 384,
      y: 576,
      width: 96,
      height: 96,
      obstacleType: "small",
      hitbox: { width: 64, height: 64 },
    },
    {
      name: "small_obstacle_2",
      x: 1728,
      y: 2560,
      width: 96,
      height: 96,
      obstacleType: "small",
      hitbox: { width: 64, height: 64 },
    },
  ],

  // Player spawn points — visualSize for client marker rendering
  playerSpawns: [
    { name: "spawn_start", x: 192, y: 192, visualSize: 32 },
    { name: "checkpoint_mid", x: 1280, y: 1600, visualSize: 32 },
  ],

  // Enemy spawn zones — visual size + smaller hitbox for collision
  enemySpawnZones: [
    {
      name: "enemy_zone_top",
      x: 512,
      y: 128,
      width: 192,
      height: 192,
      enemyTypes: ["elder"],
      maxAlive: 3,
      intervalMs: 3000,
      hitbox: { width: 134, height: 134 },
    },
    {
      name: "enemy_zone_right",
      x: 1920,
      y: 256,
      width: 192,
      height: 256,
      enemyTypes: ["ork"],
      maxAlive: 2,
      intervalMs: 4000,
      hitbox: { width: 134, height: 180 },
    },
    {
      name: "enemy_zone_bottom",
      x: 896,
      y: 2560,
      width: 256,
      height: 192,
      enemyTypes: ["elder", "ork"],
      maxAlive: 4,
      intervalMs: 2500,
      hitbox: { width: 180, height: 134 },
    },
  ],

  // Exit point — visual size + smaller hitbox for trigger zone
  exitPoint: {
    name: "exit_bottom_right",
    x: 2304,
    y: 3008,
    width: 192,
    height: 128,
    hitbox: { width: 134, height: 90 },
  },

  tilesetColumns: 4,
};
