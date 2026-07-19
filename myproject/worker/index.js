// Lisa 1000 API — Cloudflare Worker
// Static files in ../public are served by the assets binding; requests that
// don't match a file (and all POSTs) land here.
//
// Secrets come from `env`:
//   ANTHROPIC_API_KEY    Claude (stories, definitions, translation)
//   ELEVENLABS_API_KEY   text-to-speech (streaming narration)
//   OPENAI_API_KEY       images + TTS fallback when ElevenLabs is unavailable
//   HF_CREDENTIALS       Higgsfield "KEY_ID:KEY_SECRET" (story illustrations)
//   GOOGLE_CLIENT_ID     Google OAuth sign-in (/auth/login, /auth/callback)
//   GOOGLE_CLIENT_SECRET Google OAuth sign-in — paired with GOOGLE_CLIENT_ID

import Anthropic from '@anthropic-ai/sdk';

// Primary text model: OpenAI's best value tier (strong quality, low cost).
// Swap to 'gpt-5' for maximum quality or 'gpt-5-nano' for minimum cost.
const OPENAI_TEXT_MODEL = 'gpt-5-mini';
// Fallback text model when OpenAI errors out.
const CLAUDE_MODEL = 'claude-sonnet-5'; // swap to 'claude-haiku-4-5' (cheaper) or 'claude-opus-4-8' (higher quality)
const HIGGSFIELD_BASE = 'https://platform.higgsfield.ai';

// Style palette for generated illustrations. Every image prompt is wrapped
// with one of these plus CARTOON_SUFFIX below, so covers stay unmistakably
// storybook art — never photoreal — no matter which style the user picks.
const CARTOON_STYLES = [
    'storybook watercolor',
    'flat vector cartoon',
    'crayon and colored-pencil',
    'paper cut-out collage',
    'claymation-style 3D',
    'soft pastel illustration',
    'retro comic book',
    "gouache children's picture book",
];
const DEFAULT_CARTOON_STYLE = 'storybook watercolor';
// Hard suffix appended to every image prompt regardless of style, provider,
// or user input — the one non-negotiable guardrail for a kids' product.
const CARTOON_SUFFIX = ", charming children's cartoon illustration, absolutely no photorealism, no real people";

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

// Extract the plain text from a Claude response (skips thinking blocks).
function claudeText(message) {
    const text = message.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('')
        .trim();
    if (!text) {
        throw new Error(`Claude returned no text (stop_reason: ${message.stop_reason})`);
    }
    return text;
}

// Look up a single English word in the free dictionary API.
async function lookupDictionary(word) {
    const resp = await fetch(
        `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`
    );
    if (!resp.ok) return null;

    const entries = await resp.json();
    const entry = Array.isArray(entries) ? entries[0] : null;
    if (!entry) return null;

    const phonetics = entry.phonetics || [];
    const phonetic = entry.phonetic || phonetics.find((p) => p.text)?.text || '';
    const audioUrl = phonetics.find((p) => p.audio)?.audio || '';
    const meanings = (entry.meanings || []).slice(0, 3).map((m) => ({
        partOfSpeech: m.partOfSpeech,
        definition: m.definitions?.[0]?.definition || '',
        example: m.definitions?.[0]?.example || '',
    }));
    if (!meanings.length) return null;

    return { word: entry.word, phonetic, audioUrl, meanings };
}

// ---------- OpenAI primary with a Claude fallback ----------
// OpenAI (gpt-5-mini) serves all text generation; if it fails — for any
// reason — the same prompt runs against Claude instead. Two independent
// providers means one being down never stops a story.

async function openaiChatText(env, system, prompt, maxTokens) {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: OPENAI_TEXT_MODEL,
            // GPT-5 family expects max_completion_tokens (max_tokens is rejected)
            max_completion_tokens: maxTokens,
            messages: [
                { role: 'system', content: system },
                { role: 'user', content: prompt },
            ],
        }),
    });
    if (!resp.ok) throw new Error(`OpenAI failed (${resp.status}): ${await resp.text()}`);
    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('OpenAI returned no text');
    return text;
}

async function claudeChatText(anthropic, system, prompt, maxTokens) {
    const message = await anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: prompt }],
    });
    return claudeText(message);
}

// OpenAI first; on any OpenAI failure run the same prompt against Claude.
// With no OpenAI key configured at all, Claude serves alone.
async function generateText(env, anthropic, { system, prompt, maxTokens }) {
    if (!env.OPENAI_API_KEY) {
        return { text: await claudeChatText(anthropic, system, prompt, maxTokens), provider: 'claude' };
    }
    try {
        return { text: await openaiChatText(env, system, prompt, maxTokens), provider: 'openai' };
    } catch (error) {
        if (!env.ANTHROPIC_API_KEY) throw error;
        // Logged so a config problem (e.g. bad OpenAI key) stays visible in
        // the worker logs even while Claude keeps the site alive.
        console.error('OpenAI unavailable, falling back to Claude:', error.message);
        return { text: await claudeChatText(anthropic, system, prompt, maxTokens), provider: 'claude' };
    }
}

async function defineWithClaude(env, anthropic, word) {
    const { text, provider } = await generateText(env, anthropic, {
        system: 'You are a Dictionary that provides definitions for words in a simple and clear manner plus example use case. You return In Dictionary Format.',
        prompt: `Define the word "${word}".`,
        maxTokens: 1024,
    });
    return { word, definition: text, phonetic: '', audioUrl: '', meanings: [], source: provider };
}

async function handleDefinition(env, anthropic, word) {
    if (!word) return json({ error: 'No word provided' }, 400);

    if (/^[a-zA-Z'-]+$/.test(word.trim())) {
        try {
            const result = await lookupDictionary(word.trim());
            if (result) {
                const definition = result.meanings
                    .map((m) => `(${m.partOfSpeech}) ${m.definition}${m.example ? ` — e.g. "${m.example}"` : ''}`)
                    .join('\n');
                return json({ ...result, definition, source: 'dictionary' });
            }
        } catch (error) {
            console.error('Dictionary API failed, falling back to Claude:', error.message);
        }
    }

    return json(await defineWithClaude(env, anthropic, word));
}

async function handleTranslate(env, anthropic, body) {
    const { text, targetLanguage } = body;
    if (!text || !targetLanguage) {
        return json({ error: 'Text or target language not provided' }, 400);
    }

    const { text: translatedText } = await generateText(env, anthropic, {
        system: 'You are a helpful assistant that translates text. Reply with the translation only — no preamble.',
        prompt: `Translate the following text to ${targetLanguage}: ${text}`,
        maxTokens: 8192,
    });

    return json({ translatedText });
}

// ---------- Text-to-speech (ElevenLabs streaming, OpenAI fallback) ----------

// Cloned narrator voices. The client normally sends a concrete voice_id;
// these cover named keys and legacy OpenAI voice names still in the wild.
const ELEVEN_VOICES = { lisa: 'kv1Qe4fUcVPEC2ZisX5i', adam: 'IRHApOXLvnW57QJPQH2P' };

function resolveElevenVoiceId(voice) {
    if (!voice) return ELEVEN_VOICES.lisa;
    if (ELEVEN_VOICES[voice]) return ELEVEN_VOICES[voice];
    if (/^[a-zA-Z0-9]{16,}$/.test(voice)) return voice; // already a voice_id
    return ['onyx', 'echo', 'adam'].includes(voice) ? ELEVEN_VOICES.adam : ELEVEN_VOICES.lisa;
}

// Emotional delivery cues like [whispers]/[excited] need the v3 model;
// plain text uses multilingual v2 (same voice can read any language).
function elevenModelFor(text) {
    return /\[[^\]\n]{2,30}\]/.test(text) ? 'eleven_v3' : 'eleven_multilingual_v2';
}

