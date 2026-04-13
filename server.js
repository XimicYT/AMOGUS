const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());

app.get("/health", (req, res) => { res.status(200).json({ status: "ok", message: "Sabotage server is alive!" }); });

const server = http.createServer(app);
const io = new Server(server, {
  path: "/v1/sys/fetch", // Must match the client
  cors: { origin: "*", methods: ["GET", "POST"] },
  transports: ['polling'], // Force the server to only use polling
  pingInterval: 30000,    // Slowed way down (30 seconds) to reduce "heartbeat" noise
  pingTimeout: 15000,
  allowUpgrades: false    // Security measure to keep it on standard HTTP
});
const players = {};
let mapBodies = []; 
let countdownInterval = null;
let gameInProgress = false;
let gameLoopInterval = null;
let activePodChanneler = null; 

const TICK_RATE = 1000 / 20;

const CARD_DB = {
  // ==========================================
  // TIER 1: Frequent disruptions (Sensory & Movement Chaos)
  // ==========================================
  power_flicker: { id: "power_flicker", name: "Power Flicker", tier: 1, duration: 8000, desc: "Map vision rapidly pulses between pitch black and normal." },
  
  identity_theft: { id: "identity_theft", name: "Identity Theft", tier: 1, duration: 12000, desc: "Hides all player names and turns everyone into identical grey blobs." },
  
  door_roulette: { id: "door_roulette", name: "Door Roulette", tier: 1, duration: 10000, desc: "Random doors rapidly slam shut and pop open across the entire map." },
  
  zero_friction: { id: "zero_friction", name: "Zero-G Thrusters", tier: 1, duration: 8000, desc: "Removes floor friction. Everyone slides uncontrollably like they are on ice." },

  tunnel_vision: { id: "tunnel_vision", name: "Tunnel Vision", tier: 1, duration: 10000, desc: "Vision radius shrinks to just 40 pixels, but everyone gets a slight speed boost." },

  color_drain: { id: "color_drain", name: "Color Drain", tier: 1, duration: 15000, desc: "The entire map and all players render in pure grayscale." },

  hyper_sprint: { id: "hyper_sprint", name: "Hyper Sprint", tier: 1, duration: 4000, desc: "Everyone moves at 300% speed. Wall-slamming guaranteed." },

  sonar_ping: { id: "sonar_ping", name: "Sonar System", tier: 1, duration: 12000, desc: "Pitch black map. Vision only returns for a split-second flash every 3 seconds." },

  // ==========================================
  // TIER 2: Game-altering shifts (Highly disorienting)
  // ==========================================
  neural_scramble: { id: "neural_scramble", name: "Neural Scramble", tier: 2, duration: 8000, desc: "Inverts movement keys (W=S, A=D) for all players." },
  
  spatial_shift: { id: "spatial_shift", name: "Spatial Shift", tier: 2, duration: 0, desc: "Instantly teleports every player to a random, scattered coordinate." },
  
  task_shuffle: { id: "task_shuffle", name: "Task Shuffle", tier: 2, duration: 0, desc: "Randomly relocates everyone's uncompleted tasks to new spots." },
  
  blind_panic: { id: "blind_panic", name: "Blind Panic", tier: 2, duration: 8000, desc: "Grants everyone +50% speed, but drops vision to almost zero." },

  time_warp: { id: "time_warp", name: "Time Warp", tier: 2, duration: 10000, desc: "Physics engine runs at double speed. Everything is entirely too fast." },

  drunk_walk: { id: "drunk_walk", name: "Intoxication Protocol", tier: 2, duration: 10000, desc: "Applies a random sine-wave sway to all movement. Walking straight is impossible." },

  stutter_step: { id: "stutter_step", name: "Stutter Step", tier: 2, duration: 12000, desc: "Server lag simulation. Every 2 seconds, all players freeze in place for 0.5 seconds." },

  kinetic_vision: { id: "kinetic_vision", name: "Kinetic Vision", tier: 2, duration: 15000, desc: "Standing still makes you completely blind. You only get vision while moving." }
};

let activeGlobalEffects = {}; 

const MAP_SIZE_W = 5000;
const MAP_SIZE_H = 3000;

