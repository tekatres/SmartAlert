"""AI provider factory."""
from app.ai.base import AIProvider
from app.ai.mock import MockAIProvider
from app.ai.openai_provider import OpenAIProvider
from app.core.config import Settings


def get_ai_provider(settings: Settings) -> AIProvider:
    if settings.ai_provider == "openai" and settings.openai_api_key:
        return OpenAIProvider(api_key=settings.openai_api_key, model=settings.openai_model)
    return MockAIProvider()
