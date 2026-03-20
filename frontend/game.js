// Configuration
const CELL_SIZE = 32;
const CHUNK_SIZE = 50;
const BACKEND_URL = window.location.origin;

// État
let socket = null;
let canvas, ctx;
let cameraX = 0, cameraY = 0;
let playerData = null;
let selectedBuildingType = null;
let isDestroying = false;
let destroyTarget = null;

// Stockage des données
let buildings = new Map(); // "x,y" -> {x, y, type, color, playerId, hp}
let players = new Map(); // playerId -> {id, username, color, x, y}
let alliances = new Set(); // Set de playerIds alliés

// Camera drag
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
const playersBtn = document.getElementById('playersBtn');
const helpBtn = document.getElementById('helpBtn');
const playersPanel = document.getElementById('playersPanel');
const helpPanel = document.getElementById('helpPanel');
const playersList = document.getElementById('playersList');
const destroyBtn = document.getElementById('destroyBtn');
const destroyIndicator = document.getElementById('destroyIndicator');
const destroyBar = document.getElementById('destroyBar');
const cancelDestroyBtn = document.getElementById('cancelDestroy');
const castleCostSpan = document.getElementById('castleCost');

// Init
function init() {
  canvas = document.getElementById('canvas');
  ctx = canvas.getContext('2d');
  
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  // Événements login
  joinBtn.addEventListener('click', joinGame);
  usernameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') joinGame();
  });

  // Boutons de construction
  document.querySelectorAll('.build-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedBuildingType = btn.dataset.type;
      destroyBtn.classList.remove('active');
      showNotification(`Mode: Placer ${btn.dataset.type}`);
    });
  });

  // Bouton détruire
  destroyBtn.addEventListener('click', () => {
    selectedBuildingType = null;
    destroyBtn.classList.add('active');
    showNotification('Mode: Détruire');
  });

  // Annuler destruction
  cancelDestroyBtn.addEventListener('click', () => {
    if (destroyTarget && socket) {
      socket.emit('cancelDestroy', destroyTarget);
    }
    isDestroying = false;
    destroyTarget = null;
    destroyIndicator.classList.remove('active');
  });

  // Panels
  playersBtn.addEventListener('click', () => {
    playersPanel.classList.toggle('active');
    helpPanel.classList.remove('active');
  });

  helpBtn.addEventListener('click', () => {
    helpPanel.classList.toggle('active');
    playersPanel.classList.remove('active');
  });

  document.querySelectorAll('.close-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.closest('.panel').classList.remove('active');
    });
  });

  // Canvas events
  canvas.addEventListener('mousedown', handleMouseDown);
  canvas.addEventListener('mousemove', handleMouseMove);
  canvas.addEventListener('mouseup', handleMouseUp);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('click', handleClick);

  // Keyboard pour déplacement
  window.addEventListener('keydown', handleKeyDown);

  // Touch support
  canvas.addEventListener('touchstart', handleTouchStart);
  canvas.addEventListener('touchmove', handleTouchMove);
  canvas.addEventListener('touchend', handleTouchEnd);

  usernameInput.focus();
}

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight - 70;
  render();
}

