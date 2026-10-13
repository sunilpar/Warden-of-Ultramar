import { defineServer, defineRoom, monitor, playground } from "colyseus";
import { matchMaker } from "colyseus";
import type { Request, Response } from "express";

/**
 * Import your Room files
 */
import { GameRoom } from "./rooms/GameRoom";
import { generateLobbyCode, lookupLobby, registerLobby } from "./lobbyRegistry";

const server = defineServer({
  rooms: {
    // ONE room type = one game session. Maps rotate INSIDE the room
    // (map1 -> map2 -> map1 ...) - see config/mapRegistry.ts.
    game_room: defineRoom(GameRoom),
  },

  express: (app) => {
    /**
     * Bind your custom express routes here:
     */
    app.get("/hello", (_req, res) => {
      res.send("It's time to kick ass and chew bubblegum!");
    });

    // ====================================================================
    // LOBBY CODE HTTP ENDPOINTS
    // ====================================================================
    // The client uses these to create a code lobby (POST /api/lobby/create)
    // and to resolve a code -> roomId for joinOrCreate (GET /api/lobby/join).
    //
    // Why HTTP and not matchMaker.joinByName? matchMaker can't filter by our
    // custom metadata; the lobbyRegistry is the source of truth and the HTTP
    // route hands the client back the actual roomId to pass to joinById.
    //
    // Codes are 6 chars from 0-9 A-Z (uppercase only - 36 chars; ~2.2B
    // combinations). With even 1k concurrent code-lobbies the collision
    // probability is ~5e-7, so we retry up to 8 times before giving up.

    /**
     * POST /api/lobby/create
     *   Creates a fresh GameRoom with a random 6-char code, registers it in
     *   the lobby registry, and returns { code, roomId }. The client then
     *   calls client.joinById(roomId) to enter the room (and becomes the
     *   leader because they're the first player in).
     *
     *   No request body required. Always returns 200 + {code, roomId} on
     *   success; 500 if all 8 retry attempts collided (effectively never).
     */
    app.post("/api/lobby/create", async (_req: Request, res: Response) => {
      const MAX_ATTEMPTS = 8;
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const code = generateLobbyCode();
        try {
          // matchMaker.createRoom returns a CacheEntry with the roomId.
          const cache = await matchMaker.createRoom("game_room", {
            lobbyCode: code,
          });
          // Register the code in the registry NOW, BEFORE returning the
          // JSON response. The dialog auto-copies the code the moment
          // it lands, so a second player could paste + JOIN in the
          // window between this response and the creator's
          // `joinById` handshake (which is what used to insert the
          // entry in GameRoom.onJoin). Registering eagerly closes that
          // race. `leaderId` is empty here - GameRoom.onJoin stamps it
          // via setLobbyLeader() once the creator connects.
          const registered = registerLobby(code, cache.roomId, "");
          if (!registered) {
            // Vanishingly rare collision with a concurrent create
            // using the same code. The room is now unreachable via
            // /api/lobby/join; retry with a fresh code. The orphan
            // room will be cleaned up by Colyseus's natural timeout.
            console.warn(
              `[API] /api/lobby/create: code "${code}" race-collision, retrying`,
            );
            continue;
          }
          res.json({ code, roomId: cache.roomId });
          return;
        } catch (e) {
          if (attempt === MAX_ATTEMPTS - 1) {
            console.error("[API] /api/lobby/create failed:", e);
            res
              .status(500)
              .json({ error: "lobby_create_failed", message: String(e) });
            return;
          }
        }
      }
    });

    /**
     * POST /api/lobby/solo
     *   Creates a fresh private solo GameRoom. Unlike /api/lobby/create
     *   this room has NO lobbyCode and is not registered in the
     *   lobbyRegistry -> it is unreachable via /api/lobby/join and
     *   effectively a single-player private session. The first player
     *   to join it is auto-teleported to map1 by GameRoom.onCreate +
     *   onJoin's isSoloRun branch (no second Play click needed).
     */
    app.post("/api/lobby/solo", async (_req: Request, res: Response) => {
      try {
        const cache = await matchMaker.createRoom("game_room", {
          soloRun: true,
        });
        res.json({ roomId: cache.roomId });
      } catch (e) {
        console.error("[API] /api/lobby/solo failed:", e);
        res
          .status(500)
          .json({ error: "lobby_solo_failed", message: String(e) });
      }
    });

    /**
     * GET /api/lobby/join?code=ABC123
     *   Looks up a live code lobby. Returns { roomId } on success.
     *   Rejects (404) if:
     *     - code is missing or malformed
     *     - no lobby exists for that code (lobby destroyed / leader left)
     *     - the lobby leader is currently mid-map (run in progress)
     *
     *   Once the client has roomId it does client.joinById(roomId) - this
     *   is a normal Colyseus join, not lobby-creation, so it does NOT
     *   loop through the create flow even if the room is somehow full.
     */
    app.get("/api/lobby/join", (req: Request, res: Response) => {
      const codeRaw = req.query;
      const code = typeof codeRaw.code === "string" ? codeRaw.code.trim() : "";
      // Server-side generator only emits uppercase A-Z + 0-9, but a user
      // typing the code may paste it in any case - normalise to upper so
      // the registry lookup matches.
      const normalised = code.toUpperCase();
      const entry = normalised ? lookupLobby(normalised) : null;
      if (!entry) {
        res.status(404).json({
          error: "lobby_not_found",
          message:
            "No lobby with that code. Ask the host to share their 6-character code, or create your own lobby.",
        });
        return;
      }
      if (!entry.leaderInLobby) {
        // Leader is mid-map -> the run is in progress, no new drop-ins.
        res.status(409).json({
          error: "lobby_in_run",
          message:
            "The lobby leader is mid-run. Wait for them to return to the lobby.",
        });
        return;
      }
      res.json({ roomId: entry.roomId, code: entry.code ?? code });
    });

    if (process.env.NODE_ENV !== "production") {
      app.use("/", playground());
    }

    /**
     * Bind @colyseus/monitor
     * It is recommended to protect this route with a password.
     * Read more: https://docs.colyseus.io/tools/monitor/
     */
    app.use("/monitor", monitor());
  },
});

export default server;
