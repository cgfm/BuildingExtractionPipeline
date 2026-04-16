(function() {
    const tip = document.getElementById('tooltip');
    function showTip(el) {
        const text = el.dataset.tooltip || (el.querySelector('.info-tip-text') || {}).textContent || '';
        if (!text.trim()) return;
        tip.textContent = text.trim();
        tip.className = '';
        tip.style.left = '-9999px';
        tip.style.top = '0';
        tip.style.visibility = 'hidden';
        tip.style.display = 'block';
        tip.style.opacity = '0';
        const tipRect = tip.getBoundingClientRect();
        const rect = el.getBoundingClientRect();
        const pad = 8;
        let top, arrowClass;
        if (rect.top - tipRect.height - pad > 0) {
            top = rect.top - tipRect.height - pad;
            arrowClass = 'arrow-bottom';
        } else {
            top = rect.bottom + pad;
            arrowClass = 'arrow-top';
        }
        let left = rect.left + rect.width / 2 - tipRect.width / 2;
        left = Math.max(pad, Math.min(left, window.innerWidth - tipRect.width - pad));
        let arrowLeft = rect.left + rect.width / 2 - left;
        arrowLeft = Math.max(10, Math.min(arrowLeft, tipRect.width - 10));
        tip.style.left = left + 'px';
        tip.style.top = top + 'px';
        tip.style.setProperty('--arrow-left', arrowLeft + 'px');
        tip.style.visibility = '';
        tip.style.display = '';
        tip.style.opacity = '';
        tip.className = arrowClass + ' visible';
    }
    function hideTip() { tip.className = ''; }
    document.addEventListener('mouseenter', function(e) {
        if (!e.target.closest) return;
        const el = e.target.closest('[data-tooltip], .info-tip');
        if (el) showTip(el);
    }, true);
    document.addEventListener('mouseleave', function(e) {
        if (!e.target.closest) return;
        const el = e.target.closest('[data-tooltip], .info-tip');
        if (el) hideTip();
    }, true);
})();
