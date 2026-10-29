"""evaluar.py — puntúa las salidas de las dos variantes con el MISMO código y resume.

  · Acierto: veredicto final == verdad.json.
  · Cita literal: la cita final aparece en la especificación (kit.limpieza.text_norm,
    literal tras normalizar tipografía; sin umbral). Mismo comprobador para A y B.
  · Cita decisiva: además de literal, solapa con la frase que decide según verdad.json.
  · Apartado correcto: el apartado devuelto coincide con el de verdad.json (8 requisitos con apartado).

Uso: python evaluar.py      → lee resultados/runs.jsonl y escribe resumen.json y RESULTADOS.md
"""
from __future__ import annotations

import json
import re
import statistics as st

import comun as C
from kit.limpieza.text_norm import find_literal_span, normalize

LLM_EP = {"/api/chat", "/api/generate", "/v1/chat/completions", "/v1/completions"}
EMB_EP = {"/api/embed", "/api/embeddings", "/v1/embeddings"}


def es_literal(cita: str, spec: str) -> bool:
    return bool(cita) and len(cita.strip()) >= 10 and find_literal_span(cita, spec) is not None


def solapa(cita: str, frase: str) -> bool:
    a, b = normalize(cita)[0], normalize(frase)[0]
    return bool(a) and (a in b or b in a)


def puntuar(salida: dict) -> dict:
    spec, verdad = C.cargar_spec(), C.cargar_verdad()
    por_req, aciertos, por_tipo = {}, 0, {}
    citas = literales = decisivas = sec_ok = 0
    citas_modelo = literales_modelo = 0
    for r in salida["resultados"]:
        v = verdad[r["id"]]
        ok = r["veredicto"] == v["veredicto"]
        aciertos += ok
        t = por_tipo.setdefault(v["tipo"], [0, 0])
        t[0] += ok
        t[1] += 1
        cita = r.get("cita") or ""
        lit = es_literal(cita, spec)
        if cita.strip():
            citas += 1
            literales += lit
            decisivas += bool(lit and v["frase"] and solapa(cita, v["frase"]))
        if "cita_modelo" in r and (r["cita_modelo"] or "").strip():   # B: lo que escribió el modelo, antes de verificar
            citas_modelo += 1
            literales_modelo += es_literal(r["cita_modelo"], spec)
        if v["seccion"]:
            sec_ok += r.get("seccion") == v["seccion"]
        por_req[r["id"]] = {"veredicto": r["veredicto"], "ok": ok, "cita_literal": lit,
                            "seccion": r.get("seccion"), "flags": r.get("flags", [])}
    out = {"aciertos": aciertos, "n": len(salida["resultados"]),
           "por_tipo": {k: f"{a}/{n}" for k, (a, n) in por_tipo.items()},
           "citas_no_vacias": citas, "citas_literales": literales, "citas_decisivas": decisivas,
           "apartado_correcto": sec_ok, "por_requisito": por_req}
    if citas_modelo or salida.get("variante") == "B":
        out["citas_modelo_no_vacias"] = citas_modelo
        out["citas_modelo_literales"] = literales_modelo
        out["degradados"] = sum(any(f.startswith("demoted") for f in r.get("flags", [])) for r in salida["resultados"])
    return out


def medir_proxy(lineas: list[dict]) -> dict:
    llm = [l for l in lineas if l["endpoint"] in LLM_EP]
    emb = [l for l in lineas if l["endpoint"] in EMB_EP]
    otras = [l for l in lineas if l["endpoint"] not in LLM_EP | EMB_EP]
    pin = [l.get("prompt_eval_count") or 0 for l in llm]
    return {
        "llamadas_llm": len(llm),
        "llamadas_embed": len(emb),
        "llamadas_otras": len(otras),
        "endpoints_llm": sorted({l["endpoint"] for l in llm}),
        "tokens_in": sum(pin),
        "tokens_out": sum(l.get("eval_count") or 0 for l in llm),
        "tokens_embed": sum(l.get("prompt_eval_count") or 0 for l in emb),
        "max_prompt_tokens": max(pin, default=0),
        "prompts_cerca_del_limite": sum(p >= 0.9 * C.NUM_CTX_SERVIDOR for p in pin),
        "llm_sin_contadores": sum(l.get("prompt_eval_count") is None for l in llm),
        "http_errores": sum((l.get("status") or 0) >= 400 for l in lineas),
        "segundos_en_modelo_llm": round(sum(l["duration_s"] for l in llm), 1),
        "segundos_en_embed": round(sum(l["duration_s"] for l in emb), 1),
    }


