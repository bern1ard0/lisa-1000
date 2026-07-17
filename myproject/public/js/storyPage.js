// Dedicated story reader page (story.html?id=<work id> or ?sid=<seed number>).
// Loads one story from the works API — falling back to data/stories.json when
// no database is available — and wires the Read / Record / Translate controls.

// Small toast-style notice (SweetAlert2 when available, alert() otherwise)
function notifyUser(title, text) {
    if (window.Swal) {
        Swal.fire({ icon: 'info', title: title, text: text, confirmButtonColor: '#8B5CF6' });
    } else {
        alert(title + '\n' + text);
    }
}

// ---------- Story loading ----------

async function fetchStory() {
    const params = new URLSearchParams(window.location.search);
    const workId = params.get('id');
    const seedId = params.get('sid');

    if (workId) {
        try {
            const resp = await fetch(`/api/works/${encodeURIComponent(workId)}`);
            if (resp.ok) {
                const work = await resp.json();
                return {
                    id: work.id, // present only for a real saved work — gates the narration cache below
                    title: work.title,
                    cover: work.cover_image_url,
                    paragraphs: (work.scenes || []).map((s) => s.display_text),
                    narration: (work.scenes || []).map((s) => s.narration_text || s.display_text).join('\n'),
                    language: work.language || 'en',
                };
            }
        } catch (error) {
            console.warn('Works API unavailable, trying stories.json fallback:', error);
        }
        // Seed works (w_001..w_010) map onto the flat stories.json entries
        const match = /^w_0*(\d+)$/.exec(workId);
        if (match) return fetchSeedStory(parseInt(match[1], 10));
        return null;
    }

    if (seedId) return fetchSeedStory(parseInt(seedId, 10));
    return null;
}

async function fetchSeedStory(id) {
    const stories = await fetch('data/stories.json').then((r) => r.json());
    const story = stories.find((s) => s.id === id);
    if (!story) return null;
    return {
        title: story.title,
        cover: story.image,
        paragraphs: story.content.split(/\n+/).map((p) => p.trim()).filter(Boolean),
        narration: story.content,
        language: 'en',
    };
}

let currentStoryData = null;

async function renderStory() {
    const titleEl = document.getElementById('story-title');
    const contentEl = document.getElementById('story-content');
    const coverEl = document.getElementById('story-cover');
    const coverBgEl = document.getElementById('story-cover-bg');
    const coverWrapEl = document.getElementById('story-cover-wrap');

    const story = await fetchStory();
    if (!story) {
        titleEl.textContent = 'Story not found';
        contentEl.innerHTML = '<p>This story may be private or no longer exist. <a href="library.html">Browse the Library</a> instead.</p>';
        document.querySelector('.reader-controls').classList.add('hidden');
        return;
    }

    currentStoryData = story;
    window.currentStoryLanguage = story.language;
    document.title = `${story.title} · Lisa 1000`;
    titleEl.textContent = story.title;
    contentEl.innerHTML = story.paragraphs.map((p) => `<p>${p}</p>`).join('');
    if (story.cover) {
        // Full artwork, never cropped: the cover is letterboxed inside a
        // 16:9 frame whose sides are a blurred copy of the same image.
        coverEl.src = story.cover;
        coverBgEl.src = story.cover;
        coverEl.alt = `${story.title} cover`;
        coverWrapEl.classList.remove('hidden');
        coverEl.onerror = () => coverWrapEl.classList.add('hidden');
    }
}

// ---------- Narration cache + word highlighting (saved works only) ----------
// A saved work (has an id) can be narrated once and replayed for free via
// /api/works/:id/narration. Freshly-generated, unsaved stories have no id
// and keep using the live-streaming path in tts.js unchanged.

// Per-page cache so re-clicking Play never refetches even once the server
// cache (D1 + R2) is already warm: workId:voiceKey -> narration response.
const narrationCache = new Map();

