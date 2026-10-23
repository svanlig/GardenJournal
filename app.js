/*Stage 6: Automatic local-first sync engine (Queue + Network loop)*/
/* ---------- Stage 1:: persistence state ---------- */
let isAppReady = false;
let _persistTimer = null;
let _persistInFlight = false;
let _persistPendingAgain = false;
const PERSIST_DEBOUNCE_MS = 500;

/* =========================================================
   GARDEN JOURNAL — APPLICATION LOGIC - 
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
   SUPABASE CLIENT
   Only used for auth in Stage 3. No data sync yet.
   --------------------------------------------------------- */
const SUPABASE_URL = 'https://wvsrhuvjgfwxkmlkfozc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind2c3JodXZqZ2Z3eGttbGtmb3pjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIxNjI0NDUsImV4cCI6MjEwNzczODQ0NX0.HUTToc9yfP5gxrpeD1-7LQNv3XKqReamT2vSgPDxgk0';

let supabaseClient = null;
try {
    supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} catch (e) {
    console.error('Supabase init failed:', e);
}

/* ---------------------------------------------------------
   CLOUD SYNC (Stage 5: One-way Upload)
   --------------------------------------------------------- */

async function pushToCloud() {
    if (!supabaseClient || !currentSession) {
        showNotification('Please sign in to upload.');
        return;
    }

    const confirmed = confirm("Upload this device's journal to the cloud? This will overwrite any existing cloud data for this account.");
    if (!confirmed) return;

    const btn = document.getElementById('btnUploadCloud');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Uploading...';
    showNotification('Starting upload...');

    try {
        const userId = currentSession.user.id;
        let uploadedEntries = 0;
        let uploadedSections = 0;
        let uploadedPhotos = 0;

        // Iterate over entries to process photos and build the insert payloads
        for (const entry of journalDatabase) {
            ensureEntryId(entry);

            // 1. Upload Entry
            const entryPayload = {
                user_id: userId,
                local_id: entry._id,
                date: entry.date,
                display_title: entry.displayTitle || '',
                location: entry.location || '',
                climate: entry.climate || '',
                weather_stats: entry.weatherStats || '',
                weather_feel: entry.weatherFeel || '',
                sort_order: entry.sortOrder || 0
            };

            const { error: entryError } = await supabaseClient
                .from('entries')
                .upsert(entryPayload, { onConflict: 'user_id, local_id' });

            if (entryError) throw new Error("Entry insert failed: " + entryError.message);
            uploadedEntries++;

            // 2. Upload Sections
            for (const sec of (entry.sections || [])) {
                ensureSectionId(sec, entry._id);

                let photoUrl = sec.image || '';

                // If the image is a local Data URL, upload it to Storage
                if (photoUrl.startsWith('data:image/')) {
                    const blob = dataURLtoBlob(photoUrl);
                    const fileExt = blob.type.split('/')[1] || 'jpeg';
                    const filePath = `${userId}/${entry._id}/${sec._id}.${fileExt}`;

                    const { error: uploadError } = await supabaseClient.storage
                        .from('photos')
                        .upload(filePath, blob, { upsert: true });

                    if (uploadError) {
                        console.error("Photo upload failed for section", sec._id, uploadError);
                        // We continue anyway, keeping the data URL locally if it fails
                    } else {
                        // Get the public URL (or create a signed URL if private)
                        // Note: Since your bucket is private, we need a signed URL.
                        // For simplicity in Stage 5, we'll generate a long-lived signed URL (1 year).
                        const { data: urlData, error: urlError } = await supabaseClient.storage
                            .from('photos')
                            .createSignedUrl(filePath, 31536000); // 1 year in seconds

                        if (!urlError && urlData) {
                            photoUrl = urlData.signedUrl;
                            uploadedPhotos++;
                        }
                    }
                }

                // Update the local model with the new URL so we don't re-upload next time
                sec.image = photoUrl;
                markSectionDirty(sec); // We'll clear this dirty flag after everything finishes

                const sectionPayload = {
                    user_id: userId,
                    entry_local_id: entry._id,
                    local_id: sec._id,
                    layout: sec.layout,
                    sort_order: sec.sortOrder || 0,
                    label: sec.label || '',
                    text: sec.text || '',
                    texts: sec.texts || null,
                    labels: sec.labels || null,
                    photo_url: photoUrl
                };

                const { error: secError } = await supabaseClient
                    .from('sections')
                    .upsert(sectionPayload, { onConflict: 'user_id, local_id' });

                if (secError) throw new Error("Section insert failed: " + secError.message);
                uploadedSections++;
            }
        }

        // 3. If we made it here, the cloud is up to date.
        // Clear all dirty flags locally.
        journalDatabase.forEach(e => {
            e._dirty = false;
            (e.sections || []).forEach(s => s._dirty = false);
        });

        // Save locally to reflect the new photo URLs and cleared dirty flags
        await persistImmediately();

        showNotification(`Success! Uploaded ${uploadedEntries} entries, ${uploadedSections} sections.`);
        alert(`Upload complete!\n\n${uploadedEntries} entries\n${uploadedSections} sections\n${uploadedPhotos} photos uploaded.`);

    } catch (err) {
        console.error('Cloud upload failed:', err);
        showNotification('Upload failed. Check console.');
        alert('Upload failed: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.textContent = originalText;
    }
}

/* Debug helper for Stage 6A */
window.showQueue = async function() {
    const q = await getSyncQueue();
    console.log(`--- SYNC QUEUE (${q.length} items) ---`);
    q.forEach(item => console.log(item));
};

// Helper to convert Data URL to Blob
function dataURLtoBlob(dataurl) {
    var arr = dataurl.split(','), mime = arr[0].match(/:(.*?);/)[1],
        bstr = atob(arr[1]), n = bstr.length, u8arr = new Uint8Array(n);
    while(n--){
        u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], {type:mime});
}
/* ---------------------------------------------------------
   STAGE 6B: NETWORK LOOP (PUSH)
   --------------------------------------------------------- */

let isSyncing = false;

async function processSyncQueue() {
    // 1. Safety checks
    if (!window.isAppReady || !supabaseClient || !currentSession || isSyncing) return;
    if (!navigator.onLine) return; // Don't try if offline

    isSyncing = true;

    try {
        const queue = await getSyncQueue();
        if (queue.length === 0) {
            isSyncing = false;
            return;
        }

        console.log(`Processing ${queue.length} sync items...`);

        // Process items one by one
        for (const item of queue) {
            // Find the actual data in memory
            const entry = journalDatabase.find(e => e._id === item.recordId);
            let section = null;
            let parentEntry = null;
            
            if (!entry) {
                // If it's a section, find its parent entry
                for (const e of journalDatabase) {
                    const sec = (e.sections || []).find(s => s._id === item.recordId);
                    if (sec) {
                        section = sec;
                        parentEntry = e;
                        break;
                    }
                }
            }

            // If we can't find the data, it was deleted from memory. Skip it.
            if (!entry && !section) {
                await removeFromSyncQueue(item._queueId);
                continue;
            }

            try {
                if (item.entity === 'entry') {
                    await pushEntryToCloud(entry, item.action);
                } else if (item.entity === 'section') {
                    await pushSectionToCloud(section, parentEntry, item.action);
                }
                
                // If successful, remove from queue
                await removeFromSyncQueue(item._queueId);
                
            } catch (err) {
                console.error(`Failed to sync ${item.entity} ${item.recordId}:`, err);
                // Increment attempt count, update in DB, and abort loop to retry later
                await updateQueueItemError(item._queueId, err.message);
                throw err; 
            }
        }
        
        console.log('Queue processed successfully.');
        showNotification('Cloud sync complete.');
        
    } catch (err) {
        console.warn('Sync paused due to error. Will retry later.');
    } finally {
        isSyncing = false;
    }
}

