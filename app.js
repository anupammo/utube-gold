let player;
let deferredPrompt;
let playHistory = [];

const silentAudio = document.getElementById('silentAudio');
const installBtn = document.getElementById('installBtn');
const loadBtn = document.getElementById('loadBtn');
const videoInput = document.getElementById('videoUrl');
const historyList = document.getElementById('historyList');

// 1. Service Worker & Installation Registration (Using Relative Paths)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js')
    .then(() => console.log('Service Worker active'))
    .catch((err) => console.error('Service Worker Registration failed:', err));
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installBtn.classList.remove('install-hidden');
});

installBtn.addEventListener('click', async () => {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      installBtn.classList.add('install-hidden');
    }
    deferredPrompt = null;
  }
});

// 2. Local Storage (JSON History Management)
function initHistory() {
  const data = localStorage.getItem('yt_pwa_history');
  if (data) {
    try {
      playHistory = JSON.parse(data);
    } catch (e) {
      playHistory = [];
    }
  }
  renderHistory();
}

async function addToHistory(videoId) {
  let title = `Video (${videoId})`;
  
  // Attempt to fetch title via standard YouTube CORS-enabled oEmbed endpoint
  try {
    const res = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
    if (res.ok) {
      const metadata = await res.json();
      title = metadata.title || title;
    }
  } catch (err) {
    console.warn('Metadata fetch failed, defaulting to template label', err);
  }

  // Deduplicate and insert new entry at top
  playHistory = playHistory.filter(item => item.id !== videoId);
  playHistory.unshift({
    id: videoId,
    title: title,
    thumb: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
    time: Date.now()
  });

  // Keep list size limited to 20 tracks
  if (playHistory.length > 20) {
    playHistory.pop();
  }

  localStorage.setItem('yt_pwa_history', JSON.stringify(playHistory));
  renderHistory();
}

function renderHistory() {
  if (playHistory.length === 0) {
    historyList.innerHTML = `<p class="empty-state">No played tracks yet.</p>`;
    return;
  }

  historyList.innerHTML = playHistory.map(item => `
    <div class="history-card" onclick="loadVideoDirectly('${item.id}')">
      <div class="history-thumb" style="background-image: url('${item.thumb}')"></div>
      <div class="history-info">
        <p class="history-title">${escapeHTML(item.title)}</p>
        <p class="history-meta">ID: ${item.id}</p>
      </div>
    </div>
  `).join('');
}

function escapeHTML(str) {
  return str.replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}

// 3. Media Player Controls
function extractVideoId(url) {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : url;
}

loadBtn.addEventListener('click', () => {
  const rawInput = videoInput.value.trim();
  const videoId = extractVideoId(rawInput);
  if (videoId) {
    loadVideoDirectly(videoId);
    videoInput.value = '';
  } else {
    alert('Please enter a valid YouTube ID or URL');
  }
});

function loadVideoDirectly(videoId) {
  // Silent audio must be triggered here to secure audio session context
  silentAudio.play().catch(() => {});

  if (!player) {
    player = new YT.Player('player', {
      height: '100%',
      width: '100%',
      videoId: videoId,
      playerVars: {
        'playsinline': 1,
        'autoplay': 1,
        'controls': 1
      },
      events: {
        'onReady': (event) => {
          event.target.playVideo();
          setupMediaSession(videoId);
        },
        'onStateChange': onPlayerStateChange
      }
    });
  } else {
    player.loadVideoById(videoId);
    setupMediaSession(videoId);
  }

  addToHistory(videoId);
}

function onPlayerStateChange(event) {
  if ('mediaSession' in navigator) {
    if (event.data === YT.PlayerState.PLAYING) {
      navigator.mediaSession.playbackState = "playing";
      silentAudio.play().catch(() => {});
    } else if (event.data === YT.PlayerState.PAUSED) {
      navigator.mediaSession.playbackState = "paused";
      silentAudio.pause();
    }
  }
}

// 4. Media Session Integration (For System-Level lock screen controls)
async function setupMediaSession(videoId) {
  if (!('mediaSession' in navigator)) return;

  let title = "Background Stream";
  try {
    const res = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
    if (res.ok) {
      const data = await res.json();
      title = data.title || title;
    }
  } catch (err) {}

  navigator.mediaSession.metadata = new MediaMetadata({
    title: title,
    artist: 'PWA Background Player',
    album: 'YouTube Playlist',
    artwork: [
      { src: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`, sizes: '320x180', type: 'image/jpeg' }
    ]
  });

  navigator.mediaSession.setActionHandler('play', () => {
    if (player) {
      player.playVideo();
      silentAudio.play().catch(() => {});
    }
  });

  navigator.mediaSession.setActionHandler('pause', () => {
    if (player) {
      player.pauseVideo();
      silentAudio.pause();
    }
  });
}

// Initialize history on boot
initHistory();