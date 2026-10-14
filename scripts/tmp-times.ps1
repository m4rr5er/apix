$apix = Get-CimInstance Win32_Process -Filter "Name='APIX.exe'"
$pis = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*mode rpc*' }
'APIX  start: {0}' -f ($apix | ForEach-Object { $_.CreationDate })
foreach ($p in $pis) { 'pi    start: {0}  pid={1}' -f $p.CreationDate, $p.ProcessId }
'--- parent of each pi ---'
foreach ($p in $pis) {
  $parent = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $p.ParentProcessId) -ErrorAction SilentlyContinue
  'pid {0} parent {1} = {2}' -f $p.ProcessId, $p.ParentProcessId, ($parent.Name)
}
