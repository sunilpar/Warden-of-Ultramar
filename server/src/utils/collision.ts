/**
 * Collision Utilities
 * ===================
 * Reusable collision detection functions.
 *
 * WHY: Collision checks happen every tick for every entity.
 * Centralizing them avoids duplicated code and ensures
 * consistent collision behavior across the entire game.
 *
 * All functions use squared distances for performance.
 */

import { distanceSq } from "./math";

/**
 * Check if two circles overlap (using squared distance).
 *
 * HOW: Instead of calculating actual distance (which needs sqrt),
 * we compare squared distance against squared combined radii.
 * This gives the same result without the expensive sqrt call.
 *
 * @returns true if the circles overlap
 */
export function circleCollision(
  x1: number, y1: number, radius1: number,
  x2: number, y2: number, radius2: number
): boolean {
  const combinedRadius = radius1 + radius2;
  const combinedRadiusSq = combinedRadius * combinedRadius;
  return distanceSq(x1, y1, x2, y2) < combinedRadiusSq;
}

/**
 * Check if a point is within a certain range of another point.
 * Uses squared distance for performance.
 *
 * @returns true if the point is within the given range
 */
export function pointInRange(
  x1: number, y1: number,
  x2: number, y2: number,
  range: number
): boolean {
  const rangeSq = range * range;
  return distanceSq(x1, y1, x2, y2) < rangeSq;
}

/**
 * Check if a circle collides with a rectangle (axis-aligned).
 *
 * HOW: Find the closest point on the rectangle to the circle center.
 * If the distance from the circle center to that closest point is
 * less than the circle's radius, they overlap.
 *
 * This is the standard circle-AABB collision test used in most 2D games.
 *
 * @param cx - Circle center X
 * @param cy - Circle center Y
 * @param cr - Circle radius
 * @param rx - Rectangle top-left X
 * @param ry - Rectangle top-left Y
 * @param rw - Rectangle width
 * @param rh - Rectangle height
 * @returns true if the circle and rectangle overlap
 */
export function circleRectCollision(
  cx: number, cy: number, cr: number,
  rx: number, ry: number, rw: number, rh: number
): boolean {
  // Find the closest point on the rectangle to the circle center
  const closestX = Math.max(rx, Math.min(cx, rx + rw));
  const closestY = Math.max(ry, Math.min(cy, ry + rh));

  // Check if the closest point is within the circle's radius
  return distanceSq(cx, cy, closestX, closestY) < cr * cr;
}

/**
 * Check if a point is inside a rectangle.
 *
 * @returns true if the point is inside the rectangle
 */
export function pointInRect(
  px: number, py: number,
  rx: number, ry: number,
  rw: number, rh: number
): boolean {
  return px >= rx && px <= rx + rw && py >= ry && py <= ry + rh;
}
