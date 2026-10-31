'use strict';

const express = require('express');
const http = require('node:http');
const { Server } = require('socket.io');
const { randomUUID, randomBytes } = require('node:crypto');

const PORT = Number(process.env.PORT) || 3000;
const allowedOrigins = new Set(
  (process.env.ALLOWED_ORIGINS || 'http://localhost:5500,http://127.0.0.1:5500,http://localhost:5501,http://127.0.0.1:5501')
    .split(',').map(value => value.trim()).filter(Boolean)
);

const app = express();
app.disable('x-powered-by');
app.get('/health', (_req, res) => res.json({ ok: true, service: 'iron-throne-game-server' }));
app.get('/', (_req, res) => res.type('text').send('The Iron Throne multiplayer server is running.'));
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) return callback(null, true);
      return callback(new Error(`Origin not allowed: ${origin}`), false);
    },
    methods: ['GET', 'POST']
  },
  allowRequest(req, callback) {
    const origin = req.headers.origin;
    callback(null, !origin || allowedOrigins.has(origin));
  }
});

const HOUSE_DEFS = [
  { id: 'stark', name: 'Stark', type: 'major', color: '#91a8c1', sigil: '🐺', motto: 'Winter is Coming', capital: 'Winterfell', buff: 'Northern resilience: +2 defense when Winterfell is attacked.', nerf: null },
  { id: 'lannister', name: 'Lannister', type: 'major', color: '#c8a45c', sigil: '🦁', motto: 'Hear Me Roar!', capital: 'Casterly Rock', buff: 'A rich house: begins with 5 extra gold.', nerf: null },
  { id: 'baratheon', name: 'Baratheon', type: 'major', color: '#c7b8a0', sigil: '🦌', motto: 'Ours Is the Fury', capital: 'Storm’s End', buff: 'Royal succession: one player of House Baratheon is chosen at random as the first king.', nerf: null },
  { id: 'targaryen', name: 'Targaryen', type: 'minor', color: '#bf6258', sigil: '🐉', motto: 'Fire and Blood', capital: 'Dragonstone', buff: 'Dragonlord: begins with 1 dragon; each dragon adds 5 battle strength and +2 siege strength.', nerf: 'The realm fears dragons: failed spy missions against this house are more likely.' },
  { id: 'tyrell', name: 'Tyrell', type: 'minor', color: '#76a77d', sigil: '🌹', motto: 'Growing Strong', capital: 'Highgarden', buff: 'The Reach: gains 2 extra gold per capital at round start.', nerf: 'Lavish courts: infantry recruitment costs 5 gold each.' },
  { id: 'greyjoy', name: 'greyjoy', type: 'minor', color: '#8f9da7', sigil: '🐙', motto: 'We Do Not Sow', capital: 'Pyke', buff: 'Iron Fleet: ships cost 4 gold each.', nerf: 'Hard shores: infantry recruitment costs 5 gold each.' },
  { id: 'martell', name: 'martell', type: 'minor', color: '#d49b62', sigil: '☀', motto: 'Unbowed, Unbent, Unbroken', capital: 'Sunspear', buff: 'Desert defense: +2 defense when Sunspear is attacked.', nerf: 'Distant ports: naval recruitment costs 6 gold each.' },
  { id: 'arryn', name: 'arryn', type: 'minor', color: '#8cb8c9', sigil: '🦅', motto: 'As High as Honor', capital: 'The Eyrie', buff: 'High ground: +2 defense when the Eyrie is attacked.', nerf: 'Mountain roads: infantry recruitment costs 5 gold each.' }
];

const CAPITAL_DEFS = [
  { id: 'winterfell', name: 'Winterfell', region: 'The North', icon: '❄', defense: 5, originalHouseId: 'stark' },
  { id: 'casterly-rock', name: 'Casterly Rock', region: 'The Westerlands', icon: '⛰', defense: 5, originalHouseId: 'lannister' },
  { id: 'storms-end', name: 'Storm’s End', region: 'The Stormlands', icon: '⛈', defense: 5, originalHouseId: 'baratheon' },
  { id: 'dragonstone', name: 'Dragonstone', region: 'The Crownlands', icon: '🐉', defense: 4, originalHouseId: 'targaryen' },
  { id: 'highgarden', name: 'Highgarden', region: 'The Reach', icon: '🌹', defense: 4, originalHouseId: 'tyrell' },
  { id: 'pyke', name: 'Pyke', region: 'The Iron Islands', icon: '⚓', defense: 4, originalHouseId: 'greyjoy' },
  { id: 'sunspear', name: 'Sunspear', region: 'Dorne', icon: '☀', defense: 4, originalHouseId: 'martell' },
  { id: 'the-eyrie', name: 'The Eyrie', region: 'The Vale', icon: '🦅', defense: 4, originalHouseId: 'arryn' }
];

let players = new Map();
let tokenToPlayerId = new Map();
let alliances = [];
let allianceOffers = [];
let publicMessages = [];
let privateMessages = [];
let events = [];
let houses;
let capitals;
let phase;
let round;
let hostId;
let kingPlayerId;
let handPlayerId;
let runoff;
let candidateIds;
let voterIds;
let gameSettings;

