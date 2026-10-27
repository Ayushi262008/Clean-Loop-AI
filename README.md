# EcoTrack — Intelligent Waste Management System

An AI-powered municipal & campus waste management platform designed for rapid civic reporting, automated AI triage, geolocated collection routing, doorstep pickup scheduling, and gamified citizen education.

---

## 🌟 Key Features

1. **Executive Dashboard (Green & White Theme)**:
   - High-contrast accessible design with dark mode support.
   - Real-time complaint statistics with animated counters.
   - Live **Recent Waste Reports** community feed.
   - Quick action shortcuts for reporting, pickups, tracking, and learning.
   - Interactive 4-step circular loop process visualization.
   - Citizen Eco-Leaderboard with points & badges.

2. **Smart Waste Reporting Wizard**:
   - 3-step accessible flow: Category & Location $\rightarrow$ Description & Voice Input $\rightarrow$ Photo & AI Triage.
   - Web Speech API integration supporting voice recording in both **Hindi** (`hi-IN`) and **English** (`en-IN`).
   - One-tap HTML5 GPS location auto-detection.
   - Photo upload zone with drag-and-drop and instant preview.
   - Multimodal AI Triage (Claude Vision / Regex rules fallback) outputting category, priority rating (`High`/`Medium`/`Low`), safety tips, and +10 eco points.

3. **Doorstep Waste Pickup Scheduling**:
   - Select categories: Household Dry, Kitchen/Organic, Bulk/Garden, E-Waste, Construction Debris.
   - Date picker, address locator, and personal tracking queue with live status badges (`Scheduled`, `In Transit`, `Completed`).

4. **Complaint Tracking & Audit Trail**:
   - Real-time 3-stage visual progress stepper (`Reported` $\rightarrow$ `Crew Assigned` $\rightarrow$ `Resolved`).
   - Detailed event timeline with timestamps, crew notes, and uploaded photos.
   - Instant search & filter bar.

5. **Gamified Waste Awareness & AI Coach**:
   - **Interactive Waste Sorting Game**: Drag-and-drop or tap to sort items into 4 colored bins (Green = Organic, Blue = Recyclable, Red = Hazardous, Gray = E-Waste) with streak counter and confetti.
   - **AI Segregation Assistant**: Multi-language Q&A (English, Hindi, Hinglish) with quick suggestion chips.

6. **Municipal Admin Command Center**:
   - Interactive Leaflet OpenStreetMap hotspot map showing high-priority clusters.
   - Ward and waste category distribution bar charts.
   - Priority Triage Queue with 1-click status transitions (`Assign Crew`, `Mark Resolved`).
   - AI Weekly Action Plan generator.

---

## 🚀 Quick Start

```bash
cd clean-loop-ai
npm install
cp .env.example .env     # Optional: add ANTHROPIC_API_KEY for Claude; falls back to regex rules if omitted
npm start                # Server starts on http://localhost:3000
```

### Pre-Configured Demo Accounts (Auto-Seeded):
- **Admin**: `admin@cleanloop.ai` / `admin123`
- **Citizen**: `priya@ecotrack.org` / `demo123`

---

## 🏗️ Architecture & Technology Stack

- **Frontend**: Vanilla JavaScript (SPA), HTML5, CSS3 Variables, Leaflet.js, Web Speech API.
- **Backend**: Node.js, Express REST API, JWT Authentication, bcryptjs.
- **Database**: SQLite via `better-sqlite3` with indexed foreign keys and audit history.
- **AI Intelligence**: Anthropic Claude Messages API (multimodal vision + text) with a resilient rule-based keyword fallback engine.

---

## 🔌 API Reference

| Endpoint | Method | Role | Description |
|---|---|---|---|
| `/api/auth/register` | `POST` | Public | Create citizen account |
| `/api/auth/login` | `POST` | Public | Authenticate user or admin |
| `/api/me` | `GET` | Auth | Current user profile & points |
| `/api/public-stats` | `GET` | Public | Real-time complaint counters |
| `/api/reports/recent` | `GET` | Public | Latest 6 community reports |
| `/api/reports` | `POST` | Auth | Submit complaint with photo & AI triage |
| `/api/reports/mine` | `GET` | Auth | Citizen reports with nested history |
| `/api/reports/:id` | `GET` | Auth | Report details & timeline |
| `/api/pickups` | `POST` | Auth | Book scheduled collection |
| `/api/pickups/mine` | `GET` | Auth | Citizen's pickup requests |
| `/api/leaderboard` | `GET` | Public | Top 10 citizens by points |
| `/api/awareness/ask` | `POST` | Public | AI segregation guidance |
| `/api/admin/hotspots` | `GET` | Admin | Real-time geographical hotspot analytics & priority ranking |
| `/api/admin/stats` | `GET` | Admin | Aggregated ward & status metrics |
| `/api/admin/reports` | `GET` | Admin | Priority complaint queue |
| `/api/admin/reports/:id`| `PATCH`| Admin | Update complaint status |
| `/api/admin/pickups` | `GET` | Admin | Pickup fulfillment queue |
| `/api/admin/insight` | `POST` | Admin | Generate AI weekly action plan |
