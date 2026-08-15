/**
 * Game Room
 * =========
 * The authoritative server room. Handles:
 *   - Player join/leave
 *   - Movement input (message type 0)
 *   - Skill cast (message type 1)
 *   - Skill upgrade (message type 2)
 *   - Fixed timestep simulation (60 ticks/sec)
 *   - Enemy AI + projectile simulation
 *
 * MESSAGE TYPES:
 *   0: Movement input { left, right, up, down, tick }
 *   1: Cast skill     { skill: SkillId, angle: number }
 *   2: Upgrade skill  { skill: SkillId }
 *   3: Viewport rect   { x, y, w, h } (camera world view)
 */

import { Room, Client } from "colyseus";
import { RoomState } from "../schema/RoomState";
import { Player, InputData } from "../schema/Player";
import { GAME_CONFIG } from "../config/game";
import { MapSystem2 } from "../systems/MapSystem2";
import { PlayerSystem } from "../systems/PlayerSystem";
import { EnemySystem } from "../systems/EnemySystem";
import type { Enemy } from "../schema/Enemy";
import { ProjectileSystem } from "../systems/ProjectileSystem";
import { ClawSystem } from "../systems/ClawSystem";
import { SlamSystem } from "../systems/SlamSystem";
import { HealSystem } from "../systems/HealSystem";
import { PulseSystem } from "../systems/PulseSystem";
import { ShockSystem } from "../systems/ShockSystem";
import { DashSystem } from "../systems/DashSystem";
import { VortexSystem } from "../systems/VortexSystem";
import { LAYERED_MAP_2 } from "../config/layeredMap2";
import {
  SKILL_DEFS,
  MAX_SKILL_LEVEL,
  skillCritRate,
  pulseCooldown,
  dashCooldown,
  type SkillId,
} from "../config/skillDefs";
import {
  MAP_MODIFIERS,
  MAP_INFO,
  applyPlayerModifiers,
  applyEnemyModifiers,
  type ModifierId,
} from "../config/modifiers";

export class GameRoom2 extends Room {
  state = new RoomState();
  fixedTimeStep = GAME_CONFIG.FIXED_TIME_STEP_MS;

  private mapSystem!: MapSystem2;
  private playerSystem!: PlayerSystem;
  private enemySystem!: EnemySystem;
  private projectileSystem!: ProjectileSystem;
  private clawSystem!: ClawSystem;
  private slamSystem!: SlamSystem;
  private healSystem!: HealSystem;
  private pulseSystem!: PulseSystem;
  private shockSystem!: ShockSystem;
  private dashSystem!: DashSystem;
  private vortexSystem!: VortexSystem;
  private spawnedZones = new Set<number>();
  private activeModifiers: ModifierId[] = MAP_MODIFIERS["game_room_2"] ?? [];
  private viewports = new Map<
    string,
    { x: number; y: number; w: number; h: number }
  >();