def primera_iteracion_A(log_path) -> list[dict]:
    """Dictámenes del orquestador de A en orden, sacados del log verbose de CrewAI.

    La primera iteración procesa R01..R10 en orden, así que los 10 primeros dictámenes
    son «A sin bucle de reintentos». Sirve para separar el efecto del bucle.
    """
    t = log_path.read_text(encoding="utf-8")
    out = []
    for seg in t.split("✅ Agent Final Answer")[1:]:
        lineas = [l.strip().strip("│").strip() for l in seg.split("└")[0].splitlines()]
        agente = next((l for l in lineas if l.startswith("Agent:")), "")
        if "Auditor jefe" not in agente:
            continue
        i = next(i for i, l in enumerate(lineas) if l.startswith("Final Answer"))
        txt = " ".join(lineas[i + 1:])
        v = re.search(r"veredicto='(\w+)'", txt)
        a = re.search(r"aprobado=(True|False)", txt)
        out.append({"veredicto": v.group(1) if v else None, "aprobado": (a.group(1) == "True") if a else None})
    return out


# ---------------------------------------------------------------- resumen
CAMPOS = [("aciertos", "Aciertos (x/10)"), ("llamadas_llm", "Llamadas al modelo (chat)"),
          ("llamadas_embed", "Llamadas de embeddings"), ("tokens_in", "Tokens de entrada"),
          ("tokens_out", "Tokens de salida"), ("tokens_embed", "Tokens de embeddings"),
          ("wall_s", "Tiempo de pared (s)"), ("segundos_en_modelo_llm", "Segundos dentro del modelo de chat (proxy)"), ("citas_no_vacias", "Citas devueltas"),
          ("citas_literales", "Citas literales en la spec"), ("citas_decisivas", "Citas literales y decisivas"),
          ("apartado_correcto", "Apartado correcto (x/8)"), ("errores", "Errores/caídas"),
          ("reintentos", "Reintentos (requisito re-ejecutado)"), ("max_prompt_tokens", "Prompt más largo (tokens)")]


def agg(vals):
    vals = [v for v in vals if v is not None]
    if not vals:
        return None
    return {"media": round(st.mean(vals), 2), "min": min(vals), "max": max(vals), "n": len(vals)}


def fmt(a):
    if a is None:
        return "—"
    m = a["media"]
    m = int(m) if float(m).is_integer() else m
    return f"{m}" if a["min"] == a["max"] else f"{m} ({a['min']}–{a['max']})"


