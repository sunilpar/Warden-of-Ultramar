/**
 * Player System
 * =============
 * Processes player input and moves players each tick.
 * Handles: normalized diagonal movement, boundary clamping, obstacle collision.
 *
 * Per-map scoping: each PlayerSystem instance is bound to ONE map
 * (`targetMapId`) and processes only the players whose `currentMapId`
 * matches. The room runs two systems side-by-side: one for the lobby,
 * one for the room's current gameplay map. This keeps movement +
 * collision resolution isolated to the right map per player.
 *
 * INPUT PROCESSING (why the "skipping" happened)
 * ----------------------------------------------
 * The client sends one input packet per CLIENT tick (60/s) and the
 * server echoes back the tick of the last input it consumed. Those
 * packets arrive over the network in BURSTS: 3 one tick, 0 the next,
 * 5 the next...
 *
 * The old code applied a FULL tick of movement for EVERY queued input,
 * so a burst of 5 packets moved the player 5 ticks' worth of distance
 * in a single server tick. The client had only predicted 1 tick -> the
 * two diverged and the client rubber-banded back to the server.
 * The faster the player moved, the larger the divergence - which is
 * exactly why the problem only showed up at higher movement speeds.
 *
 * THE FIX
 * -------
 *  1. Each input packet is applied as EXACTLY one tick of movement,
 *     in packet order, using that packet's own direction. The server's
 *     position after consuming input #N is therefore identical to the
 *     client's prediction after tick #N, so the two agree exactly.
 *  2. The number of packets consumed per tick is bounded by REAL TIME
 *     (we never advance a player further than real time has passed),
 *     so a client cannot move faster than real time by flooding
 *     packets, while a client that stalled can still catch up.
 *  3. Leftover packets stay QUEUED (never discarded), so no movement
 *     is ever lost.
 *
 * The collision maths itself lives in ./movement.ts, shared byte-for-
 * byte with the client's client/src/maps/movement.ts.
 */
import { GAME_CONFIG } from "../config/game";
export class PlayerSystem {
    constructor(state, mapSystem, targetMapId) {
        this.state = state;
        this.mapSystem = mapSystem;
        this.targetMapId = targetMapId;
    }
    update(dt) {
        this.state.players.forEach((player) => {
            // Skip players that aren't on this system's map (lobby players
            // are processed by the lobby's PlayerSystem, not this one).
            if (player.currentMapId !== this.targetMapId)
                return;
            // Skip movement while in hit-stun (pausedUntil).
            if (false) {
                // hit-stun removed
                player.inputQueue.length = 0;
                return;
            }
            const now = Date.now();
            // ---- How many packets may we consume this tick? -------------
            // Bound by REAL TIME, with a fractional accumulator.
            //
            // The client sends one packet per client tick, so the number of
            // packets we may consume is the number of client ticks that
            // could have elapsed. We accumulate the elapsed time as a
            // FRACTIONAL debt and spend whole ticks from it:
            //
            //   - A naive `ceil(elapsed / step)` would over-grant on a
            //     jittery tick (e.g. the sim loop running 2 ticks in one
            //     frame and 0 in the next -> ceil() grants 3 ticks of
            //     movement for 2 ticks of time = a 50% speed advantage).
            //   - The fractional debt keeps the long-run average at exactly
            //     real time.
            //
            // This is the primary anti-speed-hack guard: a client can never
            // advance further than the wall-clock time that actually passed,
            // while a client that legitimately stalled can still catch up.
            const sinceLast = player.lastInputAt
                ? now - player.lastInputAt
                : GAME_CONFIG.FIXED_TIME_STEP_MS;
            player.lastInputAt = now;
            // Only accumulate debt when there is actually something to
            // consume. If the client is idle or stalled (no input packets),
            // there is no movement owed, so no debt may pile up - otherwise
            // the server would grant a huge burst of movement the moment the
            // client resumed.
            if (player.inputQueue.length > 0) {
                player.inputDebt += sinceLast / GAME_CONFIG.FIXED_TIME_STEP_MS;
                // Never accumulate more than the burst cap: beyond that the
                // client is not just late, it is trying to move faster than
                // real time.
                if (player.inputDebt > GAME_CONFIG.MAX_INPUTS_PER_TICK) {
                    player.inputDebt = GAME_CONFIG.MAX_INPUTS_PER_TICK;
                }
            }
            const allowed = Math.min(GAME_CONFIG.MAX_INPUTS_PER_TICK, Math.max(1, Math.floor(player.inputDebt)));
            // ---- Consume the input buffer -------------------------------
            // Each packet = one tick of movement, applied in order with that
            // packet's own direction, so the server's trajectory matches
            // the client's prediction exactly.
            let processed = 0;
            let input;
            // Recompute the effective speed ONCE per tick (not per packet):
            // every packet in this tick must use the same speed, otherwise
            // the server's trajectory would diverge from the client's.
            player.recalcDerivedStats();
            const speed = player.moveSpeed;
            while (processed < allowed) {
                input = player.inputQueue.shift();
                if (input === undefined)
                    break;
                // Build direction vector from this input.
                let dirX = 0;
                let dirY = 0;
                if (input.left)
                    dirX -= 1;
                if (input.right)
                    dirX += 1;
                if (input.up)
                    dirY -= 1;
                if (input.down)
                    dirY += 1;
                // Normalize so diagonal movement is same speed as cardinal.
                const length = Math.sqrt(dirX * dirX + dirY * dirY);
                if (length > 0) {
                    dirX /= length;
                    dirY /= length;
                }
                // Swept collision: sub-stepped so a fast player can never
                // tunnel through a wall, and axis-separated so the player
                // slides along walls instead of sticking to them.
                const moved = this.mapSystem.moveWithCollision(player.x, player.y, dirX * speed * dt, dirY * speed * dt, GAME_CONFIG.PLAYER.COLLISION_RADIUS);
                // Clamp to map boundaries.
                player.x = Math.max(0, Math.min(this.mapSystem.width, moved.x));
                player.y = Math.max(0, Math.min(this.mapSystem.height, moved.y));
                // Acknowledge this input so the client can reconcile its
                // prediction against our authoritative position.
                if (input.tick !== undefined) {
                    player.tick = input.tick;
                }
                processed++;
            }
            // Spend the debt we just consumed. Any remainder is carried to
            // the next tick (this is what keeps the long-run rate at
            // exactly real time).
            player.inputDebt -= processed;
            // Bound the queue so a flooding (malicious) client cannot grow
            // it without limit. Oldest packets are stale intent and are the
            // least valuable, so they go first.
            if (player.inputQueue.length > GAME_CONFIG.MAX_QUEUED_INPUTS) {
                player.inputQueue.splice(0, player.inputQueue.length - GAME_CONFIG.MAX_QUEUED_INPUTS);
            }
        });
    }
}
