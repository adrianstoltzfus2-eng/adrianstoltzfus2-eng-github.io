const { randomUUID } = require('node:crypto');

const HOUSE_DEFS = [
  {
    id: 'stark', name: 'Stark', type: 'major', sigil: '🐺', color: '#b7c7d6',
    motto: 'Winter Is Coming', capitalId: 'winterfell', capital: 'Winterfell',
    buff: 'Northern resolve: +25% defense when defending Winterfell.', nerf: null,
    incomeMultiplier: 1, infantryCost: 4, navyCost: 5, attackMultiplier: 1, defenseMultiplier: 1.25,
    initial: { money: 30, infantry: 8, navy: 3, dragons: 0 }
  },
  {
    id: 'lannister', name: 'Lannister', type: 'major', sigil: '🦁', color: '#d7b46a',
    motto: 'Hear Me Roar', capitalId: 'casterly-rock', capital: 'Casterly Rock',
    buff: 'Lannister gold: +25% income from controlled capitals.', nerf: null,
    incomeMultiplier: 1.25, infantryCost: 4, navyCost: 5, attackMultiplier: 1, defenseMultiplier: 1,
    initial: { money: 30, infantry: 8, navy: 3, dragons: 0 }
  },
  {
    id: 'baratheon', name: 'Baratheon', type: 'major', sigil: '🦌', color: '#d9c05d',
    motto: 'Ours Is the Fury', capitalId: 'storms-end', capital: "Storm's End",
    buff: 'Stormland assault: +15% attack strength.', nerf: null,
    incomeMultiplier: 1, infantryCost: 4, navyCost: 5, attackMultiplier: 1.15, defenseMultiplier: 1,
    initial: { money: 30, infantry: 8, navy: 3, dragons: 0 }
  },
  {
    id: 'targaryen', name: 'Targaryen', type: 'minor', sigil: '🐉', color: '#c96c65',
    motto: 'Fire and Blood', capitalId: 'dragonstone', capital: 'Dragonstone',
    buff: 'Dragonlords: +35% attack strength when attacking a capital with a dragon.', nerf: 'Costly levies: infantry costs 5 gold instead of 4.',
    incomeMultiplier: 1, infantryCost: 5, navyCost: 5, attackMultiplier: 1, defenseMultiplier: 1, dragonSiegeMultiplier: 1.35,
    initial: { money: 30, infantry: 7, navy: 2, dragons: 1 }
  },
  {
    id: 'tyrell', name: 'Tyrell', type: 'minor', sigil: '🌹', color: '#a3b47a',
    motto: 'Growing Strong', capitalId: 'highgarden', capital: 'Highgarden',
    buff: 'Abundant levies: infantry costs 3 gold instead of 4.', nerf: 'Weak fleet tradition: navy costs 6 gold instead of 5.',
    incomeMultiplier: 1, infantryCost: 3, navyCost: 6, attackMultiplier: 1, defenseMultiplier: 1,
    initial: { money: 30, infantry: 8, navy: 2, dragons: 0 }
  },
  {
    id: 'greyjoy', name: 'Greyjoy', type: 'minor', sigil: '🦑', color: '#a9b3b6',
    motto: 'We Do Not Sow', capitalId: 'pyke', capital: 'Pyke',
    buff: 'Iron Fleet: navy counts as 1.5 strength in battle.', nerf: 'Costly land levies: infantry costs 5 gold instead of 4.',
    incomeMultiplier: 1, infantryCost: 5, navyCost: 4, attackMultiplier: 1, defenseMultiplier: 1, navyMultiplier: 1.5,
    initial: { money: 30, infantry: 7, navy: 4, dragons: 0 }
  },
  {
    id: 'martell', name: 'Martell', type: 'minor', sigil: '☀️', color: '#d99562',
    motto: 'Unbowed, Unbent, Unbroken', capitalId: 'sunspear', capital: 'Sunspear',
    buff: 'Dornish defense: +25% defense when defending Sunspear.', nerf: 'Difficult levies: infantry costs 5 gold instead of 4.',
    incomeMultiplier: 1, infantryCost: 5, navyCost: 5, attackMultiplier: 1, defenseMultiplier: 1.25,
    initial: { money: 30, infantry: 7, navy: 3, dragons: 0 }
  },
  {
    id: 'arryn', name: 'Arryn', type: 'minor', sigil: '🦅', color: '#8eacc9',
    motto: 'As High as Honor', capitalId: 'the-eyrie', capital: 'The Eyrie',
    buff: 'Mountain fortress: +30% defense when defending the Eyrie.', nerf: 'Remote economy: income from capitals is reduced by 15%.',
    incomeMultiplier: 0.85, infantryCost: 4, navyCost: 5, attackMultiplier: 1, defenseMultiplier: 1.3,
    initial: { money: 30, infantry: 8, navy: 2, dragons: 0 }
  }
];

