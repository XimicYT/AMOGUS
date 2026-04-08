const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', message: 'Sabotage server is alive!' });
});

const server = http.createServer(app);
const io = new Server(server, {
    path: '/api/game-data', 
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    }
});

const players = {};
let countdownInterval = null;
let gameInProgress = false; 
let gameLoopInterval = null; 

// --- CONSTANTS & MAP GEOMETRY ---
const MAP_SIZE = 2000; 
const TICK_RATE = 1000 / 20; 

// NEW: The Wall Geometry! 
const MAP_WALLS = [
    // Outer Boundaries
    { x: -50, y: -50, w: 2100, h: 50 },
    { x: -50, y: 2000, w: 2100, h: 50 },
    { x: -50, y: 0, w: 50, h: 2000 },
    { x: 2000, y: 0, w: 50, h: 2000 },

    // L-Shaped Corner Rooms (Creates Hallways)
    { x: 200, y: 200, w: 600, h: 200 }, { x: 200, y: 400, w: 200, h: 400 },     // Top Left
    { x: 1200, y: 200, w: 600, h: 200 }, { x: 1600, y: 400, w: 200, h: 400 },   // Top Right
    { x: 200, y: 1600, w: 600, h: 200 }, { x: 200, y: 1200, w: 200, h: 400 },   // Bottom Left
    { x: 1200, y: 1600, w: 600, h: 200 }, { x: 1600, y: 1200, w: 200, h: 400 }, // Bottom Right

    // Center Room Outer Shell (with 4 doors)
    { x: 800, y: 800, w: 150, h: 20 }, { x: 1050, y: 800, w: 150, h: 20 },
    { x: 800, y: 1180, w: 150, h: 20 }, { x: 1050, y: 1180, w: 150, h: 20 },
    { x: 800, y: 800, w: 20, h: 150 }, { x: 800, y: 1050, w: 20, h: 150 },
    { x: 1180, y: 800, w: 20, h: 150 }, { x: 1180, y: 1050, w: 20, h: 150 },

    // 4 Central Pillars (For Cover!)
    { x: 900, y: 900, w: 40, h: 40 }, { x: 1060, y: 900, w: 40, h: 40 },
    { x: 900, y: 1060, w: 40, h: 40 }, { x: 1060, y: 1060, w: 40, h: 40 }
];

// UPDATED: Tasks moved so they are not inside walls!
const GAME_TASKS = [
    { id: 'task_1', type: 'wiring', name: 'Fix North Power Routing', x: 1000, y: 150 },
    { id: 'task_2', type: 'download', name: 'Download Nav Data', x: 1900, y: 500 },
    { id: 'task_3', type: 'keypad', name: 'Override Security', x: 1500, y: 1500 },
    { id: 'task_4', type: 'primer', name: 'Prime Shields', x: 500, y: 1900 },
    { id: 'task_5', type: 'wiring', name: 'Fix South O2 Filters', x: 1000, y: 1850 },
    { id: 'task_6', type: 'download', name: 'Sync Database', x: 100, y: 1000 },
    { id: 'task_7', type: 'keypad', name: 'Unlock Medbay', x: 100, y: 400 },
    { id: 'task_8', type: 'primer', name: 'Reboot Reactor', x: 1900, y: 1000 },
];

let totalTaskTarget = 0; 
let tasksCompleted = 0;

// NEW: Server-Side Collision Helper
function isColliding(playerX, playerY, radius) {
    for (let wall of MAP_WALLS) {
        let testX = playerX;
        let testY = playerY;

        if (playerX < wall.x) testX = wall.x;
        else if (playerX > wall.x + wall.w) testX = wall.x + wall.w;

        if (playerY < wall.y) testY = wall.y;
        else if (playerY > wall.y + wall.h) testY = wall.y + wall.h;

        let distX = playerX - testX;
        let distY = playerY - testY;
        if (Math.sqrt((distX*distX) + (distY*distY)) <= radius) {
            return true;
        }
    }
    return false;
}

