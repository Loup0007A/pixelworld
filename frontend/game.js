// Configuration
const CELL_SIZE = 32;
const CHUNK_SIZE = 50;
const BACKEND_URL = window.location.origin;

// Données des bâtiments (côté client)
const BUILDINGS_DATA = {
  // Niveau 1
  wall: { name: 'Mur', icon: '🧱', cost: 20, income: 0, level: 1 },
  tower: { name: 'Tour', icon: '🗼', cost: 15, income: 2, level: 1 },
  castle: { name: 'Château', icon: '🏰', cost: 50, income: '×Tours', level: 1 },
  
  // Niveau 5
  mine: { name: 'Mine', icon: '⛏️', cost: 30, income: 3, level: 5 },
  farm: { name: 'Ferme', icon: '🌾', cost: 40, income: 4, level: 5 },
  lumbermill: { name: 'Scierie', icon: '🪵', cost: 35, income: 3.5, level: 5 },
  
  // Niveau 10
  bank: { name: 'Banque', icon: '🏦', cost: 100, income: '1%', level: 10 },
  market: { name: 'Marché', icon: '🏪', cost: 120, income: 8, level: 10 },
  workshop: { name: 'Atelier', icon: '🔧', cost: 150, income: 10, level: 10 },
  
  // Niveau 15
  laboratory: { name: 'Laboratoire', icon: '🧪', cost: 200, income: 15, level: 15 },
  temple: { name: 'Temple', icon: '⛪', cost: 250, income: 20, level: 15 },
  arena: { name: 'Arène', icon: '⚔️', cost: 300, income: 25, level: 15 },
  
  // Niveau 20
  fortress: { name: 'Forteresse', icon: '🏛️', cost: 500, income: 10, level: 20 },
  monument: { name: 'Monument', icon: '🗿', cost: 600, income: 30, level: 20 },
  palace: { name: 'Palais', icon: '👑', cost: 800, income: 40, level: 20 },
  
  // Niveau 25
  cathedral: { name: 'Cathédrale', icon: '⛪', cost: 1000, income: 50, level: 25 },
  citadel: { name: 'Citadelle', icon: '🏰', cost: 1200, income: 60, level: 25 },
  oracle: { name: 'Oracle', icon: '🔮', cost: 1500, income: 70, level: 25 },
  
  // Niveau 30
  nexus: { name: 'Nexus', icon: '🌌', cost: 2000, income: 80, level: 30 },
  portal: { name: 'Portail', icon: '🌀', cost: 2500, income: 100, level: 30 },
  titan_forge: { name: 'Forge Titan', icon: '⚒️', cost: 3000, income: 120, level: 30 },
  
  // Niveau 35
  celestial_spire: { name: 'Tour Céleste', icon: '✨', cost: 4000, income: 150, level: 35 },
  void_gate: { name: 'Porte Vide', icon: '🕳️', cost: 5000, income: 200, level: 35 },
  infinity_core: { name: 'Noyau Infini', icon: '⚡', cost: 6000, income: 250, level: 35 },
  
  // Niveau 40
  world_tree: { name: 'Arbre Monde', icon: '🌳', cost: 10000, income: 300, level: 40 },
  star_reactor: { name: 'Réacteur Stellaire', icon: '⭐', cost: 15000, income: 400, level: 40 },
  quantum_vault: { name: 'Coffre Quantique', icon: '💎', cost: 20000, income: 500, level: 40 }
};

