/**
 * Map Modifier Pool
 * ==================
 * Each modifier is a tradeoff. When a player transitions between maps,
 * they pick 1 of 2 randomly chosen modifiers. The chosen modifier
 * applies to their new map instance.
 *
 * Modifier effects are applied in SpawnSystem (enemy hp/atk/speed),
 * PlayerSystem (player speed), and SkillSystem (skill damage multiplier).
 */

export interface Modifier {
  id: string;
  label: string;
  description: string;
  enemyHpMult?: number;
  enemyAtkMult?: number;
  enemySpeedMult?: number;
  lootDropChanceMult?: number;
  playerSpeedMult?: number;
  playerSkillDamageMult?: number;
}

export const MODIFIER_POOL: Modifier[] = [
  {
    id: "mod_tanky_loot",
    label: "Tanky Enemies, Rich Loot",
    description: "+50% Enemy HP, +2% Loot Drop Chance",
    enemyHpMult: 1.5,
    lootDropChanceMult: 1.02,
  },
  {
    id: "mod_hard_hitters",
    label: "Hard Hitters, Swift Feet",
    description: "+10% Enemy ATK, +Player Movement Speed",
    enemyAtkMult: 1.1,
    playerSpeedMult: 1.15,
  },
  {
    id: "mod_swift_enemies",
    label: "Swift Enemies, Mighty Skills",
    description: "+30% Enemy Speed, +20% Skill Damage",
    enemySpeedMult: 1.3,
    playerSkillDamageMult: 1.2,
  },
];

export function pickRandomMods(count: number): Modifier[] {
  const shuffled = [...MODIFIER_POOL].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}
