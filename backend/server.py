"""
YouTube Summary Service - Flask Backend
Uses yt-dlp for reliable transcript fetching
"""

from flask import Flask, jsonify, request
from flask_cors import CORS
import yt_dlp
import requests
import anthropic
import os
import json
import logging
from datetime import datetime

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler()
    ]
)

app = Flask(__name__)
CORS(app)

# Configuration file path
CONFIG_FILE = os.path.join(os.path.dirname(__file__), 'config.json')

def load_config():
    """Load configuration from file"""
    if os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE, 'r') as f:
            return json.load(f)
    return {'anthropic_api_key': '', 'model': 'claude-sonnet-4-20250514'}

def save_config(config):
    """Save configuration to file"""
    with open(CONFIG_FILE, 'w') as f:
        json.dump(config, f, indent=2)

def get_transcript(video_id):
    """Fetch transcript using yt-dlp"""
    ydl_opts = {
        'writesubtitles': True,
        'writeautomaticsub': True,
        'subtitleslangs': ['en'],
        'skip_download': True,
        'quiet': True,
        'no_warnings': True
    }
    
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(f'https://www.youtube.com/watch?v={video_id}', download=False)
        
        # Try manual subtitles first, then auto captions
        captions = info.get('subtitles', {}).get('en', []) or info.get('automatic_captions', {}).get('en', [])
        
        if not captions:
            return None, "No English captions available"
        
        # Find json3 format
        for cap in captions:
            if cap.get('ext') == 'json3':
                resp = requests.get(cap['url'])
                data = resp.json()
                
                text_parts = []
                for event in data.get('events', []):
                    if 'segs' in event:
                        for seg in event['segs']:
                            if 'utf8' in seg:
                                text_parts.append(seg['utf8'])
                
                transcript = ' '.join(text_parts).replace('\n', ' ').strip()
                return transcript, None
        
        return None, "Could not parse captions"

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({
        'status': 'running',
        'timestamp': datetime.now().isoformat(),
        'version': '2.0.0'
    })

@app.route('/config', methods=['GET', 'POST'])
def config_endpoint():
    """Get or update configuration"""
    if request.method == 'GET':
        config = load_config()
        return jsonify({
            'api_key_set': bool(config.get('anthropic_api_key')),
            'model': config.get('model', 'claude-sonnet-4-20250514')
        })
    
    elif request.method == 'POST':
        data = request.json
        config = load_config()
        
        if 'anthropic_api_key' in data:
            config['anthropic_api_key'] = data['anthropic_api_key']
        if 'model' in data:
            config['model'] = data['model']
        
        save_config(config)
        return jsonify({'success': True})

@app.route('/transcript/<video_id>', methods=['GET'])
def transcript_endpoint(video_id):
    """Fetch transcript for a YouTube video"""
    try:
        logging.info(f'Fetching transcript for: {video_id}')
        transcript, error = get_transcript(video_id)
        
        if error:
            return jsonify({'success': False, 'error': error}), 400
        
        logging.info(f'Got transcript: {len(transcript)} chars')
        return jsonify({
            'success': True,
            'transcript': transcript,
            'length': len(transcript)
        })
        
    except Exception as e:
        logging.error(f'Error: {str(e)}')
        return jsonify({'success': False, 'error': str(e)}), 400

@app.route('/summarize', methods=['POST'])
def summarize():
    """Summarize a YouTube video"""
    try:
        data = request.json
        video_id = data.get('video_id')
        
        if not video_id:
            return jsonify({'success': False, 'error': 'video_id required'}), 400
        
        logging.info(f'Summarizing: {video_id}')
        
        # Get transcript
        transcript, error = get_transcript(video_id)
        if error:
            return jsonify({'success': False, 'error': error}), 400
        
        logging.info(f'Transcript: {len(transcript)} chars')
        
        # Truncate if too long
        max_chars = 50000
        if len(transcript) > max_chars:
            half = max_chars // 2
            transcript = transcript[:half] + '\n\n[...truncated...]\n\n' + transcript[-half:]
        
        # Get API key
        config = load_config()
        api_key = config.get('anthropic_api_key')
        
        if not api_key:
            return jsonify({'success': False, 'error': 'API key not configured'}), 400
        
        # Call Claude
        logging.info('Calling Claude API...')
        client = anthropic.Anthropic(api_key=api_key)
        
        message = client.messages.create(
            model=config.get('model', 'claude-sonnet-4-20250514'),
            max_tokens=200,
            messages=[{
                'role': 'user',
                'content': f'Summarize this YouTube transcript in 2-3 sentences:\n\n{transcript}'
            }]
        )
        
        summary = message.content[0].text
        logging.info(f'Summary: {summary[:100]}...')
        
        return jsonify({
            'success': True,
            'summary': summary
        })
        
    except Exception as e:
        logging.error(f'Error: {str(e)}')
        return jsonify({'success': False, 'error': str(e)}), 400

@app.route('/test-api-key', methods=['POST'])
def test_api_key():
    """Test if API key works"""
    try:
        data = request.json
        api_key = data.get('api_key')
        
        if not api_key:
            return jsonify({'success': False, 'error': 'API key required'}), 400
        
        client = anthropic.Anthropic(api_key=api_key)
        client.messages.create(
            model='claude-sonnet-4-20250514',
            max_tokens=10,
            messages=[{'role': 'user', 'content': 'Hi'}]
        )
        
        return jsonify({'success': True, 'message': 'API key is valid!'})
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 400

if __name__ == '__main__':
    logging.info('Starting YouTube Summary Service on http://localhost:5000')
    app.run(host='127.0.0.1', port=5000, debug=False)
