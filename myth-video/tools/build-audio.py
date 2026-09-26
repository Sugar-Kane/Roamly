# Mixes the narration over the score: places each line at its cue, adds a touch of hall to the voice,
# and ducks the music under speech. Writes audio/mix_pre.wav for tools/master-audio.sh.
import json, wave
import numpy as np
SR = 48000
cues = json.load(open('audio/cues.json'))
N = int(cues['duration'] * SR)

def read(path):
    w = wave.open(path); ch = w.getnchannels()
    a = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    return a.reshape(-1, ch) if ch > 1 else a[:, None]

music = read('audio/music.wav')[:N]
music = np.pad(music, ((0, N - len(music)), (0, 0)))
vo = np.zeros(N, np.float32)
for c in cues['vo']:
    x = read(f"audio/vo/{c['id']}.wav")[:, 0]
    i = int(c['at'] * SR); vo[i:i + len(x)] += x[:N - i]

# hall on the voice: exponentially decaying noise impulse (1.4 s), convolved by FFT, mixed low
rng = np.random.default_rng(3)
L = int(1.4 * SR); ir = rng.standard_normal(L).astype(np.float32) * np.exp(-np.arange(L) / (0.32 * SR)); ir[: int(0.02 * SR)] = 0
n = 1 << int(np.ceil(np.log2(N + L)))
wet = np.fft.irfft(np.fft.rfft(vo, n) * np.fft.rfft(ir / np.sqrt((ir ** 2).sum()), n), n)[:N].astype(np.float32)
voice = vo * 1.0 + wet * 0.12

# ducking: speech envelope (fast attack, slow release) pulls the music down by up to 7 dB
env = np.abs(vo); blk = 480
e = env[: N // blk * blk].reshape(-1, blk).max(1)
g = np.zeros_like(e); lvl = 0.0
for k, v in enumerate(e):
    on = 1.0 if v > 0.02 else 0.0
    lvl = lvl + (on - lvl) * (0.5 if on > lvl else 0.04)
    g[k] = lvl
duck = np.repeat(10 ** (-7 * g / 20), blk); duck = np.pad(duck, (0, N - len(duck)), constant_values=1.0)

mix = music * duck[:, None] * 2.3 + voice[:, None] * 1.15
peak = np.abs(mix).max()
if peak > 0.98: mix *= 0.98 / peak
out = (np.clip(mix, -1, 1) * 32767).astype('<i2')
w = wave.open('audio/mix_pre.wav', 'wb'); w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(out.tobytes()); w.close()
print(f'mix_pre.wav: {N / SR:.1f}s, pre-peak {peak:.2f}')
