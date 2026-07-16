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

async function defineWithClaude(anthropic, word) {
    const message = await anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 1024,
        system: 'You are a Dictionary that provides definitions for words in a simple and clear manner plus example use case. You return In Dictionary Format.',
        messages: [{ role: 'user', content: `Define the word "${word}".` }],
    });
    return { word, definition: claudeText(message), phonetic: '', audioUrl: '', meanings: [], source: 'claude' };
}

async function handleDefinition(anthropic, word) {
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

    return json(await defineWithClaude(anthropic, word));
}

async function handleTranslate(anthropic, body) {
    const { text, targetLanguage } = body;
    if (!text || !targetLanguage) {
        return json({ error: 'Text or target language not provided' }, 400);
    }

    const message = await anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 8192,
        system: 'You are a helpful assistant that translates text. Reply with the translation only — no preamble.',
        messages: [{ role: 'user', content: `Translate the following text to ${targetLanguage}: ${text}` }],
    });

    return json({ translatedText: claudeText(message) });
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
    'You are a helpful assistant designed to write short stories. Output plain text in exactly this format: story|narration|imagePrompt. ' +
    'The story is the clean text shown to the reader. ' +
    'The narration is the SAME story with inline emotional delivery cues in square brackets placed before the phrases they affect — e.g. [warmly], [excited], [whispers], [sighs], [laughs] — for an expressive text-to-speech narrator. ' +
    'The imagePrompt is a highly detailed illustration prompt for the story. ' +
    'Output exactly two "|" characters separating the three parts, and nothing else.';

async function handleGenerateStory(env, anthropic, body) {
    const prompt = body.prompt;
    if (!prompt) return json({ error: 'No prompt provided' }, 400);

    const message = await anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 8192,
        system: STORY_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt }],
    });

    const parts = claudeText(message).split('|').map((part) => part.trim());
    // Expected: [story, narration, imagePrompt] — tolerate a missing narration part.
    const story = parts[0] || '';
    const narration = parts.length >= 3 ? parts[1] : story;
    const imagePrompt = parts[parts.length - 1] || '';

    const imageUrl = await generateIllustrationOpenAI(env, (imagePrompt || story).substring(0, 1000));
    return json({ story, narration, imageUrl });
}

// ---------- Works API (D1 — schema in docs/SCHEMA.md) ----------

// GET /api/works?kind=&genre=&owner=&emotion=&character=
// Library listing with every filter from the schema's feature->query map.
async function handleListWorks(env, url) {
    if (!env.DB) return json({ error: 'Database not configured' }, 501);

    const p = url.searchParams;
    const where = [];
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

    const work = await env.DB.prepare('SELECT * FROM works WHERE id = ?').bind(id).first();
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

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const path = url.pathname;
        const method = request.method;

        try {
            const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
            if (method === 'POST') {
                const body = await request.json().catch(() => ({}));

                if (path === '/definition') return await handleDefinition(anthropic, body.word);
                if (path === '/translate') return await handleTranslate(anthropic, body);
                if (path === '/generate-speech' || path === '/api/synthesize-speech') {
                    return await handleSpeech(env, body);
                }
                if (path === '/generate-story') return await handleGenerateStory(env, anthropic, body);
            }

            if (method === 'GET') {
                if (path === '/api/works') return await handleListWorks(env, url);
                if (path.startsWith('/api/works/')) {
                    return await handleGetWork(env, decodeURIComponent(path.slice('/api/works/'.length)));
                }
                if (path.startsWith('/definition/')) {
                    const word = decodeURIComponent(path.slice('/definition/'.length));
                    return await handleDefinition(anthropic, word);
                }
            }

            return json({ error: 'Not found' }, 404);
        } catch (error) {
            console.error(`Error handling ${method} ${path}:`, error);
            // Surface the underlying cause so failures are debuggable from the
            // browser Network tab (no key material is ever in these messages).
            return json({ error: 'Internal error', detail: String(error?.message || error) }, 500);
        }
    },
};
