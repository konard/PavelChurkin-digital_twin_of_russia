from __future__ import annotations

from textwrap import indent

from backend.app.schemas import ScenarioRun


def render_markdown(run: ScenarioRun) -> str:
    result = run.result
    source_lines: list[str] = []
    for source in result.get("sources", []):
        source_lines.append(
            "- "
            f"{source['source']} ({source['dataset_id']}), "
            f"version {source['source_version']}, "
            f"license: {source['license']}, "
            f"quality: {source['quality_flag']}"
        )
        for limitation in source.get("known_limitations", []):
            source_lines.append(f"  - limitation: {limitation}")

    return "\n".join(
        [
            f"# Scenario report: {run.scenario_id}",
            "",
            f"Run ID: `{run.id}`",
            f"Dataset version: `{run.dataset_version}`",
            f"Model version: `{run.model_version}`",
            f"Scenario version: `{run.scenario_version}`",
            "",
            "## Summary",
            str(result.get("summary", "No summary available.")),
            "",
            "## Result",
            indent(str({key: value for key, value in result.items() if key != "sources"}), "    "),
            "",
            "## Sources and Limitations",
            *(source_lines or ["- No sources recorded."]),
            "",
            "This report is incomplete by design: v0.1 uses only open and aggregated data.",
        ]
    )


def render_pdf(run: ScenarioRun) -> bytes:
    text = render_markdown(run).replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    stream = f"BT /F1 10 Tf 36 780 Td ({text[:2400]}) Tj ET"
    pdf = (
        "%PDF-1.4\n"
        "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n"
        "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n"
        "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
        "/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj\n"
        "4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n"
        f"5 0 obj << /Length {len(stream.encode('utf-8'))} >> stream\n"
        f"{stream}\n"
        "endstream endobj\n"
        "xref\n0 6\n0000000000 65535 f \n"
        "trailer << /Root 1 0 R /Size 6 >>\nstartxref\n0\n%%EOF\n"
    )
    return pdf.encode("utf-8")
