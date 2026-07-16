// Fills every .star-field element with twinkling, drifting stars and makes
// them parallax away from the cursor. Star count comes from data-stars
// (default 30); positions are seeded so each page load looks the same.
(function () {
    function seeded(i) {
        const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
        return x - Math.floor(x);
    }

    function populate(field) {
        const count = parseInt(field.getAttribute('data-stars'), 10) || 30;
        for (let i = 0; i < count; i++) {
            const depth = 0.4 + seeded(i + 7) * 1.2;
            const star = document.createElement('span');
            star.className = 'star' + (seeded(i + 3) > 0.72 ? ' gold' : '');
            star.setAttribute('data-depth', depth.toFixed(2));
            star.style.top = (2 + seeded(i + 1) * 90) + '%';
            star.style.left = (1 + seeded(i + 2) * 97) + '%';

            const inner = document.createElement('i');
            inner.textContent = '✦';
            inner.style.fontSize = (6 + depth * 7).toFixed(0) + 'px';
            inner.style.animationDuration =
                (2 + seeded(i + 4) * 2.5).toFixed(1) + 's, ' +
                (4.5 + seeded(i + 5) * 4).toFixed(1) + 's';
            inner.style.animationDelay =
                (seeded(i + 6) * 3).toFixed(1) + 's, ' +
                (seeded(i + 8) * 4).toFixed(1) + 's';

            star.appendChild(inner);
            field.appendChild(star);
        }
    }

    document.addEventListener('DOMContentLoaded', function () {
        const fields = document.querySelectorAll('.star-field');
        if (!fields.length) return;
        fields.forEach(populate);

        window.addEventListener('mousemove', function (e) {
            fields.forEach(function (field) {
                const r = field.getBoundingClientRect();
                if (!r.width || !r.height) return;
                const dx = (e.clientX - (r.left + r.width / 2)) / r.width;
                const dy = (e.clientY - (r.top + r.height / 2)) / r.height;
                field.querySelectorAll('[data-depth]').forEach(function (star) {
                    const d = parseFloat(star.getAttribute('data-depth'));
                    star.style.transform =
                        'translate(' + (dx * d * -28).toFixed(1) + 'px, ' + (dy * d * -20).toFixed(1) + 'px)';
                });
            });
        });
    });
})();
