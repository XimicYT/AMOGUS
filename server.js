const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", message: "Sabotage server is alive!" });
});

const server = http.createServer(app);
const io = new Server(server, {
  path: "/api/game-data",
  cors: { origin: "*", methods: ["GET", "POST"] },
  // THE HEARTBEAT CONFIGURATION
  pingInterval: 10000, // Send a ping every 10 seconds
  pingTimeout: 5000, // Drop connection if no pong back in 5 seconds
});

const players = {};
let countdownInterval = null;
let gameInProgress = false;
let gameLoopInterval = null;

const MAP_SIZE = 2000;
const TICK_RATE = 1000 / 20;

// --- NEW: THE CARD DATABASE ---
const CARD_DB = {
  short_circuit: {
    id: "short_circuit",
    name: "Short Circuit",
    tier: 1,
    duration: 10000,
    desc: "Reduce map vision to 2 meters.",
  },
  comms_static: {
    id: "comms_static",
    name: "Comms Static",
    tier: 1,
    duration: 15000,
    desc: "Scramble UI & Task Tracking.",
  },
  gravity_spike: {
    id: "gravity_spike",
    name: "Gravity Spike",
    tier: 2,
    duration: 15000,
    desc: "Reduces movement speed by 50%.",
  },
  grid_overload: {
    id: "grid_overload",
    name: "Grid Overload",
    tier: 2,
    duration: 15000,
    desc: "Lock all task interactions map-wide.",
  },
};

let activeGlobalEffects = {}; // Tracks currently active sabotages

const MAP_WALLS = [
  { x: 0, y: 0, w: 2000, h: 40 },
  { x: 0, y: 1960, w: 2000, h: 40 },
  { x: 0, y: 0, w: 40, h: 2000 },
  { x: 1960, y: 0, w: 40, h: 2000 },
  { x: 800, y: 800, w: 150, h: 40 },
  { x: 1050, y: 800, w: 150, h: 40 },
  { x: 800, y: 1160, w: 150, h: 40 },
  { x: 1050, y: 1160, w: 150, h: 40 },
  { x: 800, y: 800, w: 40, h: 150 },
  { x: 800, y: 1050, w: 40, h: 150 },
  { x: 1160, y: 800, w: 40, h: 150 },
  { x: 1160, y: 1050, w: 40, h: 150 },
  { x: 200, y: 200, w: 400, h: 40 },
  { x: 200, y: 600, w: 150, h: 40 },
  { x: 450, y: 600, w: 150, h: 40 },
  { x: 200, y: 200, w: 40, h: 400 },
  { x: 560, y: 200, w: 40, h: 150 },
  { x: 560, y: 450, w: 40, h: 150 },
  { x: 1400, y: 200, w: 400, h: 40 },
  { x: 1400, y: 600, w: 150, h: 40 },
  { x: 1650, y: 600, w: 150, h: 40 },
  { x: 1760, y: 200, w: 40, h: 400 },
  { x: 1400, y: 200, w: 40, h: 150 },
  { x: 1400, y: 450, w: 40, h: 150 },
  { x: 200, y: 1760, w: 400, h: 40 },
  { x: 200, y: 1400, w: 150, h: 40 },
  { x: 450, y: 1400, w: 150, h: 40 },
  { x: 200, y: 1400, w: 40, h: 400 },
  { x: 560, y: 1400, w: 40, h: 150 },
  { x: 560, y: 1650, w: 40, h: 150 },
  { x: 1400, y: 1760, w: 400, h: 40 },
  { x: 1400, y: 1400, w: 150, h: 40 },
  { x: 1650, y: 1400, w: 150, h: 40 },
  { x: 1760, y: 1400, w: 40, h: 400 },
  { x: 1400, y: 1400, w: 40, h: 150 },
  { x: 1400, y: 1650, w: 40, h: 150 },
  { x: 600, y: 600, w: 100, h: 100 },
  { x: 1300, y: 600, w: 100, h: 100 },
  { x: 600, y: 1300, w: 100, h: 100 },
  { x: 1300, y: 1300, w: 100, h: 100 },
];

