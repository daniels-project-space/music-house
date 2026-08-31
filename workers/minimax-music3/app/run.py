#!/usr/bin/env python3
"""One isolated MiniMax Music3 render using presigned Music House R2 links."""

from __future__ import annotations

import io
import json
import os
import time
import urllib.error
import urllib.request
import wave


INPUT_URL = os.environ["MUSIC_HOUSE_MINIMAX_MUSIC3_INPUT_URL"]
OUTPUT_URL = os.environ["MUSIC_HOUSE_MINIMAX_MUSIC3_OUTPUT_URL"]
STATUS_URL = os.environ["MUSIC_HOUSE_MINIMAX_MUSIC3_STATUS_URL"]


def get_json(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=120) as response:
        return json.loads(response.read().decode("utf-8"))


def upload(url: str, body: bytes, content_type: str) -> None:
    request = urllib.request.Request(url, data=body, method="PUT", headers={"Content-Type": content_type})
    with urllib.request.urlopen(request, timeout=180) as response:
        response.read()


def wait_for_server() -> None:
    deadline = time.monotonic() + 15 * 60
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen("http://127.0.0.1:8000/health", timeout=5) as response:
                if 200 <= response.status < 300:
                    return
        except (urllib.error.URLError, TimeoutError):
            pass
        time.sleep(2)
    raise RuntimeError("sgl-omni did not become healthy within 15 minutes")


def wav_metadata(data: bytes) -> tuple[int, int, int]:
    with wave.open(io.BytesIO(data), "rb") as rendered:
        channels = rendered.getnchannels()
        sample_rate = rendered.getframerate()
        duration = round(rendered.getnframes() / sample_rate) if sample_rate else 0
    if sample_rate != 32_000 or channels != 2:
        raise RuntimeError(f"expected 32 kHz stereo WAV, received {sample_rate} Hz/{channels}ch")
    return sample_rate, channels, duration


def main() -> None:
    config = get_json(INPUT_URL)
    wait_for_server()
    payload = json.dumps(config).encode("utf-8")
    request = urllib.request.Request(
        "http://127.0.0.1:8000/v1/audio/speech",
        data=payload,
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=30 * 60) as response:
        audio = response.read()
    sample_rate, channels, duration = wav_metadata(audio)
    upload(OUTPUT_URL, audio, "audio/wav")
    upload(STATUS_URL, json.dumps({
        "status": "complete",
        "sampleRate": sample_rate,
        "channels": channels,
        "durationSeconds": duration,
        "bytes": len(audio),
    }).encode("utf-8"), "application/json")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        try:
            upload(STATUS_URL, json.dumps({"status": "failed", "error": str(error)[:700]}).encode("utf-8"), "application/json")
        finally:
            raise
