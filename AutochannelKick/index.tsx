/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { DataStore } from "@api/index";
import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin from "@utils/types";
import { findByPropsLazy, findComponentByCodeLazy } from "@webpack";
import { ApplicationCommandIndexStore, AuthenticationStore, FluxDispatcher, Menu, RestAPI, SelectedGuildStore, SnowflakeUtils } from "@webpack/common";

const ChannelStore = findByPropsLazy("getChannel", "getMutableGuildChannelsForGuild");
const UserStore = findByPropsLazy("getUser", "getCurrentUser");
const ProfileActions = findByPropsLazy("openUserProfileModal");
const CurrentUserStore = findByPropsLazy("getCurrentUser");
const VoiceStateStore = findByPropsLazy("getVoiceStateForChannel", "getVoiceState");
const UserProfileActions = findByPropsLazy("fetchProfile");
const UserProfileStore = findByPropsLazy("getUserProfile");
const AccountPanelButton = findComponentByCodeLazy(".GREEN,positionKeyStemOverride:");
const VoiceChannelActions = findByPropsLazy("selectVoiceChannel", "selectChannel");

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

type IncrementRun = {
    guildId: string;
    channelId: string;
    remaining: string[];
    sent: number;
    total: number;
    timer?: ReturnType<typeof setTimeout>;
};

let incrementRun: IncrementRun | null = null;
let nukeInProgress = false;
let nukeGeneration = 0;

const recentlyKicked = new Set<string>();

// Serialize interactions so auto kicks and manual batch kicks cannot race.
let kickQueue: Promise<void> = Promise.resolve();

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
    let renamedMatch: any = null;
    let topicMatch: any = null;

    for (const id in channels) {
        const channel = ChannelStore.getChannel(id);
        const name = channel?.name?.toLowerCase();

        // Prefer the original name, but support server prefixes such as the
        // current #lfg-ac-commands rename without hard-coding one server name.
        if (name === "ac-commands") return channel;
        if (!renamedMatch && name?.endsWith("-ac-commands")) renamedMatch = channel;

        // Last-resort detection if the channel is renamed again.
        if (!topicMatch && channel?.topic?.toLowerCase().includes("/autochannel ban")) {
            topicMatch = channel;
        }
    }

    return renamedMatch ?? topicMatch;
}

function findAutochannelBanCommand(channel: any) {
    const result = ApplicationCommandIndexStore.query(
        { type: "channel", channel },
        {
            commandTypes: [1],
            text: "autochannel",
            builtIns: "deny",
            applicationCommands: true
        },
        {
            allowFetch: true,
            allowApplicationState: true,
            allowEmptySections: true,
            installOnDemand: false,
            scoreMethod: "none"
        }
    );

    const command = result.commands.find((entry: any) => {
        const names = [entry.untranslatedName, entry.displayName]
            .filter(Boolean)
            .map((name: string) => name.toLowerCase());

        return names.includes("autochannel ban") || (
            entry.rootCommand?.name?.toLowerCase() === "autochannel" &&
            entry.subCommandPath?.some((option: any) => option.name?.toLowerCase() === "ban")
        );
    });

    return { command, loading: result.loading };
}

async function waitForAutochannelBanCommand(channel: any, timeoutMs = 6000) {
    const endsAt = Date.now() + timeoutMs;

    while (Date.now() < endsAt) {
        const { command, loading } = findAutochannelBanCommand(channel);
        if (command) return command;
        if (!loading) await sleep(250);
        else await sleep(100);
    }

    throw new Error("Discord could not load the /autochannel ban command.");
}