const CAPITAL_DEFS = [
  { id: 'winterfell', name: 'Winterfell', region: 'The North', originalHouseId: 'stark', defense: 5, icon: '🏰' },
  { id: 'casterly-rock', name: 'Casterly Rock', region: 'The Westerlands', originalHouseId: 'lannister', defense: 5, icon: '⛰️' },
  { id: 'storms-end', name: "Storm's End", region: 'The Stormlands', originalHouseId: 'baratheon', defense: 4, icon: '🏰' },
  { id: 'dragonstone', name: 'Dragonstone', region: 'The Narrow Sea', originalHouseId: 'targaryen', defense: 4, icon: '🐉' },
  { id: 'highgarden', name: 'Highgarden', region: 'The Reach', originalHouseId: 'tyrell', defense: 4, icon: '🌿' },
  { id: 'pyke', name: 'Pyke', region: 'The Iron Islands', originalHouseId: 'greyjoy', defense: 4, icon: '🌊' },
  { id: 'sunspear', name: 'Sunspear', region: 'Dorne', originalHouseId: 'martell', defense: 4, icon: '☀️' },
  { id: 'the-eyrie', name: 'The Eyrie', region: 'The Vale', originalHouseId: 'arryn', defense: 6, icon: '🦅' }
];

function createGame() {
  const houses = {};
  for (const def of HOUSE_DEFS) {
    houses[def.id] = {
      ...structuredClone(def),
      money: def.initial.money,
      infantry: def.initial.infantry,
      navy: def.initial.navy,
      dragons: def.initial.dragons,
      pendingAttack: null,
      lastAttackRound: 0,
      embargoUntilRound: 0,
      commandUsedRound: 0
    };
  }
  const capitals = {};
  for (const def of CAPITAL_DEFS) {
    capitals[def.id] = { ...def, ownerHouseId: def.originalHouseId };
  }
  return {
    phase: 'LOBBY', round: 1, hostId: null, kingId: null,
    players: [], houses, capitals, runoffCandidates: null,
    publicMessages: [], privateMessages: [], alliances: [], allianceOffers: [], events: [],
    gameStarted: false, createdAt: Date.now(), nextJoinedOrder: 1
  };
}

function playerById(game, id) {
  return game.players.find(p => p.id === id);
}

function houseById(game, id) {
  return id ? game.houses[id] : null;
}

function connectedPlayers(game) {
  return game.players.filter(p => p.connected);
}

function getHostId(game) {
  const online = connectedPlayers(game).sort((a, b) => a.joinedOrder - b.joinedOrder);
  return online[0]?.id || game.hostId || null;
}

function addEvent(game, text, kind = 'normal') {
  game.events.unshift({ id: randomUUID(), round: game.round, phase: game.phase, text, kind, at: Date.now() });
  game.events = game.events.slice(0, 50);
}

function capitalCount(game, houseId) {
  return Object.values(game.capitals).filter(c => c.ownerHouseId === houseId).length;
}

function unitPower(house, units = house) {
  return (units.infantry || 0) + (units.navy || 0) * (house.navyMultiplier || 1) + (units.dragons || 0) * 5;
}

function canChooseMinor(game) {
  return game.players.length > 6;
}

function currentKing(game) {
  return playerById(game, game.kingId);
}

function isHouseMember(game, playerId, houseId) {
  const p = playerById(game, playerId);
  return Boolean(p && p.houseId === houseId);
}

function loginPlayer(game, username, token) {
  const cleanName = String(username || '').trim().replace(/\s+/g, ' ').slice(0, 22);
  const cleanToken = String(token || '').trim().slice(0, 100);
  if (cleanName.length < 2) throw new Error('Use a username with at least 2 characters.');
  if (cleanName.length > 22) throw new Error('Username is too long.');
  if (cleanToken.length < 20) throw new Error('This browser session token is invalid. Refresh and try again.');

  const existingToken = game.players.find(p => p.clientToken === cleanToken);
  if (existingToken) {
    existingToken.connected = true;
    existingToken.lastSeenAt = Date.now();
    return existingToken;
  }
  if (game.phase !== 'LOBBY') throw new Error('This game has already started. New players cannot join this temporary game.');
  const duplicate = game.players.find(p => p.username.toLowerCase() === cleanName.toLowerCase());
  if (duplicate && duplicate.connected) throw new Error('That username is already in this game. Choose another name.');
  if (duplicate && !duplicate.connected) {
    duplicate.clientToken = cleanToken;
    duplicate.connected = true;
    duplicate.lastSeenAt = Date.now();
    return duplicate;
  }

  const p = {
    id: randomUUID(), username: cleanName, clientToken: cleanToken, houseId: null,
    connected: true, joinedOrder: game.nextJoinedOrder++, vote: null,
    lastPurchaseRound: 0, lastSpyRound: 0, spyReports: [], joinedAt: Date.now(), lastSeenAt: Date.now()
  };
  game.players.push(p);
  if (!game.hostId) game.hostId = p.id;
  addEvent(game, `${cleanName} joined the lobby.`);
  return p;
}

