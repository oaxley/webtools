# agent

Minimal Python chat agent for testing the webtools MCP server
(`apps/worker/src/routes/mcp.ts`). It uses the FastMCP client and an
OpenAI-compatible LLM, and prints every tool call and result.

## Setup

```sh
cd agent
uv sync
```

## Configuration

| Variable             | Required | Default                       |
|----------------------|----------|-------------------------------|
| `OPENAI_API_KEY`     | yes      |                               |
| `OPENAI_MODEL`       | yes      |                               |
| `OPENAI_BASE_URL`    | no       | OpenAI API                    |
| `MCP_URL`            | no       | `http://localhost:8787/mcp`   |
| `AGENT_HISTORY_FILE` | no       | `~/.webtools_agent_history`   |

## Run

```sh
# terminal 1
cd apps/worker && npx wrangler dev

# terminal 2
cd agent && uv run agent.py
```

## Prompt history

Use **Up** and **Down** at the `you>` prompt to browse your previous
prompts. **Ctrl-R** searches them, and the usual readline line editing
works too.

- History is saved to `AGENT_HISTORY_FILE` (default
  `~/.webtools_agent_history`) when the agent exits, so it's still there
  in the next session. It keeps the last 1000 prompts.
- Empty lines, `exit`/`quit` and back-to-back repeats aren't recorded.
- A prompt is recorded even if it fails (e.g. a mistyped `@file` path),
  so you can recall it and fix it.
- Prompts are saved as typed, so `@file` references are stored, not file
  contents. Anything you paste inline (e.g. a real token) does end up in
  the history file.
- Needs Python's `readline` module (Linux/macOS). Without it, the agent
  still works but has no history.

## Attaching local files

Instead of pasting a certificate or token into the prompt, reference a file
with `@`:

```text
you> Who issued @./certs/server.pem and when does it expire?
you> Decode @~/tokens/id_token.jwt
you> Compare @"/tmp/my certs/a.pem" with @/tmp/b.der
```

- Use `@"..."` for paths containing spaces; `~` is expanded.
- The agent reads the file into memory and the LLM only sees the `@...`
  reference. When the LLM passes that reference as a tool argument, the
  agent swaps in the file content right before the MCP call. The file
  content never goes through the LLM, so it costs no tokens.
- Text files are sent as-is. Binary files (e.g. a DER certificate) are
  sent base64-encoded, which `decode_x509` accepts.
- Files are limited to 1 MiB. A missing file is reported immediately and
  the prompt isn't sent.
- References stay valid for the whole session, so follow-up questions
  can reuse them.
- Only a tool argument that is exactly the reference gets replaced. A
  reference inside a longer string is left alone.

## Example prompts

- `Is 10.0.0.0/8 routable, and how many usable hosts does it have?`
- `Decode this JWT and tell me when it expires: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c`
- `Who issued this certificate, which hostnames does it cover, and when does it expire?` followed by a pasted PEM block