async function pushEntryToCloud(entry, action) {
    const userId = currentSession.user.id;
    
    if (action === 'delete') {
        const { error } = await supabaseClient
            .from('entries')
            .update({ deleted_at: new Date().toISOString() })
            .eq('user_id', userId)
            .eq('local_id', entry._id);
        if (error) throw error;
        return;
    }

    const payload = {
        user_id: userId,
        local_id: entry._id,
        date: entry.date,
        display_title: entry.displayTitle || '',
        location: entry.location || '',
        climate: entry.climate || '',
        weather_stats: entry.weatherStats || '',
        weather_feel: entry.weatherFeel || '',
        sort_order: entry.sortOrder || 0,
        deleted_at: null
    };

    const { error } = await supabaseClient
        .from('entries')
        .upsert(payload, { onConflict: 'user_id, local_id' });
    
    if (error) throw error;
}

async function pushSectionToCloud(section, parentEntry, action) {
    const userId = currentSession.user.id;
    
    if (action === 'delete') {
        const { error } = await supabaseClient
            .from('sections')
            .update({ deleted_at: new Date().toISOString() })
            .eq('user_id', userId)
            .eq('local_id', section._id);
        if (error) throw error;
        return;
    }

    // Handle Photo Upload if this is a new local Data URL
    let photoUrl = section.image || '';
    if (photoUrl.startsWith('data:image/')) {
        const blob = dataURLtoBlob(photoUrl);
        const fileExt = blob.type.split('/')[1] || 'jpeg';
        const filePath = `${userId}/${parentEntry._id}/${section._id}.${fileExt}`;

        const { error: uploadError } = await supabaseClient.storage
            .from('photos')
            .upload(filePath, blob, { upsert: true });

        if (!uploadError) {
            const { data: urlData } = await supabaseClient.storage
                .from('photos')
                .createSignedUrl(filePath, 31536000); // 1 year
            if (urlData) photoUrl = urlData.signedUrl;
        }
        
        // Update memory so we don't upload it again
        section.image = photoUrl;
    }

    const payload = {
        user_id: userId,
        entry_local_id: parentEntry._id,
        local_id: section._id,
        layout: section.layout,
        sort_order: section.sortOrder || 0,
        label: section.label || '',
        text: section.text || '',
        texts: section.texts || null,
        labels: section.labels || null,
        photo_url: photoUrl,
        deleted_at: null
    };

    const { error } = await supabaseClient
        .from('sections')
        .upsert(payload, { onConflict: 'user_id, local_id' });
    
    if (error) throw error;
}


async function updateQueueItemError(queueId, errorMsg) {
    const tx = _db.transaction(['syncQueue'], 'readwrite');
    const store = tx.objectStore('syncQueue');
    const req = store.get(queueId);
    req.onsuccess = () => {
        const item = req.result;
        if (item) {
            item._attemptCount = (item._attemptCount || 0) + 1;
            item._lastError = errorMsg;
            store.put(item);
        }
    };
    await _txDone(tx);
}


/* ---------------------------------------------------------
   AUTH STATE + UI
   --------------------------------------------------------- */
let currentSession = null;
let authMode = 'signin';   // 'signin' or 'signup'

async function initAuth() {
    if (!supabaseClient) {
        window.isAppReady = true; // App is ready even if offline
        return;
    }

    try {
        // 1. Listen for changes (defer the UI update so we don't block the auth client)
        supabaseClient.auth.onAuthStateChange((event, session) => {
            currentSession = session;
            setTimeout(() => {
                updateAuthUI();
                if (event === 'SIGNED_IN') showNotification('Signed in.');
                if (event === 'SIGNED_OUT') showNotification('Signed out.');
            }, 0);
        });

        // 2. Manually check the session on load
        const { data, error } = await supabaseClient.auth.getSession();
        if (error) throw error;
        
        currentSession = data.session;
        updateAuthUI();
        
        // 3. Mark the app as ready to sync
        window.isAppReady = true;
        
    } catch (err) {
        console.error('initAuth failed:', err);
        // Even if auth fails, the app is ready to sync locally
        window.isAppReady = true; 
    }
}

function updateAuthUI() {
    // 1. App Bar elements
    const btnSignIn = document.getElementById('btnSignIn');
    const btnSignOut = document.getElementById('btnSignOut');
    const authEmail = document.getElementById('authEmail');

    // 2. Landing Page elements
    const landBtnSignIn = document.getElementById('landingBtnSignIn');
    const landBtnSignOut = document.getElementById('landingBtnSignOut');
    const landAuthUser = document.getElementById('landingAuthUser');
    const landAuthEmail = document.getElementById('landingAuthEmail');
    const btnUploadCloud = document.getElementById('btnUploadCloud');

    if (currentSession && currentSession.user) {
        // Logged In State
        if (btnSignIn) btnSignIn.style.display = 'none';
        if (btnSignOut) btnSignOut.style.display = 'inline-block';
        if (authEmail) authEmail.textContent = currentSession.user.email || '';

        if (landBtnSignIn) landBtnSignIn.style.display = 'none';
        if (landAuthUser) landAuthUser.style.display = 'block';
        if (landAuthEmail) landAuthEmail.textContent = currentSession.user.email || '';
        if (landBtnSignOut) landBtnSignOut.style.display = 'block';
        if (btnUploadCloud) btnUploadCloud.style.display = 'block';
    } else {
        // Logged Out State
        if (btnSignIn) btnSignIn.style.display = 'inline-block';
        if (btnSignOut) btnSignOut.style.display = 'none';
        if (authEmail) authEmail.textContent = '';

        if (landBtnSignIn) landBtnSignIn.style.display = 'block';
        if (landAuthUser) landAuthUser.style.display = 'none';
        if (landBtnSignOut) landBtnSignOut.style.display = 'none';
        if (btnUploadCloud) btnUploadCloud.style.display = 'none';
    }

   const btnSync = document.getElementById('btnManualSync');

    if (currentSession && currentSession.user) {
        // ... existing logged in code ...
        if (btnSync) btnSync.style.display = 'inline-block'; // Show sync button
    } else {
        // ... existing logged out code ...
        if (btnSync) btnSync.style.display = 'none'; // Hide sync button
    }
}

