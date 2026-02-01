class SessionHub {
    constructor() {
        this.sessions = [];
        this.currentEditingId = null;
        this.availableTabs = [];
        this.selectedTabs = new Set();
        this.init();
    }

    async init() {
        await this.loadSessions();
        this.setupEventListeners();
        this.renderSessions();
    }

    setupEventListeners() {
        // Save all tabs button
        document.getElementById('saveAllBtn').addEventListener('click', () => this.saveAllTabs());

        // Save selected tabs button
        document.getElementById('saveSelectedBtn').addEventListener('click', () => this.showTabSelection());

        // Tab selection panel buttons
        document.getElementById('cancelSelectionBtn').addEventListener('click', () => this.hideTabSelection());
        document.getElementById('saveSelectedConfirmBtn').addEventListener('click', () => this.saveSelectedTabs());

        // Clear all button
        document.getElementById('clearAllBtn').addEventListener('click', () => this.clearAllSessions());

        // Close button
        document.getElementById('closeBtn').addEventListener('click', () => window.close());

        // Modal buttons
        document.getElementById('cancelRename').addEventListener('click', () => this.closeRenameModal());
        document.getElementById('confirmRename').addEventListener('click', () => this.confirmRename());

        // Close modal on outside click
        document.getElementById('renameModal').addEventListener('click', (e) => {
            if (e.target.id === 'renameModal') {
                this.closeRenameModal();
            }
        });

        // Enter key in rename input
        document.getElementById('renameInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.confirmRename();
            }
        });

        // Event delegation for dynamically created elements
        document.getElementById('sessionsList').addEventListener('click', (e) => {
            const sessionCard = e.target.closest('.session-card');
            if (!sessionCard) return;

            const sessionId = sessionCard.dataset.sessionId;
            if (!sessionId) return;

            // Handle restore button clicks
            if (e.target.classList.contains('restore-btn')) {
                this.restoreSession(sessionId);
            }

            // Handle more button clicks
            if (e.target.closest('.more-btn')) {
                e.stopPropagation();
                this.toggleDropdown(sessionId);
            }

            // Handle dropdown item clicks
            if (e.target.classList.contains('dropdown-item')) {
                e.stopPropagation();
                const action = e.target.textContent.trim();
                
                if (action === 'Rename') {
                    this.openRenameModal(sessionId);
                } else if (action === 'Delete') {
                    this.deleteSession(sessionId);
                }
                
                // Close dropdown after action
                this.closeAllDropdowns();
            }
        });

        // Close dropdowns when clicking outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.more-btn') && !e.target.closest('.dropdown-menu')) {
                this.closeAllDropdowns();
            }
        });
    }

    closeAllDropdowns() {
        document.querySelectorAll('.dropdown-menu').forEach(menu => {
            menu.classList.remove('show');
        });
    }

    async loadSessions() {
        try {
            const result = await chrome.storage.local.get(['tabSessions']);
            this.sessions = result.tabSessions || [];
        } catch (error) {
            console.error('Error loading sessions:', error);
            this.sessions = [];
        }
    }

    async saveSessions() {
        try {
            await chrome.storage.local.set({ tabSessions: this.sessions });
        } catch (error) {
            console.error('Error saving sessions:', error);
        }
    }

    async showTabSelection() {
        try {
            // Get all tabs in current window
            const tabs = await chrome.tabs.query({ currentWindow: true });
            this.availableTabs = tabs;
            this.selectedTabs.clear();

            // Show tab selection panel
            document.getElementById('tabSelection').style.display = 'block';
            
            // Render tab list
            this.renderTabList();
        } catch (error) {
            console.error('Error loading tabs:', error);
            this.showMessage('Error loading tabs');
        }
    }

    hideTabSelection() {
        document.getElementById('tabSelection').style.display = 'none';
        this.selectedTabs.clear();
    }

    renderTabList() {
        const tabList = document.getElementById('tabList');
        const saveButton = document.getElementById('saveSelectedConfirmBtn');

        tabList.innerHTML = this.availableTabs.map(tab => `
            <div class="tab-item" data-tab-id="${tab.id}">
                <input type="checkbox" class="tab-checkbox" data-tab-id="${tab.id}">
                <div class="tab-info">
                    <div class="tab-title">${this.escapeHtml(tab.title)}</div>
                    <div class="tab-url">${this.escapeHtml(new URL(tab.url).hostname)}</div>
                </div>
            </div>
        `).join('');

        // Add event listeners for checkboxes
        tabList.addEventListener('change', (e) => {
            if (e.target.classList.contains('tab-checkbox')) {
                const tabId = e.target.dataset.tabId;
                if (e.target.checked) {
                    this.selectedTabs.add(tabId);
                } else {
                    this.selectedTabs.delete(tabId);
                }
                
                // Update save button state
                saveButton.disabled = this.selectedTabs.size === 0;
            }
        });

        // Add click listener for tab items (toggle checkbox)
        tabList.addEventListener('click', (e) => {
            const tabItem = e.target.closest('.tab-item');
            if (!tabItem) return;

            const checkbox = tabItem.querySelector('.tab-checkbox');
            if (e.target !== checkbox) {
                checkbox.checked = !checkbox.checked;
                checkbox.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });

        // Initially disable save button
        saveButton.disabled = true;
    }

    async saveSelectedTabs() {
        if (this.selectedTabs.size === 0) {
            return; // Do nothing if no tabs selected
        }

        try {
            // Get selected tab objects
            const selectedTabObjects = this.availableTabs.filter(tab => 
                this.selectedTabs.has(tab.id.toString())
            );

            // Create session object
            const session = {
                id: Date.now().toString(),
                name: this.generateSessionName() + ' (Selected)',
                timestamp: Date.now(),
                tabs: selectedTabObjects.map(tab => ({
                    url: tab.url,
                    title: tab.title,
                    favIconUrl: tab.favIconUrl
                })),
                tabCount: selectedTabObjects.length
            };

            // Group tabs by domain for domain indicator
            const domains = new Set(selectedTabObjects.map(tab => new URL(tab.url).hostname));
            session.domains = Array.from(domains);
            session.primaryDomain = this.getPrimaryDomain(domains);

            // Add to sessions
            this.sessions.unshift(session);
            
            // Limit to 50 sessions
            if (this.sessions.length > 50) {
                this.sessions = this.sessions.slice(0, 50);
            }

            await this.saveSessions();
            this.hideTabSelection();
            this.renderSessions();
            this.showMessage(`Saved ${selectedTabObjects.length} selected tabs`);
        } catch (error) {
            console.error('Error saving selected tabs:', error);
            this.showMessage('Error saving selected tabs');
        }
    }

    async saveAllTabs() {
        try {
            // Get all tabs in the current window
            const tabs = await chrome.tabs.query({ currentWindow: true });
            
            if (tabs.length === 0) {
                this.showMessage('No tabs to save');
                return;
            }

            // Create session object
            const session = {
                id: Date.now().toString(),
                name: this.generateSessionName(),
                timestamp: Date.now(),
                tabs: tabs.map(tab => ({
                    url: tab.url,
                    title: tab.title,
                    favIconUrl: tab.favIconUrl
                })),
                tabCount: tabs.length
            };

            // Group tabs by domain for domain indicator
            const domains = new Set(tabs.map(tab => new URL(tab.url).hostname));
            session.domains = Array.from(domains);
            session.primaryDomain = this.getPrimaryDomain(domains);

            // Add to sessions
            this.sessions.unshift(session);
            
            // Limit to 50 sessions to prevent storage issues
            if (this.sessions.length > 50) {
                this.sessions = this.sessions.slice(0, 50);
            }

            await this.saveSessions();
            this.renderSessions();
            this.showMessage(`Saved ${tabs.length} tabs`);
        } catch (error) {
            console.error('Error saving tabs:', error);
            this.showMessage('Error saving tabs');
        }
    }

    generateSessionName() {
        const now = new Date();
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        if (now.toDateString() === today.toDateString()) {
            return `Today, ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
        } else if (now.toDateString() === yesterday.toDateString()) {
            return `Yesterday, ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
        } else {
            return now.toLocaleDateString('en-US', { 
                month: 'short', 
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        }
    }

    getPrimaryDomain(domains) {
        if (domains.size === 0) return null;
        if (domains.size === 1) return domains.values().next().value;
        
        // Find most common domain
        const domainCounts = {};
        domains.forEach(domain => {
            domainCounts[domain] = (domainCounts[domain] || 0) + 1;
        });
        
        return Object.keys(domainCounts).reduce((a, b) => 
            domainCounts[a] > domainCounts[b] ? a : b
        );
    }

    async restoreSession(sessionId) {
        try {
            const session = this.sessions.find(s => s.id === sessionId);
            if (!session) {
                this.showMessage('Session not found');
                return;
            }

            // Create tabs for each saved URL
            for (const tab of session.tabs) {
                await chrome.tabs.create({
                    url: tab.url,
                    active: false // Don't activate each tab, only the first one
                });
            }

            // Activate the first tab
            if (session.tabs.length > 0) {
                const newTabs = await chrome.tabs.query({ 
                    url: session.tabs[0].url,
                    currentWindow: true 
                });
                if (newTabs.length > 0) {
                    await chrome.tabs.update(newTabs[newTabs.length - 1].id, { active: true });
                }
            }

            this.showRestoreConfirmation(`Session restored successfully`);
        } catch (error) {
            console.error('Error restoring session:', error);
            this.showMessage('Error restoring session');
        }
    }

    async deleteSession(sessionId) {
        try {
            this.sessions = this.sessions.filter(s => s.id !== sessionId);
            await this.saveSessions();
            this.renderSessions();
            this.showMessage('Session deleted');
        } catch (error) {
            console.error('Error deleting session:', error);
            this.showMessage('Error deleting session');
        }
    }

    async clearAllSessions() {
        if (this.sessions.length === 0) {
            this.showMessage('No sessions to clear');
            return;
        }

        if (confirm('Are you sure you want to clear all saved sessions?')) {
            try {
                this.sessions = [];
                await this.saveSessions();
                this.renderSessions();
                this.showMessage('All sessions cleared');
            } catch (error) {
                console.error('Error clearing sessions:', error);
                this.showMessage('Error clearing sessions');
            }
        }
    }

    openRenameModal(sessionId) {
        const session = this.sessions.find(s => s.id === sessionId);
        if (!session) return;

        this.currentEditingId = sessionId;
        const input = document.getElementById('renameInput');
        input.value = session.name;
        input.focus();
        input.select();
        
        document.getElementById('renameModal').classList.add('show');
    }

    closeRenameModal() {
        document.getElementById('renameModal').classList.remove('show');
        this.currentEditingId = null;
    }

    async confirmRename() {
        if (!this.currentEditingId) return;

        const newName = document.getElementById('renameInput').value.trim();
        if (!newName) {
            this.showMessage('Please enter a name');
            return;
        }

        try {
            const session = this.sessions.find(s => s.id === this.currentEditingId);
            if (session) {
                session.name = newName;
                await this.saveSessions();
                this.renderSessions();
                this.showMessage('Session renamed');
            }
        } catch (error) {
            console.error('Error renaming session:', error);
            this.showMessage('Error renaming session');
        }

        this.closeRenameModal();
    }

    toggleDropdown(sessionId) {
        // Close all other dropdowns
        document.querySelectorAll('.dropdown-menu').forEach(menu => {
            if (!menu.dataset.sessionId || menu.dataset.sessionId !== sessionId) {
                menu.classList.remove('show');
            }
        });

        // Toggle current dropdown
        const dropdown = document.querySelector(`.dropdown-menu[data-session-id="${sessionId}"]`);
        if (dropdown) {
            dropdown.classList.toggle('show');
        }
    }

    renderSessions() {
        const sessionsList = document.getElementById('sessionsList');
        const emptyState = document.getElementById('emptyState');

        if (this.sessions.length === 0) {
            sessionsList.innerHTML = '';
            emptyState.classList.add('show');
            return;
        }

        emptyState.classList.remove('show');
        
        sessionsList.innerHTML = this.sessions.map(session => {
            const domainDisplay = session.primaryDomain ? 
                `<span class="domain-indicator">${session.primaryDomain}</span>` : '';
            
            return `
                <div class="session-card" data-session-id="${session.id}">
                    <div class="session-header">
                        <div class="session-info">
                            <div class="session-name">${this.escapeHtml(session.name)}</div>
                            <div class="session-meta">
                                <span class="tab-count">${session.tabCount} ${session.tabCount === 1 ? 'Tab' : 'Tabs'}</span>
                                ${domainDisplay}
                            </div>
                        </div>
                        <div class="session-actions">
                            <button class="restore-btn">
                                Restore
                            </button>
                            <div style="position: relative;">
                                <button class="more-btn">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <circle cx="12" cy="12" r="1"></circle>
                                        <circle cx="12" cy="5" r="1"></circle>
                                        <circle cx="12" cy="19" r="1"></circle>
                                    </svg>
                                </button>
                                <div class="dropdown-menu" data-session-id="${session.id}">
                                    <button class="dropdown-item">Rename</button>
                                    <button class="dropdown-item">Delete</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    showRestoreConfirmation(message) {
        // Create inline success message below the restored session
        const confirmation = document.createElement('div');
        confirmation.style.cssText = `
            background-color: #FF9900;
            color: #000000;
            padding: 8px 12px;
            border-radius: 6px;
            font-size: 12px;
            font-weight: 500;
            margin-top: 8px;
            text-align: center;
            opacity: 0;
            transition: opacity 0.2s;
        `;
        confirmation.textContent = message;

        // Find the most recent session card (the one that was just restored)
        const sessionCards = document.querySelectorAll('.session-card');
        if (sessionCards.length > 0) {
            const firstCard = sessionCards[0];
            firstCard.appendChild(confirmation);

            // Show the message
            setTimeout(() => confirmation.style.opacity = '1', 10);

            // Auto-dismiss after 2 seconds
            setTimeout(() => {
                confirmation.style.opacity = '0';
                setTimeout(() => {
                    if (confirmation.parentNode) {
                        confirmation.parentNode.removeChild(confirmation);
                    }
                }, 200);
            }, 2000);
        }
    }

    showMessage(message) {
        // Create a simple toast notification
        const toast = document.createElement('div');
        toast.style.cssText = `
            position: fixed;
            bottom: 16px;
            left: 50%;
            transform: translateX(-50%);
            background-color: #111827;
            color: white;
            padding: 8px 16px;
            border-radius: 6px;
            font-size: 14px;
            z-index: 3000;
            opacity: 0;
            transition: opacity 0.2s;
        `;
        toast.textContent = message;
        document.body.appendChild(toast);

        // Show the toast
        setTimeout(() => toast.style.opacity = '1', 10);

        // Hide and remove after 2 seconds
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => document.body.removeChild(toast), 200);
        }, 2000);
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize the app
const sessionHub = new SessionHub();