const UPGRADES_DATA = {
  speed: { name: 'Vitesse', icon: '⚡', desc: 'Cooldown déplacement', maxLevel: 10, baseCost: 100 },
  teleport: { name: 'Téléportation', icon: '🌀', desc: 'Portée de déplacement', maxLevel: 5, baseCost: 500 },
  destruction: { name: 'Destruction', icon: '💥', desc: 'Détruit plus vite', maxLevel: 10, baseCost: 200 },
  goldMultiplier: { name: 'Mult. Or', icon: '💰', desc: '+10% or/niveau', maxLevel: 20, baseCost: 300 },
  xpMultiplier: { name: 'Mult. XP', icon: '⭐', desc: '+15% XP/niveau', maxLevel: 15, baseCost: 250 },
  buildRange: { name: 'Portée', icon: '🔨', desc: 'Construis plus loin', maxLevel: 5, baseCost: 400 },
  autoCollect: { name: 'Auto-Collecte', icon: '🤖', desc: 'Or automatique', maxLevel: 1, baseCost: 5000 },
  shield: { name: 'Bouclier', icon: '🛡️', desc: '+20% HP/niveau', maxLevel: 10, baseCost: 600 }
};

// État
let socket = null;
let canvas, ctx;
let cameraX = 0, cameraY = 0;
let playerData = null;
let selectedBuildingType = null;
let isDestroying = false;
let destroyTarget = null;
let leaderboard = [];

// Stockage
let buildings = new Map();
let players = new Map();
let alliances = new Set();

// Camera
let isDragging = false;
let dragStartX = 0, dragStartY = 0;
let dragStartCamX = 0, dragStartCamY = 0;

// Éléments DOM
const loginScreen = document.getElementById('loginScreen');
const gameScreen = document.getElementById('gameScreen');
const usernameInput = document.getElementById('usernameInput');
const joinBtn = document.getElementById('joinBtn');
const coordsDiv = document.getElementById('coords');
const playerNameSpan = document.getElementById('playerName');
const playerColorDiv = document.getElementById('playerColor');
const goldDisplay = document.getElementById('goldDisplay');
const levelDisplay = document.getElementById('levelDisplay');
const upgradesBtn = document.getElementById('upgradesBtn');
const leaderboardBtn = document.getElementById('leaderboardBtn');
const buildingsBtn = document.getElementById('buildingsBtn');
const playersBtn = document.getElementById('playersBtn');
const helpBtn = document.getElementById('helpBtn');
const upgradesPanel = document.getElementById('upgradesPanel');
const leaderboardPanel = document.getElementById('leaderboardPanel');
const buildingsPanel = document.getElementById('buildingsPanel');
const playersPanel = document.getElementById('playersPanel');
const helpPanel = document.getElementById('helpPanel');
const playersList = document.getElementById('playersList');
const destroyBtn = document.getElementById('destroyBtn');
const destroyIndicator = document.getElementById('destroyIndicator');
const destroyBar = document.getElementById('destroyBar');
const cancelDestroyBtn = document.getElementById('cancelDestroy');
const castleCostSpan = document.getElementById('castleCost');
const leaderboardContent = document.getElementById('leaderboardContent');
const upgradesContent = document.getElementById('upgradesContent');
const buildingsContent = document.getElementById('buildingsContent');

function init() {
  canvas = document.getElementById('canvas');
  ctx = canvas.getContext('2d');
  
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  joinBtn.addEventListener('click', joinGame);
  usernameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') joinGame();
  });

  document.querySelectorAll('.build-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedBuildingType = btn.dataset.type;
      destroyBtn.classList.remove('active');
      showNotification(`Mode: Placer ${btn.dataset.type}`);
    });
  });

  destroyBtn.addEventListener('click', () => {
    selectedBuildingType = null;
    destroyBtn.classList.add('active');
    showNotification('Mode: Détruire');
  });

  cancelDestroyBtn.addEventListener('click', () => {
    if (destroyTarget && socket) {
      socket.emit('cancelDestroy', destroyTarget);
    }
    isDestroying = false;
    destroyTarget = null;
    destroyIndicator.classList.remove('active');
  });

  upgradesBtn.addEventListener('click', () => {
    upgradesPanel.classList.toggle('active');
    closeOtherPanels(upgradesPanel);
    renderUpgradesPanel();
  });

  leaderboardBtn.addEventListener('click', () => {
    leaderboardPanel.classList.toggle('active');
    closeOtherPanels(leaderboardPanel);
    if (socket) socket.emit('getLeaderboard');
  });

  buildingsBtn.addEventListener('click', () => {
    buildingsPanel.classList.toggle('active');
    closeOtherPanels(buildingsPanel);
    renderBuildingsPanel();
  });

  playersBtn.addEventListener('click', () => {
    playersPanel.classList.toggle('active');
    closeOtherPanels(playersPanel);
  });

  helpBtn.addEventListener('click', () => {
    helpPanel.classList.toggle('active');
    closeOtherPanels(helpPanel);
  });

  document.querySelectorAll('.close-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.closest('.panel').classList.remove('active');
    });
  });

  canvas.addEventListener('mousedown', handleMouseDown);
  canvas.addEventListener('mousemove', handleMouseMove);
  canvas.addEventListener('mouseup', handleMouseUp);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('click', handleClick);
  canvas.addEventListener('dblclick', handleDoubleClick);

  window.addEventListener('keydown', handleKeyDown);

  canvas.addEventListener('touchstart', handleTouchStart);
  canvas.addEventListener('touchmove', handleTouchMove);
  canvas.addEventListener('touchend', handleTouchEnd);

  usernameInput.focus();
}

