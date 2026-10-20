# Rehearsal

Plan a wedding, birthday or community event, then rehearse it before it happens.

Most AI planners hand you a checklist and stop. That's the easy part. Events go wrong in the gaps: the caterer is an hour late, it rains during the procession, grandma stands for 90 minutes because the cocktail hour only has high tables. I wanted something that goes looking for those problems on paper, while they're still cheap to fix.

## What it does

You fill in the basics (date, city, guests, budget, vibe, traditions, any constraints) and Gemini drafts a plan: a budget split, a countdown timeline with real dates, a vendor checklist with questions to ask before you pay a deposit, three signature ideas and the run of show for the day. It uses Google Search grounding, so prices and vendor norms come from the actual city. Name your venue and it checks what reviews say about it.

Then you break it.

The Dress Rehearsal is a pre-mortem. Gemini walks the day minute by minute, assumes things will go wrong and tells you what fails, what that knocks on to and how to prevent it. You get a readiness score, the three fixes worth doing this week and a revised run of show you can apply with one click.

The Chaos test lets you pick the disaster yourself. "Caterer arrives 60 minutes late at the varmala." The delay pushes down the schedule right away, and anything that now runs past your curfew turns red. That part is plain code, so it's instant and costs no API calls. Then you ask Gemini to rescue the day around that specific incident.

Guest Lens is a heat map. Rows are the stages of your event (arrival, ceremony, the awkward waiting gap, dinner, exit) and columns are guests who usually get forgotten: elderly guests, wheelchair users, parents of under-5s, people with allergies, and sensory-sensitive guests. Red cells show the actual problem, a fix and roughly what it costs. One click puts the fix on your timeline.

A few smaller things:

- The budget slider shows each category's realistic minimum. Drag the total too low and categories turn red. It suggests changing the format (high tea instead of a sit-down dinner) instead of pretending you can feed 200 people on scraps.
- Plans come out in 10 languages, with Arabic rendered right to left, in whatever currency you use.
- Share links pack the whole plan into the URL with the browser's built-in gzip. There's no database and no accounts.
- Every task has an "Add to Google Calendar" link, and you can download the whole timeline as an .ics file.
- Each vendor has a Google Maps search link for your city. It's a plain link, not the Places API.
- Try the examples button: a Punjabi wedding in Jaipur, a dinosaur birthday in Lagos and a park clean-up in Toronto.

## How it's built

```
public/            plain HTML/CSS/JS, no framework, no build step
  app.js           UI; AI text is only ever set via textContent
  schedule.js      the chaos-test delay cascade
  calendar.js      .ics, Google Calendar and Maps links
lib/planner.js     validation, prompts, the Gemini call, post-processing
server.js          node:http server, static files + POST /api/generate
test/              node:test
```

There are no npm dependencies. Node already ships `http`, `fetch` and a test runner, and for an app this size that's all it needs.

Gemini returns JSON against a `responseSchema`, so nothing parses free text. I still don't trust the output blindly. The server rescales the budget so it adds up to exactly what you entered, clamps every "weeks before" to the time you actually have before turning them into real dates, and drops any heat-map cell with a persona or rating it doesn't recognise. If the model rejects grounding together with a schema, the call retries once without grounding.

Google pieces in use: the Gemini API (`gemini-3.6-flash`, which you can change with `GEMINI_MODEL`), Search grounding, Cloud Run, Secret Manager (optional), and Calendar and Maps links.

### Security

The API key never leaves the server. Every field is validated at the boundary against allow-lists, numeric and time ranges and length caps. Control characters and angle brackets are stripped, so user text can't close the `<event>` tag it's wrapped in, and the system prompt tells the model to treat that block as data. The CSP blocks inline scripts and styles. Bodies are capped at 32 KB, and the rate limiter keys on the IP that Cloud Run's front end appends last in `X-Forwarded-For`, because the earlier entries can be forged. Share links are shape-checked before anything renders, and only https source links get shown. The container runs as a non-root user.

One exception to the strict CSP: Google's grounding terms say you have to show their Search Suggestions widget exactly as they send it, inline styles and all. Rather than loosen the whole site for that, the widget renders inside a sandboxed iframe (`widget.html`) with its own small CSP. The frame has an opaque origin, so even a tampered share link can't reach the app's storage from in there.

### Accessibility

The tabs follow the WAI-ARIA pattern, so arrow keys, Home and End all work. Status and errors go through an aria-live region. Nothing relies on colour alone: cells say "Problem" or "Watch", schedule rows say "overruns". There's a skip link, visible focus, dark mode, reduced-motion support, and `lang`/`dir` set on the AI output so screen readers pronounce Hindi as Hindi.

## Running it

Put your key in a `.env` file (it's gitignored) and start the dev server:

```bash
echo "GEMINI_API_KEY=your_key" > .env   # https://aistudio.google.com/apikey
npm run dev                             # http://localhost:8080
npm test
```

Deploy to Cloud Run:

```bash
gcloud run deploy rehearsal --source . --region us-central1 --allow-unauthenticated \
  --set-env-vars GEMINI_API_KEY=your_key
```

Or keep the key in Secret Manager:

```bash
printf "your_key" | gcloud secrets create gemini-api-key --data-file=-
gcloud run deploy rehearsal --source . --region us-central1 --allow-unauthenticated \
  --set-secrets GEMINI_API_KEY=gemini-api-key:latest
```

The response cache and rate limiter live in memory, one per instance. That's fine at hackathon scale. If this ever needs to scale out, they'd move to something shared.
