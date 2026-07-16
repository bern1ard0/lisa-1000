document.addEventListener('DOMContentLoaded', function() {
    fetch('data/stories.json')  // Adjusted path assuming 'stories.json' is in 'public/data'
        .then(response => response.json())
        .then(stories => {
            const mainElement = document.getElementById('story-list');
            stories.sort((a, b) => a.id - b.id).forEach(story => {
                const card = document.createElement('div');
                card.className = 'story-card';

                // Cover image, with a lettered placeholder if the file is missing
                const cover = document.createElement('img');
                cover.src = story.image || '';
                cover.alt = `${story.title} cover`;
                cover.loading = 'lazy';
                cover.onerror = function() {
                    const placeholder = document.createElement('div');
                    placeholder.className = 'cover-placeholder';
                    placeholder.textContent = story.title.charAt(0);
                    this.replaceWith(placeholder);
                };
                card.appendChild(cover);

                const body = document.createElement('div');
                body.className = 'card-body';

                const heading = document.createElement('h2');
                heading.textContent = story.title;

                const excerpt = story.content.substring(0, 150) + '...';
                const text = document.createElement('p');
                text.textContent = excerpt;

                const button = document.createElement('button');
                button.textContent = 'Read More';
                button.addEventListener('click', () => {
                    const expanded = card.classList.toggle('expanded');
                    text.textContent = expanded ? story.content : excerpt;
                    button.textContent = expanded ? 'Show Less' : 'Read More';
                });

                body.appendChild(heading);
                body.appendChild(text);
                body.appendChild(button);
                card.appendChild(body);
                mainElement.appendChild(card);
            });
        })
        .catch(error => {
            console.error('Error loading the stories:', error);
        });
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