/**
 * Per-Skill Targeting Rules
 * =========================
 *
 * Decouples "how a skill aims" from "which HUD slot it lives in". Every
 * skill declares its own targeting behaviour; the cast path reads the
 * rule from the SKILL in the slot, not the slot itself. This lets any
 * skill go in any slot and behave correctly.
 *
 * Targeting modes:
 *   - "aim"   : the skill fires toward the player's mouse pointer.
 *               Used by directional skills (shock, bolter, dash, claw, slam).
 *   - "self"  : the skill is centered on the caster. Mouse is irrelevant.
 *               Used by self-centered AoEs (heal, pulse, vortex).
 *
 * The cast path (client/src/scenes/GameScene.ts → castSlot) does:
 *
 *   const skill = this.slotSkill(slot);
 *   const targeting = getSkillTargeting(skill);
 *   const angle = targeting === "self" ? 0 : this.computeAimAngle();
 *   this.room.send(1, { slot, angle });
 *
 * The server ignores `angle` for "self" skills so sending 0 is safe.
 */
import type { SkillId } from "./skillDefs";

export type TargetingMode = "aim" | "self";

/** Per-skill targeting rules. Add a new skill here when one is added. */
export const SKILL_TARGETING: Record<SkillId, TargetingMode> = {
  // Directional — fire toward mouse pointer.
  shock: "aim",
  bolter: "aim",
  dash: "aim",
  claw: "aim",
  slam: "aim",
  // Self-centered — mouse position is irrelevant.
  heal: "self",
  pulse: "self",
  vortex: "self",
  // Shield is a passive equipped card (no active cast); default to self.
  shield: "self",
};

/** Look up a skill's targeting mode. Defaults to "aim" if unknown. */
export function getSkillTargeting(skill: SkillId): TargetingMode {
  return SKILL_TARGETING[skill] ?? "aim";
}
