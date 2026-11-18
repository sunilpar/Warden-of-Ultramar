/**
 * Shared Movement / Collision Core
 * ================================
 * SINGLE SOURCE OF TRUTH for player movement + tile collision.
 *
 * The server (authoritative) and the client (prediction) MUST run the
 * exact same code, otherwise their positions diverge and the player
 * rubber-bands. This module is copied verbatim into:
 *   - server/src/systems/movement.ts
 *   - client/src/maps/movement.ts
 * Keep the two copies byte-identical.
 *
 * WHY SUB-STEPPING (the core fix for "skipping through walls")
 * -----------------------------------------------------------
 * A single discrete collision test only sees the FINAL position of a
 * move. If the player travels further in one step than the wall is
 * thick, the final position is on the far side of the wall and the
 * test reports "no collision" -> the player tunnels THROUGH the wall.
 *
 * The industry-standard fix is CONTINUOUS COLLISION DETECTION via
 * sub-stepping: split the move into N smaller steps, each at most
 * `maxStepDistance` long, and run the collision test after each one.
 * With maxStepDistance <= the smallest wall thickness, a wall can
 * never be skipped.
 *
 * Corner/edge handling: after the push-out we re-run the resolution a
 * few times (iterative depenetration). Pushing out of wall A can push
 * the player INTO wall B (concave corners); iterating converges to a
 * position that overlaps nothing.
 *
 * AXIS-SEPARATED MOVEMENT
 * -----------------------
 * We move on X, resolve on X, then move on Y, resolve on Y. This is the
 * standard "slide along walls" behaviour: when you walk into a wall you
 * still slide along it instead of sticking. A single combined X+Y step
 * makes the player stick to walls and wedge in corners.
 */
/** Tunables shared by server and client. */
export const MOVEMENT_CONFIG = {
    /**
     * Maximum distance (px) a player may travel in ONE collision
     * sub-step. Must be <= the thinnest wall thickness (32px tiles ->
     * a 1-tile wall is 32px thick), so we use a small fraction of the
     * collision radius to stay safe. At 120px/s and 60Hz a step is 2px,
     * so this only kicks in at high speed / large catch-up steps.
     */
    MAX_SUB_STEP_DISTANCE: 4,
    /**
     * Maximum number of depenetration passes per sub-step. 4 is enough
     * to resolve concave corners without an unbounded loop.
     */
    MAX_DEPENETRATION_PASSES: 4,
    /**
     * Distance (px) within which a contact is considered "touching" and
     * is snapped flush. Prevents the player from hovering a few pixels
     * off a wall and flickering between contact states.
     */
    CONTACT_SNAP_EPSILON: 0.001,
};
/**
 * Resolve a circle out of any solid tile it overlaps.
 *
 * Iterative depenetration: repeat the push-out until the circle
 * overlaps nothing (or MAX_DEPENETRATION_PASSES is reached). A single
 * pass can push the circle out of one tile and into a neighbour, which
 * is what causes the "clipping into corners" artefact.
 *
 * Returns the corrected position. O(1) - only the tiles the circle
 * can possibly touch are examined.
 */
