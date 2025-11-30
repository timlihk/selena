class BabyTracker {
    constructor() {
        // Event configuration constants
        this.EVENT_CONFIG = {
            milk: {
                icon: '🍼',
                label: 'Milk Feed',
                color: '#667eea',
                requiresAmount: true,
                amountUnit: 'ml',
                amountMax: 500,
                amountPlaceholder: 'Amount (ml)'
            },
            diaper: {
                icon: '💩',
                label: 'Diaper Change',
                color: '#8b6914',
                requiresSubtype: true,
                subtypes: {
                    pee: { icon: '💧', label: 'Diaper Change (Pee)', color: '#4facfe' },
                    poo: { icon: '💩', label: 'Diaper Change (Poo)', color: '#8b6914' },
                    both: { icon: '💧💩', label: 'Diaper Change (Both)', color: '#a855f7' }
                }
            },
            bath: {
                icon: '🛁',
                label: 'Bath Time',
                color: '#4facfe'
            },
            sleep: {
                icon: '😴',
                label: 'Sleep Session',
                color: '#43e97b',
                requiresAmount: true,
                amountUnit: 'min',
                amountMax: 480,
                amountPlaceholder: 'Duration (min)'
            },
            poo: {
                icon: '💩',
                label: 'Diaper Change (Legacy)',
                color: '#8b6914'
            }
        };

        // UI constants
        this.UI_CONSTANTS = {
            EVENTS_LIST_MAX_HEIGHT: 400,
            TIMELINE_HOURS: 24,
            ANIMATION_DURATION: 300
        };

        // Validation constants
        this.VALIDATION = {
            MAX_USERNAME_LENGTH: 50,
            MAX_NOTE_LENGTH: 500,
            TIMESTAMP_MAX_PAST_DAYS: 365
        };

        this.events = [];
        this.allEvents = [];
        this.manualTimeOverride = false;
        this.activeTimelineMarker = null;
        this.localTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        this.defaultHomeTimezone = 'Asia/Hong_Kong';
        this.homeTimezone = this.defaultHomeTimezone;
        this.init();
    }

    async init() {
        await this.loadConfig();
        this.setCurrentTime();
        this.bindEvents();
        await this.loadEvents();
        await this.updateStats();
        await this.renderTimeline();
    }

    async loadConfig() {
        try {
            const response = await fetch('/api/config');
            if (!response.ok) {
                throw new Error('Failed to load configuration');
            }
            const data = await response.json();
            if (data.homeTimezone) {
                this.homeTimezone = data.homeTimezone;
            }
        } catch (error) {
            console.warn('Failed to load configuration, using fallback timezone', error);
            this.homeTimezone = this.homeTimezone || this.localTimezone || this.defaultHomeTimezone;
        }
    }

    setCurrentTime(date = new Date()) {
        const formattedTime = this.formatDateTimeInTimezone(date, this.homeTimezone);

        const timeInput = document.getElementById('eventTime');
        if (timeInput && formattedTime) {
            timeInput.value = formattedTime;
        }
        this.manualTimeOverride = false;
    }

    bindEvents() {
        const eventForm = document.getElementById('eventForm');
        const eventType = document.getElementById('eventType');
        const milkAmountGroup = document.getElementById('milkAmountGroup');
        const diaperSubtypeGroup = document.getElementById('diaperSubtypeGroup');
        const sleepTrackingGroup = document.getElementById('sleepTrackingGroup');
        const fallAsleepBtn = document.getElementById('fallAsleepBtn');
        const wakeUpBtn = document.getElementById('wakeUpBtn');
        const dateFilter = document.getElementById('dateFilter');
        const customDateRange = document.getElementById('customDateRange');
        const applyCustomRange = document.getElementById('applyCustomRange');
        const exportCSV = document.getElementById('exportCSV');
        const exportPDF = document.getElementById('exportPDF');
        document.addEventListener('click', () => {
            if (this.activeTimelineMarker) {
                this.activeTimelineMarker.classList.remove('show-tooltip');
                this.activeTimelineMarker = null;
            }
        });

        const themeToggle = document.getElementById('themeToggle');
        if (themeToggle) {
            const savedTheme = localStorage.getItem('theme');
            if (savedTheme) {
                document.body.classList.add(savedTheme);
            } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
                document.body.classList.add('dark-mode');
            }
            this.updateThemeIcon(themeToggle);

            themeToggle.addEventListener('click', () => {
                const isDark = document.body.classList.contains('dark-mode');
                document.body.classList.remove('dark-mode', 'light-mode');

                if (isDark) {
                    document.body.classList.add('light-mode');
                    localStorage.setItem('theme', 'light-mode');
                } else {
                    document.body.classList.add('dark-mode');
                    localStorage.setItem('theme', 'dark-mode');
                }

                this.updateThemeIcon(themeToggle);
            });
        }

        const timeInput = document.getElementById('eventTime');
        if (timeInput) {
            timeInput.addEventListener('input', () => {
                this.manualTimeOverride = true;
            });
        }

        // Show/hide amount fields based on event type
        eventType.addEventListener('change', (e) => {
            const selectedType = e.target.value;
            const selectedConfig = this.EVENT_CONFIG[selectedType] || {};
            milkAmountGroup.style.display = selectedType === 'milk' ? 'block' : 'none';
            if (selectedType === 'milk') {
                const milkInput = document.getElementById('milkAmount');
                if (milkInput) {
                    milkInput.placeholder = selectedConfig.amountPlaceholder || 'Amount (ml)';
                    milkInput.max = selectedConfig.amountMax || 500;
                }
            }
            diaperSubtypeGroup.style.display = selectedType === 'diaper' ? 'block' : 'none';
            sleepTrackingGroup.style.display = selectedType === 'sleep' ? 'block' : 'none';

            // Reset diaper subtype selection when switching away
            if (selectedType !== 'diaper') {
                document.getElementById('diaperSubtype').value = '';
                document.querySelectorAll('.btn-diaper').forEach(btn => btn.classList.remove('selected'));
            }
        });

        // Sleep button handlers
        fallAsleepBtn.addEventListener('click', () => {
            this.addSleepEvent('fall_asleep');
        });

        wakeUpBtn.addEventListener('click', () => {
            this.addSleepEvent('wake_up');
        });

        // Diaper button handlers
        document.querySelectorAll('.btn-diaper').forEach(button => {
            button.addEventListener('click', (e) => {
                const subtype = e.currentTarget.getAttribute('data-subtype');
                document.getElementById('diaperSubtype').value = subtype;

                // Update button visual state
                document.querySelectorAll('.btn-diaper').forEach(btn => btn.classList.remove('selected'));
                e.currentTarget.classList.add('selected');
            });
        });

        // Handle form submission
        eventForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.addEvent();
        });

        // Date filter change
        dateFilter.addEventListener('change', (e) => {
            if (e.target.value === 'custom') {
                customDateRange.style.display = 'flex';
            } else {
                customDateRange.style.display = 'none';
                this.applyDateFilter(e.target.value);
            }
        });

        // Type filter change
        const typeFilter = document.getElementById('typeFilter');
        typeFilter.addEventListener('change', (e) => {
            this.applyTypeFilter(e.target.value);
        });

        // Apply custom date range
        applyCustomRange.addEventListener('click', () => {
            this.applyCustomDateFilter();
        });

        // Export functionality
        exportCSV.addEventListener('click', () => {
            this.exportToCSV();
        });

        exportPDF.addEventListener('click', () => {
            this.exportToPDF();
        });
    }

    async addEvent() {
        const eventType = document.getElementById('eventType').value;
        const milkAmount = document.getElementById('milkAmount').value;
        const diaperSubtype = document.getElementById('diaperSubtype').value;
        const userName = document.getElementById('userName').value;
        const eventTimeInput = document.getElementById('eventTime');
        const eventTime = eventTimeInput ? eventTimeInput.value : '';
        const submitButton = document.querySelector('#eventForm button[type="submit"]');

        if (!userName) {
            alert('Please select who is recording');
            return;
        }

        if (!eventType) {
            alert('Please select an event type');
            return;
        }

        if (eventType === 'milk' && (!milkAmount || isNaN(parseInt(milkAmount)) || parseInt(milkAmount) <= 0)) {
            alert('Please enter a valid milk amount (positive number)');
            return;
        }

        if (eventType === 'diaper' && !diaperSubtype) {
            alert('Please select diaper type (Pee, Poo, or Both)');
            return;
        }

        // Skip sleep events in the main form - they're handled by the sleep buttons
        if (eventType === 'sleep') {
            alert('Please use the "Fall Asleep" or "Wake Up" buttons for sleep tracking');
            return;
        }

        this.setButtonLoading(submitButton, true, 'Adding...');
        let loadingActive = true;

        try {
            const timestampIso = this.convertInputToHomeISO(eventTime);
            if (!timestampIso) {
                alert('Please enter a valid time');
                this.setButtonLoading(submitButton, false);
                loadingActive = false;
                return;
            }

            const requestData = {
                type: eventType,
                amount: eventType === 'milk' ? parseInt(milkAmount, 10) : null,
                userName,
                timestamp: timestampIso
            };

            // Add diaper subtype if applicable
            if (eventType === 'diaper') {
                requestData.diaperSubtype = diaperSubtype;
            }

            console.log('Sending event creation request:', requestData);

            const response = await fetch('/api/events', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestData)
            });

            if (!response.ok) {
                let errorMessage = 'Failed to add event';
                try {
                    const errorData = await response.json();
                    errorMessage = errorData.error || errorMessage;
                } catch (jsonError) {
                    // If response is not JSON, use status text
                    errorMessage = response.statusText || errorMessage;
                }
                throw new Error(errorMessage);
            }

            await this.loadEvents();
            await this.updateStats();
            await this.renderTimeline();
            this.resetForm();

            if (submitButton) {
                this.setButtonLoading(submitButton, false);
                loadingActive = false;
                this.showButtonSuccess(submitButton, '✓ Added!');
            }
        } catch (error) {
            console.error('Error adding event:', error);
            alert(`Failed to add event: ${  error.message}`);
        } finally {
            if (loadingActive) {
                this.setButtonLoading(submitButton, false);
            }
        }
    }

    // Add sleep event with fall asleep/wake up tracking
    async addSleepEvent(sleepSubType) {
        const userName = document.getElementById('userName').value;
        const eventTime = document.getElementById('eventTime').value;
        const buttonId = sleepSubType === 'fall_asleep' ? 'fallAsleepBtn' : 'wakeUpBtn';
        const button = document.getElementById(buttonId);

        if (!userName) {
            alert('Please select who is recording');
            return;
        }

        let eventTimestamp;
        if (this.manualTimeOverride) {
            if (!eventTime) {
                alert('Please select event time');
                return;
            }
            const manualIso = this.convertInputToHomeISO(eventTime);
            if (!manualIso) {
                alert('Please enter a valid time');
                return;
            }
            eventTimestamp = manualIso;
        } else {
            const now = new Date();
            eventTimestamp = now.toISOString();
            this.setCurrentTime(now);
        }

        const loadingText = sleepSubType === 'fall_asleep' ? 'Recording...' : 'Waking...';
        this.setButtonLoading(button, true, loadingText);
        let loadingActive = true;

        try {
            const response = await fetch('/api/events', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    type: 'sleep',
                    sleepSubType,
                    userName,
                    timestamp: eventTimestamp
                })
            });

            if (!response.ok) {
                let errorMessage = 'Failed to add sleep event';
                try {
                    const errorData = await response.json();
                    errorMessage = errorData.error || errorMessage;
                } catch (jsonError) {
                    // If response is not JSON, use status text
                    errorMessage = response.statusText || errorMessage;
                }
                throw new Error(errorMessage);
            }

            await this.loadEvents();
            await this.updateStats();
            this.setCurrentTime();

            const successMessage = sleepSubType === 'fall_asleep' ? '😴 Asleep!' : '☀️ Awake!';
            if (button) {
                this.setButtonLoading(button, false);
                loadingActive = false;
                this.showButtonSuccess(button, successMessage);
            }
        } catch (error) {
            console.error('Error adding sleep event:', error);
            alert(`Failed to add sleep event: ${  error.message}`);
        } finally {
            if (loadingActive) {
                this.setButtonLoading(button, false);
            }
        }
    }

    resetForm() {
        document.getElementById('eventForm').reset();
        document.getElementById('milkAmountGroup').style.display = 'none';
        document.getElementById('diaperSubtypeGroup').style.display = 'none';
        document.getElementById('sleepTrackingGroup').style.display = 'none';
        document.getElementById('diaperSubtype').value = '';
        document.querySelectorAll('.btn-diaper').forEach(btn => btn.classList.remove('selected'));
        this.setCurrentTime(); // Reset time to current time
    }

    async loadEvents() {
        const eventsSection = document.querySelector('.events-section');
        if (eventsSection) {
            this.setLoadingOverlay(eventsSection, true);
        }
        try {
            const response = await fetch('/api/events');
            if (!response.ok) {
                throw new Error('Failed to load events');
            }
            const data = await response.json();
            this.allEvents = Array.isArray(data) ? [...data] : [];
            this.events = [...this.allEvents];
            this.renderEvents();
            await this.renderTimeline();
        } catch (error) {
            console.error('Error loading events:', error);
            this.events = [];
            this.allEvents = [];
            this.renderEvents();
            await this.renderTimeline();
        } finally {
            if (eventsSection) {
                this.setLoadingOverlay(eventsSection, false);
            }
        }
    }

    renderEvents() {
        const eventsList = document.getElementById('eventsList');
        if (eventsList && !eventsList.dataset.maxHeightApplied) {
            eventsList.style.maxHeight = `${this.UI_CONSTANTS.EVENTS_LIST_MAX_HEIGHT}px`;
            eventsList.dataset.maxHeightApplied = 'true';
        }
        eventsList.innerHTML = ''; // Safe to clear

        if (this.events.length === 0) {
            const noEvents = document.createElement('p');
            noEvents.className = 'no-events';
            noEvents.textContent = 'No events recorded yet. Add your first event above!';
            eventsList.appendChild(noEvents);
            return;
        }

        this.events.forEach(event => {
            const eventElement = this.createEventElement(event);
            eventsList.appendChild(eventElement);
        });
    }

    createEventElement(event) {
        const config = this.EVENT_CONFIG[event.type] || { icon: '📝', label: event.type };
        const icon = event.type === 'diaper' && event.subtype
            ? config.subtypes?.[event.subtype]?.icon || config.icon
            : config.icon;
        const label = event.type === 'diaper' && event.subtype
            ? config.subtypes?.[event.subtype]?.label || config.label
            : config.label;

        const eventItem = document.createElement('div');
        eventItem.className = 'event-item';
        eventItem.setAttribute('data-event-id', event.id);

        const eventInfo = document.createElement('div');
        eventInfo.className = 'event-info';

        const eventIcon = document.createElement('span');
        eventIcon.className = 'event-icon';
        eventIcon.textContent = icon;

        const eventDetails = document.createElement('div');
        eventDetails.className = 'event-details';

        const eventType = document.createElement('span');
        eventType.className = 'event-type';
        eventType.textContent = label;

        const eventTimeSpan = document.createElement('span');
        eventTimeSpan.className = 'event-time';
        eventTimeSpan.textContent = this.formatDisplayTime(event.timestamp);

        const eventUser = document.createElement('span');
        eventUser.className = 'event-user';
        eventUser.textContent = `👤 ${event.user_name}`;

        const eventActions = document.createElement('div');
        eventActions.className = 'event-actions';

        // Add amount if present
        if (event.amount) {
            const eventAmount = document.createElement('span');
            eventAmount.className = 'event-amount';
            const unit = config.amountUnit || (event.type === 'milk' ? 'ml' : event.type === 'sleep' ? 'min' : '');
            eventAmount.textContent = `${event.amount}${unit}`;
            eventActions.appendChild(eventAmount);
        }

        // Add edit button
        const editButton = document.createElement('button');
        editButton.className = 'btn-edit';
        editButton.textContent = '✏️';
        editButton.title = 'Edit event';
        editButton.addEventListener('click', () => this.startInlineEdit(event.id));

        // Add remove button
        const removeButton = document.createElement('button');
        removeButton.className = 'btn-remove';
        removeButton.textContent = '🗑️';
        removeButton.title = 'Remove event';
        removeButton.addEventListener('click', () => this.removeEvent(event.id));

        // Build DOM structure
        eventDetails.appendChild(eventType);
        eventDetails.appendChild(eventTimeSpan);
        eventDetails.appendChild(eventUser);

        eventInfo.appendChild(eventIcon);
        eventInfo.appendChild(eventDetails);

        eventActions.appendChild(editButton);
        eventActions.appendChild(removeButton);

        eventItem.appendChild(eventInfo);
        eventItem.appendChild(eventActions);

        return eventItem;
    }

    async updateStats() {
        try {
            const response = await fetch('/api/stats/today');
            if (!response.ok) {
                throw new Error('Failed to load stats');
            }
            const stats = await response.json();

            document.getElementById('milkCount').textContent = stats.milk || 0;
            document.getElementById('pooCount').textContent = stats.poo || 0;
            document.getElementById('bathCount').textContent = stats.bath || 0;
            document.getElementById('sleepCount').textContent = stats.sleep || 0;
            document.getElementById('totalMilk').textContent = stats.totalMilk || 0;
            document.getElementById('totalSleep').textContent = stats.totalSleepHours || 0;
        } catch (error) {
            console.error('Error loading stats:', error);
            document.getElementById('milkCount').textContent = '0';
            document.getElementById('pooCount').textContent = '0';
            document.getElementById('bathCount').textContent = '0';
            document.getElementById('sleepCount').textContent = '0';
            document.getElementById('totalMilk').textContent = '0';
            document.getElementById('totalSleep').textContent = '0';
        } finally {
            // Always update intelligent insights even if stats endpoint fails
            this.updateFeedingIntelligence();
            this.updateSleepQuality();
            if (typeof this.updateDiaperHealth === 'function') {
                this.updateDiaperHealth();
            }
            if (typeof this.updateSmartAlerts === 'function') {
                this.updateSmartAlerts();
            }
            this.updateAdaptiveCoach();
        }
    }

    // Calculate feeding interval intelligence
    calculateFeedingIntelligence() {
        const todayEvents = this.getTodayEvents();
        const milkEvents = todayEvents.filter(e => e.type === 'milk')
            .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

        if (milkEvents.length === 0) {
            console.log('calculateFeedingIntelligence: No milk events today');
            return null;
        }

        const now = new Date();
        const lastFeed = new Date(milkEvents[milkEvents.length - 1].timestamp);
        const timeSinceLastMs = now - lastFeed;
        const hoursSince = timeSinceLastMs / (1000 * 60 * 60);
        const minutesSince = Math.floor((timeSinceLastMs % (1000 * 60 * 60)) / (1000 * 60));

        // Calculate intervals between consecutive feedings
        const intervals = [];
        for (let i = 1; i < milkEvents.length; i++) {
            const prev = new Date(milkEvents[i - 1].timestamp);
            const curr = new Date(milkEvents[i].timestamp);
            const intervalHours = (curr - prev) / (1000 * 60 * 60);
            intervals.push(intervalHours);
        }

        // Calculate average interval
        const avgInterval = intervals.length > 0
            ? intervals.reduce((sum, val) => sum + val, 0) / intervals.length
            : 3; // Default 3 hours if no history

        // Predict next feeding time
        const nextFeedDue = new Date(lastFeed.getTime() + avgInterval * 60 * 60 * 1000);
        const timeUntilNextMs = nextFeedDue - now;
        const minutesUntilNext = Math.floor(timeUntilNextMs / (1000 * 60));

        return {
            lastFeedTime: lastFeed,
            hoursSince: Math.floor(hoursSince),
            minutesSince,
            intervals: intervals.map(h => (h).toFixed(1)),
            avgInterval: avgInterval.toFixed(1),
            nextFeedDue,
            minutesUntilNext,
            isOverdue: minutesUntilNext < 0
        };
    }

    // Calculate sleep quality metrics
    calculateSleepQuality() {
        const todayEvents = this.getTodayEvents();
        const sleepEvents = todayEvents.filter(e => e.type === 'sleep')
            .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

        if (sleepEvents.length === 0) {
            console.log('calculateSleepQuality: No sleep events today');
            return null;
        }

        // Calculate total sleep in hours
        const totalSleepMinutes = sleepEvents.reduce((sum, e) => sum + (e.amount || 0), 0);
        const totalSleepHours = totalSleepMinutes / 60;

        // Calculate last 3 days sleep breakdown by day
        const last3DaysBreakdown = this.getLast3DaysSleepBreakdown();

        // Calculate total for last 3 days
        const last3DaysTotalHours = last3DaysBreakdown.reduce((sum, day) => sum + day.hours, 0);
        const last3DaysSessionCount = last3DaysBreakdown.reduce((sum, day) => sum + day.sessionCount, 0);

        // Find longest sleep stretch
        const longestSleep = Math.max(...sleepEvents.map(e => e.amount || 0));
        const longestSleepEvent = sleepEvents.find(e => e.amount === longestSleep);

        // Calculate average nap duration
        const avgNapMinutes = totalSleepMinutes / sleepEvents.length;

        // Calculate wake windows (gaps between sleep sessions)
        // Only include sessions with valid start and end times
        const wakeWindows = [];
        for (let i = 1; i < sleepEvents.length; i++) {
            const prev = sleepEvents[i - 1];
            const curr = sleepEvents[i];

            // Skip if either event is missing timestamps
            if (!prev.sleep_end_time || !curr.sleep_start_time) {
                console.warn('Sleep event missing timestamps:', { prev: prev.id, curr: curr.id });
                continue;
            }

            const prevEnd = new Date(prev.sleep_end_time);
            const currStart = new Date(curr.sleep_start_time);

            // Validate dates
            if (isNaN(prevEnd.getTime()) || isNaN(currStart.getTime())) {
                console.warn('Invalid sleep timestamps:', { prevEnd: prev.sleep_end_time, currStart: curr.sleep_start_time });
                continue;
            }

            const gapHours = (currStart - prevEnd) / (1000 * 60 * 60);

            // Only add positive gaps (negative would mean overlapping sessions)
            if (gapHours > 0) {
                wakeWindows.push(gapHours);
            }
        }

        // Find longest wake window
        const longestWake = wakeWindows.length > 0 ? Math.max(...wakeWindows) : 0;

        // Recommended sleep for newborn (adjustable based on age)
        const recommendedHours = 15.5;
        const sleepPercentage = (totalSleepHours / recommendedHours) * 100;

        return {
            totalHours: totalSleepHours.toFixed(1),
            totalMinutes: totalSleepMinutes,
            sessionCount: sleepEvents.length,
            longestStretchMinutes: longestSleep,
            longestStretchHours: (longestSleep / 60).toFixed(1),
            avgNapMinutes: Math.round(avgNapMinutes),
            avgNapHours: (avgNapMinutes / 60).toFixed(1),
            wakeWindows: wakeWindows.map(h => h.toFixed(1)),
            longestWakeHours: longestWake.toFixed(1),
            recommendedHours,
            sleepPercentage: Math.round(sleepPercentage),
            isUnderslept: sleepPercentage < 85,
            last3DaysTotalHours: last3DaysTotalHours.toFixed(1),
            last3DaysSessionCount,
            last3DaysBreakdown
        };
    }

    // Helper method to get events from last N days
    getEventsFromLastNDays(days) {
        const now = new Date();
        const cutoffDate = new Date(now);
        cutoffDate.setDate(cutoffDate.getDate() - days);

        return this.allEvents.filter(event => {
            const eventDate = new Date(event.timestamp);
            return eventDate >= cutoffDate && eventDate <= now;
        });
    }

    // Get sleep breakdown for the last 3 days
    getLast3DaysSleepBreakdown() {
        const breakdown = [];

        for (let i = 0; i < 3; i++) {
            const date = new Date();
            date.setDate(date.getDate() - i);

            // Get start and end of this day in home timezone
            const formatter = new Intl.DateTimeFormat('en-US', {
                timeZone: this.homeTimezone,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
            });

            const parts = formatter.formatToParts(date);
            const year = parseInt(parts.find(p => p.type === 'year').value);
            const month = parseInt(parts.find(p => p.type === 'month').value);
            const day = parseInt(parts.find(p => p.type === 'day').value);

            // Create start and end of day
            const startStr = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}T00:00:00`;
            const endStr = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}T23:59:59.999`;

            const dayStart = this.parseInTimezone(startStr, this.homeTimezone);
            const dayEnd = this.parseInTimezone(endStr, this.homeTimezone);

            // Get sleep events for this day
            const daySleepEvents = this.allEvents.filter(event => {
                if (event.type !== 'sleep') {return false;}
                const eventDate = new Date(event.timestamp);
                return eventDate >= dayStart && eventDate <= dayEnd;
            });

            // Calculate total sleep for this day
            const totalMinutes = daySleepEvents.reduce((sum, e) => sum + (e.amount || 0), 0);
            const totalHours = totalMinutes / 60;

            // Create label
            let label;
            if (i === 0) {
                label = 'Today';
            } else if (i === 1) {
                label = 'Yesterday';
            } else {
                label = `${month}/${day}`;
            }

            breakdown.push({
                label,
                hours: totalHours,
                sessionCount: daySleepEvents.length,
                date: `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`
            });
        }

        return breakdown;
    }

    // Get today's events in home timezone
    getTodayEvents() {
        try {
            const now = new Date();

            // Get the current date in home timezone using proper timezone conversion
            const formatter = new Intl.DateTimeFormat('en-US', {
                timeZone: this.homeTimezone,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour12: false
            });

            const parts = formatter.formatToParts(now);
            const year = parseInt(parts.find(p => p.type === 'year').value);
            const month = parseInt(parts.find(p => p.type === 'month').value);
            const day = parseInt(parts.find(p => p.type === 'day').value);

            // Create start of day in home timezone (00:00:00)
            const startStr = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}T00:00:00`;
            const todayStart = this.parseInTimezone(startStr, this.homeTimezone);

            // Create end of day in home timezone (23:59:59.999)
            const endStr = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}T23:59:59.999`;
            const todayEnd = this.parseInTimezone(endStr, this.homeTimezone);

            return this.allEvents.filter(event => {
                const eventDate = new Date(event.timestamp);
                return eventDate >= todayStart && eventDate <= todayEnd;
            });
        } catch (error) {
            console.error('Error in getTodayEvents:', error);
            // Fallback to simple date comparison in case of error
            const now = new Date();
            const todayStart = new Date(now);
            todayStart.setHours(0, 0, 0, 0);
            const todayEnd = new Date(now);
            todayEnd.setHours(23, 59, 59, 999);

            return this.allEvents.filter(event => {
                const eventDate = new Date(event.timestamp);
                return eventDate >= todayStart && eventDate <= todayEnd;
            });
        }
    }

    // Parse a datetime string in a specific timezone and return UTC Date object
    parseInTimezone(dateTimeStr, timeZone) {
        // dateTimeStr format: "YYYY-MM-DDTHH:mm:ss" or "YYYY-MM-DDTHH:mm:ss.sss"
        const parts = dateTimeStr.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?/);
        if (!parts) {
            throw new Error(`Invalid datetime format: ${dateTimeStr}`);
        }

        const [, year, month, day, hour, minute, second, ms = '0'] = parts;

        // Create a date string that will be interpreted in the target timezone
        // We'll use Intl.DateTimeFormat to get the offset for this specific date/time
        const testDate = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);

        // Get the formatted string in the target timezone
        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
            timeZoneName: 'short'
        });

        // Calculate offset by comparing UTC to timezone
        // Create the intended time as if it were UTC
        const utcDate = new Date(Date.UTC(
            parseInt(year),
            parseInt(month) - 1,
            parseInt(day),
            parseInt(hour),
            parseInt(minute),
            parseInt(second),
            parseInt(ms)
        ));

        // Get what time it shows in the target timezone
        const tzParts = formatter.formatToParts(utcDate);
        const tzYear = parseInt(tzParts.find(p => p.type === 'year').value);
        const tzMonth = parseInt(tzParts.find(p => p.type === 'month').value);
        const tzDay = parseInt(tzParts.find(p => p.type === 'day').value);
        const tzHour = parseInt(tzParts.find(p => p.type === 'hour').value);
        const tzMinute = parseInt(tzParts.find(p => p.type === 'minute').value);
        const tzSecond = parseInt(tzParts.find(p => p.type === 'second').value);

        // Calculate the offset in milliseconds
        const intendedTime = Date.UTC(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute), parseInt(second), parseInt(ms));
        const actualTime = Date.UTC(tzYear, tzMonth - 1, tzDay, tzHour, tzMinute, tzSecond, parseInt(ms));
        const offset = actualTime - utcDate.getTime();

        // Apply the offset to get the correct UTC time
        return new Date(intendedTime - offset);
    }

    // Update feeding intelligence UI
    updateFeedingIntelligence() {
        const intelligence = this.calculateFeedingIntelligence();
        const container = document.getElementById('feedingIntelligence');

        if (!container) {return;}

        if (!intelligence) {
            container.innerHTML = '<p class="no-data">No feeding data yet today</p>';
            return;
        }

        const overdueBadge = intelligence.isOverdue
            ? '<span class="alert-badge">Overdue</span>'
            : '';

        const timeUntilText = intelligence.isOverdue
            ? `${Math.abs(intelligence.minutesUntilNext)} min overdue`
            : `~${intelligence.minutesUntilNext} min`;

        container.innerHTML = `
            <div class="intelligence-card">
                <h3>🍼 Feeding Intelligence</h3>
                <div class="intel-row">
                    <span class="intel-label">Last fed:</span>
                    <span class="intel-value">${intelligence.hoursSince}h ${intelligence.minutesSince}m ago</span>
                </div>
                <div class="intel-row">
                    <span class="intel-label">Next feed due:</span>
                    <span class="intel-value ${intelligence.isOverdue ? 'alert-text' : ''}">${timeUntilText} ${overdueBadge}</span>
                </div>
                <div class="intel-row">
                    <span class="intel-label">Average interval:</span>
                    <span class="intel-value">${intelligence.avgInterval}h</span>
                </div>
                ${intelligence.intervals.length > 1 ? `
                <div class="intel-row">
                    <span class="intel-label">Today's pattern:</span>
                    <span class="intel-value intel-pattern">${intelligence.intervals.join('h → ')}h</span>
                </div>
                ` : ''}
            </div>
        `;
    }

    // Update sleep quality UI
    updateSleepQuality() {
        const quality = this.calculateSleepQuality();
        const container = document.getElementById('sleepQuality');

        if (!container) {return;}

        if (!quality) {
            container.innerHTML = '<p class="no-data">No sleep data yet today</p>';
            return;
        }

        const percentageClass = quality.sleepPercentage >= 90 ? 'good' :
                               quality.sleepPercentage >= 75 ? 'okay' : 'alert';

        const wakeAlert = parseFloat(quality.longestWakeHours) > 4
            ? '<span class="alert-badge">Long wake window</span>'
            : '';

        // Build daily breakdown display (excluding today to avoid duplication)
        let breakdownHtml = '';
        if (quality.last3DaysBreakdown && quality.last3DaysBreakdown.length > 0) {
            breakdownHtml = quality.last3DaysBreakdown
                .filter(day => day.label !== 'Today') // Exclude today as it's shown in "Total today"
                .map(day => `<div class="intel-row">
                        <span class="intel-label">${day.label}:</span>
                        <span class="intel-value">${day.hours.toFixed(1)}h (${day.sessionCount} sessions)</span>
                    </div>`).join('');
        }

        container.innerHTML = `
            <div class="intelligence-card">
                <h3>😴 Sleep Quality</h3>
                <div class="intel-row">
                    <span class="intel-label">Total today:</span>
                    <span class="intel-value">${quality.totalHours}h (${quality.sleepPercentage}% of ${quality.recommendedHours}h)</span>
                    <span class="percentage-badge ${percentageClass}">${quality.sleepPercentage}%</span>
                </div>
                ${breakdownHtml}
                <div class="intel-row">
                    <span class="intel-label">Longest stretch:</span>
                    <span class="intel-value">${quality.longestStretchHours}h (${this.formatMinutes(quality.longestStretchMinutes)})</span>
                </div>
                <div class="intel-row">
                    <span class="intel-label">Sleep sessions:</span>
                    <span class="intel-value">${quality.sessionCount} naps</span>
                </div>
                <div class="intel-row">
                    <span class="intel-label">Average nap:</span>
                    <span class="intel-value">${quality.avgNapHours}h (${quality.avgNapMinutes} min)</span>
                </div>
                ${quality.wakeWindows.length > 0 ? `
                <div class="intel-row">
                    <span class="intel-label">Wake windows:</span>
                    <span class="intel-value intel-pattern">${quality.wakeWindows.join('h, ')}h ${wakeAlert}</span>
                </div>
                ` : ''}
            </div>
        `;
    }

    // Update Adaptive Coach insights
    updateAdaptiveCoach() {
        const container = document.getElementById('adaptiveCoach');
        if (!container) {return;}

        // Create analyzer and generate insights
        const analyzer = new PatternAnalyzer(this.events || [], this.homeTimezone);
        const insights = analyzer.generateInsights();

        if (!insights || insights.length === 0) {
            container.innerHTML = '<p class="no-data">No insights yet - keep tracking!</p>';
            return;
        }

        // Render insights
        const insightsHtml = insights.slice(0, 3).map(insight => {
            const confidenceColor = insight.confidence > 0.7 ? '#10b981' :
                                   insight.confidence > 0.4 ? '#f59e0b' : '#ef4444';
            return `
                <div class="insights-card coach-insight ${insight.type}">
                    <div class="insight-header">
                        <h4>${insight.title}</h4>
                        ${insight.confidence > 0 ? `<span class="confidence" style="background: ${confidenceColor}" title="Confidence: ${Math.round(insight.confidence * 100)}%">${Math.round(insight.confidence * 100)}%</span>` : ''}
                    </div>
                    <p class="insight-description">${insight.description}</p>
                    ${insight.recommendation ? `<p class="insight-recommendation">💡 ${insight.recommendation}</p>` : ''}
                    ${insight.dataPoints > 0 ? `<p class="insight-data">📊 Based on ${insight.dataPoints} data points</p>` : ''}
                </div>
            `;
        }).join('');

        container.innerHTML = `
            <div class="intelligence-card">
                <h3>🎯 Adaptive Parenting Coach</h3>
                <div class="coach-insights">
                    ${insightsHtml}
                </div>
            </div>
        `;
    }

    // Helper to format minutes as "Xh Ym"
    formatMinutes(minutes) {
        const h = Math.floor(minutes / 60);
        const m = minutes % 60;
        return h > 0 ? `${h}h ${m}m` : `${m}m`;
    }

    // Calculate diaper health metrics
    calculateDiaperHealth() {
        const todayEvents = this.getTodayEvents();
        const diaperEvents = todayEvents.filter(e =>
            e.type === 'diaper' || e.type === 'poo'
        ).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

        if (diaperEvents.length === 0) {
            return null;
        }

        const now = new Date();

        // Count by subtype
        let peeCount = 0;
        let pooCount = 0;
        let bothCount = 0;

        // Track last occurrence of each type
        let lastPeeTime = null;
        let lastPooTime = null;
        let lastChangeTime = null;

        diaperEvents.forEach(event => {
            const eventTime = new Date(event.timestamp);

            if (event.type === 'poo') {
                // Legacy poo events count as poo
                pooCount++;
                lastPooTime = eventTime;
                lastChangeTime = eventTime;
            } else if (event.subtype === 'pee') {
                peeCount++;
                lastPeeTime = eventTime;
                lastChangeTime = eventTime;
            } else if (event.subtype === 'poo') {
                pooCount++;
                lastPooTime = eventTime;
                lastChangeTime = eventTime;
            } else if (event.subtype === 'both') {
                bothCount++;
                peeCount++; // Both counts as pee
                pooCount++; // Both counts as poo
                lastPeeTime = eventTime;
                lastPooTime = eventTime;
                lastChangeTime = eventTime;
            }
        });

        // Calculate time since last change
        const timeSinceLastMs = lastChangeTime ? now - lastChangeTime : null;
        const hoursSinceLast = timeSinceLastMs ? Math.floor(timeSinceLastMs / (1000 * 60 * 60)) : null;
        const minutesSinceLast = timeSinceLastMs ? Math.floor((timeSinceLastMs % (1000 * 60 * 60)) / (1000 * 60)) : null;

        // Calculate time since last pee
        const timeSincePeeMs = lastPeeTime ? now - lastPeeTime : null;
        const hoursSincePee = timeSincePeeMs ? Math.floor(timeSincePeeMs / (1000 * 60 * 60)) : null;
        const minutesSincePee = timeSincePeeMs ? Math.floor((timeSincePeeMs % (1000 * 60 * 60)) / (1000 * 60)) : null;

        // Calculate time since last poo
        const timeSincePooMs = lastPooTime ? now - lastPooTime : null;
        const hoursSincePoo = timeSincePooMs ? Math.floor(timeSincePooMs / (1000 * 60 * 60)) : null;
        const minutesSincePoo = timeSincePooMs ? Math.floor((timeSincePooMs % (1000 * 60 * 60)) / (1000 * 60)) : null;

        // Calculate average pee frequency
        const peeEvents = diaperEvents.filter(e =>
            e.subtype === 'pee' || e.subtype === 'both'
        );
        let avgPeeInterval = null;
        if (peeEvents.length > 1) {
            const intervals = [];
            for (let i = 1; i < peeEvents.length; i++) {
                const prev = new Date(peeEvents[i - 1].timestamp);
                const curr = new Date(peeEvents[i].timestamp);
                intervals.push((curr - prev) / (1000 * 60 * 60));
            }
            avgPeeInterval = intervals.reduce((sum, val) => sum + val, 0) / intervals.length;
        }

        return {
            totalChanges: diaperEvents.length,
            peeCount,
            pooCount,
            bothCount,
            lastChangeTime,
            hoursSinceLast,
            minutesSinceLast,
            lastPeeTime,
            hoursSincePee,
            minutesSincePee,
            lastPooTime,
            hoursSincePoo,
            minutesSincePoo,
            avgPeeInterval: avgPeeInterval ? avgPeeInterval.toFixed(1) : null,
            // Alerts
            noPeeAlert: hoursSincePee >= 4,
            noPooAlert: hoursSincePoo >= 24,
            noChangeAlert: hoursSinceLast >= 3
        };
    }

    // Calculate smart alerts
    calculateSmartAlerts() {
        const todayEvents = this.getTodayEvents();
        const alerts = [];
        const now = new Date();

        // Check feeding alerts
        const feedingIntel = this.calculateFeedingIntelligence();
        if (feedingIntel && feedingIntel.isOverdue && feedingIntel.minutesUntilNext < -15) {
            alerts.push({
                type: 'feeding',
                severity: 'warning',
                icon: '🍼',
                message: `Feeding overdue by ${Math.abs(feedingIntel.minutesUntilNext)} minutes`
            });
        }

        // Check diaper alerts
        const diaperHealth = this.calculateDiaperHealth();
        if (diaperHealth) {
            if (diaperHealth.noPeeAlert) {
                alerts.push({
                    type: 'diaper',
                    severity: 'alert',
                    icon: '💧',
                    message: `No wet diaper in ${diaperHealth.hoursSincePee}h ${diaperHealth.minutesSincePee}m - check hydration`
                });
            }
            if (diaperHealth.noChangeAlert) {
                alerts.push({
                    type: 'diaper',
                    severity: 'warning',
                    icon: '💩',
                    message: `No diaper change in ${diaperHealth.hoursSinceLast}h ${diaperHealth.minutesSinceLast}m`
                });
            }
            if (diaperHealth.noPooAlert) {
                alerts.push({
                    type: 'diaper',
                    severity: 'info',
                    icon: '💩',
                    message: `No poo in ${diaperHealth.hoursSincePoo}h - monitor for constipation`
                });
            }
        }

        // Check sleep alerts
        const sleepQuality = this.calculateSleepQuality();
        if (sleepQuality) {
            if (sleepQuality.sleepPercentage < 75) {
                const deficit = sleepQuality.recommendedHours - parseFloat(sleepQuality.totalHours);
                alerts.push({
                    type: 'sleep',
                    severity: 'alert',
                    icon: '😴',
                    message: `Only ${sleepQuality.totalHours}h sleep - ${deficit.toFixed(1)}h below recommended`
                });
            }
            if (parseFloat(sleepQuality.longestWakeHours) > 4) {
                alerts.push({
                    type: 'sleep',
                    severity: 'warning',
                    icon: '😴',
                    message: `Wake window of ${sleepQuality.longestWakeHours}h exceeds 4h - baby may be overtired`
                });
            }
        }

        return alerts;
    }

    // Update diaper health UI
    updateDiaperHealth() {
        const health = this.calculateDiaperHealth();
        const container = document.getElementById('diaperHealth');

        if (!container) {return;}

        if (!health) {
            container.innerHTML = '<p class="no-data">No diaper data yet today</p>';
            return;
        }

        const lastChangeSubtype = health.lastChangeTime ?
            (health.bothCount > 0 ? 'both' :
             health.hoursSincePee === health.hoursSinceLast ? 'pee' : 'poo') : '';

        const peeAlert = health.noPeeAlert ? '<span class="alert-badge">Dehydration risk</span>' : '✅';
        const pooAlert = health.noPooAlert ? '<span class="alert-badge">Monitor</span>' : '✅';

        container.innerHTML = `
            <div class="intelligence-card">
                <h3>💩 Diaper Health</h3>
                <div class="intel-row">
                    <span class="intel-label">Today:</span>
                    <span class="intel-value">${health.totalChanges} changes (${health.peeCount} pee, ${health.pooCount} poo${health.bothCount > 0 ? `, ${health.bothCount} both` : ''})</span>
                </div>
                ${health.lastChangeTime ? `
                <div class="intel-row">
                    <span class="intel-label">Last change:</span>
                    <span class="intel-value">${health.hoursSinceLast}h ${health.minutesSinceLast}m ago</span>
                </div>
                ` : ''}
                ${health.lastPeeTime ? `
                <div class="intel-row">
                    <span class="intel-label">Last pee:</span>
                    <span class="intel-value ${health.noPeeAlert ? 'alert-text' : ''}">${health.hoursSincePee}h ${health.minutesSincePee}m ago ${peeAlert}</span>
                </div>
                ` : ''}
                ${health.lastPooTime ? `
                <div class="intel-row">
                    <span class="intel-label">Last poo:</span>
                    <span class="intel-value ${health.noPooAlert ? 'alert-text' : ''}">${health.hoursSincePoo}h ${health.minutesSincePoo}m ago ${pooAlert}</span>
                </div>
                ` : ''}
                ${health.avgPeeInterval ? `
                <div class="intel-row">
                    <span class="intel-label">Pee frequency:</span>
                    <span class="intel-value">Every ${health.avgPeeInterval}h average</span>
                </div>
                ` : ''}
            </div>
        `;
    }

    // Update smart alerts UI
    updateSmartAlerts() {
        const alerts = this.calculateSmartAlerts();
        const container = document.getElementById('smartAlerts');

        if (!container) {return;}

        if (!alerts || alerts.length === 0) {
            container.innerHTML = '<p class="no-data">✅ No alerts - everything looks good!</p>';
            return;
        }

        const alertsHtml = alerts.map(alert => {
            const severityClass = alert.severity === 'alert' ? 'alert-critical' :
                                 alert.severity === 'warning' ? 'alert-warning' : 'alert-info';
            return `
                <div class="alert-item ${severityClass}">
                    <span class="alert-icon">${alert.icon}</span>
                    <span class="alert-message">${alert.message}</span>
                </div>
            `;
        }).join('');

        container.innerHTML = `
            <div class="intelligence-card alerts-card">
                <h3>⚠️ Smart Alerts</h3>
                <div class="alerts-list">
                    ${alertsHtml}
                </div>
            </div>
        `;
    }

    // Remove a single event
    async removeEvent(eventId) {
        if (!confirm('Are you sure you want to remove this event?')) {
            return;
        }

        const eventItem = document.querySelector(`[data-event-id="${eventId}"]`);
        const deleteButton = eventItem?.querySelector('.btn-remove');
        this.setButtonLoading(deleteButton, true);
        let loadingActive = true;

        try {
            const response = await fetch(`/api/events/${eventId}`, {
                method: 'DELETE'
            });

            if (!response.ok) {
                throw new Error('Failed to remove event');
            }

            if (eventItem) {
                const durationMs = this.UI_CONSTANTS.ANIMATION_DURATION || 300;
                eventItem.style.transition = `opacity ${durationMs}ms ease, transform ${durationMs}ms ease`;
                eventItem.style.opacity = '0';
                eventItem.style.transform = 'translateX(-20px)';
                await new Promise(resolve => setTimeout(resolve, durationMs));
            }

            await this.loadEvents();
            await this.updateStats();
            await this.renderTimeline();

            this.setButtonLoading(deleteButton, false);
            loadingActive = false;
        } catch (error) {
            console.error('Error removing event:', error);
            alert(`Failed to remove event: ${  error.message}`);
        } finally {
            if (loadingActive) {
                this.setButtonLoading(deleteButton, false);
            }
        }
    }

    // Start inline editing for an event
    startInlineEdit(eventId) {
        const event = this.events.find(e => e.id === eventId);
        if (!event) {return;}

        const eventItem = document.querySelector(`[data-event-id="${eventId}"]`);
        if (!eventItem) {return;}

        const config = this.EVENT_CONFIG[event.type] || {};

        eventItem.innerHTML = '';
        eventItem.classList.add('editing');

        const eventInfo = document.createElement('div');
        eventInfo.className = 'event-info';

        const eventIcon = document.createElement('span');
        eventIcon.className = 'event-icon';
        eventIcon.textContent = config.icon || '📝';
        eventInfo.appendChild(eventIcon);

        const eventDetails = document.createElement('div');
        eventDetails.className = 'event-details';

        const typeSelect = document.createElement('select');
        typeSelect.className = 'edit-type';
        Object.entries(this.EVENT_CONFIG).forEach(([type, typeConfig]) => {
            const option = document.createElement('option');
            option.value = type;
            option.textContent = `${typeConfig.icon} ${typeConfig.label}`;
            if (type === event.type) {
                option.selected = true;
            }
            typeSelect.appendChild(option);
        });
        eventDetails.appendChild(typeSelect);

        const timeInput = document.createElement('input');
        timeInput.type = 'datetime-local';
        timeInput.className = 'edit-time';
        timeInput.value = this.formatDateTimeLocal(event.timestamp);
        timeInput.setAttribute('aria-label', 'Event time');
        eventDetails.appendChild(timeInput);

        eventInfo.appendChild(eventDetails);
        eventItem.appendChild(eventInfo);

        const eventActions = document.createElement('div');
        eventActions.className = 'event-actions';

        const amountGroup = document.createElement('div');
        amountGroup.className = 'edit-amount-group';
        const amountInput = document.createElement('input');
        amountInput.type = 'number';
        amountInput.className = 'edit-amount';
        amountInput.value = event.amount || '';
        amountInput.min = '0';
        amountInput.style.width = '80px';
        amountInput.style.padding = '4px 8px';
        amountGroup.appendChild(amountInput);
        eventActions.appendChild(amountGroup);

        const diaperSubtypeGroup = document.createElement('div');
        diaperSubtypeGroup.className = 'edit-diaper-subtype-group';
        diaperSubtypeGroup.style.display = 'none';
        const diaperSubtypeSelect = document.createElement('select');
        diaperSubtypeSelect.className = 'edit-diaper-subtype';
        diaperSubtypeSelect.style.padding = '4px 8px';
        diaperSubtypeSelect.style.marginRight = '10px';
        if (this.EVENT_CONFIG.diaper?.subtypes) {
            Object.entries(this.EVENT_CONFIG.diaper.subtypes).forEach(([value, subtypeConfig]) => {
                const option = document.createElement('option');
                option.value = value;
                option.textContent = subtypeConfig.label;
                if (value === event.subtype) {
                    option.selected = true;
                }
                diaperSubtypeSelect.appendChild(option);
            });
        }
        diaperSubtypeGroup.appendChild(diaperSubtypeSelect);
        eventActions.appendChild(diaperSubtypeGroup);

        const saveButton = document.createElement('button');
        saveButton.className = 'btn-save';
        saveButton.textContent = '💾';
        saveButton.title = 'Save changes';
        saveButton.addEventListener('click', () => this.saveInlineEdit(eventId));
        eventActions.appendChild(saveButton);

        const cancelButton = document.createElement('button');
        cancelButton.className = 'btn-cancel';
        cancelButton.textContent = '❌';
        cancelButton.title = 'Cancel';
        cancelButton.addEventListener('click', () => this.cancelInlineEdit(eventId));
        eventActions.appendChild(cancelButton);

        eventItem.appendChild(eventActions);

        const updateFieldVisibility = (selectedType) => {
            const selectedConfig = this.EVENT_CONFIG[selectedType] || {};
            if (selectedConfig.requiresAmount) {
                amountGroup.style.display = 'block';
                amountInput.max = selectedConfig.amountMax || '500';
                amountInput.placeholder = selectedConfig.amountPlaceholder || 'Amount';
            } else {
                amountGroup.style.display = 'none';
            }

            if (selectedType === 'diaper') {
                diaperSubtypeGroup.style.display = 'block';
            } else {
                diaperSubtypeGroup.style.display = 'none';
            }
        };

        updateFieldVisibility(event.type);

        typeSelect.addEventListener('change', (e) => {
            updateFieldVisibility(e.target.value);
        });
    }

    // Save inline edit changes
    async saveInlineEdit(eventId) {
        const eventItem = document.querySelector(`[data-event-id="${eventId}"]`);
        if (!eventItem) {return;}

        const typeSelect = eventItem.querySelector('.edit-type');
        const amountInput = eventItem.querySelector('.edit-amount');
        const diaperSubtypeSelect = eventItem.querySelector('.edit-diaper-subtype');
        const timeInput = eventItem.querySelector('.edit-time');
        const saveButton = eventItem.querySelector('.btn-save');

        const newType = typeSelect.value;
        const selectedConfig = this.EVENT_CONFIG[newType] || {};
        let newAmount = null;
        let diaperSubtype = null;

        if (selectedConfig.requiresAmount) {
            if (!amountInput.value || isNaN(amountInput.value) || parseInt(amountInput.value) <= 0) {
                const amountLabel = newType === 'milk' ? 'milk amount' : 'sleep duration';
                alert(`Please enter a valid ${amountLabel}`);
                return;
            }
            newAmount = parseInt(amountInput.value);
        }

        if (newType === 'diaper') {
            if (!diaperSubtypeSelect || !diaperSubtypeSelect.value) {
                alert('Please select a diaper subtype');
                return;
            }
            diaperSubtype = diaperSubtypeSelect.value;
        }

        if (!timeInput || !timeInput.value) {
            alert('Please select a valid date and time');
            return;
        }

        const isoTimestamp = this.convertInputToHomeISO(timeInput.value);
        if (!isoTimestamp) {
            alert('Please enter a valid date and time');
            return;
        }

        this.setButtonLoading(saveButton, true, 'Saving...');
        let loadingActive = true;

        try {
            const requestBody = {
                type: newType,
                amount: newAmount,
                timestamp: isoTimestamp
            };

            if (newType === 'diaper') {
                requestBody.diaperSubtype = diaperSubtype;
            }

            const response = await fetch(`/api/events/${eventId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                let errorMessage = 'Failed to update event';
                try {
                    const errorData = await response.json();
                    errorMessage = errorData.error || errorMessage;
                } catch (jsonError) {
                    // If response is not JSON, use status text
                    errorMessage = response.statusText || errorMessage;
                }
                throw new Error(errorMessage);
            }

            await this.loadEvents();
            await this.updateStats();
            await this.renderTimeline();
            this.setButtonLoading(saveButton, false);
            loadingActive = false;
            this.showButtonSuccess(saveButton, 'Saved!');
        } catch (error) {
            console.error('Error updating event:', error);
            alert(`Failed to update event: ${  error.message}`);
        } finally {
            if (loadingActive) {
                this.setButtonLoading(saveButton, false);
            }
        }
    }

    // Cancel inline editing
    cancelInlineEdit(eventId) {
        this.loadEvents();
    }

    // Apply date filter
    async applyDateFilter(filterType) {
        try {
            const filter = {};
            const today = new Date();
            const todayString = this.formatLocalDate(today);

            switch (filterType) {
                case 'today': {
                    filter.startDate = todayString;
                    filter.endDate = todayString;
                    break;
                }
                case 'yesterday': {
                    const yesterday = new Date(today);
                    yesterday.setDate(yesterday.getDate() - 1);
                    const formatted = this.formatLocalDate(yesterday);
                    filter.startDate = formatted;
                    filter.endDate = formatted;
                    break;
                }
                case 'last7': {
                    const start = new Date(today);
                    start.setDate(start.getDate() - 6);
                    filter.startDate = this.formatLocalDate(start);
                    filter.endDate = todayString;
                    break;
                }
                case 'last30': {
                    const start = new Date(today);
                    start.setDate(start.getDate() - 29);
                    filter.startDate = this.formatLocalDate(start);
                    filter.endDate = todayString;
                    break;
                }
                case 'all':
                    await this.loadEvents();
                    return;
                default:
                    await this.loadEvents();
                    return;
            }

            const response = await fetch(`/api/events?filter=${encodeURIComponent(JSON.stringify(filter))}`);
            if (!response.ok) {
                throw new Error('Failed to load filtered events');
            }
            this.events = await response.json();
            this.renderEvents();
        } catch (error) {
            console.error('Error applying date filter:', error);
            alert('Failed to apply date filter');
        }
    }

    // Apply custom date range filter
    async applyCustomDateFilter() {
        const startDate = document.getElementById('startDate').value;
        const endDate = document.getElementById('endDate').value;

        if (!startDate || !endDate) {
            alert('Please select both start and end dates');
            return;
        }

        if (new Date(startDate) > new Date(endDate)) {
            alert('Start date cannot be after end date');
            return;
        }

        try {
            const filter = {
                startDate,
                endDate
            };

            const response = await fetch(`/api/events?filter=${encodeURIComponent(JSON.stringify(filter))}`);
            if (!response.ok) {
                throw new Error('Failed to load filtered events');
            }
            this.events = await response.json();
            this.renderEvents();
        } catch (error) {
            console.error('Error applying custom date filter:', error);
            alert('Failed to apply custom date filter');
        }
    }

    // Apply type filter
    async applyTypeFilter(type) {
        try {
            if (type === 'all') {
                // Reload all events
                await this.loadEvents();
            } else {
                // Filter by type
                const response = await fetch(`/api/events?type=${type}`);
                if (!response.ok) {
                    throw new Error('Failed to load filtered events');
                }
                this.events = await response.json();
                this.renderEvents();
            }
        } catch (error) {
            console.error('Error applying type filter:', error);
            alert('Failed to apply type filter');
        }
    }

    // Export to CSV
    exportToCSV() {
        if (this.events.length === 0) {
            alert('No events to export');
            return;
        }

        const headers = ['Type', 'Amount (ml)', 'User', 'Date', 'Time'];
        const csvData = this.events.map(event => {
            const date = new Date(event.timestamp);
            return [
                event.type,
                event.amount || '',
                event.user_name,
                date.toLocaleDateString(),
                date.toLocaleTimeString()
            ];
        });

        const csvContent = [headers, ...csvData]
            .map(row => row.map(field => `"${field}"`).join(','))
            .join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `baby-events-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }

    // Export to PDF (simple implementation)
    exportToPDF() {
        if (this.events.length === 0) {
            alert('No events to export');
            return;
        }

        // Simple PDF generation using window.print() for now
        // In a real implementation, you might use a library like jsPDF
        const printWindow = window.open('', '_blank');
        printWindow.document.write(`
            <html>
                <head>
                    <title>Baby Events Report</title>
                    <style>
                        body { font-family: Arial, sans-serif; margin: 20px; }
                        h1 { color: #333; }
                        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                        th { background-color: #f2f2f2; }
                    </style>
                </head>
                <body>
                    <h1>Baby Events Report</h1>
                    <p>Generated on: ${new Date().toLocaleString()}</p>
                    <table>
                        <thead>
                            <tr>
                                <th>Type</th>
                                <th>Amount (ml)</th>
                                <th>User</th>
                                <th>Date</th>
                                <th>Time</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${this.events.map(event => {
                                const date = new Date(event.timestamp);
                                return `
                                    <tr>
                                        <td>${event.type}</td>
                                        <td>${event.amount || ''}</td>
                                        <td>${event.user_name}</td>
                                        <td>${date.toLocaleDateString()}</td>
                                        <td>${date.toLocaleTimeString()}</td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </body>
            </html>
        `);
        printWindow.document.close();
        printWindow.print();
    }

    updateThemeIcon(button) {
        if (!button) {return;}
        const iconSpan = button.querySelector('.theme-icon');
        if (!iconSpan) {return;}
        iconSpan.textContent = document.body.classList.contains('dark-mode') ? '☀️' : '🌙';
    }

    formatDateTimeInTimezone(date, timeZone) {
        try {
            const formatter = new Intl.DateTimeFormat('en-CA', {
                timeZone: timeZone || this.homeTimezone || this.localTimezone,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
            });
            const parts = formatter.formatToParts(date);
            const getPart = (type) => parts.find(part => part.type === type)?.value || '00';
            return `${getPart('year')}-${getPart('month')}-${getPart('day')}T${getPart('hour')}:${getPart('minute')}`;
        } catch (error) {
            console.error('Failed to format datetime for timezone', error);
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const hours = String(date.getHours()).padStart(2, '0');
            const minutes = String(date.getMinutes()).padStart(2, '0');
            return `${year}-${month}-${day}T${hours}:${minutes}`;
        }
    }

    convertInputToHomeISO(value) {
        if (!value) {
            return null;
        }

        try {
            // The datetime-local input gives us a string like "2025-11-19T14:30"
            // We need to interpret this as being in the home timezone and convert to UTC

            // Parse the value as-is (it comes from datetime-local input)
            const match = value.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
            if (!match) {
                console.error('Invalid datetime-local format:', value);
                return null;
            }

            const [, year, month, day, hour, minute] = match;
            const dateTimeStr = `${year}-${month}-${day}T${hour}:${minute}:00`;

            // Use parseInTimezone to interpret this datetime in the home timezone
            const utcDate = this.parseInTimezone(dateTimeStr, this.homeTimezone);

            if (!utcDate || isNaN(utcDate.getTime())) {
                console.error('Failed to parse datetime in timezone:', dateTimeStr, this.homeTimezone);
                return null;
            }

            return utcDate.toISOString();
        } catch (error) {
            console.error('Failed to convert input time to home timezone:', error);
            // Fallback: treat input as local time
            const parsed = new Date(value);
            return !isNaN(parsed.getTime()) ? parsed.toISOString() : null;
        }
    }

    formatDisplayTime(timestamp) {
        if (!timestamp) {
            return '--:--';
        }

        let sourceValue = timestamp;
        if (typeof sourceValue === 'object') {
            if (sourceValue instanceof Date) {
                // already a date
            } else if (sourceValue.value) {
                sourceValue = sourceValue.value;
            } else if (typeof sourceValue.toISOString === 'function') {
                sourceValue = sourceValue.toISOString();
            } else {
                sourceValue = String(sourceValue);
            }
        }

        const date = sourceValue instanceof Date ? sourceValue : new Date(sourceValue);
        if (isNaN(date.getTime())) {
            return '--:--';
        }

        try {
            return new Intl.DateTimeFormat('en-US', {
                timeZone: this.homeTimezone || this.localTimezone,
                hour: '2-digit',
                minute: '2-digit',
                hour12: true
            }).format(date);
        } catch (error) {
            console.error('Failed to format display time', error);
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
    }

    formatDateTimeLocal(timestamp) {
        if (!timestamp) {
            return '';
        }
        const date = new Date(timestamp);
        if (isNaN(date.getTime())) {
            return '';
        }
        return this.formatDateTimeInTimezone(date, this.homeTimezone);
    }

    formatLocalDate(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    setButtonLoading(button, isLoading, loadingText = null) {
        if (!button) {return;}

        if (isLoading) {
            button.dataset.originalText = button.textContent;
            button.disabled = true;
            button.classList.add('loading');
            if (loadingText) {
                button.textContent = loadingText;
            }
        } else {
            button.disabled = false;
            button.classList.remove('loading');
            if (button.dataset.originalText) {
                button.textContent = button.dataset.originalText;
                delete button.dataset.originalText;
            }
        }
    }

    setLoadingOverlay(section, show) {
        if (!section) {return;}
        let overlay = section.querySelector('.loading-overlay');

        if (show && !overlay) {
            overlay = document.createElement('div');
            overlay.className = 'loading-overlay';
            overlay.innerHTML = '<div class="spinner"></div>';
            if (getComputedStyle(section).position === 'static') {
                section.style.position = 'relative';
            }
            section.appendChild(overlay);
        } else if (!show && overlay) {
            overlay.remove();
        }
    }

    showButtonSuccess(button, text = 'Done!') {
        if (!button) {
            return;
        }
        const originalText = button.textContent;
        button.textContent = text;
        button.classList.add('success');
        setTimeout(() => {
            button.classList.remove('success');
            button.textContent = originalText;
        }, 1500);
    }

    async renderTimeline() {
        try {
            const hoursContainer = document.querySelector('.timeline-hours');
            const eventsContainer = document.querySelector('.timeline-events');
            if (!hoursContainer || !eventsContainer) {
                return;
            }

            const sourceEvents = this.allEvents && this.allEvents.length ? this.allEvents : this.events;
            const tz = this.homeTimezone || this.localTimezone;
            const now = new Date();
            const startOfDay = new Date(now.toLocaleString('en-US', { timeZone: tz }));
            startOfDay.setHours(0, 0, 0, 0);
            const endOfDay = new Date(startOfDay);
            endOfDay.setHours(23, 59, 59, 999);

            const todayEvents = sourceEvents.filter(event => {
                const eventDate = new Date(event.timestamp);
                const eventInTz = new Date(eventDate.toLocaleString('en-US', { timeZone: tz }));
                return eventInTz >= startOfDay && eventInTz <= endOfDay;
            });

            hoursContainer.innerHTML = '<div class="timeline-hours-labels"></div>';
            const labelsContainer = hoursContainer.querySelector('.timeline-hours-labels');
            const hourLabels = [];
            for (let hour = 0; hour <= this.UI_CONSTANTS.TIMELINE_HOURS; hour += 6) {
                hourLabels.push(hour);
            }
            hourLabels.forEach(hour => {
                const hourDiv = document.createElement('div');
                hourDiv.className = 'timeline-hour';
                hourDiv.textContent = `${hour.toString().padStart(2, '0')}:00`;
                labelsContainer.appendChild(hourDiv);
            });

            eventsContainer.innerHTML = '';

            if (todayEvents.length === 0) {
                eventsContainer.innerHTML = '<div class="timeline-empty">No events recorded today</div>';
                return;
            }

            // Create three lanes: Sleep, Milk, Diapers/Bath
            const sleepLaneDiv = document.createElement('div');
            sleepLaneDiv.className = 'timeline-lane';

            const sleepLabelDiv = document.createElement('div');
            sleepLabelDiv.className = 'timeline-lane-label';
            sleepLabelDiv.innerHTML = '<span>😴</span>';
            sleepLaneDiv.appendChild(sleepLabelDiv);

            const sleepTrackDiv = document.createElement('div');
            sleepTrackDiv.className = 'timeline-lane-track';

            const milkLaneDiv = document.createElement('div');
            milkLaneDiv.className = 'timeline-lane';

            const milkLabelDiv = document.createElement('div');
            milkLabelDiv.className = 'timeline-lane-label';
            milkLabelDiv.innerHTML = '<span>🍼</span>';
            milkLaneDiv.appendChild(milkLabelDiv);

            const milkTrackDiv = document.createElement('div');
            milkTrackDiv.className = 'timeline-lane-track';

            const diapersBathLaneDiv = document.createElement('div');
            diapersBathLaneDiv.className = 'timeline-lane';

            const diapersBathLabelDiv = document.createElement('div');
            diapersBathLabelDiv.className = 'timeline-lane-label';
            diapersBathLabelDiv.innerHTML = '<span>💩🛁</span>';
            diapersBathLaneDiv.appendChild(diapersBathLabelDiv);

            const diapersBathTrackDiv = document.createElement('div');
            diapersBathTrackDiv.className = 'timeline-lane-track';

            // Process events and separate into lanes
            todayEvents.forEach(event => {
                const eventDate = new Date(event.timestamp);
                const eventInTz = new Date(eventDate.toLocaleString('en-US', { timeZone: tz }));
                const minutes = eventInTz.getHours() * 60 + eventInTz.getMinutes();
                const leftPosition = (minutes / (24 * 60)) * 100;

                const normalizedType = event.type === 'poo' ? 'diaper' : event.type;
                const config = this.EVENT_CONFIG[normalizedType] || {};

                if (normalizedType === 'sleep') {
                    // Handle both completed and ongoing sleep sessions
                    const sleepStart = new Date(event.sleep_start_time);
                    const sleepEnd = event.sleep_end_time ? new Date(event.sleep_end_time) : new Date(); // Use current time for ongoing sessions
                    const sleepStartInTz = new Date(sleepStart.toLocaleString('en-US', { timeZone: tz }));
                    const sleepEndInTz = new Date(sleepEnd.toLocaleString('en-US', { timeZone: tz }));

                    const startMinutes = sleepStartInTz.getHours() * 60 + sleepStartInTz.getMinutes();
                    const endMinutes = sleepEndInTz.getHours() * 60 + sleepEndInTz.getMinutes();

                    const startPosition = (startMinutes / (24 * 60)) * 100;
                    const endPosition = (endMinutes / (24 * 60)) * 100;
                    const width = Math.max(1, endPosition - startPosition);

                    const progressBar = document.createElement('div');
                    progressBar.className = 'timeline-progress-bar sleep';
                    progressBar.style.left = `${startPosition}%`;
                    progressBar.style.width = `${width}%`;
                    progressBar.style.backgroundColor = config.color || '#43e97b';

                    // Add ongoing class for incomplete sleep sessions
                    if (!event.sleep_end_time) {
                        progressBar.classList.add('ongoing');
                        progressBar.style.background = 'linear-gradient(90deg, #43e97b, #38b2ac)';
                    }

                    const tooltip = document.createElement('div');
                    tooltip.className = 'timeline-marker-tooltip';
                    const duration = event.amount || Math.round((sleepEnd - sleepStart) / (1000 * 60));
                    let tooltipText = `${config.icon || '😴'} Sleep - ${this.formatDisplayTime(sleepStart)}`;

                    if (event.sleep_end_time) {
                        tooltipText += ` to ${this.formatDisplayTime(sleepEnd)}`;
                    } else {
                        tooltipText += ' to now (ongoing)';
                    }

                    tooltipText += `\nDuration: ${duration} minutes`;
                    if (event.user_name) {
                        tooltipText += `\n${event.user_name}`;
                    }
                    if (!event.sleep_end_time) {
                        tooltipText += '\n🔄 Currently sleeping';
                    }
                    tooltip.textContent = tooltipText;
                    tooltip.style.whiteSpace = 'pre-line';

                    progressBar.appendChild(tooltip);

                    progressBar.addEventListener('click', (eventObj) => {
                        eventObj.stopPropagation();
                        if (this.activeTimelineMarker && this.activeTimelineMarker !== progressBar) {
                            this.activeTimelineMarker.classList.remove('show-tooltip');
                        }
                        progressBar.classList.toggle('show-tooltip');
                        this.activeTimelineMarker = progressBar.classList.contains('show-tooltip') ? progressBar : null;
                    });

                    progressBar.addEventListener('touchstart', (eventObj) => {
                        eventObj.stopPropagation();
                        if (this.activeTimelineMarker && this.activeTimelineMarker !== progressBar) {
                            this.activeTimelineMarker.classList.remove('show-tooltip');
                        }
                        progressBar.classList.add('show-tooltip');
                        this.activeTimelineMarker = progressBar;
                    }, { passive: true });

                    sleepTrackDiv.appendChild(progressBar);
                } else if (['milk', 'diaper', 'bath'].includes(normalizedType)) {
                    // Create marker for other event types and route to appropriate lanes
                    const marker = document.createElement('div');
                    marker.className = 'timeline-marker timeline-icon-marker';
                    marker.style.left = `${leftPosition}%`;

                    // Get the appropriate icon
                    let icon;
                    if (normalizedType === 'diaper') {
                        const subtype = event.subtype || 'poo';
                        marker.classList.add(`diaper-${subtype}`);
                        icon = this.EVENT_CONFIG.diaper?.subtypes?.[subtype]?.icon || config.icon;
                        const subtypeColor = this.EVENT_CONFIG.diaper?.subtypes?.[subtype]?.color;
                        if (subtypeColor) {
                            marker.style.background = subtypeColor;
                        }
                    } else {
                        marker.classList.add(normalizedType);
                        icon = config.icon;
                        if (config.color) {
                            marker.style.background = config.color;
                        }
                    }

                    // Create icon element
                    const iconElement = document.createElement('span');
                    iconElement.className = 'timeline-icon';
                    iconElement.textContent = icon || '📝';
                    marker.appendChild(iconElement);

                    const tooltip = document.createElement('div');
                    tooltip.className = 'timeline-marker-tooltip';
                    const tooltipIcon = normalizedType === 'diaper' && event.subtype
                        ? this.EVENT_CONFIG.diaper?.subtypes?.[event.subtype]?.icon || config.icon
                        : config.icon;
                    const label = normalizedType === 'diaper' && event.subtype
                        ? this.EVENT_CONFIG.diaper?.subtypes?.[event.subtype]?.label || config.label
                        : config.label;
                    let tooltipText = `${tooltipIcon || '📝'} ${label || normalizedType} - ${this.formatDisplayTime(event.timestamp)}`;

                    if (event.amount && (config.amountUnit || normalizedType === 'milk')) {
                        const unit = config.amountUnit || (normalizedType === 'milk' ? 'ml' : '');
                        tooltipText += ` (${event.amount}${unit})`;
                    }

                    if (event.user_name) {
                        tooltipText += `\n${event.user_name}`;
                    }
                    tooltip.textContent = tooltipText;
                    tooltip.style.whiteSpace = 'pre-line';

                    marker.appendChild(tooltip);

                    marker.addEventListener('click', (eventObj) => {
                        eventObj.stopPropagation();
                        if (this.activeTimelineMarker && this.activeTimelineMarker !== marker) {
                            this.activeTimelineMarker.classList.remove('show-tooltip');
                        }
                        marker.classList.toggle('show-tooltip');
                        this.activeTimelineMarker = marker.classList.contains('show-tooltip') ? marker : null;
                    });

                    marker.addEventListener('touchstart', (eventObj) => {
                        eventObj.stopPropagation();
                        if (this.activeTimelineMarker && this.activeTimelineMarker !== marker) {
                            this.activeTimelineMarker.classList.remove('show-tooltip');
                        }
                        marker.classList.add('show-tooltip');
                        this.activeTimelineMarker = marker;
                    }, { passive: true });

                    // Route to appropriate lane
                    if (normalizedType === 'milk') {
                        milkTrackDiv.appendChild(marker);
                    } else if (['diaper', 'bath'].includes(normalizedType)) {
                        diapersBathTrackDiv.appendChild(marker);
                    }
                }
            });

            // Assemble the lanes
            sleepLaneDiv.appendChild(sleepTrackDiv);
            milkLaneDiv.appendChild(milkTrackDiv);
            diapersBathLaneDiv.appendChild(diapersBathTrackDiv);

            eventsContainer.appendChild(sleepLaneDiv);
            eventsContainer.appendChild(milkLaneDiv);
            eventsContainer.appendChild(diapersBathLaneDiv);
        } catch (error) {
            console.error('Error rendering timeline:', error);
            const eventsContainer = document.querySelector('.timeline-events');
            if (eventsContainer) {
                eventsContainer.innerHTML = '<div class="timeline-empty">Error loading timeline</div>';
            }
        }
    }

}

// Initialize the tracker when the page loads
let babyTracker;
document.addEventListener('DOMContentLoaded', () => {
    babyTracker = new BabyTracker();
});
