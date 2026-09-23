/* =========================================================
   GARDEN JOURNAL — APPLICATION LOGIC
   Function names are unchanged so existing inline handlers
   in index.html continue to resolve.
   ========================================================= */
let isEditMode = false;
/* ---------------------------------------------------------
   UNDO STATE
   One-level undo stash for the most recent section deletion.
   Cleared on any other action or when leaving Edit mode.
   --------------------------------------------------------- */
let lastDeletedSection = null;   // { section: {...}, index: N, entryIndex: M } or null

/* ---------------------------------------------------------
   DRAG STATE
   Tracks the in-progress drag of a section. Null when idle.
   --------------------------------------------------------- */
let sectionDrag = null;   // { index, startY, currentTargetIndex, placeholder, sectionEl } or null

/* ---------------------------------------------------------
   DATA
   --------------------------------------------------------- */
let journalDatabase = [
    {
        date: "2026-09-17",
        displayTitle: "The Orange Tree",
        weatherStats: "82°F · Sunny",
        weatherFeel: "Hot and humid, but there was a lovely breeze this morning.",
        sections: [
            {
                text: "The Meyer Lemon saplings are completely bathing in the early sunlight today. Noticeable soft new growth clusters along the southern branch tips. The soil texture feels perfect after Tuesday's light rain framework.",
                image: "https://images.unsplash.com/photo-1596547609652-9cf5d8d76921?auto=format&fit=crop&w=600&q=80"
            },
            {
                text: "Tasted the first tiny orange yield of the season. The skins are highly fragrant, crisp oils bursting immediately upon handling. Need to adjust the organic mulch perimeter before the temperature shifts upward next week.",
                image: "https://images.unsplash.com/photo-1611080626919-7cf5a9dbab5b?auto=format&fit=crop&w=1200&q=80"
            },
            {
                text: "Spent an hour carefully tending to the low-hanging interior olive branches. Clear pathways created inside the structure to maximize airflow and catch the beautiful, golden afternoon warm sunlight perfectly.",
                image: "https://images.unsplash.com/photo-1543157145-f78c636d023d?auto=format&fit=crop&w=600&q=80"
            },
            {
                text: "The warm dusk scent profile carries sweet, intense undertones of mock orange blossoms and dry rosemary spikes. A single pale gold butterfly stayed near the upper leaf tiers for almost twenty quiet minutes tonight.",
                image: "https://images.unsplash.com/photo-1590502593747-42a996133562?auto=format&fit=crop&w=600&q=80"
            }
        ]
    },
    {
        date: "2026-09-14",
        displayTitle: "Tomatoes",
        weatherStats: "79°F · Overcast",
        weatherFeel: "Heavy gray air keeping things cool, with a small hint of afternoon rain drops.",
        sections: [
            { text: "Heirloom tomato variants showing brilliant deep red shading across the grid blocks.", image: "https://images.unsplash.com/photo-1592924357228-91a4daadcfea?auto=format&fit=crop&w=600&q=80" },
            { text: "Sturdy stakes supporting heavy branches seamlessly.", image: "" },
            { text: "", image: "" },
            { text: "", image: "" }
        ]
    },
    {
        date: "2026-09-08",
        displayTitle: "First Dahlia",
        weatherStats: "74°F · Crisp morning",
        weatherFeel: "A beautiful shift in breeze profile. Perfect dew points for tracking early color scales.",
        sections: [
            { text: "The very first magnificent dahlia bloom opened fully this morning layout.", image: "https://images.unsplash.com/photo-1508747705-3df2073ff37d?auto=format&fit=crop&w=600&q=80" },
            { text: "", image: "" },
            { text: "", image: "" },
            { text: "", image: "" }
        ]
    },
    {
        date: "2026-09-02",
        displayTitle: "Morning in the Garden",
        weatherStats: "85°F · High Sun",
        weatherFeel: "Intense heat early. Had to water the delicate greens twice to counter quick drying cycles.",
        sections: [
            { text: "Quiet layers of autumn dew hovering low above the crisp herb fields.", image: "" },
            { text: "", image: "" },
            { text: "", image: "" },
            { text: "", image: "" }
        ]
    }
];

/* ---------------------------------------------------------
   STATE
   --------------------------------------------------------- */
let currentEntryIndex = 0;
let autoSaveFeedbackTimeout;
let typingDebounceTimeout;

const MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
];

/* ---------------------------------------------------------
   LAYOUT REGISTRY
   Single source of truth for the compositions that can appear
   in a journal entry. Order here is the order shown in the
   future layout chooser.
   --------------------------------------------------------- */
const LAYOUTS = [
    { id: "arr-1", name: "Photo right / Text left" },
    { id: "arr-2", name: "Wide photo / Text below" },
    { id: "arr-3", name: "Photo left / Text right" },
    { id: "arr-4", name: "Photo right / Text left" }
];

/* ---------------------------------------------------------
   MIGRATION
   Fills in a `layout` field on every section that lacks one,
   based on its index. Existing entries get arr-1..arr-4 in
   their original order, so rendering is visually unchanged.
   --------------------------------------------------------- */
function migrateJournalDatabase(db) {
    db.forEach(entry => {
        if (!Array.isArray(entry.sections)) entry.sections = [];
        entry.sections.forEach((section, index) => {
            if (!section.layout) {
                section.layout = LAYOUTS[index] ? LAYOUTS[index].id : LAYOUTS[0].id;
            }
        });
    });
}

/* ---------------------------------------------------------
   BOOTSTRAP
   --------------------------------------------------------- */
window.onload = function () {
    migrateJournalDatabase(journalDatabase);
    renderEntry(currentEntryIndex);
    setupWeatherListeners();
    lockJournalEditing();
    document.querySelector('.app-bar').style.display = 'none';
};