const MAP_WALLS = [
  { x: 360, y: 700, w: 40, h: 40 },
  { x: 460, y: 700, w: 40, h: 40 },
  { x: 300, y: 700, w: 60, h: 550 },
  { x: 300, y: 1250, w: 1060, h: 50 },
  { x: 1360, y: 910, w: 50, h: 390 },
  { x: 1360, y: 860, w: 460, h: 50 },
  { x: 1000, y: 350, w: 50, h: 350 },
  { x: 550, y: 100, w: 50, h: 600 },
  { x: 600, y: 100, w: 770, h: 50 },
  { x: 500, y: 700, w: 320, h: 50 },
  { x: 820, y: 700, w: 40, h: 40 },
  { x: 920, y: 700, w: 40, h: 40 },
  { x: 960, y: 700, w: 90, h: 50 },
  { x: 600, y: 500, w: 40, h: 40 },
  { x: 700, y: 500, w: 40, h: 40 },
  { x: 740, y: 500, w: 260, h: 40 },
  { x: 1000, y: 150, w: 40, h: 40 },
  { x: 1000, y: 250, w: 40, h: 40 },
  { x: 1000, y: 290, w: 50, h: 60 },
  { x: 740, y: 300, w: 250, h: 50 },
  { x: 600, y: 310, w: 40, h: 40 },
  { x: 700, y: 310, w: 40, h: 40 },
  { x: 950, y: 300, w: 60, h: 50 },
  { x: 1370, y: 100, w: 180, h: 50 },
  { x: 1500, y: 150, w: 50, h: 450 },
  { x: 1550, y: 500, w: 300, h: 50 },
  { x: 1850, y: 500, w: 300, h: 50 },
  { x: 1960, y: 860, w: 190, h: 50 },
  { x: 650, y: 750, w: 100, h: 300 },
  { x: 1200, y: 450, w: 150, h: 150 },
  { x: 1550, y: 1050, w: 520, h: 50 },
  { x: 1550, y: 1100, w: 50, h: 350 },
  { x: 2070, y: 1050, w: 360, h: 50 },
  { x: 2100, y: 1350, w: 200, h: 50 },
  { x: 1550, y: 1450, w: 50, h: 250 },
  { x: 2100, y: 1400, w: 40, h: 40 },
  { x: 2100, y: 1500, w: 40, h: 40 },
  { x: 1600, y: 1650, w: 550, h: 50 },
  { x: 2100, y: 1540, w: 50, h: 110 },
  { x: 1810, y: 860, w: 180, h: 50 },
  { x: 2110, y: 600, w: 40, h: 40 },
  { x: 2110, y: 700, w: 40, h: 40 },
  { x: 2110, y: 530, w: 40, h: 70 },
  { x: 2110, y: 720, w: 40, h: 140 },
  { x: 0, y: 0, w: 400, h: 50 },
  { x: 0, y: 50, w: 50, h: 550 },
  { x: 50, y: 540, w: 250, h: 60 },
  { x: 350, y: 110, w: 40, h: 40 },
  { x: 350, y: 210, w: 40, h: 40 },
  { x: 350, y: 50, w: 50, h: 60 },
  { x: 350, y: 250, w: 50, h: 100 },
  { x: 0, y: 1650, w: 450, h: 50 },
  { x: 500, y: 1850, w: 400, h: 50 },
  { x: 900, y: 1900, w: 50, h: 320 },
  { x: 850, y: 1900, w: 50, h: 50 },
  { x: 950, y: 2170, w: 310, h: 50 },
  { x: 1200, y: 2220, w: 60, h: 380 },
  { x: 1200, y: 2600, w: 350, h: 50 },
  { x: 1510, y: 2860, w: 40, h: 40 },
  { x: 1510, y: 2960, w: 40, h: 40 },
  { x: 1510, y: 2650, w: 40, h: 210 },
  { x: 460, y: 1710, w: 40, h: 40 },
  { x: 460, y: 1810, w: 40, h: 40 },
  { x: 460, y: 1850, w: 40, h: 50 },
  { x: 450, y: 1650, w: 50, h: 60 },
  { x: 460, y: 1900, w: 50, h: 250 },
  { x: 150, y: 2150, w: 360, h: 50 },
  { x: 200, y: 2210, w: 50, h: 650 },
  { x: 200, y: 2190, w: 50, h: 20 },
  { x: 250, y: 2810, w: 40, h: 40 },
  { x: 350, y: 2810, w: 40, h: 40 },
  { x: 390, y: 2800, w: 560, h: 50 },
  { x: 250, y: 2550, w: 450, h: 50 },
  { x: 900, y: 2220, w: 50, h: 580 },
  { x: 400, y: 2350, w: 500, h: 50 },
  { x: 950, y: 2300, w: 210, h: 50 },
  { x: 800, y: 1450, w: 400, h: 50 },
  { x: 800, y: 1650, w: 400, h: 50 },
  { x: 800, y: 1490, w: 400, h: 160 },
  { x: 1300, y: 1850, w: 300, h: 200 },
  { x: 1550, y: 300, w: 190, h: 200 },
  { x: 1740, y: 300, w: 10, h: 200 },
  { x: 1900, y: 0, w: 50, h: 350 },
  { x: 1950, y: 300, w: 400, h: 50 },
  { x: 2350, y: 300, w: 40, h: 40 },
  { x: 2450, y: 300, w: 40, h: 40 },
  { x: 2490, y: 300, w: 360, h: 50 },
  { x: 2800, y: 0, w: 50, h: 300 },
  { x: 2100, y: 100, w: 50, h: 200 },
  { x: 2550, y: 510, w: 50, h: 400 },
  { x: 2550, y: 900, w: 50, h: 100 },
  { x: 2550, y: 500, w: 710, h: 50 },
  { x: 3220, y: 550, w: 40, h: 40 },
  { x: 3220, y: 650, w: 40, h: 40 },
  { x: 3220, y: 690, w: 40, h: 460 },
  { x: 2550, y: 1000, w: 50, h: 600 },
  { x: 2600, y: 1150, w: 250, h: 50 },
  { x: 2800, y: 700, w: 410, h: 50 },
  { x: 3210, y: 700, w: 10, h: 50 },
  { x: 2800, y: 900, w: 50, h: 250 },
  { x: 2800, y: 760, w: 40, h: 40 },
  { x: 2800, y: 860, w: 40, h: 40 },
  { x: 2800, y: 750, w: 40, h: 10 },
  { x: 2840, y: 750, w: 10, h: 10 },
  { x: 1900, y: 1950, w: 50, h: 850 },
  { x: 1950, y: 1950, w: 950, h: 50 },
  { x: 3900, y: 2300, w: 450, h: 50 },
  { x: 4350, y: 2300, w: 50, h: 50 },
  { x: 4350, y: 2350, w: 50, h: 300 },
  { x: 4360, y: 2650, w: 40, h: 40 },
  { x: 4360, y: 2750, w: 40, h: 40 },
  { x: 4350, y: 2790, w: 50, h: 210 },
  { x: 1910, y: 2800, w: 40, h: 40 },
  { x: 1910, y: 2900, w: 40, h: 40 },
  { x: 1900, y: 2940, w: 50, h: 60 },
  { x: 3150, y: 2100, w: 150, h: 50 },
  { x: 3440, y: 2100, w: 160, h: 50 },
  { x: 3300, y: 2100, w: 40, h: 40 },
  { x: 3400, y: 2100, w: 40, h: 40 },
  { x: 1950, y: 2700, w: 650, h: 50 },
  { x: 3450, y: 2150, w: 50, h: 600 },
  { x: 3650, y: 2800, w: 700, h: 50 },
  { x: 3450, y: 2750, w: 50, h: 100 },
  { x: 3510, y: 2810, w: 40, h: 40 },
  { x: 3610, y: 2810, w: 40, h: 40 },
  { x: 3500, y: 2810, w: 10, h: 40 },
  { x: 2600, y: 2700, w: 650, h: 50 },
  { x: 1950, y: 2940, w: 1150, h: 60 },
  { x: 3260, y: 2750, w: 40, h: 40 },
  { x: 3260, y: 2850, w: 40, h: 40 },
  { x: 3100, y: 2940, w: 200, h: 60 },
  { x: 3260, y: 2890, w: 40, h: 50 },
  { x: 3210, y: 2560, w: 40, h: 40 },
  { x: 3210, y: 2660, w: 40, h: 40 },
  { x: 3210, y: 2200, w: 40, h: 40 },
  { x: 3210, y: 2300, w: 40, h: 40 },
  { x: 3210, y: 2340, w: 40, h: 220 },
  { x: 3210, y: 2150, w: 40, h: 50 },
  { x: 2810, y: 2300, w: 400, h: 40 },
  { x: 1940, y: 2400, w: 260, h: 50 },
  { x: 2500, y: 2500, w: 50, h: 200 },
  { x: 2200, y: 2000, w: 50, h: 250 },
  { x: 1950, y: 2150, w: 200, h: 50 },
  { x: 2600, y: 2140, w: 50, h: 200 },
  { x: 3960, y: 2610, w: 40, h: 40 },
  { x: 4060, y: 2610, w: 40, h: 40 },
  { x: 3500, y: 2600, w: 460, h: 50 },
  { x: 4100, y: 2600, w: 250, h: 50 },
  { x: 4600, y: 2450, w: 200, h: 350 },
  { x: 4050, y: 2100, w: 600, h: 50 },
  { x: 4700, y: 1650, w: 50, h: 250 },
  { x: 3550, y: 1600, w: 50, h: 250 },
  { x: 3550, y: 1550, w: 400, h: 50 },
  { x: 3900, y: 1400, w: 50, h: 150 },
  { x: 3950, y: 1400, w: 40, h: 40 },
  { x: 4050, y: 1400, w: 40, h: 40 },
  { x: 4090, y: 1400, w: 360, h: 50 },
  { x: 4710, y: 1510, w: 40, h: 40 },
  { x: 4710, y: 1610, w: 40, h: 40 },
  { x: 4700, y: 1400, w: 50, h: 110 },
  { x: 4450, y: 1400, w: 250, h: 50 },
  { x: 4250, y: 1450, w: 50, h: 450 },
  { x: 4300, y: 1850, w: 200, h: 50 },
  { x: 3900, y: 1600, w: 50, h: 200 },
  { x: 3950, y: 1800, w: 150, h: 50 },
  { x: 3900, y: 1800, w: 50, h: 50 },
  { x: 3450, y: 1110, w: 300, h: 290 },
  { x: 3550, y: 310, w: 40, h: 40 },
  { x: 3650, y: 310, w: 40, h: 40 },
  { x: 3500, y: 0, w: 50, h: 350 },
  { x: 3690, y: 250, w: 60, h: 100 },
  { x: 3750, y: 250, w: 450, h: 50 },
  { x: 4150, y: 300, w: 50, h: 350 },
  { x: 4150, y: 650, w: 50, h: 260 },
  { x: 4150, y: 900, w: 650, h: 50 },
  { x: 4800, y: 910, w: 40, h: 40 },
  { x: 4900, y: 910, w: 40, h: 40 },
  { x: 4940, y: 900, w: 60, h: 50 },
  { x: 4200, y: 250, w: 100, h: 50 },
  { x: 4300, y: 250, w: 40, h: 40 },
  { x: 4400, y: 250, w: 40, h: 40 },
  { x: 4660, y: 250, w: 40, h: 40 },
  { x: 4760, y: 250, w: 40, h: 40 },
  { x: 4440, y: 250, w: 220, h: 50 },
  { x: 4800, y: 250, w: 200, h: 50 },
  { x: 4500, y: 300, w: 50, h: 370 },
  { x: 4500, y: 630, w: 500, h: 40 },
  { x: 4550, y: 430, w: 330, h: 50 },
  { x: 4890, y: 1080, w: 110, h: 200 },
  { x: 4200, y: 1100, w: 480, h: 180 },
  { x: 4200, y: 1080, w: 480, h: 20 },
  { x: 3550, y: 700, w: 200, h: 410 },
  { x: 3600, y: 550, w: 150, h: 150 },
  { x: 3750, y: 800, w: 100, h: 250 },
  { x: 3250, y: 2700, w: 50, h: 50 },
  // --- Outer Map Borders ---
  { x: 0, y: -50, w: 5000, h: 50 },    // Top border
  { x: 0, y: 3000, w: 5000, h: 50 },   // Bottom border
  { x: -50, y: 0, w: 50, h: 3000 },    // Left border
  { x: 5000, y: 0, w: 50, h: 3000 }    // Right border
];

