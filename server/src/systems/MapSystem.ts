/**
 * Map System
 * ===========
 * Manages the currently loaded map and provides map-related queries:
 *   - Obstacle collision checks (player and bullet)
 *   - Exit point detection (map transition trigger)
 *   - Nearest checkpoint finder (for respawn)
 *   - Spawn zone data (for SpawnSystem)
 *
 * HOW IT WORKS:
 *   - The MapSystem holds a reference to the current MapDefinition
 *   - Other systems ask MapSystem questions like "does this position
 *     collide with any obstacle?" or "where is the nearest checkpoint?"
 *   - MapSystem does NOT move entities — it only answers queries
 *
 * SERVER AUTHORITY:
 *   All collision decisions are made here on the server.
 *   The client renders debug hitboxes for visualization only.
 *
 * OBSTACLE COLLISION RESOLUTION:
 *   When a player or enemy moves into an obstacle, the calling system
 *   (PlayerSystem / EnemyAISystem) needs to resolve the collision.
 *   MapSystem provides `resolveObstacleCollision()` which pushes
 *   the entity out of the obstacle along the shortest axis.
 */

import { MapDefinition, MapObstacle, HitboxOverride } from "../config/maps";
import { circleRectCollision, pointInRect } from "../utils/collision";
import { GAME_CONFIG } from "../config/game";

/**
 * Compute the effective collision rect from a visual rect + optional hitbox override.
 * If hitbox is defined, it is centered within the visual bounds.
 * If hitbox is omitted, the visual rect is used as-is.
 */
