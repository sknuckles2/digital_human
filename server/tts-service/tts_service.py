"""
数字人 TTS 语音合成服务

基于 Qwen3-TTS-12Hz-1.7B-CustomVoice 实现本地语音合成，支持 CPU 推理。
监听 :6091，提供 REST API。

端点：
  POST /tts      — 文本转语音
  GET  /voices   — 列出可用音色
  GET  /health   — 健康检查
"""

import os
import time
import logging
import io
from typing import Optional

import soundfile as sf
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

# ============================================================
#  AMD GPU 加速（DirectML）
#  如果安装了 torch-directml，使用 AMD GPU 加速推理
# ============================================================
_dml_device = None

def _init_device():
    """初始化设备：优先 DirectML (AMD) → CPU"""
    global _dml_device

    # 检查是否设置了强制设备
    forced = os.environ.get("TTS_DEVICE", "").lower()
    if forced and forced != "auto":
        logger.info(f"使用强制设备: {forced}")
        return forced

    # 尝试 DirectML（AMD GPU on Windows）
    try:
        import torch_directml
        dml = torch_directml.device()
        _dml_device = dml
        logger.info(f"检测到 AMD GPU (DirectML): {dml}")
        return "dml"  # 特殊标记，后续用 _dml_device
    except ImportError:
        logger.info("torch-directml 未安装，使用 CPU")

    return "cpu"

def get_torch_device():
    """获取 PyTorch 设备对象"""
    global _dml_device
    if _dml_device is not None:
        return _dml_device
    import torch
    return torch.device("cpu")

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("tts-service")

# ============================================================
#  配置
# ============================================================
TTS_PORT = int(os.environ.get("TTS_PORT", "6091"))
TTS_MODEL_PATH = os.environ.get(
    "TTS_MODEL_PATH",
    "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice",  # HF ID 或本地路径
)
TTS_DEVICE = os.environ.get("TTS_DEVICE", "cpu")  # cpu, cuda
TTS_DTYPE = os.environ.get("TTS_DTYPE", "float32")  # float32, bfloat16

app = FastAPI(title="数字人 TTS 服务", version="1.0.0")

# ============================================================
#  预设音色列表（Qwen CustomVoice 内置 9 个 speakers）
# ============================================================
PRESET_VOICES = [
    {"id": "Vivian",    "name": "Vivian（明亮女声）",       "locale": "zh-CN", "gender": "female", "native": "Chinese"},
    {"id": "Serena",    "name": "Serena（温婉女声）",       "locale": "zh-CN", "gender": "female", "native": "Chinese"},
    {"id": "Uncle_Fu",  "name": "Uncle Fu（低沉大叔音）",   "locale": "zh-CN", "gender": "male",   "native": "Chinese"},
    {"id": "Dylan",     "name": "Dylan（北京话青年）",      "locale": "zh-CN", "gender": "male",   "native": "Chinese (Beijing)"},
    {"id": "Eric",      "name": "Eric（成都话青年）",       "locale": "zh-CN", "gender": "male",   "native": "Chinese (Sichuan)"},
    {"id": "Ryan",      "name": "Ryan（阳光男声）",         "locale": "en-US", "gender": "male",   "native": "English"},
    {"id": "Aiden",     "name": "Aiden（清亮男声）",        "locale": "en-US", "gender": "male",   "native": "English"},
    {"id": "Ono_Anna",  "name": "Ono Anna（俏皮日语女声）", "locale": "ja-JP", "gender": "female", "native": "Japanese"},
    {"id": "Sohee",     "name": "Sohee（温暖韩语女声）",    "locale": "ko-KR", "gender": "female", "native": "Korean"},
]


# ============================================================
#  模型管理（惰性加载）
# ============================================================
_model = None

