# Captures one browser process's own windows (main window plus its popups, e.g. the omnibox suggestion list) with PrintWindow, which
# reads each window's own content, never the screen: nothing belonging to another application can end up in the picture.
# Optionally moves the mouse to hover a point of the window, but only if the topmost window at that point belongs to this pid.
param([Parameter(Mandatory)][int]$ProcId, [Parameter(Mandatory)][string]$Out, [int]$MoveX = -1, [int]$MoveY = -1)
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System; using System.Collections.Generic; using System.Runtime.InteropServices; using System.Text;
public class OrbisCap {
  delegate bool EP(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EP p, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint f);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint f);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint f);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool f);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  // Brings one of OUR windows to the front (thread-input attach, no synthetic keys); true once it really is in front.
  public static bool Front(IntPtr h) {
    if (IsIconic(h)) ShowWindow(h, 9);
    for (int i = 0; i < 6; i++) {
      IntPtr fg = GetForegroundWindow();
      if (fg == h) return true;
      uint d; uint ft = fg == IntPtr.Zero ? 0 : GetWindowThreadProcessId(fg, out d); uint me = GetCurrentThreadId();
      bool a = ft != 0 && ft != me && AttachThreadInput(me, ft, true);
      BringWindowToTop(h); SetForegroundWindow(h);
      if (a) AttachThreadInput(me, ft, false);
      System.Threading.Thread.Sleep(120);
    }
    return GetForegroundWindow() == h;
  }
  public struct RECT { public int L, T, R, B; }
  public struct POINT { public int X, Y; }
  public static uint OwnerOf(IntPtr h) { uint p; GetWindowThreadProcessId(h, out p); return p; }
  // Visible Chrome top-level windows of the pid, in z-order (front first).
  public static List<IntPtr> Windows(uint pid) {
    var l = new List<IntPtr>();
    EnumWindows((h, x) => { uint p; GetWindowThreadProcessId(h, out p); if (p != pid || !IsWindowVisible(h)) return true;
      var c = new StringBuilder(256); GetClassName(h, c, 256); if (c.ToString() != "Chrome_WidgetWin_1") return true;
      RECT r; GetWindowRect(h, out r); if (r.R - r.L > 20 && r.B - r.T > 20) l.Add(h); return true; }, IntPtr.Zero);
    return l;
  }
}
"@ -ReferencedAssemblies System.Drawing
[OrbisCap]::SetProcessDPIAware() | Out-Null
$wins = [OrbisCap]::Windows([uint32]$ProcId)
if ($wins.Count -eq 0) { Write-Error "no visible window for pid $ProcId"; exit 2 }
# The main window is the widest one; the rest are popups drawn over it.
$rects = @{}; foreach ($h in $wins) { $r = New-Object OrbisCap+RECT; [OrbisCap]::GetWindowRect($h, [ref]$r) | Out-Null; $rects[$h] = $r }
$main = $wins | Sort-Object { $rects[$_].R - $rects[$_].L } -Descending | Select-Object -First 1
$m = $rects[$main]
if ($MoveX -ge 0) {
  # Real hover: put THIS browser window in front (topmost, so a topmost window of another app cannot cover it), then move the cursor
  # onto it, but only if the topmost window at that point belongs to this pid. Nothing is clicked or typed.
  if (-not [OrbisCap]::Front($main)) { Write-Error "could not bring pid $ProcId window to the front; mouse not moved"; exit 2 }
  [OrbisCap]::SetWindowPos($main, [IntPtr]::new(-1), 0, 0, 0, 0, 0x0013) | Out-Null
  Start-Sleep -Milliseconds 300
  $pt = New-Object OrbisCap+POINT; $pt.X = $m.L + $MoveX; $pt.Y = $m.T + $MoveY
  $top = [OrbisCap]::GetAncestor([OrbisCap]::WindowFromPoint($pt), 2)
  if ([OrbisCap]::OwnerOf($top) -ne [uint32]$ProcId) { $op = [OrbisCap]::OwnerOf($top); $pn = (Get-Process -Id $op -ea 0).ProcessName; Write-Error "the window at that point belongs to $pn ($op), not pid $ProcId; mouse not moved"; exit 2 }
  [OrbisCap]::SetCursorPos($pt.X, $pt.Y) | Out-Null; Start-Sleep -Milliseconds 300
  [OrbisCap]::SetCursorPos($pt.X + 1, $pt.Y + 1) | Out-Null; Start-Sleep -Milliseconds 700
}
$w = $m.R - $m.L; $ht = $m.B - $m.T
$b = New-Object System.Drawing.Bitmap $w, $ht
$g = [System.Drawing.Graphics]::FromImage($b)
$g.Clear([System.Drawing.Color]::Black)
# Back to front: the main window first, then popups (list order is front-first, so reverse it).
$popups = @($wins | Where-Object { $_ -ne $main }); [array]::Reverse($popups); $order = @($main) + $popups
foreach ($h in $order) {
  if ($null -eq $h -or -not $rects.ContainsKey($h)) { continue }
  $r = $rects[$h]; $bw = $r.R - $r.L; $bh = $r.B - $r.T
  $tmp = New-Object System.Drawing.Bitmap $bw, $bh
  $tg = [System.Drawing.Graphics]::FromImage($tmp); $dc = $tg.GetHdc()
  [OrbisCap]::PrintWindow($h, $dc, 2) | Out-Null
  $tg.ReleaseHdc($dc); $tg.Dispose()
  $g.DrawImage($tmp, $r.L - $m.L, $r.T - $m.T); $tmp.Dispose()
}
$b.Save($Out); $g.Dispose(); $b.Dispose()
"saved $Out ($($wins.Count) windows)"
