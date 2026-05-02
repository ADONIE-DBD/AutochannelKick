import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { DataStore } from "@api/index";
import definePlugin from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { FluxDispatcher, Menu, SelectedGuildStore } from "@webpack/common";

const ChannelStore = findByPropsLazy("getChannel", "getMutableGuildChannelsForGuild");
const UserStore = findByPropsLazy("getUser", "getCurrentUser");
const ProfileActions = findByPropsLazy("openUserProfileModal");
const CurrentUserStore = findByPropsLazy("getCurrentUser");
const VoiceStateStore = findByPropsLazy("getVoiceStateForChannel", "getVoiceState");
const UserProfileActions = findByPropsLazy("fetchProfile");
const UserProfileStore = findByPropsLazy("getUserProfile");

const VAULT_KEY = "AutochannelKick_ShitterVault_v6";

type VaultEntry = {
    userId: string;
    username: string;
    guildId: string;
    avatar?: string;
    addedAt: number;
};

let vaultCache: VaultEntry[] = [];
let autoKickEnabled = false;
let autoKickGuildId: string | null = null;
let autoKickChannelId: string | null = null;

const recentlyKicked = new Set<string>();
const lastKnownVoiceChannel = new Map<string, string | null>();

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function log(...args: any[]) {
    console.log("[AutochannelKick]", ...args);
}

function injectVaultStyles() {
    if (document.getElementById("autochannel-vault-styles")) return;

    const style = document.createElement("style");
    style.id = "autochannel-vault-styles";
    style.textContent = `
        .ak-vault-scroll {
            scrollbar-width: thin;
            scrollbar-color: #1a1b1e #2b2d31;
        }

        .ak-vault-scroll::-webkit-scrollbar {
            width: 8px;
        }

        .ak-vault-scroll::-webkit-scrollbar-track {
            background: #2b2d31;
            border-radius: 999px;
        }

        .ak-vault-scroll::-webkit-scrollbar-thumb {
            background: #1a1b1e;
            border-radius: 999px;
        }

        .ak-vault-scroll::-webkit-scrollbar-thumb:hover {
            background: #111214;
        }
    `;

    document.head.appendChild(style);
}

async function loadVault() {
    try {
        const stored = await DataStore.get<VaultEntry[]>(VAULT_KEY);
        vaultCache = Array.isArray(stored) ? stored : [];
    } catch {
        vaultCache = [];
    }
}

async function saveVault(entries: VaultEntry[]) {
    vaultCache = entries;
    await DataStore.set(VAULT_KEY, entries);
}

function getVault(): VaultEntry[] {
    return Array.isArray(vaultCache) ? vaultCache : [];
}

function getCurrentUserId() {
    return CurrentUserStore.getCurrentUser?.()?.id;
}

function getMyVoiceChannelId(guildId: string) {
    const myUserId = getCurrentUserId();
    if (!myUserId) return null;

    const myVoiceState = VoiceStateStore.getVoiceState(guildId, myUserId);
    return myVoiceState?.channelId || myVoiceState?.channel_id || null;
}

function disableAutoKick(reason = "disabled") {
    autoKickEnabled = false;
    autoKickGuildId = null;
    autoKickChannelId = null;
    log("Auto kick disabled:", reason);
}

function toggleAutoKick(guildId: string) {
    if (autoKickEnabled) {
        disableAutoKick("manual toggle off");
        showSmallModal("Auto kick disabled", "Shitter Vault auto kick is now off.");
        return;
    }

    const myChannelId = getMyVoiceChannelId(guildId);

    if (!myChannelId) {
        showSmallModal("Join a VC first", "You need to be inside the VC you own before enabling Auto kick.");
        return;
    }

    autoKickEnabled = true;
    autoKickGuildId = guildId;
    autoKickChannelId = myChannelId;

    const channel = ChannelStore.getChannel(myChannelId);
    showSmallModal("Auto kick enabled", `Shitter Vault will now kick vaulted users who join:\n${channel?.name || myChannelId}`);
    log("Auto kick enabled for:", guildId, myChannelId);
}

