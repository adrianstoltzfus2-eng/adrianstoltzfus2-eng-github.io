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

  function emitAction(eventName, payload = {}, onOk) {
    if (!socket?.connected) {
      showToast('Not connected to the game server yet.', 'error');
      return;
    }
    socket.emit(eventName, payload, result => {
      if (!result?.ok) showToast(result?.message || 'Action failed.', 'error');
      else {
        if (result.message) showToast(result.message, 'success');
        if (onOk) onOk(result);
      }
    });
  }

  // ---- Locked buttons stay tappable: tapping one explains why it is locked ----
  function lock(el, reason) {
    if (!el) return;
    el.disabled = false;
    el.classList.toggle('is-locked', Boolean(reason));
    if (reason) { el.dataset.lockReason = reason; el.setAttribute('aria-disabled', 'true'); }
    else { delete el.dataset.lockReason; el.removeAttribute('aria-disabled'); }
  }
  const lockAttr = reason => (reason ? ` data-lock-reason="${escapeHtml(reason)}"` : '');
  document.addEventListener('click', event => {
    const locked = event.target.closest?.('.is-locked');
    if (!locked) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    showToast(locked.dataset.lockReason || 'That is not available right now.', 'error');
  }, true);
  document.addEventListener('submit', event => {
    const locked = event.target.querySelector?.('button.is-locked');
    if (!locked) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    showToast(locked.dataset.lockReason || 'That is not available right now.', 'error');
  }, true);

  // ---- The whole interface wears your house colour ----
  function applyTheme() {
    const house = state?.me?.houseId ? state.houses.find(h => h.id === state.me.houseId) : null;
    document.body.classList.toggle('house-themed', Boolean(house));
    if (house?.color) document.body.style.setProperty('--accent', house.color);
    else document.body.style.removeProperty('--accent');
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
    lock(document.querySelector('[data-action="edit-menu-house"]'), lobbyCanChangeHouse ? '' : 'There are no other houses available right now.');
    const houseRank = id => { const i = state.houses.findIndex(h => h.id === id); return i < 0 ? state.houses.length : i; };
    const lobbyOrder = [...state.players].sort((a, b) => houseRank(a.houseId) - houseRank(b.houseId));
    $('lobbyRoster').innerHTML = lobbyOrder.length ? lobbyOrder.map(p => {
      const house = state.houses.find(h => h.id === p.houseId);
      const banner = house ? houseBanner(house, 'player-house-banner') : '<span class="player-house-banner player-house-pending" aria-hidden="true">?</span>';
      const status = p.isBot ? 'Bot player' : p.left ? 'Left the game' : p.connected ? 'Connected' : 'Reconnecting';
      const own = p.id === state.me.id;
      const houseControl = own ? `<button class="lobby-banner-button ${lobbyCanChangeHouse ? '' : 'is-locked'}" type="button" data-action="edit-player" data-edit-kind="house" aria-label="Change your house"${lockAttr(lobbyCanChangeHouse ? '' : 'There are no other houses available right now.')}>${banner}</button>` : banner;
      const nameEdit = own ? '<button class="player-edit-name" type="button" data-action="edit-player" data-edit-kind="name" aria-label="Edit your name">✎</button>' : '';
      const botControls = p.isBot && state.isHost && state.phase === 'LOBBY' ? `<button class="player-edit-name" type="button" data-action="edit-bot" data-bot-id="${escapeHtml(p.id)}" aria-label="Edit ${escapeHtml(p.username)}">✎</button><button class="player-edit-name player-remove-bot" type="button" data-action="remove-bot" data-bot-id="${escapeHtml(p.id)}" aria-label="Remove ${escapeHtml(p.username)}">✕</button>` : '';
      return `<div class="player-row ${p.left ? 'player-left' : ''} ${own ? 'player-row-own' : ''}" ${own && house?.color ? `style="--house-color:${escapeHtml(house.color)}"` : ''}><span class="online-dot ${p.connected && !p.left ? 'online' : ''} ${p.isBot ? 'bot-dot' : ''}"></span>${houseControl}<div class="player-row-info"><strong>${escapeHtml(p.username)}${p.isBot ? ' <em class="bot-tag">BOT</em>' : ''}${p.id === state.hostId ? ' <em class="host-tag">SERVER OWNER</em>' : ''}${nameEdit}${botControls}</strong><small>${house ? `House ${escapeHtml(house.name)}` : 'Joining · house not chosen'} · ${status}</small></div></div>`;
    }).join('') : '<p class="muted">The hall is quiet. Be the first to join.</p>';
    const canStart = state.isHost && state.phase === 'LOBBY';
    const hasBaratheon = state.players.some(p => p.connected && p.houseId === 'baratheon');
    const canAddBot = canStart && activePlayers.length < Number(setup.maxPlayers);
    $('addBotButton').hidden = !canStart;
    lock($('addBotButton'), canAddBot ? '' : 'The hall is full. Raise the player limit or remove someone first.');
    $('startGameButton').hidden = !canStart;
    const connectedPlayers = activePlayers.filter(p => p.connected);
    const hasMinor = connectedPlayers.some(p => state.houses.find(h => h.id === p.houseId)?.type === 'minor');
    const thinMajors = hasMinor ? state.houses.filter(h => h.type === 'major' && connectedPlayers.filter(p => p.houseId === h.id).length < 2).map(h => h.name) : [];
    lock($('startGameButton'), !canStart ? '' : !hasBaratheon ? 'A connected player or bot must join House Baratheon first, so the crown has someone to claim it.' : connectedPlayers.length < 2 ? 'At least 2 connected players are needed to begin.' : thinMajors.length ? `With minor houses in play, every major house needs at least 2 players. Still short: ${thinMajors.map(capName).join(', ')}.` : '');
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
    lock($('handSelectionForm').querySelector('button'), 'Choose a player to appoint first.');
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
    lock($('voteForm').querySelector('button'), candidateSelect.disabled ? (state.me?.vote ? 'Your vote has already been cast.' : 'There is no candidate to vote for yet.') : '');
  }

  // ---- War: the target is chosen on the map ----
  let warTargetId = null;
  let pickingTarget = false;
  const capName = text => String(text || '').replace(/^\w/, c => c.toUpperCase());
  const diploOpen = () => state?.phase === 'ACTION' || state?.phase === 'COURT';
  const alliesOf = houseId => (state?.alliances || []).filter(a => a.houseA === houseId || a.houseB === houseId).map(a => (a.houseA === houseId ? a.houseB : a.houseA));

  function warTargetProblem(capital) {
    const mine = state.myHouse;
    if (capital.contested) return `${capital.name} is contested between two victorious allies. Wait until they settle who rules it.`;
    if (!capital.ownerHouseId || capital.ownerHouseId === mine.id) return `${capital.name} is already yours.`;
    if (alliesOf(mine.id).includes(capital.ownerHouseId)) return `${capital.name} belongs to your ally, House ${capName(prettyHouse(capital.ownerHouseId))}. Break the alliance before marching on it.`;
    return '';
  }
  function warBlockReason() {
    const h = state?.myHouse;
    if (!h) return 'Choose a house first.';
    if (state.round < 2) return 'Wars cannot begin until Round 2. Round 1 is for building and scheming.';
    if (state.phase !== 'ACTION') return 'War is declared during the action phase. Wait for the next round to begin.';
    if (h.pendingAttack) return 'Your house has already committed an army to a war that has not resolved yet.';
    if (h.hasAttackedThisRound) return 'Your house is already committed to a war this round.';
    if (!state.capitals.some(c => !warTargetProblem(c))) return 'There is no capital you can attack right now.';
    return '';
  }
  function attackLockReason() {
    const block = warBlockReason();
    if (block) return block;
    if (!warTargetId) return 'Choose a target capital on the map first.';
    const h = state.myHouse;
    const inf = Number($('attackInfantry').value), nav = Number($('attackNavy').value), dr = Number($('attackDragons').value);
    if ([inf, nav, dr].some(n => !Number.isInteger(n) || n < 0)) return 'Units to send must be whole numbers, zero or more.';
    if (inf + nav + dr < 1) return 'Commit at least one unit to the war.';
    if (inf > h.infantry || nav > h.navy || dr > h.dragons) return `You only have ${h.infantry} infantry, ${h.navy} ships and ${h.dragons} dragons to send.`;
    return '';
  }
  function updateAttackLock() {
    if (!state?.myHouse) return;
    lock($('attackForm').querySelector('button[type="submit"]'), attackLockReason());
    lock($('pickTargetButton'), warBlockReason());
    lock(document.querySelector('[data-action="go-to-war"]'), warBlockReason());
  }
  function renderWarTarget() {
    const c = state.capitals.find(x => x.id === warTargetId);
    const box = $('warTargetBox');
    box.classList.toggle('is-empty', !c);
    box.innerHTML = c ? `${escapeHtml(c.name)}<small>${escapeHtml(c.region)} · House ${escapeHtml(capName(prettyHouse(c.ownerHouseId)))}</small>` : 'No target chosen yet';
    $('pickTargetButton').textContent = c ? '🗺 Change target on the map' : '🗺 Choose target on the map';
  }

  // Map: owner colours, contested capitals, and target picking.
  const normName = text => String(text || '').toLowerCase().replace(/[^a-z]/g, '');
  function renderMap() {
    if (!state?.capitals) return;
    const byName = new Map(state.capitals.map(c => [normName(c.name), c]));
    $('mapDialog').querySelectorAll('.map-cap').forEach(el => {
      const label = el.querySelector('.cap-name');
      const cap = label ? byName.get(normName(label.textContent)) : null;
      if (!cap) return;
      const owner = state.houses.find(h => h.id === cap.ownerHouseId);
      el.dataset.capital = cap.id;
      el.style.setProperty('--cap-color', owner?.color || '#7d2a14');
      el.classList.toggle('is-contested', Boolean(cap.contested));
      const sub = el.querySelector('.cap-sub');
      if (sub) sub.textContent = cap.contested ? 'Contested' : owner ? `House ${capName(owner.name)}` : '';
      el.classList.toggle('is-target', pickingTarget && state.myHouse && !warTargetProblem(cap));
    });
  }
  function showMapHint(text) {
    const hint = $('mapHint');
    hint.textContent = text || '';
    hint.hidden = !text;
  }
  function startPick() {
    pickingTarget = true;
    $('mapDialog').classList.add('pick-mode');
    showMapHint('Tap the capital you wish to attack. Highlighted capitals can be targeted.');
    renderMap();
    setMapOpen(true);
  }
  function endPick() {
    if (!pickingTarget && !$('mapDialog').classList.contains('pick-mode')) return;
    pickingTarget = false;
    $('mapDialog').classList.remove('pick-mode');
    showMapHint('');
    if (state) renderMap();
  }

  function renderRoundActions() {
    const house = state.myHouse;
    $('infantryCostLabel').textContent = house.infantryCost;
    $('navyCostLabel').textContent = house.navyCost;
    $('spyTarget').innerHTML = state.houses.filter(h => h.id !== house.id).map(h => `<option value="${escapeHtml(h.id)}">${escapeHtml(h.name)}</option>`).join('');
    $('attackAlly').innerHTML = '<option value="">No ally — march alone</option>' + alliesOf(house.id).map(id => `<option value="${escapeHtml(id)}">House ${escapeHtml(capName(prettyHouse(id)))}</option>`).join('');
    $('attackInfantry').max = house.infantry;
    $('attackNavy').max = house.navy;
    $('attackDragons').max = house.dragons;
    $('attackDragons').disabled = house.dragons === 0;
    $('attackForm').hidden = false;
    const target = state.capitals.find(c => c.id === warTargetId);
    if (!target || warTargetProblem(target)) warTargetId = null;
    renderWarTarget();
    const ally = house.pendingAttack?.ally;
    const allyNote = !ally ? '' : ally.status === 'joined' ? ` House ${capName(prettyHouse(ally.houseId))} marches with you (${ally.units.infantry + ally.units.navy + ally.units.dragons} units).` : ally.status === 'declined' ? ` House ${capName(prettyHouse(ally.houseId))} declined to march.` : ` Waiting for House ${capName(prettyHouse(ally.houseId))} to answer your call.`;
    $('attackOrderStatus').textContent = state.round < 2 ? 'Attacks unlock after Round 1.' : house.pendingAttack ? `Committed against ${house.pendingAttack.targetName}; resolves after Round ${house.pendingAttack.resolveRound}.${allyNote}` : house.hasAttackedThisRound ? 'Your house is already committed to a war this round.' : 'The target and committed forces stay secret until the attack resolves. A winning pair of allies split the plunder.';
    updateAttackLock();
    updateRecruitButton();
    const spyReason = state.phase !== 'ACTION' ? 'Spies can only be sent during the action phase.' : state.me.lastSpyRound === state.round ? 'You have already sent spies this round.' : house.money < 8 ? `A spy mission costs 8 gold, but your house only has ${house.money}.` : '';
    lock($('spyForm').querySelector('button'), spyReason);
    $('spyReports').innerHTML = state.spyReports.length ? `<div class="subsection-title">Your intelligence reports</div>${state.spyReports.map(r => r.success ? `<article class="spy-report"><div><b>${escapeHtml(r.targetName)}</b><span>Round ${r.round} · successful</span></div><p>${r.infantry} infantry · ${r.navy} ships · ${r.dragons} dragons</p>${r.pendingTarget ? `<small>Possible planned attack: ${escapeHtml(r.pendingTarget)}</small>` : '<small>No pending attack seen.</small>'}</article>` : `<article class="spy-report spy-failed"><div><b>${escapeHtml(r.targetName)}</b><span>Round ${r.round} · failed</span></div><p>Your agents returned without reliable force estimates.</p></article>`).join('')}` : '';
  }

  function updateRecruitButton() {
    const button = $('recruitForm')?.querySelector('button');
    if (!button) return;
    const house = state?.myHouse;
    if (!house) return lock(button, 'Choose a house first.');
    const unit = $('unitSelect').value;
    const amount = Number($('unitAmount').value);
    const cost = unit === 'navy' ? house.navyCost : house.infantryCost;
    lock(button, state.phase !== 'ACTION' ? 'Recruiting is only possible during the action phase.'
      : house.lockedByEmbargo ? 'A royal embargo blocks your recruitment this round.'
      : !Number.isInteger(amount) || amount < 1 || amount > 10 ? 'Choose a whole number of units between 1 and 10.'
      : cost * amount > house.money ? `That costs ${cost * amount} gold, but your house only has ${house.money}.` : '');
  }

  function renderRoundOverview() {
    const house = state.myHouse;
    $('roundGold').textContent = house ? house.money : '—';
    const total = house ? house.infantry + house.navy + house.dragons : null;
    $('roundMilitaryTotal').textContent = total === null ? '—' : total;
    $('headerArmy').title = house ? `${house.infantry} infantry · ${house.navy} navy · ${house.dragons} dragons` : 'Forces unavailable';
    // King / Hand icons only appear for the player who holds that role.
    const myDef = state.houses.find(item => item.id === state.me?.houseId);
    const banner = $('headerBanner');
    if (banner.dataset.house !== (myDef?.id || '')) {
      banner.dataset.house = myDef?.id || '';
      banner.innerHTML = myDef ? houseBanner(myDef, 'hs-banner-art') : '';
    }
    banner.hidden = !myDef;
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

  const goodsMarkup = t => {
    const parts = [];
    if (t.gold) parts.push(`${t.gold} gold`);
    if (t.infantry) parts.push(`${t.infantry} infantry`);
    if (t.navy) parts.push(`${t.navy} ships`);
    return parts.length ? `<div class="treaty-goods">${parts.map(x => `<span>${escapeHtml(x)}</span>`).join('')}</div>` : '';
  };
  const houseColor = id => state.houses.find(h => h.id === id)?.color || '#c8a86c';
  const TREATY_STATUS = { accepted: 'Accepted', declined: 'Declined', cancelled: 'Withdrawn' };

  function renderAlliances() {
    const mine = state.myHouse;
    const myId = mine?.id;
    const open = diploOpen();
    const allied = new Set(alliesOf(myId));
    const offers = state.allianceOffers || [];
    const alliances = state.alliances || [];
    const withPlayers = state.houses.filter(h => h.id !== myId && h.players.length > 0);
    const proposable = withPlayers.filter(h => !allied.has(h.id) && !offers.some(o => (o.fromHouseId === myId && o.toHouseId === h.id) || (o.fromHouseId === h.id && o.toHouseId === myId)));
    $('allianceTarget').innerHTML = proposable.map(h => `<option value="${escapeHtml(h.id)}">House ${escapeHtml(capName(h.name))}</option>`).join('');
    $('treatyTarget').innerHTML = withPlayers.map(h => `<option value="${escapeHtml(h.id)}">House ${escapeHtml(capName(h.name))}${allied.has(h.id) ? ' · ally' : ''}</option>`).join('');
    $('commandTarget').innerHTML = state.houses.filter(h => h.id !== myId).map(h => `<option value="${escapeHtml(h.id)}">${escapeHtml(h.name)}</option>`).join('');
    const closedMsg = 'Diplomacy is open during the action and court phases.';
    lock($('allianceForm').querySelector('button'), !mine ? 'Choose a house first.' : !open ? closedMsg : !withPlayers.length ? 'No other house has a player yet.' : !proposable.length ? 'Every house with a player is already your ally or has a pending offer.' : '');
    lock($('treatyForm').querySelector('button'), !mine ? 'Choose a house first.' : !open ? closedMsg : !withPlayers.length ? 'No other house has a player yet.' : '');
    // Royal commands exist only for the king.
    $('commandForm').hidden = !state.isKing;
    lock($('commandForm').querySelector('button'), !state.isKing ? '' : state.phase !== 'COURT' ? 'Royal commands can only be issued during court.' : mine?.commandUsedRound === state.round ? 'You have already used your royal command this round.' : '');
    $('commandSelect').disabled = !state.isKing;
    $('commandTarget').disabled = !state.isKing || $('commandSelect').value !== 'embargo';
    $('kingBadge').textContent = state.king ? `King: ${state.king.username}` : 'No king';

    let markup = '';
    markup += offers.map(o => `<div class="alliance-row offer-row"><div><strong>${o.isOutgoing ? `Offer to House ${escapeHtml(capName(prettyHouse(o.toHouseId)))}` : `Offer from House ${escapeHtml(capName(prettyHouse(o.fromHouseId)))}`}</strong><small>${o.scope === 'secret' ? 'Secret offer' : 'Public offer'} · Round ${o.round}</small></div><div class="alliance-row-actions">${o.canRespond ? `<button class="button button-primary button-small ${open ? '' : 'is-locked'}" data-action="respond-alliance" data-offer-id="${escapeHtml(o.id)}" data-accept="true"${lockAttr(open ? '' : closedMsg)}>Accept</button><button class="button button-quiet button-small ${open ? '' : 'is-locked'}" data-action="respond-alliance" data-offer-id="${escapeHtml(o.id)}" data-accept="false"${lockAttr(open ? '' : closedMsg)}>Decline</button>` : '<span class="subtle-label">Awaiting reply</span>'}</div></div>`).join('');
    markup += alliances.map(a => `<div class="alliance-row"><div><strong>${escapeHtml(capName(prettyHouse(a.houseA)))} <span class="alliance-link">↔</span> ${escapeHtml(capName(prettyHouse(a.houseB)))}</strong><small>${a.scope === 'secret' ? 'Secret alliance' : 'Public alliance'} · since Round ${a.createdRound}</small></div>${mine && (a.houseA === myId || a.houseB === myId) ? `<button class="button button-quiet button-small ${open ? '' : 'is-locked'}" data-action="break-alliance" data-alliance-id="${escapeHtml(a.id)}"${lockAttr(open ? '' : closedMsg)}><img class="button-icon" src="./assets/game-chain.png?v=2" alt="">Break</button>` : ''}</div>`).join('');
    $('allianceList').innerHTML = markup || '<p class="muted small-text">No alliances or alliance offers yet.</p>';

    const treaties = [...(state.treaties || [])].sort((a, b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1)).slice(0, 14);
    $('treatyList').innerHTML = treaties.map(t => {
      const otherId = t.isOutgoing ? t.toHouseId : t.fromHouseId;
      const pending = t.status === 'pending';
      const label = pending ? (t.isOutgoing ? 'Awaiting reply' : 'Awaiting your answer') : TREATY_STATUS[t.status] || t.status;
      const actions = pending ? (t.isOutgoing
        ? `<button class="button button-quiet button-small" data-action="cancel-treaty" data-treaty-id="${escapeHtml(t.id)}">Withdraw</button>`
        : `<button class="button button-primary button-small ${open ? '' : 'is-locked'}" data-action="respond-treaty" data-treaty-id="${escapeHtml(t.id)}" data-accept="true"${lockAttr(open ? '' : closedMsg)}>Accept</button><button class="button button-quiet button-small ${open ? '' : 'is-locked'}" data-action="respond-treaty" data-treaty-id="${escapeHtml(t.id)}" data-accept="false"${lockAttr(open ? '' : closedMsg)}>Decline</button>`) : '';
      return `<article class="treaty-card" style="--house-color:${escapeHtml(houseColor(otherId))}"><header><strong>${t.isOutgoing ? 'To' : 'From'} House ${escapeHtml(capName(prettyHouse(otherId)))}${allied.has(otherId) ? ' · ally' : ''}</strong><span class="treaty-status is-${escapeHtml(t.status)}">${escapeHtml(label)}</span></header>${goodsMarkup(t)}${t.message ? `<p class="treaty-note">“${escapeHtml(t.message)}”</p>` : ''}<small>Round ${t.round}</small>${actions ? `<div class="treaty-actions">${actions}</div>` : ''}</article>`;
    }).join('') || '<p class="muted small-text">No treaties yet. Send one to an ally or to any other house.</p>';

    // War councils: invitations from allies, your own marching orders, and the spoils of won wars.
    let war = '';
    war += (state.warInvites || []).map(w => {
      const idp = `warJoin-${w.leaderHouseId}`;
      const leader = capName(prettyHouse(w.leaderHouseId));
      const startInf = Math.min(3, mine?.infantry || 0);
      return `<article class="treaty-card war-card" style="--house-color:${escapeHtml(houseColor(w.leaderHouseId))}"><header><strong>House ${escapeHtml(leader)} calls you to war</strong><span class="treaty-status">Target: ${escapeHtml(w.targetName)}</span></header><p class="treaty-note">They have committed ${w.units.infantry} infantry, ${w.units.navy} ships and ${w.units.dragons} dragons. Win together and you split the plunder, then agree who rules ${escapeHtml(w.targetName)} or fight for it. Resolves after Round ${w.resolveRound}.</p><div class="join-grid"><div><label for="${idp}-inf">Infantry</label><input id="${idp}-inf" type="number" min="0" value="${startInf}" inputmode="numeric"></div><div><label for="${idp}-nav">Ships</label><input id="${idp}-nav" type="number" min="0" value="0" inputmode="numeric"></div><div><label for="${idp}-dra">Dragons</label><input id="${idp}-dra" type="number" min="0" value="0" inputmode="numeric"></div></div><div class="treaty-actions"><button class="button button-danger button-small ${open ? '' : 'is-locked'}" data-action="join-war" data-leader="${escapeHtml(w.leaderHouseId)}"${lockAttr(open ? '' : closedMsg)}>March with them</button><button class="button button-quiet button-small ${open ? '' : 'is-locked'}" data-action="decline-war" data-leader="${escapeHtml(w.leaderHouseId)}"${lockAttr(open ? '' : closedMsg)}>Decline</button></div></article>`;
    }).join('');
    if (mine?.pendingAttack) {
      const pa = mine.pendingAttack;
      const note = !pa.ally ? 'You march alone.' : pa.ally.status === 'joined' ? `House ${capName(prettyHouse(pa.ally.houseId))} marches with you.` : pa.ally.status === 'declined' ? `House ${capName(prettyHouse(pa.ally.houseId))} declined.` : `Waiting for House ${capName(prettyHouse(pa.ally.houseId))} to answer.`;
      war += `<article class="treaty-card war-card"><header><strong>Your war on ${escapeHtml(pa.targetName)}</strong><span class="treaty-status">Resolves after Round ${pa.resolveRound}</span></header><p class="treaty-note">${escapeHtml(note)}</p></article>`;
    }
    war += (state.spoils || []).map(sp => {
      const other = sp.houseA === myId ? sp.houseB : sp.houseA;
      const nm = id => capName(prettyHouse(id));
      if (sp.status !== 'open') return `<article class="treaty-card war-card"><header><strong>${escapeHtml(sp.capitalName)}</strong><span class="treaty-status is-accepted">Settled</span></header><p class="treaty-note">Now ruled by House ${escapeHtml(nm(sp.winnerId))}.</p></article>`;
      const myClaim = sp.claims[myId], theirClaim = sp.claims[other];
      const claimBtn = id => `<button class="button button-secondary button-small ${myClaim === id ? 'is-mine' : ''}" data-action="claim-spoils" data-spoil-id="${escapeHtml(sp.id)}" data-claim="${escapeHtml(id)}">${myClaim === id ? '✓ ' : ''}House ${escapeHtml(nm(id))} rules</button>`;
      return `<article class="treaty-card war-card" style="--house-color:${escapeHtml(houseColor(other))}"><header><strong>Spoils: ${escapeHtml(sp.capitalName)}</strong><span class="treaty-status">Decide by the end of Round ${sp.deadlineRound} court</span></header><p class="treaty-note">You and House ${escapeHtml(nm(other))} won it together and split ${sp.plunder} gold of plunder. You must both name the same ruler, or you will fight each other for it.</p><small>Your choice: ${myClaim ? `House ${escapeHtml(nm(myClaim))}` : 'not chosen'} · Their choice: ${theirClaim ? `House ${escapeHtml(nm(theirClaim))}` : 'not chosen'}</small><div class="spoil-claims">${claimBtn(sp.houseA)}${claimBtn(sp.houseB)}</div></article>`;
    }).join('');
    $('warList').innerHTML = war || '<p class="muted small-text">No wars are being waged. Press “Go to war” to pick a target on the map.</p>';
  }

  const selectedRecipients = new Set();
  const chatOthers = () => (state?.players || []).filter(p => !p.left && !p.isBot && p.id !== state.me?.id);

  function messageMarkup(messages, isPrivate = false) {
    const myId = state.me?.id;
    return messages.map(m => {
      const house = state.houses.find(h => h.id === m.senderHouseId);
      const mine = m.senderId === myId;
      const to = isPrivate
        ? (m.targets || []).map(t => { const th = state.houses.find(h => h.id === t.houseId); return `<span class="msg-chip" style="--house-color:${escapeHtml(th?.color || '#c8a86c')}">${houseBanner(th, 'msg-banner msg-banner-sm')}${escapeHtml(t.id === myId ? 'You' : t.name)}</span>`; }).join('')
        : '<span class="msg-chip msg-chip-all">The whole court</span>';
      return `<article class="chat-message ${isPrivate ? 'chat-secret-message' : ''} ${mine ? 'chat-mine' : ''}" style="--house-color:${escapeHtml(house?.color || '#c8a86c')}"><div class="msg-head">${houseBanner(house, 'msg-banner')}<div class="msg-meta"><strong>${escapeHtml(mine ? 'You' : m.senderName)}</strong><span>House ${escapeHtml(m.senderHouseName || house?.name || '')} · R${m.round}</span></div></div><div class="msg-to"><em>to</em>${to}</div><p>${escapeHtml(m.message)}</p></article>`;
    }).join('') || '<p class="muted small-text chat-empty">No messages yet. Start the conversation.</p>';
  }

  function renderChat() {
    const logs = [$('publicChat'), $('secretChat')].map(el => [el, el.scrollHeight - el.scrollTop - el.clientHeight < 40]);
    $('publicChat').innerHTML = messageMarkup(state.publicMessages || []);
    $('secretChat').innerHTML = messageMarkup(state.privateMessages || [], true);
    logs.forEach(([el, atBottom]) => { if (atBottom) el.scrollTop = el.scrollHeight; });
    const isPrivate = activeChatTab === 'secret';
    $('publicChat').hidden = isPrivate;
    $('secretChat').hidden = !isPrivate;
    document.querySelectorAll('[data-chat-tab]').forEach(btn => btn.classList.toggle('active', btn.dataset.chatTab === activeChatTab));
    // Who a private message goes to: individual players, any number of them.
    const others = chatOthers();
    [...selectedRecipients].forEach(id => { if (!others.some(p => p.id === id)) selectedRecipients.delete(id); });
    $('chatRecipients').hidden = !isPrivate;
    $('recipientChips').innerHTML = others.length
      ? `<button type="button" class="recipient-chip recipient-all ${selectedRecipients.size === others.length ? 'selected' : ''}" data-recipient="__all">Everyone</button>${others.map(p => {
        const house = state.houses.find(item => item.id === p.houseId);
        const on = selectedRecipients.has(p.id);
        return `<button type="button" class="recipient-chip ${on ? 'selected' : ''}" data-recipient="${escapeHtml(p.id)}" aria-pressed="${on}" style="--house-color:${escapeHtml(house?.color || '#c8a86c')}">${houseBanner(house, 'msg-banner msg-banner-sm')}<span>${escapeHtml(p.username)}</span></button>`;
      }).join('')}`
      : '<p class="muted small-text">No other players are at court yet.</p>';
    $('chatMessage').disabled = !state.myHouse;
    lock($('chatForm').querySelector('button'), state.myHouse ? '' : 'Choose a house before you speak at court.');
    $('chatMessage').placeholder = isPrivate ? 'Whisper to the chosen players…' : 'Speak before the court…';
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
    markHubSeen(currentHub);
    $('hubOverlay').hidden = true;
    currentHub = null;
    document.body.classList.remove('hub-open');
    updateBadges();
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
    const waiting = (state.allianceOffers || []).filter(o => o.canRespond).length + (state.treaties || []).filter(t => t.status === 'pending' && !t.isOutgoing).length + (state.warInvites || []).length;
    const total = h.infantry + h.navy + h.dragons;
    // Hub buttons (details are hidden on phones)
    $('hubMoneyGold').textContent = `${h.money} gold`;
    $('hubMoneyIncome').textContent = `+${h.incomePerRound} gold each round`;
    $('hubMoneyCapitals').textContent = plural(h.capitalCount, 'capital') + ' held';
    $('hubRelAlliances').textContent = plural(myAlliances, 'alliance');
    $('hubRelOffers').textContent = waiting ? `${plural(waiting, 'offer')} awaiting your reply` : 'No offers waiting';
    $('hubRelRole').textContent = state.isKing ? 'You wear the crown — traitors & taxes' : 'Alliances, treaties & messages';
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
    $('battleReports').innerHTML = (state.events || []).filter(e => e.kind === 'battle').map(e => `<div class="resolution-item"><span>R${e.round}</span><p>${escapeHtml(e.text)}</p></div>`).join('') || '<p class="muted small-text">No battles have been fought yet.</p>';
    $('armyPhaseNote').textContent = state.phase === 'ACTION' ? '' : 'Recruiting, spying and declaring war open during the action phase.';
    $('relationsPhaseNote').textContent = diploOpen() ? (state.isKing && state.phase !== 'COURT' ? 'Royal decrees open during the court phase.' : '') : 'Alliances, treaties and war councils open during the action and court phases. Messages can be sent at any time.';
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

  // ---- Notification badges: on the three hub buttons, and on the exact box inside each menu ----
  const seenNotes = { ready: false, pub: new Set(), sec: new Set(), offers: new Set(), treaties: new Set(), war: new Set(), battles: new Set(), gold: 0 };
  let currentHub = null;
  const markSeen = (set, list) => list.forEach(item => set.add(item.id));
  function noteLists() {
    const me = state.me.id;
    return {
      pub: (state.publicMessages || []).filter(m => m.senderId !== me),
      sec: (state.privateMessages || []).filter(m => m.senderId !== me),
      offers: (state.allianceOffers || []).filter(o => o.canRespond),
      treaties: (state.treaties || []).filter(t => t.status === 'pending' && !t.isOutgoing),
      war: [...(state.warInvites || []).map(w => ({ id: `${w.leaderHouseId}:${w.resolveRound}` })), ...(state.spoils || []).filter(x => x.status === 'open').map(x => ({ id: x.id }))],
      battles: (state.events || []).filter(e => e.kind === 'battle')
    };
  }
  function setBadge(id, text) {
    const el = $(id);
    if (!el) return;
    const previous = el.hidden ? '' : el.textContent;
    el.hidden = !text;
    el.textContent = text || '';
    if (text && text !== previous) { el.classList.remove('badge-pop'); void el.offsetWidth; el.classList.add('badge-pop'); }
  }
  // Boxes inside a menu keep their badge while you are in it; they count as seen when you close the menu.
  function markHubSeen(kind) {
    const h = state?.myHouse;
    if (!h || !state.me || !kind) return;
    const n = noteLists();
    if (kind === 'relations') { markSeen(seenNotes.offers, n.offers); markSeen(seenNotes.treaties, n.treaties); markSeen(seenNotes.war, n.war); markSeen(seenNotes.pub, activeChatTab === 'public' ? n.pub : []); markSeen(seenNotes.sec, activeChatTab === 'secret' ? n.sec : []); }
    if (kind === 'army') markSeen(seenNotes.battles, n.battles);
    if (kind === 'money') seenNotes.gold = h.money;
  }
  function updateBadges() {
    const h = state?.myHouse;
    if (!h || !state.me) return;
    const n = noteLists();
    if (!seenNotes.ready) {
      markSeen(seenNotes.pub, n.pub); markSeen(seenNotes.sec, n.sec); markSeen(seenNotes.offers, n.offers); markSeen(seenNotes.treaties, n.treaties); markSeen(seenNotes.war, n.war); markSeen(seenNotes.battles, n.battles);
      seenNotes.gold = h.money;
      seenNotes.ready = true;
    }
    // The chat tab you are reading counts as seen straight away.
    if (currentHub === 'relations') markSeen(activeChatTab === 'public' ? seenNotes.pub : seenNotes.sec, activeChatTab === 'public' ? n.pub : n.sec);
    if (h.money < seenNotes.gold) seenNotes.gold = h.money;
    const count = (list, set) => list.filter(item => !set.has(item.id)).length;
    const unPub = count(n.pub, seenNotes.pub), unSec = count(n.sec, seenNotes.sec), unOffers = count(n.offers, seenNotes.offers), unTreaties = count(n.treaties, seenNotes.treaties), unWar = count(n.war, seenNotes.war), unBattles = count(n.battles, seenNotes.battles);
    const gain = Math.max(0, h.money - seenNotes.gold);
    const text = value => (value ? String(Math.min(value, 99)) : '');
    setBadge('badgeRelations', text(unPub + unSec + unOffers + unTreaties + unWar));
    setBadge('badgeArmy', text(unBattles));
    setBadge('badgeMoney', gain ? `+${gain}` : '');
    setBadge('badgeTabPublic', text(unPub));
    setBadge('badgeTabSecret', text(unSec));
    setBadge('badgeOffers', text(unOffers));
    setBadge('badgeTreaties', text(unTreaties));
    setBadge('badgeWar', text(unWar));
    setBadge('badgeBattles', text(unBattles));
    setBadge('badgeGold', gain ? `+${gain}` : '');
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
    applyTheme();
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
    renderMap();

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
    if (state.myHouse) updateAttackLock();
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
    lock($('handSelectionForm').querySelector('button'), event.target.value ? '' : 'Choose a player to appoint first.');
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
    if (pickingTarget) {
      const pick = event.target.closest('.map-cap');
      if (pick) {
        const capital = state.capitals.find(c => c.id === pick.dataset.capital);
        if (!capital) return showMapHint('The Red Keep and King’s Landing cannot be attacked. Choose a house capital.');
        const problem = warTargetProblem(capital);
        if (problem) return showMapHint(problem);
        warTargetId = capital.id;
        setMapOpen(false);
        renderWarTarget();
        updateAttackLock();
        $('attackForm').scrollIntoView({ block: 'center', behavior: 'smooth' });
        showToast(`Target chosen: ${capital.name}. Commit your forces and declare war.`, 'success');
        return;
      }
    }
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

  $('mapDialog').addEventListener('close', endPick);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !$('mapDialog').open) closeHub();
  });

  document.addEventListener('click', event => {
    const tab = event.target.closest('[data-chat-tab]');
    if (tab) {
      activeChatTab = tab.dataset.chatTab;
      renderChat();
      const log = $(activeChatTab === 'public' ? 'publicChat' : 'secretChat');
      log.scrollTop = log.scrollHeight;
      updateBadges();
      return;
    }
    const chip = event.target.closest('[data-recipient]');
    if (chip) {
      const id = chip.dataset.recipient;
      const others = chatOthers();
      if (id === '__all') { if (selectedRecipients.size === others.length) selectedRecipients.clear(); else others.forEach(p => selectedRecipients.add(p.id)); }
      else if (selectedRecipients.has(id)) selectedRecipients.delete(id);
      else selectedRecipients.add(id);
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
    if (action === 'pick-target') { startPick(); return; }
    if (action === 'go-to-war') { openHub('army'); startPick(); return; }
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
    else if (action === 'respond-treaty') emitAction('respond-treaty', { treatyId: button.dataset.treatyId, accept: button.dataset.accept === 'true' });
    else if (action === 'cancel-treaty') emitAction('cancel-treaty', { treatyId: button.dataset.treatyId });
    else if (action === 'decline-war') emitAction('respond-war', { leaderHouseId: button.dataset.leader, accept: false });
    else if (action === 'join-war') {
      const idp = `warJoin-${button.dataset.leader}`;
      emitAction('respond-war', { leaderHouseId: button.dataset.leader, accept: true, infantry: Number($(`${idp}-inf`).value), navy: Number($(`${idp}-nav`).value), dragons: Number($(`${idp}-dra`).value) });
    }
    else if (action === 'claim-spoils') emitAction('claim-spoils', { spoilId: button.dataset.spoilId, claimHouseId: button.dataset.claim });
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
      targetCapitalId: warTargetId,
      allyHouseId: $('attackAlly').value || undefined,
      infantry: Number($('attackInfantry').value),
      navy: Number($('attackNavy').value),
      dragons: Number($('attackDragons').value)
    }, () => { warTargetId = null; });
  });
  ['attackInfantry', 'attackNavy', 'attackDragons'].forEach(id => $(id).addEventListener('input', updateAttackLock));

  $('treatyForm').addEventListener('submit', event => {
    event.preventDefault();
    emitAction('offer-treaty', {
      targetHouseId: $('treatyTarget').value,
      gold: Number($('treatyGold').value || 0),
      infantry: Number($('treatyInfantry').value || 0),
      navy: Number($('treatyNavy').value || 0),
      message: $('treatyMessage').value
    }, () => { $('treatyGold').value = 0; $('treatyInfantry').value = 0; $('treatyNavy').value = 0; $('treatyMessage').value = ''; });
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

  $('chatForm').addEventListener('submit', event => {
    event.preventDefault();
    const message = $('chatMessage').value.trim();
    if (!message) return;
    // The tab you are on decides the type: Public goes to the whole court, Private to the players you chose.
    const scope = activeChatTab === 'secret' ? 'secret' : 'public';
    if (scope === 'secret' && !selectedRecipients.size) return showToast('Choose at least one player to whisper to.', 'error');
    emitAction('send-chat', { scope, targetPlayerIds: [...selectedRecipients], message });
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
