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
  apiKey: "AIzaSyCVnk08gIu8FxxVpBJZF1XqISJoVzeLBHI",
  authDomain: "web-weaver-cda29.firebaseapp.com",
  projectId: "web-weaver-cda29",
  storageBucket: "web-weaver-cda29.appspot.com",
  messagingSenderId: "384391887170",
  appId: "1:384391887170:web:eac82ad449276ebb56f0db",
  measurementId: "G-S54F8VX9GH"
};

firebase.initializeApp(firebaseConfig);
const storage = firebase.storage();

// GitHub Configuration
const GITHUB_TOKEN = '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'; // Replace with your token
const REPO_OWNER = 'Bashar575'; // Replace with your GitHub username
const REPO_NAME = 'Story-Weaver.github.io'; // Replace with your repository name

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
  const fileInput = document.getElementById('fileInput');
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

    // Choose between Firebase or GitHub upload
    const useFirebase = true; // Set to false to use GitHub instead
    let fileURL;

    if (useFirebase) {
      // Upload to Firebase
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
      // Upload to GitHub
      const content = await file.text();
      const base64Content = btoa(content);

      const response = await fetch(
        `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/uploads/${file.name}`,
        {
          method: 'PUT',
          headers: {
            Authorization: `token ${GITHUB_TOKEN}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            message: 'File upload',
            content: base64Content
          })
        }
      );

      if (!response.ok) throw new Error('Upload failed');
      const data = await response.json();
      fileURL = data.content.download_url;
    }

    // Store metadata in Dexie
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
// HELPER FUNCTIONS
// ========================
function getSelectedPlatforms() {
  return Array.from(document.querySelectorAll('.platform-option input:checked'))
    .map(input => input.id.replace('Check', '').toLowerCase());
}

function refreshUploadUI() {
  document.getElementById('fileInput').value = '';
  document.getElementById('storyCaption').value = '';
  document.getElementById('filePreviewContainer').innerHTML = ''; // Clear file preview
  document.querySelectorAll('.platform-option input').forEach(input => {
    input.checked = true; // Reset to default checked state
  });
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
    document.getElementById('fileInput').files = files;
    handleFilePreview(files[0]); // Show preview of the dropped file
  }
});

// ========================
// FILE PREVIEW FUNCTIONALITY
// ========================
function handleFilePreview(file) {
  const reader = new FileReader();
  reader.onload = function (e) {
    const filePreviewContainer = document.getElementById('filePreviewContainer');
    filePreviewContainer.innerHTML = `<img src="${e.target.result}" alt="Selected file preview">`;
  };
  reader.readAsDataURL(file);
}

document.getElementById('fileInput').addEventListener('change', function (e) {
  const file = e.target.files[0];
  if (file) {
    handleFilePreview(file); // Show preview of the selected file
  }
});

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

// ========================
// MESSAGE DISPLAY
// ========================
function showMessage(message, type) {
  const errorDisplay = document.getElementById('errorDisplay');
  errorDisplay.textContent = message;
  errorDisplay.classList.add('visible', type);

  setTimeout(() => {
    errorDisplay.classList.remove('visible', type);
  }, 3000);
}

// ========================
// ANALYTICS CHART INITIALIZATION
// ========================
function initAnalyticsChart() {
  const ctx = document.getElementById('analyticsChart').getContext('2d');
  analyticsChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: 'Engagement',
        data: [],
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