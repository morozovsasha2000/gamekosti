const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const games = {};
const playersInLobby = [];

// Таблица лидеров (счётчик побед) — храним по id игрока
const leaderboard = {};

io.on('connection', (socket) => {
    console.log('Игрок подключился:', socket.id);

    // Присоединение к лобби
    socket.on('joinLobby', (nickname) => {
        socket.nickname = nickname;
        playersInLobby.push({ id: socket.id, nickname: nickname });

        // Добавляем в таблицу лидеров, если ещё нет
        if (!leaderboard[socket.id]) {
            leaderboard[socket.id] = { nickname: nickname, wins: 0 };
        }

        io.emit('lobbyUpdate', playersInLobby);
        io.emit('leaderboardUpdate', getLeaderboardData());
    });

    // Начало игры
    socket.on('startGame', () => {
        if (playersInLobby.length < 2) {
            socket.emit('error', 'Минимум 2 игрока');
            return;
        }

        const roomId = 'game_' + Date.now();
        const gamePlayers = [...playersInLobby];

        const board = {};
        for (let r = 1; r <= 6; r++) {
            for (let c = 1; c <= 6; c++) {
                board[r * 10 + c] = null;
            }
        }

        games[roomId] = {
            players: gamePlayers,
            board: board,
            currentPlayerIndex: 0,
            diceValues: null,
            gameOver: false
        };

        gamePlayers.forEach(p => {
            const s = io.sockets.sockets.get(p.id);
            if (s) {
                s.join(roomId);
                s.roomId = roomId;
            }
        });

        // Очищаем лобби, но запоминаем состав для рестарта
        playersInLobby.length = 0;

        io.to(roomId).emit('gameStarted', {
            players: gamePlayers,
            board: games[roomId].board,
            currentPlayerIndex: 0
        });

        io.emit('lobbyUpdate', playersInLobby);
    });

    // Рестарт игры с теми же игроками
    socket.on('restartGame', () => {
        const roomId = socket.roomId;
        const oldGame = games[roomId];
        if (!oldGame) return;

        const gamePlayers = oldGame.players;

        const board = {};
        for (let r = 1; r <= 6; r++) {
            for (let c = 1; c <= 6; c++) {
                board[r * 10 + c] = null;
            }
        }

        games[roomId] = {
            players: gamePlayers,
            board: board,
            currentPlayerIndex: 0,
            diceValues: null,
            gameOver: false
        };

        io.to(roomId).emit('gameStarted', {
            players: gamePlayers,
            board: board,
            currentPlayerIndex: 0
        });
    });

    // Бросок кубиков
    socket.on('rollDice', () => {
        const roomId = socket.roomId;
        const game = games[roomId];
        if (!game || game.gameOver) return;

        const playerIndex = game.players.findIndex(p => p.id === socket.id);
        if (playerIndex !== game.currentPlayerIndex) return;
        if (game.diceValues && !game.diceValues.isDouble) return;

        const d1 = Math.floor(Math.random() * 6) + 1;
        const d2 = Math.floor(Math.random() * 6) + 1;
        game.diceValues = { dice1: d1, dice2: d2, isDouble: d1 === d2 };

        const possibleMoves = getPossibleMoves(game, d1, d2);

        io.to(roomId).emit('diceRolled', {
            dice: game.diceValues,
            possibleMoves: possibleMoves,
            currentPlayerIndex: game.currentPlayerIndex
        });
    });

    // Ход
    socket.on('makeMove', (cellKey) => {
        const roomId = socket.roomId;
        const game = games[roomId];
        if (!game || game.gameOver) return;

        const playerIndex = game.players.findIndex(p => p.id === socket.id);
        if (playerIndex !== game.currentPlayerIndex) return;
        if (!game.diceValues) return;

        const possibleMoves = getPossibleMoves(game, game.diceValues.dice1, game.diceValues.dice2);
        if (!possibleMoves.includes(cellKey)) return;

        const currentOccupant = game.board[cellKey];
        let wasKick = false;

        if (currentOccupant === null) {
            // Пустая клетка
            game.board[cellKey] = playerIndex;

            if (checkWin(game, playerIndex)) {
                game.gameOver = true;
                // Записываем победу
                const winnerId = game.players[playerIndex].id;
                if (leaderboard[winnerId]) {
                    leaderboard[winnerId].wins++;
                }
                io.to(roomId).emit('gameOver', {
                    winner: game.players[playerIndex],
                    board: game.board
                });
                io.emit('leaderboardUpdate', getLeaderboardData());
                return;
            }
        } else if (currentOccupant !== playerIndex) {
            // Чужая клетка — сбиваем, клетка становится пустой
            game.board[cellKey] = null;
            wasKick = true;
        } else {
            return; // своя клетка — ничего не делаем
        }

        // Переход хода
        // ИСПРАВЛЕНИЕ: дубль всегда даёт дополнительный ход, даже при снятии чужой фишки
        if (game.diceValues && game.diceValues.isDouble) {
            // Дубль — игрок ходит ещё раз (бросает заново)
            game.diceValues = null;
        } else {
            // Обычный переход
            game.currentPlayerIndex = (game.currentPlayerIndex + 1) % game.players.length;
            game.diceValues = null;
        }

        io.to(roomId).emit('gameStateUpdate', {
            board: game.board,
            currentPlayerIndex: game.currentPlayerIndex,
            diceValues: null,
            lastAction: wasKick ? 'kick' : 'move'
        });
    });

    // Выход в лобби (после игры)
    socket.on('returnToLobby', () => {
        const roomId = socket.roomId;
        const game = games[roomId];
        if (!game) return;

        // Возвращаем всех игроков в лобби
        game.players.forEach(p => {
            const s = io.sockets.sockets.get(p.id);
            if (s) {
                s.leave(roomId);
                s.roomId = null;
                // Если игрок ещё не в лобби — добавляем
                if (!playersInLobby.find(lp => lp.id === p.id)) {
                    playersInLobby.push({ id: p.id, nickname: p.nickname || leaderboard[p.id]?.nickname || 'Игрок' });
                }
            }
        });

        delete games[roomId];

        io.emit('lobbyUpdate', playersInLobby);
        io.emit('leaderboardUpdate', getLeaderboardData());

        // Отправляем команду вернуться в лобби
        game.players.forEach(p => {
            const s = io.sockets.sockets.get(p.id);
            if (s) {
                s.emit('goToLobby');
            }
        });
    });

    // Отключение
    socket.on('disconnect', () => {
        // Удаляем из лобби
        const lobbyIndex = playersInLobby.findIndex(p => p.id === socket.id);
        if (lobbyIndex !== -1) {
            playersInLobby.splice(lobbyIndex, 1);
            io.emit('lobbyUpdate', playersInLobby);
        }

        // Уведомляем игру, если игрок был в ней
        if (socket.roomId && games[socket.roomId]) {
            io.to(socket.roomId).emit('playerDisconnected', {
                nickname: socket.nickname || 'Игрок'
            });
        }

        console.log('Игрок отключился:', socket.nickname || socket.id);
    });
});