// Strip [cue] delivery markers — used for the OpenAI fallback (which would
// read them out loud) and for the narration-with-timestamps v3 → v2 retry.
function stripCues(text) {
    return text.replace(/\[[^\]\n]{2,30}\]\s*/g, '');
}

async function handleSpeech(env, body) {
    const { text, voice } = body;
    if (!text) return json({ error: 'No text provided' }, 400);

    // ElevenLabs first: the upstream body is passed through untouched, so the
    // client starts playing while synthesis is still running.
    if (env.ELEVENLABS_API_KEY) {
        const voiceId = resolveElevenVoiceId(voice);
        const resp = await fetch(
            `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?output_format=mp3_44100_128`,
            {
                method: 'POST',
                headers: {
                    'xi-api-key': env.ELEVENLABS_API_KEY,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ text, model_id: elevenModelFor(text) }),
            }
        );
        if (resp.ok) {
            return new Response(resp.body, {
                status: 200,
                headers: { 'Content-Type': 'audio/mpeg' },
            });
        }
        console.error('ElevenLabs TTS failed, falling back to OpenAI:', resp.status, await resp.text());
    }

    // Fallback: OpenAI TTS. Strip emotional cues (OpenAI would read them out)
    // and map named/ElevenLabs voices onto the closest OpenAI equivalents.
    const plain = stripCues(text);
    const openaiVoice = /^(alloy|echo|fable|onyx|nova|shimmer)$/.test(voice || '')
        ? voice
        : (['adam', ELEVEN_VOICES.adam].includes(voice) ? 'onyx' : 'nova');
    const resp = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: 'tts-1', voice: openaiVoice, input: plain }),
    });

    if (!resp.ok) {
        console.error('TTS error:', resp.status, await resp.text());
        return json({ error: 'Failed to generate speech' }, 500);
    }

    return new Response(resp.body, {
        status: 200,
        headers: { 'Content-Type': 'audio/mpeg' },
    });
}

// ---------- Narration cache (synthesize once, replay free) ----------

// ElevenLabs "with-timestamps": same synthesis as /stream, but returns whole
// base64 audio plus per-character alignment instead of a byte stream — the
// alignment is what makes word highlighting possible on replay.
async function synthesizeWithTimestamps(env, voiceId, text, modelId) {
    const resp = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps?output_format=mp3_44100_128`,
        {
            method: 'POST',
            headers: {
                'xi-api-key': env.ELEVENLABS_API_KEY,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ text, model_id: modelId }),
        }
    );
    if (!resp.ok) throw new Error(`ElevenLabs with-timestamps failed (${resp.status}): ${await resp.text()}`);
    const data = await resp.json();
    if (!data.audio_base64 || !data.alignment) throw new Error('ElevenLabs with-timestamps returned no audio/alignment');
    return { audioBase64: data.audio_base64, alignment: data.alignment };
}

// Collapse ElevenLabs' per-character alignment into per-word timings, e.g.
// { characters: ['H','i',' ','w','o','r','l','d'], character_start_times_seconds: [...], ... }
// becomes { words: [{ w: 'Hi', s: 0, e: 0.2 }, { w: 'world', s: 0.3, e: 0.7 }] }.
// [cue] runs are dropped entirely — they're never spoken as words, and a
// scene's rough start time can later be derived by matching its first word
// against this list (no separate scene-sync data needed).
function compactWordTimestamps(alignment) {
    const chars = alignment?.characters || [];
    const starts = alignment?.character_start_times_seconds || [];
    const ends = alignment?.character_end_times_seconds || [];
    const words = [];
    let word = '', wordStart = null, wordEnd = null, inCue = false;

    const flush = () => {
        if (word) words.push({ w: word, s: wordStart, e: wordEnd });
        word = '';
        wordStart = null;
        wordEnd = null;
    };

    for (let i = 0; i < chars.length; i++) {
        const ch = chars[i];
        if (ch === '[') { flush(); inCue = true; continue; }
        if (ch === ']') { inCue = false; continue; }
        if (inCue) continue;
        if (/\s/.test(ch)) { flush(); continue; }
        if (!word) wordStart = starts[i];
        word += ch;
        wordEnd = ends[i];
    }
    flush();
    return words;
}

// GET /api/works/:id/narration?voice=<key-or-id> — cached narration audio +
// word timestamps. Same visibility rule as handleGetWork (private works are
// invisible to non-owners). A cache hit is free; a miss synthesizes once via
// ElevenLabs and stores the result so every later play/replay is a hit.
async function handleGetNarration(env, workId, voiceParam, sessionUser) {
    if (!env.DB) return json({ error: 'Database not configured' }, 501);
    if (!env.MEDIA) return json({ error: 'Media storage not configured' }, 501); // cache requires R2

    const work = await env.DB.prepare('SELECT * FROM works WHERE id = ?').bind(workId).first();
    if (!work) return json({ error: 'Work not found' }, 404);
    const ownedByViewer = sessionUser && sessionUser.id === work.owner_id;
    if (work.visibility === 'private' && !ownedByViewer) return json({ error: 'Work not found' }, 404);

    const voiceId = resolveElevenVoiceId(voiceParam);
    const language = work.language || 'en';

    const cached = await env.DB.prepare(
        'SELECT audio_url, timestamps_json FROM narrations WHERE work_id = ? AND voice_id = ? AND language = ?'
    ).bind(workId, voiceId, language).first();
    if (cached) {
        return json({
            audio_url: cached.audio_url,
            timestamps: cached.timestamps_json ? JSON.parse(cached.timestamps_json) : null,
            cached: true,
        });
    }

    if (!env.ELEVENLABS_API_KEY) return json({ error: 'Narration not available' }, 502);

    const scenes = await env.DB.prepare(
        'SELECT narration_text, display_text FROM scenes WHERE work_id = ? ORDER BY idx'
    ).bind(workId).all();
    if (!scenes.results.length) return json({ error: 'Work has no scenes' }, 404);
    const text = scenes.results.map((s) => s.narration_text || s.display_text).join('\n\n');

    let audioBase64, alignment;
    try {
        ({ audioBase64, alignment } = await synthesizeWithTimestamps(env, voiceId, text, elevenModelFor(text)));
    } catch (error) {
        // v3 (cue-driven) synthesis is less reliable than v2 — one retry with
        // cues stripped before giving up and letting the client fall back to
        // live streaming.
        if (elevenModelFor(text) !== 'eleven_v3') {
            console.error('Narration synthesis failed:', error.message);
            return json({ error: 'Narration synthesis failed', detail: error.message }, 502);
        }
        try {
            ({ audioBase64, alignment } = await synthesizeWithTimestamps(env, voiceId, stripCues(text), 'eleven_multilingual_v2'));
        } catch (retryError) {
            console.error('Narration synthesis retry failed:', retryError.message);
            return json({ error: 'Narration synthesis failed', detail: retryError.message }, 502);
        }
    }

    const audioBytes = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));
    const key = `narrations/${workId}/${voiceId}/${language}.mp3`;
    await env.MEDIA.put(key, audioBytes, { httpMetadata: { contentType: 'audio/mpeg' } });
    const audioUrl = `/media/${key}`;
    const timestampsJson = JSON.stringify({ words: compactWordTimestamps(alignment) });

    // The unique index may race under concurrent requests for the same
    // (work, voice, language); IGNORE the loser and re-read whichever row won.
    await env.DB.prepare(
        `INSERT OR IGNORE INTO narrations (id, work_id, voice_id, language, audio_url, timestamps_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(`n_${crypto.randomUUID()}`, workId, voiceId, language, audioUrl, timestampsJson, Math.floor(Date.now() / 1000)).run();

    const row = await env.DB.prepare(
        'SELECT audio_url, timestamps_json FROM narrations WHERE work_id = ? AND voice_id = ? AND language = ?'
    ).bind(workId, voiceId, language).first();
    return json({
        audio_url: row.audio_url,
        timestamps: row.timestamps_json ? JSON.parse(row.timestamps_json) : null,
        cached: false,
    });
}

// OpenAI GPT Image text-to-image (current image provider).
// GPT Image models return base64, not a hosted URL, so we hand back a data URL.
async function generateIllustrationOpenAI(env, prompt) {
    const resp = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: 'gpt-image-2', prompt, size: '1024x1024' }),
    });
    if (!resp.ok) {
        throw new Error(`OpenAI image generation failed (${resp.status}): ${await resp.text()}`);
    }
    const data = await resp.json();
    const b64 = data.data?.[0]?.b64_json;
    if (!b64) throw new Error('OpenAI image generation returned no image data');
    return `data:image/png;base64,${b64}`;
}

