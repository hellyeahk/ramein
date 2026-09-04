const firebaseDatabase = firebase.database();
const ref = (parent, path) => parent.ref(path);
const onValue = (target, handler) => target.on('value', handler);
const onChildAdded = (target, handler) => target.on('child_added', handler);
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
const roomFromUrl = window.location.hash.match(/room-([a-z0-9]{4})/i)?.[1]?.toUpperCase();
let roomCode = roomFromUrl || '7F3A';
let userName = sessionStorage.getItem('ramein-name');
let roomRef;
let presenceRef;
let roomState = {};
let clientId = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
let isPlaying = false;
let ytPlayer;
let syncingRemotePlayback = false;
let selectedVideoId = null;

function updatePlayButton() {
  const icon = isPlaying ? 'pause' : 'play';
  playButton.innerHTML = `<i data-lucide="${icon}"></i>`;
  controlPlayButton.innerHTML = `<i data-lucide="${icon}"></i>`;
  lucide.createIcons();
}

function sendPlaybackState() {
  if (!ytPlayer?.getCurrentTime) return;
  sendRealtime({ type: 'playback', playing: isPlaying, position: Math.round(ytPlayer.getCurrentTime()) });
}

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
  $('#videoFrame').classList.remove('empty-video');
  $('#noVideoState').classList.add('hidden');
  if (!ytPlayer && window.YT?.Player) initYouTubePlayer();
  if (ytPlayer?.loadVideoById) ytPlayer.loadVideoById(videoId);
  updateNowPlaying(videoId);
  setTimeout(updateNowPlayingFromPlayer, 1200);
  if (notifyRoom) sendRealtime({ type: 'video_select', videoId });
}

function initYouTubePlayer() {
  if (ytPlayer || !selectedVideoId || !window.YT?.Player) return;
  ytPlayer = new YT.Player('videoPlayer', {
    videoId: selectedVideoId,
    events: {
      onReady: (event) => {
        ytPlayer = event.target;
        updateNowPlayingFromPlayer() || updateNowPlaying(selectedVideoId);
        setTimeout(updateNowPlayingFromPlayer, 1800);
        updateProgress();
      },
      onStateChange: (event) => {
        updateNowPlayingFromPlayer();
        if (event.data === YT.PlayerState.PLAYING || event.data === YT.PlayerState.PAUSED) {
          isPlaying = event.data === YT.PlayerState.PLAYING;
          updatePlayButton();
          if (!syncingRemotePlayback) sendPlaybackState();
        }
      }
    }
  });
}

window.onYouTubeIframeAPIReady = initYouTubePlayer;
if (window.YT?.Player) setTimeout(initYouTubePlayer, 0);

function appendChatMessage(name, message) {
  $('.chat-empty')?.remove();
  const bubble = document.createElement('div');
  bubble.className = 'chat-message';
  bubble.dataset.author = name;
  bubble.innerHTML = `<span class="avatar avatar-you"></span><div><div class="name-line"><strong></strong><time>now</time></div><p></p></div>`;
  bubble.querySelector('.avatar').textContent = name.slice(0, 1).toUpperCase();
  bubble.querySelector('strong').textContent = name;
  bubble.querySelector('p').textContent = message;
  $('#chatFeed').append(bubble);
  $('#chatFeed').scrollTop = $('#chatFeed').scrollHeight;
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
  const visibleNames = names.length ? names : [userName || 'You'];
  $('#viewerModalCount').textContent = visibleNames.length;
  visibleNames.forEach((name) => {
    const person = document.createElement('div');
    person.className = 'watching-person';
    person.innerHTML = '<span class="avatar avatar-you"></span><strong></strong><span class="person-status"></span>';
    person.querySelector('.avatar').textContent = name.slice(0, 1).toUpperCase();
    person.querySelector('strong').textContent = name;
    list.append(person);
  });
}

function clearQueueView() {
  queueList.innerHTML = '<div class="empty-state queue-empty"><i data-lucide="list-video"></i><strong>Queue masih kosong</strong><span>Tambahkan link YouTube untuk mulai menyusun tontonan.</span><button class="empty-action" id="emptyQueueButton">Add first video</button></div>';
  $('#emptyQueueButton').addEventListener('click', openVideoModal);
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
  presenceRef = ref(roomRef, `presence/${clientId}`);
  set(presenceRef, { name: userName || 'Guest' });
  onDisconnect(presenceRef).remove();
  onValue(ref(roomRef, 'presence'), (snapshot) => {
    const presence = snapshot.val() || {};
    const viewers = Object.values(presence).map((person) => person.name).filter(Boolean);
    $('#viewerCount').textContent = `${viewers.length || 1} watching`;
    document.querySelector('.online-count').lastChild.textContent = ` ${viewers.length || 1} online`;
    renderViewers(viewers);
  });
  onValue(ref(roomRef, 'state'), (snapshot) => {
    roomState = snapshot.val() || {};
    clearQueueView();
    (roomState.queue || []).forEach((videoId) => addQueueItem(videoId, false));
    if (roomState.currentVideoId && roomState.currentVideoId !== selectedVideoId) selectVideo(roomState.currentVideoId, false);
    else showEmptyVideoState();
    if (roomState.lastActor !== clientId) setRemotePlayback(roomState.playing, roomState.position);
  });
  onChildAdded(query(ref(roomRef, 'events'), limitToLast(50)), (snapshot) => {
    const message = snapshot.val();
    if (!message) return;
    if (message.type === 'chat') appendChatMessage(message.name, message.message);
    if (message.type === 'reaction') {
      const button = document.querySelector(`[data-reaction="${message.emoji}"]`);
      const count = button?.querySelector('span');
      if (count) count.textContent = Number(count.textContent) + 1;
    }
  });
  $('#viewerCount').textContent = 'connected';
  document.querySelector('.online-count').lastChild.textContent = ' connected';
  showToast('Terhubung ke Firebase realtime');
}

