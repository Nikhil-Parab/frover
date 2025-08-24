# RAG Agent - Meeting Intelligence System

Smart meeting memory that finds discussions and connects related topics across all your meetings using AI.

## Environment Setup

Create a `.env` file:(make the file in rag-agent-pinecone folder)

```
PINECONE_API_KEY=your-pinecone-api-key
PINECONE_ENVIRONMENT=us-east-1-aws
PINECONE_INDEX_NAME=conversation-history
PINECONE_INDEX_URL=your-pinecone-index-url
OPENAI_API_KEY=your-openai-api-key
```

## How to Run

**Start local dev server:**

```bash
npx wrangler dev --local
```

**Deploy live:**

```bash
npx wrangler deploy
```

## Basic Usage

**Create content:**

```powershell
Invoke-WebRequest -Uri "https://rag-agent-pinecone.loopie23.workers.dev/brain/create" `
-Method POST `
-Headers @{ "Content-Type" = "application/json" } `
-Body (@{
    id      = "meeting-notes-1"
    content = "Team discussed Q4 budget allocation. Decided to increase marketing spend by 20%. Action item: John to prepare detailed breakdown by Friday."
    type    = "text"
} | ConvertTo-Json -Depth 3)
```

**Query content:**

```powershell
Invoke-WebRequest -Uri "https://rag-agent-pinecone.loopie23.workers.dev/brain/query" `
-Method POST `
-Headers @{ "Content-Type" = "application/json" } `
-Body (@{
    query = "What was decided about the budget?"
    top_k = 3
} | ConvertTo-Json -Depth 3)
```
