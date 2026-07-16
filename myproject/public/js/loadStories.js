// Build one library card. `getFullText` is an async () => string used the
// first time the card expands (D1-backed works fetch their scenes on demand).
function buildStoryCard(mainElement, { title, image, excerpt, getFullText }) {
    const card = document.createElement('div');
    card.className = 'story-card';

    // Cover image, with a lettered placeholder if the file is missing
    const cover = document.createElement('img');
    cover.src = image || '';
    cover.alt = `${title} cover`;
    cover.loading = 'lazy';
    cover.onerror = function() {
        const placeholder = document.createElement('div');
        placeholder.className = 'cover-placeholder';
        placeholder.textContent = title.charAt(0);
        this.replaceWith(placeholder);
    };
    card.appendChild(cover);

    const body = document.createElement('div');
    body.className = 'card-body';

    const heading = document.createElement('h2');
    heading.textContent = title;

    const shortText = excerpt.substring(0, 150) + '...';
    const text = document.createElement('p');
    text.textContent = shortText;

    let fullText = null;
    const button = document.createElement('button');
    button.textContent = 'Read More';
    button.addEventListener('click', async () => {
        if (fullText === null) {
            button.disabled = true;
            try { fullText = await getFullText(); } finally { button.disabled = false; }
        }
        const expanded = card.classList.toggle('expanded');
        text.textContent = expanded ? fullText : shortText;
        button.textContent = expanded ? 'Show Less' : 'Read More';
    });

    body.appendChild(heading);
    body.appendChild(text);
    body.appendChild(button);
    card.appendChild(body);
    mainElement.appendChild(card);
}

function renderWorks(mainElement, works) {
    mainElement.innerHTML = '';
    if (!works.length) {
        const empty = document.createElement('p');
        empty.className = 'library-empty';
        empty.textContent = 'No stories match these filters — try widening them.';
        mainElement.appendChild(empty);
        return;
    }
    works.forEach(work => buildStoryCard(mainElement, {
        title: work.title,
        image: work.cover_image_url,
        excerpt: work.excerpt || '',
        getFullText: async () => {
            const full = await fetch(`/api/works/${encodeURIComponent(work.id)}`).then(r => r.json());
            return (full.scenes || []).map(s => s.display_text).join('\n\n');
        },
    }));
}

// Active filter state; empty string = "All" for that group.
const libraryFilters = { owner: '', kind: '', genre: '', emotion: '' };

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

function activateFilterBar(mainElement) {
    const bar = document.getElementById('library-filters');
    bar.classList.remove('hidden');
    bar.addEventListener('click', async (event) => {
        const chip = event.target.closest('.chip');
        if (!chip) return;
        const group = chip.closest('.filter-group');
        group.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        libraryFilters[group.getAttribute('data-param')] = chip.getAttribute('data-value');
        try {
            renderWorks(mainElement, await fetchWorks());
        } catch (error) {
            console.error('Error filtering stories:', error);
        }
    });
}

// Works API (D1) first; stories.json as fallback for environments without
// a database (local Express dev, static preview). Filters only appear in
// API mode — the flat JSON has no genre/emotion data to filter on.
async function loadLibrary() {
    const mainElement = document.getElementById('story-list');

    try {
        const works = await fetchWorks();
        if (works.length) {
            renderWorks(mainElement, works);
            buildGenreChips(works);
            activateFilterBar(mainElement);
            return;
        }
    } catch (error) {
        console.warn('Works API unavailable, falling back to stories.json:', error);
    }

    const stories = await fetch('data/stories.json').then(r => r.json());
    stories.sort((a, b) => a.id - b.id).forEach(story => buildStoryCard(mainElement, {
        title: story.title,
        image: story.image,
        excerpt: story.content,
        getFullText: async () => story.content,
    }));
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