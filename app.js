
        // State variables
        let coasterLog = [];
        let coasterpediaSearchResults = [];
        let coasterpediaParkIndex = [];
        let coasterpediaParkIndexPromise = null;
        let currentParkRides = [];
        let rideNameVersionOptions = new Map();
        let currentParkTitle = '';
        let currentParkPageId = '';
        let searchDebounceTimer;
        let searchRequestId = 0;
        let parkSearchCandidates = [];
        let parkSearchCursor = 0;
        let parkSearchLoading = false;
        let parkSearchLoadingRequestId = 0;
        let parkValidationAbortController = null;
        let activeDashboardFilter = null;
        let currentUser = null;
        let relogSourceEntryId = '';
        let relogInitialCoasterName = '';
        let relogInitialVariant = 'Original';
        let relogVersionManuallySelected = false;
        let authMode = 'signin';
        let authLoadRequestId = 0;
        let authStateSubscription = null;
        let cloudDataSubscription = null;

        // Credit Calculation Rules Defaults
        const DEFAULT_CREDIT_RULES = {
            powered: true,
            alpine: true,
            water: true,
            elementChange: true,
            relocated: true,
            countRelogs: false
        };
        let creditRules = { ...DEFAULT_CREDIT_RULES };

        // Initialize Application on Load
        window.onload = async function() {
            try {
                await window.trackRecordCloud.ready;
                const user = window.trackRecordCloud.getCurrentUser();
                currentUser = user;
                updateAccountAction();
                await handleFirebaseAuthState(user);
                authStateSubscription = window.trackRecordCloud.onAuthStateChanged(user => {
                    if (user?.uid === currentUser?.uid || (!user && !currentUser)) return;
                    handleFirebaseAuthState(user).catch(error => {
                        console.error('Failed to load account data:', error);
                        showAuthMessage(`Could not load your account data: ${error.message}`, 'error');
                    });
                });
            } catch (error) {
                console.error('Firebase initialization failed:', error);
                document.getElementById('startup-screen').classList.add('hidden');
                document.getElementById('app-content').classList.remove('hidden');
                openAuthDialog();
                showAuthMessage(`Could not connect to Firebase: ${error.message}`, 'error');
            }
            document.addEventListener('click', event => {
                const results = document.getElementById('park-search-results');
                const input = document.getElementById('park-search-input');
                if (!results.contains(event.target) && event.target !== input) {
                    hideParkSearchResults();
                }
            });
        };

        // Navigation Switcher
        function switchTab(tab) {
            const tabLog = document.getElementById('tab-log');
            const tabSearch = document.getElementById('tab-search');
            const btnLog = document.getElementById('tab-btn-log');
            const btnSearch = document.getElementById('tab-btn-search');

            if (tab === 'log') {
                tabLog.classList.remove('hidden');
                tabSearch.classList.add('hidden');
                btnLog.className = "flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-all duration-150 bg-brand-600 text-white shadow-sm";
                btnSearch.className = "flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-all duration-150 text-slate-400 hover:text-white hover:bg-slate-800";
            } else {
                tabLog.classList.add('hidden');
                tabSearch.classList.remove('hidden');
                btnSearch.className = "flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-all duration-150 bg-brand-600 text-white shadow-sm";
                btnLog.className = "flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-all duration-150 text-slate-400 hover:text-white hover:bg-slate-800";
                if (currentParkRides.length) renderRidesList();
                if (!document.getElementById('park-search-input').value.trim()) {
                    searchCoasterpedia();
                }
            }
        }

        function goToCredits() {
            activeDashboardFilter = null;
            document.getElementById('park-breakdown').classList.add('hidden');
            syncDashboardCardStyles();
            renderLogbook();
            switchTab('log');
        }

        async function handleFirebaseAuthState(user) {
            const requestId = ++authLoadRequestId;
            const authScreen = document.getElementById('auth-screen');
            const appContent = document.getElementById('app-content');
            const emailLabel = document.getElementById('account-email');

            if (!user) {
                document.getElementById('startup-screen').classList.add('hidden');
                cloudDataSubscription?.();
                cloudDataSubscription = null;
                currentUser = null;
                coasterLog = [];
                creditRules = { ...DEFAULT_CREDIT_RULES };
                activeDashboardFilter = null;
                document.getElementById('modal-entry').classList.add('hidden');
                document.getElementById('modal-settings').classList.add('hidden');
                document.getElementById('park-breakdown').classList.add('hidden');
                emailLabel.innerText = '';
                appContent.classList.remove('hidden');
                authScreen.classList.add('hidden');
                authScreen.classList.remove('flex');
                document.getElementById('auth-submit').disabled = false;
                document.getElementById('auth-retry').classList.add('hidden');
                document.getElementById('auth-signout').classList.add('hidden');
                document.getElementById('continue-as-guest').classList.remove('hidden');
                showAuthMessage('', 'status');
                updateAccountAction();
                updateStatsAndCounters();
                renderLogbook();
                return;
            }

            currentUser = user;
            updateAccountAction();
            cloudDataSubscription?.();
            cloudDataSubscription = null;
            document.getElementById('startup-screen').classList.remove('hidden');
            authScreen.classList.add('hidden');
            document.getElementById('auth-submit').disabled = false;
            document.getElementById('continue-as-guest').classList.remove('hidden');
            showAuthMessage('', 'status');

            try {
                const remoteData = await window.trackRecordCloud.loadData(user);
                if (requestId !== authLoadRequestId) return;

                if (remoteData.exists) {
                    coasterLog = remoteData.entries;
                    if (remoteData.creditRules) creditRules = migrateCreditRules(remoteData.creditRules);
                    cacheUserData(user);
                } else if (localStorage.getItem('track_record_legacy_imported') !== 'true') {
                    loadLegacyLocalStorage();
                    await window.trackRecordCloud.saveData(user, coasterLog, creditRules);
                    if (requestId !== authLoadRequestId) return;
                    localStorage.setItem('track_record_legacy_imported', 'true');
                    cacheUserData(user);
                } else {
                    coasterLog = [];
                    creditRules = migrateCreditRules({});
                    await window.trackRecordCloud.saveData(user, coasterLog, creditRules);
                    if (requestId !== authLoadRequestId) return;
                    cacheUserData(user);
                }

                currentUser = user;
                emailLabel.innerText = user.email || '';
                syncCreditRuleInputs();
                updateStatsAndCounters();
                renderLogbook();
                document.getElementById('auth-retry').classList.add('hidden');
                document.getElementById('auth-signout').classList.add('hidden');
                authScreen.classList.add('hidden');
                appContent.classList.remove('hidden');
                document.getElementById('startup-screen').classList.add('hidden');
                updateAccountAction();
                cloudDataSubscription = window.trackRecordCloud.subscribeData(user, data => {
                    if (currentUser?.uid !== user.uid) return;
                    const nextRules = data.creditRules ? migrateCreditRules(data.creditRules) : creditRules;
                    if (JSON.stringify(coasterLog) === JSON.stringify(data.entries) &&
                        JSON.stringify(creditRules) === JSON.stringify(nextRules)) return;
                    coasterLog = data.entries;
                    creditRules = nextRules;
                    cacheUserData(user);
                    syncCreditRuleInputs();
                    updateStatsAndCounters();
                    renderLogbook();
                    if (!document.getElementById('park-breakdown').classList.contains('hidden')) renderParkBreakdown();
                    refreshVisibleSearchResults();
                }, error => {
                    console.error('Firebase live sync failed:', error);
                    showToast(`Live sync stopped: ${error.message}`, 'error');
                });
                refreshLoggedRideStatuses();
            } catch (error) {
                if (requestId !== authLoadRequestId) return;
                currentUser = user;
                appContent.classList.remove('hidden');
                document.getElementById('startup-screen').classList.add('hidden');
                updateAccountAction();
                console.error('Could not load account data:', error);
                showToast(`Could not load your cloud data: ${error.message}. You are still signed in; try reloading.`, 'error');
            }
        }

        function updateAccountAction() {
            const signedIn = Boolean(window.trackRecordCloud?.getCurrentUser() || currentUser);
            document.getElementById('account-action-label').innerText = signedIn ? 'Sign Out' : 'Sign In';
            document.getElementById('account-action-icon').className = signedIn
                ? 'fa-solid fa-arrow-right-from-bracket'
                : 'fa-solid fa-arrow-right-to-bracket';
            document.getElementById('account-action').title = signedIn ? 'Sign Out' : 'Sign In';
        }

        function openAuthDialog(message = '') {
            const authScreen = document.getElementById('auth-screen');
            authScreen.classList.remove('hidden');
            document.getElementById('auth-submit').disabled = false;
            document.getElementById('continue-as-guest').classList.toggle('hidden', Boolean(currentUser));
            showAuthMessage(message, 'status');
        }

        function closeAuthDialog() {
            document.getElementById('auth-screen').classList.add('hidden');
            showAuthMessage('', 'status');
        }

        function requireSignedIn() {
            if (currentUser) return true;
            openAuthDialog('Sign in or create an account to log and manage coaster credits.');
            return false;
        }

        async function handleAccountAction() {
            if (currentUser) {
                await signOutAccount();
                return;
            }
            const existingUser = window.trackRecordCloud?.getCurrentUser();
            if (existingUser) {
                await handleFirebaseAuthState(existingUser);
                return;
            }
            openAuthDialog();
        }

        function syncCreditRuleInputs() {
            document.getElementById('rule-powered').checked = creditRules.powered;
            document.getElementById('rule-alpine').checked = creditRules.alpine;
            document.getElementById('rule-water').checked = creditRules.water;
            document.getElementById('rule-element-change').checked = creditRules.elementChange;
            document.getElementById('rule-relocated').checked = creditRules.relocated;
            document.getElementById('rule-count-relogs').checked = creditRules.countRelogs;
        }

        function showAuthMessage(message, type = 'status') {
            const error = document.getElementById('auth-error');
            const status = document.getElementById('auth-status');
            error.classList.toggle('hidden', type !== 'error' || !message);
            status.classList.toggle('hidden', type !== 'status' || !message);
            error.innerText = type === 'error' ? message : '';
            status.innerText = type === 'status' ? message : '';
        }

        async function retryAccountLoad() {
            try {
                await handleFirebaseAuthState(window.trackRecordCloud.getCurrentUser());
            } catch (error) {
                console.error('Failed to retry loading account:', error);
                showAuthMessage(`Could not load your cloud data: ${error.message}`, 'error');
            }
        }

        function toggleAuthMode() {
            authMode = authMode === 'signin' ? 'signup' : 'signin';
            const signUp = authMode === 'signup';
            document.getElementById('auth-submit').innerText = signUp ? 'Create Account' : 'Sign In';
            document.getElementById('auth-mode-toggle').innerText = signUp ? 'I already have an account' : 'Create an Account';
            document.getElementById('auth-password').autocomplete = signUp ? 'new-password' : 'current-password';
            document.getElementById('auth-reset').classList.toggle('hidden', signUp);
            showAuthMessage('', 'status');
            document.getElementById('auth-retry').classList.add('hidden');
        }

        async function submitAuthForm(event) {
            event.preventDefault();
            const email = document.getElementById('auth-email').value.trim();
            const password = document.getElementById('auth-password').value;
            const submit = document.getElementById('auth-submit');
            submit.disabled = true;
            showAuthMessage('', 'status');
            try {
                if (authMode === 'signup') await window.trackRecordCloud.createAccount(email, password);
                else await window.trackRecordCloud.signIn(email, password);
            } catch (error) {
                showAuthMessage(error.message, 'error');
                submit.disabled = false;
            }
        }

        async function resetAccountPassword() {
            const email = document.getElementById('auth-email').value.trim();
            if (!email) {
                showAuthMessage('Enter your email address first, then choose Forgot password.', 'error');
                return;
            }
            try {
                await window.trackRecordCloud.resetPassword(email);
                showAuthMessage('Password reset email sent. Check your inbox.', 'status');
            } catch (error) {
                showAuthMessage(error.message, 'error');
            }
        }

        async function signOutAccount() {
            try {
                await window.trackRecordCloud.signOut();
            } catch (error) {
                showToast(`Could not sign out: ${error.message}`, 'error');
            }
        }

        function cacheUserData(user) {
            localStorage.setItem(`coaster_log_entries_${user.uid}`, JSON.stringify(coasterLog));
            localStorage.setItem(`coaster_credit_rules_${user.uid}`, JSON.stringify(creditRules));
        }

        // Local cache and legacy migration
        function saveToLocalStorage() {
            if (!currentUser) return;
            cacheUserData(currentUser);
            const user = currentUser;
            window.trackRecordCloud.saveData(user, coasterLog, creditRules)
                .catch(error => {
                    console.error('Failed to save coaster log to Firebase:', error);
                    showToast(`Cloud sync failed: ${error.message}. Your changes remain on this device.`, 'error');
                });
        }

        function loadLegacyLocalStorage() {
            const savedLog = localStorage.getItem('coaster_log_entries');
            if (savedLog) {
                try {
                    const parsedLog = JSON.parse(savedLog);
                    if (!Array.isArray(parsedLog)) throw new Error('Saved coaster log is not a list.');
                    coasterLog = parsedLog;
                } catch (error) {
                    console.error('Could not read existing browser coaster log:', error);
                    throw new Error('Could not import the existing browser log. Export or repair that data before continuing.');
                }
            }
            const savedRules = localStorage.getItem('coaster_credit_rules');
            if (savedRules) {
                try {
                    creditRules = migrateCreditRules(JSON.parse(savedRules));
                } catch (error) {
                    console.error('Could not read existing browser credit rules:', error);
                    throw new Error('Could not import the existing browser credit settings.');
                }
            }
        }

        function migrateCreditRules(saved = {}) {
            const oldOverhaul = typeof saved.overhaul === 'boolean' ? saved.overhaul : creditRules.elementChange;
            const oldDrive = typeof saved.drive === 'boolean' ? saved.drive : creditRules.elementChange;
            const legacyExperienceChange = Boolean(saved.experienceChange || saved.vr || saved.indoor);
            return {
                powered: typeof saved.powered === 'boolean' ? saved.powered : creditRules.powered,
                alpine: typeof saved.alpine === 'boolean' ? saved.alpine : creditRules.alpine,
                water: typeof saved.water === 'boolean' ? saved.water : creditRules.water,
                elementChange: typeof saved.elementChange === 'boolean'
                    ? saved.elementChange || legacyExperienceChange
                    : oldOverhaul || oldDrive || legacyExperienceChange,
                relocated: typeof saved.relocated === 'boolean' ? saved.relocated : creditRules.relocated,
                countRelogs: typeof saved.countRelogs === 'boolean' ? saved.countRelogs : false
            };
        }

        function normalizeRideVariant(variant = 'Original') {
            if (!variant) return 'Original';
            if (['VR', 'Indoor', 'ExperienceChange', 'Overhaul', 'DriveChange'].includes(variant)) return 'ElementChange';
            if (variant === 'Defunct' || variant === 'ReviewChange') return 'Original';
            return variant;
        }

        function rideEntryVariant(entry) {
            return normalizeRideVariant(entry.variant);
        }

        function rideVariantLabel(variant) {
            const labels = {
                ElementChange: 'Reimagined',
                Defunct: 'Defunct / Retracked'
            };
            const normalizedVariant = normalizeRideVariant(variant);
            return labels[normalizedVariant] || normalizedVariant;
        }

        function rideIdentityKey(entry) {
            const coasterName = entry.coasterName || entry.coasterNameRidden || '';
            return JSON.stringify([
                (entry.parkName || entry.parkNameRidden || '').trim().toLocaleLowerCase(),
                coasterName.trim().toLocaleLowerCase(),
                entry.type || 'Real',
                rideEntryVariant(entry),
                entry.coasterpediaRideId || ''
            ]);
        }

        function getCoasterLogGroups(entries = coasterLog) {
            const groupsByKey = new Map();
            entries.forEach(entry => {
                const key = rideIdentityKey(entry);
                if (!groupsByKey.has(key)) {
                    groupsByKey.set(key, { key, entry, entries: [], rideCount: 0 });
                }
                const group = groupsByKey.get(key);
                group.entries.push(entry);
                group.rideCount += Math.max(1, Number.parseInt(entry.rideCount, 10) || 1);
            });
            return [...groupsByKey.values()];
        }

        function duplicateRideGroupKeys(groups) {
            return new Set(groups
                .filter(group => group.entries.some(entry => entry.isDuplicate === true))
                .map(group => group.key));
        }

        // Stats & Calculation Rules Logic
        function updateStatsAndCounters() {
            let realCount = 0;
            let poweredCount = 0;
            let alpineCount = 0;
            let waterCount = 0;
            let calculatedTotal = 0;
            let relogCount = 0;
            
            // Unique Parks Set
            const uniqueParks = new Set();
            const groups = getCoasterLogGroups();
            const duplicateKeys = duplicateRideGroupKeys(groups);

            groups.forEach(group => {
                const entry = group.entry;
                const type = entry.type || 'Real';
                const variant = rideEntryVariant(entry);
                if (group.rideCount > 1) relogCount++;

                // Count unique park names (prefer official, fallback to ridden name)
                const parkKey = (entry.parkName || entry.parkNameRidden || '').trim().toLowerCase();
                if (parkKey) uniqueParks.add(parkKey);

                // Type counts
                if (type === 'Real') realCount++;
                else if (type === 'Powered') poweredCount++;
                else if (type === 'Alpine') alpineCount++;
                else if (type === 'Water') waterCount++;

                // Credit Calculation Evaluation
                let isCredit = false;

                if (type === 'Real') {
                    isCredit = true;
                } else if (type === 'Powered' && creditRules.powered) {
                    isCredit = true;
                } else if (type === 'Alpine' && creditRules.alpine) {
                    isCredit = true;
                } else if (type === 'Water' && creditRules.water) {
                    isCredit = true;
                }

                // Variant exceptions
                if (variant === 'ElementChange' && !creditRules.elementChange) isCredit = false;
                if (variant === 'Relocated' && !creditRules.relocated) isCredit = false;
                if (isCredit) {
                    calculatedTotal += creditRules.countRelogs ? group.rideCount : 1;
                }
            });

            // Update DOM Counter Cards
            document.getElementById('stat-real').innerText = realCount;
            document.getElementById('stat-powered').innerText = poweredCount;
            document.getElementById('stat-alpine').innerText = alpineCount;
            document.getElementById('stat-water').innerText = waterCount;
            document.getElementById('stat-duplicates').innerText = duplicateKeys.size;
            document.getElementById('stat-relogs').innerText = relogCount;
            document.getElementById('stat-parks').innerText = uniqueParks.size;
            document.getElementById('stat-total').innerText = calculatedTotal;
            document.getElementById('log-count-badge').innerText = `${groups.length} Rides Logged`;
            syncDashboardCardStyles();
        }

        function isEntryCredit(entry) {
            const type = entry.type || 'Real';
            const variant = rideEntryVariant(entry);
            let isCredit = type === 'Real' ||
                (type === 'Powered' && creditRules.powered) ||
                (type === 'Alpine' && creditRules.alpine) ||
                (type === 'Water' && creditRules.water);

            if (variant === 'ElementChange' && !creditRules.elementChange) isCredit = false;
            if (variant === 'Relocated' && !creditRules.relocated) isCredit = false;
            return isCredit;
        }

        function applyDashboardFilter(kind, value = null) {
            const scrollX = window.scrollX;
            const scrollY = window.scrollY;
            const logList = document.getElementById('log-list');
            document.getElementById('park-breakdown').classList.add('hidden');
            const isSameFilter = activeDashboardFilter?.kind === kind &&
                (kind !== 'type' || activeDashboardFilter.value === value) &&
                (kind !== 'ride' || (
                    activeDashboardFilter.value.park.toLowerCase() === value.park.toLowerCase() &&
                    activeDashboardFilter.value.coaster.toLowerCase() === value.coaster.toLowerCase() &&
                    (activeDashboardFilter.value.rideId || '') === (value.rideId || '')
                ));
            if (isSameFilter) {
                activeDashboardFilter = null;
                logList.style.minHeight = '';
            } else {
                if (!activeDashboardFilter) {
                    logList.style.minHeight = `${logList.getBoundingClientRect().height}px`;
                }
                activeDashboardFilter = { kind, value };
            }
            syncDashboardCardStyles();
            renderLogbook();
            requestAnimationFrame(() => window.scrollTo({ left: scrollX, top: scrollY, behavior: 'instant' }));
        }

        function syncDashboardCardStyles() {
            const parkBreakdownOpen = !document.getElementById('park-breakdown').classList.contains('hidden');
            document.querySelectorAll('.dashboard-stat-card').forEach(card => {
                const filterKind = card.dataset.filterKind;
                const isActive = (activeDashboardFilter?.kind === filterKind &&
                        (filterKind !== 'type' || activeDashboardFilter.value === card.dataset.filterValue)) ||
                    (filterKind === 'parks' && parkBreakdownOpen);
                card.classList.toggle('is-active', isActive);
            });
        }

        function toggleParkBreakdown() {
            const panel = document.getElementById('park-breakdown');
            if (panel.classList.contains('hidden')) {
                activeDashboardFilter = null;
                renderParkBreakdown();
                panel.classList.remove('hidden');
            } else {
                panel.classList.add('hidden');
            }
            renderLogbook();
            syncDashboardCardStyles();
        }

        function closeParkBreakdown() {
            document.getElementById('park-breakdown').classList.add('hidden');
            if (activeDashboardFilter?.kind === 'ride') {
                activeDashboardFilter = null;
                renderLogbook();
            }
            syncDashboardCardStyles();
        }

        function renderParkBreakdown() {
            const panel = document.getElementById('park-breakdown');
            const parks = new Map();
            getCoasterLogGroups().forEach(group => {
                const entry = group.entry;
                const park = (entry.parkName || entry.parkNameRidden || '').trim();
                if (!park) return;
                const key = park.toLocaleLowerCase();
                if (!parks.has(key)) parks.set(key, { name: park, entries: [] });
                parks.get(key).entries.push(group);
            });

            if (!parks.size) {
                panel.innerHTML = '<p class="text-sm text-slate-400">No parks recorded yet. Standalone rides without a park are not included.</p>';
                return;
            }

            panel.innerHTML = `<div class="mb-3 flex items-center justify-between">
                <h3 class="text-sm font-semibold text-white">Parks</h3>
                <button type="button" onclick="closeParkBreakdown()" class="text-xs text-slate-400 hover:text-white">Close</button>
            </div><div class="space-y-2">${[...parks.values()].sort((a, b) => a.name.localeCompare(b.name)).map(park => `
                <details class="overflow-hidden rounded-xl border border-bordercolor bg-slate-900/50">
                    <summary class="flex cursor-pointer items-center justify-between px-4 py-3 text-sm font-medium text-slate-200 hover:bg-slate-800">
                        <span>${escapeHtml(park.name)}</span><span class="text-xs text-slate-500">${park.entries.length} logged ${park.entries.length === 1 ? 'ride' : 'rides'}</span>
                    </summary>
                    <div class="border-t border-bordercolor divide-y divide-bordercolor/70">
                        ${park.entries.slice().sort((a, b) => (a.entry.coasterName || '').localeCompare(b.entry.coasterName || '')).map(group => `
                            <button type="button" data-park="${escapeHtml(park.name)}" data-coaster="${escapeHtml(group.entry.coasterName || '')}" data-ride-id="${escapeHtml(group.entry.coasterpediaRideId || '')}" onclick="applyDashboardFilter('ride', {park: this.dataset.park, coaster: this.dataset.coaster, rideId: this.dataset.rideId})" class="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-xs hover:bg-slate-800">
                                <span class="text-slate-200">${escapeHtml(group.entry.coasterName || 'Unnamed coaster')}${group.rideCount > 1 ? ` · ${group.rideCount} laps` : ''}</span>
                                <span class="text-slate-500">${escapeHtml(normalizeCoasterStatus(group.entry.rideStatus || 'Status unknown'))}</span>
                            </button>
                        `).join('')}
                    </div>
                </details>`).join('')}</div>`;
        }

        // Render Logbook List
        function renderLogbook() {
            const listContainer = document.getElementById('log-list');
            const searchVal = document.getElementById('log-search').value.toLowerCase().trim();
            const sortVal = document.getElementById('log-sort').value;
            const groups = getCoasterLogGroups();
            const duplicateKeys = duplicateRideGroupKeys(groups);

            // Filter entries
            let filtered = groups.filter(group => {
                const entry = group.entry;
                const matchSearch = group.entries.some(item =>
                    (item.coasterName || '').toLowerCase().includes(searchVal) ||
                    (item.parkName || '').toLowerCase().includes(searchVal) ||
                    (item.parkNameRidden || '').toLowerCase().includes(searchVal) ||
                    (item.notes || '').toLowerCase().includes(searchVal)
                );
                const matchDashboardFilter = !activeDashboardFilter ||
                    (activeDashboardFilter.kind === 'type' && (entry.type || 'Real') === activeDashboardFilter.value) ||
                    (activeDashboardFilter.kind === 'duplicates' && duplicateKeys.has(group.key)) ||
                    (activeDashboardFilter.kind === 'relogs' && group.rideCount > 1) ||
                    (activeDashboardFilter.kind === 'credits' && isEntryCredit(entry)) ||
                    (activeDashboardFilter.kind === 'ride' &&
                        (entry.parkName || entry.parkNameRidden || '').toLowerCase() === activeDashboardFilter.value.park.toLowerCase() &&
                        (entry.coasterName || '').toLowerCase() === activeDashboardFilter.value.coaster.toLowerCase() &&
                        (!activeDashboardFilter.value.rideId ||
                            entry.coasterpediaRideId === activeDashboardFilter.value.rideId));
                return matchSearch && matchDashboardFilter;
            });

            // Sort entries
            filtered.sort((a, b) => {
                if (sortVal === 'date-desc') return rideDateValue(b.entry) - rideDateValue(a.entry);
                if (sortVal === 'date-asc') return rideDateValue(a.entry) - rideDateValue(b.entry);
                if (sortVal === 'name-asc') return (a.entry.coasterName || '').localeCompare(b.entry.coasterName || '');
                if (sortVal === 'park-asc') return (a.entry.parkName || '').localeCompare(b.entry.parkName || '');
                return 0;
            });

            if (filtered.length === 0) {
                if (groups.length === 0) {
                    listContainer.innerHTML = `
                        <div class="bg-cardbg rounded-2xl border border-bordercolor p-12 text-center">
                            <div class="w-16 h-16 rounded-full bg-slate-800 text-slate-500 flex items-center justify-center mx-auto mb-4 text-2xl">
                                <i class="fa-solid fa-ghost"></i>
                            </div>
                            <h3 class="text-base font-semibold text-white mb-1">${currentUser ? 'Your Coaster Log is Empty' : 'Browsing as a Guest'}</h3>
                            <p class="text-xs text-slate-400 max-w-md mx-auto mb-6">${currentUser ? "Start building your credit list by searching for theme parks or manually adding rides you've ridden!" : 'Your personal log is private and only appears after you sign in. Browse coaster parks freely, or sign in to view and manage your credits.'}</p>
                            <div class="flex justify-center gap-3">
                                <button onclick="switchTab('search')" class="px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white rounded-xl text-xs font-semibold shadow-md shadow-brand-600/20 transition">
                                    <i class="fa-solid fa-magnifying-glass mr-1.5"></i> Search Theme Parks
                                </button>
                                <button onclick="${currentUser ? 'openAddModal()' : 'openAuthDialog()'}" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-bordercolor rounded-xl text-xs font-semibold transition">
                                    <i class="fa-solid ${currentUser ? 'fa-plus' : 'fa-right-to-bracket'} mr-1.5"></i> ${currentUser ? 'Add Custom Entry' : 'Sign in'}
                                </button>
                            </div>
                        </div>
                    `;
                } else {
                    listContainer.innerHTML = `
                        <div class="bg-cardbg rounded-2xl border border-bordercolor p-8 text-center text-slate-400 text-xs">
                            No ride entries found matching your search and filter criteria.
                        </div>
                    `;
                }
                return;
            }

            let html = '';
            filtered.forEach(group => {
                const entry = group.entry;
                const isDuplicate = duplicateKeys.has(group.key);
                const openingEntry = group.entries.find(item => item.coasterpediaOpeningDate || item.coasterpediaClosingDate);
                const operatingDates = [openingEntry?.coasterpediaOpeningDate, openingEntry?.coasterpediaClosingDate]
                    .map(formatCoasterpediaYear)
                    .filter(Boolean)
                    .join('–');

                const parkDisplayName = entry.parkName || 'Standalone ride';
                const historicParkName = entry.parkNameRidden && entry.parkNameRidden !== entry.parkName
                    ? entry.parkNameRidden
                    : '';

                const rideDateTime = formatRideDateTime(entry);
                const rideStatus = normalizeCoasterStatus(entry.rideStatus || 'Status unknown');

                html += `
                    <div class="bg-cardbg rounded-2xl border border-bordercolor p-4 hover:border-slate-700 transition flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                        <div class="space-y-1.5 flex-grow">
                            <div class="flex items-center gap-2 flex-wrap">
                                <h4 class="text-base font-bold text-white">${escapeHtml(entry.coasterName)}</h4>
                                ${isDuplicate ? '<span class="rounded-md border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[10px] font-semibold text-violet-300">Duplicate</span>' : ''}
                            </div>
                            ${entry.coasterNameRidden && entry.coasterNameRidden !== entry.coasterName
                                ? `<p class="text-[11px] text-slate-400">Ridden as: ${escapeHtml(entry.coasterNameRidden)}</p>`
                                : ''}
                            <div class="flex flex-col gap-2 text-xs text-slate-400 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
                                <div class="flex flex-wrap items-center gap-3">
                                    ${rideDateTime ? `<span><i class="fa-regular fa-calendar mr-1"></i>${escapeHtml(rideDateTime)}</span>` : ''}
                                    <span class="rounded-md border border-slate-700 px-2 py-0.5 text-[10px] uppercase tracking-wide">${escapeHtml(rideStatus)}</span>
                                    ${operatingDates ? `<span class="text-slate-500">Dates ${escapeHtml(operatingDates)}</span>` : ''}
                                    ${group.rideCount > 1 ? `<span><i class="fa-solid fa-ticket mr-1"></i>${group.rideCount} laps</span>` : ''}
                                </div>
                                <div class="flex flex-wrap items-center gap-3">
                                    <span class="font-medium text-slate-200"><i class="fa-solid fa-location-dot text-brand-500 mr-1"></i>${escapeHtml(parkDisplayName)}</span>
                                    ${historicParkName ? `<span class="text-slate-500">${escapeHtml(historicParkName)}</span>` : ''}
                                </div>
                            </div>
                            ${entry.notes ? `<p class="text-[11px] italic text-slate-500">${escapeHtml(entry.notes)}</p>` : ''}
                        </div>

                        <div class="flex flex-wrap items-center justify-end gap-2 self-end md:self-center">
                            <button onclick="openEditModal('${entry.id}')" class="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-bordercolor text-xs transition flex items-center gap-1.5" title="Edit Entry" aria-label="Edit ${escapeHtml(entry.coasterName)}">
                                <i class="fa-solid fa-pen"></i><span>Edit</span>
                            </button>
                            <button type="button" onclick="relogEntry('${entry.id}')" class="px-3 py-2 rounded-xl bg-brand-600/10 hover:bg-brand-600/20 text-brand-300 border border-brand-500/20 text-xs transition flex items-center gap-1.5" title="Edit and save a relog">
                                <i class="fa-solid fa-rotate"></i><span>Relog</span>
                            </button>
                            <button type="button" onclick="deleteEntry('${entry.id}')" class="p-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 text-xs transition" title="Delete Entry" aria-label="Delete ${escapeHtml(entry.coasterName)} log entry">
                                <i class="fa-solid fa-trash"></i>
                            </button>
                        </div>
                    </div>
                `;
            });

            listContainer.innerHTML = html;
        }

        // Coasterpedia MediaWiki API integration
        function searchCoasterpedia() {
            const input = document.getElementById('park-search-input');
            const query = input.value.trim();
            const requestId = ++searchRequestId;
            clearTimeout(searchDebounceTimer);
            parkValidationAbortController?.abort();
            parkValidationAbortController = null;

            if (query !== currentParkTitle) {
                currentParkTitle = '';
                currentParkPageId = '';
                currentParkRides = [];
                document.getElementById('rides-results-placeholder').classList.remove('hidden');
                document.getElementById('rides-loading').classList.add('hidden');
                document.getElementById('rides-content').classList.add('hidden');
            }

            renderParkSearchMessage(query ? 'Searching all Coasterpedia parks...' : 'Loading Coasterpedia park directory...');
            searchDebounceTimer = setTimeout(() => loadCoasterpediaParkResults(query, requestId), 200);
        }

        function showParkSearchResults() {
            const query = document.getElementById('park-search-input').value.trim();
            if (query || !coasterpediaSearchResults.length) searchCoasterpedia();
            else document.getElementById('park-search-results').classList.remove('hidden');
        }

        function hideParkSearchResults() {
            document.getElementById('park-search-results').classList.add('hidden');
            document.getElementById('park-search-input').setAttribute('aria-expanded', 'false');
        }

        function renderParkSearchMessage(message) {
            const results = document.getElementById('park-search-results');
            results.innerHTML = `<div class="px-4 py-3 text-xs text-slate-400">${escapeHtml(message)}</div>`;
            results.classList.remove('hidden');
            document.getElementById('park-search-input').setAttribute('aria-expanded', 'true');
        }

        async function loadCoasterpediaParkIndex() {
            if (coasterpediaParkIndex.length) return coasterpediaParkIndex;
            if (coasterpediaParkIndexPromise) return coasterpediaParkIndexPromise;

            coasterpediaParkIndexPromise = (async () => {
                const parks = [];
                let continuation = '';
                do {
                    const params = new URLSearchParams({
                        action: 'query',
                        list: 'categorymembers',
                        cmtitle: 'Category:Amusement parks by name',
                        cmnamespace: '0',
                        cmlimit: '500',
                        format: 'json',
                        origin: '*'
                    });
                    if (continuation) params.set('cmcontinue', continuation);

                    const response = await fetch(`https://coasterpedia.net/w/api.php?${params}`);
                    if (!response.ok) {
                        throw new Error(`Coasterpedia park directory failed with status ${response.status}`);
                    }
                    const data = await response.json();
                    parks.push(...(data.query?.categorymembers || []));
                    continuation = data.continue?.cmcontinue || '';
                } while (continuation);

                coasterpediaParkIndex = parks.sort((a, b) => a.title.localeCompare(b.title));
                return coasterpediaParkIndex;
            })();

            try {
                return await coasterpediaParkIndexPromise;
            } catch (err) {
                coasterpediaParkIndexPromise = null;
                throw err;
            }
        }

        async function loadCoasterpediaParkResults(query, requestId) {
            try {
                const parks = await loadCoasterpediaParkIndex();
                if (requestId !== searchRequestId) return;

                const normalizedQuery = normalizeParkSearchText(query);
                parkSearchCandidates = parks.filter(park =>
                    normalizeParkSearchText(park.title).includes(normalizedQuery)
                );
                parkSearchCandidates.sort((a, b) => {
                    const aStarts = normalizeParkSearchText(a.title).startsWith(normalizedQuery);
                    const bStarts = normalizeParkSearchText(b.title).startsWith(normalizedQuery);
                    return Number(bStarts) - Number(aStarts) || a.title.localeCompare(b.title);
                });
                parkSearchCursor = 0;
                coasterpediaSearchResults = [];
                parkSearchLoading = false;
                parkSearchLoadingRequestId = 0;
                await loadMoreCoasterpediaParks(requestId);
            } catch (err) {
                if (requestId !== searchRequestId) return;
                console.error('Failed to load Coasterpedia park directory:', err);
                renderParkSearchMessage('Could not load Coasterpedia parks. Please try again.');
                showToast('Failed to load Coasterpedia parks', 'error');
            }
        }

        function normalizeParkSearchText(value) {
            return value.toLocaleLowerCase().replace(/[’‘]/g, "'");
        }

        async function loadMoreCoasterpediaParks(requestId) {
            if ((parkSearchLoading && parkSearchLoadingRequestId === requestId) || requestId !== searchRequestId) return;
            parkSearchLoading = true;
            parkSearchLoadingRequestId = requestId;

            const batchSize = 10;
            const batch = parkSearchCandidates.slice(parkSearchCursor, parkSearchCursor + batchSize);
            parkSearchCursor += batch.length;
            const abortController = new AbortController();
            parkValidationAbortController = abortController;
            const params = new URLSearchParams({
                action: 'query',
                prop: 'revisions',
                titles: batch.map(page => page.title).join('|'),
                rvprop: 'content',
                rvslots: 'main',
                format: 'json',
                origin: '*'
            });

            try {
                const response = await fetch(`https://coasterpedia.net/w/api.php?${params}`, {
                    signal: abortController.signal
                });
                if (!response.ok) {
                    throw new Error(`Coasterpedia park lookup failed with status ${response.status}`);
                }
                const data = await response.json();
                if (requestId !== searchRequestId) return;
                if (parkValidationAbortController === abortController) parkValidationAbortController = null;

                const pagesByTitle = new Map(Object.values(data.query?.pages || [])
                    .map(page => [page.title.toLocaleLowerCase(), page]));
                coasterpediaSearchResults.push(...batch.flatMap(park => {
                    const page = pagesByTitle.get(park.title.toLocaleLowerCase());
                    const wikitext = page?.revisions?.[0]?.slots?.main?.['*'] || '';
                    return hasCoasterpediaCoasterSections(wikitext)
                        ? [{ ...park, title: page.title, coasterpediaParkPageId: String(page.pageid || '') }]
                        : [];
                }));
            } catch (err) {
                if (requestId !== searchRequestId) return;
                if (parkValidationAbortController === abortController) parkValidationAbortController = null;
                parkSearchCursor -= batch.length;
                parkSearchLoading = false;
                console.error('Failed to check Coasterpedia park sections:', err);
                renderCoasterpediaParkResults();
                showToast('Failed to check Coasterpedia parks. Try again.', 'error');
                return;
            }

            parkSearchLoading = false;
            renderCoasterpediaParkResults();

            const minimumResults = document.getElementById('park-search-input').value.trim() ? 1 : 8;
            if (coasterpediaSearchResults.length < minimumResults && parkSearchCursor < parkSearchCandidates.length) {
                await loadMoreCoasterpediaParks(requestId);
            } else if (coasterpediaSearchResults.length === 0) {
                renderParkSearchMessage('No parks with operating, not operating, or defunct coaster lists found.');
            }
        }

        function hasCoasterpediaCoasterSections(wikitext) {
            const headings = [...wikitext.matchAll(/^(={2,6})\s*(.*?)\s*\1\s*$/gm)]
                .map((match, index) => ({
                    hLevel: match[1].length,
                    line: match[2].trim().replace(/_/g, ' '),
                    index: String(index + 1)
                }));
            return findCoasterpediaSections(headings).length > 0;
        }

        function coasterpediaCoasterEra(heading) {
            if (/^(?:not operating|standing but not operating|under construction|under refurbishment|in storage|temporarily closed|never operated)$/i.test(heading)) return 'Not operating';
            if (/^(?:present|current|operating)$/i.test(heading)) return 'Operating';
            if (/^(?:past|former|defunct)$/i.test(heading)) return 'Defunct';
            return null;
        }

        function normalizeCoasterStatus(status = 'Unknown') {
            const value = String(status || 'Unknown').trim();
            if (/^(?:present|current|operating)$/i.test(value)) return 'Operating';
            if (/^(?:former|past|defunct)$/i.test(value)) return 'Defunct';
            if (/^(?:not operating|standing but not operating|under construction|under refurbishment|in storage|temporarily closed|never operated)$/i.test(value)) return 'Not operating';
            return value;
        }

        function coasterStatusForRide(ride) {
            return normalizeCoasterStatus(String(ride.entityType || '').replace(/\s+coaster$/i, ''));
        }

        function isNotOperatingCoasterRow(value = '') {
            return /\b(?:not operating|under construction|under refurbishment|in storage|temporarily closed)\b/i.test(value);
        }

        function coasterpediaCoasterListHeadingEra(heading) {
            const match = heading.match(/^(.+?)\s+(?:roller\s+)?coasters?$/i);
            return match ? coasterpediaCoasterEra(match[1].trim()) : null;
        }

        function renderCoasterpediaParkResults() {
            const results = document.getElementById('park-search-results');
            const loadingText = parkSearchCursor < parkSearchCandidates.length
                ? `Load more parks (${parkSearchCandidates.length.toLocaleString()} names to check)`
                : `${coasterpediaSearchResults.length} parks with coaster lists`;
            results.innerHTML = coasterpediaSearchResults.map((result, index) => `
                <button type="button" role="option" aria-selected="false" onclick="selectCoasterpediaPark(${index})" class="w-full text-left px-4 py-3 border-b border-bordercolor last:border-0 hover:bg-slate-800 focus:bg-slate-800 focus:outline-none">
                    <span class="block text-sm font-semibold text-white">${escapeHtml(result.title)}</span>
                    <span class="block text-[11px] text-slate-500 mt-0.5">Park directory</span>
                </button>
            `).join('') + (parkSearchLoading
                ? `<div class="px-4 py-3 text-xs text-slate-400">Checking parks...</div>`
                : parkSearchCursor < parkSearchCandidates.length
                    ? `<button type="button" onclick="loadMoreCoasterpediaParks(searchRequestId)" class="w-full px-4 py-3 text-left text-xs text-brand-400 hover:bg-slate-800">${escapeHtml(loadingText)}</button>`
                    : '');
            results.classList.remove('hidden');
            document.getElementById('park-search-input').setAttribute('aria-expanded', 'true');
        }

        function onParkSearchScroll() {
            const results = document.getElementById('park-search-results');
            if (results.scrollTop + results.clientHeight >= results.scrollHeight - 40) {
                loadMoreCoasterpediaParks(searchRequestId);
            }
        }

        async function selectCoasterpediaPark(index) {
            const selectedPage = coasterpediaSearchResults[index];
            if (!selectedPage) return;

            const requestId = ++searchRequestId;
            currentParkTitle = selectedPage.title;
            currentParkPageId = selectedPage.coasterpediaParkPageId || '';
            coasterpediaSearchResults = [selectedPage];
            document.getElementById('park-search-input').value = selectedPage.title;
            hideParkSearchResults();
            const containerPlaceholder = document.getElementById('rides-results-placeholder');
            const containerLoading = document.getElementById('rides-loading');
            const containerContent = document.getElementById('rides-content');

            containerPlaceholder.classList.add('hidden');
            containerLoading.classList.remove('hidden');
            containerContent.classList.add('hidden');

            try {
                currentParkRides = await fetchCoasterpediaParkRides(selectedPage.title);
                if (requestId !== searchRequestId) return;
                await enrichCoasterRideDetails();
                if (requestId !== searchRequestId) return;

                if (currentParkRides.length === 0) {
                    throw new Error('No coaster entries were found in this park article.');
                }

                const updatedRideDetails = await updateLoggedRideStatuses(
                    selectedPage.title,
                    currentParkRides,
                    selectedPage.coasterpediaParkPageId
                );
                if (updatedRideDetails > 0) {
                    saveToLocalStorage();
                    renderLogbook();
                    if (!document.getElementById('park-breakdown').classList.contains('hidden')) renderParkBreakdown();
                    showToast(`Updated name or status for ${updatedRideDetails} logged coaster${updatedRideDetails === 1 ? '' : 's'}.`, 'success');
                }

                document.getElementById('current-park-title').innerText = `${selectedPage.title} Coasters`;
                renderRidesList();

                containerLoading.classList.add('hidden');
                containerContent.classList.remove('hidden');

            } catch (err) {
                if (requestId !== searchRequestId) return;
                console.error('Error fetching Coasterpedia coaster list:', err);
                containerLoading.classList.add('hidden');
                containerPlaceholder.classList.remove('hidden');
                showToast(err.message || 'Failed to load coaster directory', 'error');
            }
        }

        async function fetchCoasterpediaParkRides(parkTitle) {
            const tocParams = new URLSearchParams({
                action: 'parse',
                page: parkTitle,
                prop: 'tocdata',
                format: 'json',
                origin: '*'
            });
            const tocResponse = await fetch(`https://coasterpedia.net/w/api.php?${tocParams}`);
            if (!tocResponse.ok) {
                throw new Error(`Coasterpedia page lookup failed with status ${tocResponse.status}`);
            }
            const tocData = await tocResponse.json();
            const sections = findCoasterpediaSections(tocData.parse?.tocdata?.sections || []);
            if (sections.length === 0) {
                throw new Error(`"${parkTitle}" does not have a coaster list.`);
            }

            const rides = (await Promise.all(sections.map(async section => {
                const sectionParams = new URLSearchParams({
                    action: 'parse',
                    page: parkTitle,
                    section: section.index,
                    prop: 'text|wikitext',
                    format: 'json',
                    origin: '*'
                });
                const sectionResponse = await fetch(`https://coasterpedia.net/w/api.php?${sectionParams}`);
                if (!sectionResponse.ok) {
                    throw new Error(`Coasterpedia coaster list failed with status ${sectionResponse.status}`);
                }
                const sectionData = await sectionResponse.json();
                const parsed = sectionData.parse || {};
                const renderedRides = parseCoasterpediaRenderedCoasters(
                    parsed.text?.['*'] || '',
                    parkTitle,
                    section.status
                );
                return renderedRides.length
                    ? renderedRides
                    : parseCoasterpediaCoasters(parsed.wikitext?.['*'] || '', parkTitle, section.status);
            }))).flat();
            if (rides.length === 0) {
                throw new Error(`No coaster entries were found in "${parkTitle}".`);
            }
            return rides;
        }

        function coasterpediaRideReference(value = '') {
            const match = String(value).match(/^(.*?)(::track-\d+)$/i);
            return { pageTitle: match ? match[1] : String(value), trackIdSuffix: match?.[2] || '' };
        }

        function coasterpediaRideBaseName(name = '') {
            return String(name).replace(/\s+\((?:red track|blue track|track \d+)\)$/i, '').trim();
        }

        function coasterpediaRideNameSuffix(name = '') {
            return String(name).match(/\s+\((?:red track|blue track|track \d+)\)$/i)?.[0] || '';
        }

        async function resolveCoasterpediaPageReferences(titles) {
            const uniqueTitles = [...new Map(titles.filter(Boolean).map(title =>
                [String(title).toLocaleLowerCase(), String(title)]
            )).values()];
            const references = new Map();

            for (let offset = 0; offset < uniqueTitles.length; offset += 50) {
                const batch = uniqueTitles.slice(offset, offset + 50);
                const params = new URLSearchParams({
                    action: 'query',
                    prop: 'info',
                    titles: batch.join('|'),
                    redirects: 1,
                    format: 'json',
                    origin: '*'
                });
                const response = await fetch(`https://coasterpedia.net/w/api.php?${params}`);
                if (!response.ok) throw new Error(`Coasterpedia ride identity lookup failed with status ${response.status}`);
                const data = await response.json();
                const aliases = new Map();
                const pagesByTitle = new Map();
                Object.values(data.query?.pages || {}).forEach(page => {
                    if (page.pageid) {
                        pagesByTitle.set(page.title.toLocaleLowerCase(), {
                            pageId: String(page.pageid),
                            title: page.title
                        });
                    }
                });
                [...(data.query?.normalized || []), ...(data.query?.redirects || [])].forEach(alias => {
                    aliases.set(alias.from.toLocaleLowerCase(), alias.to);
                });

                batch.forEach(title => {
                    let currentTitle = title;
                    const visited = new Set();
                    while (aliases.has(currentTitle.toLocaleLowerCase()) &&
                        !visited.has(currentTitle.toLocaleLowerCase())) {
                        visited.add(currentTitle.toLocaleLowerCase());
                        currentTitle = aliases.get(currentTitle.toLocaleLowerCase());
                    }
                    const reference = pagesByTitle.get(currentTitle.toLocaleLowerCase());
                    if (reference) references.set(title.toLocaleLowerCase(), reference);
                });
            }

            return references;
        }

        async function updateLoggedRideStatuses(parkTitle, rides, parkPageId = '') {
            const parkEntries = coasterLog.filter(entry =>
                (entry.parkName || entry.parkNameRidden || '').trim().toLocaleLowerCase() === parkTitle.toLocaleLowerCase()
            );
            const titlesToResolve = [
                ...rides.map(ride => ride.pageTitle || coasterpediaRideReference(ride.sourceRideId || ride.id).pageTitle),
                ...parkEntries.filter(entry => !entry.coasterpediaPageId && entry.coasterpediaRideId)
                    .map(entry => coasterpediaRideReference(entry.coasterpediaRideId).pageTitle)
            ];
            let pageReferences = new Map();
            try {
                pageReferences = await resolveCoasterpediaPageReferences(titlesToResolve);
            } catch (error) {
                console.warn(`Coasterpedia ride identity lookup failed for "${parkTitle}"; matching by name only.`, error);
            }

            const ridesByPageId = new Map();
            const ridesByName = new Map();
            rides.forEach(ride => {
                const rideReference = coasterpediaRideReference(ride.sourceRideId || ride.pageTitle || ride.id);
                const resolved = pageReferences.get((ride.pageTitle || rideReference.pageTitle).toLocaleLowerCase());
                if (resolved) {
                    ride.pageTitle = resolved.title;
                    ride.coasterpediaPageId = resolved.pageId;
                    ride.sourceRideId = `${resolved.title}${rideReference.trackIdSuffix}`;
                    ride.id = ride.sourceRideId;
                }

                const rideName = coasterpediaRideBaseName(ride.name);
                const rideStatus = coasterStatusForRide(ride);
                const rideDetails = {
                    pageId: ride.coasterpediaPageId || '',
                    pageTitle: ride.pageTitle || rideReference.pageTitle,
                    name: rideName,
                    status: rideStatus
                };
                if (rideDetails.pageId) {
                    const previous = ridesByPageId.get(rideDetails.pageId);
                    if (!previous || rideStatus === 'Operating') ridesByPageId.set(rideDetails.pageId, rideDetails);
                }
                const nameKey = normalizeRideStatusName(rideName);
                if (!ridesByName.has(nameKey)) ridesByName.set(nameKey, []);
                const rideKey = rideDetails.pageId || rideDetails.pageTitle.toLocaleLowerCase();
                if (!ridesByName.get(nameKey).some(item =>
                    (item.pageId || item.pageTitle.toLocaleLowerCase()) === rideKey
                )) {
                    ridesByName.get(nameKey).push(rideDetails);
                }
            });

            let updatedCount = 0;
            parkEntries.forEach(entry => {
                let changed = false;
                if (parkPageId && entry.coasterpediaParkPageId !== String(parkPageId)) {
                    entry.coasterpediaParkPageId = String(parkPageId);
                    changed = true;
                }
                const savedReference = coasterpediaRideReference(entry.coasterpediaRideId || '');
                const resolvedSavedReference = !entry.coasterpediaPageId && savedReference.pageTitle
                    ? pageReferences.get(savedReference.pageTitle.toLocaleLowerCase())
                    : null;
                const savedPageId = entry.coasterpediaPageId || resolvedSavedReference?.pageId;

                let rideDetails = savedPageId
                    ? ridesByPageId.get(String(savedPageId))
                    : null;
                const identityMatched = Boolean(rideDetails);
                if (!rideDetails) {
                    const candidates = ridesByName.get(normalizeRideStatusName(coasterpediaRideBaseName(entry.coasterName || ''))) || [];
                    if (candidates.length === 1) rideDetails = candidates[0];
                }
                if (!rideDetails) {
                    if (changed) updatedCount++;
                    return;
                }

                if (identityMatched) {
                    if (!entry.coasterpediaPageId && resolvedSavedReference) {
                        entry.coasterpediaPageId = resolvedSavedReference.pageId;
                        changed = true;
                    }
                    const updatedName = `${rideDetails.name}${coasterpediaRideNameSuffix(entry.coasterName)}`;
                    if (updatedName && entry.coasterName !== updatedName) {
                        entry.coasterName = updatedName;
                        changed = true;
                    }
                    const updatedRideId = `${rideDetails.pageTitle}${savedReference.trackIdSuffix}`;
                    if (entry.coasterpediaRideId !== updatedRideId) {
                        entry.coasterpediaRideId = updatedRideId;
                        changed = true;
                    }
                    if (entry.coasterpediaPageId !== rideDetails.pageId) {
                        entry.coasterpediaPageId = rideDetails.pageId;
                        changed = true;
                    }
                }
                if (rideDetails.status && entry.rideStatus !== rideDetails.status) {
                    entry.rideStatus = rideDetails.status;
                    changed = true;
                }
                if (changed) updatedCount++;
            });
            return updatedCount;
        }

        async function resolveCoasterpediaParkReference(title, pageId = '') {
            if (/^\d+$/.test(String(pageId || ''))) {
                const params = new URLSearchParams({
                    action: 'query',
                    prop: 'info',
                    pageids: String(pageId),
                    format: 'json',
                    origin: '*'
                });
                try {
                    const response = await fetch(`https://coasterpedia.net/w/api.php?${params}`);
                    if (response.ok) {
                        const data = await response.json();
                        const page = Object.values(data.query?.pages || []).find(item => item.pageid);
                        if (page) return { pageId: String(page.pageid), title: page.title };
                    }
                } catch (error) {
                    console.warn(`Coasterpedia park page ID lookup failed for "${title}"; resolving by title.`, error);
                }
            }

            if (!title) return null;
            try {
                const references = await resolveCoasterpediaPageReferences([title]);
                return references.get(String(title).toLocaleLowerCase()) || null;
            } catch (error) {
                console.warn(`Coasterpedia park title lookup failed for "${title}".`, error);
                return null;
            }
        }

        function normalizeRideStatusName(name) {
            return name.trim().toLocaleLowerCase().replace(/[’‘]/g, "'");
        }

        async function refreshLoggedRideStatuses() {
            const parks = new Map();
            coasterLog.forEach(entry => {
                const parkName = (entry.parkName || entry.parkNameRidden || '').trim();
                if (!parkName) return;
                const pageId = String(entry.coasterpediaParkPageId || '');
                const key = pageId ? `page:${pageId}` : `title:${parkName.toLocaleLowerCase()}`;
                if (!parks.has(key)) parks.set(key, { title: parkName, pageId, entries: [] });
                parks.get(key).entries.push(entry);
            });
            const pendingParks = [...parks.values()];
            if (pendingParks.length === 0) return;

            let updatedCount = 0;
            let failedParks = 0;
            const workers = Array.from({ length: Math.min(3, pendingParks.length) }, async () => {
                while (pendingParks.length > 0) {
                    const park = pendingParks.shift();
                    const originalStates = new Map(park.entries.map(entry => [entry, JSON.stringify([
                        entry.parkName,
                        entry.coasterpediaParkPageId,
                        entry.coasterName,
                        entry.coasterpediaRideId,
                        entry.coasterpediaPageId,
                        entry.rideStatus
                    ])]));
                    try {
                        const reference = await resolveCoasterpediaParkReference(park.title, park.pageId);
                        const parkTitle = reference?.title || park.title;
                        const parkPageId = reference?.pageId || park.pageId;
                        park.entries.forEach(entry => {
                            entry.parkName = parkTitle;
                            if (parkPageId) entry.coasterpediaParkPageId = parkPageId;
                        });
                        const rides = await fetchCoasterpediaParkRides(parkTitle);
                        await updateLoggedRideStatuses(parkTitle, rides, parkPageId);
                    } catch (error) {
                        failedParks++;
                        console.error(`Failed to refresh logged ride status for "${park.title}":`, error);
                    } finally {
                        updatedCount += park.entries.filter(entry =>
                            originalStates.get(entry) !== JSON.stringify([
                                entry.parkName,
                                entry.coasterpediaParkPageId,
                                entry.coasterName,
                                entry.coasterpediaRideId,
                                entry.coasterpediaPageId,
                                entry.rideStatus
                            ])
                        ).length;
                    }
                }
            });
            await Promise.all(workers);

            if (updatedCount > 0) {
                saveToLocalStorage();
                updateStatsAndCounters();
                renderLogbook();
                if (!document.getElementById('park-breakdown').classList.contains('hidden')) renderParkBreakdown();
                showToast(`Updated names or statuses for ${updatedCount} logged coaster${updatedCount === 1 ? '' : 's'} from Coasterpedia.`, 'success');
            }
            if (failedParks > 0) {
                showToast(`Could not refresh status from Coasterpedia for ${failedParks} park${failedParks === 1 ? '' : 's'}; saved statuses were kept.`, 'error');
            }
        }

        function findCoasterpediaSections(sections) {
            const entries = sections.map(section => ({
                ...section,
                level: Number(section.hLevel),
                heading: String(section.line || '').replace(/<[^>]*>/g, '').trim()
                    .replace(/&amp;/gi, '&').replace(/&#0*39;|&apos;/gi, "'")
                    .replace(/&quot;/gi, '"').replace(/&nbsp;/gi, ' '),
                ancestors: []
            }));
            const headingStack = [];

            entries.forEach(entry => {
                while (headingStack.length && headingStack.at(-1).level >= entry.level) headingStack.pop();
                entry.ancestors = [...headingStack];
                headingStack.push(entry);
            });

            const isPlainCoasterHeading = heading => /^(?:roller\s+)?coasters?$/i.test(heading);
            const hasCoasterListAncestor = entry => entry.ancestors.some(ancestor =>
                coasterpediaCoasterListHeadingEra(ancestor.heading) || isPlainCoasterHeading(ancestor.heading)
            );
            const nestedStatusSections = entries.filter(entry =>
                coasterpediaCoasterEra(entry.heading) && hasCoasterListAncestor(entry)
            );

            return entries.flatMap(entry => {
                const directEra = coasterpediaCoasterListHeadingEra(entry.heading);
                const plainHeading = isPlainCoasterHeading(entry.heading);
                const nestedEra = coasterpediaCoasterEra(entry.heading);
                const isNestedStatus = nestedEra && hasCoasterListAncestor(entry);
                if (!directEra && !plainHeading && !isNestedStatus) return [];

                const neverOperatedSection = /\bnever operated\b/i.test(entry.heading) ||
                    entry.ancestors.some(ancestor => /\bnever operated\b/i.test(ancestor.heading));
                const hasNestedStatusLists = nestedStatusSections.some(statusSection =>
                    statusSection.ancestors.some(ancestor => ancestor.index === entry.index)
                );
                if (neverOperatedSection || (plainHeading && hasNestedStatusLists)) return [];

                const ancestorEra = entry.ancestors.slice().reverse()
                    .map(ancestor => coasterpediaCoasterEra(ancestor.heading))
                    .find(Boolean);
                return [{
                    index: entry.index,
                    status: isNestedStatus ? nestedEra : directEra || ancestorEra || 'Operating'
                }];
            });
        }

        function parseCoasterpediaRenderedCoasters(html, parkName, status) {
            const documentNode = new DOMParser().parseFromString(html, 'text/html');
            const seenTitles = new Set();
            const rides = [];

            documentNode.querySelectorAll('table').forEach(table => {
                const rows = [...table.querySelectorAll('tr')];
                const headerRow = rows.find(row => row.querySelector('th'));
                const headers = headerRow
                    ? [...headerRow.children]
                        .filter(cell => cell.tagName === 'TH' || cell.tagName === 'TD')
                        .map(cell => cell.textContent.trim().toLowerCase())
                    : [];
                const nameColumn = headers.findIndex(header => /^(?:name|coaster|roller coaster)$/.test(header));
                const classColumn = headers.findIndex(header => /^(?:class|category|ride type)$/.test(header));

                rows.forEach(row => {
                    if (row === headerRow || /\bnever operated\b/i.test(row.textContent)) return;
                    const rowStatus = isNotOperatingCoasterRow(row.textContent) ? 'Not operating' : status;
                    const cells = [...row.children].filter(cell => cell.tagName === 'TH' || cell.tagName === 'TD');
                    if (!cells.length) return;
                    const nameCell = cells[nameColumn >= 0 ? nameColumn : 0];
                    const link = nameCell?.querySelector('a[href*="/wiki/"]');
                    const name = link?.textContent.trim();
                    if (!link || !name) return;

                    const pageTitle = (link.getAttribute('title') || link.pathname.split('/wiki/').pop() || '')
                        .replace(/_/g, ' ');
                    let decodedTitle = pageTitle;
                    try { decodedTitle = decodeURIComponent(pageTitle); } catch {}
                    const titleKey = decodedTitle.toLocaleLowerCase();
                    if (!decodedTitle || seenTitles.has(titleKey)) return;
                    seenTitles.add(titleKey);

                    const rideClass = cells[classColumn]?.textContent.trim() || '';
                    rides.push({
                        id: decodedTitle,
                        sourceRideId: decodedTitle,
                        name,
                        pageTitle: decodedTitle,
                        entityType: `${rowStatus} coaster`,
                        parkName,
                        type: classifyCoasterpediaRide(rideClass),
                        rideType: cleanCoasterpediaCell(rideClass) || classifyRideLabel(''),
                        variant: /\bvr$/i.test(name) ? 'ElementChange' : 'Original'
                    });
                });
            });

            return rides;
        }

        function parseCoasterpediaCoasters(wikitext, parkName, status) {
            const seenTitles = new Set();
            const rides = [];
            const tableMatches = [...wikitext.matchAll(/\{\|([\s\S]*?)^\|\}/gm)];
            tableMatches.forEach(tableMatch => {
                const table = tableMatch[1];
                const subsections = [...wikitext.slice(0, tableMatch.index).matchAll(/^={3}\s*(.*?)\s*={3}\s*$/gm)];
                const subsectionTitle = subsections.at(-1)?.[1]?.trim() || '';
                const rideStatus = coasterpediaCoasterEra(subsectionTitle) || status;
                const headers = table.split(/\r?\n/)
                    .filter(line => line.trim().startsWith('!'))
                    .flatMap(line => line.trim().slice(1).split('!!'))
                    .map(header => header.replace(/^.*\|/, '').replace(/<[^>]*>/g, '').trim().toLowerCase());
                const nameColumn = headers.findIndex(header => /^(name|coaster|roller coaster)$/.test(header));
                const classColumn = headers.findIndex(header => /^(class|category|ride type)$/.test(header));

                table.split(/^\|-/m).slice(1).forEach(row => {
                    if (/\bnever operated\b/i.test(row)) return;
                    const rowStatus = isNotOperatingCoasterRow(row) ? 'Not operating' : rideStatus;
                    const cells = [];
                    row.split(/\r?\n/).map(line => line.trim())
                        .filter(line => line.startsWith('|') && !line.startsWith('|}') && !line.startsWith('|+'))
                        .forEach(line => {
                            const rowCells = line.startsWith('||')
                                ? [...(cells.length === 0 ? [''] : []), ...line.slice(2).split('||')]
                                : line.slice(1).split('||');
                            if (rowCells.length > 1) {
                                cells.push(...rowCells.map(cell => cell.trim()));
                            } else {
                                cells.push(rowCells[0].trim());
                            }
                        });

                    const cell = cells[nameColumn >= 0 ? nameColumn : 0] || '';
                    const link = cell.match(/\[\[([^\]]+)\]\]/);
                    if (!link) return;

                    const [rawTitle, displayName] = link[1].split('|');
                    const pageTitle = rawTitle.split('#')[0].trim();
                    const name = (displayName || pageTitle).trim();
                    const titleKey = pageTitle.toLowerCase();
                    if (!name || seenTitles.has(titleKey)) return;
                    seenTitles.add(titleKey);

                    const rideClass = cells[classColumn] || '';
                    const rideType = cleanCoasterpediaCell(rideClass) || classifyRideLabel(cells.find((_, index) =>
                        headers[index] === 'type'
                    ) || '');
                    rides.push({
                        id: pageTitle,
                        sourceRideId: pageTitle,
                        name,
                        pageTitle,
                        entityType: `${rowStatus} coaster`,
                        parkName,
                        type: classifyCoasterpediaRide(rideClass),
                        rideType,
                        variant: /\bvr$/i.test(name) ? 'ElementChange' : 'Original'
                    });
                });
            });

            return rides;
        }

        function cleanCoasterpediaCell(value) {
            return value
                .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, title, label) => label || title)
                .replace(/<[^>]*>/g, ' ')
                .replace(/'{2,}/g, '')
                .trim();
        }

        function cleanCoasterpediaFormerName(value = '') {
            return cleanCoasterpediaCell(value)
                .replace(/\s*\((?:18|19|20)\d{2}\s*[-â€“â€”]\s*(?:(?:18|19|20)\d{2}|present|current)?\)\s*$/i, '')
                .replace(/\s*\((?:formerly|previously|past name)\)\s*$/i, '')
                .replace(/\s+(?:formerly|previously)\s+.+$/i, '')
                .replace(/^\s*(?:name\d*|past[\s_-]*name\d*|former[\s_-]*name\d*|previous[\s_-]*name\d*)\s*[:=-]\s*/i, '')
                .replace(/\s+/g, ' ')
                .replace(/^[*#;:\s|!-]+|[*#;:\s|!-]+$/g, '')
                .trim();
        }

        function splitCoasterpediaFormerNames(value = '') {
            return String(value)
                .split(/<br\s*\/?>|;/i)
                .map(cleanCoasterpediaFormerName)
                .filter(isLikelyCoasterFormerName);
        }

        function isLikelyCoasterFormerName(name = '') {
            const value = cleanCoasterpediaFormerName(name);
            const normalized = value.toLocaleLowerCase();
            if (!value || !/[a-z0-9]/i.test(value)) return false;
            if (!/(?:^|[\s'&.-])(?:[A-Z][a-zA-Z0-9]*|[A-Z0-9]{2,})(?:$|[\s'&.-])|\d/.test(value)) return false;
            if (/^(?:it|its|itself|they|them|this|that|these|those|he|she|we|ride|coaster|roller coaster|attraction|train|track|layout|name|theme|area|park)$/i.test(value)) return false;
            if (/^(?:the|a|an)\s+(?:ride|coaster|roller coaster|attraction|train|track|layout|name|theme|area|park)$/i.test(value)) return false;
            if (/^(?:was|were|is|are|would|will|could|should|opened|closed|renamed|relocated)\b/i.test(value)) return false;
            if (/^(?:operating|closed|removed|relocated|unknown|present|current)$/i.test(value)) return false;
            if (/\b(?:train|trains|car|cars|vehicle|vehicles|locomotive|lead car)\b/i.test(value)) return false;
            if (/\b(?:project|codename|code name|working title|placeholder|alt\.?\s*winged)\b/i.test(value)) return false;
            if (/\b(?:tallest|fastest|longest|highest|steepest|complete circuit|roller coaster|coaster to|first|second|third|record|records?|height|speed|drop|inversion|inversions|track length)\b/i.test(value)) return false;
            if (value.split(/\s+/).length > 5) return false;
            if (/^(?:18|19|20)\d{2}(?:\s*[^a-z0-9\s]\s*(?:(?:18|19|20)\d{2}|present|current))?$/i.test(value)) return false;
            if (value.length < 2 && !/^[A-Z0-9]$/.test(value)) return false;
            return normalized.length > 1 || /^[A-Z0-9]$/.test(value);
        }

        function cleanCoasterpediaFormerNameList(names = [], currentName = '') {
            const currentKey = currentName.toLocaleLowerCase();
            return [...new Map(names
                .map(cleanCoasterpediaFormerName)
                .filter(name => isLikelyCoasterFormerName(name) && name.toLocaleLowerCase() !== currentKey)
                .map(name => [name.toLocaleLowerCase(), name])
            ).values()];
        }

        function extractCoasterpediaPastNames(infobox) {
            const values = [...infobox.matchAll(/^\|\s*(?:past[\s_-]*names?|previous(?:ly)?[\s_-]*names?|former[\s_-]*names?|previously[\s_-]*known[\s_-]*as)\s*=\s*(.+)$/gim)]
                .map(match => match[1]);
            return [...new Set(values.flatMap(value => {
                const parts = value.split(/<br\s*\/?>|;/i).map(part => part.trim()).filter(Boolean);
                return parts.flatMap(part => {
                    const links = [...part.matchAll(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g)]
                        .map(([, title, label]) => cleanCoasterpediaCell(label || title));
                    return links.length ? links : [cleanCoasterpediaCell(part)];
                });
            }).filter(Boolean))].map(name =>
                name.replace(/\s*\((?:18|19|20)\d{2}\s*[-–—]\s*(?:(?:18|19|20)\d{2}|present|current)?\)\s*$/i, '').trim()
            ).filter(Boolean);
        }

        function parseCoasterpediaInfoboxParams(infobox = '') {
            const params = new Map();
            let key = '';
            let value = [];
            const save = () => {
                if (key) params.set(key.toLowerCase().replace(/[\s-]+/g, '_'), value.join('\n').trim());
            };
            infobox.split(/\r?\n/).forEach(line => {
                const match = line.match(/^\s*\|\s*([^=]+?)\s*=\s*(.*)$/);
                if (match) {
                    save();
                    key = match[1].trim();
                    value = [match[2]];
                } else if (key) value.push(line);
            });
            save();
            return params;
        }

        function parseCoasterpediaPastNamesValue(value = '') {
            const source = String(value)
                .replace(/<!--[\s\S]*?-->/g, '')
                .replace(/<ref\b[^>]*>[\s\S]*?<\/ref\s*>/gi, '')
                .replace(/<ref\b[^>]*\/\s*>/gi, '');
            const names = [...source.matchAll(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g)]
                .map(([, title, label]) => label || title);
            [...source.matchAll(/\{\{\s*([^{}]+)\}\}/g)].forEach(([, body]) => {
                const parts = body.split('|').map(part => part.trim());
                parts.shift();
                parts.forEach(part => {
                    if (!part || /^[a-z_ -]+\s*=/.test(part)) return;
                    if (/^(?:\d{4}|(?:18|19|20)\d{2}\s*[-–—]\s*(?:(?:18|19|20)\d{2}|present|current)?)$/i.test(part)) return;
                    const linkLabels = [...part.matchAll(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g)]
                        .map(([, title, label]) => label || title);
                    names.push(...(linkLabels.length ? linkLabels : [part]));
                });
            });
            source.split(/\r?\n|<br\s*\/?>|;/i).forEach(line => {
                const parts = line.split(/\|\||!!/).map(part => part.trim()).filter(Boolean);
                (parts.length > 1 ? parts : [line]).forEach(part => {
                    if (/\[\[[^\]]+\]\]/.test(part)) return;
                    const plain = part.replace(/^\s*[|!*#;]+\s*/, '')
                        .replace(/^\{\{\s*[^|{}]+\s*\|/i, '').replace(/\}\}\s*$/, '').trim();
                    if (/^(?:\d{4}|(?:from|to|opened|closed|years?|dates?|name|past names?)\s*=?)$/i.test(plain)) return;
                    names.push(plain);
                });
            });
            return [...new Set(names.flatMap(splitCoasterpediaFormerNames))];
        }

        function extractCoasterpediaPastNamesParsed(infobox) {
            const params = parseCoasterpediaInfoboxParams(infobox);
            return [...new Set([...params.entries()]
                .filter(([key]) => /^(?:past_names?|previous_names?|former_names?|previously_known_as)$/.test(key))
                .flatMap(([, value]) => parseCoasterpediaPastNamesValue(value)))];
        }

        function escapeRegExp(value = '') {
            return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        }

        function extractCoasterpediaFallbackFormerNames(wikitext, currentName = '') {
            const articleText = cleanCoasterpediaCell(wikitext
                .split(/^={2,}\s*(?:references|external links|further reading|notes)\s*={2,}\s*$/im)[0]
                .replace(/<ref\b[^>]*>[\s\S]*?<\/ref\s*>/gi, ' ')
                .replace(/<ref\b[^>]*\/\s*>/gi, ' ')
                .replace(/\{\{[^{}]*\}\}/g, ' ')
                .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
                .replace(/\[\[([^\]]+)\]\]/g, '$1')
                .replace(/\s+/g, ' '));
            const currentNamePattern = escapeRegExp(currentName);
            const patterns = [
                /\b(?:opened|debuted)\b[^.!?]{0,80}\bas\s+([A-Z][A-Za-z0-9'&.-]*(?:\s+[A-Z0-9][A-Za-z0-9'&.-]*){0,4})(?=\s+(?:in|on|at|before|after|when|for|but|and|\.|,)|[.!?])/g,
                /\b(?:formerly|previously|originally)\s+(?:known\s+as|called|named|referred\s+to\s+as)\s+["“]?([A-Z][A-Za-z0-9'&.-]*(?:\s+[A-Z0-9][A-Za-z0-9'&.-]*){0,4})(?=["”]?\s+(?:in|on|at|before|after|when|for|but|and|until|during|from|between|\.|,)|[.!?])/g,
                /\b(?:was|were|is|are)\s+(?:also\s+)?(?:known\s+as|called|named|referred\s+to\s+as)\s+["“]?([A-Z][A-Za-z0-9'&.-]*(?:\s+[A-Z0-9][A-Za-z0-9'&.-]*){0,4})(?=["”]?\s+(?:in|on|at|before|after|when|for|but|and|until|during|from|between|\.|,)|[.!?])/g,
                /\b(?:went\s+by|bore\s+the\s+name)\s+["“]?([A-Z][A-Za-z0-9'&.-]*(?:\s+[A-Z0-9][A-Za-z0-9'&.-]*){0,4})(?=["”]?\s+(?:in|on|at|before|after|when|for|but|and|until|during|from|between|\.|,)|[.!?])/g,
                /\bwas named\s+["“]?[A-Z][A-Za-z0-9'&.-]*(?:\s+[A-Z0-9][A-Za-z0-9'&.-]*){0,4}["”]?\s+until\s+(?:it|the ride|the coaster)\s+was changed to\s+["“]?([A-Z][A-Za-z0-9'&.-]*(?:\s+[A-Z0-9][A-Za-z0-9'&.-]*){0,4})(?=\s+(?:in|on|at|for|during|before|after|the)\b|[.!?,]|$)/g,
                /\b(?:renamed|changed)\s+(?:its\s+)?name\s+from\s+([A-Z][A-Za-z0-9'&.-]*(?:\s+[A-Z0-9][A-Za-z0-9'&.-]*){0,4})\s+to\b/g,
                /\b(?:renamed|changed)\s+from\s+([A-Z][A-Za-z0-9'&.-]*(?:\s+[A-Z0-9][A-Za-z0-9'&.-]*){0,4})\s+to\b/g
            ];
            if (currentNamePattern) {
                patterns.push(new RegExp(`\\b${currentNamePattern}\\s*\\(\\s*(?:also\\s+)?(?:known as|called|named)\\s+([A-Z][A-Za-z0-9'&.-]*(?:\\s+[A-Z0-9][A-Za-z0-9'&.-]*){0,4})\\s*\\)`, 'g'));
                patterns.push(new RegExp(`\\b((?:[A-Z][A-Za-z0-9'&.-]*)(?:\\s+[A-Z][A-Za-z0-9'&.-]*){0,4})\\s+was\\b[^.!?]{0,80}\\brenamed\\s+(?:to\\s+|as\\s+)?${currentNamePattern}\\b`, 'g'));
                patterns.push(new RegExp(`\\b([A-Z][A-Za-z0-9'&.-]*(?:\\s+[A-Z0-9][A-Za-z0-9'&.-]*){0,4})\\s+(?:was|would be|became|got)\\s+renamed\\s+${currentNamePattern}\\b`, 'g'));
                patterns.push(new RegExp(`\\b([A-Z][A-Za-z0-9'&.-]*(?:\\s+[A-Z0-9][A-Za-z0-9'&.-]*){0,4})\\s+(?:was|is)\\s+(?:formerly\\s+)?(?:known as|called|named)\\s+${currentNamePattern}\\b`, 'g'));
            }
            return [...new Set(patterns.flatMap(pattern =>
                [...articleText.matchAll(pattern)].map(match => cleanCoasterpediaFormerName(match[1])
                    .replace(/^(?:the|a|an)\s+/i, '')
                    .replace(/\s+(?:was|were|is|are|would|will|could|should)\b.*$/i, '')
                    .trim())
            ).filter(name => isLikelyCoasterFormerName(name) && name.toLocaleLowerCase() !== currentName.toLocaleLowerCase()))];
        }

        function extractCoasterpediaNameSectionFormerNames(wikitext, currentName = '') {
            const names = [];
            const headingPattern = /^={2,}\s*(past names?|former names?|previous names?|previously known as|name history)\s*={2,}\s*$/gim;
            for (const heading of wikitext.matchAll(headingPattern)) {
                const contentStart = heading.index + heading[0].length;
                const sectionContent = wikitext
                    .slice(contentStart)
                    .split(/^={2,}.*$/m)[0]
                    .replace(/<!--[\s\S]*?-->/g, '')
                    .replace(/<ref\b[^>]*>[\s\S]*?<\/ref\s*>/gi, ' ')
                    .replace(/<ref\b[^>]*\/\s*>/gi, ' ')
                    .replace(/\{\{[^{}]*\}\}/g, ' ');

                sectionContent.split(/\r?\n/).forEach(line => {
                    const trimmed = line.trim();
                    if (!trimmed || /^(?:\{\||\|\}|\|-|!|caption\b)/i.test(trimmed)) return;
                    const isStructuredNameLine = /^[*#;|]/.test(trimmed) ||
                        /^(?:past name|former name|previous name|name)\s*[:=]/i.test(trimmed);
                    if (!isStructuredNameLine) return;
                    const cells = trimmed
                        .replace(/^[*#;:\s|!]+/, '')
                        .split(/\|\||!!/)
                        .map(cell => cell.replace(/^.*?\|/, '').trim())
                        .filter(Boolean);
                    (cells.length ? cells : [trimmed]).forEach(cell => {
                        const cleanCell = cleanCoasterpediaCell(cell);
                        if (/^(?:name|past name|former name|previous name|opened|closed|from|to|years?|dates?|status|source|notes?)$/i.test(cleanCell)) return;
                        if (/^(?:(?:18|19|20)\d{2}|present|current|operating|closed|removed|relocated|unknown)(?:\s*[-â€“â€”]\s*(?:(?:18|19|20)\d{2}|present|current))?$/i.test(cleanCell)) return;
                        names.push(...splitCoasterpediaFormerNames(cell));
                    });
                });
            }
            return [...new Set(names
                .map(cleanCoasterpediaFormerName)
                .filter(name => isLikelyCoasterFormerName(name) && name.toLocaleLowerCase() !== currentName.toLocaleLowerCase())
            )];
        }

        function extractCoasterpediaLinkedNames(value) {
            const linkedNames = [...value.matchAll(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g)]
                .flatMap(([, title, label]) => [title, label].filter(Boolean))
                .map(name => cleanCoasterpediaCell(name));
            return [...new Set([cleanCoasterpediaCell(value), ...linkedNames].filter(Boolean))];
        }

        function classifyRideLabel(value) {
            const normalized = cleanCoasterpediaCell(value).toLowerCase();
            if (/\bpowered\b/.test(normalized)) return 'Powered';
            if (/\balpine\b/.test(normalized)) return 'Alpine';
            if (/\bwater\b/.test(normalized)) return 'Water';
            return 'Roller';
        }

        function classifyCoasterpediaRide(rideClass) {
            const normalizedClass = cleanCoasterpediaCell(rideClass).toLowerCase();

            if (/\bpowered\b/.test(normalizedClass)) return 'Powered';
            if (/\balpine\b/.test(normalizedClass)) return 'Alpine';
            if (/\bwater\b/.test(normalizedClass)) return 'Water';
            return 'Real';
        }

        async function enrichCoasterRideDetails() {
            const pageTitles = [...new Set(currentParkRides.map(ride => ride.pageTitle))];
            if (pageTitles.length === 0) return;

            const redirectParams = new URLSearchParams({
                action: 'query',
                prop: 'redirects',
                titles: pageTitles.join('|'),
                rdlimit: 'max',
                redirects: 1,
                format: 'json',
                origin: '*'
            });
            const redirectResponse = await fetch(`https://coasterpedia.net/w/api.php?${redirectParams}`);
            if (!redirectResponse.ok) {
                throw new Error(`Coasterpedia page redirect lookup failed with status ${redirectResponse.status}`);
            }

            const redirectData = await redirectResponse.json();
            const canonicalTitleByRequestedTitle = new Map();
            Object.values(redirectData.query?.pages || {}).forEach(page => {
                canonicalTitleByRequestedTitle.set(page.title.toLocaleLowerCase(), page.title);
                (page.redirects || []).forEach(redirect => {
                    canonicalTitleByRequestedTitle.set(redirect.title.toLocaleLowerCase(), page.title);
                });
            });

            const articlesByTitle = new Map();
            const pageIdByTitle = new Map();
            for (let offset = 0; offset < pageTitles.length; offset += 50) {
                const articleParams = new URLSearchParams({
                    action: 'query',
                    prop: 'revisions',
                    titles: pageTitles.slice(offset, offset + 50).join('|'),
                    rvprop: 'content',
                    rvslots: 'main',
                    redirects: 1,
                    format: 'json',
                    origin: '*'
                });
                const articleResponse = await fetch(`https://coasterpedia.net/w/api.php?${articleParams}`);
                if (!articleResponse.ok) {
                    throw new Error(`Coasterpedia ride history lookup failed with status ${articleResponse.status}`);
                }
                const articleData = await articleResponse.json();
                Object.values(articleData.query?.pages || []).forEach(page => {
                    const wikitext = page.revisions?.[0]?.slots?.main?.['*'] || '';
                    if (page.pageid) pageIdByTitle.set(page.title.toLocaleLowerCase(), String(page.pageid));
                    articlesByTitle.set(
                        page.title.toLowerCase(),
                        extractCoasterpediaInfoboxDetails(wikitext, currentParkRides[0]?.parkName || '')
                    );
                });
            }

            currentParkRides.forEach(ride => {
                const canonicalTitle = canonicalTitleByRequestedTitle.get(ride.pageTitle.toLocaleLowerCase()) || ride.pageTitle;
                const details = articlesByTitle.get(canonicalTitle.toLocaleLowerCase());
                ride.pageTitle = canonicalTitle;
                ride.sourceRideId = canonicalTitle;
                ride.id = canonicalTitle;
                ride.coasterpediaPageId = pageIdByTitle.get(canonicalTitle.toLocaleLowerCase()) || ride.coasterpediaPageId || '';
                if (!details) return;
                ride.variant = details.changeClassification === 'reimagined'
                    ? 'ElementChange'
                    : details.hasRelocatedHistory
                        ? 'Relocated'
                        : 'Original';
                ride.hasReimaginedVersion = false;
                ride.hasRelocatedHistory = details.hasRelocatedHistory;
                ride.openingDate = details.openingDate;
                ride.closingDate = details.closingDate;
                if (details.tracks < 2) return;
                ride.trackCount = details.tracks;
                ride.trackNames = details.tracks === 2 && ride.name.toLowerCase() === 'gemini'
                    ? ['Red Track', 'Blue Track']
                    : Array.from({ length: details.tracks }, (_, index) => `Track ${index + 1}`);
            });

            collapseDuplicateCoasterPages();
            currentParkRides = currentParkRides.flatMap(ride => {
                if (!ride.trackNames) return [ride];
                return ride.trackNames.map((trackName, index) => ({
                    ...ride,
                    id: `${ride.id}::track-${index + 1}`,
                    sourceRideId: `${ride.sourceRideId}::track-${index + 1}`,
                    name: `${ride.name} (${trackName})`,
                    trackIndex: index + 1,
                    trackNames: undefined
                }));
            });
        }

        function collapseDuplicateCoasterPages() {
            const ridesByIdentity = new Map();
            currentParkRides.forEach(ride => {
                const identity = (ride.sourceRideId || ride.pageTitle || ride.id).toLocaleLowerCase();
                if (!ridesByIdentity.has(identity)) ridesByIdentity.set(identity, []);
                ridesByIdentity.get(identity).push(ride);
            });

            currentParkRides = [...ridesByIdentity.values()].map(rides => {
                if (rides.length === 1) {
                    rides[0].hasReimaginedVersion = false;
                    return rides[0];
                }

                const canonicalRide = rides.find(ride => ride.entityType === 'Operating coaster') ||
                    rides.find(ride => ride.entityType === 'Not operating coaster') || rides[0];
                if (rides.some(ride => ride.entityType === 'Operating coaster')) {
                    canonicalRide.entityType = 'Operating coaster';
                }
                canonicalRide.hasRelocatedHistory = rides.some(ride => ride.hasRelocatedHistory || ride.variant === 'Relocated');
                canonicalRide.variant = rides.some(ride => ride.variant === 'ElementChange')
                        ? 'ElementChange'
                        : canonicalRide.hasRelocatedHistory
                            ? 'Relocated'
                            : 'Original';
                canonicalRide.hasReimaginedVersion = false;
                return canonicalRide;
            });
        }

        function extractCoasterpediaInfoboxDetails(wikitext, selectedParkName = '') {
            const infobox = wikitext.match(/\{\{Infobox roller coaster\b([\s\S]*?)^\}\}/im)?.[1] || '';
            const infoboxName = cleanCoasterpediaCell(infobox.match(/^\|name\s*=\s*(.+)$/im)?.[1] || '');
            const nameRows = [...infobox.matchAll(/^\|name(\d*)\s*=\s*(.+)$/gim)];
            const hasFirstNumberedName = nameRows.some(match => match[1] === '1');
            const nameHistory = nameRows.map(match => {
                const index = Number(match[1] || 0);
                const historyIndex = index === 0 && !hasFirstNumberedName ? 1 : index;
                return {
                    index,
                    name: cleanCoasterpediaCell(match[2]),
                    from: cleanCoasterpediaCell(infobox.match(new RegExp(`^\\|name${historyIndex}From\\s*=\\s*(.+)$`, 'im'))?.[1] || ''),
                    to: cleanCoasterpediaCell(infobox.match(new RegExp(`^\\|name${historyIndex}To\\s*=\\s*(.+)$`, 'im'))?.[1] || '')
                };
            }).filter(item => item.name);
            const trackCount = infobox.match(/^\|tracks?\s*=\s*(\d+)/im);
            const pastInfoboxes = [...wikitext.matchAll(/\{\{\s*infobox past\b([\s\S]*?)^[ \t]*\}\}/gim)]
                .map(match => {
                    const pastInfobox = match[1];
                    const parkField = pastInfobox.match(/^[ \t]*\|park\s*=\s*(.+)$/im)?.[1] || '';
                    return {
                        park: cleanCoasterpediaCell(parkField),
                        parkNames: extractCoasterpediaLinkedNames(parkField),
                        opened: cleanCoasterpediaCell(pastInfobox.match(/^[ \t]*\|opened\s*=\s*(.+)$/im)?.[1] || ''),
                        wikitext: pastInfobox
                    };
                });
            const parkNameKey = selectedParkName.toLocaleLowerCase().replace(/[^a-z0-9]/g, '');
            const matchesSelectedPark = item => Boolean(parkNameKey && (
                item.park.toLocaleLowerCase().replace(/[^a-z0-9]/g, '') === parkNameKey ||
                item.parkNames.some(name => name.toLocaleLowerCase().replace(/[^a-z0-9]/g, '') === parkNameKey)
            ));
            const mainParkField = infobox.match(/^[ \t]*\|park\s*=\s*(.+)$/im)?.[1] || '';
            const mainPark = cleanCoasterpediaCell(mainParkField);
            const mainParkOpened = cleanCoasterpediaCell(infobox.match(/^[ \t]*\|opened\s*=\s*(.+)$/im)?.[1] || '');
            const mainParkKey = mainPark.toLocaleLowerCase().replace(/[^a-z0-9]/g, '');
            const currentName = nameHistory.find(item => /present|current/i.test(item.to))?.name ||
                nameHistory.at(-1)?.name ||
                infoboxName;
            const mainParkMatches = Boolean(parkNameKey &&
                (mainParkKey === parkNameKey || extractCoasterpediaLinkedNames(mainParkField)
                    .some(name => name.toLocaleLowerCase().replace(/[^a-z0-9]/g, '') === parkNameKey)));
            const pastParkInfobox = pastInfoboxes.find(item =>
                matchesSelectedPark(item)
            );
            const hasOperatedAt = opened => Boolean(opened) &&
                !/\b(?:never operated|never opened|not opened|planned|cancelled|canceled)\b/i.test(opened);
            const dateInfobox = mainParkMatches
                ? infobox
                : pastParkInfobox?.wikitext || '';
            const changeEvidence = getCoasterpediaChangeEvidence(wikitext);
            const changeClassification = classifyCoasterpediaChange(wikitext, infobox, nameHistory);
            const currentVersionStart = nameHistory.find(item => item.name === currentName)?.from || '';
            return {
                tracks: trackCount ? Number(trackCount[1]) : 1,
                openingDate: parseCoasterpediaDate(dateInfobox.match(/^[ \t]*\|opened\s*=\s*(.+)$/im)?.[1] || ''),
                closingDate: parseCoasterpediaDate(dateInfobox.match(/^[ \t]*\|closed\s*=\s*(.+)$/im)?.[1] || ''),
                changeClassification,
                changeEvidence: changeEvidence.find(item => item.type === 'major')?.text ||
                    changeEvidence.find(item => item.type === 'track')?.text ||
                    changeEvidence.find(item => item.type === 'structural')?.text ||
                    '',
                changeYear: changeClassification === 'reimagined'
                    ? currentVersionStart.match(/\b(?:18|19|20)\d{2}\b/)?.[0] ||
                        (changeEvidence.find(item => ['major', 'track', 'structural'].includes(item.type))?.text || '')
                            .match(/\b(?:18|19|20)\d{2}\b/)?.[0] ||
                        ''
                    : '',
                hasReimaginedVersion: changeClassification === 'reimagined' && nameHistory.length < 2,
                hasRelocatedHistory: mainParkMatches && hasOperatedAt(mainParkOpened) &&
                    pastInfoboxes.some(item => item.parkNames.length > 0 && !matchesSelectedPark(item) && hasOperatedAt(item.opened))
            };
        }

        function classifyCoasterpediaChange(wikitext, infobox, nameHistory) {
            const evidence = getCoasterpediaChangeEvidence(wikitext);
            const hasHistoricalSpecification = value =>
                /originally|\b(?:19|20)\d{2}\s*[-–]\s*(?:19|20)\d{2}\b/i.test(value) ||
                (/<br\s*\/?\s*>/i.test(value) && /\[\[[^\]]+\]\]/.test(value));
            const trackMaterial = infobox.match(/^\|track_material\s*=\s*(.+)$/im)?.[1] || '';
            const trackMaterialChange = hasHistoricalSpecification(trackMaterial) &&
                /\bwood(?:en)?\b/i.test(trackMaterial) && /\bsteel\b/i.test(trackMaterial);
            const rideTypeSpecificationChange = ['category1', 'category2', 'lift/launch'].some(field => {
                const value = infobox.match(new RegExp(`^\\|${field.replace('/', '\\/')}\\s*=\\s*(.+)$`, 'im'))?.[1] || '';
                return hasHistoricalSpecification(value);
            });
            const productHistory = infobox.match(/^\|product\s*=\s*(.+)$/im)?.[1] || '';
            const documentedRefurbishment = nameHistory.length > 1 &&
                /<br\s*\/?\s*>/i.test(productHistory) &&
                /\b(?:original|refurbishment|conversion)\b/i.test(productHistory);
            if (evidence.some(item => ['major', 'track', 'structural'].includes(item.type)) ||
                trackMaterialChange ||
                (rideTypeSpecificationChange && nameHistory.length > 1) ||
                documentedRefurbishment) {
                return 'reimagined';
            }
            if (evidence.some(item => item.type === 'minor')) {
                return 'minor';
            }
            return nameHistory.length > 1 ? 'uncertain' : 'none';
        }

        function getCoasterpediaChangeEvidence(wikitext) {
            const historySections = [...wikitext.matchAll(/^={2,}\s*history\s*={2,}\s*$/gim)]
                .map(match => {
                    const contentStart = match.index + match[0].length;
                    const sectionContent = wikitext.slice(contentStart);
                    const nextHeadingOffset = sectionContent.search(/^={2,}.*$/m);
                    return sectionContent.slice(0, nextHeadingOffset < 0 ? undefined : nextHeadingOffset);
                })
                .join('\n');
            const historyTableText = historySections
                .replace(/\[\[(?:File|Image):[^\r\n]*\]\]/gi, ' ')
                .replace(/\{\|[\s\S]*?\|\}/g, table => table
                    .replace(/^\{\|.*$/gm, ' ')
                    .replace(/^\|-.*$/gm, '\n')
                    .replace(/^\s*[|!]\s*/gm, ' ')
                    .replace(/\|\||!!/g, '\n')
                    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
                    .replace(/\[\[([^\]]+)\]\]/g, '$1')
                    .replace(/<ref\b[^>]*>[\s\S]*?<\/ref\s*>/gi, ' ')
                    .replace(/<ref\b[^>]*\/\s*>/gi, ' ')
                    .replace(/<[^>]+>/g, ' ')
                    .replace(/'{2,}/g, ' '));
            const articleText = wikitext
                .split(/^={2,}\s*(?:references|external links|further reading|notes)\s*={2,}\s*$/im)[0]
                .replace(/\[\[(?:File|Image):[^\r\n]*\]\]/gi, ' ')
                .concat(`\n${historyTableText}`)
                .replace(/<!--[\s\S]*?-->/g, '')
                .replace(/<ref\b[^>]*>[\s\S]*?<\/ref\s*>/gi, ' ')
                .replace(/<ref\b[^>]*\/\s*>/gi, ' ')
                .replace(/<[^>]+>/g, ' ')
                .replace(/\{\{[\s\S]*?\}\}/g, ' ')
                .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
                .replace(/\[\[([^\]]+)\]\]/g, '$1')
                .replace(/\[(?:https?:\/\/\S+)\s+([^\]]+)\]/g, '$1')
                .replace(/'{2,}/g, '')
                .replace(/^\s*[=|!].*$/gm, ' ');
            const sentences = articleText.split(/(?<=[.!?])\s+|\r?\n/)
                .map(sentence => sentence.replace(/\s+/g, ' ').trim())
                .filter(Boolean);

            return sentences.flatMap(sentence => {
                const normalized = sentence.toLocaleLowerCase();
                if (isMajorRideTransformation(normalized)) return [{ type: 'major', text: sentence }];
                if (isTrackMaterialChange(normalized)) return [{ type: 'track', text: sentence }];
                if (isStructuralRideChange(normalized)) return [{ type: 'structural', text: sentence }];
                if (/\b(?:renamed|name changed|new name|repainted|new colour scheme|new color scheme|new trains?|train was replaced|rethemed|new theme|theme change|retrack(?:ed|ing|s)?)\b/i.test(normalized)) {
                    return [{ type: 'minor', text: sentence }];
                }
                return [];
            });
        }

        function isStructuralRideChange(sentence) {
            const structuralNoun = '(?:track layout|track elements?|ride elements?|layout|drop|lift(?: hill)?|launch|loop|inversions?|course|coaster type)';
            const changeVerb = '(?:chang(?:e|ed|es|ing)|modif(?:y|ied|ies|ication)|alter(?:ed|ing)|reconfigur(?:ed|ing)|redesign(?:ed|ing)|replac(?:e|ed|es|ing)|remov(?:e|ed|es|ing)|add(?:ed|s|ing)|install(?:ed|ing)|convert(?:ed|s|ing)|reprofil(?:ed|e|ing))';
            return new RegExp(`\\b${structuralNoun}\\b\\s+(?:was\\s+|were\\s+|has\\s+been\\s+|have\\s+been\\s+)?${changeVerb}\\b`, 'i').test(sentence) ||
                new RegExp(`\\b${changeVerb}\\b\\s+(?:the\\s+|a\\s+)?${structuralNoun}\\b`, 'i').test(sentence) ||
                /\b(?:launch|lift hill|drop|inversions?)\b[^.!?\n]{0,80}\b(?:replaced|changed|modified|added|removed|installed|converted)\b/i.test(sentence) ||
                /\bconverted?\s+(?:from\b.{0,80}\bto\b|into\b.{0,60}\b(?:floorless|stand.?up|sit.?down|inverted|launched|wooden|steel))\b/i.test(sentence);
        }

        function isTrackMaterialChange(sentence) {
            return /\bwood(?:en)?\b/i.test(sentence) &&
                /\bsteel\b/i.test(sentence) &&
                /\b(?:replac(?:ed|ing)|convert(?:ed|ing)|chang(?:ed|ing)|switch(?:ed|ing)|from|to)\b/i.test(sentence);
        }

        function isRideTypeConversion(sentence) {
            const rideType = '(?:floorless|stand[ -]?up|sit[ -]?down|inverted|launched|wood(?:en)?|steel|flying|wing|suspended|spinning|pipeline|4d)';
            const changeAction = '(?:conversion|convert(?:ed|s|ing)?|switch(?:ed|es|ing)?|chang(?:e|ed|es|ing)|replac(?:e|ed|es|ing)|transform(?:ed|s|ing)|transition(?:ed|s|ing))';
            const typeTransition = new RegExp(`\\b${rideType}\\b[^.!?\\n]{0,100}\\b${changeAction}\\b[^.!?\\n]{0,100}\\b${rideType}\\b`, 'i');
            const transitionToType = new RegExp(`\\b${changeAction}\\b[^.!?\\n]{0,60}\\b(?:to|into)\\s+(?:an?\\s+)?\\b${rideType}\\b`, 'i');
            const typeConversion = new RegExp(`\\b${rideType}\\s+conversion\\b|\\bconversion\\b[^.!?\\n]{0,80}\\b${rideType}\\b`, 'i');
            return typeTransition.test(sentence) || transitionToType.test(sentence) || typeConversion.test(sentence);
        }

        function isMajorRideTransformation(sentence) {
            return /\b(?:virtual reality|vr)\s+(?:overlay|experience|conversion|version)\b/i.test(sentence) ||
                isRideTypeConversion(sentence) ||
                /\bfloorless\s+conversion\b/i.test(sentence) ||
                /\bconversion\b[^.!?\n]{0,100}\bfloorless\b/i.test(sentence) ||
                /\b(?:new|different|all[\s-]new|entirely new|completely new)\s+(?:ride\s+)?experience\b/i.test(sentence) ||
                /\b(?:experience|ride experience)\b[^.!?\n]{0,100}\b(?:(?:was|were|has been|have been)\s+)?(?:substantially\s+|completely\s+|significantly\s+)?(?:chang(?:e|ed|es|ing)|transform(?:ed|ation|ing)|replac(?:ed|ing)|reimagined)\b/i.test(sentence) ||
                /\b(?:chang(?:e|ed|es|ing)|transform(?:ed|ation|ing)|replac(?:ed|ing)|reimagined)\b[^.!?\n]{0,100}\b(?:the\s+)?(?:ride\s+)?experience\b/i.test(sentence) ||
                /\b(?:stand.?up|floorless)\b[^.!?\n]{0,120}\b(?:replac(?:e|ed|ing)|convert(?:ed|ing)?|chang(?:e|ed|ing)|switch(?:ed|ing)?)\b[^.!?\n]{0,80}\b(?:stand.?up|floorless)\b/i.test(sentence) ||
                /\bconvert(?:ed|ing)?\b[^.!?\n]{0,100}\b(?:from\s+)?(?:outdoor|indoor)\b[^.!?\n]{0,100}\b(?:to\s+)?(?:outdoor|indoor|inside|outside)\b/i.test(sentence) ||
                /\b(?:moved|relocated)\s+(?:the\s+)?(?:ride|coaster)?\s*(?:indoors|outdoors)\b/i.test(sentence) ||
                /\b(?:converted|changed)\b[^.!?\n]{0,60}\b(?:into|to)\s+(?:an?\s+)?(?:indoor|outdoor)\s+(?:ride|coaster)\b/i.test(sentence) ||
                /\b(?:renovat|transform|convert|rebuild)[^.!?\n]{0,120}\b(?:completely|fully)?\s*enclos(?:ed|ing)\b/i.test(sentence) ||
                /\b(?:completely|fully)\s+enclos(?:ed|ing)\s+(?:it|the ride|the coaster)\b/i.test(sentence) ||
                /\b(?:enclos(?:ed|ing))\b[^.!?\n]{0,120}\b(?:ride|coaster|building)\b[^.!?\n]{0,60}\b(?:convert(?:ed|s|ing)?|renovat(?:e|ed|ing)|transform(?:ed|ation|ing))\b/i.test(sentence) ||
                /\b(?:convert(?:ed|s|ing)?|renovat(?:e|ed|ing)|transform(?:ed|ation|ing))\b[^.!?\n]{0,120}\b(?:enclos(?:ed|ing)|enclosure)\b/i.test(sentence) ||
                /\b(?:convert(?:ed|s|ing)?|chang(?:ed|es|ing))\b[^.!?\n]{0,120}\b(?:into\s+)?(?:a\s+)?floorless(?:\s+coaster)?\b/i.test(sentence) ||
                /\b(?:convert(?:ed|s|ing)?|chang(?:ed|es|ing))\b[^.!?\n]{0,120}\bstand.?up\b[^.!?\n]{0,120}\bfloorless\b/i.test(sentence) ||
                /\b(?:converted|changed)\s+(?:from\s+)?(?:a\s+)?floorless\s+(?:coaster|ride)?\s*(?:to|into)\s+(?:a\s+)?stand.?up\b/i.test(sentence);
        }

        function parseCoasterpediaDate(value) {
            const dateText = cleanCoasterpediaCell(value).replace(/\s+/g, ' ').trim();
            return formatCoasterpediaYear(dateText);
        }

        function formatCoasterpediaYear(value = '') {
            return String(value).match(/\b(?:18|19|20)\d{2}\b/)?.[0] || '';
        }

        function renderRidesList() {
            const grid = document.getElementById('rides-grid');
            const searchVal = document.getElementById('ride-search-filter').value.toLowerCase().trim();

            const filtered = currentParkRides.filter(ride =>
                ride.name.toLocaleLowerCase().includes(searchVal)
            );
            const distinctRideIdsByName = new Map();
            currentParkRides.forEach(ride => {
                const nameKey = ride.name.toLocaleLowerCase();
                if (!distinctRideIdsByName.has(nameKey)) distinctRideIdsByName.set(nameKey, new Set());
                distinctRideIdsByName.get(nameKey).add(ride.sourceRideId || ride.id);
            });

            if (filtered.length === 0) {
                grid.innerHTML = `<div class="col-span-full text-center py-8 text-xs text-slate-500">No attractions found matching filter.</div>`;
                return;
            }

            let html = '';
            const sections = [
                { title: 'Operating', rides: filtered.filter(ride => ride.entityType === 'Operating coaster') },
                { title: 'Not operating', rides: filtered.filter(ride => ride.entityType === 'Not operating coaster') },
                { title: 'Defunct', rides: filtered.filter(ride => ride.entityType === 'Defunct coaster') }
            ];

            sections.forEach(section => {
                if (section.rides.length === 0) return;
                html += `
                    <details open class="group overflow-hidden rounded-xl border border-bordercolor bg-slate-900/40">
                        <summary class="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 hover:bg-slate-800/70">
                            <span class="text-xs font-bold uppercase tracking-wider text-slate-300">${section.title}<span class="ml-2 text-slate-500">${section.rides.length}</span></span>
                            <i class="fa-solid fa-chevron-down text-[10px] text-slate-500 transition-transform group-open:rotate-180"></i>
                        </summary>
                        <div class="divide-y divide-bordercolor/70 border-t border-bordercolor">
                `;
                section.rides.forEach(ride => {
                    const rideSourceId = ride.sourceRideId || ride.id;
                    const sameNameRideCount = distinctRideIdsByName.get(ride.name.toLocaleLowerCase())?.size || 1;
                    const displayedRideName = ride.name;
                    const displayedVariant = normalizeRideVariant(ride.variant);
                    const matchingParkEntries = coasterLog.filter(entry =>
                        (entry.parkName || entry.parkNameRidden || '').toLocaleLowerCase() === ride.parkName.toLocaleLowerCase() &&
                        (entry.coasterpediaRideId === rideSourceId ||
                            (entry.coasterName || '').toLocaleLowerCase() === ride.name.toLocaleLowerCase())
                    );
                    const entryMatchesDisplayedName = entry =>
                        (entry.coasterName || '').toLocaleLowerCase() === displayedRideName.toLocaleLowerCase();
                    const loggedEntry = matchingParkEntries.find(entry =>
                        entry.coasterpediaRideId === rideSourceId &&
                        rideEntryVariant(entry) === displayedVariant &&
                        entryMatchesDisplayedName(entry)
                    ) || matchingParkEntries.find(entry =>
                        entry.coasterpediaRideId === rideSourceId &&
                        rideEntryVariant(entry) === displayedVariant
                    ) || (sameNameRideCount === 1
                        ? matchingParkEntries.find(entry =>
                            !entry.coasterpediaRideId &&
                            rideEntryVariant(entry) === displayedVariant &&
                            entryMatchesDisplayedName(entry)
                        )
                        : null);
                    const reimaginedEntry = matchingParkEntries.find(entry =>
                        entry.coasterpediaRideId === rideSourceId &&
                        rideEntryVariant(entry) === 'ElementChange'
                    );
                    const articleUrl = `https://coasterpedia.net/wiki/${encodeURIComponent(ride.pageTitle.replace(/ /g, '_'))}`;
                    const rideType = ride.rideType || classifyRideLabel(ride.type || '');
                    const variant = displayedVariant;
                    const rideStatus = coasterStatusForRide(ride);
                    const disambiguatingOpeningDate = sameNameRideCount > 1 ? formatCoasterpediaYear(ride.openingDate) : '';
                    const disambiguatingClosingDate = sameNameRideCount > 1 ? formatCoasterpediaYear(ride.closingDate) : '';
                    const disambiguatingDateLabel = [disambiguatingOpeningDate, disambiguatingClosingDate].filter(Boolean).join('–');
                    const dateLabel = disambiguatingDateLabel
                        ? `<p class="mt-1 text-[11px] text-slate-500">Dates ${escapeHtml(disambiguatingDateLabel)}</p>`
                        : '';
                    const reimaginedAction = ride.hasReimaginedVersion
                        ? (reimaginedEntry
                            ? `<button data-entry-id="${escapeHtml(reimaginedEntry.id)}" data-current-name="${escapeHtml(ride.name)}" data-status="${rideStatus}" data-ride-type="${ride.type || 'Real'}" data-ride-id="${escapeHtml(rideSourceId)}" onclick="relogEntry(this.dataset.entryId, {name: this.dataset.currentName, status: this.dataset.status, type: this.dataset.rideType, variant: 'ElementChange', rideId: this.dataset.rideId})" class="rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-1.5 text-[11px] font-semibold text-violet-300 transition hover:bg-violet-500/20"><i class="fa-solid fa-rotate mr-1"></i>Relog Reimagined</button>`
                            : `<button data-park-name="${escapeHtml(ride.parkName)}" data-ride-name="${escapeHtml(ride.name)}" data-ride-type="${ride.type || 'Real'}" data-status="${rideStatus}" data-ride-id="${escapeHtml(rideSourceId)}" onclick="quickLogRide(this.dataset.parkName, this.dataset.rideName, 'ElementChange', this.dataset.rideType, this.dataset.status, this.dataset.rideId)" class="rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-1.5 text-[11px] font-semibold text-violet-300 transition hover:bg-violet-500/20"><i class="fa-solid fa-plus mr-1"></i>Log Reimagined</button>`)
                        : '';

                    html += `
                        <div class="flex flex-col gap-2 px-4 py-3 transition hover:bg-slate-800/40 sm:flex-row sm:items-center sm:justify-between">
                            <div class="min-w-0">
                                <div class="flex min-w-0 items-center gap-2 flex-wrap">
                                    <a href="${articleUrl}" target="_blank" rel="noopener noreferrer" class="truncate text-sm font-semibold text-slate-100 hover:text-brand-400">${escapeHtml(displayedRideName)}</a>
                                    <span class="rounded-md border border-brand-500/20 bg-brand-500/10 px-2 py-0.5 text-[10px] font-semibold text-brand-300">${escapeHtml(rideType)}</span>
                                    ${variant === 'ElementChange' || variant === 'Relocated'
                                        ? `<span class="rounded-md border ${variant === 'ElementChange' ? 'border-violet-500/20 bg-violet-500/10 text-violet-300' : 'border-amber-500/20 bg-amber-500/10 text-amber-300'} px-2 py-0.5 text-[10px] font-semibold">${escapeHtml(rideVariantLabel(variant))}</span>`
                                        : ''}
                                </div>
                                ${ride.hasReimaginedVersion ? `<p class="mt-1 text-[11px] text-violet-300">Coasterpedia history indicates a substantial ride change${ride.changeYear ? ` around ${escapeHtml(ride.changeYear)}` : ''}; you can log the reimagined version separately.</p>` : ''}
                                ${dateLabel}
                                ${sameNameRideCount > 1 && matchingParkEntries.some(entry => !entry.coasterpediaRideId)
                                    ? '<p class="mt-1 text-[10px] text-amber-400">Older same-name logs are not assigned to a specific ride. New logs will be distinguished automatically.</p>'
                                    : ''}
                            </div>
                            ${loggedEntry
                                ? `<div class="flex gap-2 self-end sm:self-auto">
                                    <button data-entry-id="${escapeHtml(loggedEntry.id)}" data-current-name="${escapeHtml(displayedRideName)}" data-status="${rideStatus}" data-ride-type="${ride.type || 'Real'}" data-variant="${variant}" data-ride-id="${escapeHtml(rideSourceId)}" data-opening-date="${escapeHtml(disambiguatingOpeningDate)}" data-closing-date="${escapeHtml(disambiguatingClosingDate)}" onclick="relogEntry(this.dataset.entryId, {name: this.dataset.currentName, status: this.dataset.status, type: this.dataset.rideType, variant: this.dataset.variant, rideId: this.dataset.rideId, openingDate: this.dataset.openingDate, closingDate: this.dataset.closingDate})" class="rounded-lg border border-brand-500/30 bg-brand-500/10 px-3 py-1.5 text-[11px] font-semibold text-brand-300 transition hover:bg-brand-500/20"><i class="fa-solid fa-rotate mr-1"></i>Relog</button>
                                    <button data-entry-id="${escapeHtml(loggedEntry.id)}" data-current-name="${escapeHtml(displayedRideName)}" onclick="openRideEntryEdit(this.dataset.entryId, this.dataset.currentName)" class="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-[11px] font-semibold text-rose-300 transition hover:bg-rose-500/20"><i class="fa-solid fa-pen mr-1"></i>Edit</button>
                                    <button data-entry-id="${escapeHtml(loggedEntry.id)}" onclick="deleteEntry(this.dataset.entryId)" class="rounded-lg border border-rose-500/30 bg-rose-500/10 px-2 py-1.5 text-[11px] text-rose-300 transition hover:bg-rose-500/20" title="Delete log entry" aria-label="Delete ${escapeHtml(displayedRideName)} log entry"><i class="fa-solid fa-trash"></i></button>
                                    ${reimaginedAction}
                                </div>`
                                : `<div class="flex flex-wrap gap-2 self-end sm:self-auto">
                                    <button data-park-name="${escapeHtml(ride.parkName)}" data-ride-name="${escapeHtml(displayedRideName)}" data-ride-type="${ride.type || 'Real'}" data-variant="${variant}" data-status="${rideStatus}" data-ride-id="${escapeHtml(rideSourceId)}" data-opening-date="${escapeHtml(disambiguatingOpeningDate)}" data-closing-date="${escapeHtml(disambiguatingClosingDate)}" onclick="quickLogRide(this.dataset.parkName, this.dataset.rideName, this.dataset.variant, this.dataset.rideType, this.dataset.status, this.dataset.rideId, this.dataset.openingDate, this.dataset.closingDate)" class="rounded-lg bg-brand-600 px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm transition hover:bg-brand-500"><i class="fa-solid fa-plus mr-1"></i>Log Coaster</button>
                                    ${reimaginedAction}
                                </div>`}
                        </div>
                    `;
                });
                html += '</div></details>';
            });

            grid.innerHTML = html;
        }

        function refreshVisibleSearchResults() {
            if (!document.getElementById('tab-search').classList.contains('hidden') && currentParkRides.length) {
                renderRidesList();
            }
        }

        function filterRidesList() {
            renderRidesList();
        }

        // Quick Log from Coasterpedia's park directory
        function quickLogRide(parkName, rideName, variant = 'Original', type = 'Real', status = 'Unknown', rideId = '', openingDate = '', closingDate = '') {
            if (!openAddModal()) return;
            document.getElementById('form-park-name').value = parkName;
            document.getElementById('form-coasterpedia-park-page-id').value = currentParkPageId;
            document.getElementById('form-park-ridden').value = '';
            document.getElementById('form-coaster-ridden').value = '';
            document.getElementById('form-coaster-type').value = type;
            document.getElementById('form-variant-type').value = normalizeRideVariant(variant);
            document.getElementById('form-ride-status').value = status;
            document.getElementById('form-coasterpedia-ride-id').value = rideId;
            document.getElementById('form-coasterpedia-opening-date').value = openingDate;
            document.getElementById('form-coasterpedia-closing-date').value = closingDate;
            const ride = currentParkRides.find(item =>
                (item.sourceRideId || item.id) === rideId
            );
            document.getElementById('form-coasterpedia-page-id').value = ride?.coasterpediaPageId || '';
            setRideNameVersionOptions(ride, rideName, type, variant);
            selectOfficialCoasterName(rideName);
        }

        function setRideNameVersionOptions(ride = null, fallbackName = '', fallbackType = 'Real', fallbackVariant = 'Original') {
            rideNameVersionOptions = new Map();
            const nameInput = document.getElementById('form-coaster-name');
            if (!nameInput) return;
            const names = [
                ...(ride ? [{ name: ride.name, variant: normalizeRideVariant(ride.variant) }] : []),
                ...(!ride && fallbackName ? [{ name: fallbackName, variant: normalizeRideVariant(fallbackVariant) }] : [])
            ];
            const options = [...new Map(names.map(option =>
                [option.name.toLocaleLowerCase(), option]
            )).values()];
            options.forEach(({ name, variant }) => {
                rideNameVersionOptions.set(name.toLocaleLowerCase(), {
                    type: ride?.type || fallbackType,
                    variant
                });
            });
            nameInput.disabled = Boolean(ride || document.getElementById('form-coasterpedia-ride-id').value);
        }

        function selectOfficialCoasterName(name = '') {
            const nameInput = document.getElementById('form-coaster-name');
            const selectedName = name || nameInput.value;
            nameInput.value = selectedName;
            updateRideClassificationFromName();
        }

        function updateRideClassificationFromName() {
            const option = rideNameVersionOptions.get(
                document.getElementById('form-coaster-name').value.trim().toLocaleLowerCase()
            );
            if (!option) return;
            document.getElementById('form-coaster-type').value = option.type;
            document.getElementById('form-variant-type').value = option.variant;
            markRelogVersionManuallySelected();
        }

        // Modal Handlers & Form Actions
        function openAddModal() {
            if (!requireSignedIn()) return false;
            relogSourceEntryId = '';
            relogInitialCoasterName = '';
            relogVersionManuallySelected = false;
            document.getElementById('form-duplicate-row').classList.remove('hidden');
            setRideNameVersionOptions();
            document.getElementById('modal-entry-title').innerHTML = `<i class="fa-solid fa-pen-to-square text-brand-500"></i> Add Log Entry`;
            document.getElementById('form-entry-submit').textContent = 'Save Ride Entry';
            document.getElementById('form-entry-id').value = '';
            document.getElementById('form-coasterpedia-ride-id').value = '';
            document.getElementById('form-coasterpedia-page-id').value = '';
            document.getElementById('form-coasterpedia-park-page-id').value = '';
            document.getElementById('form-coasterpedia-opening-date').value = '';
            document.getElementById('form-coasterpedia-closing-date').value = '';
            document.getElementById('form-park-name').value = '';
            document.getElementById('form-park-ridden').value = '';
            document.getElementById('form-coaster-name').value = '';
            document.getElementById('form-coaster-name').disabled = false;
            document.getElementById('form-coaster-ridden').value = '';
            document.getElementById('form-coaster-type').value = 'Real';
            document.getElementById('form-variant-type').value = 'Original';
            const now = new Date();
            document.getElementById('form-date-ridden').value = formatLocalDate(now);
            document.getElementById('form-time-ridden').value = formatLocalTime(now);
            document.getElementById('form-date-unknown').checked = false;
            document.getElementById('form-time-unknown').checked = false;
            toggleUnknownRideDate('date');
            toggleUnknownRideDate('time');
            document.getElementById('form-ride-status').value = 'Unknown';
            document.getElementById('form-ride-count').value = 1;
            document.getElementById('form-is-duplicate').checked = false;
            document.getElementById('form-notes').value = '';
            document.getElementById('modal-entry').classList.remove('hidden');
            return true;
        }

        function openEditModal(id) {
            if (!requireSignedIn()) return false;
            relogSourceEntryId = '';
            relogInitialCoasterName = '';
            relogVersionManuallySelected = false;
            document.getElementById('form-duplicate-row').classList.remove('hidden');
            const group = getCoasterLogGroups().find(item => item.entries.some(entry => entry.id === id));
            const entry = group?.entry;
            if (!entry) return false;

            document.getElementById('modal-entry-title').innerHTML = `<i class="fa-solid fa-pen-to-square text-brand-500"></i> Edit Log Entry`;
            document.getElementById('form-entry-submit').textContent = 'Save Ride Entry';
            document.getElementById('form-entry-id').value = entry.id;
            document.getElementById('form-coasterpedia-ride-id').value = entry.coasterpediaRideId || '';
            document.getElementById('form-coasterpedia-page-id').value = entry.coasterpediaPageId || '';
            document.getElementById('form-coasterpedia-park-page-id').value = entry.coasterpediaParkPageId || '';
            document.getElementById('form-coasterpedia-opening-date').value = entry.coasterpediaOpeningDate || '';
            document.getElementById('form-coasterpedia-closing-date').value = entry.coasterpediaClosingDate || '';
            document.getElementById('form-park-name').value = entry.parkName || '';
            document.getElementById('form-park-ridden').value = entry.parkNameRidden || '';
            document.getElementById('form-coaster-name').value = entry.coasterName || '';
            document.getElementById('form-coaster-ridden').value = entry.coasterNameRidden !== entry.coasterName
                ? entry.coasterNameRidden || ''
                : '';
            document.getElementById('form-coaster-type').value = entry.type || 'Real';
            document.getElementById('form-variant-type').value = rideEntryVariant(entry);
            document.getElementById('form-date-ridden').value = entry.dateRidden || '';
            document.getElementById('form-time-ridden').value = entry.timeRidden || '';
            document.getElementById('form-date-unknown').checked = entry.unknownDate === true;
            document.getElementById('form-time-unknown').checked = entry.unknownTime === true;
            toggleUnknownRideDate('date');
            toggleUnknownRideDate('time');
            document.getElementById('form-ride-status').value = normalizeCoasterStatus(entry.rideStatus || 'Unknown');
            document.getElementById('form-ride-count').value = group.rideCount;
            document.getElementById('form-is-duplicate').checked =
                group.entries.some(item => item.isDuplicate === true);
            document.getElementById('form-notes').value = entry.notes || '';
            const matchingRide = currentParkRides.find(ride =>
                (ride.sourceRideId || ride.id) === entry.coasterpediaRideId
            );
            setRideNameVersionOptions(
                matchingRide,
                entry.coasterName || '',
                entry.type || 'Real',
                rideEntryVariant(entry)
            );
            selectOfficialCoasterName(entry.coasterName || '');
            if (entry.coasterName && !rideNameVersionOptions.has(entry.coasterName.toLocaleLowerCase())) {
                document.getElementById('form-coaster-name').value = entry.coasterName;
            }

            document.getElementById('modal-entry').classList.remove('hidden');
            return true;
        }

        function relogEntry(id, rideDetails = null) {
            if (!requireSignedIn()) return;
            const group = getCoasterLogGroups().find(item => item.entries.some(entry => entry.id === id));
            if (!group || !openEditModal(id)) return;

            relogSourceEntryId = id;
            const now = new Date();
            if (rideDetails) {
                const ride = currentParkRides.find(item =>
                    (item.sourceRideId || item.id) === rideDetails.rideId
                );
                document.getElementById('form-coasterpedia-page-id').value =
                    ride?.coasterpediaPageId || group.entry.coasterpediaPageId || '';
                const editedParkName = document.getElementById('form-park-name').value.trim();
                const selectedParkPageId = editedParkName.toLocaleLowerCase() === currentParkTitle.toLocaleLowerCase()
                    ? currentParkPageId
                    : '';
                document.getElementById('form-coasterpedia-park-page-id').value =
                    group.entry.coasterpediaParkPageId || selectedParkPageId;
                setRideNameVersionOptions(
                    ride,
                    rideDetails.name,
                    rideDetails.type,
                    rideDetails.variant
                );
                selectOfficialCoasterName(rideDetails.name);
                document.getElementById('form-ride-status').value = rideDetails.status;
                document.getElementById('form-coaster-type').value = rideDetails.type;
                document.getElementById('form-variant-type').value = normalizeRideVariant(rideDetails.variant);
                document.getElementById('form-coasterpedia-ride-id').value =
                    rideDetails.rideId || group.entry.coasterpediaRideId || '';
                document.getElementById('form-coasterpedia-opening-date').value =
                    rideDetails.openingDate || group.entry.coasterpediaOpeningDate || '';
                document.getElementById('form-coasterpedia-closing-date').value =
                    rideDetails.closingDate || group.entry.coasterpediaClosingDate || '';
            }
            document.getElementById('modal-entry-title').innerHTML = `<i class="fa-solid fa-rotate text-brand-500"></i> Relog Ride Entry`;
            document.getElementById('form-entry-submit').textContent = 'Save Relog';
            document.getElementById('form-date-ridden').value = formatLocalDate(now);
            document.getElementById('form-time-ridden').value = formatLocalTime(now);
            document.getElementById('form-date-unknown').checked = false;
            document.getElementById('form-time-unknown').checked = false;
            toggleUnknownRideDate('date');
            toggleUnknownRideDate('time');
            document.getElementById('form-ride-count').value = group.rideCount;
            relogInitialCoasterName = document.getElementById('form-coaster-name').value;
            relogInitialVariant = document.getElementById('form-variant-type').value;
            relogVersionManuallySelected = false;
        }

        function updateRelogNameVariant() {
            if (!relogSourceEntryId || relogVersionManuallySelected) return;
            const currentName = document.getElementById('form-coaster-name').value.trim();
            const versionInput = document.getElementById('form-variant-type');
            if (currentName === relogInitialCoasterName) {
                versionInput.value = relogInitialVariant;
            } else if (rideNameVersionOptions.has(currentName.toLocaleLowerCase())) {
                versionInput.value = rideNameVersionOptions.get(currentName.toLocaleLowerCase()).variant;
            } else if (versionInput.value === 'ElementChange') {
                versionInput.value = 'Original';
            }
        }

        function markRelogVersionManuallySelected() {
            if (relogSourceEntryId) relogVersionManuallySelected = true;
        }

        function formatLocalDate(date) {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        }

        function formatLocalTime(date) {
            return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
        }

        function formatRideDateTime(entry) {
            const date = entry.unknownDate ? '' : entry.dateRidden || '';
            const time = entry.unknownTime ? '' : entry.timeRidden || '';
            if (date && time) return `${date} ${time}`;
            if (date || time) return date || time;
            if (entry.unknownDate || entry.unknownTime) return '';
            if (entry.loggedAt) return new Date(entry.loggedAt).toLocaleString();
            return '';
        }

        function rideDateValue(entry) {
            if (entry.dateRidden) {
                return new Date(`${entry.dateRidden}T${entry.timeRidden || '00:00'}`).getTime();
            }
            return entry.loggedAt ? new Date(entry.loggedAt).getTime() : 0;
        }

        function openRideEntryEdit(id, currentCoasterName) {
            if (!openEditModal(id)) return;
            const coasterNameInput = document.getElementById('form-coaster-name');
            if (coasterNameInput.value !== currentCoasterName) {
                coasterNameInput.value = currentCoasterName;
            }
        }

        function closeEntryModal() {
            document.getElementById('modal-entry').classList.add('hidden');
            relogSourceEntryId = '';
            relogInitialCoasterName = '';
            relogInitialVariant = 'Original';
            relogVersionManuallySelected = false;
        }

        function toggleUnknownRideDate(field) {
            const isDate = field === 'date';
            const checkbox = document.getElementById(isDate ? 'form-date-unknown' : 'form-time-unknown');
            const input = document.getElementById(isDate ? 'form-date-ridden' : 'form-time-ridden');
            input.disabled = checkbox.checked;
            if (checkbox.checked) input.value = '';
        }

        function saveEntry(e) {
            e.preventDefault();
            if (!requireSignedIn()) return;
            const id = document.getElementById('form-entry-id').value;
            const parkName = document.getElementById('form-park-name').value.trim();
            const parkNameRidden = document.getElementById('form-park-ridden').value.trim();
            const coasterName = document.getElementById('form-coaster-name').value.trim();
            let coasterNameRidden = document.getElementById('form-coaster-ridden').value.trim();
            const type = document.getElementById('form-coaster-type').value;
            const variant = document.getElementById('form-variant-type').value;
            const dateRidden = document.getElementById('form-date-ridden').value;
            const timeRidden = document.getElementById('form-time-ridden').value;
            const unknownDate = document.getElementById('form-date-unknown').checked;
            const unknownTime = document.getElementById('form-time-unknown').checked;
            const rideStatus = normalizeCoasterStatus(document.getElementById('form-ride-status').value);
            const rideCount = parseInt(document.getElementById('form-ride-count').value) || 1;
            const isDuplicate = document.getElementById('form-is-duplicate').checked;
            const notes = document.getElementById('form-notes').value.trim();
            const coasterpediaRideId = document.getElementById('form-coasterpedia-ride-id').value;
            const coasterpediaPageId = document.getElementById('form-coasterpedia-page-id').value;
            const coasterpediaParkPageId = document.getElementById('form-coasterpedia-park-page-id').value;
            const coasterpediaOpeningDate = document.getElementById('form-coasterpedia-opening-date').value;
            const coasterpediaClosingDate = document.getElementById('form-coasterpedia-closing-date').value;
            const savedAt = new Date();

            if (relogSourceEntryId) {
                const sourceGroup = getCoasterLogGroups().find(group =>
                    group.entries.some(entry => entry.id === relogSourceEntryId)
                );
                if (!sourceGroup) {
                    relogSourceEntryId = '';
                    showToast('The original log entry could not be found. Please try relogging again.', 'error');
                    return;
                }
                const reloggedEntry = {
                    ...sourceGroup.entry,
                    parkName,
                    parkNameRidden,
                    coasterName,
                    coasterNameRidden,
                    coasterpediaRideId,
                    coasterpediaPageId,
                    coasterpediaParkPageId,
                    coasterpediaOpeningDate,
                    coasterpediaClosingDate,
                    type,
                    variant,
                    dateRidden,
                    timeRidden,
                    unknownDate,
                    unknownTime,
                    rideStatus,
                    rideCount: sourceGroup.rideCount + 1,
                    notes,
                    isDuplicate,
                    loggedAt: savedAt.toISOString()
                };
                const isSameRide = rideIdentityKey(reloggedEntry) === sourceGroup.key;
                if (isSameRide) {
                    const sourceIds = new Set(sourceGroup.entries.map(entry => entry.id));
                    coasterLog = coasterLog.filter(entry => !sourceIds.has(entry.id));
                    reloggedEntry.id = sourceGroup.entry.id;
                    reloggedEntry.rideCount = sourceGroup.rideCount + 1;
                    coasterLog.unshift(reloggedEntry);
                    showToast('Coaster relogged', 'success');
                } else {
                    reloggedEntry.id = 'entry_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
                    reloggedEntry.rideCount = 1;
                    coasterLog.unshift(reloggedEntry);
                    showToast('New ride version added to your log', 'success');
                }
                relogSourceEntryId = '';
                saveToLocalStorage();
                updateStatsAndCounters();
                renderLogbook();
                closeEntryModal();
                if (!document.getElementById('park-breakdown').classList.contains('hidden')) renderParkBreakdown();
                if (!document.getElementById('tab-search').classList.contains('hidden')) renderRidesList();
                return;
            }

            if (id) {
                // Edit existing
                const group = getCoasterLogGroups().find(item => item.entries.some(entry => entry.id === id));
                const index = coasterLog.findIndex(e => e.id === id);
                if (index !== -1) {
                    coasterLog[index] = {
                        ...coasterLog[index],
                        parkName,
                        parkNameRidden,
                        coasterName,
                        coasterNameRidden,
                        coasterpediaRideId,
                        coasterpediaPageId,
                        coasterpediaParkPageId,
                        coasterpediaOpeningDate,
                        coasterpediaClosingDate,
                        type,
                        variant,
                        dateRidden,
                        timeRidden,
                        unknownDate,
                        unknownTime,
                        rideStatus,
                        rideCount,
                        notes,
                        isDuplicate
                    };
                    if (group?.entries.length > 1) {
                        const otherIds = new Set(group.entries.filter(entry => entry.id !== id).map(entry => entry.id));
                        coasterLog = coasterLog.filter(entry => !otherIds.has(entry.id));
                    }
                    showToast('Log entry updated', 'success');
                }
            } else {
                // New entry
                const newEntry = {
                    id: 'entry_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
                    parkName,
                    parkNameRidden,
                    coasterName,
                    coasterNameRidden,
                    coasterpediaRideId,
                    coasterpediaPageId,
                    coasterpediaParkPageId,
                    coasterpediaOpeningDate,
                    coasterpediaClosingDate,
                    type,
                    variant,
                    dateRidden,
                    timeRidden,
                    unknownDate,
                    unknownTime,
                    rideStatus,
                    loggedAt: new Date().toISOString(),
                    isDuplicate,
                    rideCount,
                    notes
                };
                coasterLog.unshift(newEntry);
                showToast('Coaster added to logbook!', 'success');
            }

            saveToLocalStorage();
            updateStatsAndCounters();
            renderLogbook();
            closeEntryModal();
            if (!document.getElementById('park-breakdown').classList.contains('hidden')) renderParkBreakdown();

            // Refresh search list if visible
            if (!document.getElementById('tab-search').classList.contains('hidden')) {
                renderRidesList();
            }
        }

        function deleteEntry(id) {
            if (!requireSignedIn()) return;
            if (!confirm('Are you sure you want to remove this coaster entry?')) return;
            const group = getCoasterLogGroups().find(item => item.entries.some(entry => entry.id === id));
            const groupIds = new Set((group?.entries || []).map(entry => entry.id));
            coasterLog = coasterLog.filter(entry => !groupIds.has(entry.id));
            saveToLocalStorage();
            updateStatsAndCounters();
            renderLogbook();
            if (!document.getElementById('park-breakdown').classList.contains('hidden')) renderParkBreakdown();
            showToast('Entry removed from logbook', 'info');

            refreshVisibleSearchResults();
        }

        // Settings Modal Handlers
        function openSettingsModal() {
            if (!requireSignedIn()) return;
            document.getElementById('modal-settings').classList.remove('hidden');
        }

        function closeSettingsModal() {
            document.getElementById('modal-settings').classList.add('hidden');
        }

        function saveRules() {
            if (!requireSignedIn()) {
                syncCreditRuleInputs();
                return;
            }
            creditRules = {
                powered: document.getElementById('rule-powered').checked,
                alpine: document.getElementById('rule-alpine').checked,
                water: document.getElementById('rule-water').checked,
                elementChange: document.getElementById('rule-element-change').checked,
                relocated: document.getElementById('rule-relocated').checked,
                countRelogs: document.getElementById('rule-count-relogs').checked
            };
            saveToLocalStorage();
            updateStatsAndCounters();
        }

        // Import & Export Handlers
        function exportData(format) {
            if (!requireSignedIn()) return;
            if (coasterLog.length === 0) {
                showToast('No data to export', 'error');
                return;
            }

            if (format === 'json') {
                const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(coasterLog, null, 2));
                const downloadAnchor = document.createElement('a');
                downloadAnchor.setAttribute("href", dataStr);
                downloadAnchor.setAttribute("download", `track_record_${new Date().toISOString().slice(0,10)}.json`);
                document.body.appendChild(downloadAnchor);
                downloadAnchor.click();
                downloadAnchor.remove();
                showToast('Exported JSON successfully', 'success');
            }
        }

        function requestImportData() {
            if (!requireSignedIn()) return;
            document.getElementById('import-file-input').click();
        }

        function importData(event) {
            if (!requireSignedIn()) {
                event.target.value = '';
                return;
            }
            const file = event.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = function(e) {
                try {
                    const content = e.target.result;
                    let importedEntries = [];

                    if (file.name.endsWith('.json')) {
                        importedEntries = JSON.parse(content);
                    } else if (file.name.endsWith('.csv')) {
                        // Simple CSV parser
                        const lines = content.split('\n');
                        for (let i = 1; i < lines.length; i++) {
                            const line = lines[i].trim();
                            if (!line) continue;
                            const cols = line.split(',');
                            if (cols.length >= 2) {
                                importedEntries.push({
                                    id: 'import_' + Date.now() + '_' + i,
                                    parkName: cols[0]?.replace(/"/g, '') || 'Imported Park',
                                    parkNameRidden: cols[0]?.replace(/"/g, '') || 'Imported Park',
                                    coasterName: cols[1]?.replace(/"/g, '') || 'Imported Coaster',
                                    coasterNameRidden: cols[1]?.replace(/"/g, '') || 'Imported Coaster',
                                    type: cols[2]?.replace(/"/g, '') || 'Real',
                                    variant: cols[3]?.replace(/"/g, '') || 'Original',
                                    dateRidden: cols[4]?.replace(/"/g, '') || '',
                                    rideCount: parseInt(cols[5]) || 1,
                                    notes: cols[6]?.replace(/"/g, '') || ''
                                });
                            }
                        }
                    }

                    if (Array.isArray(importedEntries) && importedEntries.length > 0) {
                        coasterLog = [...coasterLog, ...importedEntries];
                        saveToLocalStorage();
                        updateStatsAndCounters();
                        renderLogbook();
                        showToast(`Successfully imported ${importedEntries.length} entries!`, 'success');
                    } else {
                        showToast('Invalid or empty import file format', 'error');
                    }
                } catch (err) {
                    console.error('Import error:', err);
                    showToast('Failed to parse import file', 'error');
                }
            };
            reader.readAsText(file);
            event.target.value = '';
        }

        // Custom Toast Notification System
        function showToast(message, type = 'info') {
            const container = document.getElementById('toast-container');
            const toast = document.createElement('div');

            let icon = 'fa-info-circle';
            let colors = 'bg-slate-800 text-slate-200 border-bordercolor';

            if (type === 'success') {
                icon = 'fa-circle-check';
                colors = 'bg-brand-900/90 text-brand-200 border-brand-500/40';
            } else if (type === 'error') {
                icon = 'fa-circle-exclamation';
                colors = 'bg-rose-950/90 text-rose-200 border-rose-500/40';
            }

            toast.className = `px-4 py-2.5 rounded-xl border text-xs shadow-xl flex items-center gap-2 transition-all duration-300 transform translate-y-2 opacity-0 pointer-events-auto ${colors}`;
            toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${escapeHtml(message)}</span>`;

            container.appendChild(toast);

            setTimeout(() => {
                toast.classList.remove('translate-y-2', 'opacity-0');
            }, 10);

            setTimeout(() => {
                toast.classList.add('opacity-0', 'translate-y-2');
                setTimeout(() => toast.remove(), 300);
            }, 3000);
        }

        // HTML Escape Helper
        function escapeHtml(str) {
            if (!str) return '';
            return String(str)
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#039;");
        }
    
