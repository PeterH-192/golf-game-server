const { createDeck, shuffle } = require('./Deck');
const { calculateScore } = require('./Scoring');

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

function sendGameState(room) {
    room.players.forEach((player, idx) => {
        // Build opponents array with their cards - SANITIZED
        const opponents = room.players
            .filter((p, i) => i !== idx)
            .map(p => ({
                name: p.name,
                // sanitize cards to hide suit and rank of face down cards from network
                cards: p.cards.map(c => c.faceUp ? c : { faceUp: false })
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

module.exports = {
    initGame,
    reshuffleDiscardIntoDraw,
    endRound,
    advanceTurn,
    sendGameState
};
