/**
 * Player HUD strip (display name + health bar + shield overlay)
 * ============================================================
 * A Phaser container that follows each player sprite and renders:
 *
 *   - the player's display name, ABOVE the head (top of the stack)
 *   - a horizontal HP bar (with shield overlay), BELOW the name
 *     and ABOVE the head
 *
 * Both elements sit ABOVE the sprite - never under the feet - so the
 * stack reads as: name on top, HP bar under it, sprite beneath.
 *
 * IMPORTANT: a child added with `.text(sprite.x, sprite.y + dy, ...)`
 * at world coords and then placed in a container at `(sprite.x,
 * sprite.y)` would end up rendered at `(sprite.x + sprite.x,
 * sprite.y + sprite.y + dy)` — way off-screen. We therefore create
 * every child at `(0, dy)` (local to the container) and let
 * `container.setPosition(sprite.x, sprite.y)` do the translation.
 *
 * Health numbers come from:
 *   - local player: `currentPlayerState` (read each tick so we don't
 *     wait for an onChange patch)
 *   - remote player: `sprite.data.get("currentHealth"/"maxHealth"/...)`
 *     (written by the Colyseus onChange handler)
 */
import Phaser from "phaser";

/** Sticky of the player HUD: a positioned container with all children. */
export interface PlayerHud {
  container: Phaser.GameObjects.Container;
  nameText: Phaser.GameObjects.Text;
  hpBg: Phaser.GameObjects.Rectangle;
  hpFill: Phaser.GameObjects.Rectangle;
  shieldFill: Phaser.GameObjects.Rectangle;
  /** Cached so update() can skip setText when the name is unchanged. */
  lastName: string;
}

const HUD_DEPTH = 9;
/**
 * Vertical offsets in CONTAINER-LOCAL space (relative to the sprite's
 * CENTER). Both labels sit above the head, stacked top-to-bottom:
 *
 *   y = -50   NAME  (top of the stack; bottom edge at y = -50)
 *   y = -44   HP BAR + SHIELD OVERLAY  (5px gap, just under the name)
 *   y = -32   sprite head / top edge  (~7px gap to the bar)
 *
 * Both labels are local to the container, so they stay aligned as
 * long as the container follows the sprite.
 */
const NAME_OFFSET_Y = -50;
const BAR_OFFSET_Y = -44;
const BAR_W = 48;
const BAR_H = 5;
const NAME_STYLE = {
  color: "#ffffff",
  fontSize: "12px",
  fontFamily: "monospace",
  stroke: "#000000",
  strokeThickness: 3,
};

/**
 * Build the HUD container once. The container is anchored on the
 * sprite's center, so children use LOCAL coords relative to that
 * center.
 *
 * `showHpBar` controls whether the HP bar + shield overlay are
 * visible. The lobby passes `false` (no health concept there); the
 * gameplay scenes pass `true`.
 */
export function attachPlayerHud(
  scene: Phaser.Scene,
  sprite: Phaser.GameObjects.Sprite,
  initialName: string,
  options: { showHpBar?: boolean } = {},
): PlayerHud {
  const showHpBar = options.showHpBar !== false;
  const barW = BAR_W;

  // Name text — local coord (0, -38) above the sprite's head.
  const nameText = scene.add
    .text(0, NAME_OFFSET_Y, initialName || "", NAME_STYLE)
    .setOrigin(0.5, 1);

  // HP bar — local coords centered horizontally on the sprite.
  // We place the background centered (origin 0.5), the fill/shield
  // anchored at the left edge so they shrink rightward with scaleX.
  const hpBg = scene.add
    .rectangle(0, BAR_OFFSET_Y, barW, BAR_H, 0x000000, 0.7)
    .setStrokeStyle(1, 0x000000, 0.9);
  const hpFill = scene.add
    .rectangle(-barW / 2, BAR_OFFSET_Y, barW, BAR_H, 0x4dd24d)
    .setOrigin(0, 0.5);
  const shieldFill = scene.add
    .rectangle(-barW / 2, BAR_OFFSET_Y, barW, BAR_H, 0xffffff, 0.6)
    .setOrigin(0, 0.5)
    .setVisible(false);

  hpBg.setVisible(showHpBar);
  hpFill.setVisible(showHpBar);

  const container = scene.add
    .container(sprite.x, sprite.y, [nameText, hpBg, hpFill, shieldFill])
    .setDepth(HUD_DEPTH);

  return {
    container,
    nameText,
    hpBg,
    hpFill,
    shieldFill,
    lastName: initialName || "",
  };
}

/**
 * Move the HUD with the sprite and refresh the bar/name. Cheap to
 * call every fixed tick.
 *
 *   sprite           the player sprite (anchor)
 *   hud              returned by attachPlayerHud()
 *   newName          server-synced displayName (may be "" until first patch)
 *   hp / maxHp       server-synced currentHealth / maxHealth
 *   shield / maxSh   server-synced shield / maxShield
 *   showHpBar        when false, HP bar + shield stay hidden
 */
export function updatePlayerHud(
  hud: PlayerHud,
  sprite: Phaser.GameObjects.Sprite,
  newName: string,
  hp: number,
  maxHp: number,
  shield: number,
  maxSh: number,
  showHpBar: boolean,
): void {
  // Translate the container with the sprite (children keep their
  // local offsets, so the bar stays under the feet and the name
  // stays over the head).
  hud.container.setPosition(sprite.x, sprite.y);

  // Refresh the name only when it changes (avoids re-laying-out text).
  const safeName = newName || "";
  if (safeName !== hud.lastName) {
    hud.nameText.setText(safeName);
    hud.lastName = safeName;
  }

  if (!showHpBar) {
    if (hud.hpBg.visible) hud.hpBg.setVisible(false);
    if (hud.hpFill.visible) hud.hpFill.setVisible(false);
    if (hud.shieldFill.visible) hud.shieldFill.setVisible(false);
    return;
  }
  // Bar was hidden (lobby path) but the scene is now a gameplay scene
  // — make it visible again.
  if (!hud.hpBg.visible) hud.hpBg.setVisible(true);
  if (!hud.hpFill.visible) hud.hpFill.setVisible(true);

  // ---- HP fill ----
  const safeMax = Math.max(1, maxHp | 0);
  const ratio = Math.max(0, Math.min(1, (hp | 0) / safeMax));
  hud.hpFill.scaleX = ratio;
  // Color: green above 50%, orange-yellow at 25-50%, red below 25%.
  hud.hpFill.fillColor = ratio > 0.5 ? 0x4dd24d : ratio > 0.25 ? 0xffaa00 : 0xff3333;

  // ---- Shield overlay ----
  // Hidden when the player has no shield capacity or their shield is 0.
  if (maxSh > 0 && shield > 0) {
    if (!hud.shieldFill.visible) hud.shieldFill.setVisible(true);
    hud.shieldFill.scaleX = Math.max(0, Math.min(1, shield / maxSh));
  } else if (hud.shieldFill.visible) {
    hud.shieldFill.setVisible(false);
  }
}

/** Tear down the HUD container + every child. */
export function destroyPlayerHud(
  hud: PlayerHud | null | undefined,
): void {
  if (!hud) return;
  hud.container.destroy();
}
