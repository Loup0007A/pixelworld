const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Database = require('better-sqlite3');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');

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
    gold INTEGER DEFAULT 0,
    created_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS buildings (
    x INTEGER,
    y INTEGER,
    type TEXT,
    color TEXT,
    player_id TEXT,
    hp INTEGER DEFAULT 0,
    created_at INTEGER,
    PRIMARY KEY (x, y)
  );

  CREATE TABLE IF NOT EXISTS alliances (
    player1_id TEXT,
    player2_id TEXT,
    created_at INTEGER,
    PRIMARY KEY (player1_id, player2_id)
  );
`);

// Constantes de jeu
const BUILDING_COSTS = {
  wall: 20,
  tower: 15,
  castle: (numCastles) => 50 * Math.pow(2, numCastles) // Coût exponentiel
};

const BUILDING_HP = {
  wall: 5,  // 5 secondes à détruire (1 HP/sec)
  tower: 3,
  castle: 10
};

const GOLD_REWARDS = {
  wall: 1,
  tower: 10,
  castle: (numTowers, numCastles) => 100 * numTowers / Math.max(numCastles, 1)
};

// Préparer les requêtes
const getPlayer = db.prepare('SELECT * FROM players WHERE id = ?');
const createPlayer = db.prepare('INSERT INTO players (id, username, color, x, y, gold, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
const updatePlayerPos = db.prepare('UPDATE players SET x = ?, y = ? WHERE id = ?');
const updatePlayerGold = db.prepare('UPDATE players SET gold = ? WHERE id = ?');
const getBuildingsNear = db.prepare('SELECT * FROM buildings WHERE x BETWEEN ? AND ? AND y BETWEEN ? AND ?');
const getAllBuildingsByPlayer = db.prepare('SELECT * FROM buildings WHERE player_id = ?');
const placeBuilding = db.prepare('INSERT OR REPLACE INTO buildings (x, y, type, color, player_id, hp, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
const removeBuilding = db.prepare('DELETE FROM buildings WHERE x = ? AND y = ?');
const getBuilding = db.prepare('SELECT * FROM buildings WHERE x = ? AND y = ?');
const updateBuildingHP = db.prepare('UPDATE buildings SET hp = ? WHERE x = ? AND y = ?');
const getAlliances = db.prepare('SELECT player2_id FROM alliances WHERE player1_id = ?');
const createAlliance = db.prepare('INSERT OR IGNORE INTO alliances (player1_id, player2_id, created_at) VALUES (?, ?, ?)');
const getAllPlayers = db.prepare('SELECT * FROM players');

// Connexion des joueurs
const players = new Map(); // socketId -> playerData
const destroyingBuildings = new Map(); // "x,y" -> {playerId, startTime, building}

io.on('connection', (socket) => {
  let playerId = null;

  socket.on('join', (data) => {
    const { userId, username } = data;
    
    playerId = userId || crypto.randomUUID();
    
    let player = getPlayer.get(playerId);
    
    if (!player) {
      const color = `#${Math.floor(Math.random()*16777215).toString(16)}`;
      createPlayer.run(playerId, username || 'Joueur', color, 0, 0, 0, Date.now());
      player = getPlayer.get(playerId);
    }

    players.set(socket.id, { 
      id: player.id, 
      username: player.username,
      color: player.color,
      x: player.x,
      y: player.y,
      gold: player.gold
    });

    socket.emit('init', {
      playerId: player.id,
      player: player,
      onlinePlayers: Array.from(players.values())
    });

    socket.broadcast.emit('playerJoined', {
      id: player.id,
      username: player.username,
      color: player.color,
      x: player.x,
      y: player.y
    });

    console.log(`${player.username} rejoint (${socket.id})`);
  });

  // Charger les bâtiments autour du joueur
  socket.on('loadChunk', (data) => {
    const { x, y, range } = data;
    const halfRange = range / 2;
    
    const buildings = getBuildingsNear.all(
      x - halfRange, x + halfRange,
      y - halfRange, y + halfRange
    );

    socket.emit('chunkData', { buildings });
  });

  // Vérifier si une position est adjacente au joueur
  function isAdjacent(playerX, playerY, targetX, targetY) {
    const dx = Math.abs(playerX - targetX);
    const dy = Math.abs(playerY - targetY);
    return (dx <= 1 && dy <= 1) && !(dx === 0 && dy === 0);
  }

  // Placer un bâtiment
  socket.on('placeBuilding', (data) => {
    const player = players.get(socket.id);
    if (!player) return;

    const { x, y, type } = data;
    
    // Vérifier adjacence
    if (!isAdjacent(player.x, player.y, x, y)) {
      socket.emit('error', { message: 'Trop loin ! Place uniquement adjacent à toi.' });
      return;
    }

    // Vérifier si case occupée
    const existing = getBuilding.get(x, y);
    if (existing) {
      socket.emit('error', { message: 'Case occupée !' });
      return;
    }

    // Vérifier si c'est la position du joueur
    if (x === player.x && y === player.y) {
      socket.emit('error', { message: 'Tu es sur cette case !' });
      return;
    }

    // Calculer le coût
    let cost = 0;
    if (type === 'castle') {
      const playerBuildings = getAllBuildingsByPlayer.all(player.id);
      const numCastles = playerBuildings.filter(b => b.type === 'castle').length;
      cost = BUILDING_COSTS.castle(numCastles);
    } else {
      cost = BUILDING_COSTS[type];
    }

    // Vérifier l'or
    if (player.gold < cost) {
      socket.emit('error', { message: `Pas assez d'or ! Besoin de ${cost}` });
      return;
    }

    // Déduire l'or
    player.gold -= cost;
    updatePlayerGold.run(player.gold, player.id);

    // Placer le bâtiment
    const hp = BUILDING_HP[type];
    placeBuilding.run(x, y, type, player.color, player.id, hp, Date.now());
    
    io.emit('buildingPlaced', { 
      x, y, type, 
      color: player.color, 
      playerId: player.id,
      hp
    });

    socket.emit('goldUpdate', { gold: player.gold });
  });

  // Commencer à détruire un bâtiment
  socket.on('startDestroy', (data) => {
    const player = players.get(socket.id);
    if (!player) return;

    const { x, y } = data;
    
    // Vérifier adjacence
    if (!isAdjacent(player.x, player.y, x, y)) {
      socket.emit('error', { message: 'Trop loin pour détruire !' });
      return;
    }

    const building = getBuilding.get(x, y);
    if (!building) {
      socket.emit('error', { message: 'Aucun bâtiment ici !' });
      return;
    }

    const key = `${x},${y}`;
    destroyingBuildings.set(key, {
      playerId: player.id,
      startTime: Date.now(),
      building: building
    });

    socket.emit('destroyStarted', { x, y, duration: building.hp * 1000 });
  });

  // Annuler la destruction
  socket.on('cancelDestroy', (data) => {
    const { x, y } = data;
    const key = `${x},${y}`;
    destroyingBuildings.delete(key);
  });

  // Bouger le joueur
  socket.on('move', (data) => {
    const player = players.get(socket.id);
    if (!player) return;

    const { x, y } = data;

    // Vérifier s'il y a un mur
    const building = getBuilding.get(x, y);
    if (building && building.type === 'wall') {
      socket.emit('error', { message: 'Un mur bloque le passage !' });
      return;
    }

    player.x = x;
    player.y = y;

    updatePlayerPos.run(x, y, player.id);

    socket.broadcast.emit('playerMoved', {
      id: player.id,
      x, y
    });

    socket.emit('positionUpdate', { x, y });
  });

  // Créer alliance
  socket.on('createAlliance', (data) => {
    const player = players.get(socket.id);
    if (!player) return;

    const { targetPlayerId } = data;
    
    createAlliance.run(player.id, targetPlayerId, Date.now());
    createAlliance.run(targetPlayerId, player.id, Date.now());

    const targetSocket = Array.from(players.entries())
      .find(([_, p]) => p.id === targetPlayerId);
    
    socket.emit('allianceCreated', { playerId: targetPlayerId });
    if (targetSocket) {
      io.to(targetSocket[0]).emit('allianceCreated', { playerId: player.id });
    }
  });

  // Obtenir liste joueurs
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


