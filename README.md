# Install

Install Git and Node.js first:

- https://git-scm.com/download/win
- https://nodejs.org

Then open PowerShell and run:

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned

irm https://raw.githubusercontent.com/ADONIE-DBD/AutochannelKick/main/install.ps1 | iex

Set-ExecutionPolicy -ExecutionPolicy Restricted
```

Restart Discord after installation. 

Enable the plugin: 

Settings → Vencord → Plugins → AutochannelKick
