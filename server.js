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
let gameLoopInterval = null; // The physics engine loop

// --- CONSTANTS ---
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
const PLAYER_SPEED = 5;
const TICK_RATE = 1000 / 30; // 30 Frames Per Second

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
    
    // Pick 1 random Killer
    const killerIndex = Math.floor(Math.random() * playerIds.length);
    const killerId = playerIds[killerIndex];

    // Assign roles and setup positions
    playerIds.forEach(id => {
        players[id].role = (id === killerId) ? 'Killer' : 'Crewmate';
        
        // Spawn players in the center of the map with a slight random offset
        players[id].x = (CANVAS_WIDTH / 2) + (Math.random() * 40 - 20);
        players[id].y = (CANVAS_HEIGHT / 2) + (Math.random() * 40 - 20);
        
        // Track what keys they are pressing
        players[id].inputs = { up: false, down: false, left: false, right: false };

        // Send a PRIVATE message to this specific socket ID
        io.to(id).emit('game_start', {
            role: players[id].role,
            playersInGame: playerIds.length
        });
    });

    console.log(`Game started! ${players[killerId].name} is the Killer.`);

    // Start the server physics loop
    gameLoopInterval = setInterval(updatePhysics, TICK_RATE);
}

// --- The Core Movement Engine ---
function updatePhysics() {
    const sanitizedPlayers = []; // We use this to hide roles from the network payload

    Object.values(players).forEach(p => {
        // Apply movement based on inputs
        if (p.inputs.up) p.y -= PLAYER_SPEED;
        if (p.inputs.down) p.y += PLAYER_SPEED;
        if (p.inputs.left) p.x -= PLAYER_SPEED;
        if (p.inputs.right) p.x += PLAYER_SPEED;

        // Keep players inside the bounds of the 800x600 map
        p.x = Math.max(10, Math.min(CANVAS_WIDTH - 10, p.x));
        p.y = Math.max(10, Math.min(CANVAS_HEIGHT - 10, p.y));

        // Package safe data to send to clients
        sanitizedPlayers.push({
            id: p.id,
            name: p.name,
            x: p.x,
            y: p.y
            // Notice: 'role' is intentionally left out!
        });
    });

    // Broadcast the new positions to everyone
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
            y: 0,
            inputs: { up: false, down: false, left: false, right: false }
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

    // --- Listen for keyboard inputs from the client ---
    socket.on('player_input', (inputs) => {
        if (players[socket.id] && gameInProgress) {
            players[socket.id].inputs = inputs;
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