// Strip punctuation and case for word matching — "Roxy," and "roxy" match.
function normalizeWord(w) {
    return (w || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

// Zip the displayed words against the timestamped narration words. Narration
// text can diverge slightly from display text (delivery cues, punctuation),
// so this is best-effort: pointers always advance together in lockstep —
// no attempt to re-sync after a mismatch.
function alignWords(displayWords, timestampWords) {
    const n = Math.min(displayWords.length, timestampWords.length);
    const aligned = new Array(displayWords.length).fill(null);
    for (let i = 0; i < n; i++) {
        aligned[i] = timestampWords[i];
    }
    return aligned;
}

// Wrap every word of the rendered story text in a <span>, returning the
// words in reading order (for alignWords) alongside their span elements.
function wrapStoryWordsForHighlight(contentEl) {
    const words = [];
    let idx = 0;
    contentEl.querySelectorAll('p').forEach((p) => {
        p.innerHTML = p.textContent.replace(/\S+/g, (word) => {
            const span = `<span class="story-word" data-w="${idx++}">${word}</span>`;
            words.push(word);
            return span;
        });
    });
    return { words, spans: [...contentEl.querySelectorAll('.story-word')] };
}

// Drive .word-active off audio playback. Word timings are chronological, so
// an advancing pointer (no per-frame re-scan) is enough.
function attachWordHighlighting(audio, spans, aligned) {
    let current = -1;
    const clear = () => { if (current >= 0 && spans[current]) spans[current].classList.remove('word-active'); };
    audio.addEventListener('timeupdate', () => {
        const t = audio.currentTime;
        let next = current;
        while (next + 1 < aligned.length && aligned[next + 1] && t >= aligned[next + 1].s) next++;
        if (next !== current) {
            clear();
            current = next;
            if (current >= 0 && spans[current]) spans[current].classList.add('word-active');
        }
    });
    audio.addEventListener('ended', clear);
}

// Fetch (or reuse) the cached narration for a saved work + voice. Resolves
// null on any failure so the caller falls back to live streaming silently.
async function fetchNarration(workId, voiceKey) {
    const cacheKey = `${workId}:${voiceKey}`;
    if (narrationCache.has(cacheKey)) return narrationCache.get(cacheKey);
    try {
        const resp = await fetch(`/api/works/${encodeURIComponent(workId)}/narration?voice=${encodeURIComponent(voiceKey)}`);
        if (!resp.ok) return null;
        const data = await resp.json();
        narrationCache.set(cacheKey, data);
        return data;
    } catch (error) {
        console.warn('Narration cache unavailable, falling back to streaming:', error);
        return null;
    }
}

// Play a saved work's cached narration, highlighting words as they're
// spoken. Returns false (without throwing) when the cache endpoint fails,
// so the caller can fall back to the streaming path.
async function playCachedNarration(workId, voiceKey) {
    const data = await fetchNarration(workId, voiceKey);
    if (!data || !data.audio_url) return false;

    const audio = new Audio(data.audio_url);
    const words = data.timestamps?.words;
    if (words && words.length) {
        const contentEl = document.getElementById('story-content');
        const { words: displayWords, spans } = wrapStoryWordsForHighlight(contentEl);
        attachWordHighlighting(audio, spans, alignWords(displayWords, words));
    }

    await audio.play();
    await new Promise((resolve) => { audio.onended = resolve; audio.onerror = resolve; });
    return true;
}

// ---------- Reader controls ----------

document.addEventListener('DOMContentLoaded', function () {
    renderStory().catch((error) => console.error('Error loading story:', error));

    const voiceDropdown = document.getElementById('voiceDropdown');
    const readButton = document.getElementById('readButton');
    const recordButton = document.getElementById('recordButton');
    const translateButton = document.getElementById('translateButton');

    readButton.addEventListener('click', async function () {
        if (!currentStoryData) return;
        readButton.disabled = true;
        try {
            // Saved works: try the cache first (instant on replay, highlights
            // words). Any endpoint failure falls through to live streaming.
            if (currentStoryData.id && await playCachedNarration(currentStoryData.id, voiceDropdown.value)) {
                return;
            }
            const text = `${currentStoryData.title}. ${currentStoryData.narration}`;
            await streamSpeech(text, voiceDropdown.value, window.currentStoryLanguage);
        } catch (error) {
            console.error('Error reading story aloud:', error);
            notifyUser('Could not play narration', 'Please try again in a moment.');
        } finally {
            readButton.disabled = false;
        }
    });

    recordButton.addEventListener('click', function () {
        if ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window) {
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            const recognition = new SpeechRecognition();
            recognition.onresult = (event) => {
                const transcript = event.results[0][0].transcript;
                showRecordingModal(transcript);
            };
            recognition.onerror = (event) => console.error('Speech recognition error:', event.error);
            recognition.start();
            notifyUser('Listening…', 'Read a sentence from the story out loud.');
        } else {
            notifyUser('Not supported', 'Speech recognition is not supported in this browser.');
        }
    });

    translateButton.addEventListener('click', async function () {
        const toggleOn = document.getElementById('translation-toggle').classList.contains('active');
        if (!toggleOn) {
            notifyUser('Turn on Translate mode', 'Click the T toggle in the navigation bar to enable translation, then press Translate again.');
            return;
        }
        let targetLanguage = document.getElementById('nativeLanguage').value;
        if (targetLanguage === 'other') {
            targetLanguage = document.getElementById('otherLanguage').value.trim();
        }
        if (!targetLanguage || targetLanguage === 'default') {
            notifyUser('Pick your language', 'Choose your language in the "I speak…" dropdown so we know what to translate into.');
            return;
        }

        const contentEl = document.getElementById('story-content');
        translateButton.disabled = true;
        const originalLabel = translateButton.textContent;
        translateButton.textContent = 'Translating…';
        try {
            const translated = await translateText(contentEl.textContent, targetLanguage);
            if (translated) {
                contentEl.innerHTML = translated.split(/\n+/).map((p) => `<p>${p}</p>`).join('');
                window.currentStoryLanguage = targetLanguage;
                if (currentStoryData) currentStoryData.narration = translated;
            }
        } finally {
            translateButton.disabled = false;
            translateButton.textContent = originalLabel;
        }
    });

    // Language dropdown "Other..." reveal
    const nativeLanguage = document.getElementById('nativeLanguage');
    const otherLanguageInput = document.getElementById('otherLanguage');
    nativeLanguage.addEventListener('change', function () {
        otherLanguageInput.classList.toggle('hidden', this.value !== 'other');
        if (this.value === 'other') otherLanguageInput.focus();
    });

    // Translate-mode toggle
    document.getElementById('translation-toggle').addEventListener('click', function () {
        this.classList.toggle('active');
    });

    // Highlight the Library tab (this page belongs to it)
    document.querySelectorAll('.nav-container nav ul li a').forEach((link) => {
        if (link.getAttribute('href') === 'library.html') link.classList.add('current-page');
    });
});

// Recording playback modal (transcript + synthesis + your own recording)
function showRecordingModal(transcript) {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content">
            <span class="close-btn">&times;</span>
            <h2>You said:</h2>
            <p>${transcript}</p>
            <button id="playSynthesisButton">🔊 Hear it spoken</button>
        </div>`;
    document.body.appendChild(modal);
    modal.style.display = 'block';

    modal.querySelector('.close-btn').addEventListener('click', () => modal.remove());
    modal.querySelector('#playSynthesisButton').addEventListener('click', () => {
        const utterance = new SpeechSynthesisUtterance(transcript);
        window.speechSynthesis.speak(utterance);
    });
}

// ---------- Definitions & translation (double-click) ----------

async function defineText(word) {
    try {
        const response = await fetch('/definition', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ word: word }),
        });
        if (!response.ok) throw new Error(`Server error: ${response.statusText}`);
        return await response.json();
    } catch (error) {
        console.error('Error getting definition:', error);
        return null;
    }
}

// Convert the lightweight markdown the model returns (## headings, **bold**) to HTML
function formatDefinitionText(text) {
    return (text || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/^#{1,4}\s*(.+)$/gm, '<h4>$1</h4>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\n{2,}/g, '<br>')
        .replace(/\n/g, '<br>')
        .replace(/<\/h4><br>/g, '</h4>');
}

function renderDefinition(entry) {
    const meanings = (entry.meanings && entry.meanings.length)
        ? entry.meanings.map(m => `<p><em>${m.partOfSpeech}</em> — ${m.definition}${m.example ? `<br><span class="def-example">"${m.example}"</span>` : ''}</p>`).join('')
        : `<div class="def-body">${formatDefinitionText(entry.definition)}</div>`;
    const audio = entry.audioUrl
        ? `<button class="pronounce-btn" onclick="new Audio('${entry.audioUrl}').play()">🔊 Pronounce</button>`
        : '';
    return `
        <h2>${entry.word || 'Definition'}</h2>
        ${entry.phonetic ? `<p class="phonetic">${entry.phonetic}</p>` : ''}
        ${audio}
        ${meanings}`;
}

async function translateText(text, targetLanguage) {
    try {
        const response = await fetch('/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: text, targetLanguage: targetLanguage }),
        });
        const data = await response.json();
        return data.translatedText;
    } catch (error) {
        console.error('Error translating text:', error);
        return null;
    }
}

function showPopup(content) {
    const popup = document.createElement('div');
    popup.className = 'popup';
    popup.innerHTML = `
        <div class="popup-content">
            <span class="close-btn">&times;</span>
            ${content}
        </div>`;
    document.body.appendChild(popup);
    popup.querySelector('.close-btn').addEventListener('click', () => popup.remove());
}

function showTranslation(selectedText, translation) {
    const range = window.getSelection().getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const tooltip = document.createElement('div');
    tooltip.className = 'translation-tooltip';
    tooltip.innerText = translation;
    document.body.appendChild(tooltip);
    tooltip.style.left = `${rect.left + window.scrollX}px`;
    tooltip.style.top = `${rect.top + window.scrollY - tooltip.offsetHeight}px`;
    setTimeout(() => tooltip.remove(), 3000);
}

document.addEventListener('dblclick', async function () {
    const selectedText = window.getSelection().toString().trim();
    if (!selectedText) return;

    const toggleOn = document.getElementById('translation-toggle').classList.contains('active');
    if (toggleOn) {
        let targetLanguage = document.getElementById('nativeLanguage').value;
        if (targetLanguage === 'other') {
            targetLanguage = document.getElementById('otherLanguage').value.trim();
        }
        if (targetLanguage && targetLanguage !== 'default') {
            const translation = await translateText(selectedText, targetLanguage);
            if (translation) showTranslation(selectedText, translation);
        }
    } else {
        const entry = await defineText(selectedText);
        if (entry) showPopup(renderDefinition(entry));
    }
});
