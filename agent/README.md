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

| Variable          | Required | Default                       |
|-------------------|----------|-------------------------------|
| `OPENAI_API_KEY`  | yes      |                               |
| `OPENAI_MODEL`    | yes      |                               |
| `OPENAI_BASE_URL` | no       | OpenAI API                    |
| `MCP_URL`         | no       | `http://localhost:8787/mcp`   |

## Run

```sh
# terminal 1
cd apps/worker && npx wrangler dev

# terminal 2
cd agent && uv run agent.py
```

Example prompt: `Is 10.0.0.0/8 routable, and how many usable hosts does it have?`
