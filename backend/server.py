"""
YouTube Summary Service - Flask Backend
Uses yt-dlp for reliable transcript fetching
With crash resilience and auto-recovery
"""

from flask import Flask, jsonify, request
from flask_cors import CORS
import anthropic
import os
import json
import logging
import subprocess
import sys
import time
from datetime import datetime

# Setup logging - also log to file for debugging crashes
LOG_FILE = os.path.join(os.path.expanduser('~'), 'YouTubeSummarizer_server.log')
from logging.handlers import RotatingFileHandler

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(),
        RotatingFileHandler(LOG_FILE, maxBytes=5*1024*1024, backupCount=3)
    ]
)

app = Flask(__name__)
CORS(app)

# Configuration file path
CONFIG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'config.json')

# Reusable Anthropic client (created once, reused)
_anthropic_client = None
_anthropic_api_key = None

# In-flight request deduplication: video_id -> {result, event}
_inflight = {}
_inflight_lock = __import__('threading').Lock()

def load_config():
    """Load configuration from file"""
    try:
        if os.path.exists(CONFIG_FILE):
            with open(CONFIG_FILE, 'r') as f:
                return json.load(f)
    except (json.JSONDecodeError, IOError) as e:
        logging.error(f'Error loading config: {e}')
    return {'anthropic_api_key': '', 'model': 'claude-haiku-4-5-20241022'}

def save_config(config):
    """Save configuration to file"""
    try:
        with open(CONFIG_FILE, 'w') as f:
            json.dump(config, f, indent=2)
    except IOError as e:
        logging.error(f'Error saving config: {e}')

def get_anthropic_client():
    """Get or create reusable Anthropic client"""
    global _anthropic_client, _anthropic_api_key
    config = load_config()
    api_key = config.get('anthropic_api_key')

    if not api_key:
        return None

    # Recreate client only if API key changed
    if _anthropic_client is None or _anthropic_api_key != api_key:
        _anthropic_client = anthropic.Anthropic(
            api_key=api_key,
            timeout=60.0  # 60s hard timeout - prevents server from hanging forever
        )
        _anthropic_api_key = api_key
        logging.info('Created new Anthropic client')

    return _anthropic_client

def _run_transcript_subprocess(video_id):
    """Run yt-dlp in a separate process, kill it hard on timeout."""
    script = f'''
import yt_dlp, requests, json, sys
ydl_opts = {{
    'writesubtitles': True,
    'writeautomaticsub': True,
    'subtitleslangs': ['en'],
    'skip_download': True,
    'quiet': True,
    'no_warnings': True,
    'socket_timeout': 10,
    'retries': 1,
    'extractor_retries': 0,
    'http_headers': {{
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }}
}}
try:
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info("https://www.youtube.com/watch?v={video_id}", download=False)
        captions = info.get('subtitles', {{}}).get('en', []) or info.get('automatic_captions', {{}}).get('en', [])
        if not captions:
            print(json.dumps({{"error": "No English captions available"}}))
            sys.exit(0)
        for cap in captions:
            if cap.get('ext') == 'json3':
                resp = requests.get(cap['url'], timeout=10)
                data = resp.json()
                text_parts = []
                for event in data.get('events', []):
                    if 'segs' in event:
                        for seg in event['segs']:
                            if 'utf8' in seg:
                                text_parts.append(seg['utf8'])
                transcript = ' '.join(text_parts).replace('\\n', ' ').strip()
                print(json.dumps({{"transcript": transcript}}))
                sys.exit(0)
        print(json.dumps({{"error": "Could not parse captions"}}))
except Exception as e:
    print(json.dumps({{"error": str(e)}}))
'''
    try:
        proc = subprocess.Popen(
            [sys.executable, '-c', script],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
        )
        try:
            stdout, stderr = proc.communicate(timeout=20)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
            logging.error(f'yt-dlp subprocess killed after 20s for {video_id}')
            return None, "Transcript fetch timed out. Please try again."

        if proc.returncode != 0:
            logging.error(f'yt-dlp subprocess failed for {video_id}: {(stderr or "")[-200:]}')
            return None, "Transcript fetch failed"

        output = stdout.strip()
        if not output:
            logging.error(f'yt-dlp subprocess returned empty output for {video_id}')
            return None, "No transcript data returned"

        result = json.loads(output)
        if 'error' in result:
            return None, result['error']
        return result['transcript'], None

    except json.JSONDecodeError as e:
        logging.error(f'Bad JSON from yt-dlp subprocess for {video_id}: {e}')
        return None, "Transcript fetch failed"
    except Exception as e:
        logging.error(f'Transcript fetch error for {video_id}: {e}')
        return None, str(e)


def get_transcript(video_id):
    """Fetch transcript with deduplication - if another request for the same video
    is already in flight, wait for that result instead of spawning a second subprocess."""
    import threading

    with _inflight_lock:
        if video_id in _inflight:
            logging.info(f'Dedup: waiting on existing request for {video_id}')
            entry = _inflight[video_id]
        else:
            entry = {'event': threading.Event(), 'result': None}
            _inflight[video_id] = entry
            entry['_owner'] = True

    if not entry.get('_owner'):
        # Wait for the other thread's result (up to 25s)
        entry['event'].wait(timeout=25)
        if entry['result'] is not None:
            return entry['result']
        return None, "Transcript fetch timed out. Please try again."

    try:
        result = _run_transcript_subprocess(video_id)
        entry['result'] = result
        return result
    finally:
        entry['event'].set()
        with _inflight_lock:
            _inflight.pop(video_id, None)

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({
        'status': 'running',
        'timestamp': datetime.now().isoformat(),
        'version': '2.3.0'
    })

