````md id="3dg64r"
# AutochannelKick

Adds:

- Shitter Vault
- Open vault button next to mute button
- Kick Shitter button
- Auto kick toggle
- Import / Export IDs
- Nuke VC buutton
- Incremental kicking of users in the vault
- Kick everyone in vc button

---

# Vencord Edition

Installs directly into normal Discord using a Vencord source build.

## Requirements

Install these first:

- Git: https://git-scm.com/download/win
- Node.js LTS: https://nodejs.org

---

# Automatic Install (Recommended)

Open PowerShell and run:

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned

irm https://raw.githubusercontent.com/ADONIE-DBD/AutochannelKick/main/AutochannelKick-Vencord-Setup.ps1 | iex

Set-ExecutionPolicy -ExecutionPolicy Restricted
````

This installs the Vencord source build into:

```text
C:\Vencord
```

and automatically installs the AutochannelKick plugin.

After installation:

```text
Restart Discord
```

Then enable:

```text
Settings → Vencord → Plugins → AutochannelKick
```

---

# Manual Installation

## Requirements

Install these first:

* Git: https://git-scm.com/download/win
* Node.js LTS: https://nodejs.org

If you do not already have a Vencord source build installed, download it here:

* Vencord: https://github.com/Vendicated/Vencord

---

## 1. Open your Vencord folder

Example:

```text
C:\Vencord
```

---

## 2. Navigate to:

```text
src\userplugins
```

If the folder does not exist, create it manually.

---

## 3. Create a new folder named:

```text
AutochannelKick
```

Result:

```text
Vencord
 └── src
     └── userplugins
         └── AutochannelKick
```

---

## 4. Download this repository

Click:

```text
Code → Download ZIP
```

Extract the ZIP.

---

## 5. Copy the plugin files

Copy everything inside:

```text
AutochannelKick
```

into:

```text
Vencord\src\userplugins\AutochannelKick
```

Make sure `index.tsx` is directly inside the folder.

Example:

```text
AutochannelKick
 └── index.tsx
```

---

## 6. Build Vencord

Open PowerShell inside your Vencord folder and run:

```powershell
pnpm install
pnpm build
pnpm inject
```

---

## 7. Restart Discord

Then enable the plugin:

```text
Settings → Vencord → Plugins → AutochannelKick
```

---

# Important

Do NOT move the Vencord folder after installation.

The Vencord source build stores internal references to its install location.
Moving the folder can break Discord loading.

---