function closeOtherPanels(exceptPanel) {
  [upgradesPanel, leaderboardPanel, buildingsPanel, playersPanel, helpPanel].forEach(panel => {
    if (panel !== exceptPanel) panel.classList.remove('active');
  });
}

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight - 70;
  render();
}

function joinGame() {
  const username = usernameInput.value.trim() || 'Joueur';
  const userId = getCookie('playerId');

  socket = io(BACKEND_URL);

  socket.on('connect', () => {
    socket.emit('join', { userId, username });
  });

  socket.on('init', (data) => {
    playerData = data.player;
    
    setCookie('playerId', playerData.id, 365);

    playerNameSpan.textContent = playerData.username;
    playerColorDiv.style.backgroundColor = playerData.color;
    updateGoldDisplay();
    updateLevelDisplay();

    cameraX = playerData.x * CELL_SIZE - canvas.width / 2;
    cameraY = playerData.y * CELL_SIZE - canvas.height / 2;

    data.onlinePlayers.forEach(p => players.set(p.id, p));
    leaderboard = data.leaderboard || [];

    loadChunk();

    loginScreen.classList.remove('active');
    gameScreen.classList.add('active');

    render();
    updatePlayersList();
    updateCastleCost();
    renderBuildingsPanel();
    renderUpgradesPanel();
    updateLeaderboard();
    
    showNotification(`Bienvenue ${playerData.username} !`);
  });

  socket.on('chunkData', (data) => {
    data.buildings.forEach(building => {
      buildings.set(`${building.x},${building.y}`, building);
    });
    render();
  });

  socket.on('buildingPlaced', (data) => {
    buildings.set(`${data.x},${data.y}`, data);
    render();
    updateCastleCost();
  });

  socket.on('buildingDestroyed', (data) => {
    buildings.delete(`${data.x},${data.y}`);
    render();
    updateCastleCost();
  });

  socket.on('buildingUpgraded', (data) => {
    const building = buildings.get(`${data.x},${data.y}`);
    if (building) {
      building.level = data.level;
      render();
    }
  });

  socket.on('goldUpdate', (data) => {
    if (playerData) {
      playerData.gold = data.gold;
      updateGoldDisplay();
    }
  });

  socket.on('xpUpdate', (data) => {
    if (playerData) {
      playerData.xp = data.xp;
      playerData.level = data.level;
      updateLevelDisplay();
      renderBuildingsPanel();
    }
  });

  socket.on('upgradeUpdate', (data) => {
    if (playerData) {
      playerData.upgrades = data.upgrades;
      renderUpgradesPanel();
    }
  });

  socket.on('levelUp', (data) => {
    playerData.level = data.level;
    playerData.xp = data.xp;
    updateLevelDisplay();
    renderBuildingsPanel();
    showNotification(`🎉 NIVEAU ${data.level} !`, false, 'levelup');
  });

  socket.on('positionUpdate', (data) => {
    if (playerData) {
      playerData.x = data.x;
      playerData.y = data.y;
      
      cameraX = playerData.x * CELL_SIZE - canvas.width / 2;
      cameraY = playerData.y * CELL_SIZE - canvas.height / 2;
      
      render();
    }
  });

  socket.on('destroyStarted', (data) => {
    isDestroying = true;
    destroyTarget = { x: data.x, y: data.y };
    destroyIndicator.classList.add('active');
    
    const startTime = Date.now();
    const duration = data.duration;
    
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min((elapsed / duration) * 100, 100);
      destroyBar.style.width = progress + '%';
      
      if (progress >= 100 || !isDestroying) {
        clearInterval(interval);
      }
    }, 50);
  });

  socket.on('destroyComplete', (data) => {
    isDestroying = false;
    destroyTarget = null;
    destroyIndicator.classList.remove('active');
    destroyBar.style.width = '0%';
    showNotification(`+${data.reward}💰 pour destruction !`);
  });

  socket.on('playerJoined', (data) => {
    players.set(data.id, data);
    updatePlayersList();
    showNotification(`${data.username} a rejoint`);
  });

  socket.on('playerLeft', (data) => {
    const player = players.get(data.id);
    if (player) {
      showNotification(`${player.username} est parti`);
      players.delete(data.id);
      updatePlayersList();
    }
  });

  socket.on('playerMoved', (data) => {
    const player = players.get(data.id);
    if (player) {
      player.x = data.x;
      player.y = data.y;
      render();
    }
  });

  socket.on('playersList', (list) => {
    list.forEach(p => players.set(p.id, p));
    updatePlayersList();
  });

  socket.on('allianceCreated', (data) => {
    alliances.add(data.playerId);
    updatePlayersList();
    showNotification('Alliance créée !');
  });

  socket.on('leaderboardUpdate', (data) => {
    leaderboard = data;
    updateLeaderboard();
  });

  socket.on('error', (data) => {
    showNotification(data.message, true);
  });
}

