(() => {
  'use strict';

  const SERVER_URL = window.GOT_CONFIG?.serverUrl || 'http://localhost:3000';
  const tokenKey = 'ironThroneClientToken';
  const usernameKey = 'ironThroneUsername';
  const roomCodeKey = 'warOfWesterosGamePin';
  // House chosen on the throne screen before logging in. Claimed automatically right after login.
  const pickedHouseKey = 'ironThronePickedHouse';
  let pickedHouse = null;
  let preparingHost = false;
  let showHostSetup = false;
  let gameCode = localStorage.getItem(roomCodeKey)?.toUpperCase() || '';
  try { pickedHouse = JSON.parse(localStorage.getItem(pickedHouseKey) || 'null'); } catch { pickedHouse = null; }
  const hashHouse = /^#house=([a-z\-]{2,40})$/i.exec(location.hash);
  if (hashHouse) {
    const key = decodeURIComponent(hashHouse[1]).toLowerCase();
    pickedHouse = { key, name: `House ${key.charAt(0).toUpperCase()}${key.slice(1)}` };
    localStorage.setItem(pickedHouseKey, JSON.stringify(pickedHouse));
    history.replaceState(null, '', location.pathname + location.search);
  }
  let clientToken = localStorage.getItem(tokenKey);
  if (!clientToken) {
    const makePart = () => (window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`);
    clientToken = `${makePart()}-${makePart()}`;
    localStorage.setItem(tokenKey, clientToken);
  }

  const $ = id => document.getElementById(id);
  function setThronePage(mode) {
    const frame = $('throneFrame');
    if (frame) frame.src = mode === 'entry' ? './throne-photo.html?mode=entry&v=13' : './throne-photo.html?v=13';
  }
  function transitionThrone(mode) {
    const frame = $('throneFrame');
    if (frame?.contentWindow) frame.contentWindow.postMessage({ type: 'iron-throne:set-mode', mode }, location.origin === 'null' ? '*' : location.origin);
  }
  setThronePage(gameCode ? 'house' : 'entry');
  const isMobileDevice = () => Boolean(navigator.userAgentData?.mobile || /Android|iPhone|iPod|Mobile/i.test(navigator.userAgent) || (window.matchMedia('(pointer: coarse)').matches && window.innerWidth <= 900));
  const syncMobileLayout = () => document.body.classList.toggle('mobile-device', isMobileDevice());
  syncMobileLayout();
  window.addEventListener('resize', syncMobileLayout, { passive: true });
  window.addEventListener('orientationchange', syncMobileLayout, { passive: true });
  const socket = window.io ? window.io(SERVER_URL, { autoConnect: true, reconnection: true, reconnectionAttempts: Infinity }) : null;
  let state = null;
  let activeChatTab = 'public';
  let toastTimer = null;

  const PHASES = {
    LOBBY: ['THE LOBBY', 'The Great Houses', 'Choose a house. The lobby host can begin the Great Council once everyone has joined a house.'],
    HAND_SELECTION: ['THE FIRST KING', 'Appoint the Hand', 'The first king was chosen at random from the players of House Baratheon. The king chooses the Hand of the King before Round 1 begins.'],
    ACTION: ['ROUND ACTIONS', `Round ${state?.round || 1}: prepare your moves`, 'Recruit forces, purchase intelligence, and plan an attack. Army sizes stay private from enemy houses.'],
    COURT: ['THE ROYAL COURT', 'Words and alliances', 'Negotiate, make alliance offers, exchange secret messages, and let the king issue one decree.'],
    RESOLUTION: ['ROUND RESOLUTION', 'The realm answers', 'The host resolves the round. Pending attacks that are due are calculated and the realm chronicle is updated.']
  };

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function prettyHouse(houseId) {
    return state?.houses?.find(h => h.id === houseId)?.name || houseId || 'Unknown house';
  }

  function phaseLabel(phase) {
    return ({ LOBBY: 'LOBBY', HAND_SELECTION: 'FIRST KING', ACTION: `ROUND ${state?.round || 1} · ACTION`, COURT: `ROUND ${state?.round || 1} · COURT`, RESOLUTION: `ROUND ${state?.round || 1} · RESOLUTION` })[phase] || phase;
  }

  function showToast(message, kind = 'normal') {
    const toast = $('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.className = `toast toast-visible ${kind === 'error' ? 'toast-error' : kind === 'success' ? 'toast-success' : ''}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.className = 'toast'; }, 4200);
  }

  function setConnection(connected, label) {
    const pill = $('connectionPill');
    if (!pill) return;
    pill.className = `status-pill ${connected ? 'status-online' : 'status-offline'}`;
    pill.setAttribute('aria-label', `Server ${label.toLowerCase()}`);
    pill.title = `Server ${label.toLowerCase()}`;
    pill.innerHTML = `<i></i><span>${escapeHtml(label)}</span>`;
  }

  function emitAction(eventName, payload = {}) {
    if (!socket?.connected) {
      showToast('Not connected to the game server yet.', 'error');
      return;
    }
    socket.emit(eventName, payload, result => {
      if (!result?.ok) showToast(result?.message || 'Action failed.', 'error');
      else if (result.message) showToast(result.message, 'success');
    });
  }

  function allHouseOptions(excludeHouseId = null, includeEmpty = false) {
    if (!state) return '<option value="">Connect to server first</option>';
    const list = state.houses.filter(h => h.id !== excludeHouseId && (includeEmpty || h.players.length > 0 || h.capitalCount >= 0));
    return list.map(h => `<option value="${escapeHtml(h.id)}">${escapeHtml(h.name)}${h.type === 'minor' ? ' · Minor' : ''}</option>`).join('');
  }

  function playerName(playerId) {
    return state?.players?.find(p => p.id === playerId)?.username || 'Unknown player';
  }

  const HOUSE_SPRITE_POSITION = {
    stark: ['0%', '0%'], lannister: ['33.333%', '0%'], baratheon: ['66.667%', '0%'], targaryen: ['100%', '0%'],
    tyrell: ['0%', '100%'], greyjoy: ['33.333%', '100%'], martell: ['66.667%', '100%'], arryn: ['100%', '100%']
  };

  function houseBanner(house, className = 'house-sigil-art') {
    if (!house?.id) return '';
    const position = HOUSE_SPRITE_POSITION[house.id];
    if (!position) return '';
    return `<span class="${className} house-sprite" style="--sprite-x:${position[0]};--sprite-y:${position[1]}" role="img" aria-label="${escapeHtml(house.name)} house banner"></span>`;
  }

  function renderPlayers() {
    $('playerCount').textContent = `${state.players.length} player${state.players.length === 1 ? '' : 's'}`;
    $('playerRoster').innerHTML = state.players.length ? state.players.map(p => {
      const house = state.houses.find(h => h.id === p.houseId);
      return `<div class="player-row"><span class="online-dot ${p.connected ? 'online' : ''}"></span>${houseBanner(house, 'player-house-banner')}<div class="player-row-info"><strong>${escapeHtml(p.username)}${p.id === state.hostId ? ' <em class="host-tag">HOST</em>' : ''}${p.isKing ? ' <em class="king-tag">KING</em>' : ''}${p.isHand ? ' <em class="hand-tag">HAND</em>' : ''}</strong><small>${house ? `House ${escapeHtml(house.name)}` : 'No house chosen'}</small></div></div>`;
    }).join('') : '<p class="muted small-text">No players have joined yet.</p>';
    $('lobbyPlayerList').innerHTML = state.players.map(p => `<span class="mini-player ${p.houseId ? 'assigned' : ''}">${escapeHtml(p.username)}${p.houseId ? ` · ${escapeHtml(prettyHouse(p.houseId))}` : ''}</span>`).join('');
  }

  function renderWaitingRoom() {
    if (!state?.me) return;
    $('lobbyRoomPin').textContent = gameCode || '——';
    $('hostRoomPin').textContent = gameCode || '——';
    $('lobbyCount').textContent = `${state.players.length} player${state.players.length === 1 ? '' : 's'}`;
    const setup = state.settings || { maxPlayers: 16, gameType: 'CLASSIC' };
    const gameTypeLabel = setup.gameType === 'LAST_DRAGON' ? 'Last Dragon · rules coming later' : 'Classic';
    $('lobbySettings').textContent = `${gameTypeLabel} · ${state.players.length} of ${setup.maxPlayers} players`;
    $('lobbyRoster').innerHTML = state.players.length ? state.players.map(p => {
      const house = state.houses.find(h => h.id === p.houseId);
      const banner = house ? houseBanner(house, 'player-house-banner') : '<span class="player-house-banner player-house-pending" aria-hidden="true">?</span>';
      return `<div class="player-row"><span class="online-dot ${p.connected ? 'online' : ''}"></span>${banner}<div class="player-row-info"><strong>${escapeHtml(p.username)}${p.id === state.hostId ? ' <em class="host-tag">SERVER OWNER</em>' : ''}</strong><small>${house ? `House ${escapeHtml(house.name)}` : 'Joining · house not chosen'}${p.connected ? '' : ' · reconnecting'}</small></div></div>`;
    }).join('') : '<p class="muted">The hall is quiet. Be the first to join.</p>';
    const canStart = state.isHost && state.phase === 'LOBBY';
    const hasBaratheon = state.players.some(p => p.connected && p.houseId === 'baratheon');
    $('startGameButton').hidden = !canStart;
    $('startGameButton').disabled = canStart && !hasBaratheon;
    $('lobbyHostNote').textContent = canStart ? (hasBaratheon ? 'As server owner, begin when everyone is ready.' : 'A connected player must join House Baratheon to receive its first-king buff.') : 'The server owner will begin the game when everyone is ready.';
  }

  function renderKingSelection() {
    const king = state.king;
    const kingPlayer = state.players.find(player => player.id === king?.id);
    const house = state.houses.find(item => item.id === kingPlayer?.houseId);
    $('firstKingIdentity').innerHTML = `${houseBanner(house, 'player-house-banner first-king-banner')}<div><small>FIRST KING · HOUSE BARATHEON</small><strong>${escapeHtml(king?.username || 'Awaiting the king')}</strong></div>`;
    $('handSelectionForm').hidden = !state.isKing;
    $('kingWaitingMessage').hidden = state.isKing;
    $('kingWaitingMessage').textContent = `${king?.username || 'The king'} is choosing the Hand of the King. The game will begin when the appointment is made.`;
    $('handPlayerSelect').innerHTML = '<option value="" disabled selected>Choose a player</option>' + state.players.map(player => {
      const playerHouse = state.houses.find(item => item.id === player.houseId);
      return `<option value="${escapeHtml(player.id)}">${escapeHtml(player.username)}${playerHouse ? ` · House ${escapeHtml(playerHouse.name)}` : ''}${player.connected ? '' : ' · reconnecting'}</option>`;
    }).join('');
    $('handPlayerSelect').disabled = !state.players.length;
    $('handSelectionForm').querySelector('button').disabled = true;
  }

  function renderVotePanel() {
    const candidateSelect = $('candidateSelect');
    candidateSelect.innerHTML = state.voteCandidates.map(c => {
      const house = state.houses.find(h => h.id === c.houseId);
      return `<option value="${escapeHtml(c.id)}">${escapeHtml(c.username)}${house ? ` · House ${escapeHtml(house.name)}` : ''}</option>`;
    }).join('');
    candidateSelect.disabled = !state.me || state.me.vote !== null || state.voteCandidates.length === 0;
    $('voteProgress').textContent = `${state.votesCast}/${state.voteTotal} votes cast`;
    $('voteStatus').textContent = state.me?.vote ? `Your vote has been recorded for ${escapeHtml(playerName(state.me.vote))}.` : state.runoff ? 'Runoff election: only the tied candidates can receive votes.' : 'Your vote is private until the election closes.';
    $('voteForm').querySelector('button').disabled = candidateSelect.disabled;
  }

  function renderRoundActions() {
    const house = state.myHouse;
    $('infantryCostLabel').textContent = house.infantryCost;
    $('navyCostLabel').textContent = house.navyCost;
    $('spyTarget').innerHTML = state.houses.filter(h => h.id !== house.id).map(h => `<option value="${escapeHtml(h.id)}">${escapeHtml(h.name)}</option>`).join('');
    $('attackTarget').innerHTML = state.capitals.filter(c => c.ownerHouseId !== house.id).map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)} · ${escapeHtml(prettyHouse(c.ownerHouseId))}</option>`).join('');
    $('attackInfantry').max = house.infantry;
    $('attackNavy').max = house.navy;
    $('attackDragons').max = house.dragons;
    $('attackDragons').disabled = house.dragons === 0;
    const attackLocked = state.phase !== 'ACTION' || state.round < 2 || Boolean(house.pendingAttack) || house.hasAttackedThisRound;
    $('attackForm').hidden = state.round === 1;
    $('attackForm').querySelector('button').disabled = attackLocked || !state.capitals.some(c => c.ownerHouseId !== house.id);
    $('attackOrderStatus').textContent = state.round < 2 ? 'Attacks unlock after Round 1.' : house.pendingAttack ? `Committed for resolution after Round ${house.pendingAttack.resolveRound}.` : house.hasAttackedThisRound ? 'Your house has already planned an attack this round.' : 'The target and committed forces remain secret until the attack resolves.';
    updateRecruitButton();
    $('spyForm').querySelector('button').disabled = state.phase !== 'ACTION' || house.money < 8 || state.me.lastSpyRound === state.round;
    $('spyReports').innerHTML = state.spyReports.length ? `<div class="subsection-title">Your intelligence reports</div>${state.spyReports.map(r => r.success ? `<article class="spy-report"><div><b>${escapeHtml(r.targetName)}</b><span>Round ${r.round} · successful</span></div><p>${r.infantry} infantry · ${r.navy} ships · ${r.dragons} dragons</p>${r.pendingTarget ? `<small>Possible planned attack: ${escapeHtml(r.pendingTarget)}</small>` : '<small>No pending attack seen.</small>'}</article>` : `<article class="spy-report spy-failed"><div><b>${escapeHtml(r.targetName)}</b><span>Round ${r.round} · failed</span></div><p>Your agents returned without reliable force estimates.</p></article>`).join('')}` : '';
  }

  function updateRecruitButton() {
    const button = $('recruitForm')?.querySelector('button');
    if (!button) return;
    const house = state?.myHouse;
    if (!house) { button.disabled = true; return; }
    const unit = $('unitSelect').value;
    const amount = Number($('unitAmount').value);
    const cost = unit === 'navy' ? house.navyCost : house.infantryCost;
    button.disabled = state.phase !== 'ACTION' || house.lockedByEmbargo || !Number.isInteger(amount) || amount < 1 || amount > 10 || cost * amount > house.money;
  }

  function renderRoundOverview() {
    const house = state.myHouse;
    $('roundGold').textContent = house ? house.money : '—';
    const total = house ? house.infantry + house.navy + house.dragons : null;
    $('roundMilitaryTotal').textContent = total === null ? '—' : `${total} units`;
    $('roundMilitaryDetail').textContent = house ? `${house.infantry} infantry · ${house.navy} navy · ${house.dragons} dragons` : 'Forces unavailable';
    $('roundKingName').textContent = state.king?.username || 'Awaiting appointment';
    $('roundHandName').textContent = state.hand?.username || 'Awaiting appointment';
    $('roundKingBadge').hidden = !state.isKing;
    $('roundHandBadge').hidden = !state.isHand;
    $('roundRoleMessage').textContent = state.isKing && state.isHand ? 'You are both King and Hand of the King.' : state.isKing ? 'You are the King. Your decisions shape the court.' : state.isHand ? 'You are the Hand of the King.' : 'You serve on the royal council.';
  }

  function renderAlliances() {
    $('allianceTarget').innerHTML = state.houses.filter(h => h.id !== state.me?.houseId).map(h => `<option value="${escapeHtml(h.id)}">${escapeHtml(h.name)}</option>`).join('');
    $('commandTarget').innerHTML = state.houses.filter(h => h.id !== state.myHouse?.id).map(h => `<option value="${escapeHtml(h.id)}">${escapeHtml(h.name)}</option>`).join('');
    $('allianceForm').querySelector('button').disabled = state.phase !== 'COURT' || !state.myHouse;
    $('commandForm').querySelector('button').disabled = state.phase !== 'COURT' || !state.isKing || !state.myHouse || state.myHouse.commandUsedRound === state.round;
    $('commandSelect').disabled = !state.isKing;
    $('commandTarget').disabled = !state.isKing || $('commandSelect').value !== 'embargo';
    $('kingBadge').textContent = state.king ? `King: ${state.king.username}` : 'No king';

    const offers = state.allianceOffers || [];
    const alliances = state.alliances || [];
    let markup = '';
    if (offers.length) {
      markup += offers.map(o => `<div class="alliance-row offer-row"><div><strong>${o.isOutgoing ? `Offer to House ${escapeHtml(prettyHouse(o.toHouseId))}` : `Offer from House ${escapeHtml(prettyHouse(o.fromHouseId))}`}</strong><small>${o.scope === 'secret' ? 'Secret offer' : 'Public offer'} · Round ${o.round}</small></div><div class="alliance-row-actions">${o.canRespond ? `<button class="button button-primary button-small" data-action="respond-alliance" data-offer-id="${escapeHtml(o.id)}" data-accept="true" ${state.phase !== 'COURT' ? 'disabled' : ''}>Accept</button><button class="button button-quiet button-small" data-action="respond-alliance" data-offer-id="${escapeHtml(o.id)}" data-accept="false" ${state.phase !== 'COURT' ? 'disabled' : ''}>Decline</button>` : '<span class="subtle-label">Awaiting reply</span>'}</div></div>`).join('');
    }
    if (alliances.length) {
      markup += alliances.map(a => `<div class="alliance-row"><div><strong>${escapeHtml(prettyHouse(a.houseA))} <span class="alliance-link">↔</span> ${escapeHtml(prettyHouse(a.houseB))}</strong><small>${a.scope === 'secret' ? 'Secret alliance' : 'Public alliance'} · since Round ${a.createdRound}</small></div>${state.myHouse && (a.houseA === state.myHouse.id || a.houseB === state.myHouse.id) ? `<button class="button button-quiet button-small" data-action="break-alliance" data-alliance-id="${escapeHtml(a.id)}" ${state.phase !== 'COURT' ? 'disabled' : ''}><img class="button-icon" src="./assets/game-chain.png?v=2" alt="">Break</button>` : ''}</div>`).join('');
    }
    $('allianceList').innerHTML = markup || '<p class="muted small-text">No active alliance offers or treaties.</p>';
  }

  function messageMarkup(messages, includeTarget = false) {
    return messages.map(m => `<article class="chat-message ${m.scope === 'secret' ? 'chat-secret-message' : ''}"><div class="chat-message-meta"><strong>${escapeHtml(m.senderName)}</strong><span>${escapeHtml(m.senderHouseName)} · R${m.round}${includeTarget && m.targetHouseName ? ` · to ${escapeHtml(m.targetHouseName)}` : ''}</span></div><p>${escapeHtml(m.message)}</p></article>`).join('') || '<p class="muted small-text chat-empty">No messages yet. Start the conversation.</p>';
  }

  function renderChat() {
    $('publicChat').innerHTML = messageMarkup(state.publicMessages || []);
    $('secretChat').innerHTML = messageMarkup(state.privateMessages || [], true);
    $('publicChat').hidden = activeChatTab !== 'public';
    $('secretChat').hidden = activeChatTab !== 'secret';
    document.querySelectorAll('[data-chat-tab]').forEach(btn => btn.classList.toggle('active', btn.dataset.chatTab === activeChatTab));
    $('chatTarget').innerHTML = state.houses.filter(h => h.id !== state.myHouse?.id).map(h => `<option value="${escapeHtml(h.id)}">${escapeHtml(h.name)}</option>`).join('');
    $('chatScope').disabled = !state.myHouse;
    $('chatMessage').disabled = !state.myHouse;
    $('chatForm').querySelector('button').disabled = !state.myHouse;
    $('chatTarget').hidden = $('chatScope').value !== 'secret';
  }

  function renderEvents() {
    $('resolutionEvents').innerHTML = state.events.filter(e => e.kind === 'battle' || e.kind === 'important').map(e => `<div class="resolution-item"><span>R${e.round}</span><p>${escapeHtml(e.text)}</p></div>`).join('') || '<p class="muted small-text">No major events have been recorded yet.</p>';
  }

  function renderPhase() {
    const phaseInfo = PHASES[state.phase] || PHASES.LOBBY;
    $('phaseEyebrow').textContent = phaseInfo[0];
    $('phaseTitle').textContent = state.phase === 'ACTION' ? `Round ${state.round}: prepare your moves` : phaseInfo[1];
    $('phaseDescription').textContent = phaseInfo[2];
    $('roundPill').textContent = phaseLabel(state.phase);

    $('lobbyPanel').hidden = state.phase !== 'LOBBY';
    $('electionPanel').hidden = state.phase !== 'KING_VOTE';
    $('actionPanel').hidden = state.phase !== 'ACTION';
    $('courtPanel').hidden = state.phase !== 'COURT';
    $('resolutionPanel').hidden = state.phase !== 'RESOLUTION';

    const controls = $('hostControls');
    if (state.isHost) {
      const action = ({ LOBBY: ['start-game', 'Begin the game'], ACTION: ['advance-phase', 'Open the court →'], COURT: ['advance-phase', 'Resolve this round →'], RESOLUTION: ['advance-phase', `Begin Round ${state.round + 1} →`] })[state.phase];
      controls.innerHTML = `<span class="host-label">YOU ARE HOST</span><button class="button button-primary" data-action="${action[0]}">${action[1]}</button>`;
    } else {
      const message = state.phase === 'LOBBY' ? 'The host will begin when everyone is ready.' : 'Waiting for the host to advance the phase.';
      controls.innerHTML = `<span class="waiting-label">${escapeHtml(message)}</span>`;
    }
  }

  const normHouse = value => String(value || '').toLowerCase().replace(/^house\s+/, '').trim();
  function findPickedHouse() {
    if (!pickedHouse || !state?.houses) return null;
    return state.houses.find(h => h.id === pickedHouse.key || normHouse(h.id) === pickedHouse.key || normHouse(h.name) === pickedHouse.key) || null;
  }
  function setPickedHouse(value) {
    pickedHouse = value;
    if (value) localStorage.setItem(pickedHouseKey, JSON.stringify(value));
    else localStorage.removeItem(pickedHouseKey);
  }

  // Flow: host setup or throne selection → name → waiting room → game.
  function updateScreens() {
    const loggedIn = Boolean(state?.me);
    const hostSetup = showHostSetup || (loggedIn && state?.phase === 'LOBBY' && state.isHost && !state.settings?.configured);
    const showThrone = !loggedIn && (!gameCode || !pickedHouse);
    const waiting = loggedIn && state?.phase === 'LOBBY' && !hostSetup;
    const inGame = loggedIn && state?.phase !== 'LOBBY' && state?.phase !== 'HAND_SELECTION';
    $('throneScreen').hidden = !showThrone;
    $('loginScreen').hidden = loggedIn || !gameCode || showThrone;
    $('hostSetupScreen').hidden = !hostSetup;
    $('lobbyScreen').hidden = !waiting;
    $('kingSelectionScreen').hidden = !loggedIn || state?.phase !== 'HAND_SELECTION';
    $('gameScreen').hidden = !inGame;
    $('buildLabel').hidden = inGame;
    $('gameVersion').hidden = inGame;
    document.body.classList.toggle('throne-open', showThrone);
    if (hostSetup) {
      $('hostRoomPin').textContent = gameCode || '——';
      const maxSelect = $('maxPlayersInput');
      if (!maxSelect.options.length) maxSelect.innerHTML = Array.from({ length: 15 }, (_, i) => i + 2).map(n => `<option value="${n}">${n} players</option>`).join('');
      maxSelect.value = String(state?.settings?.maxPlayers || 4);
      $('gameTypeInput').value = state?.settings?.gameType || 'CLASSIC';
    }
    const chosen = $('chosenHouse');
    if (chosen) {
      const house = findPickedHouse();
      chosen.hidden = !pickedHouse || loggedIn;
      if (pickedHouse) {
        chosen.style.setProperty('--house-color', house?.color || '#c8a86c');
        chosen.innerHTML = `<div class="chosen-house-identity">${houseBanner(house, 'chosen-house-heraldry')}<div><small>YOUR HOUSE</small><strong>House ${escapeHtml(house?.name || pickedHouse.name.replace(/^house\s+/i, ''))}</strong></div></div><button class="button button-quiet button-small" type="button" data-action="change-house">Change</button>`;
      }
    }
  }

  // Tell the throne which houses can be picked right now (same rules as the lobby house picker).
  function sendHousesToThrone() {
    const frame = $('throneFrame');
    if (!frame?.contentWindow || !state?.houses) return;
    const houses = state.houses.map(h => {
      const locked = h.type === 'minor' && !state.minorHousesUnlocked;
      const claimed = h.type === 'minor' && h.players.length > 0 && !h.players.some(p => p.id === state.me?.id);
      return {
        id: h.id, name: h.name, motto: h.motto, color: h.color,
        status: locked ? 'locked' : claimed ? 'claimed' : 'open',
        note: locked ? `Minor house · unlocks at 7 players (${state.players.length}/7)` : claimed ? 'Already claimed by another player' : h.type === 'major' ? `Major house · ${h.players.length} sworn` : 'Minor house · one player only'
      };
    });
    frame.contentWindow.postMessage({ type: 'iron-throne:houses', houses }, location.origin === 'null' ? '*' : location.origin);
  }

  // Once logged in, claim the house picked on the throne (uses the existing select-house action).
  function claimPickedHouse() {
    if (!pickedHouse || !state?.me) return;
    const house = findPickedHouse();
    const label = pickedHouse.name;
    setPickedHouse(null);
    if (!house) { showToast(`Could not find ${label}. Choose a house in the lobby.`, 'error'); return; }
    if (state.me.houseId === house.id) return;
    if (state.phase !== 'LOBBY') { showToast('The game has already begun, so your house cannot change now.', 'error'); return; }
    emitAction('select-house', { houseId: house.id });
  }

  function render() {
    updateScreens();
    if (!state) return;
    // Preserve all form selections and text while another player causes a shared-state update.
    const savedValues = {};
    document.querySelectorAll('input[id], select[id], textarea[id]').forEach(element => {
      savedValues[element.id] = element.value;
    });
    const wasFocused = document.activeElement?.id;
    const selectionStart = wasFocused && typeof document.activeElement.selectionStart === 'number' ? document.activeElement.selectionStart : null;

    const loggedIn = Boolean(state.me);
    if (!loggedIn) return;
    claimPickedHouse();

    renderWaitingRoom();
    if (state.phase === 'HAND_SELECTION') {
      renderKingSelection();
      $('roundPill').textContent = 'FIRST KING';
      return;
    }
    renderPhase();
    renderPlayers();
    renderRoundOverview();
    renderRoundActions();
    renderAlliances();
    renderChat();
    renderEvents();

    for (const [id, value] of Object.entries(savedValues)) {
      const element = $(id);
      if (!element) continue;
      if (element.tagName === 'SELECT') {
        if ([...element.options].some(option => option.value === value)) element.value = value;
      } else {
        element.value = value;
      }
    }
    updateRecruitButton();
    if (wasFocused) {
      const element = $(wasFocused);
      if (element && !element.disabled) {
        element.focus({ preventScroll: true });
        if (selectionStart !== null && element.setSelectionRange && element.type !== 'number') element.setSelectionRange(selectionStart, selectionStart);
      }
    }
  }

  updateScreens();

  if (!socket) {
    setConnection(false, 'Socket.IO failed to load');
    $('loginError').textContent = 'The realtime client library did not load. Check your internet connection or CDN access.';
  } else {
    socket.on('connect', () => {
      setConnection(true, 'Connected to server');
      const restoreSession = () => {
        socket.emit('request-state');
        const savedName = gameCode ? localStorage.getItem(usernameKey) : null;
        if (savedName) socket.emit('login', { username: savedName, clientToken }, result => {
          if (!result?.ok) showToast(result?.message || 'Could not restore your session.', 'error');
        });
      };
      if (gameCode) socket.emit('join-game-room', { pin: gameCode, clientToken }, result => {
        if (!result?.ok) {
          gameCode = '';
          localStorage.removeItem(roomCodeKey);
          localStorage.removeItem(usernameKey);
          setThronePage('entry');
          render();
          showToast(result?.message || 'That game PIN is no longer available.', 'error');
          return;
        }
        restoreSession();
      });
      else restoreSession();
    });
    socket.on('disconnect', () => setConnection(false, 'Disconnected — reconnecting'));
    socket.on('connect_error', () => setConnection(false, 'Server unavailable'));
    socket.on('state', nextState => {
      state = nextState;
      render();
      sendHousesToThrone();
    });
    socket.on('game-ended', ({ message } = {}) => {
      gameCode = '';
      state = null;
      localStorage.removeItem(roomCodeKey);
      localStorage.removeItem(usernameKey);
      setPickedHouse(null);
      setThronePage('entry');
      $('throneFrame')?.contentWindow?.postMessage({ type: 'iron-throne:reset' }, location.origin === 'null' ? '*' : location.origin);
      render();
      showToast(message || 'The host did not reconnect in time. This game has ended.', 'error');
    });
  }

  // Messages from the throne screen (same site only).
  window.addEventListener('message', event => {
    const frame = $('throneFrame');
    if (!frame || event.source !== frame.contentWindow || !event.data) return;
    if (event.data.type === 'iron-throne:ready') sendHousesToThrone();
    if (event.data.type === 'iron-throne:host') {
      if (!socket?.connected) return frame.contentWindow.postMessage({ type: 'iron-throne:mode-error', message: 'Connecting to the game server. Try again in a moment.' }, location.origin === 'null' ? '*' : location.origin);
      socket.emit('create-game-room', { clientToken }, result => {
        if (!result?.ok || !result.pin) return frame.contentWindow.postMessage({ type: 'iron-throne:mode-error', message: result?.message || 'Could not create a game.' }, location.origin === 'null' ? '*' : location.origin);
        gameCode = result.pin;
        localStorage.setItem(roomCodeKey, gameCode);
        localStorage.removeItem(usernameKey);
        setPickedHouse(null);
        $('usernameInput').value = '';
        preparingHost = true;
        showHostSetup = true;
        render();
      });
    }
    if (event.data.type === 'iron-throne:join-pin' && typeof event.data.pin === 'string') {
      const pin = event.data.pin.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
      if (pin.length !== 4) return frame.contentWindow.postMessage({ type: 'iron-throne:mode-error', message: 'Enter the complete four-character game PIN.' }, location.origin === 'null' ? '*' : location.origin);
      if (!socket?.connected) return frame.contentWindow.postMessage({ type: 'iron-throne:mode-error', message: 'Connecting to the game server. Try again in a moment.' }, location.origin === 'null' ? '*' : location.origin);
      socket.emit('join-game-room', { pin, clientToken }, result => {
        if (!result?.ok) return frame.contentWindow.postMessage({ type: 'iron-throne:mode-error', message: result?.message || 'Could not join that game.' }, location.origin === 'null' ? '*' : location.origin);
        gameCode = result.pin;
        localStorage.setItem(roomCodeKey, gameCode);
        localStorage.removeItem(usernameKey);
        setPickedHouse(null);
        $('usernameInput').value = '';
        showHostSetup = false;
        transitionThrone('house');
        render();
        sendHousesToThrone();
      });
    }
    if (event.data.type === 'iron-throne:pick' && typeof event.data.house === 'string') {
      setPickedHouse({ key: normHouse(event.data.house).slice(0, 40), name: String(event.data.name || event.data.house).slice(0, 60) });
      render();
    }
  });
  $('throneFrame')?.addEventListener('load', sendHousesToThrone);

  $('loginForm').addEventListener('submit', event => {
    event.preventDefault();
    const username = $('usernameInput').value.trim();
    if (!socket?.connected) {
      $('loginError').textContent = `Cannot reach ${SERVER_URL}. Start the server and check docs/config.js.`;
      return;
    }
    $('loginError').textContent = '';
    socket.emit('login', { username, clientToken }, result => {
      if (!result?.ok) {
        $('loginError').textContent = result?.message || 'Could not join the game.';
        return;
      }
      localStorage.setItem(usernameKey, username);
      showToast(result.message || 'Welcome to the realm.', 'success');
      socket.emit('request-state');
    });
  });
  $('hostSetupForm').addEventListener('submit', event => {
    event.preventDefault();
    $('hostSetupError').textContent = '';
    const settings = { maxPlayers: Number($('maxPlayersInput').value), gameType: $('gameTypeInput').value };
    socket.emit(preparingHost ? 'set-room-settings' : 'set-game-settings', preparingHost ? { ...settings, clientToken } : settings, result => {
      if (!result?.ok) $('hostSetupError').textContent = result?.message || 'Could not save game setup.';
      else {
        showToast(result.message || 'Game setup saved.', 'success');
        if (preparingHost) {
          preparingHost = false;
          showHostSetup = false;
          transitionThrone('house');
          render();
          sendHousesToThrone();
        }
      }
    });
  });
  $('startGameButton').addEventListener('click', () => emitAction('start-game'));
  $('handSelectionForm').addEventListener('submit', event => {
    event.preventDefault();
    emitAction('appoint-hand', { playerId: $('handPlayerSelect').value });
  });
  $('handPlayerSelect').addEventListener('change', event => {
    $('handSelectionForm').querySelector('button').disabled = !event.target.value;
  });

  document.addEventListener('click', event => {
    const tab = event.target.closest('[data-chat-tab]');
    if (tab) {
      activeChatTab = tab.dataset.chatTab;
      renderChat();
      return;
    }
    const button = event.target.closest('[data-action]');
    if (!button || button.disabled) return;
    const action = button.dataset.action;
    if (action === 'change-house') {
      setPickedHouse(null);
      $('throneFrame')?.contentWindow?.postMessage({ type: 'iron-throne:reset' }, location.origin === 'null' ? '*' : location.origin);
      sendHousesToThrone();
      render();
      return;
    }
    if (action === 'select-house') emitAction('select-house', { houseId: button.dataset.houseId });
    else if (action === 'start-game') emitAction('start-game');
    else if (action === 'advance-phase') emitAction('advance-phase');
    else if (action === 'respond-alliance') emitAction('respond-alliance', { offerId: button.dataset.offerId, accept: button.dataset.accept === 'true' });
    else if (action === 'break-alliance') emitAction('break-alliance', { allianceId: button.dataset.allianceId });
  });

  $('voteForm').addEventListener('submit', event => {
    event.preventDefault();
    emitAction('vote-king', { candidateId: $('candidateSelect').value });
  });

  $('recruitForm').addEventListener('submit', event => {
    event.preventDefault();
    emitAction('purchase', { unit: $('unitSelect').value, amount: Number($('unitAmount').value) });
  });
  $('unitSelect').addEventListener('change', updateRecruitButton);
  $('unitAmount').addEventListener('input', updateRecruitButton);

  $('spyForm').addEventListener('submit', event => {
    event.preventDefault();
    emitAction('spy', { targetHouseId: $('spyTarget').value });
  });

  $('attackForm').addEventListener('submit', event => {
    event.preventDefault();
    emitAction('plan-attack', {
      targetCapitalId: $('attackTarget').value,
      infantry: Number($('attackInfantry').value),
      navy: Number($('attackNavy').value),
      dragons: Number($('attackDragons').value)
    });
  });

  $('allianceForm').addEventListener('submit', event => {
    event.preventDefault();
    emitAction('offer-alliance', { targetHouseId: $('allianceTarget').value, scope: $('allianceScope').value });
  });

  $('commandSelect').addEventListener('change', () => {
    $('commandTarget').disabled = !state?.isKing || $('commandSelect').value !== 'embargo';
  });

  $('commandForm').addEventListener('submit', event => {
    event.preventDefault();
    emitAction('king-command', { command: $('commandSelect').value, targetHouseId: $('commandTarget').value });
  });

  $('chatScope').addEventListener('change', () => {
    $('chatTarget').hidden = $('chatScope').value !== 'secret';
  });

  $('chatForm').addEventListener('submit', event => {
    event.preventDefault();
    emitAction('send-chat', { scope: $('chatScope').value, targetHouseId: $('chatTarget').value, message: $('chatMessage').value });
    $('chatMessage').value = '';
  });

  $('homeLink').addEventListener('click', event => {
    event.preventDefault();
    if (!window.confirm('Return to the start page? You will leave this game session.')) return;
    localStorage.removeItem(usernameKey);
    localStorage.removeItem(tokenKey);
    localStorage.removeItem(roomCodeKey);
    gameCode = '';
    setPickedHouse(null);
    const makePart = () => (window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`);
    clientToken = `${makePart()}-${makePart()}`;
    localStorage.setItem(tokenKey, clientToken);
    if (socket?.connected) socket.emit('logout-player', {}, () => window.location.reload());
    setTimeout(() => window.location.reload(), 500);
  });

  $('logoutButton').addEventListener('click', () => {
    if (socket?.connected) socket.emit('logout-player', {}, () => {});
    localStorage.removeItem(usernameKey);
    localStorage.removeItem(tokenKey);
    localStorage.removeItem(roomCodeKey);
    gameCode = '';
    state = state ? { ...state, me: null, myHouse: null } : null;
    setPickedHouse(null);
    setThronePage('entry');
    $('throneFrame')?.contentWindow?.postMessage({ type: 'iron-throne:reset' }, location.origin === 'null' ? '*' : location.origin);
    render();
    $('usernameInput').value = '';
    // Prepare a fresh guest identity on this browser; the server keeps the old player slot disconnected.
    const makePart = () => (window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`);
    clientToken = `${makePart()}-${makePart()}`;
    localStorage.setItem(tokenKey, clientToken);
    showToast('Signed out in this browser.', 'normal');
  });
})();