function leaveRoom() {
  presenceRef?.remove();
  roomRef?.off();
  presenceRef?.off();
  roomRef = null;
  presenceRef = null;
  $('#viewerModal').classList.add('hidden');
  welcomeModal.classList.remove('hidden');
  $('#viewerCount').textContent = 'connecting...';
  document.querySelector('.online-count').lastChild.textContent = ' connecting...';
  history.replaceState(null, '', window.location.pathname + window.location.search);
  showToast('Kamu sudah keluar dari room');
}

function sendRealtime(message) {
  if (!roomRef) return false;
  if (message.type === 'chat' || message.type === 'reaction') {
    push(ref(roomRef, 'events'), { ...message, name: userName || 'Guest', createdAt: Date.now() });
    return true;
  }
  if (message.type === 'queue_add') {
    runTransaction(ref(roomRef, 'state/queue'), (queue = []) => {
      const nextQueue = Array.isArray(queue) ? queue : [];
      return nextQueue.includes(message.videoId) ? nextQueue : [...nextQueue, message.videoId];
    });
    return true;
  }
  if (message.type === 'queue_clear') {
    set(ref(roomRef, 'state/queue'), []);
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

function enterRoom(code) {
  roomCode = code.toUpperCase();
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

if (userName) nameInput.value = userName;
if (userName) enterRoom(roomCode);
else nameInput.focus();

$('#createRoomButton').addEventListener('click', () => {
  if (!validateName()) return;
  enterRoom(Math.random().toString(36).slice(2, 6).toUpperCase());
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
  syncingRemotePlayback = true;
  ytPlayer.seekTo(Number(position) || 0, true);
  if (playing) ytPlayer.playVideo();
  else ytPlayer.pauseVideo();
  sendYouTubeCommand(playing ? 'playVideo' : 'pauseVideo');
  setTimeout(() => { syncingRemotePlayback = false; }, 700);
}

const playButton = $('#playButton');
const controlPlayButton = $('#controlPlayButton');
function togglePlayback() {
  if (!selectedVideoId) return showToast('Pilih video dari queue terlebih dahulu');
  isPlaying = !isPlaying;
  if (ytPlayer?.playVideo && ytPlayer?.pauseVideo) isPlaying ? ytPlayer.playVideo() : ytPlayer.pauseVideo();
  sendYouTubeCommand(isPlaying ? 'playVideo' : 'pauseVideo');
  sendPlaybackState();
  updatePlayButton();
  showToast(isPlaying ? 'Playback dimulai untuk semua orang' : 'Playback dijeda untuk semua orang');
}
playButton.addEventListener('click', togglePlayback);
controlPlayButton.addEventListener('click', togglePlayback);
$('#videoFrame').addEventListener('click', (event) => {
  if (event.target.closest('#playButton, #controlPlayButton, #progressBar, .video-topline')) return;
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
  item.innerHTML = `<span class="drag"><i data-lucide="grip-vertical"></i></span><div class="thumb youtube-thumb" style="background-image:url('https://img.youtube.com/vi/${videoId}/mqdefault.jpg')"></div><div class="queue-copy"><strong>YouTube video · ${videoId}</strong><span>Added just now · ready to watch</span></div><button class="more-button" aria-label="More options"><i data-lucide="more-horizontal"></i></button>`;
  queueList.append(item);
  $('#queueCount').textContent = queueList.querySelectorAll('.queue-item').length;
  if (notifyServer) sendRealtime({ type: 'queue_add', videoId });
  item.addEventListener('click', (event) => {
    if (event.target.closest('.more-button')) return;
    selectVideo(videoId);
    showToast('Video dimuat ke player utama');
  });
  lucide.createIcons();
}

$('#emptyQueueButton').addEventListener('click', openVideoModal);
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
  addQueueItem(videoId);
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
messageForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const message = messageInput.value.trim();
  if (!message) return;
  if (!sendRealtime({ type: 'chat', message })) showToast('Belum terhubung ke room');
  messageInput.value = '';
  $('#chatFeed').scrollTop = $('#chatFeed').scrollHeight;
});

document.querySelectorAll('.reaction').forEach((button) => {
  button.addEventListener('click', () => {
    if (!sendRealtime({ type: 'reaction', emoji: button.dataset.reaction })) return showToast('Belum terhubung ke room');
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
progressBar.addEventListener('pointerdown', () => { isSeeking = true; });
progressBar.addEventListener('pointerup', () => {
  isSeeking = false;
  if (ytPlayer?.seekTo) {
    const seconds = Math.round((Number(progressBar.value) / 100) * (ytPlayer.getDuration() || 0));
    ytPlayer.seekTo(seconds, true);
    sendPlaybackState();
  }
});
progressBar.addEventListener('input', () => {
  const seconds = Math.round((Number(progressBar.value) / 100) * (ytPlayer?.getDuration?.() || 3764));
  currentTime.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  if (ytPlayer?.seekTo) {
    ytPlayer.seekTo(seconds, true);
    sendPlaybackState();
  } else sendYouTubeCommand('seekTo', [seconds, true]);
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
