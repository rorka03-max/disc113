// Global state
let currentChannel = 'general';
let currentTextChannelId = 1;
let channels = { 'general': [], 'random': [] };
let channelNameToId = { 'general': 1, 'random': 2 };
let channelIdToName = { 1: 'general', 2: 'random' };
let servers = [];
let inCall = false;
let localStream = null;
let screenStream = null;
let peerConnections = {};
let isVideoEnabled = true;
let isAudioEnabled = true;
let isMuted = false;
let isDeafened = false;
let currentUser = null;
let socket = null;
let token = null;
let currentView = 'friends';
let currentServerId = null;
let currentServer = null;
let currentDMUserId = null;
// Initialize
document.addEventListener('DOMContentLoaded', () => {
    token = localStorage.getItem('token');
    const userStr = localStorage.getItem('currentUser');
    
    if (!token || !userStr) {
        window.location.replace('login.html');
        return;
    }
    
    try {
        currentUser = JSON.parse(userStr);
        initializeApp();
    } catch (e) {
        console.error('Error parsing user data:', e);
        localStorage.removeItem('token');
        localStorage.removeItem('currentUser');
        window.location.replace('login.html');
    }
});

function initializeApp() {
    updateUserInfo();
    initializeFriendsTabs();
    initializeChannels();
    initializeMessageInput();
    initializeUserControls();
    initializeCallControls();
    initializeServerManagement();
    initializeTelegramChannelUI();
    initializeMobileUI();
    initializeFileUpload();
    initializeEmojiPicker();
    initializeDraggableCallWindow();
    connectToSocketIO();
    requestNotificationPermission();
    loadUserServers();
    // Try to restore last state
    const lastView = localStorage.getItem('lastView');
    const lastServerId = localStorage.getItem('lastServerId');
    const lastChannelName = localStorage.getItem('lastChannelName') || 'general';
    if (isMobileLayout()) {
        showDMHomeView();
        return;
    }
    if (lastView === 'server' && lastServerId) {
        // Show server UI immediately; server icon highlight will sync when user clicks
        currentView = 'server';
        currentChannel = lastChannelName;
        document.getElementById('friendsView').style.display = 'none';
        document.getElementById('chatView').style.display = 'flex';
        document.getElementById('channelsView').style.display = 'block';
        document.getElementById('dmListView').style.display = 'none';
        // Load messages for the restored channel
        switchChannel(currentChannel);
    } else {
        showFriendsView();
    }
}

function getServerOwnerId(server) {
    if (!server) return null;
    return server.ownerId ?? server.owner ?? server.creatorId ?? server.userId ?? null;
}

function isCurrentServerOwnedByUser() {
    const ownerId = getServerOwnerId(currentServer);
    if (!ownerId || !currentUser) return false;
    return String(ownerId) === String(currentUser.id);
}

function getMuteStorageKey(channelName) {
    const sid = currentServerId != null ? String(currentServerId) : 'none';
    return `tgMute:${sid}:${String(channelName)}`;
}

function isChannelMuted(channelName) {
    try {
        return localStorage.getItem(getMuteStorageKey(channelName)) === '1';
    } catch (_) {
        return false;
    }
}

function setChannelMuted(channelName, muted) {
    try {
        localStorage.setItem(getMuteStorageKey(channelName), muted ? '1' : '0');
    } catch (_) {}
}

function updateMuteSubtitle(muted) {
    const subtitle = document.getElementById('tgMuteSubtitle');
    if (!subtitle) return;
    subtitle.textContent = muted ? 'Отключены' : 'Включены';
}

function applyTelegramChannelState(channelName) {
    const footer = document.getElementById('tgChannelFooter');
    const muteToggle = document.getElementById('tgMuteToggle');

    if (footer) {
        footer.style.display = currentView === 'server' ? 'flex' : 'none';
    }

    if (muteToggle) {
        const muted = isChannelMuted(channelName);
        muteToggle.checked = muted;
        updateMuteSubtitle(muted);
    }

    const messageInput = document.getElementById('messageInput');
    const wrapper = document.querySelector('.message-input-wrapper');
    const readOnly = currentView === 'server' && !isCurrentServerOwnedByUser();

    if (messageInput) {
        messageInput.disabled = readOnly;
        messageInput.placeholder = readOnly ? 'Только чтение' : `Message #${channelName}`;
    }

    if (wrapper) {
        wrapper.classList.toggle('tg-read-only', readOnly);
    }
}

function setTelegramAddTab(tab) {
    const tabFind = document.getElementById('tgTabFindBtn');
    const tabCreate = document.getElementById('tgTabCreateBtn');
    const findPane = document.getElementById('tgFindPane');
    const createPane = document.getElementById('tgCreatePane');

    const isFind = tab === 'find';
    tabFind?.classList.toggle('active', isFind);
    tabCreate?.classList.toggle('active', !isFind);
    if (findPane) findPane.style.display = isFind ? 'block' : 'none';
    if (createPane) createPane.style.display = isFind ? 'none' : 'block';

    if (isFind) {
        document.getElementById('tgFindInput')?.focus();
    } else {
        document.getElementById('tgCreateInput')?.focus();
    }
}

function renderTelegramFindResults(query) {
    const resultsEl = document.getElementById('tgFindResults');
    if (!resultsEl) return;

    const q = String(query || '').trim().toLowerCase();
    const list = (servers || [])
        .filter(s => {
            const name = String(s?.name || '').toLowerCase();
            return q === '' || name.includes(q);
        })
        .slice(0, 12);

    resultsEl.innerHTML = '';
    list.forEach(server => {
        const item = document.createElement('div');
        item.className = 'tg-find-item';

        const left = document.createElement('div');
        const name = document.createElement('div');
        name.className = 'tg-find-name';
        name.textContent = server.name;
        const hint = document.createElement('div');
        hint.className = 'tg-find-hint';
        hint.textContent = 'Открыть канал';
        left.appendChild(name);
        left.appendChild(hint);

        const right = document.createElement('div');
        right.className = 'tg-find-hint';
        right.textContent = '→';

        item.appendChild(left);
        item.appendChild(right);
        item.addEventListener('click', () => {
            const icon = document.querySelector(`.server-icon[data-server-id="${server.id}"]`);
            if (icon) icon.click();
            else showServerView(server);
            closeTelegramAddMenu();
        });

        resultsEl.appendChild(item);
    });
}

function openTelegramAddMenu() {
    const overlay = document.getElementById('tgAddOverlay');
    if (!overlay) return;
    overlay.style.display = 'flex';
    setTelegramAddTab('find');

    const findInput = document.getElementById('tgFindInput');
    if (findInput) {
        findInput.value = '';
        findInput.focus();
        renderTelegramFindResults('');
    }
}

function closeTelegramAddMenu() {
    const overlay = document.getElementById('tgAddOverlay');
    if (!overlay) return;
    overlay.style.display = 'none';
}

function initializeTelegramChannelUI() {
    const muteToggle = document.getElementById('tgMuteToggle');
    if (muteToggle) {
        muteToggle.addEventListener('change', () => {
            setChannelMuted(currentChannel, Boolean(muteToggle.checked));
            updateMuteSubtitle(Boolean(muteToggle.checked));
        });
    }

    const overlay = document.getElementById('tgAddOverlay');
    const closeBtn = document.getElementById('tgAddCloseBtn');
    if (closeBtn) closeBtn.addEventListener('click', closeTelegramAddMenu);
    if (overlay) {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeTelegramAddMenu();
        });
    }

    const tabFind = document.getElementById('tgTabFindBtn');
    const tabCreate = document.getElementById('tgTabCreateBtn');
    tabFind?.addEventListener('click', () => setTelegramAddTab('find'));
    tabCreate?.addEventListener('click', () => setTelegramAddTab('create'));

    const findInput = document.getElementById('tgFindInput');
    findInput?.addEventListener('input', () => renderTelegramFindResults(findInput.value));

    const createBtn = document.getElementById('tgCreateSubmit');
    createBtn?.addEventListener('click', async () => {
        const nameInput = document.getElementById('tgCreateInput');
        const name = nameInput?.value || '';
        await createNewServer(name);
        if (nameInput) nameInput.value = '';
        closeTelegramAddMenu();
    });
}

function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
}

function showNotification(title, body) {
    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(title, { body, icon: '/assets/icon.png' });
    }
}

function updateUserInfo() {
    const userAvatar = document.querySelector('.user-avatar');
    const username = document.querySelector('.username');
    
    if (userAvatar) userAvatar.textContent = currentUser.avatar;
    if (username) username.textContent = currentUser.username;
}