function disconnectPlayer(game, playerId) {
  const p = playerById(game, playerId);
  if (!p) return;
  p.connected = false;
  p.lastSeenAt = Date.now();
  addEvent(game, `${p.username} disconnected.`);
}

function selectHouse(game, playerId, houseId) {
  const p = playerById(game, playerId);
  if (!p) throw new Error('Log in first.');
  if (game.phase !== 'LOBBY') throw new Error('House selection is locked after the game starts.');
  const house = houseById(game, houseId);
  if (!house) throw new Error('That house does not exist.');
  if (house.type === 'minor' && !canChooseMinor(game)) throw new Error('Minor houses unlock when there are more than 6 players in the lobby.');
  if (house.type === 'minor' && game.players.some(other => other.id !== p.id && other.houseId === houseId)) throw new Error('That minor house has already been claimed.');
  const previousHouse = p.houseId;
  p.houseId = houseId;
  if (previousHouse !== houseId) addEvent(game, `${p.username} joined House ${house.name}.`);
}

function startElection(game, playerId) {
  if (playerId !== getHostId(game)) throw new Error('Only the lobby host can start the election.');
  if (game.phase !== 'LOBBY') throw new Error('The lobby has already closed.');
  const online = connectedPlayers(game);
  if (online.length < 3) throw new Error('At least 3 connected players are needed to start.');
  const unassigned = online.filter(p => !p.houseId);
  if (unassigned.length) throw new Error(`Every connected player must choose a house first. ${unassigned.length} player(s) still need a house.`);
  game.phase = 'KING_VOTE';
  game.runoffCandidates = null;
  for (const p of game.players) p.vote = null;
  addEvent(game, 'The Great Council is called. Vote for the first king.', 'important');
}

function voteKing(game, playerId, candidateId) {
  const p = playerById(game, playerId);
  if (!p || !p.houseId) throw new Error('Choose a house before voting.');
  if (game.phase !== 'KING_VOTE') throw new Error('It is not the king election phase.');
  const candidates = connectedPlayers(game);
  if (game.runoffCandidates && !game.runoffCandidates.includes(candidateId)) throw new Error('That player is not eligible in this runoff.');
  const target = candidates.find(c => c.id === candidateId);
  if (!target) throw new Error('That candidate is not available.');
  p.vote = candidateId;
}

function closeVoting(game, playerId) {
  if (playerId !== getHostId(game)) throw new Error('Only the lobby host can close voting.');
  if (game.phase !== 'KING_VOTE') throw new Error('There is no election to close.');
  const eligible = connectedPlayers(game);
  const votes = eligible.filter(p => p.vote && eligible.some(c => c.id === p.vote));
  if (!votes.length) throw new Error('At least one vote must be cast before closing the election.');
  const tally = new Map();
  for (const p of votes) tally.set(p.vote, (tally.get(p.vote) || 0) + 1);
  const maxVotes = Math.max(...tally.values());
  const tied = [...tally.entries()].filter(([, count]) => count === maxVotes).map(([id]) => id);
  if (tied.length > 1) {
    game.runoffCandidates = tied;
    for (const p of game.players) p.vote = null;
    addEvent(game, `The council is deadlocked. A runoff begins between ${tied.map(id => playerById(game, id)?.username || 'a candidate').join(' and ')}.`, 'important');
    return { runoff: true };
  }
  const winner = playerById(game, tied[0]);
  if (!winner) throw new Error('The winning candidate is no longer available.');
  game.kingId = winner.id;
  game.phase = 'ACTION';
  game.round = 1;
  game.gameStarted = true;
  game.runoffCandidates = null;
  addEvent(game, `${winner.username} of House ${game.houses[winner.houseId].name} is crowned the first king. Round 1 begins.`, 'important');
  return { runoff: false, winner: winner.username };
}

