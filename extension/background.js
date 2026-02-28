// Background script - calls local Flask server for summaries

console.log('🎬 YouTube Summary Service - Background script loaded');

const LOCAL_SERVER = 'http://localhost:5000';
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 3000; // Wait 3s between retries (gives watchdog time to restart)

// Helper: wait ms
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Helper: check if server is reachable
async function isServerUp() {
  try {
    const resp = await fetch(`${LOCAL_SERVER}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(2000)
    });
    return resp.ok;
  } catch {
    return false;
  }
}

// Handle messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getSummary') {
    handleGetSummary(request.videoId)
      .then(response => sendResponse(response))
      .catch(error => sendResponse({
        success: false,
        error: error.message
      }));
    return true; // Keep channel open for async response
  }

  if (request.action === 'validateSummary') {
    handleValidateSummary(request.summary, request.videoId)
      .then(response => sendResponse(response))
      .catch(error => sendResponse({
        success: false,
        error: error.message
      }));
    return true;
  }
});

// Get summary from local server (with retries)
async function handleGetSummary(videoId) {
  try {
    console.log('🎬 Requesting summary for video:', videoId);

    // Check server with retries (watchdog may be restarting it)
    let serverUp = false;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      serverUp = await isServerUp();
      if (serverUp) break;
      console.log(`🎬 Server not ready, retry ${attempt}/${MAX_RETRIES} in ${RETRY_DELAY_MS/1000}s...`);
      if (attempt < MAX_RETRIES) await sleep(RETRY_DELAY_MS);
    }

    if (!serverUp) {
      return {
        success: false,
        error: 'YouTube Summary Service is not running.\n\nPlease start it from the system tray icon (look for the blue "YT" icon near your clock).'
      };
    }

    console.log('🎬 Server is running, requesting summary...');

    // Request summary from local server
    const response = await fetch(`${LOCAL_SERVER}/summarize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ video_id: videoId })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to get summary');
    }

    if (data.success) {
      console.log('🎬 Successfully got summary');
      return {
        success: true,
        data: {
          summary: data.summary,
          duration: data.duration,
          language: data.language
        }
      };
    } else {
      throw new Error(data.error || 'Unknown error');
    }

  } catch (error) {
    console.error('❌ Error getting summary:', error);

    let errorMessage = error.message;

    if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
      errorMessage = 'Cannot connect to YouTube Summary Service.\n\nPlease make sure the service is running (check system tray icon).';
    } else if (error.message.includes('API key')) {
      errorMessage = error.message + '\n\nClick the system tray icon and select "Configure..." to set your API key.';
    }

    return {
      success: false,
      error: errorMessage
    };
  }
}

// Validate a summary using Claude Opus 4.6
async function handleValidateSummary(summary, videoId) {
  try {
    console.log('🔍 Requesting validation for summary, video:', videoId);

    const response = await fetch(`${LOCAL_SERVER}/validate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        summary: summary,
        video_id: videoId
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to validate summary');
    }

    if (data.success) {
      console.log('🔍 Successfully got validation');
      return {
        success: true,
        data: {
          validation: data.validation
        }
      };
    } else {
      throw new Error(data.error || 'Unknown error');
    }

  } catch (error) {
    console.error('❌ Error validating summary:', error);

    let errorMessage = error.message;

    if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
      errorMessage = 'Cannot connect to YouTube Summary Service.';
    }

    return {
      success: false,
      error: errorMessage
    };
  }
}
