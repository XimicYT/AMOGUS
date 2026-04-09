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
let mapBodies = []; 
let countdownInterval = null;
let gameInProgress = false;
let gameLoopInterval = null;
let activePodChanneler = null; 

const MAP_SIZE = 3000; // 🚪 INCREASED MAP SIZE
const TICK_RATE = 1000 / 20;

const CARD_DB = {
  short_circuit: { id: "short_circuit", name: "Short Circuit", tier: 1, duration: 10000, desc: "Reduce map vision heavily." },
  comms_static: { id: "comms_static", name: "Comms Static", tier: 1, duration: 15000, desc: "Scramble UI & Task Tracking." },
  flashbang: { id: "flashbang", name: "Flashbang", tier: 1, duration: 2000, desc: "Blinds all players, vision slowly returns." },
  adrenaline_surge: { id: "adrenaline_surge", name: "Adrenaline Surge", tier: 1, duration: 5000, desc: "30% speed boost to 50% of players." },
  airlock_seal: { id: "airlock_seal", name: "Airlock Seal", tier: 1, duration: 10000, desc: "Slams and locks all nearby doors." }, // 🚪 NEW CARD
  
  gravity_spike: { id: "gravity_spike", name: "Gravity Spike", tier: 2, duration: 15000, desc: "Reduces movement speed by 50%." },
  grid_overload: { id: "grid_overload", name: "Grid Overload", tier: 2, duration: 15000, desc: "Lock all task interactions map-wide." },
  pod_lockdown: { id: "pod_lockdown", name: "Pod Lockdown", tier: 2, duration: 20000, desc: "Disables Escape Pods for 20 seconds."},
  neural_scramble: { id: "neural_scramble", name: "Neural Scramble", tier: 2, duration: 5000, desc: "Inverts movement keys for all players." },
  task_wipe: { id: "task_wipe", name: "Task Wipe", tier: 2, duration: 0, desc: "Adds 1 task to 50% of Crewmates." }
};

let activeGlobalEffects = {}; 

// 🚪 MASSIVE ASYMMETRICAL MAP
const MAP_WALLS = [
  // Outer Bounds
  { x: 0, y: 0, w: 3000, h: 40 }, { x: 0, y: 2960, w: 3000, h: 40 },
  { x: 0, y: 0, w: 40, h: 3000 }, { x: 2960, y: 0, w: 40, h: 3000 },

  // Center Admin Hub (800x800) with Door Gaps
  { x: 1100, y: 1100, w: 300, h: 40 }, { x: 1600, y: 1100, w: 300, h: 40 }, // Top Wall
  { x: 1100, y: 1860, w: 300, h: 40 }, { x: 1600, y: 1860, w: 300, h: 40 }, // Bottom Wall
  { x: 1100, y: 1140, w: 40, h: 260 }, { x: 1100, y: 1600, w: 40, h: 260 }, // Left Wall
  { x: 1860, y: 1140, w: 40, h: 260 }, { x: 1860, y: 1600, w: 40, h: 260 }, // Right Wall

  // Corner L-Shapes
  { x: 400, y: 400, w: 300, h: 40 }, { x: 400, y: 440, w: 40, h: 260 }, // Top Left
  { x: 2300, y: 400, w: 300, h: 40 }, { x: 2560, y: 440, w: 40, h: 260 }, // Top Right
  { x: 400, y: 2560, w: 300, h: 40 }, { x: 400, y: 2300, w: 40, h: 260 }, // Bottom Left
  { x: 2300, y: 2560, w: 300, h: 40 }, { x: 2560, y: 2300, w: 40, h: 260 }, // Bottom Right

  // LoS Blocking Pillars
  { x: 800, y: 800, w: 100, h: 100 }, { x: 2100, y: 800, w: 100, h: 100 },
  { x: 800, y: 2100, w: 100, h: 100 }, { x: 2100, y: 2100, w: 100, h: 100 },

  // Asymmetric Hallway Dividers
  { x: 800, y: 40, w: 40, h: 400 }, // North-West divider
  { x: 400, y: 850, w: 40, h: 250 }, // Top-Left continuation
  { x: 2160, y: 1480, w: 240, h: 40 }, { x: 2550, y: 1480, w: 410, h: 40 } // Broken East Corridor
];

