// Card rendering lives in js/cards.js (LisaCards.buildWorkCard) — shared
// with the My Stories page so both grids stay identical.

// Signed-in viewer (or null), shared from auth.js — gates reactions and
// unlocks the owner options in each card's ⋮ menu.
let libraryMe = null;
// Last fetched result set, re-sorted client-side when the sort changes.
let lastWorks = [];

function sortWorks(works) {
    const mode = document.getElementById('librarySort')?.value || 'recommended';
    if (mode === 'recommended') return works; // server order: top-viewed pinned, then most liked
    const sorted = [...works];
    if (mode === 'newest') sorted.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    if (mode === 'views') sorted.sort((a, b) => (b.view_count || 0) - (a.view_count || 0));
    if (mode === 'likes') sorted.sort((a, b) => (b.like_count || 0) - (a.like_count || 0));
    return sorted;
}

function anyFilterActive() {
    return Object.values(libraryFilters).some(Boolean);
}

function renderWorks(mainElement, works) {
    lastWorks = works;
    mainElement.innerHTML = '';

    const count = document.getElementById('resultsCount');
    if (count) count.textContent = `${works.length} ${works.length === 1 ? 'story' : 'stories'}`;
    const clear = document.getElementById('clearFilters');
    if (clear) clear.hidden = !anyFilterActive();

    if (!works.length) {
        const empty = document.createElement('p');
        empty.className = 'library-empty';
        empty.textContent = libraryFilters.q
            ? `No stories found for “${libraryFilters.q}” — try another search.`
            : 'No stories match these filters — try widening them.';
        mainElement.appendChild(empty);
        return;
    }
    sortWorks(works).forEach(work => LisaCards.buildWorkCard(mainElement, work, { me: libraryMe }));
}

// Active filter state; empty string = "All" for that group.
const libraryFilters = { owner: '', kind: '', genre: '', emotion: '', q: '' };

async function fetchWorks() {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(libraryFilters)) {
        if (value) params.set(key, value);
    }
    const qs = params.toString();
    const resp = await fetch('/api/works' + (qs ? `?${qs}` : ''));
    if (!resp.ok) throw new Error(`Works API ${resp.status}`);
    return (await resp.json()).works || [];
}

// Fill the genre group with chips for every genre present in the library.
function buildGenreChips(works) {
    const group = document.querySelector('.filter-group[data-param="genre"]');
    const genres = [...new Set(works.map(w => w.genre).filter(Boolean))].sort();
    genres.forEach(genre => {
        const chip = document.createElement('button');
        chip.className = 'chip';
        chip.setAttribute('data-value', genre);
        chip.textContent = genre.charAt(0).toUpperCase() + genre.slice(1);
        group.appendChild(chip);
    });
}

function paintChipStates() {
    document.querySelectorAll('#library-filters .chip').forEach((chip) => {
        chip.setAttribute('aria-pressed', chip.classList.contains('active') ? 'true' : 'false');
    });
}

function activateFilterBar(mainElement) {
    const bar = document.getElementById('library-filters');
    bar.classList.remove('hidden');
    paintChipStates();
    bar.addEventListener('click', async (event) => {
        const chip = event.target.closest('.chip');
        if (!chip) return;
        const group = chip.closest('.filter-group');
        group.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        paintChipStates();
        libraryFilters[group.getAttribute('data-param')] = chip.getAttribute('data-value');
        try {
            renderWorks(mainElement, await fetchWorks());
        } catch (error) {
            console.error('Error filtering stories:', error);
        }
    });

    // Sort re-orders the already-fetched set — no refetch needed.
    const sortSelect = document.getElementById('librarySort');
    if (sortSelect) sortSelect.addEventListener('change', () => renderWorks(mainElement, lastWorks));

    // Clear filters: back to All everywhere, empty search, refetch.
    const clear = document.getElementById('clearFilters');
    if (clear) clear.addEventListener('click', async () => {
        for (const key of Object.keys(libraryFilters)) libraryFilters[key] = '';
        const search = document.getElementById('librarySearch');
        if (search) search.value = '';
        document.querySelectorAll('#library-filters .filter-group').forEach((group) => {
            group.querySelectorAll('.chip').forEach((c) =>
                c.classList.toggle('active', c.getAttribute('data-value') === ''));
        });
        paintChipStates();
        try {
            renderWorks(mainElement, await fetchWorks());
        } catch (error) {
            console.error('Error clearing filters:', error);
        }
    });
}

// Debounced title search — refetches the library as the visitor types.
function activateSearch(mainElement) {
    const input = document.getElementById('librarySearch');
    if (!input) return;
    input.parentElement.classList.remove('hidden');
    let timer = null;
    input.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(async () => {
            libraryFilters.q = input.value.trim();
            try {
                renderWorks(mainElement, await fetchWorks());
            } catch (error) {
                console.error('Error searching stories:', error);
            }
        }, 300);
    });
}

