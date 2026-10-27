const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const gameLogic = require('./game');

const app = express();
const server = http.createServer(app);
const port = Number(process.env.PORT) || 3000;
const configuredOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

function originAllowed(origin) {
  if (!origin) return true; // health checks and local tooling
  if (configuredOrigins.length === 0) return true; // convenient for local testing; set ALLOWED_ORIGINS in deployment
  if (configuredOrigins.includes('*')) return true;
  if (configuredOrigins.includes(origin)) return true;
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

const io = new Server(server, {
  cors: {
    origin(origin, callback) {
      if (originAllowed(origin)) callback(null, true);
      else callback(new Error('Origin not allowed by ALLOWED_ORIGINS.'));
    },
    methods: ['GET', 'POST'],
    credentials: false
  },
  transports: ['websocket', 'polling']
});

let game = gameLogic.createGame();
app.disable('x-powered-by');
app.get('/health', (_req, res) => res.json({ ok: true, service: 'iron-throne-game-server', phase: game.phase, round: game.round }));
app.get('/', (_req, res) => res.type('text').send('Iron Throne Game server is running. The frontend is hosted separately on GitHub Pages.'));

function sendStateToAll() {
  for (const socket of io.sockets.sockets.values()) {
    const playerId = socket.data.playerId || null;
    socket.emit('state', gameLogic.buildState(game, playerId));
  }
}

function act(socket, acknowledge, operation) {
  try {
    const result = operation();
    if (typeof acknowledge === 'function') acknowledge({ ok: true, ...(result || {}) });
    sendStateToAll();
  } catch (error) {
    if (typeof acknowledge === 'function') acknowledge({ ok: false, message: error.message || 'Action failed.' });
  }
}

function requirePlayer(socket) {
  const playerId = socket.data.playerId;
  const player = playerId ? gameLogic.playerById(game, playerId) : null;
  if (!player) throw new Error('Log in before taking game actions.');
  return player;
}

io.on('connection', socket => {
  socket.emit('state', gameLogic.buildState(game, null));

  socket.on('login', (payload = {}, ack) => act(socket, ack, () => {
    const player = gameLogic.loginPlayer(game, payload.username, payload.clientToken);
    socket.data.playerId = player.id;
    return { message: `Welcome, ${player.username}.`, playerId: player.id };
  }));

  socket.on('select-house', (payload = {}, ack) => act(socket, ack, () => {
    const p = requirePlayer(socket);
    gameLogic.selectHouse(game, p.id, payload.houseId);
    return { message: `House selected.` };
  }));

  socket.on('start-election', (_payload, ack) => act(socket, ack, () => {
    const p = requirePlayer(socket);
    gameLogic.startElection(game, p.id);
    return { message: 'The Great Council has begun.' };
  }));

  socket.on('vote-king', (payload = {}, ack) => act(socket, ack, () => {
    const p = requirePlayer(socket);
    gameLogic.voteKing(game, p.id, payload.candidateId);
    return { message: 'Vote recorded.' };
  }));

  socket.on('close-voting', (_payload, ack) => act(socket, ack, () => {
    const p = requirePlayer(socket);
    return gameLogic.closeVoting(game, p.id) || { message: 'Voting closed.' };
  }));

  socket.on('purchase', (payload = {}, ack) => act(socket, ack, () => {
    const p = requirePlayer(socket);
    const result = gameLogic.purchase(game, p.id, payload.unit, payload.amount);
    return { message: `Purchased ${result.amount} ${result.unit} for ${result.cost} gold.` };
  }));

  socket.on('spy', (payload = {}, ack) => act(socket, ack, () => {
    const p = requirePlayer(socket);
    const result = gameLogic.conductSpy(game, p.id, payload.targetHouseId);
    return { message: result.success ? `Spy mission succeeded against House ${result.report.targetName}.` : `Spy mission against House ${result.report.targetName} failed.` };
  }));

  socket.on('plan-attack', (payload = {}, ack) => act(socket, ack, () => {
    const p = requirePlayer(socket);
    const result = gameLogic.planAttack(game, p.id, payload);
    return { message: `Attack on ${result.target} scheduled for Round ${result.resolveRound}.` };
  }));

  socket.on('offer-alliance', (payload = {}, ack) => act(socket, ack, () => {
    const p = requirePlayer(socket);
    return gameLogic.offerAlliance(game, p.id, payload);
  }));

  socket.on('respond-alliance', (payload = {}, ack) => act(socket, ack, () => {
    const p = requirePlayer(socket);
    return gameLogic.respondAllianceOffer(game, p.id, payload);
  }));

  socket.on('break-alliance', (payload = {}, ack) => act(socket, ack, () => {
    const p = requirePlayer(socket);
    return gameLogic.breakAlliance(game, p.id, payload.allianceId);
  }));

  socket.on('send-chat', (payload = {}, ack) => act(socket, ack, () => {
    const p = requirePlayer(socket);
    gameLogic.sendChat(game, p.id, payload);
    return { message: 'Message sent.' };
  }));

  socket.on('king-command', (payload = {}, ack) => act(socket, ack, () => {
    const p = requirePlayer(socket);
    return gameLogic.issueKingCommand(game, p.id, payload);
  }));

  socket.on('advance-phase', (_payload, ack) => act(socket, ack, () => {
    const p = requirePlayer(socket);
    return gameLogic.advancePhase(game, p.id);
  }));

  socket.on('reset-game', (_payload, ack) => act(socket, ack, () => {
    const p = requirePlayer(socket);
    if (p.id !== gameLogic.getHostId(game)) throw new Error('Only the host can reset the game.');
    game = gameLogic.resetGame(game);
    // Keep each connected socket associated with its same participant ID.
    return { message: 'Game reset. Everyone must choose a house again.' };
  }));

  socket.on('request-state', () => {
    socket.emit('state', gameLogic.buildState(game, socket.data.playerId || null));
  });

  socket.on('disconnect', () => {
    const playerId = socket.data.playerId;
    if (playerId) {
      gameLogic.disconnectPlayer(game, playerId);
      sendStateToAll();
    }
  });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Iron Throne game server listening on 0.0.0.0:${port}`);
  console.log(`Allowed origins: ${configuredOrigins.length ? configuredOrigins.join(', ') : '(development default: all origins)'}`);
});
