// Lisa 1000 API — Cloudflare Worker
// Static files in ../public are served by the assets binding; requests that
// don't match a file (and all POSTs) land here.
//
// Secrets come from `env`:
//   ANTHROPIC_API_KEY    Claude (stories, definitions, translation)
//   ELEVENLABS_API_KEY   text-to-speech (streaming narration)
//   OPENAI_API_KEY       images + TTS fallback when ElevenLabs is unavailable
//   HF_CREDENTIALS       Higgsfield "KEY_ID:KEY_SECRET" (story illustrations)

import Anthropic from '@anthropic-ai/sdk';

// Primary text model: OpenAI's best value tier (strong quality, low cost).
// Swap to 'gpt-5' for maximum quality or 'gpt-5-nano' for minimum cost.
const OPENAI_TEXT_MODEL = 'gpt-5-mini';
// Fallback text model when OpenAI errors out.
const CLAUDE_MODEL = 'claude-sonnet-5'; // swap to 'claude-haiku-4-5' (cheaper) or 'claude-opus-4-8' (higher quality)
const HIGGSFIELD_BASE = 'https://platform.higgsfield.ai';

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
    const plain = text.replace(/\[[^\]\n]{2,30}\]\s*/g, '');
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

// OpenAI GPT Image text-to-image (current image provider).
// GPT Image models return base64, not a hosted URL, so we hand back a data URL.
// House art style for every illustration — matches the original 10 story
// covers. The model supplies only the scene; the style is enforced here.
const IMAGE_STYLE_PREFIX =
    "Children's storybook illustration, warm whimsical hand-painted style, " +
    'soft colors, gentle light, painterly gouache texture, cozy and friendly: ';

async function generateIllustrationOpenAI(env, prompt) {
    const resp = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: 'gpt-image-2', prompt: IMAGE_STYLE_PREFIX + prompt, size: '1024x1024' }),
    });
    if (!resp.ok) {
        throw new Error(`OpenAI image generation failed (${resp.status}): ${await resp.text()}`);
    }
    const data = await resp.json();
    const b64 = data.data?.[0]?.b64_json;
    if (!b64) throw new Error('OpenAI image generation returned no image data');
    return `data:image/png;base64,${b64}`;
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

    let job = await submit.json();
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

const STORY_SYSTEM_PROMPT =
    'LISA 1000 is a language-learning product for young children and educators. Everything you write MUST be appropriate for children aged 4-10: kind, gentle, and positive, with simple vocabulary. Absolutely no violence, horror, romance, or adult themes. If the request asks for unsuitable content, do not refuse — instead write a gentle, age-appropriate story on the nearest safe theme. ' +
    'You are a helpful assistant designed to write short stories. Output plain text in exactly this format: title|story|narration|imagePrompt. ' +
    'The title is a short, evocative story title (a few words, no quotes). ' +
    'The story is the clean text shown to the reader. It must NOT repeat the title. ' +
    'The narration is the SAME story with inline emotional delivery cues in square brackets placed before the phrases they affect — e.g. [warmly], [excited], [whispers], [sighs], [laughs] — for an expressive text-to-speech narrator. ' +
    'The imagePrompt describes only the SCENE to illustrate (characters, setting, moment) — no art style, which is applied automatically. ' +
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

    const imageUrl = await generateIllustrationOpenAI(env, (imagePrompt || story).substring(0, 1000));
    return json({ title, story, narration, imageUrl });
}

// ---------- Works API (D1 — schema in docs/SCHEMA.md) ----------