function connectToSocketIO() {
    if (typeof io !== 'undefined') {
        socket = io({ auth: { token: token } });
        
        socket.on('connect', () => {
            console.log('Connected to server');
            // Ensure we are in the current text channel room after reconnect/refresh
            try {
                const channelId = getChannelIdByName(currentChannel);
                currentTextChannelId = channelId;
                socket.emit('join-text-channel', channelId);
            } catch (_) {}
        });
        
       socket.on('connect_error', (error) => {
            console.error('Connection error:', error);
        });
        
        socket.on('new-message', (data) => {
            const incomingChannelId = Number(data.channelId);
            const currentChannelId = getChannelIdByName(currentChannel);

            const channelName = getChannelNameById(incomingChannelId);

            if (!channels[channelName]) {
                channels[channelName] = [];
            }
            channels[channelName].push(data.message);
            
            if (incomingChannelId === currentChannelId && currentView === 'server') {
                addMessageToUI(data.message);
                scrollToBottom();
            }
            
            if (document.hidden) {
                if (!isChannelMuted(channelName)) {
                    showNotification('New Message', `${data.message.author}: ${data.message.text}`);
                }
            }
        });
        
        socket.on('reaction-update', (data) => {
            updateMessageReactions(data.messageId, data.reactions);
        });

        // WebRTC Signaling
        socket.on('user-joined-voice', (data) => {
            console.log('User joined voice:', data);
            createPeerConnection(data.socketId, true);
        });

        socket.on('existing-voice-users', (users) => {
            users.forEach(user => {
                createPeerConnection(user.socketId, false);
            });
        });

        socket.on('user-left-voice', (socketId) => {
            if (peerConnections[socketId]) {
                peerConnections[socketId].close();
                delete peerConnections[socketId];
            }
            const remoteVideo = document.getElementById(`remote-${socketId}`);
            if (remoteVideo) remoteVideo.remove();
        });

        socket.on('offer', async (data) => {
            if (!peerConnections[data.from]) {
                createPeerConnection(data.from, false);
            }
            const pc = peerConnections[data.from];
            await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.emit('answer', { to: data.from, answer: answer });
        });

        socket.on('answer', async (data) => {
            const pc = peerConnections[data.from];
            if (pc) {
                await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
            }
        });

        socket.on('ice-candidate', async (data) => {
            const pc = peerConnections[data.from];
            if (pc && data.candidate) {
                await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
            }
        });
        
        socket.on('video-toggle', (data) => {
            // Update UI when peer toggles video
            const participantDiv = document.getElementById(`participant-${data.from}`);
            if (participantDiv) {
                if (data.enabled) {
                    participantDiv.style.opacity = '1';
                } else {
                    participantDiv.style.opacity = '0.7';
                }
            }
        });
        socket.on('new-dm', (data) => {
            if (data.senderId === currentDMUserId) {
                addMessageToUI({
                    id: data.message.id,
                    author: data.message.author,
                    avatar: data.message.avatar,
                    text: data.message.text,
                    timestamp: data.message.timestamp
                });
                scrollToBottom();
            }
        });

        socket.on('dm-sent', (data) => {
            if (data.receiverId === currentDMUserId) {
                addMessageToUI({
                    id: data.message.id,
                    author: currentUser.username,
                    avatar: currentUser.avatar,
                    text: data.message.text,
                    timestamp: data.message.timestamp
                });
                scrollToBottom();
            }
        });

        socket.on('new-friend-request', () => {
            loadPendingRequests();
            showNotification('New Friend Request', 'You have a new friend request!');
        });

        socket.on('incoming-call', (data) => {
            const { from, type } = data;
            if (from) {
                showIncomingCall(from, type);
            }
        });

        socket.on('call-accepted', (data) => {
            console.log('Call accepted by:', data.from);
            // When call is accepted, create peer connection
            document.querySelector('.call-channel-name').textContent = `Connected with ${data.from.username}`;
            
            // Create peer connection as initiator
            if (!peerConnections[data.from.socketId]) {
                createPeerConnection(data.from.socketId, true);
            }
        });

        socket.on('call-rejected', (data) => {
            alert('Call was declined');
            // Close call interface
            const callInterface = document.getElementById('callInterface');
            callInterface.classList.add('hidden');
            if (localStream) {
                localStream.getTracks().forEach(track => track.stop());
                localStream = null;
            }
            inCall = false;
        });
        
        socket.on('call-ended', (data) => {
            // Handle when other party ends the call
            if (peerConnections[data.from]) {
                peerConnections[data.from].close();
                delete peerConnections[data.from];
            }
            const remoteVideo = document.getElementById(`remote-${data.from}`);
            if (remoteVideo) remoteVideo.remove();
            
            // If no more connections, end the call
            if (Object.keys(peerConnections).length === 0) {
                leaveVoiceChannel(true);
            }
        });
    }
}

// Initialize friends tabs
function initializeFriendsTabs() {
    const tabs = document.querySelectorAll('.friends-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.getAttribute('data-tab');
            switchFriendsTab(tabName);
        });
    });
    
    const searchBtn = document.getElementById('searchUserBtn');
    if (searchBtn) {
        searchBtn.addEventListener('click', searchUsers);
    }
    
    loadFriends();
}

function switchFriendsTab(tabName) {
    document.querySelectorAll('.friends-tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
    
    document.querySelectorAll('.friends-list').forEach(l => l.classList.remove('active-tab'));
    const contentMap = {
        'online': 'friendsOnline',
        'all': 'friendsAll',
        'pending': 'friendsPending',
        'add': 'friendsAdd'
    };
    document.getElementById(contentMap[tabName]).classList.add('active-tab');
    
    if (tabName === 'pending') {
        loadPendingRequests();
    }
}

async function loadFriends() {
    try {
        const response = await fetch('/api/friends', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const friends = await response.json();
        displayFriends(friends);
        populateDMList(friends);
    } catch (error) {
        console.error('Error loading friends:', error);
    }
}

function displayFriends(friends) {
    const onlineList = document.getElementById('friendsOnline');
    const allList = document.getElementById('friendsAll');
    
    onlineList.innerHTML = '';
    allList.innerHTML = '';
    
    if (friends.length === 0) {
        onlineList.innerHTML = '<div class="friends-empty">No friends yet</div>';
        allList.innerHTML = '<div class="friends-empty">No friends yet</div>';
        return;
    }
    
    const onlineFriends = friends.filter(f => f.status === 'Online');
    
    if (onlineFriends.length === 0) {
        onlineList.innerHTML = '<div class="friends-empty">No one is online</div>';
    } else {
        onlineFriends.forEach(friend => {
            onlineList.appendChild(createFriendItem(friend));
        });
    }
    
    friends.forEach(friend => {
        allList.appendChild(createFriendItem(friend));
    });
}

function createFriendItem(friend) {
    const div = document.createElement('div');
    div.className = 'friend-item';
    
    div.innerHTML = `
        <div class="friend-avatar">${friend.avatar || friend.username.charAt(0).toUpperCase()}</div>
        <div class="friend-info">
            <div class="friend-name">${friend.username}</div>
            <div class="friend-status ${friend.status === 'Online' ? '' : 'offline'}">${friend.status}</div>
        </div>
        <div class="friend-actions">
            <button class="friend-action-btn message" title="Message">💬</button>
            <button class="friend-action-btn audio-call" title="Audio Call">📞</button>
            <button class="friend-action-btn video-call" title="Video Call">📹</button>
            <button class="friend-action-btn remove" title="Remove">🗑️</button>
        </div>
    `;

    div.querySelector('.message').addEventListener('click', () => startDM(friend.id, friend.username));
    div.querySelector('.audio-call').addEventListener('click', () => initiateCall(friend.id, 'audio'));
    div.querySelector('.video-call').addEventListener('click', () => initiateCall(friend.id, 'video'));
    div.querySelector('.remove').addEventListener('click', () => removeFriend(friend.id));
    
    return div;
}

async function searchUsers() {
    const searchInput = document.getElementById('searchUserInput');
    const query = searchInput.value.trim();
    
    if (!query) return;
    
    try {
        const response = await fetch('/api/users', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const users = await response.json();
        
        const results = users.filter(u => 
            u.username.toLowerCase().includes(query.toLowerCase()) && 
            u.id !== currentUser.id
        );
        
        displaySearchResults(results);
    } catch (error) {
        console.error('Error searching users:', error);
    }
}

function displaySearchResults(users) {
    const resultsDiv = document.getElementById('searchResults');
    resultsDiv.innerHTML = '';
    
    if (users.length === 0) {
        resultsDiv.innerHTML = '<div class="friends-empty">No users found</div>';
        return;
    }
    
    users.forEach(user => {
        const div = document.createElement('div');
        div.className = 'user-search-item';
        
        div.innerHTML = `
            <div class="user-avatar">${user.avatar || user.username.charAt(0).toUpperCase()}</div>
            <div class="user-info">
                <div class="user-name">${user.username}</div>
            </div>
            <button class="add-friend-btn" onclick="sendFriendRequest(${user.id})">Add Friend</button>
        `;
        
        resultsDiv.appendChild(div);
    });
}

window.sendFriendRequest = async function(friendId) {
    try {
        const response = await fetch('/api/friends/request', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ friendId })
        });
        
        if (response.ok) {
            alert('Friend request sent!');
        } else {
            const error = await response.json();
            alert(error.error || 'Failed to send request');
        }
    } catch (error) {
        console.error('Error sending friend request:', error);
        alert('Failed to send friend request');
    }
};

async function loadPendingRequests() {
    try {
        const response = await fetch('/api/friends/pending', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const requests = await response.json();
        
        const pendingList = document.getElementById('friendsPending');
        pendingList.innerHTML = '';
        
        if (requests.length === 0) {
            pendingList.innerHTML = '<div class="friends-empty">No pending requests</div>';
            return;
        }
        
        requests.forEach(request => {
            const div = document.createElement('div');
            div.className = 'friend-item';
            
            div.innerHTML = `
                <div class="friend-avatar">${request.avatar || request.username.charAt(0).toUpperCase()}</div>
                <div class="friend-info">
                    <div class="friend-name">${request.username}</div>
                    <div class="friend-status">Incoming Friend Request</div>
                </div>
                <div class="friend-actions">
                    <button class="friend-action-btn accept" onclick="acceptFriendRequest(${request.id})">✓</button>
                    <button class="friend-action-btn reject" onclick="rejectFriendRequest(${request.id})">✕</button>
                </div>
            `;
            
            pendingList.appendChild(div);
        });
    } catch (error) {
        console.error('Error loading pending requests:', error);
    }
}

window.acceptFriendRequest = async function(friendId) {
    try {
        const response = await fetch('/api/friends/accept', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ friendId })
        });
        
        if (response.ok) {
            loadPendingRequests();
            loadFriends();
        }
    } catch (error) {
        console.error('Error accepting friend request:', error);
    }
};

window.rejectFriendRequest = async function(friendId) {
    try {
        const response = await fetch('/api/friends/reject', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ friendId })
        });
        
        if (response.ok) {
            loadPendingRequests();
        }
    } catch (error) {
        console.error('Error rejecting friend request:', error);
    }
};

