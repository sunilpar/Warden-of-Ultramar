/**
 * Map-Stat Picker popup (v2).
 * ===========================
 * Single scrollable card listing EVERY rolled mod for the room, plus
 * three action buttons at the bottom:
 *
 *   [ Cancel ]       - close this player's popup only (others can pick)
 *   [ No Mods ]      - confirm -> transition everyone with no stat
 *   [ Choose Mod ]   - confirm -> transition with the selected mod
 *
 * Each row is clickable to select it; only one is selected at a time.
 * Selected row is highlighted.
 *
 * The bug in v1 (overlay.setInteractive() blocking clicks on the cards)
 * is avoided here: the overlay is purely visual and does NOT consume
 * pointer events; all interactive children are added at a HIGHER
 * display depth than the overlay.
 */
import Phaser from "phaser";

export interface MapStatOffer {
  index: number;
  defId: string;
  goodName: string;
  badName: string;
  goodEffect: string;
  badEffect: string;
  goodValue: number;
  badValue: number;
  durationMaps: number;
}

export interface MapStatPickerRefs {
  root: Phaser.GameObjects.Container;
  /**
   * Open the picker with the full flat offer list.
   * `onCancel`       - fired when "Cancel" is clicked (close-only).
   * `onNoMods`       - fired when "No Mods" is CONFIRMED.
   * `onChoose`       - fired when "Choose Mod" is CONFIRMED with the
   *                    selected index (always >= 0).
   */
  show: (
    tier: number,
    offers: MapStatOffer[],
    callbacks: {
      onCancel: () => void;
      onNoMods: () => void;
      onChoose: (index: number) => void;
    },
  ) => void;
  hide: () => void;
}

const EFFECT_LABEL: Record<string, string> = {
  damage_mult: "Damage",
  crit_rate: "Crit Rate",
  crit_damage: "Crit Damage",
  move_speed_mult: "Move Speed",
  max_health_mult: "Max Health",
  defence: "Defence",
  cooldown_reduction: "Cooldown Reduction",
  rarity_bias: "Better Rarity",
  drop_rate_mult: "Drop Rate",
};

function fmtPct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

function fmtValue(effect: string, value: number): string {
  if (effect === "rarity_bias") return `+${value.toFixed(0)}`;
  return fmtPct(value);
}

/** Compose the combined title and full description for an offer. */
function describeOffer(o: MapStatOffer): { title: string; desc: string } {
  const title = `${o.goodName} and ${o.badName}`;
  const goodSign = o.goodEffect === "rarity_bias" ? "+" : "+";
  const goodLine = `${goodSign}${fmtValue(o.goodEffect, o.goodValue)} player ${EFFECT_LABEL[o.goodEffect] ?? o.goodEffect}`;
  const badLine = `${goodSign}${fmtValue(o.badEffect, o.badValue)} enemy ${EFFECT_LABEL[o.badEffect] ?? o.badEffect}`;
  const durLine = `Lasts ${o.durationMaps} map${o.durationMaps === 1 ? "" : "s"}`;
  return { title, desc: `${goodLine} but ${badLine} • ${durLine}` };
}

