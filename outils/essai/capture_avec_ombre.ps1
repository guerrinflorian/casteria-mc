# Photographie une fenêtre TELLE QU'ELLE S'AFFICHE (coins arrondis et ombre de Windows 11 compris), avec une petite
# marge autour (24 px par défaut : juste de quoi voir l'ombre). La fenêtre est d'abord mise au premier plan.
# Usage : powershell -File capture_avec_ombre.ps1 -ProcessId <pid> -Sortie <png> [-Marge 24]
param(
    [Parameter(Mandatory = $true)][int]$ProcessId,
    [Parameter(Mandatory = $true)][string]$Sortie,
    [int]$Marge = 24
)
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Ombre {
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT r, int taille);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
"@
[void][Ombre]::SetProcessDPIAware()
$p = Get-Process -Id $ProcessId -ErrorAction Stop
$h = $p.MainWindowHandle
if ($h -eq [IntPtr]::Zero) { Write-Output "PAS_DE_FENETRE"; exit 2 }
[void][Ombre]::SetForegroundWindow($h)
Start-Sleep -Milliseconds 400
$r = New-Object Ombre+RECT
# 9 = DWMWA_EXTENDED_FRAME_BOUNDS : le vrai rectangle affiché, sans la zone invisible des bords
[void][Ombre]::DwmGetWindowAttribute($h, 9, [ref]$r, 16)
$x = $r.Left - $Marge; $y = $r.Top - $Marge
$l = $r.Right - $r.Left + 2 * $Marge; $ht = $r.Bottom - $r.Top + 2 * $Marge
$bmp = New-Object System.Drawing.Bitmap $l, $ht
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($x, $y, 0, 0, (New-Object System.Drawing.Size $l, $ht))
$g.Dispose()
$bmp.Save($Sortie, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output ("OK {0}x{1} (fenetre {2}x{3}) -> {4}" -f $l, $ht, ($r.Right - $r.Left), ($r.Bottom - $r.Top), $Sortie)
