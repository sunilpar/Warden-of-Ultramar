/**
 * Shock System
 * ============
 * Chain lightning skill. Finds enemies in a cone, damages them, and
 * chains to nearby enemies with damage falloff.
 * Respects wall collisions — lightning cannot pass through walls.
 */
import { RoomState } from "../schema/RoomState";
import { Player } from "../schema/Player";
import { Enemy } from "../schema/Enemy";
import { ShockCast } from "../schema/ShockCast";
import {
  applyCrit,
  shockDamage,
  shockRange,
  shockTargets,
  shockChains,
  shockChainRadius,
  SHOCK,
} from "../config/skillDefs";

const SEGMENT_TTL_MS = 1200;

interface Seg {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  delay: number;
}

export interface ShockCollisionResolver {
  resolveTileCollision(
    x: number,
    y: number,
    radius: number,
  ): { x: number; y: number };
}

export class ShockSystem {
  private nextId = 1;

  constructor(
    private state: RoomState,
    private mapSystem: ShockCollisionResolver | null = null,
  ) {}

  /**
   * Raymarch along the line and return how far the lightning can travel
   * before hitting a wall. Returns a value from 0..1 where 1 = full distance.
   */
  private raycastCoverage(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
  ): number {
    if (!this.mapSystem) return 1; // no collision system = allow all
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dist = Math.hypot(dx, dy);
    if (dist < 1) return 1;
    const stepSize = 6; // check every 6px for accuracy
    const steps = Math.ceil(dist / stepSize);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const px = x1 + dx * t;
      const py = y1 + dy * t;
      const res = this.mapSystem.resolveTileCollision(px, py, 2);
      if (Math.hypot(res.x - px, res.y - py) > 0.5) {
        // Wall hit — return how far we got
        return (i - 1) / steps;
      }
    }
    return 1; // full distance, no wall
  }

  castPlayerShock(
    player: Player,
    sessionId: string,
    skillLevel: number,
    critRate: number,
    critDamage: number,
    aimAngle: number,
  ): boolean {
    if (skillLevel <= 0) return false;

    const dmg = shockDamage(skillLevel);
    const range = shockRange(skillLevel);
    const maxTargets = shockTargets(skillLevel);
    const maxChains = shockChains(skillLevel);
    const chainRadius = shockChainRadius(skillLevel);
    const halfAngle = SHOCK.coneHalfAngle;

    const inCone = this.findEnemiesInCone(
      player.x,
      player.y,
      aimAngle,
      range,
      halfAngle,
    );
    const targets = inCone.slice(0, maxTargets);

    // If no enemies found, still show VFX traveling to the edge of the cone
    if (targets.length === 0) {
      const edgeX = player.x + Math.cos(aimAngle) * range;
      const edgeY = player.y + Math.sin(aimAngle) * range;
      this.spawnShockVfx(
        player.x,
        player.y,
        skillLevel,
        "player",
        [{ x1: player.x, y1: player.y, x2: edgeX, y2: edgeY, delay: 0 }],
        aimAngle,
      );
      return false;
    }

    const segments: Seg[] = [];
    const hitSet = new Set<Enemy>();
    let delay = 0;

    for (const enemy of targets) {
      const { damage: finalDamage, isCrit } = applyCrit(
        dmg,
        critRate,
        critDamage,
      );
      enemy.takeDamage(finalDamage, "shock", sessionId, isCrit);
      hitSet.add(enemy);
      segments.push({
        x1: player.x,
        y1: player.y,
        x2: enemy.x,
        y2: enemy.y,
        delay,
      });
      delay += 80;
    }

    if (maxChains > 0) {
      let currentSources = targets;
      let chainDamageMul = SHOCK.chainDamageFalloff;
      for (let chain = 0; chain < maxChains; chain++) {
        const nextTargets: Enemy[] = [];
        for (const source of currentSources) {
          const nearby = this.findNearestEnemies(
            source.x,
            source.y,
            chainRadius,
            hitSet,
          );
          if (nearby.length > 0) {
            const ct = nearby[0];
            const chainDmg = dmg * chainDamageMul;
            const { damage: finalDamage, isCrit } = applyCrit(
              chainDmg,
              critRate,
              critDamage,
            );
            ct.takeDamage(finalDamage, "shock", sessionId, isCrit);
            hitSet.add(ct);
            nextTargets.push(ct);
            segments.push({
              x1: source.x,
              y1: source.y,
              x2: ct.x,
              y2: ct.y,
              delay,
            });
            delay += 60;
          }
        }
        currentSources = nextTargets;
        chainDamageMul *= SHOCK.chainDamageFalloff;
        if (currentSources.length === 0) break;
      }
    }

    this.spawnShockVfx(
      player.x,
      player.y,
      skillLevel,
      "player",
      segments,
      aimAngle,
    );
    return true;
  }

  castEnemyShock(
    enemy: Enemy,
    skillLevel: number = 1,
    critRate: number = 0,
    critDamage: number = 1.5,
    aimAngle: number = 0,
  ): boolean {
    const dmg = shockDamage(skillLevel);
    const range = shockRange(skillLevel);
    const maxTargets = shockTargets(skillLevel);
    const halfAngle = SHOCK.coneHalfAngle;

    const inCone = this.findPlayersInCone(
      enemy.x,
      enemy.y,
      aimAngle,
      range,
      halfAngle,
    );
    const targets = inCone.slice(0, maxTargets);
    if (targets.length === 0) return false;

    const segments: Seg[] = [];
    let delay = 0;
    for (const p of targets) {
      const { damage: finalDamage, isCrit } = applyCrit(
        dmg,
        critRate,
        critDamage,
      );
      p.takeDamage(finalDamage, "shock", undefined, isCrit);
      segments.push({ x1: enemy.x, y1: enemy.y, x2: p.x, y2: p.y, delay });
      delay += 80;
    }

    this.spawnShockVfx(
      enemy.x,
      enemy.y,
      skillLevel,
      "enemy",
      segments,
      aimAngle,
    );
    return true;
  }

  private findEnemiesInCone(
    cx: number,
    cy: number,
    aimAngle: number,
    range: number,
    halfAngle: number,
  ): Enemy[] {
    const results: { enemy: Enemy; dist: number }[] = [];
    this.state.enemies.forEach((enemy) => {
      if (enemy.isDead) return;
      const dx = enemy.x - cx;
      const dy = enemy.y - cy;
      const dist = Math.hypot(dx, dy);
      if (dist > range) return;
      const angle = Math.atan2(dy, dx);
      let diff = Math.abs(angle - aimAngle);
      if (diff > Math.PI) diff = 2 * Math.PI - diff;
      if (diff <= halfAngle) {
        // Wall check: must have line of sight to the enemy
        if (this.raycastCoverage(cx, cy, enemy.x, enemy.y) < 1) return;
        results.push({ enemy, dist });
      }
    });
    results.sort((a, b) => a.dist - b.dist);
    return results.map((r) => r.enemy);
  }

  private findPlayersInCone(
    cx: number,
    cy: number,
    aimAngle: number,
    range: number,
    halfAngle: number,
  ): Player[] {
    const results: { player: Player; dist: number }[] = [];
    this.state.players.forEach((p) => {
      if (p.isDead) return;
      const dx = p.x - cx;
      const dy = p.y - cy;
      const dist = Math.hypot(dx, dy);
      if (dist > range) return;
      const angle = Math.atan2(dy, dx);
      let diff = Math.abs(angle - aimAngle);
      if (diff > Math.PI) diff = 2 * Math.PI - diff;
      if (diff <= halfAngle) {
        if (this.raycastCoverage(cx, cy, p.x, p.y) < 1) return;
        results.push({ player: p, dist });
      }
    });
    results.sort((a, b) => a.dist - b.dist);
    return results.map((r) => r.player);
  }

  private findNearestEnemies(
    cx: number,
    cy: number,
    radius: number,
    hitSet: Set<Enemy>,
  ): Enemy[] {
    const results: { enemy: Enemy; dist: number }[] = [];
    this.state.enemies.forEach((enemy) => {
      if (enemy.isDead) return;
      if (hitSet.has(enemy)) return;
      const dist = Math.hypot(enemy.x - cx, enemy.y - cy);
      if (dist <= radius) {
        // Wall check for chains too
        if (this.raycastCoverage(cx, cy, enemy.x, enemy.y) < 1) return;
        results.push({ enemy, dist });
      }
    });
    results.sort((a, b) => a.dist - b.dist);
    return results.map((r) => r.enemy);
  }

  /** Spawn a shock VFX with segments encoded as a flat string. */
  private spawnShockVfx(
    x: number,
    y: number,
    level: number,
    faction: string,
    segments: Seg[],
    aimAngle: number,
  ): void {
    // Clip each segment to the wall hit point so the VFX stops at walls
    const clipped = segments.map((s) => {
      const coverage = this.raycastCoverage(s.x1, s.y1, s.x2, s.y2);
      return {
        x1: s.x1,
        y1: s.y1,
        x2: s.x1 + (s.x2 - s.x1) * coverage,
        y2: s.y1 + (s.y2 - s.y1) * coverage,
        delay: s.delay,
      };
    });
    const segStr = clipped
      .map(
        (s) =>
          `${Math.round(s.x1)},${Math.round(s.y1)},${Math.round(s.x2)},${Math.round(s.y2)},${s.delay}`,
      )
      .join(";");

    const cast = new ShockCast();
    cast.x = x;
    cast.y = y;
    cast.level = level;
    cast.faction = faction;
    cast.aimAngle = aimAngle;
    cast.segments = segStr;

    const id = `shock_${this.nextId++}_${Date.now()}`;
    this.state.shockCasts.set(id, cast);
    setTimeout(() => {
      this.state.shockCasts.delete(id);
    }, SEGMENT_TTL_MS);
  }
}