function purchase(game, playerId, unit, amount) {
  const p = playerById(game, playerId);
  if (!p?.houseId) throw new Error('Choose a house first.');
  if (game.phase !== 'ACTION') throw new Error('Recruitment is only available during the action phase.');
  if (game.round < 1) throw new Error('The game has not started.');
  const house = game.houses[p.houseId];
  if (game.round <= house.embargoUntilRound) throw new Error('A royal embargo prevents recruitment this round.');
  const n = Number(amount);
  if (!Number.isInteger(n) || n < 1 || n > 10) throw new Error('Recruit between 1 and 10 units at a time.');
  let cost;
  if (unit === 'infantry') cost = house.infantryCost * n;
  else if (unit === 'navy') cost = house.navyCost * n;
  else throw new Error('Only infantry and navy can be recruited. Dragons cannot be purchased.');
  if (house.money < cost) throw new Error(`Not enough gold. This purchase costs ${cost}.`);
  house.money -= cost;
  house[unit] += n;
  p.lastPurchaseRound = game.round;
  addEvent(game, `House ${house.name} recruited ${n} ${unit === 'infantry' ? 'infantry' : 'naval'} unit${n > 1 ? 's' : ''}.`);
  return { cost, unit, amount: n };
}

function conductSpy(game, playerId, targetHouseId) {
  const p = playerById(game, playerId);
  if (!p?.houseId) throw new Error('Choose a house first.');
  if (game.phase !== 'ACTION') throw new Error('Spying is only available during the action phase.');
  if (game.round < 1) throw new Error('The game has not started.');
  if (!game.houses[targetHouseId]) throw new Error('That house does not exist.');
  if (targetHouseId === p.houseId) throw new Error('You cannot spy on your own house.');
  if (p.lastSpyRound === game.round) throw new Error('You have already attempted a spy mission this round.');
  const house = game.houses[p.houseId];
  const cost = 8;
  if (house.money < cost) throw new Error('A spy mission costs 8 gold.');
  house.money -= cost;
  p.lastSpyRound = game.round;
  const successChance = targetHouseId === 'arryn' ? 0.6 : 0.7;
  if (Math.random() < successChance) {
    const target = game.houses[targetHouseId];
    const report = {
      id: randomUUID(), round: game.round, targetHouseId,
      targetName: target.name, success: true,
      infantry: target.infantry, navy: target.navy, dragons: target.dragons,
      pendingTarget: target.pendingAttack ? game.capitals[target.pendingAttack.targetCapitalId]?.name : null,
      note: `Report from Round ${game.round}`
    };
    p.spyReports.unshift(report);
    p.spyReports = p.spyReports.slice(0, 12);
    addEvent(game, 'A spy network has returned with intelligence.', 'secret');
    return { success: true, report };
  }
  const report = { id: randomUUID(), round: game.round, targetHouseId, targetName: game.houses[targetHouseId].name, success: false, note: `Mission failed in Round ${game.round}` };
  p.spyReports.unshift(report);
  p.spyReports = p.spyReports.slice(0, 12);
  return { success: false, report };
}

function planAttack(game, playerId, payload) {
  const p = playerById(game, playerId);
  if (!p?.houseId) throw new Error('Choose a house first.');
  if (game.phase !== 'ACTION') throw new Error('Attack planning is only available during the action phase.');
  if (game.round < 2) throw new Error('Armies cannot attack during Round 1. You can begin planning attacks in Round 2.');
  const house = game.houses[p.houseId];
  if (house.pendingAttack) throw new Error('Your house already has an attack order in progress.');
  if (house.lastAttackRound === game.round) throw new Error('Your house has already planned an attack this round.');
  const capital = game.capitals[payload.targetCapitalId];
  if (!capital) throw new Error('Choose a valid capital as the target.');
  if (capital.ownerHouseId === p.houseId) throw new Error('Your house already controls that capital.');
  const infantry = Number(payload.infantry);
  const navy = Number(payload.navy);
  const dragons = Number(payload.dragons);
  for (const n of [infantry, navy, dragons]) {
    if (!Number.isInteger(n) || n < 0) throw new Error('Unit counts must be whole numbers of zero or greater.');
  }
  if (infantry + navy + dragons < 1) throw new Error('Send at least one unit.');
  if (infantry > house.infantry || navy > house.navy || dragons > house.dragons) throw new Error('You do not have enough uncommitted units for this attack.');
  if (p.houseId !== 'targaryen' && dragons > 0) throw new Error('Only House Targaryen can command dragons.');

  // Units are reserved immediately, so future recruitment cannot be used to fake an existing army.
  house.infantry -= infantry;
  house.navy -= navy;
  house.dragons -= dragons;
  house.pendingAttack = {
    id: randomUUID(), attackerHouseId: house.id, targetCapitalId: capital.id,
    targetHouseIdAtOrder: capital.ownerHouseId,
    units: { infantry, navy, dragons },
    orderedRound: game.round, resolveRound: game.round + 1, orderedBy: p.id
  };
  house.lastAttackRound = game.round;
  addEvent(game, `House ${house.name} has committed forces to a secret operation.`, 'secret');
  return { target: capital.name, resolveRound: house.pendingAttack.resolveRound };
}

