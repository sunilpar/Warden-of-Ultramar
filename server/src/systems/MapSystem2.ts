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

  /**
   * Resolve a rectangle (AABB) out of any solid tiles it overlaps.
   * hw = half-width, hh = half-height. Returns corrected position.
   */
  resolveRectTileCollision(
    x: number,
    y: number,
    hw: number,
    hh: number,
  ): { x: number; y: number } {
    // Check tiles overlapping the rectangle bounds
    const minCol = Math.floor((x - hw) / this.tileSize);
    const maxCol = Math.floor((x + hw) / this.tileSize);
    const minRow = Math.floor((y - hh) / this.tileSize);
    const maxRow = Math.floor((y + hh) / this.tileSize);

    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        if (r < 0 || r >= this.rows || c < 0 || c >= this.cols) continue;
        if (!this.grid[r * this.cols + c]) continue;

        const cellX = c * this.tileSize;
        const cellY = r * this.tileSize;

        // AABB overlap test
        const overlapLeft = (x + hw) - cellX;       // how far rect penetrates from left
        const overlapRight = (cellX + this.tileSize) - (x - hw);
        const overlapTop = (y + hh) - cellY;
        const overlapBottom = (cellY + this.tileSize) - (y - hh);

        if (overlapLeft > 0 && overlapRight > 0 && overlapTop > 0 && overlapBottom > 0) {
          // Push out along axis of least penetration
          const minOverlap = Math.min(overlapLeft, overlapRight, overlapTop, overlapBottom);
          if (minOverlap === overlapLeft) x -= overlapLeft;
          else if (minOverlap === overlapRight) x += overlapRight;
          else if (minOverlap === overlapTop) y -= overlapTop;
          else y += overlapBottom;
        }
      }
    }
    return { x, y };
  }
}
