(() => {
  'use strict';

  const SERVER_URL = window.GOT_CONFIG?.serverUrl || 'http://localhost:3000';
  const tokenKey = 'ironThroneClientToken';
  const usernameKey = 'ironThroneUsername';
  let clientToken = localStorage.getItem(tokenKey);
  if (!clientToken) {
    const makePart = () => (window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`);
    clientToken = `${makePart()}-${makePart()}`;
    localStorage.setItem(tokenKey, clientToken);
  }

  const $ = id => document.getElementById(id);
  const socket = window.io ? window.io(SERVER_URL, { autoConnect: true, reconnection: true, reconnectionAttempts: Infinity }) : null;
  let state = null;
  let activeChatTab = 'public';
  let toastTimer = null;

  const PHASES = {
    LOBBY: ['THE LOBBY', 'The Great Houses', 'Choose a house. The lobby host can begin the Great Council once everyone has joined a house.'],
    KING_VOTE: ['THE GREAT COUNCIL', 'Choose the king', 'Cast your vote. The lobby host closes the ballot; a tie triggers a runoff.'],
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
    return ({ LOBBY: 'LOBBY', KING_VOTE: 'KING VOTE', ACTION: `ROUND ${state?.round || 1} · ACTION`, COURT: `ROUND ${state?.round || 1} · COURT`, RESOLUTION: `ROUND ${state?.round || 1} · RESOLUTION` })[phase] || phase;
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

  function renderHouseRoster() {
    $('houseRoster').innerHTML = state.houses.map(h => {
      const members = h.players.length ? h.players.map(p => `<span class="member-dot ${p.connected ? '' : 'member-offline'}" title="${escapeHtml(p.username)}">${escapeHtml(p.username.slice(0, 1).toUpperCase())}</span>`).join('') : '<span class="empty-members">No players</span>';
      const capitals = h.capitalCount === 1 ? '1 capital' : `${h.capitalCount} capitals`;
      return `<div class="roster-house" style="--house-color:${escapeHtml(h.color)}">
        <span class="house-sigil">${escapeHtml(h.sigil)}</span>
        <div class="roster-house-info"><strong>${escapeHtml(h.name)}</strong><small>${escapeHtml(capitals)} · ${h.players.length} player${h.players.length === 1 ? '' : 's'}</small></div>
        <div class="member-stack">${members}</div>
      </div>`;
    }).join('');
  }

  function renderPlayers() {
    $('playerCount').textContent = `${state.players.length} player${state.players.length === 1 ? '' : 's'}`;
    $('playerRoster').innerHTML = state.players.length ? state.players.map(p => {
      const house = state.houses.find(h => h.id === p.houseId);
      return `<div class="player-row"><span class="online-dot ${p.connected ? 'online' : ''}"></span><div class="player-row-info"><strong>${escapeHtml(p.username)}${p.id === state.hostId ? ' <em class="host-tag">HOST</em>' : ''}${p.isKing ? ' <em class="king-tag">KING</em>' : ''}</strong><small>${house ? `${escapeHtml(house.sigil)} House ${escapeHtml(house.name)}` : 'No house chosen'}</small></div></div>`;
    }).join('') : '<p class="muted small-text">No players have joined yet.</p>';
    $('lobbyPlayerList').innerHTML = state.players.map(p => `<span class="mini-player ${p.houseId ? 'assigned' : ''}">${escapeHtml(p.username)}${p.houseId ? ` · ${escapeHtml(prettyHouse(p.houseId))}` : ''}</span>`).join('');
  }

  function renderHousePicker() {
    if (!state.me) return;
    const mine = state.me.houseId;
    $('housePicker').innerHTML = state.houses.map(h => {
      const minorTakenByOther = h.type === 'minor' && h.players.some(p => p.id !== state.me.id);
      const locked = h.type === 'minor' && !state.minorHousesUnlocked;
      const alreadyChosen = mine === h.id;
      const disabled = state.phase !== 'LOBBY' || locked || minorTakenByOther;
      let buttonText = alreadyChosen ? 'Your house ✓' : minorTakenByOther ? 'Claimed' : locked ? 'Unlocks at 7 players' : h.type === 'major' ? 'Join house' : 'Claim house';
      return `<article class="house-choice ${alreadyChosen ? 'house-choice-selected' : ''} ${disabled && !alreadyChosen ? 'house-choice-disabled' : ''}" style="--house-color:${escapeHtml(h.color)}">
        <div class="choice-top"><span class="choice-sigil">${escapeHtml(h.sigil)}</span><span class="house-type ${h.type}">${h.type === 'major' ? 'MAJOR' : 'MINOR'}</span></div>
        <h3>${escapeHtml(h.name)}</h3><p class="house-motto">${escapeHtml(h.motto)}</p>
        <div class="choice-capital"><span>CAPITAL</span><strong>${escapeHtml(h.capital)}</strong></div>
        <p class="house-buff"><b>BUFF</b> ${escapeHtml(h.buff)}</p>
        ${h.nerf ? `<p class="house-nerf"><b>NERF</b> ${escapeHtml(h.nerf)}</p>` : '<p class="house-nerf no-nerf"><b>NERF</b> None</p>'}
        <div class="choice-footer"><span>${h.players.length} player${h.players.length === 1 ? '' : 's'}</span><button class="button ${alreadyChosen ? 'button-selected' : 'button-secondary'}" type="button" data-action="select-house" data-house-id="${escapeHtml(h.id)}" ${disabled ? 'disabled' : ''}>${escapeHtml(buttonText)}</button></div>
      </article>`;
    }).join('');
    $('lobbyStatus').textContent = state.minorHousesUnlocked ? 'Minor houses are unlocked. Each minor house can be claimed by one player.' : `Minor houses unlock at 7 joined players (${state.players.length}/7).`;
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

  function renderCapitalBoard() {
    $('capitalBoard').innerHTML = state.capitals.map(c => {
      const owner = state.houses.find(h => h.id === c.ownerHouseId);
      const original = state.houses.find(h => h.id === c.originalHouseId);
      return `<article class="capital-card" style="--house-color:${escapeHtml(owner?.color || '#888')}" data-capital="${escapeHtml(c.id)}">
        <div class="capital-art"><span>${escapeHtml(c.icon)}</span><b>DEF ${escapeHtml(c.defense)}</b></div>
        <div class="capital-info"><h3>${escapeHtml(c.name)}</h3><small>${escapeHtml(c.region)}</small><div class="capital-owner"><span class="owner-swatch"></span><strong>House ${escapeHtml(owner?.name || 'Unknown')}</strong></div>
        ${owner?.id !== original?.id ? `<small class="occupied-note">Originally ${escapeHtml(original?.name || 'unknown')}</small>` : ''}</div>
      </article>`;
    }).join('');
  }

  function renderMyHouse() {
    const house = state.myHouse;
    if (!house) {
      $('myHouseTitle').textContent = 'Unclaimed';
      $('myHouseCard').innerHTML = '<p class="muted">Choose a house in the lobby to see your resources.</p>';
      $('myHouseSummary').innerHTML = '';
      return;
    }
    const def = state.houses.find(h => h.id === house.id);
    $('myHouseTitle').textContent = `House ${house.name}`;
    $('myHouseCard').innerHTML = `<div class="my-house-banner" style="--house-color:${escapeHtml(def?.color || '#888')}"><span>${escapeHtml(def?.sigil || '♜')}</span><div><strong>${escapeHtml(house.name)}</strong><small>${escapeHtml(def?.capital || '')}</small></div></div>
      <div class="my-house-stats"><div><span>GOLD</span><strong>◆ ${house.money}</strong></div><div><span>INFANTRY</span><strong>${house.infantry}</strong></div><div><span>NAVY</span><strong>${house.navy}</strong></div><div><span>DRAGONS</span><strong>${house.dragons}</strong></div></div>
      <div class="house-trait"><small>HOUSE BUFF</small><p>${escapeHtml(def?.buff || '')}</p></div>
      ${def?.nerf ? `<div class="house-trait trait-nerf"><small>HOUSE NERF</small><p>${escapeHtml(def.nerf)}</p></div>` : ''}
      ${house.pendingAttack ? `<div class="pending-attack"><small>SECRET ATTACK ORDER</small><strong>${escapeHtml(house.pendingAttack.targetName)}</strong><p>Ordered Round ${house.pendingAttack.orderedRound}; resolves after Round ${house.pendingAttack.resolveRound} court.</p><span>${house.pendingAttack.units.infantry} infantry · ${house.pendingAttack.units.navy} ships · ${house.pendingAttack.units.dragons} dragons committed</span></div>` : ''}
      ${house.lockedByEmbargo ? '<p class="warning-note">Royal embargo: recruitment is blocked this round.</p>' : ''}`;
    $('myHouseSummary').innerHTML = [
      ['GOLD', `◆ ${house.money}`, 'Your treasury'],
      ['INFANTRY', house.infantry, 'Available forces'],
      ['NAVY', house.navy, 'Available fleet'],
      ['DRAGONS', house.dragons, '5 strength each']
    ].map(([label, value, sub]) => `<div class="resource-tile"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(sub)}</small></div>`).join('');
    $('infantryCostLabel').textContent = house.infantryCost;
    $('navyCostLabel').textContent = house.navyCost;
    $('spyTarget').innerHTML = state.houses.filter(h => h.id !== house.id).map(h => `<option value="${escapeHtml(h.id)}">${escapeHtml(h.name)}</option>`).join('');
    $('attackTarget').innerHTML = state.capitals.filter(c => c.ownerHouseId !== house.id).map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)} · ${escapeHtml(prettyHouse(c.ownerHouseId))}</option>`).join('');
    $('attackInfantry').max = house.infantry;
    $('attackNavy').max = house.navy;
    $('attackDragons').max = house.dragons;
    $('attackDragons').disabled = house.dragons === 0;
    const attackLocked = state.phase !== 'ACTION' || state.round < 2 || Boolean(house.pendingAttack) || house.hasAttackedThisRound;
    $('attackForm').querySelector('button').disabled = attackLocked || !state.capitals.some(c => c.ownerHouseId !== house.id);
    $('attackOrderStatus').textContent = state.round < 2 ? 'Attacks unlock after Round 1.' : house.pendingAttack ? `Committed for resolution after Round ${house.pendingAttack.resolveRound}.` : house.hasAttackedThisRound ? 'Your house has already planned an attack this round.' : 'The target and committed forces remain secret until the attack resolves.';
    const recruitBlocked = state.phase !== 'ACTION' || house.lockedByEmbargo;
    $('recruitForm').querySelector('button').disabled = recruitBlocked;
    $('spyForm').querySelector('button').disabled = state.phase !== 'ACTION' || house.money < 8 || state.me.lastSpyRound === state.round;
    $('spyReports').innerHTML = state.spyReports.length ? `<div class="subsection-title">Your intelligence reports</div>${state.spyReports.map(r => r.success ? `<article class="spy-report"><div><b>${escapeHtml(r.targetName)}</b><span>Round ${r.round} · successful</span></div><p>${r.infantry} infantry · ${r.navy} ships · ${r.dragons} dragons</p>${r.pendingTarget ? `<small>Possible planned attack: ${escapeHtml(r.pendingTarget)}</small>` : '<small>No pending attack seen.</small>'}</article>` : `<article class="spy-report spy-failed"><div><b>${escapeHtml(r.targetName)}</b><span>Round ${r.round} · failed</span></div><p>Your agents returned without reliable force estimates.</p></article>`).join('')}` : '';
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
      markup += alliances.map(a => `<div class="alliance-row"><div><strong>${escapeHtml(prettyHouse(a.houseA))} <span class="alliance-link">↔</span> ${escapeHtml(prettyHouse(a.houseB))}</strong><small>${a.scope === 'secret' ? 'Secret alliance' : 'Public alliance'} · since Round ${a.createdRound}</small></div>${state.myHouse && (a.houseA === state.myHouse.id || a.houseB === state.myHouse.id) ? `<button class="button button-quiet button-small" data-action="break-alliance" data-alliance-id="${escapeHtml(a.id)}" ${state.phase !== 'COURT' ? 'disabled' : ''}>Break</button>` : ''}</div>`).join('');
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
    $('eventFeed').innerHTML = state.events.map(e => `<div class="event-item ${escapeHtml(e.kind)}"><span class="event-marker"></span><div><small>ROUND ${e.round}</small><p>${escapeHtml(e.text)}</p></div></div>`).join('') || '<p class="muted small-text">The chronicle is empty.</p>';
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
      const action = ({ LOBBY: ['start-election', 'Begin king election'], KING_VOTE: ['close-voting', 'Close the vote'], ACTION: ['advance-phase', 'Open the court →'], COURT: ['advance-phase', 'Resolve this round →'], RESOLUTION: ['advance-phase', `Begin Round ${state.round + 1} →`] })[state.phase];
      controls.innerHTML = `<span class="host-label">YOU ARE HOST</span><button class="button button-primary" data-action="${action[0]}">${action[1]}</button>`;
    } else {
      const message = state.phase === 'LOBBY' ? 'The host will start the election.' : state.phase === 'KING_VOTE' ? 'Waiting for the host to close the ballot.' : 'Waiting for the host to advance the phase.';
      controls.innerHTML = `<span class="waiting-label">${escapeHtml(message)}</span>`;
    }
    $('resetGameButton').hidden = !state.isHost;
  }

  function render() {
    if (!state) return;
    // Preserve all form selections and text while another player causes a shared-state update.
    const savedValues = {};
    document.querySelectorAll('input[id], select[id], textarea[id]').forEach(element => {
      savedValues[element.id] = element.value;
    });
    const wasFocused = document.activeElement?.id;
    const selectionStart = wasFocused && typeof document.activeElement.selectionStart === 'number' ? document.activeElement.selectionStart : null;

    const loggedIn = Boolean(state.me);
    $('loginScreen').hidden = loggedIn;
    $('gameScreen').hidden = !loggedIn;
    if (!loggedIn) return;

    renderPhase();
    renderHouseRoster();
    renderPlayers();
    renderHousePicker();
    if (state.phase === 'KING_VOTE') renderVotePanel();
    renderMyHouse();
    renderCapitalBoard();
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
    if (wasFocused) {
      const element = $(wasFocused);
      if (element && !element.disabled) {
        element.focus({ preventScroll: true });
        if (selectionStart !== null && element.setSelectionRange && element.type !== 'number') element.setSelectionRange(selectionStart, selectionStart);
      }
    }
  }

  if (!socket) {
    setConnection(false, 'Socket.IO failed to load');
    $('loginError').textContent = 'The realtime client library did not load. Check your internet connection or CDN access.';
  } else {
    socket.on('connect', () => {
      setConnection(true, 'Connected to server');
      socket.emit('request-state');
      const savedName = localStorage.getItem(usernameKey);
      if (savedName) socket.emit('login', { username: savedName, clientToken }, result => {
        if (!result?.ok) showToast(result?.message || 'Could not restore your session.', 'error');
      });
    });
    socket.on('disconnect', () => setConnection(false, 'Disconnected — reconnecting'));
    socket.on('connect_error', () => setConnection(false, 'Server unavailable'));
    socket.on('state', nextState => {
      state = nextState;
      render();
    });
  }

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
    if (action === 'select-house') emitAction('select-house', { houseId: button.dataset.houseId });
    else if (action === 'start-election') emitAction('start-election');
    else if (action === 'close-voting') emitAction('close-voting');
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

  $('resetGameButton').addEventListener('click', () => {
    if (window.confirm('Reset the entire temporary game? All houses, votes, alliances, and armies will reset.')) emitAction('reset-game');
  });

  $('logoutButton').addEventListener('click', () => {
    if (socket?.connected) socket.emit('logout-player', {}, () => {});
    localStorage.removeItem(usernameKey);
    localStorage.removeItem(tokenKey);
    state = state ? { ...state, me: null, myHouse: null } : null;
    render();
    $('usernameInput').value = '';
    // Prepare a fresh guest identity on this browser; the server keeps the old player slot disconnected.
    const makePart = () => (window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`);
    clientToken = `${makePart()}-${makePart()}`;
    localStorage.setItem(tokenKey, clientToken);
    showToast('Signed out in this browser.', 'normal');
  });
})();