/* ---------------------------------------------------------
   VIEW SWITCHING
   --------------------------------------------------------- */
function showLandingPage() {
    document.querySelectorAll('.view-panel').forEach(p => p.classList.remove('active'));
    document.getElementById('landingViewContainer').classList.add('active');
    document.querySelector('.app-bar').style.display = 'none';
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function switchToJournalSheetView() {
    document.querySelectorAll('.view-panel').forEach(p => p.classList.remove('active'));
    document.getElementById('journalViewContainer').classList.add('active');
    document.querySelector('.app-bar').style.display = 'flex';
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function exitArchiveView() {
    document.getElementById('archiveViewContainer').classList.remove('active');
    document.getElementById('journalViewContainer').classList.add('active');
    document.querySelector('.app-bar').style.display = 'flex';
}

/* ---------------------------------------------------------
   LANDING PAGE HANDLERS
   --------------------------------------------------------- */
function createNewEntryFromCover() {
    createNewEntry();
    switchToJournalSheetView();
}

function triggerArchiveSearchFromCover() {
    const mStr = document.getElementById('coverMonthSelect').value;
    const yStr = document.getElementById('coverYearSelect').value;

    document.getElementById('archiveMonthSelect').value = mStr;
    document.getElementById('archiveYearSelect').value = yStr;

    buildArchiveList(mStr, yStr);
    document.querySelector('.app-bar').style.display = 'flex';
}

function triggerSurpriseMe() {
    if (journalDatabase.length === 0) {
        showNotification("No records available inside memory pool context.");
        return;
    }
    const randIndex = Math.floor(Math.random() * journalDatabase.length);
    renderEntry(randIndex);
    switchToJournalSheetView();
    showNotification(`✦ Surprised you with: "${journalDatabase[randIndex].displayTitle}"`);
}

/* ---------------------------------------------------------
   JOURNAL RENDERING
   --------------------------------------------------------- */
/* ---------------------------------------------------------
   SECTION BUILDER
   Creates the DOM for one journal section from its data.
   The inner structure is identical for all four layouts;
   the composition class on the outer <section> is what
   arranges text vs. photo visually via CSS.
   --------------------------------------------------------- */
function buildSectionElement(sectionData, index) {
    const section = document.createElement('section');
    section.className = 'journal-section ' + (sectionData.layout || 'arr-1');
    section.dataset.index = String(index);

    // ---- text wrapper ----
    const textWrapper = document.createElement('div');
    textWrapper.className = 'text-wrapper';

    const label = document.createElement('span');
    label.className = 'section-note-label';
    label.textContent = getDefaultLabelForLayout(sectionData.layout);

    const textInput = document.createElement('div');
    textInput.className = 'text-area-input';
    textInput.contentEditable = 'true';
    textInput.setAttribute('placeholder', 'Click here to write notes...');
    textInput.innerText = sectionData.text || '';

    textInput.addEventListener('input', () => {
        const current = journalDatabase[currentEntryIndex];
        if (!current || !current.sections[index]) return;
        current.sections[index].text = textInput.innerText;

        // Derive the entry title from the FIRST section that has text,
        // regardless of its position. Matches the decision made for
        // the flexible layout system.
        if (index === 0) {
            const t = textInput.innerText.trim();
            if (t.length > 0) {
                current.displayTitle = t.split(' ').slice(0, 3).join(' ') + '...';
            }
        }

        clearTimeout(typingDebounceTimeout);
        typingDebounceTimeout = setTimeout(() => { triggerAutoSaveFeedback(); }, 600);
    });

    textWrapper.appendChild(label);
    textWrapper.appendChild(textInput);

    // ---- photo wrapper ----
    const photoWrapper = document.createElement('div');
    photoWrapper.className = 'photo-wrapper';

    const photoContainer = document.createElement('div');
    photoContainer.className = 'photo-container';

    const photoFrame = document.createElement('div');
    photoFrame.className = 'photo-frame';

    if (sectionData.image) {
        const img = document.createElement('img');
        img.src = sectionData.image;
        img.alt = 'Garden View Slot';
        photoFrame.appendChild(img);
    } else {
        photoFrame.innerHTML = placeholderMarkup();
    }

    // Gallery picker (existing behavior)
    const galleryInput = document.createElement('input');
    galleryInput.type = 'file';
    galleryInput.className = 'hidden-file-input';
    galleryInput.accept = 'image/*';
    galleryInput.addEventListener('change', (event) => handlePhotoSelect(event, index));

    // Camera capture (opens the phone's camera on mobile via capture attr)
    const cameraInput = document.createElement('input');
    cameraInput.type = 'file';
    cameraInput.className = 'hidden-file-input';
    cameraInput.accept = 'image/*';
    cameraInput.setAttribute('capture', 'environment');   // rear camera
    cameraInput.addEventListener('change', (event) => handlePhotoSelect(event, index));

    photoContainer.addEventListener('click', (event) => triggerPhotoUpload(event, index));

    photoContainer.appendChild(photoFrame);
    photoWrapper.appendChild(photoContainer);
    photoWrapper.appendChild(galleryInput);
    photoWrapper.appendChild(cameraInput);
   
    section.appendChild(textWrapper);
    section.appendChild(photoWrapper);
    section.appendChild(buildRemoveSectionButton(index));
    section.appendChild(buildDragHandle(index));      // NEW
    return section;
}

function getDefaultLabelForLayout(layoutId) {
    switch (layoutId) {
        case 'arr-1': return 'Morning Observations';
        case 'arr-2': return 'Midday Harvest Notes';
        case 'arr-3': return 'Pruning Reflections';
        case 'arr-4': return 'Dusk Sanctuary Details';
        default:      return 'Notes';
    }
}

function placeholderMarkup() {
    return `
        <div class="photo-placeholder-graphic">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="18" height="18" rx="0" />
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <path d="M21 15l-5-5L5 21" />
            </svg>
            <span>Select Photo</span>
        </div>`;
}

function buildDividerElement() {
    const divider = document.createElement('div');
    divider.className = 'divider-container';
    divider.innerHTML = `
        <svg class="wobbly-line" viewBox="0 0 800 20" preserveAspectRatio="none">
            <path d="M 10 12 Q 150 5, 310 14 T 620 7 T 790 11" />
        </svg>`;
    return divider;
}

/* ---------------------------------------------------------
   ADD LAYOUT CONTROL
   Renders the + button below the last section. Lives inside
   #sectionsContainer so it flows with the sections. Hidden
   by CSS unless #journalPage has the is-editing class.
   --------------------------------------------------------- */
function buildAddLayoutControl() {
    const wrapper = document.createElement('div');
    wrapper.className = 'add-layout-control';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'add-layout-btn';
    button.innerHTML = '<span class="add-layout-plus">+</span><span>Add layout</span>';
    button.addEventListener('click', openLayoutChooser);

    wrapper.appendChild(button);
    return wrapper;
}

/* ---------------------------------------------------------
   LAYOUT CHOOSER
   Populates the overlay with one tile per entry in LAYOUTS,
   shows the overlay, and wires click handlers.
   --------------------------------------------------------- */
function openLayoutChooser() {
    const overlay = document.getElementById('layoutChooserOverlay');
    const grid = document.getElementById('layoutChooserGrid');
    if (!overlay || !grid) return;

    grid.innerHTML = '';

    LAYOUTS.forEach(layout => {
        const tile = document.createElement('button');
        tile.type = 'button';
        tile.className = 'layout-choice-tile';
        tile.dataset.layoutId = layout.id;

        const preview = document.createElement('div');
        preview.className = 'layout-choice-preview';

        // Mini rendering of the composition using the same class names
        // as the real section, so the diagram matches what gets added.
        preview.innerHTML = `
            <div class="preview-section ${layout.id}">
                <div class="preview-photo"></div>
                <div class="preview-text"></div>
            </div>`;

        const label = document.createElement('span');
        label.className = 'layout-choice-label';
        label.textContent = layout.name;

        tile.appendChild(preview);
        tile.appendChild(label);

        tile.addEventListener('click', () => {
            chooseLayout(layout.id);
        });

        grid.appendChild(tile);
    });

    overlay.classList.add('visible');
}

function closeLayoutChooser() {
    const overlay = document.getElementById('layoutChooserOverlay');
    if (overlay) overlay.classList.remove('visible');
}

/* ---------------------------------------------------------
   CHOOSE A LAYOUT
   Appends a new, empty section with the chosen composition
   to the current entry, closes the chooser, re-renders.
   --------------------------------------------------------- */
function chooseLayout(layoutId) {
    const entry = journalDatabase[currentEntryIndex];
    if (!entry) return;

    lastDeletedSection = null;   // NEW: adding is "another action"

    entry.sections.push({
        layout: layoutId,
        text: '',
        image: ''
    });

    closeLayoutChooser();

    // Re-render to pick up the new section. renderEntry re-attaches
    // all listeners and rebuilds the container including the + control.
    renderEntry(currentEntryIndex);

    triggerAutoSaveFeedback();

    const layoutName = (LAYOUTS.find(l => l.id === layoutId) || {}).name || 'Layout';
    showNotification(`${layoutName} added.`);
}

/* ---------------------------------------------------------
   CLOSE CHOOSER ON OUTSIDE CLICK / ESCAPE
   --------------------------------------------------------- */
document.addEventListener('click', (e) => {
    const overlay = document.getElementById('layoutChooserOverlay');
    if (!overlay || !overlay.classList.contains('visible')) return;

    // If the click is directly on the overlay backdrop (not inside
    // the chooser panel), close it.
    if (e.target === overlay) {
        closeLayoutChooser();
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeLayoutChooser();
    }
});

function renderEntry(index) {
    if (index < 0 || index >= journalDatabase.length) return;
    currentEntryIndex = index;

    const entry = journalDatabase[currentEntryIndex];

    document.getElementById('journalTitleInput').innerText = entry.displayTitle || '';
    document.getElementById('entryInlineDate').value = entry.date;

    const locationDisplay = document.getElementById('gardenLocationDisplay');
    if (locationDisplay) {
        locationDisplay.innerText = entry.location || 'Tallahassee, FL';
    }

    const weatherDisplay = document.getElementById('weatherStatsDisplay');
    if (weatherDisplay) {
        weatherDisplay.innerText = entry.weatherStats || 'Weather loading...';
    }

    document.getElementById('weatherFeelInput').innerText = entry.weatherFeel || '';

    const container = document.getElementById('sectionsContainer');
    container.innerHTML = '';

    // NEW: Undo banner sits at the top of the sections flow.
    container.appendChild(buildUndoBanner());
   
    entry.sections.forEach((sectionData, i) => {
        container.appendChild(buildSectionElement(sectionData, i));
        if (i < entry.sections.length - 1) {
            container.appendChild(buildDividerElement());
        }
    });

    // NEW: + button at the end of the sections flow.
    container.appendChild(buildAddLayoutControl());

   // INSERTION 2: after re-render, keep the Undo banner visible
    // if there is a pending deletion for this entry.
    if (lastDeletedSection && lastDeletedSection.entryIndex === currentEntryIndex) {
        showUndoBanner();
    }

    const pageIndicator = document.getElementById('pageIndicator');
    if (pageIndicator) {
        pageIndicator.innerText =
            `Page ${currentEntryIndex + 1} of ${journalDatabase.length}`;
    }

    const btnPrev = document.getElementById('btnPrev');
    if (btnPrev) btnPrev.disabled = (currentEntryIndex === 0);

    const btnNext = document.getElementById('btnNext');
    if (btnNext) btnNext.disabled = (currentEntryIndex === journalDatabase.length - 1);
}

/* ---------------------------------------------------------
   DRAG HANDLE
   Small grip icon rendered in the top-left of every section.
   Hidden by CSS unless #journalPage has the is-editing class.
   Pointer Events, so mouse and touch use the same code path.
   --------------------------------------------------------- */
function buildDragHandle(index) {
    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'drag-handle';
    handle.title = 'Drag to reorder';
    handle.setAttribute('aria-label', 'Drag to reorder section');
    handle.textContent = '⋮⋮';   // vertical dots, reads as a grip

    handle.addEventListener('pointerdown', (e) => {
        startSectionDrag(e, index, handle);
    });

    // Prevent the click from bubbling up to the section (which
    // might trigger text focus or photo click on some browsers).
    handle.addEventListener('click', (e) => {
        e.stopPropagation();
    });

    return handle;
}

/* ---------------------------------------------------------
   DRAG LIFECYCLE
   --------------------------------------------------------- */

function startSectionDrag(e, index, handle) {
    // Only in Edit mode.
    if (!isEditMode) return;

    const entry = journalDatabase[currentEntryIndex];
    if (!entry) return;
    if (index < 0 || index >= entry.sections.length) return;

    // Prevent the browser from starting a scroll or text selection.
    e.preventDefault();
    e.stopPropagation();

    const container = document.getElementById('sectionsContainer');
    const sectionEl = container.querySelector(`.journal-section[data-index="${index}"]`);
    if (!sectionEl) return;

    // Create the placeholder bar that will move as the user drags.
    const placeholder = document.createElement('div');
    placeholder.className = 'journal-section drop-placeholder';

    sectionDrag = {
        index: index,
        startY: e.clientY,
        sectionEl: sectionEl,
        placeholder: placeholder,
        container: container
    };

    sectionEl.classList.add('is-dragging');
    document.body.classList.add('is-dragging-section');

    // Insert the placeholder immediately after the dragged section
    // so it's visible from the first frame.
    if (sectionEl.nextSibling) {
        container.insertBefore(placeholder, sectionEl.nextSibling);
    } else {
        container.appendChild(placeholder);
    }

    // Attach global move/up handlers. Using pointer events means
    // these fire for both mouse and touch.
    window.addEventListener('pointermove', onSectionDragMove);
    window.addEventListener('pointerup', onSectionDragEnd);
    window.addEventListener('pointercancel', onSectionDragEnd);
}

function onSectionDragMove(e) {
    if (!sectionDrag) return;
    e.preventDefault();

    const container = sectionDrag.container;

    // Find the section the pointer is currently over.
    // We walk all visible sections and find which one's vertical
    // midpoint the cursor has crossed.
    const sections = Array.from(
        container.querySelectorAll('.journal-section:not(.is-dragging):not(.drop-placeholder)')
    );

    let targetEl = null;
    for (const el of sections) {
        const rect = el.getBoundingClientRect();
        if (e.clientY < rect.top + rect.height / 2) {
            targetEl = el;
            break;
        }
    }

    // Move the placeholder to just before the target element,
    // or to the end of the container if the pointer is below all
    // sections.
    if (targetEl) {
        if (sectionDrag.placeholder.nextSibling !== targetEl) {
            container.insertBefore(sectionDrag.placeholder, targetEl);
        }
    } else {
        // Below all sections — put the placeholder just before the
        // + button, or at the very end if the + isn't present.
        const addControl = container.querySelector('.add-layout-control');
        if (addControl) {
            container.insertBefore(sectionDrag.placeholder, addControl);
        } else {
            container.appendChild(sectionDrag.placeholder);
        }
    }
}

function onSectionDragEnd(e) {
    if (!sectionDrag) return;

    const { index, container, placeholder, sectionEl } = sectionDrag;

    // Determine the new array position from the placeholder's DOM
    // position. We count how many non-dragging sections come before
    // the placeholder.
    const children = Array.from(container.children);
    const placeholderPos = children.indexOf(placeholder);

    let newIndex = 0;
    for (let i = 0; i < placeholderPos; i++) {
        const child = children[i];
        if (child.classList && child.classList.contains('journal-section')) {
            if (!child.classList.contains('drop-placeholder') &&
                !child.classList.contains('is-dragging')) {
                newIndex++;
            }
        }
    }

    // Clamp just in case.
    const entry = journalDatabase[currentEntryIndex];
    if (entry) {
        newIndex = Math.max(0, Math.min(newIndex, entry.sections.length - 1));
    }

    // Clean up DOM and state.
    placeholder.remove();
    sectionEl.classList.remove('is-dragging');
    document.body.classList.remove('is-dragging-section');

    window.removeEventListener('pointermove', onSectionDragMove);
    window.removeEventListener('pointerup', onSectionDragEnd);
    window.removeEventListener('pointercancel', onSectionDragEnd);

    sectionDrag = null;

    // If the position didn't change, do nothing.
    if (!entry || newIndex === index) return;

    // Reorder the array: remove the section from its old spot,
    // insert it at the new position.
    const [moved] = entry.sections.splice(index, 1);
    entry.sections.splice(newIndex, 0, moved);

    // Re-render the sections. Any pending undo is cleared because
    // reordering counts as "another action."
    lastDeletedSection = null;

    renderEntry(currentEntryIndex);
    triggerAutoSaveFeedback();
    showNotification(`Section moved.`);
}


/* ---------------------------------------------------------
   AUTO-SAVE FEEDBACK
   --------------------------------------------------------- */
function triggerAutoSaveFeedback() {
    const indicator = document.getElementById('autoSaveIndicator');
    if (!indicator) return;
    indicator.style.opacity = '1';

    clearTimeout(autoSaveFeedbackTimeout);
    autoSaveFeedbackTimeout = setTimeout(() => {
        indicator.style.opacity = '0';
    }, 1200);
}

/* ---------------------------------------------------------
   EDITABLE FIELDS — WEATHER
   --------------------------------------------------------- */
function setupWeatherListeners() {
    const weatherFeelInput = document.getElementById('weatherFeelInput');

    if (!weatherFeelInput) return;

    weatherFeelInput.addEventListener('input', (e) => {
        if (!isEditMode) return;

        journalDatabase[currentEntryIndex].weatherFeel = e.target.innerText;

        clearTimeout(typingDebounceTimeout);
        typingDebounceTimeout = setTimeout(() => {
            triggerAutoSaveFeedback();
        }, 600);
    });
}
/* ---------------------------------------------------------
   EDITABLE FIELD — JOURNAL TITLE
   Attached once to the (static) title element. Only writes
   back to the data model while in Edit mode.
   --------------------------------------------------------- */
const journalTitle = document.getElementById('journalTitleInput');

if (journalTitle) {
    journalTitle.addEventListener('input', () => {
        if (!isEditMode) return;

        journalDatabase[currentEntryIndex].displayTitle =
            journalTitle.innerText;

        clearTimeout(typingDebounceTimeout);
        typingDebounceTimeout = setTimeout(() => {
            triggerAutoSaveFeedback();
        }, 600);
    });
}

/* ---------------------------------------------------------
   DATE EDITING
   --------------------------------------------------------- */
/* ---------------------------------------------------------
   DATE EDITING
   --------------------------------------------------------- */
async function handleInlineDateChange(dateValue) {
    if (!dateValue) return;

    journalDatabase[currentEntryIndex].date = dateValue;

    const weatherDisplay = document.getElementById('weatherStatsDisplay');
    if (weatherDisplay) {
        weatherDisplay.innerText = "Weather loading...";
    }

    try {
        await updateEntryWeather();
    } catch (error) {
        console.error("Date weather update failed:", error);
    }

    triggerAutoSaveFeedback();
    showNotification(`Active sheet entry date set to: ${dateValue}`);
}

/* ---------------------------------------------------------
   ARCHIVE
   --------------------------------------------------------- */
function triggerArchiveSearch() {
    const selectedMonth = document.getElementById('archiveMonthSelect').value;
    const selectedYear = document.getElementById('archiveYearSelect').value;
    document.getElementById('innerArchiveMonth').value = selectedMonth;
    document.getElementById('innerArchiveYear').value = selectedYear;
    buildArchiveList(selectedMonth, selectedYear);
}

function syncInnerArchive() {
    const selectedMonth = document.getElementById('innerArchiveMonth').value;
    const selectedYear = document.getElementById('innerArchiveYear').value;
    buildArchiveList(selectedMonth, selectedYear);
}

function buildArchiveList(monthStr, yearStr) {
    const monthIndex = parseInt(monthStr, 10) - 1;

    document.getElementById('archiveDisplayHeader').innerText =
        `${MONTH_NAMES[monthIndex]} ${yearStr}`;

    const listContainer = document.getElementById('archiveEntriesList');
    listContainer.innerHTML = '';

    const matchingEntries = [];
    journalDatabase.forEach((entry, actualIndex) => {
        if (entry.date) {
            const parts = entry.date.split('-');
            if (parts[0] === yearStr && parts[1] === monthStr) {
                matchingEntries.push({ ...entry, dbIndex: actualIndex });
            }
        }
    });

    if (matchingEntries.length === 0) {
        listContainer.innerHTML =
            `<div class="archive-empty-state">No journal logs recorded inside this specific timeframe frame block.</div>`;
    } else {
        matchingEntries.forEach(item => {
            const hasPhoto = item.sections.some(s => s.image && s.image.length > 0);
            const photoLabel = hasPhoto
                ? `<span class="archive-item-photo-indicator has-pic">[photo]</span>`
                : `<span class="archive-item-photo-indicator">[empty]</span>`;

            const dateParts = item.date.split('-');
            const displayDayStr = `${MONTH_NAMES[monthIndex]} ${dateParts[2]}`;
            const entryTitle = item.displayTitle || "Untitled Entry Log";

            const itemNode = document.createElement('div');
            itemNode.className = 'archive-item';
            itemNode.onclick = () => openJournalFromArchive(item.dbIndex);
            itemNode.innerHTML = `
                <div class="archive-item-left">
                    <span class="archive-item-date">${displayDayStr}</span>
                    <span class="archive-item-name">${entryTitle}</span>
                </div>
                <div>${photoLabel}</div>
            `;
            listContainer.appendChild(itemNode);
        });
    }

    document.querySelectorAll('.view-panel').forEach(p => p.classList.remove('active'));
    document.getElementById('archiveViewContainer').classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function openJournalFromArchive(dbIndex) {
    renderEntry(dbIndex);
    exitArchiveView();
    showNotification(`Opened archive log matching sheet.`);
}

/* ---------------------------------------------------------
   ENTRY CREATION / NAVIGATION
   --------------------------------------------------------- */
function createNewEntry() {
    lastDeletedSection = null;   // NEW
    const todayStr = new Date().toISOString().split('T')[0];
    const newBlankPage = {
        date: todayStr,
        displayTitle: "New Organic Entry",
        location: "Tallahassee, FL",
        weatherStats: "",
        weatherFeel: "",
        sections: []
    };
    journalDatabase.push(newBlankPage);
    renderEntry(journalDatabase.length - 1);
    updateEntryWeather();
    showNotification('New blank journal page composition initialized.');
}

function navigatePage(direction) {
    const targetIndex = currentEntryIndex + direction;
    if (targetIndex >= 0 && targetIndex < journalDatabase.length) {
        renderEntry(targetIndex);
    }
}

/* ---------------------------------------------------------
   THREE-DOT MENU
   --------------------------------------------------------- */
function toggleDropdown(event) {
    event.stopPropagation();
    document.getElementById('appDropdown').classList.add('show');
}

window.addEventListener('click', function () {
    const dropdown = document.getElementById('appDropdown');
    if (dropdown) dropdown.classList.remove('show');
});

function handleMenuAction(action) {
    if (action === 'edit') {
        const firstInput = document.querySelector('.journal-section .text-area-input');
        if (firstInput) {
            firstInput.classList.add('editing-focus');
            firstInput.focus();
            showNotification('Direct edit focus triggered on first section.');
            setTimeout(() => firstInput.classList.remove('editing-focus'), 1800);
        }
    } else if (action === 'photos') {
        document.querySelectorAll('.photo-container').forEach(c => c.classList.add('highlight-flash'));
        showNotification('Click photo frame windows directly to map elements.');
        setTimeout(() => {
            document.querySelectorAll('.photo-container').forEach(c => c.classList.remove('highlight-flash'));
        }, 2500);
    } else if (action === 'export-pdf') {
        window.print();
    } else if (action === 'delete') {
        const confirmed = confirm('Confirm Delete?');
        if (!confirmed) return;
       
        lastDeletedSection = null;   // NEW
       
        if (journalDatabase.length > 1) {
            journalDatabase.splice(currentEntryIndex, 1);
            const targetIndex = Math.max(0, currentEntryIndex - 1);
            renderEntry(targetIndex);
            showNotification('Entry removed from journal indexes.');
        } else {
            journalDatabase[0] = {
                date: new Date().toISOString().split('T')[0],
                displayTitle: "Single Wiped Sheet",
                weatherStats: "75°F · Clear",
                weatherFeel: "",
                sections: []
            };
            renderEntry(0);
            showNotification('Single entry wiped cleanly.');
        }
    }
}

/* ---------------------------------------------------------
   PHOTOS
   --------------------------------------------------------- */

function triggerPhotoUpload(event, index) {
    if (!isEditMode) return;

    // Prevent this click from bubbling to document, where the global
    // outside-click handler would immediately close the menu we're
    // about to open.
    if (event && event.stopPropagation) {
        event.stopPropagation();
    }

    const container = document.getElementById('sectionsContainer');
    const section = container.querySelector(`.journal-section[data-index="${index}"]`);
    if (!section) return;

    const photoContainer = section.querySelector('.photo-container');
    if (!photoContainer) return;

    openPhotoSourceMenu(photoContainer, index);
}

function handlePhotoSelect(event, index) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
        const container = document.getElementById('sectionsContainer');
        const section = container.querySelector(`.journal-section[data-index="${index}"]`);
        if (!section) return;

        const photoFrame = section.querySelector('.photo-frame');
        if (photoFrame) {
            photoFrame.innerHTML = `<img src="${e.target.result}" alt="Uploaded Garden View Element">`;
        }

        const current = journalDatabase[currentEntryIndex];
        if (current && current.sections[index]) {
            current.sections[index].image = e.target.result;
        }

        triggerAutoSaveFeedback();
        showNotification(`Photo added.`);
    };
    reader.readAsDataURL(file);
}
/* ---------------------------------------------------------
   NOTIFICATIONS
   --------------------------------------------------------- */
function showNotification(msg) {
    const box = document.getElementById('appNotification');
    box.innerText = msg;
    box.classList.add('visible');
    setTimeout(() => { box.classList.remove('visible'); }, 3000);
}

function toggleEditMode() {
    isEditMode = !isEditMode;

    document.querySelectorAll('.text-area-input, .weather-stats-input, .weather-feel-input')
        .forEach(el => {
            el.contentEditable = isEditMode ? 'true' : 'false';
        });

    const dateInput = document.getElementById('entryInlineDate');
    if (dateInput) {
        dateInput.disabled = !isEditMode;
    }

    const changeLocationButton = document.getElementById('changeLocationButton');
    if (changeLocationButton) {
        changeLocationButton.style.display = isEditMode ? 'inline-block' : 'none';
    }

    document.querySelectorAll('.photo-container').forEach(photo => {
        photo.classList.toggle('photo-editable', isEditMode);
    });

    const button = document.getElementById('editModeButton');
    if (button) {
        button.textContent = isEditMode ? 'Done' : 'Edit';
    }

    if (isEditMode) {
        showNotification('Edit mode on — you can now change this entry.');
    } else {
        triggerAutoSaveFeedback();
        showNotification('Changes saved.');
    }

    const journalTitle = document.getElementById('journalTitleInput');
    if (journalTitle) {
        journalTitle.contentEditable = isEditMode ? 'true' : 'false';
    }

    // NEW: toggle the is-editing class on the journal page so that
    // Edit-mode-only controls (e.g. the + button) appear/hide.
    const journalPage = document.getElementById('journalPage');
    if (journalPage) {
        journalPage.classList.toggle('is-editing', isEditMode);
    }
   // NEW: entering or leaving Edit mode clears any pending undo.
    lastDeletedSection = null;
    hideUndoBanner();
}

function lockJournalEditing() {
    document.querySelectorAll('.text-area-input, .weather-stats-input, .weather-feel-input')
        .forEach(el => {
            el.contentEditable = 'false';
        });

    const dateInput = document.getElementById('entryInlineDate');
    if (dateInput) {
        dateInput.disabled = true;
    }

    isEditMode = false;

    const button = document.getElementById('editModeButton');
    if (button) {
        button.textContent = 'Edit';
    }

    // NEW: hide Edit-mode-only controls (e.g. the + button) by
    // removing the is-editing class from the journal page.
    const journalPage = document.getElementById('journalPage');
    if (journalPage) {
        journalPage.classList.remove('is-editing');
    }
}

async function changeGardenLocation() {
    const newLocation = prompt(
        "Enter your garden location:",
        journalDatabase[currentEntryIndex].location || ""
    );

    if (!newLocation || !newLocation.trim()) return;

    journalDatabase[currentEntryIndex].location = newLocation.trim();

    const locationDisplay = document.getElementById('gardenLocationDisplay');
    if (locationDisplay) {
        locationDisplay.innerText = newLocation.trim();
    }

    const weatherDisplay = document.getElementById('weatherStatsDisplay');
    if (weatherDisplay) {
        weatherDisplay.innerText = "Weather loading...";
    }

    try {
        await updateEntryWeather();
    } catch (error) {
        console.error("Location weather update failed:", error);
    }

    triggerAutoSaveFeedback();
}

async function geocodeGardenLocation(locationName) {
    const url =
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(locationName)}&count=1&language=en&format=json`;

    const response = await fetch(url);
    const data = await response.json();

    if (!data.results || data.results.length === 0) {
        throw new Error('Location not found.');
    }

    return {
        latitude: data.results[0].latitude,
        longitude: data.results[0].longitude,
        timezone: data.results[0].timezone
    };
}
async function getGardenWeather(latitude, longitude, date) {
    const url =
        `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
        `&hourly=temperature_2m,weather_code` +
        `&start_date=${date}&end_date=${date}` +
        `&timezone=auto`;

    const response = await fetch(url);
    const data = await response.json();

    if (!data.hourly) {
        throw new Error('Weather data not found.');
    }

    const noonIndex = data.hourly.time.findIndex(time =>
        time.includes('T12:00')
    );

    if (noonIndex === -1) {
        throw new Error('Noon weather data not found.');
    }

    return {
        temperature: data.hourly.temperature_2m[noonIndex],
        weatherCode: data.hourly.weather_code[noonIndex]
    };
}
function weatherCodeToText(code) {
    if (code === 0) return "Sunny";
    if (code === 1) return "Mostly sunny";
    if (code === 2) return "Partly cloudy";
    if (code === 3) return "Cloudy";
    if ([45, 48].includes(code)) return "Foggy";
    if ([51, 53, 55, 56, 57].includes(code)) return "Drizzle";
    if ([61, 63, 65, 66, 67].includes(code)) return "Rainy";
    if ([71, 73, 75, 77].includes(code)) return "Snowy";
    if ([80, 81, 82].includes(code)) return "Rain showers";
    if ([85, 86].includes(code)) return "Snow showers";
    if ([95, 96, 99].includes(code)) return "Thunderstorms";

    return "Unknown";
}
async function updateEntryWeather() {
    const entry = journalDatabase[currentEntryIndex];

    if (!entry || !entry.location || !entry.date) return;

    try {
        const location = await geocodeGardenLocation(entry.location);

        entry.latitude = location.latitude;
        entry.longitude = location.longitude;
        entry.timezone = location.timezone;

        const weather = await getGardenWeather(
            location.latitude,
            location.longitude,
            entry.date
        );

        const temperatureF = Math.round((weather.temperature * 9 / 5) + 32);
        const condition = weatherCodeToText(weather.weatherCode);

        entry.weatherStats = `${temperatureF}°F · ${condition}`;

        const weatherDisplay = document.getElementById('weatherStatsDisplay');

        if (weatherDisplay) {
            weatherDisplay.innerText = entry.weatherStats;
        }

        triggerAutoSaveFeedback();

    } catch (error) {
        console.error("Weather lookup failed:", error);

        const weatherDisplay = document.getElementById('weatherStatsDisplay');

        if (weatherDisplay) {
            weatherDisplay.innerText = "Weather unavailable";
        }
    }
}
function backupJournal() {
    const backupData = JSON.stringify(journalDatabase, null, 2);

    const blob = new Blob([backupData], {
        type: 'application/json'
    });

    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = `garden-journal-backup-${new Date().toISOString().split('T')[0]}.json`;

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(url);

    showNotification('Garden Journal backup downloaded successfully.');
}
function restoreJournal() {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json,application/json';

    fileInput.addEventListener('change', function(event) {
        const file = event.target.files[0];

        if (!file) return;

         const confirmed = confirm(
          'Restore this backup? Your current journal entries will be replaced.'
         );

       if (!confirmed) return;

       const reader = new FileReader();
       
        reader.onload = function(e) {
            try {
                const restoredData = JSON.parse(e.target.result);

                if (!Array.isArray(restoredData)) {
                    throw new Error('Invalid backup format.');
                }

                journalDatabase = restoredData;
                currentEntryIndex = 0;

                renderEntry(currentEntryIndex);

                showNotification('Garden Journal restored successfully.');

            } catch (error) {
                console.error('Restore failed:', error);
                showNotification('Restore failed. The backup file is invalid.');
            }
        };

        reader.readAsText(file);
    });

    fileInput.click();
}
/* ---------------------------------------------------------
   REMOVE-SECTION BUTTON
   Small − button rendered inside every section. Hidden by CSS
   unless #journalPage has the is-editing class.
   --------------------------------------------------------- */