const MAP_DIAGONALS = [
  { x1: 2400, y1: 1080, x2: 2270, y2: 1380, thick: 40 },
  { x1: 370, y1: 340, x2: 270, y2: 570, thick: 40 },
  { x1: 2580, y1: 1580, x2: 3240, y2: 1130, thick: 40 },
  { x1: 2880, y1: 1980, x2: 3180, y2: 2130, thick: 40 },
  { x1: 3570, y1: 2120, x2: 3930, y2: 2330, thick: 40 },
  { x1: 2830, y1: 2320, x2: 2180, y2: 2430, thick: 40 },
  { x1: 3580, y1: 1820, x2: 4070, y2: 2120, thick: 40 },
  { x1: 4630, y1: 2130, x2: 4720, y2: 1880, thick: 40 },
  { x1: 2980, y1: 1730, x2: 3570, y2: 1580, thick: 40 },
  { x1: 2980, y1: 1730, x2: 3580, y2: 1830, thick: 40 }
];

const MAP_DOORS = [
  { id: 'd_1775820794954', x: 400, y: 710, w: 60, h: 20, isOpen: false, lockedUntil: 0 },
  { id: 'd_1775820862251', x: 860, y: 710, w: 60, h: 20, isOpen: false, lockedUntil: 0 },
  { id: 'd_1775820870576', x: 640, y: 510, w: 60, h: 20, isOpen: false, lockedUntil: 0 },
  { id: 'd_1775820883258', x: 1010, y: 190, w: 20, h: 60, isOpen: false, lockedUntil: 0 },
  { id: 'd_1775820908529', x: 640, y: 320, w: 60, h: 20, isOpen: false, lockedUntil: 0 },
  { id: 'd_1775821195661', x: 2110, y: 1440, w: 20, h: 60, isOpen: false, lockedUntil: 0 },
  { id: 'd_1775821709343', x: 2120, y: 640, w: 20, h: 60, isOpen: false, lockedUntil: 0 },
  { id: 'd_1775821772794', x: 360, y: 150, w: 20, h: 60, isOpen: false, lockedUntil: 0 },
  { id: 'd_1775821895883', x: 1520, y: 2900, w: 20, h: 60, isOpen: false, lockedUntil: 0 },
  { id: 'd_1775821910484', x: 470, y: 1750, w: 20, h: 60, isOpen: false, lockedUntil: 0 },
  { id: 'd_1775821987595', x: 290, y: 2820, w: 60, h: 20, isOpen: false, lockedUntil: 0 },
  { id: 'd_1775822569968', x: 2390, y: 310, w: 60, h: 20, isOpen: false, lockedUntil: 0 },
  { id: 'd_1775822683846', x: 3230, y: 590, w: 20, h: 60, isOpen: false, lockedUntil: 0 },
  { id: 'd_1775822767951', x: 2810, y: 800, w: 20, h: 60, isOpen: false, lockedUntil: 0 },
  { id: 'd_1775822840149', x: 4370, y: 2690, w: 20, h: 60, isOpen: false, lockedUntil: 0 },
  { id: 'd_1775822851098', x: 1920, y: 2840, w: 20, h: 60, isOpen: false, lockedUntil: 0 },
  { id: 'd_1775822881969', x: 3340, y: 2110, w: 60, h: 20, isOpen: false, lockedUntil: 0 },
  { id: 'd_1775822921528', x: 3550, y: 2820, w: 60, h: 20, isOpen: false, lockedUntil: 0 },
  { id: 'd_1775822977229', x: 3270, y: 2790, w: 20, h: 60, isOpen: false, lockedUntil: 0 },
  { id: 'd_1775823017483', x: 3220, y: 2600, w: 20, h: 60, isOpen: false, lockedUntil: 0 },
  { id: 'd_1775823020631', x: 3220, y: 2240, w: 20, h: 60, isOpen: false, lockedUntil: 0 },
  { id: 'd_1775823138334', x: 4000, y: 2620, w: 60, h: 20, isOpen: false, lockedUntil: 0 },
  { id: 'd_1775823307330', x: 3990, y: 1410, w: 60, h: 20, isOpen: false, lockedUntil: 0 },
  { id: 'd_1775823343030', x: 4720, y: 1550, w: 20, h: 60, isOpen: false, lockedUntil: 0 },
  { id: 'd_1775823795642', x: 3590, y: 320, w: 60, h: 20, isOpen: false, lockedUntil: 0 },
  { id: 'd_1775823827826', x: 4840, y: 920, w: 60, h: 20, isOpen: false, lockedUntil: 0 },
  { id: 'd_1775823843592', x: 4340, y: 260, w: 60, h: 20, isOpen: false, lockedUntil: 0 },
  { id: 'd_1775823846800', x: 4700, y: 260, w: 60, h: 20, isOpen: false, lockedUntil: 0 }
];

