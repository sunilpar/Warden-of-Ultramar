import { moveCircleWithCollision, resolveCircleTileCollision, } from "./movement";
export class MapSystem {
    constructor(data) {
        this.data = data;
        this.tileSize = data.tileSize;
        this.cols = data.cols;
        this.rows = data.rows;
        this.grid = data.collisionGrid;
    }
    get width() {
        return this.data.widthPx;
    }
    get height() {
        return this.data.heightPx;
    }
    getSpawnPoint() {
        return { ...this.data.spawnPoint };
    }
    getExitPoint() {
        return { ...this.data.exitPoint };
    }
    /**
     * The collision grid in the shape the shared movement module expects.
     */
    get world() {
        return {
            grid: this.grid,
            cols: this.cols,
            rows: this.rows,
            tileSize: this.tileSize,
        };
    }
    /**
     * Resolve the player circle out of any solid tiles it overlaps.
     * Returns the corrected position. O(1).
     *
     * Uses ITERATIVE depenetration (multiple passes) so that pushing out
     * of one wall cannot push the player into an adjacent wall - which
     * was the source of the corner-clipping artefact.
     */
    resolveTileCollision(x, y, radius) {
        return resolveCircleTileCollision(x, y, radius, this.world);
    }
    /**
     * Move a circle by (dx, dy) with CONTINUOUS COLLISION DETECTION.
     *
     * This is the fix for high-speed movement clipping through walls:
     * the move is split into sub-steps small enough that a wall can never
     * be skipped, and each sub-step is resolved against the grid.
     * Movement is axis-separated so the player slides along walls.
     */
    moveWithCollision(x, y, dx, dy, radius) {
        return moveCircleWithCollision(x, y, dx, dy, radius, this.world);
    }
    /**
     * True if the given point is inside a solid tile. Used for line-of-
     * sight / dash wall checks.
     */
    isSolidAt(x, y) {
        const col = Math.floor(x / this.tileSize);
        const row = Math.floor(y / this.tileSize);
        if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) {
            return false;
        }
        return this.grid[row * this.cols + col] === 1;
    }
    /**
     * Sweep a segment from (x1,y1) to (x2,y2) and return the fraction of
     * the segment that is clear of solid tiles (0..1).
     *
     * Used for dashes and line-of-sight: a dash stops where the wall
     * starts instead of teleporting through it.
     */
    sweepCoverage(x1, y1, x2, y2) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const dist = Math.hypot(dx, dy);
        if (dist < 1)
            return 1;
        // Sample finely enough that a wall (>= 1 tile = 32px) is always
        // detected between two samples.
        const stepSize = 4;
        const steps = Math.ceil(dist / stepSize);
        for (let i = 1; i < steps; i++) {
            const t = i / steps;
            if (this.isSolidAt(x1 + dx * t, y1 + dy * t)) {
                return (i - 1) / steps;
            }
        }
        return 1;
    }
}
