import './style.css';

// State Management
const state = {
    selectedKorean: new Set(),
    selectedGlobal: new Set(),
    maxSelections: 5
};

// DOM Elements
const elements = {
    currentDate: document.getElementById('current-date'),
    koreanGrid: document.getElementById('korean-grid'),
    globalGrid: document.getElementById('global-grid'),
    krCounter: document.getElementById('kr-counter'),
    glCounter: document.getElementById('gl-counter'),
    // Modal Elements
    modalOverlay: document.getElementById('article-modal'),
    modalCloseBtn: document.getElementById('modal-close-btn'),
    modalSource: document.getElementById('modal-source'),
    modalTitle: document.getElementById('modal-title'),
    modalBody: document.getElementById('modal-body'),
    modalLink: document.getElementById('modal-link'),

    // Selection chips containers
    krSelectedList: document.getElementById('kr-selected-list'),
    glSelectedList: document.getElementById('gl-selected-list'),
    toastContainer: document.getElementById('toast-container')
};

// Initialize App
async function init() {
    setDate();

    // Show loading state
    elements.koreanGrid.innerHTML = '<p style="padding: 20px; color: var(--text-muted);">Fetching live news...</p>';
    elements.globalGrid.innerHTML = '<p style="padding: 20px; color: var(--text-muted);">Fetching live news...</p>';

    try {
        const response = await fetch('/data.json');
        if (!response.ok) throw new Error('Data not found');

        const data = await response.json();

        renderArticles(data.koreanNews || [], elements.koreanGrid, 'korean');
        renderArticles(data.globalNews || [], elements.globalGrid, 'global');
    } catch (error) {
        console.error('Error fetching news:', error);
        const errorMsg = '<p style="padding: 20px; color: var(--danger);">Failed to load latest news. Please ensure the backend updater has run.</p>';
        elements.koreanGrid.innerHTML = errorMsg;
        elements.globalGrid.innerHTML = errorMsg;
    }

    // Setup modal close events
    elements.modalCloseBtn.addEventListener('click', closeModal);
    elements.modalOverlay.addEventListener('click', (e) => {
        if (e.target === elements.modalOverlay) closeModal();
    });
}

function openModal(article) {
    elements.modalSource.textContent = article.source || 'News Source';
    elements.modalTitle.textContent = article.title;

    const formattedSummary = article.summary
        .replace(/\n/g, '<br>');

    elements.modalBody.innerHTML = `
        <div class="modal-section">
            <h4 class="modal-section-title">요약</h4>
            ${formattedSummary}
        </div>
        <div class="modal-section" style="margin-top: 24px; border-top: 1px solid var(--border-color); padding-top: 16px;">
            <h4 class="modal-section-title" style="color: var(--accent-color);">왜 중요한가</h4>
            <p>${article.impact}</p>
        </div>
    `;
    elements.modalLink.href = article.link;
    elements.modalOverlay.classList.remove('hidden');
}

function closeModal() {
    elements.modalOverlay.classList.add('hidden');
}

// Format and set current date
function setDate() {
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const today = new Date().toLocaleDateString('en-US', options);
    elements.currentDate.textContent = today;
}

