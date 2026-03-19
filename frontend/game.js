// Configuration
const CELL_SIZE = 32;
const CHUNK_SIZE = 50;
const BACKEND_URL = window.location.origin;

// État
let socket = null;
let canvas, ctx;
let cameraX = 0, cameraY = 0;
let playerData = null;
let currentTool = 'move';
let paintColor = '#ff0000';

// Stockage des données
let blocks = new Map(); // "x,y" -> {x, y, type, color, playerId}
let pixels = new Map(); // "x,y" -> {x, y, color, playerId}
let players = new Map(); // playerId -> {id, username, color, x, y}
let alliances = new Set(); // Set de playerIds alliés

// Camera drag
let isDragging = false;
let lastMouseX = 0, lastMouseY = 0;

// Éléments DOM
const loginScreen = document.getElementById('loginScreen');
const gameScreen = document.getElementById('gameScreen');
const usernameInput = document.getElementById('usernameInput');
const joinBtn = document.getElementById('joinBtn');
const coordsDiv = document.getElementById('coords');
const playerNameSpan = document.getElementById('playerName');
const playerColorDiv = document.getElementById('playerColor');
const playersBtn = document.getElementById('playersBtn');
const helpBtn = document.getElementById('helpBtn');
const playersPanel = document.getElementById('playersPanel');
const helpPanel = document.getElementById('helpPanel');
const playersList = document.getElementById('playersList');
const paintColorInput = document.getElementById('paintColor');
const colorPicker = document.getElementById('colorPicker');

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

  // Outils
  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentTool = btn.dataset.tool;
      
      // Montrer color picker si paint
      colorPicker.classList.toggle('active', currentTool === 'paint');
    });
  });

  paintColorInput.addEventListener('change', (e) => {
    paintColor = e.target.value;
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
  canvas.addEventListener('wheel', handleWheel);
  canvas.addEventListener('click', handleClick);

  // Touch support
  canvas.addEventListener('touchstart', handleTouchStart);
  canvas.addEventListener('touchmove', handleTouchMove);
  canvas.addEventListener('touchend', handleTouchEnd);

  usernameInput.focus();
}

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight - 70; // HUD height
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
    
    // Sauvegarder l'ID dans un cookie
    setCookie('playerId', playerData.id, 365);

    // Mettre à jour UI
    playerNameSpan.textContent = playerData.username;
    playerColorDiv.style.backgroundColor = playerData.color;

    // Centrer caméra
    cameraX = playerData.x * CELL_SIZE - canvas.width / 2;
    cameraY = playerData.y * CELL_SIZE - canvas.height / 2;

    // Charger les joueurs
    data.onlinePlayers.forEach(p => {
      players.set(p.id, p);
    });

    // Charger la zone
    loadChunk();

    // Passer à l'écran de jeu
    loginScreen.classList.remove('active');
    gameScreen.classList.add('active');

    render();
    updatePlayersList();
    
    showNotification(`Bienvenue ${playerData.username} !`);
  });

  socket.on('chunkData', (data) => {
    // Charger les blocs
    data.blocks.forEach(block => {
      blocks.set(`${block.x},${block.y}`, block);
    });

    // Charger les pixels
    data.pixels.forEach(pixel => {
      pixels.set(`${pixel.x},${pixel.y}`, pixel);
    });

    render();
  });

  socket.on('blockPlaced', (data) => {
    blocks.set(`${data.x},${data.y}`, data);
    render();
  });

  socket.on('blockDestroyed', (data) => {
    blocks.delete(`${data.x},${data.y}`);
    render();
  });

  socket.on('pixelDrawn', (data) => {
    pixels.set(`${data.x},${data.y}`, data);
    render();
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
}

// Charger un chunk
function loadChunk() {
  const centerX = Math.floor(cameraX / CELL_SIZE + canvas.width / 2 / CELL_SIZE);
  const centerY = Math.floor(cameraY / CELL_SIZE + canvas.height / 2 / CELL_SIZE);

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

  // Pixels dessinés
  pixels.forEach(pixel => {
    ctx.fillStyle = pixel.color;
    ctx.fillRect(pixel.x * CELL_SIZE, pixel.y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
  });

  // Blocs
  blocks.forEach(block => {
    ctx.fillStyle = block.color;
    ctx.fillRect(block.x * CELL_SIZE, block.y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
    
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 2;
    ctx.strokeRect(block.x * CELL_SIZE, block.y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
  });

  // Joueurs
  players.forEach(player => {
    const px = player.x * CELL_SIZE + CELL_SIZE / 2;
    const py = player.y * CELL_SIZE + CELL_SIZE / 2;

    // Cercle joueur
    ctx.fillStyle = player.color;
    ctx.beginPath();
    ctx.arc(px, py, 12, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'white';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Nom
    ctx.fillStyle = 'white';
    ctx.font = '14px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(player.username, px, py - 20);
  });

  ctx.restore();

  // Mettre à jour coordonnées
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

// Interactions
function handleMouseDown(e) {
  if (e.button === 2 || currentTool === 'move') {
    isDragging = true;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    canvas.style.cursor = 'grabbing';
  }
}

function handleMouseMove(e) {
  if (isDragging) {
    const dx = e.clientX - lastMouseX;
    const dy = e.clientY - lastMouseY;

    cameraX -= dx;
    cameraY -= dy;

    lastMouseX = e.clientX;
    lastMouseY = e.clientY;

    render();
  }
}

function handleMouseUp() {
  isDragging = false;
  canvas.style.cursor = 'crosshair';
}

function handleWheel(e) {
  e.preventDefault();
  // Zoom désactivé pour simplicité
}

function handleClick(e) {
  if (!playerData || isDragging) return;

  const rect = canvas.getBoundingClientRect();
  const clickX = e.clientX - rect.left + cameraX;
  const clickY = e.clientY - rect.top + cameraY;

  const gridX = Math.floor(clickX / CELL_SIZE);
  const gridY = Math.floor(clickY / CELL_SIZE);

  if (currentTool === 'place') {
    socket.emit('placeBlock', { x: gridX, y: gridY, type: 'block' });
  } else if (currentTool === 'destroy') {
    socket.emit('destroyBlock', { x: gridX, y: gridY });
  } else if (currentTool === 'paint') {
    socket.emit('drawPixel', { x: gridX, y: gridY, color: paintColor });
  }
}

// Touch support
let touchStartX = 0, touchStartY = 0;
function handleTouchStart(e) {
  e.preventDefault();
  if (e.touches.length === 1) {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    isDragging = true;
  }
}

function handleTouchMove(e) {
  e.preventDefault();
  if (isDragging && e.touches.length === 1) {
    const dx = e.touches[0].clientX - touchStartX;
    const dy = e.touches[0].clientY - touchStartY;

    cameraX -= dx;
    cameraY -= dy;

    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;

    render();
  }
}

function handleTouchEnd(e) {
  isDragging = false;
  
  // Si tap rapide, placer bloc
  if (e.changedTouches.length === 1 && currentTool !== 'move') {
    handleClick({ 
      clientX: e.changedTouches[0].clientX, 
      clientY: e.changedTouches[0].clientY 
    });
  }
}

// UI
function updateCoords() {
  const centerX = Math.floor(cameraX / CELL_SIZE + canvas.width / 2 / CELL_SIZE);
  const centerY = Math.floor(cameraY / CELL_SIZE + canvas.height / 2 / CELL_SIZE);
  coordsDiv.textContent = `X: ${centerX}, Y: ${centerY}`;
}

function updatePlayersList() {
  playersList.innerHTML = '';
  
  players.forEach(player => {
    if (player.id === playerData?.id) return; // Pas soi-même

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

function showNotification(message) {
  const div = document.createElement('div');
  div.className = 'notification';
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
}, 1000 / 30); // 30 FPS