function getCachedUserName(userId: string, fallback = userId) {
    const user = UserStore.getUser(userId);
    const profile = UserProfileStore?.getUserProfile?.(userId);

    return (
        user?.globalName ||
        user?.username ||
        user?.tag ||
        profile?.user?.globalName ||
        profile?.user?.username ||
        fallback ||
        userId
    );
}

function getCachedAvatarUrl(userId: string, fallbackAvatar?: string) {
    const user = UserStore.getUser(userId);
    const profile = UserProfileStore?.getUserProfile?.(userId);
    const avatar = user?.avatar || profile?.user?.avatar || fallbackAvatar;

    if (user?.getAvatarURL) {
        try {
            return user.getAvatarURL(undefined, 64, true);
        } catch {}
    }

    if (avatar) {
        return `https://cdn.discordapp.com/avatars/${userId}/${avatar}.png?size=64`;
    }

    return "https://cdn.discordapp.com/embed/avatars/0.png";
}

async function hydrateUser(userId: string, guildId: string) {
    try {
        const user = UserStore.getUser(userId);

        if (user?.username || user?.globalName) {
            return {
                username: user.globalName || user.username || user.tag || userId,
                avatar: user.avatar
            };
        }

        if (UserProfileActions?.fetchProfile) {
            try {
                await UserProfileActions.fetchProfile(userId, {
                    guildId,
                    withMutualGuilds: false,
                    withMutualFriends: false
                });
            } catch {
                try {
                    await UserProfileActions.fetchProfile(userId, guildId);
                } catch {
                    try {
                        await UserProfileActions.fetchProfile(userId);
                    } catch {}
                }
            }
        }

        await sleep(150);

        const loadedUser = UserStore.getUser(userId);
        const profile = UserProfileStore?.getUserProfile?.(userId);

        const username =
            loadedUser?.globalName ||
            loadedUser?.username ||
            loadedUser?.tag ||
            profile?.user?.globalName ||
            profile?.user?.username ||
            userId;

        const avatar = loadedUser?.avatar || profile?.user?.avatar;

        return { username, avatar };
    } catch {
        return { username: userId, avatar: undefined };
    }
}

function openProfile(userId: string, guildId: string) {
    try {
        ProfileActions.openUserProfileModal({
            userId,
            guildId,
            sourceAnalyticsLocations: []
        });
    } catch {
        log("Could not open profile for:", userId);
    }
}

function isInVault(userId: string, guildId: string) {
    return getVault().some(e => e.userId === userId && e.guildId === guildId);
}

async function addToVaultById(userId: string, guildId: string, username?: string) {
    const cleanId = userId.trim();

    if (!/^\d{17,20}$/.test(cleanId)) return "invalid";

    const vault = getVault();

    if (vault.some(e => e.userId === cleanId && e.guildId === guildId)) {
        return "duplicate";
    }

    const hydrated = await hydrateUser(cleanId, guildId);

    vault.push({
        userId: cleanId,
        username: username || hydrated.username || cleanId,
        avatar: hydrated.avatar,
        guildId,
        addedAt: Date.now()
    });

    await saveVault(vault);
    return "added";
}

async function addToVault(user: any, guildId: string) {
    await addToVaultById(
        user.id,
        guildId,
        user.globalName || user.username || user.tag || user.id
    );
}

async function removeFromVault(userId: string, guildId: string) {
    await saveVault(getVault().filter(e => !(e.userId === userId && e.guildId === guildId)));
}

function findAcCommandsChannel(guildId: string) {
    const channels = ChannelStore.getMutableGuildChannelsForGuild(guildId);

    for (const id in channels) {
        const channel = ChannelStore.getChannel(id);
        if (channel?.name === "ac-commands") return channel;
    }

    return null;
}

function goToChannel(guildId: string, channelId: string) {
    const url = `/channels/${guildId}/${channelId}`;
    window.history.pushState({}, "", url);
    window.dispatchEvent(new PopStateEvent("popstate"));
}

async function insertText(editor: HTMLElement, text: string) {
    editor.focus();

    const data = new DataTransfer();
    data.setData("text/plain", text);

    editor.dispatchEvent(new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true
    }));
}

async function pressEnter(editor: HTMLElement) {
    editor.focus();

    editor.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true
    }));

    await sleep(30);

    editor.dispatchEvent(new KeyboardEvent("keyup", {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true
    }));
}

