"""Requiem Atlas API. Bind to loopback by default."""
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from . import db
from .scanner import TargetError, analyze


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    yield


app = FastAPI(title="Requiem Atlas API", version="0.1.0", lifespan=lifespan,
              description="Local-first, bounded asset inventory and OSINT analysis.")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                   allow_credentials=False, allow_methods=["GET", "POST"], allow_headers=["Content-Type"])


class AnalysisRequest(BaseModel):
    target: str = Field(min_length=3, max_length=253)
    authorized_probe: bool = False
    include_ct: bool = False


@app.get("/health")
def health():
    return {"status": "ok", "version": "0.1.0"}


@app.get("/api/stats")
def stats():
    return db.statistics()


@app.get("/api/history")
def history(q: Annotated[str, Query(max_length=120)] = "", limit: Annotated[int, Query(ge=1, le=100)] = 40):
    return {"items": db.history(q.strip(), limit)}


@app.get("/api/history/{analysis_id}")
def analysis_by_id(analysis_id: int):
    if analysis_id < 1:
        raise HTTPException(status_code=404, detail="Запись не найдена.")
    result = db.get_one(analysis_id)
    if not result:
        raise HTTPException(status_code=404, detail="Запись не найдена.")
    return result


@app.post("/api/analyze")
def analyze_target(request: AnalysisRequest):
    try:
        result = analyze(request.target, authorized=request.authorized_probe, include_ct=request.include_ct)
    except TargetError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return db.save(result)
