/**
 * Character Stats Screen (press C to toggle).
 *
 * UPGRADE FLOW
 * ------------
 * The player allocates skill points LOCALLY first, then presses the
 * SAVE button at the top of the panel to apply the whole batch to the
 * server in a single message (server msg 21). One confirmation popup
 * is shown only on SAVE - not on every + / − click.
 *
 * If the panel is closed (ESC / outside-click / [C] toggle) without
 * saving, ALL pending allocations are discarded.
 *
 * Card level ups are done by right-clicking the card image; the shield
 * slot level up by the + button next to it (same layout as the cards).
 *
 * CLICK HANDLING
 * --------------
 * The dim overlay covers the full screen and closes the panel on click.
 * A transparent interactive rectangle sits BEHIND every dynamic child
 * but ABOVE the overlay (depth 401, inside the panel), so clicks INSIDE
 * the panel are absorbed by it instead of bubbling to the overlay. The
 * SAVE button is OUTSIDE the panel (to the right), where it has its
 * own interactive area on top of the overlay.
 *
 * HOVER TOOLTIPS
 * --------------
 * Every hover element uses a shared showHover/hideHover pair. If the
 * mouse leaves the element, the tooltip closes immediately. As a
 * safety net (e.g. the underlying element was destroyed during a
 * refresh), a 2-second timer auto-closes any lingering tooltip.
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

/** Per-stat deltas when one skill point is spent on that stat. */
interface StatDef {
  id: string;
  label: string;
  /** Optional cap (e.g. defence caps at 0.95). */
  cap?: number;
  /** Format the displayed stat value with `pending` extra points. */
  format: (p: any, pending: number) => string;
}

const STAT_DEFS: StatDef[] = [
  {
    id: "health",
    label: "Max Health",
    format: (p, n) => Math.round(p.maxHealth + n * 500).toString(),
  },
  {
    id: "attack",
    label: "Attack",
    format: (p, n) => Math.round(p.attack + n * 20).toString(),
  },
  {
    id: "critRate",
    label: "Crit Rate",
    format: (p, n) => Math.round((p.critRate + n * 0.02) * 100) + "%",
  },
  {
    id: "critDamage",
    label: "Crit Damage",
    format: (p, n) => Math.round((p.critDamage + n * 0.2) * 100) + "%",
  },
  {
    id: "moveSpeed",
    label: "Move Speed",
    format: (p, n) => {
      const base = p.baseMoveSpeed ?? 120;
      const mult = (p.speedMultiplier ?? 1.0) + n * 0.05;
      return Math.round((base * mult * 100) / base) + "%";
    },
  },
  {
    id: "defence",
    label: "Defence",
    cap: 0.95,
    format: (p, n) =>
      Math.round(Math.min(0.95, p.defence + n * 0.02) * 100) + "%",
  },
];

const MAX_CARD_LEVEL = 10;
const MAX_SHIELD_CARD_LEVEL = 10;

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
  sendStatBatch: (payload: {
    stats: Record<string, number>;
    shieldLevels: number;
    cards: { slot: number; levels: number }[];
  }) => void;
}

