/* =========================================================
   GARDEN JOURNAL — APPLICATION LOGIC
   Function names are unchanged so existing inline handlers
   in index.html continue to resolve.
   ========================================================= */
let isEditMode = false;
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

const SECTION_COUNT = 4;

/* ---------------------------------------------------------
   BOOTSTRAP
   --------------------------------------------------------- */
window.onload = function () {
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
function renderEntry(index) {
    if (index < 0 || index >= journalDatabase.length) return;
    currentEntryIndex = index;

    const entry = journalDatabase[currentEntryIndex];

    document.getElementById('entryInlineDate').value = entry.date;
    const weatherDisplay = document.getElementById('weatherStatsDisplay');
    if (weatherDisplay) {
    weatherDisplay.innerText = entry.weatherStats || 'Weather loading...';
    }
    document.getElementById('weatherFeelInput').innerText = entry.weatherFeel || '';

    for (let i = 0; i < SECTION_COUNT; i++) {
        const textInput = document.getElementById('textInput' + (i + 1));
        const photoFrame = document.getElementById('photoFrame' + (i + 1));
        const secData = entry.sections[i];

        textInput.innerText = secData.text || '';

        if (secData.image) {
            photoFrame.innerHTML = `<img src="${secData.image}" alt="Garden View Slot">`;
        } else {
            renderPlaceholder(i + 1);
        }
    }

    document.getElementById('pageIndicator').innerText =
        `Page ${currentEntryIndex + 1} of ${journalDatabase.length}`;
    document.getElementById('btnPrev').disabled = (currentEntryIndex === 0);
    document.getElementById('btnNext').disabled = (currentEntryIndex === journalDatabase.length - 1);
}

function renderPlaceholder(id) {
    const frame = document.getElementById('photoFrame' + id);
    frame.innerHTML = `
        <div class="photo-placeholder-graphic">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="18" height="18" rx="0" />
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <path d="M21 15l-5-5L5 21" />
            </svg>
            <span>Select Photo</span>
        </div>`;
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
   EDITABLE FIELDS — TEXT SECTIONS
   Listeners are attached once at parse time to the four
   persistent .text-area-input nodes.
   --------------------------------------------------------- */
document.querySelectorAll('.text-area-input').forEach((input, idx) => {
    input.addEventListener('input', () => {
        journalDatabase[currentEntryIndex].sections[idx].text = input.innerText;

        if (idx === 0 && input.innerText.trim().length > 0) {
            const cleanWords = input.innerText.trim().split(" ").slice(0, 3).join(" ");
            journalDatabase[currentEntryIndex].displayTitle = cleanWords + "...";
        }

        clearTimeout(typingDebounceTimeout);
        typingDebounceTimeout = setTimeout(() => { triggerAutoSaveFeedback(); }, 600);
    });
});

/* ---------------------------------------------------------
   DATE EDITING
   --------------------------------------------------------- */
function handleInlineDateChange(dateValue) {
    if (!dateValue) return;
    journalDatabase[currentEntryIndex].date = dateValue;
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
    const todayStr = new Date().toISOString().split('T')[0];
    const newBlankPage = {
        date: todayStr,
        displayTitle: "New Organic Entry",
        location: "Tallahassee, FL",
        weatherStats: "",
        weatherFeel: "",
        sections: [
            { text: "", image: "" },
            { text: "", image: "" },
            { text: "", image: "" },
            { text: "", image: "" }
        ]
    };
    journalDatabase.push(newBlankPage);
    renderEntry(journalDatabase.length - 1);
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
function Dropdown(event) {
    event.stopPropagation();
    document.getElementById('appDropdown').classList.add('show');
}

window.addEventListener('click', function () {
    const dropdown = document.getElementById('appDropdown');
    if (dropdown) dropdown.classList.remove('show');
});

function handleMenuAction(action) {
    if (action === 'edit') {
        const firstInput = document.getElementById('textInput1');
        if (firstInput) {
            firstInput.classList.add('editing-focus');
            firstInput.focus();
            showNotification('Direct edit focus triggered on Section 1.');
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
                sections: [
                    { text: "", image: "" },
                    { text: "", image: "" },
                    { text: "", image: "" },
                    { text: "", image: "" }
                ]
            };
            renderEntry(0);
            showNotification('Single entry wiped cleanly.');
        }
    }
}

/* ---------------------------------------------------------
   PHOTOS
   --------------------------------------------------------- */
function triggerPhotoUpload(id) {
    if (!isEditMode) return;

    const fileInput = document.getElementById('fileInput' + id);
    if (fileInput) {
        fileInput.click();
    }
}


function handlePhotoSelect(event, id) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function (e) {
            const frame = document.getElementById('photoFrame' + id);
            frame.innerHTML = `<img src="${e.target.result}" alt="Uploaded Garden View Element">`;
            journalDatabase[currentEntryIndex].sections[id - 1].image = e.target.result;
            triggerAutoSaveFeedback();
            showNotification(`Photo mapped successfully to Section ${id}.`);
        };
        reader.readAsDataURL(file);
    }
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

    // Lock/unlock text areas
    document.querySelectorAll('.text-area-input, .weather-stats-input, .weather-feel-input')
        .forEach(el => {
            el.contentEditable = isEditMode ? 'true' : 'false';
        });

    // Lock/unlock date
    const dateInput = document.getElementById('entryInlineDate');
    if (dateInput) {
        dateInput.disabled = !isEditMode;
    }

    // Give photo areas a visual state
    document.querySelectorAll('.photo-container').forEach(photo => {
        photo.classList.toggle('photo-editable', isEditMode);
    });

    // Change button
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
}
function changeGardenLocation() {
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

    triggerAutoSaveFeedback();
    showNotification(`Garden location updated to ${newLocation.trim()}.`);
}
