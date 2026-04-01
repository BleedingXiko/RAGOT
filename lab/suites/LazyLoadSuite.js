/**
 * LazyLoadSuite — Tests createLazyLoader with purely offline SVG images.
 *
 * All images use inline SVG data URIs — zero network calls.
 * The lazy loader still works: images start without src, and data-src
 * is only applied when the IntersectionObserver fires.
 */
import { Component, createElement, createLazyLoader, append, hide, $ } from '../../index.js';
import { makePlaceholderSrc } from '../labUtils.js';

export class LazyLoadSuite extends Component {
    onStart() {
        const loader = createLazyLoader(this, {
            root: this.refs.scrollContainer,
            rootMargin: '100px 0px',
            selector: '.lazy-image',
            onLoad: (img) => {
                img.classList.add('loaded');
                const wrapper = img.parentElement;
                if (wrapper) {
                    const placeholder = $('.lazy-placeholder', wrapper);
                    if (placeholder) hide(placeholder);

                    const card = wrapper.parentElement;
                    if (card) {
                        const meta = $('.lab-card-meta', card);
                        if (meta) {
                            meta.textContent = `data-src loaded at ${new Date().toLocaleTimeString()}`;
                        }
                    }
                }
            },
            onError: (img) => {
                // This should never fire with data URIs, but just in case
                const wrapper = img.parentElement;
                if (wrapper) {
                    const placeholder = $('.lazy-placeholder', wrapper);
                    if (placeholder) {
                        placeholder.textContent = '⚠ Failed to render image';
                    }
                }
            }
        });

        const container = this.refs.scrollContainer;
        const total = 50;
        const cards = [];

        for (let i = 0; i < total; i++) {
            // Fully offline — inline SVG data URI, no network
            const svgSrc = makePlaceholderSrc(i, `#${i + 1}`, 320, 180);

            const card = createElement('div', { className: 'lab-card', style: { padding: '0', overflow: 'hidden' } },
                createElement('div', { className: 'lazy-image-wrapper' },
                    createElement('div', { className: 'lazy-placeholder' },
                        createElement('span', { textContent: '⏳', style: { fontSize: '20px' } }),
                        createElement('span', { textContent: `Image ${i + 1}`, style: { fontSize: '12px', color: 'var(--text-secondary)' } })
                    ),
                    createElement('img', {
                        className: 'lazy-image',
                        dataset: { src: svgSrc },
                        alt: `Lazy image ${i + 1}`
                    })
                ),
                createElement('div', { style: { padding: '12px' } },
                    createElement('div', { className: 'lab-card-title', textContent: `Image #${i + 1}` }),
                    createElement('div', { className: 'lab-card-meta', style: { marginTop: '4px' }, textContent: `data-src queued` })
                )
            );

            cards.push(card);
        }

        append(container, ...cards);

        cards.forEach(card => {
            const img = $('.lazy-image', card);
            if (img) loader.observe(img);
        });
    }

    render() {
        return createElement('div', { className: 'suite-container' },
            createElement('header', { className: 'suite-header' },
                createElement('h1', { className: 'suite-title', textContent: 'createLazyLoader' }),
                createElement('p', { className: 'suite-description', textContent: 'Images use inline SVG data URIs — fully offline. The lazy loader still defers src assignment until the card enters the viewport via IntersectionObserver. Scroll slowly and watch each row appear.' })
            ),

            createElement('div', { className: 'sandbox-card' },
                createElement('div', { className: 'sandbox-header' },
                    createElement('span', { className: 'sandbox-label', textContent: 'Scroll to trigger loads ↓' })
                ),
                createElement('div', {
                    ref: this.ref('scrollContainer'),
                    className: 'lazy-grid-viewport'
                })
            )
        );
    }
}
