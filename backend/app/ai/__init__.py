"""AI layer: turns raw events into human-friendly alerts."""
from .base import AIProvider
from .factory import get_ai_provider

__all__ = ["AIProvider", "get_ai_provider"]