  onCreate(_options: any) {
    this.mapSystem = new MapSystem2();
    this.playerSystem = new PlayerSystem(this.state, this.mapSystem as any);
    this.enemySystem = new EnemySystem(this.state, this.mapSystem);
    this.projectileSystem = new ProjectileSystem(
      this.state,
      this.mapSystem as any,
    );
    this.clawSystem = new ClawSystem(this.state);
    this.slamSystem = new SlamSystem(this.state, this.mapSystem);
    this.healSystem = new HealSystem(this.state);
    this.pulseSystem = new PulseSystem(this.state);
    this.shockSystem = new ShockSystem(this.state, this.mapSystem);
    this.dashSystem = new DashSystem(this.state);
    this.vortexSystem = new VortexSystem(this.state, this.mapSystem);
    // Cross-link: enemies can fire projectiles + claws.
    this.enemySystem.setProjectileSystem(this.projectileSystem);
    this.enemySystem.setClawSystem(this.clawSystem);
    this.enemySystem.setSlamSystem(this.slamSystem);
    this.enemySystem.setHealSystem(this.healSystem);
    this.enemySystem.setShockSystem(this.shockSystem);
    this.enemySystem.setDashSystem(this.dashSystem);
    this.enemySystem.setVortexSystem(this.vortexSystem);
    this.enemySystem.setPulseSystem(this.pulseSystem);

    // Fixed timestep simulation loop
    let elapsedTime = 0;
    this.setSimulationInterval((deltaTime) => {
      elapsedTime += deltaTime;
      while (elapsedTime >= this.fixedTimeStep) {
        elapsedTime -= this.fixedTimeStep;
        this.fixedTick(this.fixedTimeStep);
      }
    });

    // ---- Map metadata for client display ----
    this.setMetadata({
      mapName: MAP_INFO["game_room_2"]?.name ?? "Unknown",
      mapDescription: MAP_INFO["game_room_2"]?.description ?? "",
      modifiers: this.activeModifiers.map((id) => {
        const defs: Record<
          string,
          { id: string; title: string; description: string }
        > = {
          swift_movement: {
            id,
            title: "Swift Movement",
            description: "All entities move 30% faster.",
          },
          veteran_enemies: {
            id,
            title: "Veteran Enemies",
            description: "Enemies have +50% HP and +25% ATK.",
          },
          rich_loot: {
            id,
            title: "Rich Loot",
            description: "Double XP, improved loot rarity.",
          },
          glass_cannon: {
            id,
            title: "Glass Cannon",
            description: "2x damage, 50% less health.",
          },
          regeneration: {
            id,
            title: "Regeneration",
            description: "Regenerate 5 HP/sec.",
          },
        };
        return defs[id] ?? { id, title: id, description: "" };
      }),
    });
    console.log(
      "GameRoom2 created with Map2",
      `${LAYERED_MAP_2.cols}x${LAYERED_MAP_2.rows} tiles`,
    );
  }

  //core cycle
  fixedTick(timeStepMs: number) {
    const dt = timeStepMs / 1000;
    this.playerSystem.update(dt);
    this.enemySystem.update(dt);
    this.projectileSystem.update(dt);
    this.clawSystem.update(dt);
    this.slamSystem.update(dt);
    this.vortexSystem.update(dt);
    // Tick player skill cooldowns + bleed DoT
    this.state.players.forEach((p) => {
      p.tickShield(dt);
      p.tickSkillCooldowns(dt);
      p.tickHealCooldown(dt);
      if (p.tickBleed(dt)) {
        // Player died from bleed
        p.die();
      }
      // Check if player died from any damage source
      if (p.isDead && p.currentHealth === 0) {
        p.die();
      }
    });
    // Clean up dead enemies
    this.cleanupDeadEnemies();
    // Viewport-activated spawning
    this.checkSpawnZones();
  }

  /**
   * Returns the highest level among all currently connected players.
   * Falls back to GAME_CONFIG.ENEMY.DEFAULT_LEVEL (1) if no players.
   * Used to scale enemy stats on spawn.
   */
  private getHighestPlayerLevel(): number {
    let maxLevel = GAME_CONFIG.ENEMY.DEFAULT_LEVEL;
    this.state.players.forEach((p) => {
      if (p.level > maxLevel) maxLevel = p.level;
    });
    return maxLevel;
  }

  /**
   * Total enemies this map should host: 20 base + 1 per 2 player levels
   * (highest player level in the room).
   */
  private getTargetEnemyCount(): number {
    return 20 + Math.floor(this.getHighestPlayerLevel() / 2);
  }

  /**
   * Pick an enemy type by spawn ratio: 40% tyranid / 30% mechanicus /
   * 20% tau / 10% orck.
   */
  private pickEnemyType(): "tyranid" | "orck" | "tau" | "mechanicus" {
    const r = Math.random();
    if (r < 0.4) return "tyranid";
    if (r < 0.7) return "mechanicus";
    if (r < 0.9) return "tau";
    return "orck";
  }