@app.route('/config', methods=['GET', 'POST'])
def config_endpoint():
    """Get or update configuration"""
    if request.method == 'GET':
        config = load_config()
        return jsonify({
            'api_key_set': bool(config.get('anthropic_api_key')),
            'model': config.get('model', 'claude-haiku-4-5-20241022')
        })
    
    elif request.method == 'POST':
        data = request.json
        config = load_config()
        
        if 'anthropic_api_key' in data:
            config['anthropic_api_key'] = data['anthropic_api_key']
            global _anthropic_client
            _anthropic_client = None
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
        
        transcript, error = get_transcript(video_id)
        if error:
            return jsonify({'success': False, 'error': error}), 400
        
        logging.info(f'Transcript: {len(transcript)} chars')
        
        max_chars = 50000
        if len(transcript) > max_chars:
            half = max_chars // 2
            transcript = transcript[:half] + '\n\n[...truncated...]\n\n' + transcript[-half:]
        
        client = get_anthropic_client()
        if not client:
            return jsonify({'success': False, 'error': 'API key not configured'}), 400
        
        config = load_config()
        logging.info('Calling Claude API...')

        try:
            message = client.messages.create(
                model=config.get('model', 'claude-haiku-4-5-20241022'),
                max_tokens=200,
                messages=[{
                    'role': 'user',
                    'content': f'Summarize this YouTube transcript in 2-3 sentences:\n\n{transcript}'
                }]
            )
        except Exception as api_err:
            logging.error(f'Claude API call failed: {api_err}')
            return jsonify({'success': False, 'error': f'AI service error: {api_err}'}), 502

        summary = message.content[0].text
        logging.info(f'Summary: {summary[:100]}...')
        
        return jsonify({
            'success': True,
            'summary': summary
        })
        
    except Exception as e:
        logging.error(f'Summarize error: {str(e)}')
        return jsonify({'success': False, 'error': str(e)}), 400

@app.route('/validate', methods=['POST'])
def validate():
    """Validate a summary's claims using Claude Opus 4.6"""
    try:
        data = request.json
        summary = data.get('summary')
        video_id = data.get('video_id')
        
        if not summary:
            return jsonify({'success': False, 'error': 'summary required'}), 400
        
        logging.info(f'Validating summary for video: {video_id}')
        
        client = get_anthropic_client()
        if not client:
            return jsonify({'success': False, 'error': 'API key not configured'}), 400
        
        # Fetch the transcript again for Opus to cross-reference
        transcript = None
        if video_id:
            transcript, error = get_transcript(video_id)
            if error:
                logging.warning(f'Could not fetch transcript for validation: {error}')
        
        # Build the validation prompt
        if transcript:
            max_chars = 50000
            if len(transcript) > max_chars:
                half = max_chars // 2
                transcript = transcript[:half] + '\n\n[...truncated...]\n\n' + transcript[-half:]
            
            validation_prompt = f"""You are a fact-checker and critical analyst. A summary was generated from a YouTube video transcript. Your job is to evaluate the validity and accuracy of the summary by cross-referencing it against the original transcript.

SUMMARY TO VALIDATE:
{summary}

ORIGINAL TRANSCRIPT:
{transcript}

Please analyze:
1. ACCURACY: Does the summary accurately represent what was said in the transcript? Are there any misrepresentations or distortions?
2. CLAIMS: Identify any specific factual claims made in the summary. For each claim, note whether the transcript supports it, contradicts it, or doesn't address it.
3. OMISSIONS: Are there critical points from the transcript that the summary misleadingly leaves out?
4. OVERALL VERDICT: Rate the summary as one of: ACCURATE, MOSTLY ACCURATE, PARTIALLY ACCURATE, MISLEADING, or INACCURATE.

Keep your response concise (3-5 sentences) and lead with the overall verdict."""
        else:
            validation_prompt = f"""You are a fact-checker and critical analyst. Evaluate the following summary that was generated from a YouTube video. Since the original transcript is unavailable, assess the claims based on your knowledge.

SUMMARY TO VALIDATE:
{summary}

Please analyze:
1. Identify specific factual claims in the summary.
2. For each claim, assess whether it is likely true, false, unverifiable, or misleading based on your knowledge.
3. Note any red flags, logical inconsistencies, or signs of bias.
4. Rate the summary as one of: LIKELY ACCURATE, PLAUSIBLE, UNCERTAIN, QUESTIONABLE, or LIKELY INACCURATE.

Keep your response concise (3-5 sentences) and lead with the overall verdict."""
        
        logging.info('Calling Claude Opus 4.6 for validation...')

        try:
            message = client.messages.create(
                model='claude-opus-4-20250514',
                max_tokens=500,
                messages=[{
                    'role': 'user',
                    'content': validation_prompt
                }]
            )
        except Exception as api_err:
            logging.error(f'Claude Opus API call failed: {api_err}')
            return jsonify({'success': False, 'error': f'Validation service error: {api_err}'}), 502

        validation = message.content[0].text
        logging.info(f'Validation result: {validation[:100]}...')
        
        return jsonify({
            'success': True,
            'validation': validation
        })
        
    except Exception as e:
        logging.error(f'Validation error: {str(e)}')
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
            model='claude-haiku-4-5-20241022',
            max_tokens=10,
            messages=[{'role': 'user', 'content': 'Hi'}]
        )
        
        return jsonify({'success': True, 'message': 'API key is valid!'})
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 400

if __name__ == '__main__':
    logging.info('='*50)
    logging.info('Starting YouTube Summary Service v2.3.0')
    logging.info(f'Log file: {LOG_FILE}')
    logging.info('='*50)

    from waitress import serve
    logging.info('Starting Waitress server on http://127.0.0.1:5000')
    serve(app, host='127.0.0.1', port=5000, threads=16)
