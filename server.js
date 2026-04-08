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
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// --- NEW: Game State ---
// We will store players here. Key = socket.id, Value = Player Object
const players = {};
// -----------------------

io.on('connection', (socket) => {
    console.log(`A player connected: ${socket.id}`);

    // --- NEW: Handle player joining the lobby ---
    socket.on('join_lobby', (playerName) => {
        // Create a new player object
        players[socket.id] = {
            id: socket.id,
            name: playerName || `Player_${Math.floor(Math.random() * 1000)}`,
            isReady: false,
            role: null // 'killer' or 'crewmate' (assigned later)
        };

        console.log(`${players[socket.id].name} joined the lobby.`);

        // Broadcast the updated player list to ALL connected clients
        io.emit('update_player_list', Object.values(players));
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        console.log(`Player disconnected: ${socket.id}`);
        
        // --- NEW: Remove player and update everyone ---
        if (players[socket.id]) {
            delete players[socket.id];
            io.emit('update_player_list', Object.values(players));
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Sabotage Escape server running on port ${PORT}`);
});