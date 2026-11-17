import { describe, expect, it } from "vite-plus/test";

import {
  codexTable,
  configPaths,
  editClaudeConfig,
  editCodexConfig,
  stopProcessesScript,
} from "./ToolServers.ts";

const target = {
  exe: String.raw`C:\Users\O'Brien\AppData\Local\Programs\t3code\T3 Code (Nightly).exe`,
  home: String.raw`C:\Users\O'Brien\.t3\t3mode`,
};
const server = {
  id: "computer-use",
  script: String.raw`${target.home}\plugins\computer-use\mcp.cjs`,
};
const other = { exe: target.exe, home: String.raw`D:\dev\t3mode\.sandbox\home` };

describe("editCodexConfig", () => {
  const user = [
    'model = "gpt-5"',
    "",
    "[mcp_servers.playwright]",
    'command = "npx"',
    "args = []",
    "startup_timeout_sec = 120",
    "",
    "[projects.'D:\\src']",
    'trust_level = "trusted"',
  ].join("\r\n");

  it("adds a table with escaped paths, keeping CRLF and the missing final newline", () => {
    const added = editCodexConfig(user, target, [server]);
    expect(added.text).toBe([user, "", ...codexTable(target, server)].join("\r\n"));
    expect(added.text).toContain(
      String.raw`command = "C:\\Users\\O'Brien\\AppData\\Local\\Programs\\t3code\\T3 Code (Nightly).exe"`,
    );
  });

  it("gives the file back byte for byte when the plugin goes away", () => {
    for (const text of [user, `${user}\r\n`, "", 'model = "x"\n', "[a]\nb = 1\n\n\n[c]\n"]) {
      const added = editCodexConfig(text, target, [server]).text!;
      const back = editCodexConfig(added, target, []);
      expect(back.text, JSON.stringify(text)).toBe(text);
      expect(back.removed).toEqual(["computer-use"]);
    }
  });

  it("removes a table from the middle, with its subtables, and keeps the spacing around it", () => {
    const text = [
      "[a]",
      "",
      "[mcp_servers.t3mode-computer-use]",
      'command = "x"',
      "",
      "[mcp_servers.t3mode-computer-use.env]",
      `T3MODE_HOME = ${JSON.stringify(target.home)}`,
      "",
      "[b]",
      "",
    ].join("\n");
    expect(editCodexConfig(text, target, []).text).toBe("[a]\n\n[b]\n");
  });

  it("is a no-op when the table is already right", () => {
    const added = editCodexConfig(user, target, [server]).text!;
    expect(editCodexConfig(added, target, [server])).toEqual({
      text: undefined,
      removed: [],
      conflicts: [],
    });
  });

  it("rewrites its own table when the exe moved", () => {
    const added = editCodexConfig(user, target, [server]).text!;
    const moved = { ...target, exe: String.raw`D:\T3\T3 Code.exe` };
    const next = editCodexConfig(added, moved, [server]);
    expect(next.text).toBe([user, "", ...codexTable(moved, server)].join("\r\n"));
    expect(next.removed).toEqual([]);
  });

  it("leaves another home's entry and the user's own alone, and reports the name as taken", () => {
    const sandbox = editCodexConfig(user, other, [server]).text!;
    const result = editCodexConfig(sandbox, target, [server]);
    expect(result).toEqual({ text: undefined, removed: [], conflicts: ["computer-use"] });
    expect(editCodexConfig(sandbox, target, []).text).toBeUndefined();

    for (const taken of [
      '[mcp_servers]\n"t3mode-computer-use" = { command = "mine" }\n',
      'mcp_servers.t3mode-computer-use.command = "mine"\n',
      '[mcp_servers."t3mode-computer-use"]\ncommand = "mine"\n',
    ]) {
      expect(editCodexConfig(taken, target, [server]), taken).toEqual({
        text: undefined,
        removed: [],
        conflicts: ["computer-use"],
      });
    }
  });

  it("finds its marker after Codex rewrote the table with a quoted name and an env subtable", () => {
    const reshaped = [
      '[mcp_servers."t3mode-computer-use"]',
      `command = ${JSON.stringify(target.exe)}`,
      `args = [${JSON.stringify(server.script)}]`,
      "",
      '[mcp_servers."t3mode-computer-use".env]',
      'ELECTRON_RUN_AS_NODE = "1"',
      `T3MODE_HOME = ${JSON.stringify(target.home.toUpperCase())}`,
      "",
    ].join("\n");
    expect(editCodexConfig(reshaped, target, [])).toEqual({
      text: "",
      removed: ["computer-use"],
      conflicts: [],
    });
    expect(editCodexConfig(reshaped, target, [server]).text).toBe(
      `${codexTable(target, server).join("\n")}\n`,
    );
  });
});

