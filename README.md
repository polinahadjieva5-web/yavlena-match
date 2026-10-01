# Yavlena Match

Standalone buyer matching + operational meeting assistant.

## Data isolation
This project intentionally does NOT read data from Yavlena Premium, Million+, Team 4, or any other internal app. External offer ingestion will be implemented independently.

## Local setup
1. Copy `.env.local.example` to `.env.local` and set Supabase URL + publishable key.
2. `npm install`
3. `npm run dev`
