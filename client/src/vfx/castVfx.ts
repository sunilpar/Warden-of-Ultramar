/**
 * Skill-cast VFX helpers (claw / pulse / heal / dash / slam).
 */
import Phaser from "phaser";
import { clawRowStartFrame } from "../config/skillDefs";

export interface CastVfxAnchor {
  x: number;
  y: number;
  angle: number;
  range?: number;
  faction?: string;
  tier?: string;
  level?: number;
  startX?: number;
  startY?: number;
}

export function spawnClawVfx(
  scene: Phaser.Scene,
  anchor: CastVfxAnchor,
): Phaser.GameObjects.Sprite {
  const tier = (anchor.tier ?? "small") as "small" | "mid" | "big";
  const startFrame = clawRowStartFrame(anchor.level ?? 1);
  const range = anchor.range ?? (tier === "big" ? 110 : tier === "mid" ? 85 : 60);
  const SPRITE_NATIVE = 64;
  const clawScale = Math.max(1.0, range / 60);
  const scaledSpriteSize = SPRITE_NATIVE * clawScale;
  const halfSprite = scaledSpriteSize / 2;
  const VFX_GAP_CLAW = 12;
  const edgeDist = range - halfSprite;
  const edgeX = anchor.x + Math.cos(anchor.angle) * (edgeDist + VFX_GAP_CLAW);
  const edgeY = anchor.y + Math.sin(anchor.angle) * (edgeDist + VFX_GAP_CLAW);
  const tint = anchor.faction === "enemy" ? 0xff5555 : 0xffffff;
  const animKey = "claw_" + tier;
  const sprite = scene.add
    .sprite(edgeX, edgeY, "claw_sheet", startFrame)
    .setDepth(5)
    .setScale(clawScale)
    .setRotation(anchor.angle)
    .setTint(tint);
  sprite.anims.play(animKey);
  return sprite;
}

export function spawnPulseVfx(
  scene: Phaser.Scene,
  anchor: CastVfxAnchor,
): Phaser.GameObjects.Sprite {
  const tier = (anchor.level ?? 1) >= 6 ? "big" : "small";
  const startFrame = tier === "big" ? 4 : 0;
  const radius = anchor.range ?? 80;
  const SPRITE_NATIVE = 64;
  const pulseScale = Math.max(1.0, (radius * 2) / SPRITE_NATIVE);
  const animKey = "pulse_" + tier;
  const sprite = scene.add
    .sprite(anchor.x, anchor.y, "pulse_sheet", startFrame)
    .setDepth(7)
    .setScale(pulseScale);
  sprite.anims.play(animKey);
  sprite.on("animationcomplete", () => sprite.destroy());
  return sprite;
}

export function spawnHealVfx(
  scene: Phaser.Scene,
  anchor: CastVfxAnchor,
): Phaser.GameObjects.GameObject {
  const radius = anchor.range ?? 0;
  if (radius > 0) {
    const circle = scene.add
      .circle(anchor.x, anchor.y, radius, 0x00ff00, 0.2)
      .setStrokeStyle(3, 0x00ff00, 0.8)
      .setDepth(6);
    scene.tweens.add({
      targets: circle,
      alpha: 0,
      scale: 1.3,
      duration: 700,
      ease: "Cubic.out",
      onComplete: () => circle.destroy(),
    });
    return circle;
  }
  const flash = scene.add.circle(anchor.x, anchor.y, 24, 0x00ff00, 0.6).setDepth(6);
  scene.tweens.add({
    targets: flash,
    alpha: 0,
    scale: 2.5,
    duration: 500,
    ease: "Cubic.out",
    onComplete: () => flash.destroy(),
  });
  return flash;
}