async function runAutochannelBanTargets(userIds: string[], guildId?: string, guard?: () => void) {
    guard?.();
    const targetGuildId = guildId || SelectedGuildStore.getGuildId();

    if (!targetGuildId) throw new Error("No Discord server is currently selected.");

    const targets = [...new Set(userIds)]
        .filter(id => /^\d{17,20}$/.test(id))
        .slice(0, 10);

    if (!targets.length) throw new Error("No valid users were selected to kick.");

    const acChannel = findAcCommandsChannel(targetGuildId);

    if (!acChannel) {
        throw new Error("No Autochannel command channel was found in this server.");
    }

    const command = await waitForAutochannelBanCommand(acChannel);
    const { rootCommand } = command;
    if (!rootCommand) throw new Error("Discord returned incomplete Autochannel command data.");

    const subCommand = command.subCommandPath?.find((option: any) =>
        option.name?.toLowerCase() === "ban"
    );
    const targetOption = command.options?.find((option: any) =>
        option.name?.toLowerCase() === "ban_targets"
    );

    guard?.();
    await RestAPI.post({
        url: "/interactions",
        body: {
            type: 2,
            application_id: rootCommand.application_id || command.applicationId,
            guild_id: targetGuildId,
            channel_id: acChannel.id,
            session_id: AuthenticationStore.getSessionId(),
            nonce: String(SnowflakeUtils.fromTimestamp(Date.now())),
            analytics_location: "slash_ui",
            data: {
                version: rootCommand.version || command.version,
                id: rootCommand.id,
                name: rootCommand.name,
                type: rootCommand.type || 1,
                options: [{
                    type: subCommand?.type || 1,
                    name: subCommand?.name || "ban",
                    options: [{
                        type: targetOption?.type || 3,
                        name: targetOption?.name || "ban_targets",
                        value: targets.join(" ")
                    }]
                }],
                application_command: rootCommand,
                attachments: []
            }
        }
    });

    log(`Background kick sent for ${targets.length} user(s) through #${acChannel.name}.`);
}

function queueAutochannelBanTargets(userIds: string[], guildId?: string, guard?: () => void) {
    const run = kickQueue.then(() => runAutochannelBanTargets(userIds, guildId, guard));

    kickQueue = run.catch(error => {
        log("FAILED to run /autochannel ban:", error);
    });

    return run;
}

function queueAutochannelBan(userId: string, guildId?: string) {
    return queueAutochannelBanTargets([userId], guildId);
}

async function kickUpToTenVaultedUsers(guildId: string) {
    const channelId = getMyVoiceChannelId(guildId);
    if (!channelId) throw new Error("Join the voice channel you own first.");

    const voiceStates = VoiceStateStore.getVoiceStatesForChannel(channelId) || {};
    const myUserId = getCurrentUserId();
    const targets = getVault()
        .filter(entry => entry.guildId === guildId && entry.userId !== myUserId && voiceStates[entry.userId])
        .map(entry => entry.userId)
        .slice(0, 10);

    if (!targets.length) {
        throw new Error("No vaulted users are currently in your voice channel.");
    }

    await queueAutochannelBanTargets(targets, guildId);
    showKickNotice("Batch kick sent", `Sent ${targets.length} vaulted user${targets.length === 1 ? "" : "s"} in the background.`, "#23a559");
}

function getVoiceMemberIds(channelId: string): string[] {
    return [...new Set<string>(Object.values(VoiceStateStore.getVoiceStatesForChannel(channelId) || {})
        .map((state: any) => state.userId ?? state.user_id)
        .filter((id: any) => typeof id === "string" && /^\d{17,20}$/.test(id)))];
}

function updateVaultActionButtons() {
    const button = document.getElementById("autochannel-increment-button");
    if (button) {
        const active = incrementRun?.guildId === button.dataset.guildId;
        button.textContent = active ? "Increment kicking: On (Stop)" : "Increment kicking: Off";
        button.setAttribute("aria-pressed", String(active));
    }
    const status = document.getElementById("autochannel-increment-status");
    if (status) {
        status.textContent = incrementRun && incrementRun.guildId === status.dataset.guildId
            ? `${incrementRun.sent}/${incrementRun.total} IDs submitted. Up to 10 every 15 seconds.`
            : "Increment kicking processes the entire server vault, including users outside your VC.";
    }
    const nukeButton = document.getElementById("autochannel-nuke-button") as HTMLButtonElement | null;
    if (nukeButton) {
        nukeButton.disabled = nukeInProgress;
        nukeButton.textContent = nukeInProgress ? "Nuking VC…" : "Nuke VC";
    }
}

function stopIncrementKicking() {
    if (incrementRun?.timer) clearTimeout(incrementRun.timer);
    incrementRun = null;
    updateVaultActionButtons();
}