function buildRemoveSectionButton(index) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'remove-section-btn';
    button.title = 'Remove this section';
    button.setAttribute('aria-label', 'Remove section');
    button.textContent = '−';
    button.addEventListener('click', (e) => {
        e.stopPropagation();
        removeSection(index);
    });
    return button;
}


   /* ---------------------------------------------------------
   UNDO BANNER
   Rendered at the top of the sections container. Hidden by
   default; .visible makes it show (but only in Edit mode —
   the CSS gates it on .is-editing).
   --------------------------------------------------------- */
function buildUndoBanner() {
    const banner = document.createElement('div');
    banner.className = 'undo-banner';
    banner.id = 'undoBanner';

    banner.innerHTML = `
        <span class="undo-banner-message" id="undoBannerMessage"></span>
        <span class="undo-banner-actions">
            <button type="button" class="undo-banner-btn" id="undoBannerUndoBtn">Undo</button>
            <button type="button" class="undo-banner-btn undo-banner-dismiss" id="undoBannerDismissBtn" aria-label="Dismiss">×</button>
        </span>`;

    banner.querySelector('#undoBannerUndoBtn').addEventListener('click', undoLastDelete);
    banner.querySelector('#undoBannerDismissBtn').addEventListener('click', () => {
        lastDeletedSection = null;
        hideUndoBanner();
    });

    return banner;
}