async function runSlashCommand(userId: string) {
    await sleep(450);

    const editor = document.querySelector('[data-slate-editor="true"]') as HTMLElement;

    if (!editor) {
        log("FAILED: editor not found");
        return;
    }

    insertText(editor, "/autochannel ban ");

    await sleep(900);

    await pressEnter(editor);

    await sleep(220);

    insertText(editor, userId);

    await sleep(140);

    await pressEnter(editor);
}

async function runAutochannelBan(userId: string, guildId?: string) {
    const targetGuildId = guildId || SelectedGuildStore.getGuildId();

    if (!targetGuildId) return;

    const acChannel = findAcCommandsChannel(targetGuildId);

    if (!acChannel) {
        log("FAILED: no ac-commands channel found");
        return;
    }

    goToChannel(targetGuildId, acChannel.id);

    await sleep(650);

    await runSlashCommand(userId);
}

async function handleVoiceUpdate(event: any) {
    const myUserId = getCurrentUserId();
    if (!myUserId) return;

    const states = [
        ...(event?.voiceStates || []),
        ...(event?.voice_states || []),
        ...(event?.updates || []),
        ...(event?.states || [])
    ];

    if (event?.voiceState) states.push(event.voiceState);
    if (event?.userId || event?.user_id) states.push(event);

    if (!states.length) return;

    const vault = getVault();
    if (!vault.length && !autoKickEnabled) return;

    for (const state of states) {
        const userId = state?.userId || state?.user_id;
        const newChannelId = state?.channelId || state?.channel_id || null;
        const guildId = state?.guildId || state?.guild_id || SelectedGuildStore.getGuildId();

        if (!userId || !guildId) continue;

        const key = `${guildId}:${userId}`;
        const oldChannelId = lastKnownVoiceChannel.get(key) ?? null;

        lastKnownVoiceChannel.set(key, newChannelId);

        if (userId === myUserId) {
            if (!newChannelId) {
                disableAutoKick("you left VC");
            } else if (autoKickEnabled && autoKickChannelId && newChannelId !== autoKickChannelId) {
                disableAutoKick("you changed VC");
            }

            continue;
        }

        if (!autoKickEnabled || !autoKickChannelId || !autoKickGuildId) continue;
        if (guildId !== autoKickGuildId) continue;

        const joinedVcNow = oldChannelId !== newChannelId && !!newChannelId;
        if (!joinedVcNow) continue;

        if (newChannelId !== autoKickChannelId) continue;

        const match = vault.find(e => e.userId === userId && e.guildId === guildId);
        if (!match) continue;

        if (recentlyKicked.has(key)) continue;

        recentlyKicked.add(key);

        log("Auto kick active. Vault user joined armed VC:", userId);

        await runAutochannelBan(userId, guildId);

        setTimeout(() => recentlyKicked.delete(key), 15000);
    }
}

function showSmallModal(title: string, message: string) {
    document.getElementById("autochannel-small-modal")?.remove();

    const backdrop = document.createElement("div");
    backdrop.id = "autochannel-small-modal";
    backdrop.style.cssText = `
        position: fixed;
        inset: 0;
        z-index: 1000000;
        background: rgba(0,0,0,0.55);
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: var(--font-primary), Arial;
    `;

    const modal = document.createElement("div");
    modal.style.cssText = `
        width: 420px;
        background: #313338;
        border-radius: 12px;
        box-shadow: 0 20px 60px rgba(0,0,0,0.5);
        color: #f2f3f5;
        padding: 20px;
    `;

    modal.innerHTML = `
        <div style="font-size:20px;font-weight:800;margin-bottom:8px;">${escapeHtml(title)}</div>
        <div style="font-size:14px;color:#b5bac1;line-height:1.4;margin-bottom:18px;white-space:pre-line;">${escapeHtml(message)}</div>
    `;

    const btn = makeButton("Okay", "#5865f2");
    btn.onclick = () => backdrop.remove();

    modal.appendChild(btn);
    backdrop.appendChild(modal);

    backdrop.addEventListener("click", e => {
        if (e.target === backdrop) backdrop.remove();
    });

    document.body.appendChild(backdrop);
}

