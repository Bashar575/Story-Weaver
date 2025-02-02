// ========================
// CONSTANTS & VARIABLES
// ========================
const API_BASE = 'http://localhost:3000';
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
  tiktok: {
    authUrl: 'https://www.tiktok.com/auth/authorize',
    clientId: 'YOUR_TIKTOK_CLIENT_ID',
    redirectUri: 'http://localhost:3000/auth/tiktok/callback',
    scope: 'user.info.basic,video.list'
  },
  snapchat: {
    authUrl: 'https://accounts.snapchat.com/login/oauth2/authorize',
    clientId: 'YOUR_SNAPCHAT_CLIENT_ID',
    redirectUri: 'http://localhost:3000/auth/snapchat/callback',
    scope: 'snapchat-marketing-api'
  }
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
  apiKey: "YOUR_FIREBASE_API_KEY",
  authDomain: "YOUR_FIREBASE_AUTH_DOMAIN",
  projectId: "YOUR_FIREBASE_PROJECT_ID",
  storageBucket: "YOUR_FIREBASE_STORAGE_BUCKET",
  messagingSenderId: "YOUR_FIREBASE_SENDER_ID",
  appId: "YOUR_FIREBASE_APP_ID"
};

firebase.initializeApp(firebaseConfig);
const storage = firebase.storage();

// GitHub Configuration
const GITHUB_TOKEN = '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';
const REPO_OWNER = 'Bashar575';
const REPO_NAME = 'Story-Weaver.github.io';


// ========================
// DATABASE INITIALIZATION
// ========================
db.version(2).stores({
  connections: 'platform, token, connectedAt',
  drafts: '++id, content, timestamp',
  metrics: 'platform, timestamp'
});

// ========================
// FILE HANDLING
// ========================
document.getElementById('fileInput').addEventListener('change', function(e) {
  const file = e.target.files[0];
  if (file) handleFilePreview(file);
});

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
    document.getElementById('fileInput').files = files;
    handleFilePreview(files[0]);
  }
});

function handleFilePreview(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    document.getElementById('filePreviewContainer').innerHTML = 
      `<img src="${e.target.result}" alt="Preview" class="file-preview">`;
  };
  reader.readAsDataURL(file);
}

// ========================
// UPLOAD FUNCTIONALITY
// ========================
async function uploadFile() {
  const fileInput = document.getElementById('fileInput');
  const file = fileInput.files[0];
  const caption = document.getElementById('storyCaption').value;
  const loadingOverlay = document.getElementById('uploadLoading');

  if (!file) {
    showMessage('Please select a file', 'error');
    return;
  }

  try {
    loadingOverlay.style.display = 'flex';

    // Choose storage provider
    const useFirebase = true; // Toggle between Firebase and GitHub
    let fileURL;

    if (useFirebase) {
      // Firebase Upload
      const filePath = `uploads/${Date.now()}_${file.name}`;
      const storageRef = storage.ref(filePath);
      const snapshot = await storageRef.put(file, {
        customMetadata: {
          caption: caption,
          platforms: getSelectedPlatforms().join(','),
          uploadDate: new Date().toISOString()
        }
      });
      fileURL = await snapshot.ref.getDownloadURL();
    } else {
      // GitHub Upload
      const content = await file.text();
      const base64Content = btoa(unescape(encodeURIComponent(content)));

      const response = await fetch(
        `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/uploads/${file.name}`,
        {
          method: 'PUT',
          headers: {
            Authorization: `token ${GITHUB_TOKEN}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            message: 'Upload via Story Weaver',
            content: base64Content,
            branch: 'main'
          })
        }
      );

      if (!response.ok) throw new Error('GitHub upload failed');
      const data = await response.json();
      fileURL = data.content.download_url;
    }

    // Store metadata
    await db.drafts.add({
      content: {
        fileURL: fileURL,
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
  } catch (error) {
    showMessage(`Upload failed: ${error.message}`, 'error');
  } finally {
    loadingOverlay.style.display = 'none';
  }
}

// ========================
// PLATFORM CONNECTION
// ========================
function handlePlatformConnection(platform) {
  const { authUrl, clientId, redirectUri, scope } = PLATFORM_OAUTH_URLS[platform];
  const authWindow = window.open(
    `${authUrl}?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}`,
    'OAuth2', 
    'width=500,height=600'
  );

  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin) return;
    if (event.data.code) {
      exchangeCodeForToken(platform, event.data.code)
        .then(token => {
          db.connections.put({ 
            platform, 
            token, 
            connectedAt: Date.now() 
          });
          updateConnectionUI(platform);
          showMessage(`${platform.charAt(0).toUpperCase() + platform.slice(1)} connected!`, 'success');
        })
        .catch(error => showMessage(`Connection failed: ${error.message}`, 'error'));
    }
  });
}

async function exchangeCodeForToken(platform, code) {
  const response = await fetch(`${API_BASE}/auth/${platform}/callback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code })
  });
  if (!response.ok) throw new Error('Token exchange failed');
  return (await response.json()).token;
}

