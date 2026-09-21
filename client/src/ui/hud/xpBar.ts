/**
 * Top-center XP bar + level badge + skill-point badge.
 *
 * Layout:  [ Lv N ]  [========blue bar showing xp=========]
 */
import Phaser from "phaser";
import { spawnXpGainPopup, formatNumber } from "../damageNumbers";

export interface XpBarRefs {
  xpBarBack: Phaser.GameObjects.Rectangle;
  xpBarFill: Phaser.GameObjects.Rectangle;
  xpBarGain: Phaser.GameObjects.Rectangle;
  levelBadge: Phaser.GameObjects.Container;
  levelBadgeText: Phaser.GameObjects.Text;
  xpBarText: Phaser.GameObjects.Text;
  skillPointBadgePulse: Phaser.Tweens.Tween | null;
  skillPointBadge: Phaser.GameObjects.Container;
  skillPointBadgeText: Phaser.GameObjects.Text;
  xpBarFullWidth: number;
  xpBarY: number;
  /** World-space center of the gold skill-point dot. Used for hit area. */
  badgeX: number;
  badgeY: number;
  xpGainPopups: Phaser.GameObjects.Text[];
}

export function createXpBar(scene: Phaser.Scene): XpBarRefs {
  const W = scene.cameras.main.width;
  const OFFSET_X = -300;
  const cx = W / 2 + OFFSET_X;
  const BAR_W = Math.min(W * 0.35, 196);
  const BAR_H = 6;
  const BADGE_GAP = 6;
  const ABOVE_HUD_GAP = -34;
  const BACK_COLOR = 0x0a1a2a;
  const FILL_COLOR = 0x2f8fff;

  const HUD_SCALE_TMP = 0.3;
  const HUD_IMG_H_TMP = 479;
  const hudTopY = scene.cameras.main.height - HUD_IMG_H_TMP * HUD_SCALE_TMP;
  const TOP_Y = hudTopY - ABOVE_HUD_GAP - BAR_H;
  const levelTextApproxW = 36;
  const totalW = levelTextApproxW + BADGE_GAP + BAR_W;
  const rowLeft = cx - totalW / 2;
  const barX = rowLeft + levelTextApproxW + BADGE_GAP;
  const levelTextX = rowLeft + levelTextApproxW / 2;
  const cy = TOP_Y + BAR_H / 2;

  const xpBarBack = scene.add
    .rectangle(barX, TOP_Y, BAR_W, BAR_H, BACK_COLOR)
    .setOrigin(0, 0)
    .setScrollFactor(0)
    .setDepth(150);
  const xpBarFill = scene.add
    .rectangle(barX, TOP_Y, 0, BAR_H, FILL_COLOR)
    .setOrigin(0, 0)
    .setScrollFactor(0)
    .setDepth(151);
  const xpBarGain = scene.add
    .rectangle(barX, TOP_Y, 0, BAR_H, 0xffffff)
    .setOrigin(0, 0)
    .setScrollFactor(0)
    .setDepth(152)
    .setAlpha(0);
  const xpBarText = scene.add
    .text(barX + BAR_W / 2, cy, "", {
      color: "#ffffff",
      fontSize: "10px",
      fontFamily: "monospace",
      stroke: "#000000",
      strokeThickness: 3,
    })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(153);
  const levelBadgeText = scene.add
    .text(levelTextX, cy, "Lv 1", {
      color: "#ffd700",
      fontSize: "14px",
      fontFamily: "monospace",
      fontStyle: "bold",
      stroke: "#000000",
      strokeThickness: 3,
    })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(153);
  const levelBadge = scene.add
    .container(0, 0, [levelBadgeText])
    .setScrollFactor(0)
    .setDepth(151);

  const badgeX = levelTextX + 16;
  const badgeY = cy - 10;
  const badgeBg = scene.add.graphics().setScrollFactor(0).setDepth(154);
  badgeBg.fillStyle(0xffd700, 1);
  badgeBg.fillCircle(badgeX, badgeY, 6);
  badgeBg.lineStyle(2, 0xffffff, 0.9);
  badgeBg.strokeCircle(badgeX, badgeY, 6);
  const skillPointBadgeText = scene.add
    .text(badgeX, badgeY, "1", {
      color: "#000000",
      fontSize: "10px",
      fontFamily: "monospace",
      fontStyle: "bold",
    })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(155);
  const skillPointBadge = scene.add
    .container(0, 0, [badgeBg, skillPointBadgeText])
    .setScrollFactor(0)
    .setDepth(154)
    .setVisible(false);

  levelBadgeText.setInteractive({ useHandCursor: true });

  return {
    xpBarBack,
    xpBarFill,
    xpBarGain,
    levelBadge,
    levelBadgeText,
    xpBarText,
    skillPointBadgePulse: null,
    skillPointBadge,
    skillPointBadgeText,
    xpBarFullWidth: BAR_W,
    xpBarY: cy,
    badgeX,
    badgeY,
    xpGainPopups: [],
  };
}

