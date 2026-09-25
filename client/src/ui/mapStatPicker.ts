/**
 * Map-Stat Picker popup (v2).
 * ===========================
 * Single scrollable card listing EVERY rolled mod for the room, plus
 * three action buttons at the bottom:
 *
 *   [ Cancel ]       - close this player's popup only (others can pick)
 *   [ No Mods ]      - confirm -> transition everyone with no stat
 *   [ Continue with Mod ]   - confirm -> transition with the selected mod
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

/** Minimal view of one ACTIVE map mod (from room.state.activeMapStats). */
export interface ActiveMapStatView {
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

export const EFFECT_LABEL: Record<string, string> = {
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

export function fmtValue(effect: string, value: number): string {
  if (effect === "rarity_bias") return `+${value.toFixed(0)}`;
  return fmtPct(value);
}

/**
 * Two-line description of an ACTIVE map stat (HUD tooltip + inventory):
 *   title:  "Furious and Tanky"
 *   desc:   "+30% player Damage but +20% enemy Defence (+2 maps)"
 * where "+N maps" is the remaining duration. This mirrors describeOffer
 * (used by the picker) so wording stays consistent before/after picking.
 */
export function describeActiveStat(s: ActiveMapStatView): {
  title: string;
  desc: string;
} {
  const goodLine = `+${fmtValue(s.goodEffect, s.goodValue)} player ${EFFECT_LABEL[s.goodEffect] ?? s.goodEffect}`;
  const badLine = `+${fmtValue(s.badEffect, s.badValue)} enemy ${EFFECT_LABEL[s.badEffect] ?? s.badEffect}`;
  const remaining = `(+${s.durationMaps} map${s.durationMaps === 1 ? "" : "s"})`;
  return {
    title: `${s.goodName} and ${s.badName}`,
    desc: `${goodLine} but ${badLine} ${remaining}`,
  };
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
  // Build everything INSIDE one container at depth 900 so the popup
  // always sits above the picker (depth 600) and any other UI.
  const root = scene.add
    .container(W / 2, H / 2)
    .setDepth(900)
    .setScrollFactor(0);
  const overlay = scene.add
    .rectangle(0, 0, W * 2, H * 2, 0x000000, 0.7)
    .setOrigin(0.5)
    .setScrollFactor(0);
  const cW = 460;
  const cH = 160;
  const bg = scene.add.graphics().setScrollFactor(0);
  bg.fillStyle(0x12121e, 0.97);
  bg.fillRoundedRect(-cW / 2, -cH / 2, cW, cH, 12);
  bg.lineStyle(2, 0xffe066, 1);
  bg.strokeRoundedRect(-cW / 2, -cH / 2, cW, cH, 12);
  const text = scene.add
    .text(0, -cH / 2 + 18, message, {
      color: "#ffffff",
      fontSize: "15px",
      fontFamily: "monospace",
      align: "center",
      wordWrap: { width: cW - 40 },
      stroke: "#000000",
      strokeThickness: 3,
    })
    .setOrigin(0.5, 0)
    .setScrollFactor(0);
  const yes = scene.add
    .text(-70, cH / 2 - 32, "[ YES ]", {
      color: "#66bb6a",
      fontSize: "18px",
      fontFamily: "monospace",
      fontStyle: "bold",
      stroke: "#000000",
      strokeThickness: 3,
    })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setInteractive({ useHandCursor: true });
  const no = scene.add
    .text(70, cH / 2 - 32, "[ NO ]", {
      color: "#ef5350",
      fontSize: "18px",
      fontFamily: "monospace",
      fontStyle: "bold",
      stroke: "#000000",
      strokeThickness: 3,
    })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setInteractive({ useHandCursor: true });
  // Invisible full-area hit so clicks outside the popup but inside the
  // overlay do not fall through to the picker / scene underneath.
  const overlayHit = scene.add
    .rectangle(0, 0, W * 2, H * 2, 0x000000, 0)
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setInteractive();
  root.add([overlayHit, overlay, bg, text, yes, no]);
  // Pop-in animation so the popup is visually obvious.
  root.setScale(0.6);
  scene.tweens.add({
    targets: root,
    scale: 1,
    duration: 140,
    ease: "Back.easeOut",
  });
  const close = () => {
    yes.removeAllListeners();
    no.removeAllListeners();
    overlayHit.removeAllListeners();
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
      .setOrigin(0.5)
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
    "[ Continue with Mod ]",
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
        `Are you sure you want to proceed further with\n${modTitle}?`,
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
  let hoverIndex: number = -1;
  let currentOffers: MapStatOffer[] = [];
  // We re-render rows on selection/hover change so we can highlight the
  // chosen / hovered row. Keep references so we can destroy them when
  // re-rendering.
  const rowObjects: Phaser.GameObjects.GameObject[] = [];

  /** Redraw only the bg + radio visuals of a single row (used for hover). */
  const redrawRowVisuals = (
    i: number,
    bg: Phaser.GameObjects.Graphics,
    radio: Phaser.GameObjects.Graphics,
    titleText: Phaser.GameObjects.Text,
  ) => {
    const y = i * rowH;
    const isSel = i === selectedIndex;
    const isHover = i === hoverIndex;
    // Background colour: selected = bright blue, hovered = mid blue,
    // otherwise dark.
    const bgFill = isSel ? 0x3a4b5f : isHover ? 0x22304a : 0x121824;
    const bgStroke = isSel ? 0xffe066 : isHover ? 0x6a8aaa : 0x2a3a4a;
    bg.clear();
    bg.fillStyle(bgFill, 1);
    bg.fillRoundedRect(4, y + 4, listW - 8, rowH - 8, 6);
    bg.lineStyle(2, bgStroke, 1);
    bg.strokeRoundedRect(4, y + 4, listW - 8, rowH - 8, 6);
    radio.clear();
    radio.fillStyle(isSel ? 0xffe066 : 0x000000, 1);
    radio.fillCircle(28, y + rowH / 2, 9);
    radio.lineStyle(2, 0xffe066, 1);
    radio.strokeCircle(28, y + rowH / 2, 9);
    titleText.setColor(isSel ? "#ffe066" : "#ffffff");
  };

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
      const radio = scene.add.graphics();

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

      // Initial visuals (bg + radio drawn via the helper so they are
      // consistent with the hover update path).
      redrawRowVisuals(i, bg, radio, titleText);
      // Render order: bg FIRST so it renders UNDER the text. Adding it
      // after the text would paint the bg fill over the title/desc.
      list.add([bg, titleText, descText, radio]);

      // Clickable hit area covering the whole row.
      // NOTE: scrollFactor(0) is REQUIRED for input to work here. The
      // game camera scrolls with the player, and Phaser 3.55 hit-tests
      // container children using the child's OWN scrollFactor. Without
      // this, the clickable area drifts off-screen with the camera and
      // rows become unclickable (the buttons below already do this).
      const hit = scene.add
        .rectangle(listW / 2, y + rowH / 2, listW - 8, rowH - 8, 0x000000, 0)
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setInteractive({ useHandCursor: true });
      hit.on("pointerdown", () => {
        if (selectedIndex === i) return;
        selectedIndex = i;
        // Defer the row rebuild to the NEXT frame so the in-flight
        // pointerdown/pointerup events complete against the original
        // (still-alive) hit rectangle. Re-rendering synchronously
        // destroys the row mid-click, which can cause some pointer
        // event paths to drop the gesture entirely.
        scene.time.delayedCall(0, () => {
          if (root.visible) renderList();
        });
      });
      // Hover feedback (no full re-render - just redraw the affected
      // rows so the highlight follows the cursor smoothly).
      hit.on("pointerover", () => {
        if (hoverIndex === i) return;
        const prev = hoverIndex;
        hoverIndex = i;
        if (prev >= 0 && rowObjects[prev * 5]) {
          redrawRowVisuals(
            prev,
            rowObjects[prev * 5] as Phaser.GameObjects.Graphics,
            rowObjects[prev * 5 + 1] as Phaser.GameObjects.Graphics,
            rowObjects[prev * 5 + 2] as Phaser.GameObjects.Text,
          );
        }
        redrawRowVisuals(i, bg, radio, titleText);
      });
      hit.on("pointerout", () => {
        if (hoverIndex !== i) return;
        hoverIndex = -1;
        redrawRowVisuals(i, bg, radio, titleText);
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
