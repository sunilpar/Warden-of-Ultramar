/**
 * Elite/Exit Edge Indicator
 * =========================
 * When a tracked target (elite enemy, map exit) is active but OFF-screen
 * (outside the local player's camera viewport), show a chunky arrow pinned
 * to the nearest viewport edge that points toward the target. When the
 * target enters the viewport, the marker hides automatically.
 *
 * Geometry is built once inside a single Container so children inherit
 * its scrollFactor(0). No sprite is needed - just a thick arrow + a
 * label that rotates as a unit.
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
  /** Arrow + label fill color (0xRRGGBB). Default: gold (elite). */
  color?: number;
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
  const color = opts.color ?? 0xffd700;
  const labelColor = opts.labelColor ?? "#ffd700";
  const labelText = opts.label ?? "Elite";

  // High depth so it sits ABOVE the map-info button and other HUD chrome.
  const DEPTH = 500;

  // ---- Arrow body (points UP - we rotate the whole container) ----
  // Big and bold so it reads at a glance.
  const ARROW = scene.add.graphics();
  ARROW.fillStyle(color, 1);
  ARROW.lineStyle(3, 0x000000, 1);
  // Triangle pointing up: base at y=14, tip at y=-22 (bigger than before).
  ARROW.fillTriangle(-18, 14, 18, 14, 0, -22);
  ARROW.strokeTriangle(-18, 14, 18, 14, 0, -22);

  // ---- Label below the arrow ----
  const label = scene.add
    .text(0, 30, labelText, {
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
    .container(0, 0, [ARROW, label])
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
      // Elite is on screen - no marker needed.
      if (root.visible) root.setVisible(false);
      return;
    }

    // Clamp onto the nearest edge with a margin so the marker doesn't
    // sit exactly on the screen border.
    let worldX = Phaser.Math.Clamp(elite.x, camLeft, camRight);
    let worldY = Phaser.Math.Clamp(elite.y, camTop, camBottom);
    if (elite.x < camLeft) worldX = camLeft + margin;
    else if (elite.x > camRight) worldX = camRight - margin;
    if (elite.y < camTop) worldY = camTop + margin;
    else if (elite.y > camBottom) worldY = camBottom - margin;

    // Convert world -> screen pixels.
    const sx = worldX - cam.scrollX;
    const sy = worldY - cam.scrollY;
    root.setPosition(sx, sy);

    // Rotation: angle from screen center to elite world position. Arrow
    // was authored pointing UP (-Y), so add +PI/2 to align.
    const dx = elite.x - (cam.scrollX + cam.width / 2);
    const dy = elite.y - (cam.scrollY + cam.height / 2);
    const angle = Math.atan2(dy, dx);
    root.setRotation(angle + Math.PI / 2);

    if (!root.visible) root.setVisible(true);
  }

  return { update, setVisible, destroy };
}
