from __future__ import annotations

from pathlib import Path

from worker.activities import stt_activity


class FakeWhisperSegment:
    def __init__(self, start: float, end: float, text: str) -> None:
        self.start = start
        self.end = end
        self.text = text


class FakeWhisperModel:
    def transcribe(self, path: str, beam_size: int):
        assert path.endswith(".wav")
        assert beam_size == 5
        return (
            [
                FakeWhisperSegment(0.0, 2.25, " first "),
                FakeWhisperSegment(2.25, 4.5, "second"),
            ],
            object(),
        )


def test_local_whisper_preserves_segment_timestamps(monkeypatch):
    monkeypatch.setattr(stt_activity, "_whisper_model", FakeWhisperModel())

    result = stt_activity._local_whisper(Path("lecture.wav"))

    assert result["text"] == "first second"
    assert result["segments"] == [
        {
            "index": 0,
            "startSec": 0.0,
            "endSec": 2.25,
            "text": "first",
            "speaker": None,
            "language": None,
            "confidence": None,
        },
        {
            "index": 1,
            "startSec": 2.25,
            "endSec": 4.5,
            "text": "second",
            "speaker": None,
            "language": None,
            "confidence": None,
        },
    ]


def test_text_only_provider_result_gets_whole_recording_segment():
    result = stt_activity._normalize_transcription_result(
        "plain transcript",
        provider="gemini",
        model="gemini-3-flash-preview",
        duration_sec=12.5,
    )

    assert result == {
        "text": "plain transcript",
        "transcript": "plain transcript",
        "provider": "gemini",
        "model": "gemini-3-flash-preview",
        "segments": [
            {
                "index": 0,
                "startSec": 0.0,
                "endSec": 12.5,
                "text": "plain transcript",
                "speaker": None,
                "language": None,
                "confidence": None,
            }
        ],
    }
