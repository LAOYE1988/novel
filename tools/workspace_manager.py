import json
import os
from pathlib import Path

TOOLS_DIR = Path(__file__).parent
CONFIG_PATH = TOOLS_DIR / "workspace_config.json"
NOVELS_CONFIG_PATH = TOOLS_DIR / "novels_config.json"
PROJECT_DIR = TOOLS_DIR.parent


def _load_config() -> dict:
    if not CONFIG_PATH.exists():
        return {"workspaces": {}}
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError:
        return {"workspaces": {}}


def _load_novels_config() -> dict:
    if not NOVELS_CONFIG_PATH.exists():
        return {"current": "", "novels": []}
    try:
        with open(NOVELS_CONFIG_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError:
        return {"current": "", "novels": []}


def _save_novels_config(data: dict):
    NOVELS_CONFIG_PATH.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )


def get_current_novel() -> str:
    config = _load_novels_config()
    return config.get("current", "")


def list_novels() -> list[str]:
    config = _load_novels_config()
    return config.get("novels", [])


def switch_novel(name: str) -> bool:
    config = _load_novels_config()
    novels = config.get("novels", [])

    if name not in novels:
        print(f"  [错误] 小说「{name}」不存在")
        print(f"  [提示] 可用: {', '.join(novels) if novels else '(无)'}")
        return False

    config["current"] = name
    _save_novels_config(config)

    novel_dir = PROJECT_DIR / name
    for sub in ["大纲", "文稿", "设定集"]:
        (novel_dir / sub).mkdir(parents=True, exist_ok=True)

    print(f"  [OK] 已切换到小说: {name}\n")
    return True


def create_novel(name: str) -> bool:
    config = _load_novels_config()
    novels = config.get("novels", [])

    if name in novels:
        print(f"  [错误] 小说「{name}」已存在")
        return False

    novels.append(name)
    config["novels"] = novels
    config["current"] = name
    _save_novels_config(config)

    novel_dir = PROJECT_DIR / name
    for sub in ["大纲", "文稿", "设定集"]:
        (novel_dir / sub).mkdir(parents=True, exist_ok=True)

    print(f"  [OK] 已创建并切换到小说: {name}")
    print(f"      文件夹: {novel_dir}")
    for sub in ["大纲", "文稿", "设定集"]:
        print(f"        {sub}/")
    print()
    return True


def rename_novel(old_name: str, new_name: str) -> bool:
    config = _load_novels_config()
    novels = config.get("novels", [])

    if old_name not in novels:
        print(f"  [错误] 小说「{old_name}」不存在")
        return False
    if new_name in novels:
        print(f"  [错误] 小说「{new_name}」已存在")
        return False

    idx = novels.index(old_name)
    novels[idx] = new_name
    config["novels"] = novels
    if config.get("current") == old_name:
        config["current"] = new_name
    _save_novels_config(config)

    old_dir = PROJECT_DIR / old_name
    new_dir = PROJECT_DIR / new_name
    if old_dir.exists():
        old_dir.rename(new_dir)

    print(f"  [OK] 已重命名: {old_name} -> {new_name}\n")
    return True


def delete_novel(name: str) -> bool:
    config = _load_novels_config()
    novels = config.get("novels", [])

    if name not in novels:
        print(f"  [错误] 小说「{name}」不存在")
        return False

    novels.remove(name)
    config["novels"] = novels
    if config.get("current") == name:
        config["current"] = novels[0] if novels else ""
    _save_novels_config(config)

    print(f"  [OK] 已从项目列表移除: {name}")
    print(f"  [提示] 文件夹仍保留在磁盘: {PROJECT_DIR / name}")
    print(f"         如需彻底删除请手动操作\n")
    return True


def _resolve_path(ws_path_template: str) -> Path:
    novel = get_current_novel()
    path_str = ws_path_template.replace("{novel}", novel)
    return (PROJECT_DIR / path_str).resolve()


def list_workspaces() -> list[dict]:
    config = _load_config()
    workspaces = config.get("workspaces", {})
    result = []
    for name, info in workspaces.items():
        path = _resolve_path(info.get("path", name))
        result.append({
            "name": name,
            "path": str(path),
            "description": info.get("description", ""),
            "read": info.get("read", True),
            "write": info.get("write", True),
            "shared": info.get("shared", False),
        })
    return result


def list_files(workspace: str, pattern: str = "*") -> list[dict]:
    path = _resolve_path(_get_raw_path(workspace))
    if not path or not path.exists():
        return []

    files = []
    for f in sorted(path.glob(pattern)):
        if f.is_file():
            size = f.stat().st_size
            mtime = f.stat().st_mtime
            from datetime import datetime
            files.append({
                "name": f.name,
                "size": size,
                "modified": datetime.fromtimestamp(mtime).strftime("%Y-%m-%d %H:%M"),
                "ext": f.suffix.lower(),
            })
    return files


def _get_raw_path(workspace: str) -> str:
    config = _load_config()
    ws = config.get("workspaces", {}).get(workspace)
    return ws.get("path", workspace) if ws else workspace


