/**
 * Map System (Layered / Grid-Based)
 * ==================================
 * Authoritative collision against the layered Tiled map.
 *
 * Collision is O(1): the player circle (radius < tileSize/2) overlaps at most
 * 4 grid cells, so we check a 3×3 neighborhood around the player's cell.
 *
 * MUST match the client's resolveTileCollision() exactly.
 */
import { LAYERED_MAP } from "../config/layeredMap";
export class MapSystem {
    constructor() {
        this.tileSize = LAYERED_MAP.tileSize;
        this.cols = LAYERED_MAP.cols;
        this.rows = LAYERED_MAP.rows;
        this.grid = LAYERED_MAP.collisionGrid;
    }
    get width() {
        return LAYERED_MAP.widthPx;
    }
    get height() {
        return LAYERED_MAP.heightPx;
    }
    getSpawnPoint() {
        return { ...LAYERED_MAP.spawnPoint };
    }
    /**
     * Resolve the player circle out of any solid tiles it overlaps.
     * Returns the corrected position. O(1).
     */
    resolveTileCollision(x, y, radius) {
        const col = Math.floor(x / this.tileSize);
        const row = Math.floor(y / this.tileSize);
        for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
                const r = row + dr;
                const c = col + dc;
                if (r < 0 || r >= this.rows || c < 0 || c >= this.cols)
                    continue;
                if (!this.grid[r * this.cols + c])
                    continue;
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
                    }
                    else {
                        // Center inside the cell — push out along nearest edge
                        const dLeft = x - cellX;
                        const dRight = cellX + this.tileSize - x;
                        const dTop = y - cellY;
                        const dBottom = cellY + this.tileSize - y;
                        const minD = Math.min(dLeft, dRight, dTop, dBottom);
                        if (minD === dLeft)
                            x = cellX - radius;
                        else if (minD === dRight)
                            x = cellX + this.tileSize + radius;
                        else if (minD === dTop)
                            y = cellY - radius;
                        else
                            y = cellY + this.tileSize + radius;
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
    resolveRectTileCollision(x, y, hw, hh) {
        // Check tiles overlapping the rectangle bounds
        const minCol = Math.floor((x - hw) / this.tileSize);
        const maxCol = Math.floor((x + hw) / this.tileSize);
        const minRow = Math.floor((y - hh) / this.tileSize);
        const maxRow = Math.floor((y + hh) / this.tileSize);
        for (let r = minRow; r <= maxRow; r++) {
            for (let c = minCol; c <= maxCol; c++) {
                if (r < 0 || r >= this.rows || c < 0 || c >= this.cols)
                    continue;
                if (!this.grid[r * this.cols + c])
                    continue;
                const cellX = c * this.tileSize;
                const cellY = r * this.tileSize;
                // AABB overlap test
                const overlapLeft = (x + hw) - cellX; // how far rect penetrates from left
                const overlapRight = (cellX + this.tileSize) - (x - hw);
                const overlapTop = (y + hh) - cellY;
                const overlapBottom = (cellY + this.tileSize) - (y - hh);
                if (overlapLeft > 0 && overlapRight > 0 && overlapTop > 0 && overlapBottom > 0) {
                    // Push out along axis of least penetration
                    const minOverlap = Math.min(overlapLeft, overlapRight, overlapTop, overlapBottom);
                    if (minOverlap === overlapLeft)
                        x -= overlapLeft;
                    else if (minOverlap === overlapRight)
                        x += overlapRight;
                    else if (minOverlap === overlapTop)
                        y -= overlapTop;
                    else
                        y += overlapBottom;
                }
            }
        }
        return { x, y };
    }
}
