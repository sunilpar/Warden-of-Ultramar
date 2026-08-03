/**
 * Skill System (Per-Player Aware)
 * ===============================
 * Builds per-caster SkillContext that filters entities by map ownership:
 *   - Player-cast skill only hits enemies whose ownerId matches.
 *   - Enemy-cast skill only hits the player whose sessionId matches the enemy's ownerId.
 * Applies playerSkillDamageMult and enemyAtkMult from mods.
 */

import { SkillEffect } from "../schema/SkillEffect";
import { RoomState } from "../schema/RoomState";
import { MapSystem } from "./MapSystem";
import { ISkill, SkillContext, CasterInfo } from "../skills/ISkill";
import { ClawSkill } from "../skills/ClawSkill";
import { BolterShotSkill } from "../skills/BolterShotSkill";
import { PulseSkill } from "../skills/PulseSkill";
import { HealSkill } from "../skills/HealSkill";
import { VortexSkill } from "../skills/VortexSkill";
import { BlinkSkill } from "../skills/BlinkSkill";
import { GAME_CONFIG } from "../config/game";
import { MODIFIER_POOL } from "../config/modifiers";

const ALL_MODS_BY_ID: Record<string, typeof MODIFIER_POOL[number]> = {};
for (const m of MODIFIER_POOL) ALL_MODS_BY_ID[m.id] = m;

export class SkillSystem {
  private state: RoomState;
  private mapSystem: MapSystem;
  private skills: Map<string, ISkill> = new Map();
  private cooldowns: Map<string, number> = new Map();
  private effectOwners: Map<string, string> = new Map();
  private effectIdCounter: number = 0;

  constructor(state: RoomState, mapSystem: MapSystem) {
    this.state = state;
    this.mapSystem = mapSystem;
    this.register(new ClawSkill());
    this.register(new BolterShotSkill());
    this.register(new PulseSkill());
    this.register(new HealSkill());
    this.register(new VortexSkill());
    this.register(new BlinkSkill());
  }

  private register(skill: ISkill) {
    this.skills.set(skill.config.id, skill);
  }

  getSkill(id: string): ISkill | undefined {
    return this.skills.get(id);
  }

  activate(skillId: string, caster: CasterInfo, gameTime: number): boolean {
    const skill = this.skills.get(skillId);
    if (!skill) return false;

    const cfg = skill.config;
    const mapOwner = this.resolveMapOwner(caster);

    // Cooldown check
    if (cfg.killsRequired && cfg.killsRequired > 0) {
      const casterPlayer = this.state.players.get(caster.ownerId);
      if (casterPlayer) {
        if (casterPlayer.killsSinceLastHeal < cfg.killsRequired) return false;
      }
    } else {
      const cdKey = caster.ownerId + ":" + skillId;
      const readyAt = this.cooldowns.get(cdKey) ?? 0;
      if (gameTime < readyAt) return false;
    }

    const ctx = this.buildContext(mapOwner, caster);
    const result = skill.activate(caster, ctx);
    if (!result.triggered) return false;

    // Start cooldown
    if (!(cfg.killsRequired && cfg.killsRequired > 0)) {
      const cdKey = caster.ownerId + ":" + skillId;
      this.cooldowns.set(cdKey, gameTime + cfg.cooldown);
    }

    return true;
  }

  private resolveMapOwner(caster: CasterInfo): string {
    if (caster.isPlayer) return caster.ownerId;
    const enemy = this.state.enemies.get(caster.ownerId);
    return enemy ? enemy.ownerId : caster.ownerId;
  }

  update(dt: number, gameTime: number): void {
    const toDespawn: string[] = [];

    this.state.skillEffects.forEach((effect, effectId) => {
      const skill = this.skills.get(effect.skillId);
      if (!skill) {
        toDespawn.push(effectId);
        return;
      }

      const mapOwner = this.resolveEffectMapOwner(effect);
      const ctx = this.buildContext(mapOwner, {
        ownerId: effect.ownerId,
        isPlayer: effect.isPlayer,
        x: effect.x,
        y: effect.y,
        targetDirX: effect.directionX,
        targetDirY: effect.directionY,
      });

      const shouldDespawn = skill.update(effectId, effect, dt, gameTime, ctx);
      if (shouldDespawn) toDespawn.push(effectId);
    });

    for (const id of toDespawn) this.despawn(id);
  }