function freshHouses() {
  return HOUSE_DEFS.map(def => ({
    ...def,
    money: 15 + (def.id === 'lannister' ? 5 : 0),
    infantry: 8,
    navy: 4,
    dragons: def.id === 'targaryen' ? 1 : 0,
    infantryCost: ['tyrell', 'greyjoy', 'arryn'].includes(def.id) ? 5 : def.id === 'targaryen' ? 4 : 4,
    navyCost: def.id === 'greyjoy' ? 4 : def.id === 'martell' ? 6 : 5,
    pendingAttack: null,
    hasAttackedThisRound: false,
    commandUsedRound: 0,
    lockedUntilRound: 0,
    spyReports: []
  }));
}
function freshCapitals() {
  return CAPITAL_DEFS.map(cap => ({ ...cap, ownerHouseId: cap.originalHouseId }));
}
function resetWorld(keepPlayers = true) {
  phase = 'LOBBY';
  round = 1;
  gameSettings = { configured: false, maxPlayers: 4, gameType: 'CLASSIC' };
  kingPlayerId = null;
  handPlayerId = null;
  runoff = false;
  candidateIds = [];
  voterIds = [];
  houses = freshHouses();
  capitals = freshCapitals();
  alliances.length = 0;
  allianceOffers.length = 0;
  publicMessages.length = 0;
  privateMessages.length = 0;
  events.length = 0;
  if (!keepPlayers) {
    players.clear();
    tokenToPlayerId.clear();
    hostId = null;
  } else {
    for (const p of players.values()) {
      p.houseId = null;
      p.vote = null;
      p.lastSpyRound = 0;
      p.isKing = false;
      p.isHand = false;
    }
  }
  addEvent('important', 'The Great Houses gather. The realm is reset and the lobby is open.');
}
resetWorld(false);
const gameRooms = new Map();
const roomOwners = new Map();
const hostDisconnectTimers = new Map();
const HOST_DISCONNECT_GRACE_MS = 2 * 60 * 1000;
function cancelHostDisconnect(roomCode) {
  const timer = hostDisconnectTimers.get(roomCode);
  if (timer) clearTimeout(timer);
  hostDisconnectTimers.delete(roomCode);
}
function endGameRoom(roomCode, message) {
  if (!gameRooms.has(roomCode)) return;
  cancelHostDisconnect(roomCode);
  io.to(roomCode).emit('game-ended', { message });
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.gameCode !== roomCode) continue;
    socket.data.gameCode = null;
    socket.data.playerId = null;
    socket.data.roomOwnerToken = null;
    socket.leave(roomCode);
  }
  gameRooms.delete(roomCode);
  roomOwners.delete(roomCode);
}
function scheduleHostDisconnect(roomCode) {
  cancelHostDisconnect(roomCode);
  const timer = setTimeout(() => {
    const roomExists = gameRooms.has(roomCode);
    if (!roomExists) return hostDisconnectTimers.delete(roomCode);
    const hostOnline = withWorld(roomCode, () => {
      const host = hostId ? players.get(hostId) : null;
      if (host) return host.connected;
      const ownerToken = roomOwners.get(roomCode);
      return [...io.sockets.sockets.values()].some(socket => socket.data.gameCode === roomCode && socket.data.roomOwnerToken === ownerToken);
    });
    if (hostOnline) return hostDisconnectTimers.delete(roomCode);
    endGameRoom(roomCode, 'This game ended because the host did not reconnect in time.');
  }, HOST_DISCONNECT_GRACE_MS);
  hostDisconnectTimers.set(roomCode, timer);
}
function captureWorld() {
  return { players, tokenToPlayerId, alliances, allianceOffers, publicMessages, privateMessages, events, houses, capitals, phase, round, hostId, kingPlayerId, handPlayerId, runoff, candidateIds, voterIds, gameSettings };
}
function activateWorld(world) {
  ({ players, tokenToPlayerId, alliances, allianceOffers, publicMessages, privateMessages, events, houses, capitals, phase, round, hostId, kingPlayerId, handPlayerId, runoff, candidateIds, voterIds, gameSettings } = world);
}
const initialWorld = structuredClone(captureWorld());
function withWorld(roomCode, callback) {
  const room = gameRooms.get(roomCode);
  if (!room) return null;
  const previous = captureWorld();
  activateWorld(room);
  try { return callback(); }
  finally {
    gameRooms.set(roomCode, captureWorld());
    activateWorld(previous);
  }
}

