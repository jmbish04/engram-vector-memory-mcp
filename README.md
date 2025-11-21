# Engram - Global Memory System

A Cloudflare-based global memory system that provides persistent, semantic memory across AI assistants and sessions using the Model Context Protocol (MCP).

Built by Christian Beaumont (@chrisbe42) - November 2025

## What is Engram?

Engram is a serverless memory system that allows AI assistants to remember information across different sessions, platforms, and providers. Save a memory in Claude Code, recall it in Claude Chat. Save preferences in one session, and every future AI interaction knows about them.

**Key Features:**
- 🌍 **Universal Memory**: Works across all MCP-enabled clients (Claude Code, Claude Chat, Cursor, etc.)
- ⚡ **Edge Performance**: Runs on Cloudflare Workers globally with <50ms latency
- 🔍 **Semantic Search**: Vector-based search using embeddings for intelligent recall
- 🚀 **Async Processing**: Instant responses with background embedding generation
- 💰 **Cost Effective**: Runs on Cloudflare's generous free tier + $5/month for queues

## Architecture

```
┌─────────────────┐
│   MCP Client    │  (Claude Code, Claude Chat, etc.)
│  (save_memory)  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Cloudflare      │
│ Worker (SSE)    │  ← Instant "Ack" response
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Cloudflare      │
│ Queue           │  ← Async processing
└────────┬────────┘
         │
         ▼
    ┌────────────────────┐
    │  Queue Consumer    │
    │  - Generate Vector │
    │  - Store Memory    │
    └─────┬──────────────┘
          │
    ┌─────┴─────┬──────────┐
    ▼           ▼          ▼
┌────────┐ ┌──────────┐ ┌────┐
│Vectorize│ │Workers AI│ │ D1 │
│(Search) │ │(Embedder)│ │(DB)│
└─────────┘ └──────────┘ └────┘
```

## Tech Stack

- **Cloudflare Workers**: Serverless compute at the edge
- **Cloudflare Vectorize**: Vector database for semantic search
- **Cloudflare D1**: SQLite database for metadata and analytics
- **Cloudflare Queues**: Async message processing
- **Cloudflare Workers AI**: BGE-base-en-v1.5 embedding model
- **MCP SDK**: Model Context Protocol for AI tool integration

## Deployment

### Prerequisites

- Cloudflare account with Workers Paid plan ($5/month - required for Queues)
- Node.js and npm installed
- Wrangler CLI (included in project)

### Setup Instructions

1. **Clone and install dependencies:**
```bash
git clone https://github.com/Foundation42/engram.git
cd engram
npm install
```

2. **Login to Cloudflare:**
```bash
npx wrangler login
```

3. **Create infrastructure:**
```bash
# Create D1 database
npx wrangler d1 create memory-db

# Create Vectorize index (768 dimensions for BGE embeddings)
npx wrangler vectorize create memory-index --dimensions=768 --metric=cosine

# Create Queue
npx wrangler queues create memory-ingest
```

4. **Update wrangler.jsonc:**

Replace the `database_id` in `wrangler.jsonc` with the ID from step 3:

```jsonc
{
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "memory-db",
      "database_id": "YOUR_DATABASE_ID_HERE"
    }
  ]
}
```

5. **Initialize database schema:**
```bash
npx wrangler d1 execute memory-db --remote --command "CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  tags TEXT,
  created_at INTEGER NOT NULL,
  source_app TEXT,
  session_id TEXT
);"
```

6. **Deploy:**
```bash
npm run deploy
```

Your memory system will be deployed to: `https://memory-mcp.YOUR-SUBDOMAIN.workers.dev`

## Usage

### MCP Tools

Engram exposes two tools via the Model Context Protocol:

#### 1. `save_memory`

Saves information to your global memory.

**Parameters:**
- `text` (required): The text to remember
- `context_tags` (optional): Array of tags for categorization (e.g., `["coding", "preferences"]`)
- `source_app` (optional): The application this memory came from
- `session_id` (optional): Session identifier

**Example:**
```typescript
save_memory({
  text: "Christian prefers TypeScript over JavaScript for production code",
  context_tags: ["preferences", "coding"],
  source_app: "Claude Code"
})
```

#### 2. `search_memory`

Searches memories using semantic vector search.

