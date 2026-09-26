# Clique dans la fenetre du jeu lance par le test (messages envoyes a CETTE fenetre, la souris de Florian ne bouge pas).
# X et Y sont lus sur une capture de capture_fenetre.ps1 (coordonnees de la fenetre entiere, barre de titre comprise).
# Usage : powershell -File cliquer.ps1 -ProcessId <pid> -X <x> -Y <y>
param(
    [Parameter(Mandatory = $true)][int]$ProcessId,
    [Parameter(Mandatory = $true)][int]$X,
    [Parameter(Mandatory = $true)][int]$Y
)

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Clic {
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern bool ScreenToClient(IntPtr h, ref POINT p);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
"@

[void][Clic]::SetProcessDPIAware()
$p = Get-Process -Id $ProcessId -ErrorAction Stop
$cmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId").CommandLine
if ($cmd -notlike '*test-launcher*') { Write-Output "REFUS : ce processus n'est pas le jeu du test"; exit 4 }
$h = $p.MainWindowHandle
$r = New-Object Clic+RECT
[void][Clic]::GetWindowRect($h, [ref]$r)
$pt = New-Object Clic+POINT
$pt.X = $r.Left + $X; $pt.Y = $r.Top + $Y
[void][Clic]::ScreenToClient($h, [ref]$pt)
$l = [IntPtr](($pt.Y -shl 16) -bor ($pt.X -band 0xFFFF))
# WM_MOUSEMOVE, puis WM_LBUTTONDOWN (MK_LBUTTON) et WM_LBUTTONUP
[void][Clic]::PostMessage($h, 0x0200, [IntPtr]0, $l)
Start-Sleep -Milliseconds 150
[void][Clic]::PostMessage($h, 0x0201, [IntPtr]1, $l)
Start-Sleep -Milliseconds 80
[void][Clic]::PostMessage($h, 0x0202, [IntPtr]0, $l)
Write-Output ("CLIC client ({0},{1}) dans '{2}'" -f $pt.X, $pt.Y, $p.MainWindowTitle)