function showImportModal(guildId: string, onDone: () => void) {
    document.getElementById("autochannel-import-modal")?.remove();

    const backdrop = document.createElement("div");
    backdrop.id = "autochannel-import-modal";
    backdrop.style.cssText = `
        position: fixed;
        inset: 0;
        z-index: 1000001;
        background: rgba(0,0,0,0.65);
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: var(--font-primary), Arial;
    `;

    const modal = document.createElement("div");
    modal.style.cssText = `
        width: 520px;
        background: #313338;
        border-radius: 12px;
        box-shadow: 0 20px 60px rgba(0,0,0,0.5);
        color: #f2f3f5;
        overflow: hidden;
    `;

    const header = document.createElement("div");
    header.style.cssText = `padding: 20px 22px 10px 22px;`;
    header.innerHTML = `
        <div style="font-size:20px;font-weight:800;">Import IDs</div>
        <div style="font-size:12px;color:#b5bac1;margin-top:4px;">
            Paste Discord user IDs below. You can separate them by spaces, commas, or new lines.
        </div>
    `;

    const body = document.createElement("div");
    body.style.cssText = `padding: 0 22px 20px 22px;`;

    const textarea = document.createElement("textarea");
    textarea.placeholder = "123456789012345678\n234567890123456789\n345678901234567890";
    textarea.style.cssText = `
        width: 100%;
        min-height: 180px;
        box-sizing: border-box;
        resize: vertical;
        background: #1e1f22;
        border: none;
        outline: none;
        border-radius: 6px;
        color: #f2f3f5;
        padding: 12px;
        font-size: 14px;
        font-family: Consolas, monospace;
    `;

    const buttons = document.createElement("div");
    buttons.style.cssText = `
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 14px;
    `;

    const cancel = makeButton("Cancel", "#4f545c");
    const importBtn = makeButton("Import", "#5865f2");

    cancel.onclick = () => backdrop.remove();

    importBtn.onclick = async () => {
        const ids = textarea.value.match(/\d{17,20}/g) || [];

        let added = 0;
        let duplicates = 0;
        let invalid = 0;

        if (!ids.length) {
            showSmallModal("Import Failed", "No valid Discord user IDs were found.");
            return;
        }

        importBtn.textContent = "Importing...";
        importBtn.setAttribute("disabled", "true");

        for (const id of ids) {
            const result = await addToVaultById(id, guildId);

            if (result === "added") added++;
            else if (result === "duplicate") duplicates++;
            else invalid++;
        }

        backdrop.remove();
        onDone();

        showSmallModal(
            "Import Complete",
            `Added: ${added}\nAlready in vault: ${duplicates}\nInvalid: ${invalid}`
        );
    };

    buttons.appendChild(cancel);
    buttons.appendChild(importBtn);

    body.appendChild(textarea);
    body.appendChild(buttons);

    modal.appendChild(header);
    modal.appendChild(body);
    backdrop.appendChild(modal);

    backdrop.addEventListener("click", e => {
        if (e.target === backdrop) backdrop.remove();
    });

    document.body.appendChild(backdrop);
    setTimeout(() => textarea.focus(), 50);
}

