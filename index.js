const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const RANK_ORDER = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const CARD_VALUES = {
  'A': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7,
  '8': 8, '9': 9, '10': 10, 'J': 10, 'Q': 10, 'K': 0, 'JOKER': -2
};

const rooms = new Map();

function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank, faceUp: false });
    }
  }
  // Add 2 jokers
  deck.push({ suit: '🃏', rank: 'JOKER', faceUp: false });
  deck.push({ suit: '🃏', rank: 'JOKER', faceUp: false });
  return shuffle(deck);
}

function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Check if three cards form a straight flush
function isStraightFlush(cards) {
  // Must have exactly 3 valid cards
  if (!cards || cards.length !== 3) return false;
  if (cards.some(c => !c || !c.rank || !c.suit)) return false;
  if (cards.some(c => c.rank === 'JOKER')) return false;

  // Must all be same suit
  const suit = cards[0].suit;
  if (!cards.every(c => c.suit === suit)) return false;

  // Must be consecutive ranks - get indices in RANK_ORDER
  const indices = cards.map(c => RANK_ORDER.indexOf(c.rank));

  // Check all cards have valid ranks
  if (indices.some(i => i === -1)) return false;

  // Sort to check for consecutive sequence
  indices.sort((a, b) => a - b);

  // Check if consecutive (e.g., [4,5,6] or [10,11,12] for J,Q,K)
  return indices[1] === indices[0] + 1 && indices[2] === indices[1] + 1;
}

// Check if three cards are three of a kind
function isThreeOfAKind(cards) {
  // Must have exactly 3 valid cards
  if (!cards || cards.length !== 3) return false;
  if (cards.some(c => !c || !c.rank)) return false;
  if (cards.some(c => c.rank === 'JOKER')) return false;

  return cards[0].rank === cards[1].rank && cards[1].rank === cards[2].rank;
}

function calculateScore(cards) {
  let score = 0;
  const scoredCards = new Set();

  // Check rows (indices: 0-1-2, 3-4-5, 6-7-8)
  const rows = [[0, 1, 2], [3, 4, 5], [6, 7, 8]];
  // Check columns (indices: 0-3-6, 1-4-7, 2-5-8)
  const cols = [[0, 3, 6], [1, 4, 7], [2, 5, 8]];

  const checkLine = (indices) => {
    const lineCards = indices.map(i => cards[i]);
    if (isStraightFlush(lineCards)) {
      indices.forEach(i => scoredCards.add(i));
      return -8; // Straight flush bonus
    }
    if (isThreeOfAKind(lineCards)) {
      indices.forEach(i => scoredCards.add(i));
      return 0; // Three of a kind = 0
    }
    return null;
  };

  // Check all rows and columns for special combinations
  for (const row of rows) {
    const lineScore = checkLine(row);
    if (lineScore !== null) {
      score += lineScore;
    }
  }
  for (const col of cols) {
    const lineScore = checkLine(col);
    if (lineScore !== null) {
      score += lineScore;
    }
  }

  // Add up remaining cards not part of special combinations
  for (let i = 0; i < 9; i++) {
    if (!scoredCards.has(i) && cards[i]) {
      score += CARD_VALUES[cards[i].rank];
    }
  }

  return score;
}

function initGame(room) {
  const deck = createDeck();
  room.drawPile = deck;
  room.discardPile = [];
  room.currentPlayerIndex = 0;
  room.roundOver = false;
  room.scores = {};
  room.selectionPhase = true;
  room.playersReady = new Set();

  // 9 cards per player (3x3 grid)
  room.players.forEach(player => {
    player.cards = room.drawPile.splice(0, 9).map(card => ({
      ...card,
      faceUp: false
    }));
    player.selectedInitialCards = [];
  });

  const firstDiscard = room.drawPile.pop();
  firstDiscard.faceUp = true;
  room.discardPile.push(firstDiscard);
}

function sendGameState(room) {
  room.players.forEach((player, idx) => {
    // Build opponents array with their cards
    const opponents = room.players
      .filter((p, i) => i !== idx)
      .map(p => ({
        name: p.name,
        cards: p.cards
      }));

    const state = {
      players: room.players.map(p => ({ name: p.name, cardCount: p.cards.length })),
      myCards: player.cards,
      opponents: opponents,
      drawPileCount: room.drawPile.length,
      discardPile: room.discardPile,
      currentPlayerIndex: room.currentPlayerIndex,
      myIndex: idx,
      drawnCard: player.drawnCard || null,
      hasDrawnThisTurn: player.hasDrawnThisTurn || false,
      drawnFromDiscard: player.drawnFromDiscard || false,
      mustRevealCard: player.mustRevealCard || false,
      message: room.selectionPhase
        ? (room.playersReady.has(idx)
            ? `Waiting for other players... (${room.playersReady.size}/${room.players.length} ready)`
            : "Select 3 cards to flip!")
        : (room.currentPlayerIndex === idx ? "Your turn!" : `${room.players[room.currentPlayerIndex].name}'s turn`),
      scores: room.scores,
      roundOver: room.roundOver,
      winner: room.winner,
      selectionPhase: room.selectionPhase,
      knocker: room.knocker || null,
      finalRound: room.finalRound || false
    };
    player.socket.emit('gameState', state);
  });
}

// Reshuffle discard pile into draw pile when draw pile is empty
function reshuffleDiscardIntoDraw(room) {
  if (room.drawPile.length > 0 || room.discardPile.length <= 1) {
    return false;
  }

  // Keep the top card in discard, shuffle the rest into draw pile
  const topDiscard = room.discardPile[room.discardPile.length - 1];
  const cardsToShuffle = room.discardPile.slice(0, -1).map(c => ({ ...c, faceUp: false }));

  // Shuffle the cards
  room.drawPile = shuffle(cardsToShuffle);
  room.discardPile = [topDiscard];

  console.log(`Reshuffled ${room.drawPile.length} cards into draw pile`);
  return true;
}

function endRound(room) {
  room.roundOver = true;
  room.finalRound = false;
  room.knocker = null;
  room.playersWithFinalTurn = null;

  room.players.forEach(p => {
    p.cards = p.cards.map(c => ({ ...c, faceUp: true }));
    room.scores[p.name] = calculateScore(p.cards);
  });

  const minScore = Math.min(...Object.values(room.scores));
  const winners = Object.entries(room.scores)
    .filter(([, score]) => score === minScore)
    .map(([name]) => name);
  room.winner = winners.join(', ');
}

function advanceTurn(room) {
  // If in final round, track who has had their final turn
  if (room.finalRound) {
    room.playersWithFinalTurn.add(room.currentPlayerIndex);

    // Check if all players have had their final turn (except knocker who already went)
    if (room.playersWithFinalTurn.size >= room.players.length) {
      endRound(room);
      return;
    }
  }

  room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.players.length;
  room.players[room.currentPlayerIndex].hasDrawnThisTurn = false;
  room.players[room.currentPlayerIndex].drawnCard = null;
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('createRoom', ({ roomCode, playerName }) => {
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

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
