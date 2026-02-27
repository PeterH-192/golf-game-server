const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const configureSocketEvents = require('./src/socket/events');

const app = express();
app.use(cors());

// Serve static files from the public directory
app.use(express.static('public'));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

configureSocketEvents(io);

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
