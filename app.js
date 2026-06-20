let deferredPrompt;
let playHistory = [];
let isSeeking = false;

const audioPlayer = document.getElementById('audioPlayer');
const playPauseBtn = document.getElementById('playPauseBtn');
const progressBar = document.getElementById('progressBar');
const currentTimeEl = document.getElementById('currentTime');
const totalDurationEl = document.getElementById('totalDuration');
const currentTrackTitle = document.getElementById('currentTrackTitle');
const currentTrackArtist = document.getElementById('currentTrackArtist');
const playerThumb = document.getElementById('playerThumb');

const installBtn = document.getElementById('installBtn');
const loadBtn = document.getElementById('loadBtn');
const videoInput = document.getElementById('videoUrl');
const historyList = document.getElementById('historyList');

const PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.leptons.xyz',
  'https://pipedapi.r4fo.com',
  'https://piped-api.lunar.icu'
];

playerThumb.style.backgroundImage = "url('https://images.unsplash.com/photo-1614680376593-902f74fa0d41?w=320')";

// 1. Service Worker Setup
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

// 2. Fetch Pure Audio Stream from YouTube Bypass APIs
async function fetchAudioStream(videoId) {
  for (const instance of PIPED_INSTANCES) {
    try {
      const res = await fetch(`${instance}/streams/${videoId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.audioStreams && data.audioStreams.length > 0) {
          const bestAudio = data.audioStreams.find(s => s.mimeType.includes('audio/mp4') || s.format === 'M4A') || data.audioStreams[0];
          return {
            streamUrl: bestAudio.url,
            title: data.title || `Track (${videoId})`,
            uploader: data.uploader || 'YouTube Artist',
            thumbnail: data.thumbnailUrl || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`
          };
        }
      }
    } catch (e) {
      console.warn(`Piped Instance ${instance} failed. Trying next...`);
    }
  }
  throw new Error("Unable to parse audio stream. All backends are currently busy.");
}

// 3. User Gesture Preservation Lock (CRUCIAL FOR MOBILE BACKGROUND PLAYBACK)
function loadVideoDirectly(videoId) {
  // We immediately set a silent source to play synchronously. 
  // This satisfies the mobile OS requirement that media starts during a direct tap event.
  audioPlayer.src = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";
  
  audioPlayer.play()
    .then(() => {
      // Once the browser registers the user gesture on this audio element,
      // we can safely execute the async network fetch without losing background privileges.
      playVideo(videoId);
    })
    .catch((e) => {
      console.warn("Silent play boundary failed, falling back to direct play:", e);
      playVideo(videoId);
    });
}

async function playVideo(videoId) {
  currentTrackTitle.textContent = "Loading stream...";
  currentTrackArtist.textContent = "Extracting background audio track...";
  playerThumb.classList.remove('playing');
  
  try {
    const mediaInfo = await fetchAudioStream(videoId);
    
    // Swap source to the fetched stream url (retains the user-initiated play lock)
    audioPlayer.src = mediaInfo.streamUrl;
    audioPlayer.load();
    
    audioPlayer.play()
      .then(() => {
        playerThumb.classList.add('playing');
      })
      .catch((e) => {
        console.error("Stream autoplay failed:", e);
        playPauseBtn.textContent = "▶";
      });

    // Update Player UI
    currentTrackTitle.textContent = mediaInfo.title;
    currentTrackArtist.textContent = mediaInfo.uploader;
    playerThumb.style.backgroundImage = `url('${mediaInfo.thumbnail}')`;

    setupMediaSession(mediaInfo.title, mediaInfo.uploader, mediaInfo.thumbnail);
    addToHistory(videoId, mediaInfo.title, mediaInfo.thumbnail);

  } catch (error) {
    currentTrackTitle.textContent = "Error Loading Stream";
    currentTrackArtist.textContent = error.message;
    alert("Streaming failed. All backend gateways are currently busy.");
  }
}

// 4. Custom Audio Player Events
audioPlayer.addEventListener('timeupdate', () => {
  if (!isSeeking) {
    const progress = (audioPlayer.currentTime / audioPlayer.duration) * 100;
    progressBar.value = isNaN(progress) ? 0 : progress;
    currentTimeEl.textContent = formatTime(audioPlayer.currentTime);
  }
});

audioPlayer.addEventListener('loadedmetadata', () => {
  totalDurationEl.textContent = formatTime(audioPlayer.duration);
});

playPauseBtn.addEventListener('click', () => {
  if (audioPlayer.paused) {
    audioPlayer.play();
  } else {
    audioPlayer.pause();
  }
});

audioPlayer.addEventListener('play', () => {
  playPauseBtn.textContent = "⏸";
  playerThumb.classList.add('playing');
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = "playing";
});

audioPlayer.addEventListener('pause', () => {
  playPauseBtn.textContent = "▶";
  playerThumb.classList.remove('playing');
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = "paused";
});

progressBar.addEventListener('input', () => {
  isSeeking = true;
});

progressBar.addEventListener('change', () => {
  const seekTime = (progressBar.value / 100) * audioPlayer.duration;
  audioPlayer.currentTime = seekTime;
  isSeeking = false;
});

function formatTime(seconds) {
  if (isNaN(seconds)) return "00:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// 5. Media Session Controls (Lock Screen & Background System Actions)
function setupMediaSession(title, artist, thumbnail) {
  if (!('mediaSession' in navigator)) return;

  navigator.mediaSession.metadata = new MediaMetadata({
    title: title,
    artist: artist,
    album: 'BG Player PWA',
    artwork: [{ src: thumbnail, sizes: '320x180', type: 'image/jpeg' }]
  });

  navigator.mediaSession.setActionHandler('play', () => audioPlayer.play());
  navigator.mediaSession.setActionHandler('pause', () => audioPlayer.pause());
  navigator.mediaSession.setActionHandler('seekto', (details) => {
    audioPlayer.currentTime = details.seekTime;
  });
}

// 6. Local Storage JSON History
function initHistory() {
  const data = localStorage.getItem('yt_pwa_history_audio');
  if (data) {
    try {
      playHistory = JSON.parse(data);
    } catch (e) {
      playHistory = [];
    }
  }
  renderHistory();
}

function addToHistory(videoId, title, thumbnail) {
  playHistory = playHistory.filter(item => item.id !== videoId);
  playHistory.unshift({
    id: videoId,
    title: title,
    thumb: thumbnail,
    time: Date.now()
  });

  if (playHistory.length > 20) {
    playHistory.pop();
  }

  localStorage.setItem('yt_pwa_history_audio', JSON.stringify(playHistory));
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

// Boot the history list
initHistory();