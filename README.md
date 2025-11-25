# YouTube Video Summarizer 🎬

A Chrome extension + local backend that generates AI-powered summaries of YouTube videos on hover. Just hover over any video thumbnail for 2 seconds and get an instant summary.

![Demo](demo.gif)

## ✨ Features

- **Hover to Summarize** - Just hover over any YouTube thumbnail for 2 seconds
- **AI-Powered** - Uses Claude AI for intelligent, contextual summaries
- **Works on Any Video** - Supports videos with captions (manual or auto-generated)
- **Fast & Cached** - Summaries are cached so repeat hovers are instant
- **Privacy-First** - Runs entirely locally, your data never leaves your machine
- **No YouTube API Key Needed** - Uses yt-dlp for reliable transcript fetching

## 🏗️ Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ Chrome Extension│────▶│  Flask Backend  │────▶│   Claude API    │
│  (Hover detect) │     │  (localhost)    │     │  (Summarize)    │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌─────────────────┐
                        │     yt-dlp      │
                        │ (Get transcript)│
                        └─────────────────┘
```

## 📋 Requirements

- Windows 10/11
- Python 3.8+
- Chrome or Edge browser
- Anthropic API key ([get one here](https://console.anthropic.com/))

## 🚀 Installation

### Option 1: Easy Installer (Recommended)

1. Download the [latest release](../../releases)
2. Extract the ZIP file
3. Double-click `INSTALL.bat`
4. Follow the prompts

### Option 2: Manual Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Powellga/youtube-video-summarizer.git
   cd youtube-video-summarizer
   ```

2. **Set up Python environment:**
   ```bash
   cd backend
   python -m venv venv
   venv\Scripts\activate
   pip install -r requirements.txt
   ```

3. **Create config file:**
   ```bash
   # Create backend/config.json with your API key:
   {
     "anthropic_api_key": "sk-ant-api03-YOUR-KEY-HERE",
     "model": "claude-sonnet-4-20250514"
   }
   ```

4. **Install Chrome extension:**
   - Open Chrome → `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `extension` folder

## 🎯 Usage

1. **Start the backend server:**
   ```bash
   cd backend
   venv\Scripts\python.exe server.py
   ```

2. **Browse YouTube** - Go to youtube.com

3. **Hover over any video thumbnail** - Wait 2 seconds

4. **See the summary!** - A tooltip appears with the AI-generated summary

## 📁 Project Structure

```
youtube-video-summarizer/
├── backend/
│   ├── server.py          # Flask backend server
│   ├── requirements.txt   # Python dependencies
│   └── config.json        # Your API key (create this)
├── extension/
│   ├── manifest.json      # Chrome extension manifest
│   ├── background.js      # Service worker
│   ├── content.js         # YouTube page injection
│   ├── styles.css         # Tooltip styling
│   └── icons/             # Extension icons
├── installer/
│   └── install.ps1        # Windows installer script
├── INSTALL.bat            # Easy installer launcher
└── README.md
```

## ⚙️ Configuration

Edit `backend/config.json`:

```json
{
  "anthropic_api_key": "sk-ant-api03-YOUR-KEY-HERE",
  "model": "claude-sonnet-4-20250514"
}
```

**Available models:**
- `claude-sonnet-4-20250514` - Fast, good quality (recommended)
- `claude-opus-4-20250514` - Highest quality, slower
- `claude-haiku-4-20250514` - Fastest, lower cost

## 💰 Cost Estimate

- ~$0.003 per summary with Sonnet
- Light usage (50 videos/day): ~$5/month
- Heavy usage (200 videos/day): ~$15-20/month

## 🔧 Troubleshooting

### Server won't start
```bash
# Make sure you're in the backend directory with venv activated
cd backend
venv\Scripts\activate
python server.py
```

### "Extension error occurred"
- Check that the server is running (you should see "Running on http://127.0.0.1:5000")
- Check Chrome DevTools console for errors (F12)

### No transcript available
- The video might not have captions enabled
- Try a different video

### API key errors
- Verify your API key is correct in `config.json`
- Make sure you have API credits at console.anthropic.com

## 🛠️ Tech Stack

- **Backend:** Python, Flask, yt-dlp
- **AI:** Anthropic Claude API
- **Extension:** Chrome Manifest V3, vanilla JavaScript
- **Transcript:** yt-dlp (more reliable than youtube-transcript-api)

## 📝 License

MIT License - feel free to use, modify, and distribute.

## 🙏 Acknowledgments

- [yt-dlp](https://github.com/yt-dlp/yt-dlp) - Reliable YouTube data extraction
- [Anthropic](https://anthropic.com) - Claude AI API
- Built with frustration and determination 😅

## 👤 Author

**Gregg Powell**
- GitHub: [@Powellga](https://github.com/Powellga)

---

⭐ If you find this useful, give it a star!