window.removeFriend = async function(friendId) {
    if (!confirm('Are you sure you want to remove this friend?')) return;
    
    try {
        const response = await fetch(`/api/friends/${friendId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (response.ok) {
            loadFriends();
        }
    } catch (error) {
        console.error('Error removing friend:', error);
    }
};

// Initiate call function
async function initiateCall(friendId, type) {
    try {
        // On mobile, start with camera on by default.
        // On desktop, start audio-only to avoid auto camera enable.
        const constraints = isMobileLayout()
            ? { video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: true }
            : { video: false, audio: true };
        
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        
        // Show call interface
        const callInterface = document.getElementById('callInterface');
        callInterface.classList.remove('hidden');
        callInterface.classList.toggle('fullscreen', isMobileLayout());
        
        // Update call header
        document.querySelector('.call-channel-name').textContent = `Calling...`;
        
        // Set local video
        const localVideo = document.getElementById('localVideo');
        localVideo.srcObject = localStream;
        setLocalPlaceholderVisible(localStream.getVideoTracks().length === 0);
        // Monitor local speaking (green outline when you speak)
        const callRoot = document.getElementById('callInterface');
        if (callRoot) monitorSpeaking(localStream, callRoot, { threshold: 0.015 });
        
        // Store call details
        window.currentCallDetails = {
            friendId: friendId,
            type: type,
            isInitiator: true,
            originalType: type
        };
        
        // Emit call request via socket
        if (socket && socket.connected) {
            socket.emit('initiate-call', {
                to: friendId,
                type: type,
                from: {
                    id: currentUser.id,
                    username: currentUser.username,
                    socketId: socket.id
                }
            });
        }
        
        inCall = true;
        isVideoEnabled = isMobileLayout(); // camera on by default on mobile
        isAudioEnabled = true;
        updateCallButtons();
        
        // Initialize resizable functionality after a short delay
        setTimeout(() => {
            if (typeof initializeResizableVideos === 'function') {
                initializeResizableVideos();
            }
        }, 100);
        
    } catch (error) {
        console.error('Error initiating call:', error);
        alert('Failed to access camera/microphone. Please check permissions.');
    }
}

// Show incoming call notification
function showIncomingCall(caller, type) {
    const incomingCallDiv = document.getElementById('incomingCall');
    const callerName = incomingCallDiv.querySelector('.caller-name');
    const callerAvatar = incomingCallDiv.querySelector('.caller-avatar');
    
    callerName.textContent = caller.username || 'Unknown User';
    callerAvatar.textContent = caller.avatar || caller.username?.charAt(0).toUpperCase() || 'U';
    
    incomingCallDiv.classList.remove('hidden');
    
    // Set up accept/reject handlers
    const acceptBtn = document.getElementById('acceptCallBtn');
    const rejectBtn = document.getElementById('rejectCallBtn');
    
    acceptBtn.onclick = async () => {
        incomingCallDiv.classList.add('hidden');
        await acceptCall(caller, type);
    };
    
    rejectBtn.onclick = () => {
        incomingCallDiv.classList.add('hidden');
        rejectCall(caller);
    };
    
    // Auto-reject after 30 seconds
    setTimeout(() => {
        if (!incomingCallDiv.classList.contains('hidden')) {
            incomingCallDiv.classList.add('hidden');
            rejectCall(caller);
        }
    }, 30000);
}

// Accept incoming call
async function acceptCall(caller, type) {
    try {
        // On mobile, start with camera on by default.
        // On desktop, start audio-only; user can enable camera later.
        const constraints = isMobileLayout()
            ? { video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: true }
            : { video: false, audio: true };
        
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        
        // Show call interface
        const callInterface = document.getElementById('callInterface');
        callInterface.classList.remove('hidden');
        callInterface.classList.toggle('fullscreen', isMobileLayout());
        
        document.querySelector('.call-channel-name').textContent = `Call with ${caller.username}`;
        
        const localVideo = document.getElementById('localVideo');
        localVideo.srcObject = localStream;
        setLocalPlaceholderVisible(localStream.getVideoTracks().length === 0);
        // Monitor local speaking (green outline when you speak)
        const callRoot = document.getElementById('callInterface');
        if (callRoot) monitorSpeaking(localStream, callRoot, { threshold: 0.015 });
        
        // Store call details
        window.currentCallDetails = {
            peerId: caller.socketId,
            type: type,
            isInitiator: false,
            originalType: type
        };
        
        if (socket && socket.connected) {
            socket.emit('accept-call', {
                to: caller.socketId,
                from: {
                    id: currentUser.id,
                    username: currentUser.username,
                    socketId: socket.id
                }
            });
        }
        
        inCall = true;
        isVideoEnabled = isMobileLayout();
        isAudioEnabled = true;
        updateCallButtons();
        
        // Create peer connection as receiver (not initiator)
        if (!peerConnections[caller.socketId]) {
            createPeerConnection(caller.socketId, false);
        }
        
        // Initialize resizable functionality after a short delay
        setTimeout(() => {
            if (typeof initializeResizableVideos === 'function') {
                initializeResizableVideos();
            }
        }, 100);
        
    } catch (error) {
        console.error('Error accepting call:', error);
        alert('Failed to access camera/microphone. Please check permissions.');
    }
}

// Reject incoming call
function rejectCall(caller) {
    if (socket && socket.connected) {
        socket.emit('reject-call', { to: caller.socketId });
    }
}

window.startDM = async function(friendId, friendUsername) {
    currentView = 'dm';
    currentDMUserId = friendId;
    currentServerId = null;
    currentServer = null;

    document.getElementById('friendsView').style.display = 'none';
    document.getElementById('chatView').style.display = 'flex';
    document.getElementById('channelsView').style.display = 'none';
    document.getElementById('dmListView').style.display = 'block';

    const chatHeaderInfo = document.getElementById('chatHeaderInfo');
    chatHeaderInfo.innerHTML = `
        <div class="chat-user-avatar">${friendUsername.charAt(0).toUpperCase()}</div>
        <div class="chat-user-meta">
            <div class="chat-user-name">${friendUsername}</div>
            <div class="chat-user-status">В сети</div>
        </div>
        <button class="chat-action-btn" id="dmHeaderCallBtn" title="Позвонить">📞</button>
    `;

    const dmHeaderCallBtn = document.getElementById('dmHeaderCallBtn');
    if (dmHeaderCallBtn) {
        dmHeaderCallBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            initiateCall(friendId, 'audio');
        });
    }

    // Inject DM header actions
    const controls = document.querySelector('.chat-header .chat-controls');
    if (controls && controls.childElementCount === 1) { // keep existing membersBtn, add actions once
        controls.innerHTML = `
            <button class="chat-action-btn" id="dmCallBtn" title="Аудиозвонок">📞</button>
            <button class="chat-action-btn" id="dmVideoBtn" title="Видеозвонок">📹</button>
            <button class="chat-action-btn" id="dmSearchBtn" title="Поиск">🔍</button>
            <button class="chat-action-btn" id="dmMoreBtn" title="Ещё">⋯</button>
        `;
    }
    
    document.getElementById('messageInput').placeholder = `Message @${friendUsername}`;

    closeMobileDrawer();

    enterChatMode();
    
    await loadDMHistory(friendId);
};

// Show friends view
function showFriendsView() {
    currentView = 'friends';
    currentDMUserId = null;
    currentServerId = null;
    currentServer = null;

    document.getElementById('friendsView').style.display = 'flex';
    document.getElementById('chatView').style.display = 'none';
    document.getElementById('channelsView').style.display = 'none';
    document.getElementById('dmListView').style.display = 'block';
    
    document.getElementById('serverName').textContent = 'Friends';
    
    document.querySelectorAll('.server-icon').forEach(icon => icon.classList.remove('active'));
    document.getElementById('friendsBtn').classList.add('active');
    
    // Hide chat and show friends content
    document.getElementById('chatView').style.display = 'none';
    document.getElementById('friendsView').style.display = 'flex';

    closeMobileDrawer();
}

function showDMHomeView() {
    currentView = 'dm_home';
    currentDMUserId = null;
    currentServerId = null;
    currentServer = null;

    document.getElementById('friendsView').style.display = 'none';
    document.getElementById('chatView').style.display = 'none';
    document.getElementById('channelsView').style.display = 'none';
    document.getElementById('dmListView').style.display = 'block';

    document.getElementById('serverName').textContent = 'Friends';
    document.querySelectorAll('.server-icon').forEach(icon => icon.classList.remove('active'));
    const friendsBtn = document.getElementById('friendsBtn');
    if (friendsBtn) friendsBtn.classList.add('active');

    openMobileDrawer(false);
    closeFriendsOverlay();
}

// Show server view
function showServerView(server) {
    currentView = 'server';
    currentServerId = server.id;
    currentServer = server;
    currentDMUserId = null;

    document.getElementById('friendsView').style.display = 'none';
    document.getElementById('chatView').style.display = 'flex';
    document.getElementById('channelsView').style.display = 'block';
    document.getElementById('dmListView').style.display = 'none';

    document.getElementById('serverName').textContent = server.name;
    switchChannel('general');

    closeMobileDrawer();
    closeFriendsOverlay();
}

function isMobileLayout() {
    return window.matchMedia && window.matchMedia('(max-width: 768px)').matches;
}

function openMobileDrawer(showOverlay = true) {
    if (!isMobileLayout()) return;
    const channelList = document.getElementById('channelList');
    const overlay = document.getElementById('mobileOverlay');
    if (channelList) channelList.classList.add('mobile-open');
    if (overlay) overlay.style.display = showOverlay ? 'block' : 'none';
}

function closeMobileDrawer() {
    const channelList = document.getElementById('channelList');
    const overlay = document.getElementById('mobileOverlay');
    if (channelList) channelList.classList.remove('mobile-open');
    if (overlay) overlay.style.display = 'none';
}

function initializeMobileUI() {
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const overlay = document.getElementById('mobileOverlay');
    const addFriendBtn = document.getElementById('mobileAddFriendBtn');
    const closeFriendsBtn = document.getElementById('mobileCloseFriendsBtn');

    if (mobileMenuBtn) {
        mobileMenuBtn.addEventListener('click', () => {
            const channelList = document.getElementById('channelList');
            if (!channelList) return;
            const isOpen = channelList.classList.contains('mobile-open');
            if (isOpen) closeMobileDrawer();
            else openMobileDrawer();
        });
    }

    if (overlay) {
        overlay.addEventListener('click', () => {
            closeMobileDrawer();
        });
    }

    if (addFriendBtn) {
        addFriendBtn.addEventListener('click', () => {
            openFriendsOverlay();
        });
    }

    if (closeFriendsBtn) {
        closeFriendsBtn.addEventListener('click', () => {
            closeFriendsOverlay();
        });
    }
}

function openFriendsOverlay() {
    if (!isMobileLayout()) {
        showFriendsView();
        switchFriendsTab('add');
        return;
    }

    const friendsView = document.getElementById('friendsView');
    if (friendsView) friendsView.style.display = 'flex';
    switchFriendsTab('add');
    closeMobileDrawer();

    enterChatMode();
}

function closeFriendsOverlay() {
    if (!isMobileLayout()) return;
    const friendsView = document.getElementById('friendsView');
    if (friendsView) friendsView.style.display = 'none';
}

async function loadUserServers() {
    try {
        const response = await fetch('/api/servers', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        servers = await response.json();
        servers.forEach(server => addServerToUI(server, false));
    } catch (error) {
        console.error('Error loading servers:', error);
    }
}

function initializeServerManagement() {
    const friendsBtn = document.getElementById('friendsBtn');
    const addServerBtn = document.getElementById('addServerBtn');
    
    friendsBtn.addEventListener('click', () => {
        if (isMobileLayout()) {
            showDMHomeView();
        } else {
            showFriendsView();
        }
    });
    
    addServerBtn.addEventListener('click', () => {
        openTelegramAddMenu();
    });

    // Global handler to close context menu
    document.addEventListener('click', () => removeContextMenu());
    document.addEventListener('contextmenu', (e) => {
        // Close any open menu when right-clicking elsewhere
        if (!(e.target && e.target.closest('.server-icon'))) {
            removeContextMenu();
        }
    });
}

async function createNewServer(serverName) {
    if (!serverName || serverName.trim() === '') return;
    
    try {
        const response = await fetch('/api/servers', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name: serverName.trim() })
        });
        
        if (response.ok) {
            const server = await response.json();
            servers.push(server);
            addServerToUI(server, true);
        }
    } catch (error) {
        console.error('Error creating server:', error);
        alert('Failed to create server');
    }
}

function addServerToUI(server, switchTo = false) {
    const serverList = document.querySelector('.server-list');
    const addServerBtn = document.getElementById('addServerBtn');
    
    const serverIcon = document.createElement('div');
    serverIcon.className = 'server-icon';
    serverIcon.textContent = server.icon;
    serverIcon.title = server.name;
    serverIcon.setAttribute('data-server-id', server.id);
    
    serverIcon.addEventListener('click', () => {
        document.querySelectorAll('.server-icon').forEach(icon => icon.classList.remove('active'));
        serverIcon.classList.add('active');
        showServerView(server);
    });

    // Right-click context menu on server icon
    serverIcon.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showServerContextMenu(e.clientX, e.clientY);
    });
    
    serverList.insertBefore(serverIcon, addServerBtn);
    
    if (switchTo) {
        serverIcon.click();
    }
}

function showServerContextMenu(x, y) {
    removeContextMenu();
    const menu = document.createElement('div');
    menu.className = 'context-menu';

    const leaveItem = document.createElement('div');
    leaveItem.className = 'context-menu-item';
    leaveItem.textContent = 'Выйти из канала';
    leaveItem.addEventListener('click', () => {
        // Leave voice if in call
        leaveVoiceChannel(true);
        // Also exit text channel view back to Friends
        showFriendsView();
        // Clear active selection on server icons
        document.querySelectorAll('.server-icon').forEach(icon => icon.classList.remove('active'));
        removeContextMenu();
    });

    // Disable item if not in a call
    // Always enabled: leaving channel should be allowed even when not in a call

    menu.appendChild(leaveItem);

    // Position within viewport bounds
    const padding = 8;
    const maxX = window.innerWidth - 200 - padding;
    const maxY = window.innerHeight - 120 - padding;
    menu.style.left = Math.min(x, maxX) + 'px';
    menu.style.top = Math.min(y, maxY) + 'px';

    document.body.appendChild(menu);
}

function removeContextMenu() {
    const existing = document.querySelector('.context-menu');
    if (existing) existing.remove();
}

function showChannelContextMenu(channelEl, x, y) {
    removeContextMenu();
    const menu = document.createElement('div');
    menu.className = 'context-menu';

    const leaveItem = document.createElement('div');
    leaveItem.className = 'context-menu-item';
    leaveItem.textContent = 'Выйти из канала';
    leaveItem.addEventListener('click', () => {
        // Exit voice if any
        leaveVoiceChannel(true);
        // Leave current text channel room and view
        const leavingId = getChannelIdByName(currentChannel);
        if (socket && socket.connected) {
            socket.emit('leave-text-channel', leavingId);
        }
        // Reset selection and go на вкладку друзей
        document.querySelectorAll('.text-channel').forEach(ch => ch.classList.remove('active'));
        showFriendsView();
        removeContextMenu();
    });

    menu.appendChild(leaveItem);

    const padding = 8;
    const maxX = window.innerWidth - 200 - padding;
    const maxY = window.innerHeight - 120 - padding;
    menu.style.left = Math.min(x, maxX) + 'px';
    menu.style.top = Math.min(y, maxY) + 'px';

    document.body.appendChild(menu);
}

function initializeChannels() {
    const channelElements = document.querySelectorAll('.channel');
    
    channelElements.forEach(channel => {
        channel.addEventListener('click', () => {
            if (channel.classList.contains('dm-item') || channel.hasAttribute('data-dm-id')) return;
            const channelName = channel.getAttribute('data-channel');
            const isVoiceChannel = channel.classList.contains('voice-channel');
            
            if (isVoiceChannel) {
                // Pass both machine id and visible name
                const visibleName = channel.querySelector('span')?.textContent?.trim() || channelName;
                joinVoiceChannel(channelName, visibleName);
            } else {
                // When switching, ensure we join the proper text room
                switchChannel(channelName);
            }
        });

        // Right-click context menu on channel items (voice channels)
        channel.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showChannelContextMenu(channel, e.clientX, e.clientY);
        });
    });
}

function switchChannel(channelName) {
    currentView = 'server';
    currentDMUserId = null;
    currentChannel = channelName;
    const nextChannelId = getChannelIdByName(channelName);
    // Leave previous text room and join new one
    try {
        if (socket && socket.connected) {
            if (typeof currentTextChannelId !== 'undefined' && currentTextChannelId !== nextChannelId) {
                socket.emit('leave-text-channel', currentTextChannelId);
            }
            socket.emit('join-text-channel', nextChannelId);
        }
    } catch (_) {}
    
    document.querySelectorAll('.text-channel').forEach(ch => ch.classList.remove('active'));
    const channelEl = document.querySelector(`[data-channel="${channelName}"]`);
    if (channelEl) channelEl.classList.add('active');
    
    const headerEl = document.getElementById('currentChannelName');
    if (headerEl) headerEl.textContent = channelName;
    document.getElementById('messageInput').placeholder = `Message #${channelName}`;

    const chatHeaderInfo = document.getElementById('chatHeaderInfo');
    if (chatHeaderInfo) {
        chatHeaderInfo.innerHTML = `<div class="chat-channel-title"># ${channelName}</div>`;
    }

    applyTelegramChannelState(channelName);

    const friendsView = document.getElementById('friendsView');
    const chatView = document.getElementById('chatView');
    const channelsView = document.getElementById('channelsView');
    const dmListView = document.getElementById('dmListView');
    if (friendsView) friendsView.style.display = 'none';
    if (chatView) chatView.style.display = 'flex';
    if (channelsView) channelsView.style.display = 'block';
    if (dmListView) dmListView.style.display = 'none';

    closeMobileDrawer();

    enterChatMode();
    
    loadChannelMessages(channelName);

    // Persist selection
    localStorage.setItem('lastView', 'server');
    if (currentServerId != null) localStorage.setItem('lastServerId', String(currentServerId));
    localStorage.setItem('lastChannelName', channelName);
}

// Функция для входа в режим чата (скрытие плашек)
function enterChatMode() {
    if (window.innerWidth <= 768) {
        document.body.classList.add('mobile-chat-mode');
    }
}

// Функция для выхода из режима чата (показ плашек)
function exitChatMode() {
    document.body.classList.remove('mobile-chat-mode');
}

// Слушатель для всех каналов
document.addEventListener('click', (e) => {
    // Если кликнули по каналу или другу (ЛС)
    if (e.target.closest('.channel') || e.target.closest('.friend-item') || e.target.closest('.dm-item')) {
        enterChatMode();
    }
});

// Навешиваем событие на кнопки "Назад"
document.getElementById('backBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    exitChatMode();
});

document.getElementById('backBtnFriends')?.addEventListener('click', (e) => {
    e.stopPropagation();
    exitChatMode();
});

// Если при загрузке выбирается канал — проверяем ширину экрана
if (currentChannel && window.innerWidth <= 768) {
    // Если нужно чтобы сразу открывался чат, раскомментируй:
    // enterChatMode();
}

function initializeMessageInput() {
    const messageInput = document.getElementById('messageInput');
    
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
}

function sendMessage() {
    const messageInput = document.getElementById('messageInput');
    const text = messageInput.value.trim();
    
    if (text === '') return;

    if (currentView === 'server' && !isCurrentServerOwnedByUser()) {
        return;
    }

    const message = {
        text: text,
    };

    if (socket && socket.connected) {
        if (currentView === 'dm' && currentDMUserId) {
            socket.emit('send-dm', {
                receiverId: currentDMUserId,
                message: message
            });
        } else if (currentView === 'server') {
            const channelId = getChannelIdByName(currentChannel);
            socket.emit('send-message', {
                channelId: channelId,
                message: message
            });
        }
    }
    
    messageInput.value = '';
}

function addMessageToUI(message) {
    const messagesContainer = document.getElementById('messagesContainer');
    
    const messageGroup = document.createElement('div');
    messageGroup.className = 'message-group';
    messageGroup.setAttribute('data-message-id', message.id || Date.now());
    if (message.author) messageGroup.setAttribute('data-author', message.author);
    
    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = message.avatar;
    // Context menu on avatar
    avatar.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (message.author) showUserContextMenu(message.author, e.clientX, e.clientY);
    });
    
    const content = document.createElement('div');
    content.className = 'message-content';
    
    const header = document.createElement('div');
    header.className = 'message-header';
    
    const author = document.createElement('span');
    author.className = 'message-author';
    author.textContent = message.author;
    // Context menu on author name
    author.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (message.author) showUserContextMenu(message.author, e.clientX, e.clientY);
    });
    
    const timestamp = document.createElement('span');
    timestamp.className = 'message-timestamp';
    timestamp.textContent = formatTimestamp(message.timestamp);
    
    const text = document.createElement('div');
    text.className = 'message-text';
    text.textContent = message.text;
    // Context menu on message body
    text.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (message.author) showUserContextMenu(message.author, e.clientX, e.clientY);
    });
    
    const reactionsContainer = document.createElement('div');
    reactionsContainer.className = 'message-reactions';
    
    const addReactionBtn = document.createElement('button');
    addReactionBtn.className = 'add-reaction-btn';
    addReactionBtn.textContent = '😊';
    addReactionBtn.title = 'Add reaction';
    addReactionBtn.onclick = () => showEmojiPickerForMessage(message.id || Date.now());
    
    header.appendChild(author);
    header.appendChild(timestamp);
    content.appendChild(header);
    content.appendChild(text);
    content.appendChild(reactionsContainer);
    content.appendChild(addReactionBtn);
    
    messageGroup.appendChild(avatar);
    messageGroup.appendChild(content);
    
    messagesContainer.appendChild(messageGroup);
}