**Parameters:**
- `query` (required): What to search for
- `limit` (optional): Number of results (default: 5)
- `filter_tags` (optional): Filter by specific tags

**Example:**
```typescript
search_memory({
  query: "What are Christian's coding preferences?",
  limit: 3
})
```

### Connecting to MCP Clients

#### Claude Code

```bash
claude mcp add --transport sse engram https://memory-mcp.YOUR-SUBDOMAIN.workers.dev/sse
```

#### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "engram": {
      "transport": {
        "type": "sse",
        "url": "https://memory-mcp.YOUR-SUBDOMAIN.workers.dev/sse"
      }
    }
  }
}
```

#### Other MCP Clients

Use the SSE endpoint: `https://memory-mcp.YOUR-SUBDOMAIN.workers.dev/sse`

## Development

### Local Development

```bash
npm run dev
```

This starts a local development server with hot reload.

### View Logs

```bash
npx wrangler tail --format pretty
```

### Query D1 Database

```bash
# Local
npx wrangler d1 execute memory-db --command "SELECT * FROM memories LIMIT 10;"

# Remote
npx wrangler d1 execute memory-db --remote --command "SELECT * FROM memories LIMIT 10;"
```

## Memory Structure

Each memory is stored with:

**Vectorize (for semantic search):**
- `id`: UUID
- `values`: 768-dimensional embedding vector
- `metadata`:
  - `text`: The memory content
  - `tags`: JSON array of tags
  - `created_at`: ISO timestamp
  - `source_app`: Where it came from
  - `session_id`: Session identifier

**D1 Database (for analytics):**
- `id`: UUID
- `text`: The memory content
- `tags`: JSON string
- `created_at`: Unix timestamp
- `source_app`: Application name
- `session_id`: Session identifier

## Memory Curator

Engram includes an **autonomous Memory Curator** that runs daily to keep your memories clean and efficient.

### What it does:

- **Runs daily at 2 AM UTC** via Cloudflare Cron Triggers
- **Detects duplicates** using vector similarity (>0.95 similarity score)
- **Intelligently consolidates** similar memories using Llama 3.3 70B
- **Preserves important information** while removing redundancy
- **Updates both D1 and Vectorize** with consolidated memories
- **Processes up to 10 groups per run** to avoid timeouts

### How it works:

```
1. Query all memories from D1
2. For each memory, search Vectorize for similar ones
3. Group memories with >95% similarity
4. Use LLM to create consolidated version
5. Update original memory with consolidated text
6. Delete duplicate memories
7. Log consolidation results
```

The curator uses **Llama 3.3 70B Instruct** to intelligently merge memories, ensuring no information is lost while reducing noise and redundancy.

## Future Enhancements

Potential features to add:

- **Memory Decay**: Age out old, unaccessed memories
- **Analytics Dashboard**: Visualize memory patterns over time
- **Advanced Filtering**: Complex queries by date range, source, etc.
- **Memory Export**: Bulk export functionality
- **Memory Synthesis**: Create higher-level summary memories from clusters
- **Access Control**: Multi-user support with permissions
- **Plugin Architecture**: Unified search interface for web, APIs, databases

## Cost Estimation

Based on moderate usage (100 memories/day):

- **Workers**: Free tier (100k requests/day)
- **Vectorize**: Free tier (10M queries/month)
- **D1**: Free tier (5GB storage)
- **Workers AI**: Free tier (10k requests/day)
- **Queues**: $5/month (Workers Paid plan required)

**Total: ~$5/month**

## Licensing

This project uses a dual licensing model:

- **MIT License** - Free for individuals, education, and community projects
- **Commercial License** - For proprietary or revenue-generating use

If your organization uses Engram in a product, service, or platform, please reach out: **license@foundation42.org**

See [LICENSE](LICENSE) and [LICENSE-MIT](LICENSE-MIT) for details.

## Author

Built by **Christian Beaumont** (@chrisbe42)
Founder, Entrained AI Research Institute
Liversedge, West Yorkshire, UK

## Links

- GitHub: https://github.com/Foundation42/engram
- Cloudflare Workers: https://workers.cloudflare.com
- Model Context Protocol: https://modelcontextprotocol.io

---

*"An engram is a unit of cognitive information imprinted in a physical substance, theorized to be the means by which memories are stored."* 
