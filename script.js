class BabyTracker {
    constructor() {
        this.events = [];
        this.init();
    }

    async init() {
        this.bindEvents();
        await this.loadEvents();
        await this.updateStats();
    }

    bindEvents() {
        const eventForm = document.getElementById('eventForm');
        const eventType = document.getElementById('eventType');
        const milkAmountGroup = document.getElementById('milkAmountGroup');
        const sleepDurationGroup = document.getElementById('sleepDurationGroup');
        const dateFilter = document.getElementById('dateFilter');
        const customDateRange = document.getElementById('customDateRange');
        const applyCustomRange = document.getElementById('applyCustomRange');
        const exportCSV = document.getElementById('exportCSV');
        const exportPDF = document.getElementById('exportPDF');

        // Show/hide amount fields based on event type
        eventType.addEventListener('change', (e) => {
            const selectedType = e.target.value;
            milkAmountGroup.style.display = selectedType === 'milk' ? 'block' : 'none';
            sleepDurationGroup.style.display = selectedType === 'sleep' ? 'block' : 'none';
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
        const sleepDuration = document.getElementById('sleepDuration').value;
        const userName = document.getElementById('userName').value;

        if (!userName) {
            alert('Please select who is recording');
            return;
        }

        if (!eventType) {
            alert('Please select an event type');
            return;
        }

        if (eventType === 'milk' && !milkAmount) {
            alert('Please enter milk amount');
            return;
        }

        if (eventType === 'sleep' && !sleepDuration) {
            alert('Please enter sleep duration');
            return;
        }

        try {
            const response = await fetch('/api/events', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    type: eventType,
                    amount: (eventType === 'milk' || eventType === 'sleep') ?
                        (eventType === 'milk' ? parseInt(milkAmount) : parseInt(sleepDuration)) : null,
                    userName: userName
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to add event');
            }

            await this.loadEvents();
            await this.updateStats();
            this.resetForm();
        } catch (error) {
            console.error('Error adding event:', error);
            alert('Failed to add event: ' + error.message);
        }
    }

    resetForm() {
        document.getElementById('eventForm').reset();
        document.getElementById('milkAmountGroup').style.display = 'none';
        document.getElementById('sleepDurationGroup').style.display = 'none';
    }

    async loadEvents() {
        try {
            const response = await fetch('/api/events');
            if (!response.ok) {
                throw new Error('Failed to load events');
            }
            this.events = await response.json();
            this.renderEvents();
        } catch (error) {
            console.error('Error loading events:', error);
            this.events = [];
            this.renderEvents();
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

    createEventHTML(event) {
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

        return `
            <div class="event-item" data-event-id="${event.id}">
                <div class="event-info">
                    <span class="event-icon">${icons[event.type]}</span>
                    <div class="event-details">
                        <span class="event-type">${labels[event.type]}</span>
                        <span class="event-time">${eventTime}</span>
                        <span class="event-user">👤 ${event.user_name}</span>
                    </div>
                </div>
                <div class="event-actions">
                    ${event.amount ?
                        (event.type === 'milk' ?
                            `<span class="event-amount">${event.amount}ml</span>` :
                            `<span class="event-amount">${event.amount}min</span>`)
                        : ''}
                    <button class="btn-edit" onclick="babyTracker.startInlineEdit(${event.id})" title="Edit event">✏️</button>
                    <button class="btn-remove" onclick="babyTracker.removeEvent(${event.id})" title="Remove event">🗑️</button>
                </div>
            </div>
        `;
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
        } catch (error) {
            console.error('Error loading stats:', error);
            document.getElementById('milkCount').textContent = '0';
            document.getElementById('pooCount').textContent = '0';
            document.getElementById('bathCount').textContent = '0';
            document.getElementById('sleepCount').textContent = '0';
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

        eventItem.innerHTML = `
            <div class="event-info">
                <span class="event-icon">${icons[event.type]}</span>
                <div class="event-details">
                    <select class="edit-type" value="${event.type}">
                        <option value="milk" ${event.type === 'milk' ? 'selected' : ''}>🍼 Milk Feed</option>
                        <option value="poo" ${event.type === 'poo' ? 'selected' : ''}>💩 Diaper Change</option>
                        <option value="bath" ${event.type === 'bath' ? 'selected' : ''}>🛁 Bath Time</option>
                        <option value="sleep" ${event.type === 'sleep' ? 'selected' : ''}>😴 Sleep Session</option>
                    </select>
                    <span class="event-time">${eventTime}</span>
                </div>
            </div>
            <div class="event-actions">
                <div class="edit-amount-group" style="${event.type === 'milk' || event.type === 'sleep' ? '' : 'display: none;'}">
                    <input type="number" class="edit-amount" value="${event.amount || ''}" min="0" max="${event.type === 'milk' ? '500' : '480'}" placeholder="${event.type === 'milk' ? 'ml' : 'min'}" style="width: 80px; padding: 4px 8px;">
                </div>
                <button class="btn-save" onclick="babyTracker.saveInlineEdit(${eventId})" title="Save changes">💾</button>
                <button class="btn-cancel" onclick="babyTracker.cancelInlineEdit(${eventId})" title="Cancel">❌</button>
            </div>
        `;

        // Add event listener for type change to show/hide amount field
        const typeSelect = eventItem.querySelector('.edit-type');
        const amountGroup = eventItem.querySelector('.edit-amount-group');

        typeSelect.addEventListener('change', (e) => {
            if (e.target.value === 'milk' || e.target.value === 'sleep') {
                amountGroup.style.display = 'block';
                const amountInput = amountGroup.querySelector('.edit-amount');
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
                const error = await response.json();
                throw new Error(error.error || 'Failed to update event');
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

            switch (filterType) {
                case 'today':
                    filter.startDate = today.toISOString().split('T')[0];
                    filter.endDate = today.toISOString().split('T')[0];
                    break;
                case 'yesterday':
                    const yesterday = new Date(today);
                    yesterday.setDate(yesterday.getDate() - 1);
                    filter.startDate = yesterday.toISOString().split('T')[0];
                    filter.endDate = yesterday.toISOString().split('T')[0];
                    break;
                case 'last7':
                    const last7 = new Date(today);
                    last7.setDate(last7.getDate() - 7);
                    filter.startDate = last7.toISOString().split('T')[0];
                    filter.endDate = today.toISOString().split('T')[0];
                    break;
                case 'last30':
                    const last30 = new Date(today);
                    last30.setDate(last30.getDate() - 30);
                    filter.startDate = last30.toISOString().split('T')[0];
                    filter.endDate = today.toISOString().split('T')[0];
                    break;
                case 'all':
                    // No filter - load all events
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

}

// Initialize the tracker when the page loads
let babyTracker;
document.addEventListener('DOMContentLoaded', () => {
    babyTracker = new BabyTracker();
});