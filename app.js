const firebaseDatabase = firebase.database();
const ref = (parent, path) => typeof parent.ref === 'function' ? parent.ref(path) : parent.child(path);
const onValue = (target, handler) => target.on('value', handler);
const onDisconnect = (target) => target.onDisconnect();
const push = (target, value) => target.push(value);
const query = (target, limit) => limit ? target.limitToLast(limit) : target;
const limitToLast = (limit) => limit;
const runTransaction = (target, handler) => target.transaction(handler);
const set = (target, value) => target.set(value);
const update = (target, value) => target.update(value);

const $ = (selector) => document.querySelector(selector);
const toast = $('#toast');
let toastTimer;

lucide.createIcons();

const roomCodeElement = $('#roomCode');
const welcomeModal = $('#welcomeModal');
const joinForm = $('#joinForm');
const nameInput = $('#nameInput');
const joinCodeInput = $('#joinCodeInput');
const initialRoomFromUrl = window.location.hash.match(/room-([a-zA-Z0-9]{4})/)?.[1];
let roomCode = initialRoomFromUrl || '7F3A';
let userName = sessionStorage.getItem('ramein-name');
let roomRef;
let presenceRef;
let roomState = {};
let isHost = false;
let mediaRecorder;
let voiceChunks = [];
let clientId = sessionStorage.getItem('ramein-client-id');
if (!clientId) {
  clientId = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  sessionStorage.setItem('ramein-client-id', clientId);
}
let typingTimer;
let knownPresenceIds = new Set();
let knownPresenceNames = new Map();
let knownChatEventIds = new Set();
let currentPresencePeople = [];
let presenceInitialized = false;
let isPageUnloading = false;
let isPlaying = false;
let ytPlayer;
let autoplayOnReady = false;
let syncingRemotePlayback = false;
let suppressPlaybackUntil = 0;
let selectedVideoId = null;
let controlsHideTimer;
let needsAudioResume = false;
let chatEventsInitialized = false;
const notificationSound = $('#notificationSound');

function updatePlayButton() {
  const icon = isPlaying ? 'pause' : 'play';
  playButton.innerHTML = `<i data-lucide="${icon}"></i>`;
  lucide.createIcons();
}

function sendPlaybackState() {
  if (isPageUnloading || !ytPlayer?.getCurrentTime) return;
  sendRealtime({ type: 'playback', playing: isPlaying, position: Math.round(ytPlayer.getCurrentTime()) });
}

window.addEventListener('pagehide', () => {
  isPageUnloading = true;
});

function sendYouTubeCommand(command, args = []) {
  document.querySelector('#videoPlayer')?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: command, args }), '*');
}

async function updateNowPlaying(videoId) {
  try {
    const response = await fetch(`/api/video?id=${encodeURIComponent(videoId)}`);
    if (!response.ok) throw new Error('Metadata unavailable');
    const video = await response.json();
    $('#nowPlayingTitle').textContent = video.title;
    $('#nowPlayingChannel').textContent = video.channel;
    $('#nowPlayingViews').textContent = 'YouTube';
  } catch {
    $('#nowPlayingTitle').textContent = `YouTube video · ${videoId}`;
    $('#nowPlayingChannel').textContent = 'YouTube';
    $('#nowPlayingViews').textContent = 'YouTube';
  }
}

function updateNowPlayingFromPlayer() {
  const videoData = ytPlayer?.getVideoData?.();
  if (!videoData?.title) return false;
  $('#nowPlayingTitle').textContent = videoData.title;
  $('#nowPlayingChannel').textContent = videoData.author || 'YouTube';
  $('#nowPlayingViews').textContent = 'YouTube';
  return true;
}

function selectVideo(videoId, notifyRoom = true) {
  selectedVideoId = videoId;
  updateQueueActiveState();
  showVideoControls();
  $('#videoFrame').classList.remove('empty-video');
  $('#noVideoState').classList.add('hidden');
  if (!ytPlayer && window.YT?.Player) initYouTubePlayer();
  if (ytPlayer?.loadVideoById) ytPlayer.loadVideoById(videoId);
  updateNowPlaying(videoId);
  setTimeout(updateNowPlayingFromPlayer, 1200);
  if (notifyRoom) sendRealtime({ type: 'video_select', videoId });
}

function updateQueueActiveState() {
  document.querySelectorAll('.queue-item').forEach((item) => {
    const isActive = item.dataset.videoId === selectedVideoId;
    item.classList.toggle('active', isActive);
    item.querySelector('.queue-now-playing')?.classList.toggle('hidden', !isActive);
  });
}

function playNextVideo() {
  const queue = Array.isArray(roomState.queue) ? roomState.queue : [];
  const currentIndex = queue.indexOf(selectedVideoId);
  const nextVideoId = currentIndex >= 0 ? queue[currentIndex + 1] : queue[0];
  if (!nextVideoId) return;
  if (!window.confirm('Video selesai. Lanjutkan ke video berikutnya?')) {
    isPlaying = false;
    updatePlayButton();
    return;
  }
  selectVideo(nextVideoId);
  ytPlayer?.playVideo?.();
  isPlaying = true;
  sendRealtime({ type: 'playback', playing: true, position: 0 });
}