// Вспомогательные функции
function getPossibleMoves(game, d1, d2) {
    const move1 = d1 * 10 + d2;
    const move2 = d2 * 10 + d1;
    const moves = [];
    const playerIndex = game.currentPlayerIndex;

    if (game.board[move1] === null || game.board[move1] !== playerIndex) moves.push(move1);
    if (move1 !== move2 && (game.board[move2] === null || game.board[move2] !== playerIndex)) moves.push(move2);
    return moves;
}

function checkWin(game, playerIndex) {
    const grid = [];
    for (let r = 1; r <= 6; r++) {
        const row = [];
        for (let c = 1; c <= 6; c++) {
            row.push(game.board[r * 10 + c]);
        }
        grid.push(row);
    }
    for (let r = 0; r < 6; r++) {
        for (let c = 0; c < 6; c++) {
            if (grid[r][c] !== playerIndex) continue;
            if (c <= 3 && grid[r][c+1] === playerIndex && grid[r][c+2] === playerIndex) return true;
            if (r <= 3 && grid[r+1][c] === playerIndex && grid[r+2][c] === playerIndex) return true;
            if (r <= 3 && c <= 3 && grid[r+1][c+1] === playerIndex && grid[r+2][c+2] === playerIndex) return true;
            if (r <= 3 && c >= 2 && grid[r+1][c-1] === playerIndex && grid[r+2][c-2] === playerIndex) return true;
        }
    }
    return false;
}

function getLeaderboardData() {
    const data = Object.values(leaderboard)
        .filter(entry => playersInLobby.some(p => p.id === entry.id) || entry.wins > 0)
        .sort((a, b) => b.wins - a.wins);
    return data;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log('Сервер запущен на порту ' + PORT);
});
