"""Create an original, restrained 30-second KYROX score using only Python's stdlib."""
import math
import wave
from pathlib import Path

RATE = 48_000
DURATION = 30
OUT = Path(__file__).resolve().parents[1] / "public" / "showcase-score.wav"
CHORDS = ((55.0, 82.41, 110.0, 164.81), (49.0, 73.42, 98.0, 146.83), (65.41, 98.0, 130.81, 196.0))
MARKS = (4.0, 9.0, 15.0, 20.0, 25.0)


def smooth(t: float) -> float:
    return max(0.0, min(1.0, t)) ** 2 * (3.0 - 2.0 * max(0.0, min(1.0, t)))


with wave.open(str(OUT), "wb") as wav:
    wav.setnchannels(2)
    wav.setsampwidth(2)
    wav.setframerate(RATE)
    chunk = bytearray()
    for n in range(RATE * DURATION):
        t = n / RATE
        chord = CHORDS[min(2, int(t // 10))]
        fade = smooth(t / 1.2) * smooth((DURATION - t) / 2.0)
        pad = 0.0
        for index, hz in enumerate(chord):
            wobble = 1.0 + 0.00028 * math.sin(2 * math.pi * 0.035 * t + index)
            tone = math.sin(2 * math.pi * hz * wobble * t)
            overtone = math.sin(2 * math.pi * hz * 2 * t) * 0.12
            pad += (tone + overtone) / (6.2 + index * 1.8)
        pulse_phase = t % 5.0
        pulse = math.exp(-pulse_phase * 2.8) * math.sin(2 * math.pi * 43 * pulse_phase) * 0.075
        chime = 0.0
        for mark in MARKS:
            dt = t - mark
            if 0 <= dt < 0.55:
                envelope = math.exp(-dt * 9.0) * min(1.0, dt * 45.0)
                chime += envelope * (math.sin(2 * math.pi * 660 * dt) + 0.35 * math.sin(2 * math.pi * 990 * dt)) * 0.045
        sample = max(-0.9, min(0.9, (pad * 0.28 + pulse + chime) * fade * 3.0))
        left = int(sample * 32767)
        right = int(sample * (0.98 + 0.02 * math.sin(2 * math.pi * 0.025 * t)) * 32767)
        chunk.extend((left & 255, (left >> 8) & 255, right & 255, (right >> 8) & 255))
        if len(chunk) >= RATE * 4:
            wav.writeframesraw(chunk)
            chunk.clear()
    if chunk:
        wav.writeframesraw(chunk)
print(f"Wrote {OUT}")