  /**
   * Spawn one enemy at the center of each spawn zone the FIRST time any
   * player's viewport touches it. Each zone spawns exactly once.
   */
  private checkSpawnZones(): void {
    const zones = LAYERED_MAP_2.enemySpawnZones;
    if (zones.length === 0 || this.viewports.size === 0) return;
    const enemyLevel = this.getHighestPlayerLevel();
    for (let i = 0; i < zones.length; i++) {
      if (this.spawnedZones.has(i)) continue;
      const z = zones[i];
      let touched = false;
      for (const vp of this.viewports.values()) {
        if (
          vp.x < z.x + z.width &&
          vp.x + vp.w > z.x &&
          vp.y < z.y + z.height &&
          vp.y + vp.h > z.y
        ) {
          touched = true;
          break;
        }
      }
      if (touched) {
        // Spawn until the map's target enemy count is reached.
        const target = this.getTargetEnemyCount();
        const alive = this.state.enemies.size;
        if (alive >= target) {
          this.spawnedZones.add(i);
          continue;
        }
        const spawnId = this.enemySystem.spawn(
          this.pickEnemyType(),
          z.x + z.width / 2,
          z.y + z.height / 2,
          enemyLevel,
        );
        const spawnedEnemy = this.state.enemies.get(spawnId);
        if (spawnedEnemy)
          applyEnemyModifiers(spawnedEnemy, this.activeModifiers);
        this.spawnedZones.add(i);
      }
    }
  }

  /**
   * Award XP: killer gets 100%, other damagers get 50%.
   */
  private awardKillXp(enemy: Enemy): void {
    const trackers = enemy.damageTrackers;
    if (trackers.size === 0) {
      let alive = 0;
      this.state.players.forEach((p) => {
        if (!p.isDead) alive++;
      });
      if (alive > 0) {
        const share = Math.floor(enemy.xpReward / alive);
        this.state.players.forEach((p) => {
          if (!p.isDead) p.addXp(share);
        });
      }
      return;
    }
    let killerId: string | null = null;
    let maxDmg = 0;
    for (const [pid, dmg] of trackers) {
      if (dmg > maxDmg) {
        maxDmg = dmg;
        killerId = pid;
      }
    }
    if (killerId) {
      const killer = this.state.players.get(killerId);
      if (killer && !killer.isDead) {
        killer.addXp(enemy.xpReward);
        killer.addHealKill();
      }
    }
    const halfXp = Math.floor(enemy.xpReward * 0.5);
    for (const pid of trackers.keys()) {
      if (pid === killerId) continue;
      const teammate = this.state.players.get(pid);
      if (teammate && !teammate.isDead) teammate.addXp(halfXp);
    }
  }

  /** Remove dead enemies from state. */
  private cleanupDeadEnemies(): void {
    const dead: string[] = [];
    this.state.enemies.forEach((enemy, id) => {
      if (enemy.isDead) dead.push(id);
    });
    for (const id of dead) {
      const enemy = this.state.enemies.get(id);
      if (enemy) {
        this.awardKillXp(enemy);
      }
      // Despawn any slams/projectiles owned by this enemy.
      if (this.enemySystem) this.enemySystem.cleanupOnEnemyDeath(id);
      this.state.enemies.delete(id);
    }
  }