function initYouTubePlayer() {
  if (ytPlayer || !selectedVideoId || !window.YT?.Player) return;
  ytPlayer = new YT.Player('videoPlayer', {
    videoId: selectedVideoId,
    playerVars: { autoplay: 0, controls: 0, enablejsapi: 1, origin: window.location.origin },
    events: {
      onReady: (event) => {
        ytPlayer = event.target;
        updateNowPlayingFromPlayer() || updateNowPlaying(selectedVideoId);
        setTimeout(updateNowPlayingFromPlayer, 1800);
        if (roomState.currentVideoId === selectedVideoId) setRemotePlayback(roomState.playing, roomState.position);
        if (autoplayOnReady) {
          ytPlayer.playVideo();
          isPlaying = true;
          autoplayOnReady = false;
          sendRealtime({ type: 'playback', playing: true, position: 0 });
          updatePlayButton();
        }
        updateProgress();
      },
      onStateChange: (event) => {
        updateNowPlayingFromPlayer();
        if (event.data === YT.PlayerState.ENDED) {
          playNextVideo();
          return;
        }
        if (event.data === YT.PlayerState.PLAYING || event.data === YT.PlayerState.PAUSED) {
          isPlaying = event.data === YT.PlayerState.PLAYING;
          updatePlayButton();
        }
      }
    }
  });
}

window.onYouTubeIframeAPIReady = initYouTubePlayer;
if (window.YT?.Player) setTimeout(initYouTubePlayer, 0);

function playNotificationSound() {
  if (!notificationSound) return;
  notificationSound.currentTime = 0;
  notificationSound.play().catch(() => {});
}

function showFloatingReaction(emoji) {
  const reaction = document.createElement('span');
  reaction.className = 'floating-reaction';
  reaction.textContent = emoji;
  reaction.style.left = `${18 + Math.random() * 64}%`;
  reaction.style.setProperty('--reaction-drift', `${(Math.random() - 0.5) * 70}px`);
  reaction.addEventListener('animationend', () => reaction.remove(), { once: true });
  $('#reactionOverlay').append(reaction);
}

