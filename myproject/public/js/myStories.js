// My Stories — the signed-in user's shelf. Private stories stay hidden
// until the "Show private stories" checkbox is ticked; a recommendations
// rail (built from opens, searches, and likes) sits underneath.
(function () {
    let me = null;
    let myWorks = [];

    function renderMine() {
        const grid = document.getElementById('my-story-list');
        const showPrivate = document.getElementById('showPrivate').checked;
        grid.innerHTML = '';

        const visible = myWorks.filter((w) => showPrivate || w.visibility !== 'private');
        if (!visible.length) {
            const empty = document.createElement('p');
            empty.className = 'library-empty';
            empty.textContent = myWorks.length
                ? 'All your stories here are private — tick “Show private stories” to see them.'
                : "You haven't saved any stories yet — create one and it will appear here.";
            grid.appendChild(empty);
            return;
        }
        visible.forEach((work) =>
            LisaCards.buildWorkCard(grid, work, {
                me: me,
                badge: true,
                onChanged: (kind, changed) => {
                    if (kind === 'deleted') {
                        myWorks = myWorks.filter((w) => w.id !== changed.id);
                        renderMine();
                    }
                    if (kind === 'visibility') renderMine();
                },
            })
        );
    }

    async function loadRecommendations() {
        try {
            const resp = await fetch('/api/me/recommendations');
            if (!resp.ok) return;
            const { works } = await resp.json();
            if (!works || !works.length) return;
            const section = document.getElementById('recommended-section');
            const grid = document.getElementById('rec-list');
            section.classList.remove('hidden');
            works.forEach((work) => LisaCards.buildWorkCard(grid, work, { me: me }));
        } catch (error) {
            console.warn('Recommendations unavailable:', error);
        }
    }

    async function init() {
        me = window.lisaMePromise ? await window.lisaMePromise : null;

        if (!me) {
            document.getElementById('mystories-gate').classList.remove('hidden');
            return;
        }

        document.getElementById('mystories-controls').classList.remove('hidden');
        document.getElementById('showPrivate').addEventListener('change', renderMine);

        try {
            const resp = await fetch('/api/me/works');
            if (!resp.ok) throw new Error(`My works API ${resp.status}`);
            ({ works: myWorks = [] } = await resp.json());
        } catch (error) {
            console.error('Could not load your stories:', error);
            myWorks = [];
        }
        renderMine();
        loadRecommendations();
    }

    document.addEventListener('DOMContentLoaded', () => {
        init().catch((error) => console.error('My Stories failed to load:', error));

        // Nav plumbing shared with the other pages (language + translate toggle)
        const nativeLanguage = document.getElementById('nativeLanguage');
        const otherLanguageInput = document.getElementById('otherLanguage');
        nativeLanguage.addEventListener('change', function () {
            otherLanguageInput.classList.toggle('hidden', this.value !== 'other');
            if (this.value === 'other') otherLanguageInput.focus();
        });
        document.getElementById('translation-toggle').addEventListener('click', function () {
            this.classList.toggle('active');
        });
    });
})();
