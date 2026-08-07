/**
 * Enemy Stats Configuration
 * =========================
 * Central definition of every enemy type. Mirrors the player's stat model
 * (base / multiplier / effective) so level-based growth and percentage
 * buffs/debuffs apply cleanly.
 *
 * SKILL POOL
 *   Skills are shared between enemies and the player (same SkillId space as
 *   client/src/config/skills.ts). An enemy's skill pool is the set of skills
 *   it MAY cast; the EnemySystem picks one at random each attempt, gated by
 *   that skill's cooldown. Skill logic itself is NOT implemented yet.
 *
 * BASE SPEED NOTE
 *   The simulation moves entities by `speed * dt` where dt is in SECONDS.
 *   A base speed of 60 px/sec == exactly 1 pixel per tick (60 ticks/sec).
 *   A percentage bonus (e.g. +20%) is applied as a multiplier (1.2), giving
 *   72 px/sec. The same formula that moves players then moves the enemy.
 */
export const ENEMY_STATS = {
    tyranid: {
        id: "tyranid",
        title: "Tyranid",
        description: "A relentless xenos beast that closes the distance and tears its prey apart with melee claws.",
        maxHealth: 600,
        moveSpeed: 60, // 1px per tick
        attack: 40,
        shield: 0,
        collisionRadius: 18,
        skillPool: ["claw"],
        skillCooldown: { claw: 1.5 },
        growth: {
            maxHealth: 120,
            moveSpeed: 0, // speed doesn't grow with level
            attack: 8,
        },
    },
};
/** All enemy types as a list (useful for spawn tables). */
export const ENEMY_TYPE_LIST = Object.values(ENEMY_STATS);