function formatAudioTime(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

function appendChatMessage(name, message, media = {}, authorId = '') {
  $('.chat-empty')?.remove();
  const bubble = document.createElement('div');
  bubble.className = 'chat-message';
  bubble.dataset.author = name;
  const adminBadge = authorId && authorId === roomState.hostId ? '<span class="admin-badge">ADMIN</span>' : '';
  bubble.innerHTML = `<span class="avatar avatar-you"></span><div><div class="name-line"><strong></strong>${adminBadge}<time>now</time></div><p></p><div class="chat-media"></div></div>`;
  bubble.querySelector('.avatar').textContent = name.slice(0, 1).toUpperCase();
  bubble.querySelector('strong').textContent = name;
  bubble.querySelector('p').textContent = message;
  if (media.type === 'photo' && media.url) bubble.querySelector('.chat-media').innerHTML = `<img src="${media.url}" alt="Photo from ${name}">`;
  if (media.type === 'voice' && media.url) {
    const mediaContainer = bubble.querySelector('.chat-media');
    const player = document.createElement('div');
    player.className = 'voice-player';
    player.innerHTML = '<button class="voice-play" type="button" aria-label="Play voice note"><i data-lucide="play"></i></button><div class="voice-wave"><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span></div><span class="voice-time">0:00</span>';
    const audio = document.createElement('audio');
    audio.src = media.url;
    audio.preload = 'metadata';
    audio.controlsList = 'nodownload';
    audio.addEventListener('contextmenu', (event) => event.preventDefault());
    const playButton = player.querySelector('.voice-play');
    const timeLabel = player.querySelector('.voice-time');
    let durationLabel = '--:--';
    playButton.addEventListener('click', () => audio.paused ? audio.play() : audio.pause());
    audio.addEventListener('loadedmetadata', () => {
      durationLabel = formatAudioTime(audio.duration);
      timeLabel.textContent = durationLabel;
    });
    audio.addEventListener('play', () => {
      playButton.innerHTML = '<i data-lucide="pause"></i>';
      timeLabel.textContent = `0:00 / ${durationLabel}`;
      player.classList.add('playing');
      lucide.createIcons();
    });
    audio.addEventListener('pause', () => {
      playButton.innerHTML = '<i data-lucide="play"></i>';
      player.classList.remove('playing');
      lucide.createIcons();
    });
    audio.addEventListener('timeupdate', () => {
      timeLabel.textContent = `${formatAudioTime(audio.currentTime)} / ${durationLabel}`;
    });
    audio.addEventListener('ended', () => {
      timeLabel.textContent = durationLabel;
    });
    player.append(audio);
    mediaContainer.append(player);
    lucide.createIcons();
  }
  $('#chatFeed').append(bubble);
  $('#chatFeed').scrollTop = $('#chatFeed').scrollHeight;
}

function clearChatView() {
  $('#chatFeed').innerHTML = '<div class="empty-state chat-empty"><i data-lucide="message-circle"></i><strong>Belum ada chat</strong><span>Jadilah yang pertama menyapa room ini.</span></div>';
  lucide.createIcons();
}

function showEmptyVideoState() {
  selectedVideoId = null;
  isPlaying = false;
  $('#videoFrame').classList.add('empty-video');
  $('#noVideoState').classList.remove('hidden');
  $('#nowPlayingTitle').textContent = 'Belum ada video diputar';
  $('#nowPlayingChannel').textContent = 'Queue masih kosong';
  $('#nowPlayingViews').textContent = 'Tambahkan video untuk mulai';
  updatePlayButton();
}

function renderViewers(names = []) {
  const list = $('#watchingList');
  list.innerHTML = '';
  const people = names.length ? names : [{ id: clientId, name: userName || 'You' }];
  const visibleNames = people.map((person) => typeof person === 'string' ? { id: '', name: person } : person);
  $('#viewerModalCount').textContent = visibleNames.length;
  visibleNames.forEach((personData) => {
    const person = document.createElement('div');
    person.className = 'watching-person';
    const adminBadge = personData.id && personData.id === roomState.hostId ? '<span class="admin-badge">ADMIN</span>' : '';
    const kickButton = isHost && personData.id && personData.id !== clientId ? '<button class="kick-button" data-kick-id="' + personData.id + '" title="Kick viewer" aria-label="Kick viewer"><i data-lucide="user-x"></i></button>' : '';
    person.innerHTML = `<span class="avatar avatar-you"></span><strong></strong>${adminBadge}<span class="person-status"></span>${kickButton}`;
    person.querySelector('.avatar').textContent = personData.name.slice(0, 1).toUpperCase();
    person.querySelector('strong').textContent = personData.name;
    person.querySelector('.kick-button')?.addEventListener('click', () => kickViewer(personData.id, personData.name));
    list.append(person);
  });
  lucide.createIcons();
}

function clearQueueView() {
  queueList.innerHTML = '<div class="empty-state queue-empty"><i data-lucide="list-video"></i><strong>Queue masih kosong</strong><span>Tambahkan link YouTube untuk mulai menyusun tontonan.</span></div>';
  $('#queueCount').textContent = '0';
  lucide.createIcons();
}

function connectRealtime() {
  const database = firebaseDatabase;
  if (!database) {
    $('#viewerCount').textContent = 'connecting...';
    document.querySelector('.online-count').lastChild.textContent = ' connecting...';
    return;
  }
  roomRef = ref(database, `rooms/${roomCode}`);
  suppressPlaybackUntil = Date.now() + 3000;
  knownPresenceIds = new Set();
  knownPresenceNames = new Map();
  presenceInitialized = false;
  presenceRef = ref(roomRef, `presence/${clientId}`);
  onDisconnect(presenceRef).remove();
  if (isHost) update(ref(roomRef, 'state'), { hostId: clientId });
  set(presenceRef, { name: userName || 'Guest', isTyping: false });
  onValue(ref(roomRef, `kicked/${clientId}`), (snapshot) => {
    if (!snapshot.val()) return;
    set(ref(roomRef, `kicked/${clientId}`), null);
    showToast('Kamu telah dikeluarkan dari room');
    leaveRoom(true, true);
  });
  onValue(ref(roomRef, 'presence'), (snapshot) => {
    const presence = snapshot.val() || {};
    const presenceEntries = Object.entries(presence);
    const currentPresenceIds = new Set(presenceEntries.map(([id]) => id));
    if (presenceInitialized) {
      presenceEntries.forEach(([id, person]) => {
        if (id !== clientId && !knownPresenceIds.has(id)) showToast(`${person.name || 'Seseorang'} masuk ke room`);
      });
      knownPresenceIds.forEach((id) => {
        if (id !== clientId && !currentPresenceIds.has(id)) showToast(`${knownPresenceNames.get(id) || 'Seseorang'} keluar dari room`);
      });
    }
    knownPresenceIds = currentPresenceIds;
    knownPresenceNames = new Map(presenceEntries.map(([id, person]) => [id, person.name || 'Seseorang']));
    presenceInitialized = true;
    const viewers = presenceEntries.map(([id, person]) => ({ id, name: person.name })).filter((person) => person.name);
    currentPresencePeople = viewers;
    const typingNames = presenceEntries
      .filter(([id, person]) => id !== clientId && person.isTyping)
      .map(([, person]) => person.name)
      .filter(Boolean);
    const typingIndicator = $('#typingIndicator');
    if (typingNames.length) {
      typingIndicator.textContent = `${typingNames.join(', ')} ${typingNames.length === 1 ? 'is' : 'are'} typing...`;
      typingIndicator.classList.remove('hidden');
    } else {
      typingIndicator.textContent = '';
      typingIndicator.classList.add('hidden');
    }
    $('#viewerCount').textContent = `${viewers.length || 1} watching`;
    document.querySelector('.online-count').lastChild.textContent = ` ${viewers.length || 1} online`;
    renderViewers(viewers);
  });
  onValue(ref(roomRef, 'state'), (snapshot) => {
    roomState = snapshot.val() || {};
    if (roomState.hostId) isHost = roomState.hostId === clientId;
    else if (isHost) update(ref(roomRef, 'state'), { hostId: clientId });
    renderViewers(currentPresencePeople);
    clearQueueView();
    (roomState.queue || []).forEach((videoId) => addQueueItem(videoId, false));
    if (roomState.currentVideoId && roomState.currentVideoId !== selectedVideoId) selectVideo(roomState.currentVideoId, false);
      else if (!roomState.currentVideoId && selectedVideoId) showEmptyVideoState();
    if (roomState.lastActor !== clientId) setRemotePlayback(roomState.playing, roomState.position);
  });
  onValue(ref(roomRef, 'events'), (snapshot) => {
    const currentChatEventIds = new Set();
    clearChatView();
    snapshot.forEach((messageSnapshot) => {
      const message = messageSnapshot.val();
      if (message?.type !== 'chat' && message?.type !== 'reaction') return;
      currentChatEventIds.add(messageSnapshot.key);
      if (message.type === 'chat') appendChatMessage(message.name, message.message, message.media, message.clientId);
      if (message.type === 'reaction' && chatEventsInitialized && !knownChatEventIds.has(messageSnapshot.key) && message.clientId !== clientId) showFloatingReaction(message.message);
      if (message.type === 'chat' && chatEventsInitialized && !knownChatEventIds.has(messageSnapshot.key) && message.name !== userName) playNotificationSound();
    });
    knownChatEventIds = currentChatEventIds;
    chatEventsInitialized = true;
  });
  $('#viewerCount').textContent = 'connected';
  document.querySelector('.online-count').lastChild.textContent = ' connected';
  showToast('Terhubung ke Firebase realtime');
}

function kickViewer(viewerId, viewerName) {
  if (!isHost || viewerId === clientId) return;
  if (!window.confirm(`Keluarkan ${viewerName} dari room?`)) return;
  set(ref(roomRef, `kicked/${viewerId}`), true);
  ref(roomRef, `presence/${viewerId}`).remove();
  showToast(`${viewerName} dikeluarkan dari room`);
}

function leaveRoom(force = false, silent = false) {
  if (!force && !window.confirm('Keluar dari room ini?')) return;
  clearTimeout(typingTimer);
  presenceRef?.update({ isTyping: false });
  presenceRef?.remove();
  roomRef?.off();
  presenceRef?.off();
  ytPlayer?.pauseVideo?.();
  needsAudioResume = false;
  clearTimeout(controlsHideTimer);
  showEmptyVideoState();
  clearQueueView();
  clearChatView();
  roomState = {};
  roomRef = null;
  presenceRef = null;
  knownPresenceIds = new Set();
  knownPresenceNames = new Map();
  knownChatEventIds = new Set();
  chatEventsInitialized = false;
  currentPresencePeople = [];
  presenceInitialized = false;
  roomCode = '';
  $('#createRoomButton').innerHTML = 'Buat room baru <i data-lucide="arrow-right"></i>';
  $('#showJoinButton').classList.remove('hidden');
  joinForm.classList.remove('visible');
  lucide.createIcons();
  $('#viewerModal').classList.add('hidden');
  welcomeModal.classList.remove('hidden');
  $('#viewerCount').textContent = 'connecting...';
  document.querySelector('.online-count').lastChild.textContent = ' connecting...';
  history.replaceState(null, '', window.location.pathname + window.location.search);
  if (!silent) showToast('Kamu sudah keluar dari room');
}

function sendRealtime(message) {
  if (!roomRef) return false;
  if (message.type === 'chat' || message.type === 'reaction') {
    push(ref(roomRef, 'events'), { ...message, name: userName || 'Guest', clientId, createdAt: Date.now() });
    return true;
  }
  if (message.type === 'queue_add') {
    runTransaction(ref(roomRef, 'state/queue'), (queue = []) => {
      const nextQueue = Array.isArray(queue) ? queue : [];
      return nextQueue.includes(message.videoId) ? nextQueue : [...nextQueue, message.videoId];
    });
    return true;
  }
  if (message.type === 'queue_remove' || message.type === 'queue_move') {
    runTransaction(ref(roomRef, 'state/queue'), (queue = []) => {
      const nextQueue = Array.isArray(queue) ? [...queue] : [];
      const index = nextQueue.indexOf(message.videoId);
      if (index < 0) return nextQueue;
      if (message.type === 'queue_remove') nextQueue.splice(index, 1);
      else {
        const targetIndex = Math.max(0, Math.min(nextQueue.length - 1, index + message.direction));
        [nextQueue[index], nextQueue[targetIndex]] = [nextQueue[targetIndex], nextQueue[index]];
      }
      return nextQueue;
    });
    return true;
  }
  if (message.type === 'queue_clear') {
    update(ref(roomRef, 'state'), { queue: [], currentVideoId: null, playing: false, position: 0, lastActor: clientId });
    return true;
  }
  if (message.type === 'video_select') {
    update(ref(roomRef, 'state'), { currentVideoId: message.videoId, lastActor: clientId });
    return true;
  }
  if (message.type === 'playback') {
    update(ref(roomRef, 'state'), { playing: message.playing, position: message.position, lastActor: clientId });
    return true;
  }
  return false;
}

async function sendMediaMessage(file, type, message = '') {
  if (!roomRef || !file) return;
  const safeName = (file.name || (type === 'voice' ? 'voice-note.webm' : 'photo')).replace(/[^a-zA-Z0-9._-]/g, '_');
  const filename = `rooms/${roomCode}/media/${clientId}-${Date.now()}-${safeName}`;
  try {
    showToast(type === 'photo' ? 'Mengunggah foto...' : 'Mengunggah voice note...');
    const uploadResponse = await fetch(`/api/upload?filename=${encodeURIComponent(filename)}`, {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    });
    if (!uploadResponse.ok) throw new Error('Upload failed');
    const { url } = await uploadResponse.json();
    await push(ref(roomRef, 'events'), { type: 'chat', message, media: { type, url }, name: userName || 'Guest', createdAt: Date.now() });
    showToast(type === 'photo' ? 'Foto terkirim' : 'Voice note terkirim');
  } catch {
    showToast('Media gagal dikirim');
  }
}

function changeName() {
  $('#renameInput').value = userName || '';
  $('#renameError').classList.remove('visible');
  $('#nameModal').classList.remove('hidden');
  $('#renameInput').focus();
}

function saveName() {
  const nextName = $('#renameInput').value.trim().slice(0, 24);
  if (!nextName) {
    $('#renameError').classList.add('visible');
    $('#renameInput').focus();
    return;
  }
  userName = nextName;
  sessionStorage.setItem('ramein-name', userName);
  $('#profileButton').textContent = userName.slice(0, 1).toUpperCase();
  presenceRef?.update({ name: userName });
  $('#nameModal').classList.add('hidden');
  showToast('Nama berhasil diubah');
}

function enterRoom(code, host = false) {
  isPageUnloading = false;
  isHost = host;
  roomRef?.off();
  presenceRef?.off();
  clearChatView();
  roomCode = code;
  roomCodeElement.textContent = roomCode;
  $('#largeRoomCode').textContent = roomCode;
  $('#viewerRoomCode').textContent = roomCode;
  $('#shareLink').value = `${window.location.href.split('#')[0]}#room-${roomCode}`;
  history.replaceState(null, '', `#room-${roomCode}`);
  welcomeModal.classList.add('hidden');
  renderViewers(userName ? [userName] : []);
  connectRealtime();
}

function validateName() {
  userName = nameInput.value.trim();
  if (!userName) {
    $('#nameError').classList.add('visible');
    nameInput.focus();
    return false;
  }
  sessionStorage.setItem('ramein-name', userName);
  $('#nameError').classList.remove('visible');
  return true;
}

if (userName) {
  nameInput.value = userName;
  $('#profileButton').textContent = userName.slice(0, 1).toUpperCase();
}
if (userName && initialRoomFromUrl) enterRoom(roomCode);
else nameInput.focus();

if (initialRoomFromUrl) {
  $('#createRoomButton').innerHTML = 'Join room <i data-lucide="log-in"></i>';
  $('#showJoinButton').classList.add('hidden');
  joinForm.classList.remove('visible');
  lucide.createIcons();
}

$('#createRoomButton').addEventListener('click', () => {
  if (!validateName()) return;
  const destinationRoom = Math.random().toString(36).slice(2, 6).toUpperCase();
  enterRoom(destinationRoom, true);
  showToast(`Room ${roomCode} berhasil dibuat`);
});

$('#showJoinButton').addEventListener('click', () => {
  joinForm.classList.toggle('visible');
  joinCodeInput.focus();
});

$('#joinRoomButton').addEventListener('click', () => {
  if (!validateName()) return;
  const code = joinCodeInput.value.trim().replace(/[^a-z0-9]/gi, '').slice(0, 4);
  if (code.length !== 4) return showToast('Kode room harus 4 karakter');
  enterRoom(code);
  showToast(`Berhasil masuk ke room ${roomCode}`);
});

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
}

