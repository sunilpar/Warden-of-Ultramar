/**
 * Map-info button + hover tooltip (top-right of the screen).
 */
import Phaser from "phaser";
import { MAP_INFO } from "../../config/modifiers";
import { describeActiveStat, type ActiveMapStatView } from "../mapStatPicker";

export interface MapInfoRefs {
  button: Phaser.GameObjects.Image;
  tooltip: Phaser.GameObjects.Container;
  getInfoKey: () => string;
  getModifiers: () => Array<{
    id: string;
    title?: string;
    description?: string;
  }>;
  getMapStats: () => ActiveMapStatView[];
}

export function createMapInfoButton(
  scene: Phaser.Scene,
  getInfoKey: () => string,
  getModifiers: () => Array<{
    id: string;
    title?: string;
    description?: string;
  }>,
  getMapStats: () => ActiveMapStatView[],
): MapInfoRefs {
  const W = scene.cameras.main.width;
  const ICON_SIZE = 40;
  const MARGIN = 50;
  const button = scene.add
    .image(W - ICON_SIZE / 2 - MARGIN, ICON_SIZE / 2 + 5, "map_info_icon")
    .setDisplaySize(ICON_SIZE, ICON_SIZE)
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(150)
    .setInteractive({ useHandCursor: true });
  const tooltip = scene.add
    .container(0, 0)
    .setDepth(300)
    .setVisible(false)
    .setScrollFactor(0);
  const refs: MapInfoRefs = {
    button,
    tooltip,
    getInfoKey,
    getModifiers,
    getMapStats,
  };
  buildTooltipContent(scene, refs);
  button.on("pointerover", () => tooltip.setVisible(true));
  button.on("pointerout", () => tooltip.setVisible(false));
  return refs;
}

export function rebuildMapInfoTooltip(
  scene: Phaser.Scene,
  refs: MapInfoRefs,
): void {
  if (refs.tooltip) {
    const wasVisible = refs.tooltip.visible;
    refs.tooltip.destroy();
    const fresh = scene.add
      .container(0, 0)
      .setDepth(300)
      .setVisible(wasVisible)
      .setScrollFactor(0);
    refs.tooltip = fresh;
    // Remove stale hover listeners first: this rebuild now runs on
    // every activeMapStats add/remove, and re-binding without
    // removing would stack duplicate listeners on the button.
    refs.button.off("pointerover");
    refs.button.off("pointerout");
    refs.button.on("pointerover", () => refs.tooltip.setVisible(true));
    refs.button.on("pointerout", () => refs.tooltip.setVisible(false));
  }
  buildTooltipContent(scene, refs);
}

function buildTooltipContent(scene: Phaser.Scene, refs: MapInfoRefs): void {
  const tooltipW = 320;
  const padding = 12;
  let tooltipY = padding;
  const infoKey = refs.getInfoKey();
  const mapInfo = MAP_INFO[infoKey] ?? { name: infoKey, description: "" };
  const nameText = scene.add
    .text(padding, tooltipY, mapInfo.name, {
      color: "#ffd700",
      fontSize: "16px",
      fontFamily: "monospace",
      fontStyle: "bold",
      stroke: "#000000",
      strokeThickness: 3,
    })
    .setOrigin(0, 0)
    .setScrollFactor(0);
  refs.tooltip.add(nameText);
  tooltipY += nameText.height + 6;
  if (mapInfo.description) {
    const descText = scene.add
      .text(padding, tooltipY, mapInfo.description, {
        color: "#cccccc",
        fontSize: "12px",
        fontFamily: "monospace",
        wordWrap: { width: tooltipW - padding * 2 },
        stroke: "#000000",
        strokeThickness: 2,
      })
      .setOrigin(0, 0)
      .setScrollFactor(0);
    refs.tooltip.add(descText);
    tooltipY += descText.height + 8;
  }
  const modHeader = scene.add
    .text(padding, tooltipY, "Active Modifiers", {
      color: "#ffffff",
      fontSize: "12px",
      fontFamily: "monospace",
      fontStyle: "bold",
      stroke: "#000000",
      strokeThickness: 2,
    })
    .setOrigin(0, 0)
    .setScrollFactor(0);
  refs.tooltip.add(modHeader);
  tooltipY += modHeader.height + 4;
  const modifiers = refs.getModifiers();
  if (modifiers.length === 0) {
    const noneText = scene.add
      .text(padding, tooltipY, "None", {
        color: "#888888",
        fontSize: "11px",
        fontFamily: "monospace",
        stroke: "#000000",
        strokeThickness: 2,
      })
      .setOrigin(0, 0)
      .setScrollFactor(0);
    refs.tooltip.add(noneText);
    tooltipY += noneText.height + 4;
  } else {
    for (const m of modifiers) {
      const t = scene.add
        .text(
          padding,
          tooltipY,
          "\u25cf " +
            (m.title ?? m.id) +
            (m.description ? " - " + m.description : ""),
          {
            color: "#88ff88",
            fontSize: "11px",
            fontFamily: "monospace",
            wordWrap: { width: tooltipW - padding * 2 },
            stroke: "#000000",
            strokeThickness: 2,
          },
        )
        .setOrigin(0, 0)
        .setScrollFactor(0);
      refs.tooltip.add(t);
      tooltipY += t.height + 2;
    }
  }
  // ---- Active map mods (picked at map exits) ----
  const stats = refs.getMapStats();
  if (stats.length > 0) {
    tooltipY += 6;
    const statsHeader = scene.add
      .text(padding, tooltipY, "Active Map Mods", {
        color: "#ffd700",
        fontSize: "12px",
        fontFamily: "monospace",
        fontStyle: "bold",
        stroke: "#000000",
        strokeThickness: 2,
      })
      .setOrigin(0, 0)
      .setScrollFactor(0);
    refs.tooltip.add(statsHeader);
    tooltipY += statsHeader.height + 4;
    for (const s of stats) {
      const { title, desc } = describeActiveStat(s);
      const titleText = scene.add
        .text(padding, tooltipY, `● ${title}`, {
          color: "#88ff88",
          fontSize: "11px",
          fontFamily: "monospace",
          fontStyle: "bold",
          stroke: "#000000",
          strokeThickness: 2,
        })
        .setOrigin(0, 0)
        .setScrollFactor(0);
      refs.tooltip.add(titleText);
      tooltipY += titleText.height;
      const descText = scene.add
        .text(padding + 12, tooltipY, `${desc}`, {
          color: "#a8d8a8",
          fontSize: "11px",
          fontFamily: "monospace",
          wordWrap: { width: tooltipW - padding * 2 - 12 },
          stroke: "#000000",
          strokeThickness: 2,
        })
        .setOrigin(0, 0)
        .setScrollFactor(0);
      refs.tooltip.add(descText);
      tooltipY += descText.height + 4;
    }
  }
  const tooltipH = tooltipY + padding;
  const bg = scene.add.graphics().setScrollFactor(0).setDepth(-1);
  bg.fillStyle(0x0a0a14, 0.92);
  bg.fillRoundedRect(0, 0, tooltipW, tooltipH, 8);
  bg.lineStyle(2, 0x4a6a8a, 0.8);
  bg.strokeRoundedRect(0, 0, tooltipW, tooltipH, 8);
  refs.tooltip.add(bg);
  refs.tooltip.sendToBack(bg);
  const tx = refs.button.x - 40 / 2 - tooltipW - 4;
  const ty = refs.button.y - 40 / 2;
  refs.tooltip.setPosition(tx, ty);
}