const GAME_TASKS = [
  { id: 't1', type: 'wiring', name: 'Wiring', x: 930, y: 430 },
  { id: 't2', type: 'asteroid_defense', name: 'Weapons', x: 2200, y: 1200 },
  { id: 't3', type: 'keypad', name: 'Prime Shields', x: 1470, y: 970 },
  { id: 't4', type: 'primer', name: 'Start Generator', x: 170, y: 470 },
  { id: 't5', type: 'download', name: 'Download', x: 580, y: 1970 },
  { id: 't6', type: 'wiring', name: 'Wiring', x: 150, y: 2550 },
  { id: 't7', type: 'slider_calibration', name: 'Fix Breaker', x: 1050, y: 2100 },
  { id: 't8', type: 'keypad', name: 'Prime Shields', x: 2020, y: 220 },
  { id: 't9', type: 'asteroid_defense', name: 'Asteroids', x: 2680, y: 1380 },
  { id: 't10', type: 'download', name: 'Download', x: 4270, y: 2930 },
  { id: 't11', type: 'wiring', name: 'Fix Wiring', x: 2600, y: 2820 },
  { id: 't12', type: 'simon_says', name: 'Prime Servers', x: 2430, y: 2630 },
  { id: 't13', type: 'primer', name: 'Prime Shields', x: 3600, y: 2270 },
  { id: 't14', type: 'primer', name: 'Prime Shields', x: 4350, y: 1800 },
  { id: 't15', type: 'simon_says', name: 'Prime Servers', x: 4600, y: 550 },
  { id: 't16', type: 'simon_says', name: 'Prime Servers', x: 4600, y: 550 }
];

