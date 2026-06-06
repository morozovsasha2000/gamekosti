const socket = io();

// Экран лобби
const lobbyScreen = document.getElementById('lobbyScreen');
const nicknameInput = document.getElementById('nicknameInput');
const joinButton = document.getElementById('joinButton');
const startGameButton = document.getElementById('startGameButton');
const lobbyList = document.getElementById('lobbyList');
const lobbyMessage = document.getElementById('lobbyMessage');
const leaderboardBody = document.getElementById('leaderboardBody');

// Экран игры
const gameScreen = document.getElementById('gameScreen');
const playersPanel = document.getElementById('playersPanel');
const boardDiv = document.getElementById('board');
const dice1Div = document.getElementById('dice1');
const dice2Div = document.getElementById('dice2');
const rollButton = document.getElementById('rollButton');
const messageDiv = document.getElementById('message');
const leaveButton = document.getElementById('leaveButton');
const gameOverButtons = document.getElementById('gameOverButtons');
const playAgainButton = document.getElementById('playAgainButton');
const returnToLobbyButton = document.getElementById('returnToLobbyButton');

const PLAYER_COLORS = ['#e74c3c','#3498db','#2ecc71','#f39c12','#9b59b6','#1abc9c'];

let gameState = {
    players: [],
    board: {},
    currentPlayerIndex: 0,
    diceValues: null,
    possibleMoves: [],
    gameOver: false
};

let isHost = false;

// ========== ЛОББИ ==========
joinButton.addEventListener('click', () => {
    const nick = nicknameInput.value.trim();
    if (!nick) { lobbyMessage.textContent = 'Введи ник!'; return; }
    socket.emit('joinLobby', nick);
    joinButton.disabled = true;
    nicknameInput.disabled = true;
    lobbyMessage.textContent = 'Ты в лобби. Ждём игроков...';
    startGameButton.style.display = 'inline-block';
    isHost = true; // первый зашедший — хост
});

socket.on('lobbyUpdate', (players) => {
    lobbyList.innerHTML = '';
    players.forEach(p => {
        const li = document.createElement('li');
        li.textContent = p.nickname + (p.id === socket.id ? ' (ты)' : '');
        lobbyList.appendChild(li);
    });
    // Если хоста нет в лобби, даём возможность стать хостом другому
    if (!players.some(p => p.id === socket.id && isHost)) {
        if (players.length > 0 && players[0].id === socket.id) {
            isHost = true;
            startGameButton.style.display = 'inline-block';
        }
    }
});

startGameButton.addEventListener('click', () => {
    socket.emit('startGame');
});

socket.on('error', (msg) => {
    lobbyMessage.textContent = msg;
});

