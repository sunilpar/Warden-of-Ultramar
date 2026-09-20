/**
 * 9-slice outline frame built from the ui_outline spritesheet.
 * Used by every modal panel (inventory, character, death screen, confirm).
 *
 * Edit TWEAK values to fit art to new panel sizes.
 */
import Phaser from "phaser";

export function buildOutlineFrame(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
): Phaser.GameObjects.Container {
  const T = 16;
  const INSET = 0;
  const ART = 64;
  const cw = Math.min(T, w / 2);
  const ch = Math.min(T, h / 2);
  const frame = scene.add.container(0, 0);
  const tile = (
    tx: number,
    ty: number,
    fr: number,
    tw: number,
    th: number,
  ): Phaser.GameObjects.Image =>
    scene.add
      .image(tx, ty, "ui_outline", fr)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setScale(tw / ART, th / ART);
  const ox = x - cw + INSET;
  const oy = y - ch + INSET;
  const rx = x + w - INSET;
  const by = y + h - INSET;
  frame.add(tile(ox, oy, 0, cw, ch));
  frame.add(tile(rx, oy, 0, cw, ch).setFlipX(true));
  frame.add(tile(ox, by, 0, cw, ch).setFlipY(true));
  frame.add(tile(rx, by, 0, cw, ch).setFlipX(true).setFlipY(true));
  for (let c = x + cw; c < x + w - cw; c += T) {
    const tw = Math.min(T, x + w - cw - c);
    frame.add(tile(c, oy, 1, tw, ch));
    frame.add(tile(c, by, 1, tw, ch).setFlipY(true));
  }
  for (let r = y + ch; r < y + h - ch; r += T) {
    const th = Math.min(T, y + h - ch - r);
    frame.add(tile(ox, r, 2, cw, th));
    frame.add(tile(rx, r, 2, cw, th).setFlipX(true));
  }
  return frame;
}
