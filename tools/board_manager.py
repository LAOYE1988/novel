import re
from pathlib import Path

BOARD_PATH = Path(__file__).parent / "创作看板.md"

AGENT_SECTIONS = {
    "main-writer":     "网文主笔·总控",
    "setting-manager": "设定管家·书库",
    "outline-architect": "大纲架构师·章纲",
    "content-writer":  "正文写手·去AI",
    "editor-polisher": "金牌责编·润色",
    "inspiration-engine": "灵感引擎·爽点",
    "style-feeder":    "书风认知·投喂专员",
    "plot-analyzer":   "爆款解构·剧情分析师",
}

AGENT_IDS = {v: k for k, v in AGENT_SECTIONS.items()}


def read_board() -> str:
    """读取创作看板的完整内容"""
    if not BOARD_PATH.exists():
        return "[看板文件不存在]"
    return BOARD_PATH.read_text(encoding="utf-8")


def get_agent_section(agent_id: str) -> str | None:
    """获取指定智能体在创作看板中的区块内容"""
    name = AGENT_SECTIONS.get(agent_id)
    if not name:
        return None

    content = read_board()
    if content.startswith("[看板"):
        return None

    pattern = rf"(### .*{re.escape(name)}.*\n(?:[^#][\s\S]*?))(?=\n### |\Z)"
    match = re.search(pattern, content)
    if not match:
        pattern2 = rf"(## .*{re.escape(name)}.*\n(?:[^#][\s\S]*?))(?=\n## |\Z)"
        match = re.search(pattern2, content)

    return match.group(1).strip() if match else None


def update_board(agent_id: str, updates: dict) -> bool:
    """更新创作看板中指定智能体的字段

    updates 格式:
    {
        "checkboxes": {"人设": "同步"},       # 勾选指定选项
        "fill_text": {"进度": "第3卷 第15章"},  # 填写文本
    }
    """
    name = AGENT_SECTIONS.get(agent_id)
    if not name:
        print(f"  [错误] 未知的智能体 ID: {agent_id}")
        return False

    content = read_board()
    if content.startswith("[看板"):
        print(f"  [错误] {content}")
        return False

    pattern = rf"(### .*{re.escape(name)}.*\n(?:[^#][\s\S]*?))(?=\n### |\Z)"
    match = re.search(pattern, content)
    if not match:
        print(f"  [错误] 未在看板中找到: {name}")
        return False

    old_section = match.group(1)
    new_section = old_section

    checkboxes = updates.get("checkboxes", {})
    for field, selected_option in checkboxes.items():
        lines = new_section.split("\n")
        new_lines = []
        for line in lines:
            if field in line:
                parts = re.split(r"(□[^□\n]+)", line)
                new_parts = []
                for part in parts:
                    if part.startswith("□") and selected_option in part:
                        new_parts.append("■" + part[1:])
                    elif part.startswith("■") and selected_option not in part:
                        new_parts.append("□" + part[1:])
                    else:
                        new_parts.append(part)
                line = "".join(new_parts)
            new_lines.append(line)
        new_section = "\n".join(new_lines)

    fill_texts = updates.get("fill_text", {})
    for field, value in fill_texts.items():
        lines = new_section.split("\n")
        new_lines = []
        for line in lines:
            if field in line:
                line = re.sub(r"＿+", value, line)
                line = re.sub(r"_{2,}", value, line)
            new_lines.append(line)
        new_section = "\n".join(new_lines)

    fill_lines = updates.get("fill_lines", {})
    for field, value in fill_lines.items():
        lines = new_section.split("\n")
        new_lines = []
        for line in lines:
            if field in line:
                line = re.sub(r"_{2,}__*", value, line)
            new_lines.append(line)
        new_section = "\n".join(new_lines)

    content = content.replace(old_section, new_section)
    BOARD_PATH.write_text(content, encoding="utf-8")

    updated_fields = []
    for k, v in checkboxes.items():
        updated_fields.append(f"  [状态] {k}: {v}")
    for k, v in fill_texts.items():
        updated_fields.append(f"  [文本] {k}: {v}")
    for k, v in fill_lines.items():
        updated_fields.append(f"  [内容] {k}: {v}")

    print(f"  [OK] 看板已更新 [{name}]")
    for item in updated_fields:
        print(item)
    return True


def list_all_status() -> dict:
    """读取看板中所有智能体的当前状态"""
    content = read_board()
    if content.startswith("[看板"):
        return {}

    status = {}
    for agent_id, name in AGENT_SECTIONS.items():
        section = get_agent_section(agent_id)
        if section:
            status[agent_id] = {"name": name, "raw": section}
    return status


def print_board_summary():
    """打印看板摘要"""
    content = read_board()
    if content.startswith("[看板"):
        print(f"  {content}")
        return

    print(f"\n{'='*60}")
    print("  [看板] 创作看板 - 当前状态总览")
    print(f"{'='*60}")

    sections = content.split("\n### ")
    for section in sections:
        if not section.strip():
            continue
        lines = section.strip().split("\n")
        title = lines[0].strip()
        print(f"\n  [{title}]")

        for line in lines[1:]:
            line = line.strip()
            if not line:
                continue
            if "：" in line or ":" in line:
                print(f"    {line}")

    print(f"\n{'='*60}")
    print(f"  看板路径: {BOARD_PATH}")
    print(f"{'='*60}\n")
