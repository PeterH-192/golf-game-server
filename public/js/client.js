// Initialize Socket
const socket = io();

// DOM Elements - Lobby
const lobbyScreen = document.getElementById('lobby-screen');
const gameScreen = document.getElementById('game-screen');
const playerNameInput = document.getElementById('player-name');
const roomCodeInput = document.getElementById('room-code');
const btnCreate = document.getElementById('btn-create');
const btnJoin = document.getElementById('btn-join');
const waitingArea = document.getElementById('waiting-area');
const displayRoomCode = document.getElementById('display-room-code');
const lobbyPlayersList = document.getElementById('lobby-players');
const btnStart = document.getElementById('btn-start');
const waitingMsg = document.getElementById('waiting-msg');

// DOM Elements - Game
const hudRoom = document.getElementById('hud-room');
const turnIndicator = document.getElementById('turn-indicator');
const actionMessage = document.getElementById('action-message');
const myGrid = document.getElementById('my-grid');
const opponentsContainer = document.getElementById('opponents-container');
const drawPile = document.getElementById('draw-pile');
const discardPile = document.getElementById('discard-pile');
const drawCount = document.getElementById('draw-count');
const myNameDisplay = document.getElementById('my-name');
const btnKnock = document.getElementById('btn-knock');
const roundIndicator = document.getElementById('round-indicator');
const myScoreBadge = document.getElementById('my-score');

const drawnCardContainer = document.getElementById('drawn-card-container');
const drawnCardDisplay = document.getElementById('drawn-card-display');
const btnDiscardDrawn = document.getElementById('btn-discard-drawn');

// End round modal
const endGameModal = document.getElementById('end-game-modal');
const winnerAnnouncement = document.getElementById('winner-announcement');
const finalScoresList = document.getElementById('final-scores-list');
const btnModalNewRound = document.getElementById('btn-modal-new-round');

// State tracking
let myName = '';
let currentGameState = null;
let selectedForOpening = []; // Indices of cards selected to flip at start
let isMyTurnLocal = false;

// --- Notification System ---
function showNotification(msg, isError = false) {
    const container = document.getElementById('notification-container');
    const el = document.createElement('div');
    el.className = `notification ${isError ? 'error' : ''}`;
    el.innerText = msg;
    container.appendChild(el);
    setTimeout(() => {
        el.style.opacity = '0';
        setTimeout(() => el.remove(), 300);
    }, 4000);
}

// --- Card HTML Generator ---
function getCardHTML(card, index = -1, isInteractive = false, context = 'grid') {
    if (!card) return `<div class="card glass-card empty-slot"></div>`;

    let classes = 'card glass-card';
    if (!card.faceUp) classes += ' card-back';
    else if (card.suit === '♥' || card.suit === '♦') classes += ' suit-hearts';
    else classes += ' suit-spades';

    if (isInteractive) classes += ' interactive';
    if (context === 'grid' && selectedForOpening.includes(index)) classes += ' selected';

    let content = '';
    if (card.faceUp) {
        content = `
            <div class="rank-top-left">${card.rank}</div>
            <div class="suit-center">${card.suit}</div>
        `;
    } else {
        content = `<div class="card-inner-pattern"></div>`;
    }

    return `<div class="${classes}" data-index="${index}" data-context="${context}">${content}</div>`;
}

// --- Lobby Interactions ---
btnCreate.addEventListener('click', () => {
    myName = playerNameInput.value.trim() || `Player-${Math.floor(Math.random() * 1000)}`;
    const room = roomCodeInput.value.trim().toUpperCase() || Math.random().toString(36).substring(2, 6).toUpperCase();
    socket.emit('createRoom', { roomCode: room, playerName: myName });
});

btnJoin.addEventListener('click', () => {
    myName = playerNameInput.value.trim();
    if (!myName) return showNotification("Please enter a name", true);
    const room = roomCodeInput.value.trim().toUpperCase();
    if (!room) return showNotification("Please enter a room code", true);
    socket.emit('joinRoom', { roomCode: room, playerName: myName });
});

btnStart.addEventListener('click', () => {
    socket.emit('startGame');
});

// --- Socket Listeners (Lobby) ---
socket.on('error', (msg) => showNotification(msg, true));