def read_file(workspace: str, filename: str) -> str | None:
    path = _resolve_path(_get_raw_path(workspace))
    if not path:
        print(f"  [错误] 未找到工作区: {workspace}")
        return None

    file_path = path / filename
    if not file_path.exists():
        print(f"  [错误] 文件不存在: {workspace}/{filename}")
        return None
    if not file_path.is_file():
        print(f"  [错误] 路径不是文件: {workspace}/{filename}")
        return None

    try:
        return file_path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        try:
            return file_path.read_text(encoding="gbk")
        except Exception as e:
            print(f"  [错误] 读取文件失败: {e}")
            return None
    except Exception as e:
        print(f"  [错误] 读取文件失败: {e}")
        return None


def save_file(workspace: str, filename: str, content: str, overwrite: bool = True) -> bool:
    path = _resolve_path(_get_raw_path(workspace))
    if not path:
        return False

    file_path = path / filename
    if file_path.exists() and not overwrite:
        print(f"  [提示] 文件已存在: {filename}")
        return False

    file_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        file_path.write_text(content, encoding="utf-8")
        print(f"  [OK] 已保存: [{get_current_novel()}] {workspace}/{filename} ({(len(content))} 字符)")
        return True
    except Exception as e:
        print(f"  [错误] 保存文件失败: {e}")
        return False


def delete_file(workspace: str, filename: str) -> bool:
    path = _resolve_path(_get_raw_path(workspace))
    if not path:
        print(f"  [错误] 未找到工作区: {workspace}")
        return False

    file_path = path / filename
    if not file_path.exists():
        print(f"  [错误] 文件不存在: {workspace}/{filename}")
        return False

    try:
        file_path.unlink()
        print(f"  [OK] 已删除: {workspace}/{filename}")
        return True
    except Exception as e:
        print(f"  [错误] 删除文件失败: {e}")
        return False


def get_workspace_context(workspace: str, max_files: int = 5, max_chars_per_file: int = 2000) -> str:
    path = _resolve_path(_get_raw_path(workspace))
    if not path or not path.exists():
        return ""

    files = list_files(workspace)
    if not files:
        novel = get_current_novel()
        tag = f"[{novel}] " if not _is_shared(workspace) else ""
        return f"{tag}[{workspace}] (空文件夹)"

    novel = get_current_novel()
    tag = f"[{novel}] " if not _is_shared(workspace) else ""
    result = f"{tag}【{workspace}】文件夹内容:\n"
    count = 0
    for f in files:
        if count >= max_files:
            result += f"  ... 以及其余 {len(files) - max_files} 个文件\n"
            break
        content = read_file(workspace, f["name"])
        if content:
            preview = content[:max_chars_per_file]
            if len(content) > max_chars_per_file:
                preview += "\n...(截断)"
            result += f"\n--- {f['name']} ---\n{preview}\n"
        count += 1
    return result


def get_all_workspaces_context(max_files_per_ws: int = 3, max_chars: int = 1500) -> str:
    config = _load_config()
    workspace_names = list(config.get("workspaces", {}).keys())
    parts = []
    for name in workspace_names:
        ctx = get_workspace_context(name, max_files_per_ws, max_chars)
        if ctx:
            parts.append(ctx)
    return "\n\n".join(parts)


def _is_shared(workspace: str) -> bool:
    config = _load_config()
    ws = config.get("workspaces", {}).get(workspace)
    return ws.get("shared", False) if ws else False


def print_workspace_tree():
    workspaces = list_workspaces()
    if not workspaces:
        print("  (未配置工作区)")
        return

    current = get_current_novel()

    print(f"\n{'='*60}")
    print(f"  当前小说: {current}")
    print(f"{'='*60}")
    print(f"  {'[RW]':<6} {'名称':<10} {'类型':<8} {'路径'}")
    print(f"  {'-'*58}")

    for ws in workspaces:
        r = "R" if ws["read"] else "-"
        w = "W" if ws["write"] else "-"
        ws_type = "共享" if ws.get("shared") else f"「{current}」专属"
        path_short = ws["path"].replace(str(PROJECT_DIR) + "\\", "")
        print(f"  [{r}{w}]  {ws['name']:<10} {ws_type:<8} {path_short}")

        files = list_files(ws["name"])
        if files:
            for f in files[:3]:
                print(f"       {f['name']:<30} {f['size']:>6}B  {f['modified']}")
            if len(files) > 3:
                print(f"       ... 以及其余 {len(files) - 3} 个文件")
        else:
            print(f"       (空)")
        print()

    print(f"{'='*60}\n")


def add_workspace(name: str, path: str, description: str = "") -> bool:
    config = _load_config()
    workspaces = config.get("workspaces", {})

    if name in workspaces:
        print(f"  [错误] 工作区「{name}」已存在")
        return False

    target_path = Path(path)
    if target_path.is_absolute():
        rel_path = os.path.relpath(target_path, PROJECT_DIR)
    else:
        rel_path = path

    workspaces[name] = {
        "path": rel_path,
        "description": description or f"自定义工作区: {name}",
        "read": True,
        "write": True,
        "shared": True,
    }

    config["workspaces"] = workspaces
    try:
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(config, f, ensure_ascii=False, indent=2)
        print(f"  [OK] 已添加工作区: {name} -> {rel_path}")
        full_path = (PROJECT_DIR / rel_path).resolve()
        full_path.mkdir(parents=True, exist_ok=True)
        return True
    except Exception as e:
        print(f"  [错误] 保存配置失败: {e}")
        return False
