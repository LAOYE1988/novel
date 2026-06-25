import json
import os
import sys
from pathlib import Path

AGENTS_DIR = Path(__file__).parent
DEFAULT_JSON = AGENTS_DIR / "agents.json"

BOARD_DIR = AGENTS_DIR.parent
sys.path.insert(0, str(BOARD_DIR))
import board_manager

TOOLS_DIR = BOARD_DIR
sys.path.insert(0, str(TOOLS_DIR))
from config import is_configured, get_api_key
from deepseek_api import chat_with_agent
import workspace_manager


def load_agents(json_path: str | Path) -> list[dict]:
    path = Path(json_path)
    if not path.exists():
        print(f"  [错误] 文件不存在: {path}")
        return []

    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except json.JSONDecodeError as e:
        print(f"  [错误] JSON 解析失败: {e}")
        return []

    agents = data.get("agents", [])
    if not isinstance(agents, list):
        print(f"  [错误] 'agents' 字段必须是一个列表")
        return []

    print(f"  共发现 {len(agents)} 个智能体定义")
    return agents


def validate_agent(agent: dict) -> list[str]:
    errors = []
    required = ["id", "name", "description", "system_prompt"]
    for field in required:
        if field not in agent or not agent[field]:
            errors.append(f"缺少必需字段: {field}")
    if "id" in agent and not isinstance(agent["id"], str):
        errors.append("'id' 必须是字符串")
    return errors


def merge_agents(existing: list[dict], new_agents: list[dict]) -> tuple[list[dict], int, int]:
    existing_ids = {a["id"] for a in existing if "id" in a}
    added = 0
    skipped = 0

    for agent in new_agents:
        if not isinstance(agent, dict):
            skipped += 1
            continue

        errors = validate_agent(agent)
        if errors:
            print(f"  [跳过] 智能体数据不完整: {agent.get('id', '未知')} - {'; '.join(errors)}")
            skipped += 1
            continue

        if agent["id"] in existing_ids:
            print(f"  [跳过] ID 已存在: {agent['id']} ({agent['name']})")
            skipped += 1
        else:
            existing.append(agent)
            existing_ids.add(agent["id"])
            added += 1

    return existing, added, skipped


def print_agents_table(agents: list[dict], title: str = "当前智能体列表"):
    if not agents:
        print("  (空)")
        return

    print(f"\n{'='*80}")
    print(f"  {title}")
    print(f"{'='*80}")
    print(f"  {'ID':<22} {'名称':<18} {'类别':<10} {'看板':<12} {'模型':<16}")
    print(f"  {'-'*78}")
    for a in agents:
        board = "Y" if a.get("board_section") else "-"
        print(f"  {a['id']:<22} {a['name']:<18} {a.get('category', '未分类'):<10} {board:<12} {a.get('model', '默认'):<16}")
    print(f"{'='*80}")
    print(f"  总计: {len(agents)} 个智能体\n")


def print_agent_detail(agent: dict):
    print(f"\n{'━'*50}")
    print(f"  [{agent['id']}] {agent['name']}")
    print(f"{'━'*50}")
    print(f"  类别:     {agent.get('category', '未分类')}")
    print(f"  模型:     {agent.get('model', '默认')}")
    print(f"  温度:     {agent.get('temperature', '默认')}")
    if agent.get("board_section"):
        print(f"  看板区块: {agent['board_section']}")
        bf = agent.get("board_fields", {})
        fields = []
        if bf.get("checkboxes"):
            fields.extend(bf["checkboxes"])
        if bf.get("fill_text"):
            fields.extend(bf["fill_text"])
        if bf.get("fill_lines"):
            fields.extend(bf["fill_lines"])
        print(f"  看板字段: {', '.join(fields)}")
    print(f"  描述:     {agent['description']}")
    print(f"{'─'*50}")
    print(f"  系统提示词:")
    lines = agent['system_prompt'].strip().split('\n')
    for line in lines:
        print(f"    {line}")
    print(f"{'━'*50}\n")


def import_from_file(json_path: str | Path, agents_store: list[dict]) -> tuple[int, int]:
    print(f"\n  正在导入: {json_path}")
    new_agents = load_agents(json_path)
    if not new_agents:
        return 0, 0
    agents_store, added, skipped = merge_agents(agents_store, new_agents)
    print(f"  结果: 新增 {added} 个, 跳过 {skipped} 个\n")
    return added, skipped


def export_to_json(agents: list[dict], output_path: str | Path):
    data = {
        "schema_version": "2.0",
        "description": f"导出的智能体数据 (共 {len(agents)} 个)",
        "board_file": "../创作看板.md",
        "agents": agents
    }
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"  已导出 {len(agents)} 个智能体到: {output_path}\n")