function toggleIncrementKicking(guildId: string) {
    if (incrementRun?.guildId === guildId) {
        stopIncrementKicking();
        showKickNotice("Increment kicking stopped", "No further batches will be sent.", "#5865f2");
        return;
    }
    if (nukeInProgress) throw new Error("Wait for Nuke VC to finish first.");
    const channelId = getMyVoiceChannelId(guildId);
    if (!channelId) throw new Error("Join the voice channel you own first.");

    const remaining = [...new Set(getVault()
        .filter(entry => entry.guildId === guildId && entry.userId !== getCurrentUserId())
        .map(entry => entry.userId))].filter(id => /^\d{17,20}$/.test(id));
    if (!remaining.length) throw new Error("This server's vault has no users to ban.");

    stopIncrementKicking();
    const run: IncrementRun = { guildId, channelId, remaining, sent: 0, total: remaining.length };
    incrementRun = run;
    updateVaultActionButtons();
    void sendIncrementBatch(run);
}

async function sendIncrementBatch(run: IncrementRun) {
    const guard = () => {
        if (incrementRun !== run) throw new Error("Increment kicking was stopped.");
        if (getMyVoiceChannelId(run.guildId) !== run.channelId) {
            throw new Error("You left or changed voice channels.");
        }
    };
    try {
        guard();
        // Respect removals from the vault while a run is active.
        run.remaining = run.remaining.filter(id => isInVault(id, run.guildId));
        const batch = run.remaining.slice(0, 10);
        if (batch.length) {
            await queueAutochannelBanTargets(batch, run.guildId, guard);
            if (incrementRun !== run) return;
            run.remaining.splice(0, batch.length);
            run.sent += batch.length;
        }
        updateVaultActionButtons();
        if (!run.remaining.length) {
            stopIncrementKicking();
            showKickNotice("Increment kicking finished", `Submitted bans for ${run.sent} vault users. Check the bot's replies for results.`, "#23a559");
            return;
        }
        run.timer = setTimeout(() => void sendIncrementBatch(run), 15000);
    } catch (error) {
        if (incrementRun !== run) return;
        stopIncrementKicking();
        log("Increment kicking failed:", error);
        showKickNotice("Increment kicking stopped", error instanceof Error ? error.message : String(error));
    }
}

async function nukeVc(guildId: string) {
    if (nukeInProgress) throw new Error("Nuke VC is already running.");
    const channelId = getMyVoiceChannelId(guildId);
    if (!channelId) throw new Error("Join the voice channel you own first.");
    const targets = getVoiceMemberIds(channelId).filter(id => id !== getCurrentUserId());
    stopIncrementKicking();
    disableAutoKick("Nuke VC started");
    nukeInProgress = true;
    const generation = ++nukeGeneration;
    updateVaultActionButtons();
    const guard = () => {
        if (!nukeInProgress || generation !== nukeGeneration || getMyVoiceChannelId(guildId) !== channelId) {
            throw new Error("Nuke VC stopped because you left or changed voice channels.");
        }
    };
    try {
        for (let offset = 0; offset < targets.length; offset += 10) {
            guard();
            const batch = targets.slice(offset, offset + 10);
            await queueAutochannelBanTargets(batch, guildId, guard);
            // The command response only confirms receipt. Keep ownership until
            // voice-state updates show the bot actually removed the targets.
            const deadline = Date.now() + 15000;
            while (batch.some(id => getVoiceMemberIds(channelId).includes(id))) {
                guard();
                if (Date.now() >= deadline) {
                    throw new Error("Some users are still in the VC. You remain connected; check the bot's reply before trying again.");
                }
                await sleep(250);
            }
            if (offset + 10 < targets.length) await sleep(15000);
        }
        guard();
        await VoiceChannelActions.selectVoiceChannel(null);
        showKickNotice("Nuke VC finished", `Removed ${targets.length} users and disconnected you.`, "#23a559");
    } finally {
        if (generation === nukeGeneration) {
            nukeInProgress = false;
            updateVaultActionButtons();
        }
    }
}

function reportActionError(title: string, action: () => void | Promise<void>) {
    Promise.resolve().then(action).catch(error => {
        log(title, error);
        showKickNotice(title, error instanceof Error ? error.message : String(error));
    });
}

async function kickAndAddToVault(user: any, guildId: string) {
    const result = await addToVaultById(
        user.id,
        guildId,
        user.globalName || user.username || user.tag || user.id
    );

    if (result === "invalid") {
        throw new Error("That user does not have a valid Discord user ID.");
    }

    try {
        await queueAutochannelBan(user.id, guildId);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const vaultStatus = result === "added"
            ? "The user was still added to the vault."
            : "The user was already in the vault.";

        throw new Error(`${message}\n\n${vaultStatus}`);
    }
}

