# Demo recording plan — “Built for Hands”

A ~6–7 minute solo tech-podcast episode about WebMCP itself: what it is, why
the core idea is right, and what is honestly still unsolved. It is recorded
**deliberately imperfect** — every planted flaw below is a beat the agent
fixes on camera during the demo. Record from talking points, not verbatim,
or the filler words you need will disappear.

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
| 1 | Natural “um / uh” sprinkled through the loose sections | `remove_fillers` |
| 2 | Two or three 3–5s silent pauses (pretend to check notes) | `remove_silences` |
| 3 | One flubbed sentence, then “let me try that again,” then the clean take | `find_in_transcript` + cut the bad take |
| 4 | One deliberate wrong word, self-corrected aloud | `correct_text` |
| 5 | One tight, quotable 25–40s cold open | `create_composition` → the Hook clip |
| 6 | Say “the architecture looks like this” while describing it | `add_image_overlay` diagram moment |

## Episode outline (~6:30)

### 0:00 – 0:40 · Cold open — THE HOOK (plant #5)

Tight and quotable; this becomes the clip composition. The thesis: for
thirty years the web was built for eyeballs; WebMCP is a bet that the next
user of your site is an agent, and instead of guessing at buttons, the page
hands it typed, callable tools.

### 0:40 – 2:00 · What it actually is

Technical and concrete: `document.modelContext.registerTool(name, schema,
fn)` running as ordinary page JavaScript; the agent attached to the tab
calls the tool and the callback runs with the page's state, session, and
permissions. Same grammar as MCP — the difference is the transport: the
page is the server, the logged-in session is the auth. Incubating in the
W3C Web Machine Learning Community Group; live in ChatGPT Desktop, behind a
flag in Chrome. *(One long pause here — plant #2.)*

### 2:00 – 3:20 · The good (plant #1 — speak loosely)

Three arguments: determinism versus screenshot-driven computer use; the
human never leaves — one shared visible surface, every mutation auditable
and undoable; and the economics — sites expose verbs they already own.

### 3:20 – 4:40 · The architecture (plants #3, #6)

Say **“the architecture looks like this”** and describe the three layers:
page state → one shared action hub → two front ends, buttons for humans and
tools for agents. Same verbs, nobody gets a special door; if the paths
differ they drift. **Plant the flub here** while explaining tool design,
then land it: narrow verbs, clear side effects, return what changed.

### 4:40 – 5:50 · The bad — deliver straight

Prompt injection gets a well-typed new attack surface (tool descriptions
are prompt input); the consent model is unfinished and browser-specific;
the spec is pre-standard and moving; and it only exists while the tab is
open — agency *with* you, not *for* you. Background automation is
server-side MCP's job, and that boundary is arguably a feature.

### 5:50 – 6:30 · Close (plant #4)

Plant the wrong word: “it's in the W3C spec — sorry, the **Web Machine
Learning Community Group** spec.” Then the close: the web that's coming
isn't one you browse — it's one you delegate.

## Live demo prompts (in ChatGPT Desktop, Site Tools on)

Run in order; each maps to planted material:

1. “Read the current project state. Don't edit anything yet.”
2. “Remove the filler words and the long silences.”
3. “I flubbed a sentence and restarted it — find the bad take and cut it.”
4. “I said ‘W3C spec’ near the end when I meant the Web Machine Learning
   Community Group — fix the transcript.”
5. “Find the most clip-worthy passage and make it a composition called *Hook*.”
6. “Turn on captions, remove my background, and put the studio card behind me.”
   *(Upload the background image via On screen → folder button first.)*
7. “Put the three-layers diagram on screen while I describe the architecture.”
8. “Export the Hook as a composed video.”

The exported MP4 (captions + background swap burned in) is the post-demo
YouTube artifact.

## Submission video (< 3:00) shot list

- 0:00–0:20 — The problem, over the raw uploaded recording — and the promise:
  the video being edited is already on YouTube; stick around for the link.
- 0:20–0:50 — Upload → transcript editable in under a minute (screen capture,
  timer visible).
- 0:50–1:40 — Agent conversation: cleanup, cutting the flub, fixing the wrong
  word. Show the activity log filling as tools fire.
- 1:40–2:20 — “Make me a hook”: composition appears, captions on, background
  swapped live, diagram on screen.
- 2:20–2:50 — Composed export downloads; cut to the finished clip playing on
  YouTube.
- 2:50–3:00 — YouTube link, live URL, and repo on screen.
