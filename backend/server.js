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
    level INTEGER DEFAULT 1,
    xp INTEGER DEFAULT 0,
    upgrade_speed INTEGER DEFAULT 0,
    upgrade_teleport INTEGER DEFAULT 0,
    upgrade_destruction INTEGER DEFAULT 0,
    upgrade_gold_mult INTEGER DEFAULT 0,
    upgrade_xp_mult INTEGER DEFAULT 0,
    upgrade_build_range INTEGER DEFAULT 0,
    upgrade_auto_collect INTEGER DEFAULT 0,
    upgrade_shield INTEGER DEFAULT 0,
    created_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS buildings (
    x INTEGER,
    y INTEGER,
    type TEXT,
    color TEXT,
    player_id TEXT,
    hp INTEGER DEFAULT 0,
    level INTEGER DEFAULT 1,
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

// Zone de spawn protégée (10x10 au centre)
const SPAWN_ZONE = { minX: -5, maxX: 5, minY: -5, maxY: 5 };

// Constantes de jeu - Bâtiments de base
const BUILDING_COSTS = {
  // Niveau 1
  wall: 20,
  tower: 15,
  castle: (numCastles) => 50 * Math.pow(2, numCastles),
  
  // Niveau 5
  mine: 30,
  farm: 40,
  lumbermill: 35,
  
  // Niveau 10
  bank: 100,
  market: 120,
  workshop: 150,
  
  // Niveau 15
  laboratory: 200,
  temple: 250,
  arena: 300,
  
  // Niveau 20
  fortress: 500,
  monument: 600,
  palace: 800,
  
  // Niveau 25
  cathedral: 1000,
  citadel: 1200,
  oracle: 1500,
  
  // Niveau 30
  nexus: 2000,
  portal: 2500,
  titan_forge: 3000,
  
  // Niveau 35
  celestial_spire: 4000,
  void_gate: 5000,
  infinity_core: 6000,
  
  // Niveau 40
  world_tree: 10000,
  star_reactor: 15000,
  quantum_vault: 20000
};

const BUILDING_HP = {
  wall: 5, tower: 3, castle: 10,
  mine: 7, farm: 5, lumbermill: 6,
  bank: 15, market: 12, workshop: 10,
  laboratory: 20, temple: 25, arena: 18,
  fortress: 30, monument: 35, palace: 40,
  cathedral: 50, citadel: 60, oracle: 55,
  nexus: 70, portal: 80, titan_forge: 90,
  celestial_spire: 100, void_gate: 120, infinity_core: 140,
  world_tree: 200, star_reactor: 250, quantum_vault: 300
};

const GOLD_REWARDS = {
  wall: 1, tower: 10, castle: (numTowers, numCastles) => 100 * numTowers / Math.max(numCastles, 1),
  mine: 20, farm: 25, lumbermill: 22,
  bank: 50, market: 60, workshop: 75,
  laboratory: 100, temple: 125, arena: 150,
  fortress: 200, monument: 250, palace: 300,
  cathedral: 500, citadel: 600, oracle: 700,
  nexus: 1000, portal: 1200, titan_forge: 1500,
  celestial_spire: 2000, void_gate: 2500, infinity_core: 3000,
  world_tree: 5000, star_reactor: 7500, quantum_vault: 10000
};

// Revenus passifs par bâtiment (or/sec)
const BUILDING_INCOME = {
  tower: 2,
  castle: (numTowers) => numTowers,
  mine: 3,
  farm: 4,
  lumbermill: 3.5,
  bank: (totalGold) => Math.floor(totalGold * 0.01),
  market: 8,
  workshop: 10,
  laboratory: 15,
  temple: 20,
  arena: 25,
  fortress: 10,
  monument: 30,
  palace: 40,
  cathedral: 50,
  citadel: 60,
  oracle: 70,
  nexus: 80,
  portal: 100,
  titan_forge: 120,
  celestial_spire: 150,
  void_gate: 200,
  infinity_core: 250,
  world_tree: 300,
  star_reactor: 400,
  quantum_vault: 500
};

// Coût d'amélioration
const UPGRADE_COST_MULTIPLIER = 1.5;

// XP par action
const XP_REWARDS = {
  placeBuilding: 10,
  destroyBuilding: 15,
  upgradeBuilding: 20,
  move: 1,
  upgradePlayer: 50
};

// XP requis par niveau
function getXPForLevel(level) {
  return Math.floor(100 * Math.pow(1.5, level - 1));
}

// Bâtiments débloqués par niveau
const BUILDING_UNLOCKS = {
  1: ['wall', 'tower', 'castle'],
  5: ['mine', 'farm', 'lumbermill'],
  10: ['bank', 'market', 'workshop'],
  15: ['laboratory', 'temple', 'arena'],
  20: ['fortress', 'monument', 'palace'],
  25: ['cathedral', 'citadel', 'oracle'],
  30: ['nexus', 'portal', 'titan_forge'],
  35: ['celestial_spire', 'void_gate', 'infinity_core'],
  40: ['world_tree', 'star_reactor', 'quantum_vault']
};

// Améliorations de personnage
const PLAYER_UPGRADES = {
  speed: {
    name: 'Vitesse',
    description: 'Réduit le cooldown de déplacement',
    icon: '⚡',
    maxLevel: 10,
    baseCost: 100,
    effect: (level) => 1 - (level * 0.05) // -5% par niveau
  },
  teleport: {
    name: 'Téléportation',
    description: 'Augmente la portée de déplacement',
    icon: '🌀',
    maxLevel: 5,
    baseCost: 500,
    effect: (level) => level + 1 // Portée de TP
  },
  destruction: {
    name: 'Destruction Rapide',
    description: 'Détruit plus vite',
    icon: '💥',
    maxLevel: 10,
    baseCost: 200,
    effect: (level) => 1 - (level * 0.1) // -10% par niveau
  },
  goldMultiplier: {
    name: 'Multiplicateur Or',
    description: 'Bonus sur gains d\'or',
    icon: '💰',
    maxLevel: 20,
    baseCost: 300,
    effect: (level) => 1 + (level * 0.1) // +10% par niveau
  },
  xpMultiplier: {
    name: 'Multiplicateur XP',
    description: 'Bonus sur gains d\'XP',
    icon: '⭐',
    maxLevel: 15,
    baseCost: 250,
    effect: (level) => 1 + (level * 0.15) // +15% par niveau
  },
  buildRange: {
    name: 'Portée Construction',
    description: 'Construis plus loin',
    icon: '🔨',
    maxLevel: 5,
    baseCost: 400,
    effect: (level) => level + 1 // Portée de construction
  },
  autoCollect: {
    name: 'Collecte Auto',
    description: 'Collecte l\'or automatiquement',
    icon: '🤖',
    maxLevel: 1,
    baseCost: 5000,
    effect: (level) => level > 0
  },
  shield: {
    name: 'Bouclier',
    description: 'Tes bâtiments ont +HP',
    icon: '🛡️',
    maxLevel: 10,
    baseCost: 600,
    effect: (level) => 1 + (level * 0.2) // +20% HP par niveau
  }
};

// Préparer les requêtes
const getPlayer = db.prepare('SELECT * FROM players WHERE id = ?');
const createPlayer = db.prepare(`INSERT INTO players (
  id, username, color, x, y, gold, level, xp, 
  upgrade_speed, upgrade_teleport, upgrade_destruction, upgrade_gold_mult, 
  upgrade_xp_mult, upgrade_build_range, upgrade_auto_collect, upgrade_shield, created_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0, ?)`);
const updatePlayerPos = db.prepare('UPDATE players SET x = ?, y = ? WHERE id = ?');
const updatePlayerGold = db.prepare('UPDATE players SET gold = ? WHERE id = ?');
const updatePlayerLevel = db.prepare('UPDATE players SET level = ?, xp = ? WHERE id = ?');
const updatePlayerUpgrade = db.prepare(`UPDATE players SET 
  upgrade_speed = ?, upgrade_teleport = ?, upgrade_destruction = ?,
  upgrade_gold_mult = ?, upgrade_xp_mult = ?, upgrade_build_range = ?,
  upgrade_auto_collect = ?, upgrade_shield = ?
  WHERE id = ?`);
const getBuildingsNear = db.prepare('SELECT * FROM buildings WHERE x BETWEEN ? AND ? AND y BETWEEN ? AND ?');
const getAllBuildingsByPlayer = db.prepare('SELECT * FROM buildings WHERE player_id = ?');
const placeBuilding = db.prepare('INSERT OR REPLACE INTO buildings (x, y, type, color, player_id, hp, level, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
const removeBuilding = db.prepare('DELETE FROM buildings WHERE x = ? AND y = ?');
const getBuilding = db.prepare('SELECT * FROM buildings WHERE x = ? AND y = ?');
const updateBuildingLevel = db.prepare('UPDATE buildings SET level = ? WHERE x = ? AND y = ?');
const getAlliances = db.prepare('SELECT player2_id FROM alliances WHERE player1_id = ?');
const createAlliance = db.prepare('INSERT OR IGNORE INTO alliances (player1_id, player2_id, created_at) VALUES (?, ?, ?)');
const getAllPlayers = db.prepare('SELECT * FROM players ORDER BY level DESC, gold DESC');
const getLeaderboard = db.prepare(`
  SELECT 
    p.id, p.username, p.color, p.gold, p.level,
    COUNT(b.x) as building_count,
    SUM(CASE WHEN b.type = 'castle' THEN 1 ELSE 0 END) as castle_count
  FROM players p
  LEFT JOIN buildings b ON p.id = b.player_id
  GROUP BY p.id
  ORDER BY castle_count DESC, p.gold DESC
  LIMIT 10
`);

// Fonctions utilitaires
function isInSpawnZone(x, y) {
  return x >= SPAWN_ZONE.minX && x <= SPAWN_ZONE.maxX &&
         y >= SPAWN_ZONE.minY && y <= SPAWN_ZONE.maxY;
}

function findSafeSpawn() {
  // Chercher un spawn libre autour de (0,0)
  for (let radius = 6; radius < 20; radius++) {
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 8) {
      const x = Math.round(Math.cos(angle) * radius);
      const y = Math.round(Math.sin(angle) * radius);
      
      const building = getBuilding.get(x, y);
      if (!building) {
        return { x, y };
      }
    }
  }
  return { x: 0, y: 0 }; // Fallback
}

function giveXP(playerId, amount) {
  const player = players.get(Array.from(players.entries()).find(([_, p]) => p.id === playerId)?.[0]);
  if (!player) return;

  player.xp += amount;
  const requiredXP = getXPForLevel(player.level);

  if (player.xp >= requiredXP) {
    player.level++;
    player.xp -= requiredXP;
    updatePlayerLevel.run(player.level, player.xp, player.id);
    
    const socketId = Array.from(players.entries()).find(([_, p]) => p.id === playerId)?.[0];
    if (socketId) {
      io.to(socketId).emit('levelUp', { level: player.level, xp: player.xp });
    }
  } else {
    updatePlayerLevel.run(player.level, player.xp, player.id);
  }
}

// Connexion des joueurs
const players = new Map();
const destroyingBuildings = new Map();

io.on('connection', (socket) => {
  let playerId = null;

  socket.on('join', (data) => {
    const { userId, username } = data;
    
    playerId = userId || crypto.randomUUID();
    
    let player = getPlayer.get(playerId);
    
    if (!player) {
      const color = `#${Math.floor(Math.random()*16777215).toString(16)}`;
      const spawn = findSafeSpawn();
      createPlayer.run(playerId, username || 'Joueur', color, spawn.x, spawn.y, 0, 1, 0, Date.now());
      player = getPlayer.get(playerId);
    } else {
      // Vérifier si le joueur spawne sur un mur
      const building = getBuilding.get(player.x, player.y);
      if (building && building.type === 'wall') {
        const spawn = findSafeSpawn();
        updatePlayerPos.run(spawn.x, spawn.y, player.id);
        player = getPlayer.get(playerId);
      }
    }

    players.set(socket.id, { 
      id: player.id, 
      username: player.username,
      color: player.color,
      x: player.x,
      y: player.y,
      gold: player.gold,
      level: player.level,
      xp: player.xp,
      upgrades: {
        speed: player.upgrade_speed || 0,
        teleport: player.upgrade_teleport || 0,
        destruction: player.upgrade_destruction || 0,
        goldMultiplier: player.upgrade_gold_mult || 0,
        xpMultiplier: player.upgrade_xp_mult || 0,
        buildRange: player.upgrade_build_range || 0,
        autoCollect: player.upgrade_auto_collect || 0,
        shield: player.upgrade_shield || 0
      }
    });

    socket.emit('init', {
      playerId: player.id,
      player: players.get(socket.id),
      onlinePlayers: Array.from(players.values()),
      leaderboard: getLeaderboard.all()
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
    
    // Vérifier zone de spawn
    if (isInSpawnZone(x, y)) {
      socket.emit('error', { message: 'Zone de spawn protégée !' });
      return;
    }

    // Vérifier niveau requis
    const requiredLevel = Object.entries(BUILDING_UNLOCKS).reverse().find(([lvl, buildings]) => 
      buildings.includes(type)
    )?.[0] || 1;

    if (player.level < parseInt(requiredLevel)) {
      socket.emit('error', { message: `Niveau ${requiredLevel} requis pour ${type} !` });
      return;
    }

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
      socket.emit('error', { message: `Pas assez d'or ! Besoin de ${cost}💰` });
      return;
    }

    // Déduire l'or
    player.gold -= cost;
    updatePlayerGold.run(player.gold, player.id);

    // Placer le bâtiment
    const hp = BUILDING_HP[type];
    placeBuilding.run(x, y, type, player.color, player.id, hp, 1, Date.now());
    
    // Donner XP
    giveXP(player.id, XP_REWARDS.placeBuilding);

    io.emit('buildingPlaced', { 
      x, y, type, 
      color: player.color, 
      playerId: player.id,
      hp,
      level: 1
    });

    socket.emit('goldUpdate', { gold: player.gold });
    socket.emit('xpUpdate', { xp: player.xp, level: player.level });
    io.emit('leaderboardUpdate', getLeaderboard.all());
  });

  // Améliorer un bâtiment
  socket.on('upgradeBuilding', (data) => {
    const player = players.get(socket.id);
    if (!player) return;

    const { x, y } = data;

    const building = getBuilding.get(x, y);
    if (!building) {
      socket.emit('error', { message: 'Aucun bâtiment ici !' });
      return;
    }

    if (building.player_id !== player.id) {
      socket.emit('error', { message: 'Ce n\'est pas ton bâtiment !' });
      return;
    }

    // Calculer coût d'amélioration
    let baseCost = BUILDING_COSTS[building.type];
    if (typeof baseCost === 'function') {
      const playerBuildings = getAllBuildingsByPlayer.all(player.id);
      const numCastles = playerBuildings.filter(b => b.type === 'castle').length;
      baseCost = baseCost(numCastles);
    }
    const upgradeCost = Math.floor(baseCost * UPGRADE_COST_MULTIPLIER * building.level);

    if (player.gold < upgradeCost) {
      socket.emit('error', { message: `Besoin de ${upgradeCost}💰 pour améliorer !` });
      return;
    }

    // Vérifier adjacence
    if (!isAdjacent(player.x, player.y, x, y)) {
      socket.emit('error', { message: 'Trop loin pour améliorer !' });
      return;
    }

    player.gold -= upgradeCost;
    updatePlayerGold.run(player.gold, player.id);

    const newLevel = building.level + 1;
    updateBuildingLevel.run(newLevel, x, y);

    // Donner XP
    giveXP(player.id, XP_REWARDS.upgradeBuilding);

    io.emit('buildingUpgraded', { x, y, level: newLevel });
    socket.emit('goldUpdate', { gold: player.gold });
    socket.emit('xpUpdate', { xp: player.xp, level: player.level });
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

  // Améliorer le personnage
  socket.on('upgradePlayer', (data) => {
    const player = players.get(socket.id);
    if (!player) return;

    const { upgradeType } = data;
    const upgrade = PLAYER_UPGRADES[upgradeType];
    
    if (!upgrade) {
      socket.emit('error', { message: 'Amélioration inconnue !' });
      return;
    }

    const currentLevel = player.upgrades[upgradeType];
    
    if (currentLevel >= upgrade.maxLevel) {
      socket.emit('error', { message: 'Niveau maximum atteint !' });
      return;
    }

    const cost = Math.floor(upgrade.baseCost * Math.pow(1.5, currentLevel));

    if (player.gold < cost) {
      socket.emit('error', { message: `Besoin de ${cost}💰 !` });
      return;
    }

    player.gold -= cost;
    player.upgrades[upgradeType]++;
    
    updatePlayerGold.run(player.gold, player.id);
    updatePlayerUpgrade.run(
      player.upgrades.speed,
      player.upgrades.teleport,
      player.upgrades.destruction,
      player.upgrades.goldMultiplier,
      player.upgrades.xpMultiplier,
      player.upgrades.buildRange,
      player.upgrades.autoCollect,
      player.upgrades.shield,
      player.id
    );

    giveXP(player.id, XP_REWARDS.upgradePlayer);

    socket.emit('goldUpdate', { gold: player.gold });
    socket.emit('upgradeUpdate', { upgrades: player.upgrades });
    socket.emit('xpUpdate', { xp: player.xp, level: player.level });
  });

  // Obtenir leaderboard
  socket.on('getLeaderboard', () => {
    socket.emit('leaderboardUpdate', getLeaderboard.all());
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
    let goldPerSec = 1; // Base

    const playerBuildings = getAllBuildingsByPlayer.all(player.id);
    const towers = playerBuildings.filter(b => b.type === 'tower');
    const castles = playerBuildings.filter(b => b.type === 'castle');
    const mines = playerBuildings.filter(b => b.type === 'mine');
    const banks = playerBuildings.filter(b => b.type === 'bank');
    const fortresses = playerBuildings.filter(b => b.type === 'fortress');

    // Tours : 2 or/sec * niveau
    towers.forEach(t => goldPerSec += BUILDING_INCOME.tower * t.level);

    // Châteaux : autant d'or que de tours * niveau
    castles.forEach(c => goldPerSec += BUILDING_INCOME.castle(towers.length) * c.level);

    // Mines : 3 or/sec * niveau
    mines.forEach(m => goldPerSec += BUILDING_INCOME.mine * m.level);

    // Banques : 1% de l'or total * niveau
    banks.forEach(b => goldPerSec += BUILDING_INCOME.bank(player.gold) * b.level);

    // Forteresses : 10 or/sec * niveau
    fortresses.forEach(f => goldPerSec += BUILDING_INCOME.fortress * f.level);

    player.gold += goldPerSec;
    updatePlayerGold.run(player.gold, player.id);

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
    const requiredTime = data.building.hp * 1000;

    if (elapsed >= requiredTime) {
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
        } else if (building.type === 'mine') {
          reward = GOLD_REWARDS.mine;
        } else if (building.type === 'bank') {
          reward = GOLD_REWARDS.bank;
        } else if (building.type === 'fortress') {
          reward = GOLD_REWARDS.fortress;
        }

        // Bonus de niveau
        reward *= building.level;

        // Donner récompense + XP
        const destroyer = players.get(Array.from(players.entries()).find(([_, p]) => p.id === data.playerId)?.[0]);
        if (destroyer) {
          destroyer.gold += reward;
          updatePlayerGold.run(destroyer.gold, destroyer.id);
          
          giveXP(destroyer.id, XP_REWARDS.destroyBuilding);
          
          const socketId = Array.from(players.entries()).find(([_, p]) => p.id === destroyer.id)?.[0];
          if (socketId) {
            io.to(socketId).emit('goldUpdate', { gold: destroyer.gold });
            io.to(socketId).emit('destroyComplete', { x, y, reward });
            io.to(socketId).emit('xpUpdate', { xp: destroyer.xp, level: destroyer.level });
          }
        }

        removeBuilding.run(x, y);
        io.emit('buildingDestroyed', { x, y });
        io.emit('leaderboardUpdate', getLeaderboard.all());
      }

      destroyingBuildings.delete(key);
    }
  });
}, 100);

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
