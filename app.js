let deferredPrompt;
let isSeeking = false;
let currentAudioUrl = null;
let currentThumbUrl = null;

const audioPlayer = document.getElementById('audioPlayer');
const playPauseBtn = document.getElementById('playPauseBtn');
const progressBar = document.getElementById('progressBar');
const currentTimeEl = document.getElementById('currentTime');
const totalDurationEl = document.getElementById('totalDuration');
const currentTrackTitle = document.getElementById('currentTrackTitle');
const currentTrackArtist = document.getElementById('currentTrackArtist');
const playerThumb = document.getElementById('playerThumb');

const installBtn = document.getElementById('installBtn');
const downloadBtn = document.getElementById('downloadBtn');
const videoInput = document.getElementById('videoUrl');
const offlineList = document.getElementById('offlineList');
const statusMsg = document.getElementById('statusMsg');

const DEFAULT_ART = "https://images.unsplash.com/photo-1614680376593-902f74fa0d41?w=320";
playerThumb.style.backgroundImage = `url('${DEFAULT_ART}')`;

const PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.leptons.xyz',
  'https://pipedapi.r4fo.com',
  'https://piped-api.lunar.icu'
];

const DB_NAME = 'OfflineMP3PlayerDB';
const DB_VERSION = 1;
const STORE_NAME = 'mp3_tracks';

// 1. IndexedDB Core Logic
function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

async function saveTrackToDB(track) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(track);
    request.onsuccess = () => resolve();
    request.onerror = (e) => reject(e.target.error);
  });
}

async function getAllTracksFromDB() {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

async function getTrackFromDB(id) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

async function deleteTrackFromDB(id) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = (e) => reject(e.target.error);
  });
}

// 2. Resolve YouTube API Metadata
async function fetchAudioMetadata(videoId) {
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
            thumbnailUrl: data.thumbnailUrl || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`
          };
        }
      }
    } catch (e) {
      console.warn(`Instance failed: ${instance}. Rotating...`);
    }
  }
  throw new Error("API decoding failed. Decryptor servers are busy.");
}

// 3. Audio File Downloader (With CORS Bypass Proxy Fallback)
async function fetchAudioFileAsBlob(streamUrl) {
  try {
    const res = await fetch(streamUrl);
    if (res.ok) return await res.blob();
  } catch (err) {
    console.warn("Direct download failed due to CORS. Retrying via secure CORS proxy...", err);
  }

  // Fallback to CORS proxy to prevent stream failures
  const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(streamUrl)}`;
  const res = await fetch(proxyUrl);
  if (!res.ok) throw new Error("CORS Proxy down. Streaming file was blocked.");
  return await res.blob();
}

async function startDownload(videoId) {
  statusMsg.textContent = "Connecting to decrypter...";
  downloadBtn.disabled = true;

  try {
    const metadata = await fetchAudioMetadata(videoId);
    
    statusMsg.textContent = "Downloading MP3 stream to app...";
    const audioBlob = await fetchAudioFileAsBlob(metadata.streamUrl);

    statusMsg.textContent = "Caching metadata graphics...";
    let thumbnailBlob = null;
    try {
      // Proxy thumbnail to bypass any strict image domain security policies
      const imgProxyUrl = `https://corsproxy.io/?${encodeURIComponent(metadata.thumbnailUrl)}`;
      const imgRes = await fetch(imgProxyUrl);
      if (imgRes.ok) {
        thumbnailBlob = await imgRes.blob();
      }
    } catch (err) {
      console.warn("Could not cash track art locally.", err);
    }

    // Insert as physical file block directly inside the IndexedDB sandbox
    await saveTrackToDB({
      id: videoId,
      title: metadata.title,
      uploader: metadata.uploader,
      audioBlob: audioBlob,
      thumbnailBlob: thumbnailBlob,
      savedAt: Date.now()
    });

    statusMsg.textContent = "Success! Saved in your offline library.";
    videoInput.value = "";
    loadOfflineList();

  } catch (err) {
    statusMsg.textContent = `Error: ${err.message}`;
  } finally {
    downloadBtn.disabled = false;
    setTimeout(() => { statusMsg.textContent = ""; }, 5000);
  }
}

