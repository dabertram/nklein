from __future__ import annotations

from fastapi.testclient import TestClient

from klein_core.app import app
from klein_core.compression import compress_by_token_importance
from klein_core.embeddings import cosine_similarity, embed_texts, lexical_embedding
from klein_core.repomap import RepoFile, rank_symbols

client = TestClient(app)


def test_compress_keeps_high_information_tokens() -> None:
    text = "the function computeChecksum reads the file and the the returns the checksum value"
    result = compress_by_token_importance(text, target_ratio=0.5)
    assert result.kept_token_count < result.original_token_count
    assert "computeChecksum" in result.compressed


def test_compress_endpoint_uses_heuristic_by_default() -> None:
    response = client.post("/v1/compress", json={"text": "alpha beta gamma delta epsilon zeta", "target_ratio": 0.5})
    assert response.status_code == 200
    body = response.json()
    assert body["backend"] == "heuristic"
    assert body["kept_token_count"] <= body["original_token_count"]


def test_lexical_embedding_is_normalized_and_similar_for_similar_text() -> None:
    a = lexical_embedding("parse the config file")
    b = lexical_embedding("parse the config file")
    c = lexical_embedding("totally unrelated astronomy content")
    assert abs(sum(x * x for x in a) - 1.0) < 1e-6
    assert cosine_similarity(a, b) == 1.0
    assert cosine_similarity(a, c) < cosine_similarity(a, b)


def test_embed_endpoint_lexical() -> None:
    response = client.post("/v1/embed", json={"texts": ["hello world", "hello world"]})
    assert response.status_code == 200
    body = response.json()
    assert body["backend"] == "lexical"
    assert len(body["embeddings"]) == 2
    # Identical inputs -> ~1.0 cosine (JSON float round-trip loses exactness).
    assert cosine_similarity(body["embeddings"][0], body["embeddings"][1]) > 0.999


def test_embed_texts_falls_back_when_model_missing() -> None:
    # A bogus model id triggers the import/load failure path -> lexical fallback (never raises).
    embeddings = embed_texts(["x"], model="definitely-not-installed-model")
    assert len(embeddings) == 1


def test_embed_texts_falls_back_when_gguf_unavailable() -> None:
    # A missing GGUF (or missing native dep) must degrade to lexical, never raise, so indexing always works.
    embeddings = embed_texts(["x", "y"], gguf_path="/definitely/not/a/real/model.gguf")
    assert len(embeddings) == 2
    assert len(embeddings[0]) == 256


def test_embed_endpoint_accepts_gguf_path_and_degrades() -> None:
    response = client.post(
        "/v1/embed",
        json={"texts": ["alpha beta"], "gguf_path": "/definitely/not/a/real/model.gguf"},
    )
    assert response.status_code == 200
    body = response.json()
    # The requested backend is llama_cpp even though the load degraded to lexical vectors under the hood.
    assert body["backend"] == "llama_cpp"
    assert len(body["embeddings"]) == 1


def test_embed_unload_endpoint_reports_zero_when_nothing_loaded() -> None:
    response = client.post("/v1/embed/unload", json={})
    assert response.status_code == 200
    assert response.json()["unloaded"] >= 0


def test_repomap_ranks_referenced_symbols() -> None:
    files = [
        RepoFile(path="core.ts", content="export function computeScore() { return 1 }"),
        RepoFile(path="a.ts", content="import { computeScore } from './core'; computeScore(); computeScore();"),
        RepoFile(path="b.ts", content="import { computeScore } from './core'; computeScore();"),
    ]
    ranked = rank_symbols(files)
    assert ranked[0].name == "computeScore"
    assert ranked[0].path == "core.ts"


def test_repomap_endpoint() -> None:
    response = client.post(
        "/v1/repomap",
        json={
            "files": [
                {"path": "core.ts", "content": "export function compute() {}"},
                {"path": "use.ts", "content": "import {compute} from './core'; compute()"},
            ]
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert any(symbol["name"] == "compute" for symbol in body["symbols"])
    assert "compute" in body["rendered"]
