let player;
const silentAudio = document.getElementById('silentAudio');
const loadBtn = document.getElementById('loadBtn');

// Register PWA Service Worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js')
    .then(() => console.log('Service Worker Active'))
    .catch((err) => console.error('Service Worker Registration Failed:', err));
}

// Extract Video ID from various YouTube URL formats
function extractVideoId(url) {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : url;
}

// Triggered when load button is clicked
loadBtn.addEventListener('click', () => {
  const inputVal = document.getElementById('videoUrl').value.trim();
  const videoId = extractVideoId(inputVal);

  if (!videoId) {
    alert('Please enter a valid YouTube Video ID or URL');
    return;
  }

  // Play the silent audio to claim audio context.
  // Must be executed directly within this user-triggered click event.
  silentAudio.play().catch(e => console.log('Silent audio playback deferred:', e));

  if (!player) {
    player = new YT.Player('player', {
      height: '220',
      width: '100%',
      videoId: videoId,
      playerVars: {
        'playsinline': 1, // Crucial for preventing iOS Safari from forcing fullscreen video
        'autoplay': 1,
        'controls': 1
      },
      events: {
        'onReady': onPlayerReady,
        'onStateChange': onPlayerStateChange
      }
    });
  } else {
    player.loadVideoById(videoId);
  }
});

function onPlayerReady(event) {
  event.target.playVideo();
  setupMediaSession();
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

// Bind PWA controls to device OS (lock screen / notification area)
function setupMediaSession() {
  if ('mediaSession' in navigator) {
    // Update metadata (customize as needed)
    navigator.mediaSession.metadata = new MediaMetadata({
      title: 'YouTube Background Player',
      artist: 'PWA WebApp',
      album: 'Background Audio',
      artwork: [
        { src: 'icon-192.png', sizes: '192x192', type: 'image/png' }
      ]
    });

    // Handle OS level play command (when resumed from lock screen)
    navigator.mediaSession.setActionHandler('play', () => {
      if (player) {
        player.playVideo();
        silentAudio.play().catch(() => {});
      }
    });

    // Handle OS level pause command
    navigator.mediaSession.setActionHandler('pause', () => {
      if (player) {
        player.pauseVideo();
        silentAudio.pause();
      }
    });
  }
}