def filter_by_category(agents: list[dict], category: str) -> list[dict]:
    return [a for a in agents if a.get("category") == category]


def find_agent(agents: list[dict], agent_id: str) -> dict | None:
    for a in agents:
        if a["id"] == agent_id:
            return a
    return None


def check_api_config():
    if is_configured():
        key = get_api_key()
        masked = key[:8] + "****" + key[-4:] if len(key) > 16 else "已设置"
        print(f"\n  [OK] DeepSeek API 配置正常")
        print(f"  API Key: {masked}")
        from config import get_model, get_base_url
        print(f"  模型:    {get_model()}")
        print(f"  地址:    {get_base_url()}\n")
    else:
        print(f"\n  [错误] 未配置 DeepSeek API Key")
        print(f"  [提示] 请在 tools/.env 文件中设置:")
        print(f"         DEEPSEEK_API_KEY=sk-你的Key\n")


def once_chat(agents: list[dict], agent_id: str, user_message: str):
    agent = find_agent(agents, agent_id)
    if not agent:
        print(f"[错误] 未找到智能体: {agent_id}")
        return

    if not is_configured():
        check_api_config()
        return

    print(f"\n{'='*60}")
    print(f"  [{agent['name']}] 正在思考...")
    print(f"{'='*60}\n")

    board_context = board_manager.get_agent_section(agent_id) or ""

    response = chat_with_agent(agent, user_message, board_context)
    if response is None:
        return

    print(response)
    print(f"\n{'='*60}")
    print(f"  [完成] 回复结束")
    print(f"{'='*60}\n")


def talk_with_agent(agents: list[dict], agent_id: str):
    agent = find_agent(agents, agent_id)
    if not agent:
        print(f"[错误] 未找到智能体: {agent_id}")
        return

    if not is_configured():
        check_api_config()
        return

    print(f"\n{'='*60}")
    print(f"  进入对话模式: [{agent['name']}]")
    print(f"  输入内容后按回车发送")
    print(f"  输入 /quit 或 /q 退出对话")
    print(f"  输入 /board 查看当前看板状态")
    print(f"  输入 /update <字段:值> 更新看板 (如:产出:正常)")
    print(f"  输入 /novel 查看小说 /novel-switch <名> 切换小说")
    print(f"  输入 /ws 查看工作区 /ws-ls <名> 列文件 /ws-read <名> <文件> 读文件")
    print(f"  输入 /ws-save <工作区> <文件> <内容> 保存到工作区")
    print(f"{'='*60}\n")

    history = []
    while True:
        try:
            user_input = input("  [你] > ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\n\n  [退出] 对话结束")
            break

        if not user_input:
            continue

        if user_input.lower() in ("/quit", "/q"):
            print("  [退出] 对话结束\n")
            break

        if user_input.lower() == "/board":
            board_manager.print_board_summary()
            continue

        if user_input.lower().startswith("/update"):
            parts = user_input.split(maxsplit=2)
            if len(parts) < 3:
                print("  [提示] 用法: /update 字段:值 (如: /update 产出:正常)")
                continue
            kv = parse_key_value(parts[1] + ":" + parts[2]) if ":" not in parts[1] else parse_key_value(parts[1] + ":" + parts[2])
            # handle simpler format
            rest = user_input[len("/update "):].strip()
            if ":" in rest:
                key, value = rest.split(":", 1)
                key, value = key.strip(), value.strip()
                agent_board_fields = agent.get("board_fields", {})
                if key in agent_board_fields.get("checkboxes", []):
                    board_manager.update_board(agent_id, {"checkboxes": {key: value}})
                elif key in agent_board_fields.get("fill_text", []):
                    board_manager.update_board(agent_id, {"fill_text": {key: value}})
                elif key in agent_board_fields.get("fill_lines", []):
                    board_manager.update_board(agent_id, {"fill_lines": {key: value}})
                else:
                    board_manager.update_board(agent_id, {"fill_text": {key: value}})
            else:
                print("  [提示] 格式: /update 字段:值")
            continue

        if user_input.lower().startswith("/novel"):
            parts = user_input.strip().split(maxsplit=1)
            cmd = parts[0].lower() if parts else ""

            if cmd == "/novel":
                current = workspace_manager.get_current_novel()
                novels = workspace_manager.list_novels()
                print(f"\n  当前小说: {current}")
                print(f"  所有小说:")
                for n in novels:
                    marker = " <<<" if n == current else ""
                    print(f"    {n}{marker}")

            elif cmd == "/novel-switch" and len(parts) >= 2:
                workspace_manager.switch_novel(parts[1])

            elif cmd == "/novel-create" and len(parts) >= 2:
                workspace_manager.create_novel(parts[1])

            else:
                print("  [提示] 用法:")
                print("    /novel                   查看小说列表")
                print("    /novel-switch <名称>     切换当前小说")
                print("    /novel-create <名称>     创建新小说")
            continue

        if user_input.lower().startswith("/ws"):
            parts = user_input.strip().split(maxsplit=2)
            cmd = parts[0].lower() if parts else ""

            if cmd == "/ws":
                workspace_manager.print_workspace_tree()

            elif cmd == "/ws-ls" and len(parts) >= 2:
                files = workspace_manager.list_files(parts[1])
                if not files:
                    print(f"  [信息] 工作区「{parts[1]}」为空或不存在")
                else:
                    print(f"\n  工作区「{parts[1]}」的文件:")
                    print(f"  {'─'*40}")
                    for f in files:
                        print(f"  {f['name']:<30} {f['size']:>6}B  {f['modified']}")
                    print()

            elif cmd == "/ws-read" and len(parts) >= 3:
                content = workspace_manager.read_file(parts[1], parts[2])
                if content is not None:
                    print(f"\n  ──  {parts[1]}/{parts[2]}  ──")
                    print(content)
                    if not content.endswith("\n"):
                        print()
                    print(f"  ──  结束  ──\n")

            elif cmd == "/ws-save" and len(parts) >= 4:
                workspace_manager.save_file(parts[1], parts[2], parts[3])

            elif cmd == "/ws-add" and len(parts) >= 3:
                workspace_manager.add_workspace(parts[1], parts[2])

            else:
                print("  [提示] 用法:")
                print("    /ws                     查看工作区")
                print("    /ws-ls <工作区>         列出文件")
                print("    /ws-read <工作区> <文件> 读取文件")
                print("    /ws-save <工作区> <文件> <内容> 保存文件")
                print("    /ws-add <名称> <路径>    添加工作区")
            continue

        board_context = board_manager.get_agent_section(agent_id) or ""

        print(f"\n  [{agent['name']}] 正在思考...\n")

        response = chat_with_agent(agent, user_input, board_context, history)

        if response is None:
            print("  [错误] 请求失败，请检查 API 配置 (输入 /quit 退出)\n")
            continue

        if history and history[-1]["role"] == "user":
            history.append({"role": "assistant", "content": response})
        else:
            history.extend([
                {"role": "user", "content": user_input},
                {"role": "assistant", "content": response},
            ])

        if len(history) > 20:
            history = history[-20:]

        print(response)
        print(f"\n{'─'*50}\n")