export function createCharacterScreen(
  cb: CharacterScreenCallbacks,
): CharacterScreenRefs {
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

  // ============================================================
  // CLICK BLOCKER — absorbs clicks INSIDE the panel so they don't
  // bubble to the overlay (which would close the tab).
  // Placed at depth 401 (above overlay's 399, below the SAVE
  // button) and added EARLY in the container so dynamic buttons
  // drawn later render on top and still receive their own events.
  // ============================================================
  const panelBlocker = scene.add
    .rectangle(
      px + PANEL_W / 2,
      py + PANEL_H / 2,
      PANEL_W,
      PANEL_H,
      0x000000,
      0,
    )
    .setOrigin(0.5, 0.5)
    .setScrollFactor(0)
    .setDepth(401)
    .setInteractive();
  container.add(panelBlocker);

  // ============================================================
  // PERSISTENT HEADER (rendered above the panel blocker)
  // ============================================================
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

  const spBanner = scene.add
    .text(px + 20, py + 78, "", {
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

  // ---- SAVE button: absolute bottom-right of the C tab panel ----
  // Like CSS `position: absolute; bottom: 0; right: 0`. Sits inside
  // the panel area so the panelBlocker absorbs its clicks (no overlay
  // close).
  const SAVE_BTN_W = 110;
  const SAVE_BTN_H = 34;
  const saveBtnX = px + PANEL_W - 14;
  const saveBtnY = py + PANEL_H - 18;
  const saveBtnBg = scene.add.graphics().setScrollFactor(0).setDepth(402);
  const saveBtnLabel = scene.add
    .text(saveBtnX, saveBtnY, "[ SAVE ]", {
      color: "#66ff66",
      fontSize: "16px",
      fontFamily: "monospace",
      fontStyle: "bold",
      stroke: "#000000",
      strokeThickness: 3,
    })
    .setOrigin(1, 1)
    .setScrollFactor(0)
    .setDepth(402);
  const saveHit = scene.add
    .rectangle(
      saveBtnX - SAVE_BTN_W / 2,
      saveBtnY - SAVE_BTN_H / 2,
      SAVE_BTN_W,
      SAVE_BTN_H,
      0x000000,
      0,
    )
    .setOrigin(0.5, 0.5)
    .setScrollFactor(0)
    .setDepth(402)
    .setInteractive({ useHandCursor: true });
  saveBtnLabel.setInteractive({ useHandCursor: true });

  const drawSaveBtnBg = (enabled: boolean) => {
    saveBtnBg.clear();
    saveBtnBg.fillStyle(enabled ? 0x1d3a1d : 0x222222, 0.95);
    saveBtnBg.fillRoundedRect(
      saveBtnX - SAVE_BTN_W,
      saveBtnY - SAVE_BTN_H,
      SAVE_BTN_W,
      SAVE_BTN_H,
      6,
    );
    saveBtnBg.lineStyle(enabled ? 2 : 1, enabled ? 0x66ff66 : 0x444444, 1);
    saveBtnBg.strokeRoundedRect(
      saveBtnX - SAVE_BTN_W,
      saveBtnY - SAVE_BTN_H,
      SAVE_BTN_W,
      SAVE_BTN_H,
      6,
    );
  };
  drawSaveBtnBg(false);

  container.add([saveBtnBg, saveHit, saveBtnLabel]);

  // ---- close hint (small, top-right) ----
  const closeHint = scene.add
    .text(px + PANEL_W - 12, py + 12, "[C/ESC] Close", {
      color: "#888888",
      fontSize: "11px",
      fontFamily: "monospace",
      stroke: "#000000",
      strokeThickness: 2,
    })
    .setOrigin(1, 0)
    .setScrollFactor(0);
  container.add(closeHint);

  // ============================================================
  // PENDING ALLOCATION STATE
  // ============================================================
  let pendingStat: Record<string, number> = {};
  let pendingCardLevels: number[] = [0, 0, 0, 0, 0];
  let pendingShieldLevels = 0;

  const totalPending = (): number => {
    let t = pendingShieldLevels;
    for (const v of Object.values(pendingStat)) t += v;
    for (const v of pendingCardLevels) t += v;
    return t;
  };
  const resetPending = () => {
    pendingStat = {};
    pendingCardLevels = [0, 0, 0, 0, 0];
    pendingShieldLevels = 0;
  };

  // ============================================================
  // HOVER TOOLTIP SYSTEM
  // ============================================================
  // Single shared tooltip container. The auto-close timer fires 2 s
  // after the LAST pointerover event on any hovered element. If the
  // mouse moves off the element (pointerout), we hide it immediately.
  // If the element was destroyed (e.g. refresh) the auto-close timer
  // hides it as a fallback.
  let hoverTT: Phaser.GameObjects.Container | null = null;
  let hoverAutoClose: Phaser.Time.TimerEvent | null = null;
  const HOVER_AUTO_CLOSE_MS = 2000;

  const cancelHoverAutoClose = () => {
    if (hoverAutoClose) {
      hoverAutoClose.remove(false);
      hoverAutoClose = null;
    }
  };

  const hideHover = () => {
    cancelHoverAutoClose();
    if (hoverTT) {
      hoverTT.destroy();
      hoverTT = null;
    }
  };

  /** Show a tooltip at the given position with auto-close fallback. */
  const showHover = (
    panel: Phaser.GameObjects.Container,
    x: number,
    y: number,
  ) => {
    hideHover();
    panel.setScrollFactor(0).setDepth(500).setPosition(x, y);
    container.add(panel);
    hoverTT = panel;
    // Auto-close after 2s as a safety net (e.g. underlying element
    // was destroyed during refresh so pointerout never fires).
    hoverAutoClose = scene.time.delayedCall(HOVER_AUTO_CLOSE_MS, () => {
      hideHover();
    });
  };

  // ============================================================
  // DYNAMIC CONTENT (cleared on each refresh)
  // ============================================================
  const dynChildren: Phaser.GameObjects.GameObject[] = [];
  const clearDyn = () => {
    // Always wipe any lingering tooltip when content is rebuilt.
    hideHover();
    for (const d of dynChildren) d.destroy();
    dynChildren.length = 0;
  };
  const addDyn = (obj: Phaser.GameObjects.GameObject) => {
    container.add(obj);
    dynChildren.push(obj);
    return obj;
  };

  let visible = false;
  let hideMapInfo: () => void = () => {};

  /** Build a small [−] / [+] pair on the right edge of a row. */
  const buildPlusMinus = (
    yMid: number,
    canPlus: boolean,
    canMinus: boolean,
    onPlus: () => void,
    onMinus: () => void,
  ): void => {
    const plus = scene.add
      .text(px + PANEL_W - 22, yMid, "+", {
        color: canPlus ? "#66ff66" : "#444444",
        fontSize: "22px",
        fontFamily: "monospace",
        fontStyle: "bold",
        stroke: "#000000",
        strokeThickness: 3,
      })
      .setOrigin(0.5, 0.5)
      .setScrollFactor(0)
      .setDepth(402);
    if (canPlus) {
      plus.setInteractive({ useHandCursor: true });
      plus.on("pointerdown", () => onPlus());
    }
    addDyn(plus);
    const minus = scene.add
      .text(px + PANEL_W - 52, yMid, "−", {
        color: canMinus ? "#ffaa55" : "#444444",
        fontSize: "22px",
        fontFamily: "monospace",
        fontStyle: "bold",
        stroke: "#000000",
        strokeThickness: 3,
      })
      .setOrigin(0.5, 0.5)
      .setScrollFactor(0)
      .setDepth(402);
    if (canMinus) {
      minus.setInteractive({ useHandCursor: true });
      minus.on("pointerdown", () => onMinus());
    }
    addDyn(minus);
  };

  // ============================================================
  // SAVE HANDLER (single confirm popup)
  // ============================================================
  const handleSave = () => {
    const sp = Math.floor(cb.getPlayer()?.skillPoints ?? 0);
    if (totalPending() <= 0 || totalPending() > sp) return;
    cb.confirmPopup.show(
      "Apply " +
        totalPending() +
        " upgrade(s) to your character?\nAre you sure?",
      () => {
        const cards: { slot: number; levels: number }[] = [];
        for (let i = 0; i < pendingCardLevels.length; i++) {
          if (pendingCardLevels[i] > 0) {
            cards.push({ slot: i, levels: pendingCardLevels[i] });
          }
        }
        cb.sendStatBatch({
          stats: { ...pendingStat },
          shieldLevels: pendingShieldLevels,
          cards,
        });
        resetPending();
        scene.time.delayedCall(200, () => {
          if (visible) refresh();
        });
      },
    );
  };
  saveHit.on("pointerdown", () => handleSave());
  saveBtnLabel.on("pointerdown", () => handleSave());

  // ============================================================
  // REFRESH (rebuild all dynamic content from current player state)
  // ============================================================
  const refresh = () => {
    const p = cb.getPlayer();
    if (!p) return;
    clearDyn();
    const sp = Math.floor(p.skillPoints ?? 0);
    const total = totalPending();
    spBanner.setText(
      sp > 0
        ? "Skill Points: " +
            sp +
            (total > 0 ? "  (pending: " + total + ")" : "")
        : total > 0
          ? "Pending: " + total
          : "",
    );
    const saveEnabled = total > 0 && total <= sp;
    saveBtnLabel.setColor(saveEnabled ? "#66ff66" : "#666666");
    drawSaveBtnBg(saveEnabled);

    // ============================================================
    // STATS section
    // ============================================================
    let y = py + 105;
    addDyn(
      scene.add
        .text(px + 20, y, "STATS", {
          color: "#ffd700",
          fontSize: "14px",
          fontFamily: "monospace",
          fontStyle: "bold",
          stroke: "#000000",
          strokeThickness: 3,
        })
        .setOrigin(0, 0)
        .setScrollFactor(0)
        .setDepth(402),
    );
    y += 24;
    for (const stat of STAT_DEFS) {
      const pending = pendingStat[stat.id] ?? 0;
      const valStr = stat.format(p, pending);
      const labelText =
        stat.label +
        ": " +
        valStr +
        (pending > 0 ? "  (+" + pending + ")" : "");
      const line = scene.add
        .text(px + 20, y, labelText, {
          color: pending > 0 ? "#ffe066" : "#ffffff",
          fontSize: "13px",
          fontFamily: "monospace",
          stroke: "#000000",
          strokeThickness: 2,
        })
        .setOrigin(0, 0)
        .setScrollFactor(0)
        .setDepth(402);
      addDyn(line);
      // Defence caps at 0.95 — disable + once we hit it.
      const isCapped =
        stat.cap !== undefined &&
        (stat.id === "defence" ? p.defence : p[stat.id]) >= stat.cap;
      const canPlus = sp > 0 && total < sp && !isCapped;
      const canMinus = pending > 0;
      buildPlusMinus(
        y + 9,
        canPlus,
        canMinus,
        () => {
          pendingStat[stat.id] = (pendingStat[stat.id] ?? 0) + 1;
          refresh();
        },
        () => {
          pendingStat[stat.id] = Math.max(0, (pendingStat[stat.id] ?? 0) - 1);
          if (pendingStat[stat.id] === 0) delete pendingStat[stat.id];
          refresh();
        },
      );
      y += 22;
    }
    y += 14;

    // ============================================================
    // EQUIPPED ITEMS (shield slot — rendered EXACTLY like the
    // equipped cards below: card image + Lv label + hover tooltip)
    // ============================================================
    addDyn(
      scene.add
        .text(px + 20, y, "EQUIPPED ITEMS", {
          color: "#88ccff",
          fontSize: "14px",
          fontFamily: "monospace",
          fontStyle: "bold",
          stroke: "#000000",
          strokeThickness: 3,
        })
        .setOrigin(0, 0)
        .setScrollFactor(0)
        .setDepth(402),
    );
    y += 24;
    if ((p.maxShield ?? 0) > 0) {
      const shieldLevelNow = p.shieldCardLevel ?? 1;
      const shieldCapped =
        shieldLevelNow + pendingShieldLevels >= MAX_SHIELD_CARD_LEVEL;
      // Same card layout as the equipped cards below.
      const cardDispW = 48;
      const cardDispH = 75;
      const csInset = cardDispW * CARD_ART_INSET_RATIO;
      const cardX = px + 30;
      const cardY = y;
      const rarity: Rarity = "common";
      addDyn(
        scene.add
          .image(cardX, cardY, "card_sheet", rarityBaseFrame(rarity))
          .setDisplaySize(cardDispW, cardDispH)
          .setOrigin(0, 0)
          .setScrollFactor(0)
          .setDepth(402),
      );
      const slotImg = scene.add
        .sprite(
          cardX + csInset,
          cardY + csInset,
          "card_sheet",
          cardFrameForLevel("shield", shieldLevelNow),
        )
        .setDisplaySize(cardDispW - csInset * 2, cardDispH - csInset * 2)
        .setOrigin(0, 0)
        .setScrollFactor(0)
        .setInteractive({ useHandCursor: true })
        .setDepth(402);
      addDyn(slotImg);
      // Lv label below (same style as cards).
      addDyn(
        scene.add
          .graphics()
          .setScrollFactor(0)
          .setDepth(402)
          .fillStyle(0x000000, 0.7)
          .fillRoundedRect(
            cardX + cardDispW / 2 - 16,
            cardY + cardDispH - 18,
            32,
            14,
            4,
          ),
      );
      const lvlTxt =
        "Lv" +
        shieldLevelNow +
        (pendingShieldLevels > 0 ? " (+" + pendingShieldLevels + ")" : "");
      addDyn(
        scene.add
          .text(cardX + cardDispW / 2, cardY + cardDispH - 11, lvlTxt, {
            color: pendingShieldLevels > 0 ? "#ffe066" : "#ffd700",
            fontSize: "9px",
            fontFamily: "monospace",
            fontStyle: "bold",
            stroke: "#000000",
            strokeThickness: 2,
          })
          .setOrigin(0.5)
          .setScrollFactor(0)
          .setDepth(402),
      );
      // Hover tooltip (same panel used by the equipped cards).
      const tooltipShield = () => {
        const panel = buildCardTooltipPanel(scene, {
          skill: "shield" as SkillId,
          level: shieldLevelNow,
          rarity: "common",
          modIds: [],
          modValues: [],
        });
        showHover(panel, cardX + cardDispW / 2, cardY - panel.height / 2 - 8);
      };
      slotImg.on("pointerover", () => {
        cancelHoverAutoClose();
        tooltipShield();
      });
      slotImg.on("pointerout", () => hideHover());
      // Right-click also adds a pending shield level (matches cards).
      slotImg.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
        if (!pointer.rightButtonDown()) return;
        if (sp <= 0 || total >= sp || shieldCapped) return;
        pendingShieldLevels += 1;
        refresh();
      });
      // The [+] / [−] pair to the right of the shield card.
      const canPlusShield = sp > 0 && total < sp && !shieldCapped;
      buildPlusMinus(
        cardY + cardDispH / 2,
        canPlusShield,
        pendingShieldLevels > 0,
        () => {
          pendingShieldLevels += 1;
          refresh();
        },
        () => {
          pendingShieldLevels = Math.max(0, pendingShieldLevels - 1);
          refresh();
        },
      );
      y += cardDispH + 12;
    }

    // ============================================================
    // EQUIPPED CARDS — same as before but NO [+] / [−] below each
    // card. Right-click to upgrade instead.
    // ============================================================
    addDyn(
      scene.add
        .text(px + 20, y, "EQUIPPED CARDS", {
          color: "#ffd700",
          fontSize: "14px",
          fontFamily: "monospace",
          fontStyle: "bold",
          stroke: "#000000",
          strokeThickness: 3,
        })
        .setOrigin(0, 0)
        .setScrollFactor(0)
        .setDepth(402),
    );
    y += 24;
    const cardDispW = 48;
    const cardDispH = 75;
    const cardGap = 12;
    const equipped: string[] = [];
    if (p.equippedSlots) {
      for (const c2 of p.equippedSlots)
        if (c2 && c2.skill) equipped.push(c2.skill);
    }
    for (let i = 0; i < equipped.length; i++) {
      const skillId = equipped[i] as SkillId;
      const slotCard = (p.equippedSlots as any)[i];
      const skillLvl = slotCard?.level ?? p.skillLevels.get(skillId) ?? 1;
      const cardX = px + 30 + i * (cardDispW + cardGap);
      const cardY = y;
      const rarity: Rarity = asRarity((p.equippedSlots as any)[i]?.rarity);
      const csInset = cardDispW * CARD_ART_INSET_RATIO;
      addDyn(
        scene.add
          .image(cardX, cardY, "card_sheet", rarityBaseFrame(rarity))
          .setDisplaySize(cardDispW, cardDispH)
          .setOrigin(0, 0)
          .setScrollFactor(0)
          .setDepth(402),
      );
      const cardImg = scene.add
        .image(
          cardX + csInset,
          cardY + csInset,
          "card_sheet",
          cardFrameForLevel(skillId, skillLvl),
        )
        .setDisplaySize(cardDispW - csInset * 2, cardDispH - csInset * 2)
        .setOrigin(0, 0)
        .setScrollFactor(0)
        .setInteractive({ useHandCursor: true })
        .setDepth(402);
      addDyn(cardImg);
      // Lv label (same style as shield).
      addDyn(
        scene.add
          .graphics()
          .setScrollFactor(0)
          .setDepth(402)
          .fillStyle(0x000000, 0.7)
          .fillRoundedRect(
            cardX + cardDispW / 2 - 16,
            cardY + cardDispH - 18,
            32,
            14,
            4,
          ),
      );
      const pendingLvl = pendingCardLevels[i] ?? 0;
      const cardLvlCapped = skillLvl + pendingLvl >= MAX_CARD_LEVEL;
      const lvlTxt =
        "Lv" + skillLvl + (pendingLvl > 0 ? " (+" + pendingLvl + ")" : "");
      addDyn(
        scene.add
          .text(cardX + cardDispW / 2, cardY + cardDispH - 11, lvlTxt, {
            color: pendingLvl > 0 ? "#ffe066" : "#ffd700",
            fontSize: "9px",
            fontFamily: "monospace",
            fontStyle: "bold",
            stroke: "#000000",
            strokeThickness: 2,
          })
          .setOrigin(0.5)
          .setScrollFactor(0)
          .setDepth(402),
      );
      // Hover tooltip using the same card tooltip builder as everywhere
      // else (with the 2-second auto-close safety net).
      const ttCard = (p.equippedSlots as any)[i];
      cardImg.on("pointerover", () => {
        cancelHoverAutoClose();
        const panel = buildCardTooltipPanel(scene, {
          skill: skillId,
          level: skillLvl,
          rarity: asRarity(ttCard?.rarity ?? "common"),
          modIds: (ttCard?.modIds as string[]) ?? [],
          modValues: (ttCard?.modValues as number[]) ?? [],
        });
        showHover(panel, cardX + cardDispW / 2, cardY - panel.height / 2 - 8);
      });
      cardImg.on("pointerout", () => hideHover());
      // Right-click stages a card level upgrade (no confirm popup here).
      cardImg.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
        if (!pointer.rightButtonDown()) return;
        if (sp <= 0 || total >= sp || cardLvlCapped) return;
        pendingCardLevels[i] = (pendingCardLevels[i] ?? 0) + 1;
        refresh();
      });
    }
    y += cardDispH + 18;

    // ============================================================
    // XP / Level line
    // ============================================================
    const level = Math.floor(p.level ?? 1);
    const currentXp = Math.floor(p.currentXp ?? 0);
    const xpToLevelUp = Math.floor(p.xpToLevelUp ?? 0);
    addDyn(
      scene.add
        .text(
          px + 20,
          y,
          [
            "Level: " +
              level +
              "    XP: " +
              formatNumber(currentXp) +
              " / " +
              formatNumber(xpToLevelUp),
            "XP to next level: " +
              formatNumber(Math.max(0, xpToLevelUp - currentXp)),
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
        .setScrollFactor(0)
        .setDepth(402),
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
    // Closing discards all pending allocations.
    resetPending();
    hideHover();
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
