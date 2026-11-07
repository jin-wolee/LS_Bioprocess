#!/usr/bin/env python3
"""PreToolUse guard for the Bash tool: block commands that publish anything outside this machine.

The guard is a local safety control; the author alone approves and performs publishing.
Git hooks and repository permissions provide additional layers.

Reads the hook JSON on stdin, inspects tool_input.command, exits 2 (block, stderr goes to
Claude) when a publishing command is found. Any parse problem also blocks (fail closed).
"""
from __future__ import annotations

import json
import os
import re
import shlex
import sys

OPERATORS = {";", "&&", "||", "|", "&", "|&", ";;", "(", ")"}
KEYWORDS = {"{", "}", "if", "then", "else", "elif", "do", "while", "until", "!"}
# Each wrapper has its own flag and value-taking options. Unknown options are
# refused: guessing their arity can hide the command being inspected.
WRAPPER_OPTIONS = {
    # wrapper: (short flags, short options with values, long flags, long options with values)
    "sudo": ("AbEHknPSv", "CDghpRTUu", {"--background", "--preserve-env", "--non-interactive", "--stdin"}, {"--chdir", "--close-from", "--group", "--host", "--prompt", "--user"}),
    "command": ("p", "", set(), set()),
    "env": ("i0v", "Cu", {"--ignore-environment", "--null", "--debug"}, {"--chdir", "--unset"}),
    "time": ("apqv", "fo", {"--append", "--portability", "--quiet", "--verbose"}, {"--format", "--output"}),
    "nohup": ("", "", set(), set()),
    "exec": ("cl", "a", set(), set()),
    "xargs": ("0oprtx", "adEILnPs", {"--null", "--open-tty", "--interactive", "--no-run-if-empty", "--verbose", "--exit"}, {"--arg-file", "--delimiter", "--eof", "--replace", "--max-lines", "--max-args", "--max-procs", "--max-chars"}),
    "builtin": ("", "", set(), set()),
    "nice": ("", "n", set(), {"--adjustment"}),
    "timeout": ("v", "ks", {"--foreground", "--preserve-status", "--verbose"}, {"--kill-after", "--signal"}),
    "watch": ("bcdegptx", "n", {"--beep", "--color", "--differences", "--errexit", "--chgexit", "--precise", "--no-title", "--exec"}, {"--interval"}),
    "stdbuf": ("", "eio", set(), {"--error", "--input", "--output"}),
}
SHELLS = {"bash", "sh", "zsh", "dash"}
GIT_OPTS_WITH_ARG = {"-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path"}
GH_API_WRITE = {"POST", "PUT", "PATCH", "DELETE"}


def block(reason: str) -> None:
    sys.stderr.write(
        f"BLOCKED by guard_bash: {reason}\n"
        "Publishing (push, remote changes, repo/gist/PR creation, npm publish, gh-pages) is done by the user, "
        "not by Claude. Tell the user the exact command to run with the `!` prefix instead.\n"
    )
    sys.exit(2)


def wrapper_command_index(tokens: list[str], i: int, wrapper: str) -> int:
    """Find the command after a wrapper's understood options and operands."""
    flags, valued, long_flags, long_valued = WRAPPER_OPTIONS[wrapper]
    while i < len(tokens) and tokens[i].startswith("-") and tokens[i] != "-":
        option = tokens[i]
        i += 1
        if option == "--":
            break
        if option.startswith("--"):
            name, equals, value = option.partition("=")
            if name in long_flags and not equals:
                continue
            if name not in long_valued or (equals and not value):
                block(f"uninspectable {wrapper} option")
            if not equals:
                if i >= len(tokens) or not tokens[i]:
                    block(f"missing {wrapper} option value")
                i += 1
        else:
            for pos, char in enumerate(option[1:], 1):
                if char in valued:
                    if not option[pos + 1:]:
                        if i >= len(tokens) or not tokens[i]:
                            block(f"missing {wrapper} option value")
                        i += 1
                    break
                if char not in flags:
                    block(f"uninspectable {wrapper} option")
    if wrapper == "env":
        if i < len(tokens) and tokens[i] == "-":
            i += 1  # env's historical alias for --ignore-environment
        while i < len(tokens) and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*=.*", tokens[i]):
            i += 1
        if i < len(tokens) and tokens[i].startswith("-"):
            block("uninspectable env command or option position")
    if wrapper == "timeout":
        if i >= len(tokens) or not re.fullmatch(r"(?:\d+(?:\.\d*)?|\.\d+)[smhd]?", tokens[i]):
            block("uninspectable timeout duration")
        i += 1
    return i


def strip_prefix(tokens: list[str]) -> list[str]:
    """Drop VAR=value assignments and wrapper commands in front of the real command."""
    i = 0
    while i < len(tokens):
        t = tokens[i]
        if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*=.*", t):
            i += 1
        elif t in KEYWORDS:
            i += 1
        elif os.path.basename(t) in WRAPPER_OPTIONS:
            wrapper = os.path.basename(t)
            i = wrapper_command_index(tokens, i + 1, wrapper)
        else:
            break
    return tokens[i:]


def git_subcommand(args: list[str]) -> tuple[str | None, list[str]]:
    i = 0
    while i < len(args):
        a = args[i]
        if a in GIT_OPTS_WITH_ARG:
            i += 2
        elif a.startswith("-"):
            i += 1
        else:
            return a, args[i + 1:]
    return None, []