function showUndoBanner() {
    const banner = document.getElementById('undoBanner');
    const message = document.getElementById('undoBannerMessage');
    if (!banner || !message) return;

    if (!lastDeletedSection) {
        hideUndoBanner();
        return;
    }

    const layout = lastDeletedSection.section.layout || 'arr-1';
    const layoutName = (LAYOUTS.find(l => l.id === layout) || {}).name || 'Section';
    message.textContent = `Removed: ${layoutName}`;
    banner.classList.add('visible');
}

function hideUndoBanner() {
    const banner = document.getElementById('undoBanner');
    if (banner) banner.classList.remove('visible');
}

/* ---------------------------------------------------------
   PHOTO SOURCE MENU
   Small popup offering Camera or Gallery. Rendered on demand,
   positioned near the tapped photo container.
   --------------------------------------------------------- */

let activePhotoMenu = null;   // the currently-open menu element, or null

function openPhotoSourceMenu(photoContainer, index) {
    closePhotoSourceMenu();

    const menu = document.createElement('div');
    menu.className = 'photo-source-menu';

    const cameraBtn = document.createElement('button');
    cameraBtn.type = 'button';
    cameraBtn.innerHTML = '<span class="source-icon">📷</span><span>Take Photo</span>';
    cameraBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        choosePhotoSource('camera', index);
    });

    const galleryBtn = document.createElement('button');
    galleryBtn.type = 'button';
    galleryBtn.innerHTML = '<span class="source-icon">🖼️</span><span>Choose from Gallery</span>';
    galleryBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        choosePhotoSource('gallery', index);
    });

    menu.appendChild(cameraBtn);
    menu.appendChild(galleryBtn);

    // Position the menu just below the photo container.
    const rect = photoContainer.getBoundingClientRect();
    menu.style.position = 'absolute';
    menu.style.top = (window.scrollY + rect.bottom + 6) + 'px';
    menu.style.left = (window.scrollX + rect.left) + 'px';

    document.body.appendChild(menu);

    // Force a reflow so the .visible transition (if any) applies cleanly.
    void menu.offsetWidth;
    menu.classList.add('visible');

    activePhotoMenu = menu;
}

