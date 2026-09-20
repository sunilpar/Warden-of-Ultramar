/**
 * Character Stats Screen (press C to toggle).
 */
import Phaser from "phaser";
import {
  asRarity,
  cardFrameForLevel,
  CARD_ART_INSET_RATIO,
  rarityBaseFrame,
  SKILL_CARDS,
  type SkillId,
  type Rarity,
} from "../../config/skillDefs";
import { buildOutlineFrame } from "../uiOutline";
import { buildCardTooltipPanel } from "../cardTooltip";
import type { ConfirmPopupRefs } from "../confirmPopup";
import { formatNumber } from "../damageNumbers";

export interface CharacterScreenRefs {
  container: Phaser.GameObjects.Container;
  overlay: Phaser.GameObjects.Rectangle;
  toggle: () => void;
  isVisible: () => boolean;
  refresh: () => void;
  close: () => void;
  setHideMapInfoTooltip: (fn: () => void) => void;
}

export interface CharacterScreenCallbacks {
  scene: Phaser.Scene;
  confirmPopup: ConfirmPopupRefs;
  getPlayer: () => any;
  sendStatSpend: (stat: string) => void;
  sendCardUpgrade: (slot: number) => void;
}

interface StatEntry {
  id: string;
  label: string;
  getValue: (p: any) => string;
  upgradeDesc: string;
}

