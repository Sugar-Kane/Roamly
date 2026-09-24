"""Sound design + mix for the Roamly Flow promo.

All SFX are synthesized here (numpy, seeded) from the cue sheet exported by the animation
(audio/cues.json), so sound and picture share one timeline. VO lines are placed individually
(tools/vo-lines.json). Music (audio/music.wav) is ducked under the VO. Output: audio/mix_pre.wav
(the pre-loudness mix). Loudness normalisation happens in tools/master-audio.sh.
"""
import json, wave
import numpy as np

SR = 48000
DUR = 60.0
N = int(SR * DUR)
rng = np.random.default_rng(1234)
SILENCE = (10.0, 10.625)  # the beat when Roamly Flow appears


def db(x):
    return 10 ** (x / 20)


def t_axis(d):
    return np.arange(int(d * SR)) / SR


def env_ad(n, a, d, curve=4.0):
    """attack/decay envelope over n samples (a, d in seconds)."""
    t = np.arange(n) / SR
    e = np.where(t < a, t / max(a, 1e-4), np.exp(-(t - a) / max(d, 1e-4) * curve / 4))
    return e


def bp(x, lo, hi, order=2):
    """cheap band-pass via FFT mask (smooth edges)."""
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    m = np.ones_like(f)
    if lo:
        m *= 1 / (1 + (lo / np.maximum(f, 1)) ** (2 * order))
    if hi:
        m *= 1 / (1 + (f / hi) ** (2 * order))
    return np.fft.irfft(X * m, len(x))


def noise(d, color='white', seed=None):
    r = np.random.default_rng(seed) if seed is not None else rng
    n = int(d * SR)
    w = r.standard_normal(n)
    if color == 'pink':
        X = np.fft.rfft(w); f = np.fft.rfftfreq(n, 1 / SR); X /= np.sqrt(np.maximum(f, 20)); w = np.fft.irfft(X, n)
    if color == 'brown':
        w = np.cumsum(w); w -= np.convolve(w, np.ones(4800) / 4800, 'same')
    return w / (np.abs(w).max() + 1e-9)


def sine(f, d, ph=0):
    t = t_axis(d)
    if callable(f):
        ph_arr = 2 * np.pi * np.cumsum(f(t)) / SR
        return np.sin(ph_arr + ph)
    return np.sin(2 * np.pi * f * t + ph)


def norm(x, peak=1.0):
    return x / (np.abs(x).max() + 1e-9) * peak


# ---------------------------------------------------------------- recipes (mono, peak ~1)
def pencil(d=0.8, seed=0, glide=False):
    r = np.random.default_rng(seed)
    x = bp(noise(d, seed=seed + 1), 1800, 7000)
    t = t_axis(d)
    rate = 3.0 if glide else 7.5 + r.random() * 3
    strokes = 0.55 + 0.45 * np.abs(np.sin(np.pi * rate * t + r.random() * 3)) ** 0.7
    grit = 1 + 0.6 * bp(r.standard_normal(len(t)), 20, 180)
    e = np.minimum(1, t / 0.03) * np.minimum(1, (d - t) / 0.08)
    return norm(x * strokes * np.clip(grit, 0.2, 2) * e)


def paper_slap(seed=0):
    d = 0.35
    x = bp(noise(d, seed=seed), 250, 5000) * env_ad(int(d * SR), 0.002, 0.06)
    th = sine(lambda t: 140 * np.exp(-t * 18) + 70, d) * env_ad(int(d * SR), 0.001, 0.07)
    crinkle = bp(noise(d, seed=seed + 5), 3000, 9000) * env_ad(int(d * SR), 0.01, 0.12) * 0.3
    return norm(x + 0.9 * th + crinkle)


def card_flick(seed=0):
    d = 0.25
    return norm(bp(noise(d, seed=seed), 2000, 9000) * env_ad(int(d * SR), 0.001, 0.025) + 0.4 * sine(2400, d) * env_ad(int(d * SR), 0.001, 0.01))


