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
let countdownInterval = null; // Tracks the pre-game countdown

// --- NEW: Helper function to check if game can start ---
function checkGameStart() {
    const playerArray = Object.values(players);
    const allReady = playerArray.length >= 2 && playerArray.every(p => p.isReady);

    if (allReady) {
        let timeLeft = 5;
        io.emit('countdown_update', `Game starting in ${timeLeft}...`);
        
        countdownInterval = setInterval(() => {
            timeLeft--;
            if (timeLeft > 0) {
                io.emit('countdown_update', `Game starting in ${timeLeft}...`);
            } else {
                clearInterval(countdownInterval);
                io.emit('game_start'); // This will trigger the map load later
            }
        }, 1000);
    } else {
        // If the countdown was running but someone un-readied or left
        if (countdownInterval) {
            clearInterval(countdownInterval);
            countdownInterval = null;
            io.emit('countdown_update', 'Waiting for all players to be ready...');
        }
    }
}
// --------------------------------------------------------

io.on('connection', (socket) => {
    console.log(`A player connected: ${socket.id}`);

    socket.on('join_lobby', (playerName) => {
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