  private resolveEffectMapOwner(effect: SkillEffect): string {
    if (effect.isPlayer) return effect.ownerId;
    const enemy = this.state.enemies.get(effect.ownerId);
    return enemy ? enemy.ownerId : effect.ownerId;
  }

  private spawn(effect: SkillEffect): string {
    const id = "fx_" + this.effectIdCounter++;
    this.state.skillEffects.set(id, effect);
    this.effectOwners.set(id, effect.skillId);
    return id;
  }

  private despawn(effectId: string): void {
    this.state.skillEffects.delete(effectId);
    this.effectOwners.delete(effectId);
  }

  /** Global context for StatusSystem (not per-player scoped). */
  getContext(): SkillContext {
    const firstId = this.mapSystem.getPlayerIds()[0];
    const mw = firstId ? this.mapSystem.getMapWidth(firstId) : GAME_CONFIG.MAP_WIDTH;
    const mh = firstId ? this.mapSystem.getMapHeight(firstId) : GAME_CONFIG.MAP_HEIGHT;
    return {
      spawn: (effect: SkillEffect) => this.spawn(effect),
      despawn: (id: string) => this.despawn(id),
      forEachPlayer: (cb) => { this.state.players.forEach((p, id) => cb(p, id)); },
      forEachEnemy: (cb) => { this.state.enemies.forEach((e, id) => cb(e, id)); },
      getPlayer: (id) => this.state.players.get(id),
      getEnemy: (id) => this.state.enemies.get(id),
      mapWidth: mw,
      mapHeight: mh,
      pointBlocked: (x, y) => {
        if (!firstId) return false;
        return this.mapSystem.checkAllBlockingCollision(firstId, x, y, GAME_CONFIG.PLAYER.COLLISION_RADIUS) !== null;
      },
    };
  }

  /** Per-caster context scoped to a specific player's map instance. */
  private buildContext(mapOwner: string, caster: CasterInfo): SkillContext {
    const mapWidth = this.mapSystem.getMapWidth(mapOwner);
    const mapHeight = this.mapSystem.getMapHeight(mapOwner);

    let skillDmgMult = 1;
    let enemySkillDmgMult = 1;
    if (caster.isPlayer) {
      const p = this.state.players.get(caster.ownerId);
      if (p) {
        for (const md of p.activeMods) {
          const mod = ALL_MODS_BY_ID[md.id];
          if (mod && mod.playerSkillDamageMult) skillDmgMult *= mod.playerSkillDamageMult;
        }
      }
    } else {
      const enemy = this.state.enemies.get(caster.ownerId);
      if (enemy && enemy.atkMult) enemySkillDmgMult = enemy.atkMult;
    }

    const ctx: SkillContext = {
      spawn: (effect: SkillEffect) => this.spawn(effect),
      despawn: (id: string) => this.despawn(id),
      forEachPlayer: (cb) => {
        const p = this.state.players.get(mapOwner);
        if (p && !p.isDead) cb(p, mapOwner);
      },
      forEachEnemy: (cb) => {
        this.state.enemies.forEach((e, id) => {
          if (!e.isDead && e.ownerId === mapOwner) cb(e, id);
        });
      },
      getPlayer: (id) => this.state.players.get(id),
      getEnemy: (id) => this.state.enemies.get(id),
      mapWidth,
      mapHeight,
      pointBlocked: (x, y) =>
        this.mapSystem.checkAllBlockingCollision(mapOwner, x, y, GAME_CONFIG.PLAYER.COLLISION_RADIUS) !== null,
    };

    if (skillDmgMult !== 1) ctx._playerSkillDamageMult = skillDmgMult;
    if (enemySkillDmgMult !== 1) ctx._enemySkillDamageMult = enemySkillDmgMult;

    return ctx;
  }
}
