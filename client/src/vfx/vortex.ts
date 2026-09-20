/**
 * Vortex (hurricane pull + yellow blast).
 */
import Phaser from "phaser";
import { VORTEX_COLORS } from "../config/skillDefs";

export function spawnVortex(
  scene: Phaser.Scene,
  x: number,
  y: number,
  radius: number,
  tier: "grey" | "brown" | "purple",
): { container: Phaser.GameObjects.Container; spinEvent: Phaser.Time.TimerEvent } {
  const color = VORTEX_COLORS[tier] ?? VORTEX_COLORS.grey;
  const container = scene.add.container(x, y).setDepth(4);
  const spiralArms: Phaser.GameObjects.Graphics[] = [];
  const ARM_COUNT = 3;
  for (let i = 0; i < ARM_COUNT; i++) {
    const arm = scene.add.graphics();
    arm.lineStyle(4, color, 0.85);
    const points: { x: number; y: number }[] = [];
    const turns = 1.75;
    for (let t = 0; t <= 1.001; t += 0.05) {
      const angle = t * turns * Math.PI * 2 + (i * (Math.PI * 2)) / ARM_COUNT;
      const r = 4 + t * radius;
      points.push({ x: Math.cos(angle) * r, y: Math.sin(angle) * r });
    }
    arm.beginPath();
    arm.moveTo(points[0].x, points[0].y);
    for (const p of points.slice(1)) arm.lineTo(p.x, p.y);
    arm.strokePath();
    container.add(arm);
    spiralArms.push(arm);
  }
  const core = scene.add.circle(0, 0, 12, color, 0.55).setStrokeStyle(3, color, 0.95);
  container.add(core);
  const radiusRing = scene.add
    .circle(0, 0, radius, color, 0.06)
    .setStrokeStyle(2, color, 0.45);
  container.add(radiusRing);
  const spinEvent = scene.time.addEvent({
    delay: 16,
    loop: true,
    callback: () => {
      for (const arm of spiralArms) arm.rotation += 0.12;
    },
  });
  scene.tweens.add({
    targets: core,
    scale: { from: 1, to: 1.6 },
    alpha: { from: 0.95, to: 0.35 },
    duration: 450,
    yoyo: true,
    repeat: -1,
    ease: "Sine.easeInOut",
  });
  scene.tweens.add({
    targets: radiusRing,
    alpha: { from: 0.45, to: 0.12 },
    duration: 800,
    yoyo: true,
    repeat: -1,
    ease: "Sine.easeInOut",
  });
  return { container, spinEvent };
}

export function showVortexExplosion(
  scene: Phaser.Scene,
  x: number,
  y: number,
  radius: number,
): void {
  const YELLOW = 0xffe14d;
  const flash = scene.add.circle(x, y, radius * 0.25, YELLOW, 0.85).setDepth(7);
  scene.tweens.add({
    targets: flash,
    scale: 3.4,
    alpha: 0,
    duration: 380,
    ease: "Cubic.out",
    onComplete: () => flash.destroy(),
  });
  const shock = scene.add
    .circle(x, y, radius * 0.35, 0xffffff, 0)
    .setStrokeStyle(6, YELLOW, 0.95)
    .setDepth(7);
  scene.tweens.add({
    targets: shock,
    scale: 3.2,
    alpha: 0,
    duration: 480,
    ease: "Cubic.out",
    onComplete: () => shock.destroy(),
  });
  for (let i = 0; i < 10; i++) {
    const ang = (i / 10) * Math.PI * 2 + Math.random() * 0.4;
    const spark = scene.add.circle(x, y, 4, YELLOW, 1).setDepth(7);
    const dist = radius * (0.55 + Math.random() * 0.45);
    scene.tweens.add({
      targets: spark,
      x: x + Math.cos(ang) * dist,
      y: y + Math.sin(ang) * dist,
      alpha: 0,
      scale: 0.2,
      duration: 420 + Math.random() * 180,
      ease: "Quad.out",
      onComplete: () => spark.destroy(),
    });
  }
  scene.cameras.main.shake(180, 0.004);
}