function findHouse(id) { return houses.find(h => h.id === id) || null; }
function findCapital(id) { return capitals.find(c => c.id === id) || null; }
function houseName(id) { return findHouse(id)?.name || 'Unknown house'; }
function getPlayerForSocket(socket) {
  const id = socket.data.playerId;
  return id ? players.get(id) || null : null;
}
function addEvent(kind, text) {
  events.unshift({ id: randomUUID(), round, kind, text: String(text).slice(0, 400) });
  if (events.length > 80) events.length = 80;
}
function connectedPlayers() { return [...players.values()].filter(p => p.connected && !p.left); }
function eligiblePlayers() { return [...players.values()].filter(p => p.connected && !p.left && p.houseId); }
function runBotTurns() {
  for (const bot of players.values()) {
    if (!bot.isBot || bot.left || !bot.houseId) continue;
    const house = findHouse(bot.houseId);
    if (!house || house.lockedUntilRound >= round) continue;
    const amount = Math.min(2, Math.floor(house.money / house.infantryCost));
    if (amount < 1) continue;
    house.money -= amount * house.infantryCost;
    house.infantry += amount;
    addEvent('normal', `${bot.username} recruited ${amount} infantry for House ${house.name}.`);
  }
}
function recalculateCapitalCounts() {
  for (const h of houses) h.capitalCount = capitals.filter(c => c.ownerHouseId === h.id).length;
}
function playerPublic(p) {
  return { id: p.id, username: p.username, connected: p.connected, left: Boolean(p.left), isBot: Boolean(p.isBot), houseId: p.houseId, isKing: p.id === kingPlayerId, isHand: p.id === handPlayerId };
}
function currentHouseView(h) {
  if (!h) return null;
  const { money, infantry, navy, dragons, infantryCost, navyCost, pendingAttack, hasAttackedThisRound, commandUsedRound, lockedUntilRound, spyReports, ...definition } = h;
  const members = [...players.values()].filter(p => p.houseId === h.id).map(p => ({ id: p.id, username: p.username, connected: p.connected, left: Boolean(p.left) }));
  return { ...definition, players: members, capitalCount: capitals.filter(c => c.ownerHouseId === h.id).length };
}
function makePrivateHouseView(h) {
  if (!h) return null;
  const target = h.pendingAttack ? findCapital(h.pendingAttack.targetCapitalId) : null;
  return {
    id: h.id, name: h.name, money: h.money, infantry: h.infantry, navy: h.navy, dragons: h.dragons,
    infantryCost: h.infantryCost, navyCost: h.navyCost,
    pendingAttack: h.pendingAttack ? {
      ...h.pendingAttack,
      targetName: target?.name || h.pendingAttack.targetName,
      units: { ...h.pendingAttack.units }
    } : null,
    hasAttackedThisRound: h.hasAttackedThisRound,
    commandUsedRound: h.commandUsedRound,
    lockedByEmbargo: h.lockedUntilRound >= round,
  };
}
function viewFor(playerId) {
  recalculateCapitalCounts();
  const me = playerId ? players.get(playerId) : null;
  const myHouse = me?.houseId ? findHouse(me.houseId) : null;
  const voteCandidates = (candidateIds.length ? candidateIds : eligiblePlayers().map(p => p.id))
    .map(id => players.get(id)).filter(Boolean).map(p => ({ id: p.id, username: p.username, houseId: p.houseId }));
  const visibleOffers = allianceOffers.filter(o => o.scope === 'public' || (myHouse && (o.fromHouseId === myHouse.id || o.toHouseId === myHouse.id)))
    .map(o => ({ ...o, isOutgoing: Boolean(myHouse && o.fromHouseId === myHouse.id), canRespond: Boolean(myHouse && o.toHouseId === myHouse.id) }));
  const visibleAlliances = alliances.filter(a => a.scope === 'public' || (myHouse && (a.houseA === myHouse.id || a.houseB === myHouse.id))).map(a => ({ ...a }));
  const privateForMe = myHouse ? privateMessages.filter(m => m.senderHouseId === myHouse.id || m.targetHouseId === myHouse.id).map(m => ({
    ...m, senderHouseName: houseName(m.senderHouseId), targetHouseName: houseName(m.targetHouseId)
  })) : [];
  return {
    phase, round, hostId, king: kingPlayerId && players.has(kingPlayerId) ? { id: kingPlayerId, username: players.get(kingPlayerId).username } : null,
    hand: handPlayerId && players.has(handPlayerId) ? { id: handPlayerId, username: players.get(handPlayerId).username } : null,
    settings: { ...gameSettings },
    isHost: Boolean(me && me.id === hostId), isKing: Boolean(me && me.id === kingPlayerId), isHand: Boolean(me && me.id === handPlayerId),
    me: me ? { id: me.id, username: me.username, houseId: me.houseId, vote: me.vote, lastSpyRound: me.lastSpyRound } : null,
    myHouse: makePrivateHouseView(myHouse),
    houses: houses.map(currentHouseView),
    players: [...players.values()].map(playerPublic),
    capitals: capitals.map(c => ({ ...c })),
    minorHousesUnlocked: Number(gameSettings.maxPlayers) >= 7,
    voteCandidates,
    votesCast: voterIds.filter(id => players.get(id)?.vote).length,
    voteTotal: voterIds.length,
    runoff,
    allianceOffers: visibleOffers,
    alliances: visibleAlliances,
    publicMessages: publicMessages.map(m => ({ ...m })),
    privateMessages: privateForMe,
    spyReports: myHouse ? myHouse.spyReports.map(r => ({ ...r })) : [],
    events: events.map(e => ({ ...e }))
  };
}
function broadcastState(roomCode) {
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.gameCode === roomCode) socket.emit('state', viewFor(socket.data.playerId || null));
  }
}
function ack(callback, result) {
  if (typeof callback === 'function') callback(result);
}
function fail(message) { return { ok: false, message }; }
function ok(message) { return { ok: true, message }; }
function action(socket, eventName, handler) {
  socket.on(eventName, (payload = {}, callback) => {
    try {
      const roomCode = socket.data.gameCode;
      if (!roomCode) return ack(callback, fail('Create or join a game before continuing.'));
      const result = withWorld(roomCode, () => {
        const player = getPlayerForSocket(socket);
        const outcome = handler(player, payload || {}, socket);
        if (outcome?.ok !== false) broadcastState(roomCode);
        return outcome;
      });
      ack(callback, result || fail('That game room is no longer available.'));
    } catch (error) {
      console.error(`Action ${eventName} failed:`, error);
      ack(callback, fail('The server could not complete that action. Try again.'));
    }
  });
}
function requirePlayer(player) { return player || fail('Enter the realm before taking that action.'); }
function requireHouse(player) {
  if (!player) return fail('Enter the realm before taking that action.');
  const h = player.houseId ? findHouse(player.houseId) : null;
  return h || fail('Choose a house first.');
}
function isHost(player) { return Boolean(player && player.id === hostId); }
function isCourt() { return phase === 'COURT'; }
function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

