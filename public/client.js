const socket = io();

const lobbyScreen = document.getElementById('lobbyScreen');
const gameScreen = document.getElementById('gameScreen');
const nicknameInput = document.getElementById('nicknameInput');
const joinButton = document.getElementById('joinButton');
const startGameButton = document.getElementById('startGameButton');
const lobbyList = document.getElementById('lobbyList');
const lobbyMessage = document.getElementById('lobbyMessage');
const playersPanel = document.getElementById('playersPanel');
const boardDiv = document.getElementById('board');
const dice1Div = document.getElementById('dice1');
const dice2Div = document.getElementById('dice2');
const rollButton = document.getElementById('rollButton');
const messageDiv = document.getElementById('message');
const leaveButton = document.getElementById('leaveButton');

const PLAYER_COLORS = ['#e74c3c','#3498db','#2ecc71','#f39c12','#9b59b6','#1abc9c'];

let gameState = {
    players: [],
    board: {},
    currentPlayerIndex: 0,
    diceValues: null,
    possibleMoves: [],
    gameOver: false
};

joinButton.addEventListener('click', () => {
    const nick = nicknameInput.value.trim();
    if (!nick) { lobbyMessage.textContent = 'Введи ник!'; return; }
    socket.emit('joinLobby', nick);
    joinButton.disabled = true;
    nicknameInput.disabled = true;
    lobbyMessage.textContent = 'Ты в лобби. Ждём игроков...';
    startGameButton.style.display = 'inline-block';
});

socket.on('lobbyUpdate', (players) => {
    lobbyList.innerHTML = '';
    players.forEach(p => {
        const li = document.createElement('li');
        li.textContent = p.nickname + (p.id === socket.id ? ' (ты)' : '');
        lobbyList.appendChild(li);
    });
});

startGameButton.addEventListener('click', () => socket.emit('startGame'));
socket.on('error', (msg) => lobbyMessage.textContent = msg);

socket.on('gameStarted', (data) => {
    lobbyScreen.style.display = 'none';
    gameScreen.style.display = 'block';
    gameState.players = data.players;
    gameState.board = data.board;
    gameState.currentPlayerIndex = data.currentPlayerIndex;
    gameState.diceValues = null;
    gameState.possibleMoves = [];
    gameState.gameOver = false;
    renderAll();
});

rollButton.addEventListener('click', () => socket.emit('rollDice'));

socket.on('diceRolled', (data) => {
    gameState.diceValues = data.dice;
    gameState.possibleMoves = data.possibleMoves;
    gameState.currentPlayerIndex = data.currentPlayerIndex;
    const isMyTurn = gameState.players[gameState.currentPlayerIndex]?.id === socket.id;
    if (data.possibleMoves.length === 0 && isMyTurn) {
        messageDiv.textContent = 'Нет доступных клеток. Ход пропущен.';
    } else if (isMyTurn) {
        messageDiv.textContent = 'Выпало ' + data.dice.dice1 + ' и ' + data.dice.dice2 + '. Выбери клетку.';
    }
    renderAll();
});

boardDiv.addEventListener('click', (e) => {
    const cell = e.target.closest('.cell');
    if (!cell) return;
    const key = parseInt(cell.dataset.key);
    if (gameState.possibleMoves.includes(key)) socket.emit('makeMove', key);
});

socket.on('gameStateUpdate', (data) => {
    gameState.board = data.board;
    gameState.currentPlayerIndex = data.currentPlayerIndex;
    gameState.diceValues = null;
    gameState.possibleMoves = [];
    renderAll();
});

socket.on('gameOver', (data) => {
    gameState.gameOver = true;
    gameState.board = data.board;
    messageDiv.textContent = '🏆 ' + data.winner.nickname + ' ПОБЕДИЛ!';
    renderAll();
});

socket.on('playerDisconnected', (data) => {
    messageDiv.textContent = data.nickname + ' отключился.';
});

leaveButton.addEventListener('click', () => location.reload());

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
            if (gameState.possibleMoves.includes(key)) cell.classList.add('clickable');
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
        if (i === gameState.currentPlayerIndex && !gameState.gameOver) tag.classList.add('active');
        if (p.id === socket.id) tag.classList.add('you');
        playersPanel.appendChild(tag);
    });
}

function renderDice() {
    dice1Div.textContent = gameState.diceValues ? gameState.diceValues.dice1 : '?';
    dice2Div.textContent = gameState.diceValues ? gameState.diceValues.dice2 : '?';
}

function renderAll() { renderBoard(); renderPlayers(); renderDice(); }