def first_operand(args: list[str]) -> str:
    """First argument that is not an option, so `npx --yes gh-pages` is seen as running gh-pages."""
    return next((a for a in args if not a.startswith("-")), "")


def newlines_to_semicolons(command: str) -> str:
    """Treat unquoted newlines as command separators (shlex would treat them as spaces)."""
    out, quote, escape = [], None, False
    for ch in command:
        if escape:
            out.append(ch)
            escape = False
        elif ch == "\\" and quote != "'":
            out.append(ch)
            escape = True
        elif quote:
            out.append(ch)
            if ch == quote:
                quote = None
        elif ch in "'\"":
            out.append(ch)
            quote = ch
        elif ch == "\n":
            out.append(" ; ")
        else:
            out.append(ch)
    return "".join(out)


def segments(command: str) -> list[list[str]]:
    lexer = shlex.shlex(newlines_to_semicolons(command), posix=True, punctuation_chars=True)
    lexer.whitespace_split = True
    try:
        tokens = list(lexer)
    except ValueError as e:
        block(f"could not parse command ({e}); refusing to guess")
    segs, cur = [], []
    for t in tokens:
        if t in OPERATORS:
            segs.append(cur)
            cur = []
        else:
            cur.append(t.lstrip("$") if t.startswith("$(") else t)
    segs.append(cur)
    return [s for s in segs if s]


def check_segment(tokens: list[str], depth: int = 0) -> None:
    tokens = strip_prefix(tokens)
    if not tokens:
        return
    prog = tokens[0].rsplit("/", 1)[-1]
    args = tokens[1:]

    # Inspect shell scripts recursively; an uninspectable depth is refused.
    shell_c = next((j for j, a in enumerate(args)
                    if re.fullmatch(r"-[a-zA-Z]*c[a-zA-Z]*", a)), None)
    if (prog in SHELLS and shell_c is not None) or prog == "eval":
        if depth >= 3:
            block("nested shell limit reached")
        if prog == "eval":
            check_command(" ".join(args), depth + 1)
        elif shell_c + 1 < len(args):
            check_command(args[shell_c + 1], depth + 1)
        else:
            block("missing shell command")
        return

    if prog == "git":
        sub, rest = git_subcommand(args)
        if sub == "push":
            block("git push")
        if sub == "remote" and rest and rest[0] in {"add", "set-url", "rename"}:
            block(f"git remote {rest[0]}")
        if sub == "subtree" and "push" in rest:
            block("git subtree push")
    elif prog == "gh":
        if args and args[0] == "api":
            method = "GET"
            for j, arg in enumerate(args[1:], 1):
                if arg in {"-X", "--method"}:
                    if j + 1 >= len(args):
                        block("missing API method")
                    method = args[j + 1].upper()
                elif arg.startswith("--method="):
                    method = arg.split("=", 1)[1].upper()
                elif arg.startswith("-X") and len(arg) > 2:
                    method = arg[2:].lstrip("=").upper()
            if method != "GET" or any(arg.startswith(("-f", "-F", "--field", "--raw-field", "--input")) for arg in args[1:]):
                block("gh API request is not read-only")
        elif not (args and (args[0] in {"status", "browse"} or
                 len(args) >= 2 and args[0] in {"repo", "issue", "pr", "release", "run", "workflow", "gist", "label"} and args[1] in {"view", "list", "status", "diff", "checks", "browse"})):
            block("gh command is not on the read-only list")
    elif prog in {"curl", "wget"} and any(re.search(r"(?i)(?:api|uploads)\.github\.com(?:[:/]|$)", a) for a in args):
        for j, arg in enumerate(args):
            if arg.startswith(("-d", "--data", "--json", "-F", "--form", "--upload-file", "-T", "--post-", "--body-")):
                block("GitHub request carries data")
            if arg in {"-X", "--request", "--method"}:
                if j + 1 >= len(args) or args[j + 1].upper() != "GET":
                    block("GitHub request is not GET")
            elif arg.startswith(("--request=", "--method=")) and arg.split("=", 1)[1].upper() != "GET":
                block("GitHub request is not GET")
            elif arg.startswith("-X") and len(arg) > 2 and arg[2:].lstrip("=").upper() != "GET":
                block("GitHub request is not GET")
    elif prog in {"npm", "pnpm", "yarn", "bun"} and "publish" in args:
        block(f"{prog} publish")
    elif prog == "gh-pages" or (prog in {"npx", "bunx"} and first_operand(args).startswith("gh-pages")):
        block("gh-pages deploy")


def check_command(command: str, depth: int = 0) -> None:
    if "ALLOW_PUSH" in command:
        block("authorization variable in command; search using the Grep tool and use git commit -F for messages")
    if re.search(r"(?i)core\.hookspath", command) or "--no-verify" in command:
        block("git hook bypass option")
    for seg in segments(command):
        check_segment(seg, depth)


def main() -> None:
    try:
        data = json.load(sys.stdin)
        command = data.get("tool_input", {}).get("command", "")
    except Exception as e:  # malformed input: fail closed
        block(f"unreadable hook input ({e})")
    if not isinstance(command, str):
        block("command is not a string")
    check_command(command)
    sys.exit(0)


if __name__ == "__main__":
    main()