function formatTimestamp(date) {
    const messageDate = new Date(date);
    const hours = messageDate.getHours().toString().padStart(2, '0');
    const minutes = messageDate.getMinutes().toString().padStart(2, '0');
    return `Today at ${hours}:${minutes}`;
}

function scrollToBottom() {
    const messagesContainer = document.getElementById('messagesContainer');
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Emoji picker
function initializeEmojiPicker() {
    const emojiBtn = document.querySelector('.emoji-btn');
    if (emojiBtn) {
        emojiBtn.addEventListener('click', () => {
            showEmojiPickerForInput();
        });
    }
}

function showEmojiPickerForInput() {
    const emojis = ['😀', '😂', '❤️', '👍', '👎', '🎉', '🔥', '✨', '💯', '🚀'];
    const picker = createEmojiPicker(emojis, (emoji) => {
        const input = document.getElementById('messageInput');
        input.value += emoji;
        input.focus();
    });
    document.body.appendChild(picker);
}

function showEmojiPickerForMessage(messageId) {
    const emojis = ['👍', '❤️', '😂', '😮', '😢', '🎉'];
    const picker = createEmojiPicker(emojis, (emoji) => {
        addReaction(messageId, emoji);
    });
    document.body.appendChild(picker);
}

function createEmojiPicker(emojis, onSelect) {
    const picker = document.createElement('div');
    picker.className = 'emoji-picker';
    
    emojis.forEach(emoji => {
        const btn = document.createElement('button');
        btn.className = 'emoji-option';
        btn.textContent = emoji;
        btn.addEventListener('click', () => {
            onSelect(emoji);
            picker.remove();
        });
        picker.appendChild(btn);
    });
    
    setTimeout(() => {
        document.addEventListener('click', function closePickerAnywhere(e) {
            if (!picker.contains(e.target)) {
                picker.remove();
                document.removeEventListener('click', closePickerAnywhere);
            }
        });
    }, 100);
    
    return picker;
}

function addReaction(messageId, emoji) {
    if (socket && socket.connected) {
        socket.emit('add-reaction', { messageId, emoji });
    }
}

function updateMessageReactions(messageId, reactions) {
    const reactionsContainer = document.querySelector(`[data-message-id="${messageId}"] .message-reactions`);
    if (!reactionsContainer) return;
    
    reactionsContainer.innerHTML = '';
    
    reactions.forEach(reaction => {
        const reactionEl = document.createElement('div');
        reactionEl.className = 'reaction';
        reactionEl.innerHTML = `<span class="emoji glass-emoji">${reaction.emoji}</span> <span>${reaction.count}</span>`;
        reactionEl.title = reaction.users;
        reactionEl.addEventListener('click', () => {
            if (socket && socket.connected) {
                socket.emit('remove-reaction', { messageId, emoji: reaction.emoji });
            }
        });
        reactionsContainer.appendChild(reactionEl);
    });
}

// Right-click user context menu in chat
let usersCacheByName = null;
async function getUserIdByUsername(username) {
    try {
        if (!usersCacheByName) {
            const response = await fetch('/api/users', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const users = await response.json();
            usersCacheByName = new Map(users.map(u => [u.username, u.id]));
        }
        return usersCacheByName.get(username) || null;
    } catch (e) {
        console.error('Failed to load users cache:', e);
        return null;
    }
}

function showUserContextMenu(username, x, y) {
    removeContextMenu();
    const menu = document.createElement('div');
    menu.className = 'context-menu';

    const titleItem = document.createElement('div');
    titleItem.className = 'context-menu-item';
    titleItem.textContent = username;
    titleItem.style.opacity = '0.8';
    titleItem.style.cursor = 'default';

    const removeItem = document.createElement('div');
    removeItem.className = 'context-menu-item';
    removeItem.textContent = 'Удалить из друзей';
    removeItem.addEventListener('click', async () => {
        try {
            const friendId = await getUserIdByUsername(username);
            if (!friendId) {
                alert('Не удалось найти пользователя');
                removeContextMenu();
                return;
            }
            await window.removeFriend(friendId);
        } catch (e) {
            console.error('Remove friend error:', e);
        } finally {
            removeContextMenu();
        }
    });

    menu.appendChild(titleItem);
    menu.appendChild(removeItem);

    const padding = 8;
    const maxX = window.innerWidth - 200 - padding;
    const maxY = window.innerHeight - 120 - padding;
    menu.style.left = Math.min(x, maxX) + 'px';
    menu.style.top = Math.min(y, maxY) + 'px';

    document.body.appendChild(menu);
}

// File upload
function initializeFileUpload() {
    const attachBtn = document.querySelector('.attach-btn');
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.style.display = 'none';
    document.body.appendChild(fileInput);
    
    attachBtn.addEventListener('click', () => {
        fileInput.click();
    });
    
    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
            await uploadFile(file);
        }
        fileInput.value = '';
    });
}

