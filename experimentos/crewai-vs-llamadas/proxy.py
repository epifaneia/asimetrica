"""proxy.py — proxy HTTP que registra cada petición a Ollama.

Se pone delante de Ollama (por defecto :11435 -> :11434), reenvía todo tal cual
(incluido el streaming NDJSON) y escribe una línea JSONL por petición:

    ts, method, endpoint, model, stream, num_ctx (si la petición lo trae),
    status, prompt_eval_count, eval_count (del último fragmento de Ollama),
    duration_s (reloj de pared en el proxy), total_duration_s (lo que dice Ollama).

Las DOS variantes apuntan aquí, así que se miden con el mismo instrumento.

Uso:
    python proxy.py --listen 11435 --upstream http://localhost:11434 --log resultados/proxy.jsonl
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

from aiohttp import ClientSession, ClientTimeout, web

HOP = {"host", "content-length", "transfer-encoding", "connection", "keep-alive",
       "content-encoding", "accept-encoding"}


def _ultimo_json(buf: bytes) -> dict:
    """Contadores de tokens del final de la respuesta, en los dos dialectos de Ollama.

    · API nativa (/api/chat, /api/generate, /api/embed): NDJSON en streaming o un JSON;
      el último objeto trae prompt_eval_count / eval_count.
    · API compatible OpenAI (/v1/...): un JSON con "usage", o SSE ("data: {...}") cuyo
      último fragmento con "usage" trae prompt_tokens / completion_tokens.
    Se devuelve siempre con las claves nativas.
    """
    for linea in reversed(buf.strip().splitlines()):
        linea = linea.strip()
        if linea.startswith(b"data:"):
            linea = linea[5:].strip()
        if not linea or linea == b"[DONE]":
            continue
        try:
            obj = json.loads(linea)
        except Exception:
            continue
        if not isinstance(obj, dict):
            continue
        if "prompt_eval_count" in obj or "eval_count" in obj or obj.get("done"):
            return obj
        if obj.get("usage"):
            u = obj["usage"]
            return {"prompt_eval_count": u.get("prompt_tokens"), "eval_count": u.get("completion_tokens")}
        if "embeddings" in obj or "embedding" in obj:
            return obj
    return {}


def make_app(upstream: str, log_path: Path) -> web.Application:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    state: dict = {}

    async def on_startup(app):
        state["s"] = ClientSession(timeout=ClientTimeout(total=3600), auto_decompress=True)

    async def on_cleanup(app):
        await state["s"].close()

    async def handler(req: web.Request) -> web.StreamResponse:
        t0 = time.perf_counter()
        body = await req.read()
        try:
            pj = json.loads(body) if body else {}
        except Exception:
            pj = {}
        if not isinstance(pj, dict):
            pj = {}
        headers = {k: v for k, v in req.headers.items() if k.lower() not in HOP}
        url = upstream.rstrip("/") + req.rel_url.path_qs
        async with state["s"].request(req.method, url, data=body, headers=headers) as up:
            resp = web.StreamResponse(status=up.status)
            for k, v in up.headers.items():
                if k.lower() not in HOP:
                    resp.headers[k] = v
            await resp.prepare(req)
            tail = bytearray()                   # respuesta entera: un lote de embeddings no cabe en un "final"
            async for chunk in up.content.iter_any():
                await resp.write(chunk)
                tail += chunk
            await resp.write_eof()
            status = up.status
        fin = _ultimo_json(tail)
        opts = pj.get("options") or {}
        rec = {
            "ts": time.time(),
            "method": req.method,
            "endpoint": req.rel_url.path,
            "model": pj.get("model"),
            "stream": pj.get("stream"),
            "num_ctx": opts.get("num_ctx"),
            "temperature": opts.get("temperature", pj.get("temperature")),
            "has_format": "format" in pj or "response_format" in pj,
            "seed": opts.get("seed", pj.get("seed")),
            "n_messages": len(pj.get("messages") or []),
            "status": status,
            "prompt_eval_count": fin.get("prompt_eval_count"),
            "eval_count": fin.get("eval_count"),
            "duration_s": round(time.perf_counter() - t0, 3),
            "total_duration_s": (fin.get("total_duration") or 0) / 1e9 or None,
        }
        with log_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        return resp

    app = web.Application(client_max_size=256 * 1024 * 1024)
    app.on_startup.append(on_startup)
    app.on_cleanup.append(on_cleanup)
    app.router.add_route("*", "/{tail:.*}", handler)
    return app


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--listen", type=int, default=11435)
    ap.add_argument("--upstream", default="http://localhost:11434")
    ap.add_argument("--log", default=str(Path(__file__).parent / "resultados" / "proxy.jsonl"))
    a = ap.parse_args()
    # IPv4 e IPv6: en Windows "localhost" resuelve primero a ::1 y, si solo se escucha en
    # 127.0.0.1, cada conexión nueva paga ~2 s de espera antes de reintentar por IPv4.
    web.run_app(make_app(a.upstream, Path(a.log)), host=["127.0.0.1", "::1"], port=a.listen, print=None)


if __name__ == "__main__":
    main()
