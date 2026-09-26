/**
 * Elite/Exit Edge Indicator
 * =========================
 * When a tracked target (elite enemy, map exit) is active but OFF-screen
 * (outside the local player's camera viewport), show a sprite + label
 * pinned to the nearest viewport edge that points toward the target.
 * When the target enters the viewport, the marker hides automatically.
 *
 * The arrow sprite comes from a 2-frame sprite sheet
 *   "indicators_sheet"  (32x32 per frame)
 *   frame 0 = elite indicator (gold)
 *   frame 1 = exit  indicator (green)
 *
 * SPRITE ORIENTATION
 * ------------------
 * The sprite is a pre-oriented pointer with the tip in the
 * right-bottom corner (it is NOT authored pointing straight up).
 * So we do NOT rotate the container — we just flip the sprite
 * horizontally / vertically depending on which screen edge it is
 * pinned to, so the tip points at the off-screen target.
 *
 *   edge pinned to   flip
 *   ---------------  ---------------------------------
 *   RIGHT edge       none (sprite as-is)
 *   LEFT  edge       flip vertically (mirror Y axis)
 *   TOP   edge       flip horizontally (mirror X axis)
 *   BOTTOM edge      none
 *
 * This avoids the previous bug where the pointer's tip didn't line up
 * with the off-screen target because we were rotating an already-rotated
 * sprite.
 */
import Phaser from "phaser";

export interface EliteIndicatorRefs {
  /** Call every frame with the current main camera. */
  update(cam: Phaser.Cameras.Scene2D.Camera): void;
  /** Force-hide (e.g. on map swap, elite death). */
  setVisible(v: boolean): void;
  destroy(): void;
}

export interface EdgeIndicatorOptions {
  /** Sprite sheet key holding the arrow frames. */
  spriteKey?: string;
  /** Frame index inside the sprite sheet (0 = elite, 1 = exit). */
  spriteFrame?: number;
  /** CSS color string for the text label. Default: gold (elite). */
  labelColor?: string;
  /** Label text below the arrow. Default: "Elite". */
  label?: string;
}

export function createEliteIndicator(
  scene: Phaser.Scene,
  isAlive: () => boolean,
  getEliteWorldPos: () => { x: number; y: number } | null,
  opts: EdgeIndicatorOptions = {},
): EliteIndicatorRefs {
  const spriteKey = opts.spriteKey ?? "indicators_sheet";
  const spriteFrame = opts.spriteFrame ?? 0;
  const labelColor = opts.labelColor ?? "#ffd700";
  const labelText = opts.label ?? "Elite";

  // High depth so it sits ABOVE the map-info button and other HUD chrome.
  const DEPTH = 500;

  // ---- Arrow sprite from the sprite sheet ----
  const sprite = scene.add.image(0, 0, spriteKey, spriteFrame);
  sprite.setOrigin(0.5, 0.5);
  // Render at a chunky size so it reads at a glance.
  sprite.setDisplaySize(48, 48);

  // ---- Label below the arrow ----
  const label = scene.add
    .text(0, 28, labelText, {
      color: labelColor,
      fontSize: "16px",
      fontFamily: "monospace",
      fontStyle: "bold",
      stroke: "#000000",
      strokeThickness: 4,
    })
    .setOrigin(0.5);

  // ---- Container, scrollFactor(0) sticks it to the viewport ----
  const root = scene.add
    .container(0, 0, [sprite, label])
    .setDepth(DEPTH)
    .setScrollFactor(0)
    .setVisible(false);

  function setVisible(v: boolean) {
    root.setVisible(v);
  }

  function destroy() {
    root.destroy();
  }

  function update(cam: Phaser.Cameras.Scene2D.Camera) {
    if (!isAlive()) {
      if (root.visible) root.setVisible(false);
      return;
    }
    const elite = getEliteWorldPos();
    if (!elite) {
      if (root.visible) root.setVisible(false);
      return;
    }

    const margin = 40;
    const camLeft = cam.scrollX;
    const camTop = cam.scrollY;
    const camRight = camLeft + cam.width;
    const camBottom = camTop + cam.height;

    const inX = elite.x >= camLeft && elite.x <= camRight;
    const inY = elite.y >= camTop && elite.y <= camBottom;
    if (inX && inY) {
      // Target is on screen - no marker needed.
      if (root.visible) root.setVisible(false);
      return;
    }

    // ---- Decide which edge to clamp onto ----
    // The X axis (left/right) wins when the target is farther from the
    // screen in X than in Y; otherwise Y (top/bottom) wins. For
    // pure-corner cases this gives the same edge a player would
    // expect when looking at the screen.
    const outLeft = elite.x < camLeft;
    const outRight = elite.x > camRight;
    const outTop = elite.y < camTop;
    const outBottom = elite.y > camBottom;

    const dxLeft = outLeft ? camLeft - elite.x : -Infinity;
    const dxRight = outRight ? elite.x - camRight : -Infinity;
    const dyTop = outTop ? camTop - elite.y : -Infinity;
    const dyBottom = outBottom ? elite.y - camBottom : -Infinity;

    let worldX: number;
    let worldY: number;
    let edge: "left" | "right" | "top" | "bottom";
    {
      const xDist = Math.max(dxLeft, dxRight);
      const yDist = Math.max(dyTop, dyBottom);
      if (xDist >= yDist) {
        // Pin to the LEFT or RIGHT edge (X axis dominates).
        if (outLeft) {
          worldX = camLeft + margin;
          edge = "left";
        } else {
          worldX = camRight - margin;
          edge = "right";
        }
        worldY = Phaser.Math.Clamp(elite.y, camTop, camBottom);
      } else {
        // Pin to the TOP or BOTTOM edge (Y axis dominates).
        if (outTop) {
          worldY = camTop + margin;
          edge = "top";
        } else {
          worldY = camBottom - margin;
          edge = "bottom";
        }
        worldX = Phaser.Math.Clamp(elite.x, camLeft, camRight);
      }
    }

    // Convert world -> screen pixels.
    const sx = worldX - cam.scrollX;
    const sy = worldY - cam.scrollY;
    root.setPosition(sx, sy);

    // ---- Orient the sprite so the tip points at the off-screen target ----
    // The sprite is authored with its tip in the right-bottom corner.
    // RIGHT edge:  no flip       (sprite as-is)
    // LEFT  edge:  flipY = true  (mirror vertically -> tip points left-bottom)
    // TOP   edge:  flipX = true  (mirror horizontally -> tip points left-bottom)
    // BOTTOM edge: no flip       (sprite as-is)
    const flipX = edge === "top";
    const flipY = edge === "left";
    sprite.setFlipX(flipX);
    sprite.setFlipY(flipY);
    // Label stays right-side-up regardless of which edge we're on.
    sprite.setRotation(0);
    label.setRotation(0);

    if (!root.visible) root.setVisible(true);
  }

  return { update, setVisible, destroy };
}