async function uploadFile(file) {
    try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('channelId', currentChannel);
        
        const response = await fetch('/api/upload', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            },
            body: formData
        });
        
        if (!response.ok) {
            throw new Error('Upload failed');
        }
        
        const fileData = await response.json();
        
        const message = {
            author: currentUser.username,
            avatar: currentUser.avatar,
            text: `Uploaded ${file.name}`,
            file: fileData,
            timestamp: new Date()
        };
        
        if (socket && socket.connected) {
            const channelId = getChannelIdByName(currentChannel);
            socket.emit('send-message', {
                channelId: channelId,
                message: message
            });
        }
        
    } catch (error) {
        console.error('Upload error:', error);
        alert('Failed to upload file');
    }
}

// User controls
function initializeUserControls() {
    const muteBtn = document.getElementById('muteBtn');
    const deafenBtn = document.getElementById('deafenBtn');
    const settingsBtn = document.getElementById('settingsBtn');
    
    muteBtn.addEventListener('click', () => {
        isMuted = !isMuted;
        muteBtn.querySelector('.icon-normal').style.display = isMuted ? 'none' : 'block';
        muteBtn.querySelector('.icon-slashed').style.display = isMuted ? 'block' : 'none';
        
        if (localStream) {
            localStream.getAudioTracks().forEach(track => {
                track.enabled = !isMuted;
            });
        }
    });
    
    deafenBtn.addEventListener('click', () => {
        isDeafened = !isDeafened;
        deafenBtn.querySelector('.icon-normal').style.display = isDeafened ? 'none' : 'block';
        deafenBtn.querySelector('.icon-slashed').style.display = isDeafened ? 'block' : 'none';
        
        // When deafened, also mute microphone
        if (isDeafened) {
            if (!isMuted) {
                isMuted = true;
                muteBtn.querySelector('.icon-normal').style.display = 'none';
                muteBtn.querySelector('.icon-slashed').style.display = 'block';
            }
            
            // Mute all remote audio
            document.querySelectorAll('video[id^="remote-"]').forEach(video => {
                video.volume = 0;
            });
        } else {
            // Unmute remote audio
            document.querySelectorAll('video[id^="remote-"]').forEach(video => {
                video.volume = 1;
            });
        }

        // Update local stream audio tracks
        if (localStream) {
            localStream.getAudioTracks().forEach(track => {
                track.enabled = !isMuted;
            });
        }
    });
    
    settingsBtn.addEventListener('click', () => {
        if (confirm('Do you want to logout?')) {
            if (inCall) leaveVoiceChannel();
            localStorage.removeItem('token');
            localStorage.removeItem('currentUser');
            if (socket) socket.disconnect();
            window.location.replace('login.html');
        }
    });
}

