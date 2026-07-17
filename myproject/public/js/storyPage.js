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

// ---------- Reader controls ----------

document.addEventListener('DOMContentLoaded', function () {
    renderStory().catch((error) => console.error('Error loading story:', error));

    const voiceDropdown = document.getElementById('voiceDropdown');
    const readButton = document.getElementById('readButton');
    const recordButton = document.getElementById('recordButton');
    const translateButton = document.getElementById('translateButton');

    readButton.addEventListener('click', async function () {
        if (!currentStoryData) return;
        const text = `${currentStoryData.title}. ${currentStoryData.narration}`;
        readButton.disabled = true;
        try {
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
