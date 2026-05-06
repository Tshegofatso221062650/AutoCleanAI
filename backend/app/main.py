from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.db import init_db
from app.middleware import SecurityHeadersMiddleware, RequestSizeLimitMiddleware
from app.services.scheduler import start_scheduler, stop_scheduler
from app.services.security import validate_secret_key
from app.config import settings
from app.routers import analytics_router
from app.routers import analyze_router
from app.routers import anomaly_router
from app.routers import anonymization_router
from app.routers import api_router
from app.routers import auth_router
from app.routers import alerts_router
from app.routers import batch_router
from app.routers import chat_router
from app.routers import clean_router
from app.routers import collaboration_router
from app.routers import comparison_router
from app.routers import consolidation_router
from app.routers import custom_functions_router
from app.routers import dataset_objectives_router
from app.routers import download_router
from app.routers import export_router
from app.routers import history_router
from app.routers import lineage_router
from app.routers import objectives_router
from app.routers import pipeline_router
from app.routers import profiling_router
from app.routers import quality_router
from app.routers import reports_router
from app.routers import sample_datasets_router
from app.routers import scheduler_router
from app.routers import schema_router
from app.routers import settings_router
from app.routers import tags_router
from app.routers import transformation_router
from app.routers import transformation_rules_router
from app.routers import undo_router
from app.routers import upload_router
from app.routers import validation_router
from app.routers import version_router
from app.routers import users_router
from app.routers import ws_router
from app.routers import comments_router
from app.routers import api_keys_router
from app.routers import activity_router
from app.routers import webhooks_router


@asynccontextmanager
async def lifespan(_: FastAPI):
    validate_secret_key(settings.secret_key)
    init_db()
    start_scheduler()
    yield
    stop_scheduler()


app = FastAPI(title="AutoClean AI", version="2.0.0", lifespan=lifespan)

# Middlewares are applied in reverse registration order (last added = first to run)
app.add_middleware(RequestSizeLimitMiddleware)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept", "X-Api-Key"],
    expose_headers=["Content-Disposition"],
)

app.include_router(auth_router.router)
app.include_router(upload_router.router)
app.include_router(analyze_router.router)
app.include_router(clean_router.router)
app.include_router(objectives_router.router, prefix="/objectives")
app.include_router(dataset_objectives_router.router)
app.include_router(consolidation_router.router)
app.include_router(transformation_router.router)
app.include_router(quality_router.router)
app.include_router(chat_router.router)
app.include_router(history_router.router)
app.include_router(download_router.router)
app.include_router(settings_router.router)
app.include_router(pipeline_router.router)
app.include_router(transformation_rules_router.router)
app.include_router(version_router.router)
app.include_router(lineage_router.router)
app.include_router(analytics_router.router)
app.include_router(validation_router.router, prefix="/validation")
app.include_router(scheduler_router.router, prefix="/scheduler")
app.include_router(profiling_router.router, prefix="/profiling")
app.include_router(export_router.router, prefix="/export")
app.include_router(batch_router.router, prefix="/batch")
app.include_router(custom_functions_router.router, prefix="/custom-functions")
app.include_router(comparison_router.router, prefix="/comparison")
app.include_router(alerts_router.router, prefix="/alerts")
app.include_router(tags_router.router, prefix="/tags")
app.include_router(api_router.router, prefix="/api/v1")
app.include_router(collaboration_router.router, prefix="/collaboration")
app.include_router(anonymization_router.router, prefix="/anonymization")
app.include_router(schema_router.router, prefix="/schema")
app.include_router(anomaly_router.router, prefix="/anomaly")
app.include_router(sample_datasets_router.router, prefix="/sample-datasets")
app.include_router(reports_router.router, prefix="/reports")
app.include_router(undo_router.router, prefix="/undo")
app.include_router(users_router.router)
app.include_router(ws_router.router)
app.include_router(comments_router.router)
app.include_router(api_keys_router.router)
app.include_router(activity_router.router)
app.include_router(webhooks_router.router)


@app.get("/health")
def health():
    return {"status": "ok"}