async function handleVoiceUpdates({ voiceStates }: { voiceStates?: any[] }) {
    const myUserId = getCurrentUserId();
    if (!myUserId) return;

    if (!Array.isArray(voiceStates) || !voiceStates.length) return;
    if (incrementRun && voiceStates.some(state => state.userId === myUserId &&
        (state.channelId ?? null) !== incrementRun!.channelId)) {
        stopIncrementKicking();
        showKickNotice("Increment kicking stopped", "You left or changed voice channels.");
    }
    if (!autoKickEnabled || !autoKickGuildId || !autoKickChannelId) return;

    const vault = getVault();
    if (!vault.length) return;

    for (const state of voiceStates) {
        const userId = state?.userId;
        const newChannelId = state?.channelId ?? null;
        const oldChannelId = state?.oldChannelId ?? null;
        const guildId = state?.guildId;

        if (!userId || !guildId) continue;

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

        // VOICE_STATE_UPDATES already contains the previous channel. This is
        // stable across reconnects and avoids treating mute/deafen updates as joins.
        if (newChannelId !== autoKickChannelId || oldChannelId === autoKickChannelId) continue;

        const match = vault.find(e => e.userId === userId && e.guildId === guildId);
        if (!match) continue;

        const key = `${guildId}:${userId}`;

        if (recentlyKicked.has(key)) continue;

        recentlyKicked.add(key);

        log("Auto kick active. Vault user joined armed VC:", userId);

        await queueAutochannelBan(userId, guildId).catch(error => {
            log("Auto kick command failed:", error);
        });

        setTimeout(() => recentlyKicked.delete(key), 15000);
    }
}

