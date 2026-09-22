#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
set -a; source "$ROOT/.secrets/penpot.env"; set +a
MCP_JSON="${HOME}/.cursor/mcp.json"
if [[ -L "$MCP_JSON" ]]; then
  MCP_JSON="$(readlink -f "$MCP_JSON")"
fi
python3 - "$MCP_JSON" <<'PY'
import json, os, sys
from pathlib import Path
p = Path(sys.argv[1])
cfg = json.loads(p.read_text()) if p.exists() else {"mcpServers": {}}
tok = os.environ["PENPOT_MCP_TOKEN"]
cfg.setdefault("mcpServers", {})["penpot"] = {
    "url": f"http://192.168.1.104:9001/mcp/stream?userToken={tok}",
    "timeout": 120000,
}
p.write_text(json.dumps(cfg, indent=2) + "\n")
print(f"Updated {p}")
PY
mkdir -p "$HOME/.config/penpot"
umask 077
cp "$ROOT/.secrets/penpot.env" "$HOME/.config/penpot/mcp.env"
chmod 600 "$HOME/.config/penpot/mcp.env"
echo "Done. Reload Cursor MCP (or restart Cursor), then in Penpot: File → MCP Server → Connect"
