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
let gameInProgress = false; // NEW: Prevent new players from joining mid-game

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
                startGame(); // NEW: Call the start game logic
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

// --- NEW: Role Assignment Logic ---
function startGame() {
    gameInProgress = true;
    const playerIds = Object.keys(players);
    
    // Pick 1 random Killer
    const killerIndex = Math.floor(Math.random() * playerIds.length);
    const killerId = playerIds[killerIndex];

    // Assign roles and send private messages
    playerIds.forEach(id => {
        if (id === killerId) {
            players[id].role = 'Killer';
        } else {
            players[id].role = 'Crewmate';
            // Future: Assign 3-7 tasks here based on player count
        }

        // Send a PRIVATE message to this specific socket ID
        io.to(id).emit('game_start', {
            role: players[id].role,
            playersInGame: playerIds.length
        });
    });

    console.log(`Game started! ${players[killerId].name} is the Killer.`);
}
// --------------------------------------------------------

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
            role: null 
        };

        io.emit('update_player_list', Object.values(players));
        checkGameStart(); // Check in case joining altered the state
    });

    // --- NEW: Handle Ready Toggle ---
    socket.on('toggle_ready', () => {
        if (players[socket.id]) {
            players[socket.id].isReady = !players[socket.id].isReady;
            io.emit('update_player_list', Object.values(players));
            checkGameStart(); // Re-evaluate if we should start the timer
        }
    });

    socket.on('disconnect', () => {
        console.log(`Player disconnected: ${socket.id}`);
        if (players[socket.id]) {
            delete players[socket.id];
            io.emit('update_player_list', Object.values(players));
            checkGameStart(); // Re-evaluate if someone leaving broke the ready state
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Sabotage Escape server running on port ${PORT}`);
});