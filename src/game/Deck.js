const { SUITS, RANKS } = require('../config/constants');

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

module.exports = {
    createDeck,
    shuffle
};
