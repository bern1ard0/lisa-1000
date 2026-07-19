// Shared story-card builder used by the Library and My Stories pages.
// Renders one card per work row from the works API: cover, title, excerpt,
// owner tag, view/reaction counts, and a ⋮ menu whose options grow when the
// signed-in viewer owns the story (visibility changes, delete).
window.LisaCards = (function () {
    let openMenu = null;

    function closeMenu() {
        if (openMenu) {
            openMenu.panel.remove();
            openMenu.button.setAttribute('aria-expanded', 'false');
            openMenu = null;
        }
    }
    document.addEventListener('click', closeMenu);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

    function toast(title, text) {
        if (window.Swal) {
            Swal.fire({
                toast: true, position: 'bottom-end', timer: 2600, showConfirmButton: false,
                icon: 'info', title: title, text: text || '',
                background: '#171130', color: '#EDEAF7',
            });
        } else {
            alert(title + (text ? '\n' + text : ''));
        }
    }

    // Small identity chip: LISA 1000's own stories carry the brand mark,
    // everyone else gets an initial-avatar + handle.
    function ownerTag(work) {
        const tag = document.createElement('span');
        tag.className = 'owner-tag';
        const avatar = document.createElement('span');
        avatar.className = 'owner-tag-avatar';
        const isLisa = work.owner_id === 'lisa';
        avatar.textContent = isLisa ? '✦' : (work.owner_handle || '?').charAt(0).toUpperCase();
        if (isLisa) avatar.classList.add('owner-tag-lisa');
        const name = document.createElement('span');
        name.textContent = isLisa ? 'LISA 1000' : (work.owner_handle || 'guest');
        tag.append(avatar, name);
        return tag;
    }

    function reactionBar(work, me) {
        const bar = document.createElement('div');
        bar.className = 'reaction-bar';
        const counts = { like: work.like_count || 0, dislike: work.dislike_count || 0 };
        let mine = work.my_reaction || null;
        const buttons = {};

        function paint() {
            for (const kind of ['like', 'dislike']) {
                buttons[kind].textContent = `${kind === 'like' ? '👍' : '👎'} ${counts[kind]}`;
                buttons[kind].classList.toggle('active', mine === kind);
            }
        }

        for (const kind of ['like', 'dislike']) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'reaction-btn';
            btn.setAttribute('aria-label', kind === 'like' ? 'Like this story' : 'Dislike this story');
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (!me) { toast('Log in to react', 'Reactions need an account.'); return; }
                const next = mine === kind ? null : kind;
                try {
                    const resp = await fetch(`/api/works/${encodeURIComponent(work.id)}/reaction`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ reaction: next }),
                    });
                    if (resp.status === 401) { toast('Log in to react', 'Reactions need an account.'); return; }
                    if (!resp.ok) throw new Error(`Reaction failed (${resp.status})`);
                    const data = await resp.json();
                    counts.like = data.like_count; counts.dislike = data.dislike_count;
                    mine = data.my_reaction;
                    paint();
                } catch (error) {
                    console.error('Could not save reaction:', error);
                }
            });
            buttons[kind] = btn;
            bar.appendChild(btn);
        }
        paint();
        return bar;
    }

    function menuItem(label, onClick, danger) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'card-menu-item' + (danger ? ' card-menu-danger' : '');
        item.textContent = label;
        item.addEventListener('click', (e) => { e.stopPropagation(); closeMenu(); onClick(); });
        return item;
    }

    function kebab(work, me, card, onChanged) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'card-kebab';
        button.setAttribute('aria-label', 'Story options');
        button.setAttribute('aria-haspopup', 'true');
        button.setAttribute('aria-expanded', 'false');
        button.textContent = '⋮';

        button.addEventListener('click', (e) => {
            e.stopPropagation();
            if (openMenu && openMenu.button === button) { closeMenu(); return; }
            closeMenu();

            const panel = document.createElement('div');
            panel.className = 'card-menu';
            panel.addEventListener('click', (e2) => e2.stopPropagation());

            panel.appendChild(menuItem('📖 Read', () => {
                window.location.href = `story.html?id=${encodeURIComponent(work.id)}`;
            }));
            if (work.visibility === 'public' || work.visibility === 'unlisted') {
                panel.appendChild(menuItem('🔗 Copy link', async () => {
                    const url = `${window.location.origin}/s/${encodeURIComponent(work.id)}`;
                    try {
                        await navigator.clipboard.writeText(url);
                        toast('Link copied');
                    } catch (error) {
                        prompt('Copy this link:', url);
                    }
                }));
            }

            if (me && me.id === work.owner_id) {
                const divider = document.createElement('hr');
                divider.className = 'card-menu-divider';
                panel.appendChild(divider);

                const visLabels = { public: '🌍 Make public', unlisted: '🔗 Make unlisted', private: '🔒 Make private' };
                for (const vis of ['public', 'unlisted', 'private']) {
                    if (vis === work.visibility) continue;
                    panel.appendChild(menuItem(visLabels[vis], async () => {
                        try {
                            const resp = await fetch(`/api/works/${encodeURIComponent(work.id)}`, {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ visibility: vis }),
                            });
                            if (!resp.ok) throw new Error(`Update failed (${resp.status})`);
                            work.visibility = vis;
                            toast('Visibility updated', `This story is now ${vis}.`);
                            if (onChanged) onChanged('visibility', work);
                        } catch (error) {
                            console.error('Could not change visibility:', error);
                            toast('Could not update', 'Please try again.');
                        }
                    }));
                }

                panel.appendChild(menuItem('🗑 Delete story', async () => {
                    if (!confirm(`Delete "${work.title}" forever? This cannot be undone.`)) return;
                    try {
                        const resp = await fetch(`/api/works/${encodeURIComponent(work.id)}`, { method: 'DELETE' });
                        if (!resp.ok) throw new Error(`Delete failed (${resp.status})`);
                        card.remove();
                        toast('Story deleted');
                        if (onChanged) onChanged('deleted', work);
                    } catch (error) {
                        console.error('Could not delete story:', error);
                        toast('Could not delete', 'Please try again.');
                    }
                }, true));
            }

            button.parentElement.appendChild(panel);
            button.setAttribute('aria-expanded', 'true');
            openMenu = { button, panel };
        });
        return button;
    }

    // work: a row from GET /api/works (or a minimal {title, cover_image_url,
    // excerpt} object from the stories.json fallback — no id means no
    // engagement UI). opts: { me, onChanged, badge }.
    function buildWorkCard(container, work, opts) {
        const { me = null, onChanged = null, badge = false } = opts || {};
        const card = document.createElement('div');
        card.className = 'story-card story-card-link';
        const href = work.id
            ? `story.html?id=${encodeURIComponent(work.id)}`
            : `story.html?sid=${work.sid}`;
        card.addEventListener('click', () => { window.location.href = href; });

        const frame = document.createElement('div');
        frame.className = 'cover-frame card-cover';
        const coverBg = document.createElement('img');
        coverBg.className = 'cover-frame-bg';
        coverBg.src = work.cover_image_url || '';
        coverBg.alt = '';
        coverBg.setAttribute('aria-hidden', 'true');
        coverBg.loading = 'lazy';
        const cover = document.createElement('img');
        cover.className = 'cover-frame-fg';
        cover.src = work.cover_image_url || '';
        cover.alt = `${work.title} cover`;
        cover.loading = 'lazy';
        cover.onerror = function () {
            const placeholder = document.createElement('div');
            placeholder.className = 'cover-placeholder';
            placeholder.textContent = (work.title || '?').charAt(0);
            frame.replaceWith(placeholder);
        };
        frame.append(coverBg, cover);
        card.appendChild(frame);

        if (work.id) card.appendChild(kebab(work, me, card, onChanged));
        if (badge && work.visibility && work.visibility !== 'public') {
            const chip = document.createElement('span');
            chip.className = 'visibility-chip';
            chip.textContent = work.visibility === 'private' ? '🔒 Private' : '🔗 Unlisted';
            card.appendChild(chip);
        }

        const body = document.createElement('div');
        body.className = 'card-body';

        const heading = document.createElement('h2');
        heading.textContent = work.title;
        body.appendChild(heading);

        if (work.id) {
            const meta = document.createElement('div');
            meta.className = 'card-meta';
            meta.appendChild(ownerTag(work));
            const views = document.createElement('span');
            views.className = 'view-count';
            views.textContent = `👁 ${work.view_count || 0}`;
            meta.appendChild(views);
            body.appendChild(meta);
        }

        const text = document.createElement('p');
        text.textContent = (work.excerpt || '').substring(0, 150) + '...';
        body.appendChild(text);

        const footer = document.createElement('div');
        footer.className = 'card-footer';
        const button = document.createElement('button');
        button.textContent = 'Read More →';
        footer.appendChild(button);
        if (work.id) footer.appendChild(reactionBar(work, me));
        body.appendChild(footer);

        card.appendChild(body);
        container.appendChild(card);
        return card;
    }

    return { buildWorkCard: buildWorkCard };
})();