  // ============================================================
  // MESSAGE HANDLERS
  // ============================================================
  messages = {
    // Movement input
    0: (client: Client, input: InputData) => {
      const player = this.state.players.get(client.sessionId);
      if (player) player.inputQueue.push(input);
    },

    // Cast a skill (player -> server). { skill, angle }
    1: (client: Client, msg: { skill: SkillId; angle: number }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.isDead) return;
      const skill = msg.skill;
      const level = player.getSkillLevel(skill);
      if (level <= 0) return; // skill not owned
      if (!player.isSkillReady(skill)) return; // on cooldown

      if (skill === "heal") {
        this.healSystem.castPlayerHeal(player, client.sessionId);
        return;
      }

      if (skill === "bolter") {
        const fired = this.projectileSystem.castBolter(
          client.sessionId,
          "player",
          player.x,
          player.y,
          msg.angle,
          player.attack,
          level,
          player.damageMultiplier,
          skillCritRate("bolter", level, player.critRate),
          player.critDamage,
        );
        if (fired) {
          player.startSkillCooldown(skill, SKILL_DEFS.bolter.cooldown);
        }
      } else if (skill === "claw") {
        this.clawSystem.castClaw(
          client.sessionId,
          "player",
          player.x,
          player.y,
          msg.angle,
          player.attack,
          level,
          player.damageMultiplier,
          10,
          skillCritRate("claw", level, player.critRate),
          player.critDamage,
        );
        player.startSkillCooldown(skill, SKILL_DEFS.claw.cooldown);
      } else if (skill === "slam") {
        this.slamSystem.castSlam(
          client.sessionId,
          "player",
          player.x,
          player.y,
          msg.angle,
          level,
          player.attack,
          player.damageMultiplier,
          skillCritRate("slam", level, player.critRate),
          player.critDamage,
        );
        player.startSkillCooldown(skill, SKILL_DEFS.slam.cooldown);
      } else if (skill === "pulse") {
        this.pulseSystem.castPlayerPulse(
          player,
          client.sessionId,
          level,
          skillCritRate("pulse", level, player.critRate),
          player.critDamage,
        );
        player.startSkillCooldown(skill, pulseCooldown(level));
      } else if (skill === "shock") {
        this.shockSystem.castPlayerShock(
          player,
          client.sessionId,
          level,
          skillCritRate("shock", level, player.critRate),
          player.critDamage,
          msg.angle,
        );
        player.startSkillCooldown(skill, SKILL_DEFS.shock.baseCooldown);
      } else if (skill === "dash") {
        this.dashSystem.castPlayerDash(
          player,
          client.sessionId,
          level,
          msg.angle,
          skillCritRate("dash", level, player.critRate),
          player.critDamage,
        );
        player.startSkillCooldown(skill, dashCooldown(level));
      } else if (skill === "vortex") {
        this.vortexSystem.castVortex(
          client.sessionId,
          "player",
          player.x,
          player.y,
          msg.angle,
          level,
          player.attack,
          player.damageMultiplier,
          skillCritRate("vortex", level, player.critRate),
          player.critDamage,
        );
        player.startSkillCooldown(skill, SKILL_DEFS.vortex.cooldown);
      }
    },

    // Upgrade a skill (debug "0" key). { skill }
    2: (client: Client, msg: { skill: SkillId }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const skill = msg.skill;
      const cur = player.getSkillLevel(skill);
      if (cur <= 0) {
        // Learn it at level 1 if not owned
        player.setSkillLevel(skill, 1);
      } else if (cur < MAX_SKILL_LEVEL) {
        player.upgradeSkill(skill);
      }
    },

    // Viewport rect { x, y, w, h } — the client's camera world view.
    3: (
      client: Client,
      msg: { x: number; y: number; w: number; h: number },
    ) => {
      this.viewports.set(client.sessionId, msg);
    },

