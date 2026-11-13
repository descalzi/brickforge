#!/usr/bin/env python3
"""Download and unpack the official LDraw Parts Library outside Git history."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import tempfile
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

DEFAULT_URL = "https://library.ldraw.org/library/updates/complete.zip"
CHUNK_SIZE = 1024 * 1024


def safe_archive_path(root: Path, member_name: str) -> Path:
    """Resolve a ZIP member below root and reject traversal/absolute paths."""
    normalised = member_name.replace("\\", "/")
    member = PurePosixPath(normalised)
    if member.is_absolute() or not member.parts or any(part in {"", ".", ".."} for part in member.parts):
        raise ValueError(f"Unsafe path in LDraw archive: {member_name!r}")

    root_resolved = root.resolve()
    target = root.joinpath(*member.parts)
    if not target.resolve().is_relative_to(root_resolved):
        raise ValueError(f"Archive member escapes destination: {member_name!r}")
    return target


def download_archive(url: str, destination: Path, *, replace: bool = False) -> dict[str, str | int]:
    """Download, validate and safely unpack the upstream complete.zip archive."""
    if destination.exists():
        if not replace:
            raise FileExistsError(
                f"{destination} already exists; pass --replace to replace this local copy"
            )
        shutil.rmtree(destination)

    destination.parent.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256()
    total_bytes = 0

    with tempfile.NamedTemporaryFile(prefix="brickforge-ldraw-", suffix=".zip") as temporary:
        request = urllib.request.Request(
            url,
            headers={"User-Agent": "BrickForge-LDraw-library-fetcher/0.1"},
        )
        with urllib.request.urlopen(request, timeout=90) as response:
            with open(temporary.name, "wb") as archive_file:
                while chunk := response.read(CHUNK_SIZE):
                    archive_file.write(chunk)
                    digest.update(chunk)
                    total_bytes += len(chunk)

        with zipfile.ZipFile(temporary.name) as archive:
            corrupt_member = archive.testzip()
            if corrupt_member is not None:
                raise zipfile.BadZipFile(f"Corrupt archive member: {corrupt_member}")

            destination.mkdir(parents=True, exist_ok=True)
            for member_info in archive.infolist():
                target = safe_archive_path(destination, member_info.filename)
                if member_info.is_dir():
                    target.mkdir(parents=True, exist_ok=True)
                    continue

                target.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(member_info) as source, target.open("wb") as output:
                    shutil.copyfileobj(source, output)

    metadata: dict[str, str | int] = {
        "source_url": url,
        "downloaded_at_utc": datetime.now(timezone.utc).isoformat(),
        "archive_bytes": total_bytes,
        "archive_sha256": digest.hexdigest(),
        "note": "Original LDraw files and licence notices are retained unchanged.",
    }
    (destination / "brickforge-source.json").write_text(
        json.dumps(metadata, indent=2) + "\n",
        encoding="utf-8",
    )
    return metadata


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default=DEFAULT_URL, help="LDraw complete.zip URL")
    parser.add_argument(
        "--destination",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "data" / "vendor" / "ldraw",
        help="Local destination (ignored by Git)",
    )
    parser.add_argument(
        "--replace",
        action="store_true",
        help="Replace an existing local library copy",
    )
    args = parser.parse_args()

    metadata = download_archive(args.url, args.destination, replace=args.replace)
    print(f"LDraw library installed at: {args.destination.resolve()}")
    print(f"Archive SHA-256: {metadata['archive_sha256']}")
    print("Keep the source headers and licence/readme files with this library copy.")


if __name__ == "__main__":
    main()