function showVaultModal(guildId: string) {
    injectVaultStyles();
    document.getElementById("autochannel-vault-modal")?.remove();

    let entries = getVault().filter(e => e.guildId === guildId);

    const backdrop = document.createElement("div");
    backdrop.id = "autochannel-vault-modal";
    backdrop.style.cssText = `
        position: fixed;
        inset: 0;
        z-index: 999999;
        background: rgba(0,0,0,0.65);
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: var(--font-primary), Arial;
    `;

    const modal = document.createElement("div");
    modal.style.cssText = `
        width: 680px;
        max-height: 720px;
        background: #313338;
        border-radius: 12px;
        box-shadow: 0 20px 60px rgba(0,0,0,0.5);
        overflow: hidden;
        color: #f2f3f5;
    `;

    const header = document.createElement("div");
    header.style.cssText = `
        padding: 20px 22px 12px 22px;
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
    `;

    header.innerHTML = `
        <div>
            <div style="font-size:20px;font-weight:800;">Shitter Vault</div>
            <div style="font-size:12px;color:#b5bac1;margin-top:4px;">
                Users saved for autochannel kicking • ${getVault().filter(e => e.guildId === guildId).length} users
            </div>
        </div>
    `;

    const close = document.createElement("button");
    close.textContent = "×";
    close.style.cssText = `
        background: transparent;
        border: none;
        color: #b5bac1;
        font-size: 28px;
        cursor: pointer;
        line-height: 1;
    `;
    close.onclick = () => backdrop.remove();
    header.appendChild(close);

    const controls = document.createElement("div");
    controls.style.cssText = `
        padding: 0 22px 12px 22px;
        display: grid;
        grid-template-columns: 1fr;
        gap: 10px;
    `;

    const search = document.createElement("input");
    search.placeholder = "Search by name or user ID";
    search.style.cssText = inputStyle();

    const addRow = document.createElement("div");
    addRow.style.cssText = `
        display: grid;
        grid-template-columns: 1fr auto auto auto;
        gap: 8px;
    `;

    const addInput = document.createElement("input");
    addInput.placeholder = "Add user ID manually";
    addInput.style.cssText = inputStyle();

    const addButton = makeButton("Add ID", "#5865f2");
    const importButton = makeButton("Import IDs", "#4f545c");
    const exportButton = makeButton("Export IDs", "#4f545c");

    addRow.appendChild(addInput);
    addRow.appendChild(addButton);
    addRow.appendChild(importButton);
    addRow.appendChild(exportButton);

    controls.appendChild(search);
    controls.appendChild(addRow);

    const body = document.createElement("div");
    body.className = "ak-vault-scroll";
    body.style.cssText = `
        padding: 8px 14px 16px 14px;
        max-height: 480px;
        overflow-y: auto;
    `;

    function refreshEntries() {
        entries = getVault().filter(e => e.guildId === guildId);
    }

    function renderList(query = "") {
        refreshEntries();
        body.innerHTML = "";

        const q = query.toLowerCase().trim();

        const filtered = entries.filter(entry => {
            const name = getCachedUserName(entry.userId, entry.username).toLowerCase();
            const id = entry.userId.toLowerCase();
            return !q || name.includes(q) || id.includes(q);
        });

        if (!filtered.length) {
            body.innerHTML = `
                <div style="padding:28px;text-align:center;color:#b5bac1;">
                    No users found.
                </div>
            `;
            return;
        }

        for (const entry of filtered) {
            const row = document.createElement("div");
            row.style.cssText = `
                padding: 12px;
                border-radius: 8px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                background: #2b2d31;
                margin-bottom: 8px;
            `;

            const left = document.createElement("div");
            left.style.cssText = `
                display: flex;
                align-items: center;
                gap: 12px;
                cursor: pointer;
                min-width: 0;
            `;
            left.onclick = () => openProfile(entry.userId, guildId);

            const avatar = document.createElement("img");
            avatar.src = getCachedAvatarUrl(entry.userId, entry.avatar);
            avatar.style.cssText = `
                width: 38px;
                height: 38px;
                border-radius: 50%;
                object-fit: cover;
                flex: 0 0 auto;
            `;

            const text = document.createElement("div");
            text.style.cssText = `min-width: 0;`;

            const name = getCachedUserName(entry.userId, entry.username);

            text.innerHTML = `
                <div style="font-weight:700;color:#f2f3f5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                    ${escapeHtml(name)}
                </div>
                <div style="font-size:12px;color:#949ba4;margin-top:3px;">${entry.userId}</div>
            `;

            left.appendChild(avatar);
            left.appendChild(text);

            const remove = document.createElement("button");
            remove.textContent = "Remove";
            remove.style.cssText = `
                opacity: 0;
                background: #da373c;
                border: none;
                color: white;
                padding: 7px 12px;
                border-radius: 6px;
                font-weight: 700;
                cursor: pointer;
                transition: opacity 120ms ease;
            `;

            row.onmouseenter = () => remove.style.opacity = "1";
            row.onmouseleave = () => remove.style.opacity = "0";

            remove.onclick = async () => {
                await removeFromVault(entry.userId, guildId);
                renderList(search.value);
            };

            row.appendChild(left);
            row.appendChild(remove);
            body.appendChild(row);
        }
    }

    search.addEventListener("input", () => renderList(search.value));

    addButton.onclick = async () => {
        const result = await addToVaultById(addInput.value, guildId);

        if (result === "added") {
            addInput.value = "";
            renderList(search.value);
            showSmallModal("Added", "Added 1 user ID to the vault.");
        } else if (result === "duplicate") {
            showSmallModal("Already Saved", "That user ID is already in the vault.");
        } else {
            showSmallModal("Invalid ID", "That does not look like a valid Discord user ID.");
        }
    };

    importButton.onclick = () => {
        showImportModal(guildId, () => {
            renderList(search.value);
            setTimeout(() => search.focus(), 50);
        });
    };

    exportButton.onclick = async () => {
        refreshEntries();

        const ids = entries.map(e => e.userId).join("\n");

        await navigator.clipboard.writeText(ids);

        showSmallModal("Export Complete", `Copied ${entries.length} IDs to your clipboard.`);

        setTimeout(() => search.focus(), 50);
    };

    modal.appendChild(header);
    modal.appendChild(controls);
    modal.appendChild(body);
    backdrop.appendChild(modal);

    backdrop.addEventListener("click", e => {
        if (e.target === backdrop) backdrop.remove();
    });

    document.body.appendChild(backdrop);
    search.focus();

    renderList();
}

