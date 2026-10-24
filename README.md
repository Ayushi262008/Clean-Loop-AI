# Clean Loop AI

AI-powered waste management platform for HackIndia (Problem Statement 4). Citizens report waste, request pickups and track complaints. AI triages each complaint (text and photo). Admins see hotspots and an AI weekly action plan.

## Run
```
npm install
cp .env.example .env     # add ANTHROPIC_API_KEY for Claude; works without it using rule-based fallback
npm start                # http://localhost:3000
```
Admin login: contact `admin@cleanloop.ai`, password `admin123` (change in `.env`).

## Stack
Node.js + Express, SQLite (better-sqlite3), JWT + bcrypt auth, Claude API (vision + text), vanilla JS frontend, Leaflet hotspot map.

## Core features and where they live
| Feature | Code |
|---|---|
| Registration and login | `/api/auth/*` |
| Report waste issues (photo, GPS, AI triage) | `POST /api/reports` |
| Waste pickup request | `/api/pickups` |
| Complaint tracking with history | `GET /api/reports/:id` |
| Admin dashboard (stats, map, queue, AI plan) | `/api/admin/*` |
| Waste awareness (AI segregation coach, Hindi/Hinglish/English) | `POST /api/awareness/ask` |
| Eco points and leaderboard | `/api/leaderboard` |

## Architecture
Citizen app -> Express API -> SQLite. The API calls Claude to classify complaints and answer awareness questions, and falls back to keyword rules if the AI is unavailable. Admin status changes write to a history table, which citizens see as a timeline.

## Future scope
WhatsApp bot, bin-fill IoT sensors, route optimisation, overflow prediction from history, push notifications, multi-city tenants, Postgres for production.