// Génération d'or (1/sec de base)
setInterval(() => {
  players.forEach(player => {
    // 1 or de base
    let goldPerSec = 1;

    // Calculer les bonus des bâtiments
    const playerBuildings = getAllBuildingsByPlayer.all(player.id);
    const towers = playerBuildings.filter(b => b.type === 'tower');
    const castles = playerBuildings.filter(b => b.type === 'castle');

    // Tours : 2 or/sec chacune
    goldPerSec += towers.length * 2;

    // Châteaux : autant d'or que de tours
    goldPerSec += castles.length * towers.length;

    player.gold += goldPerSec;
    updatePlayerGold.run(player.gold, player.id);

    // Envoyer mise à jour
    const socketId = Array.from(players.entries()).find(([_, p]) => p.id === player.id)?.[0];
    if (socketId) {
      io.to(socketId).emit('goldUpdate', { gold: player.gold });
    }
  });
}, 1000);

// Vérifier les destructions en cours
setInterval(() => {
  const now = Date.now();
  
  destroyingBuildings.forEach((data, key) => {
    const elapsed = now - data.startTime;
    const requiredTime = data.building.hp * 1000; // hp secondes en ms

    if (elapsed >= requiredTime) {
      // Destruction terminée
      const [x, y] = key.split(',').map(Number);
      const building = getBuilding.get(x, y);
      
      if (building) {
        // Calculer récompense
        let reward = 0;
        if (building.type === 'wall') {
          reward = GOLD_REWARDS.wall;
        } else if (building.type === 'tower') {
          reward = GOLD_REWARDS.tower;
        } else if (building.type === 'castle') {
          const playerBuildings = getAllBuildingsByPlayer.all(building.player_id);
          const numTowers = playerBuildings.filter(b => b.type === 'tower').length;
          const numCastles = playerBuildings.filter(b => b.type === 'castle').length;
          reward = GOLD_REWARDS.castle(numTowers, numCastles);
        }

        // Donner la récompense
        const destroyer = players.get(Array.from(players.entries()).find(([_, p]) => p.id === data.playerId)?.[0]);
        if (destroyer) {
          destroyer.gold += reward;
          updatePlayerGold.run(destroyer.gold, destroyer.id);
          
          const socketId = Array.from(players.entries()).find(([_, p]) => p.id === destroyer.id)?.[0];
          if (socketId) {
            io.to(socketId).emit('goldUpdate', { gold: destroyer.gold });
            io.to(socketId).emit('destroyComplete', { x, y, reward });
          }
        }

        // Supprimer le bâtiment
        removeBuilding.run(x, y);
        io.emit('buildingDestroyed', { x, y });
      }

      destroyingBuildings.delete(key);
    }
  });
}, 100); // Vérifier toutes les 100ms

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
