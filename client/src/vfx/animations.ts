/**
 * Animation registrations (player / enemies / skill sprites).
 *
 * Each function creates the animation set for ONE spritesheet and is safe
 * to call multiple times (Phaser skips animations that already exist).
 */
import Phaser from "phaser";

export function createCharacterAnimations(scene: Phaser.Scene): void {
  if (scene.anims.exists("player_idle")) return;
  scene.anims.create({
    key: "player_idle",
    frames: scene.anims.generateFrameNumbers("player_sheet", { start: 0, end: 7 }),
    frameRate: 8,
    repeat: -1,
  });
  scene.anims.create({
    key: "player_walk_left",
    frames: scene.anims.generateFrameNumbers("player_sheet", { start: 8, end: 15 }),
    frameRate: 10,
    repeat: -1,
  });
  scene.anims.create({
    key: "player_walk_right",
    frames: scene.anims.generateFrameNumbers("player_sheet", { start: 16, end: 23 }),
    frameRate: 10,
    repeat: -1,
  });
}

export function createEnemyAnimations(scene: Phaser.Scene): void {
  if (!scene.anims.exists("tri_idle")) {
    scene.anims.create({
      key: "tri_idle",
      frames: scene.anims.generateFrameNumbers("tyranid_sheet", { start: 0, end: 3 }),
      frameRate: 8,
      repeat: -1,
    });
    scene.anims.create({
      key: "tri_attack",
      frames: scene.anims.generateFrameNumbers("tyranid_sheet", { start: 4, end: 7 }),
      frameRate: 10,
      repeat: 0,
    });
  }
  if (!scene.anims.exists("orck_idle")) {
    scene.anims.create({
      key: "orck_idle",
      frames: scene.anims.generateFrameNumbers("orck_sheet", { start: 0, end: 4 }),
      frameRate: 10,
      repeat: -1,
    });
    scene.anims.create({
      key: "orck_attack",
      frames: scene.anims.generateFrameNumbers("orck_sheet", { start: 5, end: 9 }),
      frameRate: 10,
      repeat: 0,
    });
  }
  if (!scene.anims.exists("tau_idle")) {
    scene.anims.create({
      key: "tau_idle",
      frames: scene.anims.generateFrameNumbers("tau_sheet", { start: 0, end: 5 }),
      frameRate: 8,
      repeat: -1,
    });
    scene.anims.create({
      key: "tau_attack",
      frames: scene.anims.generateFrameNumbers("tau_sheet", { start: 6, end: 11 }),
      frameRate: 12,
      repeat: 0,
    });
  }
  if (!scene.anims.exists("mechanicus_idle")) {
    scene.anims.create({
      key: "mechanicus_idle",
      frames: scene.anims.generateFrameNumbers("mechanicus_sheet", { start: 0, end: 5 }),
      frameRate: 8,
      repeat: -1,
    });
    scene.anims.create({
      key: "mechanicus_attack",
      frames: scene.anims.generateFrameNumbers("mechanicus_sheet", { start: 6, end: 11 }),
      frameRate: 10,
      repeat: 0,
    });
  }
  if (!scene.anims.exists("caster_idle")) {
    scene.anims.create({
      key: "caster_idle",
      frames: scene.anims.generateFrameNumbers("caster_sheet", { start: 0, end: 4 }),
      frameRate: 8,
      repeat: -1,
    });
    scene.anims.create({
      key: "caster_attack",
      frames: scene.anims.generateFrameNumbers("caster_sheet", { start: 5, end: 9 }),
      frameRate: 10,
      repeat: 0,
    });
  }
}

export function createBolterAnimations(scene: Phaser.Scene): void {
  if (scene.anims.exists("bolter_muzzle")) return;
  scene.anims.create({
    key: "bolter_muzzle",
    frames: scene.anims.generateFrameNumbers("bolter_sheet", { start: 3, end: 5 }),
    frameRate: 24,
    repeat: 0,
  });
}

export function createPulseAnimations(scene: Phaser.Scene): void {
  const rows = [
    { tier: "small", start: 0 },
    { tier: "big", start: 4 },
  ];
  for (const { tier, start } of rows) {
    const key = "pulse_" + tier;
    if (scene.anims.exists(key)) continue;
    scene.anims.create({
      key,
      frames: scene.anims.generateFrameNumbers("pulse_sheet", { start, end: start + 3 }),
      frameRate: 20,
      repeat: 0,
    });
  }
}

export function createClawAnimations(scene: Phaser.Scene): void {
  const tiers: { key: string; start: number }[] = [
    { key: "claw_small", start: 0 },
    { key: "claw_mid", start: 4 },
    { key: "claw_big", start: 8 },
  ];
  for (const t of tiers) {
    if (scene.anims.exists(t.key)) continue;
    scene.anims.create({
      key: t.key,
      frames: scene.anims.generateFrameNumbers("claw_sheet", { start: t.start, end: t.start + 3 }),
      frameRate: 18,
      repeat: 0,
    });
  }
}
