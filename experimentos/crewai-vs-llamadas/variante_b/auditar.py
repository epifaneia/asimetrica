"""Variante B — llamadas propias. Cinco pasos; solo el 3 invoca al modelo.

  1. Trocear (código): un fragmento por apartado numerado, con su número de apartado.
  2. Recuperar (código): BM25 top-k por requisito (kit.contexto.retrieve).
  3. Decidir (modelo): UNA llamada /api/chat por requisito con JSON Schema cerrado:
       veredicto ∈ {cumple, no_cumple, abierto}
       chunk_id  ∈ {ids recuperados para ESTE requisito} ∪ {"ninguno"}
       cita      texto copiado del fragmento
  4. Verificar (código): la cita tiene que estar en el fragmento citado
     (kit.guardarrail_out.quote_verify). La cita final es el texto del documento.
  5. Sellar (código): si un veredicto distinto de "abierto" se queda sin evidencia
     verificada, se degrada a "abierto". El apartado sale del fragmento, nunca del modelo.

Uso: python variante_b/auditar.py --salida resultados/salidas/b_run1.json
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import comun as C  # noqa: E402
from kit.contexto.retrieve import Retriever  # noqa: E402
from kit.guardarrail_out.quote_verify import seal  # noqa: E402
from kit.limpieza.text_norm import normalize  # noqa: E402

SISTEMA = """Eres un auditor técnico. Decides si una especificación de producto cumple un requisito de cliente.
Solo puedes usar los fragmentos que se te dan. Reglas:
- "cumple": un fragmento afirma algo que satisface el requisito por completo (si hay cifras, compáralas: el valor de la especificación debe alcanzar el exigido).
- "no_cumple": un fragmento afirma algo que contradice el requisito: una cifra que no llega, un rango más estrecho, una negación ("no admite", "no dispone").
- "abierto": ningún fragmento trata lo que pide el requisito. No deduzcas a partir de temas parecidos.
En "comparacion" escribe en una frase qué exige el requisito y qué dice la especificación.
En "chunk_id" elige el fragmento que decide; si es "abierto", "ninguno".
En "cita" copia LITERALMENTE la frase decisiva del fragmento elegido (vacío si es "abierto")."""


def esquema(ids: list[str]) -> dict:
    return {
        "type": "object",
        "properties": {
            "comparacion": {"type": "string"},
            "veredicto": {"type": "string", "enum": C.VEREDICTOS},
            "chunk_id": {"type": "string", "enum": ids + ["ninguno"]},
            "cita": {"type": "string"},
        },
        "required": ["comparacion", "veredicto", "chunk_id", "cita"],
    }


def llamar_modelo(sistema: str, usuario: str, schema: dict) -> dict:
    cuerpo = {
        "model": C.MODELO,
        "messages": [{"role": "system", "content": sistema}, {"role": "user", "content": usuario}],
        "format": schema,
        "stream": False,
        "options": {"temperature": C.TEMPERATURA, "seed": C.SEED},   # num_ctx: el del servidor, como en A
    }
    req = urllib.request.Request(C.PROXY_URL + "/api/chat", data=json.dumps(cuerpo).encode("utf-8"),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=1200) as r:
        raw = json.loads(r.read().decode("utf-8"))
    return json.loads(raw["message"]["content"])


def auditar() -> dict:
    # 1. Trocear
    chunks = C.trocear_spec(C.cargar_spec())
    by_id = {c["chunk_id"]: c for c in chunks}
    # 2. Recuperar: BM25 sobre texto sin acentos (el tokenizador del kit es [a-z0-9]+)
    para_buscar = [dict(c, buscar=normalize(c["titulo"] + " " + c["text"])[0]) for c in chunks]
    retr = Retriever(para_buscar, max_chars=0, text_key="buscar")

    salida, errores = [], []
    for req in C.cargar_requisitos():
        cand = retr.candidates(normalize(req["texto"])[0], top_k=C.TOP_K)
        ids = [c["chunk_id"] for c in cand]
        bloques = "\n\n".join(f"[{i}] {by_id[i]['text']}" for i in ids)
        usuario = f"REQUISITO {req['id']}: {req['texto']}\n\nFRAGMENTOS DE LA ESPECIFICACIÓN:\n\n{bloques}"
        # 3. Decidir: una llamada
        try:
            r = llamar_modelo(SISTEMA, usuario, esquema(ids))
        except Exception as e:  # noqa: BLE001
            errores.append(f"{req['id']}: {type(e).__name__}: {e}")
            r = {"veredicto": "abierto", "chunk_id": "ninguno", "cita": "", "comparacion": ""}
        # 4-5. Verificar y sellar
        ev = [] if r.get("chunk_id") == "ninguno" else [{"chunk_id": r.get("chunk_id"), "quote": r.get("cita", "")}]
        final, verificadas, flags = seal(r["veredicto"], ev, by_id, open_value="abierto")
        v = verificadas[0] if verificadas else None
        salida.append({
            "id": req["id"],
            "veredicto": final,
            "cita": v["quote"] if v else "",
            "seccion": v["section"] if v else None,          # del código, no del modelo
            "veredicto_modelo": r["veredicto"],
            "cita_modelo": r.get("cita", ""),
            "chunk_id": r.get("chunk_id"),
            "recuperados": [f"{c['chunk_id']}={by_id[c['chunk_id']]['section']}" for c in cand],
            "comparacion": r.get("comparacion", ""),
            "flags": flags,
        })
    return {"resultados": salida, "errores": errores, "reintentos": 0}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--salida", required=True)
    a = ap.parse_args()
    t0 = time.perf_counter()
    out = auditar()
    out["variante"] = "B"
    out["wall_s"] = round(time.perf_counter() - t0, 2)
    Path(a.salida).parent.mkdir(parents=True, exist_ok=True)
    Path(a.salida).write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