def marker(d=0.5, seed=0):
    t = t_axis(d)
    x = bp(noise(d, seed=seed), 900, 3500)
    sq = sine(lambda tt: 1500 + 300 * np.sin(2 * np.pi * 7 * tt), d) * 0.25
    e = np.minimum(1, t / 0.02) * np.minimum(1, (d - t) / 0.05)
    return norm((x + sq) * e)


def highlighter(d=0.35, seed=0):
    t = t_axis(d)
    x = bp(noise(d, seed=seed), 600, 2600)
    e = np.sin(np.pi * np.clip(t / d, 0, 1)) ** 0.8
    return norm(x * e)


def mug(seed=0):
    d = 0.6
    n = int(d * SR)
    th = sine(lambda t: 170 * np.exp(-t * 10) + 95, d) * env_ad(n, 0.001, 0.09)
    ring = (sine(1180, d) * 0.5 + sine(2390, d) * 0.3 + sine(3710, d) * 0.15) * env_ad(n, 0.001, 0.18)
    clk = bp(noise(d, seed=seed), 1500, 8000) * env_ad(n, 0.0005, 0.01)
    return norm(th + 0.35 * ring + 0.6 * clk)


def buzz(seed=0):
    d = 0.7
    t = t_axis(d)
    v = np.sign(sine(172, d)) * 0.6 + sine(172, d) * 0.4
    gate = ((t % 0.35) < 0.2).astype(float)
    gate = np.convolve(gate, np.ones(240) / 240, 'same')
    rattle = bp(noise(d, seed=seed), 150, 900) * 0.3
    return norm(bp(v, 80, 1200) * gate + rattle * gate)


def ping(alt=False):
    d = 0.7
    n = int(d * SR)
    f1, f2 = (1318.5, 1760.0) if not alt else (1568.0, 1174.7)
    a = (sine(f1, d) + 0.3 * sine(f1 * 2, d)) * env_ad(n, 0.002, 0.12)
    b = np.zeros(n)
    k = int(0.09 * SR)
    b[k:] = ((sine(f2, d) + 0.3 * sine(f2 * 2, d)) * env_ad(n, 0.002, 0.2))[: n - k]
    return norm(a + b)


def sticky(seed=0):
    d = 0.4
    n = int(d * SR)
    tap = bp(noise(d, seed=seed), 400, 4000) * env_ad(n, 0.001, 0.03)
    peel = bp(noise(d, seed=seed + 3), 2500, 8000) * env_ad(n, 0.04, 0.12) * 0.35
    return norm(tap + peel)


def tick(i=0):
    d = 0.12
    n = int(d * SR)
    f = 3100 if i % 2 == 0 else 2600
    return norm(bp(noise(d, seed=50 + i % 2), 1500, 9000) * env_ad(n, 0.0003, 0.006) + 0.6 * sine(f, d) * env_ad(n, 0.0003, 0.012))


def timer_clunk(seed=0):
    d = 0.3
    n = int(d * SR)
    return norm(bp(noise(d, seed=seed), 300, 6000) * env_ad(n, 0.001, 0.02) + 0.7 * sine(lambda t: 420 * np.exp(-t * 20) + 200, d) * env_ad(n, 0.001, 0.05))


def key(seed=0):
    r = np.random.default_rng(seed)
    d = 0.09
    n = int(d * SR)
    x = bp(noise(d, seed=seed + 200), 1800 + r.random() * 800, 7000) * env_ad(n, 0.0004, 0.007)
    th = sine(380 + r.random() * 80, d) * env_ad(n, 0.0005, 0.012) * 0.5
    return norm(x + th) * (0.7 + 0.3 * r.random())


