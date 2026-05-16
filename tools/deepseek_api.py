import json
import urllib.request
import urllib.error

from config import get_api_key, get_model, get_base_url, is_configured


def chat_with_agent(
    agent: dict,
    user_message: str,
    board_context: str = "",
    history: list[dict] | None = None,
) -> str | None:
    api_key = get_api_key()
    if not api_key:
        return None

    messages = []
    system_prompt = agent.get("system_prompt", "")
    if board_context:
        system_prompt += f"\n\n【当前创作看板状态】\n{board_context}"
    messages.append({"role": "system", "content": system_prompt})

    if history:
        for msg in history:
            messages.append(msg)

    messages.append({"role": "user", "content": user_message})

    model = agent.get("model", get_model())
    temperature = agent.get("temperature", 0.7)

    payload = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": 4096,
        "stream": False,
    }

    base_url = get_base_url()
    url = f"{base_url}/v1/chat/completions"

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            content = result["choices"][0]["message"]["content"]
            return content
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"  [API错误] HTTP {e.code}: {body}", flush=True)
        return None
    except urllib.error.URLError as e:
        print(f"  [网络错误] {e.reason}", flush=True)
        return None
    except json.JSONDecodeError as e:
        print(f"  [解析错误] {e}", flush=True)
        return None
    except Exception as e:
        print(f"  [未知错误] {e}", flush=True)
        return None


def simple_chat(system_prompt: str, user_message: str, temperature: float = 0.7) -> str | None:
    agent = {
        "system_prompt": system_prompt,
        "model": get_model(),
        "temperature": temperature,
    }
    return chat_with_agent(agent, user_message, board_context="")