describe("editClaudeConfig", () => {
  const user = JSON.stringify(
    {
      numStartups: 4,
      mcpServers: { playwright: { type: "stdio", command: "npx", args: [] } },
      projects: { "D:/src": { allowedTools: [] } },
    },
    null,
    2,
  );

  it("adds an entry, then removes it, giving the file back", () => {
    const added = editClaudeConfig(`${user}\n`, target, [server])!;
    const config = JSON.parse(added.text!);
    expect(Object.keys(config)).toEqual(["numStartups", "mcpServers", "projects"]);
    expect(config.mcpServers["t3mode-computer-use"]).toEqual({
      type: "stdio",
      command: target.exe,
      args: [server.script],
      env: { ELECTRON_RUN_AS_NODE: "1", T3MODE_HOME: target.home },
    });
    expect(editClaudeConfig(added.text!, target, [server])!.text).toBeUndefined();
    const back = editClaudeConfig(added.text!, target, [])!;
    expect(back.text).toBe(`${user}\n`);
    expect(back.removed).toEqual(["computer-use"]);
  });

  it("creates mcpServers only when there is something to add", () => {
    expect(editClaudeConfig('{"a":1}', target, [])!.text).toBeUndefined();
    expect(JSON.parse(editClaudeConfig('{"a":1}', target, [server])!.text!).a).toBe(1);
  });

  it("leaves another home's entry and the user's own alone", () => {
    const sandbox = editClaudeConfig(user, other, [server])!.text!;
    expect(editClaudeConfig(sandbox, target, [server])).toEqual({
      text: undefined,
      removed: [],
      conflicts: ["computer-use"],
    });
    expect(editClaudeConfig(sandbox, target, [])!.text).toBeUndefined();
  });

  it("refuses text that isn't a JSON object", () => {
    for (const text of ["", "{ not json", "[]", '{"mcpServers": []}']) {
      expect(editClaudeConfig(text, target, [server]), text).toBeUndefined();
    }
  });
});

describe("stopProcessesScript", () => {
  it("quotes paths for PowerShell and matches folders with a trailing backslash", () => {
    const script = stopProcessesScript(target.exe, [
      String.raw`${target.home}\plugins\computer-use`,
    ]);
    expect(script).toContain(
      String.raw`$exe = 'C:\Users\O''Brien\AppData\Local\Programs\t3code\T3 Code (Nightly).exe'`,
    );
    expect(script).toContain(
      String.raw`$folders = @('C:\Users\O''Brien\.t3\t3mode\plugins\computer-use\')`,
    );
    expect(script).toContain("$p.ProcessId -ne $PID");
  });
});

const join = (...parts: ReadonlyArray<string>) => parts.join("\\");

describe("configPaths", () => {
  it("honors CLAUDE_CONFIG_DIR and CODEX_HOME", () => {
    expect(configPaths({}, "C:\\Users\\me", join)).toEqual({
      claude: "C:\\Users\\me\\.claude.json",
      codex: "C:\\Users\\me\\.codex\\config.toml",
    });
    expect(configPaths({ CLAUDE_CONFIG_DIR: "D:\\c", CODEX_HOME: "D:\\x" }, "C:\\u", join)).toEqual(
      {
        claude: "D:\\c\\.claude.json",
        codex: "D:\\x\\config.toml",
      },
    );
  });
});