socket.on('roomCreated', (data) => {
    document.querySelectorAll('.input-group, .button-group').forEach(el => el.classList.add('hidden'));
    waitingArea.classList.remove('hidden');
    displayRoomCode.innerText = data.roomCode;
    btnStart.classList.remove('hidden'); // Host can start
    waitingMsg.classList.add('hidden');
    lobbyPlayersList.innerHTML = `<li>${myName} (Host)</li>`;
});

socket.on('playerJoined', (data) => {
    document.querySelectorAll('.input-group, .button-group').forEach(el => el.classList.add('hidden'));
    waitingArea.classList.remove('hidden');

    // If we aren't the host (didn't create room), show wait message
    if (btnStart.classList.contains('hidden')) {
        displayRoomCode.innerText = roomCodeInput.value.trim().toUpperCase();
        waitingMsg.classList.remove('hidden');
    }

    lobbyPlayersList.innerHTML = data.players.map(p => `<li>${p}</li>`).join('');
});

// --- Socket Listeners (Game) ---
socket.on('gameState', (state) => {
    const wasLobby = !lobbyScreen.classList.contains('hidden');
    if (wasLobby) {
        lobbyScreen.classList.add('hidden');
        gameScreen.classList.remove('hidden');
        hudRoom.innerText = socket.roomCode || displayRoomCode.innerText;
        myNameDisplay.innerText = myName;
    }

    currentGameState = state;
    isMyTurnLocal = state.currentPlayerIndex === state.myIndex;

    // Update HUD
    turnIndicator.innerText = state.message;
    if (state.selectionPhase) {
        actionMessage.innerText = state.players[state.myIndex].cardCount === 9 && !state.playersReady ? "Flip 3 cards to start" : "";
    } else if (isMyTurnLocal) {
        actionMessage.innerText = state.mustRevealCard ? "Flip a face-down card to finish turn!" : "Draw from deck or discard pile.";
    } else {
        actionMessage.innerText = "";
    }

    // Toggle Knock button visibility
    if (!state.selectionPhase && !state.roundOver && !state.finalRound && isMyTurnLocal && !state.drawnCard && !state.hasDrawnThisTurn) {
        btnKnock.classList.remove('hidden');
    } else {
        btnKnock.classList.add('hidden');
    }

    if (state.finalRound) {
        roundIndicator.classList.remove('hidden');
        roundIndicator.innerText = `Final Round! (Triggered by ${state.knocker})`;
    } else {
        roundIndicator.classList.add('hidden');
    }

    renderTable(state);

    if (state.roundOver) {
        showEndGameModal(state);
    } else {
        endGameModal.classList.add('hidden');
    }
});

// --- Rendering Logic ---
function renderTable(state) {
    // 1. Render Opponents
    opponentsContainer.innerHTML = '';
    state.opponents.forEach((opp, i) => {
        // If opponent is the current active player, highlight their area
        const opponentGlobalIndex = state.players.findIndex(p => p.name === opp.name);
        const isActive = opponentGlobalIndex === state.currentPlayerIndex && !state.selectionPhase;

        const html = `
            <div class="opponent-area">
                <div class="glass-panel ${isActive ? 'active-player-indicator' : ''}">
                    <h4>${opp.name}</h4>
                    <div class="card-grid">
                        ${opp.cards.map((c, i) => getCardHTML(c, i, false, 'opponent')).join('')}
                    </div>
                </div>
            </div>
        `;
        opponentsContainer.innerHTML += html;
    });

    // 2. Render Piles
    drawCount.innerText = state.drawPileCount;
    drawPile.innerHTML = `
        <div class="card card-back glass-card" onclick="handleDrawPileClick()">
            <div class="card-inner-pattern"></div>
        </div>
        <div class="pile-label">Draw Pile</div>
    `;

    // Render Discard Pile
    const topDiscard = state.discardPile.length > 0 ? state.discardPile[state.discardPile.length - 1] : null;
    const discardContainer = document.createElement('div');
    discardContainer.innerHTML = topDiscard ? getCardHTML(topDiscard, -1, false, 'discard') : `<div class="card glass-card empty-slot"></div>`;
    discardContainer.innerHTML += '<div class="pile-label">Discard</div>';
    discardContainer.onclick = handleDiscardPileClick;
    discardPile.innerHTML = '';
    discardPile.appendChild(discardContainer);

    // Render Currently Drawn Card (Floats next to draw pile)
    if (state.drawnCard) {
        drawnCardDisplay.innerHTML = getCardHTML(state.drawnCard, -1, false, 'drawn').replace('class="', 'class="flip '); // add flip animation to inner card
        drawnCardContainer.classList.remove('hidden');

        // Only show discard button if we drew from deck, not from discard pile
        if (!state.drawnFromDiscard) {
            btnDiscardDrawn.classList.remove('hidden');
        } else {
            btnDiscardDrawn.classList.add('hidden');
        }
    } else {
        drawnCardContainer.classList.add('hidden');
    }

    // 3. Render My Grid
    myGrid.innerHTML = state.myCards.map((c, i) => getCardHTML(c, i, true, 'grid')).join('');

    // Attach click listeners to my grid
    document.querySelectorAll('#my-grid .card').forEach(el => {
        el.addEventListener('click', (e) => handleGridCardClick(parseInt(e.currentTarget.dataset.index)));
    });

    // Highlight my panel if it's my turn
    const infoPanel = document.querySelector('.my-player-area .player-info');
    if (isMyTurnLocal && !state.selectionPhase) {
        infoPanel.classList.add('active-player-indicator');
    } else {
        infoPanel.classList.remove('active-player-indicator');
    }

    // Scores
    if (state.scores[myName] !== undefined) {
        myScoreBadge.innerText = `Score: ${state.scores[myName]}`;
        myScoreBadge.classList.remove('hidden');
    }
}

