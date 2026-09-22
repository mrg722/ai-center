# AI Command Center

Web-based multi-agent command center for coordinating Claude, GPT/Codex, Gemini, future cloud APIs, MCP tools, and optional local agents from one moderated workspace.

## Core architecture

Web App -> Orchestrator -> Agent Bridges / Providers -> GitHub + Supabase

GitHub is the source of truth for project code and version history. Supabase/PostgreSQL stores operational state, tasks, messages, approvals, context, and agent sessions.

## Initial roles

- Claude: primary builder and heavy implementation.
- GPT/Codex: auditor, fixer, integrator, commit/push agent when authorized.
- Gemini: optional research and second opinion.
- Human: moderator with approval, pause, cancel, routing, and permission control.

## Project

This repository is the platform itself. Projects such as District Fury are registered as separate GitHub repositories and connected to the Command Center.

## Documents

The technical specification and implementation prompts are maintained in the repository documentation.