def show_help():
    help_text = """
网文智能体管理工具 — 集成创作看板 + DeepSeek API + 工作区

用法:
  python import_agents.py [选项]

智能体管理:
  -h, --help              显示帮助信息
  -l, --list              列出所有智能体
  -d, --detail <ID>       查看智能体详细信息
  -c, --category <类别>    按类别筛选
  -e, --export <文件路径>  导出智能体到 JSON
  -a, --add <文件路径>     从 JSON 文件导入智能体

小说项目管理:
  --novels                列出所有小说
  --novel-current         查看当前小说
  --novel-create <名称>   创建新小说并切换过去
  --novel-switch <名称>   切换到指定小说
  --novel-rename <旧> <新> 重命名小说
  --novel-remove <名称>   从项目管理中移除

创作看板:
  -b, --board             查看创作看板完整内容
  -s, --summary           打印看板状态摘要
  -u, --update <ID>       更新指定智能体在看板中的状态
      --status <字段:值>   设置勾选框状态（可多次使用）
      --fill <字段:值>     填写文本字段（可多次使用）
  -g, --get-section <ID>  查看智能体在看板中的区块
  --list-sections         列出所有已关联看板的智能体

工作区（文件夹读写）:
  --ws                    列出所有工作区
  --ws-ls <工作区>         列出工作区中的文件
  --ws-read <工作区> <文件> 读取工作区中的文件内容
  --ws-save <工作区> <文件> <内容>  保存内容到工作区文件
  --ws-add <名称> <路径>   添加自定义工作区（路径可绝对或相对）

与智能体对话（需要 DeepSeek API Key）:
  -t, --talk <ID>         进入对话模式，与指定智能体实时交流
  -o, --once <ID> <信息>   单次对话，让智能体处理一次性请求
  --check-api             检查 API 配置是否正常

对话模式内可用指令:
  /quit, /q               退出对话
  /board                  查看当前看板状态
  /update <字段:值>        更新看板（如 产出:正常）
  /novel                  查看小说列表
  /novel-switch <名称>    切换当前小说
  /novel-create <名称>    创建新小说
  /ws                     查看工作区列表
  /ws-ls <工作区>          查看工作区文件
  /ws-read <工作区> <文件>  读取工作区文件
  /ws-save <工作区> <文件>  写入工作区文件
  /ws-add <名称> <路径>    添加工作区

示例:
  python import_agents.py --novels
  python import_agents.py --novel-create 我的新小说
  python import_agents.py --novel-switch 我的新小说
  python import_agents.py -t content-writer
  python import_agents.py -o outline-architect "帮我设计第3卷的大纲"
  python import_agents.py --ws
  python import_agents.py --ws-read 素材库 参考资料.txt
  python import_agents.py --ws-save 文稿 第1章.txt "第一章内容..."
  python import_agents.py -u content-writer --status 产出:正常
  python import_agents.py --check-api
"""
    print(help_text)


