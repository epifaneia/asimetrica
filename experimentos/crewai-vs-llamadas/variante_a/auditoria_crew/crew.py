"""Crew de la variante A: analista de requisitos + lector de la especificación (con RAG)
+ orquestador. Mismo patrón que crewai_flow_template/src/crewai_flow_template/crew.py.
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Literal

from crewai import LLM, Agent, Crew, Process, Task
from crewai.knowledge.knowledge_config import KnowledgeConfig
from crewai.knowledge.source.text_file_knowledge_source import TextFileKnowledgeSource
from crewai.project import CrewBase, agent, crew, task
from pydantic import BaseModel, Field

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import comun as C  # noqa: E402

# Forma normal de apuntar CrewAI a Ollama: "ollama/<modelo>" + base_url (aquí, el proxy de medida).
llm = LLM(model=f"ollama/{C.MODELO}", base_url=C.PROXY_URL, temperature=C.TEMPERATURA, seed=C.SEED)

# RAG sobre la especificación con un modelo de embeddings local de Ollama.
EMBEDDER = {"provider": "ollama",
            "config": {"model_name": C.MODELO_EMBED, "url": f"{C.PROXY_URL}/api/embeddings"}}

# chunk_size por defecto (4000 caracteres) supera los 512 tokens de mxbai-embed-large:
# se baja a 800 caracteres (≈ un apartado) para que el embedding no se trunque.
_knowledge = TextFileKnowledgeSource(file_paths=[C.DATOS / "spec.md"], chunk_size=800, chunk_overlap=100)
# Mismo número de fragmentos por consulta que la variante B (TOP_K).
_knowledge_config = KnowledgeConfig(results_limit=C.TOP_K, score_threshold=0.35)


class Dictamen(BaseModel):
    veredicto: Literal["cumple", "no_cumple", "abierto"]
    cita: str = Field(default="", description="Frase literal de la especificación")
    seccion: str = Field(default="", description="Número de apartado, p. ej. 3.3")
    aprobado: bool = Field(description="True si la evidencia basta para firmar el dictamen")
    comentario: str = Field(default="", description="Qué falta si aprobado es false")


@CrewBase
class AuditoriaCrew:
    """Dos especialistas → orquestador, proceso secuencial."""

    agents_config = "config/agents.yaml"
    tasks_config = "config/tasks.yaml"

    @agent
    def analista_requisitos(self) -> Agent:
        return Agent(config=self.agents_config["analista_requisitos"], llm=llm,  # type: ignore[index]
                     allow_delegation=False, verbose=True)

    @agent
    def lector_especificacion(self) -> Agent:
        return Agent(config=self.agents_config["lector_especificacion"], llm=llm,  # type: ignore[index]
                     allow_delegation=False, verbose=True,
                     knowledge_sources=[_knowledge], knowledge_config=_knowledge_config,
                     embedder=EMBEDDER)

    @agent
    def orquestador(self) -> Agent:
        return Agent(config=self.agents_config["orquestador"], llm=llm,  # type: ignore[index]
                     allow_delegation=False, verbose=True)

    @task
    def analizar_requisito(self) -> Task:
        return Task(config=self.tasks_config["analizar_requisito"])  # type: ignore[index]

    @task
    def buscar_evidencia(self) -> Task:
        return Task(config=self.tasks_config["buscar_evidencia"],  # type: ignore[index]
                    context=[self.analizar_requisito()])

    @task
    def dictaminar(self) -> Task:
        return Task(config=self.tasks_config["dictaminar"],  # type: ignore[index]
                    context=[self.analizar_requisito(), self.buscar_evidencia()],
                    output_pydantic=Dictamen)

    @crew
    def crew(self) -> Crew:
        return Crew(agents=self.agents, tasks=self.tasks, process=Process.sequential,
                    verbose=True, embedder=EMBEDDER)