function sendChat(game, playerId, payload) {
  const p = playerById(game, playerId);
  if (!p?.houseId) throw new Error('Choose a house before joining court discussion.');
  if (game.phase !== 'COURT') throw new Error('Court messages can only be sent during the court phase.');
  const message = String(payload.message || '').trim().slice(0, 350);
  if (!message) throw new Error('Type a message first.');
  const scope = payload.scope === 'secret' ? 'secret' : 'public';
  const msg = {
    id: randomUUID(), round: game.round, senderId: p.id, senderName: p.username,
    senderHouseId: p.houseId, senderHouseName: game.houses[p.houseId].name,
    message, scope, at: Date.now()
  };
  if (scope === 'secret') {
    const targetHouseId = payload.targetHouseId;
    if (!game.houses[targetHouseId] || targetHouseId === p.houseId) throw new Error('Choose a different house for a secret message.');
    msg.targetHouseId = targetHouseId;
    msg.targetHouseName = game.houses[targetHouseId].name;
    game.privateMessages.push(msg);
    game.privateMessages = game.privateMessages.slice(-150);
  } else {
    game.publicMessages.push(msg);
    game.publicMessages = game.publicMessages.slice(-150);
  }
}

function issueKingCommand(game, playerId, payload) {
  const p = playerById(game, playerId);
  if (!p || playerId !== game.kingId) throw new Error('Only the current king may issue royal commands.');
  if (game.phase !== 'COURT') throw new Error('Royal commands are only available during the court phase.');
  const kingHouse = game.houses[p.houseId];
  if (kingHouse.commandUsedRound === game.round) throw new Error('The king has already issued a command this round.');
  if (payload.command === 'levy') {
    let collected = 0;
    for (const house of Object.values(game.houses)) {
      if (house.id === kingHouse.id) continue;
      const tribute = Math.min(3, house.money);
      house.money -= tribute;
      collected += tribute;
    }
    kingHouse.money += collected;
    kingHouse.commandUsedRound = game.round;
    addEvent(game, `The king levied the realm, collecting ${collected} gold for House ${kingHouse.name}.`, 'important');
    return { message: `Royal levy collected ${collected} gold.` };
  }
  if (payload.command === 'embargo') {
    const target = game.houses[payload.targetHouseId];
    if (!target || target.id === kingHouse.id) throw new Error('Choose another house to embargo.');
    target.embargoUntilRound = Math.max(target.embargoUntilRound, game.round + 1);
    kingHouse.commandUsedRound = game.round;
    addEvent(game, `The king placed House ${target.name} under a royal recruitment embargo through Round ${target.embargoUntilRound}.`, 'important');
    return { message: `House ${target.name} cannot recruit through Round ${target.embargoUntilRound}.` };
  }
  throw new Error('Unknown royal command.');
}


function offerAlliance(game, playerId, payload) {
  const p = playerById(game, playerId);
  if (!p?.houseId) throw new Error('Choose a house before proposing an alliance.');
  if (game.phase !== 'COURT') throw new Error('Alliance offers can only be sent during the court phase.');
  const targetHouseId = payload.targetHouseId;
  if (!game.houses[targetHouseId] || targetHouseId === p.houseId) throw new Error('Choose a different house.');
  const pair = [p.houseId, targetHouseId].sort().join(':');
  if (game.alliances.some(a => [a.houseA, a.houseB].sort().join(':') === pair)) throw new Error('Your houses already have an active alliance.');
  if (game.allianceOffers.some(a => a.status === 'pending' && [a.fromHouseId, a.toHouseId].sort().join(':') === pair)) throw new Error('There is already a pending offer between these houses.');
  const offer = {
    id: randomUUID(), fromHouseId: p.houseId, toHouseId: targetHouseId,
    fromPlayerId: p.id, fromPlayerName: p.username,
    scope: payload.scope === 'secret' ? 'secret' : 'public',
    status: 'pending', round: game.round, createdAt: Date.now()
  };
  game.allianceOffers.unshift(offer);
  game.allianceOffers = game.allianceOffers.slice(0, 80);
  addEvent(game, offer.scope === 'public' ? `House ${game.houses[p.houseId].name} publicly offered an alliance to House ${game.houses[targetHouseId].name}.` : 'Secret diplomatic negotiations are underway.', offer.scope === 'public' ? 'important' : 'secret');
  return { message: `Alliance offer sent to House ${game.houses[targetHouseId].name}.` };
}

