# Dumps the UI Automation tree of one browser process's own windows (main window plus popups such as menus), NOT descending into web content
# (Document controls), as JSON lines: depth, control type, name, class, automation id, keyboard focusable, help text, rect.
param([Parameter(Mandatory)][int]$ProcId, [string]$Out, [long]$Hwnd = 0)
Add-Type -AssemblyName UIAutomationClient; Add-Type -AssemblyName UIAutomationTypes
$AE = [System.Windows.Automation.AutomationElement]; $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
$res = New-Object System.Collections.ArrayList
function Walk($e, $d, $inDoc) {
  if ($d -gt 14) { return }
  $c = $null; try { $c = $e.Current } catch { return }
  $t = $c.ControlType.ProgrammaticName -replace 'ControlType\.', ''
  $r = $c.BoundingRectangle
  $nm = ([string]$c.Name) -replace '[\x00-\x1f]', ' '
  [void]$res.Add([pscustomobject]@{ d = $d; t = $t; n = $nm; c =$c.ClassName; id = $c.AutomationId; kf = $c.IsKeyboardFocusable; help = $c.HelpText; x = [int]$r.Left; y = [int]$r.Top; w = [int]$r.Width; h = [int]$r.Height; off = $c.IsOffscreen })
  if ($t -eq 'Document') { return }
  $ch = $walker.GetFirstChild($e)
  while ($null -ne $ch) { Walk $ch ($d + 1) $false; $ch = $walker.GetNextSibling($ch) }
}
$wins = $AE::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, (New-Object System.Windows.Automation.PropertyCondition($AE::ProcessIdProperty, $ProcId)))
if ($Hwnd -ne 0) { $wins = @($AE::FromHandle([IntPtr]::new($Hwnd))) }
foreach ($w in $wins) { Walk $w 0 $false }
$json = $res | ConvertTo-Json -Compress -Depth 4
if ($Out) { [IO.File]::WriteAllText($Out, $json) } else { $json }