function loadChunk() {
  socket.emit('loadChunk', {
    x: Math.floor(playerData.x),
    y: Math.floor(playerData.y),
    range: CHUNK_SIZE
  });
}

function render() {
  if (!ctx) return;

  ctx.fillStyle = '#0a0a15';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.translate(-cameraX, -cameraY);

  drawGrid();

  // Zone de spawn
  ctx.fillStyle = 'rgba(255, 255, 0, 0.05)';
  ctx.fillRect(-5 * CELL_SIZE, -5 * CELL_SIZE, 10 * CELL_SIZE, 10 * CELL_SIZE);
  ctx.strokeStyle = 'rgba(255, 255, 0, 0.3)';
  ctx.lineWidth = 2;
  ctx.strokeRect(-5 * CELL_SIZE, -5 * CELL_SIZE, 10 * CELL_SIZE, 10 * CELL_SIZE);

  // Bâtiments
  buildings.forEach(building => {
    const x = building.x * CELL_SIZE;
    const y = building.y * CELL_SIZE;

    ctx.fillStyle = building.color;
    ctx.fillRect(x, y, CELL_SIZE, CELL_SIZE);
    
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, CELL_SIZE, CELL_SIZE);

    // Icône
    const buildingData = BUILDINGS_DATA[building.type];
    if (buildingData) {
      ctx.font = '20px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(buildingData.icon, x + CELL_SIZE / 2, y + CELL_SIZE / 2);
    }

    // Niveau
    if (building.level > 1) {
      ctx.font = 'bold 10px Arial';
      ctx.fillStyle = 'white';
      ctx.strokeStyle = 'black';
      ctx.lineWidth = 2;
      ctx.strokeText(`Lv${building.level}`, x + CELL_SIZE - 10, y + 10);
      ctx.fillText(`Lv${building.level}`, x + CELL_SIZE - 10, y + 10);
    }
  });

  // Joueurs
  if (playerData) {
    const myX = playerData.x * CELL_SIZE + CELL_SIZE / 2;
    const myY = playerData.y * CELL_SIZE + CELL_SIZE / 2;

    // Cases adjacentes (portée de construction)
    const buildRange = (playerData.upgrades?.buildRange || 0) + 1;
    ctx.strokeStyle = 'rgba(255, 255, 0, 0.5)';
    ctx.lineWidth = 2;
    for (let dx = -buildRange; dx <= buildRange; dx++) {
      for (let dy = -buildRange; dy <= buildRange; dy++) {
        if (dx === 0 && dy === 0) continue;
        const adjX = (playerData.x + dx) * CELL_SIZE;
        const adjY = (playerData.y + dy) * CELL_SIZE;
        ctx.strokeRect(adjX, adjY, CELL_SIZE, CELL_SIZE);
      }
    }

    ctx.fillStyle = playerData.color;
    ctx.beginPath();
    ctx.arc(myX, myY, 16, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'white';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.fillStyle = 'white';
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(playerData.username, myX, myY - 30);
  }

  // Autres joueurs
  players.forEach(player => {
    if (player.id === playerData?.id) return;

    const px = player.x * CELL_SIZE + CELL_SIZE / 2;
    const py = player.y * CELL_SIZE + CELL_SIZE / 2;

    ctx.fillStyle = player.color;
    ctx.beginPath();
    ctx.arc(px, py, 12, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'white';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = 'white';
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(player.username, px, py - 20);
  });

  ctx.restore();
  updateCoords();
}

function drawGrid() {
  const startX = Math.floor(cameraX / CELL_SIZE) * CELL_SIZE;
  const startY = Math.floor(cameraY / CELL_SIZE) * CELL_SIZE;
  const endX = startX + canvas.width + CELL_SIZE;
  const endY = startY + canvas.height + CELL_SIZE;

  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 1;

  for (let x = startX; x < endX; x += CELL_SIZE) {
    ctx.beginPath();
    ctx.moveTo(x, startY);
    ctx.lineTo(x, endY);
    ctx.stroke();
  }

  for (let y = startY; y < endY; y += CELL_SIZE) {
    ctx.beginPath();
    ctx.moveTo(startX, y);
    ctx.lineTo(endX, y);
    ctx.stroke();
  }
}

function renderUpgradesPanel() {
  if (!playerData) return;

  upgradesContent.innerHTML = '<div class="upgrades-grid"></div>';
  const grid = upgradesContent.querySelector('.upgrades-grid');

  Object.entries(UPGRADES_DATA).forEach(([key, upgrade]) => {
    const currentLevel = playerData.upgrades?.[key] || 0;
    const cost = Math.floor(upgrade.baseCost * Math.pow(1.5, currentLevel));
    const isMaxed = currentLevel >= upgrade.maxLevel;

    const card = document.createElement('div');
    card.className = `upgrade-card ${isMaxed ? 'maxed' : ''}`;
    card.innerHTML = `
      <div class="upgrade-icon">${upgrade.icon}</div>
      <div class="upgrade-info">
        <strong>${upgrade.name}</strong>
        <p>${upgrade.desc}</p>
        <div class="upgrade-level">Niveau ${currentLevel}/${upgrade.maxLevel}</div>
        ${!isMaxed ? `<button class="upgrade-buy-btn" data-type="${key}">Améliorer (${cost}💰)</button>` : '<div class="maxed-badge">MAX</div>'}
      </div>
    `;

    if (!isMaxed) {
      card.querySelector('.upgrade-buy-btn').addEventListener('click', () => {
        socket.emit('upgradePlayer', { upgradeType: key });
      });
    }

    grid.appendChild(card);
  });
}

function renderBuildingsPanel() {
  if (!playerData) return;

  buildingsContent.innerHTML = '<div class="buildings-grid"></div>';
  const grid = buildingsContent.querySelector('.buildings-grid');

  Object.entries(BUILDINGS_DATA).forEach(([key, building]) => {
    const isUnlocked = playerData.level >= building.level;

    const card = document.createElement('div');
    card.className = `building-card ${isUnlocked ? 'unlocked' : 'locked'}`;
    card.innerHTML = `
      <div class="building-icon">${building.icon}</div>
      <div class="building-info">
        <strong>${building.name}</strong>
        <div class="building-stats">
          <div>💰 ${building.cost}</div>
          <div>📊 ${building.income}💰/sec</div>
        </div>
        <small>${isUnlocked ? `✅ Niveau ${building.level}` : `🔒 Niveau ${building.level} requis`}</small>
      </div>
    `;

    if (isUnlocked) {
      card.addEventListener('click', () => {
        selectedBuildingType = key;
        destroyBtn.classList.remove('active');
        showNotification(`Mode: Placer ${building.name}`);
        buildingsPanel.classList.remove('active');
      });
    }

    grid.appendChild(card);
  });
}

function handleKeyDown(e) {
  if (!playerData || !socket) return;

  let newX = playerData.x;
  let newY = playerData.y;

  if (e.key === 'ArrowUp' || e.key === 'z' || e.key === 'w') {
    newY--;
  } else if (e.key === 'ArrowDown' || e.key === 's') {
    newY++;
  } else if (e.key === 'ArrowLeft' || e.key === 'q' || e.key === 'a') {
    newX--;
  } else if (e.key === 'ArrowRight' || e.key === 'd') {
    newX++;
  } else {
    return;
  }

  socket.emit('move', { x: newX, y: newY });
}

function handleMouseDown(e) {
  if (e.button === 2) {
    isDragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragStartCamX = cameraX;
    dragStartCamY = cameraY;
    canvas.style.cursor = 'grabbing';
  } else if (e.button === 0) {
    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left + cameraX;
    const clickY = e.clientY - rect.top + cameraY;

    const gridX = Math.floor(clickX / CELL_SIZE);
    const gridY = Math.floor(clickY / CELL_SIZE);

    if (!selectedBuildingType && !destroyBtn.classList.contains('active')) {
      if (playerData) {
        const teleportRange = (playerData.upgrades?.teleport || 0) + 1;
        const dx = Math.abs(gridX - playerData.x);
        const dy = Math.abs(gridY - playerData.y);
        if (dx <= teleportRange && dy <= teleportRange && !(dx === 0 && dy === 0)) {
          socket.emit('move', { x: gridX, y: gridY });
        }
      }
    }
  }
}

function handleMouseMove(e) {
  if (isDragging) {
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;

    cameraX = dragStartCamX - dx;
    cameraY = dragStartCamY - dy;

    render();
  }
}

function handleMouseUp() {
  isDragging = false;
  canvas.style.cursor = 'crosshair';
}

function handleClick(e) {
  if (!playerData || isDragging) return;

  const rect = canvas.getBoundingClientRect();
  const clickX = e.clientX - rect.left + cameraX;
  const clickY = e.clientY - rect.top + cameraY;

  const gridX = Math.floor(clickX / CELL_SIZE);
  const gridY = Math.floor(clickY / CELL_SIZE);

  if (selectedBuildingType) {
    socket.emit('placeBuilding', { x: gridX, y: gridY, type: selectedBuildingType });
  } else if (destroyBtn.classList.contains('active')) {
    socket.emit('startDestroy', { x: gridX, y: gridY });
  }
}

function handleDoubleClick(e) {
  if (!playerData || !socket) return;

  const rect = canvas.getBoundingClientRect();
  const clickX = e.clientX - rect.left + cameraX;
  const clickY = e.clientY - rect.top + cameraY;

  const gridX = Math.floor(clickX / CELL_SIZE);
  const gridY = Math.floor(clickY / CELL_SIZE);

  const building = buildings.get(`${gridX},${gridY}`);
  if (building && building.player_id === playerData.id) {
    socket.emit('upgradeBuilding', { x: gridX, y: gridY });
  }
}

let touchStartX = 0, touchStartY = 0;
let touchStartCamX = 0, touchStartCamY = 0;
let isTouching = false;

function handleTouchStart(e) {
  e.preventDefault();
  if (e.touches.length === 1) {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    touchStartCamX = cameraX;
    touchStartCamY = cameraY;
    isTouching = true;
  }
}

function handleTouchMove(e) {
  e.preventDefault();
  if (isTouching && e.touches.length === 1) {
    const dx = e.touches[0].clientX - touchStartX;
    const dy = e.touches[0].clientY - touchStartY;

    cameraX = touchStartCamX - dx;
    cameraY = touchStartCamY - dy;

    render();
  }
}

function handleTouchEnd(e) {
  isTouching = false;
}

function updateCoords() {
  if (playerData) {
    coordsDiv.textContent = `X: ${playerData.x}, Y: ${playerData.y}`;
  }
}

function updateGoldDisplay() {
  goldDisplay.textContent = `💰 ${playerData.gold}`;
}

function updateLevelDisplay() {
  const xpRequired = Math.floor(100 * Math.pow(1.5, playerData.level - 1));
  levelDisplay.textContent = `⭐ Niv.${playerData.level} (${playerData.xp}/${xpRequired} XP)`;
}

function updateCastleCost() {
  if (!playerData) return;
  
  const playerBuildings = Array.from(buildings.values()).filter(b => b.player_id === playerData.id);
  const numCastles = playerBuildings.filter(b => b.type === 'castle').length;
  const cost = 50 * Math.pow(2, numCastles);
  castleCostSpan.textContent = `${cost}💰`;
}

function updatePlayersList() {
  playersList.innerHTML = '';
  
  players.forEach(player => {
    if (player.id === playerData?.id) return;

    const div = document.createElement('div');
    div.className = 'player-item';
    
    const isAllied = alliances.has(player.id);
    
    div.innerHTML = `
      <div class="name">
        <div class="color-dot" style="background: ${player.color}"></div>
        <span>${player.username}</span>
      </div>
      <button class="ally-btn ${isAllied ? 'allied' : ''}" data-id="${player.id}">
        ${isAllied ? '✓ Allié' : '+ Allier'}
      </button>
    `;

    div.querySelector('.ally-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      if (!isAllied) {
        socket.emit('createAlliance', { targetPlayerId: player.id });
      }
    });

    playersList.appendChild(div);
  });
}

