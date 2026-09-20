/**
 * Shock (chain lightning) — drawn with Phaser graphics.
 * Bright core + glow + impact spark + a re-draw flicker.
 */
import Phaser from "phaser";

export function drawLightningBolt(
  scene: Phaser.Scene,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: number,
  fillColor: number,
): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.hypot(dx, dy);
  if (dist < 1) return;
  const nx = -dy / dist;
  const ny = dx / dist;
  const segments = Math.max(4, Math.floor(dist / 30));
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const px = x1 + dx * t;
    const py = y1 + dy * t;
    const jag = i === 0 || i === segments ? 0 : (Math.random() - 0.5) * 24;
    points.push({ x: px + nx * jag, y: py + ny * jag });
  }
  const glow = scene.add.graphics().setDepth(6);
  glow.lineStyle(8, fillColor, 0.35);
  glow.beginPath();
  glow.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) glow.lineTo(points[i].x, points[i].y);
  glow.strokePath();
  const core = scene.add.graphics().setDepth(7);
  core.lineStyle(2.5, color, 1.0);
  core.beginPath();
  core.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) core.lineTo(points[i].x, points[i].y);
  core.strokePath();
  const spark = scene.add.circle(x2, y2, 12, color, 0.9).setDepth(8);
  const sparkGlow = scene.add.circle(x2, y2, 20, fillColor, 0.4).setDepth(7);
  scene.tweens.add({
    targets: [core, glow],
    alpha: 0,
    duration: 250,
    delay: 60,
    onComplete: () => {
      core.destroy();
      glow.destroy();
    },
  });
  scene.tweens.add({
    targets: [spark, sparkGlow],
    alpha: 0,
    scale: 2.5,
    duration: 300,
    onComplete: () => {
      spark.destroy();
      sparkGlow.destroy();
    },
  });
  scene.time.delayedCall(30, () => {
    if (!core.active) return;
    core.clear();
    core.lineStyle(2.5, color, 0.9);
    core.beginPath();
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const px = x1 + dx * t;
      const py = y1 + dy * t;
      const jag = i === 0 || i === segments ? 0 : (Math.random() - 0.5) * 24;
      const px2 = px + nx * jag;
      const py2 = py + ny * jag;
      if (i === 0) core.moveTo(px2, py2);
      else core.lineTo(px2, py2);
    }
    core.strokePath();
  });
}