    // Respawn request (player pressed Respawn button).
    4: (client: Client, _msg: any) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || !player.isDead) return;
      // Respawn: reset stats, heal to full, move to spawn point.
      player.respawn();
      const spawn = this.mapSystem.getSpawnPoint();
      player.x = spawn.x;
      player.y = spawn.y;
      // Give shock + claw + heal + pulse + slam at level 1
      player.setSkillLevel("shock", 1);
      player.setSkillLevel("claw", 1);
      player.setSkillLevel("heal", 1);
      player.setSkillLevel("pulse", 1);
      player.setSkillLevel("slam", 1);
      player.setSkillLevel("dash", 1);
      player.setSkillLevel("vortex", 1);
    },

    // Map transition XP reward (map2 -> map3: +1000 XP).
    5: (client: Client, _msg: any) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      player.addXp(1000);
      console.log(
        `Player ${client.sessionId} earned 1000 XP for map transition (map2 -> map3)`,
      );
    },

    // ---- Spend skill point on a stat upgrade ----
    6: (client: Client, msg: { stat: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.skillPoints <= 0) return;
      const stat = msg.stat;
      if (stat === "health") {
        player.maxHealth += 500;
        player.currentHealth += 500;
      } else if (stat === "attack") {
        player.attack += 20;
      } else if (stat === "defence") {
        player.defence = Math.min(0.95, player.defence + 0.02);
      } else if (stat === "critRate") {
        player.critRate += 0.02;
      } else if (stat === "critDamage") {
        player.critDamage += 0.2;
      } else if (stat === "moveSpeed") {
        player.speedMultiplier += 0.05;
        player.recalcDerivedStats();
      } else if (stat === "shield") {
        // Don't spend a skill point if shield card already at max level (10).
        if (player.shieldCardLevel >= 10) return;
        player.upgradeShieldSlot();
      } else {
        return;
      }
      player.skillPoints -= 1;
      player.recalcDerivedStats();
    },

    // ---- Spend skill point on a card upgrade ----
    7: (client: Client, msg: { skill: SkillId }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.skillPoints <= 0) return;
      const cur = player.getSkillLevel(msg.skill);
      if (cur <= 0) return;
      if (cur >= MAX_SKILL_LEVEL) return;
      player.upgradeSkill(msg.skill);
      player.skillPoints -= 1;
    },

    // ---- Test: grant a skill point (debug key 9) ----
    8: (client: Client, _msg: any) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      player.skillPoints += 1;
      console.log(
        `Player ${client.sessionId} granted test skill point (total: ${player.skillPoints})`,
      );
    },
    // ---- Debug: force a level-up (press 0) ----
    9: (client: Client, _msg: any) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      player.addXp(player.xpToLevelUp);
      console.log(
        `Player ${client.sessionId} forced level-up (now level ${player.level})`,
      );
    },
  };

  // ============================================================
  // CONNECTION LIFECYCLE
  // ============================================================

  onJoin(client: Client, options: any) {
    console.log("Player joined GameRoom2:", client.sessionId);

    const player = new Player();

    // Check if this is a player transferring from another map
    const ps = options?.playerState;
    if (ps) {
      // Restore player state from previous map
      player.level = ps.level ?? 1;
      player.currentXp = ps.currentXp ?? 0;
      player.xpToLevelUp = ps.xpToLevelUp ?? 1000;
      player.maxHealth = ps.maxHealth ?? 1000;
      player.currentHealth = ps.currentHealth ?? player.maxHealth;
      player.attack = ps.attack ?? 100;
      player.defence = ps.defence ?? 0;
      player.critRate = ps.critRate ?? 0.1;
      player.critDamage = ps.critDamage ?? 1.5;
      player.baseMoveSpeed = ps.baseMoveSpeed ?? 120;
      // Use the speedMultiplier directly from the serialized state.
      player.speedMultiplier = ps.speedMultiplier ?? 1.0;
      player.skillPoints = ps.skillPoints ?? 0;
      // Restore skill levels
      if (ps.skillLevels) {
        for (const [skill, lvl] of Object.entries(ps.skillLevels)) {
          player.setSkillLevel(skill as any, lvl as number);
        }
      }
    } else {
      // Fresh player
      player.initBaseStats();
      player.setSkillLevel("shock", 1);
      player.setSkillLevel("claw", 1);
      player.setSkillLevel("heal", 1);
      player.setSkillLevel("pulse", 1);
      player.setSkillLevel("slam", 1);
      player.setSkillLevel("dash", 1);
      player.setSkillLevel("vortex", 1);
    }

    applyPlayerModifiers(player, this.activeModifiers);
    const spawn = this.mapSystem.getSpawnPoint();
    player.x = spawn.x;
    player.y = spawn.y;

    this.state.players.set(client.sessionId, player);
  }
  onLeave(client: Client, _code: number) {
    console.log("Player left GameRoom2:", client.sessionId);
    this.state.players.delete(client.sessionId);
    this.viewports.delete(client.sessionId);
  }

  onDispose() {
    console.log("GameRoom2 disposed:", this.roomId);
  }
}
