// Background script - calls local Flask server for summaries

console.log('🎬 YouTube Summary Service - Background script loaded');

const LOCAL_SERVER = 'http://localhost:5000';

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
});

// Get summary from local server
async function handleGetSummary(videoId) {
  try {
    console.log('🎬 Requesting summary for video:', videoId);
    
    // Check if server is running
    try {
      const healthCheck = await fetch(`${LOCAL_SERVER}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(2000) // 2 second timeout
      });
      
      if (!healthCheck.ok) {
        throw new Error('Server returned error');
      }
    } catch (error) {
      console.error('❌ Server health check failed:', error);
      return {
        success: false,
        error: 'YouTube Summary Service is not running.\\n\\nPlease start it from the system tray icon (look for the blue "YT" icon near your clock).'
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
    
    // Provide helpful error messages
    let errorMessage = error.message;
    
    if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
      errorMessage = 'Cannot connect to YouTube Summary Service.\\n\\nPlease make sure the service is running (check system tray icon).';
    } else if (error.message.includes('API key')) {
      errorMessage = error.message + '\\n\\nClick the system tray icon and select "Configure..." to set your API key.';
    }
    
    return {
      success: false,
      error: errorMessage
    };
  }
}
