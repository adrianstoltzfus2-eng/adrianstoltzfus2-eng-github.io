const test = require('node:test');
const assert = require('node:assert/strict');
const g = require('./game');

function makeStartedGame() {
  const game = g.createGame();
  const players = [
    g.loginPlayer(game, 'Test Stark', 'token-stark-' + 'a'.repeat(28)),
    g.loginPlayer(game, 'Test Lion', 'token-lion-' + 'b'.repeat(28)),
    g.loginPlayer(game, 'Test Storm', 'token-storm-' + 'c'.repeat(28))
  ];
  g.selectHouse(game, players[0].id, 'stark');
  g.selectHouse(game, players[1].id, 'lannister');
  g.selectHouse(game, players[2].id, 'baratheon');
  g.startElection(game, players[0].id);
  for (const player of players) g.voteKing(game, player.id, players[0].id);
  g.closeVoting(game, players[0].id);
  return { game, players };
}

function reachRoundTwo(game, hostId) {
  g.advancePhase(game, hostId); // action -> court
  g.advancePhase(game, hostId); // court -> resolution
  g.advancePhase(game, hostId); // resolution -> round 2 action
}

test('major houses allow multiple players; minor houses require more than six players', () => {
  const game = g.createGame();
  const players = [];
  for (let i = 0; i < 6; i++) players.push(g.loginPlayer(game, `Player ${i}`, `token-${i}-` + String(i).repeat(30)));
  g.selectHouse(game, players[0].id, 'stark');
  g.selectHouse(game, players[1].id, 'stark');
  assert.throws(() => g.selectHouse(game, players[2].id, 'targaryen'), /unlock/);
  const seventh = g.loginPlayer(game, 'Player Seven', 'token-seven-' + '7'.repeat(28));
  g.selectHouse(game, seventh.id, 'targaryen');
  assert.equal(game.houses.stark.players, undefined); // players belong to the player roster, not house records
  assert.equal(game.players.filter(p => p.houseId === 'stark').length, 2);
  assert.equal(game.players.filter(p => p.houseId === 'targaryen').length, 1);
});

test('king election sets the king and begins Round 1 action', () => {
  const { game, players } = makeStartedGame();
  assert.equal(game.kingId, players[0].id);
  assert.equal(game.phase, 'ACTION');
  assert.equal(game.round, 1);
});

test('income reflects controlled capitals and Lannister income buff', () => {
  const { game, players } = makeStartedGame();
  const before = game.houses.lannister.money;
  reachRoundTwo(game, players[0].id);
  assert.equal(game.round, 2);
  assert.equal(game.houses.lannister.money, before + 12);
  assert.equal(game.houses.stark.money, 40);
});

test('enemy army counts remain hidden, but the owner can see their own army', () => {
  const { game, players } = makeStartedGame();
  const enemyView = g.buildState(game, players[1].id);
  assert.equal('infantry' in enemyView.houses.find(h => h.id === 'stark'), false);
  assert.equal('navy' in enemyView.houses.find(h => h.id === 'stark'), false);
  const ownView = g.buildState(game, players[0].id);
  assert.equal(ownView.myHouse.infantry, 8);
  assert.equal(ownView.myHouse.navy, 3);
});

test('attack order reserves existing units and is not exposed to enemy state', () => {
  const { game, players } = makeStartedGame();
  reachRoundTwo(game, players[0].id);
  const originalInfantry = game.houses.stark.infantry;
  g.planAttack(game, players[0].id, { targetCapitalId: 'casterly-rock', infantry: 4, navy: 1, dragons: 0 });
  assert.equal(game.houses.stark.infantry, originalInfantry - 4);
  assert.equal(game.houses.stark.pendingAttack.resolveRound, 3);
  const enemyView = g.buildState(game, players[1].id);
  assert.equal(enemyView.houses.find(h => h.id === 'stark').hasPendingAttack, true);
  assert.equal(enemyView.houses.find(h => h.id === 'stark').pendingTarget, undefined);
  assert.equal(g.buildState(game, players[0].id).myHouse.pendingAttack.targetName, 'Casterly Rock');
});

test('secret alliance is visible to the involved houses but not to a third house', () => {
  const { game, players } = makeStartedGame();
  g.advancePhase(game, players[0].id); // court
  g.offerAlliance(game, players[0].id, { targetHouseId: 'lannister', scope: 'secret' });
  const offer = game.allianceOffers.find(a => a.status === 'pending');
  g.respondAllianceOffer(game, players[1].id, { offerId: offer.id, accept: true });
  assert.equal(g.buildState(game, players[0].id).alliances.length, 1);
  assert.equal(g.buildState(game, players[1].id).alliances.length, 1);
  assert.equal(g.buildState(game, players[2].id).alliances.length, 0);
});