io.on('connection', socket => {
  socket.data.playerId = null;
  socket.data.gameCode = null;
  socket.on('create-game-room', (payload = {}, callback) => {
    const ownerToken = String(payload.clientToken || '');
    if (ownerToken.length < 16 || ownerToken.length > 200) return ack(callback, fail('Your browser session token is invalid. Refresh and try again.'));
    if (socket.data.gameCode) socket.leave(socket.data.gameCode);
    let pin;
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    do {
      const bytes = randomBytes(4);
      pin = [...bytes].map(byte => alphabet[byte & 31]).join('');
    } while (gameRooms.has(pin));
    gameRooms.set(pin, structuredClone(initialWorld));
    roomOwners.set(pin, ownerToken);
    socket.data.gameCode = pin;
    socket.data.playerId = null;
    socket.data.roomOwnerToken = ownerToken;
    socket.join(pin);
    withWorld(pin, () => socket.emit('state', viewFor(null)));
    ack(callback, { ...ok('Game created.'), pin });
  });

  socket.on('join-game-room', ({ pin: requestedPin, clientToken } = {}, callback) => {
    const pin = String(requestedPin || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    if (!gameRooms.has(pin)) return ack(callback, fail('No game was found with that PIN. Check it and try again.'));
    if (socket.data.gameCode) socket.leave(socket.data.gameCode);
    socket.data.gameCode = pin;
    socket.data.playerId = null;
    socket.data.roomOwnerToken = String(clientToken || '') === roomOwners.get(pin) ? String(clientToken) : null;
    socket.join(pin);
    if (socket.data.roomOwnerToken) cancelHostDisconnect(pin);
    withWorld(pin, () => socket.emit('state', viewFor(null)));
    ack(callback, { ...ok('Joined the game.'), pin });
  });

  socket.on('request-state', () => {
    const roomCode = socket.data.gameCode;
    if (!roomCode) return socket.emit('state', viewFor(null));
    withWorld(roomCode, () => socket.emit('state', viewFor(socket.data.playerId || null)));
  });

  socket.on('set-room-settings', (payload = {}, callback) => {
    const roomCode = socket.data.gameCode;
    if (!roomCode || roomOwners.get(roomCode) !== String(payload.clientToken || '') || socket.data.roomOwnerToken !== String(payload.clientToken || '')) return ack(callback, fail('Only the game host can prepare this room.'));
    withWorld(roomCode, () => {
      if (phase !== 'LOBBY') return ack(callback, fail('Game setup is closed after the game begins.'));
      if (gameSettings.configured) return ack(callback, fail('This game has already been prepared.'));
      const maxPlayers = Number(payload.maxPlayers);
      const gameType = String(payload.gameType || '');
      if (!Number.isInteger(maxPlayers) || maxPlayers < 2 || maxPlayers > 16) return ack(callback, fail('Choose a player limit from 2 to 16.'));
      if (!['CLASSIC', 'LAST_DRAGON'].includes(gameType)) return ack(callback, fail('Choose Classic or Last Dragon.'));
      gameSettings = { configured: true, maxPlayers, gameType };
      addEvent('important', `The host set up a ${gameType === 'LAST_DRAGON' ? 'Last Dragon' : 'Classic'} game for ${maxPlayers} players.`);
      broadcastState(roomCode);
      ack(callback, ok('Game prepared. Choose your house to continue.'));
    });
  });

  socket.on('login', (payload = {}, callback) => {
    const roomCode = socket.data.gameCode;
    if (!roomCode) return ack(callback, fail('Create or join a game before entering the realm.'));
    const result = withWorld(roomCode, () => {
      const name = String(payload.username || '').trim().replace(/\s+/g, ' ');
      const token = String(payload.clientToken || '');
      if (name.length < 2 || name.length > 22) return fail('Name must be between 2 and 22 characters.');
      if (token.length < 16 || token.length > 200) return fail('This browser session token is invalid. Refresh the page and try again.');

      let playerId = tokenToPlayerId.get(token);
      let player = playerId ? players.get(playerId) : null;
      let isNew = false;
      if (!player) {
        if (!hostId && roomOwners.get(roomCode) !== token) return fail('Waiting for the host to enter the game. Try again in a moment.');
        if (hostId && !gameSettings.configured) return fail('The host is setting up the game. Try joining again in a moment.');
        if (phase !== 'LOBBY') return fail('This game has already started.');
        if (gameSettings.configured && [...players.values()].filter(existing => !existing.left).length >= gameSettings.maxPlayers) return fail('This game is full.');
        playerId = randomUUID();
        player = { id: playerId, username: name, token, houseId: null, vote: null, lastSpyRound: 0, connected: true, left: false, socketId: socket.id };
        players.set(playerId, player);
        tokenToPlayerId.set(token, playerId);
        isNew = true;
        if (!hostId) hostId = playerId;
        addEvent('normal', `${name} entered the realm.`);
      } else {
        player.username = name;
        player.connected = true;
        player.left = false;
        player.socketId = socket.id;
        if (player.houseId && phase === 'LOBBY') {
          const h = findHouse(player.houseId);
          if (h) player.houseId = h.id;
        }
      }
      socket.data.playerId = playerId;
      if (playerId === hostId || token === roomOwners.get(roomCode)) cancelHostDisconnect(roomCode);
      broadcastState(roomCode);
      return ok(isNew ? 'Welcome to the realm.' : 'Welcome back. Your browser session was restored.');
    });
    ack(callback, result || fail('That game room is no longer available.'));
  });

  socket.on('logout-player', (_payload, callback) => {
    const roomCode = socket.data.gameCode;
    if (!roomCode) return ack(callback, ok('Signed out.'));
    let hostSignedOut = false;
    let noHost = false;
    withWorld(roomCode, () => {
      const player = getPlayerForSocket(socket);
      if (player && player.socketId === socket.id) {
        player.connected = false;
        player.left = true;
        player.socketId = null;
        hostSignedOut = player.id === hostId;
      }
      noHost = !hostId;
      socket.data.playerId = null;
      if (socket.data.roomOwnerToken) socket.data.roomOwnerToken = null;
      broadcastState(roomCode);
    });
    if (hostSignedOut || (roomOwners.get(roomCode) && noHost)) endGameRoom(roomCode, 'The host left. This game has ended.');
    ack(callback, ok('Signed out.'));
  });

  socket.on('disconnect', () => {
    const roomCode = socket.data.gameCode;
    if (!roomCode) return;
    let wasHost = false;
    let noHost = false;
    const wasRoomOwner = Boolean(socket.data.roomOwnerToken && socket.data.roomOwnerToken === roomOwners.get(roomCode));
    withWorld(roomCode, () => {
      const player = getPlayerForSocket(socket);
      noHost = !hostId;
      if (!player || player.socketId !== socket.id) return;
      player.connected = false;
      player.socketId = null;
      wasHost = player.id === hostId;
      broadcastState(roomCode);
    });
    if (wasHost || (wasRoomOwner && noHost)) scheduleHostDisconnect(roomCode);
  });

  action(socket, 'select-house', (player, payload) => {
    const check = requirePlayer(player); if (check.ok === false) return check;
    if (phase !== 'LOBBY') return fail('House selection is closed after the lobby.');
    const h = findHouse(String(payload.houseId || '')); if (!h) return fail('That house does not exist.');
    if (h.type === 'minor' && Number(gameSettings.maxPlayers) < 7) return fail('Minor houses unlock when the host sets a player limit of 7 or more.');
    if (h.type === 'minor' && [...players.values()].some(p => !p.left && p.houseId === h.id && p.id !== player.id)) return fail('That minor house has already been claimed.');
    const previous = player.houseId;
    player.houseId = h.id;
    player.vote = null;
    if (previous !== h.id) addEvent('normal', `${player.username} joined House ${h.name}.`);
    return ok(`You have joined House ${h.name}.`);
  });

  action(socket, 'set-game-settings', (player, payload) => {
    const check = requirePlayer(player); if (check.ok === false) return check;
    if (!isHost(player)) return fail('Only the host can set up this game.');
    if (phase !== 'LOBBY') return fail('Game setup is closed after the game begins.');
    const maxPlayers = Number(payload.maxPlayers);
    const gameType = String(payload.gameType || '');
    if (!Number.isInteger(maxPlayers) || maxPlayers < 2 || maxPlayers > 16) return fail('Choose a player limit from 2 to 16.');
    const activeCount = [...players.values()].filter(existing => !existing.left).length;
    if (maxPlayers < activeCount) return fail(`The player limit cannot be lower than the ${activeCount} players already joined.`);
    if (!['CLASSIC', 'LAST_DRAGON'].includes(gameType)) return fail('Choose Classic or Last Dragon.');
    gameSettings = { configured: true, maxPlayers, gameType };
    addEvent('important', `The host set up a ${gameType === 'LAST_DRAGON' ? 'Last Dragon' : 'Classic'} game for ${maxPlayers} players.`);
    return ok('Game setup saved. The hall is open.');
  });

  action(socket, 'edit-player-name', (player, payload) => {
    const check = requirePlayer(player); if (check.ok === false) return check;
    if (phase !== 'LOBBY') return fail('Names can only be changed in the lobby.');
    const name = String(payload.username || '').trim().replace(/\s+/g, ' ');
    if (name.length < 2 || name.length > 22) return fail('Name must be between 2 and 22 characters.');
    player.username = name;
    return ok('Your name has been updated.');
  });

  action(socket, 'add-bot', (player) => {
    const check = requirePlayer(player); if (check.ok === false) return check;
    if (!isHost(player)) return fail('Only the host can add a bot.');
    if (phase !== 'LOBBY') return fail('Bots can only be added in the lobby.');
    if (!gameSettings.configured) return fail('Finish game setup before adding bots.');
    if ([...players.values()].filter(existing => !existing.left).length >= gameSettings.maxPlayers) return fail('The game is full.');
    const botNumber = [...players.values()].filter(existing => existing.isBot).length + 1;
    const activeMembers = houseId => [...players.values()].filter(existing => !existing.left && existing.houseId === houseId);
    let house;
    if (activeMembers('baratheon').length === 0) house = findHouse('baratheon');
    else {
      const openMinor = Number(gameSettings.maxPlayers) >= 7 && houses.find(candidate => candidate.type === 'minor' && activeMembers(candidate.id).length === 0);
      if (openMinor) house = openMinor;
      else house = [...houses].filter(candidate => candidate.type === 'major').sort((a, b) => activeMembers(a.id).length - activeMembers(b.id).length)[0];
    }
    const bot = { id: randomUUID(), username: `Bot ${botNumber}`, token: `bot-${randomUUID()}`, houseId: house.id, vote: null, lastSpyRound: 0, connected: true, left: false, isBot: true, socketId: null };
    players.set(bot.id, bot);
    addEvent('normal', `${bot.username} joined House ${house.name}.`);
    return ok(`${bot.username} joined the lobby as House ${house.name}.`);
  });

  action(socket, 'start-game', player => {
    const check = requirePlayer(player); if (check.ok === false) return check;
    if (!isHost(player)) return fail('Only the lobby host can begin the game.');
    if (phase !== 'LOBBY') return fail('The game has already left the lobby.');
    if (!gameSettings.configured) return fail('The host must finish game setup first.');
    const connected = connectedPlayers();
    if (connected.length < 2) return fail('At least two players are needed so the king can appoint a Hand.');
    if (connected.some(p => !p.houseId)) return fail('Everyone connected must choose a house before the game begins.');
    const baratheons = connected.filter(p => p.houseId === 'baratheon');
    if (!baratheons.length) return fail('A connected player or bot must join House Baratheon to receive its first-king buff.');
    kingPlayerId = baratheons[randomInt(0, baratheons.length - 1)].id;
    const king = players.get(kingPlayerId);
    if (king?.isBot) {
      const candidates = connected.filter(candidate => candidate.id !== king.id);
      handPlayerId = candidates[randomInt(0, candidates.length - 1)].id;
      phase = 'ACTION';
      round = 1;
      for (const h of houses) h.hasAttackedThisRound = false;
      runBotTurns();
      addEvent('important', `${king.username} appointed ${players.get(handPlayerId).username} as Hand of the King.`);
      addEvent('important', 'Round 1 begins. The game is underway.');
      return ok(`${king.username} appointed the Hand of the King. Round 1 begins.`);
    }
    handPlayerId = null;
    phase = 'HAND_SELECTION';
    runoff = false;
    voterIds = [];
    candidateIds = [];
    for (const p of players.values()) p.vote = null;
    addEvent('important', `${players.get(kingPlayerId)?.username || 'A Baratheon player'} was chosen at random as the first king.`);
    return ok(`${players.get(kingPlayerId)?.username || 'A Baratheon player'} is the first king. They must appoint a Hand of the King.`);
  });

  action(socket, 'appoint-hand', (player, payload) => {
    const check = requirePlayer(player); if (check.ok === false) return check;
    if (phase !== 'HAND_SELECTION') return fail('The king is not choosing a Hand right now.');
    if (player.id !== kingPlayerId) return fail('Only the king can appoint the Hand of the King.');
    const targetId = String(payload.playerId || '');
    const target = players.get(targetId);
    if (!target) return fail('Choose a player who has joined this game.');
    if (target.id === player.id) return fail('The king cannot appoint themself as the Hand of the King.');
    if (target.left) return fail('Choose a player who has not left the game.');
    handPlayerId = target.id;
    addEvent('important', `${player.username} appointed ${target.username} as Hand of the King.`);
    phase = 'ACTION';
    round = 1;
    for (const h of houses) h.hasAttackedThisRound = false;
    runBotTurns();
    addEvent('important', 'Round 1 begins. The game is underway.');
    return ok(`${target.username} is the Hand of the King. Round 1 begins.`);
  });

  action(socket, 'purchase', (player, payload) => {
    const check = requireHouse(player); if (check.ok === false) return check;
    if (phase !== 'ACTION') return fail('Recruitment is only available during the action phase.');
    if (check.lockedUntilRound >= round) return fail('A royal embargo blocks recruitment this round.');
    const h = check;
    const unit = payload.unit;
    const amount = Number(payload.amount);
    if (!Number.isInteger(amount) || amount < 1 || amount > 10) return fail('Choose a whole number of units between 1 and 10.');
    if (!['infantry', 'navy'].includes(unit)) return fail('That unit type is not available.');
    const cost = unit === 'infantry' ? h.infantryCost : h.navyCost;
    if (h.money < cost * amount) return fail(`This purchase costs ${cost * amount} gold, but your house has ${h.money}.`);
    h.money -= cost * amount;
    h[unit] += amount;
    addEvent('normal', `House ${h.name} recruited ${amount} ${unit === 'navy' ? 'ships' : 'infantry'}.`);
    return ok(`Recruited ${amount} ${unit === 'navy' ? 'ships' : 'infantry'}.`);
  });

  action(socket, 'spy', (player, payload) => {
    const check = requireHouse(player); if (check.ok === false) return check;
    const h = check;
    if (phase !== 'ACTION') return fail('Spies can only be sent during the action phase.');
    if (player.lastSpyRound === round) return fail('You have already sent spies this round.');
    const target = findHouse(String(payload.targetHouseId || ''));
    if (!target || target.id === h.id) return fail('Choose another house as your target.');
    if (h.money < 8) return fail('A spy mission costs 8 gold.');
    h.money -= 8;
    player.lastSpyRound = round;
    const successChance = target.id === 'targaryen' ? 0.48 : 0.65;
    const success = Math.random() < successChance;
    const pendingCapital = target.pendingAttack ? findCapital(target.pendingAttack.targetCapitalId) : null;
    const report = {
      id: randomUUID(), targetHouseId: target.id, targetName: target.name, round, success,
      ...(success ? { infantry: target.infantry, navy: target.navy, dragons: target.dragons, pendingTarget: pendingCapital?.name || null } : {})
    };
    h.spyReports.unshift(report);
    if (h.spyReports.length > 15) h.spyReports.length = 15;
    addEvent('normal', `House ${h.name} sent spies toward House ${target.name}.`);
    return ok(success ? `Your spies returned with intelligence from House ${target.name}.` : `Your spy mission against House ${target.name} failed.`);
  });

  action(socket, 'plan-attack', (player, payload) => {
    const check = requireHouse(player); if (check.ok === false) return check;
    const h = check;
    if (phase !== 'ACTION') return fail('Attacks can only be ordered during the action phase.');
    if (round < 2) return fail('Attacks unlock after Round 1.');
    if (h.pendingAttack) return fail('Your house already has a pending attack order.');
    if (h.hasAttackedThisRound) return fail('Your house has already planned an attack this round.');
    const target = findCapital(String(payload.targetCapitalId || ''));
    if (!target || target.ownerHouseId === h.id) return fail('Choose a capital controlled by another house.');
    const units = { infantry: Number(payload.infantry), navy: Number(payload.navy), dragons: Number(payload.dragons) };
    if (Object.values(units).some(n => !Number.isInteger(n) || n < 0)) return fail('Committed forces must be whole numbers of zero or greater.');
    if (units.infantry + units.navy + units.dragons < 1) return fail('Commit at least one unit to the attack.');
    if (units.infantry > h.infantry || units.navy > h.navy || units.dragons > h.dragons) return fail('Your house does not have enough uncommitted forces.');
    h.infantry -= units.infantry;
    h.navy -= units.navy;
    h.dragons -= units.dragons;
    h.pendingAttack = { targetCapitalId: target.id, targetName: target.name, orderedRound: round, resolveRound: round + 1, units };
    h.hasAttackedThisRound = true;
    addEvent('normal', `House ${h.name} secretly committed an attack against a capital.`);
    return ok(`Attack order placed. It will resolve after Round ${round + 1} court.`);
  });

  action(socket, 'offer-alliance', (player, payload) => {
    const check = requireHouse(player); if (check.ok === false) return check;
    if (!isCourt()) return fail('Alliance offers can only be sent during court.');
    const target = findHouse(String(payload.targetHouseId || ''));
    const scope = payload.scope === 'secret' ? 'secret' : 'public';
    if (!target || target.id === check.id) return fail('Choose another house.');
    const existing = alliances.some(a => [a.houseA, a.houseB].includes(check.id) && [a.houseA, a.houseB].includes(target.id));
    if (existing) return fail('Your houses already have an alliance.');
    const duplicate = allianceOffers.some(o => o.fromHouseId === check.id && o.toHouseId === target.id);
    if (duplicate) return fail('Your house already has an outstanding offer to that house.');
    allianceOffers.unshift({ id: randomUUID(), fromHouseId: check.id, toHouseId: target.id, scope, round });
    addEvent('normal', scope === 'public' ? `House ${check.name} publicly offered an alliance to House ${target.name}.` : `House ${check.name} sent a secret alliance offer.`);
    return ok('Alliance offer sent.');
  });

  action(socket, 'respond-alliance', (player, payload) => {
    const check = requireHouse(player); if (check.ok === false) return check;
    if (!isCourt()) return fail('Alliance offers can only be answered during court.');
    const offer = allianceOffers.find(o => o.id === String(payload.offerId || ''));
    if (!offer || offer.toHouseId !== check.id) return fail('That offer is no longer available to your house.');
    allianceOffers.splice(allianceOffers.indexOf(offer), 1);
    if (payload.accept === true) {
      const already = alliances.some(a => [a.houseA, a.houseB].includes(offer.fromHouseId) && [a.houseA, a.houseB].includes(offer.toHouseId));
      if (!already) alliances.push({ id: randomUUID(), houseA: offer.fromHouseId, houseB: offer.toHouseId, scope: offer.scope, createdRound: round });
      addEvent('important', `House ${check.name} accepted an alliance with House ${houseName(offer.fromHouseId)}.`);
      return ok('Alliance accepted.');
    }
    addEvent('normal', `House ${check.name} declined an alliance offer from House ${houseName(offer.fromHouseId)}.`);
    return ok('Alliance declined.');
  });

  action(socket, 'break-alliance', (player, payload) => {
    const check = requireHouse(player); if (check.ok === false) return check;
    if (!isCourt()) return fail('Alliances can only be broken during court.');
    const alliance = alliances.find(a => a.id === String(payload.allianceId || ''));
    if (!alliance || ![alliance.houseA, alliance.houseB].includes(check.id)) return fail('Your house is not part of that alliance.');
    const other = alliance.houseA === check.id ? alliance.houseB : alliance.houseA;
    alliances.splice(alliances.indexOf(alliance), 1);
    addEvent('important', `House ${check.name} broke its alliance with House ${houseName(other)}.`);
    return ok('Alliance broken.');
  });

  action(socket, 'king-command', (player, payload) => {
    const check = requireHouse(player); if (check.ok === false) return check;
    const h = check;
    if (!isCourt()) return fail('Royal commands can only be issued during court.');
    if (player.id !== kingPlayerId) return fail('Only the king can issue a royal command.');
    if (h.commandUsedRound === round) return fail('Your house has already used its royal command this round.');
    if (payload.command === 'levy') {
      let collected = 0;
      const bonus = h.id === 'baratheon' ? 1 : 0;
      for (const other of houses) {
        if (other.id === h.id) continue;
        const amount = Math.min(3 + bonus, other.money);
        other.money -= amount;
        collected += amount;
      }
      h.money += collected;
      h.commandUsedRound = round;
      addEvent('important', `The king issued a royal levy. House ${h.name} collected ${collected} gold from the realm.`);
      return ok(`Royal levy collected ${collected} gold.`);
    }
    if (payload.command === 'embargo') {
      const target = findHouse(String(payload.targetHouseId || ''));
      if (!target || target.id === h.id) return fail('Choose another house for the embargo.');
      target.lockedUntilRound = round + 1;
      h.commandUsedRound = round;
      addEvent('important', `The king placed a recruitment embargo on House ${target.name} through Round ${round + 1}.`);
      return ok(`House ${target.name} cannot recruit through Round ${round + 1}.`);
    }
    return fail('Choose a valid royal command.');
  });

  action(socket, 'send-chat', (player, payload) => {
    const check = requireHouse(player); if (check.ok === false) return check;
    const message = String(payload.message || '').trim().slice(0, 350);
    if (!message) return fail('Write a message first.');
    const scope = payload.scope === 'secret' ? 'secret' : 'public';
    if (scope === 'public') {
      publicMessages.push({ id: randomUUID(), senderName: player.username, senderHouseName: check.name, senderHouseId: check.id, scope, round, message });
      if (publicMessages.length > 150) publicMessages.shift();
    } else {
      const target = findHouse(String(payload.targetHouseId || ''));
      if (!target || target.id === check.id) return fail('Choose another house to message privately.');
      privateMessages.push({ id: randomUUID(), senderName: player.username, senderHouseId: check.id, targetHouseId: target.id, senderHouseName: check.name, targetHouseName: target.name, scope: 'secret', round, message });
      if (privateMessages.length > 150) privateMessages.shift();
    }
    return ok('Message sent.');
  });

  action(socket, 'advance-phase', (player) => {
    const check = requirePlayer(player); if (check.ok === false) return check;
    if (!isHost(player)) return fail('Only the host can advance the game.');
    if (phase === 'ACTION') {
      phase = 'COURT';
      addEvent('important', `Round ${round} action phase ended. Court is now in session.`);
      return ok('Court is now in session.');
    }
    if (phase === 'COURT') {
      phase = 'RESOLUTION';
      resolveDueAttacks();
      addEvent('important', `Round ${round} court has concluded. The realm has entered resolution.`);
      return ok('Round resolution has begun.');
    }
    if (phase === 'RESOLUTION') {
      round += 1;
      phase = 'ACTION';
      for (const h of houses) {
        h.hasAttackedThisRound = false;
        const owned = capitals.filter(c => c.ownerHouseId === h.id).length;
        h.money += owned * (5 + (h.id === 'tyrell' ? 2 : 0));
      }
      runBotTurns();
      addEvent('important', `Round ${round} begins. Houses received income from their controlled capitals.`);
      return ok(`Round ${round} has begun. Capital income has been paid.`);
    }
    return fail('Use the election controls to leave the lobby or close the ballot.');
  });

  action(socket, 'reset-game', (player) => {
    const check = requirePlayer(player); if (check.ok === false) return check;
    if (!isHost(player)) return fail('Only the host can reset the game.');
    resetWorld(true);
    return ok('The game has been reset. All players can choose a house again.');
  });
});

function resolveDueAttacks() {
  for (const attacker of houses) {
    const order = attacker.pendingAttack;
    if (!order || order.resolveRound > round) continue;
    const target = findCapital(order.targetCapitalId);
    if (!target || target.ownerHouseId === attacker.id) {
      addEvent('battle', `House ${attacker.name} found no enemy holding at ${order.targetName}; the attack was spent.`);
      attacker.pendingAttack = null;
      continue;
    }
    const defender = findHouse(target.ownerHouseId);
    let defense = target.defense + randomInt(0, 3);
    if ((defender?.id === 'stark' && target.id === 'winterfell') || (defender?.id === 'martell' && target.id === 'sunspear') || (defender?.id === 'arryn' && target.id === 'the-eyrie')) defense += 2;
    // Each troop contributes one strength; ships can support an attack, and dragons add five each plus a siege bonus.
    const attackStrength = order.units.infantry + order.units.navy + order.units.dragons * 5 + (order.units.dragons ? 2 : 0) + randomInt(0, 3);
    if (attackStrength >= defense) {
      const previousOwner = target.ownerHouseId;
      target.ownerHouseId = attacker.id;
      addEvent('battle', `House ${attacker.name} captured ${target.name} from House ${defender?.name || 'an unknown house'} (attack ${attackStrength} vs. defense ${defense}).`);
    } else {
      addEvent('battle', `House ${attacker.name} failed to capture ${target.name} (attack ${attackStrength} vs. defense ${defense}).`);
    }
    attacker.pendingAttack = null;
  }
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Iron Throne multiplayer server listening on port ${PORT}`);
  console.log(`Allowed browser origins: ${[...allowedOrigins].join(', ') || '(none configured)'}`);
});
