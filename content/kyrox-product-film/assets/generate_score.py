"""Generate the film's original, royalty-free ambient score using Python's stdlib."""
import math
import random
import wave
from pathlib import Path

RATE = 48_000
DURATION = 38
OUT = Path(__file__).resolve().parents[1] / "public" / "original-score.wav"

# A slow, warm D-minor progression with soft plucks: no samples or third-party music.
CHORDS = [
    (73.42, 110.0, 146.83, 220.0),
    (65.41, 98.0, 130.81, 196.0),
    (87.31, 130.81, 174.61, 261.63),
    (58.27, 87.31, 116.54, 174.61),
]
random.seed(14)

def env(t: float, length: float) -> float:
    fade_in = min(1.0, t / 2.8)
    fade_out = min(1.0, (length - t) / 2.6)
    return max(0.0, min(fade_in, fade_out))

with wave.open(str(OUT), "wb") as wav:
    wav.setnchannels(2)
    wav.setsampwidth(2)
    wav.setframerate(RATE)
    block = bytearray()
    for n in range(RATE * DURATION):
        t = n / RATE
        chord = CHORDS[int(t // 9.5) % len(CHORDS)]
        fade = env(t, DURATION)
        sample = 0.0
        for i, hz in enumerate(chord):
            detune = 1.0 + (i - 1.5) * 0.00065
            phase = 2 * math.pi * hz * detune * t
            slow_mod = 0.86 + 0.14 * math.sin(2 * math.pi * 0.075 * t + i * 1.6)
            sample += (math.sin(phase) + 0.19 * math.sin(2 * phase)) * slow_mod / (4.2 + i * 0.7)
        # Gentle low pulse every two seconds to give scene changes a quiet anchor.
        beat = (t % 2.0)
        pulse_env = math.exp(-beat * 2.4) * (1.0 if beat < 0.58 else 0.0)
        sample += 0.12 * math.sin(2 * math.pi * 48 * beat) * pulse_env
        # A few quiet high notes, on a four-second cycle, add a restrained sparkle.
        for k, hz in enumerate((440.0, 554.37, 659.25)):
            event = (t - (4.0 * k + 1.4)) % 8.0
            if event < 0.85:
                pluck = math.exp(-event * 4.2) * math.sin(2 * math.pi * hz * event)
                sample += 0.075 * pluck
        sample *= fade * 0.42
        sample = max(-0.92, min(0.92, sample))
        left = int(sample * 32767)
        # Slight stereo width without a distracting pan effect.
        right = int(sample * (0.94 + 0.06 * math.sin(2 * math.pi * 0.045 * t)) * 32767)
        block.extend((left & 255, (left >> 8) & 255, right & 255, (right >> 8) & 255))
        if len(block) >= RATE * 4:
            wav.writeframesraw(block)
            block.clear()
    if block:
        wav.writeframesraw(block)
print(f"Wrote {OUT}")