// Voice channel functions - call persists when switching views
async function joinVoiceChannel(channelName, displayName) {
    if (inCall) {
        const callInterface = document.getElementById('callInterface');
        if (callInterface.classList.contains('hidden')) {
            callInterface.classList.remove('hidden');
        }
        return;
    }
    
    inCall = true;
    
    document.querySelectorAll('.voice-channel').forEach(ch => ch.classList.remove('in-call'));
    const channelEl = document.querySelector(`[data-channel="${channelName}"]`);
    if (channelEl) channelEl.classList.add('in-call');
    
    const callInterface = document.getElementById('callInterface');
    callInterface.classList.remove('hidden');
    
    const title = displayName || channelName;
    document.querySelector('.call-channel-name').textContent = title;
    
    try {
        await initializeMedia();
        
        // Connect to the socket for voice
        if (socket && socket.connected) {
            socket.emit('join-voice-channel', { channelName, userId: currentUser.id });
        }

    } catch (error) {
        console.error('Error initializing media:', error);
        alert('Error accessing camera/microphone. Please grant permissions.');
        leaveVoiceChannel(true); // Force leave
    }
}

async function initializeMedia() {
    try {
        // Voice channels: start with audio only
        const constraints = {
            video: false,
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                sampleRate: 48000,
                sampleSize: 16,
                channelCount: 1
            }
        };
        
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        
        const localVideo = document.getElementById('localVideo');
        localVideo.srcObject = localStream;
        setLocalPlaceholderVisible(true);
        // Monitor local speaking (green outline when you speak)
        const callRoot = document.getElementById('callInterface');
        if (callRoot) monitorSpeaking(localStream, callRoot, { threshold: 0.015 });
        
        // Log audio track status
        const audioTracks = localStream.getAudioTracks();
        console.log('Local audio tracks:', audioTracks.length);
        audioTracks.forEach(track => {
            console.log(`Audio track: ${track.label}, enabled: ${track.enabled}, readyState: ${track.readyState}`);
        });
        
        if (isMuted || isDeafened) {
            audioTracks.forEach(track => {
                track.enabled = false;
            });
        }
    } catch (error) {
        console.error('Error getting media devices:', error);
        throw error;
    }
}

function leaveVoiceChannel(force = false) {
    if (!inCall) return;

    if (force) {
        inCall = false;

        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
            localStream = null;
        }

        if (screenStream) {
            screenStream.getTracks().forEach(track => track.stop());
            screenStream = null;
        }
        
        if (socket && socket.connected) {
            socket.emit('leave-voice-channel', currentChannel);
        }

        Object.values(peerConnections).forEach(pc => pc.close());
        peerConnections = {};

        document.querySelectorAll('.voice-channel').forEach(ch => ch.classList.remove('in-call'));
        document.getElementById('remoteParticipants').innerHTML = '';
    }

    const callInterface = document.getElementById('callInterface');
    callInterface.classList.add('hidden');

    if (force) {
        const localVideo = document.getElementById('localVideo');
        localVideo.srcObject = null;
        isVideoEnabled = isMobileLayout();
        isAudioEnabled = true;
        updateCallButtons();
        setLocalPlaceholderVisible(false);
    }
}

function initializeCallControls() {
    const closeCallBtn = document.getElementById('closeCallBtn');
    const toggleVideoBtn = document.getElementById('toggleVideoBtn');
    const toggleAudioBtn = document.getElementById('toggleAudioBtn');
    const toggleScreenBtn = document.getElementById('toggleScreenBtn');
    
    closeCallBtn.addEventListener('click', () => {
        // End call for both voice channels and direct calls
        if (window.currentCallDetails) {
            // End a direct call
            Object.keys(peerConnections).forEach(socketId => {
                if (socket && socket.connected) {
                    socket.emit('end-call', { to: socketId });
                }
            });
        }
        leaveVoiceChannel(true); // Force leave on button click
    });
    
    toggleVideoBtn.addEventListener('click', () => {
        toggleVideo();
    });
    
    toggleAudioBtn.addEventListener('click', () => {
        toggleAudio();
    });
    
    toggleScreenBtn.addEventListener('click', () => {
        toggleScreenShare();
    });
}

function toggleVideo() {
    if (!localStream) return;
    
    isVideoEnabled = !isVideoEnabled;
    
    const enableVideo = async () => {
        if (localStream.getVideoTracks().length === 0) {
            try {
                const camStream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } } });
                const videoTrack = camStream.getVideoTracks()[0];
                localStream.addTrack(videoTrack);
                const localVideo = document.getElementById('localVideo');
                localVideo.srcObject = localStream;
                Object.values(peerConnections).forEach(pc => {
                    const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
                    if (sender) {
                        sender.replaceTrack(videoTrack);
                    } else {
                        pc.addTrack(videoTrack, localStream);
                    }
                });
            } catch (err) {
                console.error('Error enabling camera:', err);
                isVideoEnabled = false;
            }
        }
        localStream.getVideoTracks().forEach(track => track.enabled = true);
        setLocalPlaceholderVisible(false);
    };
    
    const disableVideo = () => {
        // Do not just disable the track (it freezes the last frame on remote).
        // Stop & remove the track and detach from peer connections.
        const tracks = localStream.getVideoTracks();
        tracks.forEach(track => {
            try { track.stop(); } catch (e) {}
            try { localStream.removeTrack(track); } catch (e) {}
        });

        Object.values(peerConnections).forEach(pc => {
            const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
            if (sender) {
                sender.replaceTrack(null);
            }
        });

        const localVideo = document.getElementById('localVideo');
        if (localVideo) {
            // Keep audio-only stream; video element will go black and placeholder will show.
            localVideo.srcObject = localStream;
        }
        setLocalPlaceholderVisible(true);
    };
    
    if (isVideoEnabled) {
        enableVideo();
    } else {
        disableVideo();
    }
    
    Object.keys(peerConnections).forEach(socketId => {
        if (socket && socket.connected) {
            socket.emit('video-toggle', {
                to: socketId,
                enabled: isVideoEnabled
            });
        }
    });
    
    updateCallButtons();
}

function toggleAudio() {
    if (!localStream) return;
    
    isAudioEnabled = !isAudioEnabled;
    localStream.getAudioTracks().forEach(track => {
        track.enabled = isAudioEnabled;
    });
    
    if (!isAudioEnabled) {
        isMuted = true;
        document.getElementById('muteBtn').classList.add('active');
    } else {
        isMuted = false;
        document.getElementById('muteBtn').classList.remove('active');
    }
    
    updateCallButtons();
}

async function toggleScreenShare() {
    // Most mobile browsers do not support getDisplayMedia.
    if (isMobileLayout() || !navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        alert('Демонстрация экрана недоступна на телефоне. Используй камеру вместо этого.');
        return;
    }

    if (screenStream) {
        // Stop screen sharing
        screenStream.getTracks().forEach(track => track.stop());
        
        // Replace screen track with camera track in all peer connections
        const videoTrack = (isVideoEnabled ? localStream.getVideoTracks()[0] : null);
        Object.values(peerConnections).forEach(pc => {
            const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
            if (sender) {
                // If camera is off / no video track exists, detach video from sender
                sender.replaceTrack(videoTrack || null);
            }
        });
        
        screenStream = null;
        
        const localVideo = document.getElementById('localVideo');
        localVideo.srcObject = localStream;
        setLocalPlaceholderVisible(!isVideoEnabled);
        
        updateCallButtons();
    } else {
        try {
            // Start screen sharing
            screenStream = await navigator.mediaDevices.getDisplayMedia({
                video: {
                    cursor: 'always',
                    width: { ideal: 1920 },
                    height: { ideal: 1080 }
                },
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    sampleRate: 44100
                }
            });
            
            const screenTrack = screenStream.getVideoTracks()[0];
            // If user stops sharing from browser UI, revert state.
            screenTrack.onended = () => {
                if (screenStream) {
                    toggleScreenShare();
                }
            };
            
            // Replace/add video track in all peer connections.
            // Calls start audio-only, so there may be NO video sender yet; in that case addTrack + renegotiate.
            let renegotiateNeeded = false;
            Object.entries(peerConnections).forEach(([remoteSocketId, pc]) => {
                const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
                if (sender) {
                    sender.replaceTrack(screenTrack);
                } else {
                    try {
                        pc.addTrack(screenTrack, screenStream);
                        renegotiateNeeded = true;
                    } catch (e) {
                        console.error('Failed to add screen track:', e);
                    }
                }
            });

            if (renegotiateNeeded) {
                renegotiateAllPeers('screen-share-start');
            }
            
            // Show screen share in local video
            const localVideo = document.getElementById('localVideo');
            const mixedStream = new MediaStream([
                screenTrack,
                ...localStream.getAudioTracks()
            ]);
            localVideo.srcObject = mixedStream;
            setLocalPlaceholderVisible(false);
            
            updateCallButtons();
        } catch (error) {
            console.error('Error sharing screen:', error);
            if (error.name === 'NotAllowedError') {
                alert('Screen sharing permission denied');
            } else {
                alert('Error sharing screen. Please try again.');
            }
        }
    }
}

async function renegotiateAllPeers(reason) {
    if (!socket || !socket.connected) return;

    const entries = Object.entries(peerConnections);
    for (const [remoteSocketId, pc] of entries) {
        if (!pc) continue;

        // Only negotiate when stable; avoids some glare issues.
        if (pc.signalingState !== 'stable') {
            continue;
        }

        try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            socket.emit('offer', {
                to: remoteSocketId,
                offer: pc.localDescription,
                reason
            });
        } catch (e) {
            console.error('Renegotiation failed:', e);
        }
    }
}

function updateCallButtons() {
    const toggleVideoBtn = document.getElementById('toggleVideoBtn');
    const toggleAudioBtn = document.getElementById('toggleAudioBtn');
    const toggleScreenBtn = document.getElementById('toggleScreenBtn');
    
    if (toggleVideoBtn) {
        toggleVideoBtn.classList.toggle('active', !isVideoEnabled);
    }
    
    if (toggleAudioBtn) {
        toggleAudioBtn.classList.toggle('active', !isAudioEnabled);
    }
    
    if (toggleScreenBtn) {
        toggleScreenBtn.classList.toggle('active', screenStream !== null);
    }
}