// Poll a submitted Higgsfield job to completion. Shared by every
// text2image model — submission bodies differ, polling doesn't.
async function pollHiggsfieldJob(auth, job) {
    const deadline = Date.now() + 120000;
    while (!['completed', 'failed', 'nsfw'].includes(job.status)) {
        if (Date.now() > deadline) throw new Error('Higgsfield polling timed out');
        await new Promise((r) => setTimeout(r, 2000));
        const poll = await fetch(`${HIGGSFIELD_BASE}/requests/${job.request_id}/status`, { headers: auth });
        if (poll.status >= 500) continue; // transient server error, keep polling
        if (!poll.ok) throw new Error(`Higgsfield poll failed (${poll.status})`);
        job = await poll.json();
    }

    if (job.status !== 'completed' || !job.images?.length) {
        throw new Error(`Higgsfield image generation ${job.status}`);
    }
    return job.images[0].url;
}

// Higgsfield Soul text-to-image via REST: submit, then poll to completion.
// Kept for when HF_CREDENTIALS (platform.higgsfield.ai developer keys) are set up.
async function generateIllustration(env, prompt) {
    const auth = { 'Authorization': `Key ${env.HF_CREDENTIALS}`, 'Content-Type': 'application/json' };

    const submit = await fetch(`${HIGGSFIELD_BASE}/v1/text2image/soul`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({
            prompt,
            width_and_height: '1536x1536',
            quality: '1080p',
            batch_size: 1,
            enhance_prompt: true,
        }),
    });
    if (!submit.ok) {
        throw new Error(`Higgsfield submit failed (${submit.status}): ${await submit.text()}`);
    }
    return pollHiggsfieldJob(auth, await submit.json());
}

// Higgsfield Recraft V4.1 text-to-image — the model the user's own
// Higgsfield account used to generate the original covers, at 16:9 1344x768.
// NOTE: /v1/text2image/soul is confirmed (it's the working code above); the
// analogous /v1/text2image/recraft path and body below follow the same
// submit+poll contract by inference from the Soul route and the Higgsfield
// SDK/CLI docs (which name the recraft_v4_1 model but don't publish its REST
// path). Confirm the exact route/params against cloud.higgsfield.ai on the
// first live call.
async function generateIllustrationHiggsfield(env, prompt, opts = {}) {
    const auth = { 'Authorization': `Key ${env.HF_CREDENTIALS}`, 'Content-Type': 'application/json' };

    const submit = await fetch(`${HIGGSFIELD_BASE}/v1/text2image/recraft`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({
            prompt,
            model: 'recraft_v4_1',
            width_and_height: opts.widthAndHeight || '1344x768',
            batch_size: 1,
        }),
    });
    if (!submit.ok) {
        throw new Error(`Higgsfield recraft submit failed (${submit.status}): ${await submit.text()}`);
    }
    return pollHiggsfieldJob(auth, await submit.json());
}

// Resolve the requested style: a literal CARTOON_STYLES entry, 'surprise'
// for a random pick, or the default when omitted/unrecognized.
function resolveCartoonStyle(requested) {
    if (requested === 'surprise') {
        return CARTOON_STYLES[Math.floor(Math.random() * CARTOON_STYLES.length)];
    }
    return CARTOON_STYLES.includes(requested) ? requested : DEFAULT_CARTOON_STYLE;
}

// Wrap a base image prompt with its style prefix and the hard suffix.
// Applies identically no matter which provider ends up serving the request.
function applyCartoonStyle(prompt, style) {
    return `${style}, ${prompt}${CARTOON_SUFFIX}`;
}

// Cover chain: Higgsfield recraft_v4_1 first (when HF_CREDENTIALS is
// configured — it's the model that made the original covers), OpenAI
// gpt-image-2 otherwise or on any Higgsfield failure. Plain sequential
// try/catch, same shape as the file's other provider fallbacks.
async function generateCoverImage(env, styledPrompt) {
    if (env.HF_CREDENTIALS) {
        try {
            return await generateIllustrationHiggsfield(env, styledPrompt);
        } catch (error) {
            console.error('Higgsfield cover generation failed, falling back to OpenAI:', error.message);
        }
    }
    return await generateIllustrationOpenAI(env, styledPrompt);
}

const STORY_SYSTEM_PROMPT =
    'You are a helpful assistant designed to write short stories. Output plain text in exactly this format: title|story|narration|imagePrompt. ' +
    'The title is a short, evocative story title (a few words, no quotes). ' +
    'The story is the clean text shown to the reader. It must NOT repeat the title. ' +
    'The narration is the SAME story with inline emotional delivery cues in square brackets placed before the phrases they affect — e.g. [warmly], [excited], [whispers], [sighs], [laughs] — for an expressive text-to-speech narrator. ' +
    'The imagePrompt is a highly detailed illustration prompt for the story. ' +
    'Output exactly three "|" characters separating the four parts, and nothing else — no labels, no markdown.';

