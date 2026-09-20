/**
 * Bolter muzzle flash + bullet hit VFX.
 */
import Phaser from "phaser";
import { BOLTER_COLORS, bolterColorTier } from "../config/skillDefs";

export function spawnMuzzleFlash(
  scene: Phaser.Scene,
  x: number,
  y: number,
  angle: number,
  level: number,
): void {
  const tier = bolterColorTier(level);
  const tint = BOLTER_COLORS[tier];
  const sprite = scene.add
    .sprite(x, y, "bolter_sheet", 3)
    .setDepth(5)
    .setScale(1.4)
    .setRotation(angle)
    .setTint(tint);
  sprite.anims.play("bolter_muzzle");
  sprite.on("animationcomplete", () => sprite.destroy());
}

export function spawnBulletHitVfx(scene: Phaser.Scene, x: number, y: number): void {
  const burst = scene.add.circle(x, y, 3, 0xffffff).setDepth(6);
  scene.tweens.add({
    targets: burst,
    scale: 4,
    alpha: 0,
    duration: 180,
    onComplete: () => burst.destroy(),
  });
}
