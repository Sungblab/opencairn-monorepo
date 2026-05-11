from __future__ import annotations

import subprocess
from typing import TYPE_CHECKING

from worker.lib import opendataloader_pdf as odl

if TYPE_CHECKING:
    from pathlib import Path


def test_empty_legacy_jar_is_not_available(monkeypatch, tmp_path: Path):
    jar = tmp_path / "opendataloader-pdf.jar"
    jar.write_bytes(b"")

    monkeypatch.setattr(odl, "OPENDATALOADER_CMD", "missing-opendataloader-pdf")
    monkeypatch.setattr(odl, "LEGACY_JAR_PATH", str(jar))
    monkeypatch.setattr(odl.shutil, "which", lambda _cmd: None)

    assert odl.legacy_jar_available() is False
    assert odl.opendataloader_available() is False


def test_run_opendataloader_prefers_packaged_cli(monkeypatch, tmp_path: Path):
    pdf = tmp_path / "sample.pdf"
    out_dir = tmp_path / "out"
    pdf.write_bytes(b"%PDF-1.4\n")
    out_dir.mkdir()
    calls: list[list[str]] = []

    def fake_run(cmd: list[str], **_kwargs):
        calls.append(cmd)
        return subprocess.CompletedProcess(cmd, 0, "", "")

    monkeypatch.setattr(odl, "OPENDATALOADER_CMD", "opendataloader-pdf")
    monkeypatch.setattr(odl.shutil, "which", lambda cmd: f"/usr/bin/{cmd}")
    monkeypatch.setattr(odl.subprocess, "run", fake_run)

    assert odl.run_opendataloader_pdf(pdf, out_dir, extract_images=True) == out_dir

    assert calls == [
        [
            "opendataloader-pdf",
            str(pdf),
            "-o",
            str(out_dir),
            "-f",
            "json",
            "--quiet",
            "--image-output",
            "external",
            "--image-dir",
            str(out_dir / "images"),
        ]
    ]


def test_normalize_current_json_schema_to_page_contract():
    data = {
        "number of pages": 2,
        "kids": [
            {
                "type": "paragraph",
                "page number": 1,
                "content": "Intro paragraph",
            },
            {
                "type": "table",
                "page number": 1,
                "rows": [
                    {
                        "type": "table row",
                        "cells": [
                            {
                                "kids": [
                                    {
                                        "type": "paragraph",
                                        "content": "Cell value",
                                    }
                                ]
                            }
                        ],
                    }
                ],
            },
            {
                "type": "image",
                "page number": 2,
                "source": "images/page-2-image-1.png",
                "bounding box": [10, 20, 70, 100],
            },
        ],
    }

    pages = odl.normalize_opendataloader_pages(data)

    assert pages[0]["text"] == "Intro paragraph\n\nCell value"
    assert len(pages[0]["tables"]) == 1
    assert pages[1]["figures"] == [
        {
            "file": "images/page-2-image-1.png",
            "kind": "image",
            "caption": None,
            "width": 60.0,
            "height": 80.0,
        }
    ]
