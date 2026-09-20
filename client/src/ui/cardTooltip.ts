/**
 * Card Tooltip (hover panel used by ground drops, HUD slots, inventory, char screen)
 * ===================================================================================
 *
 * One styled panel reused across every surface that needs to describe a card.
 * Always pass the same shape (skill + level + rarity + modIds + modValues)
 * regardless of where the card came from.
 *
 * LAYOUT (width fixed, height grows with mod count):
 *
 *   +----------------------------------+--------+
 *   | TITLE                L1          |        |
 *   | +3% Crit Rate                    |  CARD  |
 *   | +5% Damage                       |  ART   |
 *   | +60 Shield                       |        |
 *   ...                                |        |
 *   +----------------------------------+--------+
 *              LEFT (70%)              RIGHT (30%)
 *
 *   No description row. No rarity row (color is communicated via the border).
 *
 * TWEAK constants at the top of buildCardTooltipPanel to resize.
 */
import Phaser from "phaser";
import {
  asRarity,
  rarityBaseFrame,
  cardFrameForLevel,
  CARD_ART_INSET_RATIO,
  SKILL_CARDS,
  RARITY_COLORS,
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

/**
 * 70 / 30 split. Tweak TOTAL_W / LEFT_RATIO here to resize the whole panel.
 * Width is FIXED, height grows with the mod count.
 */
const TOTAL_W = 240;
const LEFT_RATIO = 0.70;     // 70% for the text column
const PADDING_X = 10;        // left/right inset inside the panel
const PADDING_Y = 10;        // top/bottom inset inside the panel
const LINE_GAP = 14;         // vertical px between mod rows
const TITLE_GAP = 6;         // gap between title row and first mod row
const COL_GAP = 8;           // gap between left text column and right art column

export function buildCardTooltipPanel(
  scene: Phaser.Scene,
  info: CardTooltipInfo,
): Phaser.GameObjects.Container {
  const { skill, level, rarity } = info;
  const def = SKILL_CARDS[skill];
  const title = def ? def.title : skill;

  // ---- 70 / 30 width split -----------------------------------------
  const leftW = Math.floor(TOTAL_W * LEFT_RATIO);     // 168
  const rightW = TOTAL_W - leftW - COL_GAP;            // 64
  const innerTextW = leftW - PADDING_X * 2;           // 148 px wrap budget

  // ---- Build the mod lines (one per rolled mod) ----------------------
  const modLines = info.modIds.map((m, idx) => {
    const disp = info.modDisplays?.[m] ?? getCardModDisplay(m);
    return formatModLine(disp, info.modValues[idx]);
  });

  // ---- Dynamic height: title + mods + padding -----------------------
  const contentH =
    PADDING_Y +                 // top padding
    14 +                        // title row
    TITLE_GAP +                  // gap
    modLines.length * LINE_GAP + // mod rows
    PADDING_Y;                  // bottom padding
  const H = Math.max(60, contentH);
  const safeRarity = asRarity(rarity);
  const rarityColor = RARITY_COLORS[safeRarity] ?? RARITY_COLORS.common;
  const rarityHex = "#" + rarityColor.toString(16).padStart(6, "0");

  // ---- Background (one rectangle per panel) -------------------------
  const bg = scene.add
    .rectangle(0, 0, TOTAL_W, H, 0x000000, 0.88)
    .setStrokeStyle(2, rarityColor, 0.95);

  // ---- Left column: title row + mod rows ----------------------------
  const leftX = -TOTAL_W / 2 + PADDING_X;
  const topY = -H / 2 + PADDING_Y;

  // Row 1: TITLE ......... L<level>  (single line)
  const titleText = scene.add
    .text(leftX, topY, title + "  L" + level, {
      color: rarityHex,
      fontSize: "13px",
      fontFamily: "monospace",
      fontStyle: "bold",
      stroke: "#000000",
      strokeThickness: 2,
    })
    .setOrigin(0, 0);

  // Row 2+: one row per mod, prefixed with "* " to keep the visual rhythm
  // the user is used to. Color shifts per mod kind via formatModLine's
  // conventions (caller already chooses per-mod color when needed).
  const modTexts: Phaser.GameObjects.Text[] = [];
  for (let i = 0; i < modLines.length; i++) {
    const t = scene.add
      .text(leftX, topY + 14 + TITLE_GAP + i * LINE_GAP, "* " + modLines[i], {
        color: i === 0 ? "#88ff88" : "#aaffaa",
        fontSize: "11px",
        fontFamily: "monospace",
        wordWrap: { width: innerTextW },
      })
      .setOrigin(0, 0);
    modTexts.push(t);
  }

  // ---- Right column: card art (rarity base + skill art over it) -----
  const rightCenterX = -TOTAL_W / 2 + leftW + COL_GAP + rightW / 2;
  const artW = Math.min(rightW - 4, 48);
  const artH = artW * (4 / 3); // 3:4 portrait ratio (card_sheet)
  const sprBase = scene.add
    .image(rightCenterX, 0, "card_sheet", rarityBaseFrame(safeRarity))
    .setDisplaySize(artW, artH);
  const ttInset = artW * CARD_ART_INSET_RATIO;
  const sprArt = scene.add
    .image(rightCenterX, 0, "card_sheet", cardFrameForLevel(skill, level))
    .setDisplaySize(artW - ttInset * 2, artH - ttInset * 2)
    .setAlpha(1);

  return scene.add.container(0, 0, [
    bg,
    titleText,
    ...modTexts,
    sprBase,
    sprArt,
  ]);
}