// Таблица лидеров
socket.on('leaderboardUpdate', (data) => {
    leaderboardBody.innerHTML = '';
    if (data.length === 0) {
        leaderboardBody.innerHTML = '<tr><td colspan="2">Пока нет побед</td></tr>';
        return;
    }
    data.forEach(entry => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${entry.nickname}</td><td>${entry.wins}</td>`;
        leaderboardBody.appendChild(tr);
    });
});

// ========== ПЕРЕХОД В ИГРУ ==========
socket.on('gameStarted', (data) => {
    lobbyScreen.style.display = 'none';
    gameScreen.style.display = 'block';
    gameOverButtons.style.display = 'none';
    gameState.players = data.players;
    gameState.board = data.board;
    gameState.currentPlayerIndex = data.currentPlayerIndex;
    gameState.diceValues = null;
    gameState.possibleMoves = [];
    gameState.gameOver = false;
    messageDiv.textContent = '';
    renderAll();
});

// ========== ВОЗВРАТ В ЛОББИ ==========
socket.on('goToLobby', () => {
    gameScreen.style.display = 'none';
    lobbyScreen.style.display = 'block';
    joinButton.disabled = true;
    nicknameInput.disabled = true;
    startGameButton.style.display = 'inline-block';
    lobbyMessage.textContent = 'Ты в лобби. Ждём игроков...';
});

// ========== БРОСОК ==========
rollButton.addEventListener('click', () => {
    socket.emit('rollDice');
});

socket.on('diceRolled', (data) => {
    gameState.diceValues = data.dice;
    gameState.possibleMoves = data.possibleMoves;
    gameState.currentPlayerIndex = data.currentPlayerIndex;

    const isMyTurn = gameState.players[gameState.currentPlayerIndex]?.id === socket.id;

    if (data.possibleMoves.length === 0 && isMyTurn) {
        messageDiv.textContent = 'Нет доступных клеток. Ход пропущен.';
    } else if (isMyTurn) {
        messageDiv.textContent = `Выпало ${data.dice.dice1} и ${data.dice.dice2}. Выбери клетку.`;
    } else {
        const currentPlayer = gameState.players[gameState.currentPlayerIndex];
        messageDiv.textContent = `Ход игрока ${currentPlayer?.nickname}. Выпало ${data.dice.dice1} и ${data.dice.dice2}.`;
    }

    renderAll();
});

// ========== КЛИК ПО КЛЕТКЕ ==========
boardDiv.addEventListener('click', (e) => {
    const cell = e.target.closest('.cell');
    if (!cell) return;
    const key = parseInt(cell.dataset.key);
    if (gameState.possibleMoves.includes(key)) {
        socket.emit('makeMove', key);
    }
});

// ========== ОБНОВЛЕНИЕ ИГРЫ ==========
socket.on('gameStateUpdate', (data) => {
    gameState.board = data.board;
    gameState.currentPlayerIndex = data.currentPlayerIndex;
    gameState.diceValues = null;
    gameState.possibleMoves = [];

    const currentPlayer = gameState.players[gameState.currentPlayerIndex];
    if (data.lastAction === 'kick') {
        messageDiv.textContent = `Фишка сбита! ${currentPlayer?.nickname}, твой ход${gameState.diceValues?.isDouble ? ' (дубль — бросай ещё)' : ''}.`;
    } else {
        messageDiv.textContent = `Ход игрока ${currentPlayer?.nickname}.`;
    }

    renderAll();
});

// ========== КОНЕЦ ИГРЫ ==========
socket.on('gameOver', (data) => {
    gameState.gameOver = true;
    gameState.board = data.board;
    messageDiv.textContent = `🏆 ${data.winner.nickname} ПОБЕДИЛ!`;
    gameOverButtons.style.display = 'block';
    renderAll();
});

// ========== КНОПКИ ПОСЛЕ ИГРЫ ==========
playAgainButton.addEventListener('click', () => {
    socket.emit('restartGame');
    gameOverButtons.style.display = 'none';
});

returnToLobbyButton.addEventListener('click', () => {
    socket.emit('returnToLobby');
});

// ========== ВЫХОД ==========
leaveButton.addEventListener('click', () => {
    location.reload();
});

// ========== ОТКЛЮЧЕНИЕ ИГРОКА ==========
socket.on('playerDisconnected', (data) => {
    messageDiv.textContent = `${data.nickname} отключился от игры.`;
});

// ========== ОТРИСОВКА ==========
function renderBoard() {
    boardDiv.innerHTML = '';
    for (let r = 1; r <= 6; r++) {
        for (let c = 1; c <= 6; c++) {
            const key = r * 10 + c;
            const cell = document.createElement('div');
            cell.className = 'cell';
            cell.textContent = key;
            cell.dataset.key = key;

            const occupantIndex = gameState.board[key];
            if (occupantIndex !== null && occupantIndex !== undefined) {
                const owner = gameState.players[occupantIndex];
                if (owner) {
                    cell.style.backgroundColor = PLAYER_COLORS[occupantIndex] || '#888';
                    cell.textContent = owner.nickname[0];
                }
            }

            if (gameState.possibleMoves.includes(key)) {
                cell.classList.add('clickable');
            }

            boardDiv.appendChild(cell);
        }
    }
}

function renderPlayers() {
    playersPanel.innerHTML = '';
    gameState.players.forEach((p, i) => {
        const tag = document.createElement('span');
        tag.className = 'player-tag';
        tag.textContent = p.nickname;
        tag.style.backgroundColor = PLAYER_COLORS[i] || '#888';
        if (i === gameState.currentPlayerIndex && !gameState.gameOver) {
            tag.classList.add('active');
        }
        if (p.id === socket.id) {
            tag.classList.add('you');
        }
        playersPanel.appendChild(tag);
    });
}

function renderDice() {
    dice1Div.textContent = gameState.diceValues ? gameState.diceValues.dice1 : '?';
    dice2Div.textContent = gameState.diceValues ? gameState.diceValues.dice2 : '?';
}

function renderAll() {
    renderBoard();
    renderPlayers();
    renderDice();
}
