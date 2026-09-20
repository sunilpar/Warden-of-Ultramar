/**
 * Card Tooltip (hover panel used by ground drops, HUD slots, inventory, char screen)
 * ===================================================================================
 *
 * One styled panel reused across every surface that needs to describe a card.
 * Always pass the same shape (skill + level + rarity + modIds + modValues)
 * regardless of where the card came from.
 */
import Phaser from "phaser";
import {
  asRarity,
  rarityBaseFrame,
  cardFrameForLevel,
  CARD_ART_INSET_RATIO,
  SKILL_CARDS,
  RARITY_COLORS,
  RARITY_NAMES,
  type Rarity,
  type SkillId,
} from "../config/skillDefs";
import {
  formatModLine,
  getCardModDisplay,
  type CardModDisplay,
} from "../config/cardMods";

export interface CardTooltipInfo {
  skill: SkillId;
  level: number;
  rarity: Rarity;
  modIds: string[];
  modValues: number[];
  /** Optional: override per-mod display entries (e.g. from server metadata). */
  modDisplays?: Record<string, CardModDisplay>;
}

export function buildCardTooltipPanel(
  scene: Phaser.Scene,
  info: CardTooltipInfo,
): Phaser.GameObjects.Container {
  const { skill, level, rarity } = info;
  const def = SKILL_CARDS[skill];
  const title = def ? def.title : skill;
  const description = def ? def.description : "";
  const W = 220;
  const safeRarity = asRarity(rarity);
  const rarityColor = RARITY_COLORS[safeRarity] ?? RARITY_COLORS.common;
  const rarityHex = "#" + rarityColor.toString(16).padStart(6, "0");
  const modLines = info.modIds.map((m, idx) => {
    const disp = info.modDisplays?.[m] ?? getCardModDisplay(m);
    return "* " + formatModLine(disp, info.modValues[idx]);
  });
  const H = 116 + Math.min(4, modLines.length) * 14;
  const bg = scene.add
    .rectangle(0, 0, W, H, 0x000000, 0.88)
    .setStrokeStyle(2, rarityColor, 0.95);
  const nameText = scene.add
    .text(-W / 2 + 10, -H / 2 + 10, title + "  L" + level, {
      color: rarityHex,
      fontSize: "14px",
      fontFamily: "monospace",
      fontStyle: "bold",
      stroke: "#000000",
      strokeThickness: 2,
    })
    .setOrigin(0, 0);
  const rarityText = scene.add
    .text(-W / 2 + 10, -H / 2 + 26, RARITY_NAMES[safeRarity] ?? "Common", {
      color: rarityHex,
      fontSize: "10px",
      fontFamily: "monospace",
      fontStyle: "bold",
      stroke: "#000000",
      strokeThickness: 2,
    })
    .setOrigin(0, 0);
  const descText = scene.add
    .text(-W / 2 + 10, -H / 2 + 42, description, {
      color: "#dddddd",
      fontSize: "11px",
      fontFamily: "monospace",
      wordWrap: { width: W - 74 },
      align: "left",
    })
    .setOrigin(0, 0);
  const modsText = scene.add
    .text(-W / 2 + 10, -H / 2 + 58, modLines.join("\n"), {
      color: "#88ff88",
      fontSize: "11px",
      fontFamily: "monospace",
      wordWrap: { width: W - 74 },
      align: "left",
    })
    .setOrigin(0, 0);
  const sprBase = scene.add
    .image(W / 2 - 32, 0, "card_sheet", rarityBaseFrame(safeRarity))
    .setDisplaySize(48, 64);
  const ttInset = 48 * CARD_ART_INSET_RATIO;
  const sprArt = scene.add
    .image(W / 2 - 32, 0, "card_sheet", cardFrameForLevel(skill, level))
    .setDisplaySize(48 - ttInset * 2, 64 - ttInset * 2)
    .setAlpha(1);
  return scene.add.container(0, 0, [
    bg,
    nameText,
    rarityText,
    descText,
    modsText,
    sprBase,
    sprArt,
  ]);
}
