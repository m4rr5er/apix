Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ForEach-Object {
  $cl = if ($_.CommandLine) { $_.CommandLine } else { '(n/a)' }
  '{0} :: {1}' -f $_.ProcessId, $cl
}