def get_model():
    global _model
    if _model is not None:
        return _model

    logger.info(f"正在加载 Qwen3-TTS 模型...")
    logger.info(f"  模型路径: {TTS_MODEL_PATH}")
    t0 = time.time()

    try:
        from qwen_tts import Qwen3TTSModel

        # 获取设备
        device_type = _init_device()
        logger.info(f"  设备: {device_type}")
        logger.info(f"  💡 首次请求会加载模型（约需 10-30 秒）")

        if device_type == "dml":
            # DirectML: 手动传 device
            import torch
            dml_device = get_torch_device()
            _model = Qwen3TTSModel.from_pretrained(
                TTS_MODEL_PATH,
                device_map=None,  # 不自动映射
                dtype=torch.float32,
            )
            # 手动移动到 DML 设备
            _model = _model.to(dml_device)
        else:
            # CPU / CUDA
            dtype_map = {
                "float32": torch.float32,
                "bfloat16": torch.bfloat16,
            }
            dtype = dtype_map.get(TTS_DTYPE, torch.float32)
            import torch

            _model = Qwen3TTSModel.from_pretrained(
                TTS_MODEL_PATH,
                device_map=device_type,
                dtype=dtype,
            )

        elapsed = time.time() - t0
        logger.info(f"Qwen3-TTS 模型加载完成 ({elapsed:.1f}s)")
    except Exception as e:
        logger.error(f"Qwen3-TTS 模型加载失败: {e}")
        raise

    return _model


# ============================================================
#  请求模型
# ============================================================

class TTSRequest(BaseModel):
    text: str
    voice: str = "Vivian"
    language: str = "Chinese"  # Chinese, English, Japanese, Korean, Auto
    instruct: Optional[str] = None


# ============================================================
#  API
# ============================================================

@app.get("/health")
async def health():
    model_loaded = _model is not None
    device_type = _init_device()
    return {
        "ok": model_loaded,
        "service": "tts",
        "model": "Qwen3-TTS-12Hz-1.7B-CustomVoice",
        "model_loaded": model_loaded,
        "device": device_type,
        "voices_available": len(PRESET_VOICES),
    }


@app.get("/voices")
async def list_voices():
    """返回可用预设音色列表"""
    return {"voices": PRESET_VOICES}


@app.post("/tts")
async def synthesize(req: TTSRequest):
    """
    文本转语音 — 返回 WAV 音频。

    参数：
      text:      要合成的文本
      voice:     音色 ID（默认 Vivian）
      language:  语言（Chinese/English/Japanese/Korean/Auto）
      instruct:  指令控制（可选，如 "用温柔的语气说"）
    """
    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Missing text")

    t0 = time.time()

    try:
        model = get_model()
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Model not loaded: {e}")

    logger.info(f"合成: voice={req.voice} lang={req.language} text='{text[:50]}...'")

    try:
        # Qwen3-TTS 的 CustomVoice 生成
        wavs, sr = model.generate_custom_voice(
            text=text,
            language=req.language if req.language != "Auto" else None,
            speaker=req.voice,
            instruct=req.instruct or "",
        )

        elapsed = time.time() - t0

        # wavs[0] 是 numpy array
        wav_data = wavs[0]

        # 写入 WAV 到内存
        buf = io.BytesIO()
        sf.write(buf, wav_data, sr, format="WAV")
        buf.seek(0)

        # 计算音频时长
        duration_sec = len(wav_data) / sr

        logger.info(f"合成完成: {duration_sec:.1f}s 音频 (合成耗时 {elapsed:.2f}s)")

        return StreamingResponse(
            buf,
            media_type="audio/wav",
            headers={
                "X-TTS-Duration": f"{duration_sec:.2f}",
                "X-TTS-Time": f"{elapsed:.3f}",
            },
        )

    except Exception as e:
        logger.error(f"合成失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
#  启动
# ============================================================
if __name__ == "__main__":
    import uvicorn
    logger.info(f"启动 TTS 服务 — :{TTS_PORT}")
    logger.info(f"  模型路径: {TTS_MODEL_PATH}")
    logger.info(f"  💡 首次请求会加载模型（约需 10-30 秒）")
    uvicorn.run(app, host="0.0.0.0", port=TTS_PORT)