function showKickNotice(title: string, message: string, borderColor = "#da373c") {
    document.getElementById("autochannel-kick-notice")?.remove();

    const notice = document.createElement("div");
    notice.id = "autochannel-kick-notice";
    notice.style.cssText = `
        position: fixed;
        right: 20px;
        bottom: 20px;
        z-index: 1000000;
        width: min(380px, calc(100vw - 40px));
        box-sizing: border-box;
        background: #313338;
        border-left: 4px solid ${borderColor};
        border-radius: 8px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.45);
        color: #f2f3f5;
        padding: 13px 15px;
        font-family: var(--font-primary), Arial;
        pointer-events: none;
    `;

    const heading = document.createElement("div");
    heading.textContent = title;
    heading.style.cssText = "font-size:14px;font-weight:800;margin-bottom:4px;";

    const body = document.createElement("div");
    body.textContent = message;
    body.style.cssText = "font-size:13px;color:#b5bac1;line-height:1.35;white-space:pre-line;";

    notice.append(heading, body);
    document.body.appendChild(notice);

    setTimeout(() => notice.remove(), 4500);
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
    header.style.cssText = "padding: 20px 22px 10px 22px;";
    header.innerHTML = `
        <div style="font-size:20px;font-weight:800;">Import IDs</div>
        <div style="font-size:12px;color:#b5bac1;margin-top:4px;">
            Paste Discord user IDs below. You can separate them by spaces, commas, or new lines.
        </div>
    `;

    const body = document.createElement("div");
    body.style.cssText = "padding: 0 22px 20px 22px;";

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
        grid-template-columns: minmax(0, 1fr) auto auto auto;
        gap: 8px;
    `;

    const addInput = document.createElement("input");
    addInput.placeholder = "Add user ID manually";
    addInput.style.cssText = inputStyle();

    const addButton = makeButton("Add ID", "#5865f2");
    const importButton = makeButton("Import IDs", "#4f545c");
    const exportButton = makeButton("Export IDs", "#4f545c");
    const batchKickButton = makeButton("Kick Up to 10 in VC (Once)", "#da373c");

    addRow.appendChild(addInput);
    addRow.appendChild(addButton);
    addRow.appendChild(importButton);
    addRow.appendChild(exportButton);

    controls.appendChild(search);
    controls.appendChild(addRow);

    const actionRow = document.createElement("div");
    actionRow.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;";
    const incrementButton = makeButton("Increment kicking: Off", "#5865f2");
    incrementButton.id = "autochannel-increment-button";
    incrementButton.dataset.guildId = guildId;
    incrementButton.onclick = () => reportActionError("Increment kicking failed", () => toggleIncrementKicking(guildId));
    const nukeButton = makeButton("Nuke VC", "#da373c");
    nukeButton.id = "autochannel-nuke-button";
    nukeButton.onclick = () => reportActionError("Nuke VC failed", () => nukeVc(guildId));
    actionRow.append(incrementButton, batchKickButton, nukeButton);
    const incrementStatus = document.createElement("div");
    incrementStatus.id = "autochannel-increment-status";
    incrementStatus.dataset.guildId = guildId;
    incrementStatus.style.cssText = "font-size:12px;color:#b5bac1;";
    controls.append(actionRow, incrementStatus);

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
            text.style.cssText = "min-width: 0;";

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

    batchKickButton.onclick = () => {
        kickUpToTenVaultedUsers(guildId).catch(error => {
            log("Batch kick failed:", error);
            showKickNotice("Batch kick failed", error instanceof Error ? error.message : String(error));
        });
    };

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
    updateVaultActionButtons();
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

function VaultIcon() {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
            <path
                fill="currentColor"
                d="M4 3h16a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm1 3v12h14V6H5Zm7 1.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9Zm0 2a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Zm-.75.75h1.5v1h1v1.5h-1v1h-1.5v-1h-1v-1.5h1v-1ZM6 7h1.5v4H6V7Zm0 6h1.5v4H6v-4Z"
            />
        </svg>
    );
}

function VaultPanelButton(props: { nameplate?: any; }) {
    return (
        <AccountPanelButton
            tooltipText="Open Shitter Vault"
            icon={VaultIcon}
            plated={props?.nameplate != null}
            onClick={() => {
                const guildId = SelectedGuildStore.getGuildId();

                if (!guildId) {
                    showKickNotice("Open a server first", "The vault is stored separately for each server.");
                    return;
                }

                showVaultModal(guildId);
            }}
        />
    );
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
            action={() => queueAutochannelBan(user.id, guildId).catch(error => {
                log("Kick Shitter command failed:", error);
                showKickNotice("Kick failed", error instanceof Error ? error.message : String(error));
            })}
        />
    );

    group.push(
        <Menu.MenuItem
            id="autochannel-kick-and-vault-user"
            label="Kick Shitter + Add to Vault"
            color="danger"
            action={() => kickAndAddToVault(user, guildId).catch(error => {
                log("Kick and vault command failed:", error);
                showKickNotice("Kick and vault failed", error instanceof Error ? error.message : String(error));
            })}
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
                id="shitter-vault-kick-ten"
                label="Kick Up to 10 in VC (Once)"
                color="danger"
                action={() => kickUpToTenVaultedUsers(guildId).catch(error => {
                    log("Batch kick failed:", error);
                    showKickNotice("Batch kick failed", error instanceof Error ? error.message : String(error));
                })}
            />

            <Menu.MenuCheckboxItem
                id="shitter-vault-increment-kicking"
                label="Increment kicking"
                checked={incrementRun?.guildId === guildId}
                action={() => reportActionError("Increment kicking failed", () => toggleIncrementKicking(guildId))}
            />

            <Menu.MenuItem
                id="shitter-vault-nuke-vc"
                label="Nuke VC"
                color="danger"
                disabled={nukeInProgress}
                action={() => reportActionError("Nuke VC failed", () => nukeVc(guildId))}
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

    patches: [{
        find: "#{intl::USER_PROFILE_ACCOUNT_POPOUT_BUTTON_A11Y_LABEL}",
        replacement: {
            match: /children:\[(?=.{0,400}?accountContainerRef)/,
            replace: "children:[$self.VaultPanelButton(arguments[0]),"
        }
    }],

    contextMenus: {
        "user-context": userContextPatch
    },

    VaultPanelButton: ErrorBoundary.wrap(VaultPanelButton, { noop: true }),

    async start() {
        await loadVault();

        FluxDispatcher.subscribe("VOICE_STATE_UPDATES", handleVoiceUpdates);

        log("Vault listener started.");
    },

    stop() {
        FluxDispatcher.unsubscribe("VOICE_STATE_UPDATES", handleVoiceUpdates);

        disableAutoKick("plugin stopped");
        stopIncrementKicking();
        nukeInProgress = false;
        nukeGeneration++;
        document.getElementById("autochannel-vault-modal")?.remove();
        document.getElementById("autochannel-kick-notice")?.remove();

        log("Vault listener stopped.");
    }
});
