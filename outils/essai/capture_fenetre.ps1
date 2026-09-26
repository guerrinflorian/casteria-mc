# Capture la fenetre principale d'UN processus (le jeu lance par le test), jamais l'ecran entier.
# Usage : powershell -File capture_fenetre.ps1 -ProcessId <pid> -Sortie <fichier.png>
param(
    [Parameter(Mandatory = $true)][int]$ProcessId,
    [Parameter(Mandatory = $true)][string]$Sortie
)

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Fenetre {
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
"@

[void][Fenetre]::SetProcessDPIAware()
$p = Get-Process -Id $ProcessId -ErrorAction Stop
$h = $p.MainWindowHandle
if ($h -eq [IntPtr]::Zero) { Write-Output "PAS_DE_FENETRE"; exit 2 }

$r = New-Object Fenetre+RECT
[void][Fenetre]::GetWindowRect($h, [ref]$r)
$l = $r.Right - $r.Left; $ht = $r.Bottom - $r.Top
if ($l -le 0 -or $ht -le 0) { Write-Output "FENETRE_VIDE"; exit 3 }

$bmp = New-Object System.Drawing.Bitmap $l, $ht
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
# 2 = PW_RENDERFULLCONTENT : lit aussi le contenu OpenGL compose par le bureau
$ok = [Fenetre]::PrintWindow($h, $hdc, 2)
$g.ReleaseHdc($hdc)
$g.Dispose()

# Si l'image est toute noire (certains pilotes OpenGL), on relit l'ecran a l'emplacement de la fenetre.
$noir = $true
for ($i = 1; $i -lt 10 -and $noir; $i++) {
    $c = $bmp.GetPixel([int]($l * $i / 10), [int]($ht * $i / 10))
    if ($c.R -gt 8 -or $c.G -gt 8 -or $c.B -gt 8) { $noir = $false }
}
$mode = "PrintWindow"
if ($noir) {
    $g2 = [System.Drawing.Graphics]::FromImage($bmp)
    $g2.CopyFromScreen($r.Left, $r.Top, 0, 0, (New-Object System.Drawing.Size $l, $ht))
    $g2.Dispose()
    $mode = "CopyFromScreen"
}
$bmp.Save($Sortie, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output ("OK {0} {1}x{2} titre='{3}' -> {4}" -f $mode, $l, $ht, $p.MainWindowTitle, $Sortie)
