#!/usr/bin/env python3
"""PreToolUse guard for the Bash tool: block commands that publish anything outside this machine.

This is a speed bump, not a security boundary. The real boundary is: the only remote is a
private backup repo, the git pre-push hook refuses without ALLOW_PUSH=1, and the user pushes.

Reads the hook JSON on stdin, inspects tool_input.command, exits 2 (block, stderr goes to
Claude) when a publishing command is found. Any parse problem also blocks (fail closed).
"""
from __future__ import annotations

import json
import re
import shlex
import sys

OPERATORS = {";", "&&", "||", "|", "&", "|&", ";;", "(", ")"}
WRAPPERS = {"sudo", "command", "env", "time", "nohup", "exec", "xargs", "builtin"}
WRAPPER_OPTS_WITH_ARG = {"-u", "-g", "-C", "-h", "-p", "-U", "-r", "-t", "-D", "-I", "-n", "-s", "-L", "-P"}  # sudo/xargs/env options that take a value
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


def strip_prefix(tokens: list[str]) -> list[str]:
    """Drop VAR=value assignments and wrapper commands in front of the real command."""
    i = 0
    while i < len(tokens):
        t = tokens[i]
        if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*=.*", t):
            i += 1
        elif t in WRAPPERS:
            i += 1
            while i < len(tokens) and tokens[i].startswith("-"):
                takes_arg = tokens[i] in WRAPPER_OPTS_WITH_ARG
                i += 2 if takes_arg else 1
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

    # shell -c "..." and eval "...": recurse into the inner script
    if prog in SHELLS and "-c" in args and depth < 3:
        idx = args.index("-c")
        if idx + 1 < len(args):
            check_command(args[idx + 1], depth + 1)
        return
    if prog == "eval" and depth < 3:
        check_command(" ".join(args), depth + 1)
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
        if len(args) >= 2 and args[0] == "repo" and args[1] in {"create", "fork", "edit", "rename", "delete", "archive"}:
            block(f"gh repo {args[1]}")
        if len(args) >= 2 and args[0] in {"gist", "pr", "release", "issue"} and args[1] in {"create", "edit", "delete", "merge", "upload"}:
            block(f"gh {args[0]} {args[1]}")
        if args and args[0] == "api":
            method = None
            for j, a in enumerate(args):
                if a in {"-X", "--method"} and j + 1 < len(args):
                    method = args[j + 1].upper()
                elif a.startswith("--method="):
                    method = a.split("=", 1)[1].upper()
                elif a.startswith("-X") and len(a) > 2:
                    method = a[2:].upper()
            has_fields = any(a in {"-f", "-F", "--field", "--raw-field", "--input"} for a in args)
            if method in GH_API_WRITE or (method is None and has_fields):
                block("gh api write request")
    elif prog in {"npm", "pnpm", "yarn", "bun"} and "publish" in args:
        block(f"{prog} publish")
    elif prog == "gh-pages" or (prog in {"npx", "bunx"} and args and args[0].startswith("gh-pages")):
        block("gh-pages deploy")


def check_command(command: str, depth: int = 0) -> None:
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