def parse_key_value(raw: str) -> tuple[str, str]:
    if ":" in raw:
        key, value = raw.split(":", 1)
        return key.strip(), value.strip()
    print(f"  [错误] 格式错误，请使用「字段:值」格式: {raw}")
    return None, None


def main():
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    agents_store = load_agents(DEFAULT_JSON)

    if len(sys.argv) == 1:
        show_help()
        print_agents_table(agents_store)
        return

    args = sys.argv[1:]
    i = 0
    board_mode = False
    board_updates = {"checkboxes": {}, "fill_text": {}, "fill_lines": {}}
    board_target_id = None

    while i < len(args):
        arg = args[i]

        if arg in ("-h", "--help"):
            show_help()
            return

        elif arg in ("-l", "--list"):
            print_agents_table(agents_store)

        elif arg in ("-d", "--detail"):
            i += 1
            if i >= len(args):
                print("[错误] 请指定智能体 ID")
                return
            agent_id = args[i]
            found = [a for a in agents_store if a["id"] == agent_id]
            if found:
                print_agent_detail(found[0])
            else:
                print(f"[错误] 未找到 ID 为 '{agent_id}' 的智能体")

        elif arg in ("-c", "--category"):
            i += 1
            if i >= len(args):
                print("[错误] 请指定类别名称")
                return
            category = args[i]
            filtered = filter_by_category(agents_store, category)
            if filtered:
                print_agents_table(filtered, f"类别「{category}」的智能体")
            else:
                print(f"\n  未找到类别「{category}」的智能体\n")

        elif arg in ("-e", "--export"):
            i += 1
            if i >= len(args):
                print("[错误] 请指定导出文件路径")
                return
            export_to_json(agents_store, args[i])

        elif arg in ("-a", "--add"):
            i += 1
            if i >= len(args):
                print("[错误] 请指定 JSON 文件路径")
                return
            import_from_file(args[i], agents_store)

        elif arg in ("-b", "--board"):
            content = board_manager.read_board()
            print(f"\n{'='*50}")
            print("  📋 创作看板 · 完整内容")
            print(f"{'='*50}\n")
            print(content)

        elif arg in ("-s", "--summary"):
            board_manager.print_board_summary()

        elif arg in ("-g", "--get-section"):
            i += 1
            if i >= len(args):
                print("[错误] 请指定智能体 ID")
                return
            section = board_manager.get_agent_section(args[i])
            if section:
                print(f"\n  📋 [{args[i]}] 在看板中的区块:\n")
                print(section)
            else:
                print(f"[错误] 未找到智能体 '{args[i]}' 的看板区块")

        elif arg == "--list-sections":
            print(f"\n{'='*50}")
            print("  已关联看板的智能体")
            print(f"{'='*50}")
            for agent in agents_store:
                if agent.get("board_section"):
                    print(f"  {agent['id']:<22} → {agent['board_section']}")
            print()

        elif arg == "--check-api":
            check_api_config()

        elif arg in ("-t", "--talk"):
            i += 1
            if i >= len(args):
                print("[错误] 请指定智能体 ID")
                return
            talk_with_agent(agents_store, args[i])

        elif arg in ("-o", "--once"):
            i += 1
            if i >= len(args):
                print("[错误] 请指定智能体 ID")
                return
            agent_id = args[i]
            i += 1
            if i >= len(args):
                print("[错误] 请指定要发送的消息")
                return
            once_chat(agents_store, agent_id, args[i])

        elif arg == "--novels":
            novels = workspace_manager.list_novels()
            current = workspace_manager.get_current_novel()
            print(f"\n  所有小说 ({len(novels)}):")
            print(f"  {'─'*40}")
            for n in novels:
                marker = " <<< 当前" if n == current else ""
                print(f"    {n}{marker}")
            print()

        elif arg == "--novel-current":
            current = workspace_manager.get_current_novel()
            print(f"\n  当前小说: {current}\n")

        elif arg == "--novel-create":
            i += 1
            if i >= len(args):
                print("[错误] 请指定小说名称")
                return
            workspace_manager.create_novel(args[i])

        elif arg == "--novel-switch":
            i += 1
            if i >= len(args):
                print("[错误] 请指定小说名称")
                return
            workspace_manager.switch_novel(args[i])

        elif arg == "--novel-rename":
            i += 1
            if i >= len(args):
                print("[错误] 请指定原名称")
                return
            old_name = args[i]
            i += 1
            if i >= len(args):
                print("[错误] 请指定新名称")
                return
            workspace_manager.rename_novel(old_name, args[i])

        elif arg == "--novel-remove":
            i += 1
            if i >= len(args):
                print("[错误] 请指定小说名称")
                return
            workspace_manager.delete_novel(args[i])

        elif arg == "--ws":
            workspace_manager.print_workspace_tree()

        elif arg == "--ws-ls":
            i += 1
            if i >= len(args):
                print("[错误] 请指定工作区名称")
                return
            workspace_name = args[i]
            files = workspace_manager.list_files(workspace_name)
            if not files:
                print(f"  [信息] 工作区「{workspace_name}」为空或不存在")
                continue
            print(f"\n  工作区「{workspace_name}」的文件:")
            print(f"  {'─'*50}")
            for f in files:
                print(f"  {f['name']:<30} {f['size']:>6}B  {f['modified']}")
            print()

        elif arg == "--ws-read":
            i += 1
            if i >= len(args):
                print("[错误] 请指定工作区名称")
                return
            ws_name = args[i]
            i += 1
            if i >= len(args):
                print("[错误] 请指定文件名")
                return
            filename = args[i]
            content = workspace_manager.read_file(ws_name, filename)
            if content is not None:
                print(f"\n  ──  {ws_name}/{filename}  ──")
                print(content)
                if not content.endswith("\n"):
                    print()
                print(f"  ──  结束  ──\n")

        elif arg == "--ws-save":
            i += 1
            if i >= len(args):
                print("[错误] 请指定工作区名称")
                return
            ws_name = args[i]
            i += 1
            if i >= len(args):
                print("[错误] 请指定文件名")
                return
            filename = args[i]
            i += 1
            if i >= len(args):
                print("[错误] 请指定文件内容")
                return
            content = args[i]
            workspace_manager.save_file(ws_name, filename, content)

        elif arg == "--ws-add":
            i += 1
            if i >= len(args):
                print("[错误] 请指定工作区名称")
                return
            ws_name = args[i]
            i += 1
            if i >= len(args):
                print("[错误] 请指定路径")
                return
            ws_path = args[i]
            workspace_manager.add_workspace(ws_name, ws_path)

        elif arg in ("-u", "--update"):
            board_mode = True
            board_updates = {"checkboxes": {}, "fill_text": {}, "fill_lines": {}}
            i += 1
            if i >= len(args):
                print("[错误] 请指定智能体 ID")
                return
            board_target_id = args[i]
            if board_target_id not in board_manager.AGENT_SECTIONS:
                print(f"[错误] 未知的智能体 ID: {board_target_id}")
                print(f"        可用 IDs: {', '.join(board_manager.AGENT_SECTIONS.keys())}")
                return

        elif arg == "--status" and board_mode:
            i += 1
            if i >= len(args):
                print("[错误] 请指定「字段:选项」")
                return
            key, val = parse_key_value(args[i])
            if key:
                board_updates["checkboxes"][key] = val

        elif arg == "--fill" and board_mode:
            i += 1
            if i >= len(args):
                print("[错误] 请指定「字段:值」")
                return
            key, val = parse_key_value(args[i])
            if key:
                if "伏笔记录" in key or "备用创意" in key or "修改意见" in key:
                    board_updates["fill_lines"][key] = val
                else:
                    board_updates["fill_text"][key] = val

        else:
            print(f"[错误] 未知选项: {arg}")
            show_help()
            return

        i += 1

    if board_mode and board_target_id:
        has_updates = any([
            board_updates["checkboxes"],
            board_updates["fill_text"],
            board_updates["fill_lines"],
        ])
        if has_updates:
            board_manager.update_board(board_target_id, board_updates)
        else:
            print("[提示] 未指定更新内容，请使用 --status 或 --fill")


if __name__ == "__main__":
    main()
