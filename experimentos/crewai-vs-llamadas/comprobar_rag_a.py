"""comprobar_rag_a.py — recall APROXIMADO del RAG de la variante A, fuera de la medición.

Reproduce el troceado de CrewAI (800 caracteres, solape 100), incrusta con el mismo
modelo de embeddings y consulta con el texto literal del requisito. CrewAI reescribe la
consulta con el LLM, así que esto solo aproxima lo que vio el lector. Llama a Ollama
directamente (no al proxy), así que no contamina resultados/proxy.jsonl.
"""
import json
import math
import urllib.request

import comun as C
from kit.limpieza.text_norm import normalize

spec, verdad = C.cargar_spec(), C.cargar_verdad()
trozos = [spec[i:i + 800] for i in range(0, len(spec), 700)]


def emb(xs):
    r = urllib.request.Request("http://localhost:11434/api/embed",
                               data=json.dumps({"model": C.MODELO_EMBED, "input": xs}).encode(),
                               headers={"Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(r).read())["embeddings"]


def cos(a, b):
    return sum(x * y for x, y in zip(a, b)) / math.sqrt(sum(x * x for x in a) * sum(y * y for y in b))


E = emb(trozos)
hits = n = 0
for q in C.cargar_requisitos():
    frase = verdad[q["id"]]["frase"]
    if not frase:
        continue
    qe = emb([q["texto"]])[0]
    top = sorted(((cos(qe, e), i) for i, e in enumerate(E)), reverse=True)[:C.TOP_K]
    clave = normalize(frase)[0][:60]
    ok = any(clave in normalize(trozos[i])[0] for s, i in top if s >= 0.35)
    hits += ok
    n += 1
    print(q["id"], "recuperado" if ok else "NO recuperado", [round(s, 2) for s, _ in top])
print(f"recall top-{C.TOP_K}: {hits}/{n} ({len(trozos)} trozos)")
