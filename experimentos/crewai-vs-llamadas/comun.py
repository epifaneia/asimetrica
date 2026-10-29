"""comun.py — configuración y utilidades compartidas por las dos variantes y el evaluador.

Todo lo que debe ser IDÉNTICO entre variantes vive aquí: modelo, temperatura,
ventana de contexto, URL del proxy, datos de entrada.
"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent
DATOS = RAIZ / "datos"
RESULTADOS = RAIZ / "resultados"
sys.path.insert(0, str(RAIZ / "vendor"))   # kit.* copiado del toolkit (ver vendor/LEEME.md)

# --- Lo que comparten las dos variantes -------------------------------------
MODELO = os.environ.get("EXP_MODELO", "qwen2.5:7b")
MODELO_EMBED = os.environ.get("EXP_MODELO_EMBED", "mxbai-embed-large")
PROXY_URL = os.environ.get("EXP_PROXY_URL", "http://localhost:11435")
TEMPERATURA = 0.0
NUM_CTX_SERVIDOR = 4096   # contexto por defecto de Ollama aquí; A no puede cambiarlo por /v1, así que B tampoco lo toca
SEED = 42
TOP_K = 4            # fragmentos que ve el modelo por requisito (B: BM25; A: results_limit del RAG)
VEREDICTOS = ["cumple", "no_cumple", "abierto"]
DOC_ID = "HV-R2-ET"


def cargar_spec() -> str:
    return (DATOS / "spec.md").read_text(encoding="utf-8")


def cargar_requisitos() -> list[dict]:
    reqs = json.loads((DATOS / "requisitos.json").read_text(encoding="utf-8"))
    solo = os.environ.get("EXP_SOLO")          # solo para pruebas de humo: EXP_SOLO=R02,R04
    return [r for r in reqs if r["id"] in solo.split(",")] if solo else reqs


def cargar_verdad() -> dict:
    return json.loads((DATOS / "verdad.json").read_text(encoding="utf-8"))


_H3 = re.compile(r"^###\s+(\d+\.\d+)\s+(.+?)\s*$", re.MULTILINE)


def trocear_spec(spec: str) -> list[dict]:
    """Un fragmento por apartado numerado (### N.M). Determinista.

    Contrato de chunk del toolkit: chunk_id, doc, section, text, page_start, page_map.
    La especificación no tiene páginas: page_start = 1 y la ubicación útil es `section`.
    """
    marcas = list(_H3.finditer(spec))
    chunks = []
    for i, m in enumerate(marcas):
        fin = marcas[i + 1].start() if i + 1 < len(marcas) else len(spec)
        cuerpo = spec[m.end():fin]
        cuerpo = re.split(r"^##\s", cuerpo, flags=re.MULTILINE)[0].strip()   # no arrastrar el título del siguiente capítulo
        chunks.append({
            "chunk_id": f"c{i + 1:02d}",
            "doc": DOC_ID,
            "section": m.group(1),
            "titulo": m.group(2),
            "text": cuerpo,
            "page_start": 1,
            "page_map": [],
        })
    return chunks


def seccion_de(texto: str | None) -> str | None:
    """Extrae el primer número de apartado N.M de un texto libre (lo que escriba el modelo)."""
    if not texto:
        return None
    m = re.search(r"\b(\d+\.\d+)\b", str(texto))
    return m.group(1) if m else None