const GAME_TASKS = [
  {
    id: "task_1",
    type: "wiring",
    name: "Fix North Power Routing",
    x: 1000,
    y: 300,
  },
  {
    id: "task_2",
    type: "download",
    name: "Download Nav Data",
    x: 1600,
    y: 400,
  },
  { id: "task_3", type: "keypad", name: "Override Security", x: 1600, y: 1600 },
  { id: "task_4", type: "primer", name: "Prime Shields", x: 400, y: 1600 },
  {
    id: "task_5",
    type: "wiring",
    name: "Fix South O2 Filters",
    x: 1000,
    y: 1700,
  },
  { id: "task_6", type: "download", name: "Sync Database", x: 400, y: 400 },
  { id: "task_7", type: "keypad", name: "Unlock Medbay", x: 300, y: 1000 },
  { id: "task_8", type: "primer", name: "Reboot Reactor", x: 1700, y: 1000 },
];

let totalTaskTarget = 0;
let tasksCompleted = 0;

function checkWallCollision(x, y) {
  const radius = 15;
  for (let wall of MAP_WALLS) {
    let testX = x;
    let testY = y;
    if (x < wall.x) testX = wall.x;
    else if (x > wall.x + wall.w) testX = wall.x + wall.w;
    if (y < wall.y) testY = wall.y;
    else if (y > wall.y + wall.h) testY = wall.y + wall.h;
    let distX = x - testX;
    let distY = y - testY;
    if (Math.sqrt(distX * distX + distY * distY) <= radius) return true;
  }
  return false;
}
function resetGame() {
  gameInProgress = false;
  if (gameLoopInterval) {
    clearInterval(gameLoopInterval);
    gameLoopInterval = null;
  }
  activeGlobalEffects = {};
  totalTaskTarget = 0;
  tasksCompleted = 0;

  // Un-ready all players and clear game state
  Object.values(players).forEach((p) => {
    p.isReady = false;
    p.role = null;
    p.inventory = [];
    p.isDead = false;
  });

  io.emit("update_player_list", Object.values(players));
}
// --- NEW: Card Drawing Math ---
function drawCard(player) {
  if (player.inventory.length >= 3) return; // Full hand

  let hasTier2 = player.inventory.some((cId) => CARD_DB[cId].tier === 2);
  let roll = Math.random();

  // 10% chance for Tier 2, BUT max 1 per person.
  let targetTier = roll < 0.1 && !hasTier2 ? 2 : 1;

  let availableCards = Object.values(CARD_DB).filter(
    (c) => c.tier === targetTier,
  );
  let drawn = availableCards[Math.floor(Math.random() * availableCards.length)];

  player.inventory.push(drawn.id);
}

function checkGameStart() {
  const playerArray = Object.values(players);
  const allReady =
    playerArray.length >= 2 && playerArray.every((p) => p.isReady);

  if (allReady && !gameInProgress) {
    let timeLeft = 5;
    io.emit("countdown_update", `BREACH IMMINENT IN ${timeLeft}...`);
    countdownInterval = setInterval(() => {
      timeLeft--;
      if (timeLeft > 0)
        io.emit("countdown_update", `BREACH IMMINENT IN ${timeLeft}...`);
      else {
        clearInterval(countdownInterval);
        startGame();
      }
    }, 1000);
  } else {
    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
      io.emit("countdown_update", "WAITING FOR FULL READY STATUS...");
    }
  }
}

function startGame() {
  gameInProgress = true;
  const playerIds = Object.keys(players);
  const killerIndex = Math.floor(Math.random() * playerIds.length);
  const killerId = playerIds[killerIndex];

  tasksCompleted = 0;
  totalTaskTarget = (playerIds.length - 1) * GAME_TASKS.length;

  playerIds.forEach((id) => {
    players[id].role = id === killerId ? "Killer" : "Crewmate";
    players[id].inventory = [];
    players[id].lastCardPlayTime = 0;

    // Killer starts with 3 cards
    if (players[id].role === "Killer") {
      drawCard(players[id]);
      drawCard(players[id]);
      drawCard(players[id]);
    }

    const startX = 1000 + (Math.random() * 40 - 20);
    const startY = 1000 + (Math.random() * 40 - 20);
    players[id].x = startX;
    players[id].y = startY;
    players[id].isDead = false;
    players[id].lastKillTime = 0;

    io.to(id).emit("game_start", {
      role: players[id].role,
      playersInGame: playerIds.length,
      startX: startX,
      startY: startY,
      tasks: GAME_TASKS,
      walls: MAP_WALLS,
    });

    // Send initial inventory
    io.to(id).emit(
      "inventory_update",
      players[id].inventory.map((c) => CARD_DB[c]),
    );
  });

  console.log(`Game started! ${players[killerId].name} is the Killer.`);
  gameLoopInterval = setInterval(broadcastState, TICK_RATE);
}