function setRemotePlayback(playing, position) {
  isPlaying = playing;
  updatePlayButton();
  if (!ytPlayer?.seekTo) return;
  suppressPlaybackUntil = Date.now() + 1500;
  syncingRemotePlayback = true;
  ytPlayer.seekTo(Number(position) || 0, true);
  if (playing) {
    ytPlayer.mute();
    ytPlayer.playVideo();
    needsAudioResume = true;
  }
    else {
      ytPlayer.pauseVideo();
      needsAudioResume = false;
    }
  sendYouTubeCommand(playing ? 'playVideo' : 'pauseVideo');
  setTimeout(() => { syncingRemotePlayback = false; }, 700);
}

function resumeAudioAfterInteraction() {
  if (!needsAudioResume || !ytPlayer) return;
  ytPlayer.unMute();
  needsAudioResume = false;
}

document.addEventListener('pointerdown', resumeAudioAfterInteraction, { once: false });
document.addEventListener('keydown', resumeAudioAfterInteraction, { once: false });

const playButton = $('#playButton');
function togglePlayback() {
  if (!selectedVideoId) return showToast('Pilih video dari queue terlebih dahulu');
  isPlaying = !isPlaying;
  if (ytPlayer?.playVideo && ytPlayer?.pauseVideo) isPlaying ? ytPlayer.playVideo() : ytPlayer.pauseVideo();
  sendYouTubeCommand(isPlaying ? 'playVideo' : 'pauseVideo');
  sendPlaybackState();
  updatePlayButton();
  showToast(isPlaying ? 'Playback dimulai untuk semua orang' : 'Playback dijeda untuk semua orang');
    needsAudioResume = false;
}
playButton.addEventListener('click', togglePlayback);
$('#fullscreenButton').addEventListener('click', async () => {
  if (document.fullscreenElement) return document.exitFullscreen();
  await $('#videoFrame').requestFullscreen?.();
  showVideoControls();
});
$('#videoFrame').addEventListener('click', (event) => {
  if (event.target.closest('#playButton, #progressBar, .video-topline')) return;
  if (event.target.closest('.video-controls')) return;
  togglePlayback();
});

