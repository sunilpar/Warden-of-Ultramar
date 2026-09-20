/**
 * Death-screen overlay (translucent black + gold-lined box + Respawn / Quit).
 */
import Phaser from "phaser";
import { buildOutlineFrame } from "../uiOutline";

export interface DeathScreenRefs {
  container: Phaser.GameObjects.Container | null;
}

export function showDeathScreen(
  scene: Phaser.Scene,
  onRespawn: () => void,
  onQuit: () => void,
): Phaser.GameObjects.Container {
  const cam = scene.cameras.main;
  const cx = cam.width / 2;
  const cy = cam.height / 2;
  const bg = scene.add
    .rectangle(cx, cy, cam.width, cam.height, 0x000000, 0.75)
    .setScrollFactor(0)
    .setDepth(2000);
  const boxW = 360;
  const boxH = 220;
  const box = scene.add
    .rectangle(cx, cy, boxW, boxH, 0x3d2b1f, 0.95)
    .setScrollFactor(0)
    .setDepth(2001);
  const boxOutline = buildOutlineFrame(
    scene,
    cx - boxW / 2,
    cy - boxH / 2,
    boxW,
    boxH,
  ).setDepth(2005);
  const title = scene.add
    .text(cx, cy - 70, "YOU DIED", {
      fontFamily: "Georgia, serif",
      fontSize: "28px",
      color: "#d4a017",
      stroke: "#000000",
      strokeThickness: 4,
    })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(2002);
  const respawnBtn = scene.add
    .rectangle(cx, cy + 10, 180, 44, 0x2d4a2b, 0.9)
    .setScrollFactor(0)
    .setDepth(2002)
    .setInteractive({ useHandCursor: true });
  const respawnOutline = buildOutlineFrame(
    scene,
    cx - 90,
    cy - 12,
    180,
    44,
  ).setDepth(2005);
  const respawnText = scene.add
    .text(cx, cy + 10, "Respawn", {
      fontFamily: "Georgia, serif",
      fontSize: "18px",
      color: "#ffffff",
    })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(2003);
  const quitBtn = scene.add
    .rectangle(cx, cy + 64, 180, 44, 0x4a2b2b, 0.9)
    .setScrollFactor(0)
    .setDepth(2002)
    .setInteractive({ useHandCursor: true });
  const quitOutline = buildOutlineFrame(
    scene,
    cx - 90,
    cy + 42,
    180,
    44,
  ).setDepth(2005);
  const quitText = scene.add
    .text(cx, cy + 64, "Quit", {
      fontFamily: "Georgia, serif",
      fontSize: "18px",
      color: "#ffffff",
    })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(2003);
  respawnBtn.on("pointerover", () => respawnBtn.setFillStyle(0x3d6a3d, 0.95));
  respawnBtn.on("pointerout", () => respawnBtn.setFillStyle(0x2d4a2b, 0.9));
  quitBtn.on("pointerover", () => quitBtn.setFillStyle(0x6a3d3d, 0.95));
  quitBtn.on("pointerout", () => quitBtn.setFillStyle(0x4a2b2b, 0.9));
  respawnBtn.on("pointerdown", onRespawn);
  quitBtn.on("pointerdown", onQuit);
  return scene.add
    .container(0, 0, [
      bg,
      box,
      boxOutline,
      title,
      respawnBtn,
      respawnOutline,
      respawnText,
      quitBtn,
      quitOutline,
      quitText,
    ])
    .setScrollFactor(0)
    .setDepth(2000);
}

export function hideDeathScreen(
  refs: DeathScreenRefs,
): DeathScreenRefs {
  if (refs.container) {
    refs.container.destroy();
    refs.container = null;
  }
  return refs;
}