export function resolveCircleTileCollision(x, y, radius, world) {
    const { grid, cols, rows, tileSize } = world;
    for (let pass = 0; pass < MOVEMENT_CONFIG.MAX_DEPENETRATION_PASSES; pass++) {
        let resolvedAny = false;
        // The circle's bounding box can touch at most a 2x2 block of tiles
        // (radius < tileSize), so scanning the 3x3 neighbourhood around
        // the centre tile is sufficient and O(1).
        const col = Math.floor(x / tileSize);
        const row = Math.floor(y / tileSize);
        for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
                const r = row + dr;
                const c = col + dc;
                if (r < 0 || r >= rows || c < 0 || c >= cols)
                    continue;
                if (!grid[r * cols + c])
                    continue;
                const cellX = c * tileSize;
                const cellY = r * tileSize;
                // Closest point on the cell rect to the circle centre.
                const closestX = Math.max(cellX, Math.min(x, cellX + tileSize));
                const closestY = Math.max(cellY, Math.min(y, cellY + tileSize));
                const dx = x - closestX;
                const dy = y - closestY;
                const distSq = dx * dx + dy * dy;
                if (distSq >= radius * radius)
                    continue;
                resolvedAny = true;
                const dist = Math.sqrt(distSq);
                if (dist > MOVEMENT_CONFIG.CONTACT_SNAP_EPSILON) {
                    // Push the circle out along the contact normal.
                    const push = radius - dist;
                    x += (dx / dist) * push;
                    y += (dy / dist) * push;
                }
                else {
                    // Centre is inside the cell (deep penetration). Eject through
                    // the nearest face so the circle can never end up inside a
                    // wall after a large step.
                    const dLeft = x - cellX;
                    const dRight = cellX + tileSize - x;
                    const dTop = y - cellY;
                    const dBottom = cellY + tileSize - y;
                    const minD = Math.min(dLeft, dRight, dTop, dBottom);
                    if (minD === dLeft)
                        x = cellX - radius;
                    else if (minD === dRight)
                        x = cellX + tileSize + radius;
                    else if (minD === dTop)
                        y = cellY - radius;
                    else
                        y = cellY + tileSize + radius;
                }
            }
        }
        // No overlap found -> fully resolved, stop iterating.
        if (!resolvedAny)
            break;
    }
    return { x, y };
}
/**
 * Move a circle by (dx, dy) with continuous collision detection.
 *
 * The move is split into sub-steps of at most MAX_SUB_STEP_DISTANCE so
 * the player can never tunnel through a wall, no matter how fast they
 * move. Each sub-step is resolved against the tile grid immediately.
 *
 * Movement is axis-separated (X then Y) so the player slides along
 * walls rather than sticking to them.
 */
export function moveCircleWithCollision(x, y, dx, dy, radius, world) {
    const totalDist = Math.hypot(dx, dy);
    if (totalDist <= MOVEMENT_CONFIG.MAX_SUB_STEP_DISTANCE) {
        // Fast path: a single step is guaranteed not to skip a wall.
        // Still axis-separated so the behaviour matches the sub-stepped
        // path exactly (client and server must never diverge).
        let res = resolveCircleTileCollision(x + dx, y, radius, world);
        x = res.x;
        y = res.y;
        res = resolveCircleTileCollision(x, y + dy, radius, world);
        return { x: res.x, y: res.y };
    }
    const steps = Math.ceil(totalDist / MOVEMENT_CONFIG.MAX_SUB_STEP_DISTANCE);
    const stepX = dx / steps;
    const stepY = dy / steps;
    for (let i = 0; i < steps; i++) {
        // Axis-separated: advance X and resolve, then advance Y and resolve.
        // Both components of the resolution result are applied - the push
        // out of a wall is along the contact normal, which is rarely
        // perfectly axis aligned, so discarding the other component would
        // leave the circle overlapping a wall.
        let res = resolveCircleTileCollision(x + stepX, y, radius, world);
        x = res.x;
        y = res.y;
        res = resolveCircleTileCollision(x, y + stepY, radius, world);
        x = res.x;
        y = res.y;
    }
    return { x, y };
}
/**
 * Clamp a position to the world bounds. Kept separate so both server
 * and client apply it in the same place in the pipeline.
 */
export function clampToWorld(x, y, width, height) {
    return {
        x: Math.max(0, Math.min(width, x)),
        y: Math.max(0, Math.min(height, y)),
    };
}
/**
 * True if a circle of `radius` centred at (x, y) overlaps any solid tile.
 * Used for sweeps (dash / line-of-sight) that must account for the
 * caster's body, not just a point.
 */
export function circleOverlapsSolid(x, y, radius, world) {
    const { grid, cols, rows, tileSize } = world;
    const col = Math.floor(x / tileSize);
    const row = Math.floor(y / tileSize);
    for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
            const r = row + dr;
            const c = col + dc;
            if (r < 0 || r >= rows || c < 0 || c >= cols)
                continue;
            if (!grid[r * cols + c])
                continue;
            const cellX = c * tileSize;
            const cellY = r * tileSize;
            const closestX = Math.max(cellX, Math.min(x, cellX + tileSize));
            const closestY = Math.max(cellY, Math.min(y, cellY + tileSize));
            const dx = x - closestX;
            const dy = y - closestY;
            if (dx * dx + dy * dy < radius * radius)
                return true;
        }
    }
    return false;
}
