---
alwaysApply: false
---

libs/frameworks/APIs: use Context7 MCP, fetch current docs not training data. setup, codegen, API refs, specific packages.

## Steps

1. Call `resolve-library-id` with lib name + user question
2. Pick best match — prefer exact names, version-specific IDs when version mentioned
3. Call `query-docs` with selected lib ID + user question
4. Answer from fetched docs — include code examples, cite version