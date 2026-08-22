# Run once to register the "China Cargo Bot" autostart task.
# Mirrors the same pattern already used for "OpenClaw Gateway" on this machine.

$action = New-ScheduledTaskAction -Execute "wscript.exe" `
    -Argument '"C:\Users\Murodjon Nuritdinov\Documents\china-cargo-bot\deploy\china-cargo-bot.vbs"'
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable

Register-ScheduledTask -TaskName "China Cargo Bot" -Action $action -Trigger $trigger -Settings $settings -RunLevel Limited -Force

Write-Host "Registered scheduled task 'China Cargo Bot'. Starting it now..."
Start-ScheduledTask -TaskName "China Cargo Bot"