function openAuthView() {
    authMode = 'signin';
    renderAuthMode();
    document.querySelectorAll('.view-panel').forEach(p => p.classList.remove('active'));
    document.getElementById('authViewContainer').classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function closeAuthView() {
    document.getElementById('authViewContainer').classList.remove('active');
    // Just return to the landing page, regardless of whether there are entries.
    showLandingPage();
}

function toggleAuthMode() {
    authMode = authMode === 'signin' ? 'signup' : 'signin';
    renderAuthMode();
}

function renderAuthMode() {
    const title = document.getElementById('authTitle');
    const subtitle = document.getElementById('authSubtitle');
    const submitBtn = document.getElementById('authSubmitBtn');
    const switchText = document.getElementById('authSwitchText');
    const switchBtn = document.getElementById('authSwitchBtn');

    if (authMode === 'signin') {
        if (title) title.textContent = 'Sign in';
        if (subtitle) subtitle.textContent = 'Welcome back to your garden journal.';
        if (submitBtn) submitBtn.textContent = 'Sign in';
        if (switchText) switchText.textContent = "Don't have an account?";
        if (switchBtn) switchBtn.textContent = 'Sign up';
    } else {
        if (title) title.textContent = 'Create an account';
        if (subtitle) subtitle.textContent = 'A place for your garden memories.';
        if (submitBtn) submitBtn.textContent = 'Sign up';
        if (switchText) switchText.textContent = 'Already have an account?';
        if (switchBtn) switchBtn.textContent = 'Sign in';
    }
}

async function handleAuthSubmit(event) {
    event.preventDefault();
    if (!supabaseClient) {
        showNotification('Sign-in is not available. Check your connection.');
        return;
    }

    const email = document.getElementById('authEmailInput').value.trim();
    const password = document.getElementById('authPasswordInput').value;
    const submitBtn = document.getElementById('authSubmitBtn');

    if (!email || !password) return;

    submitBtn.disabled = true;
    const originalText = submitBtn.textContent;
    submitBtn.textContent = authMode === 'signin' ? 'Signing in…' : 'Creating account…';

    try {
        if (authMode === 'signin') {
            const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
            if (error) throw error;
            // Force update immediately on success
            currentSession = data.session;
            updateAuthUI();
            showNotification('Signed in.');
           
        } else {
            const { data, error } = await supabaseClient.auth.signUp({ email, password });
            if (error) throw error;
            // If auto-confirmed, signUp returns a session
            if (data.session) {
                currentSession = data.session;
                updateAuthUI();
            }
           
            showNotification('Account created. Check your email to confirm if required.');
        }
        closeAuthView();
    } catch (err) {
        console.error('Auth error:', err);
        showNotification(err.message || 'Sign-in failed.');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
    }
}

async function handleSignOut() {
    if (!supabaseClient) return;
    const { error } = await supabaseClient.auth.signOut();
    if (error) {
        console.error('Sign out failed:', error);
        showNotification('Sign out failed.');
    } else {
        // Force update immediately on success
        currentSession = null;
        updateAuthUI();
        showNotification('Signed out.');
    }
}

/* ---------------------------------------------------------
   DATA
   --------------------------------------------------------- */
let journalDatabase = [
    {
  "date": "2026-10-23",
  "displayTitle": "Welcome to Your Garden Journal!",
  "location": "Your Garden",
  "climate": "Your Zone",
  "weatherStats": "Sunny",
  "weatherFeel": "Describe how the weather feels today!",
  "sortOrder": 0,
  "sections": [
    {
      "layout": "arr-6",
      "text": "This is a place that you can use to keep track of your garden successes and fails, and anything in between. The aim is to make garden journaling easier, so you can look back and remember the beautiful memories you made in your garden!",
      "image": "",
      "sortOrder": 0,
      "label": "A JOURNAL FOR YOUR GARDEN"
    },
    {
      "layout": "arr-2",
      "sortOrder": 1,
      "label": "ORGANIZE AND CUSTOMIZE",
      "text": "Click EDIT to start journaling. +ADD LAYOUT to add a section the page. Add a photo and scribble some notes. In EDIT mode, you can drag the handles on the top left side to move the section up or down. You can also delete a section by clicking the (-) button at the top right.",
      "image": "https://images.unsplash.com/photo-1611080626919-7cf5a9dbab5b?auto=format&fit=crop&w=1200&q=80"
    },
    {
      "layout": "arr-1",
      "sortOrder": 2,
      "label": "CHOOSE FROM DIFFERENT LAYOUTS",
      "text": "There are a few layouts for you to choose from, notice how this one has a picture on the right?",
      "image": "https://images.unsplash.com/photo-1596547609652-9cf5d8d76921?auto=format&fit=crop&w=600&q=80"
    },
    {
      "layout": "arr-3",
      "sortOrder": 3,
      "label": "SYNC",
      "text": "Everything you write is saved to your private account and synced across your device automatically. You can also choose to backup to your own local device.",
      "image": "https://images.unsplash.com/photo-1543157145-f78c636d023d?auto=format&fit=crop&w=600&q=80"
    },
    {
      "layout": "arr-5",
      "sortOrder": 4,
      "texts": [
        "This 3 note section can be used to organize your garden observations. This one can be a reminder \"Water the greens 3X a week.\"",
        "Give each section its own title. For this one: \"I did not even notice the hornworms until they ate up half the tomato plants. They disguise so well!\"",
        "\"I added a high K fertilizer to the roses, will have to see the results in the following weeks.\"\nThere are so many creative ways to use this space!"
      ],
      "labels": [
        "REMINDERS",
        "MY OBSERVATION",
        "FOLLOW UP"
      ]
    },
    {
      "layout": "arr-4",
      "sortOrder": 5,
      "label": "READY TO GROW?",
      "text": "When you are ready, delete this tutorial entry and create your first real entry. \nYou can also use your own photo editing apps to combine and edit photos, combine them - and then add it here for a more beautiful presentation.\nHappy Journaling and Happy Gardening!",
      "image": "https://images.unsplash.com/photo-1590502593747-42a996133562?auto=format&fit=crop&w=600&q=80"
    }
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
    { id: "arr-4", name: "Photo right / Text left" },
    { id: "arr-5", name: "Three notes" },
    { id: "arr-6", name: "Text block" },
    { id: "arr-7", name: "Image only" }
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
window.onload = async function () {
    try {
        await openDatabase();

        // If the user has used the app before (initialized flag),
        // do NOT fall back to seed data even if entries are empty.
        const initialized = await getMeta('initialized');
        const stored = await loadAll();

        if (stored.entries.length > 0) {
            // Hydrate from IndexedDB.
            journalDatabase = hydrateFromStored(stored);
        } else if (!initialized) {
            // First run — seed data. Mark as seed, assign IDs, persist.
            journalDatabase.forEach((entry, i) => {
                entry._seed = true;
                entry.sortOrder = i;
                ensureEntryId(entry);
                (entry.sections || []).forEach((sec, j) => {
                ensureSectionId(sec, entry._id);
                sec.sortOrder = j;
               sec._dirty = true;
          });
          entry._dirty = true;
       });
           
    await persistImmediately();
    await setMeta('initialized', true);
           
        } else {
            // User has used the app; their journal is empty.
            // Do not seed. Leave journalDatabase empty.
            journalDatabase = [];
        }
    } catch (err) {
        console.error('Failed to load from IndexedDB; falling back to seed data.', err);
        // In-memory seed data remains as the working copy; it will
        // persist on the next mutation.
    }

    migrateJournalDatabase(journalDatabase);
    if (journalDatabase.length === 0) {
       // Journal is empty — go to the landing page.
       showLandingPage();
    } else {
       renderEntry(currentEntryIndex);
       document.querySelector('.app-bar').style.display = 'none';
    }
   
// Wrap setup functions so one error doesn't stop the app from syncing
    try {
        setupWeatherListeners();
    } catch (err) {
        console.error('Weather listener setup failed:', err);
    }

    try {
        lockJournalEditing();
    } catch (err) {
        console.error('Lock editing failed:', err);
    }

    try {
        if (typeof initAuth === 'function') {
            initAuth(); // Note: not awaited, so it runs in background
        }
    } catch (err) {
        console.error('Auth setup failed:', err);
    }

    if (journalDatabase.some(e => e._dirty)) {
       persistImmediately();
    }
   
};

// Independent boot sequence for the sync engine
window.addEventListener('load', () => {
    // Give IndexedDB 2 seconds to settle.
    // If window.onload is stuck, this will still fire.
    setTimeout(() => {
        window.isAppReady = true;
        console.log('Sync engine fired via timeout. isAppReady =', window.isAppReady);
        
        // If there's a queue waiting, process it.
        if (typeof processSyncQueue === 'function') {
            processSyncQueue();
        }
    }, 2000);
});

/* ---------------------------------------------------------
   BOOTSTRAP
   --------------------------------------------------------- */
window.onload = async function () {
    try {
        await openDatabase();

        // If the user has used the app before (initialized flag),
        // do NOT fall back to seed data even if entries are empty.
        const initialized = await getMeta('initialized');
        const stored = await loadAll();

        if (stored.entries.length > 0) {
            // Hydrate from IndexedDB.
            journalDatabase = hydrateFromStored(stored);
        } else if (!initialized) {
            // First run — seed data. Mark as seed, assign IDs, persist.
            journalDatabase.forEach(entry => {
                entry._seed = true;
                ensureEntryId(entry);
                (entry.sections || []).forEach((sec, i) => {
                    ensureSectionId(sec, entry._id);
                    sec.sortOrder = i;
                    sec._dirty = true;
                });
                entry._dirty = true;
            });

            await persistImmediately();
            await setMeta('initialized', true);
        } else {
            // User has used the app; their journal is empty.
            // Do not seed. Leave journalDatabase empty.
            journalDatabase = [];
        }
    } catch (err) {
        console.error('Failed to load from IndexedDB; falling back to seed data.', err);
        // In-memory seed data remains as the working copy; it will
        // persist on the next mutation.
    }

    migrateJournalDatabase(journalDatabase);

    if (journalDatabase.length === 0) {
        // Journal is empty — go to the landing page.
        showLandingPage();
    } else {
        renderEntry(currentEntryIndex);
        document.querySelector('.app-bar').style.display = 'none';
    }

    setupWeatherListeners();
    lockJournalEditing();
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

function formatJournalDate(dateStr) {
    if (!dateStr) return '';
    const parts = String(dateStr).split('-');
    if (parts.length !== 3) return dateStr;
    const [y, m, d] = parts;
    const monthIndex = parseInt(m, 10) - 1;
    if (isNaN(monthIndex) || monthIndex < 0 || monthIndex > 11) return dateStr;
    const monthName = MONTH_NAMES[monthIndex];
    const day = parseInt(d, 10);
    return `${monthName} ${day}, ${y}`;
}

/* ---------------------------------------------------------
   LANDING PAGE HANDLERS
   --------------------------------------------------------- */
function openLatestEntry() {
    if (journalDatabase.length === 0) {
        showNotification('No entries yet. Create one!');
        return;
    }

    // 1. Sort a copy of the journal by date, newest first
    const sorted = [...journalDatabase].sort((a, b) => {
        const da = a.date || '';
        const db = b.date || '';
        if (da === db) return 0;
        return da < db ? 1 : -1;
    });

    // 2. Find the index of that newest entry in the original database array
    const latestEntry = sorted[0];
    const latestIndex = journalDatabase.findIndex(e => e._id === latestEntry._id);

    // 3. Render it and switch views
    if (latestIndex !== -1) {
        renderEntry(latestIndex);
        switchToJournalSheetView();
    }
}


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

    // NEW: three-note layout builds three text panels, no photo.
    if (sectionData.layout === 'arr-5') {
        return buildThreeNoteSection(section, sectionData, index);
    }
    
    if (sectionData.layout === 'arr-6') {
        return buildTextOnlySection(section, sectionData, index);
    }

    if (sectionData.layout === 'arr-7') {
        return buildImageOnlySection(section, sectionData, index);
    }

    // ---- text wrapper ----
    const textWrapper = document.createElement('div');
    textWrapper.className = 'text-wrapper';

    const label = document.createElement('span');
    label.className = 'section-note-label';
    label.textContent = sectionData.label || getDefaultLabelForLayout(sectionData.layout);
    label.contentEditable = isEditMode ? 'true' : 'false';
    label.setAttribute('placeholder', 'Add a title...');

    // Listen for edits and write back to the data model.
    label.addEventListener('input', () => {
       const current = journalDatabase[currentEntryIndex];
       if (!current || !current.sections[index]) return;
       current.sections[index].label = label.innerText;
       markSectionDirty(current.sections[index]);
       clearTimeout(typingDebounceTimeout);
       typingDebounceTimeout = setTimeout(() => { triggerAutoSaveFeedback(); }, 600);
   });

    const textInput = document.createElement('div');
    textInput.className = 'text-area-input';
    textInput.contentEditable = 'true';
    textInput.setAttribute('placeholder', 'Click here to write notes...');
    textInput.innerText = sectionData.text || '';

    textInput.addEventListener('input', () => {
       const current = journalDatabase[currentEntryIndex];
       if (!current || !current.sections[index]) return;
       current.sections[index].text = textInput.innerText;
       markSectionDirty(current.sections[index]);
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
    // All new sections start with an empty title. The user can
    // type one in Edit mode; existing seed entries keep whatever
    // titles they already have.
    return '';
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
   TEXT-ONLY SECTION (arr-6)
   One full-width text panel, leaf green. No photo.
   Uses the standard section.text and section.label fields.
   --------------------------------------------------------- */
function buildTextOnlySection(section, sectionData, index) {
    const wrapper = document.createElement('div');
    wrapper.className = 'text-wrapper';

    const label = document.createElement('span');
    label.className = 'section-note-label';
    label.textContent = sectionData.label || '';
    label.contentEditable = isEditMode ? 'true' : 'false';
    label.setAttribute('placeholder', 'Add a title...');
    label.addEventListener('input', () => {
        const current = journalDatabase[currentEntryIndex];
        if (!current || !current.sections[index]) return;
        current.sections[index].label = label.innerText;
        markSectionDirty(current.sections[index]);
        clearTimeout(typingDebounceTimeout);
        typingDebounceTimeout = setTimeout(() => { triggerAutoSaveFeedback(); }, 600);
    });

    const textInput = document.createElement('div');
    textInput.className = 'text-area-input';
    textInput.contentEditable = isEditMode ? 'true' : 'false';
    textInput.setAttribute('placeholder', 'Write a note...');
    textInput.innerText = sectionData.text || '';
    textInput.addEventListener('input', () => {
        const current = journalDatabase[currentEntryIndex];
        if (!current || !current.sections[index]) return;
        current.sections[index].text = textInput.innerText;
        markSectionDirty(current.sections[index]);
        clearTimeout(typingDebounceTimeout);
        typingDebounceTimeout = setTimeout(() => { triggerAutoSaveFeedback(); }, 600);
    });

    wrapper.appendChild(label);
    wrapper.appendChild(textInput);
    section.appendChild(wrapper);

    section.appendChild(buildRemoveSectionButton(index));
    section.appendChild(buildDragHandle(index));

    return section;
}

/* ---------------------------------------------------------
   IMAGE-ONLY SECTION (arr-7)
   Full-width image, natural proportions, no crop.
   Uses section.image / section.imagePos / section.imageFit,
   same as other layouts, but displays the image uncropped.
   --------------------------------------------------------- */
function buildImageOnlySection(section, sectionData, index) {
    const photoWrapper = document.createElement('div');
    photoWrapper.className = 'photo-wrapper';

    const photoContainer = document.createElement('div');
    photoContainer.className = 'photo-container';

    const photoFrame = document.createElement('div');
    photoFrame.className = 'photo-frame';

    if (sectionData.image) {
        const img = document.createElement('img');
        img.src = sectionData.image;
        img.alt = 'Garden image';
        photoFrame.appendChild(img);
    } else {
        photoFrame.innerHTML = placeholderMarkup();
    }

    // Gallery picker
    const galleryInput = document.createElement('input');
    galleryInput.type = 'file';
    galleryInput.className = 'hidden-file-input';
    galleryInput.accept = 'image/*';
    galleryInput.addEventListener('change', (event) => handlePhotoSelect(event, index));

    // Camera input (opens camera on mobile)
    const cameraInput = document.createElement('input');
    cameraInput.type = 'file';
    cameraInput.className = 'hidden-file-input';
    cameraInput.accept = 'image/*';
    cameraInput.setAttribute('capture', 'environment');
    cameraInput.addEventListener('change', (event) => handlePhotoSelect(event, index));

    photoContainer.addEventListener('click', (event) => triggerPhotoUpload(event, index));

    photoContainer.appendChild(photoFrame);
    photoWrapper.appendChild(photoContainer);
    photoWrapper.appendChild(galleryInput);
    photoWrapper.appendChild(cameraInput);

    section.appendChild(photoWrapper);

    section.appendChild(buildRemoveSectionButton(index));
    section.appendChild(buildDragHandle(index));

    return section;
}

/* ---------------------------------------------------------
   THREE-NOTE SECTION (arr-5)
   Builds three text panels side by side. Each has its own
   label and editable text area, stored in section.labels[]
   and section.texts[].
   --------------------------------------------------------- */
function buildThreeNoteSection(section, sectionData, index) {
    const texts = Array.isArray(sectionData.texts)
        ? [...sectionData.texts]
        : ['', '', ''];
    while (texts.length < 3) texts.push('');

    const labels = Array.isArray(sectionData.labels)
        ? [...sectionData.labels]
        : ['', '', ''];
    while (labels.length < 3) labels.push('');

    sectionData.texts = texts;
    sectionData.labels = labels;

    for (let col = 0; col < 3; col++) {
        const wrapper = document.createElement('div');
        wrapper.className = 'text-wrapper';

        const label = document.createElement('span');
        label.className = 'section-note-label';
        label.textContent = labels[col] || '';
        label.contentEditable = isEditMode ? 'true' : 'false';
        label.setAttribute('placeholder', 'Add a title...');
        label.addEventListener('input', () => {
            const current = journalDatabase[currentEntryIndex];
            if (!current || !current.sections[index]) return;
            current.sections[index].labels[col] = label.innerText;
            markSectionDirty(current.sections[index]);
            clearTimeout(typingDebounceTimeout);
            typingDebounceTimeout = setTimeout(() => { triggerAutoSaveFeedback(); }, 600);
        });

        const textInput = document.createElement('div');
        textInput.className = 'text-area-input';
        textInput.contentEditable = 'true';
        textInput.setAttribute('placeholder', 'Write a note...');
        textInput.innerText = texts[col] || '';
        textInput.addEventListener('input', () => {
            const current = journalDatabase[currentEntryIndex];
            if (!current || !current.sections[index]) return;
            current.sections[index].texts[col] = textInput.innerText;
            markSectionDirty(current.sections[index]);
            clearTimeout(typingDebounceTimeout);
            typingDebounceTimeout = setTimeout(() => { triggerAutoSaveFeedback(); }, 600);
        });

        wrapper.appendChild(label);
        wrapper.appendChild(textInput);
        section.appendChild(wrapper);
    }

    section.appendChild(buildRemoveSectionButton(index));
    section.appendChild(buildDragHandle(index));

    return section;
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

        const photoIcon = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                <circle cx="8.5" cy="8.5" r="1.5"></circle>
                <polyline points="21 15 16 10 5 21"></polyline>
            </svg>
        `;

        // Mini rendering of the composition
        if (layout.id === 'arr-5') {
            preview.innerHTML = `
                <div class="preview-section arr-5">
                    <div class="preview-text" style="background: var(--mustard);"></div>
                    <div class="preview-text" style="background: var(--muted-purple);"></div>
                    <div class="preview-text" style="background: var(--coral-red);"></div>
                </div>`;
        } else if (layout.id === 'arr-6') {
            preview.innerHTML = `
                <div class="preview-section arr-6">
                    <div class="preview-text" style="background: var(--leaf-green);"></div>
                </div>`;
         } else if (layout.id === 'arr-7') {
            preview.innerHTML = `
                <div class="preview-section arr-7">
                    <div class="preview-photo">${photoIcon}</div>
                </div>`;
         } else if (layout.id === 'arr-2') {
            // NEW: Wide banner layout
            preview.innerHTML = `
                <div class="preview-section arr-2">
                    <div class="preview-photo">${photoIcon}</div>
                    <div class="preview-text" style="background: var(--leaf-green);"></div>
                </div>`;
         } else {
            preview.innerHTML = `
                <div class="preview-section ${layout.id}">
                    <div class="preview-photo">${photoIcon}</div>
                    <div class="preview-text"></div>
                </div>`;
         }
       
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

    lastDeletedSection = null;

    const newSection = {
        layout: layoutId,
        text: '',
        image: '',
        sortOrder: entry.sections.length   // <-- append at end
    };
    ensureSectionId(newSection, entry._id);
    markSectionDirty(newSection);

    entry.sections.push(newSection);
    markEntryDirty(entry);

    closeLayoutChooser();
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
    const journalDateEl = document.getElementById('journalDate');
    if (journalDateEl) {
       journalDateEl.innerText = formatJournalDate(entry.date || '');
    }
   
    document.getElementById('entryInlineDate').value = entry.date;

    const locationDisplay = document.getElementById('gardenLocationDisplay');
    if (locationDisplay) {
        locationDisplay.innerText = entry.location || 'Tallahassee, FL';
    }

    const weatherDisplay = document.getElementById('weatherStatsDisplay');
    if (weatherDisplay) {
        weatherDisplay.innerText = entry.weatherStats || 'Weather loading...';
    }

    const climateDisplay = document.getElementById('gardenClimateDisplay');
    if (climateDisplay) {
       climateDisplay.innerText = entry.climate || '';
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

    const pageText = `Page ${currentEntryIndex + 1} of ${journalDatabase.length}`;

    const pageIndicator = document.getElementById('pageIndicator');
    if (pageIndicator) pageIndicator.innerText = pageText;

    const pageIndicatorBottom = document.getElementById('pageIndicatorBottom');
    if (pageIndicatorBottom) pageIndicatorBottom.innerText = pageText;
   
    const btnPrev = document.getElementById('btnPrev');
    if (btnPrev) btnPrev.disabled = (currentEntryIndex === 0);

    const btnNext = document.getElementById('btnNext');
    if (btnNext) btnNext.disabled = (currentEntryIndex === journalDatabase.length - 1);

    const btnPrevBottom = document.getElementById('btnPrevBottom');
    if (btnPrevBottom) btnPrevBottom.disabled = (currentEntryIndex === 0);

    const btnNextBottom = document.getElementById('btnNextBottom');
    if (btnNextBottom) btnNextBottom.disabled = (currentEntryIndex === journalDatabase.length - 1);
   
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

    // Reassign sortOrder for every section in this entry and mark
    // each one dirty, so the new order is persisted.
    entry.sections.forEach((s, i) => {
        s.sortOrder = i;
        markSectionDirty(s);
    });
    markEntryDirty(entry);

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
    if (indicator) {
        indicator.classList.remove('save-failed');
        indicator.style.opacity = '0';   // hide until save actually succeeds
    }

    // Mark the current entry as dirty. Section-level dirties are set
    // by the mutation sites themselves.
    const current = journalDatabase[currentEntryIndex];
    if (current) {markEntryDirty(current);
    }

    _schedulePersistFlush();
}

function _schedulePersistFlush() {
    if (_persistTimer) clearTimeout(_persistTimer);
    _persistTimer = setTimeout(() => {
        _persistTimer = null;
        _flushPersist();
    }, PERSIST_DEBOUNCE_MS);
}

async function _flushPersist() {
    if (_persistInFlight) {
        _persistPendingAgain = true;
        return;
    }
    _persistInFlight = true;

    try {
        const dirtyEntries = [];
        const dirtySections = [];
        const dirtyPhotos = [];

        journalDatabase.forEach(entry => {
            if (entry._dirty) {
                // Strip the inline sections array before writing the entry.
                const { sections, ...entryWithoutSections } = entry;
                dirtyEntries.push(entryWithoutSections);
                // Queue the entry for cloud sync
                enqueueSync('entry', 'upsert', entry._id);
            }
            (entry.sections || []).forEach(sec => {
                if (!sec._entryId) sec._entryId = entry._id;
                if (sec._dirty) {
                    dirtySections.push({ ...sec });
                    // ONLY queue the section if it's actually dirty
                    enqueueSync('section', 'upsert', sec._id);
                }
            });
        });

        if (dirtyEntries.length || dirtySections.length || dirtyPhotos.length) {
            await persistBatch(dirtyEntries, dirtySections, dirtyPhotos);

            // Clear dirty flags on the real in-memory objects.
            dirtyEntries.forEach(de => {
                const entry = journalDatabase.find(e => e._id === de._id);
                if (entry) entry._dirty = false;
            });
            dirtySections.forEach(ds => {
                const entry = journalDatabase.find(e => e._id === ds._entryId);
                if (!entry) return;
                const sec = entry.sections.find(x => x._id === ds._id);
                if (sec) sec._dirty = false;
            });
        }

        _showSavedIndicator();
    } catch (err) {
        console.error('Persist failed:', err);
        _showSaveFailedIndicator();
    } finally {
        _persistInFlight = false;
        
        if (_persistPendingAgain) {
            _persistPendingAgain = false;
            _schedulePersistFlush();
        } else if (window.isAppReady) {
            // Only trigger the sync loop if we aren't queued for another flush
            processSyncQueue(); 
        }
    }
}
function _showSavedIndicator() {
    const el = document.getElementById('autoSaveIndicator');
    if (!el) return;
    el.textContent = 'Saved ✓';
    el.classList.remove('save-failed');
    el.style.opacity = '1';
    clearTimeout(autoSaveFeedbackTimeout);
    autoSaveFeedbackTimeout = setTimeout(() => {
        el.style.opacity = '0';
    }, 1200);
}

function _showSaveFailedIndicator() {
    const el = document.getElementById('autoSaveIndicator');
    if (!el) return;
    el.textContent = 'Save failed — retrying';
    el.classList.add('save-failed');
    el.style.opacity = '1';
    // Do not auto-hide; the next success replaces it.
}

// Flush on tab hide (best effort) and on page hide.
document.addEventListener('visibilitychange', () => {
    if (document.hidden) _flushPersist();
});
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
async function handleInlineDateChange(dateValue) {
    if (!dateValue) return;

    journalDatabase[currentEntryIndex].date = dateValue;

    // NEW: update the journal-date element under the title so
    // it reflects the new date immediately, without waiting for
    // the next renderEntry.
    const journalDateEl = document.getElementById('journalDate');
    if (journalDateEl) {
        journalDateEl.innerText = formatJournalDate(dateValue);
    }

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
        sections: [],
        sortOrder: journalDatabase.length   // <-- append at end
    };
    // CRITICAL: Make sure it has an ID and is marked dirty BEFORE we push it
    ensureEntryId(newBlankPage);
    markEntryDirty(newBlankPage);
   
    journalDatabase.push(newBlankPage);
    renderEntry(journalDatabase.length - 1);
    updateEntryWeather();
    triggerAutoSaveFeedback();
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
    } else if (action === 'export-png') {
        exportJournalAsPNG();
    } else if (action === 'delete') {
        const confirmed = confirm('Confirm Delete?');
        if (!confirmed) return;

        lastDeletedSection = null;

        if (journalDatabase.length > 1) {
            const [removed] = journalDatabase.splice(currentEntryIndex, 1);
            if (removed) {
                removed.deleted = true;
                removed.deletedAt = Date.now();
            }
            const targetIndex = Math.max(0, currentEntryIndex - 1);
            renderEntry(targetIndex);
            if (removed) persistDeletedEntry(removed);
            showNotification('Entry removed from journal indexes.');
        } else {
            // Last entry — delete it and return to the landing page.
            const [removed] = journalDatabase.splice(currentEntryIndex, 1);
            if (removed) {
                removed.deleted = true;
                removed.deletedAt = Date.now();
                persistDeletedEntry(removed);
            }
            currentEntryIndex = 0;

            showLandingPage();
            showNotification('Last entry removed. Journal is empty.');
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
            markSectionDirty(current.sections[index]);
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

/* ---------------------------------------------------------
   PNG EXPORT
   Clones #journalPage into an off-screen container, strips the
   app chrome, and asks html2canvas to render the clone to a
   canvas. The canvas becomes a PNG download.

   html2canvas captures the full element, not just the viewport,
   because the clone is laid out at its natural size inside the
   off-screen container.
   --------------------------------------------------------- */
async function exportJournalAsPNG() {
    if (typeof html2canvas !== 'function') {
        showNotification('PNG export unavailable. Check your connection.');
        return;
    }

    const source = document.getElementById('journalPage');
    const container = document.getElementById('pngExportContainer');
    if (!source || !container) return;

    // Close the menu so we're not photographing an open dropdown.
    const dropdown = document.getElementById('appDropdown');
    if (dropdown) dropdown.classList.remove('show');

    // Deep-clone the journal page so we don't disturb the live DOM.
    const clone = source.cloneNode(true);

    // Strip chrome. Keep this list in sync with the @media print block
    // and the CSS for #pngExportContainer.
    const hideSelectors = [
        '.app-bar',
        '.bottom-nav',
        '.bottom-nav--footer',
        '.entry-meta-stamp',
        '.botanical-bg-decor',
        '.add-layout-control',
        '.remove-section-btn',
        '.drag-handle',
        '.undo-banner',
        '.photo-source-menu',
        '.layout-chooser-overlay',
        '.photo-framing-overlay',
        '.app-notification-box'
    ];
    hideSelectors.forEach(sel => {
        clone.querySelectorAll(sel).forEach(el => el.remove());
    });

    // Ensure the print header is present in the clone.
    let printHeader = clone.querySelector('.print-header');
    if (!printHeader) {
        printHeader = document.createElement('div');
        printHeader.className = 'print-header';
        printHeader.innerHTML = '<h1>My Garden Journal</h1>';
        clone.insertBefore(printHeader, clone.firstChild);
    }

    // Put the clone in the off-screen container.
    container.innerHTML = '';
    container.appendChild(clone);

    // Wait for fonts and one layout frame so the clone is fully
    // rendered before html2canvas photographs it.
    if (document.fonts && document.fonts.ready) {
        try { await document.fonts.ready; } catch (_) {}
    }
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    try {
        const canvas = await html2canvas(clone, {
            backgroundColor: '#FFFFFF',
            scale: 2,
            useCORS: true,
            logging: false,
            windowWidth: clone.scrollWidth,
            windowHeight: clone.scrollHeight
        });

        const dataUrl = canvas.toDataURL('image/png');

        const entryTitle = (journalDatabase[currentEntryIndex]?.displayTitle || 'journal')
            .replace(/[^a-z0-9\-_]+/gi, '-')
            .toLowerCase()
            .slice(0, 40);
        const dateStr = new Date().toISOString().split('T')[0];

        const link = document.createElement('a');
        link.download = `garden-journal-${dateStr}-${entryTitle}.png`;
        link.href = dataUrl;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        showNotification('PNG exported.');
    } catch (err) {
        console.error('PNG export failed:', err);
        showNotification('PNG export failed. See console for details.');
    } finally {
        container.innerHTML = '';
    }
}

function toggleEditMode() {
    isEditMode = !isEditMode;

    document.querySelectorAll('.text-area-input, .weather-stats-input, .weather-feel-input, .section-note-label')
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
    // NEW: Keep the bottom button in sync
    const buttonBottom = document.getElementById('editModeButtonBottom');
    if (buttonBottom) {
        buttonBottom.textContent = isEditMode ? 'Done' : 'Edit';
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

    // NEW: safety — abort any in-progress drag when leaving Edit mode.
    if (!isEditMode && sectionDrag) {
        if (sectionDrag.placeholder && sectionDrag.placeholder.parentElement) {
            sectionDrag.placeholder.parentElement.removeChild(sectionDrag.placeholder);
        }
        if (sectionDrag.sectionEl) {
            sectionDrag.sectionEl.classList.remove('is-dragging');
        }
        document.body.classList.remove('is-dragging-section');
        window.removeEventListener('pointermove', onSectionDragMove);
        window.removeEventListener('pointerup', onSectionDragEnd);
        window.removeEventListener('pointercancel', onSectionDragEnd);
        sectionDrag = null;
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
   
     // NEW: Keep the bottom button in sync
    const buttonBottom = document.getElementById('editModeButtonBottom');
    if (buttonBottom) {
        buttonBottom.textContent = 'Edit';
    }

    // NEW: hide Edit-mode-only controls (e.g. the + button) by
    // removing the is-editing class from the journal page.
    const journalPage = document.getElementById('journalPage');
    if (journalPage) {
        journalPage.classList.remove('is-editing');
    }
}

async function changeGardenLocation() {
    const entry = journalDatabase[currentEntryIndex];
    if (!entry) return;

    const currentLocation = entry.location || '';
    const newLocationRaw = prompt(
        "Enter your garden location:",
        currentLocation
    );
    if (newLocationRaw === null) return;

    const newLocation = newLocationRaw.trim() || currentLocation;
    if (!newLocation) return;

    const newClimateRaw = prompt(
        "Growing climate/zone (optional). Examples: 8b, Zone 8b, USDA Zone 8b, Mediterranean climate.",
        entry.climate || ''
    );
    if (newClimateRaw === null) return;
    const newClimate = newClimateRaw.trim();

    if (newLocation !== currentLocation) {
        entry.location = newLocation;

        const locationDisplay = document.getElementById('gardenLocationDisplay');
        if (locationDisplay) locationDisplay.innerText = newLocation;

        const weatherDisplay = document.getElementById('weatherStatsDisplay');
        if (weatherDisplay) weatherDisplay.innerText = "Weather loading...";

        try {
            await updateEntryWeather();
        } catch (error) {
            console.error("Location weather update failed:", error);
        }
    }

    entry.climate = newClimate;

    const climateDisplay = document.getElementById('gardenClimateDisplay');
    if (climateDisplay) climateDisplay.innerText = newClimate;

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
    try {
        // We create a clean copy of the journal, stripping out all sync internals
        // and circular references that might crash JSON.stringify.
        const cleanBackup = journalDatabase.map(entry => {
            return {
                _id: entry._id,
                date: entry.date,
                displayTitle: entry.displayTitle || '',
                location: entry.location || '',
                climate: entry.climate || '',
                weatherStats: entry.weatherStats || '',
                weatherFeel: entry.weatherFeel || '',
                sortOrder: entry.sortOrder || 0,
                sections: (entry.sections || []).map(sec => {
                    return {
                        _id: sec._id,
                        _entryId: entry._id,
                        layout: sec.layout,
                        sortOrder: sec.sortOrder || 0,
                        label: sec.label || '',
                        text: sec.text || '',
                        texts: sec.texts || null,
                        labels: sec.labels || null,
                        image: sec.image || ''
                    };
                })
            };
        });

        const backupData = JSON.stringify(cleanBackup, null, 2);
        const blob = new Blob([backupData], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const link = document.createElement('a');
        link.href = url;
        link.download = `garden-journal-backup-${new Date().toISOString().split('T')[0]}.json`;
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        URL.revokeObjectURL(url);
        showNotification('Garden Journal backup downloaded successfully.');
        
    } catch (err) {
        console.error('Backup failed:', err);
        showNotification('Backup failed. Check console.');
    }
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

        reader.onload = async function(e) {
            try {
                const restoredData = JSON.parse(e.target.result);

                if (!Array.isArray(restoredData)) {
                    throw new Error('Invalid backup format.');
                }

                // Prepare a processed copy first — do not touch the
                // live journalDatabase until we know it's valid.
                const prepared = restoredData.map(entry => {
                    ensureEntryId(entry);
                    if (typeof entry._seed !== 'boolean') entry._seed = false;
                    entry._dirty = true;
                    (entry.sections || []).forEach(sec => {
                        ensureSectionId(sec);
                        sec._dirty = true;
                    });
                    return entry;
                });

                // Commit to memory.
                journalDatabase = prepared;
                currentEntryIndex = 0;

                // Persist as the source of truth. This replaces the
                // entries/sections stores and sets the initialized flag.
                await replaceAll(
                    journalDatabase,
                    flattenSections(journalDatabase),
                    []
                );
                await setMeta('initialized', true);

                renderEntry(0);
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

    const clampedIndex = Math.max(0, Math.min(index, entry.sections.length));
    section.deleted = false;
    section.deletedAt = null;
    section._entryId = entry._id;
    entry.sections.splice(clampedIndex, 0, section);

    // Reassign sortOrder.
    entry.sections.forEach((s, i) => {
        s.sortOrder = i;
        markSectionDirty(s);
    });
    markEntryDirty(entry);

    lastDeletedSection = null;

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

    // Tombstone the removed section so the delete survives reload.
    if (removed) {
        removed.deleted = true;
        removed.deletedAt = Date.now();
        persistDeletedSection(removed);
    }

    // Reassign sortOrder to the remaining sections.
    entry.sections.forEach((s, i) => {
        s.sortOrder = i;
        markSectionDirty(s);
    });
    markEntryDirty(entry);

    lastDeletedSection = { section: removed, index, entryIndex: currentEntryIndex };

    renderEntry(currentEntryIndex);
    triggerAutoSaveFeedback();
    showUndoBanner();
}
/* ---------------------------------------------------------
   new function for syncing
   --------------------------------------------------------- */

function _newId() {
    return (crypto.randomUUID && crypto.randomUUID())
        || ('id-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10));
}

function ensureEntryId(entry) {
    if (!entry._id) entry._id = _newId();
    if (typeof entry._seed !== 'boolean') entry._seed = false;
    return entry;
}

function ensureSectionId(section, entryId) {
    if (!section._id) section._id = _newId();
    if (typeof section._dirty !== 'boolean') section._dirty = false;
    if (entryId && !section._entryId) section._entryId = entryId;
    return section;
}

function markEntryDirty(entry) {
    if (!entry) return;
    ensureEntryId(entry);
    entry._dirty = true;
    if (entry._seed) entry._seed = false;   // user touched it — no longer seed
}

function markSectionDirty(section) {
    if (!section) return;
    ensureSectionId(section);
    section._dirty = true;
}

/* ---------------------------------------------------------
   new async function for syncing
   --------------------------------------------------------- */

async function persistImmediately() {
    if (_persistTimer) {
        clearTimeout(_persistTimer);
        _persistTimer = null;
    }
    await _flushPersist();
}
/* ---------------------------------------------------------
   new hydratefrom stored function for syncing
   --------------------------------------------------------- */
function hydrateFromStored(stored) {
    const byEntry = new Map();
    stored.entries.forEach(e => byEntry.set(e._id, { ...e, sections: [] }));

    // Group sections by entry, then backfill and sort.
    const sectionsByEntry = new Map();
    stored.sections.forEach(s => {
        if (!sectionsByEntry.has(s._entryId)) sectionsByEntry.set(s._entryId, []);
        sectionsByEntry.get(s._entryId).push(s);
    });
    sectionsByEntry.forEach(arr => {
        arr.forEach((s, i) => {
            if (typeof s.sortOrder !== 'number') {
                s.sortOrder = i;
                s._dirty = true;
            }
        });
        arr.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    });

    byEntry.forEach((entry, id) => {
        entry.sections = sectionsByEntry.get(id) || [];
    });

    // Sort entries by date descending (newest first).
    const entries = stored.entries.map(e => byEntry.get(e._id));
    entries.sort((a, b) => {
        const da = a.date || '';
        const db = b.date || '';
        if (da === db) return 0;
        return da < db ? -1 : 1;   // newest first - changed to oldest first
    });
    return entries;
}

/* Write a single tombstone record for an entry that was removed from
   memory. Because the entry is no longer in journalDatabase,
   persistImmediately() would not pick it up — it has to be written
   directly. */
async function persistDeletedEntry(entry) {
    if (!entry || !entry._id) return;
    try {
        const tx = _db.transaction(['entries'], 'readwrite');
        tx.objectStore('entries').put(entry);
        await new Promise((resolve, reject) => {
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
        // NEW: Queue the delete
        enqueueSync('entry', 'delete', entry._id);
        _showSavedIndicator();
    } catch (err) {
        console.error('Failed to persist entry tombstone:', err);
        _showSaveFailedIndicator();
    }
}
async function persistDeletedSection(section) {
    if (!section || !section._id) return;
    try {
        const tx = _db.transaction(['sections'], 'readwrite');
        tx.objectStore('sections').put(section);
        await new Promise((resolve, reject) => {
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
       
        // NEW: Queue the delete
        enqueueSync('section', 'delete', section._id);
        _showSavedIndicator();
    } catch (err) {
        console.error('Failed to persist section tombstone:', err);
        _showSaveFailedIndicator();
    }
}

/* Convert the nested in-memory model to a flat list of section records,
   each tagged with the _entryId of its parent entry. Used for restore
   and for the initial persist. */
function flattenSections(db) {
    const out = [];
    db.forEach(entry => {
        (entry.sections || []).forEach(sec => {
            out.push({ ...sec, _entryId: entry._id });
        });
    });
    return out;
}
/* ---------------------------------------------------------
   CLOUD SYNC (Stage 4: Read Only)
   --------------------------------------------------------- */

async function fetchFromCloud() {
    if (!supabaseClient || !currentSession) {
        showNotification('Please sign in to sync.');
        return;
    }

    showNotification('Checking cloud...');

    try {
        // 1. Fetch entries
        const { data: cloudEntries, error: entriesError } = await supabaseClient
            .from('entries')
            .select('*')
            .is('deleted_at', null); // Ignore tombstoned entries

        if (entriesError) throw entriesError;

        // 2. Fetch sections
        const { data: cloudSections, error: sectionsError } = await supabaseClient
            .from('sections')
            .select('*')
            .is('deleted_at', null); // Ignore tombstoned sections

        if (sectionsError) throw sectionsError;

        // 3. If cloud is empty, do nothing (keep local data)
        if (!cloudEntries || cloudEntries.length === 0) {
            showNotification('Cloud is empty. Local journal is safe.');
            return;
        }

        // 4. Cloud has data! Transform it to match our local format.
        console.log('Cloud data found. Migrating to local format...', cloudEntries.length, 'entries.');

        // Rebuild the nested structure
        const hydrated = hydrateFromCloud(cloudEntries, cloudSections);
        // NEW: Sort entries by date immediately so the first render is correct
        hydrated.sort((a, b) => {
            const da = a.date || '';
            const db = b.date || '';
            if (da === db) return 0;
            return da < db ? 1 : -1; // Newest first
        });

        // 5. Overwrite local memory and local IndexedDB
        journalDatabase = hydrated;
        
        // We need to write this to IndexedDB so it persists locally.
        // We'll use the existing replaceAll function from our storage layer.
        // Note: we are not uploading photos yet (Stage 5).
        const flatSections = [];
        hydrated.forEach(entry => {
            (entry.sections || []).forEach(sec => {
                flatSections.push({ ...sec, _entryId: entry._id });
            });
        });

        // Write to local database
        await replaceAll(hydrated, flatSections, []);
        
        // Re-render
        currentEntryIndex = 0;
        renderEntry(currentEntryIndex);
        updateAuthUI(); // refresh UI just in case
        
        showNotification(`Synced ${hydrated.length} entries from cloud.`);

    } catch (err) {
        console.error('Cloud fetch failed:', err);
        showNotification('Sync failed. Check console.');
    }
}

function hydrateFromCloud(cloudEntries, cloudSections) {
    // Group sections by their parent entry's local_id
    const sectionsByEntry = new Map();
    cloudSections.forEach(s => {
        if (!sectionsByEntry.has(s.entry_local_id)) sectionsByEntry.set(s.entry_local_id, []);
        sectionsByEntry.get(s.entry_local_id).push(s);
    });

    // Map over entries
    return cloudEntries.map(ce => {
        const entrySections = sectionsByEntry.get(ce.local_id) || [];
        
        // Sort sections
        entrySections.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

        // Map sections to local format
        const mappedSections = entrySections.map(cs => ({
            _id: cs.local_id,
            _entryId: cs.entry_local_id,
            _dirty: false, // It's fresh from the cloud
            layout: cs.layout,
            sortOrder: cs.sort_order,
            label: cs.label || '',
            text: cs.text || '',
            texts: cs.texts || ['', '', ''],
            labels: cs.labels || ['', '', ''],
            image: cs.photo_url || '',
        }));

        return {
            _id: ce.local_id,
            _seed: false, // Cloud data is never seed data
            _dirty: false,
            date: ce.date,
            displayTitle: ce.display_title || '',
            location: ce.location || '',
            climate: ce.climate || '',
            weatherStats: ce.weather_stats || '',
            weatherFeel: ce.weather_feel || '',
            sortOrder: ce.sort_order,
            sections: mappedSections
        };
    });
}
window.addEventListener('online', () => {
    console.log('Back online. Processing queue...');
    processSyncQueue();
});