export function createCharacterScreen(cb: CharacterScreenCallbacks): CharacterScreenRefs {
  const { scene } = cb;
  const W = scene.cameras.main.width;
  const H = scene.cameras.main.height;
  const PANEL_W = 520;
  const PANEL_H = Math.min(H - 60, 600);
  const px = 24;
  const py = Math.round((H - PANEL_H) / 2);
  const container = scene.add
    .container(0, 0)
    .setDepth(400)
    .setVisible(false)
    .setScrollFactor(0);
  const overlay = scene.add
    .rectangle(0, 0, W, H, 0x000000, 0)
    .setOrigin(0, 0)
    .setScrollFactor(0)
    .setDepth(399)
    .setVisible(false);
  overlay.setInteractive();
  const panelBg = scene.add.graphics().setScrollFactor(0);
  panelBg.fillStyle(0x0a0a14, 0.95);
  panelBg.fillRect(px, py, PANEL_W, PANEL_H);
  container.add(panelBg);
  container.add(buildOutlineFrame(scene, px, py, PANEL_W, PANEL_H).setDepth(1));
  const titleText = scene.add
    .text(px + PANEL_W / 2, py + 14, "CHARACTER", {
      color: "#ffd700",
      fontSize: "20px",
      fontFamily: "monospace",
      fontStyle: "bold",
      stroke: "#000000",
      strokeThickness: 4,
    })
    .setOrigin(0.5, 0)
    .setScrollFactor(0);
  container.add(titleText);
  container.add(
    scene.add
      .text(px + PANEL_W - 12, py + 8, "[C] Close", {
        color: "#888888",
        fontSize: "11px",
        fontFamily: "monospace",
        stroke: "#000000",
        strokeThickness: 2,
      })
      .setOrigin(1, 0)
      .setScrollFactor(0),
  );
  const spBanner = scene.add
    .text(px + 20, py + 8, "", {
      color: "#ffd700",
      fontSize: "13px",
      fontFamily: "monospace",
      fontStyle: "bold",
      stroke: "#000000",
      strokeThickness: 3,
    })
    .setOrigin(0, 0)
    .setScrollFactor(0);
  container.add(spBanner);

  const dynChildren: Phaser.GameObjects.GameObject[] = [];
  const clearDyn = () => {
    for (const d of dynChildren) d.destroy();
    dynChildren.length = 0;
  };
  const addDyn = (obj: Phaser.GameObjects.GameObject) => {
    container.add(obj);
    dynChildren.push(obj);
    return obj;
  };

  const statDefs: StatEntry[] = [
    { id: "maxHealth", label: "Max Health", getValue: (p) => Math.round(p.maxHealth).toString(), upgradeDesc: "+20 Max Health" },
    { id: "attack", label: "Attack", getValue: (p) => Math.round(p.attack).toString(), upgradeDesc: "+8 Attack" },
    { id: "critRate", label: "Crit Rate", getValue: (p) => Math.round(p.critRate * 100) + "%", upgradeDesc: "+5% Crit Rate" },
    { id: "critDamage", label: "Crit Damage", getValue: (p) => Math.round(p.critDamage * 100) + "%", upgradeDesc: "+15% Crit Damage" },
  ];

  let visible = false;
  let hideMapInfo: () => void = () => {};

  const refresh = () => {
    const p = cb.getPlayer();
    if (!p) return;
    clearDyn();
    const sp = Math.floor(p.skillPoints ?? 0);
    spBanner.setText(sp > 0 ? "Skill Points: " + sp : "");
    let y = py + 42;
    const statHeader = scene.add
      .text(px + 20, y, "STATS", {
        color: "#ffd700",
        fontSize: "14px",
        fontFamily: "monospace",
        fontStyle: "bold",
        stroke: "#000000",
        strokeThickness: 3,
      })
      .setOrigin(0, 0)
      .setScrollFactor(0);
    addDyn(statHeader);
    y += statHeader.height + 6;
    for (const stat of statDefs) {
      const line = scene.add
        .text(px + 20, y, stat.label + ": " + stat.getValue(p), {
          color: "#ffffff",
          fontSize: "13px",
          fontFamily: "monospace",
          stroke: "#000000",
          strokeThickness: 2,
        })
        .setOrigin(0, 0)
        .setScrollFactor(0);
      addDyn(line);
      if (sp > 0) {
        const btn = scene.add
          .text(px + PANEL_W - 20, y, "[+ Upgrade]", {
            color: "#66ff66",
            fontSize: "13px",
            fontFamily: "monospace",
            fontStyle: "bold",
            stroke: "#000000",
            strokeThickness: 2,
          })
          .setOrigin(1, 0)
          .setScrollFactor(0)
          .setInteractive({ useHandCursor: true });
        addDyn(btn);
        btn.on("pointerdown", () => {
          cb.confirmPopup.show(
            "Increase " + stat.label + " by " + stat.upgradeDesc + "?\nAre you sure?",
            () => {
              cb.sendStatSpend(stat.id);
              scene.time.delayedCall(200, () => {
                if (visible) refresh();
              });
            },
          );
        });
      }
      y += line.height + 4;
    }
    y += 16;

    const itemHeader = scene.add
      .text(px + 20, y, "EQUIPPED ITEMS", {
        color: "#88ccff",
        fontSize: "14px",
        fontFamily: "monospace",
        fontStyle: "bold",
        stroke: "#000000",
        strokeThickness: 3,
      })
      .setOrigin(0, 0)
      .setScrollFactor(0);
    addDyn(itemHeader);
    y += itemHeader.height + 8;
    if ((p.maxShield ?? 0) > 0) {
      const itemDispW = 48;
      const itemDispH = 75;
      const shieldInset = itemDispW * CARD_ART_INSET_RATIO;
      const slotBg = scene.add
        .rectangle(px + 30, y, itemDispW + 6, itemDispH + 6, 0x113355, 0.8)
        .setOrigin(0, 0)
        .setScrollFactor(0)
        .setStrokeStyle(2, 0x33b5ff);
      addDyn(slotBg);
      addDyn(
        scene.add
          .image(px + 33, y + 3, "card_sheet", rarityBaseFrame("common"))
          .setOrigin(0, 0)
          .setDisplaySize(itemDispW, itemDispH)
          .setScrollFactor(0),
      );
      const slotImg = scene.add
        .sprite(px + 33 + shieldInset, y + 3 + shieldInset, "card_sheet", cardFrameForLevel("shield", 1))
        .setOrigin(0, 0)
        .setDisplaySize(itemDispW - shieldInset * 2, itemDispH - shieldInset * 2)
        .setScrollFactor(0)
        .setInteractive({ useHandCursor: true });
      addDyn(slotImg);
      const shieldLvl = p.shieldCardLevel ?? 1;
      addDyn(
        scene.add
          .rectangle(
            px + 30 + itemDispW / 2,
            y + itemDispH - 2,
            itemDispW - 6,
            16,
            0x000000,
            0.85,
          )
          .setOrigin(0.5, 1)
          .setScrollFactor(0),
      );
      addDyn(
        scene.add
          .text(px + 30 + itemDispW / 2, y + itemDispH - 4, "Lv " + shieldLvl, {
            color: "#ffffff",
            fontSize: "10px",
            fontFamily: "monospace",
            stroke: "#000000",
            strokeThickness: 2,
          })
          .setOrigin(0.5, 1)
          .setScrollFactor(0),
      );
      slotImg.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
        if (!pointer.rightButtonDown()) return;
        if (sp <= 0) return;
        cb.confirmPopup.show(
          "Upgrade Shield card slot?\nFaster recovery delay.\nAre you sure?",
          () => {
            cb.sendStatSpend("shield");
            scene.time.delayedCall(200, () => {
              if (visible) refresh();
            });
          },
        );
      });
    }
    y += 75 + 18;

    const cardHeader = scene.add
      .text(px + 20, y, "EQUIPPED CARDS", {
        color: "#ffd700",
        fontSize: "14px",
        fontFamily:
 "monospace",
        fontStyle: "bold",
        stroke: "#000000",
        strokeThickness: 3,
      })
      .setOrigin(0, 0)
      .setScrollFactor(0);
    addDyn(cardHeader);
    y += cardHeader.height + 10;
    const cardDispW = 48;
    const cardDispH = 75;
    const cardGap = 12;
    const equipped: string[] = [];
    if (p.equippedSlots) {
      for (const c of p.equippedSlots) if (c && c.skill) equipped.push(c.skill);
    }
    for (let i = 0; i < equipped.length; i++) {
      const skillId = equipped[i] as SkillId;
      const slotCard = (p.equippedSlots as any)[i];
      const skillLvl = slotCard?.level ?? p.skillLevels.get(skillId) ?? 1;
      const cardX = px + 30 + i * (cardDispW + cardGap);
      const rarity: Rarity = asRarity((p.equippedSlots as any)[i]?.rarity);
      const csInset = cardDispW * CARD_ART_INSET_RATIO;
      addDyn(
        scene.add
          .image(cardX, y, "card_sheet", rarityBaseFrame(rarity))
          .setDisplaySize(cardDispW, cardDispH)
          .setOrigin(0, 0)
          .setScrollFactor(0),
      );
      const cardImg = scene.add
        .image(cardX + csInset, y + csInset, "card_sheet", cardFrameForLevel(skillId, skillLvl))
        .setDisplaySize(cardDispW - csInset * 2, cardDispH - csInset * 2)
        .setOrigin(0, 0)
        .setScrollFactor(0)
        .setInteractive({ useHandCursor: true });
      addDyn(cardImg);
      const lvlBg = scene.add.graphics().setScrollFactor(0);
      lvlBg.fillStyle(0x000000, 0.7);
      lvlBg.fillRoundedRect(cardX + cardDispW / 2 - 14, y + cardDispH - 18, 28, 14, 4);
      addDyn(lvlBg);
      addDyn(
        scene.add
          .text(cardX + cardDispW / 2, y + cardDispH - 11, "Lv" + skillLvl, {
            color: "#ffd700",
            fontSize: "9px",
            fontFamily: "monospace",
            fontStyle: "bold",
            stroke: "#000000",
            strokeThickness: 2,
          })
          .setOrigin(0.5)
          .setScrollFactor(0),
      );
      const ttCard = (p.equippedSlots as any)[i];
      cardImg.on("pointerover", () => {
        const panel = buildCardTooltipPanel(scene, {
          skill: skillId,
          level: skillLvl,
          rarity: asRarity(ttCard?.rarity ?? "common"),
          modIds: (ttCard?.modIds as string[]) ?? [],
          modValues: (ttCard?.modValues as number[]) ?? [],
        });
        panel.setScrollFactor(0).setDepth(450);
        panel.setPosition(cardX + cardDispW / 2, y - panel.height / 2 - 8);
        container.add(panel);
        (container as any)._hoverTT = panel;
      });
      cardImg.on("pointerout", () => {
        const tt = (container as any)._hoverTT;
        if (tt) {
          tt.destroy();
          (container as any)._hoverTT = null;
        }
      });
      cardImg.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
        if (!pointer.rightButtonDown()) return;
        if (sp <= 0) return;
        let cardUpgradeDesc = "";
        if (skillId === "bolter") cardUpgradeDesc = "+10% damage, +2% projectile speed";
        else if (skillId === "claw") cardUpgradeDesc = "+20% damage";
        else if (skillId === "slam") cardUpgradeDesc = "+20% damage, +10% hitbox size";
        else cardUpgradeDesc = "upgrade to level " + (skillLvl + 1);
        const title = SKILL_CARDS[skillId]?.title ?? skillId;
        cb.confirmPopup.show(
          title + ": " + cardUpgradeDesc + "\nAre you sure you want to upgrade the card?",
          () => {
            cb.sendCardUpgrade(i);
            scene.time.delayedCall(200, () => {
              if (visible) refresh();
            });
          },
        );
      });
    }
    y += cardDispH + 20;
    const level = Math.floor(p.level ?? 1);
    const currentXp = Math.floor(p.currentXp ?? 0);
    const xpToLevelUp = Math.floor(p.xpToLevelUp ?? 0);
    addDyn(
      scene.add
        .text(
          px + 20,
          y,
          [
            "Level: " + level + "    XP: " + formatNumber(currentXp) + " / " + formatNumber(xpToLevelUp),
            "XP to next level: " + formatNumber(Math.max(0, xpToLevelUp - currentXp)),
          ].join("\n"),
          {
            color: "#aaaaff",
            fontSize: "12px",
            fontFamily: "monospace",
            stroke: "#000000",
            strokeThickness: 2,
          },
        )
        .setOrigin(0, 0)
        .setScrollFactor(0),
    );
  };

  const offX = -(PANEL_W + 60);
  const open = () => {
    hideMapInfo();
    refresh();
    container.setPosition(offX, 0).setVisible(true);
    scene.tweens.add({
      targets: container,
      x: 0,
      duration: 250,
      ease: "Cubic.Out",
      onComplete: () => {
        overlay.setVisible(true).setAlpha(0);
        scene.tweens.add({
          targets: overlay,
          alpha: 0.6,
          duration: 200,
        });
      },
    });
    visible = true;
  };
  const close = () => {
    scene.tweens.add({
      targets: overlay,
      alpha: 0,
      duration: 200,
      onComplete: () => overlay.setVisible(false),
    });
    scene.tweens.add({
      targets: container,
      x: offX,
      duration: 200,
      ease: "Cubic.In",
      onComplete: () => {
        clearDyn();
        container.setVisible(false);
      },
    });
    visible = false;
  };
  const toggle = () => (visible ? close() : open());
  overlay.on("pointerdown", () => {
    if (visible) close();
  });
  scene.input.keyboard
    ?.addKey(Phaser.Input.Keyboard.KeyCodes.C)
    ?.on("down", toggle);
  scene.input.keyboard
    ?.addKey(Phaser.Input.Keyboard.KeyCodes.ESC)
    ?.on("down", () => {
      if (visible) close();
    });

  return {
    container,
    overlay,
    toggle,
    isVisible: () => visible,
    refresh,
    close,
    setHideMapInfoTooltip: (fn: () => void) => {
      hideMapInfo = fn;
    },
  };
}
