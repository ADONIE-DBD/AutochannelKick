````md
# AutochannelKick

Adds:

- Kick Shitter button
- Shitter Vault
- Auto kick toggle
- Import / Export IDs
- Discord-style vault UI
- Automatic VC kicking for saved users

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

irm https://raw.githubusercontent.com/ADONIE-DBD/AutochannelKick/main/install.ps1 | iex

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

# Vesktop Edition

Runs completely separately from normal Discord.

This version does NOT modify your normal Discord installation.

---

# Automatic Install (Recommended)

Open PowerShell and run:

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned

irm https://raw.githubusercontent.com/ADONIE-DBD/AutochannelKick/main/AutochannelKick-Vesktop-Setup.ps1 | iex

Set-ExecutionPolicy -ExecutionPolicy Restricted
```

This automatically:

* Downloads Vesktop
* Installs Vesktop
* Creates the plugins folder
* Installs AutochannelKick

After installation:

```text
Restart Vesktop
```

Then enable:

```text
Settings → Vencord → Plugins → AutochannelKick
```

---

# Manual Vesktop Installation

## 1. Download Vesktop

* Vesktop: https://vesktop.dev

---

## 2. Open the Vesktop folder

Press:

```text
Win + R
```

Paste:

```text
%appdata%\vesktop
```

---

## 3. Create a plugins folder

Inside the Vesktop folder create:

```text
plugins
```

Result:

```text
vesktop
 └── plugins
```

---

## 4. Create the plugin folder

Inside `plugins` create:

```text
AutochannelKick
```

Result:

```text
vesktop
 └── plugins
     └── AutochannelKick
```

---

## 5. Download this repository

Click:

```text
Code → Download ZIP
```

Extract the ZIP.

---

## 6. Copy plugin files

Copy all plugin files into:

```text
%appdata%\vesktop\plugins\AutochannelKick
```

Make sure:

```text
index.tsx
```

is directly inside the folder.

Example:

```text
AutochannelKick
 └── index.tsx
```

---

## 7. Restart Vesktop

Completely close Vesktop and reopen it.

---

## 8. Enable the plugin

Open:

```text
Settings → Vencord → Plugins
```

Enable:

```text
AutochannelKick
```

```
```
