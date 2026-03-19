const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Database = require('better-sqlite3');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const db = new Database('database.db');

// Middleware
app.use(cookieParser());
app.use(express.static('frontend'));

// Créer les tables
db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    username TEXT,
    color TEXT,
    x INTEGER DEFAULT 0,
    y INTEGER DEFAULT 0,
    created_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS blocks (
    x INTEGER,
    y INTEGER,
    type TEXT,
    color TEXT,
    player_id TEXT,
    PRIMARY KEY (x, y)
  );

  CREATE TABLE IF NOT EXISTS alliances (
    player1_id TEXT,
    player2_id TEXT,
    created_at INTEGER,
    PRIMARY KEY (player1_id, player2_id)
  );

  CREATE TABLE IF NOT EXISTS pixels (
    x INTEGER,
    y INTEGER,
    color TEXT,
    player_id TEXT,
    PRIMARY KEY (x, y)
  );
`);

// Préparer les requêtes
const getPlayer = db.prepare('SELECT * FROM players WHERE id = ?');
const createPlayer = db.prepare('INSERT INTO players (id, username, color, x, y, created_at) VALUES (?, ?, ?, ?, ?, ?)');
const updatePlayerPos = db.prepare('UPDATE players SET x = ?, y = ? WHERE id = ?');
const getBlocksNear = db.prepare('SELECT * FROM blocks WHERE x BETWEEN ? AND ? AND y BETWEEN ? AND ?');
const placeBlock = db.prepare('INSERT OR REPLACE INTO blocks (x, y, type, color, player_id) VALUES (?, ?, ?, ?, ?)');
const removeBlock = db.prepare('DELETE FROM blocks WHERE x = ? AND y = ?');
const getBlock = db.prepare('SELECT * FROM blocks WHERE x = ? AND y = ?');
const getAlliances = db.prepare('SELECT * FROM alliances WHERE player1_id = ? OR player2_id = ?');
const createAlliance = db.prepare('INSERT OR IGNORE INTO alliances (player1_id, player2_id, created_at) VALUES (?, ?, ?)');
const getPixelsNear = db.prepare('SELECT * FROM pixels WHERE x BETWEEN ? AND ? AND y BETWEEN ? AND ?');
const setPixel = db.prepare('INSERT OR REPLACE INTO pixels (x, y, color, player_id) VALUES (?, ?, ?, ?)');

// Connexion des joueurs
const players = new Map(); // socketId -> playerData

io.on('connection', (socket) => {
  let playerId = null;

  socket.on('join', (data) => {
    const { userId, username } = data;
    
    // Générer ID si nouveau
    playerId = userId || crypto.randomUUID();
    
    let player = getPlayer.get(playerId);
    
    if (!player) {
      // Nouveau joueur
      const color = `#${Math.floor(Math.random()*16777215).toString(16)}`;
      createPlayer.run(playerId, username || 'Joueur', color, 0, 0, Date.now());
      player = getPlayer.get(playerId);
    }

    // Stocker le joueur connecté
    players.set(socket.id, { 
      id: player.id, 
      username: player.username,
      color: player.color,
      x: player.x,
      y: player.y 
    });

    // Envoyer les données au joueur
    socket.emit('init', {
      playerId: player.id,
      player: player,
      onlinePlayers: Array.from(players.values())
    });

    // Notifier les autres
    socket.broadcast.emit('playerJoined', {
      id: player.id,
      username: player.username,
      color: player.color,
      x: player.x,
      y: player.y
    });

    console.log(`${player.username} rejoint (${socket.id})`);
  });

  // Charger les blocs autour du joueur
  socket.on('loadChunk', (data) => {
    const { x, y, range } = data;
    const halfRange = range / 2;
    
    const blocks = getBlocksNear.all(
      x - halfRange, x + halfRange,
      y - halfRange, y + halfRange
    );

    const pixels = getPixelsNear.all(
      x - halfRange, x + halfRange,
      y - halfRange, y + halfRange
    );

    socket.emit('chunkData', { blocks, pixels });
  });

  // Placer un bloc
  socket.on('placeBlock', (data) => {
    const player = players.get(socket.id);
    if (!player) return;

    const { x, y, type } = data;
    
    placeBlock.run(x, y, type, player.color, player.id);
    
    io.emit('blockPlaced', { 
      x, y, type, 
      color: player.color, 
      playerId: player.id 
    });
  });

  // Détruire un bloc
  socket.on('destroyBlock', (data) => {
    const { x, y } = data;
    const block = getBlock.get(x, y);
    
    if (!block) return;

    const player = players.get(socket.id);
    if (!player) return;

    // Vérifier si le joueur peut détruire (son bloc ou allié)
    const alliances = getAlliances.all(player.id);
    const canDestroy = block.player_id === player.id || 
                       alliances.some(a => a.player1_id === block.player_id || a.player2_id === block.player_id);

    if (canDestroy) {
      removeBlock.run(x, y);
      io.emit('blockDestroyed', { x, y });
    }
  });

  // Dessiner pixel
  socket.on('drawPixel', (data) => {
    const player = players.get(socket.id);
    if (!player) return;

    const { x, y, color } = data;
    
    // Vérifier que la case appartient au joueur
    const block = getBlock.get(x, y);
    if (!block || block.player_id !== player.id) return;

    setPixel.run(x, y, color, player.id);
    io.emit('pixelDrawn', { x, y, color, playerId: player.id });
  });

  // Créer alliance
  socket.on('createAlliance', (data) => {
    const player = players.get(socket.id);
    if (!player) return;

    const { targetPlayerId } = data;
    
    // Créer alliance bidirectionnelle
    createAlliance.run(player.id, targetPlayerId, Date.now());
    createAlliance.run(targetPlayerId, player.id, Date.now());

    // Notifier les deux joueurs
    const targetSocket = Array.from(players.entries())
      .find(([_, p]) => p.id === targetPlayerId);
    
    socket.emit('allianceCreated', { playerId: targetPlayerId });
    if (targetSocket) {
      io.to(targetSocket[0]).emit('allianceCreated', { playerId: player.id });
    }
  });

  // Mise à jour position
  socket.on('move', (data) => {
    const player = players.get(socket.id);
    if (!player) return;

    const { x, y } = data;
    player.x = x;
    player.y = y;

    updatePlayerPos.run(x, y, player.id);

    socket.broadcast.emit('playerMoved', {
      id: player.id,
      x, y
    });
  });

  // Obtenir liste joueurs en ligne
  socket.on('getPlayers', () => {
    socket.emit('playersList', Array.from(players.values()));
  });

  // Déconnexion
  socket.on('disconnect', () => {
    const player = players.get(socket.id);
    if (player) {
      console.log(`${player.username} déconnecté`);
      socket.broadcast.emit('playerLeft', { id: player.id });
      players.delete(socket.id);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🌍 PixelWorld - Serveur démarré
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🌐 http://localhost:${PORT}
📊 Joueurs: 0
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  `);
});