const ESCAPE_PODS = [
  { id: 'pod_1775823414102', x: 4880, y: 2890, name: 'POD ALPHA' },
  { id: 'pod_1775823790675', x: 3230, y: 100, name: 'POD BETA' },
  { id: 'pod_1775823942745', x: 70, y: 1480, name: 'POD OMEGA' }
];

const SPAWN_POINTS = [
  { x: 140, y: 970 },
  { x: 1740, y: 2860 },
  { x: 4900, y: 2280 },
  { x: 2590, y: 1800 },
  { x: 1730, y: 150 }
];

// ==========================================

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
    
    // 1. Shuffle player IDs so the same person isn't always at Spawn #1
    const shuffledIds = [...playerIds].sort(() => Math.random() - 0.5);
    
    // 2. Pick a random Killer from the shuffled list
    const killerId = shuffledIds[Math.floor(Math.random() * shuffledIds.length)];

    shuffledIds.forEach((id, index) => {
        const p = players[id];
        p.role = (id === killerId) ? 'Killer' : 'Crewmate';
        p.inventory = []; 
        p.lastCardPlayTime = 0;
        p.isDead = false; 
        p.isEscaped = false; 
        
        // --- SPAWN LOGIC ---
        const spawn = SPAWN_POINTS[index % SPAWN_POINTS.length];
        
        // Add a ±20px random jitter so players aren't perfectly stacked on top of each other
        p.x = spawn.x + (Math.random() * 40 - 20);
        p.y = spawn.y + (Math.random() * 40 - 20);
        // -------------------

        let assignedTasks = [];
        if (p.role === 'Crewmate') {
            let shuffledTasks = [...GAME_TASKS].sort(() => 0.5 - Math.random());
            assignedTasks = shuffledTasks.slice(0, Math.min(4, GAME_TASKS.length));
            p.tasksLeft = assignedTasks.length;
        } else {
            // Give the killer their starting hand
            drawCard(p); drawCard(p); drawCard(p);
            p.lastKillTime = Date.now();
        }
        
        // 3. Send the starting data to the specific player
        io.to(id).emit('game_start', { 
            role: p.role, 
            playersInGame: playerIds.length, 
            startX: p.x, 
            startY: p.y, 
            tasks: assignedTasks, 
            walls: MAP_WALLS, 
            diagonals: MAP_DIAGONALS 
        });

        io.to(id).emit('inventory_update', p.inventory.map(c => CARD_DB[c]));

        if (p.role === 'Killer') {
            io.to(id).emit('kill_cooldown_started', 20000);
        }
    });

    gameLoopInterval = setInterval(broadcastState, TICK_RATE);
}