// Helper: show avatar placeholder when no video/screen
function setLocalPlaceholderVisible(show) {
    const localVideo = document.getElementById('localVideo');
    if (!localVideo) return;
    const container = localVideo.parentElement;
    if (!container) return;
    let placeholder = container.querySelector('#localVideoPlaceholder');
    if (!placeholder) {
        placeholder = document.createElement('div');
        placeholder.id = 'localVideoPlaceholder';
        placeholder.className = 'video-placeholder';
        const avatar = document.createElement('div');
        avatar.className = 'avatar-circle';
        avatar.textContent = (currentUser?.avatar || currentUser?.username?.charAt(0) || 'U').toString().toUpperCase();
        placeholder.appendChild(avatar);
        container.appendChild(placeholder);
    }
    placeholder.style.display = show ? 'flex' : 'none';
}

function initializeDraggableCallWindow() {
   const callInterface = document.getElementById('callInterface');
   const callHeader = callInterface.querySelector('.call-header');
   let isDragging = false;
   let offsetX, offsetY;

   callHeader.addEventListener('mousedown', (e) => {
       isDragging = true;
       offsetX = e.clientX - callInterface.offsetLeft;
       offsetY = e.clientY - callInterface.offsetTop;
       callInterface.style.transition = 'none'; // Disable transition during drag
   });

   document.addEventListener('mousemove', (e) => {
       if (isDragging) {
           let newX = e.clientX - offsetX;
           let newY = e.clientY - offsetY;

           // Constrain within viewport
           const maxX = window.innerWidth - callInterface.offsetWidth;
           const maxY = window.innerHeight - callInterface.offsetHeight;

           newX = Math.max(0, Math.min(newX, maxX));
           newY = Math.max(0, Math.min(newY, maxY));

           callInterface.style.left = `${newX}px`;
           callInterface.style.top = `${newY}px`;
       }
   });

   document.addEventListener('mouseup', () => {
       if (isDragging) {
           isDragging = false;
           callInterface.style.transition = 'all 0.3s ease'; // Re-enable transition
       }
   });
}

function getChannelIdByName(name) {
   const mapped = channelNameToId[name];
   if (typeof mapped !== 'undefined') return mapped;
   return name === 'general' ? 1 : 2;
}

function getChannelNameById(id) {
   const num = Number(id);
   const mapped = channelIdToName[num];
   if (mapped) return mapped;
   return num === 1 ? 'general' : 'random';
}

async function loadDMHistory(userId) {
   const messagesContainer = document.getElementById('messagesContainer');
   messagesContainer.innerHTML = '';

   try {
       const response = await fetch(`/api/dm/${userId}`, {
           headers: { 'Authorization': `Bearer ${token}` }
       });
       if (response.ok) {
           const messages = await response.json();
           messages.forEach(message => {
               addMessageToUI({
                   id: message.id,
                   author: message.username,
                   avatar: message.avatar || message.username.charAt(0).toUpperCase(),
                   text: message.content,
                   timestamp: message.created_at
               });
           });
       } else {
           console.error('Failed to load DM history');
       }
   } catch (error) {
       console.error('Error loading DM history:', error);
   }

   scrollToBottom();
}

console.log('Discord Clone initialized successfully!');
if (currentUser) {
   console.log('Logged in as:', currentUser.username);
}

function populateDMList(friends) {
   const dmList = document.getElementById('dmList');
   dmList.innerHTML = '';

   if (friends.length === 0) {
       const emptyDM = document.createElement('div');
       emptyDM.className = 'empty-dm-list';
       emptyDM.textContent = 'No conversations yet.';
       dmList.appendChild(emptyDM);
       return;
   }

   friends.forEach(friend => {
       const dmItem = document.createElement('div');
       dmItem.className = 'channel dm-item';
       dmItem.setAttribute('data-dm-id', friend.id);
       dmItem.innerHTML = `
           <div class="friend-avatar">${friend.avatar || friend.username.charAt(0).toUpperCase()}</div>
           <span>${friend.username}</span>
       `;
       dmItem.addEventListener('click', () => {
           startDM(friend.id, friend.username);
       });
       dmList.appendChild(dmItem);
   });
}


// Voice activity detection - adds 'speaking' class when audio detected
function monitorSpeaking(stream, element, { threshold = 0.015, attackMs = 100, releaseMs = 300 } = {}) {
    try {
        const AudioContextCls = window.AudioContext || window.webkitAudioContext;
        const ctx = new AudioContextCls();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        source.connect(analyser);

        const data = new Uint8Array(analyser.fftSize);
        let speaking = false;
        let speakHold = 0;
        let quietHold = 0;

        const attackFrames = Math.max(1, Math.round(attackMs / 16));
        const releaseFrames = Math.max(1, Math.round(releaseMs / 16));

        function tick() {
            analyser.getByteTimeDomainData(data);
            let sum = 0;
            for (let i = 0; i < data.length; i++) {
                const v = (data[i] - 128) / 128;
                sum += v * v;
            }
            const rms = Math.sqrt(sum / data.length);

            if (rms > threshold) {
                speakHold++;
                quietHold = 0;
                if (!speaking && speakHold >= attackFrames) {
                    speaking = true;
                    element.classList.add('speaking');
                }
            } else {
                quietHold++;
                speakHold = 0;
                if (speaking && quietHold >= releaseFrames) {
                    speaking = false;
                    element.classList.remove('speaking');
                }
            }
            requestAnimationFrame(tick);
        }
        tick();
    } catch (e) {
        console.warn('Voice activity monitor failed:', e);
    }
}
// WebRTC Functions
function createPeerConnection(remoteSocketId, isInitiator) {
    console.log(`Creating peer connection with ${remoteSocketId}, initiator: ${isInitiator}`);
    
    if (peerConnections[remoteSocketId]) {
        console.log('Peer connection already exists');
        return peerConnections[remoteSocketId];
    }
    
    const pc = new RTCPeerConnection({
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'stun:stun3.l.google.com:19302' },
            { urls: 'stun:stun4.l.google.com:19302' }
        ],
        iceCandidatePoolSize: 10
    });

    peerConnections[remoteSocketId] = pc;

    // Add local stream tracks with better error handling
    if (localStream) {
        const audioTracks = localStream.getAudioTracks();
        const videoTracks = localStream.getVideoTracks();
        
        console.log(`Adding tracks - Audio: ${audioTracks.length}, Video: ${videoTracks.length}`);
        
        // Add audio tracks first (priority for voice calls)
        audioTracks.forEach(track => {
            console.log(`Adding audio track: ${track.label}, enabled: ${track.enabled}`);
            pc.addTrack(track, localStream);
        });
        
        // Then add video tracks
        videoTracks.forEach(track => {
            console.log(`Adding video track: ${track.label}, enabled: ${track.enabled}`);
            pc.addTrack(track, localStream);
        });
    } else {
        console.error('No local stream available');
    }

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            console.log('Sending ICE candidate');
            socket.emit('ice-candidate', {
                to: remoteSocketId,
                candidate: event.candidate
            });
        }
    };
    
    // Handle connection state changes
    pc.oniceconnectionstatechange = () => {
        console.log(`ICE connection state: ${pc.iceConnectionState}`);
        if (pc.iceConnectionState === 'failed') {
            console.error('ICE connection failed');
            // Try to restart ICE
            pc.restartIce();
        }
        if (pc.iceConnectionState === 'connected') {
            console.log('Peer connection established successfully!');
        }
    };

    // Handle incoming remote stream
    pc.ontrack = (event) => {
        console.log('Received remote track:', event.track.kind, 'Stream ID:', event.streams[0]?.id);
        
        const remoteParticipants = document.getElementById('remoteParticipants');
        
        let participantDiv = document.getElementById(`participant-${remoteSocketId}`);
        let remoteVideo = document.getElementById(`remote-${remoteSocketId}`);
        
        if (!participantDiv) {
            participantDiv = document.createElement('div');
            participantDiv.className = 'participant';
            participantDiv.id = `participant-${remoteSocketId}`;
            
            remoteVideo = document.createElement('video');
            remoteVideo.id = `remote-${remoteSocketId}`;
            remoteVideo.autoplay = true;
            remoteVideo.playsInline = true;
            remoteVideo.volume = isDeafened ? 0 : 1; // Respect deafened state
            
            const participantName = document.createElement('div');
            participantName.className = 'participant-name';
            participantName.textContent = 'Friend';
            
            participantDiv.appendChild(remoteVideo);
            participantDiv.appendChild(participantName);
            remoteParticipants.appendChild(participantDiv);
        }
        
        // Set the stream to the video element
        if (event.streams && event.streams[0]) {
            console.log('Setting remote stream to video element');
            remoteVideo = document.getElementById(`remote-${remoteSocketId}`);
            if (remoteVideo) {
                remoteVideo.srcObject = event.streams[0];
                
                // Ensure audio is playing`n                `n                // Monitor remote speaking (green outline when peer speaks)`n                if (event.streams && event.streams[0] && participantDiv) {`n                    monitorSpeaking(event.streams[0], participantDiv, { threshold: 0.015 });`n                }
                remoteVideo.play().catch(e => {
                    console.error('Error playing remote video:', e);
                    // Try to play after user interaction
                    document.addEventListener('click', () => {
                        remoteVideo.play().catch(err => console.error('Still cannot play:', err));
                    }, { once: true });
                });
            }
        }
        
        // Initialize resizable videos
        function initializeResizableVideos() {
            const callInterface = document.getElementById('callInterface');
            const participants = callInterface.querySelectorAll('.participant');
            
            participants.forEach(participant => {
                makeResizable(participant);
            });
            
            // Make call interface resizable too
            makeInterfaceResizable(callInterface);
        }
        
        // Make individual video resizable
        function makeResizable(element) {
            // Add resize handle
            const resizeHandle = document.createElement('div');
            resizeHandle.className = 'resize-handle';
            resizeHandle.innerHTML = '↘';
            resizeHandle.style.cssText = `
                position: absolute;
                bottom: 5px;
                right: 5px;
                width: 20px;
                height: 20px;
                background: rgba(255,255,255,0.3);
                cursor: nwse-resize;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 3px;
                font-size: 12px;
                color: white;
                user-select: none;
            `;
            
            // Add video size controls
            const sizeControls = document.createElement('div');
            sizeControls.className = 'video-size-controls';
            sizeControls.innerHTML = `
                <button class="size-control-btn minimize-btn" title="Minimize">_</button>
                <button class="size-control-btn maximize-btn" title="Maximize">□</button>
                <button class="size-control-btn fullscreen-btn" title="Fullscreen">⛶</button>
            `;
            
            if (!element.querySelector('.resize-handle')) {
                element.appendChild(resizeHandle);
                element.appendChild(sizeControls);
                element.style.resize = 'both';
                element.style.overflow = 'auto';
                element.style.minWidth = '150px';
                element.style.minHeight = '100px';
                element.style.maxWidth = '90vw';
                element.style.maxHeight = '90vh';
                element.setAttribute('data-resizable', 'true');
                
                // Add double-click for fullscreen
                element.addEventListener('dblclick', function(e) {
                    if (!e.target.closest('.video-size-controls')) {
                        toggleVideoFullscreen(element);
                    }
                });
                
                // Size control buttons
                const minimizeBtn = sizeControls.querySelector('.minimize-btn');
                const maximizeBtn = sizeControls.querySelector('.maximize-btn');
                const fullscreenBtn = sizeControls.querySelector('.fullscreen-btn');
                
                minimizeBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    element.classList.toggle('minimized');
                    element.classList.remove('maximized');
                });
                
                maximizeBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    element.classList.toggle('maximized');
                    element.classList.remove('minimized');
                });
                
                fullscreenBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const video = element.querySelector('video');
                    if (video && video.requestFullscreen) {
                        video.requestFullscreen();
                    }
                });
            }
        }
        
        // Toggle video fullscreen
        function toggleVideoFullscreen(element) {
            element.classList.toggle('maximized');
            if (element.classList.contains('maximized')) {
                element.classList.remove('minimized');
            }
        }
        
        // Make call interface resizable
        function makeInterfaceResizable(callInterface) {
            const resizeHandle = document.createElement('div');
            resizeHandle.className = 'interface-resize-handle';
            resizeHandle.style.cssText = `
                position: absolute;
                bottom: 0;
                right: 0;
                width: 15px;
                height: 15px;
                cursor: nwse-resize;
                background: linear-gradient(135deg, transparent 50%, #5865f2 50%);
                border-bottom-right-radius: 12px;
            `;
            
            if (!callInterface.querySelector('.interface-resize-handle')) {
                callInterface.appendChild(resizeHandle);
                
                let isResizing = false;
                let startWidth = 0;
                let startHeight = 0;
                let startX = 0;
                let startY = 0;
                
                resizeHandle.addEventListener('mousedown', (e) => {
                    isResizing = true;
                    startWidth = parseInt(document.defaultView.getComputedStyle(callInterface).width, 10);
                    startHeight = parseInt(document.defaultView.getComputedStyle(callInterface).height, 10);
                    startX = e.clientX;
                    startY = e.clientY;
                    e.preventDefault();
                });
                
                document.addEventListener('mousemove', (e) => {
                    if (!isResizing) return;
                    
                    const newWidth = startWidth + e.clientX - startX;
                    const newHeight = startHeight + e.clientY - startY;
                    
                    if (newWidth > 300 && newWidth < window.innerWidth * 0.9) {
                        callInterface.style.width = newWidth + 'px';
                    }
                    if (newHeight > 200 && newHeight < window.innerHeight * 0.9) {
                        callInterface.style.height = newHeight + 'px';
                    }
                });
                
                document.addEventListener('mouseup', () => {
                    isResizing = false;
                });
            }
        }
        
        // Update resizable functionality when new participants join
        const originalOntrack = RTCPeerConnection.prototype.ontrack;
        window.observeNewParticipants = function() {
            setTimeout(() => {
                const participants = document.querySelectorAll('.participant:not([data-resizable])');
                participants.forEach(participant => {
                    participant.setAttribute('data-resizable', 'true');
                    makeResizable(participant);
                });
            }, 500);
        };
        
        // Make the new participant video resizable after a short delay
        setTimeout(() => {
            if (typeof makeResizable === 'function' && participantDiv) {
                makeResizable(participantDiv);
            }
        }, 100);
    };

    // Create offer if initiator with modern constraints
    if (isInitiator) {
        pc.createOffer()
        .then(offer => {
            console.log('Created offer with SDP:', offer.sdp.substring(0, 200));
            return pc.setLocalDescription(offer);
        })
        .then(() => {
            console.log('Sending offer to:', remoteSocketId);
            socket.emit('offer', {
                to: remoteSocketId,
                offer: pc.localDescription
            });
        })
        .catch(error => {
            console.error('Error creating offer:', error);
        });
    }
    
    return pc;
}

