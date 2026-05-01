import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import definePlugin from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { FluxDispatcher, Menu, SelectedGuildStore } from "@webpack/common";

const ChannelStore = findByPropsLazy("getChannel", "getMutableGuildChannelsForGuild");
const UserStore = findByPropsLazy("getUser", "getCurrentUser");

const VAULT_KEY = "AutochannelKick_ShitterVault_v4";

type VaultEntry = {
    userId: string;
    username: string;
    guildId: string;
    addedAt: number;
};

const memoryVaultFallback: { value: VaultEntry[] } = { value: [] };

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function log(...args: any[]) {
    console.log("[AutochannelKick]", ...args);
}

function getStorage() {
    try {
        return globalThis?.localStorage ?? window?.localStorage ?? null;
    } catch {
        return null;
    }
}

function getVault(): VaultEntry[] {
    try {
        const storage = getStorage();

        if (!storage) return memoryVaultFallback.value;

        const raw = JSON.parse(storage.getItem(VAULT_KEY) || "[]");
        return Array.isArray(raw) ? raw : [];
    } catch {
        return memoryVaultFallback.value;
    }
}

function saveVault(entries: VaultEntry[]) {
    try {
        const storage = getStorage();

        if (!storage) {
            memoryVaultFallback.value = entries;
            return;
        }

        storage.setItem(VAULT_KEY, JSON.stringify(entries));
    } catch {
        memoryVaultFallback.value = entries;
    }
}

function getDisplayName(userId: string, fallback = userId) {
    const user = UserStore.getUser(userId);
    return user?.globalName || user?.username || user?.tag || fallback || userId;
}

function isInVault(userId: string, guildId: string) {
    return getVault().some(e => e.userId === userId && e.guildId === guildId);
}

function addToVault(user: any, guildId: string) {
    const vault = getVault();

    if (vault.some(e => e.userId === user.id && e.guildId === guildId)) {
        log("Already in vault:", user.id);
        return;
    }

    vault.push({
        userId: user.id,
        username: user.globalName || user.username || user.tag || user.id,
        guildId,
        addedAt: Date.now()
    });

    saveVault(vault);
    log("Added to vault:", user.id, getVault());
}

function removeFromVault(userId: string, guildId: string) {
    saveVault(getVault().filter(e => !(e.userId === userId && e.guildId === guildId)));
    log("Removed from vault:", userId);
}

function showVaultModal(guildId: string) {
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
        width: 560px;
        max-height: 650px;
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
                Users saved for autochannel kicking
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

    const searchWrap = document.createElement("div");
    searchWrap.style.cssText = `padding: 0 22px 12px 22px;`;

    const search = document.createElement("input");
    search.placeholder = "Search by name or user ID";
    search.style.cssText = `
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

    searchWrap.appendChild(search);

    const body = document.createElement("div");
    body.style.cssText = `
        padding: 8px 14px 16px 14px;
        max-height: 460px;
        overflow-y: auto;
    `;

    function renderList(query = "") {
        body.innerHTML = "";

        const q = query.toLowerCase().trim();

        const filtered = entries.filter(entry => {
            const name = getDisplayName(entry.userId, entry.username).toLowerCase();
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

            const name = getDisplayName(entry.userId, entry.username);

            row.innerHTML = `
                <div>
                    <div style="font-weight:700;color:#f2f3f5;">${name}</div>
                    <div style="font-size:12px;color:#949ba4;margin-top:3px;">${entry.userId}</div>
                </div>
            `;

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

            remove.onclick = () => {
                removeFromVault(entry.userId, guildId);
                entries = getVault().filter(e => e.guildId === guildId);
                renderList(search.value);
            };

            row.appendChild(remove);
            body.appendChild(row);
        }
    }

    search.addEventListener("input", () => renderList(search.value));

    modal.appendChild(header);
    modal.appendChild(searchWrap);
    modal.appendChild(body);
    backdrop.appendChild(modal);

    backdrop.addEventListener("click", e => {
        if (e.target === backdrop) backdrop.remove();
    });

    document.body.appendChild(backdrop);
    search.focus();

    renderList();
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

    await sleep(40);

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
    await sleep(650);

    const editor = document.querySelector('[data-slate-editor="true"]') as HTMLElement;

    if (!editor) {
        log("FAILED: editor not found");
        return;
    }

    insertText(editor, "/autochannel ban ");

    await sleep(1200);

    await pressEnter(editor);

    await sleep(350);

    insertText(editor, userId);

    await sleep(220);

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

    await sleep(900);

    await runSlashCommand(userId);
}

const recentlyKicked = new Set<string>();

async function handleVoiceUpdate(event: any) {
    log("Voice event:", event);

    const states = [
        ...(event?.voiceStates || []),
        ...(event?.voice_states || []),
        ...(event?.updates || []),
        ...(event?.states || [])
    ];

    if (event?.voiceState) states.push(event.voiceState);
    if (event?.userId || event?.user_id) states.push(event);

    const vault = getVault();
    if (!vault.length) return;

    for (const state of states) {
        const userId = state?.userId || state?.user_id;
        const channelId = state?.channelId || state?.channel_id;
        const guildId = state?.guildId || state?.guild_id || SelectedGuildStore.getGuildId();

        log("Parsed voice state:", { userId, channelId, guildId });

        if (!userId || !channelId || !guildId) continue;

        const match = vault.find(e => e.userId === userId && e.guildId === guildId);
        if (!match) continue;

        const key = `${guildId}:${userId}`;
        if (recentlyKicked.has(key)) continue;

        recentlyKicked.add(key);

        log("Vault user joined VC. Auto-kicking:", userId);

        await runAutochannelBan(userId, guildId);

        setTimeout(() => recentlyKicked.delete(key), 15000);
    }
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
    description: "Adds Autochannel Kick and Shitter Vault.",
    authors: [{ name: "Ado", id: 0n }],

    contextMenus: {
        "user-context": userContextPatch
    },

    start() {
        FluxDispatcher.subscribe("VOICE_STATE_UPDATES", handleVoiceUpdate);
        FluxDispatcher.subscribe("VOICE_STATE_UPDATE", handleVoiceUpdate);
        log("Vault listener started.");
    },

    stop() {
        FluxDispatcher.unsubscribe("VOICE_STATE_UPDATES", handleVoiceUpdate);
        FluxDispatcher.unsubscribe("VOICE_STATE_UPDATE", handleVoiceUpdate);
        log("Vault listener stopped.");
    }
});