function broadcastState() {
  let now = Date.now();
  
  MAP_DOORS.forEach(d => {
      d.isLocked = (now < d.lockedUntil);
      if (d.isLocked) {
          d.isOpen = false;
      } else {
          let playerNear = Object.values(players).some(p => {
              if (p.isDead || p.isEscaped) return false;
              let pad = 150; 
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

function circleRectCollide(cx, cy, cr, rx, ry, rw, rh) {
    let testX = cx; let testY = cy;
    if (cx < rx) testX = rx; else if (cx > rx + rw) testX = rx + rw;
    if (cy < ry) testY = ry; else if (cy > ry + rh) testY = ry + rh;
    let distX = cx - testX; let distY = cy - testY;
    return (Math.sqrt((distX*distX) + (distY*distY)) <= cr);
}

function circleLineCollide(cx, cy, cr, x1, y1, x2, y2, thick) {
    let l2 = (x2 - x1)*(x2 - x1) + (y2 - y1)*(y2 - y1);
    if (l2 === 0) return Math.hypot(cx - x1, cy - y1) <= cr + thick/2;
    let t = ((cx - x1)*(x2 - x1) + (cy - y1)*(y2 - y1)) / l2;
    t = Math.max(0, Math.min(1, t));
    let projX = x1 + t * (x2 - x1);
    let projY = y1 + t * (y2 - y1);
    return Math.hypot(cx - projX, cy - projY) <= cr + thick/2;
}

function checkWallCollision(x, y, radius = 15) {
  for (let wall of MAP_WALLS) {
      if (circleRectCollide(x, y, radius, wall.x, wall.y, wall.w, wall.h)) return true;
  }
  for (let diag of MAP_DIAGONALS) {
      if (circleLineCollide(x, y, radius, diag.x1, diag.y1, diag.x2, diag.y2, diag.thick)) return true;
  }
  for (let door of MAP_DOORS) {
      if (!door.isOpen) {
          if (circleRectCollide(x, y, radius, door.x, door.y, door.w, door.h)) return true;
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
          // ==========================================
          // --- NEW SERVER-SIDE CARD LOGIC ---
          // ==========================================
          else if (cardId === 'spatial_shift') {
              // Teleport everyone to random spots within map bounds
              Object.values(players).forEach(p => {
                  if (!p.isDead && !p.isEscaped) {
                      p.x = 200 + Math.random() * (MAP_SIZE_W - 400);
                      p.y = 200 + Math.random() * (MAP_SIZE_H - 400);
                  }
              });
              io.emit('system_message', 'ANOMALY: SPATIAL SHIFT DETECTED');
          }
          else if (cardId === 'task_shuffle') {
              const crewIds = Object.keys(players).filter(id => players[id].role === 'Crewmate' && !players[id].isDead && !players[id].isEscaped);
              crewIds.forEach(id => {
                  // Tell client to clear their current task array
                  io.to(id).emit('wipe_tasks'); 
                  
                  // Issue brand new tasks based on how many they had left
                  for(let i = 0; i < players[id].tasksLeft; i++) {
                      const baseTask = GAME_TASKS[Math.floor(Math.random() * GAME_TASKS.length)];
                      const taskInstance = { ...baseTask, id: 'task_' + Math.floor(Math.random()*100000) };
                      io.to(id).emit('add_new_task', taskInstance);
                  }
              });
              io.emit('system_message', 'WARNING: TASK MANIFEST CORRUPTED');
          }
          else if (cardId === 'door_roulette') {
              activeGlobalEffects[cardId] = now + cardData.duration;
              io.emit('system_message', 'WARNING: DOOR CONTROL FAILURE');
              
              // Server rapid-fires random door states while the effect lasts
              const rouletteInt = setInterval(() => {
                  if (!activeGlobalEffects[cardId]) { 
                      clearInterval(rouletteInt); 
                      return; 
                  }
                  MAP_DOORS.forEach(d => d.isOpen = Math.random() > 0.5);
              }, 600); // Shuffles every 0.6 seconds
          }
          // ==========================================
          else {
              // This catches ALL other cards (zero_friction, color_drain, etc.)
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