// Split a title|story|narration|imagePrompt response, tolerating models that
// drop parts. The story is always the longest early part — this is what
// prevents a title from ever being shown as the story body again.
function parseStoryParts(text) {
    const parts = text.split('|').map((part) => part.trim()).filter(Boolean);
    let title = '', story = '', narration = '', imagePrompt = '';
    if (parts.length >= 4) {
        [title, story, narration] = parts;
        imagePrompt = parts[parts.length - 1];
    } else if (parts.length === 3) {
        // Could be title|story|imagePrompt or story|narration|imagePrompt.
        // A title is short; a story isn't. Decide by length.
        if (parts[0].length < 80 && parts[1].length > parts[0].length * 2) {
            [title, story, imagePrompt] = parts;
        } else {
            [story, narration, imagePrompt] = parts;
        }
    } else if (parts.length === 2) {
        [story, imagePrompt] = parts;
    } else {
        story = parts[0] || '';
    }
    // Strip stray labels some models prepend despite instructions
    title = title.replace(/^title\s*:\s*/i, '').replace(/^["']|["']$/g, '');
    story = story.replace(/^story\s*:\s*/i, '');
    return { title, story, narration: narration || story, imagePrompt };
}

async function handleGenerateStory(env, anthropic, body) {
    const prompt = body.prompt;
    if (!prompt) return json({ error: 'No prompt provided' }, 400);

    const { text } = await generateText(env, anthropic, {
        system: STORY_SYSTEM_PROMPT,
        prompt,
        maxTokens: 8192,
    });

    const { title, story, narration, imagePrompt } = parseStoryParts(text);

    const styleUsed = resolveCartoonStyle(body.style);
    const styledPrompt = applyCartoonStyle((imagePrompt || story).substring(0, 1000), styleUsed);
    const imageUrl = await generateCoverImage(env, styledPrompt);
    return json({ title, story, narration, imageUrl, styleUsed });
}

// ---------- Works API (D1 — schema in docs/SCHEMA.md) ----------

// Shared SELECT fragment for every listing-shaped work row (library, a
// user's own works, recommendations): engagement counts, the owner's
// handle, and — when signed in — the viewer's own reaction. IMPORTANT: the
// `?` inside my_reaction's subselect is the FIRST placeholder in any query
// built from this fragment (it sits in the SELECT clause, before any WHERE
// binds), so callers must bind sessionUser.id first when sessionUser is set.
function workListColumnsSql(sessionUser) {
    return `w.id, w.kind, w.title, w.genre, w.language, w.length, w.owner_id,
            w.visibility, w.cover_image_url, w.created_at, w.view_count,
            (SELECT s.display_text FROM scenes s
             WHERE s.work_id = w.id ORDER BY s.idx LIMIT 1) AS excerpt,
            (SELECT GROUP_CONCAT(we.emotion) FROM work_emotions we
             WHERE we.work_id = w.id) AS emotions,
            (SELECT COUNT(*) FROM work_reactions wr WHERE wr.work_id = w.id AND wr.reaction = 'like') AS like_count,
            (SELECT COUNT(*) FROM work_reactions wr WHERE wr.work_id = w.id AND wr.reaction = 'dislike') AS dislike_count,
            u.handle AS owner_handle,
            ${sessionUser
                ? '(SELECT reaction FROM work_reactions wr WHERE wr.work_id = w.id AND wr.user_id = ?) AS my_reaction'
                : 'NULL AS my_reaction'}`;
}

// Every row selected via workListColumnsSql() needs its comma-joined
// emotions string exploded into an array.
function mapWorkRow(r) {
    return { ...r, emotions: r.emotions ? r.emotions.split(',') : [] };
}

// GET /api/works?kind=&genre=&owner=&emotion=&character=&q=
// Library listing with every filter from the schema's feature->query map.
async function handleListWorks(env, url, sessionUser) {
    if (!env.DB) return json({ error: 'Database not configured' }, 501);

    const p = url.searchParams;
    // Listings show public works, plus the viewer's own (any visibility) when
    // signed in; 'unlisted' works are otherwise reachable by direct id but
    // never listed; 'private' never leaves the DB except to its owner.
    const where = sessionUser ? ["(w.visibility = 'public' OR w.owner_id = ?)"] : ["w.visibility = 'public'"];
    const binds = sessionUser ? [sessionUser.id] : [];
    let hasFilter = false;

    if (p.get('kind'))  { where.push('w.kind = ?');     binds.push(p.get('kind')); hasFilter = true; }
    if (p.get('genre')) { where.push('w.genre = ?');    binds.push(p.get('genre')); hasFilter = true; }
    if (p.get('owner')) { where.push('w.owner_id = ?'); binds.push(p.get('owner')); hasFilter = true; }
    if (p.get('emotion')) {
        where.push('EXISTS (SELECT 1 FROM work_emotions we WHERE we.work_id = w.id AND we.emotion = ?)');
        binds.push(p.get('emotion'));
        hasFilter = true;
    }
    if (p.get('character')) {
        where.push(`EXISTS (SELECT 1 FROM work_characters wc
                            JOIN characters c ON c.id = wc.character_id
                            WHERE wc.work_id = w.id AND c.name = ? COLLATE NOCASE)`);
        binds.push(p.get('character'));
        hasFilter = true;
    }
    const q = (p.get('q') || '').trim().slice(0, 100);
    if (q) {
        where.push('w.title LIKE ? COLLATE NOCASE');
        binds.push(`%${q}%`);
        hasFilter = true;
    }

    // No filters/q: rank by likes then views so the JS pinning step below has
    // a stable base order for "the rest". With filters/q: likes then recency
    // — view_count would bias a narrow filtered result toward old favorites.
    const orderSql = hasFilter
        ? 'ORDER BY like_count DESC, w.created_at DESC, w.id'
        : 'ORDER BY like_count DESC, w.view_count DESC, w.created_at DESC, w.id';

    const selectBinds = sessionUser ? [sessionUser.id] : [];
    const sql = `
        SELECT ${workListColumnsSql(sessionUser)}
        FROM works w
        JOIN users u ON u.id = w.owner_id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ${orderSql}
        LIMIT 100`;

    const { results } = await env.DB.prepare(sql).bind(...selectBinds, ...binds).all();

    // A real search is a strong "interested in" signal for recommendations.
    if (sessionUser && q) {
        await env.DB.prepare(
            `INSERT INTO user_events (id, user_id, kind, work_id, query, created_at) VALUES (?, ?, 'search', NULL, ?, ?)`
        ).bind(`ue_${crypto.randomUUID()}`, sessionUser.id, q, Math.floor(Date.now() / 1000)).run();
    }

    let works = results.map(mapWorkRow);

    // Plain listing only: pin the top 3 by view_count (ties by like_count) to
    // the front, then leave the rest in the like/view/recency order already
    // computed by the query above — one query, a stable JS partition on top.
    if (!hasFilter) {
        const byViews = [...works].sort((a, b) => b.view_count - a.view_count || b.like_count - a.like_count);
        const pinnedIds = new Set(byViews.slice(0, 3).map((w) => w.id));
        const pinned = byViews.filter((w) => pinnedIds.has(w.id));
        const rest = works.filter((w) => !pinnedIds.has(w.id));
        works = [...pinned, ...rest];
    }

    return json({ works });
}

// POST /api/works/:id/view — bumps view_count. No login required; visible to
// anyone who can see the work (same rule as handleGetWork). Logs an 'open'
// signal event when the viewer is signed in.
async function handleTrackView(env, id, sessionUser) {
    if (!env.DB) return json({ error: 'Database not configured' }, 501);

    const work = await env.DB.prepare('SELECT owner_id, visibility FROM works WHERE id = ?').bind(id).first();
    if (!work) return json({ error: 'Work not found' }, 404);
    const ownedByViewer = sessionUser && sessionUser.id === work.owner_id;
    if (work.visibility === 'private' && !ownedByViewer) return json({ error: 'Work not found' }, 404);

    await env.DB.prepare('UPDATE works SET view_count = view_count + 1 WHERE id = ?').bind(id).run();
    if (sessionUser) {
        await env.DB.prepare(
            `INSERT INTO user_events (id, user_id, kind, work_id, query, created_at) VALUES (?, ?, 'open', ?, NULL, ?)`
        ).bind(`ue_${crypto.randomUUID()}`, sessionUser.id, id, Math.floor(Date.now() / 1000)).run();
    }

    const row = await env.DB.prepare('SELECT view_count FROM works WHERE id = ?').bind(id).first();
    return json({ view_count: row.view_count });
}

// POST /api/works/:id/reaction  { reaction: 'like' | 'dislike' | null }
// One reaction per (work, user); sending a new value replaces the old one,
// null clears it. Requires sign-in — an anonymous "like" can't be undone by
// its author later. Same visibility rule as viewing: you can't react to a
// private work that isn't yours.
async function handleReaction(env, id, sessionUser, body) {
    if (!env.DB) return json({ error: 'Database not configured' }, 501);
    if (!sessionUser) return json({ error: 'Log in to react' }, 401);

    const work = await env.DB.prepare('SELECT owner_id, visibility FROM works WHERE id = ?').bind(id).first();
    if (!work) return json({ error: 'Work not found' }, 404);
    const ownedByViewer = sessionUser.id === work.owner_id;
    if (work.visibility === 'private' && !ownedByViewer) return json({ error: 'Work not found' }, 404);

    const reaction = body?.reaction ?? null;
    if (reaction !== null && reaction !== 'like' && reaction !== 'dislike') {
        return json({ error: "reaction must be 'like', 'dislike', or null" }, 400);
    }

    const now = Math.floor(Date.now() / 1000);
    if (reaction === null) {
        await env.DB.prepare('DELETE FROM work_reactions WHERE work_id = ? AND user_id = ?').bind(id, sessionUser.id).run();
    } else {
        // Flipping like<->dislike replaces the row (PRIMARY KEY (work_id, user_id)).
        await env.DB.prepare(
            'INSERT OR REPLACE INTO work_reactions (work_id, user_id, reaction, created_at) VALUES (?, ?, ?, ?)'
        ).bind(id, sessionUser.id, reaction, now).run();
        if (reaction === 'like') {
            await env.DB.prepare(
                `INSERT INTO user_events (id, user_id, kind, work_id, query, created_at) VALUES (?, ?, 'like', ?, NULL, ?)`
            ).bind(`ue_${crypto.randomUUID()}`, sessionUser.id, id, now).run();
        }
    }

    const counts = await env.DB.prepare(
        `SELECT
            (SELECT COUNT(*) FROM work_reactions WHERE work_id = ? AND reaction = 'like') AS like_count,
            (SELECT COUNT(*) FROM work_reactions WHERE work_id = ? AND reaction = 'dislike') AS dislike_count`
    ).bind(id, id).first();
    const mine = await env.DB.prepare(
        'SELECT reaction FROM work_reactions WHERE work_id = ? AND user_id = ?'
    ).bind(id, sessionUser.id).first();

    return json({ like_count: counts.like_count, dislike_count: counts.dislike_count, my_reaction: mine?.reaction ?? null });
}

// PATCH /api/works/:id  { visibility }  — owner-only.
async function handleUpdateWork(env, id, sessionUser, body) {
    if (!env.DB) return json({ error: 'Database not configured' }, 501);

    const work = await env.DB.prepare('SELECT owner_id FROM works WHERE id = ?').bind(id).first();
    if (!work) return json({ error: 'Work not found' }, 404);
    if (!sessionUser || sessionUser.id !== work.owner_id) return json({ error: 'Not your work' }, 403);

    const visibility = body?.visibility;
    const allowedVisibility = ['private', 'unlisted', 'public'];
    if (!allowedVisibility.includes(visibility)) {
        return json({ error: "visibility must be 'private', 'unlisted', or 'public'" }, 400);
    }

    await env.DB.prepare('UPDATE works SET visibility = ? WHERE id = ?').bind(visibility, id).run();
    return json({ id, visibility });
}

// DELETE /api/works/:id — owner-only. Children (scenes, work_emotions,
// work_characters, narrations, animations) cascade via ON DELETE CASCADE.
async function handleDeleteWork(env, id, sessionUser) {
    if (!env.DB) return json({ error: 'Database not configured' }, 501);

    const work = await env.DB.prepare('SELECT owner_id FROM works WHERE id = ?').bind(id).first();
    if (!work) return json({ error: 'Work not found' }, 404);
    if (!sessionUser || sessionUser.id !== work.owner_id) return json({ error: 'Not your work' }, 403);

    await env.DB.prepare('DELETE FROM works WHERE id = ?').bind(id).run();
    return json({ ok: true });
}

// GET /api/me/works — every work the signed-in user owns, any visibility.
// Feeds the MyStories page.
async function handleMyWorks(env, sessionUser) {
    if (!env.DB) return json({ error: 'Database not configured' }, 501);
    if (!sessionUser) return json({ error: 'Not signed in' }, 401);

    const sql = `
        SELECT ${workListColumnsSql(sessionUser)}
        FROM works w
        JOIN users u ON u.id = w.owner_id
        WHERE w.owner_id = ?
        ORDER BY w.created_at DESC, w.id
        LIMIT 200`;

    const { results } = await env.DB.prepare(sql).bind(sessionUser.id, sessionUser.id).all();
    return json({ works: results.map(mapWorkRow) });
}

// GET /api/me/recommendations — basic content-based "recommended for you".
// Signal: the genres/emotions of works this user has opened or liked (last
// 200 matching events). Candidates: public works they don't own and haven't
// opened, ranked by genre/emotion overlap with their signal, then by
// like_count. No signal at all → the 6 most-liked public works they don't
// own (the query below is already sorted that way).
async function handleRecommendations(env, sessionUser) {
    if (!env.DB) return json({ error: 'Database not configured' }, 501);
    if (!sessionUser) return json({ error: 'Not signed in' }, 401);

    const events = await env.DB.prepare(
        `SELECT ue.kind, ue.work_id, w.genre,
                (SELECT GROUP_CONCAT(we.emotion) FROM work_emotions we WHERE we.work_id = w.id) AS emotions
         FROM user_events ue
         JOIN works w ON w.id = ue.work_id
         WHERE ue.user_id = ? AND ue.kind IN ('open','like')
         ORDER BY ue.created_at DESC
         LIMIT 200`
    ).bind(sessionUser.id).all();

    const openedIds = new Set();
    const genreCounts = {};
    const emotionCounts = {};
    for (const e of events.results) {
        if (e.kind === 'open') openedIds.add(e.work_id);
        if (e.genre) genreCounts[e.genre] = (genreCounts[e.genre] || 0) + 1;
        for (const emotion of e.emotions ? e.emotions.split(',') : []) {
            emotionCounts[emotion] = (emotionCounts[emotion] || 0) + 1;
        }
    }
    const hasSignal = Object.keys(genreCounts).length > 0 || Object.keys(emotionCounts).length > 0;

    const candidatesSql = `
        SELECT ${workListColumnsSql(sessionUser)}
        FROM works w
        JOIN users u ON u.id = w.owner_id
        WHERE w.visibility = 'public' AND w.owner_id != ?
        ORDER BY like_count DESC, w.view_count DESC, w.created_at DESC
        LIMIT 200`;
    const { results } = await env.DB.prepare(candidatesSql).bind(sessionUser.id, sessionUser.id).all();
    const candidates = results.map(mapWorkRow).filter((w) => !openedIds.has(w.id));

    if (!hasSignal) {
        return json({ works: candidates.slice(0, 6) }); // already like_count-sorted
    }

    const scored = candidates
        .map((w) => {
            const genreScore = w.genre ? (genreCounts[w.genre] || 0) : 0;
            const emotionScore = w.emotions.reduce((sum, e) => sum + (emotionCounts[e] || 0), 0);
            return { w, score: genreScore + emotionScore };
        })
        .sort((a, b) => b.score - a.score || b.w.like_count - a.w.like_count);

    return json({ works: scored.slice(0, 6).map((s) => s.w) });
}

// Escape text for safe placement inside an HTML attribute or element body.
function escapeHtml(text) {
    return String(text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Truncate to ~160 chars on a word boundary for an og:description, appending
// an ellipsis. Short text passes through untouched.
function truncateDescription(text, limit = 160) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (clean.length <= limit) return clean;
    const cut = clean.slice(0, limit);
    const lastSpace = cut.lastIndexOf(' ');
    const boundary = lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
    return `${boundary.trimEnd()}…`;
}

// Absolutize a cover URL against the request origin. Handles relative
// `/media/...` and legacy `images/...` seed-cover paths as well as full
// http(s) URLs (returned as-is). Returns null for anything else (e.g. a
// stray data: URL that never should have been persisted).
function absolutizeCoverUrl(origin, coverUrl) {
    if (!coverUrl || typeof coverUrl !== 'string') return null;
    if (/^https?:\/\//i.test(coverUrl)) return coverUrl;
    if (coverUrl.startsWith('/')) return `${origin}${coverUrl}`;
    return `${origin}/${coverUrl}`;
}

// GET /s/:id — server-rendered share shell for a saved work: crawler-facing
// Open Graph/Twitter meta tags plus a human redirect into the real reader
// (story.html). Serves 'public' and 'unlisted' works only — a share link is
// for strangers by definition, so there's no owner exception, and 'private'/
// missing works get the same plain 404 as handleGetWork so existence is
// never revealed.
async function handleSharePage(env, url, id) {
    if (!env.DB) return json({ error: 'Database not configured' }, 501);

    const work = await env.DB.prepare('SELECT * FROM works WHERE id = ?').bind(id).first();
    if (!work || (work.visibility !== 'public' && work.visibility !== 'unlisted')) {
        return json({ error: 'Work not found' }, 404);
    }

    const firstScene = await env.DB.prepare(
        'SELECT display_text FROM scenes WHERE work_id = ? ORDER BY idx LIMIT 1'
    ).bind(id).first();

    const title = work.title || 'A story';
    const description = truncateDescription(firstScene?.display_text || '');
    const shareUrl = `${url.origin}/s/${encodeURIComponent(id)}`;
    const readerUrl = `/story.html?id=${encodeURIComponent(id)}`;
    const imageUrl = absolutizeCoverUrl(url.origin, work.cover_image_url);

    const safeTitle = escapeHtml(title);
    const safeDescription = escapeHtml(description);
    const pageTitle = escapeHtml(`${title} — LISA 1000`);

    const metaTags = [
        `<meta property="og:type" content="article">`,
        `<meta property="og:site_name" content="LISA 1000">`,
        `<meta property="og:title" content="${safeTitle}">`,
        `<meta property="og:description" content="${safeDescription}">`,
        `<meta property="og:url" content="${escapeHtml(shareUrl)}">`,
    ];
    if (imageUrl) metaTags.push(`<meta property="og:image" content="${escapeHtml(imageUrl)}">`);
    metaTags.push(`<meta name="twitter:card" content="${imageUrl ? 'summary_large_image' : 'summary'}">`);
    metaTags.push(`<meta name="twitter:title" content="${safeTitle}">`);
    metaTags.push(`<meta name="twitter:description" content="${safeDescription}">`);

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${pageTitle}</title>
<meta http-equiv="refresh" content="0;url=${escapeHtml(readerUrl)}">
${metaTags.join('\n')}
<script>location.replace(${JSON.stringify(readerUrl)});</script>
</head>
<body>
<p>Redirecting… <a href="${escapeHtml(readerUrl)}">Read this story on LISA 1000</a></p>
</body>
</html>`;

    return new Response(html, {
        status: 200,
        headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'public, max-age=300',
        },
    });
}

// GET /api/works/:id — full work: scenes (with lines), cast, emotions.
async function handleGetWork(env, id, sessionUser) {
    if (!env.DB) return json({ error: 'Database not configured' }, 501);

    // Fetched without a visibility filter so ownership can be checked below;
    // direct fetch serves public AND unlisted (share links). A private work
    // is served only to its owner — anyone else gets the same 404 as a
    // missing work, so its existence is never revealed.
    const work = await env.DB.prepare('SELECT * FROM works WHERE id = ?').bind(id).first();
    if (!work) return json({ error: 'Work not found' }, 404);
    const ownedByViewer = sessionUser && sessionUser.id === work.owner_id;
    if (work.visibility === 'private' && !ownedByViewer) return json({ error: 'Work not found' }, 404);

    const [scenes, lines, cast, emotions, counts, owner, myReaction] = await Promise.all([
        env.DB.prepare('SELECT * FROM scenes WHERE work_id = ? ORDER BY idx').bind(id).all(),
        env.DB.prepare(`SELECT sl.* FROM scene_lines sl
                        JOIN scenes s ON s.id = sl.scene_id
                        WHERE s.work_id = ? ORDER BY s.idx, sl.idx`).bind(id).all(),
        env.DB.prepare(`SELECT c.*, wc.role FROM work_characters wc
                        JOIN characters c ON c.id = wc.character_id
                        WHERE wc.work_id = ?`).bind(id).all(),
        env.DB.prepare('SELECT emotion FROM work_emotions WHERE work_id = ?').bind(id).all(),
        env.DB.prepare(
            `SELECT
                (SELECT COUNT(*) FROM work_reactions WHERE work_id = ? AND reaction = 'like') AS like_count,
                (SELECT COUNT(*) FROM work_reactions WHERE work_id = ? AND reaction = 'dislike') AS dislike_count`
        ).bind(id, id).first(),
        env.DB.prepare('SELECT handle FROM users WHERE id = ?').bind(work.owner_id).first(),
        sessionUser
            ? env.DB.prepare('SELECT reaction FROM work_reactions WHERE work_id = ? AND user_id = ?').bind(id, sessionUser.id).first()
            : null,
    ]);

    const linesByScene = {};
    for (const line of lines.results) {
        (linesByScene[line.scene_id] ||= []).push(line);
    }

    return json({
        ...work,
        emotions: emotions.results.map((e) => e.emotion),
        characters: cast.results,
        scenes: scenes.results.map((s) => ({ ...s, lines: linesByScene[s.id] || [] })),
        like_count: counts.like_count,
        dislike_count: counts.dislike_count,
        my_reaction: myReaction?.reaction ?? null,
        owner_handle: owner?.handle ?? null,
    });
}

// ---------- Auth (Google OAuth + D1 sessions) ----------
// Sign-in is Google-only: no passwords are ever stored. A session is a
// random token whose SHA-256 lives in D1; the cookie carries the raw token.

function bytesToHex(bytes) {
    return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomHex(byteLength) {
    return bytesToHex(crypto.getRandomValues(new Uint8Array(byteLength)));
}

async function sha256Hex(text) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return bytesToHex(new Uint8Array(digest));
}

// Read a single cookie value from the request's Cookie header.
function getCookie(request, name) {
    const header = request.headers.get('Cookie');
    if (!header) return null;
    const match = header.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : null;
}

// A same-origin, non-protocol-relative path: '/foo' is fine, '//evil.com' is
// browser shorthand for a scheme-relative URL and must be rejected.
function isSafeNextPath(path) {
    return typeof path === 'string' && path.startsWith('/') && !path.startsWith('//');
}

// GET /auth/login — send the browser to Google's consent screen.
async function handleAuthLogin(env, url) {
    if (!env.GOOGLE_CLIENT_ID || !env.DB) return json({ error: 'Sign-in not configured' }, 501);

    const state = randomHex(32);
    const params = new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        redirect_uri: `${url.origin}/auth/callback`,
        response_type: 'code',
        scope: 'openid email profile',
        state,
    });

    const headers = new Headers({ 'Location': `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
    headers.append('Set-Cookie', `oauth_state=${state}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=600`);
    // Where to send the browser back after sign-in (e.g. the save-gated page
    // that sent them here). Only same-origin paths are trusted.
    const next = url.searchParams.get('next');
    if (isSafeNextPath(next)) {
        headers.append('Set-Cookie', `oauth_next=${encodeURIComponent(next)}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=600`);
    }

    return new Response(null, { status: 302, headers });
}

// Find or create the user for a Google email. Handles are derived from the
// email's local part; a handle collision gets one retry with a random suffix.
async function upsertUserForEmail(env, email) {
    const existing = await env.DB.prepare('SELECT id, handle, email FROM users WHERE email = ?').bind(email).first();
    if (existing) return existing;

    const id = `u_${crypto.randomUUID()}`;
    const local = email.split('@')[0].toLowerCase().replace(/[^a-z0-9_-]/g, '');
    const handle = local || 'user';
    const now = Math.floor(Date.now() / 1000);

    try {
        await env.DB.prepare(
            'INSERT INTO users (id, handle, email, created_at) VALUES (?, ?, ?, ?)'
        ).bind(id, handle, email, now).run();
        return { id, handle, email };
    } catch (error) {
        // handle already taken — retry once with a short random suffix
        const suffixed = `${handle}-${randomHex(2)}`;
        await env.DB.prepare(
            'INSERT INTO users (id, handle, email, created_at) VALUES (?, ?, ?, ?)'
        ).bind(id, suffixed, email, now).run();
        return { id, handle: suffixed, email };
    }
}

// GET /auth/callback — exchange the code, upsert the user, start a session.
async function handleAuthCallback(env, request, url) {
    if (!env.GOOGLE_CLIENT_ID || !env.DB) return json({ error: 'Sign-in not configured' }, 501);

    const state = url.searchParams.get('state');
    const code = url.searchParams.get('code');
    if (!state || state !== getCookie(request, 'oauth_state')) {
        return json({ error: 'OAuth state mismatch — start again at /auth/login' }, 400);
    }

    const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            code,
            client_id: env.GOOGLE_CLIENT_ID,
            client_secret: env.GOOGLE_CLIENT_SECRET,
            redirect_uri: `${url.origin}/auth/callback`,
            grant_type: 'authorization_code',
        }),
    });
    if (!tokenResp.ok) {
        console.error('Google token exchange failed:', tokenResp.status, await tokenResp.text());
        return json({ error: 'Google sign-in failed' }, 502);
    }

    const { id_token: idToken } = await tokenResp.json();
    // Decode the JWT payload only — no signature check. The token came
    // straight from Google's token endpoint over TLS, so its origin is
    // already authenticated.
    const payload = JSON.parse(atob(idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    // sub and name aren't persisted — users has no matching columns yet.
    const { sub, email, name, email_verified: emailVerified } = payload;

    if (!email || emailVerified === false) {
        return json({ error: 'Google account has no verified email' }, 403);
    }

    const user = await upsertUserForEmail(env, email);

    const rawToken = randomHex(32);
    const tokenHash = await sha256Hex(rawToken);
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + 30 * 24 * 60 * 60;
    await env.DB.prepare(
        'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
    ).bind(tokenHash, user.id, now, expiresAt).run();

    const rawNext = getCookie(request, 'oauth_next');
    const next = isSafeNextPath(rawNext) ? rawNext : '/';

    const headers = new Headers({ 'Location': next });
    headers.append('Set-Cookie', `session=${rawToken}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=2592000`);
    headers.append('Set-Cookie', 'oauth_state=; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=0');
    headers.append('Set-Cookie', 'oauth_next=; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=0');
    return new Response(null, { status: 302, headers });
}

// Resolve the signed-in user (or null) from the `session` cookie.
async function getSessionUser(env, request) {
    if (!env.DB) return null;
    const raw = getCookie(request, 'session');
    if (!raw) return null;

    const tokenHash = await sha256Hex(raw);
    const now = Math.floor(Date.now() / 1000);
    const user = await env.DB.prepare(
        `SELECT u.id, u.handle, u.email FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > ?`
    ).bind(tokenHash, now).first();
    return user || null;
}

// GET /api/me
async function handleMe(env, request) {
    if (!env.DB) return json({ error: 'Database not configured' }, 501);
    return json({ user: await getSessionUser(env, request) });
}

// POST /auth/logout — always succeeds; clears the cookie either way.
async function handleAuthLogout(env, request) {
    const raw = getCookie(request, 'session');
    if (raw && env.DB) {
        await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256Hex(raw)).run();
    }
    const headers = new Headers({ 'Content-Type': 'application/json' });
    headers.append('Set-Cookie', 'session=; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=0');
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}

// DELETE /api/me — permanently delete the signed-in account and everything
// it owns. One batch, FK-safe order: animations (covers renders the user
// made on other people's works, since animations.owner_id is the renderer
// not the work owner) before works (whose scenes/emotions/cast rows cascade
// via ON DELETE CASCADE, and which also cascade-delete animations rendered
// BY OTHERS on the user's own works), then the user's other owned rows,
// then sessions, then the user row itself. 'lisa' and 'guest' are reserved
// system users with no sessions, so they can never reach this handler.
async function handleDeleteMe(env, request) {
    if (!env.DB) return json({ error: 'Database not configured' }, 501);

    const sessionUser = await getSessionUser(env, request);
    if (!sessionUser) return json({ error: 'Not signed in' }, 401);

    const uid = sessionUser.id;
    await env.DB.batch([
        env.DB.prepare('DELETE FROM animations WHERE owner_id = ?').bind(uid),
        env.DB.prepare('DELETE FROM works WHERE owner_id = ?').bind(uid),
        env.DB.prepare('DELETE FROM characters WHERE owner_id = ?').bind(uid),
        env.DB.prepare('DELETE FROM settings WHERE owner_id = ?').bind(uid),
        env.DB.prepare('DELETE FROM voices WHERE owner_id = ?').bind(uid),
        env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(uid),
        env.DB.prepare('DELETE FROM users WHERE id = ?').bind(uid),
    ]);

    const headers = new Headers({ 'Content-Type': 'application/json' });
    headers.append('Set-Cookie', 'session=; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=0');
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}

// ---------- Media storage (R2) ----------

// Decode a data:image/... URL and store it in the MEDIA bucket.
// Returns the /media/<key> path the worker serves it back from.
async function storeDataUrl(env, dataUrl, keyBase) {
    const match = /^data:(image\/(png|jpeg|webp));base64,(.+)$/.exec(dataUrl);
    if (!match) throw new Error('Unsupported data URL');
    const [, contentType, ext, b64] = match;

    const binary = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    if (binary.length > 8 * 1024 * 1024) throw new Error('Image too large (max 8 MB)');

    const key = `${keyBase}.${ext === 'jpeg' ? 'jpg' : ext}`;
    await env.MEDIA.put(key, binary, { httpMetadata: { contentType } });
    return `/media/${key}`;
}

// GET /media/* — serve R2 objects (covers now; audio/clips later).
async function handleMedia(env, path) {
    if (!env.MEDIA) return json({ error: 'Media storage not configured' }, 501);
    const key = decodeURIComponent(path.slice('/media/'.length));
    const object = await env.MEDIA.get(key);
    if (!object) return json({ error: 'Not found' }, 404);
    return new Response(object.body, {
        headers: {
            'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
            'Cache-Control': 'public, max-age=31536000, immutable',
        },
    });
}

// POST /api/works — persist a generated story into the library.
// Saving requires a signed-in owner. The 'guest' system user (migration
// 0004) is legacy-only now: existing guest-owned rows keep working, but
// nothing new is written there — a logged-out visitor gets a 401 instead.
// Ownership: `ownerId` below is always the session user, so a story
// generated from someone's prompt and saved while they're logged in is
// owned by them, full stop — never by 'lisa'. The 'lisa' owner_id is
// reserved for the seed/built-in rows from migrations 0001-0002; nothing
// in this handler can ever write it.
async function handleCreateWork(env, request, body) {
    if (!env.DB) return json({ error: 'Database not configured' }, 501);

    const sessionUser = await getSessionUser(env, request);
    if (!sessionUser) return json({ error: 'Log in to save stories' }, 401);
    const ownerId = sessionUser.id;
    const allowedVisibility = ['private', 'unlisted', 'public'];

    const {
        kind = 'story',
        title,
        genre = null,
        language = 'en',
        length = null,
        visibility = 'public',
        emotions = [],
        scenes = [],
        cover_image_url = null,
    } = body || {};

    if (kind !== 'story') return json({ error: "Only kind 'story' can be saved for now" }, 400);
    if (typeof title !== 'string' || !title.trim()) return json({ error: 'A title is required' }, 400);
    if (!allowedVisibility.includes(visibility)) {
        return json({ error: "visibility must be 'private', 'unlisted', or 'public'" }, 400);
    }
    if (!Array.isArray(scenes) || scenes.length === 0) return json({ error: 'At least one scene is required' }, 400);
    if (scenes.length > 50) return json({ error: 'Too many scenes (max 50)' }, 400);
    for (const s of scenes) {
        if (!s || typeof s.display_text !== 'string' || !s.display_text.trim()) {
            return json({ error: 'Every scene needs display_text' }, 400);
        }
        if (s.display_text.length > 10000 || (s.narration_text || '').length > 12000) {
            return json({ error: 'Scene text too long' }, 400);
        }
    }

    // Real URLs / static paths persist as-is. Generated covers arrive as
    // multi-MB base64 data URLs: with an R2 binding they're uploaded and the
    // row stores a small /media/... path; without one they're dropped (a
    // data URL in a D1 row is the expensive mistake).
    const keepUrl = (u) =>
        typeof u === 'string' && (/^https?:\/\//.test(u) || u.startsWith('images/') || u.startsWith('/media/')) ? u : null;

    const known = new Set(
        (await env.DB.prepare('SELECT name FROM emotions').all()).results.map((e) => e.name)
    );
    const emotionTags = [...new Set(emotions)].filter((e) => known.has(e));

    const workId = `w_${crypto.randomUUID()}`;
    const now = Math.floor(Date.now() / 1000);
    const lengths = ['very_short', 'short', 'medium', 'long'];

    // Upload a data-URL cover to R2 and reference it by path instead.
    let coverUrl = keepUrl(cover_image_url);
    if (!coverUrl && env.MEDIA && typeof cover_image_url === 'string' && cover_image_url.startsWith('data:image/')) {
        try {
            coverUrl = await storeDataUrl(env, cover_image_url, `covers/${workId}`);
        } catch (error) {
            console.error('Cover upload to R2 failed, saving without cover:', error.message);
        }
    }

    const statements = [
        env.DB.prepare(
            `INSERT INTO works (id, owner_id, kind, title, genre, language, length, source, visibility, cover_image_url, created_at)
             VALUES (?, ?, 'story', ?, ?, ?, ?, 'user', ?, ?, ?)`
        ).bind(
            workId,
            ownerId,
            title.trim().slice(0, 200),
            genre ? String(genre).trim().slice(0, 40).toLowerCase() : null,
            String(language).slice(0, 10),
            lengths.includes(length) ? length : null,
            visibility,
            coverUrl,
            now
        ),
        ...scenes.map((s, i) =>
            env.DB.prepare(
                `INSERT INTO scenes (id, work_id, idx, display_text, narration_text, image_prompt, image_url)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`
            ).bind(
                `sc_${crypto.randomUUID()}`,
                workId,
                i,
                s.display_text.trim(),
                s.narration_text ? String(s.narration_text).trim() : null,
                s.image_prompt ? String(s.image_prompt).slice(0, 2000) : null,
                keepUrl(s.image_url)
            )
        ),
        ...emotionTags.map((e) =>
            env.DB.prepare('INSERT INTO work_emotions (work_id, emotion) VALUES (?, ?)').bind(workId, e)
        ),
    ];

    await env.DB.batch(statements);
    return json({ id: workId, visibility }, 201);
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const path = url.pathname;
        const method = request.method;

        try {
            // maxRetries: the SDK retries transient failures (429 rate limit,
            // 529 overloaded, 5xx) with exponential backoff before giving up.
            const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 5 });
            if (method === 'POST') {
                const body = await request.json().catch(() => ({}));

                if (path === '/definition') return await handleDefinition(env, anthropic, body.word);
                if (path === '/translate') return await handleTranslate(env, anthropic, body);
                if (path === '/generate-speech' || path === '/api/synthesize-speech') {
                    return await handleSpeech(env, body);
                }
                if (path === '/generate-story') return await handleGenerateStory(env, anthropic, body);
                if (path === '/api/works') return await handleCreateWork(env, request, body);
                if (path.startsWith('/api/works/') && path.endsWith('/view')) {
                    const id = decodeURIComponent(path.slice('/api/works/'.length, -'/view'.length));
                    return await handleTrackView(env, id, await getSessionUser(env, request));
                }
                if (path.startsWith('/api/works/') && path.endsWith('/reaction')) {
                    const id = decodeURIComponent(path.slice('/api/works/'.length, -'/reaction'.length));
                    return await handleReaction(env, id, await getSessionUser(env, request), body);
                }
                if (path === '/auth/logout') return await handleAuthLogout(env, request);
            }

            if (method === 'PATCH') {
                if (path.startsWith('/api/works/')) {
                    const body = await request.json().catch(() => ({}));
                    const id = decodeURIComponent(path.slice('/api/works/'.length));
                    return await handleUpdateWork(env, id, await getSessionUser(env, request), body);
                }
            }

            if (method === 'DELETE') {
                if (path === '/api/me') return await handleDeleteMe(env, request);
                if (path.startsWith('/api/works/')) {
                    const id = decodeURIComponent(path.slice('/api/works/'.length));
                    return await handleDeleteWork(env, id, await getSessionUser(env, request));
                }
            }

            if (method === 'GET') {
                if (path.startsWith('/media/')) return await handleMedia(env, path);
                if (path.startsWith('/s/')) {
                    return await handleSharePage(env, url, decodeURIComponent(path.slice('/s/'.length)));
                }
                if (path === '/api/works') return await handleListWorks(env, url, await getSessionUser(env, request));
                if (path === '/api/me/works') return await handleMyWorks(env, await getSessionUser(env, request));
                if (path === '/api/me/recommendations') return await handleRecommendations(env, await getSessionUser(env, request));
                if (path.startsWith('/api/works/') && path.endsWith('/narration')) {
                    const id = decodeURIComponent(path.slice('/api/works/'.length, -'/narration'.length));
                    return await handleGetNarration(env, id, url.searchParams.get('voice'), await getSessionUser(env, request));
                }
                if (path.startsWith('/api/works/')) {
                    return await handleGetWork(
                        env,
                        decodeURIComponent(path.slice('/api/works/'.length)),
                        await getSessionUser(env, request)
                    );
                }
                if (path.startsWith('/definition/')) {
                    const word = decodeURIComponent(path.slice('/definition/'.length));
                    return await handleDefinition(env, anthropic, word);
                }
                if (path === '/auth/login') return await handleAuthLogin(env, url);
                if (path === '/auth/callback') return await handleAuthCallback(env, request, url);
                if (path === '/api/me') return await handleMe(env, request);
            }

            return json({ error: 'Not found' }, 404);
        } catch (error) {
            console.error(`Error handling ${method} ${path}:`, error);
            const detail = String(error?.message || error);
            // Anthropic overload/rate-limit that survived the SDK's retries:
            // tell the user it's temporary rather than "Internal error".
            if (/overloaded|529|rate.?limit|429/i.test(detail)) {
                return json({
                    error: "Lisa's AI is very popular right now — please try again in a minute.",
                    detail,
                    retryable: true,
                }, 503);
            }
            // Surface the underlying cause so failures are debuggable from the
            // browser Network tab (no key material is ever in these messages).
            return json({ error: 'Internal error', detail }, 500);
        }
    },
};