function respondAllianceOffer(game, playerId, payload) {
  const p = playerById(game, playerId);
  if (!p?.houseId) throw new Error('Choose a house first.');
  if (game.phase !== 'COURT') throw new Error('Alliance offers can only be accepted during the court phase.');
  const offer = game.allianceOffers.find(a => a.id === payload.offerId && a.status === 'pending');
  if (!offer) throw new Error('That alliance offer is no longer available.');
  if (offer.toHouseId !== p.houseId) throw new Error('Only the receiving house can respond to this offer.');
  offer.status = payload.accept ? 'accepted' : 'declined';
  offer.respondedRound = game.round;
  if (payload.accept) {
    game.alliances.push({
      id: randomUUID(), houseA: offer.fromHouseId, houseB: offer.toHouseId,
      scope: offer.scope, createdRound: game.round
    });
    addEvent(game, offer.scope === 'public'
      ? `House ${game.houses[offer.fromHouseId].name} and House ${game.houses[offer.toHouseId].name} formed an alliance.`
      : 'A secret alliance has been formed.', offer.scope === 'public' ? 'important' : 'secret');
    return { message: `Alliance with House ${game.houses[offer.fromHouseId].name} accepted.` };
  }
  addEvent(game, offer.scope === 'public'
    ? `House ${game.houses[offer.toHouseId].name} declined an alliance with House ${game.houses[offer.fromHouseId].name}.`
    : 'A secret diplomatic offer was declined.', offer.scope === 'public' ? 'normal' : 'secret');
  return { message: 'Alliance offer declined.' };
}

function breakAlliance(game, playerId, allianceId) {
  const p = playerById(game, playerId);
  if (!p?.houseId) throw new Error('Choose a house first.');
  if (game.phase !== 'COURT') throw new Error('Alliances can only be broken during the court phase.');
  const index = game.alliances.findIndex(a => a.id === allianceId);
  if (index < 0) throw new Error('That alliance no longer exists.');
  const alliance = game.alliances[index];
  if (alliance.houseA !== p.houseId && alliance.houseB !== p.houseId) throw new Error('Your house is not part of that alliance.');
  game.alliances.splice(index, 1);
  const partner = alliance.houseA === p.houseId ? alliance.houseB : alliance.houseA;
  addEvent(game, alliance.scope === 'public'
    ? `House ${game.houses[p.houseId].name} broke its alliance with House ${game.houses[partner].name}.`
    : 'A secret alliance has ended.', alliance.scope === 'public' ? 'important' : 'secret');
  return { message: `Alliance with House ${game.houses[partner].name} ended.` };
}

function calculateIncome(game) {
  const incomeLines = [];
  for (const house of Object.values(game.houses)) {
    const cities = capitalCount(game, house.id);
    if (!cities) continue;
    const income = Math.floor(10 * cities * house.incomeMultiplier);
    house.money += income;
    incomeLines.push(`${house.name} +${income} gold`);
  }
  addEvent(game, incomeLines.length ? `Round ${game.round} income collected: ${incomeLines.join(', ')}.` : `Round ${game.round} begins; no capital income was collected.`, 'normal');
}

function applyCasualties(house, units, fraction) {
  const lost = { infantry: 0, navy: 0, dragons: 0 };
  for (const key of ['infantry', 'navy', 'dragons']) {
    const count = units[key] || 0;
    if (!count) continue;
    // Dragons are hard to replace, so casualties are less likely to destroy the last dragon.
    let n = Math.floor(count * fraction);
    if (key === 'dragons' && count > 0) n = Math.random() < fraction ? 1 : 0;
    lost[key] = Math.min(count, n);
  }
  return lost;
}

function subtractUnits(house, units) {
  house.infantry = Math.max(0, house.infantry - units.infantry);
  house.navy = Math.max(0, house.navy - units.navy);
  house.dragons = Math.max(0, house.dragons - units.dragons);
}

