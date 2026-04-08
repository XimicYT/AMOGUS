const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());

app.get("/health", (req, res) => { res.status(200).json({ status: "ok", message: "Sabotage server is alive!" }); });

const server = http.createServer(app);
const io = new Server(server, {
  path: "/api/game-data", cors: { origin: "*", methods: ["GET", "POST"] },
  pingInterval: 10000, pingTimeout: 5000, 
});

const players = {};
let countdownInterval = null;
let gameInProgress = false;
let gameLoopInterval = null;

const MAP_SIZE = 2000;
const TICK_RATE = 1000 / 20;

// NEW: Pod Lockdown Added!
const CARD_DB = {
  short_circuit: { id: "short_circuit", name: "Short Circuit", tier: 1, duration: 10000, desc: "Reduce map vision to 2 meters." },
  comms_static: { id: "comms_static", name: "Comms Static", tier: 1, duration: 15000, desc: "Scramble UI & Task Tracking." },
  gravity_spike: { id: "gravity_spike", name: "Gravity Spike", tier: 2, duration: 15000, desc: "Reduces movement speed by 50%." },
  grid_overload: { id: "grid_overload", name: "Grid Overload", tier: 2, duration: 15000, desc: "Lock all task interactions map-wide." },
  pod_lockdown: { id: "pod_lockdown", name: "Pod Lockdown", tier: 2, duration: 20000, desc: "Disables Escape Pods for 20 seconds."}
};

let activeGlobalEffects = {}; 

const MAP_WALLS = [
  { x: 0, y: 0, w: 2000, h: 40 }, { x: 0, y: 1960, w: 2000, h: 40 }, { x: 0, y: 0, w: 40, h: 2000 }, { x: 1960, y: 0, w: 40, h: 2000 },
  { x: 800, y: 800, w: 150, h: 40 }, { x: 1050, y: 800, w: 150, h: 40 }, { x: 800, y: 1160, w: 150, h: 40 }, { x: 1050, y: 1160, w: 150, h: 40 },
  { x: 800, y: 800, w: 40, h: 150 }, { x: 800, y: 1050, w: 40, h: 150 }, { x: 1160, y: 800, w: 40, h: 150 }, { x: 1160, y: 1050, w: 40, h: 150 },
  { x: 200, y: 200, w: 400, h: 40 }, { x: 200, y: 600, w: 150, h: 40 }, { x: 450, y: 600, w: 150, h: 40 }, { x: 200, y: 200, w: 40, h: 400 },  
  { x: 560, y: 200, w: 40, h: 150 }, { x: 560, y: 450, w: 40, h: 150 }, { x: 1400, y: 200, w: 400, h: 40 }, { x: 1400, y: 600, w: 150, h: 40 }, 
  { x: 1650, y: 600, w: 150, h: 40 }, { x: 1760, y: 200, w: 40, h: 400 }, { x: 1400, y: 200, w: 40, h: 150 }, { x: 1400, y: 450, w: 40, h: 150 }, 
  { x: 200, y: 1760, w: 400, h: 40 }, { x: 200, y: 1400, w: 150, h: 40 }, { x: 450, y: 1400, w: 150, h: 40 }, { x: 200, y: 1400, w: 40, h: 400 }, 
  { x: 560, y: 1400, w: 40, h: 150 }, { x: 560, y: 1650, w: 40, h: 150 }, { x: 1400, y: 1760, w: 400, h: 40 }, { x: 1400, y: 1400, w: 150, h: 40 },
  { x: 1650, y: 1400, w: 150, h: 40 }, { x: 1760, y: 1400, w: 40, h: 400 }, { x: 1400, y: 1400, w: 40, h: 150 }, { x: 1400, y: 1650, w: 40, h: 150 },
  { x: 600, y: 600, w: 100, h: 100 }, { x: 1300, y: 600, w: 100, h: 100 }, { x: 600, y: 1300, w: 100, h: 100 }, { x: 1300, y: 1300, w: 100, h: 100 }
];

