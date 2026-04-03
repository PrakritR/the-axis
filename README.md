# The Axis — student housing demo

This is a small Vite + React + Tailwind project scaffolded as a starting point for a premium student housing website.

Quick start

1. cd the-axis
2. npm install
3. npm run dev

Open http://localhost:5173

Notes
- Edit property data in `src/data/properties.js` to update listings, images and details.
- Images currently use Unsplash placeholders; replace with local images or your own CDN.

Docker (no local Node required)

1. Install Docker Desktop (macOS) if you don't have it.
2. From the project folder run:

```bash
cd /Users/prakritramachandran/Desktop/house-project/the-axis
docker-compose up --build
```

3. Open http://localhost:5173

Notes: The compose file mounts the repo into the container so edits in your editor appear immediately in the dev server.