// ========================
// UI HELPERS
// ========================
function updateConnectionUI(platform) {
  const button = document.querySelector(`#${platform} .connect-btn`);
  if (button) {
    button.classList.add('connected');
    button.innerHTML = `<i class="fas fa-check-circle"></i> Connected`;
    button.disabled = true;
  }
}

function getSelectedPlatforms() {
  return Array.from(document.querySelectorAll('.platform-option input:checked'))
    .map(input => input.id.replace('Check', '').toLowerCase());
}

function refreshUploadUI() {
  document.getElementById('fileInput').value = '';
  document.getElementById('storyCaption').value = '';
  document.getElementById('filePreviewContainer').innerHTML = '';
  document.querySelectorAll('.platform-option input').forEach(input => {
    input.checked = true;
  });
}

function showMessage(message, type) {
  const errorDisplay = document.getElementById('errorDisplay');
  errorDisplay.textContent = message;
  errorDisplay.className = `error-message visible ${type}`;
  setTimeout(() => errorDisplay.classList.remove('visible'), 3000);
}

// ========================
// INITIALIZATION
// ========================
window.addEventListener('load', async () => {
  initAnalyticsChart();
  
  // Load existing connections
  const connections = await db.connections.toArray();
  connections.forEach(conn => {
    if (platformData[conn.platform]) {
      platformData[conn.platform].connected = true;
      updateConnectionUI(conn.platform);
    }
  });

  // Platform connection handlers
  document.querySelectorAll('.connect-btn').forEach(button => {
    button.addEventListener('click', (e) => {
      const platform = e.target.closest('.platform-card').id;
      handlePlatformConnection(platform);
    });
  });

  // Stats refresh handlers
  document.querySelectorAll('.refresh-btn').forEach(button => {
    button.addEventListener('click', async () => {
      const platform = button.closest('.platform-card').id;
      const connection = await db.connections.get(platform);
      if (connection?.token) {
        showMessage(`Refreshing ${platform} stats...`, 'info');
        // Add actual stats refresh logic here
      } else {
        showMessage(`Please connect to ${platform} first`, 'error');
      }
    });
  });
});

// ========================
// ANALYTICS
// ========================
function initAnalyticsChart() {
  const ctx = document.getElementById('analyticsChart').getContext('2d');
  analyticsChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
      datasets: [{
        label: 'Engagement',
        data: [65, 59, 80, 81, 56, 55],
        borderColor: '#00ffcc',
        backgroundColor: 'rgba(0, 255, 204, 0.1)',
        borderWidth: 2,
        fill: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { grid: { color: 'rgba(255, 255, 255, 0.1)' } },
        y: { grid: { color: 'rgba(255, 255, 255, 0.1)' } }
      },
      plugins: {
        legend: { display: false }
      }
    }
  });
}