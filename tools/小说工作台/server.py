import json, os, sys, io, re
from http.server import HTTPServer, SimpleHTTPRequestHandler
from socketserver import ThreadingMixIn
from pathlib import Path

class ThreadingServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True
    allow_reuse_address = True

WORKBENCH_DIR = Path(__file__).parent
EDITOR_DIR = WORKBENCH_DIR / "编辑器"
TOOLS_DIR = WORKBENCH_DIR.parent
PROJECT_DIR = TOOLS_DIR.parent
PORT = 8899

sys.path.insert(0, str(TOOLS_DIR))
sys.path.insert(0, str(TOOLS_DIR / "agents"))

import board_manager
import workspace_manager
from config import is_configured, get_api_key
from deepseek_api import chat_with_agent


class WorkbenchHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(EDITOR_DIR), **kwargs)

    def log_message(self, format, *args):
        pass

    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path

        if path.startswith("/api/"):
            self.handle_api_get(path)
        elif path.startswith("/设定/") or path.startswith("/大纲/") or path.startswith("/文风/"):
            file_path = WORKBENCH_DIR / path.lstrip("/")
            if file_path.exists() and file_path.is_file():
                content = file_path.read_bytes()
                ext = file_path.suffix
                ct = {".json": "application/json; charset=utf-8", ".md": "text/markdown; charset=utf-8", ".txt": "text/plain; charset=utf-8"}.get(ext, "application/octet-stream")
                self.send_response(200)
                self.send_header("Content-Type", ct)
                self.send_header("Content-Length", str(len(content)))
                self.end_headers()
                self.wfile.write(content)
            else:
                self.send_response(404)
                self.send_header("Content-Type", "text/plain")
                self.end_headers()
                self.wfile.write(b"404 Not Found")
        else:
            super().do_GET()

    def do_POST(self):
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length).decode("utf-8") if content_length else "{}"
        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            data = {}
        self.handle_api_post(self.path, data)

    def handle_api_get(self, path):
        from urllib.parse import urlparse, parse_qs
        parsed = urlparse(path)
        path = parsed.path
        params = parse_qs(parsed.query)

        if path == "/api/agents":
            agents_file = WORKBENCH_DIR / "agents" / "agents-config.json"
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

        elif path == "/api/novel/chapters":
            current = workspace_manager.get_current_novel()
            novel_dir = PROJECT_DIR / current / "文稿"
            chapters = []
            if novel_dir.exists():
                import re
                def natural_key(f):
                    return [int(c) if c.isdigit() else c.lower() for c in re.split(r'(\d+)', f.stem)]
                files = sorted(novel_dir.iterdir(), key=natural_key)
                for f in files:
                    if f.suffix.lower() in (".txt", ".md"):
                        chapters.append({
                            "name": f.stem,
                            "file": f.name,
                            "size": f.stat().st_size
                        })
            self.send_json({"chapters": chapters, "novel": current})

        elif path == "/api/novel/chapter/read":
            file_name = params.get("file", [None])[0]
            current = workspace_manager.get_current_novel()
            chapter_file = PROJECT_DIR / current / "文稿" / file_name
            if chapter_file.exists() and chapter_file.is_file():
                content = chapter_file.read_text("utf-8")
                self.send_json({"content": content, "file": file_name})
            else:
                self.send_json({"error": "文件不存在"}, 404)

        elif path == "/api/novel/workspace/read":
            ws = params.get("ws", [None])[0]
            file_name = params.get("file", [None])[0]
            current = workspace_manager.get_current_novel()
            target = PROJECT_DIR / current / ws / file_name
            if target.exists() and target.is_file():
                content = target.read_text("utf-8")
                self.send_json({"content": content, "file": file_name})
            else:
                self.send_json({"error": "文件不存在"}, 404)

        elif path == "/api/novel/entry/image":
            tab = params.get("tab", [None])[0]
            name = params.get("name", [None])[0]
            current = workspace_manager.get_current_novel()
            found = None
            img_dir = PROJECT_DIR / current / "设定集" / "图片" / (tab or "")
            if img_dir.exists():
                for f in img_dir.iterdir():
                    if f.stem == name and f.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp", ".gif"):
                        found = f.name
                        break
            self.send_json({"file": found})

        elif re.match(r"^/api/novel/entry/image/[^/]+/.+", path):
            from urllib.parse import unquote
            parts = path[len("/api/novel/entry/image/"):].split("/", 1)
            tab, file_name = unquote(parts[0]), unquote(parts[1])
            current = workspace_manager.get_current_novel()
            img_file = PROJECT_DIR / current / "设定集" / "图片" / tab / file_name
            if img_file.exists() and img_file.is_file():
                data = img_file.read_bytes()
                ext = img_file.suffix.lower()
                ct = {".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".webp":"image/webp",".gif":"image/gif"}.get(ext, "application/octet-stream")
                self.send_response(200)
                self.send_header("Content-Type", ct)
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Cache-Control", "private, max-age=3600")
                self.end_headers()
                self.wfile.write(data)
            else:
                self.send_json({"error": "图片不存在"}, 404)

        elif path == "/api/check":
            if is_configured():
                key = get_api_key()
                masked = key[:8] + "****" + key[-4:] if len(key) > 16 else "已设置"
                self.send_json({"ok": True, "message": f"API 正常 (Key: {masked})"})
            else:
                self.send_json({"ok": False, "error": "未配置 API Key"})

        elif path == "/api/dashboard/load":
            dash_file = EDITOR_DIR / "dashboard.json"
            if dash_file.exists():
                try:
                    self.send_json(json.loads(dash_file.read_text("utf-8")))
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

            agents_file = WORKBENCH_DIR / "agents" / "agents-config.json"
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
            import time
            t0 = time.time()
            print(f"  [API] 调用 {agent_id} ...", flush=True)
            response = chat_with_agent(agent, message, board_section, history)
            elapsed = time.time() - t0
            print(f"  [API] {agent_id} 返回 ({elapsed:.1f}s): {'成功' if response else '失败'}", flush=True)

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

        elif path == "/api/novel/create":
            name = data.get("name", "").strip()
            if name:
                ok = workspace_manager.create_novel(name)
                self.send_json({"ok": ok, "name": name})
            else:
                self.send_json({"error": "missing name"}, 400)

        elif path == "/api/novel/rename":
            old_name = data.get("old_name", "").strip()
            new_name = data.get("new_name", "").strip()
            if old_name and new_name:
                ok = workspace_manager.rename_novel(old_name, new_name)
                self.send_json({"ok": ok, "old_name": old_name, "new_name": new_name})
            else:
                self.send_json({"error": "missing params"}, 400)

        elif path == "/api/novel/delete":
            name = data.get("name", "").strip()
            import shutil
            if name:
                novel_dir = PROJECT_DIR / name
                if novel_dir.exists():
                    shutil.rmtree(novel_dir)
                ok = workspace_manager.delete_novel(name)
                self.send_json({"ok": ok})
            else:
                self.send_json({"error": "missing name"}, 400)

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

        elif path == "/api/novel/entry/image/upload":
            tab = data.get("tab", "")
            name = data.get("name", "unknown")
            raw = data.get("data", "")
            if raw.startswith("data:image"):
                try:
                    import base64, time
                    header, _, b64 = raw.partition(",")
                    ext = ".png"
                    for e in [".png", ".jpeg", ".jpg", ".webp", ".gif"]:
                        if e in header: ext = e; break
                    img_data = base64.b64decode(b64)
                    current = workspace_manager.get_current_novel()
                    img_dir = PROJECT_DIR / current / "设定集" / "图片" / tab
                    img_dir.mkdir(parents=True, exist_ok=True)
                    # Delete old image for this name
                    for f in img_dir.iterdir():
                        if f.stem == name and f.suffix.lower() in (".png",".jpg",".jpeg",".webp",".gif"):
                            f.unlink()
                    safe_name = f"{name}{ext}"
                    img_dir.joinpath(safe_name).write_bytes(img_data)
                    self.send_json({"ok": True, "file": safe_name})
                except Exception as e:
                    self.send_json({"error": str(e)}, 400)
            else:
                self.send_json({"error": "无效图片数据"}, 400)

        elif path == "/api/novel/entry/image/delete":
            tab = data.get("tab", "")
            file = data.get("file", "")
            current = workspace_manager.get_current_novel()
            target = PROJECT_DIR / current / "设定集" / "图片" / tab / file
            if target.exists():
                target.unlink()
                self.send_json({"ok": True})
            else:
                self.send_json({"error": "文件不存在"}, 404)

        elif path == "/api/dashboard/save":
            dash_file = EDITOR_DIR / "dashboard.json"
            try:
                dash_file.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
                self.send_json({"ok": True})
            except Exception as e:
                self.send_json({"error": str(e)}, 500)

        elif path == "/api/chat/history/save":
            novel = data.get("novel", "")
            content = data.get("content", "")
            today = data.get("date", "")
            if novel and content and today:
                backup_dir = PROJECT_DIR / novel / "对话备份"
                backup_dir.mkdir(parents=True, exist_ok=True)
                file_path = backup_dir / f"对话记录_{today}.md"
                file_path.write_text(content, encoding="utf-8")
                self.send_json({"ok": True})
            else:
                self.send_json({"error": "missing params"}, 400)

        elif path == "/api/chat/history/load":
            novel = data.get("novel", "")
            if novel:
                backup_dir = PROJECT_DIR / novel / "对话备份"
                all_content = []
                if backup_dir.exists():
                    files = sorted(backup_dir.iterdir(), reverse=True)
                    for f in files:
                        if f.suffix == ".md":
                            all_content.append({
                                "file": f.name,
                                "content": f.read_text(encoding="utf-8")
                            })
                self.send_json({"files": all_content})
            else:
                self.send_json({"error": "missing novel"}, 400)

        elif path == "/api/novel/backup/today":
            novel = data.get("novel", "")
            if not novel:
                self.send_json({"error": "missing novel"}, 400)
                return
            import datetime, shutil
            today = datetime.date.today().isoformat()
            novel_dir = PROJECT_DIR / novel
            backup_dir = novel_dir / "备份" / today
            backup_dir.mkdir(parents=True, exist_ok=True)

            # Backup 文稿
            src_wg = novel_dir / "文稿"
            if src_wg.exists():
                dst_wg = backup_dir / "文稿"
                dst_wg.mkdir(parents=True, exist_ok=True)
                for f in src_wg.iterdir():
                    if f.is_file():
                        shutil.copy2(f, dst_wg / f.name)

            # Backup 设定集
            src_set = novel_dir / "设定集"
            if src_set.exists():
                dst_set = backup_dir / "设定集"
                dst_set.mkdir(parents=True, exist_ok=True)
                for f in src_set.iterdir():
                    if f.is_file():
                        shutil.copy2(f, dst_set / f.name)

            # Backup 大纲
            src_ol = novel_dir / "大纲"
            if src_ol.exists():
                dst_ol = backup_dir / "大纲"
                dst_ol.mkdir(parents=True, exist_ok=True)
                for f in src_ol.iterdir():
                    if f.is_file():
                        shutil.copy2(f, dst_ol / f.name)

            # Backup 对话备份
            src_chat = novel_dir / "对话备份"
            if src_chat.exists():
                dst_chat = backup_dir / "对话备份"
                dst_chat.mkdir(parents=True, exist_ok=True)
                for f in src_chat.iterdir():
                    if f.is_file():
                        shutil.copy2(f, dst_chat / f.name)

            self.send_json({"ok": True, "backup": str(backup_dir)})

        elif path == "/api/novel/backup/cloud":
            novel = data.get("novel", "")
            if not novel:
                self.send_json({"error": "missing novel"}, 400)
                return
            import datetime, shutil, zipfile

            today = datetime.date.today().isoformat()
            novel_dir = PROJECT_DIR / novel
            if not novel_dir.exists():
                self.send_json({"error": "小说目录不存在"}, 404)
                return

            # Create zip in project temp
            zip_name = f"{novel}_{today}.zip"
            zip_path = PROJECT_DIR / zip_name
            with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
                for root, dirs, files in os.walk(novel_dir):
                    rel_root = os.path.relpath(root, PROJECT_DIR)
                    for f in files:
                        file_path = os.path.join(root, f)
                        zf.write(file_path, os.path.join(rel_root, f))

            # Copy to cloud drives
            cloud_targets = []
            user_profile = Path.home()
            for cloud_name in ["OneDrive", "WPSDrive"]:
                cloud_dir = user_profile / cloud_name
                if cloud_dir.exists():
                    novel_backup_dir = cloud_dir / "小说备份"
                    novel_backup_dir.mkdir(parents=True, exist_ok=True)
                    dest = novel_backup_dir / zip_name
                    shutil.copy2(zip_path, dest)
                    cloud_targets.append(str(dest))

            zip_path.unlink()

            self.send_json({
                "ok": True,
                "novel": novel,
                "date": today,
                "cloud_paths": cloud_targets,
                "message": f"已备份到 {len(cloud_targets)} 个云盘" if cloud_targets else "未检测到云端文件夹"
            })

        elif path == "/api/novel/backup/git":
            import datetime, subprocess
            now = datetime.datetime.now()
            today = now.strftime("%Y-%m-%d")
            time_str = now.strftime("%H:%M")
            commit_msg = f"📦 每日备份 {today} {time_str}"

            try:
                result = subprocess.run(
                    ["git", "add", "-A"],
                    cwd=PROJECT_DIR,
                    capture_output=True, text=True, encoding="utf-8", timeout=30
                )
                if result.returncode != 0:
                    self.send_json({"ok": False, "error": f"git add 失败: {result.stderr}"})
                    return

                result = subprocess.run(
                    ["git", "commit", "-m", commit_msg],
                    cwd=PROJECT_DIR,
                    capture_output=True, text=True, encoding="utf-8", timeout=30
                )

                result2 = subprocess.run(
                    ["git", "push"],
                    cwd=PROJECT_DIR,
                    capture_output=True, text=True, encoding="utf-8", timeout=60
                )
                if result2.returncode != 0:
                    self.send_json({
                        "ok": True,
                        "commit": commit_msg,
                        "push_error": result2.stderr,
                        "warning": "提交成功但推送失败，请检查 Git 远程仓库配置"
                    })
                    return

                self.send_json({
                    "ok": True,
                    "commit": commit_msg,
                    "message": f"已提交并推送到远程仓库"
                })
            except subprocess.TimeoutExpired:
                self.send_json({"ok": False, "error": "Git 操作超时"})
            except FileNotFoundError:
                self.send_json({"ok": False, "error": "未安装 Git 或不在 Git 仓库中"})
            except Exception as e:
                self.send_json({"ok": False, "error": str(e)})

        elif path == "/api/novel/word-bank":
            style = data.get("style", "auto")
            context = data.get("context", "")
            agents_file = WORKBENCH_DIR / "agents" / "agents-config.json"
            try:
                agents_data = json.loads(agents_file.read_text("utf-8"))
            except:
                agents_data = {"agents": []}
            agent = None
            for a in agents_data.get("agents", []):
                if a["id"] == "word-bank":
                    agent = a
                    break
            if not agent:
                self.send_json({"error": "词库助手未配置"}, 404)
                return

            style_hint = ""
            if style and style != "auto":
                style_hint = f"\n请使用「{style}」风格输出词汇。"
            prompt = agent.get("system_prompt", "") + style_hint
            prompt += f"\n\n【当前上下文】\n{context}"

            board_section = board_manager.get_agent_section("word-bank") or ""
            response = chat_with_agent(agent, prompt, board_section, [])
            if response:
                self.send_json({"response": response})
            else:
                self.send_json({"error": "API 调用失败"}, 500)

        else:
            self.send_json({"error": "not found"}, 404)


def main():
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    print(f"\n  {'='*50}")
    print(f"  小说创作工作台 (内置 API)")
    print(f"{'='*50}")
    print(f"  启动地址: http://localhost:{PORT}")
    print(f"  停止方式: Ctrl + C")
    print(f"{'='*50}\n")

    server = ThreadingServer(("0.0.0.0", PORT), WorkbenchHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  服务已停止\n")
        server.server_close()

if __name__ == "__main__":
    main()
