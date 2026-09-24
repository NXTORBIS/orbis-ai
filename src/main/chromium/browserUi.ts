import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Real operating-system input for the browser's own window (Windows only). CDP cannot operate Chromium's address bar or its
 * developer-tools window, so this finds the top-level windows of ONE process id (the browser Orbis launched), brings that window
 * forward, and sends genuine key presses to it with SendInput. The address bar's text is read through UI Automation.
 *
 * A single PowerShell process is kept alive (it compiles a tiny C# helper once) and is spoken to one JSON line at a time, so calls
 * after the first are fast. No native npm modules. Only windows whose owner process is the given pid are ever touched.
 */

export class BrowserUiError extends Error {
  code: 'unsupported' | 'no-window' | 'focus-refused' | 'input-failed' | 'helper-failed' | 'not-found'
  constructor(code: 'unsupported' | 'no-window' | 'focus-refused' | 'input-failed' | 'helper-failed' | 'not-found', message: string) {
    super(message)
    this.code = code
    this.name = 'BrowserUiError'
  }
}

export interface UiWindow { hwnd: number; title: string; left: number; top: number; right: number; bottom: number; minimized: boolean; foreground: boolean }

const CS = String.raw`
using System; using System.Collections.Generic; using System.Runtime.InteropServices; using System.Text;
public static class OrbisUi {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetParent(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint c);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool f);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] static extern uint SendInput(uint n, INPUT[] i, int size);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  public static void Aware() { SetProcessDPIAware(); }
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern void mouse_event(uint f, int dx, int dy, uint d, UIntPtr e);
  [DllImport("user32.dll")] static extern uint MapVirtualKey(uint c, uint t);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] struct KBD { public ushort vk, scan; public uint flags, time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct MOUSE { public int dx, dy; public uint data, flags, time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] struct INPUT { [FieldOffset(0)] public uint type; [FieldOffset(8)] public KBD k; [FieldOffset(8)] public MOUSE m; }
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr p, EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint f);
  [DllImport("user32.dll")] static extern IntPtr SetFocus(IntPtr h);
  // The window is in front when it, or the window it is embedded in (Orbis's own), is the foreground window.
  static bool IsFg(IntPtr h) { var fg = GetForegroundWindow(); return fg == h || (fg != IntPtr.Zero && fg == GetAncestor(h, 2)); }
  // The foreground window is this process's, or has a window of this process embedded in it.
  static bool FgOurs(uint pid) {
    var fg = GetForegroundWindow(); uint p; GetWindowThreadProcessId(fg, out p);
    if (p == pid) return true;
    bool found = false;
    EnumChildWindows(fg, (c, l) => { uint q; GetWindowThreadProcessId(c, out q); if (q == pid) { found = true; return false; } return true; }, IntPtr.Zero);
    return found;
  }
  static void Collect(IntPtr h, uint pid, IntPtr fg, StringBuilder sb, ref bool first) {
    if (!IsWindowVisible(h) || GetWindow(h, 4) != IntPtr.Zero) return;
    var cls = new StringBuilder(256); GetClassName(h, cls, 256);
    if (cls.ToString() != "Chrome_WidgetWin_1") return;
    var t = new StringBuilder(512); GetWindowText(h, t, 512);
    if (t.Length == 0) return;
    RECT r; GetWindowRect(h, out r);
    if (!first) sb.Append(","); first = false;
    sb.Append("{\"hwnd\":" + h.ToInt64() + ",\"title\":\"" + Esc(t.ToString()) + "\",\"left\":" + r.L + ",\"top\":" + r.T + ",\"right\":" + r.R + ",\"bottom\":" + r.B + ",\"minimized\":" + (IsIconic(h) ? "true" : "false") + ",\"foreground\":" + (IsFg(h) ? "true" : "false") + "}");
  }
  // This process's windows: its top-level windows, and the ones embedded as children in another window (the Orbis window).
  public static string Windows(uint pid) {
    var sb = new StringBuilder("["); bool first = true; var fg = GetForegroundWindow();
    EnumWindows((h, l) => {
      uint p; GetWindowThreadProcessId(h, out p);
      if (p == pid) Collect(h, pid, fg, sb, ref first);
      else { bool f2 = first; var sb2 = sb; var top = h; EnumChildWindows(h, (c, l2) => { uint q; GetWindowThreadProcessId(c, out q); if (q == pid && GetParent(c) == top) Collect(c, pid, fg, sb, ref first); return true; }, IntPtr.Zero); }
      return true;
    }, IntPtr.Zero);
    return sb.Append("]").ToString();
  }
  public static string WindowsOld(uint pid) {
    var sb = new StringBuilder("[");
    var fg = GetForegroundWindow(); bool first = true;
    EnumWindows((h, l) => {
      uint p; GetWindowThreadProcessId(h, out p);
      if (p != pid || !IsWindowVisible(h) || GetWindow(h, 4) != IntPtr.Zero) return true;
      var cls = new StringBuilder(256); GetClassName(h, cls, 256);
      if (cls.ToString() != "Chrome_WidgetWin_1") return true;
      var t = new StringBuilder(512); GetWindowText(h, t, 512);
      if (t.Length == 0) return true;
      RECT r; GetWindowRect(h, out r);
      if (!first) sb.Append(","); first = false;
      sb.Append("{\"hwnd\":" + h.ToInt64() + ",\"title\":\"" + Esc(t.ToString()) + "\",\"left\":" + r.L + ",\"top\":" + r.T + ",\"right\":" + r.R + ",\"bottom\":" + r.B + ",\"minimized\":" + (IsIconic(h) ? "true" : "false") + ",\"foreground\":" + (h == fg ? "true" : "false") + "}");
      return true;
    }, IntPtr.Zero);
    return sb.Append("]").ToString();
  }
  static string Esc(string s) { var b = new StringBuilder(); foreach (var c in s) { if (c == '"' || c == '\\') b.Append('\\').Append(c); else if (c < 32) b.Append(' '); else b.Append(c); } return b.ToString(); }
  public static long ForegroundFor(long hwnd) { return IsFg(new IntPtr(hwnd)) ? hwnd : GetForegroundWindow().ToInt64(); }
  public static long Foreground() { return GetForegroundWindow().ToInt64(); }
  public static bool Focus(long hwnd) {
    var h = new IntPtr(hwnd);
    if (!IsWindow(h)) return false;
    if (IsIconic(h)) ShowWindow(h, 9);
    if (IsFg(h)) { FocusInto(h); return true; }
    uint dummy; var fg = GetForegroundWindow();
    uint fgThread = fg == IntPtr.Zero ? 0 : GetWindowThreadProcessId(fg, out dummy);
    uint me = GetCurrentThreadId(); bool attached = false;
    // A synthetic Alt press lets SetForegroundWindow through the foreground lock.
    keybd_event(0x12, 0, 0, UIntPtr.Zero); keybd_event(0x12, 0, 2, UIntPtr.Zero);
    if (fgThread != 0 && fgThread != me) attached = AttachThreadInput(me, fgThread, true);
    BringWindowToTop(h); SetForegroundWindow(h);
    if (attached) AttachThreadInput(me, fgThread, false);
    for (int i = 0; i < 10; i++) { if (IsFg(h)) { FocusInto(h); return true; } System.Threading.Thread.Sleep(30); }
    return false;
  }
  // An embedded window lives in another process's window: give it keyboard focus by joining its input queue for the call.
  static void FocusInto(IntPtr h) {
    if (GetAncestor(h, 2) == h) return;
    uint dummy; uint t = GetWindowThreadProcessId(h, out dummy); uint me = GetCurrentThreadId();
    bool a = AttachThreadInput(me, t, true); SetFocus(h); if (a) AttachThreadInput(me, t, false);
  }
  static INPUT Key(ushort vk, ushort scan, uint flags) { var i = new INPUT(); i.type = 1; i.k.vk = vk; i.k.scan = scan; i.k.flags = flags; return i; }
  static bool Ext(ushort vk) { return vk == 0x25 || vk == 0x26 || vk == 0x27 || vk == 0x28 || vk == 0x2E || vk == 0x24 || vk == 0x23 || vk == 0x21 || vk == 0x22 || vk == 0x2D; }
  // Presses the keys in order, then releases them in reverse: a chord such as Ctrl+Shift+I.
  public static bool Chord(long hwnd, ushort[] vks) {
    if (!IsFg(new IntPtr(hwnd))) return false;
    var list = new List<INPUT>();
    foreach (var v in vks) list.Add(Key(v, (ushort)MapVirtualKey(v, 0), Ext(v) ? 1u : 0u));
    for (int i = vks.Length - 1; i >= 0; i--) list.Add(Key(vks[i], (ushort)MapVirtualKey(vks[i], 0), 2u | (Ext(vks[i]) ? 1u : 0u)));
    var arr = list.ToArray();
    return SendInput((uint)arr.Length, arr, Marshal.SizeOf(typeof(INPUT))) == arr.Length;
  }
  // Holds a chord like a real keyboard: press all, wait the typematic delay (500 ms), then repeat the last key at ~30/s until holdMs has passed, release.
  // The foreground check is repeated before every repeat, so a lost focus ends the hold. Returns how many key-down events were sent (first + repeats), -1 if not in front.
  public static int Hold(long hwnd, ushort[] vks, int holdMs) {
    var h = new IntPtr(hwnd); if (!IsFg(h)) return -1;
    int n = 0; var sw = System.Diagnostics.Stopwatch.StartNew();
    foreach (var v in vks) { var a = new INPUT[] { Key(v, (ushort)MapVirtualKey(v, 0), Ext(v) ? 1u : 0u) }; SendInput(1, a, Marshal.SizeOf(typeof(INPUT))); }
    n = 1; var last = vks[vks.Length - 1];
    System.Threading.Thread.Sleep(500);
    while (sw.ElapsedMilliseconds < holdMs && IsFg(h)) {
      var a = new INPUT[] { Key(last, (ushort)MapVirtualKey(last, 0), Ext(last) ? 1u : 0u) }; SendInput(1, a, Marshal.SizeOf(typeof(INPUT))); n++;
      System.Threading.Thread.Sleep(33);
    }
    for (int i = vks.Length - 1; i >= 0; i--) { var a = new INPUT[] { Key(vks[i], (ushort)MapVirtualKey(vks[i], 0), 2u | (Ext(vks[i]) ? 1u : 0u)) }; SendInput(1, a, Marshal.SizeOf(typeof(INPUT))); }
    return n;
  }
  public static bool Click(long hwnd, int x, int y, bool right) {
    if (!IsFg(new IntPtr(hwnd))) return false;
    SetCursorPos(x, y); System.Threading.Thread.Sleep(80);
    if (right) { mouse_event(8, 0, 0, 0, UIntPtr.Zero); mouse_event(16, 0, 0, 0, UIntPtr.Zero); } else { mouse_event(2, 0, 0, 0, UIntPtr.Zero); mouse_event(4, 0, 0, 0, UIntPtr.Zero); }
    return true;
  }
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT p);
  // GetAncestor is declared once, further up. Declaring it again here made the
  // whole OrbisUi type fail to compile ("already defines a member called
  // GetAncestor"), which took every capability in this file down with it.
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  // Real click at a screen point, only if the foreground window and the window under the point both belong to this pid.
  public static string ClickAtPid(uint pid, int x, int y, bool right) {
    if (!FgOurs(pid)) return "foreground-not-ours";
    var pt = new POINT(); pt.X = x; pt.Y = y; var top = WindowFromPoint(pt); uint q; GetWindowThreadProcessId(top, out q);
    if (q != pid) return "point-not-ours";
    SetCursorPos(x, y); System.Threading.Thread.Sleep(120);
    if (right) { mouse_event(8, 0, 0, 0, UIntPtr.Zero); mouse_event(16, 0, 0, 0, UIntPtr.Zero); } else { mouse_event(2, 0, 0, 0, UIntPtr.Zero); mouse_event(4, 0, 0, 0, UIntPtr.Zero); }
    return "ok";
  }
  public static string Hover(uint pid, int x, int y) {
    if (!FgOurs(pid)) return "foreground-not-ours";
    var pt = new POINT(); pt.X = x; pt.Y = y; var top = WindowFromPoint(pt); uint q; GetWindowThreadProcessId(top, out q);
    if (q != pid) return "point-not-ours";
    SetCursorPos(x, y); System.Threading.Thread.Sleep(150); SetCursorPos(x + 1, y + 1);
    return "ok";
  }
  // For a menu the browser just opened (a popup window of the same process holds the foreground).
  public static bool ChordIfPid(uint pid, ushort[] vks) {
    if (!FgOurs(pid)) return false;
    return Chord(GetForegroundWindow().ToInt64(), vks);
  }
  public static bool Text(long hwnd, string s) {
    if (!IsFg(new IntPtr(hwnd))) return false;
    var list = new List<INPUT>();
    foreach (var c in s) { list.Add(Key(0, c, 4)); list.Add(Key(0, c, 4 | 2)); }
    var arr = list.ToArray();
    return arr.Length == 0 || SendInput((uint)arr.Length, arr, Marshal.SizeOf(typeof(INPUT))) == arr.Length;
  }
}
`

const PS = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @'
${CS}
'@
[OrbisUi]::Aware()
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
function Omni($hwnd) {
  $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]::new([long]$hwnd))
  $edits = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)))
  foreach ($e in $edits) { if ($e.Current.Name -match 'Address and search bar') { return $e } }
  return $null
}
[Console]::Out.WriteLine('{"ready":true}')
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  try {
    $q = $line | ConvertFrom-Json
    switch ($q.cmd) {
      'windows' { $out = '{"ok":true,"data":' + [OrbisUi]::Windows([uint32]$q.pid) + '}' }
      'foreground' { $out = '{"ok":true,"data":' + [OrbisUi]::ForegroundFor([long]$q.hwnd) + '}' }
      'focus' { $out = '{"ok":true,"data":' + ([OrbisUi]::Focus([long]$q.hwnd).ToString().ToLower()) + '}' }
      'chord' { $out = '{"ok":true,"data":' + ([OrbisUi]::Chord([long]$q.hwnd, [uint16[]]@($q.vks)).ToString().ToLower()) + '}' }
      'chordPid' { $out = '{"ok":true,"data":' + ([OrbisUi]::ChordIfPid([uint32]$q.pid, [uint16[]]@($q.vks)).ToString().ToLower()) + '}' }
      'hold' { $out = '{"ok":true,"data":' + ([OrbisUi]::Hold([long]$q.hwnd, [uint16[]]@($q.vks), [int]$q.ms)) + '}' }
      'text' { $t = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($q.b64)); $out = '{"ok":true,"data":' + ([OrbisUi]::Text([long]$q.hwnd, $t).ToString().ToLower()) + '}' }
      'click' {
        $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]::new([long]$q.hwnd))
        $doc = $null
        for ($try = 0; $try -lt 15 -and $null -eq $doc; $try++) {
          $docs = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Document)))
          foreach ($d in $docs) { if ($d.Current.Name -notmatch 'DevTools' -and $d.Current.BoundingRectangle.Width -gt 0) { $doc = $d; break } }
          if ($null -eq $doc) { Start-Sleep -Milliseconds 300 }
        }
        if ($null -eq $doc) { $out = '{"ok":true,"data":"no-document"}' }
        else {
          $r = $doc.Current.BoundingRectangle
          $scale = $r.Width / [double]$q.innerWidth
          $sx = [int]($r.Left + [double]$q.x * $scale); $sy = [int]($r.Top + [double]$q.y * $scale)
          if ([OrbisUi]::Click([long]$q.hwnd, $sx, $sy, [bool]$q.right)) { $out = '{"ok":true,"data":"clicked ' + $sx + ',' + $sy + ' doc ' + $r.Left + ',' + $r.Top + ',' + $r.Width + ',' + $r.Height + ' scale ' + $scale + '"}' } else { $out = '{"ok":true,"data":"not-foreground"}' }
        }
      }
      'omnibox' {
        $e = Omni $q.hwnd
        if ($null -eq $e) { $out = '{"ok":true,"data":null}' }
        else {
          $v = ''
          try { $v = $e.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value } catch {}
          $out = '{"ok":true,"data":' + (ConvertTo-Json -Compress -InputObject ([string]$v)) + '}'
        }
      }
      'suggestions' {
        # The drop-down is a popup window of the browser process, so look through this process's windows only.
        $names = @()
        for ($try = 0; $try -lt 8 -and $names.Count -eq 0; $try++) {
          $wins = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, [int]$q.pid)))
          foreach ($w in $wins) {
            $items = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::ListItem)))
            foreach ($i in $items) { if ($i.Current.Name) { $names += [string]$i.Current.Name } }
          }
          if ($names.Count -eq 0) { Start-Sleep -Milliseconds 250 }
        }
        $out = '{"ok":true,"data":' + (ConvertTo-Json -Compress -InputObject @($names)) + '}'
      }
      'clickAt' { $out = '{"ok":true,"data":"' + [OrbisUi]::ClickAtPid([uint32]$q.pid, [int]$q.x, [int]$q.y, [bool]$q.right) + '"}' }
      'hoverAt' { $out = '{"ok":true,"data":"' + [OrbisUi]::Hover([uint32]$q.pid, [int]$q.x, [int]$q.y) + '"}' }
      'elements' {
        # Interactive elements (name, type, centre) of every window of this pid, popups included; web content is skipped.
        $res = @()
        $types = @('Button','TabItem','MenuItem','SplitButton','CheckBox','ListItem','Edit','ComboBox','Hyperlink','RadioButton')
        $wins = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, [int]$q.pid)))
        foreach ($w in $wins) {
          $all = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.OrCondition(@($types | % { New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::($_)) }))))
          foreach ($e in $all) { $r = $e.Current.BoundingRectangle; if ($r.Width -gt 0 -and $r.Height -gt 0 -and $r.Top -lt 5000) { $res += [pscustomobject]@{ n = ([string]$e.Current.Name) -replace '[\x00-\x1f]',' '; t = $e.Current.ControlType.ProgrammaticName -replace 'ControlType.',''; x = [int]($r.Left + $r.Width / 2); y = [int]($r.Top + $r.Height / 2); w = [int]$r.Width; h = [int]$r.Height } } }
        }
        $out = '{"ok":true,"data":' + (ConvertTo-Json -Compress -InputObject @($res)) + '}'
      }
      default { $out = '{"ok":false,"error":"unknown command"}' }
    }
  } catch {
    $out = '{"ok":false,"error":' + (ConvertTo-Json -Compress -InputObject ([string]$_.Exception.Message)) + '}'
  }
  [Console]::Out.WriteLine($out)
}
`

const VK: Record<string, number> = {
  ctrl: 0x11, control: 0x11, shift: 0x10, alt: 0x12, win: 0x5b, enter: 0x0d, return: 0x0d, esc: 0x1b, escape: 0x1b, tab: 0x09, space: 0x20, backspace: 0x08, delete: 0x2e,
  home: 0x24, end: 0x23, pageup: 0x21, pagedown: 0x22, left: 0x25, up: 0x26, right: 0x27, down: 0x28, plus: 0xbb, '=': 0xbb, '-': 0xbd, minus: 0xbd, ',': 0xbc, '.': 0xbe, '/': 0xbf
}
/** "ctrl+shift+i" -> virtual-key codes in press order. */
export function parseChord(chord: string): number[] {
  return chord.split('+').map((raw) => {
    const k = raw.trim().toLowerCase()
    if (k in VK) return VK[k]
    if (/^f([1-9]|1[0-2])$/.test(k)) return 0x6f + Number(k.slice(1))
    if (/^[a-z0-9]$/.test(k)) return k.toUpperCase().charCodeAt(0)
    throw new BrowserUiError('input-failed', `Unknown key "${raw}" in "${chord}".`)
  })
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export class BrowserUi {
  private ps: ChildProcessWithoutNullStreams | null = null
  private buffer = ''
  private waiting: ((line: string) => void)[] = []
  private ready: Promise<void> | null = null
  private queue: Promise<unknown> = Promise.resolve()

  private readonly pid: number
  constructor(pid: number) {
    this.pid = pid
  }

  static supported(): boolean {
    return process.platform === 'win32'
  }

  private start(): Promise<void> {
    if (this.ready) return this.ready
    if (!BrowserUi.supported()) throw new BrowserUiError('unsupported', 'Controlling the browser window is only available on Windows.')
    // Written to a file: the script outgrew the 32K command-line limit that -EncodedCommand is subject to.
    const script = join(tmpdir(), `orbis-ui-helper-${process.pid}-${Date.now()}.ps1`)
    writeFileSync(script, '\uFEFF' + PS, 'utf8')
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true })
    ps.once('exit', () => { try { unlinkSync(script) } catch { /* gone */ } })
    this.ps = ps
    ps.stdout.setEncoding('utf8')
    ps.stdout.on('data', (chunk: string) => {
      this.buffer += chunk
      let i: number
      while ((i = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, i).trim()
        this.buffer = this.buffer.slice(i + 1)
        if (line) this.waiting.shift()?.(line)
      }
    })
    let err = ''
    ps.stderr.on('data', (d) => (err += String(d)))
    ps.on('exit', () => {
      this.ps = null
      this.ready = null
      for (const w of this.waiting.splice(0)) w(JSON.stringify({ ok: false, error: `helper exited. ${err.slice(0, 300)}` }))
    })
    this.ready = new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new BrowserUiError('helper-failed', `The window helper did not start. ${err.slice(0, 300)}`)), 30_000)
      this.waiting.push((line) => {
        clearTimeout(t)
        if (line.includes('"ready"')) resolve()
        else reject(new BrowserUiError('helper-failed', line))
      })
    })
    this.ready.catch(() => this.close())
    return this.ready
  }

  private call<T>(q: Record<string, unknown>): Promise<T> {
    const run = async (): Promise<T> => {
      await this.start()
      const ps = this.ps
      if (!ps) throw new BrowserUiError('helper-failed', 'The window helper is not running.')
      const reply = new Promise<string>((resolve, reject) => {
        const t = setTimeout(() => reject(new BrowserUiError('helper-failed', 'The window helper did not answer.')), 20_000)
        this.waiting.push((l) => {
          clearTimeout(t)
          resolve(l)
        })
      })
      ps.stdin.write(JSON.stringify(q) + '\n')
      const r = JSON.parse(await reply) as { ok: boolean; data?: T; error?: string }
      if (!r.ok) throw new BrowserUiError('helper-failed', r.error ?? 'The window helper failed.')
      return r.data as T
    }
    const next = this.queue.then(run, run)
    this.queue = next.catch(() => undefined)
    return next
  }

  close(): void {
    try {
      this.ps?.kill()
    } catch {
      /* already gone */
    }
    this.ps = null
    this.ready = null
  }

  /** The visible top-level browser windows of this process, front-most first. */
  windows(): Promise<UiWindow[]> {
    return this.call<UiWindow[]>({ cmd: 'windows', pid: this.pid })
  }

  /** Picks this process's window: the one whose title contains `title` if given, else the foreground one, else the front-most. */
  async pickWindow(title?: string): Promise<UiWindow> {
    const list = await this.windows()
    if (!list.length) throw new BrowserUiError('no-window', 'The Orbis browser has no visible window (it may still be starting, or closed).')
    return (title ? list.find((w) => w.title.includes(title)) : undefined) ?? list.find((w) => w.foreground) ?? list[0]
  }

  /** Brings the window forward. Fails with `focus-refused` if Windows will not let this happen (e.g. another app holds the foreground lock). */
  async focus(win: UiWindow, attempts = 4): Promise<void> {
    for (let i = 0; i < attempts; i++) {
      if (await this.call<boolean>({ cmd: 'focus', hwnd: win.hwnd })) {
        await sleep(80)
        if ((await this.call<number>({ cmd: 'foreground', hwnd: win.hwnd })) === win.hwnd) return
      }
      await sleep(250 * (i + 1))
    }
    throw new BrowserUiError('focus-refused', 'Windows did not let Orbis bring the browser window to the front (another program may hold the foreground). Nothing was typed.')
  }

  /** Sends input only while the window is in front (checked in the same step as the send); if focus was lost, brings it back and tries again. */
  private async guarded(win: UiWindow, send: (hwnd: number) => Promise<boolean>, what: string): Promise<void> {
    for (let i = 0; i < 4; i++) {
      await this.focus(win)
      if (await send(win.hwnd)) return
      await sleep(200)
    }
    throw new BrowserUiError('focus-refused', `The browser window kept losing the foreground, so ${what} was not sent (another program is taking focus).`)
  }

  /** Focuses the window, then presses a chord such as "ctrl+l". Input goes out only once the browser really is in front. */
  async press(win: UiWindow, chord: string): Promise<void> {
    const vks = parseChord(chord)
    await this.guarded(win, (hwnd) => this.call<boolean>({ cmd: 'chord', hwnd, vks }), `the key input "${chord}"`)
    // Moving focus to the address bar (ctrl+l, ctrl+k, alt+d, f6) takes the browser a moment; text typed before it lands is lost.
    await sleep(/^(ctrl\+[lk]|alt\+d|f6)$/i.test(chord.trim()) ? 450 : 60)
  }

  /** Holds a chord (typematic auto-repeat of the last key) for `ms`; returns the number of key-down events sent. Test tooling only. */
  async hold(win: UiWindow, chord: string, ms: number): Promise<number> {
    await this.focus(win)
    const n = await this.call<number>({ cmd: 'hold', hwnd: win.hwnd, vks: parseChord(chord), ms })
    if (n < 0) throw new BrowserUiError('focus-refused', 'The browser window was not in front, so the held key was not sent.')
    await sleep(60)
    return n
  }

  /** Types text into whatever has focus in the window, after checking the window is in front. */
  async type(win: UiWindow, text: string): Promise<void> {
    const b64 = Buffer.from(text, 'utf8').toString('base64')
    await this.guarded(win, (hwnd) => this.call<boolean>({ cmd: 'text', hwnd, b64 }), 'the typed text')
    await sleep(80)
  }

  /** Presses a key while one of this process's own popups (a context menu) is in front. */
  async pressInMenu(chord: string): Promise<void> {
    const vks = parseChord(chord)
    if (!(await this.call<boolean>({ cmd: 'chordPid', pid: this.pid, vks }))) throw new BrowserUiError('focus-refused', `The browser's menu was not in front, so ${chord} was not sent.`)
    await sleep(60)
  }

  /** Clicks a point of the tab's page (CSS pixels from the page's top-left) with the real mouse; the window is brought forward first. */
  async clickPage(win: UiWindow, x: number, y: number, innerWidth: number, right = false): Promise<void> {
    for (let i = 0; i < 4; i++) {
      await this.focus(win)
      const r = await this.call<string>({ cmd: 'click', hwnd: win.hwnd, x, y, innerWidth, right })
      if (r.startsWith('clicked')) {
        if (process.env.ORBIS_UI_DEBUG) console.error('[ui click]', r, { x, y, innerWidth })
        return
      }
      if (r === 'no-document') throw new BrowserUiError('not-found', "The page's area of the window is not exposed to UI Automation.")
      await sleep(200)
    }
    throw new BrowserUiError('focus-refused', 'The browser window kept losing the foreground, so the click was not sent.')
  }

  /** Interactive UI Automation elements of this process's windows (popups included), with their screen centres. */
  elements(): Promise<{ n: string; t: string; x: number; y: number; w: number; h: number }[]> {
    return this.call({ cmd: 'elements', pid: this.pid })
  }

  /** Clicks the element whose name matches, but only while this process's window is in front and owns the point. */
  async clickElement(win: UiWindow, name: RegExp, right = false, type?: string): Promise<string> {
    await this.focus(win)
    const list = await this.elements()
    const el = list.find((e) => name.test(e.n) && (!type || e.t === type))
    if (!el) throw new BrowserUiError('not-found', `No element matching ${name} (have: ${list.map((e) => e.n).filter(Boolean).slice(0, 60).join(' | ')})`)
    const r = await this.call<string>({ cmd: 'clickAt', pid: this.pid, x: el.x, y: el.y, right })
    if (r !== 'ok') throw new BrowserUiError('focus-refused', `click refused: ${r}`)
    await sleep(120)
    return el.n
  }

  /** Clicks a screen point (same ownership checks as clickElement). */
  async clickScreen(win: UiWindow, x: number, y: number, right = false): Promise<void> {
    await this.focus(win)
    const r = await this.call<string>({ cmd: 'clickAt', pid: this.pid, x, y, right })
    if (r !== 'ok') throw new BrowserUiError('focus-refused', `click refused: ${r}`)
    await sleep(120)
  }

  /** Real cursor move onto a point (screen pixels), same ownership checks; nothing is clicked. */
  async hoverAt(win: UiWindow, x: number, y: number): Promise<void> {
    await this.focus(win)
    const r = await this.call<string>({ cmd: 'hoverAt', pid: this.pid, x, y })
    if (r !== 'ok') throw new BrowserUiError('focus-refused', `hover refused: ${r}`)
  }

  /** The address bar's text, read through UI Automation; null if the address bar is not exposed. */
  async omnibox(win: UiWindow): Promise<string | null> {
    try {
      return await this.call<string | null>({ cmd: 'omnibox', hwnd: win.hwnd })
    } catch {
      // The window's accessibility tree can be rebuilding for a moment; one more try.
      await sleep(400)
      return this.call<string | null>({ cmd: 'omnibox', hwnd: win.hwnd })
    }
  }

  /** Rows of the address bar's suggestion list, read through UI Automation. */
  suggestions(win: UiWindow): Promise<string[]> {
    return this.call<string[]>({ cmd: 'suggestions', pid: this.pid, hwnd: win.hwnd })
  }
}
