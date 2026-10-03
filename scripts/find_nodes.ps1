Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*rexeditzz-insta-agent*" } | Select-Object ProcessId, CommandLine | Format-List