$('#inviteButton').addEventListener('click', async () => {
  $('#shareModal').classList.remove('hidden');
  $('#shareLink').value = `${window.location.href.split('#')[0]}#room-${roomCode}`;
});

$('#roomButton').addEventListener('click', () => $('#viewerModal').classList.remove('hidden'));
$('#closeShareButton').addEventListener('click', () => $('#shareModal').classList.add('hidden'));
$('#closeShareButton2').addEventListener('click', () => $('#shareModal').classList.add('hidden'));
$('#closeViewerButton').addEventListener('click', () => $('#viewerModal').classList.add('hidden'));
$('#leaveRoomButton').addEventListener('click', leaveRoom);
function toggleQueueDrawer(open) {
  const shouldOpen = typeof open === 'boolean' ? open : !$('#queueList').classList.contains('queue-open');
  $('#queueList').classList.toggle('queue-open', shouldOpen);
  $('#queueBackdrop').classList.toggle('queue-open', shouldOpen);
  document.body.classList.toggle('queue-drawer-open', shouldOpen);
}
$('#queueMenuButton').addEventListener('click', () => toggleQueueDrawer());
$('#mobileQueueButton').addEventListener('click', openVideoModal);
$('#queueCloseButton').addEventListener('click', () => toggleQueueDrawer(false));
$('#queueBackdrop').addEventListener('click', () => toggleQueueDrawer(false));
$('#copyLinkButton').addEventListener('click', async () => {
  const roomLink = $('#shareLink').value;
  try {
    await navigator.clipboard.writeText(roomLink);
    showToast('Link room disalin ke clipboard');
  } catch {
    showToast('Room code 7F3A siap dibagikan');
  }
});

