const { RANK_ORDER, CARD_VALUES } = require('../config/constants');

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

module.exports = {
    isStraightFlush,
    isThreeOfAKind,
    calculateScore
};
