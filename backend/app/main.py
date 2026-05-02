from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.app.routers import confusion, mri, predict, session

app = FastAPI(
    title="Cognitive Screening & Dementia Risk — Research Prototype",
    version="0.1.0",
    description="Decision support using synthetic data and multi-modal fusion. Not for diagnosis.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(predict.router)
app.include_router(session.router)
app.include_router(mri.router)
app.include_router(confusion.router)


@app.get("/")
def root() -> dict:
    return {
        "service": "neuroscreen-fusion",
        "docs": "/docs",
        "health": "/api/health",
    }
