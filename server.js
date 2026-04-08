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

// EXPANDED TASKS: Spread across the map with new types
const GAME_TASKS = [
    { id: 'task_1', type: 'wiring', name: 'Fix North Power Routing', x: 1000, y: 300 },
    { id: 'task_2', type: 'download', name: 'Download Nav Data', x: 1700, y: 500 },
    { id: 'task_3', type: 'keypad', name: 'Override Security', x: 1500, y: 1500 },
    { id: 'task_4', type: 'primer', name: 'Prime Shields', x: 500, y: 1700 },
    { id: 'task_5', type: 'wiring', name: 'Fix South O2 Filters', x: 1000, y: 1800 },
    { id: 'task_6', type: 'download', name: 'Sync Database', x: 300, y: 1000 },
    { id: 'task_7', type: 'keypad', name: 'Unlock Medbay', x: 300, y: 400 },
    { id: 'task_8', type: 'primer', name: 'Reboot Reactor', x: 1700, y: 1000 },
];

let totalTaskTarget = 0; 
let tasksCompleted = 0;

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

    // Reset Task Progress
    tasksCompleted = 0;
    // Target = (Total Players - 1 Killer) * Number of Tasks
    totalTaskTarget = (playerIds.length - 1) * GAME_TASKS.length;

    playerIds.forEach(id => {
        players[id].role = (id === killerId) ? 'Killer' : 'Crewmate';
        
        const startX = (MAP_SIZE / 2) + (Math.random() * 40 - 20);
        const startY = (MAP_SIZE / 2) + (Math.random() * 40 - 20);
        
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
        const dx = data.x - p.x;
        const dy = data.y - p.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance > 100) {
            socket.emit('server_correction', { x: p.x, y: p.y });
        } else {
            p.x = Math.max(10, Math.min(MAP_SIZE - 10, data.x));
            p.y = Math.max(10, Math.min(MAP_SIZE - 10, data.y));
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