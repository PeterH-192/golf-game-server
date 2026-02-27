const { rooms } = require('../game/RoomStore');
const { initGame, reshuffleDiscardIntoDraw, advanceTurn, sendGameState } = require('../game/GameLogic');

module.exports = function configureSocketEvents(io) {
    io.on('connection', (socket) => {
        console.log('User connected:', socket.id);

        socket.on('createRoom', ({ roomCode, playerName }) => {
            // Basic validation
            if (typeof roomCode !== 'string' || typeof playerName !== 'string' || !roomCode.trim() || !playerName.trim()) {
                socket.emit('error', 'Invalid room code or player name');
                return;
            }
            roomCode = roomCode.trim().toUpperCase();
            playerName = playerName.trim();

            if (rooms.has(roomCode)) {
                socket.emit('error', 'Room already exists');
                return;
            }
            const room = {
                code: roomCode,
                players: [{ socket, name: playerName, cards: [], selectedInitialCards: [], disconnected: false }],
                drawPile: [],
                discardPile: [],
                currentPlayerIndex: 0,
                started: false,
                selectionPhase: false
            };
            rooms.set(roomCode, room);
            socket.join(roomCode);
            socket.roomCode = roomCode;
            socket.playerName = playerName;
            socket.emit('roomCreated', { roomCode });
            console.log(`Room ${roomCode} created by ${playerName}`);
        });

        socket.on('joinRoom', ({ roomCode, playerName }) => {
            // Basic validation
            if (typeof roomCode !== 'string' || typeof playerName !== 'string' || !roomCode.trim() || !playerName.trim()) {
                socket.emit('error', 'Invalid room code or player name');
                return;
            }
            roomCode = roomCode.trim().toUpperCase();
            playerName = playerName.trim();

            const room = rooms.get(roomCode);
            if (!room) {
                socket.emit('error', 'Room not found');
                return;
            }

            // Check if this player is rejoining (same name, was disconnected)
            const existingPlayerIdx = room.players.findIndex(p => p.name === playerName);

            if (existingPlayerIdx !== -1) {
                // Player is rejoining - update their socket
                const existingPlayer = room.players[existingPlayerIdx];
                existingPlayer.socket = socket;
                existingPlayer.disconnected = false;
                socket.join(roomCode);
                socket.roomCode = roomCode;
                socket.playerName = playerName;

                console.log(`${playerName} rejoined room ${roomCode}`);

                // If game has started, send them the current game state and notify others
                if (room.started) {
                    // Notify other players that this player reconnected
                    socket.to(roomCode).emit('playerReconnected', {
                        playerName: playerName
                    });
                    sendGameState(room);
                } else {
                    io.to(roomCode).emit('playerJoined', {
                        players: room.players.filter(p => !p.disconnected).map(p => p.name)
                    });
                }
                return;
            }

            // New player joining
            if (room.started) {
                socket.emit('error', 'Game already started. Use the same name to rejoin.');
                return;
            }
            if (room.players.length >= 4) {
                socket.emit('error', 'Room is full');
                return;
            }

            room.players.push({ socket, name: playerName, cards: [], selectedInitialCards: [], disconnected: false });
            socket.join(roomCode);
            socket.roomCode = roomCode;
            socket.playerName = playerName;

            io.to(roomCode).emit('playerJoined', {
                players: room.players.filter(p => !p.disconnected).map(p => p.name)
            });
            console.log(`${playerName} joined room ${roomCode}`);
        });

        socket.on('startGame', () => {
            const room = rooms.get(socket.roomCode);
            if (!room || room.players.length < 2) {
                socket.emit('error', 'Need at least 2 players');
                return;
            }
            room.started = true;
            initGame(room);
            sendGameState(room);
        });

        socket.on('selectInitialCards', ({ cardIndices }) => {
            // Basic validation
            if (!Array.isArray(cardIndices) || cardIndices.some(i => typeof i !== 'number' || i < 0 || i > 8)) {
                socket.emit('error', 'Invalid card indices');
                return;
            }

            const room = rooms.get(socket.roomCode);
            if (!room || !room.selectionPhase) return;

            const playerIdx = room.players.findIndex(p => p.socket.id === socket.id);
            if (playerIdx === -1) return;

            if (cardIndices.length !== 3) {
                socket.emit('error', 'Select exactly 3 cards');
                return;
            }

            const player = room.players[playerIdx];
            player.selectedInitialCards = cardIndices;
            room.playersReady.add(playerIdx);

            console.log(`Player ${playerIdx} selected cards. Ready: ${room.playersReady.size}/${room.players.length}`);

            // Check if all players have selected
            if (room.playersReady.size === room.players.length) {
                // Flip selected cards for all players
                room.players.forEach(p => {
                    p.selectedInitialCards.forEach(idx => {
                        p.cards[idx] = { ...p.cards[idx], faceUp: true };
                    });
                });
                room.selectionPhase = false;
                room.playersReady.clear();
            }
            sendGameState(room);
        });

        socket.on('drawFromPile', () => {
            const room = rooms.get(socket.roomCode);
            if (!room || room.selectionPhase || room.roundOver) return;

            const playerIdx = room.players.findIndex(p => p.socket.id === socket.id);
            if (playerIdx !== room.currentPlayerIndex) return;

            const player = room.players[playerIdx];
            if (player.drawnCard || player.hasDrawnThisTurn) return;

            // Reshuffle discard into draw if needed
            if (room.drawPile.length === 0) {
                reshuffleDiscardIntoDraw(room);
            }

            if (room.drawPile.length === 0) {
                socket.emit('error', 'No cards available to draw');
                return;
            }

            const card = room.drawPile.pop();
            card.faceUp = true;
            player.drawnCard = card;
            player.drawnFromDiscard = false; // Track source - can discard this
            player.hasDrawnThisTurn = true;
            sendGameState(room);
        });

        socket.on('drawFromDiscard', () => {
            const room = rooms.get(socket.roomCode);
            if (!room || room.selectionPhase) return;

            const playerIdx = room.players.findIndex(p => p.socket.id === socket.id);
            if (playerIdx !== room.currentPlayerIndex) return;

            const player = room.players[playerIdx];
            if (player.drawnCard || player.hasDrawnThisTurn) return;

            if (room.discardPile.length === 0) return;

            const card = room.discardPile.pop();
            player.drawnCard = card;
            player.drawnFromDiscard = true; // Track source - MUST swap, can't discard
            player.hasDrawnThisTurn = true;
            sendGameState(room);
        });

        socket.on('revealCard', ({ cardIndex }) => {
            if (typeof cardIndex !== 'number' || cardIndex < 0 || cardIndex > 8) {
                socket.emit('error', 'Invalid card index');
                return;
            }

            const room = rooms.get(socket.roomCode);
            if (!room || room.selectionPhase) return;

            const playerIdx = room.players.findIndex(p => p.socket.id === socket.id);
            if (playerIdx !== room.currentPlayerIndex) return;

            const player = room.players[playerIdx];

            // Can only reveal after discarding a drawn card (from draw pile)
            if (!player.mustRevealCard) return;

            if (player.cards[cardIndex].faceUp) {
                socket.emit('error', 'Card already revealed');
                return;
            }

            player.cards[cardIndex] = { ...player.cards[cardIndex], faceUp: true };
            player.mustRevealCard = false;
            player.hasDrawnThisTurn = false;

            advanceTurn(room);
            sendGameState(room);
        });

        socket.on('swapCard', ({ cardIndex }) => {
            if (typeof cardIndex !== 'number' || cardIndex < 0 || cardIndex > 8) {
                socket.emit('error', 'Invalid card index');
                return;
            }

            const room = rooms.get(socket.roomCode);
            if (!room || room.selectionPhase) return;

            const playerIdx = room.players.findIndex(p => p.socket.id === socket.id);
            if (playerIdx !== room.currentPlayerIndex) return;

            const player = room.players[playerIdx];
            if (!player.drawnCard) return;

            const oldCard = player.cards[cardIndex];
            player.cards[cardIndex] = { ...player.drawnCard, faceUp: true };
            oldCard.faceUp = true;
            room.discardPile.push(oldCard);
            player.drawnCard = null;
            player.drawnFromDiscard = false;
            player.hasDrawnThisTurn = false;
            player.mustRevealCard = false;

            advanceTurn(room);
            sendGameState(room);
        });

        socket.on('discardDrawn', () => {
            const room = rooms.get(socket.roomCode);
            if (!room || room.selectionPhase) return;

            const playerIdx = room.players.findIndex(p => p.socket.id === socket.id);
            if (playerIdx !== room.currentPlayerIndex) return;

            const player = room.players[playerIdx];
            if (!player.drawnCard) return;

            // Can only discard if drawn from draw pile, not from discard
            if (player.drawnFromDiscard) {
                socket.emit('error', 'Must swap when taking from discard pile');
                return;
            }

            room.discardPile.push(player.drawnCard);
            player.drawnCard = null;

            // Check if there are any face-down cards to reveal
            const hasFaceDownCards = player.cards.some(c => !c.faceUp);

            if (hasFaceDownCards) {
                // Must reveal a card before turn ends
                player.mustRevealCard = true;
                sendGameState(room);
            } else {
                // No face-down cards, turn is over
                player.hasDrawnThisTurn = false;
                player.mustRevealCard = false;
                advanceTurn(room);
                sendGameState(room);
            }
        });

        socket.on('knock', () => {
            const room = rooms.get(socket.roomCode);
            if (!room || room.selectionPhase || room.roundOver || room.finalRound) return;

            const playerIdx = room.players.findIndex(p => p.socket.id === socket.id);
            if (playerIdx !== room.currentPlayerIndex) return;

            const player = room.players[playerIdx];
            if (player.hasDrawnThisTurn || player.drawnCard) return;

            // Set up final round
            room.knocker = player.name;
            room.finalRound = true;
            room.playersWithFinalTurn = new Set([playerIdx]);

            console.log(`${player.name} knocked! Final round started.`);

            // Move to next player for their final turn
            room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.players.length;
            room.players[room.currentPlayerIndex].hasDrawnThisTurn = false;

            sendGameState(room);
        });

        socket.on('newRound', () => {
            const room = rooms.get(socket.roomCode);
            if (!room) return;

            initGame(room);
            sendGameState(room);
        });

        socket.on('disconnect', () => {
            console.log('User disconnected:', socket.id);
            if (socket.roomCode) {
                const room = rooms.get(socket.roomCode);
                if (room) {
                    const playerIdx = room.players.findIndex(p => p.socket.id === socket.id);

                    if (playerIdx !== -1) {
                        const player = room.players[playerIdx];

                        if (room.started) {
                            // Game in progress - mark as disconnected but don't remove
                            player.disconnected = true;
                            console.log(`${player.name} disconnected from room ${socket.roomCode} (can rejoin)`);

                            // Notify other players
                            io.to(socket.roomCode).emit('playerDisconnected', {
                                playerName: player.name,
                                players: room.players.map(p => ({ name: p.name, disconnected: p.disconnected }))
                            });

                            // Check if all players are disconnected
                            const allDisconnected = room.players.every(p => p.disconnected);
                            if (allDisconnected) {
                                // Delete room after a timeout if no one rejoins
                                setTimeout(() => {
                                    const checkRoom = rooms.get(socket.roomCode);
                                    if (checkRoom && checkRoom.players.every(p => p.disconnected)) {
                                        rooms.delete(socket.roomCode);
                                        console.log(`Room ${socket.roomCode} deleted - all players disconnected`);
                                    }
                                }, 300000); // 5 minutes timeout
                            }
                        } else {
                            // Game hasn't started - remove player completely
                            room.players.splice(playerIdx, 1);
                            if (room.players.length === 0) {
                                rooms.delete(socket.roomCode);
                            } else {
                                io.to(socket.roomCode).emit('playerLeft', {
                                    players: room.players.map(p => p.name)
                                });
                            }
                        }
                    }
                }
            }
        });
    });
};
