/**
 * Floating damage / XP-gain numbers (world-space) above the affected entity.
 * Both effects pool their Text objects to avoid per-damage allocation.
 */
import Phaser from "phaser";

export function formatNumber(n: number): string {
  if (n < 100000) return Math.floor(n).toString();
  const tiers: [number, string][] = [
    [1e15, "quadr"],
    [1e12, "tril"],
    [1e9, "bil"],
    [1e6, "mil"],
    [1e3, "k"],
  ];
  for (const [threshold, suffix] of tiers) {
    if (n >= threshold) {
      const val = n / threshold;
      return (
        (val >= 100
          ? val.toFixed(0)
          : val >= 10
            ? val.toFixed(1)
            : val.toFixed(2)) +
        " " +
        suffix
      );
    }
  }
  return Math.floor(n).toString();
}

export function spawnDamageNumber(
  scene: Phaser.Scene,
  pool: Phaser.GameObjects.Text[],
  x: number,
  y: number,
  amount: number,
  isCrit: boolean,
  shieldDamage: number,
  hpDamage: number,
): void {
  let txt = pool.find((t) => t.alpha === 0 || !t.active);
  const startY = y - 14;
  if (!txt) {
    txt = scene.add
      .text(x, startY, "", {
        fontSize: "14px",
        fontFamily: "monospace",
        stroke: "#000000",
        strokeThickness: 4,
      })
      .setOrigin(0.5).setDepth(300);
    pool.push(txt);
  } else {
    txt.setPosition(x, startY).setActive(true).setVisible(true);
  }
  // Damage is shown as a bare number — no leading minus sign. The
  // colour (red / blue / gold) tells the player it's damage; the
  // sign was redundant and noisy.
  const critPart = isCrit && shieldDamage > 0 ? Math.round(shieldDamage).toString() : "";
  const hpPart = hpDamage > 0
    ? Math.round(hpDamage).toString()
    : Math.round(amount).toString();
  const baseColor = isCrit
    ? "#ffd700"
    : shieldDamage > 0 && hpDamage === 0
      ? "#aaccff"
      : "#ff6666";
  const lines: string[] = [];
  if (isCrit && shieldDamage > 0) lines.push(critPart);
  lines.push(hpPart);
  txt
    .setText(lines.join("\n"))
    .setFontSize(isCrit ? 20 : 14)
    .setColor(baseColor)
    .setAlpha(1)
    .setActive(true)
    .setVisible(true);
  scene.tweens.killTweensOf(txt);
  scene.tweens.add({
    targets: txt,
    y: startY - 32,
    alpha: 0,
    duration: isCrit ? 900 : 700,
    ease: "Cubic.out",
    delay: 80,
    onComplete: () => {
      txt!.setActive(false);
    },
  });
}

export function spawnXpGainPopup(
  scene: Phaser.Scene,
  pool: Phaser.GameObjects.Text[],
  x: number,
  y: number,
  amount: number,
): void {
  if (amount <= 0) return;
  let txt = pool.find((t) => !t.active);
  if (!txt) {
    txt = scene.add
      .text(x, y, "+0 xp", {
        color: "#88ccff",
        fontSize: "12px",
        fontFamily: "monospace",
        stroke: "#000000",
        strokeThickness: 3,
      })
      .setOrigin(0.5);
    pool.push(txt);
  }
  txt.setText("+" + formatNumber(amount) + " xp");
  txt.setPosition(x, y).setAlpha(1).setActive(true).setVisible(true);
  scene.tweens.killTweensOf(txt);
  scene.tweens.add({
    targets: txt,
    y: y - 26,
    alpha: 0,
    duration: 900,
    ease: "Cubic.out",
    onComplete: () => txt!.setActive(false),
  });
}
