from __future__ import annotations

import json

import trimesh

from brickforge.cli import main


def test_inspect_cli_writes_machine_readable_report(tmp_path, capsys) -> None:
    mesh_path = tmp_path / "block.stl"
    report_path = tmp_path / "reports" / "block.json"
    trimesh.creation.box(extents=(20, 10, 5)).export(mesh_path)

    result = main([
        "inspect", str(mesh_path), "--units", "mm", "--json", str(report_path)
    ])

    captured = capsys.readouterr()
    report = json.loads(report_path.read_text(encoding="utf-8"))
    assert result == 0
    assert "closed_solid_checks_passed" in captured.out
    assert report["dimensions_mm"] == [20.0, 10.0, 5.0]
    assert report["self_intersection_status"] == "none_detected"


def test_inspect_cli_can_fail_on_mesh_review(tmp_path, capsys) -> None:
    mesh_path = tmp_path / "open.stl"
    mesh = trimesh.creation.box()
    mesh.faces = mesh.faces[:-2]
    mesh.export(mesh_path)

    result = main([
        "inspect", str(mesh_path), "--units", "mm", "--fail-on-review"
    ])

    assert result == 2
    assert "needs_review" in capsys.readouterr().out


def test_inspect_cli_reports_missing_input(tmp_path, capsys) -> None:
    result = main(["inspect", str(tmp_path / "missing.stl"), "--units", "mm"])

    assert result == 1
    assert "brickforge:" in capsys.readouterr().err
