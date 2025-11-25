// Content script for detecting YouTube video hovers and displaying summaries

console.log('🎬 YouTube Transcript Summarizer - Content script loaded!');

// Prevent multiple initializations
if (window.ytSummarizerInitialized) {
  console.log('🎬 Already initialized, not running again');
} else {
  console.log('🎬 First initialization, setting up...');
  window.ytSummarizerInitialized = true;
  
  // Now run the actual initialization
  (function() {
    let currentTooltip = null;
    let hoverTimeout = null;
    let summaryCache = new Map();

    // Initialize the extension
    function init() {
      console.log('🎬 YouTube Transcript Summarizer - Initializing...');
      
      // Clear any old markers  from previous loads
      const oldMarkers = document.querySelectorAll('[data-summarizer-attached]');
      console.log(`🎬 Found ${oldMarkers.length} old markers to clear`);
      oldMarkers.forEach(el => {
        delete el.dataset.summarizerAttached;
      });
      
      observeVideoThumbnails();
      console.log('🎬 YouTube Transcript Summarizer - Initialization complete!');
    }

    // Observe for dynamically loaded video thumbnails
    function observeVideoThumbnails() {
      const observer = new MutationObserver((mutations) => {
        attachHoverListeners();
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true
      });

      attachHoverListeners();
    }

    // Attach hover listeners to video thumbnails
    function attachHoverListeners() {
      // Select all video thumbnail links - try multiple selectors for YouTube's different layouts
      const selectors = [
        'a#thumbnail',
        'a.ytd-thumbnail',
        'ytd-thumbnail a',
        'a#video-title-link',
        'a.yt-simple-endpoint.ytd-thumbnail',
        'a.yt-lockup-view-model__content-image',  // New YouTube layout
        'ytd-rich-item-renderer a',
        'ytd-video-renderer a#thumbnail'
      ];
      
      let videoLinks = [];
      for (const selector of selectors) {
        const links = document.querySelectorAll(selector);
        if (links.length > 0) {
          videoLinks = [...videoLinks, ...links];
        }
      }
      
      // Remove duplicates
      videoLinks = [...new Set(videoLinks)];
      
      console.log(`🎬 Found ${videoLinks.length} video thumbnails to attach listeners to`);
      
      if (videoLinks.length === 0) {
        console.warn('⚠️ No video thumbnails found! YouTube layout might have changed.');
        console.log('Current URL:', window.location.href);
        return;
      }
      
      let attachedCount = 0;
      
      videoLinks.forEach((link, index) => {
        // Remove old listeners if they exist
        if (link._ytMouseEnter) {
          link.removeEventListener('mouseenter', link._ytMouseEnter);
        }
        if (link._ytMouseLeave) {
          link.removeEventListener('mouseleave', link._ytMouseLeave);
        }
        
        // Create new handlers
        const mouseEnterHandler = (e) => {
          console.log('🎬 Mouse entered video thumbnail');
          
          // CRITICAL: Capture the element NOW, before setTimeout
          // e.currentTarget becomes null after the event completes
          const targetElement = e.currentTarget;
          
          hoverTimeout = setTimeout(() => {
            console.log('🎬 Hover timeout reached, handling video hover');
            handleVideoHover(targetElement);  // Use captured element
          }, 800);
        };
        
        const mouseLeaveHandler = () => {
          console.log('🎬 Mouse left video thumbnail');
          if (hoverTimeout) {
            clearTimeout(hoverTimeout);
            hoverTimeout = null;
          }
          removeTooltip();
        };
        
        // Store handlers on element for future removal
        link._ytMouseEnter = mouseEnterHandler;
        link._ytMouseLeave = mouseLeaveHandler;
        
        // Add listeners
        link.addEventListener('mouseenter', mouseEnterHandler);
        link.addEventListener('mouseleave', mouseLeaveHandler);
        
        attachedCount++;
      });
      
      console.log(`🎬 Attached listeners to ${attachedCount} thumbnails`);
    }

    // Extract video ID from YouTube URL or element
    function extractVideoId(element) {
      console.log('🎬 extractVideoId called with:', element, 'type:', typeof element);
      
      if (!element) {
        console.error('❌ extractVideoId: element is null or undefined');
        return null;
      }
      
      // If element is not an anchor tag, try to find parent anchor
      let linkElement = element;
      
      console.log('🎬 Element tagName:', element.tagName);
      
      if (element.tagName !== 'A') {
        console.log('🎬 Element is not an A tag, searching for parent...');
        linkElement = element.closest('a');
        console.log('🎬 Found parent link:', linkElement);
      }
      
      if (!linkElement) {
        console.warn('⚠️ Could not find link element for:', element);
        return null;
      }
      
      const href = linkElement.href;
      if (!href) {
        console.warn('⚠️ Link element has no href:', linkElement);
        return null;
      }
      
      console.log('🎬 Extracting video ID from href:', href);
      
      // Match various YouTube URL formats
      const patterns = [
        /[?&]v=([^&]+)/,           // ?v=VIDEO_ID
        /\/shorts\/([^/?]+)/,      // /shorts/VIDEO_ID
        /\/embed\/([^/?]+)/,       // /embed/VIDEO_ID
        /^([a-zA-Z0-9_-]{11})$/    // Direct ID
      ];
      
      for (const pattern of patterns) {
        const match = href.match(pattern);
        if (match) {
          console.log('🎬 Extracted video ID:', match[1]);
          return match[1];
        }
      }
      
      console.warn('⚠️ Could not extract video ID from href:', href);
      return null;
    }

    // Handle video hover event
    async function handleVideoHover(element) {
      console.log('🎬 handleVideoHover called with element:', element);
      
      if (!element) {
        console.error('❌ handleVideoHover called with null element');
        return;
      }
      
      const videoId = extractVideoId(element);
      console.log('🎬 Extracted video ID:', videoId);
      
      if (!videoId) {
        console.warn('⚠️ Could not extract video ID from element:', element);
        return;
      }
      
      // Check cache first
      if (summaryCache.has(videoId)) {
        console.log('🎬 Using cached summary for video:', videoId);
        showTooltip(element, summaryCache.get(videoId));
        return;
      }
      
      // Show loading tooltip
      console.log('🎬 Showing loading tooltip');
      showTooltip(element, { status: 'loading' });
      
      try {
        // Request transcript and summary from background script
        console.log('🎬 Sending message to background script for video:', videoId);
        const response = await chrome.runtime.sendMessage({
          action: 'getSummary',
          videoId: videoId
        });
        
        console.log('🎬 Received response from background:', response);
        
        if (response.success) {
          summaryCache.set(videoId, response.data);
          showTooltip(element, response.data);
        } else {
          console.error('❌ Error from background script:', response.error);
          showTooltip(element, { 
            status: 'error', 
            message: response.error || 'Failed to get summary' 
          });
        }
      } catch (error) {
        console.error('❌ Error in handleVideoHover:', error);
        showTooltip(element, { 
          status: 'error', 
          message: 'Extension error occurred' 
        });
      }
    }

    // Show tooltip with summary
    function showTooltip(element, data) {
      removeTooltip();
      
      const tooltip = document.createElement('div');
      tooltip.className = 'yt-transcript-summary-tooltip';
      tooltip.id = 'yt-summary-tooltip';
      
      if (data.status === 'loading') {
        tooltip.innerHTML = `
          <div class="summary-loading">
            <div class="spinner"></div>
            <p>Generating summary...</p>
          </div>
        `;
      } else if (data.status === 'error') {
        tooltip.innerHTML = `
          <div class="summary-error">
            <p><strong>⚠️ Error</strong></p>
            <p>${data.message}</p>
          </div>
        `;
      } else {
        tooltip.innerHTML = `
          <div class="summary-content">
            <div class="summary-header">
              <span class="summary-icon">📝</span>
              <span class="summary-title">AI Summary</span>
            </div>
            <p class="summary-text">${data.summary}</p>
            <div class="summary-footer">
              <small>Duration: ${data.duration || 'N/A'} • Powered by AI</small>
            </div>
          </div>
        `;
      }
      
      document.body.appendChild(tooltip);
      positionTooltip(tooltip, element);
      currentTooltip = tooltip;
      
      console.log('🎬 Tooltip displayed');
    }

    // Position tooltip near the hovered element
    function positionTooltip(tooltip, element) {
      const rect = element.getBoundingClientRect();
      const tooltipRect = tooltip.getBoundingClientRect();
      
      let left = rect.right + 10;
      let top = rect.top;
      
      // Adjust if tooltip would go off-screen
      if (left + tooltipRect.width > window.innerWidth) {
        left = rect.left - tooltipRect.width - 10;
      }
      
      if (top + tooltipRect.height > window.innerHeight) {
        top = window.innerHeight - tooltipRect.height - 10;
      }
      
      if (top < 0) {
        top = 10;
      }
      
      tooltip.style.left = `${left + window.scrollX}px`;
      tooltip.style.top = `${top + window.scrollY}px`;
    }

    // Remove existing tooltip
    function removeTooltip() {
      if (currentTooltip) {
        currentTooltip.remove();
        currentTooltip = null;
        console.log('🎬 Tooltip removed');
      }
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  })();
}