function getHitboxRect(
  x: number, y: number,
  width: number, height: number,
  hitbox?: HitboxOverride
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

export class MapSystem {
  /** The currently loaded map */
  private map: MapDefinition;

  constructor(map: MapDefinition) {
    this.map = map;
  }

  /**
   * Get the current map definition.
   * Used by other systems to read map data.
   */
  getMap(): MapDefinition {
    return this.map;
  }

  /**
   * Get the map width in pixels.
   */
  get mapWidth(): number {
    return this.map.widthPx;
  }

  /**
   * Get the map height in pixels.
   */
  get mapHeight(): number {
    return this.map.heightPx;
  }

  /**
   * Get all obstacles on the current map.
   */
  getObstacles(): MapObstacle[] {
    return this.map.obstacles;
  }

  /**
   * Check if a circular entity (player, enemy) collides with any obstacle.
   *
   * HOW: Tests circle-vs-rectangle collision against every obstacle.
   * Returns the first obstacle hit, or null if none.
   *
   * PERFORMANCE: For a small number of obstacles (< 50), brute-force
   * is fine. For larger maps, use spatial partitioning (grid/quadtree).
   *
   * @param x - Entity center X
   * @param y - Entity center Y
   * @param radius - Entity collision radius
   * @returns The obstacle hit, or null
   */
  checkObstacleCollision(
    x: number, y: number, radius: number
  ): MapObstacle | null {
    for (const obstacle of this.map.obstacles) {
      const hb = getHitboxRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height, obstacle.hitbox);
      if (circleRectCollision(x, y, radius, hb.x, hb.y, hb.width, hb.height)) {
        return obstacle;
      }
    }
    return null;
  }

  /**
   * Resolve a collision by pushing the entity out of an obstacle.
   *
   * HOW: Finds the shortest push direction (X or Y) and moves
   * the entity just outside the obstacle boundary.
   *
   * This prevents entities from clipping through obstacles.
   *
   * @param x - Entity center X
   * @param y - Entity center Y
   * @param radius - Entity collision radius
   * @param obstacle - The obstacle to resolve against
   * @returns New position that is outside the obstacle
   */
  resolveObstacleCollision(
    x: number, y: number,
    radius: number,
    obstacle: MapObstacle
  ): { x: number; y: number } {
    // Use hitbox dimensions for collision resolution
    const hb = getHitboxRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height, obstacle.hitbox);

    // Calculate the overlap on each axis
    const entityLeft = x - radius;
    const entityRight = x + radius;
    const entityTop = y - radius;
    const entityBottom = y + radius;

    const obsLeft = hb.x;
    const obsRight = hb.x + hb.width;
    const obsTop = hb.y;
    const obsBottom = hb.y + hb.height;

    // Calculate push distances for each direction
    const pushLeft = obsLeft - entityRight;  // push entity left
    const pushRight = obsRight - entityLeft; // push entity right
    const pushUp = obsTop - entityBottom;    // push entity up
    const pushDown = obsBottom - entityTop;  // push entity down

    // Find the smallest push (shortest way out)
    const pushes = [
      { dx: pushLeft, dy: 0 },
      { dx: pushRight, dy: 0 },
      { dx: 0, dy: pushUp },
      { dx: 0, dy: pushDown },
    ];

    // Sort by absolute value (smallest push first)
    pushes.sort((a, b) => Math.abs(a.dx + a.dy) - Math.abs(b.dx + b.dy));

    // Apply the smallest push
    return {
      x: x + pushes[0].dx,
      y: y + pushes[0].dy,
    };
  }

  /**
   * Check if a bullet should be destroyed by hitting an obstacle.
   * Also checks enemy spawn zones as blocking.
   */
  checkBulletObstacleCollision(
    x: number, y: number, radius: number
  ): boolean {
    for (const obstacle of this.map.obstacles) {
      const hb = getHitboxRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height, obstacle.hitbox);
      if (circleRectCollision(x, y, radius, hb.x, hb.y, hb.width, hb.height)) {
        return true;
      }
    }
    // Also check enemy spawn zones as bullet blockers
    for (const zone of this.map.enemySpawnZones) {
      const hb = getHitboxRect(zone.x, zone.y, zone.width, zone.height, zone.hitbox);
      if (circleRectCollision(x, y, radius, hb.x, hb.y, hb.width, hb.height)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get blocking rects for entity movement (obstacles ONLY).
   * Enemy spawn zones do NOT block player or enemy movement.
   *
   * Used by PlayerSystem and EnemyAISystem to prevent walking through walls.
   *
   * IMPORTANT: These are the actual collision rects (with hitbox applied),
   * NOT the visual rects. The visual rects are on the original map data.
   */
  getAllBlockingRects(): { x: number; y: number; width: number; height: number; name: string }[] {
    const rects: { x: number; y: number; width: number; height: number; name: string }[] = [];
    for (const obs of this.map.obstacles) {
      const hb = getHitboxRect(obs.x, obs.y, obs.width, obs.height, obs.hitbox);
      rects.push({ ...hb, name: obs.name });
    }
    // Enemy spawn zones do NOT block movement — they only block bullets.
    // See checkBulletObstacleCollision() for bullet blocking.
    return rects;
  }

  /**
   * Check if a circular entity collides with any blocking rect
   * (obstacles + enemy spawn zones). Uses hitbox dimensions for collision.
   */
  checkAllBlockingCollision(
    x: number, y: number, radius: number
  ): { x: number; y: number; width: number; height: number; name: string } | null {
    for (const rect of this.getAllBlockingRects()) {
      if (circleRectCollision(x, y, radius, rect.x, rect.y, rect.width, rect.height)) {
        return rect;
      }
    }
    return null;
  }

  /**
   * Resolve collision against any blocking rect (hitbox-aware).
   * Same logic as resolveObstacleCollision but works with pre-computed hitbox rects.
   */
  resolveBlockingCollision(
    x: number, y: number,
    radius: number,
    rect: { x: number; y: number; width: number; height: number }
  ): { x: number; y: number } {
    const entityLeft = x - radius;
    const entityRight = x + radius;
    const entityTop = y - radius;
    const entityBottom = y + radius;

    const pushLeft = rect.x - entityRight;
    const pushRight = (rect.x + rect.width) - entityLeft;
    const pushUp = rect.y - entityBottom;
    const pushDown = (rect.y + rect.height) - entityTop;

    const pushes = [
      { dx: pushLeft, dy: 0 },
      { dx: pushRight, dy: 0 },
      { dx: 0, dy: pushUp },
      { dx: 0, dy: pushDown },
    ];
    pushes.sort((a, b) => Math.abs(a.dx + a.dy) - Math.abs(b.dx + b.dy));

    return { x: x + pushes[0].dx, y: y + pushes[0].dy };
  }

  /**
   * Check if a point is inside the exit zone.
   * Used to detect when a player reaches the map exit.
   *
   * @param x - Point X
   * @param y - Point Y
   * @returns true if the point is in the exit zone
   */
  isInExitZone(x: number, y: number): boolean {
    const exit = this.map.exitPoint;
    const hb = getHitboxRect(exit.x, exit.y, exit.width, exit.height, exit.hitbox);
    return pointInRect(x, y, hb.x, hb.y, hb.width, hb.height);
  }

  /**
   * Find the nearest player spawn point (checkpoint) to a given position.
   *
   * HOW: Calculates Euclidean distance to each spawn point.
   * Returns the closest one. Used for respawn after death.
   *
   * @param x - Current position X
   * @param y - Current position Y
   * @returns The nearest spawn point
   */
  getNearestSpawnPoint(x: number, y: number): { x: number; y: number } {
    let nearest = this.map.playerSpawns[0];
    let nearestDist = Infinity;

    for (const spawn of this.map.playerSpawns) {
      const dx = spawn.x - x;
      const dy = spawn.y - y;
      const dist = dx * dx + dy * dy; // squared distance (no sqrt needed)
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = spawn;
      }
    }

    return { x: nearest.x, y: nearest.y };
  }

  /**
   * Get the first (initial) spawn point for new players joining.
   */
  getInitialSpawnPoint(): { x: number; y: number } {
    return {
      x: this.map.playerSpawns[0].x,
      y: this.map.playerSpawns[0].y,
    };
  }

  /**
   * Get all enemy spawn zones for the current map.
   */
  getEnemySpawnZones() {
    return this.map.enemySpawnZones;
  }
}