/** Simple confirm popup (Yes / No) used before locking in a choice. */
function showConfirm(
  scene: Phaser.Scene,
  message: string,
  onYes: () => void,
): void {
  const W = scene.cameras.main.width;
  const H = scene.cameras.main.height;
  const root = scene.add.container(0, 0).setDepth(800).setScrollFactor(0);
  const overlay = scene.add
    .rectangle(0, 0, W, H, 0x000000, 0.7)
    .setOrigin(0, 0)
    .setScrollFactor(0);
  const cW = 420;
  const cH = 130;
  const cx = Math.round((W - cW) / 2);
  const cy = Math.round((H - cH) / 2);
  const bg = scene.add.graphics().setScrollFactor(0);
  bg.fillStyle(0x12121e, 0.97);
  bg.fillRoundedRect(cx, cy, cW, cH, 12);
  bg.lineStyle(2, 0xffe066, 1);
  bg.strokeRoundedRect(cx, cy, cW, cH, 12);
  const text = scene.add
    .text(W / 2, cy + 18, message, {
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
  const yes = scene.add
    .text(W / 2 - 60, cy + cH - 32, "[ YES ]", {
      color: "#66bb6a",
      fontSize: "16px",
      fontFamily: "monospace",
      fontStyle: "bold",
      stroke: "#000000",
      strokeThickness: 3,
    })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setInteractive({ useHandCursor: true });
  const no = scene.add
    .text(W / 2 + 60, cy + cH - 32, "[ NO ]", {
      color: "#ef5350",
      fontSize: "16px",
      fontFamily: "monospace",
      fontStyle: "bold",
      stroke: "#000000",
      strokeThickness: 3,
    })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setInteractive({ useHandCursor: true });
  root.add([overlay, bg, text, yes, no]);
  const close = () => {
    yes.removeAllListeners();
    no.removeAllListeners();
    root.destroy();
  };
  yes.on("pointerdown", () => {
    close();
    onYes();
  });
  no.on("pointerdown", () => {
    close();
  });
}

export function createMapStatPicker(scene: Phaser.Scene): MapStatPickerRefs {
  const W = scene.cameras.main.width;
  const H = scene.cameras.main.height;
  const root = scene.add
    .container(0, 0)
    .setDepth(600)
    .setVisible(false)
    .setScrollFactor(0);

  // Background dimmer: NOT interactive (this was the v1 click bug).
  const overlay = scene.add
    .rectangle(0, 0, W, H, 0x000000, 0.55)
    .setOrigin(0, 0)
    .setScrollFactor(0);

  // ---- Card layout constants ----
  const cardW = Math.min(720, W - 80);
  const cardH = Math.min(640, H - 80);
  const cardX = Math.round((W - cardW) / 2);
  const cardY = Math.round((H - cardH) / 2);

  const cardBg = scene.add.graphics().setScrollFactor(0);
  cardBg.fillStyle(0x0e0e18, 0.98);
  cardBg.fillRoundedRect(cardX, cardY, cardW, cardH, 14);
  cardBg.lineStyle(2, 0x6a8aaa, 1);
  cardBg.strokeRoundedRect(cardX, cardY, cardW, cardH, 14);

  const title = scene.add
    .text(W / 2, cardY + 28, "PICK MAP MOD FOR FURTHER MAP", {
      color: "#ffe066",
      fontSize: "22px",
      fontFamily: "monospace",
      fontStyle: "bold",
      stroke: "#000000",
      strokeThickness: 4,
    })
    .setOrigin(0.5)
    .setScrollFactor(0);

  const tierLabel = scene.add
    .text(W / 2, cardY + 58, "", {
      color: "#9bb0c0",
      fontSize: "12px",
      fontFamily: "monospace",
      stroke: "#000000",
      strokeThickness: 2,
    })
    .setOrigin(0.5)
    .setScrollFactor(0);

  // ---- Scrollable list area (fixed-height viewport; rows scroll inside) ----
  const listX = cardX + 16;
  const listY = cardY + 84;
  const listW = cardW - 32;
  const rowH = 76;
  const listH = cardH - 84 - 90; // leave room for buttons
  const listBg = scene.add.graphics().setScrollFactor(0);
  listBg.fillStyle(0x05050a, 0.85);
  listBg.fillRoundedRect(listX, listY, listW, listH, 8);
  listBg.lineStyle(1, 0x3a4a5a, 1);
  listBg.strokeRoundedRect(listX, listY, listW, listH, 8);

  // Mask = the list area, so child rows that overflow get clipped.
  const maskShape = scene.add
    .graphics()
    .fillRect(listX, listY, listW, listH)
    .setScrollFactor(0)
    .setVisible(false);
  const listMask = maskShape.createGeometryMask();
  listBg.setVisible(false);

  // Container of rows (masked + scrolled via setMask).
  const list = scene.add.container(0, 0).setScrollFactor(0).setMask(listMask);

  // ---- Bottom buttons ----
  const btnY = cardY + cardH - 56;
  const btnW = 150;
  const btnH = 40;
  const btnGap = 24;
  const totalBtnW = btnW * 3 + btnGap * 2;
  const btnStartX = Math.round((W - totalBtnW) / 2);

  const makeButton = (
    x: number,
    label: string,
    color: string,
    onClick: () => void,
  ) => {
    const colorInt = parseInt(color.replace("#", ""), 16);
    const bg = scene.add.graphics().setScrollFactor(0);
    const draw = (hover: boolean) => {
      bg.clear();
      bg.fillStyle(hover ? 0x3a4b5f : 0x222b3a, 1);
      bg.fillRoundedRect(x, btnY, btnW, btnH, 8);
      bg.lineStyle(2, hover ? colorInt : 0x4a5a6a, 1);
      bg.strokeRoundedRect(x, btnY, btnW, btnH, 8);
    };
    draw(false);
    const hit = scene.add
      .rectangle(x + btnW / 2, btnY + btnH / 2, btnW, btnH, 0x000000, 0)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true });
    const text = scene.add
      .text(x + btnW / 2, btnY + btnH / 2, label, {
        color,
        fontSize: "14px",
        fontFamily: "monospace",
        fontStyle: "bold",
        stroke: "#000000",
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setScrollFactor(0);
    hit.on("pointerover", () => draw(true));
    hit.on("pointerout", () => draw(false));
    hit.on("pointerdown", () => onClick());
    return { bg, hit, text };
  };

  let callbacks: {
    onCancel: () => void;
    onNoMods: () => void;
    onChoose: (index: number) => void;
  } = { onCancel: () => {}, onNoMods: () => {}, onChoose: () => {} };

  const cancelBtn = makeButton(
    btnStartX,
    "[ Cancel ]",
    "#9bb0c0",
    () => {
      hide();
      callbacks.onCancel();
    },
  );
  const noModsBtn = makeButton(
    btnStartX + btnW + btnGap,
    "[ No Mods ]",
    "#ef9a9a",
    () => {
      showConfirm(
        scene,
        "Are you sure you want to move further without any mods?",
        () => {
          hide();
          callbacks.onNoMods();
        },
      );
    },
  );
  const chooseBtn = makeButton(
    btnStartX + (btnW + btnGap) * 2,
    "[ Choose Mod ]",
    "#66bb6a",
    () => {
      if (selectedIndex < 0) {
        // No selection: brief flash on the choose button.
        const orig = chooseBtn.text.style.color;
        chooseBtn.text.setColor("#ff5252");
        scene.time.delayedCall(400, () => chooseBtn.text.setColor(orig));
        return;
      }
      const offer = currentOffers[selectedIndex];
      const { title: modTitle } = describeOffer(offer);
      showConfirm(
        scene,
        `Are you sure you want to move further with the mod:\n"${modTitle}"?`,
        () => {
          const idx = selectedIndex;
          hide();
          callbacks.onChoose(idx);
        },
      );
    },
  );

  // ---- Selection state ----
  let selectedIndex: number = -1;
  let currentOffers: MapStatOffer[] = [];
  // We re-render rows on selection change so we can highlight the
  // chosen one. Keep references so we can destroy them when re-rendering.
  const rowObjects: Phaser.GameObjects.GameObject[] = [];

  const renderList = () => {
    // Clear old rows.
    for (const obj of rowObjects) obj.destroy();
    rowObjects.length = 0;

    const totalRows = currentOffers.length;
    const contentH = totalRows * rowH;

    // The list container's y = listY; children are positioned in
    // local coords (0..contentH). Mask clips anything outside
    // [0..listH] of the container.
    list.setPosition(listX, listY);

    for (let i = 0; i < totalRows; i++) {
      const offer = currentOffers[i];
      const { title: t, desc: d } = describeOffer(offer);
      const y = i * rowH;

      const isSel = i === selectedIndex;
      const bg = scene.add.graphics();
      bg.fillStyle(isSel ? 0x3a4b5f : 0x121824, 1);
      bg.fillRoundedRect(4, y + 4, listW - 8, rowH - 8, 6);
      bg.lineStyle(2, isSel ? 0xffe066 : 0x2a3a4a, 1);
      bg.strokeRoundedRect(4, y + 4, listW - 8, rowH - 8, 6);
      list.add(bg);

      const radio = scene.add.graphics();
      radio.fillStyle(isSel ? 0xffe066 : 0x000000, 1);
      radio.fillCircle(28, y + rowH / 2, 9);
      radio.lineStyle(2, 0xffe066, 1);
      radio.strokeCircle(28, y + rowH / 2, 9);
      list.add(radio);

      const titleText = scene.add
        .text(50, y + 10, t, {
          color: isSel ? "#ffe066" : "#ffffff",
          fontSize: "14px",
          fontFamily: "monospace",
          fontStyle: "bold",
          stroke: "#000000",
          strokeThickness: 3,
        })
        .setOrigin(0, 0);
      list.add(titleText);

      const descText = scene.add
        .text(50, y + 34, d, {
          color: "#a8c0d8",
          fontSize: "11px",
          fontFamily: "monospace",
          stroke: "#000000",
          strokeThickness: 2,
          wordWrap: { width: listW - 60 },
        })
        .setOrigin(0, 0);
      list.add(descText);

      // Clickable hit area covering the whole row.
      const hit = scene.add
        .rectangle(listW / 2, y + rowH / 2, listW - 8, rowH - 8, 0x000000, 0)
        .setInteractive({ useHandCursor: true });
      hit.on("pointerdown", () => {
        selectedIndex = i;
        renderList();
      });
      list.add(hit);
      rowObjects.push(bg, radio, titleText, descText, hit);
    }

    // If list is shorter than the viewport, pad background color.
    if (contentH < listH) {
      // Already drawn by listBg.
    }
  };

  // ---- Scroll wheel support ----
  scene.input.on(
    "wheel",
    (
      _pointer: Phaser.Input.Pointer,
      _gameObjects: any,
      _deltaX: number,
      deltaY: number,
    ) => {
      if (!root.visible) return;
      const totalRows = currentOffers.length;
      const contentH = totalRows * rowH;
      if (contentH <= listH) return;
      const minY = listY - (contentH - listH);
      const cur = list.y;
      const next = Phaser.Math.Clamp(cur - deltaY * 0.5, minY, listY);
      list.y = next;
    },
  );

  // ---- Assemble the root ----
  root.add([
    overlay,
    cardBg,
    title,
    tierLabel,
    listBg,
    maskShape,
    list,
    cancelBtn.bg,
    cancelBtn.text,
    cancelBtn.hit,
    noModsBtn.bg,
    noModsBtn.text,
    noModsBtn.hit,
    chooseBtn.bg,
    chooseBtn.text,
    chooseBtn.hit,
  ]);

  const show = (
    tier: number,
    offers: MapStatOffer[],
    cbs: {
      onCancel: () => void;
      onNoMods: () => void;
      onChoose: (index: number) => void;
    },
  ) => {
    currentOffers = offers;
    selectedIndex = -1;
    callbacks = cbs;
    tierLabel.setText(
      `Tier ${tier} \u2022 ${offers.length} offer${offers.length === 1 ? "" : "s"}`,
    );
    list.y = listY;
    renderList();
    root.setVisible(true);
  };

  const hide = () => {
    root.setVisible(false);
  };

  return { root, show, hide };
}
