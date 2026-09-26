# Dessine l'icône d'un fichier (un raccourci .lnk, un .ico, un .exe) EXACTEMENT comme l'Explorateur de Windows l'affiche
# à une taille donnée (IShellItemImageFactory, icône seule) ; lecture seule. Puis l'agrandit sans lissage pour la voir.
# Usage : powershell -File icone_raccourci.ps1 -Fichier <lnk> -Sortie <png> [-Tailles "32,48,60,96"] [-Zoom 4]
param(
    [Parameter(Mandatory = $true)][string]$Fichier,
    [Parameter(Mandatory = $true)][string]$Sortie,
    [string]$Tailles = "32,48,60,96",
    [int]$Zoom = 4
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing @"
using System;
using System.Drawing;
using System.Runtime.InteropServices;
public static class ImageShell {
    [StructLayout(LayoutKind.Sequential)] public struct SIZE { public int cx, cy; }
    [ComImport, Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IShellItemImageFactory { [PreserveSig] int GetImage(SIZE size, int flags, out IntPtr phbm); }
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    static extern void SHCreateItemFromParsingName(string path, IntPtr pbc, [MarshalAs(UnmanagedType.LPStruct)] Guid riid, [MarshalAs(UnmanagedType.Interface)] out IShellItemImageFactory item);
    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr o);
    public static Bitmap Dessiner(string path, int taille) {
        IShellItemImageFactory f;
        SHCreateItemFromParsingName(path, IntPtr.Zero, new Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), out f);
        IntPtr h; SIZE s; s.cx = taille; s.cy = taille;
        // 0x4 = SIIGBF_ICONONLY : l'icône, pas une vignette
        int r = f.GetImage(s, 0x4, out h);
        if (r != 0) throw new Exception("GetImage : " + r);
        Bitmap b = System.Drawing.Image.FromHbitmap(h);
        DeleteObject(h);
        return b;
    }
}
"@
$liste = @($Tailles.Split(',') | ForEach-Object { [int]$_.Trim() })
$somme = 0; $plus = 0
foreach ($t in $liste) { $somme += $t; if ($t -gt $plus) { $plus = $t } }
$largeur = [int]($somme * $Zoom + 20 * ($liste.Count + 1))
$hauteur = [int]($plus * $Zoom + 50)
$planche = New-Object System.Drawing.Bitmap $largeur, $hauteur
$g = [System.Drawing.Graphics]::FromImage($planche)
$g.Clear([System.Drawing.Color]::FromArgb(255, 32, 40, 56))
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
$x = 20
foreach ($t in $liste) {
    $img = [ImageShell]::Dessiner($Fichier, $t)
    $g.DrawImage($img, $x, 10, $t * $Zoom, $t * $Zoom)
    $g.DrawString("$t px", (New-Object System.Drawing.Font 'Segoe UI', 11), [System.Drawing.Brushes]::White, $x, $hauteur - 32)
    $x += $t * $Zoom + 20
    $img.Dispose()
}
$g.Dispose()
$planche.Save($Sortie, [System.Drawing.Imaging.ImageFormat]::Png)
$planche.Dispose()
Write-Output "OK $Sortie"
