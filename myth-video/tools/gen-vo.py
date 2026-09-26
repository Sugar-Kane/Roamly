# Generates each narration line separately with xAI TTS.
# Reads XAI_API_KEY from the environment only; never prints or stores it.
# Usage: python3 tools/gen-vo.py [line ids...]   (VO_VOICE overrides the voice)
import json, os, sys, urllib.request, urllib.error
VOICE = os.environ.get('VO_VOICE', 'leo')
key = os.environ['XAI_API_KEY']
lines = json.load(open('tools/vo-lines.json'))
only = set(sys.argv[1:])
os.makedirs('audio/vo', exist_ok=True)
for ln in lines:
    if only and ln['id'] not in only: continue
    body = json.dumps({'text': ln['text'], 'voice_id': VOICE, 'language': 'en',
                       'output_format': {'codec': 'wav', 'sample_rate': 48000},
                       'replace': {'Uranus': '/ˈjʊərənəs/', 'Cyclopes': '/saɪˈkloʊpiːz/',
                                   'Gaia': '/ˈɡaɪə/', 'Cronus': '/ˈkroʊnəs/'}}).encode()
    req = urllib.request.Request('https://api.x.ai/v1/tts', data=body, headers={'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            data = r.read()
    except urllib.error.HTTPError as e:
        sys.exit(f"{ln['id']}: HTTP {e.code} {e.read()[:200]!r}")
    open(f"audio/vo/{ln['id']}.wav", 'wb').write(data)
    print(ln['id'], len(data), 'bytes')