def typing(d, seed=0, ramp=True):
    out = np.zeros(int(d * SR))
    r = np.random.default_rng(seed + 300)
    t = 0.0
    while t < d - 0.1:
        k = key(int(r.integers(0, 10000)))
        g = (0.35 + 0.65 * (t / d)) if ramp else 1
        i = int(t * SR)
        out[i:i + len(k)] += k[: len(out) - i] * g
        t += 0.06 + r.random() * 0.12 if r.random() > 0.08 else 0.25
    return norm(out)


def page_turn(seed=0, d=0.55):
    t = t_axis(d)
    x = noise(d, seed=seed)
    sweep = np.array([0.0])
    c = bp(x, 400, 6000)
    e = np.sin(np.pi * np.clip(t / d, 0, 1)) ** 1.5
    crk = bp(noise(d, seed=seed + 7), 3000, 10000) * (np.random.default_rng(seed).random(len(t)) > 0.995) * 3
    return norm(c * e + crk * e)


def paper_shuffle(seed=0):
    return norm(page_turn(seed, 0.4) + 0.7 * np.concatenate([np.zeros(int(0.12 * SR)), page_turn(seed + 1, 0.4)])[: int(0.4 * SR)])


def whoosh(d=0.7, lo=300, hi=3500, up=True, seed=0):
    t = t_axis(d)
    x = noise(d, 'pink', seed=seed)
    # time-varying bandpass: crossfade 6 bands
    out = np.zeros_like(x)
    bands = np.geomspace(lo, hi, 7)
    for i in range(6):
        b = bp(x, bands[i], bands[i + 1])
        pos = (i + 0.5) / 6
        centre = (t / d) if up else 1 - (t / d)
        w = np.exp(-((centre - pos) ** 2) / 0.03)
        out += b * w
    e = np.sin(np.pi * np.clip(t / d, 0, 1)) ** 2
    return norm(out * e)


def settle(seed=0):
    a, b = page_turn(seed, 0.35), paper_slap(seed)
    return norm(a * 0.6 + b[: len(a)] * 0.4)


def logo_bloom():
    d = 2.2
    t = t_axis(d)
    air = whoosh(1.0, 800, 8000, True, 9)
    air = np.concatenate([air, np.zeros(int(d * SR) - len(air))])
    sh = sum(sine(f, d) * 0.2 for f in (2349.3, 2793.8, 3520.0)) * np.exp(-t * 2.2) * np.minimum(1, t / 0.02)
    sub = sine(73.4, d) * np.exp(-t * 3) * np.minimum(1, t / 0.01) * 0.6
    return norm(air * 0.35 + sh + sub)


def paper_fold():
    d = 0.6
    a = page_turn(11, 0.3)
    b = page_turn(12, 0.3)
    out = np.zeros(int(d * SR)); out[: len(a)] += a; out[int(0.25 * SR): int(0.25 * SR) + len(b)] += b * 0.8
    return norm(out)


def ui_tap(big=False):
    d = 0.15
    n = int(d * SR)
    p = sine(lambda t: 900 * np.exp(-t * 30) + 520, d) * env_ad(n, 0.001, 0.03)
    c = bp(noise(d, seed=77), 2000, 8000) * env_ad(n, 0.0003, 0.004) * 0.4
    x = p + c
    if big:
        x += sine(lambda t: 160 * np.exp(-t * 20) + 90, d) * env_ad(n, 0.001, 0.05) * 0.8
    return norm(x)


def pop():
    d = 0.18
    n = int(d * SR)
    return norm(sine(lambda t: 380 + 1400 * (t / d), d) * env_ad(n, 0.001, 0.035))


def sheet():
    return whoosh(0.35, 500, 3000, True, 21)


def chime(alt=False):
    d = 1.8
    t = t_axis(d)
    notes = (880.0, 1318.5) if not alt else (1174.7, 880.0)
    out = np.zeros(int(d * SR))
    for k, f in enumerate(notes):
        s = int(k * 0.11 * SR)
        m = sine(f * 3.5, d - k * 0.11) * np.exp(-t[: len(t) - s] * 6) * 1.2
        car = np.sin(2 * np.pi * f * t[: len(t) - s] + m) * np.exp(-t[: len(t) - s] * 2.6)
        out[s:] += car
    return norm(out)


