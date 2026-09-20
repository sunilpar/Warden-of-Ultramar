/**
 * Reusable confirmation popup (Yes / No buttons).
 */
import Phaser from "phaser";

export interface ConfirmPopupRefs {
  root: Phaser.GameObjects.Container;
  show: (message: string, onYes: () => void) => void;
}

export function createConfirmPopup(scene: Phaser.Scene): ConfirmPopupRefs {
  const W = scene.cameras.main.width;
  const root = scene.add
    .container(0, 0)
    .setDepth(500)
    .setVisible(false)
    .setScrollFactor(0);
  const overlay = scene.add
    .rectangle(0, 0, W, scene.cameras.main.height, 0x000000, 0.3)
    .setOrigin(0, 0)
    .setScrollFactor(0);
  overlay.setInteractive();
  const cW = 300;
  const cH = 120;
  let cx = Math.round((W - cW) / 2);
  let cy = Math.round((scene.cameras.main.height - cH) / 2);
  const cBg = scene.add.graphics().setScrollFactor(0);
  cBg.fillStyle(0x12121e, 0.97);
  cBg.fillRoundedRect(cx, cy, cW, cH, 10);
  cBg.lineStyle(2, 0x4a6a8a, 0.9);
  cBg.strokeRoundedRect(cx, cy, cW, cH, 10);
  const cText = scene.add
    .text(W / 2, cy + 18, "", {
      color: "#ffffff",
      fontSize: "14px",
      fontFamily: "monospace",
      align: "center",
      wordWrap: { width: cW - 40 },
      stroke: "#000000",
      strokeThickness: 3,
    })
    .setOrigin(0.5, 0)
    .setScrollFactor(0);
  const cYes = scene.add
    .text(W / 2 - 50, cy + cH - 32, "[ YES ]", {
      color: "#66bb6a",
      fontSize: "14px",
      fontFamily: "monospace",
      fontStyle: "bold",
      stroke: "#000000",
      strokeThickness: 3,
    })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setInteractive({ useHandCursor: true });
  const cNo = scene.add
    .text(W / 2 + 50, cy + cH - 32, "[ NO ]", {
      color: "#ef5350",
      fontSize: "14px",
      fontFamily: "monospace",
      fontStyle: "bold",
      stroke: "#000000",
      strokeThickness: 3,
    })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setInteractive({ useHandCursor: true });
  root.add([overlay, cBg, cText, cYes, cNo]);
  let cb: () => void = () => {};
  const show = (message: string, onYes: () => void) => {
    cText.setText(message);
    const textHeight = cText.height;
    const minH = cH;
    const neededH = Math.max(minH, 18 + textHeight + 16 + 32 + 12);
    const newCy = Math.round((scene.cameras.main.height - neededH) / 2);
    cBg.clear();
    cBg.fillStyle(0x12121e, 0.97);
    cBg.fillRoundedRect(cx, newCy, cW, neededH, 10);
    cBg.lineStyle(2, 0x4a6a8a, 0.9);
    cBg.strokeRoundedRect(cx, newCy, cW, neededH, 10);
    cText.setPosition(W / 2, newCy + 18);
    const btnY = newCy + 18 + textHeight + 16;
    cYes.setPosition(W / 2 - 50, btnY);
    cNo.setPosition(W / 2 + 50, btnY);
    cb = onYes;
    root.setVisible(true);
  };
  cYes.on("pointerdown", () => {
    root.setVisible(false);
    const f = cb;
    cb = () => {};
    f();
  });
  cNo.on("pointerdown", () => {
    root.setVisible(false);
    cb = () => {};
  });
  return { root, show };
}