// Works API (D1) first; stories.json as fallback for environments without
// a database (local Express dev, static preview). Filters only appear in
// API mode — the flat JSON has no genre/emotion data to filter on.
async function loadLibrary() {
    const mainElement = document.getElementById('story-list');
    libraryMe = window.lisaMePromise ? await window.lisaMePromise : null;

    try {
        const works = await fetchWorks();
        if (works.length) {
            renderWorks(mainElement, works);
            buildGenreChips(works);
            activateFilterBar(mainElement);
            activateSearch(mainElement);
            return;
        }
    } catch (error) {
        console.warn('Works API unavailable, falling back to stories.json:', error);
    }

    const stories = await fetch('data/stories.json').then(r => r.json());
    stories.sort((a, b) => a.id - b.id).forEach(story => LisaCards.buildWorkCard(mainElement, {
        title: story.title,
        cover_image_url: story.image,
        excerpt: story.content,
        sid: story.id,
    }, {}));
}

document.addEventListener('DOMContentLoaded', function() {
    loadLibrary().catch(error => console.error('Error loading the stories:', error));
});
document.addEventListener('DOMContentLoaded', function() {
    const currentPage = window.location.pathname.split('/').pop();
    const navLinks = document.querySelectorAll('.nav-container nav ul li a');

    navLinks.forEach(link => {
        const linkPage = link.getAttribute('href').split('/').pop();
        if (linkPage === currentPage) {
            link.classList.add('current-page');
        }
    });
});

// Function to fetch the definition of a word
async function defineText(word) {
    try {
        const response = await fetch('/definition', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ word: word })
        });
        if (!response.ok) {
            throw new Error(`Server error: ${response.statusText}`);
        }
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Error getting definition:', error);
        return null;
    }
}

// Convert the lightweight markdown Claude returns (## headings, **bold**) to HTML
function formatDefinitionText(text) {
    return (text || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/^#{1,4}\s*(.+)$/gm, '<h4>$1</h4>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\n{2,}/g, '<br>')
        .replace(/\n/g, '<br>')
        .replace(/<\/h4><br>/g, '</h4>');
}

// Build popup HTML for a definition entry (word, phonetic, audio, meanings)
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

// Function to translate text
async function translateText(text, targetLanguage) {
    try {
        const response = await fetch('/translate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ text: text, targetLanguage: targetLanguage })
        });
        const data = await response.json();
        return data.translatedText;
    } catch (error) {
        console.error('Error translating text:', error);
        return null;
    }
}
async function handleDoubleClick() {
    const selectedText = window.getSelection().toString().trim();
    if (selectedText) {
        const translationToggle = document.getElementById('translation-toggle').classList.contains('active');
        if (translationToggle) {
            let targetLanguage = document.getElementById('nativeLanguage').value;
            if (targetLanguage === 'other') {
                targetLanguage = document.getElementById('otherLanguage').value.trim();
            }

            if (targetLanguage && targetLanguage !== 'default') {
                const translation = await translateText(selectedText, targetLanguage);
                if (translation) {
                    showTranslation(selectedText, translation);
                }
            }
        } else {
            const entry = await defineText(selectedText);
            if (entry) {
                showPopup(renderDefinition(entry));
            }
        }
    }
}



// Function to show popup with content
function showPopup(content) {
    const popup = document.createElement('div');
    popup.className = 'popup';
    popup.innerHTML = `
        <div class="popup-content">
            <span class="close-btn">&times;</span>
            ${content}
        </div>
    `;
    document.body.appendChild(popup);

    const closeButton = popup.querySelector('.close-btn');
    closeButton.addEventListener('click', () => {
        popup.remove();
    });
}

// Function to show translation above the selected text
function showTranslation(selectedText, translation) {
    const range = window.getSelection().getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const tooltip = document.createElement('div');
    tooltip.className = 'translation-tooltip';
    tooltip.innerText = translation;
    document.body.appendChild(tooltip);

    tooltip.style.left = `${rect.left + window.scrollX}px`;
    tooltip.style.top = `${rect.top + window.scrollY - tooltip.offsetHeight}px`;

    setTimeout(() => {
        tooltip.remove();
    }, 3000);
}
// Function to translate the entire story
async function translateStory() {
    const storyContent = document.getElementById('story-content').textContent;
    let targetLanguage = document.getElementById('nativeLanguage').value;
    if (targetLanguage === 'other') {
        targetLanguage = document.getElementById('otherLanguage').value.trim();
    }
    if (targetLanguage && targetLanguage !== 'default') {
        const translatedStory = await translateText(storyContent, targetLanguage);
        if (translatedStory) {
            document.getElementById('story-content').textContent = translatedStory;
        }
    }
}


// Event listener for double-click on story content
document.addEventListener('dblclick', handleDoubleClick);

document.addEventListener('DOMContentLoaded', function() {
    const nativeLanguage = document.getElementById('nativeLanguage');
    const otherLanguageInput = document.getElementById('otherLanguage');

    nativeLanguage.addEventListener('change', function() {
        const selectedLanguage = this.value;
        console.log(`Selected language: ${selectedLanguage}`);

        if (selectedLanguage === 'other') {
            otherLanguageInput.classList.remove('hidden');
            otherLanguageInput.focus(); // Focus on the input field for other language
        } else {
            otherLanguageInput.classList.add('hidden');
        }
    });
});

// Event listener for translation toggle
document.getElementById('translation-toggle').addEventListener('click', function() {
    this.classList.toggle('active');
    console.log('Translation toggle:', this.classList.contains('active'));
});

// Event listener for translate button (only present on some pages)
const translateButtonEl = document.getElementById('translateButton');
if (translateButtonEl) {
    translateButtonEl.addEventListener('click', translateStory);
}