def resumir():
    runs = [json.loads(l) for l in (C.RESULTADOS / "runs.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
    verdad = C.cargar_verdad()
    resumen = {"meta": runs[0].get("meta", {}) if runs else {}, "variantes": {}}
    for var in ("A", "B"):
        rs = [r for r in runs if r["variante"] == var]
        if not rs:
            continue
        resumen["variantes"][var] = {
            "runs": len(rs),
            **{k: agg([r.get(k) for r in rs]) for k, _ in CAMPOS},
            "citas_modelo_literales": agg([r.get("citas_modelo_literales") for r in rs]),
            "citas_modelo_no_vacias": agg([r.get("citas_modelo_no_vacias") for r in rs]),
            "degradados": agg([r.get("degradados") for r in rs]),
            "por_requisito": {rid: [r["por_requisito"][rid]["veredicto"] for r in rs] for rid in verdad},
            "por_tipo": [r["por_tipo"] for r in rs],
            "errores_detalle": [e for r in rs for e in r.get("errores_detalle", [])],
        }
    (C.RESULTADOS / "resumen.json").write_text(json.dumps(resumen, ensure_ascii=False, indent=2), encoding="utf-8")

    A, B = resumen["variantes"].get("A", {}), resumen["variantes"].get("B", {})
    m = resumen["meta"]
    L = ["# Resultados: CrewAI Flow (A) frente a llamadas propias (B)", "",
         f"Modelo: `{m.get('modelo')}` · temperatura 0 · seed {m.get('seed')} · contexto {m.get('num_ctx')} tokens (el del servidor) · "
         f"embeddings (solo A): `{m.get('modelo_embed')}` · CrewAI {m.get('crewai')} · Ollama {m.get('ollama')} · {m.get('hardware')}", "",
         f"Ejecuciones: A = {A.get('runs', 0)}, B = {B.get('runs', 0)}. Media y, entre paréntesis, mínimo–máximo cuando varían.", "",
         "| Métrica | A · CrewAI Flow | B · Llamadas propias |", "|---|---|---|"]
    for k, nombre in CAMPOS:
        L.append(f"| {nombre} | {fmt(A.get(k))} | {fmt(B.get(k))} |")
    if B.get("citas_modelo_literales"):
        L.append(f"| B: citas literales tal como las escribió el modelo, antes de verificar | — | "
                 f"{fmt(B['citas_modelo_literales'])} de {fmt(B['citas_modelo_no_vacias'])} |")
        L.append(f"| B: veredictos degradados a «abierto» por cita no verificada | — | {fmt(B.get('degradados'))} |")
    L += ["", "## Veredicto por requisito", "",
          "Una columna por ejecución. ✔ = coincide con la verdad.", "",
          "| Req. | Tipo | Verdad | A (runs) | B (runs) |", "|---|---|---|---|---|"]
    for rid, v in verdad.items():
        def celda(var):
            vs = resumen["variantes"].get(var, {}).get("por_requisito", {}).get(rid, [])
            return " · ".join(f"{x or 'sin dictamen'}{' ✔' if x == v['veredicto'] else ' ✘'}" for x in vs)
        L.append(f"| {rid} | {v['tipo']} | {v['veredicto']} | {celda('A')} | {celda('B')} |")
    # A sin el bucle de reintentos: primera iteración, sacada de los logs
    logs = sorted((C.RESULTADOS / "logs").glob("a_run*.log"))
    if logs:
        L += ["", "## A: primera iteración (sin el bucle de reintentos) y uso de «aprobado»", "",
              "Dictamen del orquestador en la primera pasada de cada requisito, leído del log de CrewAI.", "",
              "| Run | Aciertos 1.ª iteración | Aciertos finales | Veredictos 1.ª iteración (veredicto/aprobado) |", "|---|---|---|---|"]
        ids = list(verdad)
        aprob = {}
        runsA = {r["run"]: r for r in runs if r["variante"] == "A"}
        for lp in logs:
            n = int(re.search(r"run(\d+)", lp.name).group(1))
            it1 = primera_iteracion_A(lp)[:10]
            ok = sum(d["veredicto"] == verdad[rid]["veredicto"] for d, rid in zip(it1, ids))
            for d in primera_iteracion_A(lp):
                k = aprob.setdefault(d["veredicto"], [0, 0])
                k[0] += bool(d["aprobado"])
                k[1] += 1
            celdas = " ".join(f"{rid}:{d['veredicto']}/{'T' if d['aprobado'] else 'F'}" for d, rid in zip(it1, ids))
            L.append(f"| {n} | {ok}/10 | {runsA.get(n, {}).get('aciertos')}/10 | {celdas} |")
        L += ["", "Veces que el orquestador puso `aprobado=True`, por veredicto (todas las iteraciones, todos los runs): "
              + ", ".join(f"{v}: {a}/{t}" for v, (a, t) in aprob.items())]
        resumen["A_aprobado_por_veredicto"] = aprob
        (C.RESULTADOS / "resumen.json").write_text(json.dumps(resumen, ensure_ascii=False, indent=2), encoding="utf-8")
    errs = A.get("errores_detalle", []) + B.get("errores_detalle", [])
    if errs:
        L += ["", "## Errores registrados", ""] + [f"- {e}" for e in errs]
    (C.RESULTADOS / "RESULTADOS.md").write_text("\n".join(L) + "\n", encoding="utf-8")
    print("\n".join(L))


if __name__ == "__main__":
    resumir()
