/**
 * Blood splat VFX (spawned on enemy death).
 */
import Phaser from "phaser";

export function spawnBloodSplat(scene: Phaser.Scene, x: number, y: number): void {
  const splat = scene.add.circle(x, y, 8, 0x8b0000, 0.7).setDepth(6);
  scene.tweens.add({
    targets: splat,
    scale: 3,
    alpha: 0,
    duration: 450,
    ease: "Cubic.out",
    onComplete: () => splat.destroy(),
  });
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI * 2 * i) / 6 + Math.random() * 0.5;
    const dist = 12 + Math.random() * 16;
    const px = x + Math.cos(angle) * dist;
    const py = y + Math.sin(angle) * dist;
    const drop = scene.add
      .circle(px, py, 2 + Math.random() * 2, 0xaa1111, 0.6)
      .setDepth(6);
    scene.tweens.add({
      targets: drop,
      x: x + Math.cos(angle) * (dist + 10),
      y: y + Math.sin(angle) * (dist + 10),
      alpha: 0,
      duration: 350 + Math.random() * 200,
      ease: "Cubic.out",
      onComplete: () => drop.destroy(),
    });
  }
}