// Render article cards to the DOM
function renderArticles(articles, container, category) {
    container.innerHTML = ''; // clear

    articles.forEach(article => {
        const cardItem = document.createElement('div');
        cardItem.className = 'article-card';
        cardItem.dataset.id = article.id || `${category}-${article.title}`;
        cardItem.dataset.category = category;

        // Checkbox container
        const checkWrapper = document.createElement('div');
        checkWrapper.className = 'checkbox-wrapper';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'custom-checkbox';
        checkbox.id = `check-${article.id}`;

        checkWrapper.appendChild(checkbox);

        // Content container
        const contentBox = document.createElement('div');
        contentBox.className = 'card-content';

        contentBox.innerHTML = `
      <div class="card-source">${article.source}</div>
      <h3 class="card-title">${article.title}</h3>
      <p class="card-summary">${article.summary}</p>
      <p class="card-impact"><strong>왜 중요한가</strong> ${article.impact}</p>
    `;

        cardItem.appendChild(checkWrapper);
        cardItem.appendChild(contentBox);

        // Event listeners for selection and modal
        cardItem.addEventListener('click', (e) => {
            // Unify checkbox clicking behavior by intercepting clicks outside
            if (e.target.tagName.toLowerCase() === 'input' || e.target.classList.contains('checkbox-wrapper') || e.target.closest('.checkbox-wrapper')) {
                // Return out to let original checkbox event handle it OR handle it here if clicked on wrapper
                if (e.target.tagName.toLowerCase() !== 'input') {
                    // Clicked on wrapper, not the pure input
                    checkbox.checked = !checkbox.checked;
                    handleSelection(article, category, checkbox.checked, cardItem, checkbox);
                }
            } else {
                // Clicked on standard card body -> open detailed modal
                openModal(article);
            }
        });

        checkbox.addEventListener('change', () => {
            handleSelection(article, category, checkbox.checked, cardItem, checkbox);
        });

        container.appendChild(cardItem);
    });
}

// Handle checkbox selection logic
function handleSelection(article, category, isChecked, cardEl, checkboxEl) {
    const selectedSet = category === 'korean' ? state.selectedKorean : state.selectedGlobal;
    const counterEl = category === 'korean' ? elements.krCounter : elements.glCounter;

    if (isChecked) {
        if (selectedSet.size >= state.maxSelections) {
            // Limit reached, prevent selection
            checkboxEl.checked = false;
            showToast(`You can only select exactly ${state.maxSelections} ${category} articles.`, 'error');
            // Shake animation
            cardEl.animate([{ transform: 'translateX(-5px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(0)' }], { duration: 300 });
            return;
        }
        selectedSet.add(article);
        cardEl.classList.add('selected');
    } else {
        selectedSet.delete(article);
        cardEl.classList.remove('selected');
    }

    updateCounters(selectedSet.size, counterEl);
    renderSelectedChips(selectedSet, category);
}

// Render visual chips for selected articles at the top of the columns
function renderSelectedChips(selectedSet, category) {
    const listEl = category === 'korean' ? elements.krSelectedList : elements.glSelectedList;
    listEl.innerHTML = '';

    Array.from(selectedSet).forEach(article => {
        const chip = document.createElement('div');
        chip.className = 'selected-chip';

        const titleSpan = document.createElement('span');
        titleSpan.textContent = article.title.length > 35 ? article.title.substring(0, 32) + '...' : article.title;

        const removeBtn = document.createElement('button');
        removeBtn.className = 'chip-remove';
        removeBtn.innerHTML = '&times;';
        removeBtn.title = 'Remove Article';

        // Handling removal from chip
        removeBtn.addEventListener('click', () => {
            selectedSet.delete(article);
            // Must find original card to untick checkbox
            const checkbox = document.getElementById(`check-${article.id}`);
            if (checkbox) checkbox.checked = false;

            const card = document.querySelector(`.article-card[data-id="${article.id}"]`);
            if (card) card.classList.remove('selected');

            const counterEl = category === 'korean' ? elements.krCounter : elements.glCounter;
            updateCounters(selectedSet.size, counterEl);
            renderSelectedChips(selectedSet, category);
        });

        chip.appendChild(titleSpan);
        chip.appendChild(removeBtn);
        listEl.appendChild(chip);
    });
}

// Update UI counters
function updateCounters(size, element) {
    element.textContent = `${size} / ${state.maxSelections} Selected`;

    // Styling update based on completion
    if (size === state.maxSelections) {
        element.classList.add('full');
        element.classList.remove('error');
    } else {
        element.classList.remove('full');
        element.classList.remove('error');
    }
}

// Show toast notifications
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;

    elements.toastContainer.appendChild(toast);

    // Auto remove after 3 seconds
    setTimeout(() => {
        toast.style.animation = 'fadeOut 0.3s ease forwards';
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 300);
    }, 3000);
}

// Boot application
init();
