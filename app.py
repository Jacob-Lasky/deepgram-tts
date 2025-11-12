import os
import json
import urllib.request
import urllib.parse
from typing import Optional, List, Dict
import uvicorn
import logging

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field
from starlette.staticfiles import StaticFiles

# Load environment variables
load_dotenv()

# Configurable Deepgram API base and auth scheme
DEEPGRAM_API_URL = os.getenv("DEEPGRAM_API_URL", "https://api.deepgram.com").rstrip("/")
DEEPGRAM_AUTH_SCHEME = os.getenv("DEEPGRAM_AUTH_SCHEME", "Token").strip()

try:
    from deepgram import DeepgramClient
    from deepgram.core.events import EventType
    from deepgram.extensions.types.sockets import (
        SpeakV1ControlMessage,
        SpeakV1SocketClientResponse,
        SpeakV1TextMessage,
    )
except Exception as e:
    # Allow import-time issues to surface clearly when endpoint is called
    DeepgramClient = None  # type: ignore
    EventType = None  # type: ignore
    SpeakV1ControlMessage = None  # type: ignore
    SpeakV1SocketClientResponse = None  # type: ignore
    SpeakV1TextMessage = None  # type: ignore

logger = logging.getLogger("deepgram-tts-ui")
if not logger.handlers:
    _handler = logging.StreamHandler()
    _handler.setLevel(logging.INFO)
    _handler.setFormatter(
        logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
    )
    logger.addHandler(_handler)
logger.setLevel(logging.INFO)
logger.propagate = False
app = FastAPI(title="Deepgram TTS UI")

# CORS - permissive for testing across envs
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class TTSRequest(BaseModel):
    text: str = Field(min_length=1, description="Text to synthesize")
    model: Optional[str] = Field(default="aura-2-thalia-en")
    encoding: Optional[str] = Field(default="linear16")
    sample_rate: Optional[int] = Field(default=16000)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/api/tts", response_class=Response)
def tts(req: TTSRequest, api_url: Optional[str] = None):
    if not req.text or not req.text.strip():
        raise HTTPException(status_code=400, detail="Text is required")

    api_key = os.getenv("DEEPGRAM_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(
            status_code=500, detail="Missing DEEPGRAM_API_KEY in environment or .env"
        )

    # Build REST Speak URL: {base}/v1/speak?model=...&encoding=linear16&sample_rate=...
    base = (api_url or DEEPGRAM_API_URL).rstrip("/")
    model = (req.model or "aura-2-thalia-en").strip()
    params = {"model": model}
    # Force linear16 regardless of client value
    params["encoding"] = "linear16"
    if req.sample_rate:
        params["sample_rate"] = str(req.sample_rate)
    query = urllib.parse.urlencode(params)
    url = f"{base}/v1/speak?{query}"
    logger.info(f"TTS request: {url}")

    payload = json.dumps({"text": req.text}).encode("utf-8")
    headers = {
        "Authorization": f"{DEEPGRAM_AUTH_SCHEME} {api_key}",
        "Content-Type": "application/json",
    }
    try:
        http_req = urllib.request.Request(
            url, data=payload, headers=headers, method="POST"
        )
        with urllib.request.urlopen(http_req, timeout=60) as resp:
            content_type = resp.headers.get("Content-Type") or "audio/wav"
            audio = resp.read()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"TTS request failed: {e}")

    # We forced linear16, return WAV filename
    filename = "tts.wav"
    return Response(
        content=audio,
        media_type=content_type,
        headers={"Content-Disposition": f"inline; filename={filename}"},
    )


@app.get("/api/voices")
def list_voices(
    architecture: str = "aura-2",
    language: Optional[str] = None,
    accent: Optional[str] = None,
    gender: Optional[str] = None,
    api_url: Optional[str] = None,
):
    api_key = os.getenv("DEEPGRAM_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(
            status_code=500, detail="Missing DEEPGRAM_API_KEY in environment or .env"
        )

    try:
        base = "https://api.deepgram.com"  # where all voices live
        req = urllib.request.Request(
            f"{base}/v1/models",
            headers={"Authorization": f"{DEEPGRAM_AUTH_SCHEME} {api_key}"},
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to fetch models: {e}")

    tts_models = data.get("tts", []) if isinstance(data, dict) else []

    # Build facets from the full TTS list (unfiltered)
    facet_arch = set()
    facet_lang_base = set()
    facet_acc = set()
    facet_gender = set()
    for m in tts_models:
        if isinstance(m.get("architecture"), str):
            facet_arch.add(m["architecture"])
        for l in m.get("languages") or []:
            if isinstance(l, str):
                base = l.split("-", 1)[0].lower().strip()
                if base:
                    facet_lang_base.add(base)
        meta_all = m.get("metadata") or {}
        if isinstance(meta_all.get("accent"), str):
            facet_acc.add(meta_all["accent"])
        for t in meta_all.get("tags") or []:
            if isinstance(t, str) and t.lower() in ("masculine", "feminine"):
                facet_gender.add(t)

    def norm(s: Optional[str]) -> str:
        return (s or "").strip().lower()

    arch = norm(architecture) if architecture else ""
    lang = norm(language) if language else ""
    acc = norm(accent) if accent else ""
    gen = norm(gender) if gender else ""

    results: List[Dict] = []
    for m in tts_models:
        m_arch = norm(m.get("architecture"))
        if arch and m_arch != arch:
            continue

        langs = [norm(l) for l in (m.get("languages") or [])]
        if lang:
            # exact or prefix match (e.g., 'en' matches 'en-us')
            if lang not in langs and not any(l.startswith(lang) for l in langs):
                continue

        meta = m.get("metadata") or {}
        m_acc = norm(meta.get("accent"))
        if acc and m_acc != acc:
            continue

        tags = [norm(t) for t in (meta.get("tags") or [])]
        if gen and gen not in tags:
            continue

        results.append(
            {
                "name": m.get("name"),
                "canonical_name": m.get("canonical_name"),
                "architecture": m.get("architecture"),
                "languages": m.get("languages") or [],
                "metadata": {
                    "accent": meta.get("accent"),
                    "age": meta.get("age"),
                    "color": meta.get("color"),
                    "image": meta.get("image"),
                    "sample": meta.get("sample"),
                    "tags": meta.get("tags") or [],
                    "use_cases": meta.get("use_cases") or [],
                },
            }
        )

    return {
        "count": len(results),
        "voices": results,
        "facets": {
            "architectures": sorted(facet_arch),
            "languages": sorted(facet_lang_base),
            "accents": sorted(facet_acc),
            "genders": sorted(facet_gender),
        },
    }


@app.get("/api/config")
def get_config():
    return {
        "deepgram_api_url": DEEPGRAM_API_URL,
        "deepgram_auth_scheme": DEEPGRAM_AUTH_SCHEME,
    }


# Serve static UI
app.mount("/", StaticFiles(directory="static", html=True), name="static")


if __name__ == "__main__":
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