function inputStyle() {
    return `
        width: 100%;
        box-sizing: border-box;
        background: #1e1f22;
        border: none;
        outline: none;
        border-radius: 6px;
        color: #f2f3f5;
        padding: 10px 12px;
        font-size: 14px;
    `;
}

function makeButton(label: string, bg: string) {
    const button = document.createElement("button");
    button.textContent = label;
    button.style.cssText = `
        background: ${bg};
        border: none;
        color: white;
        padding: 9px 12px;
        border-radius: 6px;
        font-weight: 700;
        cursor: pointer;
        white-space: nowrap;
    `;
    return button;
}

function escapeHtml(value: string) {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

const userContextPatch: NavContextMenuPatchCallback = (children, props: any) => {
    const user = props?.user;
    if (!user?.id) return;

    const guildId = SelectedGuildStore.getGuildId();
    if (!guildId) return;

    const group = findGroupChildrenByChildId("copy-id", children) ?? children;
    const inVault = isInVault(user.id, guildId);

    group.push(
        <Menu.MenuItem
            id="autochannel-kick-user"
            label="Kick Shitter"
            color="danger"
            action={() => runAutochannelBan(user.id, guildId)}
        />
    );

    group.push(
        <Menu.MenuItem id="shitter-vault-parent" label="Shitter Vault">
            <Menu.MenuCheckboxItem
                id="shitter-vault-auto-kick"
                label="Auto kick"
                checked={autoKickEnabled && autoKickGuildId === guildId}
                action={() => toggleAutoKick(guildId)}
            />

            <Menu.MenuItem
                id="shitter-vault-add"
                label={inVault ? "Remove from Shitter Vault" : "Add to Shitter Vault"}
                color={inVault ? "default" : "danger"}
                action={() => {
                    if (inVault) removeFromVault(user.id, guildId);
                    else addToVault(user, guildId);
                }}
            />

            <Menu.MenuItem
                id="shitter-vault-view"
                label="View Vault"
                action={() => showVaultModal(guildId)}
            />
        </Menu.MenuItem>
    );
};

export default definePlugin({
    name: "AutochannelKick",
    description: "Adds Kick Shitter and Shitter Vault.",
    authors: [{ name: "ADONIE", id: 123456789012345678n }],

    contextMenus: {
        "user-context": userContextPatch
    },

    async start() {
        await loadVault();

        FluxDispatcher.subscribe("VOICE_STATE_UPDATES", handleVoiceUpdate);
        FluxDispatcher.subscribe("VOICE_STATE_UPDATE", handleVoiceUpdate);

        log("Vault listener started.");
    },

    stop() {
        FluxDispatcher.unsubscribe("VOICE_STATE_UPDATES", handleVoiceUpdate);
        FluxDispatcher.unsubscribe("VOICE_STATE_UPDATE", handleVoiceUpdate);

        disableAutoKick("plugin stopped");

        log("Vault listener stopped.");
    }
});
