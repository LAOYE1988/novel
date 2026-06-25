import os
from pathlib import Path

ENV_VAR_NAME = "DEEPSEEK_API_KEY"
DEFAULT_MODEL = "deepseek-chat"
DEFAULT_BASE_URL = "https://api.deepseek.com"


def _find_env_file() -> Path | None:
    search_paths = [
        Path(__file__).parent / ".env",
        Path(__file__).parent.parent / ".env",
    ]
    for path in search_paths:
        if path.exists():
            return path
    return None


def _load_env_file():
    env_file = _find_env_file()
    if not env_file:
        return
    try:
        lines = env_file.read_text(encoding="utf-8").splitlines()
        for line in lines:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                key, _, value = line.partition("=")
                key = key.strip()
                value = value.strip().strip("\"'").strip()
                os.environ.setdefault(key, value)
    except Exception:
        pass


_load_env_file()


def get_api_key() -> str:
    key = os.environ.get(ENV_VAR_NAME)
    if not key:
        print(f"  [错误] 未找到 DeepSeek API Key", flush=True)
        print(f"  [提示] 请在 tools/.env 或项目根目录的 .env 文件中设置:", flush=True)
        print(f"         {ENV_VAR_NAME}=sk-你的Key", flush=True)
        print(f"  [提示] 也可以设置为系统环境变量", flush=True)
        return ""
    return key


def get_model() -> str:
    return os.environ.get("DEEPSEEK_MODEL", DEFAULT_MODEL)


def get_base_url() -> str:
    return os.environ.get("DEEPSEEK_BASE_URL", DEFAULT_BASE_URL)


def is_configured() -> bool:
    key = os.environ.get(ENV_VAR_NAME)
    return bool(key)
