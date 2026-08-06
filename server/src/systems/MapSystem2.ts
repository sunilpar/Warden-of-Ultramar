/**
 * Map System 2 (Map2 — Layered / Grid-Based)
 * ==========================================
 * Same O(1) grid collision as MapSystem, but against the Map2 grid.
 */
import { LAYERED_MAP_2 } from "../config/layeredMap2";

export class MapSystem2 {
  private tileSize = LAYERED_MAP_2.tileSize;
  private cols = LAYERED_MAP_2.cols;
  private rows = LAYERED_MAP_2.rows;
  private grid = LAYERED_MAP_2.collisionGrid;

  get width(): number {
    return LAYERED_MAP_2.widthPx;
  }
  get height(): number {
    return LAYERED_MAP_2.heightPx;
  }

  getSpawnPoint(): { x: number; y: number } {
    return { ...LAYERED_MAP_2.spawnPoint };
  }

  /**
   * Resolve the player circle out of any solid tiles it overlaps.
   * Returns the corrected position. O(1).
   */
  resolveTileCollision(
    x: number,
    y: number,
    radius: number,
  ): { x: number; y: number } {
    const col = Math.floor(x / this.tileSize);
    const row = Math.floor(y / this.tileSize);

    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const r = row + dr;
        const c = col + dc;
        if (r < 0 || r >= this.rows || c < 0 || c >= this.cols) continue;
        if (!this.grid[r * this.cols + c]) continue;

        const cellX = c * this.tileSize;
        const cellY = r * this.tileSize;

        const closestX = Math.max(cellX, Math.min(x, cellX + this.tileSize));
        const closestY = Math.max(cellY, Math.min(y, cellY + this.tileSize));
        const dx = x - closestX;
        const dy = y - closestY;
        const distSq = dx * dx + dy * dy;

        if (distSq < radius * radius) {
          const dist = Math.sqrt(distSq);
          if (dist > 0.0001) {
            const push = radius - dist;
            x += (dx / dist) * push;
            y += (dy / dist) * push;
          } else {
            // Center inside the cell — push out along nearest edge
            const dLeft = x - cellX;
            const dRight = cellX + this.tileSize - x;
            const dTop = y - cellY;
            const dBottom = cellY + this.tileSize - y;
            const minD = Math.min(dLeft, dRight, dTop, dBottom);
            if (minD === dLeft) x = cellX - radius;
            else if (minD === dRight) x = cellX + this.tileSize + radius;
            else if (minD === dTop) y = cellY - radius;
            else y = cellY + this.tileSize + radius;
          }
        }
      }
    }

    return { x, y };
  }
}
