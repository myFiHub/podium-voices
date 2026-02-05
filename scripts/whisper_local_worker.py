#!/usr/bin/env python3
"""
Server-local Whisper worker for Podium Voices.

This process is designed to be spawned by the Node ASR adapter and kept alive so the Whisper
model stays loaded between requests (lower latency, less variance).

Protocol: JSON Lines over stdin/stdout.

Request:
  {"id": 1, "op": "transcribe", "audioPath": "/tmp/foo.wav"}

Response (success):
  {"id": 1, "ok": true, "result": {"text": "...", "language": "en"}}

Response (error):
  {"id": 1, "ok": false, "error": "message"}

Dependencies (engine: faster-whisper):
  pip install faster-whisper

Notes:
  - For MVP we accept WAV input paths. The Node adapter is responsible for writing temp files.
  - We intentionally keep this worker minimal, synchronous per request, and easy to debug.
"""

from __future__ import annotations

import argparse
import json
import sys
import traceback
from typing import Any, Dict


def _print_json(obj: Dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _fatal_startup_error(msg: str) -> None:
    _print_json({"id": -1, "ok": False, "error": msg})
    sys.exit(2)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True, help="Whisper model name or local path (e.g. base, small)")
    parser.add_argument("--engine", default="faster-whisper", help="Engine selector (only faster-whisper supported in MVP)")
    args = parser.parse_args()

    if args.engine != "faster-whisper":
        _fatal_startup_error(f"Unsupported WHISPER_ENGINE '{args.engine}'. MVP worker supports only 'faster-whisper'.")

    try:
        from faster_whisper import WhisperModel  # type: ignore
    except Exception as e:
        _fatal_startup_error(
            "Failed to import faster_whisper. Install with: pip install faster-whisper. "
            f"Import error: {repr(e)}"
        )

    try:
        # Use CPU by default; users can tune environment/CUDA later.
        model = WhisperModel(args.model)
    except Exception as e:
        _fatal_startup_error(f"Failed to load Whisper model '{args.model}': {repr(e)}")

    # Ready signal (informational). The Node side does not require this, but it's useful in logs.
    _print_json({"id": 0, "ok": True, "event": "READY", "engine": args.engine, "model": args.model})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            req_id = req.get("id")
            op = req.get("op")
            if op != "transcribe":
                _print_json({"id": req_id, "ok": False, "error": f"Unsupported op: {op}"})
                continue

            audio_path = req.get("audioPath")
            if not audio_path or not isinstance(audio_path, str):
                _print_json({"id": req_id, "ok": False, "error": "Missing or invalid audioPath"})
                continue

            # Transcribe file.
            segments, info = model.transcribe(audio_path)
            text_parts = []
            for seg in segments:
                # Each segment has a `text` field. Keep whitespace stable.
                t = (seg.text or "").strip()
                if t:
                    text_parts.append(t)
            text = " ".join(text_parts).strip()

            _print_json(
                {
                    "id": req_id,
                    "ok": True,
                    "result": {
                        "text": text,
                        "language": getattr(info, "language", None),
                    },
                }
            )
        except Exception as e:
            _print_json(
                {
                    "id": req.get("id", None) if isinstance(req, dict) else None,
                    "ok": False,
                    "error": f"{repr(e)}",
                    "stack": traceback.format_exc(),
                }
            )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

