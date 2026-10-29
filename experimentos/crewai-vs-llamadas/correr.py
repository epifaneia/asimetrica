"""correr.py — ejecuta A y B alternadas, N veces, y registra cada ejecución en resultados/runs.jsonl.

Requisitos: Ollama en :11434 y el proxy (proxy.py) en :11435.
Cada ejecución es un proceso nuevo. Antes de cada una se precalientan los dos modelos
directamente contra Ollama (sin pasar por el proxy, para que no cuente). Para A se usa
un almacén de CrewAI nuevo por ejecución (embeddings en frío en todas) y se borra al terminar.

Uso: python correr.py --runs 3 [--variantes A,B]
"""
from __future__ import annotations

import argparse
import json
import os
import platform
import shutil
import subprocess
import sys
import time
import urllib.request
from importlib.metadata import version
from pathlib import Path

import comun as C
from evaluar import medir_proxy, puntuar

OLLAMA = "http://localhost:11434"
PROXY_LOG = C.RESULTADOS / "proxy.jsonl"
SALIDAS = C.RESULTADOS / "salidas"
LOGS = C.RESULTADOS / "logs"
CMD = {"A": [sys.executable, str(C.RAIZ / "variante_a" / "auditoria_crew" / "main.py")],
       "B": [sys.executable, str(C.RAIZ / "variante_b" / "auditar.py")]}


def get(url):
    with urllib.request.urlopen(url, timeout=10) as r:
        return json.loads(r.read())


def post(url, body):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=600) as r:
        return json.loads(r.read())


def precalentar():
    post(OLLAMA + "/api/generate", {"model": C.MODELO, "prompt": "hola", "stream": False,
                                    "options": {"num_predict": 1, "temperature": 0}})
    post(OLLAMA + "/api/embed", {"model": C.MODELO_EMBED, "input": "hola"})


def lineas_proxy() -> list[dict]:
    if not PROXY_LOG.exists():
        return []
    return [json.loads(l) for l in PROXY_LOG.read_text(encoding="utf-8").splitlines() if l.strip()]


def meta() -> dict:
    ps = get(OLLAMA + "/api/ps").get("models", [])
    q = next((m for m in ps if m["name"].startswith(C.MODELO)), {})
    gpu = ""
    try:
        gpu = subprocess.run(["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader"],
                             capture_output=True, text=True, timeout=20).stdout.strip()
    except Exception:
        pass
    vram = q.get("size_vram", 0) / max(q.get("size", 1), 1)
    return {"modelo": C.MODELO, "modelo_embed": C.MODELO_EMBED, "temperatura": C.TEMPERATURA, "seed": C.SEED,
            "num_ctx": q.get("context_length"), "top_k": C.TOP_K, "crewai": version("crewai"),
            "ollama": get(OLLAMA + "/api/version")["version"], "python": platform.python_version(),
            "hardware": f"GPU {gpu}; Ollama carga {vram:.0%} de {C.MODELO} en VRAM (resto en CPU); {platform.processor()}"}


def una(var: str, n: int, M: dict) -> dict:
    precalentar()
    antes = len(lineas_proxy())
    salida = SALIDAS / f"{var.lower()}_run{n}.json"
    env = dict(os.environ, PYTHONUTF8="1", PYTHONIOENCODING="utf-8",
               CREWAI_DISABLE_TELEMETRY="true", OTEL_SDK_DISABLED="true", CREWAI_TRACING_ENABLED="false",
               CREWAI_STORAGE_DIR=f"crewai-vs-llamadas-run-{var}{n}-{int(time.time())}")
    env.pop("EXP_SOLO", None)
    LOGS.mkdir(parents=True, exist_ok=True)
    t0 = time.perf_counter()
    with (LOGS / f"{var.lower()}_run{n}.log").open("w", encoding="utf-8") as log:
        p = subprocess.run(CMD[var] + ["--salida", str(salida)], env=env, stdout=log, stderr=subprocess.STDOUT,
                           stdin=subprocess.DEVNULL, cwd=str(C.RAIZ))
    wall_proc = round(time.perf_counter() - t0, 2)
    if var == "A":   # borrar el almacén de embeddings de CrewAI de esta ejecución
        os.environ["CREWAI_STORAGE_DIR"] = env["CREWAI_STORAGE_DIR"]
        from crewai_core.paths import db_storage_path
        shutil.rmtree(db_storage_path(), ignore_errors=True)
    time.sleep(1)
    nuevas = lineas_proxy()[antes:]
    rec = {"variante": var, "run": n, "exit_code": p.returncode, "wall_proceso_s": wall_proc, "meta": M}
    rec.update(medir_proxy(nuevas))
    if salida.exists():
        out = json.loads(salida.read_text(encoding="utf-8"))
        rec["wall_s"] = out["wall_s"]
        rec["errores"] = len(out.get("errores", []))
        rec["errores_detalle"] = [f"{var} run{n}: {e}" for e in out.get("errores", [])]
        rec["reintentos"] = out.get("reintentos", 0)
        rec.update(puntuar(out))
    else:
        rec.update({"wall_s": None, "errores": 1, "errores_detalle": [f"{var} run{n}: el proceso no produjo salida (exit {p.returncode})"],
                    "reintentos": None, "aciertos": 0})
    with (C.RESULTADOS / "runs.jsonl").open("a", encoding="utf-8") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    print(f"{var} run{n}: aciertos {rec.get('aciertos')}/10 · llm {rec['llamadas_llm']} · emb {rec['llamadas_embed']} · "
          f"in {rec['tokens_in']} out {rec['tokens_out']} · {rec['wall_s']} s · exit {p.returncode}", flush=True)
    return rec


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", type=int, default=3)
    ap.add_argument("--variantes", default="A,B")
    ap.add_argument("--desde", type=int, default=1)
    a = ap.parse_args()
    try:
        get(OLLAMA + "/api/version")
        get(C.PROXY_URL + "/api/version")
    except Exception as e:
        sys.exit(f"Ollama o el proxy no responden: {e}")
    precalentar()
    M = meta()
    print(json.dumps(M, ensure_ascii=False), flush=True)
    for n in range(a.desde, a.desde + a.runs):
        for var in a.variantes.split(","):
            una(var, n, M)


if __name__ == "__main__":
    main()