function broadcastState() {
  const sanitizedPlayers = Object.values(players).map((p) => ({
    id: p.id,
    name: p.name,
    x: p.x,
    y: p.y,
  }));

  // Broadcast player positions and currently active global effects
  io.emit("game_state_update", {
    players: sanitizedPlayers,
    effects: activeGlobalEffects,
  });
}

io.on("connection", (socket) => {
  socket.on("join_lobby", (playerName) => {
    if (gameInProgress) {
      socket.emit("countdown_update", "GAME IN PROGRESS.");
      return;
    }
    players[socket.id] = {
      id: socket.id,
      name: playerName || `Player_${Math.floor(Math.random() * 1000)}`,
      isReady: false,
      role: null,
      x: 0,
      y: 0,
      inventory: [],
      lastCardPlayTime: 0,
    };
    io.emit("update_player_list", Object.values(players));
    checkGameStart();
  });

  socket.on("toggle_ready", () => {
    if (players[socket.id]) {
      players[socket.id].isReady = !players[socket.id].isReady;
      io.emit("update_player_list", Object.values(players));
      checkGameStart();
    }
  });

  socket.on("client_movement", (data) => {
    if (!players[socket.id] || !gameInProgress) return;
    const p = players[socket.id];

    const dx = data.x - p.x;
    const dy = data.y - p.y;
    if (
      Math.sqrt(dx * dx + dy * dy) > 100 ||
      checkWallCollision(data.x, data.y)
    ) {
      socket.emit("server_correction", { x: p.x, y: p.y });
    } else {
      p.x = data.x;
      p.y = data.y;
    }
  });

  socket.on("task_completed", (taskId) => {
    const p = players[socket.id];
    if (!p || p.role === "Killer") return;

    // ANTI-CHEAT: Cannot do tasks during Grid Overload
    if (activeGlobalEffects["grid_overload"]) return;

    tasksCompleted++;
    io.emit("task_progress_update", (tasksCompleted / totalTaskTarget) * 100);

    // Earn a card for doing a task!
    drawCard(p);
    socket.emit(
      "inventory_update",
      p.inventory.map((c) => CARD_DB[c]),
    );

    if (tasksCompleted >= totalTaskTarget) {
      io.emit("game_over", {
        winner: "Crewmates",
        reason: "All tasks completed!",
      });
    }
  });

  // --- NEW: Play Card Logic ---
  socket.on("play_card", (cardIndex) => {
    const p = players[socket.id];
    if (!p || !gameInProgress) return;

    const now = Date.now();
    if (now - p.lastCardPlayTime < 10000) return; // 10 Second Cooldown Server Enforcement

    if (cardIndex >= 0 && cardIndex < p.inventory.length) {
      const cardId = p.inventory[cardIndex];
      const cardData = CARD_DB[cardId];

      // Remove from hand
      p.inventory.splice(cardIndex, 1);
      p.lastCardPlayTime = now;

      // Apply effect globally
      activeGlobalEffects[cardId] = now + cardData.duration;
      console.log(`${p.name} played ${cardData.name}!`);

      // Tell the map a new effect happened (for sound/visuals later)
      io.emit("effect_triggered", cardData.name);

      // Give them back their new hand and trigger the cooldown UI
      socket.emit(
        "inventory_update",
        p.inventory.map((c) => CARD_DB[c]),
      );
      socket.emit("card_cooldown_started", 10000);

      // Set a timer to clean up the effect when it ends
      setTimeout(() => {
        if (
          activeGlobalEffects[cardId] &&
          Date.now() >= activeGlobalEffects[cardId]
        ) {
          delete activeGlobalEffects[cardId];
        }
      }, cardData.duration);
    }
    // --- NEW: Kill Mechanic ---
    socket.on("request_kill", () => {
      const killer = players[socket.id];
      if (!killer || killer.role !== "Killer" || !gameInProgress) return;

      // 1. Check Killer Cooldown (Server side enforcement)
      const now = Date.now();
      if (killer.lastKillTime && now - killer.lastKillTime < 20000) return; // 20s Cooldown

      // 2. Find closest crewmate in range
      let target = null;
      let closestDist = 60; // Kill range

      Object.values(players).forEach((p) => {
        if (p.role === "Crewmate" && !p.isDead) {
          const dx = killer.x - p.x;
          const dy = killer.y - p.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < closestDist) {
            closestDist = dist;
            target = p;
          }
        }
      });

      if (target) {
        // 3. Execute Kill
        target.isDead = true;
        killer.lastKillTime = now;

        // 4. Killer Reward: Refill Hand to 3 Cards
        while (killer.inventory.length < 3) {
          drawCard(killer);
        }

        // 5. Broadcast events
        io.emit("player_died", target.id);
        io.emit("effect_triggered", "CREW ELIMINATED"); // Visual/Sound cue

        // Send updated inventory back to killer
        socket.emit(
          "inventory_update",
          killer.inventory.map((c) => CARD_DB[c]),
        );

        // Trigger 20s cooldown UI for killer
        socket.emit("kill_cooldown_started", 20000);

        // 6. Check Win Condition (Are all crewmates dead?)
        const aliveCrew = Object.values(players).filter(
          (p) => p.role === "Crewmate" && !p.isDead,
        );
        if (aliveCrew.length === 0) {
          io.emit("game_over", {
            winner: "Killer",
            reason: "All crewmates eliminated.",
          });
        }
      }
    });
  });

  // --- NEW: Discard Logic (Killer Only) ---
  socket.on("discard_card", (cardIndex) => {
    const p = players[socket.id];
    if (!p || !gameInProgress || p.role !== "Killer") return;

    if (cardIndex >= 0 && cardIndex < p.inventory.length) {
      p.inventory.splice(cardIndex, 1);
      socket.emit(
        "inventory_update",
        p.inventory.map((c) => CARD_DB[c]),
      );
    }
  });

  socket.on("disconnect", (reason) => {
    console.log(`Player ${socket.id} disconnected. Reason: ${reason}`);

    if (players[socket.id]) {
      const p = players[socket.id];
      const wasKiller = p.role === "Killer";
      const wasCrewmate = p.role === "Crewmate";

      delete players[socket.id]; // Remove them from the server state

      if (!gameInProgress) {
        // Innocent disconnect in the lobby
        io.emit("update_player_list", Object.values(players));
        checkGameStart();
      } else {
        // MID-GAME EMERGENCY DISCONNECT
        if (wasKiller) {
          // Killer rage-quit or dropped. Crewmates win instantly.
          io.emit("game_over", {
            winner: "Crewmates",
            reason: "The Killer disconnected.",
          });
          resetGame();
        } else if (wasCrewmate) {
          // Check if the remaining crew is entirely dead or gone
          const aliveCrew = Object.values(players).filter(
            (pl) => pl.role === "Crewmate" && !pl.isDead,
          );

          if (aliveCrew.length === 0) {
            io.emit("game_over", {
              winner: "Killer",
              reason: "All crewmates eliminated or disconnected.",
            });
            resetGame();
          } else {
            // The game must go on, but we have to reduce the total task target
            // so the survivors aren't forced to do the missing player's ghost tasks.
            totalTaskTarget = Math.max(1, totalTaskTarget - GAME_TASKS.length);

            // Force a progress bar update for everyone
            io.emit(
              "task_progress_update",
              (tasksCompleted / totalTaskTarget) * 100,
            );

            // Update visual rendering so the disconnected player vanishes
            io.emit("game_state_update", {
              players: Object.values(players).map((pl) => ({
                id: pl.id,
                name: pl.name,
                x: pl.x,
                y: pl.y,
              })),
              effects: activeGlobalEffects,
            });
          }
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Sabotage Escape server running on port ${PORT}`);
});