function closePhotoSourceMenu() {
    if (activePhotoMenu && activePhotoMenu.parentElement) {
        activePhotoMenu.parentElement.removeChild(activePhotoMenu);
    }
    activePhotoMenu = null;
}

function choosePhotoSource(source, index) {
    closePhotoSourceMenu();

    const container = document.getElementById('sectionsContainer');
    const section = container.querySelector(`.journal-section[data-index="${index}"]`);
    if (!section) return;

    // The two file inputs are siblings of the photo container, in
    // the order: gallery first, camera second.
    const inputs = section.querySelectorAll('input[type="file"]');
    if (!inputs || inputs.length < 2) return;

    const galleryInput = inputs[0];
    const cameraInput = inputs[1];

    if (source === 'camera') {
        cameraInput.click();
    } else {
        galleryInput.click();
    }
}

/* ---------------------------------------------------------
   GLOBAL DISMISS FOR THE PHOTO SOURCE MENU
   Clicking anywhere outside the menu closes it. Escape closes it.
   --------------------------------------------------------- */
document.addEventListener('click', (e) => {
    if (!activePhotoMenu) return;
    if (e.target === activePhotoMenu || activePhotoMenu.contains(e.target)) return;
    closePhotoSourceMenu();
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closePhotoSourceMenu();
    }
});



