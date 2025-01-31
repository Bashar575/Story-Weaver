// ========================
// CONSTANTS & VARIABLES
// ========================
const API_BASE = 'http://localhost:3000'; // Backend server URL
const PLATFORM_OAUTH_URLS = {
  youtube: {
    authUrl: 'https://accounts.google.com/o/oauth2/auth',
    clientId: 'YOUR_YOUTUBE_CLIENT_ID',
    redirectUri: 'http://localhost:3000/auth/youtube/callback',
    scope: 'https://www.googleapis.com/auth/youtube.readonly'
  },
  instagram: {
    authUrl: 'https://api.instagram.com/oauth/authorize',
    clientId: 'YOUR_INSTAGRAM_CLIENT_ID',
    redirectUri: 'http://localhost:3000/auth/instagram/callback',
    scope: 'user_profile,user_media'
  },
  // Add TikTok and Snapchat OAuth URLs and credentials
};

const platformData = {
  youtube: { connected: false, stats: { views: 0, subs: 0 } },
  instagram: { connected: false, stats: { followers: 0, engagement: 0 } },
  tiktok: { connected: false, stats: { followers: 0, views: 0 } },
  snapchat: { connected: false, stats: { views: 0, snaps: 0 } }
};

const db = new Dexie('StoryWeaverDB');
let analyticsChart;

// Initialize Firebase
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_BUCKET.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};
firebase.initializeApp(firebaseConfig);
const storage = firebase.storage();

// ========================
// DATABASE INITIALIZATION
// ========================
db.version(2).stores({
  connections: 'platform, token, connectedAt',
  drafts: '++id, content, timestamp',
  metrics: 'platform, timestamp'
});

// ========================
// FILE UPLOAD FUNCTIONALITY
// ========================
async function uploadFile() {
  const fileInput = document.getElementById('storyUpload');
  const file = fileInput.files[0];
  const caption = document.getElementById('storyCaption').value;
  const loadingOverlay = document.getElementById('uploadLoading');

  if (!file) {
    showMessage('Please select a file', 'error');
    return;
  }

  try {
    // Show loading state
    loadingOverlay.style.display = 'flex';
    
    // Create storage reference with organized path
    const filePath = `uploads/${Date.now()}_${file.name}`;
    const storageRef = storage.ref(filePath);
    
    // Upload file with metadata
    const snapshot = await storageRef.put(file, {
      customMetadata: {
        caption: caption,
        platforms: getSelectedPlatforms().join(','),
        uploadDate: new Date().toISOString()
      }
    });
    
    // Get download URL
    const downloadURL = await snapshot.ref.getDownloadURL();

    // Store metadata in Dexie
    await db.drafts.add({
      content: {
        fileURL: downloadURL,
        caption: caption,
        platforms: getSelectedPlatforms(),
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size
      },
      timestamp: Date.now()
    });

    showMessage('File uploaded successfully!', 'success');
    refreshUploadUI();
    updateUploadHistory();
  } catch (error) {
    showMessage(`Upload failed: ${error.message}`, 'error');
  } finally {
    loadingOverlay.style.display = 'none';
  }
}

// ========================
// HELPER FUNCTIONS
// ========================
function getSelectedPlatforms() {
  return Array.from(document.querySelectorAll('.platform-option input:checked'))
    .map(input => input.id.replace('Check', '').toLowerCase());
}

function refreshUploadUI() {
  document.getElementById('storyUpload').value = '';
  document.getElementById('storyCaption').value = '';
  document.querySelectorAll('.platform-option input').forEach(input => {
    input.checked = true; // Reset to default checked state
  });
}

async function updateUploadHistory() {
  const uploads = await db.drafts.reverse().toArray();
  // Implement your UI update logic for showing upload history
}

// ========================
// DRAG & DROP HANDLING
// ========================
const uploadArea = document.getElementById('uploadArea');

uploadArea.addEventListener('dragover', (e) => {
  e.preventDefault();
  uploadArea.classList.add('dragover');
});

uploadArea.addEventListener('dragleave', () => {
  uploadArea.classList.remove('dragover');
});

uploadArea.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadArea.classList.remove('dragover');
  const files = e.dataTransfer.files;
  if (files.length > 0) {
    document.getElementById('storyUpload').files = files;
    uploadFile();
  }
});

