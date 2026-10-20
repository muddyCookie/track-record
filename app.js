
        // State variables
        let coasterLog = [];
        let coasterpediaSearchResults = [];
        let coasterpediaParkIndex = [];
        let coasterpediaParkIndexPromise = null;
        let currentParkRides = [];
        let currentParkTitle = '';
        let searchDebounceTimer;
        let searchRequestId = 0;
        let parkSearchCandidates = [];
        let parkSearchCursor = 0;
        let parkSearchLoading = false;
        let parkSearchLoadingRequestId = 0;
        let parkValidationAbortController = null;
        let activeDashboardFilter = null;
        let currentUser = null;
        let authMode = 'signin';
        let authLoadRequestId = 0;
        let authStateSubscription = null;
        let cloudDataSubscription = null;

        // Credit Calculation Rules Defaults
        const DEFAULT_CREDIT_RULES = {
            powered: true,
            alpine: true,
            water: true,
            experienceChange: false,
            elementChange: true,
            relocated: true
        };
        let creditRules = { ...DEFAULT_CREDIT_RULES };

        // Initialize Application on Load
        window.onload = async function() {
            try {
                await window.trackRecordCloud.ready;
                await handleFirebaseAuthState(window.trackRecordCloud.getCurrentUser());
                authStateSubscription = window.trackRecordCloud.onAuthStateChanged(user => {
                    if (user?.uid === currentUser?.uid || (!user && !currentUser)) return;
                    handleFirebaseAuthState(user).catch(error => {
                        console.error('Failed to load account data:', error);
                        showAuthMessage(`Could not load your account data: ${error.message}`, 'error');
                    });
                });
            } catch (error) {
                console.error('Firebase initialization failed:', error);
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
            cloudDataSubscription?.();
            cloudDataSubscription = null;
            appContent.classList.add('hidden');
            authScreen.classList.remove('hidden');
            authScreen.classList.add('flex');
            document.getElementById('auth-submit').disabled = true;
            document.getElementById('continue-as-guest').classList.add('hidden');
            showAuthMessage('Loading your private coaster log...', 'status');

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
                authScreen.classList.remove('flex');
                appContent.classList.remove('hidden');
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
                }, error => {
                    console.error('Firebase live sync failed:', error);
                    showToast(`Live sync stopped: ${error.message}`, 'error');
                });
                refreshLoggedRideStatuses();
            } catch (error) {
                if (requestId !== authLoadRequestId) return;
                currentUser = null;
                appContent.classList.remove('hidden');
                document.getElementById('auth-submit').disabled = false;
                document.getElementById('auth-retry').classList.remove('hidden');
                document.getElementById('auth-signout').classList.remove('hidden');
                document.getElementById('continue-as-guest').classList.remove('hidden');
                updateAccountAction();
                showAuthMessage(`Could not load your cloud data: ${error.message}`, 'error');
            }
        }

        function updateAccountAction() {
            const signedIn = Boolean(currentUser);
            document.getElementById('account-action-label').innerText = signedIn ? 'Sign out' : 'Sign in';
            document.getElementById('account-action-icon').className = signedIn
                ? 'fa-solid fa-arrow-right-from-bracket'
                : 'fa-solid fa-arrow-right-to-bracket';
            document.getElementById('account-action').title = signedIn ? 'Sign out' : 'Sign in';
        }

        function openAuthDialog(message = '') {
            const authScreen = document.getElementById('auth-screen');
            authScreen.classList.remove('hidden');
            authScreen.classList.add('flex');
            document.getElementById('auth-submit').disabled = false;
            document.getElementById('continue-as-guest').classList.toggle('hidden', Boolean(currentUser));
            showAuthMessage(message, 'status');
        }

        function closeAuthDialog() {
            if (currentUser) return;
            document.getElementById('auth-screen').classList.add('hidden');
            document.getElementById('auth-screen').classList.remove('flex');
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
            document.getElementById('rule-experience-change').checked = creditRules.experienceChange;
            document.getElementById('rule-element-change').checked = creditRules.elementChange;
            document.getElementById('rule-relocated').checked = creditRules.relocated;
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
            document.getElementById('auth-submit').innerText = signUp ? 'Create account' : 'Sign in';
            document.getElementById('auth-mode-toggle').innerText = signUp ? 'I already have an account' : 'Create an account';
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
            return {
                powered: typeof saved.powered === 'boolean' ? saved.powered : creditRules.powered,
                alpine: typeof saved.alpine === 'boolean' ? saved.alpine : creditRules.alpine,
                water: typeof saved.water === 'boolean' ? saved.water : creditRules.water,
                experienceChange: typeof saved.experienceChange === 'boolean'
                    ? saved.experienceChange
                    : Boolean(saved.vr || saved.indoor),
                elementChange: typeof saved.elementChange === 'boolean'
                    ? saved.elementChange
                    : oldOverhaul || oldDrive,
                relocated: typeof saved.relocated === 'boolean' ? saved.relocated : creditRules.relocated
            };
        }

        function normalizeRideVariant(variant = 'Original') {
            if (!variant) return 'Original';
            if (['VR', 'Indoor'].includes(variant)) return 'ExperienceChange';
            if (['Overhaul', 'DriveChange'].includes(variant)) return 'ElementChange';
            if (variant === 'Defunct') return 'Original';
            return variant;
        }

        function rideVariantLabel(variant) {
            const labels = {
                ExperienceChange: 'Experience Change',
                ElementChange: 'Element Change',
                Relocated: 'Relocated',
                Defunct: 'Defunct / Retracked'
            };
            const normalizedVariant = normalizeRideVariant(variant);
            return labels[normalizedVariant] || normalizedVariant;
        }

        // Stats & Calculation Rules Logic
        function updateStatsAndCounters() {
            let realCount = 0;
            let poweredCount = 0;
            let alpineCount = 0;
            let waterCount = 0;
            let duplicateCount = 0;
            let calculatedTotal = 0;
            
            // Unique Parks Set
            const uniqueParks = new Set();

            coasterLog.forEach(entry => {
                const type = entry.type || 'Real';
                const variant = normalizeRideVariant(entry.variant);

                // Count unique park names (prefer official, fallback to ridden name)
                const parkKey = (entry.parkName || entry.parkNameRidden || '').trim().toLowerCase();
                if (parkKey) uniqueParks.add(parkKey);

                // Type counts
                if (type === 'Real') realCount++;
                else if (type === 'Powered') poweredCount++;
                else if (type === 'Alpine') alpineCount++;
                else if (type === 'Water') waterCount++;

                // Ride variations count
                if (['ExperienceChange', 'ElementChange', 'Relocated'].includes(variant)) {
                    duplicateCount++;
                }

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
                if (variant === 'ExperienceChange' && !creditRules.experienceChange) isCredit = false;
                if (variant === 'ElementChange' && !creditRules.elementChange) isCredit = false;
                if (variant === 'Relocated' && !creditRules.relocated) isCredit = false;

                if (isCredit) {
                    calculatedTotal++;
                }
            });

            // Update DOM Counter Cards
            document.getElementById('stat-real').innerText = realCount;
            document.getElementById('stat-powered').innerText = poweredCount;
            document.getElementById('stat-alpine').innerText = alpineCount;
            document.getElementById('stat-water').innerText = waterCount;
            document.getElementById('stat-duplicates').innerText = duplicateCount;
            document.getElementById('stat-parks').innerText = uniqueParks.size;
            document.getElementById('stat-total').innerText = calculatedTotal;
            document.getElementById('log-count-badge').innerText = `${coasterLog.length} Rides Logged`;
            syncDashboardCardStyles();
        }

        function isEntryCredit(entry) {
            const type = entry.type || 'Real';
            const variant = normalizeRideVariant(entry.variant);
            let isCredit = type === 'Real' ||
                (type === 'Powered' && creditRules.powered) ||
                (type === 'Alpine' && creditRules.alpine) ||
                (type === 'Water' && creditRules.water);

            if (variant === 'ExperienceChange' && !creditRules.experienceChange) isCredit = false;
            if (variant === 'ElementChange' && !creditRules.elementChange) isCredit = false;
            if (variant === 'Relocated' && !creditRules.relocated) isCredit = false;
            return isCredit;
        }

        function applyDashboardFilter(kind, value = null) {
            document.getElementById('park-breakdown').classList.add('hidden');
            const isSameFilter = activeDashboardFilter?.kind === kind &&
                (kind !== 'type' || activeDashboardFilter.value === value) &&
                (kind !== 'ride' || (
                    activeDashboardFilter.value.park.toLowerCase() === value.park.toLowerCase() &&
                    activeDashboardFilter.value.coaster.toLowerCase() === value.coaster.toLowerCase()
                ));
            activeDashboardFilter = isSameFilter ? null : { kind, value };
            syncDashboardCardStyles();
            renderLogbook();
            document.getElementById('log-list').scrollIntoView({ behavior: 'smooth', block: 'start' });
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
            coasterLog.forEach(entry => {
                const park = (entry.parkName || entry.parkNameRidden || '').trim();
                if (!park) return;
                const key = park.toLocaleLowerCase();
                if (!parks.has(key)) parks.set(key, { name: park, entries: [] });
                parks.get(key).entries.push(entry);
            });

            if (!parks.size) {
                panel.innerHTML = '<p class="text-sm text-slate-400">No parks recorded yet. Standalone rides without a park are not included.</p>';
                return;
            }

            panel.innerHTML = `<div class="mb-3 flex items-center justify-between">
                <h3 class="text-sm font-semibold text-white">Parks Visited</h3>
                <button type="button" onclick="closeParkBreakdown()" class="text-xs text-slate-400 hover:text-white">Close</button>
            </div><div class="space-y-2">${[...parks.values()].sort((a, b) => a.name.localeCompare(b.name)).map(park => `
                <details class="overflow-hidden rounded-xl border border-bordercolor bg-slate-900/50">
                    <summary class="flex cursor-pointer items-center justify-between px-4 py-3 text-sm font-medium text-slate-200 hover:bg-slate-800">
                        <span>${escapeHtml(park.name)}</span><span class="text-xs text-slate-500">${park.entries.length} logged ${park.entries.length === 1 ? 'ride' : 'rides'}</span>
                    </summary>
                    <div class="border-t border-bordercolor divide-y divide-bordercolor/70">
                        ${park.entries.slice().sort((a, b) => (a.coasterName || '').localeCompare(b.coasterName || '')).map(entry => `
                            <button type="button" data-park="${escapeHtml(park.name)}" data-coaster="${escapeHtml(entry.coasterName || '')}" onclick="applyDashboardFilter('ride', {park: this.dataset.park, coaster: this.dataset.coaster})" class="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-xs hover:bg-slate-800">
                                <span class="text-slate-200">${escapeHtml(entry.coasterName || 'Unnamed coaster')}</span>
                                <span class="text-slate-500">${escapeHtml(entry.rideStatus || 'Status unknown')}</span>
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

            // Filter entries
            let filtered = coasterLog.filter(entry => {
                const matchSearch = (entry.coasterName || '').toLowerCase().includes(searchVal) ||
                                    (entry.coasterNameRidden || '').toLowerCase().includes(searchVal) ||
                                    (entry.parkName || '').toLowerCase().includes(searchVal) ||
                                    (entry.parkNameRidden || '').toLowerCase().includes(searchVal) ||
                                    (entry.notes || '').toLowerCase().includes(searchVal);
                const matchDashboardFilter = !activeDashboardFilter ||
                    (activeDashboardFilter.kind === 'type' && (entry.type || 'Real') === activeDashboardFilter.value) ||
                    (activeDashboardFilter.kind === 'variants' && ['ExperienceChange', 'ElementChange', 'Relocated'].includes(normalizeRideVariant(entry.variant))) ||
                    (activeDashboardFilter.kind === 'credits' && isEntryCredit(entry)) ||
                    (activeDashboardFilter.kind === 'ride' &&
                        (entry.parkName || entry.parkNameRidden || '').toLowerCase() === activeDashboardFilter.value.park.toLowerCase() &&
                        (entry.coasterName || '').toLowerCase() === activeDashboardFilter.value.coaster.toLowerCase());
                return matchSearch && matchDashboardFilter;
            });

            // Sort entries
            filtered.sort((a, b) => {
                if (sortVal === 'date-desc') return rideDateValue(b) - rideDateValue(a);
                if (sortVal === 'date-asc') return rideDateValue(a) - rideDateValue(b);
                if (sortVal === 'name-asc') return (a.coasterName || '').localeCompare(b.coasterName || '');
                if (sortVal === 'park-asc') return (a.parkName || '').localeCompare(b.parkName || '');
                return 0;
            });

            if (filtered.length === 0) {
                if (coasterLog.length === 0) {
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
            filtered.forEach(entry => {
                const coasterDisplayName = entry.coasterNameRidden && entry.coasterNameRidden !== entry.coasterName 
                    ? entry.coasterNameRidden 
                    : entry.coasterName;
                
                const showCoasterBadge = entry.coasterNameRidden && entry.coasterNameRidden !== entry.coasterName;

                const parkDisplayName = entry.parkNameRidden && entry.parkNameRidden !== entry.parkName 
                    ? entry.parkNameRidden 
                    : entry.parkName || 'Standalone ride';

                const rideDateTime = formatRideDateTime(entry);
                const rideStatus = entry.rideStatus || 'Status unknown';

                html += `
                    <div class="bg-cardbg rounded-2xl border border-bordercolor p-4 hover:border-slate-700 transition flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                        <div class="space-y-1.5 flex-grow">
                            <div class="flex items-center gap-2 flex-wrap">
                                <h4 class="text-base font-bold text-white">${escapeHtml(coasterDisplayName)}</h4>
                                ${showCoasterBadge ? `<span class="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-bordercolor" title="Current Official Name">Now: ${escapeHtml(entry.coasterName)}</span>` : ''}
                            </div>
                            <div class="flex items-center gap-3 text-xs text-slate-400 flex-wrap">
                                ${rideDateTime ? `<span><i class="fa-regular fa-calendar mr-1"></i>${escapeHtml(rideDateTime)}</span>` : ''}
                                <span class="rounded-md border border-slate-700 px-2 py-0.5 text-[10px] uppercase tracking-wide">${escapeHtml(rideStatus)}</span>
                                <span class="font-medium text-slate-200"><i class="fa-solid fa-location-dot text-brand-500 mr-1"></i>${escapeHtml(parkDisplayName)}</span>
                                ${(entry.rideCount || 1) > 1 ? `<span><i class="fa-solid fa-ticket mr-1"></i>${entry.rideCount} laps</span>` : ''}
                            </div>
                            ${entry.notes ? `<p class="text-[11px] italic text-slate-500">${escapeHtml(entry.notes)}</p>` : ''}
                        </div>

                        <div class="flex items-center gap-2 self-end md:self-center">
                            <button onclick="openEditModal('${entry.id}')" class="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-bordercolor text-xs transition flex items-center gap-1.5" title="Edit Entry" aria-label="Edit ${escapeHtml(coasterDisplayName)}">
                                <i class="fa-solid fa-pen"></i><span>Edit</span>
                            </button>
                            <button onclick="relogEntry('${entry.id}')" class="px-3 py-2 rounded-xl bg-brand-600/10 hover:bg-brand-600/20 text-brand-300 border border-brand-500/20 text-xs transition flex items-center gap-1.5" title="Log this coaster again">
                                <i class="fa-solid fa-rotate"></i><span>Relog</span>
                            </button>
                            <button onclick="deleteEntry('${entry.id}')" class="p-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 text-xs transition" title="Delete Entry">
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
                coasterpediaSearchResults.push(...batch.filter(park => {
                    const page = pagesByTitle.get(park.title.toLocaleLowerCase());
                    const wikitext = page?.revisions?.[0]?.slots?.main?.['*'] || '';
                    return hasCoasterpediaCoasterSections(wikitext);
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
                renderParkSearchMessage('No parks with present or former coaster lists found.');
            }
        }

        function hasCoasterpediaCoasterSections(wikitext) {
            const headings = [...wikitext.matchAll(/^(={2,6})\s*(.*?)\s*\1\s*$/gm)]
                .map(match => ({
                    level: match[1].length,
                    title: match[2].trim().replace(/_/g, ' ')
                }));
            let era = null;

            for (const heading of headings) {
                if (heading.level === 2) {
                    era = /^(present|current|operating)$/i.test(heading.title)
                        ? 'Present'
                        : /^(past|former|defunct)$/i.test(heading.title)
                            ? 'Former'
                            : null;
                    if (/^(?:present|current|operating|past|former|defunct)\s+(?:roller\s+)?coasters$/i.test(heading.title) ||
                        /^(?:roller\s+)?coasters?$/i.test(heading.title)) {
                        return true;
                    }
                } else if (heading.level === 3 && /^(?:roller\s+)?coasters?$/i.test(heading.title) && era) {
                    return true;
                } else if (heading.level === 3 && /^roller coasters$/i.test(heading.title)) {
                    return true;
                }
            }

            return false;
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
                await addFormerRideAliases();
                if (requestId !== searchRequestId) return;

                if (currentParkRides.length === 0) {
                    throw new Error('No coaster entries were found in this park article.');
                }

                const updatedStatuses = updateLoggedRideStatuses(selectedPage.title, currentParkRides);
                if (updatedStatuses > 0) {
                    saveToLocalStorage();
                    renderLogbook();
                    if (!document.getElementById('park-breakdown').classList.contains('hidden')) renderParkBreakdown();
                    showToast(`Updated status for ${updatedStatuses} logged coaster${updatedStatuses === 1 ? '' : 's'}.`, 'success');
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
                throw new Error(`"${parkTitle}" does not have a present or former coaster list.`);
            }

            const rides = (await Promise.all(sections.map(async section => {
                const sectionParams = new URLSearchParams({
                    action: 'parse',
                    page: parkTitle,
                    section: section.index,
                    prop: 'wikitext',
                    format: 'json',
                    origin: '*'
                });
                const sectionResponse = await fetch(`https://coasterpedia.net/w/api.php?${sectionParams}`);
                if (!sectionResponse.ok) {
                    throw new Error(`Coasterpedia coaster list failed with status ${sectionResponse.status}`);
                }
                const sectionData = await sectionResponse.json();
                return parseCoasterpediaCoasters(
                    sectionData.parse?.wikitext?.['*'] || '',
                    parkTitle,
                    section.status
                );
            }))).flat();
            if (rides.length === 0) {
                throw new Error(`No coaster entries were found in "${parkTitle}".`);
            }
            return rides;
        }

        function updateLoggedRideStatuses(parkTitle, rides) {
            const ridesByName = new Map();
            rides.forEach(ride => {
                const status = ride.entityType.startsWith('Former') ? 'Former' : 'Present';
                [ride.name, ...(ride.historicalNames || [])].forEach(name => {
                    ridesByName.set(normalizeRideStatusName(name), status);
                });
            });

            let updatedCount = 0;
            coasterLog.forEach(entry => {
                const entryPark = (entry.parkName || entry.parkNameRidden || '').trim();
                if (entryPark.toLocaleLowerCase() !== parkTitle.toLocaleLowerCase()) return;

                const names = [entry.coasterName, entry.coasterNameRidden].filter(Boolean);
                const matchingStatus = names.map(name => {
                    const normalizedName = normalizeRideStatusName(name);
                    const exactStatus = ridesByName.get(normalizedName);
                    if (exactStatus) return exactStatus;

                    const trackSuffix = normalizedName.match(/^(.*?)\s+\((?:red track|blue track|track \d+)\)$/);
                    return trackSuffix ? ridesByName.get(trackSuffix[1]) : undefined;
                }).find(Boolean);

                if (matchingStatus && entry.rideStatus !== matchingStatus) {
                    entry.rideStatus = matchingStatus;
                    updatedCount++;
                }
            });
            return updatedCount;
        }

        function normalizeRideStatusName(name) {
            return name.trim().toLocaleLowerCase().replace(/[’‘]/g, "'");
        }

        async function refreshLoggedRideStatuses() {
            const parks = new Map();
            coasterLog.forEach(entry => {
                const parkName = (entry.parkName || entry.parkNameRidden || '').trim();
                if (parkName) parks.set(parkName.toLocaleLowerCase(), parkName);
            });
            const pendingParks = [...parks.values()];
            if (pendingParks.length === 0) return;

            let updatedCount = 0;
            let failedParks = 0;
            const workers = Array.from({ length: Math.min(3, pendingParks.length) }, async () => {
                while (pendingParks.length > 0) {
                    const parkTitle = pendingParks.shift();
                    try {
                        const rides = await fetchCoasterpediaParkRides(parkTitle);
                        updatedCount += updateLoggedRideStatuses(parkTitle, rides);
                    } catch (error) {
                        failedParks++;
                        console.error(`Failed to refresh logged ride status for "${parkTitle}":`, error);
                    }
                }
            });
            await Promise.all(workers);

            if (updatedCount > 0) {
                saveToLocalStorage();
                updateStatsAndCounters();
                renderLogbook();
                if (!document.getElementById('park-breakdown').classList.contains('hidden')) renderParkBreakdown();
                showToast(`Updated status for ${updatedCount} logged coaster${updatedCount === 1 ? '' : 's'} from Coasterpedia.`, 'success');
            }
            if (failedParks > 0) {
                showToast(`Could not refresh status from Coasterpedia for ${failedParks} park${failedParks === 1 ? '' : 's'}; saved statuses were kept.`, 'error');
            }
        }

        function findCoasterpediaSections(sections) {
            const coasterSections = [];
            let era = null;

            sections.forEach(section => {
                const heading = section.line.trim();
                if (section.hLevel === 2) {
                    era = /^(present|current|operating)$/i.test(heading)
                        ? 'Present'
                        : /^(past|former|defunct)$/i.test(heading)
                            ? 'Former'
                            : null;
                    if (/^(present|current|operating)\s+(?:roller\s+)?coasters$/i.test(heading)) {
                        coasterSections.push({ index: section.index, status: 'Present' });
                    } else if (/^(past|former|defunct)\s+(?:roller\s+)?coasters$/i.test(heading)) {
                        coasterSections.push({ index: section.index, status: 'Former' });
                    } else if (/^(?:roller\s+)?coasters?$/i.test(heading)) {
                        coasterSections.push({ index: section.index, status: 'Present' });
                    }
                } else if (section.hLevel === 3 && /^(?:roller\s+)?coasters?$/i.test(heading) && era) {
                    coasterSections.push({ index: section.index, status: era });
                }
            });

            return coasterSections;
        }

        function parseCoasterpediaCoasters(wikitext, parkName, status) {
            const seenTitles = new Set();
            const rides = [];
            const tableMatches = [...wikitext.matchAll(/\{\|([\s\S]*?)^\|\}/gm)];
            tableMatches.forEach(tableMatch => {
                const table = tableMatch[1];
                const subsections = [...wikitext.slice(0, tableMatch.index).matchAll(/^={3}\s*(.*?)\s*={3}\s*$/gm)];
                const subsectionTitle = subsections.at(-1)?.[1]?.trim() || '';
                const rideStatus = /^(defunct|former|past)$/i.test(subsectionTitle)
                    ? 'Former'
                    : /^(operating|present|current)$/i.test(subsectionTitle)
                        ? 'Present'
                        : status;
                const headers = table.split(/\r?\n/)
                    .filter(line => line.trim().startsWith('!'))
                    .flatMap(line => line.trim().slice(1).split('!!'))
                    .map(header => header.replace(/^.*\|/, '').replace(/<[^>]*>/g, '').trim().toLowerCase());
                const nameColumn = headers.findIndex(header => /^(name|coaster|roller coaster)$/.test(header));
                const classColumn = headers.findIndex(header => /^(class|category|ride type)$/.test(header));

                table.split(/^\|-/m).slice(1).forEach(row => {
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
                        name,
                        pageTitle,
                        entityType: `${rideStatus} coaster`,
                        parkName,
                        type: classifyCoasterpediaRide(rideClass),
                        rideType
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

        async function addFormerRideAliases() {
            const pageTitles = [...new Set(currentParkRides.map(ride => ride.pageTitle))];
            if (pageTitles.length === 0) return;

            const redirectParams = new URLSearchParams({
                action: 'query',
                prop: 'redirects',
                titles: pageTitles.join('|'),
                rdlimit: 'max',
                format: 'json',
                origin: '*'
            });
            const redirectResponse = await fetch(`https://coasterpedia.net/w/api.php?${redirectParams}`);
            if (!redirectResponse.ok) {
                throw new Error(`Coasterpedia alternate-name lookup failed with status ${redirectResponse.status}`);
            }

            const redirectData = await redirectResponse.json();
            const pagesWithRedirects = Object.values(redirectData.query?.pages || {})
                .filter(page => page.redirects?.length);
            if (pagesWithRedirects.length === 0) return;

            const articlesByTitle = new Map();
            for (let offset = 0; offset < pageTitles.length; offset += 50) {
                const articleParams = new URLSearchParams({
                    action: 'query',
                    prop: 'revisions',
                    titles: pageTitles.slice(offset, offset + 50).join('|'),
                    rvprop: 'content',
                    rvslots: 'main',
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
                    articlesByTitle.set(page.title.toLowerCase(), extractCoasterpediaInfoboxDetails(wikitext));
                });
            }

            const ridesByTitle = new Map(currentParkRides.map(ride => [ride.pageTitle.toLowerCase(), ride]));
            const knownNames = new Set(currentParkRides.map(ride => ride.name.toLowerCase()));
            currentParkRides.forEach(ride => {
                const details = articlesByTitle.get(ride.pageTitle.toLowerCase());
                if (!details || details.tracks < 2) return;
                ride.trackCount = details.tracks;
                ride.trackNames = details.tracks === 2 && ride.name.toLowerCase() === 'gemini'
                    ? ['Red Track', 'Blue Track']
                    : Array.from({ length: details.tracks }, (_, index) => `Track ${index + 1}`);
            });

            pagesWithRedirects.forEach(page => {
                const ride = ridesByTitle.get(page.title.toLowerCase());
                if (!ride) return;
                const historicalNames = articlesByTitle.get(page.title.toLowerCase())?.names || new Set();

                (page.redirects || []).forEach(redirect => {
                    const redirectName = redirect.title.trim().replace(/\s*\([^()]*\)\s*$/, '');
                    const normalizedRedirectName = redirectName.toLowerCase();
                    const name = [...historicalNames].find(historicalName =>
                        historicalName.toLowerCase() === normalizedRedirectName
                    );
                    if (!name) return;
                    const nameKey = name.toLowerCase();
                    if (knownNames.has(nameKey)) return;
                    knownNames.add(nameKey);
                    if (isNameOnlyRideChange(ride.name, name)) {
                        ride.historicalNames = [...(ride.historicalNames || []), name];
                        return;
                    }
                    currentParkRides.push({
                        id: `${ride.id}::${name}`,
                        name,
                        pageTitle: ride.pageTitle,
                        entityType: 'Former coaster',
                        parkName: ride.parkName,
                        type: ride.type,
                        rideType: ride.rideType,
                        variant: 'ElementChange'
                    });
                });
            });

            currentParkRides = currentParkRides.flatMap(ride => {
                if (!ride.trackNames) return [ride];
                return ride.trackNames.map((trackName, index) => ({
                    ...ride,
                    id: `${ride.id}::track-${index + 1}`,
                    name: `${ride.name} (${trackName})`,
                    trackIndex: index + 1,
                    trackNames: undefined
                }));
            });
        }

        function isNameOnlyRideChange(currentName, formerName) {
            const normalizedCurrentName = currentName.toLowerCase().replace(/[^a-z0-9]/g, '');
            const normalizedFormerName = formerName.toLowerCase().replace(/[^a-z0-9]/g, '');
            return normalizedCurrentName === 'x2' && normalizedFormerName === 'x';
        }

        function extractCoasterpediaInfoboxDetails(wikitext) {
            const infobox = wikitext.match(/\{\{Infobox roller coaster\b([\s\S]*?)^\}\}/im)?.[1] || '';
            const names = [...infobox.matchAll(/^\|name\d*\s*=\s*(.+)$/gim)]
                .map(match => match[1]
                    .replace(/<!--[\s\S]*?-->/g, '')
                    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, title, label) => label || title)
                    .replace(/<[^>]*>/g, ' ')
                    .replace(/'{2,}/g, '')
                    .trim())
                    .filter(Boolean);
            const trackCount = infobox.match(/^\|tracks?\s*=\s*(\d+)/im);
            return {
                    names: new Set(names),
                tracks: trackCount ? Number(trackCount[1]) : 1
            };
        }

        function renderRidesList() {
            const grid = document.getElementById('rides-grid');
            const searchVal = document.getElementById('ride-search-filter').value.toLowerCase().trim();

            const filtered = currentParkRides.filter(r => r.name.toLowerCase().includes(searchVal));

            if (filtered.length === 0) {
                grid.innerHTML = `<div class="col-span-full text-center py-8 text-xs text-slate-500">No attractions found matching filter.</div>`;
                return;
            }

            let html = '';
            const sections = [
                { title: 'Present Coasters', rides: filtered.filter(ride => ride.entityType === 'Present coaster') },
                { title: 'Former Coasters', rides: filtered.filter(ride => ride.entityType.startsWith('Former')) }
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
                    const searchableRideNames = [ride.name, ...(ride.historicalNames || [])]
                        .map(name => name.toLocaleLowerCase());
                    const loggedEntry = coasterLog.find(l =>
                        (l.parkName || l.parkNameRidden || '').toLocaleLowerCase() === ride.parkName.toLocaleLowerCase() &&
                        [l.coasterName, l.coasterNameRidden]
                            .filter(Boolean)
                            .some(name => searchableRideNames.includes(name.toLocaleLowerCase()))
                    );
                    const articleUrl = `https://coasterpedia.net/wiki/${encodeURIComponent(ride.pageTitle.replace(/ /g, '_'))}`;
                    const rideType = ride.rideType || classifyRideLabel(ride.type || '');
                    const variant = normalizeRideVariant(ride.variant);

                    html += `
                        <div class="flex flex-col gap-2 px-4 py-3 transition hover:bg-slate-800/40 sm:flex-row sm:items-center sm:justify-between">
                            <div class="min-w-0">
                                <div class="flex min-w-0 items-center gap-2 flex-wrap">
                                    <a href="${articleUrl}" target="_blank" rel="noopener noreferrer" class="truncate text-sm font-semibold text-slate-100 hover:text-brand-400">${escapeHtml(ride.name)}</a>
                                    <span class="rounded-md border border-brand-500/20 bg-brand-500/10 px-2 py-0.5 text-[10px] font-semibold text-brand-300">${escapeHtml(rideType)}</span>
                                </div>
                                ${ride.historicalNames?.length ? `<p class="mt-1 text-[11px] text-slate-500">Also known as ${ride.historicalNames.map(escapeHtml).join(', ')}</p>` : ''}
                            </div>
                            ${loggedEntry
                                ? `<div class="flex gap-2 self-end sm:self-auto">
                                    <button data-entry-id="${escapeHtml(loggedEntry.id)}" data-current-name="${escapeHtml(ride.name)}" data-status="${ride.entityType.startsWith('Former') ? 'Former' : 'Present'}" data-ride-type="${ride.type || 'Real'}" data-variant="${variant}" onclick="relogEntry(this.dataset.entryId, {name: this.dataset.currentName, status: this.dataset.status, type: this.dataset.rideType, variant: this.dataset.variant})" class="rounded-lg border border-brand-500/30 bg-brand-500/10 px-3 py-1.5 text-[11px] font-semibold text-brand-300 transition hover:bg-brand-500/20"><i class="fa-solid fa-rotate mr-1"></i>Relog</button>
                                    <button data-entry-id="${escapeHtml(loggedEntry.id)}" data-current-name="${escapeHtml(ride.name)}" onclick="openRideEntryEdit(this.dataset.entryId, this.dataset.currentName)" class="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-[11px] font-semibold text-rose-300 transition hover:bg-rose-500/20"><i class="fa-solid fa-pen mr-1"></i>Edit</button>
                                </div>`
                                : `<button data-park-name="${escapeHtml(ride.parkName)}" data-ride-name="${escapeHtml(ride.name)}" data-ride-type="${ride.type || 'Real'}" data-variant="${variant}" data-status="${ride.entityType.startsWith('Former') ? 'Former' : 'Present'}" onclick="quickLogRide(this.dataset.parkName, this.dataset.rideName, this.dataset.variant, this.dataset.rideType, this.dataset.status)" class="self-end rounded-lg bg-brand-600 px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm transition hover:bg-brand-500 sm:self-auto"><i class="fa-solid fa-plus mr-1"></i>Log Coaster</button>`}
                        </div>
                    `;
                });
                html += '</div></details>';
            });

            grid.innerHTML = html;
        }

        function filterRidesList() {
            renderRidesList();
        }

        // Quick Log from Coasterpedia's park directory
        function quickLogRide(parkName, rideName, variant = 'Original', type = 'Real', status = 'Unknown') {
            if (!openAddModal()) return;
            document.getElementById('form-park-name').value = parkName;
            document.getElementById('form-park-ridden').value = parkName;
            document.getElementById('form-coaster-name').value = rideName;
            document.getElementById('form-coaster-ridden').value = rideName;
            document.getElementById('form-coaster-type').value = type;
            document.getElementById('form-variant-type').value = normalizeRideVariant(variant);
            document.getElementById('form-ride-status').value = status;
        }

        // Modal Handlers & Form Actions
        function openAddModal() {
            if (!requireSignedIn()) return false;
            document.getElementById('modal-entry-title').innerHTML = `<i class="fa-solid fa-pen-to-square text-brand-500"></i> Add Log Entry`;
            document.getElementById('form-entry-id').value = '';
            document.getElementById('form-park-name').value = '';
            document.getElementById('form-park-ridden').value = '';
            document.getElementById('form-coaster-name').value = '';
            document.getElementById('form-coaster-ridden').value = '';
            document.getElementById('form-coaster-type').value = 'Real';
            document.getElementById('form-variant-type').value = 'Original';
            const now = new Date();
            document.getElementById('form-date-ridden').value = formatLocalDate(now);
            document.getElementById('form-time-ridden').value = formatLocalTime(now);
            document.getElementById('form-ride-status').value = 'Unknown';
            document.getElementById('form-ride-count').value = 1;
            document.getElementById('form-notes').value = '';
            document.getElementById('modal-entry').classList.remove('hidden');
            return true;
        }

        function openEditModal(id) {
            if (!requireSignedIn()) return false;
            const entry = coasterLog.find(e => e.id === id);
            if (!entry) return false;

            document.getElementById('modal-entry-title').innerHTML = `<i class="fa-solid fa-pen-to-square text-brand-500"></i> Edit Log Entry`;
            document.getElementById('form-entry-id').value = entry.id;
            document.getElementById('form-park-name').value = entry.parkName || '';
            document.getElementById('form-park-ridden').value = entry.parkNameRidden || entry.parkName || '';
            document.getElementById('form-coaster-name').value = entry.coasterName || '';
            document.getElementById('form-coaster-ridden').value = entry.coasterNameRidden || entry.coasterName || '';
            document.getElementById('form-coaster-type').value = entry.type || 'Real';
            document.getElementById('form-variant-type').value = normalizeRideVariant(entry.variant);
            document.getElementById('form-date-ridden').value = entry.dateRidden || '';
            document.getElementById('form-time-ridden').value = entry.timeRidden || '';
            document.getElementById('form-ride-status').value = entry.rideStatus || 'Unknown';
            document.getElementById('form-ride-count').value = entry.rideCount || 1;
            document.getElementById('form-notes').value = entry.notes || '';

            document.getElementById('modal-entry').classList.remove('hidden');
            return true;
        }

        function relogEntry(id, rideDetails = null) {
            if (!requireSignedIn()) return;
            const entry = coasterLog.find(item => item.id === id);
            if (!entry) return;
            const now = new Date();
            coasterLog.unshift({
                ...entry,
                ...(rideDetails ? {
                    coasterName: rideDetails.name,
                    coasterNameRidden: rideDetails.name,
                    rideStatus: rideDetails.status,
                    type: rideDetails.type,
                    variant: normalizeRideVariant(rideDetails.variant)
                } : {}),
                id: 'entry_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
                dateRidden: formatLocalDate(now),
                timeRidden: formatLocalTime(now),
                loggedAt: now.toISOString(),
                rideCount: 1,
                notes: ''
            });
            saveToLocalStorage();
            updateStatsAndCounters();
            renderLogbook();
            if (!document.getElementById('park-breakdown').classList.contains('hidden')) renderParkBreakdown();
            if (!document.getElementById('tab-search').classList.contains('hidden')) renderRidesList();
            showToast('Coaster relogged', 'success');
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
            if (entry.dateRidden && entry.timeRidden) return `${entry.dateRidden} ${entry.timeRidden}`;
            if (entry.dateRidden) return `${entry.dateRidden} · time not recorded`;
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
        }

        function saveEntry(e) {
            e.preventDefault();
            if (!requireSignedIn()) return;
            const id = document.getElementById('form-entry-id').value;
            const parkName = document.getElementById('form-park-name').value.trim();
            const parkNameRidden = document.getElementById('form-park-ridden').value.trim() || parkName;
            const coasterName = document.getElementById('form-coaster-name').value.trim();
            const coasterNameRidden = document.getElementById('form-coaster-ridden').value.trim() || coasterName;
            const type = document.getElementById('form-coaster-type').value;
            const variant = document.getElementById('form-variant-type').value;
            const dateRidden = document.getElementById('form-date-ridden').value;
            const timeRidden = document.getElementById('form-time-ridden').value;
            const rideStatus = document.getElementById('form-ride-status').value;
            const rideCount = parseInt(document.getElementById('form-ride-count').value) || 1;
            const notes = document.getElementById('form-notes').value.trim();

            if (id) {
                // Edit existing
                const index = coasterLog.findIndex(e => e.id === id);
                if (index !== -1) {
                    coasterLog[index] = {
                        ...coasterLog[index],
                        parkName,
                        parkNameRidden,
                        coasterName,
                        coasterNameRidden,
                        type,
                        variant,
                        dateRidden,
                        timeRidden,
                        rideStatus,
                        rideCount,
                        notes
                    };
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
                    type,
                    variant,
                    dateRidden,
                    timeRidden,
                    rideStatus,
                    loggedAt: new Date().toISOString(),
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
            coasterLog = coasterLog.filter(e => e.id !== id);
            saveToLocalStorage();
            updateStatsAndCounters();
            renderLogbook();
            if (!document.getElementById('park-breakdown').classList.contains('hidden')) renderParkBreakdown();
            showToast('Entry removed from logbook', 'info');

            if (!document.getElementById('tab-search').classList.contains('hidden')) {
                renderRidesList();
            }
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
                experienceChange: document.getElementById('rule-experience-change').checked,
                elementChange: document.getElementById('rule-element-change').checked,
                relocated: document.getElementById('rule-relocated').checked
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
    