# Synthesizes the promo's UI sound effects (no samples): click, whoosh, pop, chime, tick. 48 kHz mono WAV.
import numpy as np, wave
SR = 48000
rng = np.random.default_rng(7)
def save(name, x):
    x = x / (np.max(np.abs(x)) + 1e-9) * 0.9
    with wave.open(f"public/sfx/{name}.wav", "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((x * 32767).astype(np.int16).tobytes())
def t(d): return np.arange(int(SR * d)) / SR
def lp(x, a):  # one-pole low-pass
    y = np.zeros_like(x); acc = 0.0
    for i, v in enumerate(x): acc += a * (v - acc); y[i] = acc
    return y
# click: short filtered noise burst + tiny tonal body
d = t(0.05); click = rng.standard_normal(len(d)) * np.exp(-d * 180)
click = np.diff(lp(click, 0.5), prepend=0) * 3 + np.sin(2 * np.pi * 2400 * d) * np.exp(-d * 260) * 0.6
save("click", click)
# whoosh: noise swept through a resonant band, swelling then fading
d = t(0.55); n = rng.standard_normal(len(d)); env = np.sin(np.pi * np.clip(d / 0.55, 0, 1)) ** 2
cut = 0.02 + 0.25 * np.sin(np.pi * d / 0.55)
y = np.zeros_like(n); acc = 0.0; acc2 = 0.0
for i, v in enumerate(n):
    acc += cut[i] * (v - acc); acc2 += cut[i] * (acc - acc2); y[i] = acc - acc2 * 0.6
save("whoosh", y * env)
# pop: pitch-dropping sine blip
d = t(0.14); f = 900 * np.exp(-d * 18) + 260
save("pop", np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-d * 30))
# chime: two soft bell partials (E6 + B6) with long decay
d = t(1.4)
ch = sum(a * np.sin(2 * np.pi * fr * d) * np.exp(-d * k) for fr, a, k in [(1318.5, 1, 3.2), (1975.5, 0.5, 4.5), (2637, 0.25, 7), (659.25, 0.35, 2.5)])
save("chime", ch * (1 - np.exp(-d * 400)))
# tick: tiny wooden tick for the theme flips
d = t(0.04); save("tick", np.sin(2 * np.pi * 1700 * d) * np.exp(-d * 200) + rng.standard_normal(len(d)) * np.exp(-d * 400) * 0.3)
print("ok")
