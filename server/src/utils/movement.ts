/**
 * Movement Utilities
 * ==================
 * Reusable movement helper functions.
 *
 * WHY: Movement logic is used by players, enemies, and bullets.
 * Keeping it in one place ensures consistent behavior and
 * delta-time correctness everywhere.
 *
 * DELTA TIME: All movement uses dt (delta time in seconds) so
 * that movement speed is consistent regardless of server tick rate.
 * speed * dt = pixels to move this tick.
 */

import { normalizeVector, clamp } from "./math";
import { GAME_CONFIG } from "../config/game";

/**
 * Move an entity toward a target position.
 *
 * HOW:
 *   1. Calculate direction vector (target - current)
 *   2. Normalize it (pure direction, length = 1)
 *   3. Multiply by speed and delta time
 *
 * This gives smooth, consistent movement toward a target.
 * The entity will move exactly 'speed' pixels per second.
 */
export function moveTowardTarget(
  currentX: number, currentY: number,
  targetX: number, targetY: number,
  speed: number, dt: number
): { x: number; y: number } {
  const dirX = targetX - currentX;
  const dirY = targetY - currentY;
  const dir = normalizeVector(dirX, dirY);

  return {
    x: currentX + dir.x * speed * dt,
    y: currentY + dir.y * speed * dt,
  };
}

/**
 * Move an entity in a given direction (already normalized or raw).
 * The direction vector will be normalized internally.
 *
 * Useful for: strafing, dodging, bullet travel.
 */
export function moveInDirection(
  currentX: number, currentY: number,
  dirX: number, dirY: number,
  speed: number, dt: number
): { x: number; y: number } {
  const dir = normalizeVector(dirX, dirY);

  return {
    x: currentX + dir.x * speed * dt,
    y: currentY + dir.y * speed * dt,
  };
}

/**
 * Clamp a position to stay within map boundaries.
 * Prevents entities from walking off the edge of the world.
 */
export function clampToMap(x: number, y: number): { x: number; y: number } {
  return {
    x: clamp(x, 0, GAME_CONFIG.MAP_WIDTH),
    y: clamp(y, 0, GAME_CONFIG.MAP_HEIGHT),
  };
}

/**
 * Process raw input booleans into a normalized movement vector.
 *
 * WHY: This fixes diagonal movement being √2 times faster.
 * Without normalization, pressing UP+RIGHT gives speed of ~1.41x.
 * With normalization, all directions move at exactly the same speed.
 *
 * HOW:
 *   1. Convert input booleans to a direction vector (-1, 0, +1)
 *   2. Normalize the vector
 *   3. Multiply by speed and dt
 */
export function inputToMovement(
  left: boolean, right: boolean,
  up: boolean, down: boolean,
  speed: number, dt: number
): { x: number; y: number } {
  // Build raw direction from input
  let dirX = 0;
  let dirY = 0;

  if (left) dirX -= 1;
  if (right) dirX += 1;
  if (up) dirY -= 1;
  if (down) dirY += 1;

  // No input = no movement
  if (dirX === 0 && dirY === 0) {
    return { x: 0, y: 0 };
  }

  // Normalize so diagonal = same speed as cardinal
  const dir = normalizeVector(dirX, dirY);

  return {
    x: dir.x * speed * dt,
    y: dir.y * speed * dt,
  };
}