// Initialize resizable videos
function initializeResizableVideos() {
    const callInterface = document.getElementById('callInterface');
    if (!callInterface) return;
    
    const participants = callInterface.querySelectorAll('.participant');
    participants.forEach(participant => {
        makeResizable(participant);
    });
    
    // Make call interface resizable too
    makeInterfaceResizable(callInterface);
}

// Make individual video resizable
function makeResizable(element) {
    if (!element || element.hasAttribute('data-resizable')) return;
    
    // Add resize handle
    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'resize-handle';
    resizeHandle.innerHTML = '↘';
    resizeHandle.style.cssText = `
        position: absolute;
        bottom: 5px;
        right: 5px;
        width: 20px;
        height: 20px;
        background: rgba(255,255,255,0.3);
        cursor: nwse-resize;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 3px;
        font-size: 12px;
        color: white;
        user-select: none;
        z-index: 10;
    `;
    
    // Add video size controls
    const sizeControls = document.createElement('div');
    sizeControls.className = 'video-size-controls';
    sizeControls.innerHTML = `
        <button class="size-control-btn minimize-btn" title="Minimize">_</button>
        <button class="size-control-btn maximize-btn" title="Maximize">□</button>
        <button class="size-control-btn fullscreen-btn" title="Fullscreen">⛶</button>
    `;
    sizeControls.style.cssText = `
        position: absolute;
        top: 8px;
        right: 8px;
        display: flex;
        gap: 4px;
        opacity: 0;
        transition: opacity 0.3s ease;
        z-index: 10;
    `;
    
    element.appendChild(resizeHandle);
    element.appendChild(sizeControls);
    element.style.resize = 'both';
    element.style.overflow = 'auto';
    element.style.minWidth = '150px';
    element.style.minHeight = '100px';
    element.style.maxWidth = '90vw';
    element.style.maxHeight = '90vh';
    element.setAttribute('data-resizable', 'true');
    
    // Show controls on hover
    element.addEventListener('mouseenter', () => {
        sizeControls.style.opacity = '1';
    });
    
    element.addEventListener('mouseleave', () => {
        sizeControls.style.opacity = '0';
    });
    
    // Add double-click for fullscreen
    element.addEventListener('dblclick', function(e) {
        if (!e.target.closest('.video-size-controls')) {
            toggleVideoFullscreen(element);
        }
    });
    
    // Size control buttons
    const minimizeBtn = sizeControls.querySelector('.minimize-btn');
    const maximizeBtn = sizeControls.querySelector('.maximize-btn');
    const fullscreenBtn = sizeControls.querySelector('.fullscreen-btn');
    
    if (minimizeBtn) {
        minimizeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            element.classList.toggle('minimized');
            element.classList.remove('maximized');
        });
    }
    
    if (maximizeBtn) {
        maximizeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            element.classList.toggle('maximized');
            element.classList.remove('minimized');
        });
    }
    
    if (fullscreenBtn) {
        fullscreenBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const video = element.querySelector('video');
            if (video && video.requestFullscreen) {
                video.requestFullscreen();
            }
        });
    }
}

// Toggle video fullscreen
function toggleVideoFullscreen(element) {
    element.classList.toggle('maximized');
    if (element.classList.contains('maximized')) {
        element.classList.remove('minimized');
    }
}

// Make interface resizable
function makeInterfaceResizable(callInterface) {
    if (!callInterface || callInterface.hasAttribute('data-interface-resizable')) return;
    
    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'interface-resize-handle';
    resizeHandle.style.cssText = `
        position: absolute;
        bottom: 0;
        right: 0;
        width: 15px;
        height: 15px;
        cursor: nwse-resize;
        background: linear-gradient(135deg, transparent 50%, #5865f2 50%);
        border-bottom-right-radius: 12px;
    `;
    
    callInterface.appendChild(resizeHandle);
    callInterface.setAttribute('data-interface-resizable', 'true');
    
    let isResizing = false;
    let startWidth = 0;
    let startHeight = 0;
    let startX = 0;
    let startY = 0;
    
    resizeHandle.addEventListener('mousedown', (e) => {
        isResizing = true;
        startWidth = parseInt(document.defaultView.getComputedStyle(callInterface).width, 10);
        startHeight = parseInt(document.defaultView.getComputedStyle(callInterface).height, 10);
        startX = e.clientX;
        startY = e.clientY;
        e.preventDefault();
    });
    
    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        
        const newWidth = startWidth + e.clientX - startX;
        const newHeight = startHeight + e.clientY - startY;
        
        if (newWidth > 400 && newWidth < window.innerWidth * 0.9) {
            callInterface.style.width = newWidth + 'px';
        }
        if (newHeight > 300 && newHeight < window.innerHeight * 0.9) {
            callInterface.style.height = newHeight + 'px';
        }
    });
    
    document.addEventListener('mouseup', () => {
        isResizing = false;
    });
}