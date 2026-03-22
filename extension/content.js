// Content script for detecting YouTube video hovers and displaying summaries

console.log('🎬 YouTube Transcript Summarizer - Content script loaded!');

// Prevent multiple initializations
if (window.ytSummarizerInitialized) {
  console.log('🎬 Already initialized, not running again');
} else {
  console.log('🎬 First initialization, setting up...');
  window.ytSummarizerInitialized = true;
  
  (function() {
    let currentTooltip = null;
    let validationTooltip = null;
    let hoverTimeout = null;
    let summaryCache = new Map();
    let tooltipHovered = false;
    let thumbnailHovered = false;
    let currentVideoId = null;
    let currentSummaryText = null;
    let currentValidationText = null;
    let dismissTimeout = null;
    let validationInProgress = false;

    function init() {
      console.log('🎬 YouTube Transcript Summarizer - Initializing...');
      
      const oldMarkers = document.querySelectorAll('[data-summarizer-attached]');
      oldMarkers.forEach(el => {
        delete el.dataset.summarizerAttached;
      });
      
      // Close tooltips when clicking elsewhere
      document.addEventListener('click', (e) => {
        if (currentTooltip && !currentTooltip.contains(e.target) &&
            (!validationTooltip || !validationTooltip.contains(e.target))) {
          dismissAllTooltips();
        }
      });
      
      observeVideoThumbnails();
      console.log('🎬 YouTube Transcript Summarizer - Initialization complete!');
    }

    function observeVideoThumbnails() {
      let currentHoverContainer = null;

      // Find which video card is visually at a given screen position
      function findVideoCardAtPoint(x, y) {
        // Temporarily hide the video preview overlay so elementFromPoint can see through it
        const player = document.querySelector('ytd-player#ytd-player');
        let oldPointerEvents = '';
        if (player) {
          oldPointerEvents = player.style.pointerEvents;
          player.style.pointerEvents = 'none';
        }
        const el = document.elementFromPoint(x, y);
        if (player) {
          player.style.pointerEvents = oldPointerEvents;
        }
        if (!el) return null;
        return el.closest('yt-lockup-view-model') ||
               el.closest('ytd-rich-item-renderer') ||
               el.closest('ytd-video-renderer') ||
               el.closest('ytd-thumbnail');
      }

      document.addEventListener('mouseover', (e) => {
        // Direct container match (titles, metadata, etc.)
        let container = e.target.closest('yt-lockup-view-model') ||
                        e.target.closest('ytd-rich-item-renderer') ||
                        e.target.closest('ytd-video-renderer') ||
                        e.target.closest('ytd-thumbnail');

        // If hovering over YouTube's floating video preview, find the card underneath
        if (!container && (e.target.closest('#ytd-player') ||
                           e.target.closest('.html5-video-player') ||
                           e.target.closest('.html5-video-container') ||
                           e.target.closest('ytd-video-preview'))) {
          container = findVideoCardAtPoint(e.clientX, e.clientY);
        }

        if (container) {
          if (container !== currentHoverContainer) {
            if (currentHoverContainer) handleContainerLeave();
            currentHoverContainer = container;
            thumbnailHovered = true;
            cancelDismiss();
            if (hoverTimeout) clearTimeout(hoverTimeout);
            hoverTimeout = setTimeout(() => {
              handleVideoHover(container);
            }, 800);
          }
          return;
        }

        // Check if we're over a tooltip
        if (e.target.closest('.yt-transcript-summary-tooltip')) return;

        // Mouse left all video containers
        if (currentHoverContainer) {
          handleContainerLeave();
        }
      });

      function handleContainerLeave() {
        currentHoverContainer = null;
        thumbnailHovered = false;
        if (hoverTimeout) {
          clearTimeout(hoverTimeout);
          hoverTimeout = null;
        }
        scheduleDismiss();
      }
    }

    // Schedule tooltip dismissal with a short delay
    function scheduleDismiss() {
      cancelDismiss();
      // Don't dismiss while validation is in progress or tooltip is showing results
      if (validationInProgress) return;
      dismissTimeout = setTimeout(() => {
        if (!tooltipHovered && !thumbnailHovered && !validationInProgress) {
          removeTooltip();
          removeValidationTooltip();
        }
      }, 500);
    }

    function cancelDismiss() {
      if (dismissTimeout) {
        clearTimeout(dismissTimeout);
        dismissTimeout = null;
      }
    }

    function extractVideoId(element) {
      if (!element) return null;

      const patterns = [
        /[?&]v=([^&]+)/,
        /\/shorts\/([^/?]+)/,
        /\/embed\/([^/?]+)/
      ];

      // Try the element itself if it's a link
      if (element.tagName === 'A' && element.href) {
        for (const pattern of patterns) {
          const match = element.href.match(pattern);
          if (match) return match[1];
        }
      }

      // Try closest <a> ancestor
      const parentLink = element.closest('a');
      if (parentLink && parentLink.href) {
        for (const pattern of patterns) {
          const match = parentLink.href.match(pattern);
          if (match) return match[1];
        }
      }

      // Search inside for any link with a video URL (for container elements)
      const links = element.querySelectorAll('a[href]');
      for (const link of links) {
        for (const pattern of patterns) {
          const match = link.href.match(pattern);
          if (match) return match[1];
        }
      }

      // Check for content-id class on yt-lockup-view-model
      const lockup = element.closest('yt-lockup-view-model') || element.querySelector('yt-lockup-view-model');
      if (lockup) {
        const classList = [...lockup.classList];
        const contentIdClass = classList.find(c => c.startsWith('content-id-'));
        if (contentIdClass) return contentIdClass.replace('content-id-', '');
      }

      return null;
    }

    async function handleVideoHover(element) {
      if (!element) return;
      
      const videoId = extractVideoId(element);
      if (!videoId) return;
      
      currentVideoId = videoId;
      currentValidationText = null;
      
      // Check cache first
      if (summaryCache.has(videoId)) {
        const cached = summaryCache.get(videoId);
        currentSummaryText = cached.summary;
        showTooltip(element, cached);
        return;
      }
      
      showTooltip(element, { status: 'loading' });
      
      try {
        const response = await chrome.runtime.sendMessage({
          action: 'getSummary',
          videoId: videoId
        });
        
        if (response.success) {
          currentSummaryText = response.data.summary;
          summaryCache.set(videoId, response.data);
          showTooltip(element, response.data);
        } else {
          showTooltip(element, { 
            status: 'error', 
            message: response.error || 'Failed to get summary' 
          });
        }
      } catch (error) {
        showTooltip(element, { 
          status: 'error', 
          message: 'Extension error occurred' 
        });
      }
    }

    function showTooltip(element, data) {
      removeTooltip();
      removeValidationTooltip();
      
      const tooltip = document.createElement('div');
      tooltip.className = 'yt-transcript-summary-tooltip';
      tooltip.id = 'yt-summary-tooltip';
      
      // Keep tooltip alive when mouse enters it
      tooltip.addEventListener('mouseenter', () => {
        tooltipHovered = true;
        cancelDismiss();
      });
      
      tooltip.addEventListener('mouseleave', () => {
        tooltipHovered = false;
        scheduleDismiss();
      });
      
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
            <div class="summary-actions">
              <button class="validate-btn" id="yt-validate-btn">
                <span class="validate-icon">🔍</span> Check Validity
              </button>
            </div>
            <div class="summary-footer">
              <small>Duration: ${data.duration || 'N/A'} • Powered by AI</small>
            </div>
          </div>
        `;
      }
      
      document.body.appendChild(tooltip);
      positionTooltip(tooltip, element);
      currentTooltip = tooltip;
      
      // Attach click handler for validate button
      const validateBtn = tooltip.querySelector('#yt-validate-btn');
      if (validateBtn) {
        validateBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          handleValidateClick();
        });
      }
    }

    async function handleValidateClick() {
      if (!currentSummaryText || !currentVideoId) return;

      // Lock tooltips open during validation
      validationInProgress = true;
      cancelDismiss();

      const validateBtn = document.querySelector('#yt-validate-btn');
      if (validateBtn) {
        validateBtn.disabled = true;
        validateBtn.innerHTML = '<div class="spinner-small"></div> Analyzing with Opus...';
      }

      try {
        const response = await chrome.runtime.sendMessage({
          action: 'validateSummary',
          summary: currentSummaryText,
          videoId: currentVideoId
        });

        if (response.success) {
          currentValidationText = response.data.validation;
          showValidationTooltip(response.data.validation);
        } else {
          showValidationTooltip(null, response.error || 'Validation failed');
        }
      } catch (error) {
        showValidationTooltip(null, 'Extension error occurred');
      }

      // Re-enable button
      if (validateBtn) {
        validateBtn.disabled = false;
        validateBtn.innerHTML = '<span class="validate-icon">🔍</span> Check Validity';
      }
    }

    function showValidationTooltip(validation, error) {
      removeValidationTooltip();
      
      const tooltip = document.createElement('div');
      tooltip.className = 'yt-transcript-summary-tooltip yt-validation-tooltip';
      tooltip.id = 'yt-validation-tooltip';
      
      // Keep tooltip alive when hovered
      tooltip.addEventListener('mouseenter', () => {
        tooltipHovered = true;
        cancelDismiss();
      });
      
      tooltip.addEventListener('mouseleave', () => {
        tooltipHovered = false;
        scheduleDismiss();
      });
      
      if (error) {
        tooltip.innerHTML = `
          <div class="summary-error">
            <p><strong>⚠️ Validation Error</strong></p>
            <p>${error}</p>
          </div>
        `;
      } else {
        // Detect verdict for color coding
        let verdictClass = 'verdict-neutral';
        const lowerValidation = validation.toLowerCase();
        if (lowerValidation.includes('accurate') && !lowerValidation.includes('inaccurate') && !lowerValidation.includes('partially')) {
          verdictClass = 'verdict-good';
        } else if (lowerValidation.includes('mostly accurate')) {
          verdictClass = 'verdict-good';
        } else if (lowerValidation.includes('partially accurate') || lowerValidation.includes('plausible') || lowerValidation.includes('uncertain')) {
          verdictClass = 'verdict-mixed';
        } else if (lowerValidation.includes('misleading') || lowerValidation.includes('inaccurate') || lowerValidation.includes('questionable')) {
          verdictClass = 'verdict-bad';
        }
        
        tooltip.innerHTML = `
          <div class="validation-content ${verdictClass}">
            <div class="summary-header">
              <span class="summary-icon">🔍</span>
              <span class="summary-title">Validity Check</span>
              <span class="validation-model">Claude Opus 4.6</span>
            </div>
            <p class="validation-text">${validation}</p>
            <div class="summary-actions">
              <button class="continue-claude-btn" id="yt-continue-claude-btn">
                <span class="claude-icon">✦</span> Continue in Claude
              </button>
            </div>
            <div class="summary-footer">
              <small>Cross-referenced against original transcript</small>
            </div>
          </div>
        `;
      }
      
      document.body.appendChild(tooltip);
      
      // Position validation tooltip below the summary tooltip
      if (currentTooltip) {
        const summaryRect = currentTooltip.getBoundingClientRect();
        let left = summaryRect.left + window.scrollX;
        let top = summaryRect.bottom + 8 + window.scrollY;
        
        const tooltipHeight = 250;
        if (summaryRect.bottom + tooltipHeight > window.innerHeight) {
          top = summaryRect.top - tooltipHeight - 8 + window.scrollY;
        }
        
        const tooltipWidth = 400;
        if (left + tooltipWidth > window.innerWidth) {
          left = window.innerWidth - tooltipWidth - 10;
        }
        if (left < 10) left = 10;
        
        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;
      }
      
      validationTooltip = tooltip;
      
      // Attach Continue in Claude handler
      const continueBtn = tooltip.querySelector('#yt-continue-claude-btn');
      if (continueBtn) {
        continueBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          handleContinueInClaude();
        });
      }
    }

    function handleContinueInClaude() {
      const videoUrl = currentVideoId ? `https://www.youtube.com/watch?v=${currentVideoId}` : 'Unknown video';

      const contextParts = [];
      contextParts.push(`I was watching a YouTube video and used an AI tool to summarize and fact-check it. I'd like to discuss this topic further with you.\n`);
      contextParts.push(`VIDEO: ${videoUrl}\n`);

      if (currentSummaryText) {
        contextParts.push(`AI SUMMARY (generated by Claude Haiku):\n${currentSummaryText}\n`);
      }

      if (currentValidationText) {
        contextParts.push(`VALIDITY ASSESSMENT (generated by Claude Opus):\n${currentValidationText}\n`);
      }

      contextParts.push(`---\nBased on this summary and validity assessment, I'd like to explore this topic further. What questions do you have, or what aspects would you like to discuss?`);

      const fullContext = contextParts.join('\n');

      // Copy using execCommand first (works reliably in content scripts)
      const textArea = document.createElement('textarea');
      textArea.value = fullContext;
      textArea.style.position = 'fixed';
      textArea.style.left = '0';
      textArea.style.top = '0';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const copied = document.execCommand('copy');
      document.body.removeChild(textArea);

      if (copied) {
        showToast('Context copied to clipboard — paste in Claude to continue');
        window.open('https://claude.ai/new', '_blank');
      } else {
        // Fallback to clipboard API
        navigator.clipboard.writeText(fullContext).then(() => {
          showToast('Context copied to clipboard — paste in Claude to continue');
          window.open('https://claude.ai/new', '_blank');
        }).catch(err => {
          console.error('Failed to copy:', err);
          showToast('Could not copy to clipboard — try Ctrl+C manually');
        });
      }
    }

    function showToast(message) {
      // Remove existing toast
      const existing = document.querySelector('.yt-summarizer-toast');
      if (existing) existing.remove();
      
      const toast = document.createElement('div');
      toast.className = 'yt-summarizer-toast';
      toast.innerHTML = `
        <span class="toast-icon">✦</span>
        <span class="toast-message">${message}</span>
      `;
      
      document.body.appendChild(toast);
      
      // Trigger animation
      requestAnimationFrame(() => {
        toast.classList.add('toast-visible');
      });
      
      // Auto-dismiss after 4 seconds
      setTimeout(() => {
        toast.classList.remove('toast-visible');
        setTimeout(() => toast.remove(), 300);
      }, 4000);
    }

    function positionTooltip(tooltip, element) {
      const rect = element.getBoundingClientRect();
      const tooltipRect = tooltip.getBoundingClientRect();
      
      let left = rect.right + 10;
      let top = rect.top;
      
      if (left + tooltipRect.width > window.innerWidth) {
        left = rect.left - tooltipRect.width - 10;
      }
      
      if (top + tooltipRect.height > window.innerHeight) {
        top = window.innerHeight - tooltipRect.height - 10;
      }
      
      if (top < 0) top = 10;
      
      tooltip.style.left = `${left + window.scrollX}px`;
      tooltip.style.top = `${top + window.scrollY}px`;
    }

    function removeTooltip() {
      if (currentTooltip) {
        currentTooltip.remove();
        currentTooltip = null;
      }
    }

    function removeValidationTooltip() {
      if (validationTooltip) {
        validationTooltip.remove();
        validationTooltip = null;
      }
    }

    function dismissAllTooltips() {
      tooltipHovered = false;
      thumbnailHovered = false;
      validationInProgress = false;
      cancelDismiss();
      removeTooltip();
      removeValidationTooltip();
      currentVideoId = null;
      currentSummaryText = null;
      currentValidationText = null;
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  })();
}