def confetti():
    d = 1.2
    out = np.zeros(int(d * SR))
    r = np.random.default_rng(88)
    for i in range(26):
        s = int(r.random() ** 1.6 * 0.9 * SR)
        f = 2500 + r.random() * 4000
        b = sine(f, 0.05) * env_ad(int(0.05 * SR), 0.001, 0.01)
        out[s:s + len(b)] += b * (0.3 + 0.7 * r.random())
    fwip = whoosh(0.3, 1500, 8000, True, 5)
    out[: len(fwip)] += fwip * 0.8
    return norm(out)


def rain(d=4.6):
    t = t_axis(d)
    bed = bp(noise(d, 'pink', seed=31), 900, 7000)
    drops = np.zeros(len(t))
    r = np.random.default_rng(32)
    for i in range(int(d * 55)):
        s = int(r.random() * (len(t) - 2000))
        f = 2000 + r.random() * 3000
        b = sine(f, 0.02) * env_ad(int(0.02 * SR), 0.0005, 0.004)
        drops[s:s + len(b)] += b * r.random()
    e = np.minimum(1, t / 0.8) * np.minimum(1, (d - t) / 0.8)
    return norm((bed * 0.6 + drops * 0.5) * e)


def check():
    a = pencil(0.18, 5)
    b = ui_tap()
    out = np.zeros(int(0.3 * SR)); out[: len(a)] += a * 0.7; out[int(0.1 * SR): int(0.1 * SR) + len(b)] += b
    return norm(out)


def stack_thud():
    d = 0.4
    n = int(d * SR)
    return norm(sine(lambda t: 120 * np.exp(-t * 12) + 60, d) * env_ad(n, 0.001, 0.08) + 0.5 * bp(noise(d, seed=9), 300, 3000) * env_ad(n, 0.001, 0.05))


def tape():
    d = 0.45
    t = t_axis(d)
    x = bp(noise(d, seed=41), 1500, 9000) * (0.5 + 0.5 * np.abs(np.sin(2 * np.pi * 45 * t)))
    return norm(x * np.minimum(1, t / 0.02) * np.minimum(1, (d - t) / 0.1))


def scribble(d=0.35):
    t = t_axis(d)
    x = bp(noise(d, seed=61), 1500, 6000) * (0.4 + 0.6 * np.abs(np.sin(2 * np.pi * 11 * t)))
    return norm(x * np.minimum(1, t / 0.02) * np.minimum(1, (d - t) / 0.05))


def fall():
    w = whoosh(0.45, 1500, 200, False, 71)
    s = paper_slap(72)
    out = np.zeros(len(w) + len(s)); out[: len(w)] += w * 0.6; out[int(0.38 * SR): int(0.38 * SR) + len(s)] += s * 0.5
    return norm(out)


def chaos_bed(d=6.0):
    """tension under the chaos: detuned drone + filtered rumble, swelling, hard-cut at the freeze."""
    t = t_axis(d)
    drone = sum(sine(f, d) for f in (110.0, 116.5, 164.8, 174.6)) / 4
    rumble = bp(noise(d, 'brown', seed=81), 30, 300)
    hiss = bp(noise(d, seed=82), 3000, 9000) * 0.15
    e = (t / d) ** 2.2
    trem = 1 + 0.25 * np.sin(2 * np.pi * (2 + 6 * t / d) * t)
    return norm((drone * 0.6 + rumble * 0.5 + hiss) * e * trem)


def riser(d=2.3):
    return whoosh(d, 300, 9000, True, 91)


def roomtone(d=60.0):
    x = bp(noise(d, 'pink', seed=3), 40, 2500)
    return norm(x)


