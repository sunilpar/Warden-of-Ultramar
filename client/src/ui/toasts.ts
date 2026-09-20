/**
 * Transient toasts (cooldown, upgrade, level-up, spawn countdown, exit locked,
 * pickup-failed, announcements).
 */
import Phaser from "phaser";

export function showCooldownToast(
  scene: Phaser.Scene,
  hudTopY: number | undefined,
): Phaser.GameObjects.Text {
  const msg = "skill in cooldown";
  const x = scene.cameras.main.centerX;
  const y = hudTopY !== undefined ? hudTopY - 18 : scene.cameras.main.height - 160;
  const existing = (scene as any).cooldownToast as
    | Phaser.GameObjects.Text
    | undefined;
  let txt: Phaser.GameObjects.Text;
  if (existing) {
    txt = existing.setText(msg).setPosition(x, y);
  } else {
    txt = scene.add
      .text(x, y, msg, {
        color: "#cccccc",
        fontSize: "16px",
        fontFamily: "monospace",
        stroke: "#000000",
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(200);
    (scene as any).cooldownToast = txt;
  }
  txt.setAlpha(1);
  scene.tweens.killTweensOf(txt);
  scene.time.delayedCall(600, () => {
    scene.tweens.add({
      targets: txt,
      alpha: 0,
      duration: 400,
    });
  });
  return txt;
}

export function showPickupFailedToast(
  scene: Phaser.Scene,
  msg: string,
): void {
  const x = scene.cameras.main.width / 2;
  const txt = scene.add
    .text(x, scene.cameras.main.height - 170, msg, {
      color: "#ff5555",
      fontSize: "14px",
      fontFamily: "monospace",
      fontStyle: "bold",
      stroke: "#000000",
      strokeThickness: 3,
    })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(3000);
  scene.tweens.add({
    targets: txt,
    alpha: 0,
    delay: 900,
    duration: 400,
    onComplete: () => txt.destroy(),
  });
}

export function showUpgradeToast(
  scene: Phaser.Scene,
  upgradeToast: Phaser.GameObjects.Text | undefined,
  level: number,
): Phaser.GameObjects.Text {
  const x = scene.cameras.main.width / 2;
  const y = 100;
  const msg = "CARDS UPGRADED TO Lv " + level;
  let txt: Phaser.GameObjects.Text;
  if (upgradeToast) {
    txt = upgradeToast.setText(msg).setPosition(x, y);
  } else {
    txt = scene.add
      .text(x, y, msg, {
        color: "#ffd700",
        fontSize: "18px",
        fontFamily: "monospace",
        fontStyle: "bold",
        stroke: "#000000",
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(200);
  }
  txt.setAlpha(1);
  scene.tweens.killTweensOf(txt);
  scene.time.delayedCall(1200, () => {
    scene.tweens.add({
      targets: txt,
      alpha: 0,
      duration: 600,
    });
  });
  return txt;
}

export function showLevelUpToast(
  scene: Phaser.Scene,
  existing: Phaser.GameObjects.Text | null | undefined,
  level: number,
): Phaser.GameObjects.Text {
  const msg = "LEVEL UP!  Lv " + level;
  const x = scene.cameras.main.width / 2;
  const y = 36;
  let txt: Phaser.GameObjects.Text;
  if (existing) {
    txt = existing.setText(msg).setPosition(x, y);
  } else {
    txt = scene.add
      .text(x, y, msg, {
        color: "#ffd700",
        fontSize: "18px",
        fontFamily: "monospace",
        fontStyle: "bold",
        stroke: "#000000",
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(201);
  }
  txt.setAlpha(1);
  scene.tweens.killTweensOf(txt);
  txt.setScale(1.3);
  scene.tweens.add({
    targets: txt,
    scale: 1,
    duration: 250,
    ease: "Back.out",
  });
  scene.time.delayedCall(1500, () => {
    scene.tweens.add({
      targets: txt,
      alpha: 0,
      duration: 600,
    });
  });
  return txt;
}

export function showSpawnCountdownToast(
  scene: Phaser.Scene,
  existing: Phaser.GameObjects.Text | null | undefined,
  secsLeft: number,
): Phaser.GameObjects.Text {
  const msg = "ENEMIES WILL SPAWN IN " + secsLeft;
  const x = scene.cameras.main.width / 2;
  const y = 36;
  let txt: Phaser.GameObjects.Text;
  if (existing) {
    txt = existing.setText(msg).setPosition(x, y);
  } else {
    txt = scene.add
      .text(x, y, msg, {
        color: "#ff5555",
        fontSize: "18px",
        fontFamily: "monospace",
        fontStyle: "bold",
        stroke: "#000000",
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(201);
  }
  scene.tweens.killTweensOf(txt);
  txt.setScale(1.2);
  scene.tweens.add({
    targets: txt,
    scale: 1,
    duration: 200,
    ease: "Back.out",
  });
  return txt;
}

export function showExitLockedToast(
  scene: Phaser.Scene,
  existing: Phaser.GameObjects.Text | null | undefined,
  show: boolean,
): Phaser.GameObjects.Text | null {
  if (show) {
    const x = scene.cameras.main.width / 2;
    const y = 36;
    const msg = "EXIT SEALED - SLAY THE ELITE TO UNLOCK";
    if (existing) {
      existing.setText(msg).setPosition(x, y).setVisible(true);
      return existing;
    }
    return scene.add
      .text(x, y, msg, {
        color: "#ff8844",
        fontSize: "16px",
        fontFamily: "monospace",
        fontStyle: "bold",
        stroke: "#000000",
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(3000);
  }
  if (existing) existing.setVisible(false);
  return null;
}

export function announce(scene: Phaser.Scene, msg: string, color: string): void {
  const x = scene.cameras.main.width / 2;
  const txt = scene.add
    .text(x, 60, msg, {
      color,
      fontSize: "18px",
      fontFamily: "monospace",
      fontStyle: "bold",
      stroke: "#000000",
      strokeThickness: 4,
    })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(3000);
  scene.tweens.add({
    targets: txt,
    alpha: 0,
    delay: 1800,
    duration: 700,
    onComplete: () => txt.destroy(),
  });
}