/* ---------------------------------------------------------
   UNDO LAST DELETE
   Re-inserts the stashed section at its original index.
   --------------------------------------------------------- */
function undoLastDelete() {
    if (!lastDeletedSection) return;

    const { section, index, entryIndex } = lastDeletedSection;
    const entry = journalDatabase[entryIndex];
    if (!entry) {
        lastDeletedSection = null;
        hideUndoBanner();
        return;
    }

    // If the user navigated away from the entry they deleted from,
    // still re-insert into the original entry (the index is relative
    // to that entry's sections array), but do not change the current
    // view. The user will see the effect when they navigate back.
    const clampedIndex = Math.max(0, Math.min(index, entry.sections.length));
    entry.sections.splice(clampedIndex, 0, section);

    lastDeletedSection = null;

    // Only re-render if we're still looking at the same entry.
    if (currentEntryIndex === entryIndex) {
        renderEntry(currentEntryIndex);
        triggerAutoSaveFeedback();
    }

    showNotification('Section restored.');
}

/* ---------------------------------------------------------
   REMOVE SECTION
   Splices the section at `index` out of the current entry,
   stashes it for undo, re-renders, and shows the Undo banner.
   --------------------------------------------------------- */
function removeSection(index) {
    const entry = journalDatabase[currentEntryIndex];
    if (!entry) return;
    if (index < 0 || index >= entry.sections.length) return;

    const [removed] = entry.sections.splice(index, 1);

    lastDeletedSection = {
        section: removed,
        index: index,
        entryIndex: currentEntryIndex
    };

    renderEntry(currentEntryIndex);
    triggerAutoSaveFeedback();
    showUndoBanner();
}
