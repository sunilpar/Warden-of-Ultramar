/**
 * Player Schema
 * =============
 * The synced state for a single player.
 * Only x, y, and tick are sent to clients.
 * inputQueue is local to the server (not synced).
 */

import { Schema, type } from "@colyseus/schema";

export interface InputData {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  tick?: number;
}

export class Player extends Schema {
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") tick: number = 0;

  inputQueue: InputData[] = [];
}