// Rejoindre le jeu
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
    goldDisplay.textContent = `💰 ${playerData.gold}`;

    cameraX = playerData.x * CELL_SIZE - canvas.width / 2;
    cameraY = playerData.y * CELL_SIZE - canvas.height / 2;

    data.onlinePlayers.forEach(p => {
      players.set(p.id, p);
    });

    loadChunk();

    loginScreen.classList.remove('active');
    gameScreen.classList.add('active');

    render();
    updatePlayersList();
    updateCastleCost();
    
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

  socket.on('goldUpdate', (data) => {
    if (playerData) {
      playerData.gold = data.gold;
      goldDisplay.textContent = `💰 ${playerData.gold}`;
    }
  });

  socket.on('positionUpdate', (data) => {
    if (playerData) {
      playerData.x = data.x;
      playerData.y = data.y;
      render();
    }
  });

  socket.on('destroyStarted', (data) => {
    isDestroying = true;
    destroyTarget = { x: data.x, y: data.y };
    destroyIndicator.classList.add('active');
    
    // Animer la barre
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

  socket.on('error', (data) => {
    showNotification(data.message, true);
  });
}

// Charger un chunk
function loadChunk() {
  const centerX = Math.floor(playerData.x);
  const centerY = Math.floor(playerData.y);

  socket.emit('loadChunk', {
    x: centerX,
    y: centerY,
    range: CHUNK_SIZE
  });
}

// Rendu
function render() {
  if (!ctx) return;

  ctx.fillStyle = '#0a0a15';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.translate(-cameraX, -cameraY);

  // Grille
  drawGrid();

  // Bâtiments
  buildings.forEach(building => {
    const x = building.x * CELL_SIZE;
    const y = building.y * CELL_SIZE;

    ctx.fillStyle = building.color;
    ctx.fillRect(x, y, CELL_SIZE, CELL_SIZE);
    
    // Bordure
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, CELL_SIZE, CELL_SIZE);

    // Icône
    ctx.font = '20px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (building.type === 'wall') {
      ctx.fillText('🧱', x + CELL_SIZE / 2, y + CELL_SIZE / 2);
    } else if (building.type === 'tower') {
      ctx.fillText('🗼', x + CELL_SIZE / 2, y + CELL_SIZE / 2);
    } else if (building.type === 'castle') {
      ctx.fillText('🏰', x + CELL_SIZE / 2, y + CELL_SIZE / 2);
    }
  });

  // Joueurs
  if (playerData) {
    // Mon joueur en plus gros
    const myX = playerData.x * CELL_SIZE + CELL_SIZE / 2;
    const myY = playerData.y * CELL_SIZE + CELL_SIZE / 2;

    // Grille des cases adjacentes
    ctx.strokeStyle = 'rgba(255, 255, 0, 0.5)';
    ctx.lineWidth = 2;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
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

// Déplacement clavier
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

// Interactions souris
function handleMouseDown(e) {
  if (e.button === 2) { // Clic droit
    isDragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragStartCamX = cameraX;
    dragStartCamY = cameraY;
    canvas.style.cursor = 'grabbing';
  } else if (e.button === 0) { // Clic gauche
    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left + cameraX;
    const clickY = e.clientY - rect.top + cameraY;

    const gridX = Math.floor(clickX / CELL_SIZE);
    const gridY = Math.floor(clickY / CELL_SIZE);

    // Déplacement par clic
    if (!selectedBuildingType && !destroyBtn.classList.contains('active')) {
      if (playerData) {
        const dx = Math.abs(gridX - playerData.x);
        const dy = Math.abs(gridY - playerData.y);
        if (dx <= 1 && dy <= 1 && !(dx === 0 && dy === 0)) {
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

// Touch support
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

// UI
function updateCoords() {
  if (playerData) {
    coordsDiv.textContent = `X: ${playerData.x}, Y: ${playerData.y}`;
  }
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

function showNotification(message, isError = false) {
  const div = document.createElement('div');
  div.className = 'notification';
  div.style.borderLeftColor = isError ? '#d32f2f' : '#4caf50';
  div.textContent = message;
  
  document.getElementById('notifications').appendChild(div);
  
  setTimeout(() => div.remove(), 3000);
}

// Cookies
function setCookie(name, value, days) {
  const d = new Date();
  d.setTime(d.getTime() + days * 24 * 60 * 60 * 1000);
  document.cookie = `${name}=${value};expires=${d.toUTCString()};path=/`;
}

function getCookie(name) {
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? match[2] : null;
}

// Lancer le jeu
window.addEventListener('DOMContentLoaded', init);

// Render loop
setInterval(() => {
  if (playerData) render();
}, 1000 / 30);
