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
    path: '/api/game-data', // THE DISGUISE
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    }
});

const players = {};
let countdownInterval = null;
let gameInProgress = false; 
let gameLoopInterval = null; 

// --- CONSTANTS ---
const MAP_SIZE = 2000; // Expanded Map!
const TICK_RATE = 1000 / 20; // Broadcast 20 times a second

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

// --- Role Assignment & Spawn Logic ---
function startGame() {
    gameInProgress = true;
    const playerIds = Object.keys(players);
    
    const killerIndex = Math.floor(Math.random() * playerIds.length);
    const killerId = playerIds[killerIndex];

    playerIds.forEach(id => {
        players[id].role = (id === killerId) ? 'Killer' : 'Crewmate';
        
        // Spawn players in the center of the 2000x2000 map
        const startX = (MAP_SIZE / 2) + (Math.random() * 40 - 20);
        const startY = (MAP_SIZE / 2) + (Math.random() * 40 - 20);
        
        players[id].x = startX;
        players[id].y = startY;

        io.to(id).emit('game_start', {
            role: players[id].role,
            playersInGame: playerIds.length,
            startX: startX,   // Tell the client exactly where to spawn
            startY: startY
        });
    });

    console.log(`Game started! ${players[killerId].name} is the Killer.`);

    // Start broadcasting state
    gameLoopInterval = setInterval(broadcastState, TICK_RATE);
}

// --- Broadcasting Engine ---
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

    // --- Client-Side Prediction Validator (The Double Check) ---
    socket.on('client_movement', (data) => {
        if (!players[socket.id] || !gameInProgress) return;
        
        const p = players[socket.id];
        
        // Anti-Cheat / Lag Check: Calculate how far they tried to move
        const dx = data.x - p.x;
        const dy = data.y - p.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // If they moved an impossibly large distance instantly (speed hacking or desync)
        if (distance > 100) {
            // REJECT: Force them back to the last known valid server position
            socket.emit('server_correction', { x: p.x, y: p.y });
        } else {
            // ACCEPT: Update the server's official record of their position
            p.x = Math.max(10, Math.min(MAP_SIZE - 10, data.x));
            p.y = Math.max(10, Math.min(MAP_SIZE - 10, data.y));
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