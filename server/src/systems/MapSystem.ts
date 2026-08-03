/**
 * Map System (Per-Player)
 * ========================
 * Each player has their OWN map instance. All collision, boundary,
 * spawn-zone, and exit-zone queries are scoped per sessionId.
 *
 * The system holds a Map<sessionId, MapDefinition> so different players
 * can be on different maps simultaneously without affecting each other.
 */

import { MapDefinition, MapObstacle, EnemySpawnZone, HitboxOverride } from "../config/maps";
import { GAME_CONFIG } from "../config/game";

/**
 * Compute the effective collision rect from a visual rect + optional hitbox override.
 */
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
  /** Per-player map instances */
  private playerMaps: Map<string, MapDefinition> = new Map();
  /** The default map assigned to new players */
  private defaultMap: MapDefinition;

  constructor(defaultMap: MapDefinition) {
    this.defaultMap = defaultMap;
  }

  /** Register a new player with the default map. */
  registerPlayer(sessionId: string): void {
    this.playerMaps.set(sessionId, this.defaultMap);
  }

  /** Remove a player's map entry. */
  unregisterPlayer(sessionId: string): void {
    this.playerMaps.delete(sessionId);
  }

  /** Get all registered player session IDs. */
  getPlayerIds(): string[] {
    return Array.from(this.playerMaps.keys());
  }

  /** Get the map for a specific player. */
  getMap(sessionId: string): MapDefinition {
    const map = this.playerMaps.get(sessionId);
    if (!map) {
      // Fallback: register with default and return it
      this.registerPlayer(sessionId);
      return this.defaultMap;
    }
    return map;
  }

  /** Set a specific map for a player (used during map transitions). */
  setPlayerMap(sessionId: string, map: MapDefinition): void {
    this.playerMaps.set(sessionId, map);
  }

  getMapWidth(sessionId: string): number {
    return this.getMap(sessionId).widthPx;
  }

  getMapHeight(sessionId: string): number {
    return this.getMap(sessionId).heightPx;
  }

  getObstacles(sessionId: string): MapObstacle[] {
    return this.getMap(sessionId).obstacles;
  }

  getEnemySpawnZones(sessionId: string): EnemySpawnZone[] {
    return this.getMap(sessionId).enemySpawnZones;
  }

  // ============================================================
  // COLLISION
  // ============================================================

  checkObstacleCollision(
    sessionId: string,
    x: number,
    y: number,
    radius: number,
  ): MapObstacle | null {
    for (const obstacle of this.getObstacles(sessionId)) {
      const hb = getHitboxRect(
        obstacle.x,
        obstacle.y,
        obstacle.width,
        obstacle.height,
        obstacle.hitbox,
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

  resolveObstacleCollision(
    sessionId: string,
    x: number,
    y: number,
    radius: number,
    obstacle: MapObstacle,
  ): { x: number; y: number } {
    const hb = getHitboxRect(
      obstacle.x,
      obstacle.y,
      obstacle.width,
      obstacle.height,
      obstacle.hitbox,
    );
    const closestX = Math.max(hb.x, Math.min(x, hb.x + hb.width));
    const closestY = Math.max(hb.y, Math.min(y, hb.y + hb.height));
    const dx = x - closestX;
    const dy = y - closestY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist === 0) {
      // Push out along nearest edge
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

  checkBulletObstacleCollision(
    sessionId: string,
    x: number,
    y: number,
    radius: number,
  ): boolean {
    return this.checkObstacleCollision(sessionId, x, y, radius) !== null;
  }

  /** Alias used by SkillSystem */
  checkAllBlockingCollision(
    sessionId: string,
    x: number,
    y: number,
    radius: number,
  ): MapObstacle | null {
    return this.checkObstacleCollision(sessionId, x, y, radius);
  }

  resolveBlockingCollision(
    sessionId: string,
    x: number,
    y: number,
    radius: number,
    blocker: MapObstacle,
  ): { x: number; y: number } {
    return this.resolveObstacleCollision(sessionId, x, y, radius, blocker);
  }

  // ============================================================
  // ZONES
  // ============================================================

  isInExitZone(sessionId: string, x: number, y: number): boolean {
    const exit = this.getMap(sessionId).exitPoint;
    const hb = getHitboxRect(
      exit.x,
      exit.y,
      exit.width,
      exit.height,
      exit.hitbox,
    );
    return (
      x >= hb.x &&
      x <= hb.x + hb.width &&
      y >= hb.y &&
      y <= hb.y + hb.height
    );
  }

  getNearestSpawnPoint(
    sessionId: string,
    _x: number,
    _y: number,
  ): { x: number; y: number } {
    const spawns = this.getMap(sessionId).playerSpawns;
    return { x: spawns[0].x, y: spawns[0].y };
  }

  getInitialSpawnPoint(sessionId: string): { x: number; y: number } {
    const spawn = this.getMap(sessionId).playerSpawns[0];
    return { x: spawn.x, y: spawn.y };
  }
}
