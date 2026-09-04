# Demo recording script — “Built for Hands”

A ~7-minute solo tech-podcast episode about WebMCP itself. It is written to be
**deliberately imperfect**: every planted flaw below is a beat the agent fixes
on camera during the demo. Record from the bullet points — do not read
verbatim, or the filler words you need will disappear.

## Recording setup

- One camera, landscape 16:9, 720p or 1080p, H.264 MP4.
- Webcam-style framing: head and shoulders, centered.
- **Plain background and even lighting** — the background-removal model cuts
  the cleanest edges against a boring wall with no backlight.
- Good mic, quiet room. Single continuous take; keep every mistake.
- Do a 1-minute throwaway recording first and run it through OpenCast to
  check transcription and background-removal quality on your setup.

## Planted flaws (the demo beats)

| # | Plant | Agent beat it enables |
|---|-------|----------------------|
| 1 | Natural “um / uh / like, you know” throughout | `remove_fillers` |
| 2 | Two or three 3–5s silent pauses (pretend to check notes) | `remove_silences` |
| 3 | One flubbed sentence, then “let me try that again,” then the clean take | `find_in_transcript` + cut the bad take |
| 4 | One rambling 60–90s tangent that deserves to die | “tighten this episode” judgment cut |
| 5 | One tight, quotable 25–40s cold open | `create_composition` → the Hook clip |
| 6 | Say “the architecture looks like this” while describing it | `add_image_overlay` B-roll moment |
| 7 | One deliberate wrong word, self-corrected aloud | `correct_text` |

## Episode outline (~7:00)

### 0:00 – 0:45 · Cold open — THE HOOK (plant #5)

Deliver this part tight and quotable; it becomes the clip composition.
Near-verbatim is fine here:

> “For thirty years we built websites for eyeballs. Buttons, menus, layouts —
> all of it assumes a human is looking. WebMCP is the first time we’re
> building the web for hands. An agent doesn’t *read* your page anymore — it
> *operates* it. And the sites that hand agents real tools, instead of making
> them guess at buttons, are the sites that are going to win.”

### 0:45 – 2:30 · Why UI-guessing agents are the wrong model (plants #1, #2)

Talking points — speak loosely, let the fillers happen, take one long pause:

- Screen-scraping agents click coordinates and pray; brittle, slow, blind.
- A page already *knows* its own actions — WebMCP lets it declare them:
  `document.modelContext.registerTool(...)`.
- Analogy: giving a chef your kitchen vs. making them cook through the mail
  slot.
- The user and the agent share one visible surface — nothing happens off
  screen.

### 2:30 – 4:00 · How a WebMCP site is shaped (plants #3, #6)

- Say: **“The architecture looks like this”** — describe a three-layer
  picture: page state → a shared action hub → two front ends, buttons for
  humans and tools for agents. *(Later the agent puts a diagram on screen
  right here.)*
- **Plant the flub here:** start explaining tool design, stumble mid-sentence,
  say “ugh — let me try that again,” and redo the sentence cleanly.
- Good tools are narrow verbs with clear side effects, not “do everything.”

### 4:00 – 5:30 · The tangent (plant #4)

Tell a genuinely skippable 60–90s side story — e.g. the time you automated
something with a headless browser and it broke the moment the site changed a
CSS class, with too much detail about the CSS class. This is the material the
agent chooses to cut when asked to tighten the episode.

### 5:30 – 7:00 · What it means for creators + close (plant #7)

- Creative tools are the sharpest test: editing video by *talking* about the
  transcript.
- **Plant the wrong word:** “this is all in the W3C spec — sorry, the **Web
  Machine Learning Community Group** spec.”
- Close: “The web that’s coming isn’t one you browse. It’s one you delegate.
  Build your site like an agent is already a user — because it is.”

## Live demo prompts (in ChatGPT Desktop, Site Tools on)

Run in order; each maps to planted material:

1. “Read the current project state. Don’t edit anything yet.”
2. “Remove the filler words and the long silences.”
3. “I flubbed a sentence and restarted it — find the bad take and cut it.”
4. “Tighten the episode — cut the weakest tangent to get it under six minutes.”
5. “Find the most clip-worthy passage and make it a composition called *Hook*.”
6. “Turn on captions, remove my background, and put the studio card behind me.”
   *(Upload the background image via On screen → folder button first.)*
7. “There’s a spot where I said the wrong spec name — fix the transcript text.”
8. “Export the Hook as a composed video.”

The exported MP4 (captions + background swap burned in) is the post-demo
YouTube artifact.

## Submission video (< 3:00) shot list

- 0:00–0:20 — The problem, over the raw uploaded recording: “7 minutes of
  podcast, ums, dead air, one bad take.”
- 0:20–0:50 — Upload → transcript editable in under a minute (screen capture,
  timer visible).
- 0:50–1:40 — Agent conversation: cleanup, cutting the flub, tightening.
  Show the activity log filling as tools fire.
- 1:40–2:20 — “Make me a hook”: composition appears, captions on, background
  swapped live.
- 2:20–2:50 — Composed export downloads; cut to the finished clip playing on
  YouTube.
- 2:50–3:00 — Live URL + repo on screen.
