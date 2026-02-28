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
    let tooltipHovered = false;       // Is mouse over the tooltip?
    let thumbnailHovered = false;     // Is mouse over the thumbnail?
    let currentVideoId = null;        // Track which video the tooltip is for
    let currentSummaryText = null;    // Track the summary text for validation
    let dismissTimeout = null;        // Delay before removing tooltip

    function init() {
      console.log('🎬 YouTube Transcript Summarizer - Initializing...');

      const oldMarkers = document.querySelectorAll('[data-summarizer-attached]');
      console.log(`🎬 Found ${oldMarkers.length} old markers to clear`);
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
      const observer = new MutationObserver((mutations) => {
        attachHoverListeners();
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true
      });

      attachHoverListeners();
    }

    function attachHoverListeners() {
      const selectors = [
        'a#thumbnail',
        'a.ytd-thumbnail',
        'ytd-thumbnail a',
        'a#video-title-link',
        'a.yt-simple-endpoint.ytd-thumbnail',
        'a.yt-lockup-view-model__content-image',
        'a.yt-lockup-metadata-view-model__title',
        'yt-lockup-view-model a',
        'ytd-rich-item-renderer a',
        'ytd-video-renderer a#thumbnail',
        'ytd-video-preview a'
      ];

      let videoLinks = [];
      for (const selector of selectors) {
        const links = document.querySelectorAll(selector);
        if (links.length > 0) {
          videoLinks = [...videoLinks, ...links];
        }
      }

      videoLinks = [...new Set(videoLinks)];

      if (videoLinks.length === 0) {
        return;
      }

      let attachedCount = 0;

      videoLinks.forEach((link, index) => {
        if (link._ytMouseEnter) {
          link.removeEventListener('mouseenter', link._ytMouseEnter);
        }
        if (link._ytMouseLeave) {
          link.removeEventListener('mouseleave', link._ytMouseLeave);
        }

        const mouseEnterHandler = (e) => {
          thumbnailHovered = true;
          cancelDismiss();

          const targetElement = e.currentTarget;

          hoverTimeout = setTimeout(() => {
            handleVideoHover(targetElement);
          }, 800);
        };

        const mouseLeaveHandler = (e) => {
          // Don't cancel if mouse moved to another element in the same video container
          // (e.g., YouTube's video preview overlay appearing on top of thumbnail)
          const relatedTarget = e.relatedTarget;
          if (relatedTarget && hoverTimeout) {
            const currentContainer = e.currentTarget.closest('yt-lockup-view-model') ||
                                     e.currentTarget.closest('ytd-rich-item-renderer');
            const targetContainer = relatedTarget.closest('yt-lockup-view-model') ||
                                    relatedTarget.closest('ytd-rich-item-renderer');
            if (currentContainer && currentContainer === targetContainer) {
              return; // Still within the same video, keep the timer running
            }
          }
          thumbnailHovered = false;
          if (hoverTimeout) {
            clearTimeout(hoverTimeout);
            hoverTimeout = null;
          }
          // Delay dismissal to allow mouse to reach tooltip
          scheduleDismiss();
        };

        link._ytMouseEnter = mouseEnterHandler;
        link._ytMouseLeave = mouseLeaveHandler;

        link.addEventListener('mouseenter', mouseEnterHandler);
        link.addEventListener('mouseleave', mouseLeaveHandler);

        attachedCount++;
      });
    }

    // Schedule tooltip dismissal with a short delay
    function scheduleDismiss() {
      cancelDismiss();
      dismissTimeout = setTimeout(() => {
        if (!tooltipHovered && !thumbnailHovered) {
          removeTooltip();
          removeValidationTooltip();
        }
      }, 300);  // 300ms grace period to move mouse to tooltip
    }

    function cancelDismiss() {
      if (dismissTimeout) {
        clearTimeout(dismissTimeout);
        dismissTimeout = null;
      }
    }

    function extractVideoId(element) {
      if (!element) return null;

      let linkElement = element;
      if (element.tagName !== 'A') {
        linkElement = element.closest('a');
      }

      if (!linkElement) return null;

      const href = linkElement.href;
      if (!href) return null;

      const patterns = [
        /[?&]v=([^&]+)/,
        /\/shorts\/([^/?]+)/,
        /\/embed\/([^/?]+)/,
        /^([a-zA-Z0-9_-]{11})$/
      ];

      for (const pattern of patterns) {
        const match = href.match(pattern);
        if (match) return match[1];
      }

      return null;
    }

    async function handleVideoHover(element) {
      if (!element) return;

      const videoId = extractVideoId(element);
      if (!videoId) return;

      currentVideoId = videoId;

      // Check cache first
      if (summaryCache.has(videoId)) {
        const cached = summaryCache.get(videoId);
        currentSummaryText = cached.summary;
        showTooltip(element, cached);
        return;
      }

      // Show loading tooltip
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
            <div class="summary-footer">
              <small>Cross-referenced against original transcript</small>
            </div>
          </div>
        `;
      }

      document.body.appendChild(tooltip);

      // Position validation tooltip below or beside the summary tooltip
      if (currentTooltip) {
        const summaryRect = currentTooltip.getBoundingClientRect();
        let left = summaryRect.left + window.scrollX;
        let top = summaryRect.bottom + 8 + window.scrollY;

        // If it would go off the bottom, show above
        const tooltipHeight = 200; // estimate
        if (summaryRect.bottom + tooltipHeight > window.innerHeight) {
          top = summaryRect.top - tooltipHeight - 8 + window.scrollY;
        }

        // Keep within viewport horizontally
        const tooltipWidth = 400;
        if (left + tooltipWidth > window.innerWidth) {
          left = window.innerWidth - tooltipWidth - 10;
        }
        if (left < 10) left = 10;

        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;
      }

      validationTooltip = tooltip;
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
      cancelDismiss();
      removeTooltip();
      removeValidationTooltip();
      currentVideoId = null;
      currentSummaryText = null;
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  })();
}
