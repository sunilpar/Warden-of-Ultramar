/**
 * Map System
 * ==========
 * Handles collision detection against map obstacles and boundary clamping.
 * This is a simple single-map system (no per-player map instances).
 */

import { MapDefinition, MapObstacle, HitboxOverride } from "../config/maps";

/** Compute the effective collision rect from a visual rect + optional hitbox override. */
function getHitboxRect(
  x: number,
  y: number,
  width: number,
  height: number,
  hitbox?: HitboxOverride,
): { x: number; y: number; width: number; height: number } {
  if (!hitbox) return { x, y, width, height };
  const offsetX = (width - hitbox.width) / 2;
  const offsetY = (height - hitbox.height) / 2;
  return { x: x + offsetX, y: y + offsetY, width: hitbox.width, height: hitbox.height };
}

export class MapSystem {
  private map: MapDefinition;

  constructor(map: MapDefinition) {
    this.map = map;
  }

  get width(): number { return this.map.widthPx; }
  get height(): number { return this.map.heightPx; }

  getSpawnPoint(): { x: number; y: number } {
    const spawn = this.map.playerSpawns[0];
    return { x: spawn.x, y: spawn.y };
  }

  getObstacles(): MapObstacle[] {
    return this.map.obstacles;
  }

  /**
   * Check if a circle (at x,y with given radius) collides with any obstacle.
   * Returns the first colliding obstacle, or null.
   */
  checkObstacleCollision(x: number, y: number, radius: number): MapObstacle | null {
    for (const obstacle of this.map.obstacles) {
      const hb = getHitboxRect(
        obstacle.x, obstacle.y, obstacle.width, obstacle.height, obstacle.hitbox,
      );
      const closestX = Math.max(hb.x, Math.min(x, hb.x + hb.width));
      const closestY = Math.max(hb.y, Math.min(y, hb.y + hb.height));
      const dx = x - closestX;
      const dy = y - closestY;
      if (dx * dx + dy * dy < radius * radius) {
        return obstacle;
      }
    }
    return null;
  }

  /**
   * Push a circle out of an obstacle so they no longer overlap.
   */
  resolveObstacleCollision(
    x: number, y: number, radius: number, obstacle: MapObstacle,
  ): { x: number; y: number } {
    const hb = getHitboxRect(
      obstacle.x, obstacle.y, obstacle.width, obstacle.height, obstacle.hitbox,
    );
    const closestX = Math.max(hb.x, Math.min(x, hb.x + hb.width));
    const closestY = Math.max(hb.y, Math.min(y, hb.y + hb.height));
    const dx = x - closestX;
    const dy = y - closestY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist === 0) {
      // Center is inside the obstacle — push out along nearest edge
      const leftDist = Math.abs(x - hb.x);
      const rightDist = Math.abs(hb.x + hb.width - x);
      const topDist = Math.abs(y - hb.y);
      const bottomDist = Math.abs(hb.y + hb.height - y);
      const minDist = Math.min(leftDist, rightDist, topDist, bottomDist);
      if (minDist === leftDist) return { x: hb.x - radius, y };
      if (minDist === rightDist) return { x: hb.x + hb.width + radius, y };
      if (minDist === topDist) return { x, y: hb.y - radius };
      return { x, y: hb.y + hb.height + radius };
    }

    const overlap = radius - dist;
    return {
      x: x + (dx / dist) * overlap,
      y: y + (dy / dist) * overlap,
    };
  }
}