const videoModal = $('#videoModal');
const videoUrlInput = $('#videoUrlInput');
const videoError = $('#videoError');
const queueList = $('#queueList');

function openVideoModal() {
  videoModal.classList.remove('hidden');
  videoUrlInput.focus();
}

function getYoutubeId(value) {
  try {
    const url = new URL(value);
    if (url.hostname.includes('youtu.be')) return url.pathname.slice(1).split('/')[0];
    if (url.hostname.includes('youtube.com')) return url.searchParams.get('v') || url.pathname.split('/').pop();
  } catch {
    return null;
  }
  return null;
}

function addQueueItem(videoId, notifyServer = true) {
  if (queueList.querySelector(`[data-video-id="${videoId}"]`)) return;
  $('.queue-empty')?.remove();
  const item = document.createElement('article');
  item.className = 'queue-item';
  item.dataset.videoId = videoId;
  item.innerHTML = `<span class="drag"><i data-lucide="grip-vertical"></i></span><div class="thumb youtube-thumb" style="background-image:url('https://img.youtube.com/vi/${videoId}/mqdefault.jpg')"></div><div class="queue-copy"><span class="queue-now-playing hidden">NOW PLAYING</span><strong>YouTube video · ${videoId}</strong><span>Added just now · ready to watch</span></div><div class="queue-actions"><button class="queue-action" data-action="up" aria-label="Move video up"><i data-lucide="chevron-up"></i></button><button class="queue-action" data-action="down" aria-label="Move video down"><i data-lucide="chevron-down"></i></button><button class="queue-action danger" data-action="remove" aria-label="Remove video"><i data-lucide="trash-2"></i></button></div>`;
  queueList.append(item);
  $('#queueCount').textContent = queueList.querySelectorAll('.queue-item').length;
  fetch(`/api/video?id=${encodeURIComponent(videoId)}`)
    .then((response) => response.ok ? response.json() : null)
    .then((video) => {
      if (video) item.querySelector('.queue-copy strong').textContent = video.title;
    })
    .catch(() => {});
  if (notifyServer) sendRealtime({ type: 'queue_add', videoId });
  item.addEventListener('click', (event) => {
    if (event.target.closest('.queue-actions')) return;
    selectVideo(videoId);
    showToast('Video dimuat ke player utama');
    if (window.matchMedia('(max-width:900px)').matches) toggleQueueDrawer(false);
  });
  item.querySelectorAll('.queue-action').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const action = button.dataset.action;
      sendRealtime(action === 'remove' ? { type: 'queue_remove', videoId } : { type: 'queue_move', videoId, direction: action === 'up' ? -1 : 1 });
    });
  });
  updateQueueActiveState();
  lucide.createIcons();
}

