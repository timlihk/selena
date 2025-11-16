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
                userName: userName,
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
                    'Content-Type': 'application/json',
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
            alert('Failed to add event: ' + error.message);
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
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    type: 'sleep',
                    sleepSubType: sleepSubType,
                    userName: userName,
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
            alert('Failed to add sleep event: ' + error.message);
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
        }
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
            alert('Failed to remove event: ' + error.message);
        } finally {
            if (loadingActive) {
                this.setButtonLoading(deleteButton, false);
            }
        }
    }

    // Start inline editing for an event
    startInlineEdit(eventId) {
        const event = this.events.find(e => e.id === eventId);
        if (!event) return;

        const eventItem = document.querySelector(`[data-event-id="${eventId}"]`);
        if (!eventItem) return;

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
        if (!eventItem) return;

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
                    'Content-Type': 'application/json',
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
            alert('Failed to update event: ' + error.message);
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
            let filter = {};
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
                startDate: startDate,
                endDate: endDate
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
        if (!button) return;
        const iconSpan = button.querySelector('.theme-icon');
        if (!iconSpan) return;
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
        const parsed = new Date(value);
        if (isNaN(parsed.getTime())) {
            return null;
        }
        const targetTimezone = this.homeTimezone || this.localTimezone;
        if (!targetTimezone || targetTimezone === this.localTimezone) {
            return parsed.toISOString();
        }
        try {
            const options = {
                timeZone: targetTimezone,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            };
            const timezoneString = parsed.toLocaleString('en-US', options);
            const timezoneAsLocal = new Date(timezoneString);
            const diff = parsed.getTime() - timezoneAsLocal.getTime();
            return new Date(parsed.getTime() + diff).toISOString();
        } catch (error) {
            console.error('Failed to convert input time using timezone', error);
            return parsed.toISOString();
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
        if (!button) return;

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
        if (!section) return;
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

            hoursContainer.innerHTML = '<div></div><div class="timeline-hours-labels"></div><div></div>';
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

            const timelineTypes = ['milk', 'diaper', 'bath', 'sleep'];
            const eventsByType = {};
            todayEvents.forEach(event => {
                const normalizedType = event.type === 'poo' ? 'diaper' : event.type;
                if (!eventsByType[normalizedType]) {
                    eventsByType[normalizedType] = [];
                }
                eventsByType[normalizedType].push(event);
            });

            timelineTypes.forEach(type => {
                const config = this.EVENT_CONFIG[type] || {};
                const laneDiv = document.createElement('div');
                laneDiv.className = 'timeline-lane';

                const labelDiv = document.createElement('div');
                labelDiv.className = 'timeline-lane-label';
                labelDiv.innerHTML = `<span>${config.icon || '📝'}</span><span>${config.label || type}</span>`;
                laneDiv.appendChild(labelDiv);

                const trackDiv = document.createElement('div');
                trackDiv.className = 'timeline-lane-track';

                const events = eventsByType[type] || [];
                events.forEach(event => {
                    const eventDate = new Date(event.timestamp);
                    const eventInTz = new Date(eventDate.toLocaleString('en-US', { timeZone: tz }));
                    const minutes = eventInTz.getHours() * 60 + eventInTz.getMinutes();
                    const leftPosition = (minutes / (24 * 60)) * 100;

                    const marker = document.createElement('div');
                    marker.className = 'timeline-marker';
                    marker.style.left = `${leftPosition}%`;

                    if (type === 'diaper') {
                        const subtype = event.subtype || 'poo';
                        marker.classList.add(`diaper-${subtype}`);
                        const subtypeColor = this.EVENT_CONFIG.diaper?.subtypes?.[subtype]?.color;
                        if (subtypeColor) {
                            marker.style.background = subtypeColor;
                        }
                    } else {
                        marker.classList.add(type);
                        if (config.color) {
                            marker.style.background = config.color;
                        }
                    }

                    const tooltip = document.createElement('div');
                    tooltip.className = 'timeline-marker-tooltip';
                    const icon = type === 'diaper' && event.subtype
                        ? this.EVENT_CONFIG.diaper?.subtypes?.[event.subtype]?.icon || config.icon
                        : config.icon;
                    const label = type === 'diaper' && event.subtype
                        ? this.EVENT_CONFIG.diaper?.subtypes?.[event.subtype]?.label || config.label
                        : config.label;
                    let tooltipText = `${icon || '📝'} ${label || type} - ${this.formatDisplayTime(event.timestamp)}`;

                    if (event.amount && (config.amountUnit || type === 'milk' || type === 'sleep')) {
                        const unit = config.amountUnit || (type === 'milk' ? 'ml' : type === 'sleep' ? 'min' : '');
                        tooltipText += ` (${event.amount}${unit})`;
                    }

                    if (event.user_name) {
                        tooltipText += `\n${event.user_name}`;
                    }
                    tooltip.textContent = tooltipText;
                    tooltip.style.whiteSpace = 'pre-line';

                    marker.appendChild(tooltip);
                    trackDiv.appendChild(marker);
                });

                laneDiv.appendChild(trackDiv);
                eventsContainer.appendChild(laneDiv);
            });
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