const GAME_TASKS = [
  { id: 'task_1', type: 'wiring', name: 'Fix North Power', x: 1000, y: 300 },
  { id: 'task_2', type: 'download', name: 'Download Data', x: 1600, y: 400 },
  { id: 'task_3', type: 'keypad', name: 'Override Sec', x: 1600, y: 1600 },
  { id: 'task_4', type: 'primer', name: 'Prime Shields', x: 400, y: 1600 },
  { id: 'task_5', type: 'wiring', name: 'Fix South O2', x: 1000, y: 1700 },
  { id: 'task_6', type: 'download', name: 'Sync DB', x: 400, y: 400 },
  { id: 'task_7', type: 'keypad', name: 'Unlock Medbay', x: 300, y: 1000 },
  { id: 'task_8', type: 'primer', name: 'Reboot Reactor', x: 1700, y: 1000 },
];

let totalTaskTarget = 0; 
let tasksCompleted = 0;
let escapePhaseActive = false; // NEW

function checkWallCollision(x, y) {
  const radius = 15; 
  for (let wall of MAP_WALLS) {
      let testX = x; let testY = y;
      if (x < wall.x) testX = wall.x; else if (x > wall.x + wall.w) testX = wall.x + wall.w; 
      if (y < wall.y) testY = wall.y; else if (y > wall.y + wall.h) testY = wall.y + wall.h; 
      let distX = x - testX; let distY = y - testY;
      if (Math.sqrt((distX*distX) + (distY*distY)) <= radius) return true; 
  }
  return false;
}

function drawCard(player) {
  if (player.inventory.length >= 3) return; 
  let hasTier2 = player.inventory.some(cId => CARD_DB[cId].tier === 2);
  let targetTier = (Math.random() < 0.10 && !hasTier2) ? 2 : 1;
  let availableCards = Object.values(CARD_DB).filter(c => c.tier === targetTier);
  let drawn = availableCards[Math.floor(Math.random() * availableCards.length)];
  player.inventory.push(drawn.id);
}

function resetGame() {
  gameInProgress = false; escapePhaseActive = false;
  if (gameLoopInterval) { clearInterval(gameLoopInterval); gameLoopInterval = null; }
  activeGlobalEffects = {}; totalTaskTarget = 0; tasksCompleted = 0;
  Object.values(players).forEach(p => {
      p.isReady = false; p.role = null; p.inventory = []; p.isDead = false; p.isEscaped = false; p.lastKillTime = 0;
  });
  io.emit('update_player_list', Object.values(players));
}

function checkGameStart() {
  const playerArray = Object.values(players);
  const allReady = playerArray.length >= 2 && playerArray.every(p => p.isReady);
  if (allReady && !gameInProgress) {
      let timeLeft = 5; io.emit('countdown_update', `BREACH IMMINENT IN ${timeLeft}...`);
      countdownInterval = setInterval(() => {
          timeLeft--;
          if (timeLeft > 0) io.emit('countdown_update', `BREACH IMMINENT IN ${timeLeft}...`);
          else { clearInterval(countdownInterval); startGame(); }
      }, 1000);
  } else {
      if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; io.emit('countdown_update', 'WAITING FOR FULL READY STATUS...'); }
  }
}

function startGame() {
  gameInProgress = true; escapePhaseActive = false;
  const playerIds = Object.keys(players);
  const killerIndex = Math.floor(Math.random() * playerIds.length);
  const killerId = playerIds[killerIndex];

  tasksCompleted = 0;
  totalTaskTarget = (playerIds.length - 1) * GAME_TASKS.length;

  playerIds.forEach(id => {
      players[id].role = (id === killerId) ? 'Killer' : 'Crewmate';
      players[id].inventory = []; players[id].lastCardPlayTime = 0;
      players[id].isDead = false; players[id].isEscaped = false; players[id].lastKillTime = 0;

      if (players[id].role === 'Killer') { drawCard(players[id]); drawCard(players[id]); drawCard(players[id]); }
      
      const startX = 1000 + (Math.random() * 40 - 20); const startY = 1000 + (Math.random() * 40 - 20);
      players[id].x = startX; players[id].y = startY;

      io.to(id).emit('game_start', { role: players[id].role, playersInGame: playerIds.length, startX: startX, startY: startY, tasks: GAME_TASKS, walls: MAP_WALLS });
      io.to(id).emit('inventory_update', players[id].inventory.map(c => CARD_DB[c]));
  });

  gameLoopInterval = setInterval(broadcastState, TICK_RATE);
}

