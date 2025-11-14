class BabyTracker {
    constructor() {
        this.events = [];
        this.init();
    }

    async init() {
        this.bindEvents();
        await this.loadEvents();
        await this.updateStats();
        await this.renderTimeline();
    }

    bindEvents() {
        const eventForm = document.getElementById('eventForm');
        const eventType = document.getElementById('eventType');
        const milkAmountGroup = document.getElementById('milkAmountGroup');
        const sleepTrackingGroup = document.getElementById('sleepTrackingGroup');
        const fallAsleepBtn = document.getElementById('fallAsleepBtn');
        const wakeUpBtn = document.getElementById('wakeUpBtn');
        const dateFilter = document.getElementById('dateFilter');
        const customDateRange = document.getElementById('customDateRange');
        const applyCustomRange = document.getElementById('applyCustomRange');
        const exportCSV = document.getElementById('exportCSV');
        const exportPDF = document.getElementById('exportPDF');

        // Show/hide amount fields based on event type
        eventType.addEventListener('change', (e) => {
            const selectedType = e.target.value;
            milkAmountGroup.style.display = selectedType === 'milk' ? 'block' : 'none';
            sleepTrackingGroup.style.display = selectedType === 'sleep' ? 'block' : 'none';
        });

        // Sleep button handlers
        fallAsleepBtn.addEventListener('click', () => {
            this.addSleepEvent('fall_asleep');
        });

        wakeUpBtn.addEventListener('click', () => {
            this.addSleepEvent('wake_up');
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
        const userName = document.getElementById('userName').value;

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

        // Skip sleep events in the main form - they're handled by the sleep buttons
        if (eventType === 'sleep') {
            alert('Please use the "Fall Asleep" or "Wake Up" buttons for sleep tracking');
            return;
        }

        try {
            const requestData = {
                type: eventType,
                amount: eventType === 'milk' ? parseInt(milkAmount, 10) : null,
                userName: userName
            };
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
            this.resetForm();
        } catch (error) {
            console.error('Error adding event:', error);
            alert('Failed to add event: ' + error.message);
        }
    }

    // Add sleep event with fall asleep/wake up tracking
    async addSleepEvent(sleepSubType) {
        const userName = document.getElementById('userName').value;

        if (!userName) {
            alert('Please select who is recording');
            return;
        }

        try {
            const response = await fetch('/api/events', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    type: 'sleep',
                    sleepSubType: sleepSubType,
                    userName: userName
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

            // Show success message
            if (sleepSubType === 'fall_asleep') {
                alert('😴 Fall asleep recorded! Don\'t forget to record wake up when baby wakes.');
            } else if (sleepSubType === 'wake_up') {
                alert('☀️ Wake up recorded! Sleep duration calculated automatically.');
            }
        } catch (error) {
            console.error('Error adding sleep event:', error);
            alert('Failed to add sleep event: ' + error.message);
        }
    }

    resetForm() {
        document.getElementById('eventForm').reset();
        document.getElementById('milkAmountGroup').style.display = 'none';
        document.getElementById('sleepTrackingGroup').style.display = 'none';
    }

    async loadEvents() {
        try {
            const response = await fetch('/api/events');
            if (!response.ok) {
                throw new Error('Failed to load events');
            }
            this.events = await response.json();
            this.renderEvents();
            await this.renderTimeline();
        } catch (error) {
            console.error('Error loading events:', error);
            this.events = [];
            this.renderEvents();
            await this.renderTimeline();
        }
    }

    renderEvents() {
        const eventsList = document.getElementById('eventsList');
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
        const icons = {
            milk: '🍼',
            poo: '💩',
            bath: '🛁',
            sleep: '😴'
        };

        const labels = {
            milk: 'Milk Feed',
            poo: 'Diaper Change',
            bath: 'Bath Time',
            sleep: 'Sleep Session'
        };

        const eventTime = new Date(event.timestamp).toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });

        // Create DOM elements safely
        const eventItem = document.createElement('div');
        eventItem.className = 'event-item';
        eventItem.setAttribute('data-event-id', event.id);

        const eventInfo = document.createElement('div');
        eventInfo.className = 'event-info';

        const eventIcon = document.createElement('span');
        eventIcon.className = 'event-icon';
        eventIcon.textContent = icons[event.type];

        const eventDetails = document.createElement('div');
        eventDetails.className = 'event-details';

        const eventType = document.createElement('span');
        eventType.className = 'event-type';
        eventType.textContent = labels[event.type];

        const eventTimeSpan = document.createElement('span');
        eventTimeSpan.className = 'event-time';
        eventTimeSpan.textContent = eventTime;

        const eventUser = document.createElement('span');
        eventUser.className = 'event-user';
        eventUser.textContent = `👤 ${event.user_name}`;

        const eventActions = document.createElement('div');
        eventActions.className = 'event-actions';

        // Add amount if present
        if (event.amount) {
            const eventAmount = document.createElement('span');
            eventAmount.className = 'event-amount';
            eventAmount.textContent = event.type === 'milk' ? `${event.amount}ml` : `${event.amount}min`;
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
        if (confirm('Are you sure you want to remove this event?')) {
            try {
                const response = await fetch(`/api/events/${eventId}`, {
                    method: 'DELETE'
                });

                if (!response.ok) {
                    throw new Error('Failed to remove event');
                }

                await this.loadEvents();
                await this.updateStats();
                await this.renderTimeline();
            } catch (error) {
                console.error('Error removing event:', error);
                alert('Failed to remove event');
            }
        }
    }

    // Start inline editing for an event
    startInlineEdit(eventId) {
        const event = this.events.find(e => e.id === eventId);
        if (!event) return;

        const eventItem = document.querySelector(`[data-event-id="${eventId}"]`);
        if (!eventItem) return;

        const icons = {
            milk: '🍼',
            poo: '💩',
            bath: '🛁',
            sleep: '😴'
        };

        const eventTime = new Date(event.timestamp).toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });

        // Clear existing content
        eventItem.textContent = '';

        // Create event-info container
        const eventInfo = document.createElement('div');
        eventInfo.className = 'event-info';

        // Create and append icon
        const eventIcon = document.createElement('span');
        eventIcon.className = 'event-icon';
        eventIcon.textContent = icons[event.type];
        eventInfo.appendChild(eventIcon);

        // Create event-details container
        const eventDetails = document.createElement('div');
        eventDetails.className = 'event-details';

        // Create type select dropdown
        const typeSelect = document.createElement('select');
        typeSelect.className = 'edit-type';
        typeSelect.value = event.type;

        const optionData = [
            { value: 'milk', label: '🍼 Milk Feed' },
            { value: 'poo', label: '💩 Diaper Change' },
            { value: 'bath', label: '🛁 Bath Time' },
            { value: 'sleep', label: '😴 Sleep Session' }
        ];

        optionData.forEach(opt => {
            const option = document.createElement('option');
            option.value = opt.value;
            option.textContent = opt.label;
            if (opt.value === event.type) {
                option.selected = true;
            }
            typeSelect.appendChild(option);
        });

        eventDetails.appendChild(typeSelect);

        // Create time display
        const timeSpan = document.createElement('span');
        timeSpan.className = 'event-time';
        timeSpan.textContent = eventTime;
        eventDetails.appendChild(timeSpan);

        eventInfo.appendChild(eventDetails);
        eventItem.appendChild(eventInfo);

        // Create event-actions container
        const eventActions = document.createElement('div');
        eventActions.className = 'event-actions';

        // Create amount input group
        const amountGroup = document.createElement('div');
        amountGroup.className = 'edit-amount-group';
        if (event.type !== 'milk' && event.type !== 'sleep') {
            amountGroup.style.display = 'none';
        }

        const amountInput = document.createElement('input');
        amountInput.type = 'number';
        amountInput.className = 'edit-amount';
        amountInput.value = event.amount || '';
        amountInput.min = '0';
        amountInput.max = event.type === 'milk' ? '500' : '480';
        amountInput.placeholder = event.type === 'milk' ? 'ml' : 'min';
        amountInput.style.width = '80px';
        amountInput.style.padding = '4px 8px';

        amountGroup.appendChild(amountInput);
        eventActions.appendChild(amountGroup);

        // Create save button
        const saveButton = document.createElement('button');
        saveButton.className = 'btn-save';
        saveButton.textContent = '💾';
        saveButton.title = 'Save changes';
        saveButton.addEventListener('click', () => this.saveInlineEdit(eventId));
        eventActions.appendChild(saveButton);

        // Create cancel button
        const cancelButton = document.createElement('button');
        cancelButton.className = 'btn-cancel';
        cancelButton.textContent = '❌';
        cancelButton.title = 'Cancel';
        cancelButton.addEventListener('click', () => this.cancelInlineEdit(eventId));
        eventActions.appendChild(cancelButton);

        eventItem.appendChild(eventActions);

        // Add event listener for type change to show/hide amount field
        typeSelect.addEventListener('change', (e) => {
            if (e.target.value === 'milk' || e.target.value === 'sleep') {
                amountGroup.style.display = 'block';
                amountInput.max = e.target.value === 'milk' ? '500' : '480';
                amountInput.placeholder = e.target.value === 'milk' ? 'ml' : 'min';
            } else {
                amountGroup.style.display = 'none';
            }
        });
    }

    // Save inline edit changes
    async saveInlineEdit(eventId) {
        const eventItem = document.querySelector(`[data-event-id="${eventId}"]`);
        if (!eventItem) return;

        const typeSelect = eventItem.querySelector('.edit-type');
        const amountInput = eventItem.querySelector('.edit-amount');

        const newType = typeSelect.value;
        let newAmount = null;

        if (newType === 'milk' || newType === 'sleep') {
            if (!amountInput.value || isNaN(amountInput.value) || parseInt(amountInput.value) <= 0) {
                alert(`Please enter a valid ${newType === 'milk' ? 'milk amount' : 'sleep duration'}`);
                return;
            }
            newAmount = parseInt(amountInput.value);
        }

        try {
            const response = await fetch(`/api/events/${eventId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    type: newType,
                    amount: newAmount
                })
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
        } catch (error) {
            console.error('Error updating event:', error);
            alert('Failed to update event: ' + error.message);
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

    formatLocalDate(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    async renderTimeline() {
        try {
            // Get today's events
            const today = new Date();
            const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
            const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59);

            // Filter events from today
            const todayEvents = this.events.filter(event => {
                const eventDate = new Date(event.timestamp);
                return eventDate >= startOfDay && eventDate <= endOfDay;
            });

            // Render the timeline hours (0, 6, 12, 18, 24)
            const hoursContainer = document.querySelector('.timeline-hours');
            hoursContainer.innerHTML = '<div></div><div class="timeline-hours-labels"></div><div></div>';
            const labelsContainer = hoursContainer.querySelector('.timeline-hours-labels');
            [0, 6, 12, 18, 24].forEach(hour => {
                const hourDiv = document.createElement('div');
                hourDiv.className = 'timeline-hour';
                hourDiv.textContent = `${hour}:00`;
                labelsContainer.appendChild(hourDiv);
            });

            // Render the events
            const eventsContainer = document.querySelector('.timeline-events');
            eventsContainer.innerHTML = '';

            if (todayEvents.length === 0) {
                eventsContainer.innerHTML = '<div class="timeline-empty">No events recorded today</div>';
                return;
            }

            // Event configuration
            const eventTypes = [
                { type: 'milk', icon: '🍼', label: 'Milk' },
                { type: 'poo', icon: '💩', label: 'Poo' },
                { type: 'bath', icon: '🛁', label: 'Bath' },
                { type: 'sleep', icon: '😴', label: 'Sleep' }
            ];

            // Group events by type
            const eventsByType = {};
            todayEvents.forEach(event => {
                if (!eventsByType[event.type]) {
                    eventsByType[event.type] = [];
                }
                eventsByType[event.type].push(event);
            });

            // Create a lane for each event type
            eventTypes.forEach(({ type, icon, label }) => {
                const laneDiv = document.createElement('div');
                laneDiv.className = 'timeline-lane';

                // Lane label
                const labelDiv = document.createElement('div');
                labelDiv.className = 'timeline-lane-label';
                labelDiv.innerHTML = `<span>${icon}</span><span>${label}</span>`;
                laneDiv.appendChild(labelDiv);

                // Lane track
                const trackDiv = document.createElement('div');
                trackDiv.className = 'timeline-lane-track';

                // Add events for this type
                const events = eventsByType[type] || [];
                events.forEach(event => {
                    const eventDate = new Date(event.timestamp);
                    const hour = eventDate.getHours();
                    const minute = eventDate.getMinutes();
                    const timeInMinutes = hour * 60 + minute;
                    const leftPosition = (timeInMinutes / (24 * 60)) * 100;
                    const timeString = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

                    // Create marker
                    const marker = document.createElement('div');
                    marker.className = `timeline-marker ${type}`;
                    marker.style.left = `${leftPosition}%`;

                    // Create tooltip
                    const tooltip = document.createElement('div');
                    tooltip.className = 'timeline-marker-tooltip';
                    let tooltipText = `${timeString}`;
                    if (event.type === 'milk' && event.amount) {
                        tooltipText += ` • ${event.amount}ml`;
                    } else if (event.type === 'sleep' && event.amount) {
                        tooltipText += ` • ${event.amount} min`;
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
            eventsContainer.innerHTML = '<div class="timeline-empty">Error loading timeline</div>';
        }
    }

}

// Initialize the tracker when the page loads
let babyTracker;
document.addEventListener('DOMContentLoaded', () => {
    babyTracker = new BabyTracker();
});
