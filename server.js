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

// --- CONSTANTS & MAP DATA ---
const MAP_SIZE = 2000; 
const TICK_RATE = 1000 / 20; 

// NEW: The Physical Walls of the Spaceship
const MAP_WALLS = [
    // Outer Borders (40px thick)
    { x: 0, y: 0, w: 2000, h: 40 },
    { x: 0, y: 1960, w: 2000, h: 40 },
    { x: 0, y: 0, w: 40, h: 2000 },
    { x: 1960, y: 0, w: 40, h: 2000 },

    // Center Hub Room (800,800 to 1200,1200)
    { x: 800, y: 800, w: 150, h: 40 },  // Top Left
    { x: 1050, y: 800, w: 150, h: 40 }, // Top Right (Door at 950-1050)
    { x: 800, y: 1160, w: 150, h: 40 }, // Bottom Left
    { x: 1050, y: 1160, w: 150, h: 40 },// Bottom Right
    { x: 800, y: 800, w: 40, h: 150 },  // Left Top
    { x: 800, y: 1050, w: 40, h: 150 }, // Left Bottom
    { x: 1160, y: 800, w: 40, h: 150 }, // Right Top
    { x: 1160, y: 1050, w: 40, h: 150 },// Right Bottom

    // North-West Room (200, 200 to 600, 600)
    { x: 200, y: 200, w: 400, h: 40 },  
    { x: 200, y: 600, w: 150, h: 40 },  
    { x: 450, y: 600, w: 150, h: 40 },  
    { x: 200, y: 200, w: 40, h: 400 },  
    { x: 560, y: 200, w: 40, h: 150 },  
    { x: 560, y: 450, w: 40, h: 150 },  

    // North-East Room (1400, 200 to 1800, 600)
    { x: 1400, y: 200, w: 400, h: 40 }, 
    { x: 1400, y: 600, w: 150, h: 40 }, 
    { x: 1650, y: 600, w: 150, h: 40 }, 
    { x: 1760, y: 200, w: 40, h: 400 }, 
    { x: 1400, y: 200, w: 40, h: 150 }, 
    { x: 1400, y: 450, w: 40, h: 150 }, 

    // South-West Room (200, 1400 to 600, 1800)
    { x: 200, y: 1760, w: 400, h: 40 }, 
    { x: 200, y: 1400, w: 150, h: 40 }, 
    { x: 450, y: 1400, w: 150, h: 40 }, 
    { x: 200, y: 1400, w: 40, h: 400 }, 
    { x: 560, y: 1400, w: 40, h: 150 }, 
    { x: 560, y: 1650, w: 40, h: 150 }, 

    // South-East Room (1400, 1400 to 1800, 1800)
    { x: 1400, y: 1760, w: 400, h: 40 },
    { x: 1400, y: 1400, w: 150, h: 40 },
    { x: 1650, y: 1400, w: 150, h: 40 },
    { x: 1760, y: 1400, w: 40, h: 400 },
    { x: 1400, y: 1400, w: 40, h: 150 },
    { x: 1400, y: 1650, w: 40, h: 150 },
    
    // Hallway Obstacle Pillars
    { x: 600, y: 600, w: 100, h: 100 },
    { x: 1300, y: 600, w: 100, h: 100 },
    { x: 600, y: 1300, w: 100, h: 100 },
    { x: 1300, y: 1300, w: 100, h: 100 },
];

const GAME_TASKS = [
    { id: 'task_1', type: 'wiring', name: 'Fix North Power Routing', x: 1000, y: 300 },
    { id: 'task_2', type: 'download', name: 'Download Nav Data', x: 1600, y: 400 },
    { id: 'task_3', type: 'keypad', name: 'Override Security', x: 1600, y: 1600 },
    { id: 'task_4', type: 'primer', name: 'Prime Shields', x: 400, y: 1600 },
    { id: 'task_5', type: 'wiring', name: 'Fix South O2 Filters', x: 1000, y: 1700 },
    { id: 'task_6', type: 'download', name: 'Sync Database', x: 400, y: 400 },
    { id: 'task_7', type: 'keypad', name: 'Unlock Medbay', x: 300, y: 1000 },
    { id: 'task_8', type: 'primer', name: 'Reboot Reactor', x: 1700, y: 1000 },
];

let totalTaskTarget = 0; 
let tasksCompleted = 0;

// NEW: Server-Side Collision Check Math
function checkWallCollision(x, y) {
    const radius = 15; // Player radius
    for (let wall of MAP_WALLS) {
        let testX = x;
        let testY = y;
        
        if (x < wall.x) testX = wall.x; 
        else if (x > wall.x + wall.w) testX = wall.x + wall.w; 
        
        if (y < wall.y) testY = wall.y; 
        else if (y > wall.y + wall.h) testY = wall.y + wall.h; 
        
        let distX = x - testX;
        let distY = y - testY;
        let distance = Math.sqrt((distX*distX) + (distY*distY));
        
        if (distance <= radius) {
            return true; // Hit a wall
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
        
        // Ensure they spawn right in the center Hub Room
        const startX = 1000 + (Math.random() * 40 - 20);
        const startY = 1000 + (Math.random() * 40 - 20);
        
        players[id].x = startX;
        players[id].y = startY;

        io.to(id).emit('game_start', {
            role: players[id].role,
            playersInGame: playerIds.length,
            startX: startX,   
            startY: startY,
            tasks: GAME_TASKS,
            walls: MAP_WALLS // Send geometry to clients
        });
    });

    console.log(`Game started! ${players[killerId].name} is the Killer. Task Target: ${totalTaskTarget}`);
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
        
        // ANTI-CHEAT: Did they move too far OR teleport into a wall?
        const dx = data.x - p.x;
        const dy = data.y - p.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance > 100 || checkWallCollision(data.x, data.y)) {
            // Reject movement and bounce them back to the server's record
            socket.emit('server_correction', { x: p.x, y: p.y });
        } else {
            // Accept movement
            p.x = data.x;
            p.y = data.y;
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