function resolveAttacks(game) {
  const attacks = Object.values(game.houses)
    .map(h => h.pendingAttack)
    .filter(a => a && a.resolveRound <= game.round)
    .sort((a, b) => a.orderedRound - b.orderedRound);

  for (const attack of attacks) {
    const attacker = game.houses[attack.attackerHouseId];
    const capital = game.capitals[attack.targetCapitalId];
    if (!attacker || !capital) continue;
    const defenderId = capital.ownerHouseId;
    const defender = game.houses[defenderId];
    if (!defender || defender.id === attacker.id) {
      // The original target may have changed hands while the attack was travelling.
      attacker.infantry += attack.units.infantry;
      attacker.navy += attack.units.navy;
      attacker.dragons += attack.units.dragons;
      attacker.pendingAttack = null;
      addEvent(game, `House ${attacker.name}'s operation against ${capital.name} was called off because control changed before arrival.`, 'important');
      continue;
    }

    const attackUnits = attack.units;
    const attackBase = unitPower(attacker, attackUnits);
    const usedDragon = attackUnits.dragons > 0;
    let attackMultiplier = attacker.attackMultiplier || 1;
    if (attacker.id === 'targaryen' && usedDragon) attackMultiplier *= attacker.dragonSiegeMultiplier || 1;
    if (capital.id === 'winterfell' && defender.id === 'stark') attackMultiplier *= 1;
    const attackStrength = attackBase * attackMultiplier * (0.92 + Math.random() * 0.16);

    const defenseBase = unitPower(defender);
    const territoryDefense = capital.defense || 3;
    let defenseMultiplier = 1;
    if (capital.id === 'winterfell' && defender.id === 'stark') defenseMultiplier *= defender.defenseMultiplier || 1;
    if (capital.id === 'sunspear' && defender.id === 'martell') defenseMultiplier *= defender.defenseMultiplier || 1;
    if (capital.id === 'the-eyrie' && defender.id === 'arryn') defenseMultiplier *= defender.defenseMultiplier || 1;
    const defenseStrength = (territoryDefense + defenseBase * 0.55) * defenseMultiplier * (0.92 + Math.random() * 0.16);
    const attackerWins = attackStrength >= defenseStrength;
    const attackerLossFraction = attackerWins ? 0.18 : 0.45;
    const defenderLossFraction = attackerWins ? 0.42 : 0.18;
    const attackerLost = applyCasualties(attacker, attackUnits, attackerLossFraction);
    const defenderLost = applyCasualties(defender, {
      infantry: defender.infantry, navy: defender.navy, dragons: defender.dragons
    }, defenderLossFraction);

    subtractUnits(defender, defenderLost);
    // The survivors of the committed force return to the attacking house's available pool.
    attacker.infantry += attackUnits.infantry - attackerLost.infantry;
    attacker.navy += attackUnits.navy - attackerLost.navy;
    attacker.dragons += attackUnits.dragons - attackerLost.dragons;
    attacker.pendingAttack = null;

    if (attackerWins) {
      capital.ownerHouseId = attacker.id;
      addEvent(game, `⚔️ House ${attacker.name} captured ${capital.name} from House ${defender.name}. Attacker lost ${attackerLost.infantry} infantry, ${attackerLost.navy} ships, ${attackerLost.dragons} dragon(s); defender lost ${defenderLost.infantry} infantry, ${defenderLost.navy} ships, ${defenderLost.dragons} dragon(s).`, 'battle');
    } else {
      addEvent(game, `🛡️ House ${defender.name} repelled the attack on ${capital.name}. House ${attacker.name} lost ${attackerLost.infantry} infantry, ${attackerLost.navy} ships, ${attackerLost.dragons} dragon(s); defender lost ${defenderLost.infantry} infantry, ${defenderLost.navy} ships, ${defenderLost.dragons} dragon(s).`, 'battle');
    }
  }
}

function resetForNextRound(game) {
  game.round += 1;
  game.phase = 'ACTION';
  for (const p of game.players) p.vote = null;
  calculateIncome(game);
  addEvent(game, `Round ${game.round} begins. Orders are open.`, 'important');
}

function advancePhase(game, playerId) {
  if (playerId !== getHostId(game)) throw new Error('Only the current lobby host can advance the phase.');
  if (game.phase === 'ACTION') {
    game.phase = 'COURT';
    addEvent(game, `Round ${game.round}: the court is now in session.`, 'important');
    return { message: 'Court phase started.' };
  }
  if (game.phase === 'COURT') {
    game.phase = 'RESOLUTION';
    addEvent(game, `Round ${game.round}: orders are being resolved.`, 'important');
    resolveAttacks(game);
    return { message: 'Round resolution complete.' };
  }
  if (game.phase === 'RESOLUTION') {
    resetForNextRound(game);
    return { message: `Round ${game.round} has begun.` };
  }
  throw new Error('The phase cannot be advanced right now.');
}

function resetGame(game) {
  const fresh = createGame();
  // Preserve logged-in participants, but clear houses, votes, and reports.
  fresh.players = game.players.map(p => ({ ...p, houseId: null, vote: null, lastPurchaseRound: 0, lastSpyRound: 0, spyReports: [], connected: p.connected }));
  fresh.hostId = getHostId(game) || fresh.players[0]?.id || null;
  fresh.nextJoinedOrder = Math.max(1, ...fresh.players.map(p => p.joinedOrder + 1));
  fresh.events = [];
  addEvent(fresh, 'The host reset the game. Choose houses to begin again.', 'important');
  return fresh;
}

