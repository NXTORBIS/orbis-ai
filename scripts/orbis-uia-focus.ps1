# Prints the UI Automation element that has keyboard focus, only if it belongs to the given pid (else "foreign").
param([Parameter(Mandatory)][int]$ProcId)
Add-Type -AssemblyName UIAutomationClient; Add-Type -AssemblyName UIAutomationTypes
$e = [System.Windows.Automation.AutomationElement]::FocusedElement
if ($null -eq $e -or $e.Current.ProcessId -ne $ProcId) { '{"foreign":true}'; exit }
$c = $e.Current; $r = $c.BoundingRectangle
$nm = ([string]$c.Name) -replace '[\x00-\x1f"]', ' ' -replace '\\', '/'
'{"n":"' + $nm + '","t":"' + ($c.ControlType.ProgrammaticName -replace 'ControlType\.', '') + '","c":"' + $c.ClassName + '","x":' + [int]$r.Left + ',"y":' + [int]$r.Top + ',"w":' + [int]$r.Width + ',"h":' + [int]$r.Height + '}'