// 🚪 DYNAMIC DOORS
const MAP_DOORS = [
  { id: 'd_north', x: 1400, y: 1100, w: 200, h: 40, isOpen: false, lockedUntil: 0 },
  { id: 'd_south', x: 1400, y: 1860, w: 200, h: 40, isOpen: false, lockedUntil: 0 },
  { id: 'd_west', x: 1100, y: 1400, w: 40, h: 200, isOpen: false, lockedUntil: 0 },
  { id: 'd_east', x: 1860, y: 1400, w: 40, h: 200, isOpen: false, lockedUntil: 0 },
  { id: 'd_nw', x: 400, y: 700, w: 40, h: 150, isOpen: false, lockedUntil: 0 },
  { id: 'd_e_hall', x: 2400, y: 1480, w: 150, h: 40, isOpen: false, lockedUntil: 0 }
];

const GAME_TASKS = [
  { id: 't1', type: 'wiring', name: 'Admin Route', x: 1500, y: 1500 },
  { id: 't2', type: 'download', name: 'Medbay Data', x: 500, y: 500 },
  { id: 't3', type: 'keypad', name: 'Reactor Sec', x: 2500, y: 2500 },
  { id: 't4', type: 'primer', name: 'Nav Shields', x: 500, y: 2500 },
  { id: 't5', type: 'wiring', name: 'O2 Scrubbers', x: 2500, y: 500 },
  { id: 't6', type: 'download', name: 'Sync DB', x: 1200, y: 400 },
  { id: 't7', type: 'keypad', name: 'Armory Lock', x: 400, y: 1500 },
  { id: 't8', type: 'primer', name: 'Comms Array', x: 2600, y: 1500 },
  { id: 't9', type: 'simon_says', name: 'Core Memory', x: 1500, y: 1800 },
  { id: 't10', type: 'slider_calibration', name: 'Thrusters', x: 1500, y: 1200 },
  { id: 't11', type: 'asteroid_defense', name: 'Asteroids', x: 2000, y: 500 },
  { id: 't12', type: 'simon_says', name: 'Align Sensor', x: 1500, y: 2800 }
];

function drawCard(player) {
  if (player.inventory.length >= 3) return; 
  let hasTier2 = player.inventory.some(cId => CARD_DB[cId].tier === 2);
  let targetTier = (Math.random() < 0.10 && !hasTier2) ? 2 : 1;
  let availableCards = Object.values(CARD_DB).filter(c => c.tier === targetTier);
  let drawn = availableCards[Math.floor(Math.random() * availableCards.length)];
  player.inventory.push(drawn.id);
}