function buildState(game, playerId) {
  const me = playerById(game, playerId) || null;
  const myHouse = me?.houseId ? game.houses[me.houseId] : null;
  const houses = Object.values(game.houses).map(h => ({
    id: h.id, name: h.name, type: h.type, sigil: h.sigil, color: h.color, motto: h.motto,
    buff: h.buff, nerf: h.nerf, capitalId: h.capitalId, capital: h.capital,
    money: h.money, capitalCount: capitalCount(game, h.id),
    controlledCapitals: Object.values(game.capitals).filter(c => c.ownerHouseId === h.id).map(c => c.id),
    players: game.players.filter(p => p.houseId === h.id).map(p => ({ id: p.id, username: p.username, connected: p.connected })),
    hasPendingAttack: Boolean(h.pendingAttack),
    lockedByEmbargo: game.round <= h.embargoUntilRound
  }));
  const mySpyReports = me ? me.spyReports : [];
  const privateMessages = myHouse ? game.privateMessages.filter(m => m.senderHouseId === myHouse.id || m.targetHouseId === myHouse.id) : [];
  const publicMessages = game.publicMessages.slice(-60);
  const voteCandidates = game.runoffCandidates
    ? game.runoffCandidates.map(id => playerById(game, id)).filter(Boolean).map(p => ({ id: p.id, username: p.username, houseId: p.houseId }))
    : connectedPlayers(game).map(p => ({ id: p.id, username: p.username, houseId: p.houseId }));
  return {
    phase: game.phase, round: game.round, gameStarted: game.gameStarted,
    isHost: Boolean(me && me.id === getHostId(game)), isKing: Boolean(me && me.id === game.kingId),
    hostId: getHostId(game), king: currentKing(game) ? { id: game.kingId, username: currentKing(game).username, houseId: currentKing(game).houseId } : null,
    players: game.players.map(p => ({ id: p.id, username: p.username, houseId: p.houseId, connected: p.connected, isKing: p.id === game.kingId })),
    houses,
    capitals: Object.values(game.capitals).map(c => ({ id: c.id, name: c.name, region: c.region, originalHouseId: c.originalHouseId, ownerHouseId: c.ownerHouseId, defense: c.defense, icon: c.icon })),
    me: me ? { id: me.id, username: me.username, houseId: me.houseId, vote: me.vote, lastSpyRound: me.lastSpyRound } : null,
    myHouse: myHouse ? {
      id: myHouse.id, name: myHouse.name, money: myHouse.money,
      infantry: myHouse.infantry, navy: myHouse.navy, dragons: myHouse.dragons,
      pendingAttack: myHouse.pendingAttack ? {
        targetCapitalId: myHouse.pendingAttack.targetCapitalId,
        targetName: game.capitals[myHouse.pendingAttack.targetCapitalId]?.name,
        units: { ...myHouse.pendingAttack.units },
        orderedRound: myHouse.pendingAttack.orderedRound,
        resolveRound: myHouse.pendingAttack.resolveRound
      } : null,
      infantryCost: myHouse.infantryCost, navyCost: myHouse.navyCost,
      lockedByEmbargo: game.round <= myHouse.embargoUntilRound,
      hasAttackedThisRound: myHouse.lastAttackRound === game.round,
      commandUsedRound: myHouse.commandUsedRound
    } : null,
    minorHousesUnlocked: canChooseMinor(game),
    votesCast: connectedPlayers(game).filter(p => p.vote).length,
    voteTotal: connectedPlayers(game).length,
    runoff: Boolean(game.runoffCandidates),
    voteCandidates,
    alliances: game.alliances.filter(a => a.scope === 'public' || (myHouse && (a.houseA === myHouse.id || a.houseB === myHouse.id))).map(a => ({
      id: a.id, houseA: a.houseA, houseB: a.houseB, scope: a.scope, createdRound: a.createdRound
    })),
    allianceOffers: game.allianceOffers.filter(a => a.status === 'pending' && myHouse && (a.fromHouseId === myHouse.id || a.toHouseId === myHouse.id)).map(a => ({
      id: a.id, fromHouseId: a.fromHouseId, toHouseId: a.toHouseId,
      fromPlayerName: a.fromPlayerName, scope: a.scope, round: a.round,
      canRespond: a.toHouseId === myHouse.id, isOutgoing: a.fromHouseId === myHouse.id
    })),
    spyReports: mySpyReports,
    publicMessages,
    privateMessages,
    events: game.events.filter(e => e.kind !== 'secret').slice(0, 30),
    note: 'Temporary prototype: game state is held in server memory and resets if the server restarts.'
  };
}

module.exports = {
  HOUSE_DEFS, CAPITAL_DEFS, createGame, loginPlayer, disconnectPlayer, selectHouse,
  startElection, voteKing, closeVoting, purchase, conductSpy, planAttack,
  sendChat, issueKingCommand, offerAlliance, respondAllianceOffer, breakAlliance, advancePhase, resetGame, buildState, playerById,
  getHostId, addEvent
};