// --- Game Interactions ---

function handleGridCardClick(index) {
    if (!currentGameState) return;

    // Phase 1: Selection Phase (pick 3)
    if (currentGameState.selectionPhase) {
        if (selectedForOpening.includes(index)) {
            selectedForOpening = selectedForOpening.filter(i => i !== index);
        } else if (selectedForOpening.length < 3) {
            selectedForOpening.push(index);
        }

        // Visually update selection without waiting for server
        renderTable(currentGameState);

        if (selectedForOpening.length === 3) {
            socket.emit('selectInitialCards', { cardIndices: selectedForOpening });
            actionMessage.innerText = "Waiting for others to select...";
        }
        return;
    }

    // Phase 2: Player's Turn
    if (!isMyTurnLocal) return;

    if (currentGameState.drawnCard) {
        // Swap drawn card with grid card
        socket.emit('swapCard', { cardIndex: index });
    } else if (currentGameState.mustRevealCard && !currentGameState.myCards[index].faceUp) {
        // Reveal a face down card after discarding
        socket.emit('revealCard', { cardIndex: index });
    }
}

function handleDrawPileClick() {
    if (!currentGameState || !isMyTurnLocal || currentGameState.selectionPhase || currentGameState.drawnCard || currentGameState.hasDrawnThisTurn) return;
    socket.emit('drawFromPile');
}

function handleDiscardPileClick() {
    if (!currentGameState || !isMyTurnLocal || currentGameState.selectionPhase || currentGameState.drawnCard || currentGameState.hasDrawnThisTurn) return;
    if (currentGameState.discardPile.length > 0) {
        socket.emit('drawFromDiscard');
    }
}

btnDiscardDrawn.addEventListener('click', () => {
    socket.emit('discardDrawn');
});

btnKnock.addEventListener('click', () => {
    socket.emit('knock');
});

function showEndGameModal(state) {
    endGameModal.classList.remove('hidden');

    if (state.winner.includes(myName)) {
        winnerAnnouncement.innerText = "🏆 You Won! 🏆";
        winnerAnnouncement.style.color = "var(--success)";
    } else {
        winnerAnnouncement.innerText = `${state.winner} Wins!`;
        winnerAnnouncement.style.color = "var(--text-primary)";
    }

    // Sort scores lowest to highest
    const sortedPlayers = state.players.map(p => ({
        name: p.name,
        score: state.scores[p.name]
    })).sort((a, b) => a.score - b.score);

    finalScoresList.innerHTML = sortedPlayers.map(p => `
        <div class="score-row ${state.winner.includes(p.name) ? 'winner' : ''}">
            <span>${p.name}</span>
            <strong>${p.score} pts</strong>
        </div>
    `).join('');

    // Only host/player 0 can trigger new round for everyone
    if (state.myIndex === 0) {
        btnModalNewRound.classList.remove('hidden');
    } else {
        btnModalNewRound.classList.add('hidden');
        btnModalNewRound.insertAdjacentHTML('afterend', '<p>Waiting for host to start new round...</p>');
    }
}

btnModalNewRound.addEventListener('click', () => {
    socket.emit('newRound');
});
