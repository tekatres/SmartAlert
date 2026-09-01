"""Health/readiness endpoint."""
from fastapi import APIRouter, Depends

from app.core.config import Settings, get_settings
from app.models.schemas import HealthResponse

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
async def health(settings: Settings = Depends(get_settings)) -> HealthResponse:
    return HealthResponse(
        status="ok",
        version="0.1.0",
        data_provider=settings.data_provider,
        ai_provider=settings.ai_provider,
    )
