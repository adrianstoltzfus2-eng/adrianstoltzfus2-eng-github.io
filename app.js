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
  let changingLobbyHouse = false;
  let lobbyCanChangeHouse = false;
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
    if (frame) frame.src = mode === 'entry' ? './throne-photo.html?mode=entry&v=14' : './throne-photo.html?v=14';
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

  // iPhone: if the page ever ends up zoomed (e.g. after the keyboard closes), snap it back to fit the screen.
  const viewportMeta = document.querySelector('meta[name="viewport"]');
  function resetMobileZoom() {
    if (!viewportMeta || !isMobileDevice()) return;
    const original = viewportMeta.content;
    viewportMeta.content = 'width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no';
    setTimeout(() => { viewportMeta.content = original; }, 80);
  }
  window.resetMobileZoom = resetMobileZoom;
  document.addEventListener('focusout', () => setTimeout(resetMobileZoom, 60));
  window.addEventListener('pageshow', resetMobileZoom);
  window.addEventListener('load', () => setTimeout(resetMobileZoom, 100));

  // Mobile: block pinch zoom, and keep the browser's own bars hidden (full screen).
  // Tapping empty space brings the bars back; they hide again a few seconds later.
  // (Not available on iPhone Safari; installing to the Home Screen gives the same bar-free view there.)
  document.addEventListener('gesturestart', event => event.preventDefault());
  const fsRoot = document.documentElement;
  const fsRequest = fsRoot.requestFullscreen || fsRoot.webkitRequestFullscreen;
  const fsExit = document.exitFullscreen || document.webkitExitFullscreen;
  const fsActive = () => Boolean(document.fullscreenElement || document.webkitFullscreenElement);
  const isInstalledApp = window.matchMedia('(display-mode: fullscreen)').matches || window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const FS_CONTROLS = 'button, a, input, select, textarea, label, summary, [data-action], [role="button"], .map-cap';
  const FS_IDLE_MS = 4000;
  let fsWanted = false;
  let fsTimer = null;
  function enterFullscreen() {
    clearTimeout(fsTimer);
    try { Promise.resolve(fsRequest.call(fsRoot, { navigationUI: 'hide' })).catch(() => {}); } catch { /* not allowed right now */ }
  }
  function hideBarsSoon() {
    clearTimeout(fsTimer);
    fsTimer = setTimeout(() => { if (fsWanted && !fsActive()) enterFullscreen(); }, FS_IDLE_MS);
  }
  if (fsRequest && fsExit && !isInstalledApp) {
    document.addEventListener('click', event => {
      if (!isMobileDevice()) return;
      if (!fsWanted) { fsWanted = true; enterFullscreen(); return; }       // first tap: go full screen
      if (!fsActive()) { enterFullscreen(); return; }                      // bars showing: hide them again
      if (!event.target.closest(FS_CONTROLS)) {                            // tap on empty space: show bars briefly
        try { Promise.resolve(fsExit.call(document)).catch(() => {}); } catch { /* ignore */ }
        hideBarsSoon();
      }
    });
    // Any touch while the bars are showing keeps them up a little longer.
    ['pointerdown', 'keydown'].forEach(name => document.addEventListener(name, () => { if (fsWanted && !fsActive()) hideBarsSoon(); }, { passive: true }));
  }
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
    $('lobbyPlayerList').innerHTML = state.players.map(p => `<span class="mini-player ${p.houseId ? 'assigned' : ''}">${escapeHtml(p.username)}${p.houseId ? ` · ${escapeHtml(prettyHouse(p.houseId))}` : ''}</span>`).join('');
  }

  // Why `house` can't be taken by player `excludeId` right now (null = available). Mirrors the server rules.
  function minorHouseReason(house, excludeId) {
    if (house.type !== 'minor') return null;
    const maxPlayers = Number(state.settings?.maxPlayers);
    if (maxPlayers < 7) return `Minor house · host must set the player limit to 7 or more (${maxPlayers || 0}/7)`;
    if (house.players.some(p => !p.left && p.id !== excludeId)) return 'Already claimed by another player';
    const slots = maxPlayers - 6;
    const taken = state.players.filter(p => !p.left && p.id !== excludeId && state.houses.find(h => h.id === p.houseId)?.type === 'minor').length;
    if (taken >= slots) return `All ${slots} minor-house place${slots === 1 ? '' : 's'} taken (one per player above 6)`;
    return null;
  }

  function renderWaitingRoom() {
    if (!state?.me) return;
    $('lobbyRoomPin').textContent = gameCode || '——';
    $('hostRoomPin').textContent = gameCode || '——';
    const activePlayers = state.players.filter(player => !player.left);
    $('lobbyCount').textContent = `${activePlayers.length} player${activePlayers.length === 1 ? '' : 's'}`;
    const setup = state.settings || { maxPlayers: 16, gameType: 'CLASSIC' };
    const gameTypeLabel = setup.gameType === 'LAST_DRAGON' ? 'Last Dragon · rules coming later' : 'Classic';
    $('lobbySettings').textContent = `${gameTypeLabel} · ${activePlayers.length} of ${setup.maxPlayers} players`;
    lobbyCanChangeHouse = state.phase === 'LOBBY' && state.houses.some(h => h.id !== state.me.houseId && !minorHouseReason(h, state.me.id));
    document.querySelector('[data-action="edit-menu-house"]').disabled = !lobbyCanChangeHouse;
    const houseRank = id => { const i = state.houses.findIndex(h => h.id === id); return i < 0 ? state.houses.length : i; };
    const lobbyOrder = [...state.players].sort((a, b) => houseRank(a.houseId) - houseRank(b.houseId));
    $('lobbyRoster').innerHTML = lobbyOrder.length ? lobbyOrder.map(p => {
      const house = state.houses.find(h => h.id === p.houseId);
      const banner = house ? houseBanner(house, 'player-house-banner') : '<span class="player-house-banner player-house-pending" aria-hidden="true">?</span>';
      const status = p.isBot ? 'Bot player' : p.left ? 'Left the game' : p.connected ? 'Connected' : 'Reconnecting';
      const own = p.id === state.me.id;
      const houseControl = own ? `<button class="lobby-banner-button" type="button" data-action="edit-player" data-edit-kind="house" aria-label="Change your house" ${lobbyCanChangeHouse ? '' : 'disabled'}>${banner}</button>` : banner;
      const nameEdit = own ? '<button class="player-edit-name" type="button" data-action="edit-player" data-edit-kind="name" aria-label="Edit your name">✎</button>' : '';
      const botControls = p.isBot && state.isHost && state.phase === 'LOBBY' ? `<button class="player-edit-name" type="button" data-action="edit-bot" data-bot-id="${escapeHtml(p.id)}" aria-label="Edit ${escapeHtml(p.username)}">✎</button><button class="player-edit-name player-remove-bot" type="button" data-action="remove-bot" data-bot-id="${escapeHtml(p.id)}" aria-label="Remove ${escapeHtml(p.username)}">✕</button>` : '';
      return `<div class="player-row ${p.left ? 'player-left' : ''} ${own ? 'player-row-own' : ''}" ${own && house?.color ? `style="--house-color:${escapeHtml(house.color)}"` : ''}><span class="online-dot ${p.connected && !p.left ? 'online' : ''} ${p.isBot ? 'bot-dot' : ''}"></span>${houseControl}<div class="player-row-info"><strong>${escapeHtml(p.username)}${p.isBot ? ' <em class="bot-tag">BOT</em>' : ''}${p.id === state.hostId ? ' <em class="host-tag">SERVER OWNER</em>' : ''}${nameEdit}${botControls}</strong><small>${house ? `House ${escapeHtml(house.name)}` : 'Joining · house not chosen'} · ${status}</small></div></div>`;
    }).join('') : '<p class="muted">The hall is quiet. Be the first to join.</p>';
    const canStart = state.isHost && state.phase === 'LOBBY';
    const hasBaratheon = state.players.some(p => p.connected && p.houseId === 'baratheon');
    const canAddBot = canStart && activePlayers.length < Number(setup.maxPlayers);
    $('addBotButton').hidden = !canStart;
    $('addBotButton').disabled = !canAddBot;
    $('startGameButton').hidden = !canStart;
    const connectedPlayers = activePlayers.filter(p => p.connected);
    const hasMinor = connectedPlayers.some(p => state.houses.find(h => h.id === p.houseId)?.type === 'minor');
    const thinMajors = hasMinor ? state.houses.filter(h => h.type === 'major' && connectedPlayers.filter(p => p.houseId === h.id).length < 2).map(h => h.name) : [];
    $('startGameButton').disabled = canStart && (!hasBaratheon || connectedPlayers.length < 2 || thinMajors.length > 0);
    $('lobbyHostNote').textContent = !canStart ? 'The server owner will begin the game when everyone is ready.'
      : !hasBaratheon ? 'A connected player or bot must join House Baratheon to receive its first-king buff.'
      : thinMajors.length ? `With minor houses in play, every major house needs at least 2 players. Still short: ${thinMajors.join(', ')}.`
      : 'As server owner, begin when everyone is ready.';
  }

  function renderKingSelection() {
    const king = state.king;
    const kingPlayer = state.players.find(player => player.id === king?.id);
    const house = state.houses.find(item => item.id === kingPlayer?.houseId);
    $('firstKingIdentity').innerHTML = `${houseBanner(house, 'player-house-banner first-king-banner')}<div><small>FIRST KING · HOUSE BARATHEON</small><strong>${escapeHtml(king?.username || 'Awaiting the king')}</strong></div>`;
    $('handSelectionForm').hidden = !state.isKing;
    $('kingWaitingMessage').hidden = state.isKing;
    $('kingWaitingMessage').textContent = `${king?.username || 'The king'} is choosing the Hand of the King. The game will begin when the appointment is made.`;
    const candidates = state.players.filter(player => player.id !== state.me?.id && !player.left);
    $('handPlayerSelect').innerHTML = '<option value="" disabled selected>Choose a player</option>' + candidates.map(player => {
      const playerHouse = state.houses.find(item => item.id === player.houseId);
      return `<option value="${escapeHtml(player.id)}">${escapeHtml(player.username)}${playerHouse ? ` · House ${escapeHtml(playerHouse.name)}` : ''}${player.connected ? '' : ' · reconnecting'}</option>`;
    }).join('');
    $('handPlayerSelect').disabled = !candidates.length;
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
    $('roundMilitaryTotal').textContent = total === null ? '—' : total;
    $('headerArmy').title = house ? `${house.infantry} infantry · ${house.navy} navy · ${house.dragons} dragons` : 'Forces unavailable';
    // King / Hand icons only appear for the player who holds that role.
    $('roundKingBadge').hidden = !state.isKing;
    $('roundHandBadge').hidden = !state.isHand;
  }

  const HOST_STEPS = { ACTION: ['OPEN COURT', 'Open the court'], COURT: ['RESOLVE', 'Resolve this round'], RESOLUTION: ['NEXT ROUND', 'Begin the next round'] };
  // The header pill shows the round for everyone; for the host it doubles as the "advance" button.
  function updateRoundPill() {
    const pill = $('roundPill');
    if (!pill || !state) return;
    const step = state.isHost ? HOST_STEPS[state.phase] : null;
    if (step) {
      pill.textContent = `ROUND ${state.round} · ${step[0]} →`;
      pill.dataset.action = 'advance-phase';
      pill.title = step[1];
      pill.disabled = false;
      pill.classList.add('round-pill-action');
    } else {
      pill.textContent = phaseLabel(state.phase);
      delete pill.dataset.action;
      pill.removeAttribute('title');
      pill.disabled = true;
      pill.classList.remove('round-pill-action');
    }
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

  const HUBS = { money: ['YOUR TREASURY', 'Money', 'hubMoney'], relations: ['COURT & DIPLOMACY', 'Relations', 'hubRelations'], army: ['FORCES & WAR', 'Army', 'hubArmy'] };
  function openHub(kind) {
    const cfg = HUBS[kind];
    if (!cfg) return;
    $('hubEyebrow').textContent = cfg[0];
    $('hubTitle').textContent = cfg[1];
    for (const [key, value] of Object.entries(HUBS)) $(value[2]).hidden = key !== kind;
    currentHub = kind;
    $('hubOverlay').hidden = false;
    $('hubOverlay').querySelector('.hub-sheet-body').scrollTop = 0;
    updateBadges();
    document.body.classList.add('hub-open');
  }
  function closeHub() {
    if ($('hubOverlay').hidden) return;
    $('hubOverlay').hidden = true;
    currentHub = null;
    document.body.classList.remove('hub-open');
  }
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  function renderHub() {
    const visible = state.phase === 'ACTION' || state.phase === 'COURT';
    $('actionHub').hidden = !visible;
    $('gameScreen').classList.toggle('hub-mode', visible);
    $('mapToggleButton').hidden = visible;
    if (!visible) closeHub();
    if (state.phase === 'LOBBY') seenNotes.ready = false;
    const h = state.myHouse;
    if (!h) return;
    updateBadges();
    const myAlliances = (state.alliances || []).filter(a => a.houseA === h.id || a.houseB === h.id).length;
    const waiting = (state.allianceOffers || []).filter(o => o.canRespond).length;
    const total = h.infantry + h.navy + h.dragons;
    // Hub buttons (details are hidden on phones)
    $('hubMoneyGold').textContent = `${h.money} gold`;
    $('hubMoneyIncome').textContent = `+${h.incomePerRound} gold each round`;
    $('hubMoneyCapitals').textContent = plural(h.capitalCount, 'capital') + ' held';
    $('hubRelAlliances').textContent = plural(myAlliances, 'alliance');
    $('hubRelOffers').textContent = waiting ? `${plural(waiting, 'offer')} awaiting your reply` : 'No offers waiting';
    $('hubRelRole').textContent = state.isKing ? 'You wear the crown — traitors & taxes' : 'Alliances & secret messages';
    $('hubArmyTotal').textContent = `${total} units`;
    $('hubArmyDetail').textContent = `${h.infantry} infantry · ${h.navy} navy · ${h.dragons} dragons`;
    $('hubArmyCosts').textContent = `Recruit: infantry ${h.infantryCost}g · navy ${h.navyCost}g`;
    // Money sheet
    $('moneyGold').textContent = `${h.money} gold`;
    $('moneyIncome').textContent = `+${h.incomePerRound} gold`;
    $('moneyIncomeNote').textContent = `${plural(h.capitalCount, 'capital')} × ${h.incomePerCapital} gold, paid when a new round begins.`;
    const mine = state.capitals.filter(c => c.ownerHouseId === h.id);
    $('moneyCapitals').innerHTML = mine.length ? mine.map(c => `<div class="resolution-item"><span>+${h.incomePerCapital}</span><p>${escapeHtml(c.name)}</p></div>`).join('') : '<p class="muted small-text">Your house holds no capitals, so it earns no income.</p>';
    // Army sheet
    $('armyInfantry').textContent = h.infantry;
    $('armyNavy').textContent = h.navy;
    $('armyDragons').textContent = h.dragons;
    $('armyInfantryCost').textContent = `${h.infantryCost} gold`;
    $('armyNavyCost').textContent = `${h.navyCost} gold`;
    $('armyPhaseNote').textContent = state.phase === 'ACTION' ? '' : 'Recruiting, spying and attack orders open during the action phase.';
    $('relationsPhaseNote').textContent = state.phase === 'COURT' ? '' : 'Alliance offers and royal decrees open during the court phase. Messages can be sent at any time.';
    // King's ledger
    $('kingTools').hidden = !state.isKing;
    if (state.isKing) {
      const others = state.players.filter(p => !p.left && p.id !== state.me?.id);
      $('traitorList').innerHTML = others.length ? others.map(p => {
        const house = state.houses.find(item => item.id === p.houseId);
        return `<div class="alliance-row"><div><strong>${escapeHtml(p.username)}${p.traitor ? ' <em class="traitor-tag">TRAITOR</em>' : ''}</strong><small>${house ? `House ${escapeHtml(house.name)}` : 'No house'}</small></div><button class="button ${p.traitor ? 'button-quiet' : 'button-danger'} button-small" type="button" data-action="toggle-traitor" data-player-id="${escapeHtml(p.id)}" data-traitor="${p.traitor ? 'false' : 'true'}">${p.traitor ? 'Pardon' : 'Label traitor'}</button></div>`;
      }).join('') : '<p class="muted small-text">There is no one else at court.</p>';
      $('taxLedger').innerHTML = (state.taxLedger || []).length ? state.taxLedger.map(t => `<article class="tax-entry"><strong>Round ${t.round} · ${escapeHtml(t.kind)} · ${t.demanded} gold demanded from each house</strong>${t.payments.map(x => `<div class="tax-row"><span>House ${escapeHtml(prettyHouse(x.houseId))}</span><span class="${x.amount >= t.demanded ? 'tax-paid' : x.amount > 0 ? 'tax-short' : 'tax-none'}">${x.amount >= t.demanded ? `Paid ${x.amount}` : x.amount > 0 ? `Paid ${x.amount} (short)` : 'Could not pay'}</span></div>`).join('')}</article>`).join('') : '<p class="muted small-text">No taxes or demands have been made yet. Issue a royal levy to see who pays.</p>';
    }
  }

  function renderEvents() {
    $('resolutionEvents').innerHTML = state.events.filter(e => e.kind === 'battle' || e.kind === 'important').map(e => `<div class="resolution-item"><span>R${e.round}</span><p>${escapeHtml(e.text)}</p></div>`).join('') || '<p class="muted small-text">No major events have been recorded yet.</p>';
  }

  function renderPhase() {
    const phaseInfo = PHASES[state.phase] || PHASES.LOBBY;
    $('phaseEyebrow').textContent = phaseInfo[0];
    $('phaseTitle').textContent = state.phase === 'ACTION' ? `Round ${state.round}: prepare your moves` : phaseInfo[1];
    $('phaseDescription').textContent = phaseInfo[2];
    updateRoundPill();

    $('lobbyPanel').hidden = state.phase !== 'LOBBY';
    $('electionPanel').hidden = state.phase !== 'KING_VOTE';
    $('resolutionPanel').hidden = state.phase !== 'RESOLUTION';
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
    const showThrone = changingLobbyHouse || (!loggedIn && (!gameCode || !pickedHouse));
    const waiting = loggedIn && state?.phase === 'LOBBY' && !hostSetup && !changingLobbyHouse;
    const inGame = loggedIn && state?.phase !== 'LOBBY' && state?.phase !== 'HAND_SELECTION';
    $('throneScreen').hidden = !showThrone;
    $('loginScreen').hidden = loggedIn || !gameCode || showThrone;
    $('hostSetupScreen').hidden = !hostSetup;
    $('lobbyScreen').hidden = !waiting;
    $('kingSelectionScreen').hidden = !loggedIn || state?.phase !== 'HAND_SELECTION';
    $('gameScreen').hidden = !inGame;
    $('buildLabel').hidden = inGame;
    $('gameVersion').hidden = inGame;
    $('headerStats').hidden = !inGame;
    document.body.classList.toggle('in-game', inGame);
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
      const reason = minorHouseReason(h, state.me?.id);
      const locked = Boolean(reason) && reason !== 'Already claimed by another player';
      const claimed = reason === 'Already claimed by another player';
      return {
        id: h.id, name: h.name, motto: h.motto, color: h.color,
        status: locked ? 'locked' : claimed ? 'claimed' : 'open',
        note: reason || (h.type === 'major' ? `Major house · ${h.players.length} sworn` : 'Minor house · one player only')
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

  function openNameEditor() {
    $('lobbyEditMenu').close?.();
    $('lobbyNameInput').value = state?.me?.username || '';
    $('lobbyNameDialog').showModal();
    $('lobbyNameInput').focus();
  }

  let editingBotId = null;
  function openBotEditor(botId) {
    const bot = state?.players?.find(p => p.id === botId && p.isBot);
    if (!bot) return;
    editingBotId = botId;
    $('botNameInput').value = bot.username;
    $('botHouseSelect').innerHTML = state.houses.map(h => {
      const unavailable = Boolean(minorHouseReason(h, bot.id));
      return `<option value="${escapeHtml(h.id)}" ${unavailable ? 'disabled' : ''}>${escapeHtml(h.name)}${h.type === 'minor' ? ' · Minor' : ''}</option>`;
    }).join('');
    $('botHouseSelect').value = bot.houseId;
    $('botEditDialog').showModal();
  }

  function removeBot(botId) {
    const bot = state?.players?.find(p => p.id === botId && p.isBot);
    if (bot && window.confirm(`Remove ${bot.username} from the lobby?`)) emitAction('remove-bot', { botId });
  }

  function setMapOpen(open) {
    const dialog = $('mapDialog');
    if (open) {
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) dialog.close();
    dialog.querySelectorAll('.map-cap.is-active').forEach(cap => cap.classList.remove('is-active'));
  }

  function openHouseChooser() {
    $('lobbyEditMenu').close?.();
    if (!lobbyCanChangeHouse) return showToast('There are no other houses available right now.', 'error');
    changingLobbyHouse = true;
    setPickedHouse(null);
    $('throneFrame')?.contentWindow?.postMessage({ type: 'iron-throne:reset' }, location.origin === 'null' ? '*' : location.origin);
    transitionThrone('house');
    render();
    sendHousesToThrone();
  }

  // ---- Hub notification badges (unread messages / offers, gold received, new battle reports) ----
  const seenNotes = { ready: false, chat: new Set(), offers: new Set(), battles: new Set(), gold: 0 };
  let currentHub = null;
  function setBadge(id, text) {
    const el = $(id);
    if (!el) return;
    const previous = el.hidden ? '' : el.textContent;
    el.hidden = !text;
    el.textContent = text || '';
    if (text && text !== previous) { el.classList.remove('badge-pop'); void el.offsetWidth; el.classList.add('badge-pop'); }
  }
  function updateBadges() {
    const h = state?.myHouse;
    if (!h || !state.me) return;
    const chat = [...(state.publicMessages || []).filter(m => m.senderName !== state.me.username), ...(state.privateMessages || []).filter(m => m.senderHouseId !== h.id)];
    const offers = (state.allianceOffers || []).filter(o => o.canRespond);
    const battles = (state.events || []).filter(e => e.kind === 'battle');
    const markAll = () => {
      if (currentHub === 'relations') { chat.forEach(m => seenNotes.chat.add(m.id)); offers.forEach(o => seenNotes.offers.add(o.id)); }
      if (currentHub === 'army') battles.forEach(e => seenNotes.battles.add(e.id));
      if (currentHub === 'money') seenNotes.gold = h.money;
    };
    if (!seenNotes.ready) {
      const open = currentHub; currentHub = 'relations'; markAll(); currentHub = 'army'; markAll(); currentHub = 'money'; markAll(); currentHub = open;
      seenNotes.ready = true;
    }
    markAll();
    if (h.money < seenNotes.gold) seenNotes.gold = h.money;
    const unread = chat.filter(m => !seenNotes.chat.has(m.id)).length + offers.filter(o => !seenNotes.offers.has(o.id)).length;
    const newBattles = battles.filter(e => !seenNotes.battles.has(e.id)).length;
    setBadge('badgeRelations', unread ? String(Math.min(unread, 99)) : '');
    setBadge('badgeArmy', newBattles ? String(Math.min(newBattles, 99)) : '');
    setBadge('badgeMoney', h.money > seenNotes.gold ? `+${h.money - seenNotes.gold}` : '');
  }

  // ---- King / Hand announcements: the new player's banner replaces the old one ----
  const announceKey = () => `warOfWesterosAnnounced:${gameCode}`;
  let announced = { king: null, hand: null };
  let announcedFor = '';
  const announceQueue = [];
  let announceShowing = false;
  let announceTimer = null;
  function loadAnnounced() {
    if (announcedFor === gameCode) return;
    announcedFor = gameCode;
    try { announced = { king: null, hand: null, ...JSON.parse(localStorage.getItem(announceKey()) || '{}') }; } catch { announced = { king: null, hand: null }; }
  }
  function saveAnnounced() { try { localStorage.setItem(announceKey(), JSON.stringify(announced)); } catch { /* storage unavailable */ } }
  function roleSnapshot(person) {
    if (!person) return null;
    const player = state.players.find(p => p.id === person.id);
    return { id: person.id, name: person.username, houseId: player?.houseId || null };
  }
  function checkRoleChanges() {
    if (!state?.me || !gameCode) return;
    loadAnnounced();
    if (state.phase === 'LOBBY') {
      if (announced.king || announced.hand) { announced = { king: null, hand: null }; saveAnnounced(); }
      return;
    }
    if (!['ACTION', 'COURT', 'RESOLUTION'].includes(state.phase)) return;
    for (const role of ['king', 'hand']) {
      const next = roleSnapshot(state[role]);
      const prev = announced[role];
      if (!next || (prev && prev.id === next.id)) continue;
      announceQueue.push({ role, prev, next });
      announced[role] = next;
    }
    saveAnnounced();
    if (!announceShowing) showNextAnnouncement();
  }
  function announceBanner(snap, className) {
    const house = snap && state.houses.find(h => h.id === snap.houseId);
    return (house && houseBanner(house, `announce-banner ${className}`)) || `<span class="announce-banner announce-banner-empty ${className}" aria-hidden="true">?</span>`;
  }
  function showNextAnnouncement() {
    const item = announceQueue.shift();
    if (!item) { announceShowing = false; $('announceOverlay').hidden = true; return; }
    announceShowing = true;
    const isKing = item.role === 'king';
    const house = state.houses.find(h => h.id === item.next.houseId);
    $('announceEyebrow').textContent = item.prev ? (isKing ? 'A NEW KING' : 'A NEW HAND') : (isKing ? 'THE FIRST KING' : 'THE HAND OF THE KING');
    $('announceTitle').textContent = isKing ? 'The crown has a new bearer' : 'The King has a new Hand';
    $('announceStage').innerHTML = `${item.prev ? announceBanner(item.prev, 'ann-old') : ''}${announceBanner(item.next, item.prev ? 'ann-new' : 'ann-new ann-first')}`;
    $('announceStage').classList.toggle('has-old', Boolean(item.prev));
    $('announceName').innerHTML = `<strong>${escapeHtml(item.next.name)}</strong>${house ? `<span>House ${escapeHtml(house.name)}</span>` : ''}`;
    $('announceOverlay').hidden = false;
    clearTimeout(announceTimer);
    announceTimer = setTimeout(closeAnnouncement, item.prev ? 7000 : 5500);
  }
  function closeAnnouncement() {
    clearTimeout(announceTimer);
    $('announceOverlay').hidden = true;
    setTimeout(showNextAnnouncement, 350);
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
    checkRoleChanges();
    if (state.phase === 'HAND_SELECTION') {
      renderKingSelection();
      updateRoundPill();
      return;
    }
    renderPhase();
    renderPlayers();
    renderRoundOverview();
    renderRoundActions();
    renderAlliances();
    renderChat();
    renderEvents();
    renderHub();

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
      if (state?.me) changingLobbyHouse = false;
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
  $('lobbyNameForm').addEventListener('submit', event => {
    event.preventDefault();
    const username = $('lobbyNameInput').value.trim();
    if (!socket?.connected) return showToast('Not connected to the game server yet.', 'error');
    socket.emit('edit-player-name', { username }, result => {
      if (!result?.ok) return showToast(result?.message || 'Could not update your name.', 'error');
      $('lobbyNameDialog').close();
      showToast(result.message || 'Name updated.', 'success');
    });
  });

  $('botEditForm').addEventListener('submit', event => {
    event.preventDefault();
    if (!socket?.connected) return showToast('Not connected to the game server yet.', 'error');
    socket.emit('edit-bot', { botId: editingBotId, username: $('botNameInput').value.trim(), houseId: $('botHouseSelect').value }, result => {
      if (!result?.ok) return showToast(result?.message || 'Could not update the bot.', 'error');
      $('botEditDialog').close();
      showToast(result.message || 'Bot updated.', 'success');
    });
  });
  // Clicking the dimmed backdrop closes the map.
  $('mapDialog').addEventListener('click', event => {
    if (event.target === event.currentTarget) return setMapOpen(false);
    // Tap a capital to pop it out on touch screens; tapping elsewhere puts it back.
    const cap = event.target.closest('.map-cap');
    $('mapDialog').querySelectorAll('.map-cap.is-active').forEach(el => { if (el !== cap) el.classList.remove('is-active'); });
    if (cap) { cap.classList.toggle('is-active'); cap.parentNode.appendChild(cap); }
  });
  // Keep the hovered capital on top of its neighbours.
  $('mapDialog').addEventListener('pointerover', event => {
    const cap = event.target.closest('.map-cap');
    if (cap && cap.parentNode.lastElementChild !== cap) cap.parentNode.appendChild(cap);
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !$('mapDialog').open) closeHub();
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
    if (action === 'edit-player') {
      if (document.body.classList.contains('mobile-device')) $('lobbyEditMenu').showModal();
      else if (button.dataset.editKind === 'house') openHouseChooser();
      else openNameEditor();
      return;
    }
    if (action === 'edit-menu-name') { openNameEditor(); return; }
    if (action === 'edit-menu-house') { openHouseChooser(); return; }
    if (action === 'close-edit-menu') { $('lobbyEditMenu').close(); return; }
    if (action === 'close-name-dialog') { $('lobbyNameDialog').close(); return; }
    if (action === 'add-bot') { emitAction('add-bot'); return; }
    if (action === 'edit-bot') { openBotEditor(button.dataset.botId); return; }
    if (action === 'remove-bot') { removeBot(button.dataset.botId); return; }
    if (action === 'remove-bot-dialog') { $('botEditDialog').close(); removeBot(editingBotId); return; }
    if (action === 'close-bot-dialog') { $('botEditDialog').close(); return; }
    if (action === 'open-hub') { openHub(button.dataset.hub); return; }
    if (action === 'close-hub') { closeHub(); return; }
    if (action === 'close-announce') { closeAnnouncement(); return; }
    if (action === 'toggle-traitor') { emitAction('mark-traitor', { playerId: button.dataset.playerId, traitor: button.dataset.traitor === 'true' }); return; }
    if (action === 'open-map') { setMapOpen(true); return; }
    if (action === 'close-map') { setMapOpen(false); return; }
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