function resetGame() {
  gameInProgress = false;
  activePodChanneler = null;
  mapBodies = [];
  if (gameLoopInterval) { clearInterval(gameLoopInterval); gameLoopInterval = null; }
  activeGlobalEffects = {};
  
  MAP_DOORS.forEach(d => { d.isOpen = false; d.lockedUntil = 0; });

  Object.values(players).forEach(p => {
      p.isReady = false; p.role = null; p.inventory = []; p.isDead = false; p.isEscaped = false; p.lastKillTime = 0; p.tasksLeft = 0;
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
  gameInProgress = true;
  const playerIds = Object.keys(players);
  const killerIndex = Math.floor(Math.random() * playerIds.length);
  const killerId = playerIds[killerIndex];

  playerIds.forEach(id => {
      players[id].role = (id === killerId) ? 'Killer' : 'Crewmate';
      players[id].inventory = []; players[id].lastCardPlayTime = 0;
      players[id].isDead = false; players[id].isEscaped = false; 
      
      let assignedTasks = [];
      if (players[id].role === 'Crewmate') {
          let shuffled = [...GAME_TASKS].sort(() => 0.5 - Math.random());
          assignedTasks = shuffled.slice(0, 4);
          players[id].tasksLeft = assignedTasks.length;
      } else {
          drawCard(players[id]); drawCard(players[id]); drawCard(players[id]);
          players[id].lastKillTime = Date.now();
      }
      
      // Spawn players near the Admin Center
      const startX = 1500 + (Math.random() * 80 - 40); const startY = 1500 + (Math.random() * 80 - 40);
      players[id].x = startX; players[id].y = startY;

      io.to(id).emit('game_start', { role: players[id].role, playersInGame: playerIds.length, startX: startX, startY: startY, tasks: assignedTasks, walls: MAP_WALLS });
      io.to(id).emit('inventory_update', players[id].inventory.map(c => CARD_DB[c]));

      if (players[id].role === 'Killer') {
          io.to(id).emit('kill_cooldown_started', 20000);
      }
  });

  gameLoopInterval = setInterval(broadcastState, TICK_RATE);
}

function broadcastState() {
  let now = Date.now();
  
  // 🚪 CALCULATE DOOR STATES BASED ON PROXIMITY
  MAP_DOORS.forEach(d => {
      d.isLocked = (now < d.lockedUntil);
      if (d.isLocked) {
          d.isOpen = false;
      } else {
          let playerNear = Object.values(players).some(p => {
              if (p.isDead || p.isEscaped) return false;
              let pad = 150; // Proximity sensor range
              return (p.x > d.x - pad && p.x < d.x + d.w + pad && p.y > d.y - pad && p.y < d.y + d.h + pad);
          });
          d.isOpen = playerNear;
      }
  });

  const sanitizedPlayers = Object.values(players).map(p => ({
      id: p.id, name: p.name, x: p.x, y: p.y, isDead: p.isDead, isEscaped: p.isEscaped
  }));
  
  io.emit('game_state_update', { 
      players: sanitizedPlayers, effects: activeGlobalEffects, bodies: mapBodies, 
      activePodLock: activePodChanneler !== null, doors: MAP_DOORS 
  });
}

function evaluateWinCondition() {
    const aliveCrew = Object.values(players).filter(p => p.role === 'Crewmate' && !p.isDead && !p.isEscaped);
    const escapedCrew = Object.values(players).filter(p => p.role === 'Crewmate' && p.isEscaped);
    const deadCrew = Object.values(players).filter(p => p.role === 'Crewmate' && p.isDead);
    const totalCrew = aliveCrew.length + escapedCrew.length + deadCrew.length;

    if (deadCrew.length === totalCrew) {
        io.emit('game_over', { winner: 'Killer', reason: 'All crewmates were eliminated.' });
        resetGame();
        return;
    }

    if (escapedCrew.length > 0) {
        io.emit('game_over', { winner: 'Crewmates', reason: `${escapedCrew.length} Crewmate(s) breached the perimeter!` });
        resetGame();
    }
}

// 🚪 SERVER-SIDE WALL AND DOOR COLLISION
function checkWallCollision(x, y, radius = 15) {
  for (let wall of MAP_WALLS) {
      let testX = x; let testY = y;
      if (x < wall.x) testX = wall.x; else if (x > wall.x + wall.w) testX = wall.x + wall.w; 
      if (y < wall.y) testY = wall.y; else if (y > wall.y + wall.h) testY = wall.y + wall.h; 
      let distX = x - testX; let distY = y - testY;
      if (Math.sqrt((distX*distX) + (distY*distY)) <= radius) return true;
  }
  for (let door of MAP_DOORS) {
      if (!door.isOpen) {
          let testX = x; let testY = y;
          if (x < door.x) testX = door.x; else if (x > door.x + door.w) testX = door.x + door.w; 
          if (y < door.y) testY = door.y; else if (y > door.y + door.h) testY = door.y + door.h; 
          let distX = x - testX; let distY = y - testY;
          if (Math.sqrt((distX*distX) + (distY*distY)) <= radius) return true;
      }
  }
  return false;
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
      if (!players[socket.id] || !gameInProgress || players[socket.id].isEscaped) return;
      const p = players[socket.id];
      const dx = data.x - p.x; const dy = data.y - p.y;
      
      if (p.isDead) { p.x = data.x; p.y = data.y; return; }
      
      if (Math.sqrt(dx * dx + dy * dy) > 150 || checkWallCollision(data.x, data.y)) { 
          socket.emit('server_correction', { x: p.x, y: p.y });
      } else { p.x = data.x; p.y = data.y; }
  });

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
          mapBodies.push({ x: target.x, y: target.y, name: target.name });

          while (killer.inventory.length < 3) { drawCard(killer); }

          io.emit('player_died', target.id);
          socket.emit('inventory_update', killer.inventory.map(c => CARD_DB[c]));
          socket.emit('kill_cooldown_started', 20000);
          evaluateWinCondition();
      }
  });

  socket.on('task_completed', (taskId) => {
      const p = players[socket.id];
      if (!p || p.role === 'Killer' || p.isDead || p.isEscaped) return; 
      if (activeGlobalEffects['grid_overload']) return;
      
      p.tasksLeft = Math.max(0, p.tasksLeft - 1);
      drawCard(p); 
      socket.emit('inventory_update', p.inventory.map(c => CARD_DB[c]));
  });

  socket.on('start_pod_channel', () => {
      const p = players[socket.id];
      if (!p || p.role !== 'Crewmate' || p.tasksLeft > 0 || p.inventory.length > 0) return;
      if (activeGlobalEffects['pod_lockdown']) return;
      
      if (activePodChanneler !== null && activePodChanneler !== socket.id) return;
      activePodChanneler = socket.id;

      const killerId = Object.keys(players).find(id => players[id].role === 'Killer');
      if (killerId) io.to(killerId).emit('killer_pod_alert', true);
  });

  socket.on('cancel_pod_channel', () => {
      if (activePodChanneler === socket.id) activePodChanneler = null; 
      const killerId = Object.keys(players).find(id => players[id].role === 'Killer');
      if (killerId) io.to(killerId).emit('killer_pod_alert', false);
  });

  socket.on('pod_escaped', () => {
      const p = players[socket.id];
      if (!p || p.role !== 'Crewmate' || p.isDead || activeGlobalEffects['pod_lockdown']) return;
      if (p.tasksLeft > 0 || p.inventory.length > 0) return; 
      
      p.isEscaped = true;
      if (activePodChanneler === socket.id) activePodChanneler = null;

      io.emit('system_message', `${p.name} HAS ESCAPED!`);
      socket.emit('player_escaped_success');
      
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
          
          if (cardId === 'adrenaline_surge') {
              const activeIds = Object.keys(players).filter(id => !players[id].isDead);
              const affected = activeIds.sort(() => 0.5 - Math.random()).slice(0, Math.ceil(activeIds.length / 2));
              activeGlobalEffects[cardId] = { expires: now + cardData.duration, affected: affected };
          } 
          else if (cardId === 'task_wipe') {
              const crewIds = Object.keys(players).filter(id => players[id].role === 'Crewmate' && !players[id].isDead && !players[id].isEscaped);
              const affected = crewIds.sort(() => 0.5 - Math.random()).slice(0, Math.ceil(crewIds.length / 2));
              affected.forEach(id => {
                  players[id].tasksLeft++;
                  const baseTask = GAME_TASKS[Math.floor(Math.random() * GAME_TASKS.length)];
                  const taskInstance = { ...baseTask, id: 'task_' + Math.floor(Math.random()*100000) };
                  io.to(id).emit('add_new_task', taskInstance);
              });
              io.emit('system_message', 'WARNING: CRITICAL TASK WIPE DETECTED');
          } 
          // 🚪 AIRLOCK SEAL LOGIC
          else if (cardId === 'airlock_seal') {
              MAP_DOORS.forEach(d => {
                  let cx = d.x + d.w/2; let cy = d.y + d.h/2;
                  if (Math.hypot(p.x - cx, p.y - cy) < 1000) { d.lockedUntil = now + 10000; }
              });
              activeGlobalEffects[cardId] = now + cardData.duration;
              io.emit('system_message', 'WARNING: LOCAL AIRLOCKS SEALED');
          }
          else {
              activeGlobalEffects[cardId] = now + cardData.duration;
          }
          
          socket.emit('inventory_update', p.inventory.map(c => CARD_DB[c]));
          socket.emit('card_cooldown_started', 10000);

          if (cardData.duration > 0) {
              setTimeout(() => { if (activeGlobalEffects[cardId]) { delete activeGlobalEffects[cardId]; } }, cardData.duration);
          }
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
          if (activePodChanneler === socket.id) activePodChanneler = null;
          delete players[socket.id]; 

          if (!gameInProgress) {
              io.emit('update_player_list', Object.values(players)); checkGameStart(); 
          } else {
              if (wasKiller) {
                  io.emit('game_over', { winner: 'Crewmates', reason: 'The Killer disconnected.' }); resetGame();
              } else if (wasCrewmate) {
                  evaluateWinCondition(); 
                  io.emit('system_message', `${p.name} disconnected.`);
              }
          }
      }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`Sabotage server running on port ${PORT}`); });