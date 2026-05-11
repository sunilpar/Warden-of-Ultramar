/**
 * Math Utilities
 * ==============
 * Reusable math helpers for game calculations.
 *
 * WHY: We repeat the same vector math everywhere — normalizing,
 * clamping, distance checks. Centralizing them:
 *   1. Avoids bugs (copy-paste errors)
 *   2. Makes code readable (normalizeVector() vs manual math)
 *   3. Lets us optimize once (e.g., squared distance) and benefit everywhere
 *
 * PERFORMANCE: We use squared distance comparisons to avoid
 * expensive Math.sqrt() calls wherever possible.
 */

/**
 * Normalize a 2D vector so its length is exactly 1.
 * Returns {x: 0, y: 0} if the vector is zero-length (avoids division by zero).
 *
 * WHY: Normalized vectors give us a pure direction. We can then
 * multiply by any speed to get consistent movement in any direction.
 */
export function normalizeVector(x: number, y: number): { x: number; y: number } {
  const lengthSq = x * x + y * y;

  // Avoid division by zero — if vector is zero-length, return zero vector
  if (lengthSq === 0) {
    return { x: 0, y: 0 };
  }

  const length = Math.sqrt(lengthSq);
  return {
    x: x / length,
    y: y / length,
  };
}

/**
 * Calculate squared distance between two points.
 *
 * WHY: Math.sqrt() is expensive. If we only need to COMPARE distances
 * (e.g., "is this within range?"), we can compare squared distances
 * and skip the sqrt entirely. This is a common game optimization.
 *
 * USAGE: Instead of:
 *   if (distance(a, b) < range)        // requires sqrt
 * Use:
 *   if (distanceSq(a, b) < range * range)  // no sqrt needed
 */
export function distanceSq(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return dx * dx + dy * dy;
}

/**
 * Clamp a value between a minimum and maximum.
 *
 * WHY: Used for keeping players in bounds, keeping HP between 0-max, etc.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Calculate actual distance between two points.
 * Only use this when you need the ACTUAL distance value.
 * For comparisons, use distanceSq() instead.
 */
export function distance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.sqrt(distanceSq(x1, y1, x2, y2));
}