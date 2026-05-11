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