export function spawnDashVfx(
  scene: Phaser.Scene,
  anchor: CastVfxAnchor,
): Phaser.GameObjects.GameObject[] {
  const startX = anchor.startX ?? anchor.x;
  const startY = anchor.startY ?? anchor.y;
  const endX = anchor.x;
  const endY = anchor.y;
  const trail = scene.add
    .line(0, 0, startX, startY, endX, endY, 0xffffff, 0.7)
    .setDepth(6)
    .setLineWidth(8);
  scene.tweens.add({
    targets: trail,
    alpha: 0,
    duration: 300,
    ease: "Cubic.out",
    onComplete: () => trail.destroy(),
  });
  const emerge = scene.add.circle(endX, endY, 12, 0xffffff, 0.8).setDepth(8);
  scene.tweens.add({
    targets: emerge,
    alpha: 0,
    scale: 2.5,
    duration: 350,
    ease: "Cubic.out",
    onComplete: () => emerge.destroy(),
  });
  return [trail, emerge];
}

export function spawnDashIceBlastVfx(
  scene: Phaser.Scene,
  anchor: CastVfxAnchor,
): Phaser.GameObjects.GameObject[] {
  const radius = anchor.range ?? 50;
  const iceBlast = scene.add
    .circle(anchor.x, anchor.y, radius, 0x66ccff, 0.3)
    .setStrokeStyle(3, 0x99eeff, 0.9)
    .setDepth(7);
  scene.tweens.add({
    targets: iceBlast,
    alpha: 0,
    scale: 1.4,
    duration: 500,
    ease: "Cubic.out",
    onComplete: () => iceBlast.destroy(),
  });
  const shards: Phaser.GameObjects.GameObject[] = [];
  const shardCount = 6;
  for (let i = 0; i < shardCount; i++) {
    const a = (i / shardCount) * Math.PI * 2;
    const sx = anchor.x + Math.cos(a) * radius * 0.3;
    const sy = anchor.y + Math.sin(a) * radius * 0.3;
    const ex = anchor.x + Math.cos(a) * radius;
    const ey = anchor.y + Math.sin(a) * radius;
    const shard = scene.add
      .line(0, 0, sx, sy, ex, ey, 0xaaeeff, 0.8)
      .setDepth(8)
      .setLineWidth(3);
    scene.tweens.add({
      targets: shard,
      alpha: 0,
      duration: 400,
      ease: "Cubic.out",
      onComplete: () => shard.destroy(),
    });
    shards.push(shard);
  }
  return [iceBlast, ...shards];
}

export function spawnSlamSprite(
  scene: Phaser.Scene,
  x: number,
  y: number,
  level: number,
  angle: number,
  gap: number,
): Phaser.GameObjects.Sprite {
  const isUpgraded = level >= 6;
  const slamScale = 1.5 * Math.pow(1.1, Math.max(0, level - 2));
  const spawnX = x + Math.cos(angle) * gap;
  const spawnY = y + Math.sin(angle) * gap;
  const sprite = scene.add
    .sprite(spawnX, spawnY, "slam_sheet", 0)
    .setDepth(4)
    .setScale(slamScale)
    .setRotation(angle);
  sprite.setData("slamLevel", level);
  sprite.setData("isUpgraded", isUpgraded);
  sprite.setData("angle", angle);
  return sprite;
}

export function updateSlamFrame(
  sprite: Phaser.GameObjects.Sprite,
  remainingRange: number,
): void {
  const isUpgraded = sprite.data.get("isUpgraded") as boolean;
  const totalRange = isUpgraded ? 200 : 120;
  const travelled = Math.max(0, 1 - remainingRange / totalRange);
  if (isUpgraded) {
    let frame: number;
    if (travelled >= 0.95) frame = 4 + 3;
    else if (travelled <= 0.05) frame = 4 + 0;
    else frame = 4 + (Math.floor(travelled * 20) % 2 === 0 ? 1 : 2);
    sprite.setFrame(frame);
  } else {
    let frame: number;
    if (travelled >= 0.9) frame = 2;
    else if (travelled <= 0.05) frame = 0;
    else frame = 1;
    sprite.setFrame(frame);
  }
}
