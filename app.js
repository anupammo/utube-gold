let deferredPrompt;
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
const fileInput = document.getElementById('fileInput');

// Default backdrop image
playerThumb.style.backgroundImage = "url('https://images.unsplash.com/photo-1614680376593-902f74fa0d41?w=320')";

// 1. Service Worker & Installation Setup
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

// 2. Handle Selected Local File
fileInput.addEventListener('change', (event) => {
  const file = event.target.files[0];
  if (!file) return;

  // Convert local file into an in-memory stream URL (requires zero network/data)
  const localFileUrl = URL.createObjectURL(file);
  
  // Clean up metadata from file name
  const trackName = file.name.replace(/\.[^/.]+$/, ""); // Remove extension
  
  // Assign stream directly to player
  audioPlayer.src = localFileUrl;
  audioPlayer.load();

  audioPlayer.play()
    .then(() => {
      playerThumb.classList.add('playing');
    })
    .catch((e) => console.log("Autoplay deferred:", e));

  // Update Player UI
  currentTrackTitle.textContent = trackName;
  currentTrackArtist.textContent = "Local Offline Track";
  
  // Setup Device System Lock Screen Controls
  setupMediaSession(trackName, "Local Storage");
});

// 3. Audio Player Events
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

// 4. Media Session (For Lock Screen Controls)
function setupMediaSession(title, artist) {
  if (!('mediaSession' in navigator)) return;

  navigator.mediaSession.metadata = new MediaMetadata({
    title: title,
    artist: artist,
    album: 'Offline BG Player',
    artwork: [{ src: 'https://images.unsplash.com/photo-1614680376593-902f74fa0d41?w=320', sizes: '320x320', type: 'image/jpeg' }]
  });

  navigator.mediaSession.setActionHandler('play', () => audioPlayer.play());
  navigator.mediaSession.setActionHandler('pause', () => audioPlayer.pause());
  navigator.mediaSession.setActionHandler('seekto', (details) => {
    audioPlayer.currentTime = details.seekTime;
  });
}