// 4. Mount and play offline tracks
async function playOfflineTrack(id) {
  const track = await getTrackFromDB(id);
  if (!track) return alert("Error reading track parameters.");

  // Clear obsolete Blob mappings to free local device memory
  cleanupObjectUrls();

  currentAudioUrl = URL.createObjectURL(track.audioBlob);
  currentThumbUrl = track.thumbnailBlob ? URL.createObjectURL(track.thumbnailBlob) : DEFAULT_ART;

  audioPlayer.src = currentAudioUrl;
  audioPlayer.load();

  audioPlayer.play()
    .then(() => playerThumb.classList.add('playing'))
    .catch(() => playPauseBtn.textContent = "▶");

  currentTrackTitle.textContent = track.title;
  currentTrackArtist.textContent = track.uploader;
  playerThumb.style.backgroundImage = `url('${currentThumbUrl}')`;

  setupMediaSession(track.title, track.uploader, currentThumbUrl);
}

function cleanupObjectUrls() {
  if (currentAudioUrl) {
    URL.revokeObjectURL(currentAudioUrl);
    currentAudioUrl = null;
  }
  if (currentThumbUrl && currentThumbUrl !== DEFAULT_ART) {
    URL.revokeObjectURL(currentThumbUrl);
    currentThumbUrl = null;
  }
}

// 5. Build dynamic list from IndexedDB records
async function loadOfflineList() {
  const tracks = await getAllTracksFromDB();
  if (tracks.length === 0) {
    offlineList.innerHTML = `<p class="empty-state">Your library is empty. Download a track above to get started.</p>`;
    return;
  }

  offlineList.innerHTML = tracks.map(track => {
    const thumbUrl = track.thumbnailBlob ? URL.createObjectURL(track.thumbnailBlob) : DEFAULT_ART;
    return `
      <div class="history-card" onclick="playOfflineTrack('${track.id}')">
        <div class="history-thumb" style="background-image: url('${thumbUrl}')"></div>
        <div class="history-info">
          <p class="history-title">${escapeHTML(track.title)}</p>
          <p class="history-meta">${escapeHTML(track.uploader)}</p>
        </div>
        <button class="btn-delete" onclick="event.stopPropagation(); removeTrack('${track.id}')">🗑</button>
      </div>
    `;
  }).join('');
}

async function removeTrack(id) {
  if (confirm("Delete this track from your offline library?")) {
    await deleteTrackFromDB(id);
    loadOfflineList();
  }
}

// 6. Audio Player Handlers
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

progressBar.addEventListener('input', () => { isSeeking = true; });
progressBar.addEventListener('change', () => {
  audioPlayer.currentTime = (progressBar.value / 100) * audioPlayer.duration;
  isSeeking = false;
});

function formatTime(seconds) {
  if (isNaN(seconds)) return "00:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// 7. System Lock Screen Controls
function setupMediaSession(title, artist, thumbnail) {
  if (!('mediaSession' in navigator)) return;

  navigator.mediaSession.metadata = new MediaMetadata({
    title: title,
    artist: artist,
    album: 'Offline BG Player',
    artwork: [{ src: thumbnail, sizes: '320x180', type: 'image/jpeg' }]
  });

  navigator.mediaSession.setActionHandler('play', () => audioPlayer.play());
  navigator.mediaSession.setActionHandler('pause', () => audioPlayer.pause());
  navigator.mediaSession.setActionHandler('seekto', (details) => {
    audioPlayer.currentTime = details.seekTime;
  });
}

function escapeHTML(str) {
  return str.replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag));
}

function extractVideoId(url) {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : url;
}

downloadBtn.addEventListener('click', () => {
  const rawInput = videoInput.value.trim();
  const videoId = extractVideoId(rawInput);
  if (videoId) {
    startDownload(videoId);
  } else {
    alert('Please enter a valid YouTube ID or URL');
  }
});

// Load stored entries on bootup
loadOfflineList();