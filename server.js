const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

// Initialize Express
const app = express();
app.use(cors());

// Create the HTTP server
const server = http.createServer(app);

// Initialize Socket.io with CORS enabled
const io = new Server(server, {
    cors: {
        origin: "*", // Change to your Netlify URL in production
        methods: ["GET", "POST"]
    }
});

// The core connection listener
io.on('connection', (socket) => {
    console.log(`A player connected: ${socket.id}`);

    // Handle disconnection
    socket.on('disconnect', () => {
        console.log(`Player disconnected: ${socket.id}`);
    });
});

// Render provides a dynamically assigned port, fallback to 3000 for local dev
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Sabotage Escape server running on port ${PORT}`);
});