function checkGameStart() {
    const playerArray = Object.values(players);
    const allReady = playerArray.length >= 2 && playerArray.every(p => p.isReady);

    if (allReady && !gameInProgress) {
        let timeLeft = 5;
        io.emit('countdown_update', `BREACH IMMINENT IN ${timeLeft}...`);
        
        countdownInterval = setInterval(() => {
            timeLeft--;
            if (timeLeft > 0) {
                io.emit('countdown_update', `BREACH IMMINENT IN ${timeLeft}...`);
            } else {
                clearInterval(countdownInterval);
                startGame(); 
            }
        }, 1000);
    } else {
        if (countdownInterval) {
            clearInterval(countdownInterval);
            countdownInterval = null;
            io.emit('countdown_update', 'WAITING FOR FULL READY STATUS...');
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

    playerIds.forEach(id => {
        players[id].role = (id === killerId) ? 'Killer' : 'Crewmate';
        
        // Spawn players safely inside the center room
        const startX = 1000 + (Math.random() * 40 - 20);
        const startY = 1000 + (Math.random() * 40 - 20);
        
        players[id].x = startX;
        players[id].y = startY;

        io.to(id).emit('game_start', {
            role: players[id].role,
            playersInGame: playerIds.length,
            startX: startX,   
            startY: startY,
            tasks: GAME_TASKS 
        });
    });

    console.log(`Game started! ${players[killerId].name} is the Killer.`);
    gameLoopInterval = setInterval(broadcastState, TICK_RATE);
}

function broadcastState() {
    const sanitizedPlayers = Object.values(players).map(p => ({
        id: p.id,
        name: p.name,
        x: p.x,
        y: p.y
    }));
    io.emit('game_state_update', sanitizedPlayers);
}

io.on('connection', (socket) => {
    console.log(`A player connected: ${socket.id}`);

    socket.on('join_lobby', (playerName) => {
        if (gameInProgress) {
            socket.emit('countdown_update', 'GAME IN PROGRESS. PLEASE WAIT.');
            return;
        }
        players[socket.id] = {
            id: socket.id,
            name: playerName || `Player_${Math.floor(Math.random() * 1000)}`,
            isReady: false,
            role: null,
            x: 0,
            y: 0
        };

        io.emit('update_player_list', Object.values(players));
        checkGameStart(); 
    });

    socket.on('toggle_ready', () => {
        if (players[socket.id]) {
            players[socket.id].isReady = !players[socket.id].isReady;
            io.emit('update_player_list', Object.values(players));
            checkGameStart(); 
        }
    });

    socket.on('client_movement', (data) => {
        if (!players[socket.id] || !gameInProgress) return;
        
        const p = players[socket.id];
        const dx = data.x - p.x;
        const dy = data.y - p.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // Anti-Cheat: Validate distance AND check if they are trying to clip into a wall
        if (distance > 100 || isColliding(data.x, data.y, 15)) {
            socket.emit('server_correction', { x: p.x, y: p.y });
        } else {
            p.x = Math.max(15, Math.min(MAP_SIZE - 15, data.x));
            p.y = Math.max(15, Math.min(MAP_SIZE - 15, data.y));
        }
    });

    socket.on('task_completed', (taskId) => {
        if (!players[socket.id] || players[socket.id].role === 'Killer') return; 
        
        tasksCompleted++;
        const progressPercent = (tasksCompleted / totalTaskTarget) * 100;
        
        io.emit('task_progress_update', progressPercent);

        if (tasksCompleted >= totalTaskTarget) {
            console.log("CREWMATES WIN!");
            io.emit('game_over', { winner: 'Crewmates', reason: 'All tasks completed!' });
        }
    });

    socket.on('disconnect', () => {
        console.log(`Player disconnected: ${socket.id}`);
        if (players[socket.id]) {
            delete players[socket.id];
            io.emit('update_player_list', Object.values(players));
            checkGameStart(); 
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Sabotage Escape server running on port ${PORT}`);
});