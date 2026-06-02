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
/**
 * Check if a target point is within a cone (fan-shaped area).
 *
 * HOW:
 *   1. Check if target is within range (distance check)
 *   2. Calculate angle from origin to target
 *   3. Compare angle difference against the cone's half-angle
 *
 * This is used for the claw melee attack — a cone-shaped hitbox
 * that extends from the attacker in a specific direction.
 *
 * @param originX - Cone origin X (attacker position)
 * @param originY - Cone origin Y (attacker position)
 * @param dirX - Normalized direction X (cone faces this way)
 * @param dirY - Normalized direction Y
 * @param range - Maximum distance of the cone
 * @param halfAngle - Half the cone's arc angle in radians
 * @param targetX - Target point X
 * @param targetY - Target point Y
 * @param targetRadius - Target collision radius (for generous hit detection)
 * @returns true if the target is within the cone
 */
export function coneCollision(
  originX: number, originY: number,
  dirX: number, dirY: number,
  range: number, halfAngle: number,
  targetX: number, targetY: number,
  targetRadius: number = 0
): boolean {
  const dx = targetX - originX;
  const dy = targetY - originY;
  const distSq = dx * dx + dy * dy;
  const effectiveRange = range + targetRadius;

  // Quick distance check
  if (distSq > effectiveRange * effectiveRange) return false;

  // Calculate angle from origin to target
  const dist = Math.sqrt(distSq);
  if (dist === 0) return true; // On top of attacker = always hit

  // Dot product to get cosine of angle between cone direction and target direction
  const dot = (dx * dirX + dy * dirY) / dist;
  const angleCos = Math.cos(halfAngle);

  return dot >= angleCos;
}

export function pointInRect(
  px: number, py: number,
  rx: number, ry: number,
  rw: number, rh: number
): boolean {
  return px >= rx && px <= rx + rw && py >= ry && py <= ry + rh;
}
