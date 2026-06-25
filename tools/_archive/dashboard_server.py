import json
import os
import sys
import io
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, parse_qs

DASHBOARD_DIR = Path(__file__).parent / "dashboard"
TOOLS_DIR = Path(__file__).parent
PROJECT_DIR = TOOLS_DIR.parent

sys.path.insert(0, str(TOOLS_DIR))
sys.path.insert(0, str(TOOLS_DIR / "agents"))

import board_manager
import workspace_manager
from config import is_configured, get_api_key
from deepseek_api import chat_with_agent

PORT = 8765


class DashboardHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DASHBOARD_DIR), **kwargs)

    def log_message(self, format, *args):
        pass

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        params = parse_qs(parsed.query)

        if path.startswith("/api/"):
            self.handle_api_get(path, params)
        else:
            if path == "/":
                self.path = "/index.html"
            super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length).decode("utf-8") if content_length else "{}"
        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            data = {}

        self.handle_api_post(path, data)

    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def handle_api_get(self, path, params):
        if path == "/api/agents":
            agents_file = TOOLS_DIR / "agents" / "agents.json"
            try:
                data = json.loads(agents_file.read_text("utf-8"))
                for agent in data.get("agents", []):
                    section = board_manager.get_agent_section(agent["id"])
                    agent["board_section"] = section or ""
                self.send_json(data)
            except Exception as e:
                self.send_json({"error": str(e)}, 500)

        elif path == "/api/board":
            content = board_manager.read_board()
            self.send_json({"content": content})

        elif path == "/api/board/section":
            agent_id = params.get("id", [None])[0]
            if agent_id:
                section = board_manager.get_agent_section(agent_id)
                self.send_json({"section": section or ""})
            else:
                self.send_json({"error": "missing id"}, 400)

        elif path == "/api/workspaces":
            workspaces = workspace_manager.list_workspaces()
            self.send_json({"workspaces": workspaces})

        elif path == "/api/workspace/list":
            ws = params.get("ws", [None])[0]
            if ws:
                files = workspace_manager.list_files(ws)
                self.send_json({"files": files})
            else:
                self.send_json({"error": "missing ws"}, 400)

        elif path == "/api/workspace/read":
            ws = params.get("ws", [None])[0]
            file = params.get("file", [None])[0]
            if ws and file:
                content = workspace_manager.read_file(ws, file)
                self.send_json({"content": content or ""})
            else:
                self.send_json({"error": "missing params"}, 400)

        elif path == "/api/novels":
            novels = workspace_manager.list_novels()
            current = workspace_manager.get_current_novel()
            self.send_json({"novels": novels, "current": current})

        elif path == "/api/check":
            if is_configured():
                key = get_api_key()
                masked = key[:8] + "****" + key[-4:] if len(key) > 16 else "已设置"
                self.send_json({"ok": True, "message": f"API 正常 (Key: {masked})"})
            else:
                self.send_json({"ok": False, "error": "未配置 API Key"})

        elif path == "/api/dashboard/load":
            dash_file = DASHBOARD_DIR / "dashboard.json"
            if dash_file.exists():
                try:
                    data = json.loads(dash_file.read_text("utf-8"))
                    self.send_json(data)
                except Exception:
                    self.send_json({"error": "dashboard.json 解析失败"}, 500)
            else:
                self.send_json({"error": "dashboard.json 不存在"}, 404)

        else:
            self.send_json({"error": "not found"}, 404)

    def handle_api_post(self, path, data):
        if path == "/api/chat":
            agent_id = data.get("agent_id")
            message = data.get("message", "")
            history = data.get("history", [])

            agents_file = TOOLS_DIR / "agents" / "agents.json"
            agents_data = json.loads(agents_file.read_text("utf-8"))
            agent = None
            for a in agents_data.get("agents", []):
                if a["id"] == agent_id:
                    agent = a
                    break

            if not agent:
                self.send_json({"error": f"未找到智能体: {agent_id}"}, 404)
                return

            board_section = board_manager.get_agent_section(agent_id) or ""

            response = chat_with_agent(agent, message, board_section, history)

            if response:
                self.send_json({"response": response})
            else:
                self.send_json({"error": "API 调用失败，请检查配置或网络"}, 500)

        elif path == "/api/board/update":
            agent_id = data.get("agent_id")
            updates = data.get("updates", {})
            if agent_id and updates:
                ok = board_manager.update_board(agent_id, updates)
                self.send_json({"ok": ok})
            else:
                self.send_json({"error": "missing params"}, 400)

        elif path == "/api/novel/switch":
            name = data.get("name", "")
            if name:
                ok = workspace_manager.switch_novel(name)
                self.send_json({"ok": ok})
            else:
                self.send_json({"error": "missing name"}, 400)

        elif path == "/api/workspace/save":
            ws = data.get("workspace")
            file = data.get("file")
            content = data.get("content", "")
            if ws and file:
                ok = workspace_manager.save_file(ws, file, content)
                self.send_json({"ok": ok})
            else:
                self.send_json({"error": "missing params"}, 400)

        elif path == "/api/dashboard/save":
            dash_file = DASHBOARD_DIR / "dashboard.json"
            try:
                dash_file.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
                self.send_json({"ok": True})
            except Exception as e:
                self.send_json({"error": str(e)}, 500)

        else:
            self.send_json({"error": "not found"}, 404)


def main():
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

    print(f"\n  {'='*50}")
    print(f"  网文创作控制中心")
    print(f"{'='*50}")
    print(f"  启动地址: http://localhost:{PORT}")
    print(f"  停止方式: Ctrl + C")
    print(f"{'='*50}\n")

    server = HTTPServer(("0.0.0.0", PORT), DashboardHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  服务已停止\n")
        server.server_close()


if __name__ == "__main__":
    main()