function broadcastState() {
  const sanitizedPlayers = Object.values(players).map(p => ({
      id: p.id, name: p.name, x: p.x, y: p.y, isDead: p.isDead, isEscaped: p.isEscaped
  }));
  io.emit('game_state_update', { players: sanitizedPlayers, effects: activeGlobalEffects });
}

// Check Win Conditions
function evaluateWinCondition() {
    const aliveCrew = Object.values(players).filter(p => p.role === 'Crewmate' && !p.isDead && !p.isEscaped);
    const escapedCrew = Object.values(players).filter(p => p.role === 'Crewmate' && p.isEscaped);
    
    // If no one is left running around...
    if (aliveCrew.length === 0) {
        if (escapedCrew.length > 0) {
            io.emit('game_over', { winner: 'Crewmates', reason: `${escapedCrew.length} Crewmate(s) successfully escaped!` });
        } else {
            io.emit('game_over', { winner: 'Killer', reason: 'All crewmates eliminated.' });
        }
        resetGame();
    }
}

io.on('connection', (socket) => {
  socket.on('join_lobby', (playerName) => {
      if (gameInProgress) { socket.emit('countdown_update', 'GAME IN PROGRESS.'); return; }
      players[socket.id] = { id: socket.id, name: playerName || `Player_${Math.floor(Math.random() * 1000)}`, isReady: false, role: null, x: 0, y: 0, isDead: false, isEscaped: false, inventory: [] };
      io.emit('update_player_list', Object.values(players)); checkGameStart(); 
  });

  socket.on('toggle_ready', () => {
      if (players[socket.id]) { players[socket.id].isReady = !players[socket.id].isReady; io.emit('update_player_list', Object.values(players)); checkGameStart(); }
  });

  socket.on('client_movement', (data) => {
      if (!players[socket.id] || !gameInProgress || players[socket.id].isDead || players[socket.id].isEscaped) return;
      const p = players[socket.id];
      const dx = data.x - p.x; const dy = data.y - p.y;
      if (Math.sqrt(dx * dx + dy * dy) > 100 || checkWallCollision(data.x, data.y)) {
          socket.emit('server_correction', { x: p.x, y: p.y });
      } else { p.x = data.x; p.y = data.y; }
  });

  // KILL MECHANIC
  socket.on('request_kill', () => {
      const killer = players[socket.id];
      if (!killer || killer.role !== 'Killer' || !gameInProgress) return;

      const now = Date.now();
      if (killer.lastKillTime && now - killer.lastKillTime < 20000) return; 

      let target = null; let closestDist = 60; 
      Object.values(players).forEach(p => {
          if (p.role === 'Crewmate' && !p.isDead && !p.isEscaped) {
              const dist = Math.sqrt(Math.pow(killer.x - p.x, 2) + Math.pow(killer.y - p.y, 2));
              if (dist < closestDist) { closestDist = dist; target = p; }
          }
      });

      if (target) {
          target.isDead = true; killer.lastKillTime = now;
          while (killer.inventory.length < 3) { drawCard(killer); }

          io.emit('player_died', target.id);
          socket.emit('inventory_update', killer.inventory.map(c => CARD_DB[c]));
          socket.emit('kill_cooldown_started', 20000);
          evaluateWinCondition();
      }
  });

  socket.on('task_completed', (taskId) => {
      const p = players[socket.id];
      if (!p || p.role === 'Killer' || p.isDead || escapePhaseActive) return; 
      if (activeGlobalEffects['grid_overload']) return;
      
      tasksCompleted++;
      io.emit('task_progress_update', (tasksCompleted / totalTaskTarget) * 100);
      drawCard(p); socket.emit('inventory_update', p.inventory.map(c => CARD_DB[c]));

      // NEW: Trigger Escape Phase instead of Game Over
      if (tasksCompleted >= totalTaskTarget) {
          escapePhaseActive = true;
          io.emit('escape_phase_started');
          io.emit('system_message', "ALL TASKS COMPLETE. ESCAPE PODS ONLINE.");
          
          // Give killer a full hand to aid in stopping the escape
          const killerId = Object.keys(players).find(id => players[id].role === 'Killer');
          if (killerId && players[killerId]) {
              while (players[killerId].inventory.length < 3) drawCard(players[killerId]);
              io.to(killerId).emit('inventory_update', players[killerId].inventory.map(c => CARD_DB[c]));
          }
      }
  });

  // NEW: Escape Pod Mechanics
  socket.on('start_pod_channel', () => {
      if (activeGlobalEffects['pod_lockdown']) return;
      // Alert the killer that a pod is being boarded
      const killerId = Object.keys(players).find(id => players[id].role === 'Killer');
      if (killerId) io.to(killerId).emit('killer_pod_alert', true);
  });

  socket.on('cancel_pod_channel', () => {
      const killerId = Object.keys(players).find(id => players[id].role === 'Killer');
      if (killerId) io.to(killerId).emit('killer_pod_alert', false);
  });

  socket.on('pod_escaped', () => {
      const p = players[socket.id];
      if (!p || p.role !== 'Crewmate' || p.isDead || activeGlobalEffects['pod_lockdown']) return;
      
      p.isEscaped = true;
      io.emit('system_message', `${p.name} HAS ESCAPED!`);
      socket.emit('player_escaped_success');
      
      // Stop the killer alert just in case
      const killerId = Object.keys(players).find(id => players[id].role === 'Killer');
      if (killerId) io.to(killerId).emit('killer_pod_alert', false);

      evaluateWinCondition();
  });

  socket.on('play_card', (cardIndex) => {
      const p = players[socket.id];
      if (!p || !gameInProgress || p.isDead) return;
      const now = Date.now();
      if (now - p.lastCardPlayTime < 10000) return; 
      if (cardIndex >= 0 && cardIndex < p.inventory.length) {
          const cardId = p.inventory[cardIndex]; const cardData = CARD_DB[cardId];
          p.inventory.splice(cardIndex, 1); p.lastCardPlayTime = now;
          activeGlobalEffects[cardId] = now + cardData.duration;
          
          socket.emit('inventory_update', p.inventory.map(c => CARD_DB[c]));
          socket.emit('card_cooldown_started', 10000);

          setTimeout(() => { if (activeGlobalEffects[cardId] && Date.now() >= activeGlobalEffects[cardId]) { delete activeGlobalEffects[cardId]; } }, cardData.duration);
      }
  });

  socket.on('discard_card', (cardIndex) => {
      const p = players[socket.id];
      if (!p || !gameInProgress || p.role !== 'Killer') return;
      if (cardIndex >= 0 && cardIndex < p.inventory.length) {
          p.inventory.splice(cardIndex, 1);
          socket.emit('inventory_update', p.inventory.map(c => CARD_DB[c]));
      }
  });

  socket.on('disconnect', (reason) => {
      if (players[socket.id]) {
          const p = players[socket.id];
          const wasKiller = p.role === 'Killer'; const wasCrewmate = p.role === 'Crewmate';
          delete players[socket.id]; 

          if (!gameInProgress) {
              io.emit('update_player_list', Object.values(players)); checkGameStart(); 
          } else {
              if (wasKiller) {
                  io.emit('game_over', { winner: 'Crewmates', reason: 'The Killer disconnected.' }); resetGame();
              } else if (wasCrewmate) {
                  evaluateWinCondition(); // Re-evaluate in case they were the last one
                  
                  if (!p.isDead && !p.isEscaped && !escapePhaseActive) {
                      totalTaskTarget = Math.max(1, totalTaskTarget - GAME_TASKS.length);
                  }
                  io.emit('task_progress_update', (tasksCompleted / totalTaskTarget) * 100);
                  io.emit('system_message', `${p.name} disconnected.`);
              }
          }
      }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`Sabotage server running on port ${PORT}`); });