# ---------------------------------------------------------------- placement
def load_wav(path):
    w = wave.open(path)
    sr, ch = w.getframerate(), w.getnchannels()
    a = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float64) / 32768
    a = a.reshape(-1, ch)
    assert sr == SR, (path, sr)
    return a if ch == 2 else np.repeat(a, 2, axis=1)


def place(bus, mono, t, gain=1.0, pan=0.0):
    s = int(round(t * SR))
    if s >= len(bus):
        return
    x = mono[: len(bus) - s] * gain
    L, R = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    bus[s:s + len(x), 0] += x * L * 1.414
    bus[s:s + len(x), 1] += x * R * 1.414


PANS = {'ping': -0.35, 'ping2': 0.4, 'buzz': 0.45, 'mug': -0.5, 'sticky': 0.2, 'key': 0.0, 'typing': -0.1}


def build():
    cues = json.load(open('audio/cues.json'))
    sfx = np.zeros((N, 2))
    amb = np.zeros((N, 2))
    k = 0
    for c in cues:
        t, cid, g = c['t'], c['id'], c['g']
        dur = c.get('dur', 0.5)
        k += 1
        pan = PANS.get(cid, 0.0) + (np.random.default_rng(k).random() - 0.5) * 0.3
        if cid == 'roomtone':
            place(amb, roomtone(), 0, db(-58)); continue
        x, lvl = None, -18
        if cid == 'pencil': x, lvl = pencil(dur, k), -21
        elif cid == 'pencilLong': x, lvl = pencil(dur, k, glide=True), -22
        elif cid == 'paperSlap': x, lvl = paper_slap(k), -16
        elif cid == 'cardFlick': x, lvl = card_flick(k), -22
        elif cid == 'marker': x, lvl = marker(dur, k), -23
        elif cid == 'highlighter': x, lvl = highlighter(dur, k), -25
        elif cid == 'mug': x, lvl = mug(k), -15
        elif cid == 'buzz': x, lvl = buzz(k), -22
        elif cid in ('ping', 'ping2'): x, lvl = ping(cid == 'ping2'), -24
        elif cid == 'sticky': x, lvl = sticky(k), -22
        elif cid == 'tick': x, lvl = tick(k), -21
        elif cid == 'timerClunk': x, lvl = timer_clunk(k), -17
        elif cid == 'typing': x, lvl = typing(dur, c.get('seed', 0)), -27
        elif cid == 'key': x, lvl = key(k), -26
        elif cid == 'pageTurn': x, lvl = page_turn(k), -22
        elif cid == 'paperShuffle': x, lvl = paper_shuffle(k), -22
        elif cid == 'chaosBed': x, lvl = chaos_bed(dur), -26
        elif cid == 'fall': x, lvl = fall(), -20
        elif cid == 'settle': x, lvl = settle(k), -26
        elif cid == 'logoBloom': x, lvl = logo_bloom(), -18
        elif cid == 'swish': x, lvl = whoosh(0.4, 800, 6000, True, k), -25
        elif cid == 'whoosh': x, lvl = whoosh(0.7, 300, 4000, True, k), -21
        elif cid == 'whooshSoft': x, lvl = whoosh(0.45, 600, 5000, True, k), -27
        elif cid == 'whooshAway': x, lvl = whoosh(0.9, 200, 5000, True, k), -17
        elif cid == 'whooshUp': x, lvl = whoosh(1.6, 200, 7000, True, k), -21
        elif cid == 'paperFold': x, lvl = paper_fold(), -20
        elif cid == 'uiTap': x, lvl = ui_tap(), -22
        elif cid == 'uiTapBig': x, lvl = ui_tap(True), -17
        elif cid == 'pop': x, lvl = pop(), -25
        elif cid == 'sheet': x, lvl = sheet(), -24
        elif cid == 'chime': x, lvl = chime(bool(c.get('alt'))), -17
        elif cid == 'confetti': x, lvl = confetti(), -25
        elif cid == 'rain': x, lvl = rain(dur), -27
        elif cid == 'check': x, lvl = check(), -19
        elif cid == 'stackThud': x, lvl = stack_thud(), -19
        elif cid == 'tape': x, lvl = tape(), -24
        elif cid == 'scribble': x, lvl = scribble(dur), -22
        elif cid == 'riser': x, lvl = riser(dur), -26
        if x is None:
            print('unknown cue', cid); continue
        place(sfx, x, t, db(lvl) * g, pan)

    # ---- VO
    vo = np.zeros((N, 2))
    lines = json.load(open('tools/vo-lines.json'))
    for ln in lines:
        a = load_wav(f"audio/vo/{ln['id']}.wav")
        a = a / (np.abs(a).max() + 1e-9) * db(-4)   # consistent line peaks
        s = int(ln['at'] * SR)
        vo[s:s + len(a)] += a[: N - s]
    # gentle VO EQ: high-pass 90 Hz, presence lift is left to the voice
    for c in range(2):
        vo[:, c] = bp(vo[:, c], 90, 16000)

    # ---- music + ducking from VO activity
    music = load_wav('audio/music.wav')[:N]
    music = np.vstack([music, np.zeros((N - len(music), 2))])
    act = np.abs(vo).max(axis=1)
    hop = int(0.01 * SR)
    frames = np.array([act[i:i + hop].max() for i in range(0, N, hop)])
    on = (frames > db(-38)).astype(float)
    # hold 180 ms, attack 60 ms, release 350 ms
    held = np.array([on[max(0, i - 18):i + 1].max() for i in range(len(on))])
    sm = np.zeros_like(held); v = 0.0
    for i, h in enumerate(held):
        tc = 0.06 if h > v else 0.35
        v += (h - v) * (1 - np.exp(-0.01 / tc)); sm[i] = v
    duck_db = -9.0
    gain = db(duck_db * sm)
    gain_s = np.repeat(gain, hop)[:N]
    music *= gain_s[:, None] * db(-0.5)
    sfx_duck = db(-3.0 * sm); sfx *= np.repeat(sfx_duck, hop)[:N][:, None]

    # chaos builds: SFX swell +4 dB from 2 s to the freeze
    tt = np.arange(N) / SR
    sfx *= db(4.0 * np.clip((tt - 2.0) / 7.5, 0, 1) * (tt < 10.0))[:, None]
    mix = vo + music + sfx + amb
    # ---- silence beat: near-silent 10.0 → 10.625 (only a -60 dB room floor)
    a, b = int(SILENCE[0] * SR), int(SILENCE[1] * SR)
    fade = int(0.012 * SR)
    mix[a - fade:a] *= np.linspace(1, 0, fade)[:, None]
    mix[a:b] = amb[a:b] * db(-4)
    mix[b:b + fade] *= np.linspace(0, 1, fade)[:, None]
    # ---- ends: 0.35 s fade-in of room tone at start, 1.2 s tail fade at 60 s
    mix[: int(0.02 * SR)] *= np.linspace(0, 1, int(0.02 * SR))[:, None]
    mix[-int(1.2 * SR):] *= np.linspace(1, 0, int(1.2 * SR))[:, None] ** 1.5
    peak = np.abs(mix).max()
    if peak > 0.98:
        mix *= 0.98 / peak
    write('audio/mix_pre.wav', mix)
    write('audio/stem_vo.wav', vo); write('audio/stem_music_ducked.wav', music); write('audio/stem_sfx.wav', sfx + amb)
    np.save('audio/duck_envelope.npy', sm)
    print('mix written; peak', 20 * np.log10(np.abs(mix).max()))


def write(path, a):
    a = np.clip(a, -1, 1)
    w = wave.open(path, 'wb'); w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((a * 32767).astype('<i2').tobytes()); w.close()


if __name__ == '__main__':
    build()
