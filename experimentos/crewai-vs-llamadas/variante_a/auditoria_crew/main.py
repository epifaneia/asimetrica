#!/usr/bin/env python
"""Variante A — CrewAI Flow. Mismo patrón que crewai_flow_template/main.py:

  estado del Flow → @start ejecuta el Crew → @router decide "finish" / "retry"
  con el veredicto del orquestador → reintento con su feedback, hasta MAX_ITERATIONS
  → @listen("finish") guarda el informe.

Diferencia con la plantilla: el Crew se lanza una vez por requisito (la plantilla
lanza uno para todo), porque con un único kickoff el RAG recibe una consulta que
mezcla los diez requisitos. Y la aprobación es un campo booleano del dictamen
estructurado en lugar del token "APPROVED" en texto libre.

Uso: python variante_a/auditoria_crew/main.py --salida resultados/salidas/a_run1.json
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import traceback
from pathlib import Path

from crewai.flow.flow import Flow, listen, router, start
from pydantic import BaseModel

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import comun as C  # noqa: E402
from auditoria_crew.crew import AuditoriaCrew  # noqa: E402

FEEDBACK_INICIAL = "Primera iteración: haz la búsqueda base en la especificación."


class AuditoriaState(BaseModel):
    requisitos: list[dict] = []
    pendientes: list[str] = []
    feedback: dict[str, str] = {}
    resultados: dict[str, dict] = {}
    iteration_count: int = 0
    reintentos: int = 0
    errores: list[str] = []
    status: str = "pending"


class AuditoriaFlow(Flow[AuditoriaState]):
    MAX_ITERATIONS: int = 3

    @start("retry")
    def run_crew_step(self):
        if not self.state.requisitos:   # primera pasada
            self.state.requisitos = C.cargar_requisitos()
            self.state.pendientes = [r["id"] for r in self.state.requisitos]
        else:
            self.state.reintentos += len(self.state.pendientes)
        textos = {r["id"]: r["texto"] for r in self.state.requisitos}
        siguen = []
        for rid in self.state.pendientes:
            inputs = {"req_id": rid, "req_texto": textos[rid],
                      "orchestrator_feedback": self.state.feedback.get(rid, FEEDBACK_INICIAL)}
            try:
                result = AuditoriaCrew().crew().kickoff(inputs=inputs)
                d = result.pydantic
                if d is None:
                    raise ValueError(f"sin salida estructurada: {result.raw[:300]!r}")
                self.state.resultados[rid] = dict(d.model_dump(), iteraciones=self.state.iteration_count + 1)
                if not d.aprobado:
                    siguen.append(rid)
                    self.state.feedback[rid] = ("Revisión pedida por el auditor jefe: " + (d.comentario or "")
                                                + "\nDictamen anterior:\n" + result.raw)
            except Exception as e:  # noqa: BLE001
                self.state.errores.append(f"{rid} it{self.state.iteration_count + 1}: {type(e).__name__}: {e}")
                traceback.print_exc()
                siguen.append(rid)
        self.state.iteration_count += 1
        self.state.pendientes = siguen
        if not siguen or self.state.iteration_count >= self.MAX_ITERATIONS:
            self.state.status = "approved"
        else:
            self.state.status = "rejected"

    @router(run_crew_step)
    def route_after_crew(self):
        return "finish" if self.state.status == "approved" else "retry"

    @listen("finish")
    def save_report(self):
        return self.state


def auditar() -> dict:
    flow = AuditoriaFlow()
    flow.kickoff()
    s = flow.state
    salida = []
    for r in s.requisitos:
        d = s.resultados.get(r["id"])
        if d is None:   # el Crew falló en todas las iteraciones
            salida.append({"id": r["id"], "veredicto": None, "cita": "", "seccion": None,
                           "flags": ["sin_dictamen"]})
            continue
        salida.append({"id": r["id"], "veredicto": d["veredicto"], "cita": d.get("cita", ""),
                       "seccion": C.seccion_de(d.get("seccion")),   # lo que escribió el modelo
                       "seccion_modelo": d.get("seccion", ""), "aprobado": d["aprobado"],
                       "iteraciones": d["iteraciones"], "comentario": d.get("comentario", ""),
                       "flags": [] if d["aprobado"] else ["no_aprobado_tras_max_iteraciones"]})
    return {"resultados": salida, "errores": s.errores, "reintentos": s.reintentos,
            "iteraciones_flow": s.iteration_count}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--salida", required=True)
    a = ap.parse_args()
    t0 = time.perf_counter()
    out = auditar()
    out["variante"] = "A"
    out["wall_s"] = round(time.perf_counter() - t0, 2)
    Path(a.salida).parent.mkdir(parents=True, exist_ok=True)
    Path(a.salida).write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
