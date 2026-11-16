/**
 * Elite/Exit Off-Screen Indicator
 * ==============================
 * When a tracked target (elite enemy, map exit) is active but OFF-screen
 * (outside the local player's camera viewport), a marker is pinned to the
 * border of the viewport, on the ray that leads to the target:
 *
 *     < Elite [skull]      (target off to the left)
 *
 * The marker is built from three parts:
 *   1. "<" - a pointer drawn by hand with Graphics (two strokes meeting at
 *      a tip) so it can be rotated freely and always aims at the
 *      off-screen target. Yellow for the elite, green for the exit.
 *   2. the text label ("Elite" / "Exit").
 *   3. the sprite icon taken from the "indicators_sheet" sprite sheet
 *      (frame 0 = elite skull, frame 1 = exit icon).
 *
 * The "<" is authored with its TIP on the local origin and its body
 * stretching towards +X, so rotating it by (aimAngle + PI) turns the tip
 * into the direction of the target while the body always trails inwards
 * (towards the centre of the screen).
 *
 * When the target enters the viewport, the marker hides automatically.
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
  /** Sprite sheet key holding the icon frames. */
  spriteKey?: string;
  /** Frame index inside the sprite sheet (0 = elite, 1 = exit). */
  spriteFrame?: number;
  /** CSS color string for the text label. Default: gold (elite). */
  labelColor?: string;
  /** CSS color string for the "<" pointer. Defaults to the label color. */
  pointerColor?: string;
  /** Label text next to the pointer. Default: "Elite". */
  label?: string;
}

/** Distance the marker keeps from the viewport border. */
const EDGE_INSET = 14;
/** Length of the "<" glyph, measured from its tip to the open end. */
const GLYPH_LEN = 14;
/** Half height of the "<" glyph. */
const GLYPH_HALF = 12;
/** Gap between the pointer, the text and the sprite. */
const GAP = 8;
/** Display size of the sprite icon. */
const ICON_SIZE = 32;
/** Minimum gap between the marker and the viewport border. */
const SCREEN_PAD = 10;

/** Rotates a point around the origin (Phaser uses screen coords, y down). */
function rotatePoint(x: number, y: number, radians: number) {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { x: x * cos - y * sin, y: x * sin + y * cos };
}