$('#queueButton').addEventListener('click', openVideoModal);
$('#closeVideoButton').addEventListener('click', () => videoModal.classList.add('hidden'));
$('#cancelVideoButton').addEventListener('click', () => videoModal.classList.add('hidden'));
$('#addVideoButton').addEventListener('click', () => {
  const videoId = getYoutubeId(videoUrlInput.value.trim());
  if (!videoId) {
    videoError.classList.add('visible');
    videoUrlInput.focus();
    return;
  }
  videoError.classList.remove('visible');
  const isFirstVideo = !selectedVideoId && !queueList.querySelector('.queue-item');
  addQueueItem(videoId);
  if (isFirstVideo) {
    autoplayOnReady = true;
    selectVideo(videoId);
    setTimeout(() => {
      if (ytPlayer?.playVideo) {
        ytPlayer.playVideo();
        isPlaying = true;
        autoplayOnReady = false;
        sendRealtime({ type: 'playback', playing: true, position: 0 });
        updatePlayButton();
      }
    }, 800);
  }
  videoUrlInput.value = '';
  videoModal.classList.add('hidden');
  showToast('Video ditambahkan ke queue');
});

$('#clearQueue').addEventListener('click', () => {
  clearQueueView();
  sendRealtime({ type: 'queue_clear' });
  showToast('Queue dibersihkan');
});

const messageForm = $('#messageForm');
const messageInput = $('#messageInput');
const photoInput = $('#photoInput');
let pendingMedia = null;
let recording = false;
function setRecordingState(active) {
  recording = active;
  $('#messageForm').classList.toggle('recording', active);
  $('#messageInput').classList.toggle('hidden', active);
  $('#recordingSpectrum').classList.toggle('hidden', !active);
  $('#voiceButton').classList.toggle('recording', active);
}

function attachMedia(file, type) {
  if (!file) return;
  clearAttachment();
  pendingMedia = { file, type, previewUrl: URL.createObjectURL(file) };
  const preview = $('#attachmentPreview');
  const visual = document.createElement(type === 'photo' ? 'img' : 'audio');
  visual.className = 'attachment-visual';
  visual.src = pendingMedia.previewUrl;
  if (type === 'voice') visual.controls = true;
  preview.prepend(visual);
  $('#attachmentName').textContent = type === 'photo' ? file.name : 'Voice note siap dikirim';
  preview.classList.remove('hidden');
  lucide.createIcons();
}

function clearAttachment() {
  if (pendingMedia?.previewUrl) URL.revokeObjectURL(pendingMedia.previewUrl);
  pendingMedia = null;
  const preview = $('#attachmentPreview');
  preview.classList.add('hidden');
  preview.querySelector('.attachment-visual')?.remove();
  $('#attachmentName').textContent = '';
}

$('#profileButton').addEventListener('click', changeName);
$('#closeNameButton').addEventListener('click', () => $('#nameModal').classList.add('hidden'));
$('#cancelNameButton').addEventListener('click', () => $('#nameModal').classList.add('hidden'));
$('#saveNameButton').addEventListener('click', saveName);
$('#renameInput').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') saveName();
});
$('#removeAttachmentButton').addEventListener('click', clearAttachment);
$('#photoButton').addEventListener('click', () => photoInput.click());
photoInput.addEventListener('change', () => {
  const file = photoInput.files?.[0];
  if (file) attachMedia(file, 'photo');
  photoInput.value = '';
});
$('#voiceButton').addEventListener('click', async () => {
  if (recording) return mediaRecorder.stop();
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return showToast('Voice note tidak didukung browser ini');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    voiceChunks = [];
    const mimeTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
    const mimeType = mimeTypes.find((type) => MediaRecorder.isTypeSupported(type));
    mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    setRecordingState(true);
    mediaRecorder.addEventListener('dataavailable', (event) => voiceChunks.push(event.data));
    mediaRecorder.addEventListener('stop', () => {
      stream.getTracks().forEach((track) => track.stop());
      setRecordingState(false);
      attachMedia(new Blob(voiceChunks, { type: mediaRecorder.mimeType || mimeType || 'audio/webm' }), 'voice');
    }, { once: true });
    mediaRecorder.start();
    showToast('Merekam voice note... klik mic untuk berhenti');
  } catch {
    showToast('Izin mikrofon diperlukan');
  }
});
messageInput.addEventListener('input', () => {
  if (!presenceRef) return;
  presenceRef.update({ isTyping: messageInput.value.trim().length > 0 });
  updateMentionSuggestions();
  clearTimeout(typingTimer);
  if (messageInput.value.trim()) typingTimer = setTimeout(() => presenceRef?.update({ isTyping: false }), 1000);
});