function updateLeaderboard() {
  leaderboardContent.innerHTML = '';
  
  leaderboard.forEach((player, index) => {
    const div = document.createElement('div');
    div.className = 'leaderboard-item';
    
    const medals = ['🥇', '🥈', '🥉'];
    const rank = index < 3 ? medals[index] : `#${index + 1}`;
    
    div.innerHTML = `
      <div class="leaderboard-rank">${rank}</div>
      <div class="leaderboard-player">
        <div class="color-dot" style="background: ${player.color}"></div>
        <strong>${player.username}</strong>
      </div>
      <div class="leaderboard-stats">
        <div>🏰 ${player.castle_count || 0}</div>
        <div>💰 ${player.gold}</div>
        <div>🏗️ ${player.building_count || 0}</div>
      </div>
    `;
    
    leaderboardContent.appendChild(div);
  });
}

function showNotification(message, isError = false, type = 'normal') {
  const div = document.createElement('div');
  div.className = 'notification';
  div.style.borderLeftColor = isError ? '#d32f2f' : type === 'levelup' ? '#667eea' : '#4caf50';
  div.textContent = message;
  
  document.getElementById('notifications').appendChild(div);
  
  setTimeout(() => div.remove(), 3000);
}

function setCookie(name, value, days) {
  const d = new Date();
  d.setTime(d.getTime() + days * 24 * 60 * 60 * 1000);
  document.cookie = `${name}=${value};expires=${d.toUTCString()};path=/`;
}

function getCookie(name) {
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? match[2] : null;
}

window.addEventListener('DOMContentLoaded', init);

setInterval(() => {
  if (playerData) render();
}, 1000 / 30);
