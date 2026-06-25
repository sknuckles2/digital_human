"""
数字人 ASR 语音识别服务

基于 faster-whisper 实现本地语音识别，支持 CPU 和 AMD GPU (ROCm) 推理。
监听 :6090，提供 REST API。

端点：
  POST /transcribe  — 音频转文字
  GET  /health      — 健康检查
"""

import os
import time
import logging
import tempfile
import wave
import io

import numpy as np
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import JSONResponse

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("asr-service")

# ============================================================
#  配置
# ============================================================
ASR_PORT = int(os.environ.get("ASR_PORT", "6090"))
WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "base")  # tiny/base/small/medium/large-v3
WHISPER_DEVICE = os.environ.get("WHISPER_DEVICE", "cpu")  # cpu, cuda, rocm
WHISPER_COMPUTE = os.environ.get("WHISPER_COMPUTE_TYPE", "auto")  # auto, int8, float16

app = FastAPI(title="数字人 ASR 服务", version="1.0.0")

# ============================================================
#  模型管理（惰性加载）
# ============================================================
_model = None

def get_model():
    global _model
    if _model is not None:
        return _model

    logger.info(f"正在加载 Whisper 模型: {WHISPER_MODEL} (device={WHISPER_DEVICE})")
    t0 = time.time()

    try:
        from faster_whisper import WhisperModel

        _model = WhisperModel(
            WHISPER_MODEL,
            device=WHISPER_DEVICE,
            compute_type=WHISPER_COMPUTE,
            download_root=None,  # 使用 huggingface 缓存
        )
        elapsed = time.time() - t0
        logger.info(f"Whisper 模型加载完成 ({elapsed:.1f}s)")
    except Exception as e:
        logger.error(f"Whisper 模型加载失败: {e}")
        raise

    return _model


# ============================================================
#  音频处理
# ============================================================
def convert_to_wav(audio_bytes: bytes, sample_rate: int = 16000) -> bytes:
    """将原始音频转为 Whisper 需要的 16kHz 单声道 WAV 格式"""
    import soundfile as sf

    # 尝试直接用 soundfile 读取
    try:
        data, orig_sr = sf.read(io.BytesIO(audio_bytes))
    except Exception:
        # 如果不是标准格式，尝试作为 PCM 数据读取
        data = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32) / 32768.0
        orig_sr = sample_rate

    # 确保单声道
    if len(data.shape) > 1:
        data = data.mean(axis=1)

    # 重采样到 16kHz
    if orig_sr != 16000:
        import scipy.signal
        target_len = int(len(data) * 16000 / orig_sr)
        data = scipy.signal.resample(data, target_len)

    # 写回 WAV bytes
    buf = io.BytesIO()
    sf.write(buf, data, 16000, format="WAV", subtype="PCM_16")
    return buf.getvalue()


# ============================================================
#  API
# ============================================================

@app.get("/health")
async def health():
    model_loaded = _model is not None
    return {
        "ok": True,
        "service": "asr",
        "model": WHISPER_MODEL,
        "model_loaded": model_loaded,
        "device": WHISPER_DEVICE,
    }


@app.post("/transcribe")
async def transcribe(
    audio: UploadFile = File(...),
    language: str = "zh",
):
    """
    语音识别 — 上传音频文件，返回识别文本。

    参数：
      audio:    音频文件（wav/mp3/webm/ogg）
      language: 语言代码（zh/en/ja/auto），默认 zh
    """
    t0 = time.time()

    # 读取音频
    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty audio data")

    logger.info(f"收到音频: {len(audio_bytes)} bytes, format={audio.content_type}")

    try:
        model = get_model()
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Model not loaded: {e}")

    try:
        # 转为 WAV
        wav_bytes = convert_to_wav(audio_bytes)

        # 保存临时文件供 faster-whisper 读取
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            f.write(wav_bytes)
            tmp_path = f.name

        try:
            # 识别
            lang = None if language == "auto" else language
            segments, info = model.transcribe(
                tmp_path,
                language=lang,
                beam_size=5,
                vad_filter=True,  # 启用 VAD 过滤静音
                vad_parameters=dict(
                    threshold=0.5,
                    min_speech_duration_ms=250,
                    max_speech_duration_s=30,
                ),
            )

            # 收集结果
            text_parts = []
            for seg in segments:
                text_parts.append(seg.text.strip())

            full_text = " ".join(text_parts)
            elapsed = time.time() - t0

            logger.info(f"识别完成: '{full_text[:60]}' ({elapsed:.2f}s, lang={info.language})")

            return {
                "text": full_text,
                "language": info.language,
                "segments": [
                    {
                        "start": seg.start,
                        "end": seg.end,
                        "text": seg.text.strip(),
                    }
                    for seg in segments
                ],
                "duration": elapsed,
            }

        finally:
            # 清理临时文件
            try:
                os.unlink(tmp_path)
            except Exception:
                pass

    except Exception as e:
        logger.error(f"识别失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
#  启动
# ============================================================
if __name__ == "__main__":
    import uvicorn
    logger.info(f"启动 ASR 服务 — :{ASR_PORT}")
    uvicorn.run(app, host="0.0.0.0", port=ASR_PORT)
