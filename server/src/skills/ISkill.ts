/**
 * Skill Interface
 * ===============
 * Every skill implements this.
 *
 * MODIFIER DAMAGE SCALING:
 *   _playerSkillDamageMult and _enemySkillDamageMult are read by
 *   applyDamage() to scale skill damage based on active modifiers.
 */

import type { SkillConfig } from "../config/skills";
import type { SkillEffect } from "../schema/SkillEffect";

export interface SkillActivationResult {
  triggered: boolean;
}

export interface CasterInfo {
  ownerId: string;
  isPlayer: boolean;
  x: number;
  y: number;
  targetDirX: number;
  targetDirY: number;
}

export interface SkillContext {
  spawn: (effect: SkillEffect) => string;
  despawn: (effectId: string) => void;
  forEachPlayer: (cb: (p: any, id: string) => void | boolean) => void;
  forEachEnemy: (cb: (e: any, id: string) => void | boolean) => void;
  getPlayer: (id: string) => any | undefined;
  getEnemy: (id: string) => any | undefined;
  mapWidth: number;
  mapHeight: number;
  pointBlocked: (x: number, y: number) => boolean;

  /** Damage multiplier for PLAYER-cast skills (from mods). */
  _playerSkillDamageMult?: number;
  /** Damage multiplier for ENEMY-cast skills (from mods). */
  _enemySkillDamageMult?: number;
}

export interface ISkill {
  readonly config: SkillConfig;
  activate(caster: CasterInfo, ctx: SkillContext): SkillActivationResult;
  update(
    effectId: string,
    effect: SkillEffect,
    dt: number,
    currentTime: number,
    ctx: SkillContext,
  ): boolean;
}
