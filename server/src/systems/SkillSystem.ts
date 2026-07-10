/**
 * Skill System
 * ============
 * The single orchestrator for ALL skills in the game.
 *
 * RESPONSIBILITIES:
 *   1. Hold the registry of skill instances (claw, boltershot, ...).
 *   2. Enforce per-caster cooldowns (time-based AND kill-based for heal).
 *   3. Spawn / despawn SkillEffect objects in RoomState (memory management).
 *   4. Dispatch update() to the correct skill for each active effect.
 *   5. Build the SkillContext handed to skills (safe access to state).
 *
 * WHY ONE SYSTEM: The room only talks to this system. It never needs to
 * know whether "claw" is a cone, "bolter" is a projectile, or "heal" is
 * instant. Adding a new skill = register it here + add its config + class.
 *
 * COOLDOWN MODEL:
 *   - Time-based: cooldowns map keyed by `${ownerId}:${skillId}` -> ms.
 *   - Kill-based (heal): SkillSystem checks caster.killsSinceLastHeal
 *     against the skill's killsRequired before allowing activation.
 */

import { MapSchema } from "@colyseus/schema";
import { SkillEffect } from "../schema/SkillEffect";
import { RoomState } from "../schema/RoomState";
import { MapSystem } from "./MapSystem";
import { ISkill, SkillContext, CasterInfo } from "../skills/ISkill";
import { ClawSkill } from "../skills/ClawSkill";
import { BolterShotSkill } from "../skills/BolterShotSkill";
import { PulseSkill } from "../skills/PulseSkill";
import { HealSkill } from "../skills/HealSkill";
import { GAME_CONFIG } from "../config/game";

export class SkillSystem {
  private state: RoomState;
  private mapSystem: MapSystem;

  /** skillId -> skill instance */
  private skills: Map<string, ISkill> = new Map();

  /** Per-caster time cooldowns: `${ownerId}:${skillId}` -> readyAt (ms) */
  private cooldowns: Map<string, number> = new Map();

  /** Effect id -> skillId (so update() dispatches to the right skill) */
  private effectOwners: Map<string, string> = new Map();

  constructor(state: RoomState, mapSystem: MapSystem) {
    this.state = state;
    this.mapSystem = mapSystem;

    // Register the four skills
    // NOTE : here setup a invetory system and load only equip cards only
    this.register(new ClawSkill());
    this.register(new BolterShotSkill());
    this.register(new PulseSkill());
    this.register(new HealSkill());
  }

  private register(skill: ISkill) {
    this.skills.set(skill.config.id, skill);
  }

  getSkill(id: string): ISkill | undefined {
    return this.skills.get(id);
  }

  // ============================================================
  // ACTIVATION (called by room / AI when a caster triggers a skill)
  // ============================================================

  /**
   * Attempt to trigger a skill for a caster.
   * Checks cooldown, then calls the skill's activate().
   *
   * @returns true if the skill fired
   */
  activate(skillId: string, caster: CasterInfo, gameTime: number): boolean {
    const skill = this.skills.get(skillId);
    if (!skill) {
      console.warn(`SkillSystem: unknown skill "${skillId}"`);
      return false;
    }

    const cfg = skill.config;

    // ---- Kill-based cooldown (heal) ----
    if (cfg.killsRequired && cfg.killsRequired > 0) {
      const casterPlayer = this.state.players.get(caster.ownerId);
      if (casterPlayer) {
        if (casterPlayer.killsSinceLastHeal < cfg.killsRequired) {
          return false; // not enough kills yet
        }
      }
    } else {
      // ---- Time-based cooldown ----
      const cdKey = `${caster.ownerId}:${skillId}`;
      const readyAt = this.cooldowns.get(cdKey) ?? 0;
      if (gameTime < readyAt) return false;
    }

    // Build context & activate
    // NOTE: understand this
    const ctx = this.buildContext();
    const result = skill.activate(caster, ctx);
    if (!result.triggered) return false;

    // Start cooldown
    if (cfg.killsRequired && cfg.killsRequired > 0) {
      // Kill-based: cooldown is "paid" by the skill itself (heal resets kills)
    } else {
      const cdKey = `${caster.ownerId}:${skillId}`;
      this.cooldowns.set(cdKey, gameTime + cfg.cooldown);
    }

    return true;
  }

  // ============================================================
  // UPDATE (called every tick)
  // ============================================================

  /**
   * Update all active skill effects. Dispatches to each effect's skill.
   * Despawns effects whose update() returns true.
   *
   * @param dt - delta time in SECONDS
   * @param gameTime - current game time in ms
   */
  update(dt: number, gameTime: number): void {
    const ctx = this.buildContext();

    // Collect ids to despawn (can't mutate MapSchema during iteration)
    const toDespawn: string[] = [];

    this.state.skillEffects.forEach((effect, effectId) => {
      const skillId = effect.skillId;
      const skill = this.skills.get(skillId);
      if (!skill) {
        toDespawn.push(effectId);
        return;
      }

      const shouldDespawn = skill.update(effectId, effect, dt, gameTime, ctx);
      if (shouldDespawn) {
        toDespawn.push(effectId);
      }
    });

    for (const id of toDespawn) {
      this.despawn(id);
    }
  }

  // ============================================================
  // SPAWN / DESPAWN (memory management)
  // ============================================================

  private spawn(effect: SkillEffect): string {
    const id = `fx_${this.state.skillEffects.size}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    this.state.skillEffects.set(id, effect);
    this.effectOwners.set(id, effect.skillId);
    return id;
  }

  private despawn(effectId: string): void {
    this.state.skillEffects.delete(effectId);
    this.effectOwners.delete(effectId);
  }

  // ============================================================
  // CONTEXT BUILDER
  // ============================================================

  private buildContext(): SkillContext {
    return {
      spawn: (effect: SkillEffect) => this.spawn(effect),
      despawn: (id: string) => this.despawn(id),

      forEachPlayer: (cb) => {
        this.state.players.forEach((p, id) => {
          cb(p, id);
        });
      },
      forEachEnemy: (cb) => {
        this.state.enemies.forEach((e, id) => {
          cb(e, id);
        });
      },

      getPlayer: (id) => this.state.players.get(id),
      getEnemy: (id) => this.state.enemies.get(id),

      mapWidth: this.mapSystem.mapWidth,
      mapHeight: this.mapSystem.mapHeight,
      pointBlocked: (x, y) =>
        this.mapSystem.checkAllBlockingCollision(
          x,
          y,
          GAME_CONFIG.PLAYER.COLLISION_RADIUS,
        ) !== null,
    };
  }
}
