"""Measure offline retrieval metrics for the labeled public synthetic-manual fixture."""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services/api/src"))
from nexus_titan_api.knowledge import (
    EMBEDDING_PROVIDER,
    fixture_embedding,
    paragraph_chunks,
    rank_candidates,
)

fixture = json.loads(
    (ROOT / "tests/fixtures/knowledge/retrieval-eval.json").read_text(encoding="utf-8")
)
rows = []
for path in sorted((ROOT / "tests/fixtures/world/TITAN-WTP-01/manuals").glob("*.md")):
    content = path.read_text(encoding="utf-8")
    for index, (start, end, chunk) in enumerate(paragraph_chunks(content)):
        rows.append(
            {
                "document_id": path.stem,
                "source_version": "1.0.0",
                "chunk_index": index,
                "start_offset": start,
                "end_offset": end,
                "content": chunk,
                "content_sha256": hashlib.sha256(chunk.encode()).hexdigest(),
                "embedding": fixture_embedding(chunk),
                "embedding_provider": EMBEDDING_PROVIDER,
            }
        )

details = []
for item in fixture["queries"]:
    ranked = rank_candidates(item["query"], rows, top_k=20)
    best_by_document = {}
    for row in ranked:
        if (
            row["document_id"] not in best_by_document
            or row["score"] > best_by_document[row["document_id"]]["score"]
        ):
            best_by_document[row["document_id"]] = row
    retrieved = sorted(
        best_by_document.values(), key=lambda row: (-row["score"], row["document_id"])
    )[: fixture["top_k"]]
    got = [row["document_id"] for row in retrieved]
    relevant = set(item["relevant_documents"])
    relevant_retrieved = {document_id for document_id in got if document_id in relevant}
    details.append(
        {
            "query": item["query"],
            "retrieved": got,
            "relevant": sorted(relevant),
            "precision_at_k": sum(document_id in relevant for document_id in got)
            / len(got),
            "recall_at_k": len(relevant_retrieved) / len(relevant),
        }
    )
print(
    json.dumps(
        {
            "fixture_id": fixture["fixture_id"],
            "provider": EMBEDDING_PROVIDER,
            "chunks": len(rows),
            "k": fixture["top_k"],
            "macro_precision_at_k": sum(x["precision_at_k"] for x in details)
            / len(details),
            "macro_recall_at_k": sum(x["recall_at_k"] for x in details) / len(details),
            "queries": details,
        },
        indent=2,
    )
)
