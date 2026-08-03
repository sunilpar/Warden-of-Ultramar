/**
 * Modifier Data Schema
 * =====================
 * Synced modifier info shown to the client in the selection popup
 * and tracked as active mods on each player.
 */

import { Schema, type } from "@colyseus/schema";

export class ModifierData extends Schema {
  @type("string") id: string = "";
  @type("string") label: string = "";
  @type("string") description: string = "";
}
