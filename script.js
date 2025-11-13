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

        // Show/hide milk amount field based on event type
        eventType.addEventListener('change', (e) => {
            if (e.target.value === 'milk') {
                milkAmountGroup.style.display = 'block';
            } else {
                milkAmountGroup.style.display = 'none';
            }
        });

        // Handle form submission
        eventForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.addEvent();
        });
    }

    async addEvent() {
        const eventType = document.getElementById('eventType').value;
        const milkAmount = document.getElementById('milkAmount').value;

        if (!eventType) {
            alert('Please select an event type');
            return;
        }

        if (eventType === 'milk' && !milkAmount) {
            alert('Please enter milk amount');
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
                    amount: eventType === 'milk' ? parseInt(milkAmount) : null
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

        if (this.events.length === 0) {
            eventsList.innerHTML = '<p class="no-events">No events recorded yet. Add your first event above!</p>';
            return;
        }

        eventsList.innerHTML = this.events.map(event => this.createEventHTML(event)).join('');
    }

    createEventHTML(event) {
        const icons = {
            milk: '🍼',
            poo: '💩',
            bath: '🛁'
        };

        const labels = {
            milk: 'Milk Feed',
            poo: 'Diaper Change',
            bath: 'Bath Time'
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
                    </div>
                </div>
                <div class="event-actions">
                    ${event.amount ? `<span class="event-amount">${event.amount}ml</span>` : ''}
                    <button class="btn-edit" onclick="babyTracker.editEvent(${event.id})" title="Edit event">✏️</button>
                    <button class="btn-remove" onclick="babyTracker.removeEvent(${event.id})" title="Remove event">🗑️</button>
                </div>
            </div>
        `;
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
        } catch (error) {
            console.error('Error loading stats:', error);
            document.getElementById('milkCount').textContent = '0';
            document.getElementById('pooCount').textContent = '0';
            document.getElementById('bathCount').textContent = '0';
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

    // Edit an event
    async editEvent(eventId) {
        const event = this.events.find(e => e.id === eventId);
        if (!event) return;

        // Create a simple edit form
        const newType = prompt('Edit event type (milk, poo, bath):', event.type);
        if (newType === null) return; // User cancelled

        if (!['milk', 'poo', 'bath'].includes(newType)) {
            alert('Invalid event type. Please use: milk, poo, or bath');
            return;
        }

        let newAmount = null;
        if (newType === 'milk') {
            newAmount = prompt('Enter milk amount (ml):', event.amount || '');
            if (newAmount === null) return; // User cancelled

            if (!newAmount || isNaN(newAmount) || parseInt(newAmount) <= 0) {
                alert('Please enter a valid milk amount');
                return;
            }
            newAmount = parseInt(newAmount);
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

    // Optional: Clear all events (for development/testing)
    async clearAllEvents() {
        if (confirm('Are you sure you want to clear all events?')) {
            try {
                // Delete all events one by one (for simplicity)
                for (const event of this.events) {
                    await fetch(`/api/events/${event.id}`, {
                        method: 'DELETE'
                    });
                }
                await this.loadEvents();
                await this.updateStats();
            } catch (error) {
                console.error('Error clearing events:', error);
                alert('Failed to clear events');
            }
        }
    }
}

// Initialize the tracker when the page loads
let babyTracker;
document.addEventListener('DOMContentLoaded', () => {
    babyTracker = new BabyTracker();
});

// Add clear button for development (optional)
const clearButton = document.createElement('button');
clearButton.textContent = 'Clear All Events';
clearButton.className = 'btn-primary';
clearButton.style.marginTop = '10px';
clearButton.style.backgroundColor = '#e53e3e';
clearButton.onclick = async () => {
    const tracker = new BabyTracker();
    await tracker.clearAllEvents();
};

document.querySelector('.events-section').appendChild(clearButton);