export function setLevelClickHandler(refs: XpBarRefs, cb: () => void): void {
  // Both the level badge text and the gold skill-point dot are clickable
  // shortcuts to open the character screen. The badge is the more obvious
  // target (it pulses when a skill point is available).
  const handler = () => cb();
  // Level badge text — already created with setInteractive in createXpBar,
  // we just need to bind the actual click handler here.
  refs.levelBadgeText.off("pointerdown");
  refs.levelBadgeText.on("pointerdown", handler);
  // Skill-point gold dot — make the whole container clickable with a
  // circle hit area centered on the dot. Without this the dot is purely
  // visual; no input event ever fires.
  refs.skillPointBadge.off("pointerdown");
  refs.skillPointBadge.setInteractive(
    new Phaser.Geom.Circle(refs.badgeX, refs.badgeY, 12),
    Phaser.Geom.Circle.Contains,
  );
  refs.skillPointBadge.on("pointerdown", handler);
  (refs as any)._onLevelClick = cb;
}

export interface XpBarCallbacks {
  onLevelUp?: (level: number) => void;
  scene: Phaser.Scene;
  state: {
    lastKnownXp: number;
    lastKnownLevel: number;
  };
}

export function updateXpBar(
  refs: XpBarRefs,
  player: any,
  cb: XpBarCallbacks,
): void {
  if (!refs.xpBarFill) return;
  const level = Math.floor(player.level ?? 1);
  const currentXp = Math.floor(player.currentXp ?? 0);
  const xpToLevelUp = Math.max(1, Math.floor(player.xpToLevelUp ?? 1));
  refs.levelBadgeText.setText("Lv " + level);
  const ratio = Phaser.Math.Clamp(currentXp / xpToLevelUp, 0, 1);
  const fillW = refs.xpBarFullWidth * ratio;
  refs.xpBarFill.setSize(fillW, refs.xpBarFill.height);
  refs.xpBarText.setText(
    formatNumber(currentXp) + " / " + formatNumber(xpToLevelUp),
  );
  if (cb.state.lastKnownLevel !== -1) {
    if (level === cb.state.lastKnownLevel && currentXp > cb.state.lastKnownXp) {
      const gained = currentXp - cb.state.lastKnownXp;
      flashXpBarGain(
        cb.scene,
        refs,
        cb.state.lastKnownXp,
        currentXp,
        xpToLevelUp,
      );
      spawnXpGainPopup(
        cb.scene,
        refs.xpGainPopups,
        refs.xpBarFill.x + refs.xpBarFullWidth / 2,
        refs.xpBarY - 4,
        gained,
      );
    } else if (level > cb.state.lastKnownLevel) {
      if (cb.onLevelUp) cb.onLevelUp(level);
      flashLevelUpBar(cb.scene, refs);
      if (currentXp > 0) {
        flashXpBarGain(cb.scene, refs, 0, currentXp, xpToLevelUp);
        spawnXpGainPopup(
          cb.scene,
          refs.xpGainPopups,
          refs.xpBarFill.x + refs.xpBarFullWidth / 2,
          refs.xpBarY - 4,
          currentXp,
        );
      }
    }
  }
  cb.state.lastKnownXp = currentXp;
  cb.state.lastKnownLevel = level;
  const sp = Math.floor(player.skillPoints ?? 0);
  if (sp > 0) {
    refs.skillPointBadgeText.setText(String(sp));
    refs.skillPointBadge.setVisible(true);
    if (!refs.skillPointBadgePulse) {
      refs.skillPointBadgePulse = cb.scene.tweens.add({
        targets: refs.skillPointBadge,
        alpha: { from: 0.4, to: 1.0 },
        duration: 500,
        yoyo: true,
        repeat: -1,
        ease: "Sine.inOut",
      });
    }
  } else {
    refs.skillPointBadge.setVisible(false);
    if (refs.skillPointBadgePulse) {
      refs.skillPointBadgePulse.stop();
      refs.skillPointBadgePulse = null;
      refs.skillPointBadge.setAlpha(1);
    }
  }
}

export function flashXpBarGain(
  scene: Phaser.Scene,
  refs: XpBarRefs,
  fromXp: number,
  toXp: number,
  xpToLevelUp: number,
): void {
  if (!refs.xpBarGain) return;
  const startX = refs.xpBarFill.x;
  const fromRatio = Phaser.Math.Clamp(fromXp / xpToLevelUp, 0, 1);
  const toRatio = Phaser.Math.Clamp(toXp / xpToLevelUp, 0, 1);
  const gainX = startX + refs.xpBarFullWidth * fromRatio;
  const gainW = refs.xpBarFullWidth * (toRatio - fromRatio);
  if (gainW < 0.5) return;
  refs.xpBarGain
    .setPosition(gainX, refs.xpBarFill.y)
    .setSize(gainW, refs.xpBarFill.height)
    .setAlpha(1);
  scene.tweens.killTweensOf(refs.xpBarGain);
  scene.tweens.add({
    targets: refs.xpBarGain,
    alpha: 0,
    duration: 600,
    ease: "Cubic.out",
    delay: 80,
  });
}

export function flashLevelUpBar(scene: Phaser.Scene, refs: XpBarRefs): void {
  if (!refs.xpBarGain) return;
  refs.xpBarGain
    .setPosition(refs.xpBarFill.x, refs.xpBarFill.y)
    .setSize(refs.xpBarFullWidth, refs.xpBarFill.height)
    .setAlpha(1);
  scene.tweens.killTweensOf(refs.xpBarGain);
  scene.tweens.add({
    targets: refs.xpBarGain,
    alpha: 0,
    duration: 800,
    ease: "Cubic.out",
    delay: 150,
  });
}