// GET /api/works?kind=&genre=&owner=&emotion=&character=
// Library listing with every filter from the schema's feature->query map.
async function handleListWorks(env, url) {
    if (!env.DB) return json({ error: 'Database not configured' }, 501);

    const p = url.searchParams;
    // Listings only ever show public works. Once auth ships this becomes
    // (visibility = 'public' OR owner_id = :viewer); 'unlisted' works are
    // reachable by direct id but never listed; 'private' never leaves the DB.
    const where = ["w.visibility = 'public'"];
    const binds = [];

    if (p.get('kind'))  { where.push('w.kind = ?');     binds.push(p.get('kind')); }
    if (p.get('genre')) { where.push('w.genre = ?');    binds.push(p.get('genre')); }
    if (p.get('owner')) { where.push('w.owner_id = ?'); binds.push(p.get('owner')); }
    if (p.get('emotion')) {
        where.push('EXISTS (SELECT 1 FROM work_emotions we WHERE we.work_id = w.id AND we.emotion = ?)');
        binds.push(p.get('emotion'));
    }
    if (p.get('character')) {
        where.push(`EXISTS (SELECT 1 FROM work_characters wc
                            JOIN characters c ON c.id = wc.character_id
                            WHERE wc.work_id = w.id AND c.name = ? COLLATE NOCASE)`);
        binds.push(p.get('character'));
    }

    const sql = `
        SELECT w.id, w.kind, w.title, w.genre, w.language, w.length, w.owner_id,
               w.cover_image_url, w.created_at,
               (SELECT s.display_text FROM scenes s
                WHERE s.work_id = w.id ORDER BY s.idx LIMIT 1) AS excerpt,
               (SELECT GROUP_CONCAT(we.emotion) FROM work_emotions we
                WHERE we.work_id = w.id) AS emotions
        FROM works w
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY w.created_at DESC, w.id
        LIMIT 100`;

    const { results } = await env.DB.prepare(sql).bind(...binds).all();
    return json({
        works: results.map((r) => ({ ...r, emotions: r.emotions ? r.emotions.split(',') : [] })),
    });
}

// GET /api/works/:id — full work: scenes (with lines), cast, emotions.
async function handleGetWork(env, id) {
    if (!env.DB) return json({ error: 'Database not configured' }, 501);

    // Direct fetch serves public AND unlisted (share links); private works are
    // indistinguishable from missing ones until auth can prove ownership.
    const work = await env.DB.prepare(
        "SELECT * FROM works WHERE id = ? AND visibility IN ('public','unlisted')"
    ).bind(id).first();
    if (!work) return json({ error: 'Work not found' }, 404);

    const [scenes, lines, cast, emotions] = await Promise.all([
        env.DB.prepare('SELECT * FROM scenes WHERE work_id = ? ORDER BY idx').bind(id).all(),
        env.DB.prepare(`SELECT sl.* FROM scene_lines sl
                        JOIN scenes s ON s.id = sl.scene_id
                        WHERE s.work_id = ? ORDER BY s.idx, sl.idx`).bind(id).all(),
        env.DB.prepare(`SELECT c.*, wc.role FROM work_characters wc
                        JOIN characters c ON c.id = wc.character_id
                        WHERE wc.work_id = ?`).bind(id).all(),
        env.DB.prepare('SELECT emotion FROM work_emotions WHERE work_id = ?').bind(id).all(),
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
    });
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
// Pre-auth, works are owned by the 'guest' system user; the client offers
// 'public' or 'unlisted'. 'private' arrives with accounts (a private guest
// work would be orphaned — nobody could ever retrieve it).
async function handleCreateWork(env, body) {
    if (!env.DB) return json({ error: 'Database not configured' }, 501);

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
    if (!['public', 'unlisted'].includes(visibility)) {
        return json({ error: "visibility must be 'public' or 'unlisted' (private works arrive with accounts)" }, 400);
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
             VALUES (?, 'guest', 'story', ?, ?, ?, ?, 'user', ?, ?, ?)`
        ).bind(
            workId,
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
                if (path === '/api/works') return await handleCreateWork(env, body);
            }

            if (method === 'GET') {
                if (path.startsWith('/media/')) return await handleMedia(env, path);
                if (path === '/api/works') return await handleListWorks(env, url);
                if (path.startsWith('/api/works/')) {
                    return await handleGetWork(env, decodeURIComponent(path.slice('/api/works/'.length)));
                }
                if (path.startsWith('/definition/')) {
                    const word = decodeURIComponent(path.slice('/definition/'.length));
                    return await handleDefinition(env, anthropic, word);
                }
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