export function createEliteIndicator(
  scene: Phaser.Scene,
  isAlive: () => boolean,
  getTargetWorldPos: () => { x: number; y: number } | null,
  opts: EdgeIndicatorOptions = {},
): EliteIndicatorRefs {
  const spriteKey = opts.spriteKey ?? "indicators_sheet";
  const spriteFrame = opts.spriteFrame ?? 0;
  const labelColor = opts.labelColor ?? "#ffd700";
  const pointerColor = opts.pointerColor ?? labelColor;
  const labelText = opts.label ?? "Elite";

  // High depth so it sits ABOVE the map-info button and other HUD chrome.
  const DEPTH = 500;

  // ---- "<" pointer, drawn by hand so it can be aimed at the target ----
  // The tip sits on the local origin (0, 0), the two arms open towards +X.
  const pointerGfx = scene.add.graphics();
  const pointerRgb = Phaser.Display.Color.HexStringToColor(pointerColor).color;
  // Black outline first, coloured stroke on top of it.
  pointerGfx.lineStyle(9, 0x000000, 0.9);
  pointerGfx.beginPath();
  pointerGfx.moveTo(0, 0);
  pointerGfx.lineTo(GLYPH_LEN, -GLYPH_HALF);
  pointerGfx.moveTo(0, 0);
  pointerGfx.lineTo(GLYPH_LEN, GLYPH_HALF);
  pointerGfx.strokePath();
  pointerGfx.lineStyle(4, pointerRgb, 1);
  pointerGfx.beginPath();
  pointerGfx.moveTo(0, 0);
  pointerGfx.lineTo(GLYPH_LEN, -GLYPH_HALF);
  pointerGfx.moveTo(0, 0);
  pointerGfx.lineTo(GLYPH_LEN, GLYPH_HALF);
  pointerGfx.strokePath();

  // ---- Label text ----
  const label = scene.add.text(0, 0, labelText, {
    color: labelColor,
    fontSize: "15px",
    fontFamily: "monospace",
    fontStyle: "bold",
    stroke: "#000000",
    strokeThickness: 4,
  });

  // ---- Sprite icon ----
  const icon = scene.add.image(0, 0, spriteKey, spriteFrame);
  icon.setDisplaySize(ICON_SIZE, ICON_SIZE);

  // ---- Container, scrollFactor(0) sticks it to the viewport ----
  const root = scene.add
    .container(0, 0, [pointerGfx, label, icon])
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
    const target = getTargetWorldPos();
    if (!target) {
      if (root.visible) root.setVisible(false);
      return;
    }

    const camLeft = cam.scrollX;
    const camTop = cam.scrollY;
    const camRight = camLeft + cam.width;
    const camBottom = camTop + cam.height;

    const inX = target.x >= camLeft && target.x <= camRight;
    const inY = target.y >= camTop && target.y <= camBottom;
    if (inX && inY) {
      // Target is on screen - no marker needed.
      if (root.visible) root.setVisible(false);
      return;
    }

    // ---- Direction from the viewport centre to the target ----
    const cx = (camLeft + camRight) / 2;
    const cy = (camTop + camBottom) / 2;
    const dx = target.x - cx;
    const dy = target.y - cy;
    const angle = Math.atan2(dy, dx);
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);

    // ---- Where that ray leaves the viewport (inset from the border) ----
    const halfW = Math.max(1, cam.width / 2 - EDGE_INSET);
    const halfH = Math.max(1, cam.height / 2 - EDGE_INSET);
    const kx = dx === 0 ? Infinity : halfW / Math.abs(dx);
    const ky = dy === 0 ? Infinity : halfH / Math.abs(dy);
    const k = Math.min(kx, ky);
    const worldX = cx + dx * k;
    const worldY = cy + dy * k;

    // The container has scrollFactor(0), so it lives in screen space.
    let screenX = worldX - cam.scrollX;
    let screenY = worldY - cam.scrollY;

    // ---- Aim the "<" at the target ----
    // The glyph tip is on the local origin and points towards -X, so
    // rotating it by (angle + PI) makes the tip face the target while the
    // body of the glyph trails inwards.
    const rot = angle + Math.PI;
    pointerGfx.setRotation(rot);

    // ---- Lay the row out: pointer, then text, then sprite ----
    // The chevron body trails inwards from the tip, so the text and the
    // sprite follow behind it. The extent of the rotated body is computed
    // from the actual arm positions so the row never overlaps the glyph.
    const armA = rotatePoint(GLYPH_LEN, -GLYPH_HALF, rot);
    const armB = rotatePoint(GLYPH_LEN, GLYPH_HALF, rot);
    const bodyMinX = Math.min(0, armA.x, armB.x);
    const bodyMaxX = Math.max(0, armA.x, armB.x);
    const bodyMinY = Math.min(0, armA.y, armB.y);
    const bodyMaxY = Math.max(0, armA.y, armB.y);

    let labelX: number;
    let labelY: number;

    if (Math.abs(ux) >= Math.abs(uy)) {
      if (ux < 0) {
        // Target is to the left:  < [Elite] [skull]
        label.setOrigin(0, 0.5);
        labelX = bodyMaxX + GAP;
        labelY = 0;
        icon
          .setOrigin(0.5, 0.5)
          .setPosition(labelX + label.width + GAP + ICON_SIZE / 2, 0);
      } else {
        // Target is to the right:  [skull] [Elite] >
        label.setOrigin(1, 0.5);
        labelX = bodyMinX - GAP;
        labelY = 0;
        icon
          .setOrigin(0.5, 0.5)
          .setPosition(labelX - label.width - GAP - ICON_SIZE / 2, 0);
      }
    } else {
      // Target is above / below: the row is stacked under / over the "<".
      const stacked = uy < 0;
      label.setOrigin(0.5, stacked ? 0 : 1);
      labelX = 0;
      if (stacked) {
        // Target is above: the "<" points up, the row hangs underneath it.
        labelY = bodyMaxY + GAP;
        icon
          .setOrigin(0.5, 0.5)
          .setPosition(0, labelY + label.height + GAP + ICON_SIZE / 2);
      } else {
        // Target is below: the "<" points down, the row sits above it.
        labelY = bodyMinY - GAP;
        icon
          .setOrigin(0.5, 0.5)
          .setPosition(0, labelY - label.height - GAP - ICON_SIZE / 2);
      }
    }

    label.setPosition(labelX, labelY);

    // ---- Keep the whole marker inside the viewport ----
    // The glyph, the text and the sprite are all measured around the
    // marker origin, so the origin can be nudged until nothing sticks out.
    const halfIcon = ICON_SIZE / 2;
    const labelLeft =
      label.originX === 0 ? labelX : label.originX === 1 ? labelX - label.width : labelX - label.width / 2;
    const labelRight = labelLeft + label.width;
    const labelTop =
      label.originY === 0 ? labelY : label.originY === 1 ? labelY - label.height : labelY - label.height / 2;
    const labelBottom = labelTop + label.height;

    const minX = Math.min(bodyMinX, labelLeft, icon.x - halfIcon);
    const maxX = Math.max(bodyMaxX, labelRight, icon.x + halfIcon);
    const minY = Math.min(bodyMinY, labelTop, icon.y - halfIcon);
    const maxY = Math.max(bodyMaxY, labelBottom, icon.y + halfIcon);

    screenX = Phaser.Math.Clamp(
      screenX,
      -minX + SCREEN_PAD,
      cam.width - maxX - SCREEN_PAD,
    );
    screenY = Phaser.Math.Clamp(
      screenY,
      -minY + SCREEN_PAD,
      cam.height - maxY - SCREEN_PAD,
    );

    root.setPosition(screenX, screenY);

    if (!root.visible) root.setVisible(true);
  }

  return { update, setVisible, destroy };
}