// ========================
// PLATFORM CONNECTION HANDLERS
// ========================
function handlePlatformConnection(platform) {
  const oauthConfig = PLATFORM_OAUTH_URLS[platform];
  if (!oauthConfig) {
    showMessage(`Platform ${platform} is not supported.`, 'error');
    return;
  }

  // Redirect to platform's OAuth page
  const authUrl = `${oauthConfig.authUrl}?client_id=${oauthConfig.clientId}&redirect_uri=${oauthConfig.redirectUri}&response_type=code&scope=${oauthConfig.scope}`;
  const authWindow = window.open(authUrl, `${platform}Auth`, 'width=600,height=700,menubar=no,toolbar=no,location=no,status=no');

  // Check if the popup was blocked
  if (!authWindow) {
    showMessage('Popup blocked! Please allow popups for this site.', 'error');
    return;
  }

  // Listen for OAuth callback
  const connectionHandler = async (e) => {
    if (e.data?.platform === platform && e.data.code) {
      window.removeEventListener('message', connectionHandler);

      try {
        // Exchange code for access token
        const response = await fetch(`${API_BASE}/api/auth/${platform}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: e.data.code, redirectUri: oauthConfig.redirectUri })
        });

        if (!response.ok) throw new Error('Failed to authenticate');

        const { access_token } = await response.json();

        // Store token and mark as connected
        platformData[platform].connected = true;
        await db.connections.put({
          platform,
          token: access_token,
          connectedAt: Date.now()
        });

        updateConnectionUI(platform);
        fetchPlatformStats(platform, access_token);
        showMessage(`${platform} connected successfully!`, 'success');
      } catch (error) {
        showMessage(`Connection failed: ${error.message}`, 'error');
      }
    }
  };

  window.addEventListener('message', connectionHandler);
}

// Fetch platform stats using API
async function fetchPlatformStats(platform, accessToken) {
  try {
    let stats = {};
    switch (platform) {
      case 'youtube':
        stats = await fetchYouTubeStats(accessToken);
        break;
      case 'instagram':
        stats = await fetchInstagramStats(accessToken);
        break;
      // Add cases for TikTok and Snapchat
    }

    platformData[platform].stats = stats;
    updatePlatformStatsUI(platform);
  } catch (error) {
    showMessage(`Failed to fetch ${platform} stats: ${error.message}`, 'error');
  }
}

// Example: Fetch YouTube stats
async function fetchYouTubeStats(accessToken) {
  const response = await fetch('https://www.googleapis.com/youtube/v3/channels?part=statistics&mine=true', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (!response.ok) throw new Error('Failed to fetch YouTube stats');

  const data = await response.json();
  return {
    views: data.items[0].statistics.viewCount,
    subs: data.items[0].statistics.subscriberCount
  };
}

// Example: Fetch Instagram stats
async function fetchInstagramStats(accessToken) {
  const response = await fetch('https://graph.instagram.com/me?fields=id,username,media_count', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (!response.ok) throw new Error('Failed to fetch Instagram stats');

  const data = await response.json();
  return {
    followers: data.followers_count, // Requires additional API call
    engagement: 0 // Calculate engagement rate
  };
}

// Update platform stats in UI
function updatePlatformStatsUI(platform) {
  const stats = platformData[platform].stats;
  switch (platform) {
    case 'youtube':
      document.getElementById('yt-views').textContent = stats.views;
      document.getElementById('yt-subs').textContent = stats.subs;
      break;
    case 'instagram':
      document.getElementById('ig-followers').textContent = stats.followers;
      document.getElementById('ig-engagement').textContent = `${stats.engagement}%`;
      break;
    // Add cases for TikTok and Snapchat
  }
}

// ========================
// NOTIFICATION SYSTEM
// ========================
function showMessage(message, type = 'info') {
  const notification = document.getElementById('errorDisplay');
  notification.textContent = message;
  notification.className = `error-message ${type}`;
  notification.classList.add('visible');

  setTimeout(() => {
    notification.classList.remove('visible');
  }, 3000);
}

// ========================
// ANALYTICS & CHART
// ========================
function initAnalyticsChart() {
  const ctx = document.getElementById('analyticsChart').getContext('2d');
  analyticsChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: Array.from({ length: 24 }, (_, i) => `${i}:00`),
      datasets: [{
        label: 'Engagement Rate',
        data: Array.from({ length: 24 }, () => Math.random() * 100),
        borderColor: '#00ffcc',
        tension: 0.4
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { labels: { color: '#fff' } }
      },
      scales: {
        x: { ticks: { color: '#fff' } },
        y: { ticks: { color: '#fff' } }
      }
    }
  });
}

// ========================
// INITIALIZATION
// ========================
window.addEventListener('load', async () => {
  // Initialize chart
  initAnalyticsChart();

  // Load connections from DB
  const connections = await db.connections.toArray();
  connections.forEach(conn => {
    if (platformData[conn.platform]) {
      platformData[conn.platform].connected = true;
      updateConnectionUI(conn.platform);
      fetchPlatformStats(conn.platform, conn.token);
    }
  });

  // Set up platform connection buttons
  document.querySelectorAll('.connect-btn').forEach(button => {
    button.addEventListener('click', (e) => {
      const platform = e.target.closest('.platform-card').id;
      handlePlatformConnection(platform);
    });
  });

  // Set up platform refresh buttons
  document.querySelectorAll('.refresh-btn').forEach(button => {
    button.addEventListener('click', () => {
      const platform = button.closest('.platform-card').id;
      refreshPlatformStats(platform);
    });
  });
});

// Refresh platform stats
async function refreshPlatformStats(platform) {
  const connection = await db.connections.get(platform);
  if (connection?.token) {
    fetchPlatformStats(platform, connection.token);
  } else {
    showMessage(`Please connect to ${platform} first.`, 'error');
  }
}