function updateMentionSuggestions() {
  const match = messageInput.value.match(/(?:^|\s)@([^\s]*)$/);
  const menu = $('#mentionSuggestions');
  if (!match) return menu.classList.add('hidden');
  const search = match[1].toLowerCase();
  const matches = currentPresencePeople.filter((person) => person.name?.toLowerCase().startsWith(search));
  menu.innerHTML = '';
  matches.forEach((person) => {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'mention-option';
    option.textContent = `@${person.name}`;
    option.addEventListener('click', () => {
      messageInput.value = messageInput.value.replace(/(?:^|\s)@[^\s]*$/, (prefix) => `${prefix.startsWith(' ') ? ' ' : ''}@${person.name} `);
      menu.classList.add('hidden');
      messageInput.focus();
    });
    menu.append(option);
  });
  menu.classList.toggle('hidden', !matches.length);
}

messageForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const message = messageInput.value.trim();
  if (!message && !pendingMedia) return;
  if (pendingMedia) {
    const media = pendingMedia;
    clearAttachment();
    sendMediaMessage(media.file, media.type, message);
  } else if (!sendRealtime({ type: 'chat', message })) showToast('Belum terhubung ke room');
  messageInput.value = '';
  presenceRef?.update({ isTyping: false });
  $('#chatFeed').scrollTop = $('#chatFeed').scrollHeight;
});

document.querySelectorAll('.reaction').forEach((button) => {
  button.addEventListener('click', () => {
    if (!sendRealtime({ type: 'reaction', message: button.dataset.reaction })) return showToast('Belum terhubung ke room');
    showFloatingReaction(button.dataset.reaction);
    showToast(`${button.dataset.reaction} dikirim ke room`);
  });
});

$('#chatFilterButton').addEventListener('click', () => $('#chatFilterMenu').classList.toggle('hidden'));
document.querySelectorAll('#chatFilterMenu button').forEach((button) => {
  button.addEventListener('click', () => {
    const onlyMine = button.dataset.filter === 'mine';
    document.querySelectorAll('.chat-message').forEach((message) => {
      message.hidden = onlyMine && message.dataset.author !== userName;
    });
    document.querySelectorAll('#chatFilterMenu button').forEach((item) => item.classList.toggle('active', item === button));
    $('#chatFilterMenu').classList.add('hidden');
  });
});

const progressBar = $('#progressBar');
const currentTime = $('#currentTime');
const durationTime = $('#durationTime');
let isSeeking = false;
function showVideoControls() {
  const frame = $('#videoFrame');
  frame.classList.remove('controls-hidden');
  clearTimeout(controlsHideTimer);
  if (selectedVideoId) controlsHideTimer = setTimeout(() => frame.classList.add('controls-hidden'), 4000);
}

function skipVideo(seconds) {
  if (!ytPlayer?.getCurrentTime || !ytPlayer?.getDuration) return;
  const nextPosition = Math.max(0, Math.min(ytPlayer.getDuration(), ytPlayer.getCurrentTime() + seconds));
  ytPlayer.seekTo(nextPosition, true);
  sendRealtime({ type: 'playback', playing: isPlaying, position: Math.round(nextPosition) });
  showVideoControls();
}

$('#skipBackButton').addEventListener('click', () => skipVideo(-5));
$('#skipForwardButton').addEventListener('click', () => skipVideo(5));
progressBar.addEventListener('pointerdown', () => { isSeeking = true; });
progressBar.addEventListener('pointerup', () => {
  isSeeking = false;
  if (ytPlayer?.seekTo) {
    const seconds = Math.round((Number(progressBar.value) / 100) * (ytPlayer.getDuration() || 0));
    ytPlayer.seekTo(seconds, true);
    sendPlaybackState();
  }
  showVideoControls();
});
progressBar.addEventListener('input', () => {
  const seconds = Math.round((Number(progressBar.value) / 100) * (ytPlayer?.getDuration?.() || 3764));
  currentTime.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
});

function updateProgress() {
  if (ytPlayer?.getDuration) {
    const duration = ytPlayer.getDuration();
    const position = ytPlayer.getCurrentTime();
    if (duration && !isSeeking) progressBar.value = (position / duration) * 100;
    if (duration) durationTime.textContent = `${String(Math.floor(duration / 60)).padStart(2, '0')}:${String(Math.floor(duration % 60)).padStart(2, '0')}`;
    currentTime.textContent = `${String(Math.floor(position / 60)).padStart(2, '0')}:${String(Math.floor(position % 60)).padStart(2, '0')}`;
  }
  requestAnimationFrame(updateProgress);
}
